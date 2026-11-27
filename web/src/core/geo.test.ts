import { describe, expect, it } from "vitest";
import { corridorPolys, haversine, projectOn, resample, type RoutePoint } from "./geo";

const PADOVA = { lat: 45.4064, lng: 11.8768 };
const BOLOGNA = { lat: 44.4949, lng: 11.3426 };

describe("haversine", () => {
  it("Padova–Bologna in linea d'aria è circa 110 km", () => {
    expect(haversine(PADOVA, BOLOGNA)).toBeGreaterThan(105);
    expect(haversine(PADOVA, BOLOGNA)).toBeLessThan(115);
  });
  it("è zero sullo stesso punto", () => expect(haversine(PADOVA, PADOVA)).toBe(0));
});

// Linea dritta verso est lungo il 45° parallelo, un punto ogni ~0,8 km per 60 km.
const line = (): RoutePoint[] => Array.from({ length: 76 }, (_, i) => ({ lat: 45, lng: 11 + i * 0.01 }));

describe("resample e corridoio", () => {
  it("scrive i km progressivi e tiene un punto ogni passo", () => {
    const pts = line();
    const r = resample(pts, 5);
    expect(pts.at(-1)!.km).toBeCloseTo(59, 0);
    expect(r.length).toBeGreaterThan(10);
    expect(r.at(-1)).toBe(pts.at(-1));
  });
  it("divide in tratti da 25 km con poligoni chiusi", () => {
    const r = resample(line(), 1);
    const polys = corridorPolys(r, 1.5, 25);
    expect(polys.length).toBe(3);
    for (const p of polys) expect(p.length).toBeGreaterThanOrEqual(4);
  });
  it("il corridoio è largo circa ±1,5 km", () => {
    const [poly] = corridorPolys(resample(line(), 1), 1.5, 25);
    const lats = poly!.map((p) => p.lat);
    const widthKm = (Math.max(...lats) - Math.min(...lats)) * 111.32;
    expect(widthKm).toBeCloseTo(3, 1);
  });
});

describe("projectOn", () => {
  it("trova distanza dalla strada e km dalla partenza", () => {
    const pts = line();
    resample(pts, 1);
    pts.forEach((p, i) => { p.mw = i > 20; p.ref = p.mw ? "A4" : ""; });
    const s = { lat: 45 + 1 / 111.32, lng: 11.4 }; // 1 km a nord, al km ~31
    const p = projectOn(pts, s);
    expect(p.off).toBeCloseTo(1, 1);
    expect(p.along).toBeCloseTo(31.5, 0);
    expect(p.mw).toBe(true);
    expect(p.ref).toBe("A4");
  });
});
