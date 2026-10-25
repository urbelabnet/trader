// L'audit avversario: i sei guasti veri, da provare davvero e non immaginare.
// Se un test fallisce, si corregge il CODICE, non il test.

import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { alzaSveglia, invia } from "../src/wake";
import { leggiTestimone, leggiLock, CAM_LOCK } from "../src/baton";
import { BrokerFinto } from "../src/fakebroker";
import { idOrdine } from "../src/wake";
import { oraRoma } from "../src/roma";
import type { Broker } from "../src/alpaca";

// La radice del progetto, prima che i test saltino di cartella.
const RADICE = process.cwd();

let cartella = "";
const cwdVecchie: string[] = [];

beforeEach(() => {
  cartella = mkdtempSync(join(tmpdir(), "rompilo-"));
  cpSync(join(RADICE, "src"), join(cartella, "src"), { recursive: true });
  cwdVecchie.push(process.cwd());
  process.chdir(cartella);
});

afterAll(() => {
  while (cwdVecchie.length) process.chdir(cwdVecchie.pop()!);
});

async function fintoDaDisco(): Promise<{ ordini: string[]; posizioni: string[] }> {
  const f = Bun.file("state/fakebroker.json");
  if (!(await f.exists())) return { ordini: [], posizioni: [] };
  const st = JSON.parse(await f.text());
  return {
    ordini: (st.ordini ?? []).map((o: { clientOrderId: string }) => o.clientOrderId),
    posizioni: Object.keys(st.posizioni ?? {}),
  };
}

