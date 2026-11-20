// Configurazione pubblica della web app. Qui NON vanno mai chiavi o segreti.
window.CARBURANTI_CONFIG = {
  // URL del Cloudflare Worker (es. "https://carburanti.tuonome.workers.dev").
  // Lascia vuoto finché il Worker non è pubblicato: l'app proporrà la demo.
  WORKER_URL: "https://carburanti.gabriele-rampazzo-1.workers.dev",

  // Zone rapide mostrate in alto.
  ZONES: [
    { id: "monselice", name: "Monselice", lat: 45.2414, lng: 11.7497 },
    { id: "padova", name: "Padova", lat: 45.4064, lng: 11.8768 },
  ],

  // Valori iniziali (l'utente può cambiarli; le scelte restano in localStorage).
  DEFAULTS: {
    zone: "monselice", // id di una zona oppure "gps"
    fuel: 2,           // 1 benzina, 2 gasolio, 3 metano, 4 GPL
    mode: 1,           // 1 self, 0 servito
    radius: 5,         // km: 3, 5, 10, 15
    sort: "price",     // price | distance | date
    liters: 50,        // litri del pieno per il calcolo del risparmio
  },

  // Dati storici generati da GitHub Actions (stesso sito, cartella data/).
  DATA_URL: "data",
};
