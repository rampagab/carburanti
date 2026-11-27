# 0001 — Vite + TypeScript, stesso repository

**Data:** 2026-11-27 · **Stato:** accettata

## Contesto
Il prototipo era HTML/CSS/JS senza build, con `app.js` di circa 2500 righe in un'unica funzione.
Funzionava, ma ogni modifica rischiava di romperne un'altra e non c'erano test automatici.

## Decisione
- **Vite + TypeScript** con controllo dei tipi severo; test unitari con Vitest, nel browser con Playwright.
- **Stesso repository**, rinominato `pienofurbo`: storico, Worker e dati restano collegati.
- Migrazione **graduale**: `legacy/app.js` resta e importa la logica da `core/`; ogni sessione sposta una scheda.
- Pubblicazione del sito con GitHub Actions (Pages da «GitHub Actions» invece che dal branch).

## Conseguenze
- Serve una build: la fa GitHub Actions, sempre a costo zero.
- I nomi di JS e CSS cambiano a ogni rilascio: il controllo aggiornamenti guarda solo `index.html`.
- I dati in `localStorage` restano (stesso prefisso, stessa origine).
