import { describe, expect, it } from "vitest";
import { pickFrom, plausibleRange } from "./prices";

const st = (...prices: Array<number | null>) => ({ fuels: prices.map((price) => ({ fuelId: 2, isSelf: true, price })) });

describe("filtro anti-errori", () => {
  const zone = [st(1.8), st(1.82), st(1.85), st(1.79), st(0.199), st(1.9)];

  it("scarta un prezzo mal digitato (0,199 invece di 1,99)", () => {
    const range = plausibleRange(zone, 2, true);
    expect(pickFrom(zone[4]!, 2, true, range)).toBeNull();
    expect(pickFrom(zone[0]!, 2, true, range)!.price).toBe(1.8);
  });
  it("con meno di 5 prezzi non giudica", () => {
    expect(plausibleRange(zone.slice(0, 4), 2, true)).toEqual([0, Infinity]);
  });
  it("ignora carburante e modalità diversi", () => {
    expect(plausibleRange(zone, 1, true)).toEqual([0, Infinity]);
    expect(plausibleRange(zone, 2, false)).toEqual([0, Infinity]);
  });
});

describe("pickFrom", () => {
  it("sceglie il prezzo più basso tra più prodotti dello stesso carburante", () => {
    expect(pickFrom(st(1.9, 1.85, null, 0), 2, true, [0, Infinity])!.price).toBe(1.85);
  });
});
