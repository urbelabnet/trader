// I test del contratto, tutti con broker e cervello finti.
// Ogni test lavora in una cartella temporanea: niente stato sporco tra uno e l'altro.

import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { alzaSveglia } from "../src/wake";
import { leggiTestimone, leggiLock, scriviTestimone, CAM_LOCK } from "../src/baton";
import { attraversa, stopSulCarico } from "../src/cage";
import { garantisciPaper } from "../src/config";
import { validaDecisione } from "../src/llm";
import type { Testimone } from "../src/baton";
import { leggiVerita, paginaStato } from "../src/statuspage";
import { epochDi, oraRoma } from "../src/roma";
import { BrokerFinto } from "../src/fakebroker";

let cartella = "";
const cwdVecchie: string[] = [];

beforeEach(() => {
  cartella = mkdtempSync(join(tmpdir(), "tarantola-"));
  cwdVecchie.push(process.cwd());
  process.chdir(cartella);
});

afterAll(() => {
  while (cwdVecchie.length) process.chdir(cwdVecchie.pop()!);
});

// Helper: il broker finto come la sveglia l'ha lasciato su disco.
async function fintoDaDisco(): Promise<{
  ordiniIds: string[];
  posizioni: Record<string, { qty: number; prezzoCarico: number }>;
}> {
  const f = Bun.file("state/fakebroker.json");
  if (!(await f.exists())) return { ordiniIds: [], posizioni: {} };
  const st = JSON.parse(await f.text());
  return {
    ordiniIds: (st.ordini ?? []).map((o: { clientOrderId: string }) => o.clientOrderId),
    posizioni: st.posizioni ?? {},
  };
}

describe("gabbia", () => {
  const prezzi = { SPY: 600, QQQ: 500, NVDA: 180, GOOG: 3000, TLT: 92 };
  const equity = 100_000;

  test("rifiuta ordini fuori universo, accetta quelli dentro", () => {
    const g = attraversa(
      [
        { simbolo: "SPY", lato: "buy", qty: 10, perche: "" },
        { simbolo: "GOOG", lato: "buy", qty: 1, perche: "" },
      ],
      [],
      equity,
      prezzi,
    );
    expect(g.passati.map((p) => p.simbolo)).toEqual(["SPY"]);
    expect(g.rifiutati).toHaveLength(1);
    expect(g.rifiutati[0].motivo).toContain("universo");
  });

  test("rifiuta il 40% del conto su un titolo", () => {
    const g = attraversa(
      [{ simbolo: "NVDA", lato: "buy", qty: 220, perche: "" }],
      [],
      equity,
      prezzi,
    );
    expect(g.passati).toHaveLength(0);
    expect(g.rifiutati[0].motivo).toContain("%");
  });

  test("il peso massimo conta anche la posizione già aperta", () => {
    const pos = [{ simbolo: "NVDA", qty: 30, prezzoCarico: 180, prezzo: 180, pnlPerc: 0, valore: 5400 }];
    const g = attraversa([{ simbolo: "NVDA", lato: "buy", qty: 50, perche: "" }], pos, equity, prezzi);
    // 50 azioni a 180 = 9.000 $ più la posizione da 5.400 $ = 14.400 $ (14,4%): ci sta.
    expect(g.passati).toHaveLength(1);
    const g2 = attraversa([{ simbolo: "NVDA", lato: "buy", qty: 100, perche: "" }], pos, equity, prezzi);
    // 18.000 $ più 5.400 $ = 23,4%: più del 20%, no.
    expect(g2.passati).toHaveLength(0);
    expect(g2.rifiutati[0].motivo).toContain("%");
  });

  test("quantità negative o frazionarie si rifiutano", () => {
    const g = attraversa(
      [
        { simbolo: "SPY", lato: "buy", qty: -3, perche: "" },
        { simbolo: "SPY", lato: "buy", qty: 10.5, perche: "" },
      ],
      [],
      equity,
      prezzi,
    );
    expect(g.passati).toHaveLength(0);
    expect(g.rifiutati).toHaveLength(2);
  });

  test("lo stop a -3% vende la posizione intera, anche se nessuno lo chiede", () => {
    const pos = [{ simbolo: "NVDA", qty: 30, prezzoCarico: 180, prezzo: 172.8, pnlPerc: -0.04, valore: 5184 }];
    const stop = stopSulCarico(pos);
    expect(stop).toHaveLength(1);
    expect(stop[0].simbolo).toBe("NVDA");
    expect(stop[0].lato).toBe("sell");
    expect(stop[0].qty).toBe(30);
  });
});

