// Orologio di Roma: le sveglie sono tutte all'ora di Roma, la borsa USA 15:30–22:00 qui.

import { FUSO, SVEGLIE, type Sveglia } from "./config";

const fmtRoma = new Intl.DateTimeFormat("it-IT", {
  timeZone: FUSO,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export type Ora = { data: string; hhmm: string };

/** L'ora di Roma adesso: data e hh:mm. */
export function oraRoma(d: Date = new Date()): Ora {
  const p = Object.fromEntries(
    fmtRoma.formatToParts(d).map((x) => [x.type, x.value]),
  ) as Record<string, string>;
  const hh = p.hour === "24" ? "00" : p.hour;
  return { data: `${p.year}-${p.month}-${p.day}`, hhmm: `${hh}:${p.minute}` };
}

export function testoRoma(o: Ora): string {
  return `${o.data} ${o.hhmm}`;
}

/** L'epoch di un tempo di parete ("AAAA-MM-GG", "HH:MM") a Roma. Sicuro anche col cambio ora. */
export function epochDi(o: Ora): number {
  const nominale = Date.parse(`${o.data}T${o.hhmm}:00Z`);
  for (let off = 14 * 60; off >= -12 * 60; off -= 30) {
    const t = nominale - off * 60_000;
    const readetto = oraRoma(new Date(t));
    if (readetto.data === o.data && readetto.hhmm === o.hhmm) return t;
  }
  return nominale;
}

/** Ordina le sveglie del giorno con il loro tempo accaduto (epoch, Roma). */
export function sveglieDelGiorno(data: string): Array<Sveglia & { ts: number }> {
  return SVEGLIE.map((s) => ({ ...s, ts: epochDi({ data, hhmm: s.hhmm }) })).sort((a, b) => a.ts - b.ts);
}

/** runId "AAAA-MM-GG-HHMM" come vogliono i messaggi e gli id degli ordini. */
export function runIdDi(o: Ora): string {
  return `${o.data}-${o.hhmm.replace(":", "")}`;
}
