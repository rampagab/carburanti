// Spese di viaggio: dati del gruppo, link di condivisione e messaggi. Logica pura.
import { eur } from "./format";
import { groupTotal, settle, type Expense, type Group, type Person, type Transfer } from "./split";

/** Dati per ricevere i pagamenti di chi ha creato il viaggio (da «Altro»). */
export interface PayInfo {
  /** id della persona che riceve */
  to: string;
  paypal: string;
  iban: string;
  holder: string;
}

export interface TripExpense extends Expense {
  desc: string;
  date: string;
}

export interface TripGroup extends Group {
  id: string;
  name: string;
  people: Person[];
  expenses: TripExpense[];
  pay?: PayInfo | undefined;
  /** id di «io» su questo telefono: non viaggia nel link */
  me?: string | undefined;
}

export const personName = (g: Pick<Group, "people">, id: string): string =>
  (g.people.find((x) => x.id === id) || { name: "?" }).name;

// ---------- Link di condivisione ----------
// Il viaggio viaggia nel link (#spese/import/<dati>): JSON in UTF-8, base64 adatto agli URL.

export function packGroup(g: TripGroup): string {
  const json = JSON.stringify({ v: 1, id: g.id, name: g.name, people: g.people, expenses: g.expenses, pay: g.pay });
  return btoa(unescape(encodeURIComponent(json))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Legge un link ricevuto. Non si fida di nulla: taglia i testi, scarta le spese incoerenti.
 * Lancia un errore se il link è illeggibile. `newId` serve se il viaggio non ha un id.
 */
export function unpackGroup(str: string, newId: () => string): TripGroup {
  const json = decodeURIComponent(escape(atob(str.replace(/-/g, "+").replace(/_/g, "/"))));
  const d: any = JSON.parse(json);
  const clean = (t: unknown, n: number): string => String(t == null ? "" : t).slice(0, n);
  if (!d || !Array.isArray(d.people) || !Array.isArray(d.expenses)) throw new Error("Link non valido");
  const people: Person[] = d.people
    .slice(0, 30)
    .map((p: any) => ({ id: clean(p.id, 20), name: clean(p.name, 30) }))
    .filter((p: Person) => p.id && p.name);
  const ids = new Set(people.map((p) => p.id));
  const expenses: TripExpense[] = d.expenses
    .slice(0, 500)
    .map((e: any) => ({
      id: clean(e.id, 24),
      desc: clean(e.desc, 60),
      amount: Math.round(+e.amount * 100) / 100,
      payer: clean(e.payer, 20),
      split: (Array.isArray(e.split) ? e.split : []).map((x: unknown) => clean(x, 20)).filter((x: string) => ids.has(x)),
      date: clean(e.date, 30),
      kind: e.kind === "pay" ? "pay" : undefined,
    }))
    .filter((e: TripExpense) => e.id && e.amount > 0 && e.amount < 1e6 && ids.has(e.payer) && e.split.length);
  const pay: PayInfo | undefined =
    d.pay && ids.has(clean(d.pay.to, 20))
      ? {
          to: clean(d.pay.to, 20),
          paypal: clean(d.pay.paypal, 60),
          iban: clean(d.pay.iban, 40).replace(/[^A-Za-z0-9 ]/g, ""),
          holder: clean(d.pay.holder, 40),
        }
      : undefined;
  return { id: clean(d.id, 24) || newId(), name: clean(d.name, 40) || "Viaggio", people, expenses, pay };
}

// ---------- Messaggi ----------

/** Messaggio di «Chiedi»: link PayPal già compilato e IBAN, se chi riceve è chi ha impostato i dati. */
export function askMessage(g: TripGroup, x: Transfer): string {
  const amount = (x.cents / 100).toFixed(2);
  const p = g.pay && g.pay.to === x.to ? g.pay : null;
  const lines = [`Ciao ${personName(g, x.from)}! Per «${g.name}» la tua parte è ${eur(x.cents)}.`];
  if (p && p.paypal) lines.push(`PayPal: https://paypal.me/${encodeURIComponent(p.paypal.replace(/^.*paypal\.me\//i, "").replace(/\/.*$/, ""))}/${amount}EUR`);
  if (p && p.iban) lines.push(`Bonifico: ${p.iban}${p.holder ? " (" + p.holder + ")" : ""}, causale «${g.name}»`);
  if (!p) lines.push(`Da dare a ${personName(g, x.to)}.`);
  return lines.join("\n");
}

/** Riepilogo di «Condividi» (il link va aggiunto a parte). */
export function shareSummary(g: TripGroup): string {
  const plan = settle(g);
  return (
    `${g.name} – totale ${eur(groupTotal(g))}\n` +
    (plan.length ? plan.map((x) => `${personName(g, x.from)} → ${personName(g, x.to)}: ${eur(x.cents)}`).join("\n") : "Siamo pari.") +
    `\n\nApri e aggiorna nell'app:`
  );
}
