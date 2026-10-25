// Broker finto: persistito su file, stessa interfaccia di quello vero.
// Serve per provarlo senza soldi e senza rete, e per i test che devono rompere le cose.

import type {
  Broker,
  Conto,
  EsitoOrdine,
  OrdineBroker,
  Orologio,
  Posizione,
  RichiestoOrdine,
} from "./alpaca";
import { ErroreBroker } from "./alpaca";

/** Prezzi di repertorio: sono finti, ma stabili tra una prova e l'altra. */
const PREZZI: Record<string, number> = {
  SPY: 600,
  QQQ: 500,
  IWM: 240,
  AAPL: 230,
  MSFT: 480,
  NVDA: 180,
  GLD: 260,
  TLT: 92,
};

export type GuastoConfig = {
  /** Il prossimo invio viene eseguito MA la risposta si perde (esito sconosciuto filare). */
  timeoutSuProssimoOrdine?: boolean;
  /** Il broker smette di rispondere del tutto (errore di rete su ogni lettura/invio). */
  giu?: boolean;
  /** Prezzi forzati: per provare lo stop loss senza aspettare il mercato. */
  prezziOverride?: Record<string, number>;
};

type Stato = {
  cash: number;
  posizioni: Record<string, { qty: number; prezzoCarico: number }>;
  ordini: OrdineBroker[];
  guasti?: GuastoConfig; // anche i guasti si ricordano: la sveglia dopo li deve ritrovare
  aperto?: boolean; // l'orologio del finto: la sveglia dopo lo deve ritrovare
};

export class BrokerFinto implements Broker {
  readonly nome = "finto (prova, nessuna chiamata)";

  /** Se falso, l'orologio del finto dice mercato chiuso (per provare la gabbia). */
  public aperto: boolean;

  constructor(
    private st: Stato = { cash: 100_000, posizioni: {}, ordini: [] },
    public guasti: GuastoConfig = {},
    public persiste?: string, // percorso file: se c'è, si salva dopo ogni mutazione
  ) {
    this.aperto = st.aperto ?? true;
  }

  static vuoto(cashIniziale = 100_000): BrokerFinto {
    return new BrokerFinto({ cash: cashIniziale, posizioni: {}, ordini: [] });
  }

  static daStato(st: unknown): BrokerFinto {
    const s = st as Stato;
    return new BrokerFinto(
      { cash: s.cash, posizioni: s.posizioni ?? {}, ordini: s.ordini ?? [], aperto: s.aperto },
      s.guasti ?? {},
    );
  }

  toStato(): Stato {
    return { ...this.st, aperto: this.aperto, guasti: this.guasti };
  }

  withGuasti(g: GuastoConfig): BrokerFinto {
    this.guasti = { ...this.guasti, ...g };
    return this;
  }

  private async salva(): Promise<void> {
    if (!this.persiste) return;
    await Bun.write(this.persiste, JSON.stringify(this.toStato(), null, 2));
  }

  private controllaGuasto(): void {
    if (this.guasti.giu) {
      throw new ErroreBroker("Il broker finto non risponde (guasto iniettato).", true);
    }
  }

  private prezzoDi(simbolo: string): number {
    const p = this.guasti.prezziOverride?.[simbolo] ?? PREZZI[simbolo];
    if (!p) throw new ErroreBroker(`Al broker finto manca il prezzo di ${simbolo}.`, false);
    return p;
  }

  async conto(): Promise<Conto> {
    this.controllaGuasto();
    let equity = this.st.cash;
    for (const [s, p] of Object.entries(this.st.posizioni)) {
      equity += p.qty * this.prezzoDi(s);
    }
    return { equity, cash: this.st.cash };
  }

  async posizioni(): Promise<Posizione[]> {
    this.controllaGuasto();
    return Object.entries(this.st.posizioni).map(([s, p]) => {
      const prezzo = this.prezzoDi(s);
      return {
        simbolo: s,
        qty: p.qty,
        prezzoCarico: p.prezzoCarico,
        prezzo,
        pnlPerc: (prezzo - p.prezzoCarico) / p.prezzoCarico,
        valore: p.qty * prezzo,
      };
    });
  }

