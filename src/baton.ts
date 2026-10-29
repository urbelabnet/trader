// Il testimone: la verità sulle intenzioni della sveglia precedente.
// Scritto in modo atomico (file temporaneo + rename), copiato in history.
// Corrotto vale come assente: il broker ha comunque i soldi, si riparte dalla verità del broker.
// Il lucchetto: se resta su disco, la sveglia prima è morta a metà → riconcilia.

import { renameSync, existsSync, mkdirSync, unlinkSync, openSync, readFileSync, closeSync, writeFileSync } from "node:fs";
import { MAX_RITARDO_SVEGLIA } from "./config";
import { sveglieDelGiorno, epochDi, type Ora } from "./roma";

export const DIR_STATE = "state";
export const CAM_BATON = `${DIR_STATE}/baton.json`;
export const CAM_LOCK = `${DIR_STATE}/run.lock`;
export const DIR_HISTORY = `${DIR_STATE}/history`;

export type OrdineTestimone = { simbolo: string; lato: "buy" | "sell"; qty: number; esito: string };
export type RifiutatoTestimone = { simbolo: string; motivo: string };

export type Testimone = {
  runId: string; // "2026-10-05-1540"
  sveglia: string; // briefing | apertura | meta | chiusura
  quando: string; // "2026-10-05 15:40" ora di Roma
  epoch: number;
  ordini: OrdineTestimone[];
  rifiutati: OrdineRifiutatoTestone[];
  conto: number; // equity alla sveglia
  piano: string; // la motivazione in breve
  perLaProssima: string; // cosa controllare alla sveglia dopo
  note: string; // allarmi e particolarità
  equityGiorno?: number; // equity alla prima sveglia della data
  posizioni?: Array<{ simbolo: string; qty: number; prezzoCarico: number; prezzo: number; pnlPerc: number }>;
  quotazioni?: Record<string, number>; // l'universo a quest'istante (per la pagina di stato)
  /** La verità del broker sugli ordini delle ultime 48 ore, con l'esecuzione se noto.
   *  È la fotografia di cui la cruscotto può fidarsi anche se il testimone scritto
   *  alla sveglia ha gap (difetto visto il 27/10: i primi acquisti mai nel baton). */
  ordini48h?: Array<{
    simbolo: string;
    lato: "buy" | "sell";
    qty: number;
    stato: string;
    creatoIl: string;
    prezzoMed?: number;
  }>;
};

export type OrdineRifiutatoTestone = { simbolo: string; motivo: string };

type Lock = { runId: string; sveglia: string; epoch: number; pid: number };

function prepara(): void {
  if (!existsSync(DIR_STATE)) mkdirSync(DIR_STATE, { recursive: true });
  if (!existsSync(DIR_HISTORY)) mkdirSync(DIR_HISTORY, { recursive: true });
}

/** Legge il testimone. Corrotto o assente → null: vale come nessun testimone. */
export async function leggiTestimone(campo: string = CAM_BATON): Promise<Testimone | null> {
  try {
    const testo = await Bun.file(campo).text();
    const t = JSON.parse(testo) as Testimone;
    if (!t || typeof t.runId !== "string" || typeof t.sveglia !== "string") return null;
    return t;
  } catch {
    return null;
  }
}

/** Scrive il testimone in modo atomico: file temporaneo + rename, poi copia in history. */
export async function scriviTestimone(t: Testimone): Promise<void> {
  prepara();
  const tmp = `${CAM_BATON}.tmp`;
  await Bun.write(tmp, JSON.stringify(t, null, 2));
  renameSync(tmp, CAM_BATON);
  await Bun.write(`${DIR_HISTORY}/${t.runId}.json`, JSON.stringify(t, null, 2));
}

export type EsitoLock = { ottenuto: boolean; morto?: Lock; motivo: string };

// O_EXCL: la creazione è atomica, su Windows e su Linux: passa una sola.
function creaLock(c: Lock): boolean {
  let fd: number | null = null;
  try {
    fd = openSync(CAM_LOCK, "wx");
    writeFileSync(fd, JSON.stringify(c, null, 2));
    return true;
  } catch {
    return false;
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        /* nulla da chiudere */
      }
    }
  }
}

/** Prende il lucchetto. Se lo trova di una sveglia morta, lo dice: tocca al chiamante riconciliare prima. */
export function prendiLock(runId: string, sveglia: string): EsitoLock {
  prepara();
  if (creaLock({ runId, sveglia, epoch: Date.now(), pid: process.pid })) {
    return { ottenuto: true, motivo: "lucchetto creato" };
  }
  // Qualcuno c'è già: o è morto, o sta girando adesso.
  try {
    const morto = JSON.parse(readFileSync(CAM_LOCK, "utf8")) as Lock;
    const vecchio = Date.now() - morto.epoch > MAX_RITARDO_SVEGLIA * 60_000;
    return {
      ottenuto: false,
      morto,
      motivo: vecchio
        ? "lucchetto di una sveglia morta"
        : "lucchetto fresco: forse c'è una sveglia girando adesso",
    };
  } catch {
    // Lucchetto illeggibile: prova a sostituirlo una sola volta.
    try {
      unlinkSync(CAM_LOCK);
    } catch {
      /* niente */
    }
    if (creaLock({ runId, sveglia, epoch: Date.now(), pid: process.pid })) {
      return { ottenuto: true, motivo: "lucchetto corrotto sostituito" };
    }
    return { ottenuto: false, motivo: "il lucchetto non si lascia: sveglia già attiva" };
  }
}

export function togliLock(): void {
  try {
    unlinkSync(CAM_LOCK);
  } catch {
    /* già sparito */
  }
}

export async function leggiLock(): Promise<Lock | null> {
  try {
    return JSON.parse(await Bun.file(CAM_LOCK).text()) as Lock;
  } catch {
    return null;
  }
}

export type Saltata = { nome: string; quando: string };

/** Quali sveglie di oggi dovevano suonare e non sono mai finite: macchina spenta o offline.
 *  La sveglia che si sta eseguendo adesso (anche se in ritardo) non è saltata: si sta facendo. */
export function sveglieSaltate(
  ultimo: Testimone | null,
  ora: Ora,
  esclusa?: Ora,
  limiteMinuti = MAX_RITARDO_SVEGLIA,
): Saltata[] {
  const lista = sveglieDelGiorno(ora.data);
  const ultimots = ultimo ? ultimo.epoch : -Infinity;
  const adessots = epochDi(ora);
  const esclusats = esclusa ? epochDi(esclusa) : Infinity;
  return lista
    .filter((s) => s.ts > ultimots && s.ts < adessots - limiteMinuti * 60_000 && s.ts !== esclusats)
    .map((s) => ({ nome: s.nome, quando: `${ora.data} ${s.hhmm}` }));
}
