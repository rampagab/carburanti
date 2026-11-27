# Pieno furbo: contesto per il nuovo progetto

Documento di passaggio. Riassume cosa abbiamo costruito, cosa abbiamo scoperto sulle fonti dati e cosa resta da fare. Serve per ripartire con un progetto strutturato come un'app vera.

---

## 1. Obiettivo

App personale **mobile-first** (iPhone, «Aggiungi a Home») per i **prezzi dei carburanti in Italia**, più chiara e più utile di carburanti.mise.gov.it.
Si chiama **«Pieno furbo»**. Il codice è nel repository pubblico `rampagab/pienofurbo` (prima `rampagab/carburanti`):
- App: https://rampagab.github.io/pienofurbo/ (dati finti con `?demo=1`)
- Proxy: Worker Cloudflare `carburanti`, pubblicato in automatico da GitHub (Workers Builds, cartella `worker`, comando `npx wrangler deploy`)

## 2. Vincoli (decisi finora)

- **Nessuna chiave, token o segreto** nel codice o nel repository. Se un servizio ne richiede una, si decide prima insieme (per esempio TomTom o HERE per il traffico).
- **Costo zero:** Cloudflare Workers Free (100.000 richieste al giorno), GitHub Actions e GitHub Pages.
- Interfaccia **in italiano**, prezzi in € con **3 decimali**.
- **Conferma prima di ogni push o pubblicazione.**
- Dal 27/11/2026: **Vite + TypeScript** (vedi `docs/decisioni/0001-vite-typescript.md`).

## 3. Funzionalità già fatte (nel prototipo)

**Prezzi**
- Prezzi in tempo reale vicino alla posizione o nei **luoghi salvati**, come nelle app meteo.
- Filtri compatti in una riga di pillole: auto, destinazione, raggio, filtri. L'auto scelta imposta da sola il carburante.
- **«Consigliato per te»**: costo reale = prezzo × litri + carburante per la deviazione (OSRM) + pedaggi + tempo × valore del tempo.
  - Deviazione «torno qui» (andata e ritorno) oppure «poi vado a…» (A→B→C, per esempio lavoro → distributore → casa).
  - Quantità: pieno, ¾, ½, ¼, 20/30/50 €.
  - Confronto con il più economico e con il più vicino.
- **Filtro anti-errori:** scarta i prezzi sotto il 60% o sopra il doppio della mediana del carburante.
- Loghi dei marchi (360, dal MIMIT), preferiti con la stella, scheda dell'impianto con storico, servizi, contatti e orari.

**Garage (auto)**
- Configuratore **marca → modello → motorizzazione**, filtrato per carburante, dai dati **EEA** delle auto immatricolate in Italia.
- **Consumo reale** in km/L inserito a mano. Se manca, il dichiarato aumentato del 15% (WLTP) o del 30% (NEDC).
- Niente ricerca per targa: non esiste un servizio pubblico gratuito.

**Viaggio**
- Partenza (posizione attuale o indirizzo) e arrivo con **autocompletamento** (Photon, ripiego Nominatim).
- Scelta dell'auto dal garage, o una nuova che finisce nel garage.
- Prezzo proposto = media attuale, modificabile.
- **Pedaggi stimati** per ogni autostrada del percorso (tariffe ASPI e dati ART), arrotondati ai 10 centesimi, correggibili a mano.
- Consumo che cresce di circa il 2% per ogni passeggero in più.
- **Dove fare il pieno lungo la strada:** corridoio di ±1,5 km attorno al tracciato, a tratti di 25 km, più le **aree di servizio** delle autostrade percorse. In autostrada contano solo le aree di servizio.

**Spese (stile Splitwise)**
- Gruppi di viaggio con partecipanti, spese, saldi e «chi deve quanto a chi».
- Divisione in centesimi con il resto a rotazione.
- «Chiedi» manda un messaggio con il link PayPal.me già compilato e l'IBAN. «Saldato» registra il pagamento.
- Condivisione tramite link (`#spese/import/<base64url>`). **Nessuna sincronizzazione**: manca un server.