  async ordini48h(): Promise<OrdineBroker[]> {
    this.controllaGuasto();
    return [...this.st.ordini];
  }

  async orologio(): Promise<Orologio> {
    this.controllaGuasto();
    // Il finto decide l'apertura col suo campo: la gabbia prende quello.
    return {
      open: this.aperto,
      nextOpen: new Date().toISOString(),
      nextClose: new Date().toISOString(),
    };
  }

  async prezzo(simbolo: string): Promise<number> {
    this.controllaGuasto();
    return this.prezzoDi(simbolo);
  }

  async ordine(o: RichiestoOrdine, clientOrderId: string): Promise<EsitoOrdine> {
    this.controllaGuasto();
    if (this.guasti.timeoutSuProssimoOrdine) {
      this.guasti = { ...this.guasti, timeoutSuProssimoOrdine: false };
      // Il pacchetto ARRIVA e viene eseguito, ma la risposta si perde sul filo:
      // esattamente il guasto che il codice deve saper reggere.
      const eseguito = await this.attua(o, clientOrderId);
      if (eseguito.esito === "eseguito") {
        return { esito: "sconosciuto", dettaglio: `risposta persa per ${clientOrderId} (guasto iniettato)` };
      }
      return eseguito;
    }
    return this.attua(o, clientOrderId);
  }

  /** Esecuzione immediata al prezzo di repertorio, come farebbe un conto demo sereno. */
  private async attua(o: RichiestoOrdine, clientOrderId: string): Promise<EsitoOrdine> {
    if (this.st.ordini.some((x) => x.clientOrderId === clientOrderId)) {
      return { esito: "doppione", dettaglio: `il broker rifiuta un id già usato: ${clientOrderId}` };
    }
    const s = this.st;
    const effettivo = this.prezzoDi(o.simbolo);
    if (o.lato === "buy") {
      const tot = o.qty * effettivo;
      if (tot > s.cash) {
        s.ordini.push(NuovoOrdineBroker(o, clientOrderId, "rejected"));
        await this.salva();
        return { esito: "accettato", dettaglio: `rifiutato per fondo cassa: ${clientOrderId}` };
      }
      s.cash -= tot;
      const p = s.posizioni[o.simbolo] ?? { qty: 0, prezzoCarico: 0 };
      p.prezzoCarico = (p.qty * p.prezzoCarico + tot) / (p.qty + o.qty);
      p.qty += o.qty;
      s.posizioni[o.simbolo] = p;
    } else {
      const p = s.posizioni[o.simbolo];
      if (!p || p.qty < o.qty) {
        s.ordini.push(NuovoOrdineBroker(o, clientOrderId, "rejected"));
        await this.salva();
        return {
          esito: "accettato",
          dettaglio: `rifiutato: niente (o abbastanza) posizione da vendere: ${clientOrderId}`,
        };
      }
      s.cash += o.qty * effettivo;
      p.qty -= o.qty;
      if (p.qty === 0) delete s.posizioni[o.simbolo];
    }
    s.ordini.push(NuovoOrdineBroker(o, clientOrderId, "filled", effettivo));
    await this.salva();
    return { esito: "eseguito", dettaglio: `invio ${clientOrderId} · ${o.qty} az. · filled a ${effettivo}` };
  }

  async ordinePerId(clientOrderId: string): Promise<OrdineBroker | null> {
    this.controllaGuasto();
    return this.st.ordini.find((o) => o.clientOrderId === clientOrderId) ?? null;
  }
}

function NuovoOrdineBroker(
  o: RichiestoOrdine,
  clientOrderId: string,
  stato: string,
  prezzoMed?: number,
): OrdineBroker {
  const base: OrdineBroker = {
    clientOrderId,
    simbolo: o.simbolo,
    lato: o.lato,
    qty: o.qty,
    stato,
    creatoIl: new Date().toISOString(),
  };
  if (prezzoMed !== undefined) base.prezzoMed = prezzoMed;
  return base;
}
