// Formattazione e piccole utilità condivise (pure).

const nf2 = new Intl.NumberFormat("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Importo in euro da centesimi: 1234 → "12,34 €". */
export const eur = (cents: number): string => nf2.format(cents / 100) + " €";

/** Numero scritto dall'utente, con la virgola o il punto. NaN se non è un numero. */
export const num = (v: unknown): number => parseFloat(String(v == null ? "" : v).replace(",", "."));

/** Testo sicuro dentro l'HTML (anche negli attributi). */
export const esc = (s: unknown): string =>
  String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Identificativo breve e quasi unico, con un prefisso ("g", "p", "e"…). */
export const uid = (p: string): string => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
