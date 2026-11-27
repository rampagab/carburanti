// Geometria su piccola scala (Italia): distanze, ricampionamento di un tracciato, corridoi.

export interface LatLng {
  lat: number;
  lng: number;
}

/** Punto di un tracciato OSRM: km dalla partenza, se il tratto è autostrada e la sua sigla. */
export interface RoutePoint extends LatLng {
  km?: number;
  mw?: boolean;
  ref?: string;
}

const R_EARTH_KM = 6371;
const KM_PER_DEG_LAT = 111.32;

/** Distanza in linea d'aria in km. */
export function haversine(a: LatLng, b: LatLng): number {
  const r = Math.PI / 180;
  const x =
    Math.sin(((b.lat - a.lat) * r) / 2) ** 2 +
    Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lng - a.lng) * r) / 2) ** 2;
  return 2 * R_EARTH_KM * Math.asin(Math.sqrt(x));
}

/** km per grado di longitudine alla latitudine data. */
export const kmPerDegLng = (lat: number): number => KM_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);

/**
 * Tiene un punto ogni `stepKm` (più l'ultimo). Scrive su ogni punto di `pts` il campo `km`
 * (distanza progressiva): serve anche a `projectOn`.
 */
export function resample<T extends RoutePoint>(pts: T[], stepKm: number): T[] {
  const out: T[] = [];
  let acc = 0;
  pts.forEach((p, i) => {
    if (i) acc += haversine(pts[i - 1]!, p);
    p.km = acc;
    const last = out[out.length - 1];
    if (!last || p.km - (last.km ?? 0) >= stepKm || i === pts.length - 1) out.push(p);
  });
  return out;
}

/**
 * Divide il tracciato (già con `km`) in tratti lunghi al più `chunkKm` e costruisce attorno a
 * ciascuno un poligono largo ±`halfWidthKm`. L'API MIMIT cerca i distributori dentro il poligono.
 */
export function corridorPolys(pts: RoutePoint[], halfWidthKm = 1.5, chunkKm = 25): LatLng[][] {
  const polys: LatLng[][] = [];
  let start = 0;
  while (start < pts.length - 1) {
    let end = start;
    while (end < pts.length - 1 && (pts[end + 1]!.km ?? 0) - (pts[start]!.km ?? 0) <= chunkKm) end++;
    if (end === start) end++;
    const seg = pts.slice(start, end + 1);
    const left: LatLng[] = [];
    const right: LatLng[] = [];
    seg.forEach((p, i) => {
      const a = seg[Math.max(0, i - 1)]!;
      const b = seg[Math.min(seg.length - 1, i + 1)]!;
      const dx = (b.lng - a.lng) * kmPerDegLng(p.lat);
      const dy = (b.lat - a.lat) * KM_PER_DEG_LAT;
      const len = Math.hypot(dx, dy) || 1;
      const nx = (-dy / len) * halfWidthKm;
      const ny = (dx / len) * halfWidthKm;
      left.push({ lat: p.lat + ny / KM_PER_DEG_LAT, lng: p.lng + nx / kmPerDegLng(p.lat) });
      right.push({ lat: p.lat - ny / KM_PER_DEG_LAT, lng: p.lng - nx / kmPerDegLng(p.lat) });
    });
    polys.push(left.concat(right.reverse()));
    start = end;
  }
  return polys;
}

export interface Projection {
  /** distanza dalla strada, km */
  off: number;
  /** km dalla partenza del punto più vicino */
  along: number;
  /** il tratto più vicino è autostrada */
  mw: boolean;
  ref: string;
}

/** Punto del tracciato (con `km`) più vicino a `s`. */
export function projectOn(pts: RoutePoint[], s: LatLng): Projection {
  let best: Projection = { off: Infinity, along: 0, mw: false, ref: "" };
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const kx = kmPerDegLng(a.lat);
    const bx = (b.lng - a.lng) * kx;
    const by = (b.lat - a.lat) * KM_PER_DEG_LAT;
    const px = (s.lng - a.lng) * kx;
    const py = (s.lat - a.lat) * KM_PER_DEG_LAT;
    const l2 = bx * bx + by * by || 1e-9;
    const t = Math.max(0, Math.min(1, (px * bx + py * by) / l2));
    const off = Math.hypot(px - t * bx, py - t * by);
    if (off < best.off) {
      const ak = a.km ?? 0;
      const bk = b.km ?? 0;
      best = { off, along: ak + t * (bk - ak), mw: !!(a.mw && b.mw), ref: a.ref || b.ref || "" };
    }
  }
  return best;
}
