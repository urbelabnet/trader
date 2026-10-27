// I comandi nella pratica: once, schedule, status, reconcile.
// Opzioni: --fake (broker e cervello finti), --slot 15:40 (scegli la sveglia), --force (rifalla).

import { alzaSveglia, riconcilia } from "./wake";
import type { Modalita } from "./wake";
import { PORTA_STATO, PORTA_CRUSCOTTO, garantisciPaper, BROKER_BASE } from "./config";
import { leggiLock } from "./baton";
import { leggiVerita, paginaStato, scriviIstantanea } from "./statuspage";
import { Alpaca } from "./alpaca";

const uso = `Uso:
  bun run once [--fake] [--slot 15:40] [--force]     una sveglia (la dovuta, o quella scelta)
  bun run schedule [--fake]                          resta acceso: sveglie a orario, pagina di stato sulla porta ${PORTA_STATO}
  bun run cruscotto                                  la cruscotto in locale sulla porta ${PORTA_CRUSCOTTO} (F5 = fotografia nuova)
  bun run status                                     testimone, lucchetto, conto
  bun run reconcile                                  cosa è successo alla sveglia interrotta
  bun test                                           i test (broker e cervello finti)`;

function parseArgv(): { cmd: string; fake: boolean; slot?: string; forza: boolean } {
  const [cmd = "", ...resto] = process.argv.slice(2);
  const fake = resto.includes("--fake");
  const forza = resto.includes("--force");
  let slot: string | undefined;
  const iSlot = resto.indexOf("--slot");
  if (iSlot >= 0 && resto[iSlot + 1]) slot = resto[iSlot + 1];
  return { cmd, fake, slot, forza };
}

async function main(): Promise<number> {
  const { cmd, fake, slot, forza } = parseArgv();
  const mod: Modalita = { fake, slot, forza };

  switch (cmd) {
    case "once": {
      const r = await alzaSveglia(mod);
      for (const l of r.log) console.log(l);
      return r.svoglita || r.runId === "-" ? 0 : 1;
    }

    case "schedule": {
      garantisciPaper(BROKER_BASE);
      // La pagina di stato resta in ascolto finché il processo vive.
      Bun.serve({
        port: PORTA_STATO,
        fetch: async () =>
          new Response(await paginaStato(), {
            headers: { "content-type": "text/html; charset=utf-8" },
          }),
      });
      console.log(`[stato    ] pagina di stato sulla porta ${PORTA_STATO}`);
      for (;;) {
        await alzaSveglia(mod);
        await Bun.sleep(30_000);
      }
    }

    case "status": {
      const v = await leggiVerita();
      console.log(`[stato    ] lucchetto: ${v.lock ? "presente" : "nessuno"}`);
      console.log(
        `[testimone] ${v.baton ? `${v.baton.quando} · ${v.baton.sveglia} · ${v.baton.runId}` : "nessuno"}`,
      );
      if (v.baton) {
        console.log(`[conto    ] ${v.baton.conto.toFixed(2).replace(".", ",")} $`);
        console.log(`[perche   ] ${v.baton.piano}`);
        console.log(`[mossa    ] ${v.baton.perLaProssima}`);
      }
      await scriviIstantanea();
      console.log(`[stato    ] istantanea scritta in state/status.html`);
      return 0;
    }

    case "reconcile": {
      const lock = await leggiLock();
      if (!lock) {
        console.log("[reconcile] nessun lucchetto su disco: nessuna sveglia da conciliare");
        return 0;
      }
      // A mano, per vedere cosa è successo: la sveglia dopo farà la stessa riconciliazione.
      const broker = new Alpaca();
      console.log(`[reconcile] sveglia interrotta: ${lock.sveglia} (${lock.runId})`);
      console.log(await riconcilia(broker, lock.runId));
      return 0;
    }

    case "cruscotto": {
      // La cruscotto in locale: a ogni richiesta la pagina si rigenera dallo stato,
      // quindi un ricaricare (F5) è una fotografia nuova. Nessun ordine, nulla che tocca il broker.
      Bun.serve({
        port: PORTA_CRUSCOTTO,
        fetch: async () =>
          new Response(await paginaStato(), {
            headers: { "content-type": "text/html; charset=utf-8" },
          }),
      });
      console.log(`[cruscotto] in ascolto sulla porta ${PORTA_CRUSCOTTO} · http://localhost:${PORTA_CRUSCOTTO}/`);
      console.log(`[cruscotto] premi Ctrl+C per fermare`);
      for (;;) await Bun.sleep(30_000);
    }

    default:
      console.log(uso);
      return cmd ? 2 : 0;
  }
}

process.exit(await main());
