# GUIDA UTENTE · come mettere in piedi Tarantola ( Responsabilità dell'utente ✋)

Quello che fa l'agente l'ha già fatto. Quello che **l'agente non può fare da solo** — aprire conti,
copiare chiavi, creare bot e repository — è tutto qui. Circa un'ora la prima volta: è quasi tutta
attesa di e-mail e di registrazioni.

> Convenzione: **✋** = lo fai tu. Ogni passaggio ha la **Verifica**: come controlli che abbia funzionato,
> spesso con una prova al contrario. **Non saltarla: è l'unico modo per sapere che il tuo trader è quello
> e non una copia che sembra uguale.**

Serve solo: un PC con Windows/Mac/Linux (bun e git sono già installati nella tua macchina), un browser,
un'email gratuita. Niente di più.

---

## ✋ PARTE 1 · Il broker (5 minuti)

**1.** Vai su **https://app.alpaca.markets** e registrati con la tua email. Per il conto paper
non chiedono documenti né depositi.

**2.** Dentro, in alto a sinistra, passa a **Paper Trading**. Il conto parte con 100.000 $ finti.

**3.** A destra, nel riquadro **API Keys**, clicca **Generate**. Ti dà due stringhe:
- `Key ID` (tipo `PKXXXXXX...`)
- `Secret Key` (tipo `SPXXXXXX...`) — **si vede una volta sola**: copiala SUBITO in un file di testo
  sul tuo computer (il blocco note va benissimo). La cancele dopo.

**Verifica:** sulla dashboard Paper vedi «100,000.00» come equity e la scritta *Paper* in alto a sinistra.
**Prova al contrario:** se vedi *Live* da qualche parte, sei nel posto sbagliato: torna indietro
prima di generare le chiavi.

⚠ **Le chiavi del conto paper e quelle del conto vero sono due cose diverse.** Il programma parla solo
con l'indirizzo paper, scritto nel codice: se qualcuno lo tocca, si rifiuta di partire.

---

## ✋ PARTE 2 · Telegram (3 minuti)

**1.** Su Telegram cerca **@BotFather**, scrivi `/newbot`, scegli un nome (es. `Tarantola Capital`)
e uno username che finisca in `bot` (es. `tarantola_fab_bot`).

**2.** BotFather risponde con un **token**, una riga tipo `123456789:AAH…`. Copiala nel file di testo
delle chiavi. Non mostrarlo a nessuno: chi ha il token controlla il bot.

**3.** Apri la chat col tuo bot e scrivigli **ciao**. Serve davvero: un bot non può scriverti
finché tu non gli hai scritto.

**4.** Nel browser apri:
```
https://api.telegram.org/bot<IL TUO TOKEN>/getUpdates
```
Nel testo cerca `"chat":{"id":` seguito da un numero: quello è il tuo **chat id** (es. `123456789`).
Copialo.

**Verifica:** la pagina getUpdates contiene il tuo «ciao» e un numero dopo `"id"`.
**Prova al contrario:** se vedi `"result":[]`, non hai ancora scritto al bot (o hai scritto a quello
sbagliato). Scrivigli e ricarica.

---

## ✋ PARTE 3 · Il cervello: chiave API Gemini (3 minuti)

Il cervello del trader è un modello Gemini gratuito che decide all'ora perché compare e vender.
Non serve nessun abbonamento: il free tier tollera ampiamente 4 sveglie al giorno.

**1.** Vai su **https://aistudio.google.com/apikey** (account Google qualsiasi).
**2.** Clicca **Create API key**, scegli un progetto nuovo, copia la chiave (tipo `AIzaSy…`).
Nel file di testo delle chiavi.

**Verifica:** la chiave ha una forma `AIza…` di 39 caratteri.
**Prova al contrario:** se la pagina chiede un abbonamento o dati di pagamento, sei su un pannello
sbagliato: la chiave gratuita non li chiede.

*(Extra, facoltativo)* Vuoi un modello diverso? Metti l'ambiente `GEMINI_MODEL` (es. `gemini-flash-lite-latest`:
il default usa l'alias lite, meno affollato; se non risponde il codice prova da solo anche le riserve)
o cambia l'adattatore: `src/llm.ts` è un file solo proprio per questo.

---

## PARTE 4 · Riempi le chiavi e fai le prove (10 minuti + attesa)

**1. ✋** Nel terminale, dentro `D:\AILOCALE\Trading`, copia l'esempio:
```bash
copy secrets.example.ts secrets.ts
```
**2. ✋** Apri `secrets.ts` con Blocco Note (o VS Code) e incolla tra le virgolette al posto dei campi vuoti:

| Chiave                      | Da dove                                           |
|-----------------------------|---------------------------------------------------|
| `ALPACA_KEY_ID`             | Parte 1, passaggio 3 (Key ID)                     |
| `ALPACA_SECRET_KEY`         | Parte 1, passaggio 3 (Secret Key)                 |
| `TELEGRAM_BOT_TOKEN`        | Parte 2, passaggio 2                              |
| `TELEGRAM_CHAT_ID`          | Parte 2, passaggio 4                              |
| `GEMINI_API_KEY`            | Parte 3, passaggio 2                              |

Salva. Il file è ignorato da git: non finirà mai nel repository.

