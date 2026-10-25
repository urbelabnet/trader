// Il cervello: un LLM via API REST, isolato qui. Cambiare provider deve toccare un file solo.
// Il modello propone; la risposta è JSON a schema fisso. Nessuno strumento, nessuna chat.

import { GEMINI_MODEL } from "./config";
import { chiavi } from "./secrets";

export type OrdineModello = {
  simbolo: string;
  lato: "buy" | "sell";
  qty: number;
  perche: string;
};

export type Decisione = {
  orders: OrdineModello[];
  reasoning: string; // 3–5 frasi
  planNext: string; // cosa controllare alla prossima sveglia
};

export type ContestoCervello = {
  runId: string;
  sveglia: string;
  quando: string;
  mercatoAperto: boolean;
  conto: { equity: number; cash: number };
  posizioni: Array<{ simbolo: string; qty: number; prezzoCarico: number; prezzo: number; pnlPerc: number }>;
  ordiniRecenti: Array<{ simbolo: string; lato: string; qty: number; quando: string }>;
  ultimoPiano: string | null; // il "Perché" della sveglia prima
  prossimaMossa: string | null; // il "Prossima mossa" della sveglia prima
  note: string; // allarmi, sveglie saltate, riconciliazioni
};

export type OttenutoCervello =
  | { fatto: true; decisione: Decisione }
  | { fatto: false; causa: string };

// ---- Il prompt (in italiano, in questo file: qui va cambiato anche il tono) ----

const SISTEMA = `Sei il cervello di un trader su conto demo (paper trading), svegliato a orari fissi senza nessuno al computer.
Rispondi SEMPRE e SOLO con JSON valido a schema fisso con i campi: orders, reasoning, planNext.
- orders: la lista di ordini che proponi (può essere vuota). Ognuno: simbolo, lato ("buy" o "sell"), qty intero positivo, perche (una frase, in italiano).
- reasoning: da 3 a 5 frasi in italiano: cosa vedi, cosa decidi, perché.
- planNext: cosa controllare alla prossima sveglia, in italiano.
Non puoi usare strumenti e non vedi altro oltre il contesto che ti passa il programma.
Regole che non puoi violare (il programma le controlla comunque, ma non proporre ciò che verrebbe rifiutato):
- solo titoli tra SPY QQQ IWM AAPL MSFT NVDA GLD TLT; azioni intere; niente short; niente leva
- massimo 5 titoli contemporaneamente in portafoglio; massimo 20% del conto per titolo (posizione già aperta inclusa)
- a mercato chiuso o nel briefing nessun ordine: proponi solo il piano
- una posizione venduta per stop non si riapre lo stesso giorno
Scrivi in italiano semplice, come un trader che sa di non poter rileggere niente alla sveglia dopo.`;

function contestoInTesto(c: ContestoCervello): string {
  return JSON.stringify(
    {
      sveglia: { id: c.runId, nome: c.sveglia, quando: c.quando, mercatoAperto: c.mercatoAperto },
      conto: c.conto,
      posizioni: c.posizioni,
      ordiniRecenti48h: c.ordiniRecenti,
      svegliaPrecedente: { piano: c.ultimoPiano, prossimaMossa: c.prossimaMossa },
      avvisi: c.note,
    },
    null,
    1,
  );
}

// ---- L'adattatore Gemini (chiave GEMINI_API_KEY, modello da GEMINI_MODEL) ----

const URL_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

/** La decisione a schema fisso: i nomi dei campi sono quelli del contratto. */
const SCHEMA_DECISIONE = {
  type: "OBJECT",
  properties: {
    orders: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          simbolo: { type: "STRING" },
          lato: { type: "STRING", enum: ["buy", "sell"] },
          qty: { type: "INTEGER" },
          perche: { type: "STRING" },
        },
        required: ["simbolo", "lato", "qty", "perche"],
      },
    },
    reasoning: { type: "STRING" },
    planNext: { type: "STRING" },
  },
  required: ["orders", "reasoning", "planNext"],
};

class ErroreGemini extends Error {
  constructor(
    messaggio: string,
    readonly ritentabile: boolean,
  ) {
    super(messaggio);
  }
}

