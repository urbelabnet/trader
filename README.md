# Tarantola · il trader in quattro (e più) passi

Agente che fa **paper trading da solo**, a orari fissi, senza nessuno davanti allo schermo.
Costruito dal contratto in `CONTRATTO.md`: soldi finti (Alpaca paper), prezzi veri, disciplina scritta.

**Non è una strategia che guadagna.** È un sistema che misura se rispetta le regole quando nessuno guarda:
ogni limitazione sta nel codice, non nel prompt del modello. Il modello propone, il codice dispone.

## Come funziona

Quattro sveglie al giorno, ora di Roma (borsa USA 15:30–22:00):

| Ora  | Nome      | Cosa fa                                             |
|------|-----------|-----------------------------------------------------|
| 09:00| briefing  | legge il conto e fissa il piano. **Nessun ordine.** |
| 15:40| apertura  | entra o aggiusta                                    |
| 18:30| metà seduta | controlla, stop loss                              |
| 21:40| chiusura  | chiude la giornata e scrive il resoconto            |

Ogni messaggio Telegram porta `run AAAA-MM-GG-HHMM` (lo stesso id del file di log): ▶ a inizio sveglia, ✅ a fine,
⚠ per gli allarmi. Se al telefono arriva il ▶ e non il ✅, la sveglia è morta a metà: lo capisci senza aprire nulla.

## I pilastri (perché non sbaglia mai due volte la stessa cosa)

- **Testimone** `state/baton.json`: la verità sulle intenzioni della sveglia prima. Scritto atomicamente
  (file temporaneo + rename), copiato in `state/history/`. Corrotto vale come assente: si riparte dalla verità del broker.
- **Lucchetto** `state/run.lock`: se resta su disco, la sveglia prima è morta a metà → la successiva
  riconcilia con Alpaca (quali ordini sono partiti davvero), avvisa su Telegram e prosegue.
- **Id degli ordini deterministici**: `AAAA-MM-GG-HHMM-SIMBOLO-lato` (es. `2026-09-24-1540-SPY-buy`).
  Stessa sveglia + stesso titolo + stesso lato = stesso id. Prima di ogni invio si chiede al broker se l'id esiste,
  un esito sconosciuto si ricontrolla per id, mai rimandato alla cieca.
- **La gabbia** (in `src/cage.ts`, regole nel codice): universo fisso SPY QQQ IWM AAPL MSFT NVDA GLD TLT;
  massimo 5 titoli, massimo 20% del conto per titolo, stop loss −3% dal carico che **vende anche se
  il cervello non lo chiede**, niente short, niente leva, azioni intere, niente ordini nel briefing
  o a mercato chiuso (ricontrollato prima di ogni singolo invio).

## I comandi

```bash
bun test                        # 19 test: gabbia + i sei guasti avversari (broker e cervello finti)
bun run once --fake             # la sveglia dovuta, con broker e cervello finti (senza rete)
bun run once --fake --slot 15:40 # una sveglia precisa, in modalità prova
bun run once --slot 15:40 --force  # la sveglia vera (Alpaca paper + Telegram + cervello vero)
bun run schedule                # resta acceso: sveglie a orario, pagina di stato sulla porta 8787
bun run status                  # testimone, lucchetto, conto
bun run reconcile               # cosa è successo alla sveglia interrotta
```

Su GitHub Actions non c'è `bun run schedule`: il cron inizia il lavoro ogni 10 minuti
e `bun run once` decide da solo se c'è una sveglia dovuta e più nuova dell'ultimo testimone.

## Dove gira

- **GitHub Actions** (consigliato, gratis): stato e log si committano nel repository a ogni sveglia;
  la pagina di stato va su GitHub Pages (istantanea `state/status.html`).
- **PC acceso quando può**: le sveglie perse non si recuperano: vengono elencate su Telegram (⚠)
  e si riprende dalla prima buona. Un ordine di tre ore fa non ha più senso.

## Cosa devi fare tu (le chiavi)

