# Pieno furbo

Web app personale per i prezzi dei carburanti, pensata per iPhone.
Su Safari: **Condividi › Aggiungi alla schermata Home**.

**App:** <https://rampagab.github.io/pienofurbo/>. Con dati finti: `?demo=1`.

## Cosa fa

- Prezzi in tempo reale vicino a te o nei tuoi **luoghi** salvati (tasto **+**).
- **Consigliato per te:** il distributore che ti costa meno davvero. L'app conta il carburante che metti (pieno, ¾, ½, ¼ o un importo in euro), più il carburante per la deviazione su strada calcolata con OSRM, più gli eventuali pedaggi e, se vuoi, il tempo. La deviazione si misura in due modi:
  - **Torno qui:** andata e ritorno da dove sei.
  - **Poi vado a…:** quanto allunghi il tragitto verso un luogo salvato, per esempio Casa.

  Il riepilogo confronta il consigliato con il più economico e con il più vicino.
- Filtri compatti in una riga di pillole. L'auto scelta dal garage imposta da sola il carburante.
- Loghi dei marchi (360, dal sito MIMIT; `scripts/build_logos.py`, aggiornati con il workflow annuale «Database auto»).
- Filtri per carburante, self/servito, raggio, marchio e aggiornamento nelle ultime 24 ore. Preferiti con la stella.
- Riepilogo: il distributore più economico, la media della zona, il risparmio sul pieno e l'andamento rispetto a ieri.
- **Le tue auto** (Impostazioni):
  - **configuratore marca › modello › motorizzazione**, con filtro per carburante, dai dati ufficiali EEA delle auto immatricolate in Italia dal 2012;
  - **consumo reale** in km/L, inserito a mano o calcolato da un pieno all'altro;
  - se manca quello reale, il dato dichiarato aumentato del 15% (WLTP) o del 30% (vecchio ciclo NEDC).

  Con l'auto impostata l'app calcola:
  - il costo del pieno;
  - quanto spendi ogni 100 km;
  - il **risparmio netto** di ogni distributore rispetto al più vicino, già tolto il carburante per arrivarci.
- **Viaggio:** stima il costo di un tragitto, cioè carburante più pedaggi. I pedaggi si calcolano per ogni autostrada del percorso, con le tariffe ufficiali di classe A (pianura e montagna) di Autostrade per l'Italia, pesate sulla quota di montagna di ogni concessionaria (dati ART). Il totale è arrotondato ai 10 centesimi come al casello, e l'importo esatto si può inserire a mano.
- **Viaggio, dove fare il pieno lungo la strada:** l'app divide il tracciato OSRM in tratti e cerca i distributori in un corridoio di ±1,5 km. Per farlo usa l'API MIMIT, che con più punti cerca dentro il poligono che formano, tramite il Worker su `/polygon`. Riconosce anche le aree di servizio delle autostrade percorse (`/highways` e `/highway`). Li ordina per costo del pieno più la deviazione. In autostrada contano solo le aree di servizio.
- **Filtro anti-errori:** i prezzi sotto il 60% o sopra il doppio della mediana del carburante vengono esclusi, sia in app sia nello storico.
- **Spese:** come Splitwise, pensate per i viaggi. Il consumo cresce di circa il 2% per ogni passeggero in più. In Altro salvi i tuoi dati di pagamento (PayPal.me e IBAN). Su ogni riga di pareggio, «Chiedi» manda un messaggio con il link PayPal già compilato e l'IBAN, e «Saldato» registra il pagamento. Crei il viaggio con i partecipanti, aggiungi chi ha pagato cosa e vedi saldi e «chi deve quanto a chi». Si condivide con un link: chi lo apre importa o aggiorna il viaggio. Dal pianificatore, «Dividi la spesa» aggiunge subito carburante e pedaggi.
- Menu in basso (Prezzi, Viaggio, Spese, Auto, Altro). L'aspetto è da iOS su iPhone e Material su Android, e il tema chiaro/scuro segue il sistema.
- Scheda dell'impianto con:
  - tutti i prezzi;
  - lo storico in un grafico;
  - servizi, contatti e orari.
