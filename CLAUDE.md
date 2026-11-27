# Pieno furbo — istruzioni per Claude

PWA personale per i prezzi dei carburanti in Italia (iPhone, «Aggiungi a Home»), con proxy Cloudflare.
Contesto completo: `docs/CONTESTO.md`. Struttura: `docs/ARCHITETTURA.md`. Come lavoriamo: `docs/SESSIONI.md`.

## Regole fisse
- **Nessuna chiave, token o segreto** nel codice o nel repository. Se un servizio ne vuole una: fermati e chiedi.
- **Costo zero:** GitHub Pages + Actions, Cloudflare Workers Free.
- Interfaccia **in italiano**, testi brevi. Prezzi in € con **3 decimali**.
- **Chiedi conferma prima di ogni push su `main`** e prima di ogni pubblicazione. Sui branch di lavoro puoi fare push.
- Le chiavi di `localStorage` hanno il prefisso `carburanti:`: **non cambiarlo**, gli utenti perderebbero auto, luoghi e spese.
- Rispetta i limiti dei servizi gratuiti (OSRM, Nominatim, Photon): poche richieste, in cache, mai a raffica.

## Comandi
```bash
npm ci              # dipendenze
npm run dev         # http://localhost:8765/?demo=1  (dati finti, niente rete)
npm run check       # tipi + test unitari + build: deve passare prima di ogni commit
npm run e2e         # test nel browser sulla build (iPhone e Android)
```
Il Worker si prova con `npx wrangler dev` dentro `worker/`. Le pipeline dati sono script Python in `scripts/`.

## Dove mettere il codice
- `web/src/core/` — **logica pura** (niente DOM, rete o storage), in TypeScript, **sempre con test** `*.test.ts`.
- `web/src/data/` — client delle API (Worker, OSRM, Photon, EEA) e storage.
- `web/src/features/<scheda>/` — prezzi, viaggio, spese, garage, altro: vista e stato della scheda.
- `web/src/ui/` — componenti condivisi (pillole, pannelli, card, sheet, tabbar).
- `web/src/legacy/app.js` — la parte non ancora migrata. **Non aggiungere funzionalità qui**: spostale fuori.
- `worker/` — proxy Cloudflare (pubblicato da Cloudflare a ogni push su `main`).
- `scripts/` + `data/` — pipeline GitHub Actions e dati generati (non modificare `data/` a mano).

## Convenzioni
- Un branch per lavoro: `feat/…`, `fix/…`, `migra/…`, `docs/…`. Commit in italiano, all'imperativo.
- Prima della fine: `npm run check` e `npm run e2e` verdi; aggiorna `README.md` se cambia ciò che l'utente vede.
- Una decisione importante (nuova fonte dati, nuovo servizio, cambio di architettura) va in `docs/decisioni/`.
