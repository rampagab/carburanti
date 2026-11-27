// Spese di gruppo (stile Splitwise). Tutti gli importi interni sono in centesimi.

export interface Person {
  id: string;
  name: string;
}

export interface Expense {
  id: string;
  /** euro */
  amount: number;
  payer: string;
  /** id delle persone che dividono la spesa */
  split: string[];
  /** "pay" = un pagamento di pareggio («Saldato») */
  kind?: string;
  [k: string]: unknown;
}

export interface Group {
  people: Person[];
  expenses: Expense[];
  [k: string]: unknown;
}

export interface Transfer {
  from: string;
  to: string;
  cents: number;
}

export const toCents = (eur: number): number => Math.round(eur * 100);

/** Quota di ciascuno in centesimi. I centesimi avanzati ruotano (in base all'id della spesa). */
export function shares(e: Pick<Expense, "id" | "amount" | "split">): Record<string, number> {
  const total = toCents(e.amount);
  const n = e.split.length;
  const out: Record<string, number> = {};
  if (!n) return out;
  const base = Math.floor(total / n);
  const rem = total - base * n;
  let h = 0;
  for (const ch of String(e.id)) h = (h * 31 + ch.charCodeAt(0)) % 9973;
  e.split.forEach((id, i) => {
    out[id] = base + ((((i - h) % n) + n) % n < rem ? 1 : 0);
  });
  return out;
}

/** Saldo di ciascuno in centesimi: positivo = deve ricevere. */
export function balances(g: Group): Record<string, number> {
  const b: Record<string, number> = {};
  g.people.forEach((p) => (b[p.id] = 0));
  for (const e of g.expenses) {
    b[e.payer] = (b[e.payer] ?? 0) + toCents(e.amount);
    const sh = shares(e);
    for (const id in sh) b[id] = (b[id] ?? 0) - sh[id]!;
  }
  return b;
}

/** Pochi pagamenti per pareggiare: il più indebitato paga chi deve ricevere di più. */
export function settle(g: Group): Transfer[] {
  const b = balances(g);
  const deb = Object.entries(b).filter(([, v]) => v < 0).map(([id, v]) => ({ id, v: -v })).sort((a, c) => c.v - a.v);
  const cred = Object.entries(b).filter(([, v]) => v > 0).map(([id, v]) => ({ id, v })).sort((a, c) => c.v - a.v);
  const out: Transfer[] = [];
  let i = 0;
  let j = 0;
  while (i < deb.length && j < cred.length) {
    const d = deb[i]!;
    const c = cred[j]!;
    const x = Math.min(d.v, c.v);
    if (x > 0) out.push({ from: d.id, to: c.id, cents: x });
    d.v -= x;
    c.v -= x;
    if (!d.v) i++;
    if (!c.v) j++;
  }
  return out;
}

export const groupTotal = (g: Group): number => g.expenses.reduce((a, e) => a + toCents(e.amount), 0);
