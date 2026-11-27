import { describe, expect, it } from "vitest";
import { balances, groupTotal, settle, shares, type Group } from "./split";

const people = ["io", "marco", "giulia", "luca"].map((id) => ({ id, name: id }));

describe("shares", () => {
  it("divide senza perdere centesimi", () => {
    const sh = shares({ id: "e1", amount: 10, split: ["io", "marco", "giulia"] });
    expect(Object.values(sh).reduce((a, b) => a + b, 0)).toBe(1000);
    expect(Object.values(sh).sort()).toEqual([333, 333, 334]);
  });
  it("il centesimo avanzato non tocca sempre al primo", () => {
    const who = ["a", "b", "c", "d", "e"].map((id) => {
      const sh = shares({ id, amount: 10, split: ["io", "marco", "giulia"] });
      return Object.entries(sh).find(([, v]) => v === 334)![0];
    });
    expect(new Set(who).size).toBeGreaterThan(1);
  });
});

describe("Padova–Milano, 30 € di carburante in 4", () => {
  const g: Group = {
    people,
    expenses: [{ id: "x", amount: 30, payer: "io", split: people.map((p) => p.id) }],
  };
  it("saldi", () => {
    const b = balances(g);
    expect(b.io).toBe(2250);
    expect(b.marco).toBe(-750);
  });
  it("tre pagamenti da 7,50 € verso chi ha pagato", () => {
    const t = settle(g);
    expect(t).toHaveLength(3);
    expect(t.every((x) => x.to === "io" && x.cents === 750)).toBe(true);
  });
  it("dopo «Saldato» il gruppo è in pari", () => {
    const paid: Group = {
      ...g,
      expenses: [...g.expenses, ...settle(g).map((t, i) => ({ id: "p" + i, kind: "pay", amount: t.cents / 100, payer: t.from, split: [t.to] }))],
    };
    expect(settle(paid)).toEqual([]);
    expect(groupTotal(paid)).toBe(3000 + 2250);
  });
});
