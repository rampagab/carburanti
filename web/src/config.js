// Configurazione pubblica della web app. Qui NON vanno mai chiavi o segreti.
window.CARBURANTI_CONFIG = {
  // URL del Cloudflare Worker (es. "https://carburanti.tuonome.workers.dev").
  // Lascia vuoto finché il Worker non è pubblicato: l'app proporrà la demo.
  WORKER_URL: "https://carburanti.gabriele-rampazzo-1.workers.dev",

  // Luoghi proposti al primo avvio (ognuno poi aggiunge, rinomina o elimina i suoi dall'app).
  // Lasciato vuoto: si parte da "Vicino a me" e si aggiungono i luoghi con il tasto +.
  ZONES: [],

  // Valori iniziali (l'utente può cambiarli; le scelte restano in localStorage).
  DEFAULTS: {
    zone: "gps",       // "gps" (vicino a me) all'avvio
    fuel: 2,           // 1 benzina, 2 gasolio, 3 metano, 4 GPL
    mode: 1,           // 1 self, 0 servito
    radius: 5,         // km: 3, 5, 10, 15
    sort: "price",     // price | distance | date
    liters: 50,        // litri del pieno per il calcolo del risparmio
  },

  // Dati storici generati da GitHub Actions (stesso sito, cartella data/).
  DATA_URL: "data",
};
