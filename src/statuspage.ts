// La pagina di stato: conto, prossime sveglie, ultima decisione, storico.
// In sola lettura, chiavi mai dentro. In locale anche servita sulla porta 8787;
// su GitHub Actions è solo un file (state/status.html) che va su GitHub Pages.

import { leggiTestimone, DIR_STATE, DIR_HISTORY } from "./baton";
import { SVEGLIE } from "./config";
import { oraRoma } from "./roma";
import { existsSync, mkdirSync } from "node:fs";

export type RigaStoria = {
  runId: string;
  sveglia: string;
  quando: string;
  ordini: string;
  piano: string;
  prossimaMossa: string;
};

export type Verita = {
  baton: Awaited<ReturnType<typeof leggiTestimone>>;
  righe: RigaStoria[];
  lock: boolean;
};

export async function leggiVerita(): Promise<Verita> {
  const baton = await leggiTestimone();
  const righe: RigaStoria[] = [];
  // I testimoni storici stanno tutti in state/history, uno per sveglia: lì si cerca,
  // non alla radice (difetto visto il 25/10/2026: lo Storico della pagina vuoto).
  const glob = new Bun.Glob("*.json");
  const file: string[] = [];
  if (existsSync(DIR_HISTORY)) {
    for await (const f of glob.scan(DIR_HISTORY)) file.push(f);
  }
  // il glob restituisce i nomi relativi alla cartella: va riappiccicato il percorso
  for (const f of file.sort().reverse()) {
    try {
      const t = JSON.parse(await Bun.file(`${DIR_HISTORY}/${f}`).text());
      if (t.sveglia && t.runId) {
        righe.push({
          runId: t.runId,
          sveglia: t.sveglia,
          quando: t.quando,
          ordini:
            (t.ordini ?? [])
              .map((e: { simbolo: string; lato: string; qty: number }) => `${e.lato} ${e.qty} ${e.simbolo}`)
              .join(", ") || "nessuno",
          piano: t.piano ?? "",
          prossimaMossa: t.perLaProssima ?? "",
        });
      }
    } catch {
      // la storia corrotta non ferma la pagina
    }
    if (righe.length >= 40) break;
  }
  const lock = await Bun.file("state/run.lock").exists();
  return { baton, righe, lock };
}

export async function paginaStato(): Promise<string> {
  const { baton, righe, lock } = await leggiVerita();
  const adesso = oraRoma();

  const esc = (t: string): string =>
    String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const rigaE = (label: string, valore: string): string =>
    `<tr><td>${esc(label)}</td><td>${esc(valore)}</td></tr>`;
  const vuoto = "—";

  const stato = [
    rigaE("Adesso", `${adesso.data} ${adesso.hhmm} (ora di Roma)`),
    rigaE("Lucchetto", lock ? "presente: sveglia in corso o interrotta" : "nessuno"),
    rigaE("Ultimo testimone", baton ? `${baton.quando} · ${baton.sveglia} · ${baton.runId}` : vuoto),
    rigaE("Conto", baton ? `${baton.conto.toFixed(2).replace(".", ",")} $` : vuoto),
    rigaE("Ultima decisione (Perché)", baton?.piano ?? vuoto),
    rigaE("Prossima mossa", baton?.perLaProssima ?? vuoto),
    rigaE(
      "Ultimi ordini",
      (baton?.ordini ?? []).map((e) => `${e.lato} ${e.qty} ${e.simbolo}: ${e.esito}`).join("; ") || "nessuno",
    ),
    rigaE(
      "Ultimi rifiuti",
      (baton?.rifiutati ?? []).map((r) => `${r.simbolo}: ${r.motivo}`).join("; ") || "nessuno",
    ),
  ].join("\n");

  const sveglie = SVEGLIE.map((s) => `<li>${s.hhmm} · ${s.nome}</li>`).join("\n");
  const storia = righe
    .map(
      (h) =>
        `<tr><td>${esc(h.runId)}</td><td>${esc(h.sveglia)}</td><td>${esc(h.ordini)}</td><td>${esc(h.piano)}</td><td>${esc(h.prossimaMossa)}</td></tr>`,
    )
    .join("\n");

  return `<!doctype html>
<html lang="it">
<head><meta charset="utf-8"><title>Tarantola · stato</title>
<style>
body { font-family: system-ui, sans-serif; margin: 2rem; color:#222; max-width: 1100px; }
h1 { font-size: 1.4rem } h2 { font-size: 1.1rem; margin-top: 2rem }
table { border-collapse: collapse; width: 100%; }
td { border: 1px solid #ddd; padding: 6px 10px; vertical-align: top; }
td:first-child { white-space: nowrap; font-weight: 600; }
small { color:#777 }
</style></head>
<body>
<h1>Tarantola · paper trading a orari fissi</h1>
<p><small>Pagina di stato, in sola lettura. Soldi finti, prezzi veri.</small></p>
<h2>Ora</h2>
<table>${stato}</table>
<h2>Sveglie (ora di Roma, borsa USA 15:30–22:00)</h2>
<ol>${sveglie}</ol>
<h2>Storico</h2>
<table>${storia}</table>
</body>
</html>`;
}

/** L'istantanea che viene committata per GitHub Pages. */
export async function scriviIstantanea(): Promise<void> {
  if (!existsSync(DIR_STATE)) mkdirSync(DIR_STATE, { recursive: true });
  await Bun.write(`${DIR_STATE}/status.html`, await paginaStato());
}