- Funziona anche offline, con gli ultimi dati salvati.

## Come è fatto

| Parte | Dove | Pubblicazione |
|---|---|---|
| Web app (Vite + TypeScript) | `web/` (logica testata in `web/src/core/`) | GitHub Actions → GitHub Pages |
| Proxy verso l'API MIMIT | `worker/` (guida: [`worker/README.md`](worker/README.md)) | Cloudflare Workers Builds |
| Storico, auto, pedaggi, loghi | `scripts/` → `data/` | GitHub Actions (pianificate) |

Struttura e regole: [`docs/ARCHITETTURA.md`](docs/ARCHITETTURA.md), [`CLAUDE.md`](CLAUDE.md), [`docs/SESSIONI.md`](docs/SESSIONI.md).
Nessuna chiave o segreto nel repository.

## Storico (GitHub Actions)

Ogni mattina, verso le 9 italiane, il workflow **Storico prezzi** raccoglie i prezzi delle zone elencate in `ZONES`, all'inizio di `scripts/snapshot.py`. Ora sono Monselice e Padova, con un raggio di 15 km.
Poi salva in `data/` lo storico degli impianti, la media dell'area e i metadati, e fa il commit da solo.
Se l'API MIMIT non risponde da GitHub, usa gli open data ufficiali, cioè i CSV dei prezzi delle 8 del giorno prima.

Per avviarlo subito senza aspettare la mattina:

1. Apri la scheda **Actions** del repository.
2. Scegli **Storico prezzi** › **Run workflow**.

Il riquadro «conviene oggi?» e il confronto con la media compaiono solo vicino alle zone raccolte. Il grafico dell'andamento cresce di un punto al giorno.

## Database auto (GitHub Actions)

`scripts/build_cars.py` scarica dall'Agenzia europea dell'ambiente (EEA) le auto immatricolate in Italia. Per ogni motorizzazione raccoglie marca, modello, carburante, cilindrata, potenza e consumo o CO₂ dichiarati, e genera `data/cars/`: un piccolo file per marca.
Il workflow **Database auto** lo rilancia a inizio luglio, quando di solito esce un nuovo anno, oppure a mano da **Actions**.

La ricerca per **targa** non c'è: in Italia non esiste un servizio gratuito e pubblico che la permetta.

## Tariffe pedaggi (GitHub Actions)

`scripts/build_tolls.py` legge le tariffe unitarie di classe A da autostrade.it, con valori di riserva aggiornati al 2026, e i dataset ART D17 e D22 da dati.gov.it. Poi genera `data/tolls.json`. Il workflow **Tariffe pedaggi** gira ogni 5 gennaio.
**Limite:** alcune concessionarie, come BreBeMi, Pedemontana e TEEM, hanno tariffe più alte di quelle di Autostrade per l'Italia, quindi lì la stima è più bassa del vero.

## Servizi esterni (gratuiti, senza chiave)

- Prezzi: Osservatorio prezzi carburanti del MIMIT. Licenza dei dati IODL 2.0. App personale, non affiliata al MIMIT.
- Ricerca dei luoghi: OpenStreetMap Nominatim.
- Percorsi: OSRM (server dimostrativo pubblico).
- Auto: EEA, *Monitoring of CO2 emissions from passenger cars* (licenza CC BY 4.0).
- Pedaggi: Autostrade per l'Italia (tariffe unitarie), Autorità di Regolazione dei Trasporti (CC BY 4.0).

## Prova in locale

```bash
npm ci
npm run dev
```

Poi apri <http://localhost:8765/?demo=1>. Senza `?demo=1` l'app usa il Worker, che accetta anche `localhost:8765`.
Prima di un commit: `npm run check` (tipi, test, build) e `npm run e2e` (test nel browser).
