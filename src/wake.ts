// Il giro di una sveglia, nell'ordine del contratto:
// lock → testimone e sveglie saltate → broker → cervello → gabbia → ordini → testimone → Telegram.

import { BROKER_BASE, garantisciPaper, SVEGLIE, UNIVERSO, type Sveglia } from "./config";
import { Alpaca, Broker, type OrdineBroker } from "./alpaca";
import { BrokerFinto } from "./fakebroker";
import type { Proposta } from "./cage";
import { attraversa } from "./cage";
import { scegliCervello, type ContestoCervello, CervelloMorto } from "./llm";
import { telegram } from "./notify";
import {
  DIR_STATE,
  leggiTestimone,
  prendiLock,
  sveglieSaltate,
  togliLock,
  scriviTestimone,
  type Testimone,
} from "./baton";
import { epochDi, oraRoma, runIdDi, sveglieDelGiorno, testoRoma, type Ora } from "./roma";
import { maschera } from "./secrets";
import { scriviIstantanea } from "./statuspage";
import { existsSync, mkdirSync } from "node:fs";

export type Modalita = {
  fake: boolean; // broker e cervello finti
  slot?: string; // "15:40" per scegliere la sveglia
  forza?: boolean; // rifà una sveglia già fatta
  cervelloMorto?: boolean; // solo per i test: la sveglia gira senza decisioni
};

export type Rapporto = {
  runId: string;
  sveglia: string;
  svoglita: boolean;
  log: string[];
};

const NOMI_WEEKEND_SOLI = ["apertura", "meta", "chiusura"];

/** Weekend = solo briefing. */
function saltaNelWeekend(s: Sveglia, ora: Ora): boolean {
  const giorno = new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", weekday: "short" })
    .format(new Date(epochDi(ora)));
  return /sab|dom/i.test(giorno) && NOMI_WEEKEND_SOLI.includes(s.nome);
}

/** La sveglia dovuta: l'ultima già suonata di oggi, più nuova dell'ultimo testimone. */
export function svegliaDovuta(
  ora: Ora,
  ultimo: Testimone | null,
  forza?: boolean,
): { sveglia?: Sveglia; cheDire: string } {
  const lista = sveglieDelGiorno(ora.data).filter((s) => !saltaNelWeekend(s, ora));
  const dovute = lista.filter((s) => s.ts <= epochDi(ora));
  if (dovute.length === 0) return { cheDire: "nessuna sveglia ancora dovuta oggi" };
  const dovuta = dovute[dovute.length - 1];
  if (!forza && ultimo && ultimo.epoch >= dovuta.ts) {
    return { cheDire: "testimone più nuovo: niente da fare" };
  }
  return { sveglia: { hhmm: dovuta.hhmm, nome: dovuta.nome }, cheDire: `sveglia dovuta: ${dovuta.nome}` };
}

// ---- Il diario (logs/{runId}.log, le chiavi diventano ***) ----

class Diario {
  private righe: string[] = [];
  constructor(private runId: string) {}
  scrivi(tipo: string, testo: string): void {
    const riga = `[${tipo.padEnd(9)}] ${maschera(testo)}`;
    this.righe.push(riga);
    console.log(riga);
  }
  async salvalo(): Promise<void> {
    if (!existsSync("logs")) mkdirSync("logs", { recursive: true });
    await Bun.write(`logs/${this.runId}.log`, this.righe.join("\n") + "\n");
  }
}

// ---- Ordini ----

export function idOrdine(ora: Ora, simbolo: string, lato: string): string {
  return `${ora.data}-${ora.hhmm.replace(":", "")}-${simbolo}-${lato}`;
}

type EsitoInvio = { simbolo: string; lato: "buy" | "sell"; qty: number; esito: string };

