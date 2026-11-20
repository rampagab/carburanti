// Cloudflare Worker: proxy verso l'API dell'Osservatorio prezzi carburanti (MIMIT).
// Da incollare nella dashboard Cloudflare (Workers & Pages › il tuo Worker › Edit code).
// Nessuna chiave o segreto: l'API MIMIT è pubblica, questo Worker aggiunge solo CORS,
// indirizzi degli impianti e un po' di cache.
//
// Endpoint:
//   GET /search?lat=45.24&lng=11.75&radius=5&fuel=2&mode=1   (mode: 1 self, 0 servito, x tutte)
//   GET /station/12345
//   GET /                                                      (stato)
//
// Binding opzionale: KV namespace con nome "ADDR" per ricordare gli indirizzi per 30 giorni.

const API = "https://carburanti.mise.gov.it/ospzApi/";
const VERSION = "2026-11-20.2"; // pubblicato in automatico da GitHub (Cloudflare Workers Builds)

// Siti autorizzati a usare il Worker dal browser. Aggiungi qui eventuali altri indirizzi.
// Una lista vuota [] permette qualunque sito.
const ALLOWED_ORIGINS = [
  "https://rampagab.github.io",
  "http://localhost:8765",
];

const SEARCH_CACHE_SECONDS = 300;   // stessa ricerca entro 5 minuti: risposta dalla cache
const STATION_CACHE_SECONDS = 900;  // dettaglio impianto: 15 minuti
const ADDRESS_TTL_SECONDS = 30 * 24 * 3600;
const MAX_DETAIL_FETCHES = 40;      // limite piano Free: 50 sottorichieste per richiesta
const DETAIL_CONCURRENCY = 6;
const UPSTREAM_TIMEOUT_MS = 12000;

const FUELS = new Set(["0", "1", "2", "3", "4", "323", "324"]);
const MODES = new Set(["0", "1", "x"]);

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "GET") return json({ success: false, error: "Metodo non ammesso" }, 405, cors);
    if (origin && !isAllowed(origin)) return json({ success: false, error: "Origine non autorizzata" }, 403, cors);

    const url = new URL(request.url);
    try {
      if (url.pathname === "/" || url.pathname === "") {
        return json({ success: true, service: "carburanti-proxy", version: VERSION, kv: !!env.ADDR, time: new Date().toISOString() }, 200, cors);
      }
      if (url.pathname === "/search") return await handleSearch(url, env, ctx, cors);
      const m = url.pathname.match(/^\/station\/(\d{1,9})\/?$/);
      if (m) return await handleStation(m[1], env, ctx, cors);
      return json({ success: false, error: "Percorso non trovato" }, 404, cors);
    } catch (err) {
      const msg = err && err.name === "AbortError" ? "Il sito MIMIT non risponde (timeout)" : String((err && err.message) || err);
      return json({ success: false, error: msg }, 502, cors);
    }
  },
};

// ---------- /search ----------
async function handleSearch(url, env, ctx, cors) {
  const q = url.searchParams;
  const lat = Number(q.get("lat")), lng = Number(q.get("lng"));
  const radius = Number(q.get("radius") || 5);
  const fuel = String(q.get("fuel") || "0");
  const mode = String(q.get("mode") || "x");
  if (!isFinite(lat) || !isFinite(lng) || lat < 35 || lat > 48 || lng < 6 || lng > 19.5) {
    return json({ success: false, error: "Coordinate non valide (servono coordinate in Italia)" }, 400, cors);
  }
  if (!(radius >= 1 && radius <= 25)) return json({ success: false, error: "Raggio non valido (1–25 km)" }, 400, cors);
  if (!FUELS.has(fuel) || !MODES.has(mode)) return json({ success: false, error: "Carburante o modalità non validi" }, 400, cors);

  // Cache della risposta completa (coordinate arrotondate a ~100 m).
  const key = `https://cache.local/search?lat=${lat.toFixed(3)}&lng=${lng.toFixed(3)}&r=${radius}&f=${fuel}&m=${mode}`;
  const cache = caches.default;
  const hit = await cache.match(key);
  if (hit) return withCors(hit, cors, "HIT");

  const body = {
    points: [{ lat: Number(lat.toFixed(5)), lng: Number(lng.toFixed(5)) }],
    radius,
    fuelType: `${fuel}-${mode}`,
    priceOrder: "asc",
  };
  const data = await upstream("search/zone", { method: "POST", body: JSON.stringify(body) });
  if (!data || !Array.isArray(data.results)) throw new Error("Risposta MIMIT inattesa");

  await addAddresses(data.results, env, ctx);

  const out = {
    success: true,
    center: data.center || { lat, lng },
    fetchedAt: new Date().toISOString(),
    results: data.results,
  };
  const res = json(out, 200, {});
  res.headers.set("Cache-Control", `public, max-age=${SEARCH_CACHE_SECONDS}`);
  ctx.waitUntil(cache.put(key, res.clone()));
  return withCors(res, cors, "MISS");
}

