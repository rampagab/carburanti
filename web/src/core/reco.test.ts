import { describe, expect, it } from "vitest";
import { costOf, estimateDetour } from "./reco";

describe("consigliato", () => {
  const P = { cons: 6.5, liters: 50, timeValue: 0 };

  it("il pieno senza deviazione costa prezzo × litri", () => {
    expect(costOf(2, { km: 0, min: 0, toll: 0, exact: true }, P).total).toBeCloseTo(100);
  });
  it("conta il carburante per la deviazione", () => {
    const c = costOf(2, { km: 10, min: 12, toll: 0, exact: true }, P);
    expect(c.road).toBeCloseTo(1.3); // 10 km × 6,5 L/100 × 2 €
    expect(c.total).toBeCloseTo(101.3);
  });
  it("un distributore più caro ma vicino può convenire", () => {
    const lontano = costOf(1.98, { km: 30, min: 30, toll: 0, exact: true }, P);
    const vicino = costOf(2.0, { km: 0, min: 0, toll: 0, exact: true }, P);
    expect(vicino.total).toBeLessThan(lontano.total);
  });
  it("aggiunge pedaggi e tempo", () => {
    const c = costOf(2, { km: 0, min: 30, toll: 1.5, exact: true }, { ...P, timeValue: 10 });
    expect(c.time).toBeCloseTo(5);
    expect(c.total).toBeCloseTo(106.5);
  });
  it("la stima della deviazione non è mai negativa", () => {
    expect(estimateDetour(1, 1, 5).km).toBe(0);
    expect(estimateDetour(3, 3, 4).km).toBeCloseTo(2.6);
  });
});
