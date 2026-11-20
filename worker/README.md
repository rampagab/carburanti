# Worker Cloudflare: guida passo passo

Il Worker fa da ponte tra la web app e il sito MIMIT. Il sito MIMIT non permette chiamate dirette dal browser: manca l'header CORS.
Piano **Workers Free**: 100.000 richieste al giorno, nessun metodo di pagamento, nessuna chiave da configurare.

## 1. Crea il Worker

1. Accedi a <https://dash.cloudflare.com>.
2. Nel menu a sinistra apri **Compute (Workers)** › **Workers & Pages**. Nelle versioni precedenti della dashboard la voce si chiama solo **Workers & Pages**.
3. Premi **Create** e poi, nella scheda **Workers**, scegli **Start with Hello World!** (oppure **Create Worker**).
4. Come nome scrivi `carburanti` e premi **Deploy**.
   Al primo Worker Cloudflare ti chiede di scegliere un sottodominio `*.workers.dev`. Va bene qualsiasi nome.
5. L'indirizzo del Worker sarà simile a `https://carburanti.TUO-SOTTODOMINIO.workers.dev`.

## 2. Incolla il codice

1. Nella pagina del Worker premi **Edit code**, in alto a destra.
2. Cancella tutto il contenuto di `worker.js` nell'editor.
3. Copia l'intero file [`worker/worker.js`](worker.js) di questo repository e incollalo.
4. Premi **Deploy**.

## 3. (Consigliato) Memoria per gli indirizzi: KV

Senza KV il Worker funziona lo stesso. Però la ricerca del MIMIT non contiene gli indirizzi, e ogni volta il Worker ne può recuperare al massimo 40.
Con KV li ricorda per 30 giorni, quindi dopo la prima ricerca compaiono tutti e le risposte sono più veloci.

1. Nel menu a sinistra: **Storage & Databases** › **KV** › **Create** (oppure **Create namespace**).
   Come nome scrivi `carburanti-indirizzi`.
2. Torna al Worker `carburanti` › **Settings** › **Bindings** › **Add** › **KV namespace**.
3. In **Variable name** scrivi esattamente `ADDR` e scegli il namespace `carburanti-indirizzi`.
4. Premi **Deploy**, oppure **Save**.

Limiti gratuiti di KV: 100.000 letture e 1.000 scritture al giorno, più che sufficienti per questo uso.

## 4. Verifica

Apri nel browser, sostituendo il tuo indirizzo:

- `https://carburanti.TUO-SOTTODOMINIO.workers.dev/`
  Deve mostrare `{"success":true,"service":"carburanti-proxy","kv":true,...}`. Se `kv` è `false`, il binding `ADDR` manca: vedi il punto 3.
- `https://carburanti.TUO-SOTTODOMINIO.workers.dev/search?lat=45.2414&lng=11.7497&radius=5&fuel=2&mode=1`
  Deve mostrare un elenco di impianti di Monselice con `address` compilato.

Se compare `Il sito MIMIT ha risposto 403` oppure un timeout, il sito MIMIT potrebbe bloccare le richieste che arrivano da Cloudflare. In quel caso dimmelo: ci sono alternative.

## 5. Collega l'app

Incolla l'indirizzo, senza la barra finale, in `config.js`:

```js
WORKER_URL: "https://carburanti.TUO-SOTTODOMINIO.workers.dev",
```

L'indirizzo del Worker non è un segreto: è normale che stia nel repository pubblico.

## Siti autorizzati

All'inizio di `worker.js`, `ALLOWED_ORIGINS` elenca i siti che possono usare il Worker dal browser.
Ci sono già `https://rampagab.github.io` (GitHub Pages) e `http://localhost:8765` (prove in locale).
Così un altro sito non può usare il tuo Worker e consumare la tua quota.
Aprire gli indirizzi direttamente nella barra del browser funziona sempre, come nelle verifiche qui sopra.

## Aggiornamento automatico da GitHub (consigliato)

Una volta collegato, ogni modifica a `worker/` pubblicata su GitHub aggiorna il Worker da sola, senza copia e incolla.
Non servono token né chiavi nel repository: l'autorizzazione la dai tu, una sola volta, dalla dashboard.

1. Apri il Worker `carburanti` › **Impostazioni** › **Build** (o **Compilazione**) › **Connetti** (Connect).
2. Scegli **GitHub**. Se te lo chiede, autorizza l'app Cloudflare **solo** sul repository `rampagab/carburanti`.
3. Compila così:
   - **Repository:** `rampagab/carburanti`; **branch:** `main`.
   - **Directory principale** (Root directory): `worker`.
   - **Comando di build:** lascialo vuoto.
   - **Comando di distribuzione** (Deploy command): `npx wrangler deploy`.
   - Se c'è **Percorsi da monitorare** (Build watch paths), scrivi `worker/*`. Così le modifiche all'app non rifanno il Worker.
4. Premi **Salva e distribuisci** (o **Connect**).

La configurazione è in [`wrangler.toml`](wrangler.toml).
**Attenzione al KV:** se lo usi, quando il Worker si pubblica da GitHub conta il file, non la dashboard. Inserisci l'ID del KV in `wrangler.toml`, come spiegato nel file, altrimenti il collegamento `ADDR` viene rimosso.

## Aggiornare il Worker a mano

Se non usi l'aggiornamento automatico, quando `worker.js` cambia ripeti il punto 2: Edit code, incolla, Deploy.
Il binding KV resta configurato.