export async function invia(  ordini: Proposta[],
  broker: Broker,
  ora: Ora,
  diario: Diario,
  mercatoOra?: () => Promise<boolean>,
): Promise<EsitoInvio[]> {
  const esiti: EsitoInvio[] = [];
  for (const o of ordini) {
    // Il controllo del mercato si ripete prima di OGNI invio: una sveglia lenta
    // non deve mandare ordini alle 22:01 a mercato chiuso.
    if (mercatoOra && !(await mercatoOra())) {
      esiti.push({ simbolo: o.simbolo, lato: o.lato, qty: o.qty, esito: "mercato chiuso" });
      diario.scrivi("gabbia", `rifiuto ${o.simbolo} ${o.lato} ${o.qty}: mercato chiuso durante la sveglia`);
      continue;
    }
    const id = idOrdine(ora, o.simbolo, o.lato);
    // Prima dell'invio: se il broker ha già un ordine con quell'id, non rimandarlo.
    // Ma se il riscontro pure esplode, non si manda alla cieca: esito sconosciuto,
    // lo decide la sveglia dopo col suo riscontro.
    let gia: Awaited<ReturnType<Broker["ordinePerId"]>> = null;
    try {
      gia = await broker.ordinePerId(id);
    } catch (e) {
      esiti.push({ simbolo: o.simbolo, lato: o.lato, qty: o.qty, esito: "esito sconosciuto" });
      diario.scrivi("ordine", `riscontro per ${id} non riuscito: ${(e as Error).message}`);
      continue;
    }
    if (gia) {
      esiti.push({ simbolo: o.simbolo, lato: o.lato, qty: o.qty, esito: "già presente" });
      diario.scrivi("ordine", `${id} gia presente: non rimandato`);
      continue;
    }
    let oe;
    try {
      oe = await broker.ordine({ simbolo: o.simbolo, lato: o.lato, qty: o.qty }, id);
    } catch (e) {
      // Anche se chiamare il broker esplode, non è un motivo per sbatterci dentro:
      // esito sconosciuto, si decide col riscontro per id.
      oe = { esito: "sconosciuto" as const, dettaglio: `errore durante l'invio: ${(e as Error).message}` };
    }
    if (oe.esito !== "sconosciuto") {
      esiti.push({ simbolo: o.simbolo, lato: o.lato, qty: o.qty, esito: oe.esito });
      diario.scrivi("ordine", oe.dettaglio);
      // Agancio di prova: con TARANTOLA_KILL_FILE, il test può uccidere la sveglia
      // subito dopo il primo ordine. A riposo (e in produzione) il file non c'è.
      const segnale = process.env.TARANTOLA_KILL_FILE;
      if (segnale && esiti.length === 1) await Bun.write(segnale, "primo ordine in cielo");
      continue;
    }
    // La risposta si può perdere: l'ordine si ricontrolla sul broker per id, mai rimandato alla cieca.
    let ritrovato: boolean;
    try {
      ritrovato = (await broker.ordinePerId(id)) !== null;
    } catch (e) {
      ritrovato = false;
      diario.scrivi("ordine", `il riscontro per id non ha risposto: ${(e as Error).message}`);
    }
    esiti.push({
      simbolo: o.simbolo,
      lato: o.lato,
      qty: o.qty,
      esito: ritrovato ? "eseguito" : "esito sconosciuto",
    });
    diario.scrivi("ordine", ritrovato ? "ritrovato sul broker" : `esito sconosciuto: ${oe.dettaglio}`);
  }
  return esiti;
}

// ---- Il broker di turno ----

async function caricaBroker(mod: Modalita, diario: Diario): Promise<Broker> {
  if (!mod.fake) return new Alpaca();
  const file = `${DIR_STATE}/fakebroker.json`;
  let finto: BrokerFinto;
  try {
    if (existsSync(file)) {
      finto = BrokerFinto.daStato(JSON.parse(await Bun.file(file).text()));
      diario.scrivi("broker", `riparto dal finto che c'era: ${file}`);
    } else {
      finto = BrokerFinto.vuoto();
      diario.scrivi("broker", "broker finto nuovo, 100.000 $");
    }
  } catch {
    finto = BrokerFinto.vuoto();
    diario.scrivi("broker", "stato del finto illeggibile: ricomincio pulito");
  }
  finto.persiste = file;
  return finto;
}

/** Riconciliazione: la sveglia morta quali ordini ha fatto partire davvero? */
export async function riconcilia(broker: Broker, runIdMorto: string): Promise<string> {
  const tutti = await broker.ordini48h();
  const suoi = tutti.filter((o) => o.clientOrderId.startsWith(runIdMorto));
  if (suoi.length === 0) {
    return "Nessuno dei suoi ordini è arrivato sul broker: la sveglia è morta pulita.";
  }
  const dettaglio = suoi
    .map((o) => `· ${o.clientOrderId} (${o.lato} ${o.qty} ${o.simbolo}): ${o.stato}`)
    .join("\n");
  return `Ordini partiti davvero:\n${dettaglio}`;
}