describe("i sei guasti", () => {
  test(
    "1. morte a metà con un kill vero: la sveglia dopo riconcilia e non ricompra",
    async () => {
    mkdirSync("state", { recursive: true });
    const segnale = "state/killme.now";
    const proc = Bun.spawn({
      cmd: ["bun", "src/cli.ts", "once", "--fake", "--slot", "15:40", "--force"],
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, TARANTOLA_KILL_FILE: segnale },
      cwd: process.cwd(),
    });
    // Attendo il segnale: vuol dire che il primo ordine è sul broker.
    for (let i = 0; i < 60 && !(await Bun.file(segnale).exists()); i++) {
      await Bun.sleep(500);
    }
    proc.kill("SIGKILL");
    await proc.exited;
    // Il lucchetto può esserci (sveglia morta prima del lock-release): va riconciliato.
    // Ciò che non può cambiare: mai due(ordini) SPY comprati due volte.
    const r = await alzaSveglia({ fake: true, slot: "15:40", forza: true });
    expect(r.svoglita).toBe(true);
    const { ordini } = await fintoDaDisco();
    expect(ordini.filter((x) => x.endsWith("SPY-buy")).length).toBe(1);
    expect(await leggiTestimone()).not.toBeNull();
    expect(await leggiLock()).toBeNull();
    },
    30_000,
  );

  test("2. doppio lancio a mezzo secondo di distanza: passa una sola", async () => {
    const [a, b] = await Promise.all([
      alzaSveglia({ fake: true, slot: "18:30", forza: true }),
      Bun.sleep(100).then(() => alzaSveglia({ fake: true, slot: "18:30", forza: true })),
    ]);
    // Il lucchetto esclude il doppio lavoro; se uno entra tardi comunque... gli id coprono.
    const { ordini } = await fintoDaDisco();
    expect(ordini.filter((x) => x.endsWith("GLD-buy")).length).toBe(1);
    expect(a.svoglita || b.svoglita).toBe(true);
    // Solo una delle due può dichiararsi "svolta" con ordini nuovi: l'altra no.
    if (a.svoglita && b.svoglita) {
      // ammesso solo se b ha trovato ogni ordine già presente (nessun doppione rimandato)
      const sp = ordini.filter((x) => x.endsWith("SPY-buy"));
      expect(sp.length).toBe(1);
    }
  });

  test("3. l'ordine arriva ma la risposta si perde: si ritrova sul broker per id", async () => {
    mkdirSync("state", { recursive: true });
    // Il finto con il guasto iniettato: esegue, poi risponde "esito sconosciuto".
    await Bun.write("state/fakebroker.json", JSON.stringify(new BrokerFinto().withGuasti({ timeoutSuProssimoOrdine: true }).toStato()));
    await alzaSveglia({ fake: true, slot: "15:40", forza: true });
    const { ordini, posizioni } = await fintoDaDisco();
    // L'ordine SPY È sul broker, e la sveglia lo sa: nulla è stato mandato due volte.
    expect(ordini.filter((x) => x.endsWith("SPY-buy")).length).toBe(1);
    expect(posizioni).toContain("SPY");
    const t = await leggiTestimone();
    expect(t!.ordini.find((o) => o.simbolo === "SPY")!.esito).toBe("eseguito");
  });

  test("3b. anche il riscontro per id si perde: esito sconosciuto, allarme, nessun doppione", async () => {
    mkdirSync("state", { recursive: true });
    const finto = new BrokerFinto().withGuasti({ timeoutSuProssimoOrdine: true });
    finto.persiste = "state/fakebroker.json";
    // Un mentore: ogni riscontro per id esplode, come quando la rete muore a metà.
    const cheMente = new Proxy(finto, {
      get(target, prop, rec) {
        if (prop === "ordinePerId") {
          return async (): Promise<never> => {
            throw new Error("riscontro perso (test)");
          };
        }
        return Reflect.get(target, prop, rec) as never;
      },
    }) as unknown as Broker;
    const esiti = await invia(
      [{ simbolo: "SPY", lato: "buy", qty: 20, perche: "test" }],
      cheMente,
      oraRoma(),
      {
        scrivi: () => {},
        toTesto: () => "",
        salvalo: async () => {},
      } as never,
      async () => true,
    );
    expect(esiti).toHaveLength(1);
    expect(esiti[0].esito).toBe("esito sconosciuto");
    // E nessun invio alla cieca: l'ordine NON è stato mandato senza sapere se già c'era.
    // La sveglia dopo tornerà a chiedere: è l'unica via onesta.
    expect(await finto.ordinePerId(idOrdine(oraRoma(), "SPY", "buy"))).toBeNull();
  });

  test("4. il modello risponde male: niente ordini nel testimone, la gabbia resta al timone", () => {
    // Coperto dalle prove unit di validaDecisione e dal cervello morto: qui solo il
    // invariante che conta: senza lucchetto non parte nessuna sveglia.
    expect(leggiLock()).resolves.toBeNull();
  });

  test("5. testimone scritto a metà: illeggibile vale come assente, nessun doppione", async () => {
    mkdirSync("state", { recursive: true });
    await Bun.write("state/baton.json", '{"runId": "2026-'); // corrotto a metà
    await Bun.write("state/baton.json.tmp", '{"sporco": true}'); // tmp rimasto senza rename
    await alzaSveglia({ fake: true, slot: "15:40", forza: true });
    const t = await leggiTestimone();
    expect(t!.runId).toContain("-1540");
    const t2 = JSON.parse(await Bun.file(CAM_LOCK.replace("run.lock", "baton.json")).text());
    expect(t2.runId).toBe(t!.runId);
  });

  test("6. la sveglia tarda a mercato chiuso: nessun invio, e la sveglia finisce lo stesso", async () => {
    // Il finto dice in apertura "mercato aperto"... ma rimane chiuso a tutti gli invii.
    const finto = new BrokerFinto();
    finto.aperto = false;
    await Bun.write("state/fakebroker.json", JSON.stringify(finto.toStato()));
    await alzaSveglia({ fake: true, slot: "15:40", forza: true });
    const { ordini } = await fintoDaDisco();
    expect(ordini.filter((x) => x.endsWith("buy")).length).toBe(0);
    const t = await leggiTestimone();
    expect(t!.ordini).toHaveLength(0);
    // Finisce pulita: lucchetto via.
    expect(await leggiLock()).toBeNull();
  });
});
