# Come organizzare le sessioni di Claude Code

Regola d'oro: **una sessione = un obiettivo = un branch = una pull request.**
Le sessioni non si vedono tra loro: ciò che devono sapere tutte sta nel repository (`CLAUDE.md`, `docs/`).

## I tipi di sessione

| Tipo | Quando | Come si apre (primo messaggio) |
|---|---|---|
| **Regia** (questa) | Pianificare, decidere, rivedere le PR, aggiornare `docs/` | «Sei la regia di Pieno furbo. Leggi docs/. Oggi: …» |
| **Funzionalità** | Una cosa nuova e ben definita | «Branch `feat/hvo`. Obiettivo: … Fatto quando: …» |
| **Migrazione** | Spostare una scheda da `legacy/` a `features/` | «Branch `migra/spese`. Sposta la scheda Spese, comportamento identico.» |
| **Correzione** | Un bug preciso | «Branch `fix/…`. Succede che … Mi aspetto che …» |
| **Esplorazione** | Studiare una fonte dati o un'idea, senza codice in `main` | «Solo analisi, scrivi le conclusioni in docs/decisioni/.» |

## Il ciclo di una sessione
1. **Apri** la sessione sul repository e incolla il messaggio iniziale (modello qui sotto).
2. Claude crea il branch, lavora, esegue `npm run check` e `npm run e2e`.
3. Claude fa push **sul branch** e apre la **pull request**. I controlli girano da soli su GitHub.
4. **Tu** provi l'anteprima (o la regia rivede la PR) e fai il merge. Il merge su `main` pubblica sito e Worker.
5. Chiudi (archivia) la sessione. Il lavoro sta nel repository, non nella chat.

## Modello di messaggio iniziale
```
Branch: feat/<nome>
Obiettivo: <una frase>
Fatto quando:
- <comportamento verificabile 1>
- <comportamento verificabile 2>
Fuori ambito: <cosa NON toccare>
Alla fine: npm run check + npm run e2e, push sul branch, apri la PR.
```

## Sessioni in parallelo
Si possono avere più sessioni insieme **se toccano file diversi**. Finché la migrazione non è finita,
`web/src/legacy/app.js` è un file unico: **una sola sessione alla volta lo modifica**.
Ordine consigliato: prima le migrazioni (una per volta), poi le funzionalità in parallelo.

## Roadmap delle sessioni
1. `migra/spese` — la scheda più indipendente: `features/spese/` + `data/storage.ts`.
2. `migra/garage` — auto e configuratore EEA.
3. `migra/viaggio` — pianificatore, pedaggi, pieno lungo la strada.
4. `migra/prezzi` — lista, pillole, consigliato, scheda dell'impianto.
5. `migra/shell` — menu, tema, aggiornamenti, trascina per aggiornare; `legacy/` sparisce.
6. In parallelo dopo la migrazione:
   - `feat/carburanti-hvo` — gruppi di prodotti (benzinato `type_map.csv`), HVO a parte.
   - `feat/servizi` — servizi 1–11 con nomi e icone.
   - `feat/storico-condizionale` — CSV scaricati solo se cambiati.
   - `feat/quanto-metti-viaggio` — «Quanto metti» anche per il pieno lungo la strada.
7. Da decidere prima (sessione di esplorazione): sincronizzazione delle Spese (D1?), traffico (chiave?).
