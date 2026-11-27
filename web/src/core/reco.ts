// «Consigliato per te»: quanto costa davvero fare rifornimento in un distributore.

export interface RecoParams {
  /** consumo, L/100 km (kg/100 km per il metano) */
  cons: number;
  /** litri (o kg) che si mettono */
  liters: number;
  /** € per ora di tempo; 0 = il tempo non conta */
  timeValue: number;
}

/** Deviazione per arrivare al distributore rispetto al tragitto che si farebbe comunque. */
export interface Detour {
  km: number;
  min: number;
  /** pedaggi in più, € */
  toll: number;
  /** misurata su strada (OSRM) e non stimata */
  exact: boolean;
}

export interface Cost {
  total: number;
  fill: number;
  road: number;
  toll: number;
  time: number;
  km: number;
  min: number;
  exact: boolean;
}

/** Strada / linea d'aria: fattore medio per stimare i km su strada senza chiedere a OSRM. */
export const ROAD_FACTOR = 1.3;
/** Velocità media per stimare i minuti senza OSRM. */
export const EST_SPEED_KMH = 40;

/** Stima della deviazione A → S → C rispetto ad A → C, con le distanze in linea d'aria. */
export function estimateDetour(dAS: number, dSC: number, dAC: number): Detour {
  const km = Math.max(0, dAS + dSC - dAC) * ROAD_FACTOR;
  return { km, min: (km / EST_SPEED_KMH) * 60, toll: 0, exact: false };
}

/** totale = prezzo × litri + carburante della deviazione + pedaggi + tempo × valore del tempo */
export function costOf(price: number, d: Detour, P: RecoParams): Cost {
  const fill = price * P.liters;
  const road = ((d.km * P.cons) / 100) * price;
  const time = (d.min / 60) * P.timeValue;
  return { total: fill + road + d.toll + time, fill, road, toll: d.toll, time, km: d.km, min: d.min, exact: d.exact };
}