1. **Alpaca paper** — app.alpaca.markets → Paper Trading → API Keys → Generate (Key ID + Secret).
2. **Telegram** — @BotFather → /newbot → token; manda un messaggio al bot, poi apri
   `https://api.telegram.org/bot<TOKEN>/getUpdates` e prendi `"chat":{"id":`.
3. **Gemini** — chiave API gratuita del Gemini free tier (per 4 sveglie al giorno costa zero).
4. Copia `secrets.example.ts` in `secrets.ts` e riempi i campi. Prova con `--fake`, poi con `--slot`.
5. Repository su GitHub + Secrets con gli stessi nomi delle chiavi (ALPACA_KEY_ID, ALPACA_SECRET_KEY,
   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, GEMINI_API_KEY) e abilita Pages (deploy from Actions).

## Cambiare qualcosa senza fare danni

| Vuoi…                                    | Dove                                          |
|------------------------------------------|-----------------------------------------------|
| altri orari, tetti, universo             | `src/config.ts` (la gabbia legge da qui)      |
| regole diverse                           | `src/cage.ts`: ogni modifica deve far arrossire un test |
| un cervello diverso                      | `src/llm.ts`: un file solo, l'adattatore      |
| un altro canale                          | `src/notify.ts`                               |
| il tono dei messaggi                     | il prompt dentro `src/llm.ts`                 |

**Non toccare mai** l'endpoint in `src/config.ts` (`BROKER_BASE`): è l'unica riga che ti protegge dai soldi veri.
Se la cambi, il programma si rifiuta di partire — e se la sblocca qualcuno, quel qualcuno non è questo progetto.

## Limiti conosciuti (detti chiari, non nascosti)

- I test girano con **broker e cervello finti**: l'Alpaca vero è stato toccato solo per l'interfaccia
  documentata dell'API REST v2. La prima sveglia con le chiavi vere è la prova vera.
- Prezzi del broker finto: repertorio fisso. Il peso degli ordini su Alpaca vero usa l'ultimo trade
  del feed IEX: su titoli molto líquidi è abbastanza, ma il riempimento reale può differire.
- `bun run schedule` non recupera sveglie perse: le segnala, per progetto del contratto.
- La pagina di stato è un'istantanea: non è un pannello in tempo reale.
- Il cron di Actions a volte è in ritardo di minuti: la sveglia tarda (es. 21:55) gira lo stesso,
  e l'invio ricontrolla il mercato prima di ogni ordine; se comunque è chiuso, rifiuta e lo dice.
- I test li ha scritti anche il modello che ha scritto il codice: l'audit avversario li ha fatti
  rompere uno per uno, ma le prove vere rimangono quelle coi conti veri (ndr: demo).

## Struttura

```
CONTRATTO.md        la specifica intera (il "colloquio" del trader)
secrets.example.ts  i campi vuoti per le chiavi
src/config.ts       sveglie, universo, limiti, endpoint paper (insequestrabile)
src/secrets.ts      le chiavi: ambiente prima, file dopo; maschere per i log
src/alpaca.ts       interfaccia del broker + client REST (3 tentativi, timeout 30 s)
src/fakebroker.ts   il broker finto persistito, con guasti iniettabili
src/cage.ts         la gabbia: il modello non la vede
src/llm.ts          il cervello: adattatore Gemini, schema JSON fisso, cervello finto
src/notify.ts       Telegram: ▶, ✅, ⚠; se non risponde si prosegue
src/baton.ts        testimone, lucchetto, sveglie saltate
src/wake.ts         il giro di una sveglia, nell'ordine del contratto
src/statuspage.ts   la pagina di stato (8787 in locale, GitHub Pages in CI)
src/cli.ts          once / schedule / status / reconcile
test/trader.test.ts i sette test del contratto
test/rompilo.test.ts i sei guasti avversari, con un kill vero incluso
.github/workflows/trader.yml  le sveglie di GitHub Actions, lo stato, la pagina
```
