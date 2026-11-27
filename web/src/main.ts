// Punto di ingresso. L'ordine conta: configurazione, dati demo, poi l'app.
// L'app è ancora in gran parte in legacy/app.js: le sessioni di migrazione la spostano,
// una scheda alla volta, in features/ (vedi docs/SESSIONI.md).
import "./styles/style.css";
import "./config.js";
import "./legacy/demo.js";
import "./legacy/app.js";
