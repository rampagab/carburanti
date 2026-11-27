# Architettura

```
                 ┌──────────────── GitHub (rampagab/pienofurbo) ────────────────┐
  iPhone/Android │  web/  ──Vite build──►  dist/  ──Actions──►  GitHub Pages     │
   (PWA, offline)│  scripts/ ──Actions (cron)──► data/ (storico, auto, pedaggi)   │
        │        │  worker/ ──Cloudflare Workers Builds──► Worker                 │
        │        └────────────────────────────────────────────────────────────────┘
        ├──► Worker Cloudflare ──► API MIMIT ospzApi (prezzi, aree di servizio)
        ├──► OSRM (percorsi, distanze)   ├──► Photon / Nominatim (luoghi)
        └──► data/*.json sullo stesso sito (storico, auto EEA, pedaggi, loghi)
```

## Cartelle

| Cartella | Cosa | Stato |
|---|---|---|
| `web/src/core/` | Logica pura e testata: filtro anti-errori, consigliato, geometria del percorso, divisione spese | ✅ estratta |
| `web/src/data/` | Client API e storage | da migrare |
| `web/src/features/` | prezzi, viaggio, spese, garage, altro | da migrare |
| `web/src/ui/` | Componenti condivisi | da migrare |
| `web/src/legacy/` | `app.js` (~2400 righe) e `demo.js`: tutto ciò che non è ancora migrato | in svuotamento |
| `web/public/` | icone, manifest, service worker | stabile |
| `worker/` | Proxy: `/search`, `/station/:id`, `/polygon`, `/highways`, `/highway` | stabile |
| `scripts/`, `data/` | Pipeline Python e dati generati | stabile |
| `e2e/` | Test Playwright dei flussi principali | rete di sicurezza |
| `docs/` | Contesto, sessioni, decisioni | |

## Pubblicazione
- **Sito:** `.github/workflows/pages.yml` costruisce e pubblica a ogni push su `main` e dopo i workflow dei dati.
- **Worker:** Cloudflare Workers Builds (cartella `worker`, `npx wrangler deploy`) a ogni push su `main`.
- **Controlli:** `.github/workflows/ci.yml` su ogni pull request.

## Dati sul telefono
Solo `localStorage` con prefisso `carburanti:` (impostazioni, luoghi, auto, gruppi di spesa, dati di pagamento).
Il prefisso resta quello storico: l'origine `rampagab.github.io` non cambia col nome del repository, quindi i dati sopravvivono.
