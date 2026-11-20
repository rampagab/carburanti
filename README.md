# Carburanti

Web app personale per i prezzi dei carburanti, pensata per iPhone.
Su Safari: **Condividi › Aggiungi alla schermata Home**.

**App:** <https://rampagab.github.io/carburanti/>. Con dati finti: `?demo=1`.

## Cosa fa

- Prezzi in tempo reale vicino a te o nei tuoi **luoghi** salvati (tasto **+**).
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
- **Viaggio** (icona del percorso in alto): stima il costo di un tragitto, cioè carburante più pedaggi stimati sui km di autostrada a pagamento. Puoi scegliere andata e ritorno e dividere il costo tra più persone. Se conosci l'importo esatto dei pedaggi, puoi inserirlo al posto della stima.
- Scheda dell'impianto con:
  - tutti i prezzi;
  - lo storico in un grafico;
  - servizi, contatti e orari.
- Funziona anche offline, con gli ultimi dati salvati.

## Come è fatto

| Parte | File | Dove gira |
|---|---|---|
| Web app (HTML/CSS/JS, senza build) | `index.html`, `style.css`, `app.js`, `config.js`, `demo.js`, `sw.js` | GitHub Pages |
| Proxy verso l'API MIMIT | `worker/worker.js` (guida: [`worker/README.md`](worker/README.md)) | Cloudflare Workers Free |
| Storico giornaliero | `scripts/snapshot.py`, `.github/workflows/snapshot.yml` → `data/` | GitHub Actions |

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

## Servizi esterni (gratuiti, senza chiave)

- Prezzi: Osservatorio prezzi carburanti del MIMIT. Licenza dei dati IODL 2.0. App personale, non affiliata al MIMIT.
- Ricerca dei luoghi: OpenStreetMap Nominatim.
- Percorsi: OSRM (server dimostrativo pubblico).
- Auto: EEA, *Monitoring of CO2 emissions from passenger cars* (licenza CC BY 4.0).

## Prova in locale

```bash
python3 -m http.server 8765
```

Poi apri <http://localhost:8765/?demo=1>. Senza `?demo=1` l'app usa il Worker, che accetta anche `localhost:8765`.