/** La prossima sveglia, anche di domani: "2026-10-05 18:30". */
export function prossimaSveglia(ora: Ora, fatta: string): string {
  const lista = sveglieDelGiorno(ora.data);
  const tsFatta = lista.find((s) => s.nome === fatta)?.ts ?? epochDi(ora);
  const dopo = lista.filter((s) => s.ts > tsFatta);
  if (dopo.length > 0) return `${ora.data} ${dopo[0].hhmm}`;
  for (let g = 1; g <= 7; g++) {
    const o = oraRoma(new Date(epochDi(ora) + g * 86_400_000));
    const domani = sveglieDelGiorno(o.data).filter((s) => !saltaNelWeekend(s, o));
    if (domani.length > 0) return `${o.data} ${domani[0].hhmm}`;
  }
  return "sconosciuta";
}

// ---- La sveglia ----

export async function alzaSveglia(mod: Modalita, oraForzata?: Ora | null): Promise<Rapporto> {
  garantisciPaper(BROKER_BASE);
  const ora = oraForzata ?? oraRoma();
  const ultimo = await leggiTestimone();

  // Quale sveglia: la dovuta, o quella chiesta con --slot.
  let dovuta: Sveglia | undefined;
  if (mod.slot) {
    dovuta = SVEGLIE.find((s) => s.hhmm === mod.slot);
    if (!dovuta) {
      return { runId: "-", sveglia: "-", svoglita: false, log: [`nessuna sveglia si chiama ${mod.slot}`] };
    }
    if (!mod.forza && ultimo && ultimo.epoch >= epochDi({ data: ora.data, hhmm: dovuta.hhmm })) {
      const msg = `${dovuta.nome} è già fatta: niente da fare (usa --force per rifarla)`;
      console.log(`[sveglia  ] ${msg}`);
      return { runId: "-", sveglia: "-", svoglita: false, log: [msg] };
    }
  } else {
    const d = svegliaDovuta(ora, ultimo, mod.forza);
    if (!d.sveglia) {
      console.log(`[sveglia  ] ${d.cheDire}`);
      return { runId: "-", sveglia: "-", svoglita: false, log: [d.cheDire] };
    }
    dovuta = d.sveglia;
  }

  const oraSveglia: Ora = { data: ora.data, hhmm: dovuta!.hhmm };
  const runId = runIdDi(oraSveglia);
  const quando = testoRoma(oraSveglia);
  const allarmi: string[] = [];
  const diario = new Diario(runId);
  diario.scrivi("sveglia", `${quando} · ${dovuta!.nome}${mod.fake ? " · prova: senza soldi e senza rete" : ""}`);

  // 1. Il lucchetto. Se è di una sveglia morta: riconcilia con Alpaca, avvisami, poi lo riprendi.
  const lock = prendiLock(runId, dovuta!.nome);
  if (!lock.ottenuto && lock.morto) {
    const b = await caricaBroker(mod, diario);
    const racconto = await riconcilia(b, lock.morto.runId);
    allarmi.push(`Sveglia precedente interrotta: ${lock.morto.sveglia} (${lock.morto.runId}).\n${racconto}`);
    await togliLock();
    if (!prendiLock(runId, dovuta!.nome).ottenuto) {
      await telegram(`⚠ Sveglia ${runId}: lucchetto irraggiungibile dopo la riconciliazione.`);
      await diario.salvalo();
      return { runId, sveglia: dovuta!.nome, svoglita: false, log: ["lucchetto irraggiungibile"] };
    }
  } else if (!lock.ottenuto) {
    // Lucchetto fresco: un'altra sveglia sta girando adesso. Lascio stare.
    await diario.salvalo();
    console.log(`[sveglia  ] ${lock.motivo}`);
    return { runId, sveglia: dovuta!.nome, svoglita: false, log: [lock.motivo] };
  }

  // 2. Il testimone: quali sveglie ho mancato?
  const saltate = sveglieSaltate(ultimo, ora, oraSveglia);
  if (saltate.length > 0) {
    const elenco = saltate.map((s) => `· ${s.nome} di ${s.quando}`).join("\n");
    allarmi.push(
      `Sveglie saltate (macchina spenta o offline):\n${elenco}\nNon le recupero: un ordine di ore fa non ha piu senso.`,
    );
    diario.scrivi("allarme", `sveglie saltate: ${saltate.map((s) => s.nome).join(", ")}`);
  }

  // 3. La verità sui soldi: il broker.
  const broker = await caricaBroker(mod, diario);
  let conto: Awaited<ReturnType<Broker["conto"]>>;
  let posizioni: Awaited<ReturnType<Broker["posizioni"]>>;
  let ordini: OrdineBroker[];
  let mercato: Awaited<ReturnType<Broker["orologio"]>>;
  try {
    [conto, posizioni, ordini, mercato] = await Promise.all([
      broker.conto(),
      broker.posizioni(),
      broker.ordini48h(),
      broker.orologio(),
    ]);
    diario.scrivi(
      "broker",
      `${broker.nome} · equity ${conto.equity.toFixed(2)} $ · ${posizioni.length} posizioni · ${ordini.length} ordini 48h · mercato ${mercato.open ? "aperto" : "chiuso"}`,
    );
  } catch (e) {
    // Il broker che non risponde: tre tentativi dentro alpaca.ts, poi sveglia fallita pulita.
    const msg = `Broker non disponibile: ${(e as Error).message}`;
    diario.scrivi("allarme", msg);
    await togliLock();
    await telegram(`⚠ Sveglia ${runId} fallita: ${msg}\nLucchetto rilasciato.`);
    await diario.salvalo();
    return { runId, sveglia: dovuta!.nome, svoglita: false, log: [msg] };
  }

  // ▶ Primo messaggio: se il ✅ non arriva dopo, la sveglia è morta a metà, e lo capisci dal telefono.
  await telegram(`▶ Sveglia ${quando} · ${dovuta!.nome}\n· run ${runId}`);

  // 3b. Le quotazioni dell'universo, PRIMA del cervello: senza prezzi l'ebbe non può sapere
  //     quanto costa un titolo (e la gabbia rifiuterebbe ogni acquisto).
  const quotazioni: Record<string, number> = {};
  for (const s of UNIVERSO) {
    try {
      quotazioni[s] = await broker.prezzo(s);
    } catch (e) {
      // Non silenzioso: la causa finisce nel diario, dove si può leggere quando va male.
      diario.scrivi("prezzi", `${s}: prezzo non disponibile (${(e as Error).message})`);
    }
  }
  const haPrezzi = Object.keys(quotazioni).length;
  diario.scrivi("prezzi", `${haPrezzi}/${UNIVERSO.length} quotazioni universe pronte`);

  // 4. Il cervello.
  const cervello = mod.cervelloMorto ? new CervelloMorto() : scegliCervello(mod.fake);
  const stessoGiorno = ultimo && ultimo.quando.startsWith(ora.data);
  const equityGiorno = stessoGiorno ? (ultimo!.equityGiorno ?? ultimo!.conto) : conto.equity;
  const contesto: ContestoCervello = {
    runId,
    sveglia: dovuta!.nome,
    quando,
    mercatoAperto: mercato.open,
    conto,
    posizioni: posizioni.map((p) => ({
      simbolo: p.simbolo,
      qty: p.qty,
      prezzoCarico: p.prezzoCarico,
      prezzo: p.prezzo,
      pnlPerc: p.pnlPerc,
    })),
    ordiniRecenti: ordini.slice(0, 20).map((o) => ({
      simbolo: o.simbolo,
      lato: o.lato,
      qty: o.qty,
      quando: o.creatoIl.slice(0, 16).replace("T", " "),
    })),
    quotazioni,
    ultimoPiano: ultimo?.piano ?? null,
    prossimaMossa: ultimo?.perLaProssima ?? null,
    note: allarmi.join(" || "),
  };
  const risultato = await cervello.decide(contesto);
  const senzaCervello = !risultato.fatto;
  const decisione = risultato.fatto ? risultato.decisione : null;
  if (senzaCervello) {
    // Nessun ordine nuovo, ma lo stop loss gira lo stesso.
    allarmi.push(`Cervello non disponibile: applico solo lo stop loss. (${(risultato as { causa: string }).causa})`);
  } else {
    diario.scrivi("cervello", `${cervello.nome} · ${decisione!.orders.length} ordini proposti`);
    diario.scrivi("cervello", decisione!.reasoning);
  }

  // 5. La gabbia, con le due cose che non si discutono:
  //    niente ordini nel briefing, niente ordini a mercato chiuso.
  let proposte: Proposta[] = decisione ? [...decisione.orders] : [];
  if (dovuta!.nome === "briefing" || !mercato.open) {
    proposte = [];
    diario.scrivi("gabbia", dovuta!.nome === "briefing" ? "briefing: nessun ordine possibile" : "mercato chiuso");
  }
  const inGabbia = attraversa(proposte, posizioni, conto.equity, quotazioni);
  for (const r of inGabbia.rifiutati) {
    diario.scrivi("gabbia", `rifiuto ${r.simbolo} ${r.lato} ${r.qty}: ${r.motivo}`);
  }

  // 6. Gli ordini: prima lo stop (non chiede il permesso a nessuno), poi gli ammessi dal cervello.
  // Il mercato si ricontrolla prima di ogni invio: niente ordini a seduta chiusa.
  const inVolo = [...inGabbia.stopOrdini, ...inGabbia.passati];
  const esiti = await invia(inVolo, broker, oraSveglia, diario, () =>
    broker.orologio().then((o) => o.open),
  );

  // 7. Il testimone nuovo: atomico (file temporaneo + rename), copia in history.
  const piano = senzaCervello
    ? "cervello non disponibile: gestito solo lo stop loss"
    : (decisione?.reasoning ?? "");
  const perLaProssima = senzaCervello
    ? "cervello assente alla sveglia scorsa: controllare che il mercato sia regolare"
    : (decisione?.planNext ?? "");
  const testimone: Testimone = {
    runId,
    sveglia: dovuta!.nome,
    quando,
    epoch: epochDi(oraSveglia),
    ordini: esiti.map((e) => ({ simbolo: e.simbolo, lato: e.lato, qty: e.qty, esito: e.esito })),
    rifiutati: inGabbia.rifiutati.map((r) => ({ simbolo: r.simbolo, motivo: r.motivo })),
    conto: conto.equity,
    piano,
    perLaProssima,
    note: allarmi.join(" | "),
    equityGiorno,
  };
  await scriviTestimone(testimone);
  // L'istantanea della pagina di stato: su GitHub Pages si aggiorna a ogni sveglia.
  await scriviIstantanea();

  // 8. Il resoconto su Telegram, poi il lucchetto via.
  const prossima = prossimaSveglia(oraSveglia, dovuta!.nome);
  const pnlGiorno = conto.equity - equityGiorno;
  const nStop = inGabbia.stopOrdini.length;
  const num = (x: number): string => x.toFixed(2).replace(".", ",");
  const righeOrdini = esiti.map((e, i) =>
    i < nStop
      ? `venduto ${e.qty} ${e.simbolo} (stop loss: ${inGabbia.stopOrdini[i].perche})`
      : `${e.lato === "buy" ? "comprato" : "venduto"} ${e.qty} ${e.simbolo}` + (e.esito !== "eseguito" ? ` (${e.esito})` : ""),
  );
  const fragOrdini = righeOrdini.length ? righeOrdini.join("; ") : "nessuno";
  const fragRifiuti = inGabbia.rifiutati.length
    ? inGabbia.rifiutati.map((r) => `${r.simbolo} (${r.motivo})`).join("; ")
    : "";
  const messaggioFine = [
    `✅ Fatto · ${dovuta!.nome} · run ${runId}`,
    `Ordini: ${fragOrdini}`,
    fragRifiuti ? `Rifiutati dalla gabbia: ${fragRifiuti}` : "",
    `Perché: ${piano}`,
    `Prossima mossa: ${perLaProssima}`,
    `P&L giorno: ${num(pnlGiorno)} $ · conto ${num(conto.equity)} $`,
    `Prossima sveglia: ${prossima}`,
  ]
    .filter((x) => x !== "")
    .join("\n");
  diario.scrivi("testimone", `scritto · prossima sveglia ${prossima}`);
  const esitiTelegram = await telegram(messaggioFine);
  for (const n of esitiTelegram.filter((x) => !x.ok)) diario.scrivi("telegram", n.dettaglio);
  if (allarmi.length > 0) await telegram(`⚠ ${allarmi.join("\n\n")}`);
  await togliLock();
  await diario.salvalo();

  return { runId, sveglia: dovuta!.nome, svoglita: true, log: [] };
}
