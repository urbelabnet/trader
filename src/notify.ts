// Il canale: un bot Telegram. ▶ a inizio sveglia, ✅ a fine, ⚠ per gli allarmi.
// Se Telegram non risponde, la sveglia non si ferma: lo scrive nel log.

import { chiavi } from "./secrets";

export type Notifica = { ok: boolean; dettaglio: string };

const LIMITE = 3800; // margine sotto i 4096 di Telegram

async function invia(testo: string): Promise<Notifica> {
  const k = chiavi();
  if (!k.TELEGRAM_BOT_TOKEN || !k.TELEGRAM_CHAT_ID) {
    return { ok: false, dettaglio: "Telegram non configurato (token o chat id assenti)" };
  }
  try {
    const r = await fetch(`https://api.telegram.org/bot${k.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: k.TELEGRAM_CHAT_ID, text: testo }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) return { ok: false, dettaglio: `Telegram ${r.status}` };
    return { ok: true, dettaglio: "inviato" };
  } catch (e) {
    return { ok: false, dettaglio: `Telegram non risponde: ${(e as Error).message}` };
  }
}

/** Spezza un testo lungo in più messaggi: niente sempre dentro il limite. */
export async function telegram(testo: string): Promise<Notifica[]> {
  const pezzi: string[] = [];
  if (testo.length <= LIMITE) pezzi.push(testo);
  else {
    let righe = testo.split("\n");
    let attuale = "";
    for (const r of righe) {
      if ((attuale + "\n" + r).length > LIMITE) {
        pezzi.push(attuale);
        attuale = r;
      } else attuale = attuale ? attuale + "\n" + r : r;
    }
    if (attuale) pezzi.push(attuale);
  }
  const esiti: Notifica[] = [];
  for (const p of pezzi) esiti.push(await invia(p));
  return esiti;
}
