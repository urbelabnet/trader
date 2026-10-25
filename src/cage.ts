// La gabbia: regole nel codice, non nel prompt del modello.
// Il modello propone, il codice dispone. Ogni regola rifiuta con il motivo e va nel log.

import { MAX_POSIZIONI, PESO_MAX, STOP_LOSS, UNIVERSO } from "./config";
import type { Posizione } from "./alpaca";

export type Proposta = {
  simbolo: string;
  lato: "buy" | "sell";
  qty: number;
  perche: string;
};

export type OrdineRifiutato = Proposta & { motivo: string };

export type EsitoGabbia = {
  /** Ordini di vendita forzati dallo stop loss: non chiedono il permesso al cervello. */
  stopOrdini: Proposta[];
  /** Ordini del cervello passati. */
  passati: Proposta[];
  /** Ordini rifiutati, con il motivo. */
  rifiutati: OrdineRifiutato[];
};

const inUniverso = (s: string): boolean => (UNIVERSO as readonly string[]).includes(s);

/** Lo stop loss: l'unica decisione che non passa dal modello.
 *  Ogni posizione sotto lo stop viene venduta intera, anche se il cervello dice di tenere. */
export function stopSulCarico(posizioni: Posizione[]): Proposta[] {
  return posizioni
    .filter((p) => p.qty > 0 && p.pnlPerc <= STOP_LOSS)
    .map((p) => ({
      simbolo: p.simbolo,
      lato: "sell" as const,
      qty: p.qty,
      perche: `stop loss automatico: ${(p.pnlPerc * 100).toFixed(1)}% dal carico (limite ${(STOP_LOSS * 100).toFixed(0)}%)`,
    }));
}

function calcoloPesi(posizioni: Posizione[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of posizioni) m.set(p.simbolo, p.valore);
  return m;
}

/** Filtra le proposte del cervello contro le regole. */
export function attraversa(
  proposte: Proposta[],
  posizioni: Posizione[],
  equity: number,
  prezzi: Record<string, number>,
): EsitoGabbia {
  const res: EsitoGabbia = { stopOrdini: stopSulCarico(posizioni), passati: [], rifiutati: [] };
  const pesi = calcoloPesi(posizioni);
  let titoli = new Set(posizioni.map((p) => p.simbolo)).size;

  for (const q of proposte) {
    const rifiuta = (motivo: string) => res.rifiutati.push({ ...q, motivo });

    if (!inUniverso(q.simbolo)) {
      rifiuta("fuori universo");
      continue;
    }
    if (!Number.isInteger(q.qty) || q.qty <= 0) {
      rifiuta("quantità non intera o non positiva");
      continue;
    }

    const pos = posizioni.find((p) => p.simbolo === q.simbolo);

    if (q.lato === "sell") {
      if (!pos || pos.qty < q.qty) {
        rifiuta("vendita senza (o con meno) posizione da vendere");
        continue;
      }
      res.passati.push(q);
      continue;
    }

    // Acquisto: niente leva, il fondo cassa lo controlla comunque il broker.
    const prezzo = prezzi[q.simbolo] ?? 0;
    if (prezzo <= 0) {
      rifiuta("prezzo di mercato indisponibile");
      continue;
    }
    const valoreNuovo = (pesi.get(q.simbolo) ?? 0) + prezzo * q.qty;
    if (valoreNuovo > PESO_MAX * equity) {
      rifiuta(
        `oltre il ${(PESO_MAX * 100).toFixed(0)}% del conto per titolo: ${q.qty} azioni a ${prezzo.toFixed(2)} porterebbero ${q.simbolo} al ${((valoreNuovo / equity) * 100).toFixed(1)}% di ${equity.toFixed(0)} $`,
      );
      continue;
    }
    if (!pos && titoli >= MAX_POSIZIONI) {
      rifiuta(`portafoglio pieno: massimo ${MAX_POSIZIONI} titoli`);
      continue;
    }
    res.passati.push(q);
    pesi.set(q.simbolo, valoreNuovo);
    if (!pos) titoli++;
  }
  return res;
}
