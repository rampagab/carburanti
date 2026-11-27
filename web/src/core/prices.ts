// Prezzi: scelta del prezzo di un impianto e filtro anti-errori.

export interface FuelPrice {
  fuelId: number;
  isSelf: boolean;
  price: number | null;
  [k: string]: unknown;
}

export interface StationLike {
  fuels: FuelPrice[];
}

/** Sotto il 60% o sopra il doppio della mediana: quasi sempre un errore del gestore (0,199 invece di 2,199). */
export const PLAUSIBLE_MIN = 0.6;
export const PLAUSIBLE_MAX = 2;
/** Con meno campioni non si giudica. */
export const PLAUSIBLE_MIN_SAMPLES = 5;

export type Range = readonly [number, number];

export function plausibleRange(stations: StationLike[], fuel: number, self: boolean): Range {
  const all: number[] = [];
  for (const st of stations)
    for (const f of st.fuels)
      if (f.fuelId === fuel && f.isSelf === self && f.price != null && f.price > 0) all.push(f.price);
  if (all.length < PLAUSIBLE_MIN_SAMPLES) return [0, Infinity];
  all.sort((a, b) => a - b);
  const m = all[Math.floor(all.length / 2)]!;
  return [m * PLAUSIBLE_MIN, m * PLAUSIBLE_MAX];
}

/** Il prezzo più basso e plausibile dell'impianto per carburante e modalità, o null. */
export function pickFrom<F extends FuelPrice>(
  st: { fuels: F[] },
  fuel: number,
  self: boolean,
  range: Range,
): F | null {
  let best: F | null = null;
  for (const f of st.fuels) {
    if (f.fuelId !== fuel || f.isSelf !== self || f.price == null || f.price <= 0) continue;
    if (f.price < range[0] || f.price > range[1]) continue;
    if (!best || f.price < (best.price as number)) best = f;
  }
  return best;
}