// Aggiunge l'indirizzo (assente nella ricerca) leggendo KV o il dettaglio dell'impianto.
async function addAddresses(results, env, ctx) {
  const missing = results.filter((r) => !r.address);
  if (!missing.length) return;

  if (env.ADDR) {
    const found = await Promise.all(missing.map((r) => env.ADDR.get("a:" + r.id).catch(() => null)));
    missing.forEach((r, i) => { if (found[i]) r.address = found[i]; });
  }

  // I più vicini per primi, entro il limite di sottorichieste.
  const todo = results
    .filter((r) => !r.address)
    .sort((a, b) => parseFloat(a.distance) - parseFloat(b.distance))
    .slice(0, MAX_DETAIL_FETCHES);

  const writes = [];
  for (let i = 0; i < todo.length; i += DETAIL_CONCURRENCY) {
    const batch = todo.slice(i, i + DETAIL_CONCURRENCY);
    const details = await Promise.all(batch.map((r) => stationDetail(r.id).catch(() => null)));
    batch.forEach((r, j) => {
      const d = details[j];
      if (d && d.address) {
        r.address = d.address;
        if (env.ADDR) writes.push(env.ADDR.put("a:" + r.id, d.address, { expirationTtl: ADDRESS_TTL_SECONDS }));
      }
    });
  }
  if (writes.length) ctx.waitUntil(Promise.allSettled(writes));
}

// ---------- /station/:id ----------
async function handleStation(id, env, ctx, cors) {
  const key = `https://cache.local/station/${id}`;
  const cache = caches.default;
  const hit = await cache.match(key);
  if (hit) return withCors(hit, cors, "HIT");

  const d = await stationDetail(id);
  if (!d || !d.id) return json({ success: false, error: "Impianto non trovato" }, 404, cors);
  if (env.ADDR && d.address) ctx.waitUntil(env.ADDR.put("a:" + id, d.address, { expirationTtl: ADDRESS_TTL_SECONDS }).catch(() => {}));

  const res = json(d, 200, {});
  res.headers.set("Cache-Control", `public, max-age=${STATION_CACHE_SECONDS}`);
  ctx.waitUntil(cache.put(key, res.clone()));
  return withCors(res, cors, "MISS");
}

function stationDetail(id) {
  return upstream("registry/servicearea/" + encodeURIComponent(id), { method: "GET" });
}

// ---------- Utilità ----------
async function upstream(path, init) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const res = await fetch(API + path, {
      ...init,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "it-IT,it;q=0.9",
        "Origin": "https://carburanti.mise.gov.it",
        "Referer": "https://carburanti.mise.gov.it/ospzSearch/zona",
        "User-Agent": "Mozilla/5.0 (compatible; carburanti-personal-proxy/1.0)",
      },
    });
    if (!res.ok) throw new Error(`Il sito MIMIT ha risposto ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function isAllowed(origin) {
  return ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin);
}

function corsHeaders(origin) {
  const h = {
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
  if (ALLOWED_ORIGINS.length === 0) h["Access-Control-Allow-Origin"] = "*";
  else if (origin && ALLOWED_ORIGINS.includes(origin)) h["Access-Control-Allow-Origin"] = origin;
  return h;
}

function withCors(res, cors, cacheStatus) {
  const r = new Response(res.body, res);
  for (const [k, v] of Object.entries(cors)) r.headers.set(k, v);
  r.headers.set("X-Cache", cacheStatus);
  return r;
}

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}