**App**
- Menu in basso: Prezzi, Viaggio, Spese, Garage, Altro.
- Stile iOS o Android secondo il sistema; tema chiaro o scuro automatico.
- PWA offline. Si **aggiorna da sola** dopo un rilascio (controllo dell'ETag, service worker network-first). «Trascina per aggiornare» quando è aperta dalla Home.

## 4. Fonti dati (verificate)

| Cosa | Fonte | Note |
|---|---|---|
| Prezzi in tempo reale | API MIMIT `ospzApi` (carburanti.mise.gov.it) | Senza chiave, senza CORS → serve un proxy |
| ↳ `search/zone` | | 1 punto = raggio; **≥3 punti = cerca dentro il poligono**; 2 punti = niente |
| ↳ `registry/highway`, `search/highway` | | 83 autostrade; aree di servizio per tratta (`{"highwayId":"A13-31"}`) |
| ↳ `registry/servicearea/{id}`, `registry/fuels`, `registry/alllogos` | | Dettaglio, 18 carburanti, loghi |
| Storico | Open data MIMIT (CSV giornalieri, prezzi delle 8) | Licenza IODL 2.0. **Non raggiungibili dagli IP cloud** di questa sandbox; da GitHub Actions sì |
| Percorsi | OSRM (server dimostrativo) | `route` (geometria e passi, con i tratti autostradali), `table` (distanze e tempi) |
| Luoghi | Photon (autocompletamento), Nominatim | Gratuiti, uso moderato |
| Auto | EEA DiscoData `[CO2Emission].[latest].[co2cars]` | CC BY 4.0; il firewall accetta solo GROUP BY (niente ORDER BY o COUNT(*)) |
| Pedaggi | Tariffe unitarie ASPI; dataset ART D17 e D22 (dati.gov.it) | Stima più bassa per BreBeMi, Pedemontana e TEEM |

La vecchia API `OssPrezziSearch` non funziona più (risponde 302).
Fonte da citare in app: *Osservatorio prezzi carburanti del MIMIT, IODL 2.0, app non affiliata.*

## 5. Idee prese da altri progetti (analizzati)

- **dstmrk/prezzi-carburante:** filtro degli outlier sulla mediana. *Fatto.*
- **benzinato (`type_map.csv`):** circa 60 nomi commerciali → gruppi Benzina, Gasolio, **HVO** (gruppo a sé), GPL, GNC, GNL. *Da fare.*
- **casungo (Home Assistant):** servizi con ID 1–11, con nomi e icone. *Da fare.*
- **CSV storici:** scaricarli solo se cambiati (ETag o If-Modified-Since). *Da fare.*
- Database veicoli (vehiclesdb, open-vehicle-db…): utili per il mercato USA; per l'Italia EEA resta la fonte migliore.

## 6. Architettura del prototipo

```
index.html, style.css, app.js (~2500 righe, un'unica IIFE), config.js, demo.js, sw.js, manifest
worker/worker.js        proxy Cloudflare: /search /station/:id /polygon /highways /highway
scripts/snapshot.py     storico giornaliero (Actions, 7:47 UTC) → data/history, average.json
scripts/build_cars.py   EEA → data/cars/ (una piccola JSON per marca; Actions annuale)
scripts/build_tolls.py  → data/tolls.json (Actions ogni 5 gennaio)
scripts/build_logos.py  → data/logos/
```
Dati utente solo in `localStorage` con prefisso `carburanti:`: impostazioni, luoghi, auto, gruppi di spesa, dati di pagamento.
Il Worker limita il CORS a `https://rampagab.github.io` e `http://localhost:8765`, usa la Cache API e non salva in cache le risposte con `success:false`.

## 7. Limiti e questioni aperte

- **Traffico in tempo reale:** serve una chiave (TomTom o HERE). Da decidere.
- **Sincronizzazione delle Spese tra amici:** serve un database (Cloudflare D1 o KV, oppure Supabase). Da decidere.
- **KV per gli indirizzi** nel Worker: previsto, non configurato.
- OSRM e Nominatim sono server pubblici dimostrativi: per molti utenti servono alternative o un'istanza propria.
- `app.js` in un unico file è diventato difficile da mantenere: è il motivo principale per ristrutturare.
- Il «pieno lungo la strada» calcola su un pieno completo. Proposta: usare la scelta «Quanto metti» della scheda Prezzi.

## 8. Proposta per il progetto «serio»

**Struttura a moduli** (anche senza framework si possono usare i moduli ES nativi; in alternativa Vite + TypeScript):

```
apps/web/            PWA
  src/core/          logica pura e testabile: prezzi, filtro anti-errori, consigliato, divisione spese, pedaggi
  src/data/          client API (worker, OSRM, Photon, EEA), cache, storage
  src/features/      prezzi/, viaggio/, spese/, garage/, altro/ (vista + stato di ciascuna)
  src/ui/            componenti condivisi: pillole, pannelli, card, sheet, tabbar, tema
apps/worker/         proxy Cloudflare (+ D1 se aggiungiamo la sincronizzazione)
pipelines/           script Python per storico, auto, pedaggi, loghi
data/                dati generati
docs/                decisioni (ADR), fonti, questo contesto
tests/               unit (core) + e2e Playwright (flussi principali)
```

**Metodo di lavoro con Claude Code**
- Un `CLAUDE.md` alla radice con vincoli, comandi (`dev`, `test`, `deploy`) e convenzioni.
- Una funzionalità per branch e pull request, con i test che girano in CI (GitHub Actions).
- Logica in `core/` con test unitari prima dell'interfaccia: consigliato, filtro anti-errori, divisione spese e pedaggi sono tutti puri e già ben definiti.
- Issue su GitHub per la roadmap qui sotto.

**Roadmap suggerita**
1. Migrazione: spostare il prototipo nella nuova struttura senza cambiare il comportamento (i test e2e attuali servono da rete di sicurezza).
2. Gruppi di carburante con l'HVO a parte; servizi con nomi e icone; CSV condizionali.
3. «Quanto metti» anche per il pieno lungo la strada.
4. Sincronizzazione delle Spese (decidere D1 o altro, accesso con link e senza account).
5. Traffico in tempo reale (solo dopo aver deciso sulla chiave).
6. Eventuale app nativa (Capacitor o simili) se servono notifiche o widget.