describe("il contratto sul serio", () => {
  test("1. stessa sveglia lanciata due volte: un solo ordine per titolo", async () => {
    await alzaSveglia({ fake: true, slot: "15:40", forza: true });
    const r2 = await alzaSveglia({ fake: true, slot: "15:40", forza: true });
    expect(r2.svoglita).toBe(true);
    const { ordiniIds, posizioni } = await fintoDaDisco();
    expect(ordiniIds).toEqual([
      `${r2.runId}-SPY-buy`,
      `${r2.runId}-QQQ-buy`,
      `${r2.runId}-GLD-buy`,
    ]);
    expect(Object.keys(posizioni).sort()).toEqual(["GLD", "QQQ", "SPY"]);
    expect(posizioni.SPY.qty).toBe(20);
  });

  test("2. sveglia morta dopo il primo ordine: riconcilia e non ricompra", async () => {
    await alzaSveglia({ fake: true, slot: "15:40", forza: true });
    // La sveglia è morta dopo l'invio, prima di finire: il lucchetto resta su disco.
    const prima = (await leggiTestimone())!;
    await Bun.write(
      CAM_LOCK,
      JSON.stringify({ runId: prima.runId, sveglia: "apertura", epoch: Date.now() - 61 * 60_000, pid: 999 }),
    );
    // Il cervello finto propone ancora gli stessi acquisti: non deve ricomprarli.
    const r = await alzaSveglia({ fake: true, slot: "15:40", forza: true });
    expect(r.svoglita).toBe(true);
    const { ordiniIds } = await fintoDaDisco();
    expect(ordiniIds.filter((x) => x.endsWith("GLD-buy")).length).toBe(1);
    const t = await leggiTestimone();
    expect(t!.note).toContain("Sveglia precedente interrotta");
    expect(await leggiLock()).toBeNull();
  });

  test("3. testimone delle 09:00, niente fino alle 21:40: apertura e metà seduta salate", async () => {
    const ora = oraRoma();
    const briefing: Testimone = {
      runId: `${ora.data}-0900`,
      sveglia: "briefing",
      quando: `${ora.data} 09:00`,
      epoch: epochDi({ data: ora.data, hhmm: "09:00" }),
      ordini: [],
      rifiutati: [],
      conto: 100_000,
      piano: "Il piano del mattino.",
      perLaProssima: "",
      note: "",
      equityGiorno: 100_000,
    };
    await scriviTestimone(briefing);
    // Le 23:55 della stessa data: le sveglie delle 15:40 e delle 18:30 sono salate da ore.
    await alzaSveglia({ fake: true, slot: "21:40", forza: true }, { data: ora.data, hhmm: "23:55" });
    const t = await leggiTestimone();
    expect(t!.note).toContain("Sveglie saltate");
    expect(t!.note).toContain("apertura");
    expect(t!.note).toContain("meta");
    // La chiusura è quella che si sta facendo, in ritardo: non è saltata.
    expect(t!.note).not.toContain("chiusura");
  });

  test("4. testimone corrotto: vale come assente, la sveglia va avanti col broker", async () => {
    await mkdirSync("state", { recursive: true });
    await Bun.write("state/baton.json", "{ corrotto: [[[");
    await alzaSveglia({ fake: true, slot: "15:40", forza: true });
    const t = await leggiTestimone();
    expect(t).not.toBeNull();
    expect(t!.ordini.map((e) => e.simbolo)).toEqual(["SPY", "QQQ", "GLD"]);
  });

  test("5. cervello spento: niente ordini nuovi, lo stop loss gira lo stesso", async () => {
    // Il portafoglio: 30 NVDA a 180. Il prezzo finto lo porta a 172,8 (-4%): sotto lo stop.
    const ritorno = new BrokerFinto({
      cash: 80_000,
      // Carico a 187,2 con prezzo di repertorio 180: −3,85%, sotto lo stop.
      posizioni: { NVDA: { qty: 30, prezzoCarico: 187.2 } },
      ordini: [],
    });
    mkdirSync("state", { recursive: true });
    await Bun.write("state/fakebroker.json", JSON.stringify(ritorno.toStato()));
    await alzaSveglia({ fake: true, cervelloMorto: true, slot: "18:30", forza: true });
    const { ordiniIds, posizioni } = await fintoDaDisco();
    expect(ordiniIds).toHaveLength(1);
    expect(ordiniIds[0]).toContain("NVDA-sell");
    expect(Object.keys(posizioni)).not.toContain("NVDA");
    const t = await leggiTestimone();
    expect(t!.note).toContain("Cervello non disponibile");
  });

  test("6. il cervello risponde malformato: la decisione si scarta intera", () => {
    expect(validaDecisione(null)).toBeNull();
    expect(validaDecisione("buongiorno")).toBeNull();
    expect(
      validaDecisione({
        orders: [{ simbolo: "SPY", lato: "buy", qty: -1, perche: "" }],
        reasoning: "x",
        planNext: "y",
      }),
    ).toBeNull();
    const bene = validaDecisione({
      orders: [{ simbolo: "SPY", lato: "buy", qty: 20, perche: "un motivo" }],
      reasoning: "tre frasi giuste qui",
      planNext: "domani",
    });
    expect(bene).not.toBeNull();
    expect(bene!.planNext).toBe("domani");
  });

  test("7. la guardia del paper: si rifiuta di girare sull'endpoint vero", () => {
    expect(() => garantisciPaper("https://api.alpaca.markets")).toThrow();
    expect(() => garantisciPaper("https://paper-api.alpaca.markets")).not.toThrow();
  });

  test("8. lo Storico della pagina di stato legge state/history, non la radice", async () => {
    const ora = oraRoma();
    const t: Testimone = {
      runId: `${ora.data}-1530`,
      sveglia: "briefing",
      quando: `${ora.data} 15:30`,
      epoch: epochDi({ data: ora.data, hhmm: "15:30" }),
      ordini: [],
      rifiutati: [],
      conto: 100_000,
      piano: "Il piano di prova dello Storico.",
      perLaProssima: "",
      note: "",
      equityGiorno: 100_000,
    };
    await scriviTestimone(t); // scrive baton.json E la copia in state/history/
    const v = await leggiVerita();
    expect(v.righe.map((r) => r.runId)).toContain(t.runId);
    const html = await paginaStato();
    expect(html).toContain(t.runId);
    expect(html).toContain("Il piano di prova dello Storico.");
  });
});
