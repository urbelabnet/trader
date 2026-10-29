// Interfaccia del broker e client REST v2 della Alpaca paper.
// Tutti gli ordini portano un client_order_id deterministico: è quello che impedisce i doppioni.

import { BROKER_BASE, DATA_BASE, garantisciPaper } from "./config";
import { chiavi } from "./secrets";

export type Conto = { equity: number; cash: number };
export type Posizione = {
  simbolo: string;
  qty: number; // azioni (sempre positive: niente qui lo short)
  prezzoCarico: number;
  prezzo: number;
  pnlPerc: number; // relativo al prezzo di carico
  valore: number;
};
export type OrdineBroker = {
  clientOrderId: string;
  simbolo: string;
  lato: "buy" | "sell";
  qty: number;
  stato: string; // "filled", "accepted", "rejected", ...
  creatoIl: string;
  prezzoMed?: number; // prezzo medio di esecuzione se noto
};
export type Orologio = { open: boolean; nextOpen: string; nextClose: string };
export type RichiestoOrdine = { simbolo: string; lato: "buy" | "sell"; qty: number };
export type EsitoOrdine = {
  esito: "eseguito" | "accettato" | "doppione" | "sconosciuto";
  dettaglio: string;
};

export interface Broker {
  readonly nome: string;
  conto(): Promise<Conto>;
  posizioni(): Promise<Posizione[]>;
  ordini48h(): Promise<OrdineBroker[]>;
  orologio(): Promise<Orologio>;
  prezzo(simbolo: string): Promise<number>;
  /** Invia un ordine con l'id dato. Il broker rifiuta da solo un doppione. */
  ordine(o: RichiestoOrdine, clientOrderId: string): Promise<EsitoOrdine>;
  ordinePerId(clientOrderId: string): Promise<OrdineBroker | null>;
}

export class ErroreBroker extends Error {
  constructor(
    messaggio: string,
    readonly ritentabile: boolean,
    readonly statoHttp?: number,
  ) {
    super(messaggio);
  }
}

const TENTATIVI = 3;
const TIMEOUT_MS = 30_000;

async function alpacaFetch(
  base: string,
  percorso: string,
  init: RequestInit = {},
): Promise<unknown> {
  garantisciPaper(base);
  const k = chiavi();
  if (!k.ALPACA_KEY_ID || !k.ALPACA_SECRET_KEY) {
    throw new ErroreBroker("Chiavi Alpaca non configurate (secrets.ts o ambiente).", false);
  }
  const intestazioni: Record<string, string> = {
    "APCA-API-KEY-ID": k.ALPACA_KEY_ID,
    "APCA-API-SECRET-KEY": k.ALPACA_SECRET_KEY,
    "content-type": "application/json",
    ...((init.headers as Record<string, string>) ?? {}),
  };
  let ultimoErrore: unknown;
  for (let t = 1; t <= TENTATIVI; t++) {
    try {
      const r = await fetch(base + percorso, {
        ...init,
        headers: intestazioni,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (r.ok) return (await r.json()) as unknown;
      const testo = await r.text();
      // 4xx (tranne 429): non ritenta. 5xx e 429: ritenta.
      const ritenta = r.status >= 500 || r.status === 429;
      throw new ErroreBroker(`Alpaca ${r.status}: ${testo.slice(0, 300)}`, ritenta, r.status);
    } catch (e) {
      // Errore di rete/timeout: riprova fino a tre volte.
      const ritentabile = e instanceof ErroreBroker ? e.ritentabile : true;
      ultimoErrore = e;
      if (!ritentabile || t === TENTATIVI) break;
      await new Promise((f) => setTimeout(f, 500 * t * t));
    }
  }
  throw ultimoErrore;
}

// ---- Letture ----

export class Alpaca implements Broker {
  readonly nome = "Alpaca paper";

  async conto(): Promise<Conto> {
    const a = (await alpacaFetch(BROKER_BASE, "/v2/account")) as Record<string, string>;
    return { equity: Number(a.equity), cash: Number(a.cash) };
  }

  async posizioni(): Promise<Posizione[]> {
    const raw = (await alpacaFetch(BROKER_BASE, "/v2/positions")) as Array<Record<string, string>>;
    return raw.map((p) => ({
      simbolo: p.symbol,
      qty: Math.abs(Number(p.qty)),
      prezzoCarico: Number(p.avg_entry_price),
      prezzo: Number(p.current_price),
      pnlPerc: Number(p.avg_entry_price) === 0 ? 0 : (Number(p.current_price) - Number(p.avg_entry_price)) / Number(p.avg_entry_price),
      valore: Number(p.market_value),
    }));
  }

  async ordini48h(): Promise<OrdineBroker[]> {
    const raw = (await alpacaFetch(
      BROKER_BASE,
      "/v2/orders?status=all&limit=100&direction=desc",
    )) as Array<Record<string, string>>;
    const limite = new Date(Date.now() - 48 * 3600_000);
    return raw
      .filter((o) => new Date(o.created_at) >= limite)
      .map((o) => ({
        clientOrderId: o.client_order_id ?? "",
        simbolo: o.symbol,
        lato: o.side as "buy" | "sell",
        qty: Number(o.qty),
        stato: o.status,
        creatoIl: o.created_at,
        prezzoMed: o.filled_avg_price ? Number(o.filled_avg_price) : undefined,
      }));
  }

  async orologio(): Promise<Orologio> {
    const c = (await alpacaFetch(BROKER_BASE, "/v2/clock")) as Record<string, string | boolean>;
    return {
      open: Boolean(c.is_open),
      nextOpen: String(c.next_open),
      nextClose: String(c.next_close),
    };
  }

  /** Prezzi veri dal feed IEX di Alpaca: basta per pesare gli ordini. */
  async prezzo(simbolo: string): Promise<number> {
    const t = (await alpacaFetch(
      DATA_BASE,
      `/v2/stocks/${encodeURIComponent(simbolo)}/trades/latest?feed=iex`,
    )) as { trade?: { p?: string | number } };
    const p = Number(t?.trade?.p ?? NaN);
    if (!Number.isFinite(p) || p <= 0) {
      throw new ErroreBroker(`Prezzo non disponibile per ${simbolo}.`, true);
    }
    return p;
  }

  async ordine(o: RichiestoOrdine, clientOrderId: string): Promise<EsitoOrdine> {
    try {
      const r = (await alpacaFetch(BROKER_BASE, "/v2/orders", {
        method: "POST",
        body: JSON.stringify({
          symbol: o.simbolo,
          qty: o.qty,
          side: o.lato,
          type: "market",
          time_in_force: "day",
          client_order_id: clientOrderId,
        }),
      })) as { status?: string };
      const stato = r.status ?? "accettato";
      return {
        esito: stato === "filled" ? "eseguito" : "accettato",
        dettaglio: `ordine ${clientOrderId} ${stato}`,
      };
    } catch (e) {
      // Errore di rete mentre l'ordine potrebbe essere partito: esito sconosciuto,
      // si decide col riscontro per id, mai rimandando alla cieca.
      return {
        esito: "sconosciuto",
        dettaglio: `esito sconosciuto per ${clientOrderId}: ${(e as Error).message}`,
      };
    }
  }

  async ordinePerId(clientOrderId: string): Promise<OrdineBroker | null> {
    const tutti = await this.ordini48h();
    return tutti.find((o) => o.clientOrderId === clientOrderId) ?? null;
  }
}
