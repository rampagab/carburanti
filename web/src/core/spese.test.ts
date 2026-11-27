import { describe, expect, it } from "vitest";
import { askMessage, packGroup, personName, shareSummary, unpackGroup, type TripGroup } from "./spese";

const nb = (s: string) => s.replace(/[\u00a0\u202f]/g, " "); // Intl usa spazi non separabili

const g: TripGroup = {
  id: "g1",
  name: "Weekend à Vérona",
  people: [
    { id: "a", name: "Anna" },
    { id: "l", name: "Luca" },
  ],
  expenses: [{ id: "e1", desc: "Benzina", amount: 60, payer: "a", split: ["a", "l"], date: "2026-11-01T10:00:00Z" }],
  pay: { to: "a", paypal: "https://paypal.me/annarossi", iban: "IT60 X054 2811 1010 0000 0123 456", holder: "Anna Rossi" },
  me: "a",
};
const newId = () => "gNUOVO";

describe("link del viaggio", () => {
  it("andata e ritorno, con accenti e senza caratteri vietati negli URL", () => {
    const s = packGroup(g);
    expect(s).toMatch(/^[A-Za-z0-9_-]+$/);
    const back = unpackGroup(s, newId);
    expect(back.id).toBe("g1");
    expect(back.name).toBe("Weekend à Vérona");
    expect(back.people).toEqual(g.people);
    expect(back.expenses).toHaveLength(1);
    expect(back.expenses[0]).toMatchObject({ id: "e1", desc: "Benzina", amount: 60, payer: "a", split: ["a", "l"] });
    expect(back.pay).toEqual({ to: "a", paypal: "https://paypal.me/annarossi", iban: "IT60 X054 2811 1010 0000 0123 456", holder: "Anna Rossi" });
    // «me» resta sul telefono
    expect(back.me).toBeUndefined();
  });

  const pack = (d: unknown) => btoa(unescape(encodeURIComponent(JSON.stringify(d)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  it("scarta spese incoerenti e taglia i testi", () => {
    const back = unpackGroup(
      pack({
        name: "x".repeat(100),
        people: [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "", name: "vuoto" }],
        expenses: [
          { id: "ok", desc: "ok", amount: 10.005, payer: "a", split: ["a", "b", "zzz"], kind: "pay" },
          { id: "neg", desc: "", amount: -1, payer: "a", split: ["a"] },
          { id: "chi", desc: "", amount: 1, payer: "zzz", split: ["a"] },
          { id: "nessuno", desc: "", amount: 1, payer: "a", split: ["zzz"] },
          { id: "enorme", desc: "", amount: 1e7, payer: "a", split: ["a"] },
        ],
        pay: { to: "zzz", paypal: "p" },
      }),
      newId,
    );
    expect(back.id).toBe("gNUOVO");
    expect(back.name).toHaveLength(40);
    expect(back.people.map((p) => p.id)).toEqual(["a", "b"]);
    expect(back.expenses.map((e) => e.id)).toEqual(["ok"]);
    expect(back.expenses[0]!.split).toEqual(["a", "b"]);
    expect(back.expenses[0]!.amount).toBe(10.01);
    expect(back.expenses[0]!.kind).toBe("pay");
    expect(back.pay).toBeUndefined();
  });

  it("pulisce l'IBAN e rifiuta i link rotti", () => {
    const back = unpackGroup(pack({ people: [{ id: "a", name: "A" }], expenses: [], pay: { to: "a", iban: "IT60<x>" } }), newId);
    expect(back.name).toBe("Viaggio");
    expect(back.pay?.iban).toBe("IT60x");
    expect(() => unpackGroup("!!!", newId)).toThrow();
    expect(() => unpackGroup(pack({ people: [] }), newId)).toThrow();
    expect(() => unpackGroup(pack(null), newId)).toThrow();
  });
});

describe("messaggi", () => {
  it("Chiedi: PayPal compilato e IBAN a chi ha i dati", () => {
    const t = nb(askMessage(g, { from: "l", to: "a", cents: 3000 }));
    expect(t).toBe(
      "Ciao Luca! Per «Weekend à Vérona» la tua parte è 30,00 €.\n" +
        "PayPal: https://paypal.me/annarossi/30.00EUR\n" +
        "Bonifico: IT60 X054 2811 1010 0000 0123 456 (Anna Rossi), causale «Weekend à Vérona»",
    );
  });
  it("Chiedi: senza dati di pagamento dice a chi dare i soldi", () => {
    const t = nb(askMessage(g, { from: "a", to: "l", cents: 150 }));
    expect(t).toBe("Ciao Anna! Per «Weekend à Vérona» la tua parte è 1,50 €.\nDa dare a Luca.");
  });
  it("Condividi: riepilogo", () => {
    expect(nb(shareSummary(g))).toBe("Weekend à Vérona – totale 60,00 €\nLuca → Anna: 30,00 €\n\nApri e aggiorna nell'app:");
    expect(nb(shareSummary({ ...g, expenses: [] }))).toBe("Weekend à Vérona – totale 0,00 €\nSiamo pari.\n\nApri e aggiorna nell'app:");
  });
  it("personName", () => {
    expect(personName(g, "l")).toBe("Luca");
    expect(personName(g, "x")).toBe("?");
  });
});
