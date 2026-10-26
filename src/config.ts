// Configurazione: sveglie, universo, limiti della gabbia.
// Questo è il file da toccare per cambiare orari e limiti; la gabbia li legge da qui.

/** Endpoint del broker. L'UNICA riga che ti protegge dai soldi veri: non cambiarla. */
export const BROKER_BASE = "https://paper-api.alpaca.markets";
/** Dati di mercato Alpaca (prezzi reali via feed IEX). */
export const DATA_BASE = "https://data.alpaca.markets";

/** La guardia: l'endpoint deve rimanere quello del paper. Se qualcuno lo cambia, non parte. */
export function garantisciPaper(base: string = BROKER_BASE): void {
  if (base !== "https://paper-api.alpaca.markets") {
    throw new Error(
      `Rifiuto di partire: l'endpoint del broker non è quello del paper trading (${base}). Quella riga è l'unica che ti protegge.`,
    );
  }
}

/** Ora di Roma: la borsa USA apre alle 15:30 e chiude alle 22:00 ora italiana. */
export const FUSO = "Europe/Rome";

export type Sveglia = { hhmm: string; nome: string };

/** Le quattro sveglie, ora di Roma. */
export const SVEGLIE: Sveglia[] = [
  { hhmm: "09:00", nome: "briefing" }, // legge il conto e fissa il piano: nessun ordine
  { hhmm: "15:40", nome: "apertura" }, // entra o aggiusta
  { hhmm: "18:30", nome: "meta" }, // controlla, stop loss
  { hhmm: "21:40", nome: "chiusura" }, // chiude la giornata e scrive il resoconto
];

/** Universo fisso: il resto si rifiuta. */
export const UNIVERSO = ["SPY", "QQQ", "IWM", "AAPL", "MSFT", "NVDA", "GLD", "TLT"] as const;

/** Massimo 5 titoli in portafoglio. */
export const MAX_POSIZIONI = 5;
/** Massimo 20% del conto per titolo. */
export const PESO_MAX = 0.2;
/** Stop loss a −3% dal prezzo di carico: vende anche se il modello non lo chiede. */
export const STOP_LOSS = -0.03;
/** Massimo 60 minuti di ritardo per una sveglia ancora recuperabile a risveglio del processo. */
export const MAX_RITARDO_SVEGLIA = 60; // minuti

/** Il modello del cervello: si cambia da ambiente (GEMINI_MODEL), si tocca un file solo.
 *  Di default l'alias «flash-lite-latest»: meno attracco dai picchi di domanda dei modelli grandi
 *  (il 26/10/2026 gemini-flash-latest/3.8 son stati impraticabili per 503 tutta la giornata).
 *  Se un modello un domani viene ritirato, la denuncia arriva dritta nel baton e si cambia qui. */
export const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-flash-lite-latest";

/** Porta della pagina di stato quando gira in locale con `bun run schedule`. */
export const PORTA_STATO = 8787;