**3. ✋** Cancella il file di testo con le chiavi di prima: ora stanno solo qui.

**4.** Prova senza soldi e senza rete (broker e cervello finti), sempre nel terminale nella cartella:
```bash
bun run once --fake --slot 15:40
```
Devi vedere: `[sveglia]` → `[broker]` → `[cervello]` → `[gabbia]` ok tri ordini → `[ordine]` →
`[testimone]` → e la scrittura di `state/`.

**Verifica:** `bun run status` stampa il testimone delle 15:40 e il conto a 100.000 $.
**Prova al contrario:** se qualcosa è rosso o va in errore, non correggere a mano: riporta l'errore
**tale quale** in chat, qui nella sessione con l'agente.

**5.** Sveglia vera (prezzi e conto veri del paper, Telegram vero, cervello vero):
```bash
bun run once --slot 15:40
```
**Verifica:** arrivano sul telefono ▶ e poi ✅, con «Ordini», «Perché», «Prossima mossa», «P&L giorno».
**Prova al contrario:** è un orario di mercato chiuso? La borsa USA va dalle 15:30 alle 22:00 ora di Roma.
A mercato chiuso la gabbia non manda ordini e te lo scrive: va bene lo stesso, hai verificato tutta la
catena. Per un test con ordini veri (finti), riprova tra le 15:40 e le 21:30 di un giorno feriale.

---

## ✋ PARTE 5 · GitHub Actions: le sveglie senza PC acceso (10 minuti)

**1.** Crea un **repository vuoto** su https://github.com/new — consiglio **pubblico**:
Pages gratis e minuti Actions illimitati senza code, e la cruscotto è online sul telefono.
Con il privato funziona tutto uguale, solo senza pagina web.
Consiglio: chiamalo `tarantola`. Niente README (ce l'abbiamo già) e niente gitignore per ora.

**2.** Nel terminale, dentro la cartella del progetto:
```bash
git remote add origin https://github.com/<TUO-UTENTE>/tarantola.git
git push -u origin master
```
(se il ramo si chiama `main`, sostituisci `main` a `master`)

**3.** Aggiungi le cinque **Secrets** del repository: pagina del repo → *Settings* → *Secrets and variables*
→ *Actions* → *New repository secret*, un valore per volta, con **gli stessi nomi**:
`ALPACA_KEY_ID`, `ALPACA_SECRET_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `GEMINI_API_KEY`.

**4.** Accendi la prima sveglia a mano come prova: pagina del repo → *Actions* → *sveglia* →
*Run workflow* → **Run workflow**. Dopo un minuto:
- sul telefono arrivano ▶ e ✅;
- nel repository appare il commit «stato sveglia …» col testimone.

**5.** La cruscotto vive su **GitHub Pages** (il repository è pubblico e Pages è gratis):
apri **https://urbelabnet.github.io/trader/status.html** — dal telefono anche, senza
login. La pagina viene ripubblicata a ogni sveglia che cambia lo stato; un dispatch
manuale (*Run workflow*) la ripubblica comunque. Vuoi guardarla come file? È nel
repository come `state/status.html`.
In locale c'è di meglio: con un **doppio clic su `cruscotto.bat`** la cruscotto del conto
(valore, grafico vs S&P 500, posizioni, prossime sveglie col conteggio) si apre nel browser
alla porta 8789. Senza il .bat funziona uguale: `bun run cruscotto` nel terminale.
Un F5 ricarica la fotografia più recente, e non solo dallo stato: a ogni richiesta il
serverino rilegge conto, posizioni, ordini e quotazioni direttamente dal broker.
La cruscotto resta solo lettura: nessun ordine parte da qui.

**Verifica:** *Actions* è tutto verde sui run, e il file `state/status.html` mostra l'ultimo
testimone col suo «Perché». Il cron è tarato per stare sotto i 2.000 minuti/mese del piano
gratuito: controlli attorno alle 4 sveglie vere (~11 al giorno nei feriali, ~6 nel weekend),
non ogni 10 minuti tutto il giorno.
**Prova al contrario:** un run *rosso* con «Broker non disponibile» vuol dire chiavi sbagliate
o chiavi del conto vero rimaste nell'ambiente: rigenera le chiavi dalla pagina Paper (parte 1).

---

## ✔ Checklist finale

- [ ] `bun test` → 24 pass, 0 fail
- [ ] `bun run once --fake --slot 15:40` → gabbia, ordini, testimone su schermo
- [ ] `bun run once --slot 15:40` → ▶ e ✅ sul telefono (anche a mercato chiuso)
- [ ] Il file di testo delle chiavi non esiste più
- [ ] Su GitHub: run verde del workflow, commit «stato sveglia» nel repo
- [ ] La cruscotto si apre su https://urbelabnet.github.io/trader/status.html
- [ ] `secrets.ts` non è mai apparso in un commit (`git log --stat | findstr secrets`)

E poi: `bun run schedule` resta acceso sul tuo PC se vuoi girare anche in locale
(pagina di stato sulla porta 8787), ma per le sveglie fa già tutto il cron su GitHub,
con il computer spento.

⚠ Il trader decide da solo, ma i soldi sono finti. Non cambiare mai l'indirizzo di Alpaca in `src/config.ts`.