async function geminiChiamata(testo: string, tentativi = 3): Promise<string> {
  const k = chiavi();
  const esegui = async (): Promise<string> => {
    const r = await fetch(`${URL_BASE}/${GEMINI_MODEL}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": k.GEMINI_API_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SISTEMA }] },
        contents: [{ role: "user", parts: [{ text: testo }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: SCHEMA_DECISIONE,
          temperature: 0.6,
        },
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!r.ok) {
      const d = await r.text();
      const ritenta = r.status >= 500 || r.status === 429;
      throw new ErroreGemini(`Gemini ${r.status}: ${d.slice(0, 300)}`, ritenta);
    }
    const j = (await r.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const t = j.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    if (!t) throw new ErroreGemini("Gemini ha risposto senza testo", true);
    return t;
  };

  let ultimo: unknown = null;
  for (let t = 1; t <= tentativi; t++) {
    try {
      return await esegui();
    } catch (e) {
      ultimo = e;
      if (e instanceof ErroreGemini && !e.ritentabile) break;
      if (t < tentativi) await new Promise((f) => setTimeout(f, 1000 * t * t));
    }
  }
  throw ultimo;
}

export function validaDecisione(d: unknown): Decisione | null {
  if (!d || typeof d !== "object") return null;
  const o = d as Partial<Decisione>;
  if (!Array.isArray(o.orders) || typeof o.reasoning !== "string" || typeof o.planNext !== "string")
    return null;
  const orders: OrdineModello[] = [];
  for (const x of o.orders) {
    const z = x as Partial<OrdineModello>;
    if (
      typeof z.simbolo === "string" &&
      (z.lato === "buy" || z.lato === "sell") &&
      Number.isInteger(z.qty) &&
      (z.qty as number) > 0 &&
      typeof z.perche === "string"
    ) {
      orders.push({ simbolo: z.simbolo, lato: z.lato, qty: z.qty as number, perche: z.perche });
    } else {
      return null; // un ordine malformato rende la decisione inaffidabile: si scarta tutta
    }
  }
  return { orders, reasoning: o.reasoning, planNext: o.planNext };
}

// ---- La faccia del cervello ----

export class GeminiCervello {
  readonly nome = `cervello ${GEMINI_MODEL}`;

  async decide(c: ContestoCervello): Promise<OttenutoCervello> {
    const k = chiavi();
    if (!k.GEMINI_API_KEY) {
      return { fatto: false, causa: "cervello non configurato: manca GEMINI_API_KEY" };
    }
    try {
      const testo = await geminiChiamata(contestoInTesto(c));
      let parsed: unknown;
      try {
        parsed = JSON.parse(testo);
      } catch {
        // JSON troncato o pigiato: non è una decisione, è rumore.
        return { fatto: false, causa: "il cervello ha risposto un JSON illeggibile" };
      }
      const d = validaDecisione(parsed);
      if (!d) return { fatto: false, causa: "il cervello ha risposto malformato: scartata" };
      return { fatto: true, decisione: d };
    } catch (e) {
      return { fatto: false, causa: `il cervello non risponde: ${(e as Error).message}` };
    }
  }
}

export class CervelloFinto {
  readonly nome = "cervello: finto (prova, nessuna chiamata)";  async decide(_c: ContestoCervello): Promise<OttenutoCervello> {
    void _c;
    return {
      fatto: true,
      decisione: {
        orders: [
          { simbolo: "SPY", lato: "buy", qty: 20, perche: "indice largo, base del portafoglio" },
          { simbolo: "QQQ", lato: "buy", qty: 10, perche: "tecnologia" },
          { simbolo: "GLD", lato: "buy", qty: 25, perche: "oro, copertura" },
        ],
        reasoning:
          "Prova con broker e cervello finti: eseguo il piano della sveglia precedente. Nessuna indicazione di mercato è vera, è una prova della catena. Le regole della gabbia restano quelle vere.",
        planNext: "A metà seduta controllare che nessuna delle posizioni sia vicina allo stop.",
      },
    };
  }
}

/** Il cervello adatto alla modalità. */
export function scegliCervello(fake: boolean): GeminiCervello | CervelloFinto | CervelloMorto {
  if (fake) return new CervelloFinto();
  return new GeminiCervello();
}

/** Il cervello spezzato: per i test che provano la sveglia quando non risponde nessuno. */
export class CervelloMorto {
  readonly nome = "cervello: morto (test)";

  async decide(_c: ContestoCervello): Promise<OttenutoCervello> {
    void _c;
    return { fatto: false, causa: "cervello morto (test)" };
  }
}
