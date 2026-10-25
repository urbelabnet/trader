// Le chiavi: prima dall'ambiente (GitHub Actions), poi da ../secrets.ts (locale, ignorato da git).
// Mai nei log, mai nei messaggi, mai stampate a schermo.

export type Chiavi = {
  ALPACA_KEY_ID: string;
  ALPACA_SECRET_KEY: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
  GEMINI_API_KEY: string;
};

const CAMPI: Array<keyof Chiavi> = [
  "ALPACA_KEY_ID",
  "ALPACA_SECRET_KEY",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_CHAT_ID",
  "GEMINI_API_KEY",
];

// Il file delle chiavi sta alla radice, questo modulo sta in src/.
function daFile(): Partial<Record<keyof Chiavi, string>> {
  try {
    // Bun risolve "../secrets" infilandoci secrets.ts. Se manca, va bene così.
    const mod = require("../secrets");
    return mod as Partial<Record<keyof Chiavi, string>>;
  } catch {
    return {};
  }
}

function daAmbiente(): Partial<Record<keyof Chiavi, string>> {
  return {
    ALPACA_KEY_ID: process.env.ALPACA_KEY_ID,
    ALPACA_SECRET_KEY: process.env.ALPACA_SECRET_KEY,
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  };
}

/** Le chiavi effettivamente configurate. Restano vuote finché tu non le scrivi: va bene. */
export function chiavi(): Chiavi {
  const env = daAmbiente();
  const file = daFile();
  const out = {} as Chiavi;
  for (const c of CAMPI) {
    out[c] = (env[c] && String(env[c])) || (file[c] && String(file[c])) || "";
  }
  return out;
}

/** Sostituisce le chiavi con *** in qualunque stringa che potrebbe finire in un log. */
export function maschera(testo: string): string {
  const k = chiavi();
  let t = testo;
  for (const c of CAMPI) if (k[c]) t = t.split(k[c] as string).join("***");
  return t;
}
