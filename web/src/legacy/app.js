// Pieno furbo: parte dell'app non ancora migrata in moduli (vedi docs/SESSIONI.md).
// La logica pura viene da ../core (TypeScript, testata).
import { haversine, resample as resampleKm, corridorPolys as corridorOf, projectOn, plausibleRange, pickFrom, costOf as costCore, estimateDetour, ROAD_FACTOR, shares, balances, settle, groupTotal } from "../core/index.ts";

(function () {
  "use strict";

  const CFG = window.CARBURANTI_CONFIG || {};
  const D = CFG.DEFAULTS || {};
  const params = new URLSearchParams(location.search);
  const DEMO = params.has("demo") && params.get("demo") !== "0";
  const WORKER = (CFG.WORKER_URL || "").replace(/\/+$/, "");
  const FUELS = { 1: "Benzina", 2: "Gasolio", 3: "Metano", 4: "GPL" };
  const UNIT = { 3: "€/kg" };
  const DAY_NAMES = ["", "Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato", "Domenica"];

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // ---------- Storage (sempre protetto: in privato o con dati bloccati può fallire) ----------
  const store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem("carburanti:" + key);
        return v == null ? fallback : JSON.parse(v);
      } catch (_) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem("carburanti:" + key, JSON.stringify(value)); } catch (_) { /* pieno o bloccato */ }
    },
    clearCache() {
      try {
        Object.keys(localStorage).filter((k) => k.startsWith("carburanti:cache:")).forEach((k) => localStorage.removeItem(k));
      } catch (_) { /* ignora */ }
    },
  };

  const settings = Object.assign(
    { zone: "monselice", fuel: 2, mode: 1, radius: 5, sort: "reco", liters: 50, qty: "full", dest: "back", timeValue: 0 },
    D,
    store.get("settings", {}),
    { brand: "", fresh: false, favOnly: false }
  );
  // Una volta sola: chi aveva "Prezzo" come ordinamento passa al nuovo "Consigliato".
  if (!store.get("recoIntro", false)) { settings.sort = "reco"; store.set("recoIntro", true); }
  const favs = new Set(store.get("favs", []));

  // Luoghi preferiti (come le città nelle app del meteo), salvati sul dispositivo.
  let places = store.get("places", null);
  if (!Array.isArray(places)) {
    places = (CFG.ZONES || []).map((z) => ({ id: String(z.id), name: z.name, lat: +z.lat, lng: +z.lng }));
    store.set("places", places);
  }
  const savePlaces = () => store.set("places", places);

  // Auto configurate dall'utente: consumo in L/100 km (kg/100 km per il metano), serbatoio in L (kg).
  let cars = store.get("cars", []);
  if (!Array.isArray(cars)) cars = [];
  let activeCarId = store.get("car", "");
  const saveCars = () => { store.set("cars", cars); store.set("car", activeCarId); };
  const activeCar = () => cars.find((c) => c.id === activeCarId) || null;
  // L'auto entra nei calcoli solo se il carburante mostrato è il suo.
  const carForFuel = () => { const c = activeCar(); return c && +c.fuel === +settings.fuel ? c : null; };
  const CAR_PRESETS = {
    1: { s: [5.5, 40], m: [6.5, 50], l: [8.5, 60] },
    2: { s: [4.5, 40], m: [5.5, 50], l: [7, 65] },
    4: { s: [7, 35], m: [8.5, 40], l: [10, 50] },
    3: { s: [3.8, 12], m: [4.5, 15], l: [5.5, 20] },
  };
  if (settings.zone !== "gps" && !places.some((p) => p.id === settings.zone)) settings.zone = "gps";
  const saveSettings = () => {
    const { zone, fuel, mode, radius, sort, liters, qty, dest, timeValue } = settings;
    store.set("settings", { zone, fuel, mode, radius, sort, liters, qty, dest, timeValue });
  };


  // ---------- Formattazione ----------
  const nf3 = new Intl.NumberFormat("it-IT", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  const nf2 = new Intl.NumberFormat("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const nf1 = new Intl.NumberFormat("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const price = (p) => (p == null ? "—" : nf3.format(p));
  const unit = (fuel) => UNIT[fuel] || "€/L";
  const km = (d) => (d < 1 ? Math.round(d * 1000) + " m" : nf1.format(d) + " km");
  const cents = (diff) => nf1.format(Math.round(diff * 1000) / 10);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function ago(iso) {
    const t = Date.parse(iso);
    if (!t) return { text: "data sconosciuta", hours: Infinity };
    const h = (Date.now() - t) / 3600e3;
    let text;
    if (h < 1) text = Math.max(1, Math.round(h * 60)) + " min fa";
    else if (h < 24) text = Math.round(h) + " h fa";
    else if (h < 48) text = "ieri";
    else text = Math.round(h / 24) + " giorni fa";
    return { text, hours: h };
  }
  function shortDate(iso) {
    const d = new Date(iso);
    return isNaN(d) ? "" : d.toLocaleDateString("it-IT", { day: "numeric", month: "short" });
  }

  // Nomi di marchio più leggibili ("PompeBianche" → "Pompe Bianche").
  function prettyBrand(b) {
    if (!b) return "Senza marchio";
    return String(b).replace(/([a-zà-ù])([A-Z])/g, "$1 $2").trim();
  }
  const isUsefulName = (n) => n && !/^\d+$/.test(n.trim());
  function prettyAddress(a) {
    if (!a) return "";
    // "Viale Della Repubblica 35 - 35043 MONSELICE (PD)" → "Viale della Repubblica 35, Monselice (PD)"
    // Gestisce anche più parti ("VIA PADOVA - S.S. 16 - MONSELICE (PD)") e sigle (S.R., SNC, km).
    const fixCase = (str) => str.toLowerCase()
      .replace(/(^|[\s'(\/-])(\p{L})/gu, (m, p, c) => p + c.toUpperCase())
      .replace(/\b(Della|Delle|Dello|Degli|Dei|Del|Di|Da|Al|Alla|Ai|E)\b/g, (w) => w.toLowerCase())
      .replace(/\b(Dell|Dall|Nell|Sull|All)'/g, (w) => w.toLowerCase())
      .replace(/\b([a-z])\.([a-z])\.?(?=\s|$)/gi, (m, x, y) => (x + "." + y + ".").toUpperCase()) // S.S., S.R., S.P.
      .replace(/\b(Ss|Sr|Sp|Snc|Sn)\b/g, (w) => w.toUpperCase())
      .replace(/\bKm\b/g, "km")
      .replace(/^\p{L}/u, (c) => c.toUpperCase());
    const parts = String(a).split(/\s+-\s+/).map((x) => x.trim()).filter(Boolean);
    if (!parts.length) return "";
    let city = "";
    const last = parts[parts.length - 1];
    const m = last.match(/^(?:\d{5}\s+)?(.+?)\s*\(([A-Za-z]{2})\)\s*$/);
    if (parts.length > 1 && m) { city = fixCase(m[1]) + " (" + m[2].toUpperCase() + ")"; parts.pop(); }
    const street = parts.map((x) => fixCase(x.replace(/\s+SNC$/i, ""))).join(", ");
    return city ? street + ", " + city : street;
  }

  function placeName(x) {
    const a = (x && x.address) || {};
    const town = a.city || a.town || a.village || a.municipality || a.hamlet || a.suburb || "";
    const prov = String(a["ISO3166-2-lvl6"] || "").replace(/^IT-/, "");
    let name = (x && x.name) || a.road || town || String((x && x.display_name) || "").split(",")[0];
    if (town && name !== town) name += ", " + town;
    return prov && /^[A-Z]{2}$/.test(prov) ? name + " (" + prov + ")" : name;
  }

  // Loghi dei marchi (data/logos, da scripts/build_logos.py); senza logo: iniziali su un colore fisso.
  const logoKey = (b) => String(b || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  function logoHTML(brand, size) {
    const file = state.logos && state.logos[logoKey(brand)];
    const cls = "logo" + (size ? " " + size : "");
    if (file) return `<img class="${cls}" src="${CFG.DATA_URL || "data"}/logos/${encodeURIComponent(file)}" alt="" loading="lazy" decoding="async">`;
    const words = prettyBrand(brand).split(/[\s\-/]+/).filter(Boolean);
    const ini = (words.length > 1 ? words[0][0] + words[1][0] : (words[0] || "?").slice(0, 2)).toUpperCase();
    let h = 0; for (const c of String(brand)) h = (h * 31 + c.charCodeAt(0)) % 360;
    return `<span class="${cls} ini" style="--h:${h}" aria-hidden="true">${esc(ini)}</span>`;
  }

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  function mapsUrl(s) {
    const ll = s.lat + "," + s.lng;
    return isIOS
      ? "https://maps.apple.com/?daddr=" + ll + "&dirflg=d"
      : "https://www.google.com/maps/dir/?api=1&destination=" + ll + "&travelmode=driving";
  }

  // ---------- Dati ----------
  function withTimeout(ms) {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), ms);
    return { signal: c.signal, done: () => clearTimeout(t) };
  }
  async function getJSON(url, ms = 15000) {
    const to = withTimeout(ms);
    try {
      const res = await fetch(url, { signal: to.signal });
      if (!res.ok) {
        let msg = "HTTP " + res.status;
        try { const j = await res.json(); if (j && j.error) msg = j.error; } catch (_) { /* non JSON */ }
        throw new Error(msg);
      }
      return await res.json();
    } catch (e) {
      if (e.name === "AbortError") throw new Error("Il server non risponde (timeout)");
      throw e;
    } finally { to.done(); }
  }

  function normalizeStation(r) {
    const loc = r.location || {};
    return {
      id: r.id,
      name: r.name || r.nomeImpianto || "",
      brand: r.brand || "",
      address: r.address || "",
      lat: +(loc.lat ?? r.lat),
      lng: +(loc.lng ?? r.lng),
      distance: r.distance == null ? null : parseFloat(String(r.distance).replace(",", ".")),
      insertDate: r.insertDate || null,
      fuels: (r.fuels || []).map((f) => ({
        fuelId: +f.fuelId, name: f.name, price: f.price == null ? null : +f.price,
        isSelf: !!f.isSelf, insertDate: f.insertDate || null,
      })),
    };
  }

  const carCache = {};
  const api = {
    async search(q) {
      const raw = DEMO
        ? await window.CarburantiDemo.search(q)
        : await getJSON(`${WORKER}/search?lat=${q.lat}&lng=${q.lng}&radius=${q.radius}&fuel=${q.fuel}&mode=x`, 25000);
      if (raw && raw.success === false) throw new Error(raw.error || "Ricerca non riuscita");
      return (raw.results || []).map(normalizeStation);
    },
    async station(id) {
      return DEMO ? window.CarburantiDemo.station(id) : getJSON(`${WORKER}/station/${encodeURIComponent(id)}`);
    },
    async history(id) {
      if (DEMO) return window.CarburantiDemo.history(id);
      try { return await getJSON(`${CFG.DATA_URL || "data"}/history/${encodeURIComponent(id)}.json`, 8000); } catch (_) { return null; }
    },
    // Ricerca luoghi: OpenStreetMap Nominatim (gratuito, senza chiave; solo su invio, niente autocompletamento).
    async geocode(q) {
      if (DEMO) return window.CarburantiDemo.geocode(q);
      const url = "https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=it&limit=6&addressdetails=1&accept-language=it&q=" + encodeURIComponent(q);
      const list = await getJSON(url, 10000);
      const seen = new Set();
      return (list || []).map((x) => ({ name: placeName(x), detail: x.display_name, lat: +x.lat, lng: +x.lon }))
        .filter((r) => !seen.has(r.name) && seen.add(r.name)); // stesso comune come "comune" e come "paese"
    },
    async reverse(lat, lng) {
      if (DEMO) return "Posizione demo";
      try {
        const x = await getJSON(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&addressdetails=1&accept-language=it&lat=${lat}&lon=${lng}`, 8000);
        return placeName(x);
      } catch (_) { return ""; }
    },
    // Percorso stradale: OSRM (server dimostrativo pubblico, gratuito, senza chiave).
    async route(...pts) {
      if (DEMO) return window.CarburantiDemo.route(...pts);
      const url = `https://router.project-osrm.org/route/v1/driving/${pts.map((p) => `${p.lng.toFixed(5)},${p.lat.toFixed(5)}`).join(";")}?overview=false&steps=true&alternatives=false`;
      const j = await getJSON(url, 20000);
      if (!j || j.code !== "Ok" || !j.routes || !j.routes.length) throw new Error("Percorso non trovato");
      const r = j.routes[0];
      const tolls = await api.tolls();
      const byRef = {};
      for (const leg of r.legs || []) {
        for (const st of leg.steps || []) {
          const refs = String(st.ref || "").split(/[;,]/).map((x) => x.replace(/\s+/g, "").toUpperCase());
          const m = refs.map((x) => x.match(/^A\d+/)).find(Boolean);
          // A pagamento: le autostrade in concessione (dati ART); senza dati, tutte tranne le note gratuite.
          if (m && (tolls ? tolls.refs[m[0]] : !FREE_MOTORWAYS.has(m[0]))) byRef[m[0]] = (byRef[m[0]] || 0) + st.distance / 1000;
        }
      }
      const mwKm = Object.values(byRef).reduce((a, b) => a + b, 0);
      return { km: r.distance / 1000, min: r.duration / 60, mwKm, byRef, roads: Object.keys(byRef) };
    },
    // Tracciato completo del percorso, con i tratti in autostrada marcati.
    async routeGeo(a, b) {
      if (DEMO) return window.CarburantiDemo.routeGeo(a, b);
      const j = await getJSON(`https://router.project-osrm.org/route/v1/driving/${a.lng.toFixed(5)},${a.lat.toFixed(5)};${b.lng.toFixed(5)},${b.lat.toFixed(5)}?overview=false&steps=true&geometries=geojson&alternatives=false`, 25000);
      if (!j || j.code !== "Ok" || !j.routes || !j.routes.length) throw new Error("Percorso non trovato");
      const pts = [];
      for (const leg of j.routes[0].legs || []) {
        for (const st of leg.steps || []) {
          const refs = String(st.ref || "").split(/[;,]/).map((x) => x.replace(/\s+/g, "").toUpperCase());
          const m = refs.map((x) => x.match(/^A\d+/)).find(Boolean);
          for (const [lng, lat] of (st.geometry && st.geometry.coordinates) || []) pts.push({ lat, lng, mw: !!m, ref: m ? m[0] : "" });
        }
      }
      return pts;
    },
    async polygon(poly, fuel) {
      if (DEMO) return window.CarburantiDemo.polygon(poly, fuel);
      const pts = poly.map((p) => p.lat.toFixed(5) + "," + p.lng.toFixed(5)).join(";");
      const j = await getJSON(`${WORKER}/polygon?pts=${pts}&fuel=${fuel}&mode=x`, 25000);
      return (j.results || []).map(normalizeStation);
    },
    async highways() {
      if (DEMO) return [];
      if (!carCache.highways) carCache.highways = getJSON(`${WORKER}/highways`, 15000).then((j) => j.results || []).catch(() => { carCache.highways = null; return []; });
      return carCache.highways;
    },
    async highway(id) {
      if (DEMO) return [];
      const j = await getJSON(`${WORKER}/highway?id=${encodeURIComponent(id)}`, 20000);
      return (j.results || []).map(normalizeStation);
    },
    // Distanze e tempi su strada: dall'origine a ogni distributore e da ogni distributore alla destinazione.
    async table(a, list, c) {
      if (DEMO) return window.CarburantiDemo.table(a, list, c);
      const pts = [a, ...list, c];
      const n = list.length;
      const q = `sources=${[0, ...list.map((_, i) => i + 1)].join(";")}&destinations=${[...list.map((_, i) => i + 1), n + 1].join(";")}&annotations=distance,duration`;
      const j = await getJSON(`https://router.project-osrm.org/table/v1/driving/${pts.map((p) => `${p.lng.toFixed(5)},${p.lat.toFixed(5)}`).join(";")}?${q}`, 20000);
      if (!j || j.code !== "Ok") throw new Error("Distanze non disponibili");
      return { dist: j.distances, dur: j.durations };
    },
    // Database auto (EEA, generato da scripts/build_cars.py): indice marche e un file per marca.
    async carIndex() {
      if (!carCache.index) carCache.index = getJSON(`${CFG.DATA_URL || "data"}/cars/index.json`, 15000).catch((e) => { carCache.index = null; throw e; });
      return carCache.index;
    },
    async carMake(file) {
      if (!carCache[file]) carCache[file] = getJSON(`${CFG.DATA_URL || "data"}/cars/${encodeURIComponent(file)}.json`, 15000).catch((e) => { delete carCache[file]; throw e; });
      return carCache[file];
    },
    // Suggerimenti mentre si scrive: Photon (komoot, dati OpenStreetMap), gratuito e senza chiave.
    async suggest(q, near, signal) {
      if (DEMO) return window.CarburantiDemo.geocode(q);
      const p = new URLSearchParams({ q, limit: "6", lang: "default", bbox: "6.6,35.4,18.6,47.1" });
      if (near) { p.set("lat", near.lat.toFixed(3)); p.set("lon", near.lng.toFixed(3)); }
      const res = await fetch("https://photon.komoot.io/api/?" + p, { signal });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const j = await res.json();
      const seen = new Set();
      return (j.features || []).map((f) => {
        const a = f.properties || {};
        const [lng, lat] = f.geometry.coordinates;
        const street = a.street ? a.street + (a.housenumber ? " " + a.housenumber : "") : "";
        const town = a.city || a.town || a.village || a.district || "";
        let name = a.name || street || town;
        if (street && a.name && a.name !== street) name = a.name + ", " + street;
        if (town && name !== town && !name.includes(town)) name += ", " + town;
        const prov = { Padova: "PD", Venezia: "VE", Verona: "VR", Vicenza: "VI", Treviso: "TV", Rovigo: "RO", Belluno: "BL" }[a.county] || "";
        const detail = [a.county, a.state].filter(Boolean).join(", ");
        return { name: prov && !name.includes("(") ? `${name} (${prov})` : name, detail, lat, lng };
      }).filter((r) => r.name && !seen.has(r.name) && seen.add(r.name));
    },
    // Tariffe di pedaggio per autostrada (data/tolls.json, da scripts/build_tolls.py).
    async tolls() {
      if (carCache.tolls === undefined) carCache.tolls = getJSON(`${CFG.DATA_URL || "data"}/tolls.json`, 8000).catch(() => null);
      return carCache.tolls;
    },
    async meta() {
      if (DEMO) return { zones: [{ name: "Monselice", lat: 45.2414, lng: 11.7497, radius: 15 }, { name: "Padova", lat: 45.4064, lng: 11.8768, radius: 15 }] };
      try { return await getJSON(`${CFG.DATA_URL || "data"}/meta.json`, 8000); } catch (_) { return null; }
    },
    async average() {
      if (DEMO) return window.CarburantiDemo.average();
      try { return await getJSON(`${CFG.DATA_URL || "data"}/average.json`, 8000); } catch (_) { return null; }
    },
  };

  // ---------- Stato ----------
  const state = {
    stations: [],     // tutti gli impianti trovati (normalizzati)
    loading: false,
    error: null,
    fromCache: null,  // timestamp se mostro dati in cache
    gps: null,        // ultima posizione GPS
    average: null,
    meta: null,       // data/meta.json: zone raccolte dallo storico
    logos: null,      // data/logos/index.json: marchio normalizzato → file
    reqId: 0,
  };

  function currentCenter() {
    if (settings.zone === "gps") return state.gps;
    const z = places.find((p) => p.id === settings.zone);
    return z ? { lat: z.lat, lng: z.lng, name: z.name } : null;
  }

  // Prezzo dell'impianto per carburante + modalità scelti (il più basso, se ci sono più prodotti).
  // Filtro anti-errori: un prezzo sotto il 60% o sopra il doppio della mediana della zona è quasi
  // sempre un errore di comunicazione del gestore (es. 0,199 invece di 2,199). Lo escludo.
  let pricedMemo = { stations: null, key: "", rows: [], dropped: 0 };
  function priced() {
    const key = settings.fuel + "-" + settings.mode;
    if (pricedMemo.stations === state.stations && pricedMemo.key === key) return pricedMemo.rows;
    const fuel = +settings.fuel, self = +settings.mode === 1;
    const range = plausibleRange(state.stations, fuel, self);
    let dropped = 0;
    const rows = [];
    for (const s of state.stations) {
      const f = pickFrom(s, fuel, self, range);
      if (f) rows.push({ s, f });
      else if (s.fuels.some((x) => x.fuelId === fuel && x.isSelf === self && x.price > 0)) dropped++;
    }
    pricedMemo = { stations: state.stations, key, rows, dropped };
    return rows;
  }
  // Compatibilità: il prezzo mostrato per un impianto (stesso filtro della lista).
  function pick(st) {
    const r = priced().find((x) => x.s === st);
    return r ? r.f : null;
  }

  // Distributore di riferimento: il più vicino (quello dove andresti senza spostarti).
  function nearestRef(rows) {
    return rows.reduce((best, x) => (!best || (x.s.distance ?? 99) < (best.s.distance ?? 99) ? x : best), null);
  }
  // Quanto risparmi sul pieno rispetto al più vicino, tolto il carburante per la deviazione (andata e ritorno).
  function netSaving(x, ref, car) {
    const extraKm = 2 * Math.max(0, (x.s.distance ?? 0) - (ref.s.distance ?? 0)) * ROAD_FACTOR;
    return (ref.f.price - x.f.price) * car.tank - (extraKm * car.cons / 100) * x.f.price;
  }

  // ---------- Consigliato per te ----------
  // Costo reale di un rifornimento: carburante messo + carburante per la deviazione + pedaggi + (facoltativo) tempo.
  // Deviazione = strada in più rispetto al tragitto che faresti comunque: A → distributore → C, meno A → C.
  // "Torno qui": C = A, cioè andata e ritorno.
  const DEFAULT_CONS = 6.5;  // L/100 km senza un'auto nel garage
  const reco = { key: "", road: {}, tolls: {}, busy: false, ok: false };
  const QTY = [["full", "Pieno"], ["0.75", "¾"], ["0.5", "½"], ["0.25", "¼"], ["eur:20", "20 €"], ["eur:30", "30 €"], ["eur:50", "50 €"]];

  function recoParams() {
    const A = currentCenter();
    const rows = priced();
    if (!A || !rows.length) return null;
    const dest = settings.dest !== "back" ? places.find((p) => p.id === settings.dest) : null;
    const C = dest ? { lat: dest.lat, lng: dest.lng } : { lat: A.lat, lng: A.lng };
    const car = carForFuel();
    const cons = car ? car.cons : DEFAULT_CONS;
    const tank = car ? car.tank : settings.liters;
    const avg = rows.reduce((a, x) => a + x.f.price, 0) / rows.length;
    const q = String(settings.qty || "full");
    let liters, label;
    if (q.startsWith("eur:")) {
      const eur = +q.slice(4);
      liters = eur / avg; label = `${eur} €`;            // a parità di euro: confronto sui litri equivalenti
    } else {
      const frac = q === "full" ? 1 : +q || 1;
      liters = tank * frac;
      label = frac === 1 ? `Pieno ${nf1.format(liters).replace(",0", "")} ${+settings.fuel === 3 ? "kg" : "L"}` : `${(QTY.find((x) => x[0] === q) || [0, ""])[1]} serbatoio`;
    }
    return { A: { lat: A.lat, lng: A.lng }, C, back: !dest, destName: dest ? dest.name : "", cons, liters, label, car, avg, timeValue: +settings.timeValue || 0 };
  }

  function extraFor(s, P) {
    const r = reco.road[s.id];
    if (r) return { km: r.km, min: r.min, toll: reco.tolls[s.id] || 0, exact: true };
    const st = { lat: s.lat, lng: s.lng };
    return estimateDetour(haversine(P.A, st), haversine(st, P.C), haversine(P.A, P.C));
  }
  const costOf = (x, P) => costCore(x.f.price, extraFor(x.s, P), P);
  function recoRanking() {
    const P = recoParams();
    if (!P) return null;
    const list = priced().map((x) => ({ ...x, c: costOf(x, P) })).sort((a, b) => a.c.total - b.c.total);
    return { P, list, best: list[0] };
  }

  // Distanze vere su strada (OSRM) per i distributori più promettenti, poi pedaggi per i primi tre.
  async function refineReco() {
    const P = recoParams();
    if (!P) return;
    const rows = priced();
    const key = [P.A.lat.toFixed(4), P.A.lng.toFixed(4), P.C.lat.toFixed(4), P.C.lng.toFixed(4), settings.fuel, settings.mode, rows.length].join("|");
    if (reco.key === key) return;
    reco.key = key; reco.road = {}; reco.tolls = {}; reco.ok = false;
    const prelim = rows.map((x) => ({ x, c: costOf(x, P) })).sort((a, b) => a.c.total - b.c.total);
    const near = rows.slice().sort((a, b) => (a.s.distance ?? 99) - (b.s.distance ?? 99)).slice(0, 3);
    const cand = [...new Set(prelim.slice(0, 12).map((y) => y.x).concat(near))].slice(0, 15);
    try {
      const t = await api.table(P.A, cand.map((x) => ({ lat: x.s.lat, lng: x.s.lng })), P.C);
      if (reco.key !== key) return;
      const n = cand.length;
      const base = P.back ? 0 : t.dist[0][n], baseT = P.back ? 0 : t.dur[0][n];
      cand.forEach((x, i) => {
        const d = t.dist[0][i] + t.dist[i + 1][n] - base;
        const m = t.dur[0][i] + t.dur[i + 1][n] - baseT;
        if (isFinite(d) && isFinite(m)) reco.road[x.s.id] = { km: Math.max(0, d) / 1000, min: Math.max(0, m) / 60 };
      });
      reco.ok = true;
      render();
      // Pedaggi della deviazione (es. un tratto di autostrada) per i primi tre.
      const top = cand.map((x) => ({ x, c: costOf(x, P) })).sort((a, b) => a.c.total - b.c.total).slice(0, 3);
      const tollsData = await api.tolls();
      const tollOf = (r) => Object.entries(r.byRef || {}).reduce((a, [ref, km]) => a + km * ((tollsData && tollsData.refs[ref] && tollsData.refs[ref].rate) || DEFAULT_TOLL_RATE), 0);
      const direct = P.back ? 0 : tollOf(await api.route(P.A, P.C));
      for (const { x } of top) {
        if (reco.key !== key) return;
        const r = await api.route(P.A, { lat: x.s.lat, lng: x.s.lng }, P.C);
        const extra = tollOf(r) - direct;
        if (extra > 0.05) reco.tolls[x.s.id] = Math.round(extra * 10) / 10;
      }
      if (reco.key === key) render();
    } catch (_) { /* senza OSRM resto sulla stima in linea d'aria */ }
  }

  function visible() {
    let rows = priced();
    if (settings.brand) rows = rows.filter((x) => (x.s.brand || "") === settings.brand);
    if (settings.fresh) rows = rows.filter((x) => ago(x.s.insertDate).hours <= 24);
    if (settings.favOnly) rows = rows.filter((x) => favs.has(String(x.s.id)));
    const byPrice = (a, b) => a.f.price - b.f.price || (a.s.distance ?? 99) - (b.s.distance ?? 99);
    const rk = recoRanking();
    const costById = rk ? new Map(rk.list.map((x) => [x.s.id, x.c.total])) : null;
    const sorters = {
      price: byPrice,
      reco: costById ? (a, b) => costById.get(a.s.id) - costById.get(b.s.id) || byPrice(a, b) : byPrice,
      distance: (a, b) => (a.s.distance ?? 99) - (b.s.distance ?? 99) || a.f.price - b.f.price,
      date: (a, b) => (Date.parse(b.s.insertDate) || 0) - (Date.parse(a.s.insertDate) || 0) || byPrice(a, b),
    };
    return rows.sort(sorters[settings.sort] || byPrice);
  }

  // ---------- Caricamento ----------
  const cacheKey = (c) => `cache:${c.lat.toFixed(3)},${c.lng.toFixed(3)}:${settings.radius}:${settings.fuel}`;

  async function load() {
    const center = currentCenter();
    if (!center) {
      settings.zone = "gps";
      return locate();
    }
    if (!DEMO && !WORKER) { state.error = "noworker"; render(); return; }

    const id = ++state.reqId;
    const key = cacheKey(center);
    const cached = store.get(key, null);
    state.error = null;
    if (cached && cached.data) {
      state.stations = cached.data.map(normalizeStation);
      state.fromCache = cached.t;
    } else {
      state.stations = [];
      state.fromCache = null;
    }
    state.loading = true;
    render();

    try {
      const stations = await api.search({ lat: center.lat, lng: center.lng, radius: settings.radius, fuel: settings.fuel });
      if (id !== state.reqId) return;
      state.stations = stations;
      state.fromCache = null;
      store.set(key, { t: Date.now(), data: stations });
    } catch (e) {
      if (id !== state.reqId) return;
      state.error = e.message || String(e);
    } finally {
      if (id === state.reqId) { state.loading = false; render(); }
    }
  }

  function locate() {
    if (!navigator.geolocation) { state.error = "La posizione non è disponibile su questo dispositivo."; render(); return; }
    state.loading = true; state.error = null; state.stations = []; render();
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        state.gps = { lat: pos.coords.latitude, lng: pos.coords.longitude, name: "La tua posizione" };
        state.loading = false;
        load();
      },
      (err) => {
        state.loading = false;
        state.error = err.code === 1
          ? "Permesso di posizione negato. Su iPhone: Impostazioni › Privacy › Localizzazione › Safari. Oppure aggiungi un luogo con il tasto +."
          : "Posizione non trovata. Riprova o aggiungi un luogo con il tasto +.";
        render();
      },
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 120000 }
    );
  }

  // ---------- Render ----------
  function renderControls() {
    const zones = [{ id: "gps", name: "Vicino a me" }].concat(places);
    $("#zones").innerHTML = zones.map((z) =>
      `<button role="radio" aria-checked="${settings.zone === z.id}" data-zone="${esc(z.id)}">${z.id === "gps" ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2v3M12 19v3M2 12h3M19 12h3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="12" r="6" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="2" fill="currentColor"/></svg>' : ""}${esc(z.name)}</button>`
    ).join("") + `<button class="chip-add${places.length ? "" : " wide"}" data-places aria-label="Gestisci i luoghi">${places.length ? "+" : "+ Aggiungi luogo"}</button>`;
    const segs = { "#seg-fuel": settings.fuel, "#seg-mode": settings.mode, "#seg-radius": settings.radius };
    for (const sel in segs) {
      $$(sel + " button").forEach((b) => {
        b.setAttribute("role", "radio");
        b.setAttribute("aria-checked", String(String(b.dataset.v) === String(segs[sel])));
      });
    }
    const sortOpts = [["reco", "Consigliato"], ["price", "Prezzo"], ["distance", "Distanza"], ["date", "Aggiornamento"]];
    $("#sel-sort").innerHTML = sortOpts.map(([v, t]) => `<option value="${v}">${t}</option>`).join("");
    $("#sel-sort").value = sortOpts.some((o) => o[0] === settings.sort) ? settings.sort : "reco";
    renderPills();
    $("#tg-fresh").setAttribute("aria-pressed", String(settings.fresh));
    $("#tg-fav").setAttribute("aria-pressed", String(settings.favOnly));

    // Marchi presenti nei risultati.
    const counts = {};
    for (const { s } of priced()) counts[s.brand || ""] = (counts[s.brand || ""] || 0) + 1;
    const brands = Object.keys(counts).sort((a, b) => prettyBrand(a).localeCompare(prettyBrand(b), "it"));
    if (settings.brand && !counts[settings.brand]) brands.push(settings.brand);
    $("#sel-brand").innerHTML = '<option value="">Tutti i marchi</option>' +
      brands.map((b) => `<option value="${esc(b)}">${esc(prettyBrand(b))} (${counts[b] || 0})</option>`).join("");
    $("#sel-brand").value = settings.brand;
  }

  const ICON_CAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 17h14M4 13l2-6h12l2 6v4H4z"/></svg>';
  const ICON_PUMP = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 20V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v15M3 20h14M8 7h4M15 9h2a2 2 0 0 1 2 2v5a1.5 1.5 0 0 0 3 0V8l-3-3"/></svg>';
  function renderPills() {
    const car = carForFuel();
    const mode = +settings.mode === 1 ? "self" : "servito";
    $("#pill-car").innerHTML = `${car ? ICON_CAR : ICON_PUMP}<span>${car ? esc(car.name) + " · " : ""}${esc(FUELS[settings.fuel])}${mode === "servito" ? " servito" : ""}</span><i aria-hidden="true">▾</i>`;
    const dest = settings.dest !== "back" && places.find((p) => p.id === settings.dest);
    if (settings.dest !== "back" && !dest) settings.dest = "back";
    $("#pill-route").innerHTML = `<span>${dest ? "→ " + esc(dest.name.replace(/\s*\([A-Z]{2}\)$/, "")) : "↩ Torno qui"}</span><i aria-hidden="true">▾</i>`;
    $("#pill-radius").innerHTML = `<span>${settings.radius} km</span><i aria-hidden="true">▾</i>`;
    const nf = (settings.brand ? 1 : 0) + (settings.fresh ? 1 : 0) + (settings.favOnly ? 1 : 0) + (settings.sort !== "reco" ? 1 : 0) + (+settings.timeValue > 0 ? 1 : 0);
    $("#pill-filters").innerHTML = `<span>Filtri</span>${nf ? `<b class="cnt">${nf}</b>` : ""}`;
    // Pannello auto: le auto del garage impostano da sole il carburante.
    $("#car-chips").innerHTML = cars.map((c) => `<button class="opt" data-pick-car="${esc(c.id)}" aria-pressed="${c.id === activeCarId}">${esc(c.name)} <small>${esc(FUELS[c.fuel])}</small></button>`).join("") +
      `<button class="opt" data-pick-car="" aria-pressed="${!activeCar()}">Nessuna</button><button class="opt dashed" data-new-car>+ Nuova auto</button>`;
    const q = String(settings.qty || "full");
    $("#qty-chips").innerHTML = QTY.map(([v, t]) => `<button class="opt" data-qty="${v}" aria-pressed="${q === v}">${t}</button>`).join("");
    $("#route-chips").innerHTML = `<button class="opt" data-dest="back" aria-pressed="${settings.dest === "back"}">Torno qui</button>` +
      places.map((p) => `<button class="opt" data-dest="${esc(p.id)}" aria-pressed="${settings.dest === p.id}">Poi vado a ${esc(p.name)}</button>`).join("") +
      `<button class="opt dashed" data-places>+ Luogo</button>`;
    const tv = $("#in-timevalue");
    if (tv && document.activeElement !== tv) tv.value = settings.timeValue || 0;
  }
  function togglePanel(name) {
    for (const k of ["car", "route", "radius", "filters"]) {
      const open = k === name && $("#panel-" + k).hidden;
      $("#panel-" + k).hidden = !open;
      $("#pill-" + k).setAttribute("aria-expanded", String(open));
    }
  }
  const closePanels = () => togglePanel(null);

  function renderNotice() {
    const n = $("#notice");
    let html = "";
    if (state.fromCache && state.error) {
      html = `<strong>Sei offline o il server non risponde.</strong> Mostro i dati salvati ${esc(ago(new Date(state.fromCache).toISOString()).text)}.`;
    } else if (state.fromCache && state.loading) {
      html = `Aggiornamento in corso… (dati salvati ${esc(ago(new Date(state.fromCache).toISOString()).text)})`;
    }
    n.hidden = !html;
    n.innerHTML = html;
  }

  // Zona dello storico vicina al centro attuale (la media ha senso solo lì).
  function nearHistoryZone() {
    const c = currentCenter();
    const zones = (state.meta && state.meta.zones) || [];
    if (!c) return null;
    return zones.some((z) => haversine(c, z) <= (z.radius || 15) + 5) ? zones.map((z) => z.name).join("–") : null;
  }

  function trendInfo() {
    const avg = state.average;
    if (!nearHistoryZone()) return null;
    const k = settings.fuel + "-" + settings.mode;
    if (!avg || !avg.days || avg.days.length < 2) return null;
    const days = avg.days.filter((d) => d.v && d.v[k]);
    if (days.length < 2) return null;
    const today = days[days.length - 1], prev = days[days.length - 2];
    const week = days.length >= 8 ? days[days.length - 8] : null;
    return {
      today: today.v[k].avg,
      dDay: today.v[k].avg - prev.v[k].avg,
      dWeek: week ? today.v[k].avg - week.v[k].avg : null,
    };
  }

  function renderSummary() {
    const el = $("#summary");
    const rows = priced();
    const u = unit(settings.fuel);
    if (state.error === "noworker") {
      el.innerHTML = `<div class="card state">
        <h2>Worker non configurato</h2>
        <p>Imposta <code>WORKER_URL</code> in <code>config.js</code> per vedere i prezzi reali.</p>
        <a class="btn" href="?demo=1">Prova la demo</a></div>`;
      return;
    }
    if (!rows.length) { el.innerHTML = ""; return; }
    const prices = rows.map((x) => x.f.price);
    const min = Math.min(...prices);
    const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
    const best = rows.filter((x) => x.f.price === min).sort((a, b) => (a.s.distance ?? 99) - (b.s.distance ?? 99))[0];
    const car = carForFuel();
    const qty = car ? car.tank : settings.liters;
    const qu = +settings.fuel === 3 ? "kg" : "L";
    const saving = (mean - min) * qty;
    const tr = trendInfo();
    let trend = "";
    if (tr) {
      const d = Math.round(tr.dDay * 1000) / 10;
      const cls = d < 0 ? "down" : d > 0 ? "up" : "flat";
      const arrow = d < 0 ? "↓" : d > 0 ? "↑" : "→";
      const label = d === 0 ? "stabile da ieri" : `${d < 0 ? "in calo" : "in aumento"}: ${d < 0 ? "−" : "+"}${cents(Math.abs(tr.dDay))} cent da ieri`;
      let advice = "";
      if (tr.dWeek != null) {
        const w = Math.round(tr.dWeek * 1000) / 10;
        advice = w <= -0.5 ? "Prezzi in discesa: se puoi aspettare, aspetta." : w >= 0.5 ? "Prezzi in salita: conviene fare il pieno oggi." : "Settimana stabile: nessuna fretta.";
      }
      trend = `<div class="trend ${cls}"><span class="arrow" aria-hidden="true">${arrow}</span>
        <span><strong>Media ${esc(nearHistoryZone())} ${label}</strong>${advice ? `<br><span class="muted">${advice}</span>` : ""}</span></div>`;
    }
    const center = currentCenter();
    const rk = recoRanking();
    const P = rk.P, R = rk.best;
    const cheapest = rk.list.find((x) => x.f.price === min);
    const nearest = rk.list.reduce((a, x) => (!a || (x.s.distance ?? 99) < (a.s.distance ?? 99) ? x : a), null);
    const lit = nf1.format(P.liters).replace(",0", "") + " " + qu;
    const extraTxt = (c) => `${c.exact ? "" : "~"}${nf1.format(c.km)} km${c.min >= 1 ? `<small>+${Math.round(c.min)} min</small>` : ""}`;
    const cmp = (x, label) => {
      const d = x.c.total - R.c.total;
      return `<li><span>${label} <strong>${price(x.f.price)}</strong> · ${x.s.distance != null ? km(x.s.distance) : ""}</span><b>${d < 0.005 ? "uguale" : "+" + nf2.format(d) + " €"}</b></li>`;
    };
    const others = [];
    if (cheapest && cheapest.s.id !== R.s.id) others.push(cmp(cheapest, "Il più economico"));
    if (nearest && nearest.s.id !== R.s.id && nearest !== cheapest) others.push(cmp(nearest, "Il più vicino"));
    const avgCost = P.avg * P.liters + R.c.road;
    el.innerHTML = `<div class="card sum hero">
      <div class="sum-head"><span class="pill-dark">Consigliato per te</span><span class="sum-fuel">${esc(FUELS[settings.fuel])} ${+settings.mode === 1 ? "self" : "servito"}</span></div>
      <button class="sum-best" data-open="${esc(R.s.id)}" aria-label="Dettagli ${esc(prettyBrand(R.s.brand))}">
        <span class="big">${price(R.f.price)}</span><span class="u">${u}</span>
      </button>
      <div class="sum-row">
        <span class="sum-where">${logoHTML(R.s.brand)}<span>${esc(prettyBrand(R.s.brand))}${R.s.distance != null ? " · " + km(R.s.distance) : ""}</span></span>
        <a class="round-go" href="${mapsUrl(R.s)}" target="_blank" rel="noopener" aria-label="Portami lì">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7M9 7h8v8"/></svg></a>
      </div>
      <dl class="minis">
        <div><dt>${esc(P.label)}</dt><dd>${nf2.format(R.c.total)} €</dd></div>
        <div><dt>Deviazione</dt><dd>${extraTxt(R.c)}</dd></div>
        <div><dt>Vs media</dt><dd>${nf2.format(Math.max(0, avgCost - R.c.total))} €</dd></div>
      </dl>
      <p class="reco-why">${esc(P.label.startsWith("Pieno") ? "Pieno" : P.label)}: ${nf2.format(R.c.fill)} € di carburante + ${nf2.format(R.c.road)} € di strada${R.c.toll ? ` + ${nf2.format(R.c.toll)} € di pedaggio` : ""}${R.c.time ? ` + ${nf2.format(R.c.time)} € di tempo` : ""}. ${P.back ? "Andata e ritorno da qui" : "Lungo la strada verso " + esc(P.destName)}${P.car ? ", " + esc(P.car.name) + " a " + nf1.format(100 / P.car.cons) + " km/" + qu : ", consumo medio"}.</p>
      ${others.length ? `<ul class="cmp">${others.join("")}</ul>` : ""}
      ${trend}
      <div class="sum-foot">${esc(center ? center.name : "")} · ${settings.radius} km · ${rows.length} impianti${pricedMemo.dropped ? ` · ${pricedMemo.dropped} prezz${pricedMemo.dropped === 1 ? "o anomalo escluso" : "i anomali esclusi"}` : ""}${reco.ok ? "" : " · distanze stimate"}${state.loading ? ' · <span class="spin" aria-label="Caricamento"></span>' : ""}</div>
    </div>`;
  }

  const RANK_COLORS = ["var(--c-yellow)", "var(--c-orange)", "var(--c-pink)", "var(--c-blue)", "var(--c-lilac)"];
  function cardHTML({ s, f }, min, rk, idx = 0) {
    const a = ago(s.insertDate);
    let net = "";
    if (rk) {
      const me = rk.list.find((x) => x.s.id === s.id);
      const d = me ? me.c.total - rk.best.c.total : 0;
      net = me && me.s.id === rk.best.s.id ? `<span class="net pos">consigliato</span>` : d >= 0.01 ? `<span class="net">+${nf2.format(d)} € in totale</span>` : "";
    }
    const stale = a.hours > 72;
    const diff = f.price - min;
    const fav = favs.has(String(s.id));
    const title = prettyBrand(s.brand);
    const sub = prettyAddress(s.address) || (isUsefulName(s.name) ? s.name : "Indirizzo non disponibile");
    const otherName = s.address && isUsefulName(s.name) && !/^[A-Z0-9 ,.'-]+$/.test(s.name) ? s.name : "";
    const rank = idx + 1;
    return `<article class="card st${rk && rk.best.s.id === s.id ? " best" : ""}" data-open="${esc(s.id)}" tabindex="0" aria-label="${esc(rank + ". " + title + ", " + price(f.price) + " " + unit(settings.fuel))}">
      <div class="rank" style="--rk:${(rk && rk.best.s.id === s.id) || (!rk && diff === 0) ? "var(--accent)" : RANK_COLORS[idx % RANK_COLORS.length]}" aria-hidden="true">${rank}</div>
      <div class="st-info">
        <h3>${logoHTML(s.brand)}<span class="tt">${esc(title)}${otherName ? ` <span class="muted">· ${esc(otherName)}</span>` : ""}</span></h3>
        <p class="addr">${esc(sub)}</p>
        <p class="meta">${s.distance != null ? `<span>${km(s.distance)}</span>` : ""}<span class="${diff === 0 ? "zero" : ""}">${diff === 0 ? "il migliore" : "+" + cents(diff) + " cent"}</span>
          <span class="${stale ? "stale" : ""}">${stale ? "⚠ " : ""}${esc(a.text)}</span>
          ${f.name && f.name !== FUELS[settings.fuel] ? `<span class="prod">${esc(f.name)}</span>` : ""}${net}</p>
      </div>
      <div class="st-right">
        <span class="price">${price(f.price)}</span>
        <button class="star" data-fav="${esc(s.id)}" aria-pressed="${fav}" aria-label="${fav ? "Rimuovi dai preferiti" : "Aggiungi ai preferiti"}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
        </button>
      </div>
    </article>`;
  }

  function renderList() {
    const el = $("#list");
    if (state.error === "noworker") { el.innerHTML = ""; return; }
    const rows = visible();
    const all = priced();

    if (!rows.length) {
      if (state.loading) {
        el.innerHTML = Array.from({ length: 5 }, () => `<div class="card st skeleton" aria-hidden="true"><div class="sk sk-price"></div><div class="sk-lines"><div class="sk"></div><div class="sk short"></div></div></div>`).join("") +
          `<p class="sr-only">Caricamento…</p>`;
        return;
      }
      if (state.error) {
        el.innerHTML = `<div class="card state err"><h2>Non riesco a caricare i prezzi</h2><p>${esc(state.error)}</p><button class="btn" data-retry>Riprova</button>${settings.zone === "gps" ? ' <button class="btn" data-places>Aggiungi un luogo</button>' : ""}</div>`;
        return;
      }
      if (all.length) {
        el.innerHTML = `<div class="card state"><h2>Nessun impianto con questi filtri</h2><p>Ci sono ${all.length} impianti nella zona, ma nessuno corrisponde ai filtri scelti.</p><button class="btn" data-clear>Togli i filtri</button></div>`;
        return;
      }
      const otherMode = +settings.mode === 1 ? 0 : 1;
      const otherCount = state.stations.filter((s) => s.fuels.some((f) => f.fuelId === +settings.fuel && f.isSelf === (otherMode === 1) && f.price > 0)).length;
      if (otherCount) {
        el.innerHTML = `<div class="card state"><h2>Nessun ${esc(FUELS[settings.fuel])} ${+settings.mode === 1 ? "self" : "servito"}</h2><p>Entro ${settings.radius} km ci sono ${otherCount} impianti con ${esc(FUELS[settings.fuel])} ${otherMode === 1 ? "self" : "servito"}.</p><button class="btn" data-mode="${otherMode}">Mostra ${otherMode === 1 ? "self" : "servito"}</button></div>`;
        return;
      }
      if (state.stations.length || settings.zone !== "gps" || state.gps) {
        el.innerHTML = `<div class="card state"><h2>Nessun impianto trovato</h2><p>Nessun distributore con ${esc(FUELS[settings.fuel])} ${+settings.mode === 1 ? "self" : "servito"} entro ${settings.radius} km.</p>${settings.radius < 15 ? `<button class="btn" data-wider>Allarga a ${settings.radius < 5 ? 5 : settings.radius < 10 ? 10 : 15} km</button>` : ""}</div>`;
        return;
      }
      el.innerHTML = "";
      return;
    }
    const min = Math.min(...all.map((x) => x.f.price));
    const rk = recoRanking();
    let html = rows.map((r, i) => cardHTML(r, min, rk, i)).join("");
    if (state.error && !state.fromCache) html = `<div class="card state err small"><p>${esc(state.error)}</p><button class="btn" data-retry>Riprova</button></div>` + html;
    el.innerHTML = html;
  }

  function render() {
    queueMicrotask(refineReco);
    $("#demo-badge").hidden = !DEMO;
    renderControls();
    renderNotice();
    renderSummary();
    renderList();
  }

  // ---------- Scheda dettaglio ----------
  const sheet = $("#sheet");
  let sheetReq = 0;

  function openSheet(html) {
    $("#sheet-body").innerHTML = html;
    if (!sheet.open) {
      if (typeof sheet.showModal === "function") sheet.showModal();
      else sheet.setAttribute("open", "");
      document.documentElement.classList.add("noscroll");
    }
    sheet.scrollTop = 0;
  }
  function closeSheet() {
    if (typeof sheet.close === "function" && sheet.open) sheet.close();
    else sheet.removeAttribute("open");
  }
  sheet.addEventListener("close", () => document.documentElement.classList.remove("noscroll"));
  sheet.addEventListener("click", (e) => {
    if (e.target === sheet) closeSheet(); // tocco sullo sfondo
  });

  function hoursHTML(list) {
    if (!Array.isArray(list) || !list.length) return "";
    if (list.every((o) => o.flagNonComunicato)) return `<p class="muted">Orari non comunicati dal gestore.</p>`;
    const today = ((new Date().getDay() + 6) % 7) + 1;
    const fmt = (v) => (v == null ? null : String(v).slice(0, 5));
    const rows = list.slice().sort((a, b) => a.giornoSettimanaId - b.giornoSettimanaId).map((o) => {
      let txt;
      if (o.flagH24) txt = "24 ore";
      else if (o.flagChiusura) txt = "Chiuso";
      else if (o.flagNonComunicato) txt = "Non comunicato";
      else {
        const parts = [];
        for (const key of Object.keys(o)) {
          const m = key.match(/^oraApertura(.+)$/);
          if (!m) continue;
          const open = fmt(o[key]), close = fmt(o["oraChiusura" + m[1]]);
          if (open && close) parts.push(open + "–" + close);
        }
        txt = parts.join(", ") || "Non comunicato";
      }
      const name = DAY_NAMES[o.giornoSettimanaId] || "Giorno " + o.giornoSettimanaId;
      return `<tr${o.giornoSettimanaId === today ? ' class="today"' : ""}><th>${name}</th><td>${esc(txt)}</td></tr>`;
    }).join("");
    return `<table class="hours">${rows}</table><p class="muted small">Orari indicativi, comunicati dal gestore.</p>`;
  }

  function pricesHTML(fuels, chosen) {
    // Raggruppa per prodotto: colonne Self / Servito.
    const groups = new Map();
    for (const f of fuels) {
      if (f.price == null || f.price <= 0) continue;
      const k = f.name || FUELS[f.fuelId] || "Carburante";
      if (!groups.has(k)) groups.set(k, { fuelId: +f.fuelId, self: null, served: null, date: null });
      const g = groups.get(k);
      g[f.isSelf ? "self" : "served"] = +f.price;
      const d = f.insertDate || f.validityDate;
      if (d && (!g.date || Date.parse(d) > Date.parse(g.date))) g.date = d;
    }
    const order = [2, 1, 4, 3];
    const list = [...groups.entries()].sort((a, b) => (order.indexOf(a[1].fuelId) + 1 || 9) - (order.indexOf(b[1].fuelId) + 1 || 9) || a[0].localeCompare(b[0]));
    if (!list.length) return `<p class="muted">Nessun prezzo disponibile.</p>`;
    return `<table class="prices"><thead><tr><th></th><th>Self</th><th>Servito</th></tr></thead><tbody>${list.map(([name, g]) => {
      // Evidenzio solo il prodotto mostrato in lista (es. Gasolio, non Blue Diesel).
      const sel = g.fuelId === +settings.fuel && (!chosen || name === chosen);
      const a = g.date ? ago(g.date) : null;
      return `<tr${sel ? ' class="sel"' : ""}><th>${esc(name)}${a ? `<span class="muted small${a.hours > 72 ? " stale" : ""}">${esc(a.text)}</span>` : ""}</th>
        <td${sel && +settings.mode === 1 ? ' class="hl"' : ""}>${price(g.self)}</td><td${sel && +settings.mode === 0 ? ' class="hl"' : ""}>${price(g.served)}</td></tr>`;
    }).join("")}</tbody></table>`;
  }

  // Grafico storico SVG: prezzo dell'impianto (linea piena) e media dell'area (tratteggiata).
  function chartHTML(hist, avg, key) {
    const series = (hist && hist.days ? hist.days : []).filter((d) => d.v && d.v[key] != null).map((d) => ({ d: d.d, p: d.v[key] }));
    if (series.length < 2) {
      const zones = state.meta && state.meta.zones ? state.meta.zones.map((z) => z.name).join(" e ") : "";
      return `<p class="muted">Storico non ancora disponibile per questo impianto. Si costruisce giorno per giorno${zones ? ", solo per i distributori nella zona di " + esc(zones) : ""}.</p>`;
    }
    const last = series.slice(-90);
    const from = last[0].d;
    const avgMap = {};
    if (avg && avg.days) for (const d of avg.days) if (d.v && d.v[key] && d.d >= from) avgMap[d.d] = d.v[key].avg;
    const avgPts = last.filter((x) => avgMap[x.d] != null).map((x) => ({ d: x.d, p: avgMap[x.d] }));

    const W = 340, H = 170, L = 44, R = 12, T = 14, B = 26;
    const vals = last.map((x) => x.p).concat(avgPts.map((x) => x.p));
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (hi - lo < 0.02) { const m = (hi + lo) / 2; lo = m - 0.01; hi = m + 0.01; }
    const pad = (hi - lo) * 0.12; lo -= pad; hi += pad;
    const t0 = Date.parse(last[0].d), t1 = Date.parse(last[last.length - 1].d) || t0 + 1;
    const x = (d) => L + ((Date.parse(d) - t0) / (t1 - t0 || 1)) * (W - L - R);
    const y = (p) => T + (1 - (p - lo) / (hi - lo)) * (H - T - B);
    const path = (pts) => pts.map((q, i) => (i ? "L" : "M") + x(q.d).toFixed(1) + " " + y(q.p).toFixed(1)).join(" ");
    const ticks = [lo + (hi - lo) * 0.15, (lo + hi) / 2, hi - (hi - lo) * 0.15];
    const lp = last[last.length - 1];
    const data = JSON.stringify(last.map((q) => [q.d, q.p, avgMap[q.d] ?? null]));

    return `<div class="legend"><span class="lg lg-st"></span>Questo impianto${avgPts.length ? '<span class="lg lg-avg"></span>Media area' : ""}</div>
      <div class="chart" data-series='${esc(data)}' data-l="${L}" data-r="${R}" data-w="${W}" data-t0="${t0}" data-t1="${t1}">
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Andamento del prezzo negli ultimi ${last.length} giorni: da ${price(last[0].p)} a ${price(lp.p)}">
        ${ticks.map((v) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text class="tick" x="${L - 6}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${nf3.format(v)}</text>`).join("")}
        <text class="tick" x="${L}" y="${H - 6}">${esc(shortDate(last[0].d))}</text>
        <text class="tick" x="${W - R}" y="${H - 6}" text-anchor="end">${esc(shortDate(lp.d))}</text>
        ${avgPts.length > 1 ? `<path class="ln-avg" d="${path(avgPts)}"/>` : ""}
        <path class="ln-st" d="${path(last)}"/>
        <circle class="dot-end" cx="${x(lp.d).toFixed(1)}" cy="${y(lp.p).toFixed(1)}" r="4"/>
        <g class="cross" visibility="hidden"><line y1="${T}" y2="${H - B}"/><circle r="4"/></g>
      </svg>
      <div class="tip" hidden></div>
    </div>`;
  }

  function wireChart(root) {
    const box = $(".chart", root);
    if (!box) return;
    const pts = JSON.parse(box.dataset.series);
    const svg = $("svg", box), cross = $(".cross", box), tip = $(".tip", box);
    const L = +box.dataset.l, R = +box.dataset.r, W = +box.dataset.w, t0 = +box.dataset.t0, t1 = +box.dataset.t1;
    const line = $("line", cross), dot = $("circle", cross);
    const st = $(".ln-st", svg);
    const len = st.getTotalLength ? st.getTotalLength() : 0;
    function show(ev) {
      const r = svg.getBoundingClientRect();
      const vx = ((ev.clientX - r.left) / r.width) * W;
      const t = t0 + ((vx - L) / (W - L - R)) * (t1 - t0);
      let best = pts[0];
      for (const q of pts) if (Math.abs(Date.parse(q[0]) - t) < Math.abs(Date.parse(best[0]) - t)) best = q;
      const px = L + ((Date.parse(best[0]) - t0) / (t1 - t0 || 1)) * (W - L - R);
      // y: proietta il punto sulla linea disegnata
      let py = 0;
      if (len) {
        let a = 0, b = len;
        for (let i = 0; i < 20; i++) { const m = (a + b) / 2; if (st.getPointAtLength(m).x < px) a = m; else b = m; }
        py = st.getPointAtLength((a + b) / 2).y;
      }
      line.setAttribute("x1", px); line.setAttribute("x2", px);
      dot.setAttribute("cx", px); dot.setAttribute("cy", py);
      cross.setAttribute("visibility", "visible");
      tip.hidden = false;
      tip.innerHTML = `<strong>${esc(new Date(best[0]).toLocaleDateString("it-IT", { weekday: "short", day: "numeric", month: "short" }))}</strong><br>${price(best[1])}${best[2] != null ? `<br><span class="muted">media ${price(best[2])}</span>` : ""}`;
      const left = (px / W) * r.width;
      tip.style.left = Math.min(Math.max(left, 50), r.width - 50) + "px";
    }
    function hide() { cross.setAttribute("visibility", "hidden"); tip.hidden = true; }
    svg.addEventListener("pointerdown", show);
    svg.addEventListener("pointermove", show);
    svg.addEventListener("pointerleave", hide);
  }

  function sheetHTML(s, detail, hist) {
    const fav = favs.has(String(s.id));
    const name = (detail && (detail.nomeImpianto || detail.name)) || s.name;
    const address = prettyAddress((detail && detail.address) || s.address);
    const fuels = detail && detail.fuels ? detail.fuels : s.fuels;
    const key = settings.fuel + "-" + settings.mode;
    const f = pick(s);
    const a = ago(s.insertDate);
    const services = detail && Array.isArray(detail.services) ? detail.services.map((x) => x.description).filter(Boolean) : [];
    const phone = detail && detail.phoneNumber ? String(detail.phoneNumber).trim() : "";
    const site = detail && detail.website ? String(detail.website).trim() : "";
    const email = detail && detail.email ? String(detail.email).trim() : "";
    const loadingDetail = detail === undefined;

    return `<header class="sh-head">
        <h2 id="sheet-title">${logoHTML(s.brand, "lg")}${esc(prettyBrand(s.brand))}</h2>
        ${isUsefulName(name) ? `<p class="muted">${esc(name)}</p>` : ""}
        <p class="addr">${esc(address || "Indirizzo non disponibile")}</p>
      </header>
      <div class="sh-hero">
        <div><span class="big">${price(f && f.price)}</span><span class="u">${unit(settings.fuel)}</span>
          <div class="muted">${esc(FUELS[settings.fuel])} ${+settings.mode === 1 ? "self" : "servito"}${s.distance != null ? " · " + km(s.distance) : ""}</div>
          ${carForFuel() && f ? `<div class="muted">Pieno ${esc(carForFuel().name)} (${nf1.format(carForFuel().tank).replace(",0", "")} ${+settings.fuel === 3 ? "kg" : "L"}): <strong>${nf2.format(f.price * carForFuel().tank)} €</strong></div>` : ""}
          <div class="${a.hours > 72 ? "stale" : "muted"}">${a.hours > 72 ? "⚠ Dato vecchio: " : ""}aggiornato ${esc(a.text)}</div>
        </div>
        <div class="sh-btns">
          <a class="btn primary" href="${mapsUrl(s)}" target="_blank" rel="noopener">Portami lì</a>
          <button class="btn star-btn" data-fav="${esc(s.id)}" aria-pressed="${fav}">${fav ? "★ Preferito" : "☆ Preferito"}</button>
        </div>
      </div>

      <section><h3>Prezzi</h3>${pricesHTML(fuels, f && f.name)}</section>
      <section><h3>Andamento</h3>${hist === undefined ? '<div class="sk chart-sk"></div>' : chartHTML(hist, state.average, key)}</section>
      ${loadingDetail ? '<section><div class="sk"></div><div class="sk short"></div></section>' : ""}
      ${detail === null ? '<p class="muted">Dettagli dell\'impianto non disponibili al momento.</p>' : ""}
      ${services.length ? `<section><h3>Servizi</h3><ul class="tags">${services.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></section>` : ""}
      ${phone || site || email ? `<section><h3>Contatti</h3><ul class="contacts">
          ${phone ? `<li><a href="tel:${esc(phone.replace(/[^\d+]/g, ""))}">${esc(phone)}</a></li>` : ""}
          ${site ? `<li><a href="${esc(/^https?:/i.test(site) ? site : "https://" + site)}" target="_blank" rel="noopener">${esc(site)}</a></li>` : ""}
          ${email ? `<li><a href="mailto:${esc(email)}">${esc(email)}</a></li>` : ""}</ul></section>` : ""}
      ${detail && detail.orariapertura ? `<section><h3>Orari</h3>${hoursHTML(detail.orariapertura)}</section>` : ""}
      <p class="muted small">${detail && detail.company ? esc(detail.company) + " · " : ""}Impianto MIMIT n. ${esc(s.id)}</p>`;
  }

  async function openStation(id) {
    const s = state.stations.find((x) => String(x.id) === String(id));
    if (!s) return;
    const req = ++sheetReq;
    let detail, hist;
    const draw = () => {
      if (req !== sheetReq) return;
      const top = sheet.scrollTop;
      openSheet(sheetHTML(s, detail, hist));
      sheet.scrollTop = top;
      wireChart(sheet);
    };
    draw();
    const pD = api.station(id).then((d) => { detail = d; }, () => { detail = null; }).then(draw);
    const pH = api.history(id).then((h) => { hist = h; }, () => { hist = null; }).then(draw);
    await Promise.all([pD, pH]);
  }

  // ---------- Pagine ----------
  function showView(name, html) { const el = $("#view-" + name); if (el) el.innerHTML = html; }

  // Miglior prezzo attuale per un carburante: dalla lista Prezzi se è lo stesso, altrimenti dallo storico.
  function bestPriceFor(fuel) {
    if (+settings.fuel === +fuel) {
      const rows = priced();
      if (rows.length) return Math.min(...rows.map((x) => x.f.price));
    }
    const days = state.average && state.average.days;
    const last = days && days[days.length - 1];
    const v = last && last.v && (last.v[fuel + "-1"] || last.v[fuel + "-0"]);
    return v ? v.min : null;
  }

  const CAR_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 17h14M6 17v2M18 17v2M4 13l2-6h12l2 6v4H4z"/></svg>';
  function renderAuto() {
    const u = (c) => (+c.fuel === 3 ? "kg" : "L");
    const act = activeCar();
    const others = cars.filter((c) => c !== act);
    const subOf = (c) => (c.cfg && c.cfg.engine ? c.cfg.engine : FUELS[c.fuel]);
    let hero = "";
    if (act) {
      const bp = bestPriceFor(act.fuel);
      hero = `<div class="card hero blue car-hero">
        <div class="sum-head"><span class="pill-dark">Predefinita</span>
          <button class="icon-btn boxed" data-car-edit="${esc(act.id)}" aria-label="Modifica ${esc(act.name)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4z"/></svg></button></div>
        <div class="car-name"><strong>${esc(act.name)}</strong><span>${esc(subOf(act))}${act.realKml || !act.declL100 ? "" : " · consumo stimato"}</span></div>
        <dl class="minis two">
          <div><dt>Consumo</dt><dd>${nf1.format(100 / act.cons)} km/${u(act)}</dd></div>
          <div><dt>Serbatoio</dt><dd>${nf1.format(act.tank).replace(",0", "")} ${u(act)}</dd></div>
        </dl>
        ${bp ? `<div class="mini-row"><span>Pieno oggi, al prezzo migliore</span><strong>${nf2.format(bp * act.tank)}€</strong></div>` : ""}
      </div>`;
    }
    const rowsHTML = others.map((c, i) => `<div class="card car-row">
        <span class="sq" style="--rk:${RANK_COLORS[i % RANK_COLORS.length]}" aria-hidden="true">${CAR_ICON}</span>
        <button class="car-txt-btn" data-car-edit="${esc(c.id)}" aria-label="Modifica ${esc(c.name)}"><strong>${esc(c.name)}</strong><span>${esc(FUELS[c.fuel])} · ${nf1.format(100 / c.cons)} km/${u(c)}</span></button>
        <button class="btn sm" data-car-use="${esc(c.id)}">Usa</button>
      </div>`).join("");
    showView("auto", `
      <div class="view-actions"><button class="btn primary" data-car-new><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>Aggiungi</button></div>
      ${cars.length ? "" : `<div class="card state"><h2>Ancora nessuna auto</h2><p>Aggiungila per vedere costo del pieno e risparmio netto.</p></div>`}
      ${hero}
      ${rowsHTML}
      ${act ? `<button class="linkish center" data-car-use="">Non usare un'auto predefinita</button>` : ""}`);
  }

  const payData = () => store.get("pay", {}) || {};
  function renderAltro() {
    showView("altro", `
      <section class="group">
        <label class="field"><span>Litri del pieno (senza auto)</span>
          <input id="in-liters" type="number" inputmode="numeric" min="5" max="200" step="1" value="${settings.liters}"></label>
      </section>
      <section class="group">
        <h3>Per ricevere i soldi delle spese</h3>
        <form id="pay-form" class="form" autocomplete="on">
          <label class="field"><span>Il tuo nome</span><input name="name" autocomplete="given-name" maxlength="30" value="${esc(payData().name || "")}" placeholder="Es. Gabriele"></label>
          <label class="field"><span>PayPal.me (nome utente)</span><input name="paypal" maxlength="60" value="${esc(payData().paypal || "")}" placeholder="es. gabrielerossi" autocapitalize="off" spellcheck="false"></label>
          <label class="field"><span>IBAN</span><input name="iban" maxlength="40" value="${esc(payData().iban || "")}" placeholder="IT00 X000 0000 0000 0000 0000 000" autocapitalize="characters" spellcheck="false"></label>
          <button class="btn primary" type="submit">Salva</button>
          <p class="muted small">Restano su questo telefono. Finiscono solo nei viaggi che crei tu e nei link che decidi di condividere.</p>
        </form>
      </section>
      <section class="group">
        <h3>Dati</h3>
        <p class="muted small">${DEMO ? "Modalità demo: dati finti." : "Prezzi MIMIT (IODL 2.0) · Auto EEA (CC BY 4.0) · Pedaggi Autostrade per l'Italia e ART (CC BY 4.0) · Mappe OpenStreetMap, OSRM."}
        ${state.average && state.average.updated ? `<br>Storico aggiornato ${esc(ago(state.average.updated).text)}.` : ""}</p>
        <button class="btn" id="btn-clear-cache">Svuota dati offline</button>
      </section>
      <section class="group">
        <p class="muted small">${DEMO ? '<a href="./">Esci dalla demo</a>' : '<a href="?demo=1">Modalità demo</a>'} · <a href="https://github.com/rampagab/pienofurbo" target="_blank" rel="noopener">Codice</a></p>
      </section>`);
    $("#in-liters").addEventListener("change", (e) => {
      const v = Math.round(+e.target.value);
      if (v >= 5 && v <= 200) { settings.liters = v; saveSettings(); render(); }
      else e.target.value = settings.liters;
    });
    $("#btn-clear-cache").addEventListener("click", (e) => {
      store.clearCache();
      e.target.textContent = "Fatto";
      e.target.disabled = true;
    });
  }

  // Il consumo dichiarato è ottimistico: senza un dato reale lo aumento di questa quota.
  // Ciclo WLTP (auto dal 2018 circa): +15%. Vecchio ciclo NEDC: +30%.
  const DECLARED_GAP = 0.15, DECLARED_GAP_NEDC = 0.30;
  const gapFor = (c) => (c && c.nedc ? DECLARED_GAP_NEDC : DECLARED_GAP);
  const titleCase = (t) => String(t).toLowerCase().replace(/(^|[\s\-/(])(\p{L})/gu, (m, p, c) => p + c.toUpperCase())
    .replace(/\b(Bmw|Vw|Ds|Mg|Gt|Gti|Suv|Amg|Dr|Up|Cc|Rs|Sw)\b/g, (w) => w.toUpperCase());
  const cv = (kw) => Math.round(kw * 1.36);
  function engineLabel(v) {
    const disp = v.cc ? (v.cc / 1000).toFixed(1) + " " : "";
    const years = v.y[0] === v.y[1] ? v.y[0] : v.y[0] + "–" + v.y[1];
    return `${disp}${cv(v.kw)} CV · ${FUELS[v.f]}${v.h ? " ibrida" : ""} · ${years}`;
  }
  function guessTank(v) {
    if (v.f === 3) return v.kw < 70 ? 12 : 15;     // metano, kg
    if (v.f === 4) return v.kw < 70 ? 35 : 40;     // GPL, litri utili
    return v.kw < 60 ? 40 : v.kw < 90 ? 47 : v.kw < 130 ? 55 : 65;
  }

  function openCarForm(car, target = "auto") {
    sheetReq++;
    const c = car || { name: "", fuel: +settings.fuel || 2, tank: "" };
    // Auto salvate prima di questa versione: il loro consumo era già quello reale.
    const real = c.realKml || (c.cons && !c.declL100 ? Math.round(1000 / c.cons) / 10 : "");
    const u = +c.fuel === 3 ? "kg" : "L";
    window.scrollTo(0, 0);
    showView(target, `<button class="back" data-car-cancel="${target}">‹ ${target === "viaggio" ? "Viaggio" : "Garage"}</button><h2 class="view-title">${car ? "Modifica auto" : "Nuova auto"}</h2>
      <form id="car-form" class="form" novalidate data-target="${target}" data-id="${esc(car ? car.id : "")}" data-nedc="${c.nedc ? 1 : ""}" autocomplete="off">
        <fieldset class="box cfg">
          <legend>Trova la tua auto</legend>
          <label class="field"><span>Marca</span><select name="cfgMake" disabled><option value="">Carico le marche…</option></select></label>
          <div id="cfg-model"></div>
          <div id="cfg-engines"></div>
          <p class="muted small">Auto immatricolate in Italia dal 2012. Non c'è? Compila sotto.</p>
        </fieldset>
        <label class="field"><span>Nome</span><input name="name" required maxlength="40" placeholder="Es. Panda, Golf, auto di lavoro" value="${esc(c.name)}"></label>
        <label class="field"><span>Carburante</span><select name="fuel">${[2, 1, 4, 3].map((f) => `<option value="${f}"${+c.fuel === f ? " selected" : ""}>${FUELS[f]}</option>`).join("")}</select></label>

        <fieldset class="box">
          <legend>Consumo reale <span class="tag">consigliato</span></legend>
          <label class="field"><span>km con 1 ${u}</span>
            <div class="inline"><input name="real" type="number" inputmode="decimal" step="0.1" min="3" max="100" value="${real}" placeholder="Es. 17,5"><span class="unit">km/${u}</span></div></label>
          <details class="calc"${real ? "" : " open"}>
            <summary>Calcola da un pieno all'altro</summary>
            <p class="muted small">Pieno, azzera il parziale; al pieno dopo: km e litri.</p>
            <div class="inline"><input name="ckm" type="number" inputmode="decimal" step="1" min="1" placeholder="km percorsi" aria-label="km percorsi">
              <input name="cl" type="number" inputmode="decimal" step="0.01" min="1" placeholder="litri messi" aria-label="litri messi">
              <button type="button" class="btn" data-car-calc>Calcola</button></div>
          </details>
        </fieldset>

        <fieldset class="box">
          <legend>Consumo dichiarato <span class="tag">facoltativo</span></legend>
          <div class="inline"><input name="decl" type="number" inputmode="decimal" step="0.1" min="1" max="100" value="${c.declL100 || ""}" aria-label="Consumo dichiarato">
            <select name="unit"><option value="l100">L/100 km</option><option value="kml">km/L</option></select></div>
          <p class="muted small" id="decl-note">Senza quello reale uso questo +${gapFor(c) * 100}%.</p>
        </fieldset>

        <div class="field"><span>Oppure valori tipici</span>
          <div class="preset-row"><button type="button" class="btn" data-preset="s">Piccola</button><button type="button" class="btn" data-preset="m">Media</button><button type="button" class="btn" data-preset="l">Grande / SUV</button></div></div>
        <label class="field"><span>Capienza serbatoio (${u})</span><input name="tank" type="number" inputmode="decimal" step="1" min="5" max="150" required value="${c.tank || ""}"></label>
        <p class="form-err" role="alert" hidden></p>
        <div class="preset-row"><button class="btn primary" type="submit">Salva</button><button class="btn" type="button" data-car-cancel="${target}">Annulla</button></div>
        ${car ? `<button class="btn danger wide" type="button" data-car-del="${esc(car.id)}">Elimina auto</button>` : ""}
      </form>`);
    initConfigurator($("#car-form"), c);
  }

  // Configuratore: marca › modello › motorizzazione (con filtro per carburante).
  async function initConfigurator(form, car) {
    const selMake = form.cfgMake;
    let index;
    try { index = await api.carIndex(); } catch (_) {
      selMake.innerHTML = `<option value="">Database auto non disponibile</option>`;
      return;
    }
    if (!form.isConnected) return;
    const makes = index.makes.slice().sort((a, b) => a.make.localeCompare(b.make));
    const top = index.makes.slice().sort((a, b) => b.n - a.n).slice(0, 10).map((m) => m.file);
    const opt = (m) => `<option value="${esc(m.file)}">${esc(titleCase(m.make))}</option>`;
    selMake.innerHTML = `<option value="">Scegli la marca</option>
      <optgroup label="Più diffuse">${makes.filter((m) => top.includes(m.file)).map(opt).join("")}</optgroup>
      <optgroup label="Tutte">${makes.map(opt).join("")}</optgroup>`;
    selMake.disabled = false;
    if (car && car.cfg) selMake.value = car.cfg.make;

    let data = null, models = [], fuelFilter = 0;
    const modelBox = $("#cfg-model", form), engBox = $("#cfg-engines", form);

    function renderEngines() {
      const m = models.find((x) => x.m === form.cfgModel.value);
      if (!m) { engBox.innerHTML = ""; return; }
      const fuels = [...new Set(m.v.map((v) => v.f))].sort((a, b) => [2, 1, 4, 3].indexOf(a) - [2, 1, 4, 3].indexOf(b));
      if (fuelFilter && !fuels.includes(fuelFilter)) fuelFilter = 0;
      const list = m.v.filter((v) => !fuelFilter || v.f === fuelFilter).slice().sort((a, b) => a.f - b.f || b.n - a.n);
      engBox.innerHTML = `<div class="field"><span>Motorizzazione</span>
        ${fuels.length > 1 ? `<div class="chips fuel-chips" role="radiogroup" aria-label="Carburante">
          <button type="button" role="radio" aria-checked="${!fuelFilter}" data-cfg-fuel="0">Tutte</button>
          ${fuels.map((f) => `<button type="button" role="radio" aria-checked="${fuelFilter === f}" data-cfg-fuel="${f}">${FUELS[f]}</button>`).join("")}</div>` : ""}
        <ul class="results engines">${list.map((v) => `<li><button type="button" data-cfg-engine="${m.v.indexOf(v)}">
          <strong>${esc(engineLabel(v))}</strong>
          <span class="muted small">${nf1.format(v.l)} ${v.f === 3 ? "kg" : "L"}/100 km dichiarati (${v.nedc ? "NEDC" : "WLTP"}) · ${v.n.toLocaleString("it-IT")} immatricolate</span>
        </button></li>`).join("")}</ul></div>`;
    }

    async function loadMake() {
      modelBox.innerHTML = ""; engBox.innerHTML = "";
      if (!selMake.value) return;
      modelBox.innerHTML = `<p class="muted small">Carico i modelli…</p>`;
      try { data = await api.carMake(selMake.value); } catch (_) { modelBox.innerHTML = `<p class="muted small">Modelli non disponibili.</p>`; return; }
      models = data.models;
      const popular = models.slice().sort((a, b) => b.n - a.n).slice(0, 8);
      const o = (m) => `<option value="${esc(m.m)}">${esc(titleCase(m.m))}</option>`;
      modelBox.innerHTML = `<label class="field"><span>Modello</span><select name="cfgModel"><option value="">Scegli il modello</option>
        ${models.length > 12 ? `<optgroup label="Più diffusi">${popular.map(o).join("")}</optgroup><optgroup label="Tutti">` : ""}${models.map(o).join("")}${models.length > 12 ? "</optgroup>" : ""}</select></label>`;
      form.cfgModel.addEventListener("change", () => { fuelFilter = 0; renderEngines(); });
      if (car && car.cfg && car.cfg.make === selMake.value) { form.cfgModel.value = car.cfg.model; renderEngines(); }
    }
    selMake.addEventListener("change", loadMake);
    if (selMake.value) loadMake();

    form.addEventListener("click", (e) => {
      const fb = e.target.closest("[data-cfg-fuel]");
      if (fb) { fuelFilter = +fb.dataset.cfgFuel; renderEngines(); return; }
      const eb = e.target.closest("[data-cfg-engine]");
      if (!eb) return;
      const m = models.find((x) => x.m === form.cfgModel.value);
      const v = m.v[+eb.dataset.cfgEngine];
      const makeName = titleCase(data.make);
      form.name.value = `${makeName} ${titleCase(m.m)} ${v.cc ? (v.cc / 1000).toFixed(1) + " " : ""}${cv(v.kw)} CV`.slice(0, 40);
      form.fuel.value = String(v.f);
      form.decl.value = v.l; form.unit.value = "l100";
      if (!form.tank.value) form.tank.value = guessTank(v);
      form.dataset.nedc = v.nedc ? "1" : "";
      form.dataset.cfg = JSON.stringify({ make: selMake.value, model: m.m, engine: engineLabel(v) });
      const note = $("#decl-note", form);
      if (note) note.textContent = `Dato ${v.nedc ? "NEDC" : "WLTP"}. Senza quello reale uso questo +${(v.nedc ? DECLARED_GAP_NEDC : DECLARED_GAP) * 100}%.`;
      $$("[data-cfg-engine]", form).forEach((b) => b.classList.toggle("on", b === eb));
      const real = form.real;
      (real.value ? form.tank : real).scrollIntoView({ block: "center", behavior: "smooth" });
      real.focus({ preventScroll: true });
    });
  }

  const num = (v) => parseFloat(String(v == null ? "" : v).replace(",", "."));

  function saveCarForm(form) {
    const fd = new FormData(form);
    const fuel = +fd.get("fuel");
    const realKml = num(fd.get("real"));
    let declL100 = num(fd.get("decl"));
    if (fd.get("unit") === "kml" && declL100 > 0) declL100 = 100 / declL100;
    const tank = num(fd.get("tank"));
    const name = String(fd.get("name") || "").trim();
    const err = $(".form-err", form);
    const hasReal = realKml >= 3 && realKml <= 100;
    const hasDecl = declL100 >= 1 && declL100 <= 30;
    let msg = "";
    if (!name) msg = "Scrivi un nome.";
    else if (fd.get("real") && !hasReal) msg = "Il consumo reale deve essere tra 3 e 100 km/L.";
    else if (fd.get("decl") && !hasDecl) msg = "Il consumo dichiarato deve essere tra 1 e 30 L/100 km (tra 3,3 e 100 km/L).";
    else if (!hasReal && !hasDecl) msg = "Inserisci il consumo reale (oppure quello dichiarato).";
    else if (!(tank >= 5 && tank <= 150)) msg = "Il serbatoio deve essere tra 5 e 150.";
    // 3 km/L per un diesel è quasi certamente un consumo scritto in L/100 km.
    if (!msg && hasReal && fuel !== 3 && realKml < 8 && form.dataset.lowOk !== String(realKml)) {
      form.dataset.lowOk = String(realKml);
      msg = `${nf1.format(realKml)} km/L è molto basso: forse hai scritto i litri per 100 km? Sarebbero ${nf1.format(100 / realKml)} km/L. Se è giusto così, premi di nuovo Salva.`;
    }
    if (msg) { err.hidden = false; err.textContent = msg; return; }
    const nedc = form.dataset.nedc === "1";
    const cons = hasReal ? 100 / realKml : declL100 * (1 + (nedc ? DECLARED_GAP_NEDC : DECLARED_GAP));
    const prev = cars.find((x) => x.id === form.dataset.id);
    let cfg = prev && prev.cfg;
    try { if (form.dataset.cfg) cfg = JSON.parse(form.dataset.cfg); } catch (_) { /* ignora */ }
    const id = form.dataset.id || "c" + Date.now().toString(36);
    const car = {
      id, name, fuel,
      cons: Math.round(cons * 100) / 100,              // L/100 km usato nei calcoli
      realKml: hasReal ? Math.round(realKml * 10) / 10 : null,
      declL100: hasDecl ? Math.round(declL100 * 100) / 100 : null,
      tank: Math.round(tank * 10) / 10,
      nedc: nedc || undefined,
      cfg: cfg || undefined,
    };
    const i = cars.findIndex((x) => x.id === id);
    if (i >= 0) cars[i] = car; else cars.push(car);
    window.scrollTo(0, 0);
    if (form.dataset.target === "viaggio") {
      // Auto creata dal Viaggio: entra nel garage e viene scelta per questo viaggio.
      if (!activeCarId) { activeCarId = id; saveCars(); }
      trip.carId = id; trip.priceInfo = null; trip.priceEdited = false; trip.price = "";
      openTrip();
      return;
    }
    useCar(id);
    renderAuto();
  }

  function useCar(id) {
    activeCarId = id;
    saveCars();
    const c = activeCar();
    if (c && +settings.fuel !== +c.fuel) {
      settings.fuel = +c.fuel;
      if (c.fuel === 3 || c.fuel === 4) settings.mode = 0;
      settings.brand = "";
      saveSettings();
      load();
    } else render();
  }

  // ---------- Viaggio ----------
  // Autostrade senza pedaggio (non entrano nella stima).
  const FREE_MOTORWAYS = new Set(["A2", "A19", "A29", "A90", "A91"]);
  const DEFAULT_TOLL_RATE = 0.082;
  const FALLBACK_PRICE = { 1: 1.95, 2: 2.0, 3: 1.5, 4: 0.8 };
  const tripPrefs = Object.assign({ roundTrip: false, cons: 6.5, people: ["Io"] }, store.get("trip", {}));
  if (!Array.isArray(tripPrefs.people) || !tripPrefs.people.length) tripPrefs.people = ["Io"];
  const saveTripPrefs = () => store.set("trip", tripPrefs);
  const trip = {
    from: { gps: true }, to: null, res: null, tollReal: "",
    carId: null,              // auto scelta per il viaggio (di default quella attiva)
    price: "", priceEdited: false, priceInfo: null,
    suggest: { from: [], to: [] }, groupId: null,
  };
  const LOAD_PER_PERSON = 0.02;
  const CAN_CONTACTS = "contacts" in navigator && "ContactsManager" in window;

  function tripCar() {
    if (trip.carId === null) trip.carId = activeCarId || "";
    return cars.find((c) => c.id === trip.carId) || null;
  }
  function tripFuel() { const c = tripCar(); return c ? +c.fuel : +(trip.fuel || settings.fuel); }
  function getPosition() {
    if (state.gps) return Promise.resolve(state.gps);
    return new Promise((ok, ko) => {
      if (!navigator.geolocation) return ko(new Error("Posizione non disponibile su questo dispositivo"));
      navigator.geolocation.getCurrentPosition(
        (p) => { state.gps = { lat: p.coords.latitude, lng: p.coords.longitude, name: "La tua posizione" }; ok(state.gps); },
        () => ko(new Error("Posizione non disponibile: scrivi un indirizzo di partenza")),
        { timeout: 12000, maximumAge: 120000 });
    });
  }
  const fromPoint = async () => (trip.from && trip.from.gps ? getPosition() : trip.from);

  // Prezzo proposto: media attuale dei distributori entro 10 km dalla partenza.
  const priceCache = {};
  async function refreshTripPrice() {
    const fuel = tripFuel();
    let pt;
    try { pt = await fromPoint(); } catch (_) { pt = null; }
    if (!pt) return;
    const key = `${pt.lat.toFixed(2)},${pt.lng.toFixed(2)},${fuel}`;
    try {
      if (!priceCache[key]) priceCache[key] = api.search({ lat: pt.lat, lng: pt.lng, radius: 10, fuel });
      const stations = await priceCache[key];
      const want = fuel === 3 || fuel === 4 ? [false, true] : [true, false];
      let prices = [];
      for (const self of want) {
        prices = stations.map((s) => s.fuels.filter((f) => f.fuelId === fuel && f.isSelf === self && f.price > 0).map((f) => f.price))
          .filter((a) => a.length).map((a) => Math.min(...a));
        if (prices.length) { trip.priceInfo = { n: prices.length, self }; break; }
      }
      if (!prices.length) return;
      const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
      trip.priceInfo.avg = avg;
      if (!trip.priceEdited) trip.price = avg.toFixed(3);
      updatePriceUI(); // solo il campo prezzo: non ridisegno il modulo mentre si scrive
    } catch (_) { delete priceCache[key]; }
  }

  function priceHint() {
    const pi = trip.priceInfo;
    return pi && pi.avg ? `Media attuale di ${pi.n} distributori vicino alla partenza${pi.self ? "" : " (servito)"}${trip.priceEdited ? ` · <button type="button" class="linkish" data-price-reset>usa ${nf3.format(pi.avg)}</button>` : ""}` : "Calcolo la media attuale…";
  }
  function updatePriceUI() {
    const input = $("[data-trip-price]");
    if (!input) return;
    if (!trip.priceEdited) input.value = trip.price;
    const hint = input.nextElementSibling;
    if (hint) hint.innerHTML = priceHint();
  }

  function readTripForm() {
    const f = $("#trip-form");
    if (!f) return;
    tripPrefs.roundTrip = f.round.checked;
    if (f.cons) { const c = num(f.cons.value); if (c >= 1 && c <= 30) tripPrefs.cons = c; }
    trip.price = f.price.value;
    saveTripPrefs();
  }

  function tripResultHTML() {
    const r = trip.res;
    if (!r) return "";
    const car = tripCar();
    const people0 = tripPrefs.people.length;
    // Più persone a bordo, più peso: circa +2% di consumo per ogni passeggero (stima prudente).
    const load = LOAD_PER_PERSON * Math.max(0, people0 - 1);
    const cons = (car ? car.cons : tripPrefs.cons) * (1 + load);
    const mult = tripPrefs.roundTrip ? 2 : 1;
    const priceL = num(trip.price) || (trip.priceInfo && trip.priceInfo.avg) || FALLBACK_PRICE[tripFuel()];
    const kmTot = r.km * mult, minTot = r.min * mult;
    const liters = kmTot * cons / 100;
    const fuelCost = liters * priceL;
    const legs = Object.entries(r.byRef || {}).map(([ref, km]) => {
      const rate = (trip.tolls && trip.tolls.refs[ref] ? trip.tolls.refs[ref].rate : (trip.tolls && trip.tolls.default_rate) || DEFAULT_TOLL_RATE);
      return { ref, km: km * mult, eur: km * mult * rate };
    });
    // Come al casello: importo arrotondato ai 10 centesimi (per ogni viaggio di andata e di ritorno).
    const oneWay = legs.reduce((a, l) => a + l.eur, 0) / mult;
    const tollEst = Math.round(oneWay * 10) / 10 * mult;
    const real = parseFloat(String(trip.tollReal).replace(",", "."));
    const toll = real >= 0 ? real : tollEst;
    const total = fuelCost + toll;
    const people = tripPrefs.people.length;
    trip.last = { fuel: fuelCost, toll, total, to: trip.to.name, from: trip.from.gps ? "" : trip.from.name, round: tripPrefs.roundTrip };
    const u = tripFuel() === 3 ? "kg" : "L";
    const h = Math.floor(minTot / 60), m = Math.round(minTot % 60);
    const from = trip.fromPoint, to = trip.to;
    const maps = isIOS
      ? `https://maps.apple.com/?saddr=${from.lat},${from.lng}&daddr=${to.lat},${to.lng}&dirflg=d`
      : `https://www.google.com/maps/dir/?api=1&origin=${from.lat},${from.lng}&destination=${to.lat},${to.lng}&travelmode=driving`;
    const g = trip.groupId && groups.find((x) => x.id === trip.groupId);
    const each = people > 1;
    return `<div class="card trip-res hero">
      <div class="sum-head"><span class="pill-dark">${tripPrefs.roundTrip ? "Andata e ritorno" : "Solo andata"}</span><span class="sum-fuel">${esc(to.name)}</span></div>
      <span class="res-label">${each ? `A testa · ${people} persone` : "Totale"}</span>
      <span class="big">${nf2.format(each ? total / people : total)}€</span>
      ${each ? `<span class="res-sub">Totale ${nf2.format(total)} €</span>` : ""}
      <dl class="res-grid">
        <div><dt>Distanza</dt><dd>${nf1.format(kmTot).replace(/,\d$/, "")} km</dd></div>
        <div><dt>Carburante</dt><dd>${nf2.format(fuelCost)}€</dd></div>
        <div><dt>Pedaggi${real >= 0 ? "" : "*"}</dt><dd>${nf2.format(toll)}€</dd></div>
      </dl>
      <p class="res-note">${h ? h + " h " : ""}${m} min di guida · ${nf1.format(liters)} ${u} di ${esc(FUELS[tripFuel()]).toLowerCase()}${load ? ` · consumo +${Math.round(load * 100)}% per ${people0} a bordo` : ""}</p>
    </div>
    <div class="card pad trip-more">
      ${legs.length ? `<ul class="tolls">${legs.map((l) => `<li><span>${esc(l.ref)}</span><span>${nf1.format(l.km)} km</span><span>${nf2.format(l.eur)} €</span></li>`).join("")}</ul>
        <p class="muted small">* Stima con le tariffe ufficiali di ogni autostrada: il casello può differire.</p>` : `<p class="muted small">Nessuna autostrada a pagamento.</p>`}
      <label class="field"><span>Pedaggi reali${tripPrefs.roundTrip ? " (A/R)" : ""}</span>
        <input id="toll-real" type="number" inputmode="decimal" step="0.1" min="0" value="${esc(trip.tollReal)}" placeholder="${nf2.format(tollEst).replace(",", ".")}"></label>
      <div class="preset-row">
        ${g ? `<button type="button" class="btn primary" data-sp-goto="${esc(g.id)}">Apri in Spese</button>`
            : `<button type="button" class="btn primary" data-trip-group>${people > 1 ? "Crea viaggio e dividi" : "Salva in Spese"}</button>`}
        <a class="btn" href="${maps}" target="_blank" rel="noopener">Apri in Mappe</a></div>
    </div>`;
  }

  // Partenza e arrivo in un'unica card, con suggerimenti mentre si scrive.
  function placeRowHTML(which) {
    const val = trip[which];
    const label = which === "from" ? "Da" : "A";
    const full = which === "from" ? "Partenza" : "Arrivo";
    const body = val
      ? `<span class="rv">${val.gps ? "La mia posizione" : esc(val.name)}</span><button type="button" class="icon-btn" data-pf-clear="${which}" aria-label="Cambia ${full.toLowerCase()}">✕</button>`
      : `<input class="pf-input" data-pf-input="${which}" type="search" placeholder="${which === "from" ? "Da dove parti?" : "Dove vai?"}" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="search" aria-label="${full}">`;
    return `<div class="route-row"><span class="dot ${which}" aria-hidden="true"></span><span class="rl">${label}</span>${body}</div>`;
  }
  function routeHTML() {
    const empty = !trip.from ? "from" : !trip.to ? "to" : null;
    const quick = empty ? (empty === "from" ? [`<button type="button" class="chip-q" data-pf-gps>La mia posizione</button>`] : [])
      .concat(places.map((p) => `<button type="button" class="chip-q" data-pf-place="${empty}:${esc(p.id)}">${esc(p.name)}</button>`)) : [];
    return `<div class="field"><span class="sr-only">Percorso</span>
      <div class="route">${placeRowHTML("from")}${placeRowHTML("to")}</div>
      <ul class="results pf-list" id="pf-list-from"></ul><ul class="results pf-list" id="pf-list-to"></ul>
      ${quick.length ? `<div class="quick">${quick.join("")}</div>` : ""}</div>`;
  }

  const PERSON_COLORS = ["var(--c-yellow)", "var(--c-orange)", "var(--c-lilac)", "var(--c-blue)", "var(--c-pink)", "var(--accent)"];
  function peopleHTML() {
    const ps = tripPrefs.people;
    const known = [...new Set(groups.flatMap((g) => g.people.map((p) => p.name)))].filter((n) => !ps.includes(n) && !/^Persona \d+$/.test(n)).slice(0, 8);
    return `<div class="people">${ps.map((n, i) => `<span class="person" style="--pc:${PERSON_COLORS[i % PERSON_COLORS.length]}"><button type="button" class="pname" data-pp-rename="${i}" aria-label="Rinomina ${esc(n)}">${esc(n)}</button>${ps.length > 1 ? `<button type="button" class="px" data-pp-del="${i}" aria-label="Togli ${esc(n)}">✕</button>` : ""}</span>`).join("")}
        <label class="chip-toggle"><input type="checkbox" name="round"${tripPrefs.roundTrip ? " checked" : ""}> A/R</label></div>
      <div class="inline pp-add">
        <input name="pname" placeholder="Aggiungi un nome" autocomplete="off" enterkeyhint="done" aria-label="Aggiungi un nome">
        <button type="button" class="btn" data-pp-add>Aggiungi</button>
      </div>
      ${known.length || CAN_CONTACTS ? `<div class="quick">${CAN_CONTACTS ? `<button type="button" class="chip-q" data-pp-contacts>Dalla rubrica</button>` : ""}${known.map((n) => `<button type="button" class="chip-q" data-pp-known="${esc(n)}">+ ${esc(n)}</button>`).join("")}</div>` : ""}`;
  }

  function tripHTML() {
    const car = tripCar();
    const fuel = tripFuel();
    const u = fuel === 3 ? "kg" : "L";
    const ps = tripPrefs.people;
    return `<form id="trip-form" class="form" autocomplete="off">
        ${routeHTML()}
        <div class="trip-row">
          <label class="car-box"><span class="ico" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 17h14M4 13l2-6h12l2 6v4H4z"/></svg></span>
            <span class="car-txt"><span class="sr-only">Auto</span><select name="car" data-trip-car aria-label="Auto">
              ${cars.map((c) => `<option value="${esc(c.id)}"${car && car.id === c.id ? " selected" : ""}>${esc(c.name)}</option>`).join("")}
              <option value=""${car ? "" : " selected"}>Altra auto (consumo a mano)</option>
              <option value="__new">+ Nuova auto…</option></select>
            <span class="car-sub">${car ? `${nf1.format(100 / car.cons)} km/${u} · ${esc(FUELS[car.fuel])}` : "Anche l'auto di un amico"}</span></span></label>
          <div class="stepper" role="group" aria-label="Persone">
            <button type="button" data-pp-step="-1" aria-label="Una persona in meno">−</button>
            <span class="sv"><output>${ps.length}</output><small>${ps.length === 1 ? "persona" : "persone"}</small></span>
            <button type="button" data-pp-step="1" aria-label="Una persona in più">+</button></div>
        </div>
        ${peopleHTML()}
        ${car ? "" : `<div class="field"><span>Consumo e carburante</span><div class="inline"><input name="cons" type="number" inputmode="decimal" step="0.1" min="1" max="30" value="${tripPrefs.cons}" aria-label="Consumo"><span class="unit">${u}/100 km</span>
          <select name="tfuel" data-trip-fuel aria-label="Carburante">${[2, 1, 4, 3].map((f) => `<option value="${f}"${fuel === f ? " selected" : ""}>${FUELS[f]}</option>`).join("")}</select></div></div>`}
        <label class="field"><span>Prezzo ${esc(FUELS[fuel]).toLowerCase()} (€/${u})</span>
          <input name="price" type="number" inputmode="decimal" step="0.001" min="0.3" max="5" value="${esc(trip.price)}" placeholder="${FALLBACK_PRICE[fuel].toFixed(3)}" data-trip-price>
          <small class="muted">${priceHint()}</small></label>
        <p class="form-err" role="alert" hidden></p>
        <button class="btn primary big-btn" type="submit">Calcola</button>
      </form>
      <div id="trip-out" class="trip-out" aria-live="polite">${tripResultHTML()}</div>
      <div id="along">${trip.res ? alongHTML() : ""}</div>`;
  }

  function openTrip(keepScroll) {
    const y = window.scrollY;
    showView("viaggio", tripHTML());
    if (keepScroll) window.scrollTo(0, y);
    const real = $("#toll-real");
    if (real) real.addEventListener("change", (e) => { trip.tollReal = e.target.value; readTripForm(); openTrip(true); });
    if (!trip.priceInfo) refreshTripPrice();
  }

  // Suggerimenti: Photon (OpenStreetMap), fatto per la ricerca mentre si scrive.
  let suggestTimer = 0, suggestCtl = null;
  function onPlaceInput(input) {
    const which = input.dataset.pfInput;
    const q = input.value.trim();
    clearTimeout(suggestTimer);
    const list = $("#pf-list-" + which);
    if (q.length < 3) { trip.suggest[which] = []; list.innerHTML = ""; return; }
    suggestTimer = setTimeout(async () => {
      if (suggestCtl) suggestCtl.abort();
      const ctl = suggestCtl = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; ctl.abort(); }, 6000);
      const near = state.gps || (trip.from && !trip.from.gps ? trip.from : null);
      try {
        const res = await api.suggest(q, near, ctl.signal).finally(() => clearTimeout(timer));
        if (input.value.trim() !== q) return;
        trip.suggest[which] = res;
        list.innerHTML = res.length
          ? res.map((r, i) => `<li><button type="button" data-pf-pick="${which}:${i}"><strong>${esc(r.name)}</strong><span class="muted small">${esc(r.detail || "")}</span></button></li>`).join("")
          : `<li class="muted small pf-empty">Nessun risultato</li>`;
      } catch (e) {
        // Photon non risponde (limite d'uso o rete): propongo la ricerca classica su invio.
        if (e.name !== "AbortError" || timedOut) list.innerHTML = `<li><button type="button" data-pf-search="${which}"><strong>Cerca «${esc(q)}»</strong><span class="muted small">Suggerimenti non disponibili ora</span></button></li>`;
      }
    }, 280);
  }

  async function placeSearchFallback(which) {
    const input = $(`[data-pf-input=${which}]`);
    const list = $("#pf-list-" + which);
    const q = input ? input.value.trim() : "";
    if (q.length < 2) return;
    list.innerHTML = `<li class="muted small pf-empty">Cerco…</li>`;
    try {
      const res = await api.geocode(q);
      trip.suggest[which] = res;
      list.innerHTML = res.length
        ? res.map((r, i) => `<li><button type="button" data-pf-pick="${which}:${i}"><strong>${esc(r.name)}</strong><span class="muted small">${esc(r.detail || "")}</span></button></li>`).join("")
        : `<li class="muted small pf-empty">Nessun risultato</li>`;
    } catch (_) { list.innerHTML = `<li class="muted small pf-empty">Ricerca non riuscita: controlla la connessione</li>`; }
  }

  function setTripPlace(which, val) {
    readTripForm();
    trip[which] = val;
    trip.suggest[which] = [];
    trip.res = null; trip.groupId = null; trip.tollReal = "";
    if (which === "from") { trip.priceInfo = null; }
    openTrip(true);
    if (which === "from" && val) refreshTripPrice();
    if (which === "from" && val && !trip.to) { const i = $("[data-pf-input=to]"); if (i) i.focus(); }
  }

  // ---------- Dove fare il pieno lungo il percorso ----------
  // 1) tracciato OSRM; 2) corridoio di ±1,5 km diviso in tratti; 3) per ogni tratto i distributori
  // dentro il poligono (API MIMIT tramite Worker); 4) aree di servizio delle autostrade percorse;
  // 5) classifica per costo: pieno + carburante della deviazione (+ tempo, se ha un valore).
  const CORRIDOR_KM = 1.5, CHUNK_KM = 25;

  const resample = resampleKm;
  const corridorPolys = (pts) => corridorOf(pts, CORRIDOR_KM, CHUNK_KM);
  async function pool(items, n, fn) {
    const out = [];
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) { const k = i++; out[k] = await fn(items[k]).catch(() => null); }
    }));
    return out;
  }

  async function loadAlong(from, to) {
    const key = `${from.lat},${from.lng}>${to.lat},${to.lng}|${tripFuel()}`;
    trip.along = { key, status: "loading" };
    updateAlong();
    try {
      const raw = await api.routeGeo(from, to);
      const pts = resample(raw, 1);
      const fuel = tripFuel();
      const polys = corridorPolys(pts);
      const chunks = await pool(polys, 4, (poly) => api.polygon(poly, fuel));
      const byId = new Map();
      for (const list of chunks) for (const st of list || []) byId.set(st.id, st);
      // Aree di servizio sulle autostrade del percorso (raggiungibili senza uscire).
      const refs = [...new Set(pts.filter((p) => p.mw).map((p) => p.ref))];
      const hwIds = new Set();
      if (refs.length) {
        const all = await api.highways();
        const ids = all.map((h) => h.id).filter((id) => id.split("-")[0].split("/").some((r) => refs.includes(r))).slice(0, 10);
        const lists = await pool(ids, 3, (id) => api.highway(id));
        for (const list of lists) for (const st of list || []) { hwIds.add(st.id); if (!byId.has(st.id)) byId.set(st.id, st); }
      }
      if (trip.along.key !== key) return;
      trip.along = { key, status: "ok", stations: [...byId.values()], pts, hwIds, totalKm: pts[pts.length - 1].km };
    } catch (e) {
      if (trip.along.key === key) trip.along = { key, status: "err", msg: e.message || String(e) };
    }
    updateAlong();
  }

  function alongRanking() {
    const A = trip.along;
    if (!A || A.status !== "ok") return null;
    const fuel = tripFuel();
    const car = tripCar();
    const cons = car ? car.cons : tripPrefs.cons;
    const liters = car ? car.tank : settings.liters;
    const tv = +settings.timeValue || 0;
    const selfFirst = !(fuel === 3 || fuel === 4);
    const list = [];
    for (const self of selfFirst ? [true, false] : [false, true]) {
      const range = plausibleRange(A.stations, fuel, self);
      for (const s of A.stations) {
        const f = pickFrom(s, fuel, self, range);
        if (!f || list.some((x) => x.s.id === s.id)) continue;
        const pr = projectOn(A.pts, s);
        const isHw = A.hwIds.has(s.id);
        let km, min;
        if (isHw) {
          if (!pr.mw || pr.off > 1.5) continue;      // area di servizio di un'autostrada che non percorri lì
          km = 0; min = 4;
        } else {
          if (pr.mw && pr.off > 0.3) continue;       // sei in autostrada: per arrivarci dovresti uscire
          if (pr.off > CORRIDOR_KM + 0.3) continue;
          km = 2 * pr.off * ROAD_FACTOR; min = km / 40 * 60 + 3;
        }
        const total = f.price * liters + km * cons / 100 * f.price + min / 60 * tv;
        list.push({ s, f, self, km, min, along: pr.along, hw: isHw, ref: pr.ref, total });
      }
      if (list.length >= 3) break;                   // c'è il self: il servito non serve
    }
    list.sort((a, b) => a.total - b.total);
    return { list, liters, best: list[0] };
  }

  function alongHTML() {
    const A = trip.along;
    if (!A) return "";
    if (A.status === "loading") return `<div class="card pad along"><h3>Dove fare il pieno lungo la strada</h3><p class="muted"><span class="spin"></span> Cerco i distributori lungo il percorso…</p></div>`;
    if (A.status === "err") return `<div class="card pad along"><h3>Dove fare il pieno lungo la strada</h3><p class="muted">Non disponibile ora: ${esc(A.msg)}</p></div>`;
    const R = alongRanking();
    if (!R || !R.list.length) return `<div class="card pad along"><h3>Dove fare il pieno lungo la strada</h3><p class="muted">Nessun distributore trovato vicino al percorso.</p></div>`;
    const u = tripFuel() === 3 ? "kg" : "L";
    const cheapest = R.list.reduce((a, x) => (x.f.price < a.f.price ? x : a), R.list[0]);
    const rows = R.list.slice(0, 6).map((x, i) => {
      const d = x.total - R.best.total;
      return `<li>
        <span class="rank" style="--rk:${i ? RANK_COLORS[(i - 1) % RANK_COLORS.length] : "var(--accent)"}" aria-hidden="true">${i + 1}</span>
        <span class="al-info"><strong>${logoHTML(x.s.brand)}${esc(prettyBrand(x.s.brand))}</strong>
          <small>km ${Math.round(x.along)} · ${x.hw ? `area di servizio${x.ref ? " " + esc(x.ref) : ""}` : x.km < 0.1 ? "sulla strada" : `${nf1.format(x.km / 2 / ROAD_FACTOR)} km dalla strada`}${x.self ? "" : " · servito"}${i ? ` · +${nf2.format(d)} €` : ""}</small></span>
        <span class="al-price">${price(x.f.price)}</span>
        <a class="round-go sm" href="${mapsUrl(x.s)}" target="_blank" rel="noopener" aria-label="Portami a ${esc(prettyBrand(x.s.brand))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7M9 7h8v8"/></svg></a>
      </li>`;
    }).join("");
    return `<div class="card pad along">
      <h3>Dove fare il pieno lungo la strada</h3>
      <p class="muted small">Pieno da ${nf1.format(R.liters).replace(",0", "")} ${u}, compresa la strada per arrivarci. ${R.list.length} distributori su ${Math.round(A.totalKm)} km${A.hwIds.size ? ", aree di servizio comprese" : ""}.</p>
      <ol class="along-list">${rows}</ol>
      ${(() => {
        const hw = R.list.find((x) => x.hw);
        if (!hw || R.list.indexOf(hw) < 6) return "";
        return `<p class="muted small">Senza uscire dall'autostrada: ${esc(prettyBrand(hw.s.brand))} ${esc(hw.s.name || "")}${hw.ref ? " (" + esc(hw.ref) + ")" : ""}, km ${Math.round(hw.along)}, ${price(hw.f.price)}: +${nf2.format(hw.total - R.best.total)} € rispetto al consigliato.</p>`;
      })()}
      ${cheapest !== R.best ? `<p class="muted small">Il prezzo più basso (${price(cheapest.f.price)}, km ${Math.round(cheapest.along)}) ti costerebbe ${nf2.format(cheapest.total - R.best.total)} € in più contando la deviazione.</p>` : ""}
      <p class="muted small">In autostrada contano solo le aree di servizio: per gli altri distributori dovresti uscire.</p>
    </div>`;
  }
  function updateAlong() {
    const el = $("#along");
    if (el) el.innerHTML = alongHTML();
  }

  function tripCreateGroup() {
    const l = trip.last;
    if (!l) return;
    const pay = store.get("pay", {}) || {};
    const people = tripPrefs.people.map((n, i) => ({ id: uid("p"), name: i === 0 && n === "Io" && pay.name ? pay.name : n }));
    const all = people.map((p) => p.id);
    const now = new Date().toISOString();
    const g = { id: uid("g"), name: ((l.from ? l.from + " → " : "") + l.to + (l.round ? " (A/R)" : "")).slice(0, 40), people, expenses: [], me: people[0].id };
    if (pay.paypal || pay.iban) g.pay = { to: people[0].id, paypal: pay.paypal || "", iban: pay.iban || "", holder: pay.name || "" };
    if (l.fuel > 0) g.expenses.push({ id: uid("e"), desc: "Carburante", amount: Math.round(l.fuel * 100) / 100, payer: people[0].id, split: all, date: now });
    if (l.toll > 0) g.expenses.push({ id: uid("e"), desc: "Pedaggi", amount: Math.round(l.toll * 100) / 100, payer: people[0].id, split: all, date: now });
    groups.unshift(g); saveGroups();
    trip.groupId = g.id;
    spese.open = g.id; spese.adding = false; spese.pending = null;
    go("spese");
  }

  async function tripCalc(form) {
    readTripForm();
    const err = $(".form-err", form);
    const fail = (m) => { err.hidden = false; err.textContent = m; };
    if (!trip.from) return fail("Scegli la partenza.");
    if (!trip.to) return fail("Scegli l'arrivo.");
    let from;
    try { from = await fromPoint(); } catch (e) { return fail(e.message); }
    const btn = $("button[type=submit]", form);
    btn.disabled = true; btn.textContent = "Calcolo…";
    try {
      [trip.res, trip.tolls] = await Promise.all([api.route(from, trip.to), api.tolls()]);
      trip.fromPoint = { lat: from.lat, lng: from.lng };
      trip.groupId = null;
      openTrip(true);
      loadAlong(trip.fromPoint, trip.to);
      const out = $("#trip-out");
      if (out) out.scrollIntoView({ block: "start", behavior: "smooth" });
    } catch (e) {
      btn.disabled = false; btn.textContent = "Calcola";
      fail("Percorso non calcolato: " + (e.message || e));
    }
  }

  function tripClick(t) {
    const pick = t.closest("[data-pf-pick]");
    if (pick) { const [w, i] = pick.dataset.pfPick.split(":"); setTripPlace(w, trip.suggest[w][+i]); return true; }
    if (t.closest("[data-pf-gps]")) { setTripPlace("from", { gps: true }); return true; }
    const fb = t.closest("[data-pf-search]");
    if (fb) { placeSearchFallback(fb.dataset.pfSearch); return true; }
    const pl = t.closest("[data-pf-place]");
    if (pl) { const [w, id] = pl.dataset.pfPlace.split(":"); const p = places.find((x) => x.id === id); if (p) setTripPlace(w, { name: p.name, lat: p.lat, lng: p.lng }); return true; }
    const cl = t.closest("[data-pf-clear]");
    if (cl) { setTripPlace(cl.dataset.pfClear, null); const i = $(`[data-pf-input=${cl.dataset.pfClear}]`); if (i) i.focus(); return true; }
    const step = t.closest("[data-pp-step]");
    if (step) {
      readTripForm();
      const ps = tripPrefs.people;
      if (+step.dataset.ppStep > 0 && ps.length < 20) ps.push("Persona " + (ps.length + 1));
      else if (+step.dataset.ppStep < 0 && ps.length > 1) ps.pop();
      saveTripPrefs(); trip.groupId = null; openTrip(true); return true;
    }
    if (t.closest("[data-pp-add]")) { addPeople([$("#trip-form [name=pname]").value]); return true; }
    const kn = t.closest("[data-pp-known]");
    if (kn) { addPeople([kn.dataset.ppKnown]); return true; }
    const del = t.closest("[data-pp-del]");
    if (del) { readTripForm(); tripPrefs.people.splice(+del.dataset.ppDel, 1); saveTripPrefs(); trip.groupId = null; openTrip(true); return true; }
    const ren = t.closest("[data-pp-rename]");
    if (ren) {
      const i = +ren.dataset.ppRename;
      const n = (window.prompt("Nome", tripPrefs.people[i]) || "").trim().slice(0, 30);
      if (n) { readTripForm(); tripPrefs.people[i] = n; saveTripPrefs(); openTrip(true); }
      return true;
    }
    if (t.closest("[data-pp-contacts]")) {
      navigator.contacts.select(["name"], { multiple: true })
        .then((list) => addPeople(list.map((c) => (c.name && c.name[0]) || "").filter(Boolean)))
        .catch(() => {});
      return true;
    }
    if (t.closest("[data-price-reset]")) { trip.priceEdited = false; trip.price = trip.priceInfo.avg.toFixed(3); openTrip(true); return true; }
    if (t.closest("[data-trip-group]")) { tripCreateGroup(); return true; }
    const sg = t.closest("[data-sp-goto]");
    if (sg) { spese.open = sg.dataset.spGoto; go("spese"); return true; }
    return false;
  }

  function addPeople(names) {
    readTripForm();
    const ps = tripPrefs.people;
    for (let n of names) {
      n = String(n || "").trim().slice(0, 30);
      if (!n || ps.includes(n)) continue;
      // Sostituisco i segnaposto "Persona N" prima di allungare la lista.
      const ph = ps.findIndex((x) => /^Persona \d+$/.test(x));
      if (ph >= 0) ps[ph] = n; else ps.push(n);
    }
    saveTripPrefs(); trip.groupId = null; openTrip(true);
  }

  function tripChange(t) {
    if (t.matches("[data-trip-car]")) {
      readTripForm();
      if (t.value === "__new") { openCarForm(null, "viaggio"); return true; }
      const prevFuel = tripFuel();
      trip.carId = t.value;
      if (tripFuel() !== prevFuel) { trip.priceInfo = null; trip.priceEdited = false; trip.price = ""; }
      trip.groupId = null;
      openTrip(true);
      return true;
    }
    if (t.matches("[data-trip-fuel]")) {
      readTripForm();
      trip.fuel = +t.value; // senza auto: carburante solo per questo viaggio
      trip.priceInfo = null; trip.priceEdited = false; trip.price = "";
      openTrip(true);
      return true;
    }
    if (t.matches("[data-trip-price]")) { trip.priceEdited = true; trip.price = t.value; return true; }
    return false;
  }

  function loadHistoryMeta() {
    Promise.all([api.average(), api.meta()]).then(([a, m]) => {
      state.average = a || state.average;
      state.meta = m || state.meta;
      render();
    });
  }

  // ---------- Luoghi ----------
  let placeResults = [];
  function placesHTML(msg) {
    const list = places.length
      ? `<ul class="places">${places.map((p, i) => `<li>
          <button class="pl-name" data-zone="${esc(p.id)}">${esc(p.name)}</button>
          <span class="pl-btns">
            ${i > 0 ? `<button class="icon-btn" data-place-up="${i}" aria-label="Sposta su ${esc(p.name)}">↑</button>` : ""}
            <button class="icon-btn" data-place-rename="${i}" aria-label="Rinomina ${esc(p.name)}">✎</button>
            <button class="icon-btn" data-place-del="${i}" aria-label="Elimina ${esc(p.name)}">✕</button>
          </span></li>`).join("")}</ul>`
      : `<p class="muted">Nessun luogo salvato.</p>`;
    const results = placeResults.length
      ? `<ul class="results">${placeResults.map((r, i) => `<li><button data-place-add="${i}"><strong>${esc(r.name)}</strong><span class="muted small">${esc(r.detail || "")}</span></button></li>`).join("")}</ul>`
      : "";
    return `<header class="sh-head"><h2 id="sheet-title">Luoghi</h2></header>
      <section>
        <form id="place-form" class="search" autocomplete="off">
          <input id="place-q" type="search" placeholder="Comune o indirizzo" enterkeyhint="search" aria-label="Cerca un luogo">
          <button class="btn primary" type="submit">Cerca</button>
        </form>
        ${msg ? `<p class="muted small" role="status">${msg}</p>` : ""}
        ${results}
        <button class="btn here" data-place-here>Salva la posizione attuale</button>
      </section>
      <section><h3>I tuoi luoghi</h3>${list}</section>
      <p class="muted small">Ricerca: OpenStreetMap. I luoghi restano su questo telefono.</p>`;
  }
  function openPlaces(msg) {
    sheetReq++;
    openSheet(placesHTML(msg));
    const f = $("#place-form");
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const q = $("#place-q").value.trim();
      if (q.length < 2) return;
      openPlaces("Cerco…");
      $("#place-q").value = q;
      try {
        placeResults = await api.geocode(q);
        openPlaces(placeResults.length ? "" : "Nessun risultato. Prova con il nome del comune.");
      } catch (err) {
        placeResults = [];
        openPlaces("Ricerca non riuscita: " + esc(err.message || err));
      }
      $("#place-q").value = q;
    });
  }
  function addPlace(p) {
    const place = { id: "p" + Date.now().toString(36), name: p.name || "Luogo", lat: +p.lat, lng: +p.lng };
    places.push(place);
    savePlaces();
    placeResults = [];
    settings.zone = place.id; saveSettings();
    closeSheet();
    load();
  }
  function saveHere() {
    if (!navigator.geolocation) { openPlaces("La posizione non è disponibile su questo dispositivo."); return; }
    openPlaces("Cerco la tua posizione…");
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const { latitude: lat, longitude: lng } = pos.coords;
      const guess = (await api.reverse(lat, lng)) || "La mia posizione";
      const name = window.prompt("Nome del luogo", guess);
      if (name === null) { openPlaces(); return; }
      addPlace({ name: name.trim() || guess, lat, lng });
    }, () => openPlaces("Posizione non disponibile: controlla i permessi di localizzazione."), { timeout: 12000, maximumAge: 60000 });
  }

  // ---------- Spese di viaggio (stile Splitwise) ----------
  // Tutto resta sul telefono; per condividere con gli amici si manda un link che contiene il viaggio.
  let groups = store.get("groups", []);
  if (!Array.isArray(groups)) groups = [];
  const saveGroups = () => store.set("groups", groups);
  const spese = { open: null, creating: false, adding: false, pending: null, msg: "" };
  const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const eur = (cents) => nf2.format(cents / 100) + " €";
  const personName = (g, id) => (g.people.find((x) => x.id === id) || { name: "?" }).name;

  function renderSpese() {
    const g = groups.find((x) => x.id === spese.open);
    if (g) return showView("spese", groupHTML(g));
    const pending = spese.pending ? `<div class="notice">Scegli il viaggio per aggiungere <strong>${eur(Math.round(spese.pending.amount * 100))}</strong>. <button class="linkish" data-sp-cancel>Annulla</button></div>` : "";
    const form = spese.creating || !groups.length ? `<form id="sp-new" class="card form pad" autocomplete="off">
        <label class="field"><span>Nome del viaggio</span><input name="name" maxlength="40" required placeholder="Es. Weekend a Verona"></label>
        <label class="field"><span>Chi c'è (separati da virgola)</span><input name="people" required placeholder="Io, Marco, Giulia"></label>
        <p class="form-err" role="alert" hidden></p>
        <div class="preset-row"><button class="btn primary" type="submit">Crea</button>${groups.length ? '<button class="btn" type="button" data-sp-nocreate>Annulla</button>' : ""}</div>
      </form>` : "";
    showView("spese", `${pending}
      ${groups.length ? `<ul class="glist">${groups.map((x) => `<li><button class="card gitem" data-sp-open="${esc(x.id)}">
        <strong>${esc(x.name)}</strong><span class="muted small">${x.people.length} persone · ${x.expenses.length} spese</span>
        <span class="gtot">${eur(groupTotal(x))}</span></button></li>`).join("")}</ul>` : ""}
      ${form}
      ${groups.length && !spese.creating ? '<button class="btn primary wide" data-sp-create>+ Nuovo viaggio</button>' : ""}`);
  }

  function groupHTML(g) {
    const b = balances(g);
    const plan = settle(g);
    const total = groupTotal(g);
    const exp = g.expenses.slice().sort((a, c) => (c.date || "").localeCompare(a.date || ""));
    const pre = spese.pending || {};
    const addForm = spese.adding || spese.pending ? `<form id="sp-exp" class="card form pad" autocomplete="off">
        <label class="field"><span>Cosa</span><input name="desc" maxlength="60" required value="${esc(pre.desc || "")}" placeholder="Es. Benzina, pedaggio, pranzo"></label>
        <label class="field"><span>Importo (€)</span><input name="amount" type="number" inputmode="decimal" step="0.01" min="0.01" required value="${pre.amount ? (Math.round(pre.amount * 100) / 100).toFixed(2) : ""}"></label>
        <label class="field"><span>Ha pagato</span><select name="payer">${g.people.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("")}</select></label>
        <fieldset class="box"><legend>Diviso tra</legend><div class="checks">${g.people.map((p) => `<label class="check"><input type="checkbox" name="split" value="${esc(p.id)}" checked> ${esc(p.name)}</label>`).join("")}</div></fieldset>
        <p class="form-err" role="alert" hidden></p>
        <div class="preset-row"><button class="btn primary" type="submit">Aggiungi</button><button class="btn" type="button" data-sp-noadd>Annulla</button></div>
      </form>` : `<button class="btn primary wide" data-sp-add>+ Spesa</button>`;
    return `<button class="back" data-sp-back>‹ Viaggi</button>
      <h2 class="view-title">${esc(g.name)}</h2>
      <p class="muted">Totale ${eur(total)} · ${g.people.length} persone</p>
      ${addForm}
      <section class="group">
        <h3>Saldi</h3>
        <ul class="bal">${g.people.map((p) => { const v = b[p.id] || 0; return `<li><span>${esc(p.name)}</span><strong class="${v > 0 ? "pos" : v < 0 ? "neg" : ""}">${v > 0 ? "+" : v < 0 ? "−" : ""}${eur(Math.abs(v))}</strong></li>`; }).join("")}</ul>
      </section>
      <section class="group">
        <h3>Per pareggiare</h3>
        ${plan.length ? `<ul class="bal settle">${plan.map((x, i) => `<li><span class="who">${esc(personName(g, x.from))} → ${esc(personName(g, x.to))}</span><strong>${eur(x.cents)}</strong>
          <span class="acts"><button class="btn sm" data-sp-ask="${i}">Chiedi</button><button class="btn sm primary" data-sp-settle="${i}">Saldato</button></span></li>`).join("")}</ul>` : `<p class="muted">Siete pari.</p>`}
        ${g.pay ? `<p class="muted small pay-info">Pagamenti a ${esc(personName(g, g.pay.to))}: ${g.pay.paypal ? `PayPal ${esc(g.pay.paypal)}` : ""}${g.pay.paypal && g.pay.iban ? " · " : ""}${g.pay.iban ? `IBAN ${esc(g.pay.iban)}` : ""}</p>` : ""}
      </section>
      <section class="group">
        <h3>Spese</h3>
        ${exp.length ? `<ul class="places">${exp.map((e) => `<li${e.kind === "pay" ? ' class="paid"' : ""}><span class="pl-name exp"><strong>${esc(e.desc)}</strong>
          <span class="muted small">${e.kind === "pay" ? "pagamento" : `${esc(personName(g, e.payer))} · ${e.split.length === g.people.length ? "tutti" : e.split.map((id) => esc(personName(g, id))).join(", ")}`}</span></span>
          <strong class="amt">${eur(Math.round(e.amount * 100))}</strong>
          <button class="icon-btn" data-sp-del="${esc(e.id)}" aria-label="Elimina ${esc(e.desc)}">✕</button></li>`).join("")}</ul>` : `<p class="muted">Ancora nessuna spesa.</p>`}
      </section>
      ${spese.msg ? `<p class="muted small" role="status">${esc(spese.msg)}</p>` : ""}
      <div class="preset-row">
        <button class="btn" data-sp-share>Condividi</button>
        <button class="btn" data-sp-person>+ Persona</button>
        <button class="btn danger" data-sp-remove>Elimina</button>
      </div>`;
  }

  // Messaggio per chiedere i soldi, con link PayPal già compilato e IBAN se chi riceve è chi ha impostato i dati.
  function askPayment(g, x) {
    if (!x) return;
    const amount = (x.cents / 100).toFixed(2);
    const p = g.pay && g.pay.to === x.to ? g.pay : null;
    const lines = [`Ciao ${personName(g, x.from)}! Per «${g.name}» la tua parte è ${eur(x.cents)}.`];
    if (p && p.paypal) lines.push(`PayPal: https://paypal.me/${encodeURIComponent(p.paypal.replace(/^.*paypal\.me\//i, "").replace(/\/.*$/, ""))}/${amount}EUR`);
    if (p && p.iban) lines.push(`Bonifico: ${p.iban}${p.holder ? " (" + p.holder + ")" : ""}, causale «${g.name}»`);
    if (!p) lines.push(`Da dare a ${personName(g, x.to)}.`);
    const text = lines.join("\n");
    if (navigator.share) navigator.share({ text }).catch(() => {});
    else if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => { spese.msg = "Messaggio copiato: incollalo in chat."; renderSpese(); }, () => window.prompt("Copia il messaggio", text));
    else window.prompt("Copia il messaggio", text);
  }

  function packGroup(g) {
    const json = JSON.stringify({ v: 1, id: g.id, name: g.name, people: g.people, expenses: g.expenses, pay: g.pay });
    return btoa(unescape(encodeURIComponent(json))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function unpackGroup(str) {
    const json = decodeURIComponent(escape(atob(str.replace(/-/g, "+").replace(/_/g, "/"))));
    const d = JSON.parse(json);
    const clean = (t, n) => String(t == null ? "" : t).slice(0, n);
    if (!d || !Array.isArray(d.people) || !Array.isArray(d.expenses)) throw new Error("Link non valido");
    const people = d.people.slice(0, 30).map((p) => ({ id: clean(p.id, 20), name: clean(p.name, 30) })).filter((p) => p.id && p.name);
    const ids = new Set(people.map((p) => p.id));
    const expenses = d.expenses.slice(0, 500).map((e) => ({
      id: clean(e.id, 24), desc: clean(e.desc, 60), amount: Math.round(+e.amount * 100) / 100, payer: clean(e.payer, 20),
      split: (Array.isArray(e.split) ? e.split : []).map((x) => clean(x, 20)).filter((x) => ids.has(x)), date: clean(e.date, 30),
      kind: e.kind === "pay" ? "pay" : undefined,
    })).filter((e) => e.id && e.amount > 0 && e.amount < 1e6 && ids.has(e.payer) && e.split.length);
    const pay = d.pay && ids.has(clean(d.pay.to, 20)) ? { to: clean(d.pay.to, 20), paypal: clean(d.pay.paypal, 60), iban: clean(d.pay.iban, 40).replace(/[^A-Za-z0-9 ]/g, ""), holder: clean(d.pay.holder, 40) } : undefined;
    return { id: clean(d.id, 24) || uid("g"), name: clean(d.name, 40) || "Viaggio", people, expenses, pay };
  }
  function shareGroup(g) {
    const link = location.origin + location.pathname + "#spese/import/" + packGroup(g);
    const plan = settle(g);
    const text = `${g.name} – totale ${eur(groupTotal(g))}\n` +
      (plan.length ? plan.map((x) => `${personName(g, x.from)} → ${personName(g, x.to)}: ${eur(x.cents)}`).join("\n") : "Siamo pari.") +
      `\n\nApri e aggiorna nell'app:`;
    if (navigator.share) {
      navigator.share({ title: g.name, text, url: link }).catch(() => {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(text + " " + link).then(() => { spese.msg = "Riepilogo e link copiati."; renderSpese(); }, () => {});
    } else window.prompt("Copia il link", link);
  }
  function importGroup(data) {
    let g;
    try { g = unpackGroup(data); } catch (_) { window.alert("Link del viaggio non valido."); return; }
    const i = groups.findIndex((x) => x.id === g.id);
    const ok = window.confirm(i >= 0 ? `Aggiornare «${g.name}» con i dati ricevuti?` : `Aggiungere il viaggio «${g.name}» (${g.people.length} persone, ${g.expenses.length} spese)?`);
    if (!ok) return;
    if (i >= 0) { if (groups[i].me) g.me = groups[i].me; groups[i] = g; } else groups.unshift(g);
    saveGroups();
    spese.open = g.id;
  }

  function speseClick(t) {
    if (t.closest("[data-sp-create]")) { spese.creating = true; renderSpese(); return true; }
    if (t.closest("[data-sp-nocreate]")) { spese.creating = false; renderSpese(); return true; }
    if (t.closest("[data-sp-cancel]")) { spese.pending = null; renderSpese(); return true; }
    const open = t.closest("[data-sp-open]");
    if (open) { spese.open = open.dataset.spOpen; spese.msg = ""; renderSpese(); window.scrollTo(0, 0); return true; }
    if (t.closest("[data-sp-back]")) { spese.open = null; spese.adding = false; spese.msg = ""; renderSpese(); return true; }
    const g = groups.find((x) => x.id === spese.open);
    if (!g) return false;
    if (t.closest("[data-sp-add]")) { spese.adding = true; renderSpese(); const d = $("#sp-exp [name=desc]"); if (d) d.focus(); return true; }
    if (t.closest("[data-sp-noadd]")) { spese.adding = false; spese.pending = null; renderSpese(); return true; }
    if (t.closest("[data-sp-share]")) { shareGroup(g); return true; }
    if (t.closest("[data-sp-person]")) {
      const n = (window.prompt("Nome") || "").trim().slice(0, 30);
      if (n) { g.people.push({ id: uid("p"), name: n }); saveGroups(); renderSpese(); }
      return true;
    }
    if (t.closest("[data-sp-remove]")) {
      if (window.confirm(`Eliminare «${g.name}» e tutte le sue spese?`)) { groups = groups.filter((x) => x !== g); saveGroups(); spese.open = null; renderSpese(); }
      return true;
    }
    const ask = t.closest("[data-sp-ask]");
    if (ask) { askPayment(g, settle(g)[+ask.dataset.spAsk]); return true; }
    const st = t.closest("[data-sp-settle]");
    if (st) {
      const x = settle(g)[+st.dataset.spSettle];
      if (x && window.confirm(`${personName(g, x.from)} ha dato ${eur(x.cents)} a ${personName(g, x.to)}?`)) {
        // Come in Splitwise: un pagamento è una "spesa" pagata dal debitore e tutta a carico del creditore.
        g.expenses.push({ id: uid("e"), kind: "pay", desc: `${personName(g, x.from)} ha pagato ${personName(g, x.to)}`, amount: x.cents / 100, payer: x.from, split: [x.to], date: new Date().toISOString() });
        saveGroups(); renderSpese();
      }
      return true;
    }
    const del = t.closest("[data-sp-del]");
    if (del) { g.expenses = g.expenses.filter((e) => e.id !== del.dataset.spDel); saveGroups(); renderSpese(); return true; }
    return false;
  }

  function speseSubmit(form) {
    const err = $(".form-err", form);
    const fail = (m) => { err.hidden = false; err.textContent = m; };
    if (form.id === "sp-new") {
      const name = form.name.value.trim();
      const people = [...new Set(form.people.value.split(/[,;\n]/).map((x) => x.trim().slice(0, 30)).filter(Boolean))];
      if (!name) return fail("Scrivi un nome.");
      if (people.length < 2) return fail("Servono almeno 2 persone.");
      const g = { id: uid("g"), name: name.slice(0, 40), people: people.map((n) => ({ id: uid("p"), name: n })), expenses: [] };
      groups.unshift(g); saveGroups();
      spese.creating = false; spese.open = g.id;
      renderSpese(); window.scrollTo(0, 0);
      return;
    }
    if (form.id === "sp-exp") {
      const g = groups.find((x) => x.id === spese.open);
      const amount = Math.round(num(form.amount.value) * 100) / 100;
      const split = $$("[name=split]", form).filter((c) => c.checked).map((c) => c.value);
      const desc = form.desc.value.trim();
      if (!desc) return fail("Scrivi cosa avete pagato.");
      if (!(amount > 0 && amount < 1e6)) return fail("Importo non valido.");
      if (!split.length) return fail("Scegli almeno una persona.");
      g.expenses.push({ id: uid("e"), desc: desc.slice(0, 60), amount, payer: form.payer.value, split, date: new Date().toISOString() });
      saveGroups();
      spese.adding = false; spese.pending = null;
      renderSpese();
    }
  }

  // ---------- Schede (menu in basso) ----------
  const TABS = { prezzi: "Prezzi", viaggio: "Viaggio", spese: "Spese", auto: "Garage", altro: "Altro" };
  // Titoli grandi nell'intestazione, su due righe (stile "Pieno furbo").
  const HEADINGS = { prezzi: "Pieno<br>furbo.", viaggio: "Quanto costa<br>il viaggio?", spese: "Spese<br>di viaggio.", auto: "Il tuo<br>garage.", altro: "Tutto<br>il resto." };
  let currentTab = "prezzi";
  function go(name) {
    if (location.hash === "#" + name) route();
    else location.hash = name;
  }
  function route() {
    const h = location.hash.replace(/^#/, "");
    if (h.startsWith("spese/import/")) {
      importGroup(h.slice("spese/import/".length));
      history.replaceState(null, "", location.pathname + location.search + "#spese");
    }
    const name = TABS[h.split("/")[0]] ? h.split("/")[0] : "prezzi";
    const changed = name !== currentTab;
    currentTab = name;
    document.body.dataset.tab = name;
    for (const k in TABS) $("#view-" + k).hidden = k !== name;
    $$(".tabbar a").forEach((a) => (a.dataset.tab === name ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
    $("#title").innerHTML = HEADINGS[name];
    document.title = name === "prezzi" ? "Pieno furbo" : `${TABS[name]} · Pieno furbo`;
    if (name === "viaggio") openTrip();
    else if (name === "spese") renderSpese();
    else if (name === "auto") renderAuto();
    else if (name === "altro") renderAltro();
    if (changed) window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", route);

  // ---------- Eventi ----------
  function toggleFav(id) {
    id = String(id);
    if (favs.has(id)) favs.delete(id); else favs.add(id);
    store.set("favs", [...favs]);
  }

  document.addEventListener("click", (e) => {
    const t = e.target;
    if (t.closest("[data-places]")) { closePanels(); placeResults = []; openPlaces(); return; }
    const pnl = t.closest("[data-panel]");
    if (pnl) { togglePanel(pnl.dataset.panel); return; }
    const pc = t.closest("[data-pick-car]");
    if (pc) { closePanels(); useCar(pc.dataset.pickCar); return; }
    if (t.closest("[data-new-car]")) { closePanels(); go("auto"); setTimeout(() => openCarForm(null), 0); return; }
    const qb = t.closest("[data-qty]");
    if (qb) { settings.qty = qb.dataset.qty; saveSettings(); render(); return; }
    const db = t.closest("[data-dest]");
    if (db) { settings.dest = db.dataset.dest; saveSettings(); closePanels(); render(); return; }
    if (currentTab === "spese" && speseClick(t)) return;
    if (t.closest("[data-car-new]")) { openCarForm(null); return; }
    if (t.closest("[data-car-cancel]")) { const tg = t.closest("[data-car-cancel]").dataset.carCancel; tg === "viaggio" ? openTrip() : renderAuto(); window.scrollTo(0, 0); return; }
    if (currentTab === "viaggio" && tripClick(t)) return;
    const goEl = t.closest("[data-go]");
    if (goEl) { go(goEl.dataset.go); return; }
    const cUse = t.closest("[data-car-use]");
    if (cUse) { useCar(cUse.dataset.carUse); renderAuto(); return; }
    const cEdit = t.closest("[data-car-edit]");
    if (cEdit) { openCarForm(cars.find((c) => c.id === cEdit.dataset.carEdit)); return; }
    const cDel = t.closest("[data-car-del]");
    if (cDel) {
      const c = cars.find((x) => x.id === cDel.dataset.carDel);
      if (c && window.confirm(`Eliminare «${c.name}»?`)) {
        cars = cars.filter((x) => x !== c);
        if (activeCarId === c.id) activeCarId = "";
        saveCars(); render();
      }
      renderAuto(); return;
    }
    const preset = t.closest("[data-preset]");
    if (preset) {
      const form = preset.closest("form");
      const pr = CAR_PRESETS[+form.fuel.value][preset.dataset.preset];
      form.real.value = Math.round(1000 / pr[0]) / 10; form.tank.value = pr[1];
      return;
    }
    const calc = t.closest("[data-car-calc]");
    if (calc) {
      const form = calc.closest("form");
      const k = num(form.ckm.value), l = num(form.cl.value);
      if (k > 0 && l > 0) { form.real.value = Math.round((k / l) * 10) / 10; form.real.focus(); }
      return;
    }
    const pAdd = t.closest("[data-place-add]");
    if (pAdd) { addPlace(placeResults[+pAdd.dataset.placeAdd]); return; }
    if (t.closest("[data-place-here]")) { saveHere(); return; }
    const pUp = t.closest("[data-place-up]");
    if (pUp) { const i = +pUp.dataset.placeUp; [places[i - 1], places[i]] = [places[i], places[i - 1]]; savePlaces(); render(); openPlaces(); return; }
    const pRen = t.closest("[data-place-rename]");
    if (pRen) {
      const p = places[+pRen.dataset.placeRename];
      const name = window.prompt("Nuovo nome", p.name);
      if (name && name.trim()) { p.name = name.trim(); savePlaces(); render(); }
      openPlaces(); return;
    }
    const pDel = t.closest("[data-place-del]");
    if (pDel) {
      const [p] = places.splice(+pDel.dataset.placeDel, 1);
      savePlaces();
      if (settings.zone === p.id) { settings.zone = "gps"; saveSettings(); locate(); } else render();
      openPlaces(); return;
    }
    const zone = t.closest("[data-zone]");
    if (zone) {
      if (zone.closest("#sheet")) closeSheet();
      settings.zone = zone.dataset.zone; saveSettings();
      if (settings.zone === "gps") locate(); else load();
      return;
    }
    const seg = t.closest(".seg button");
    if (seg) {
      const id = seg.parentElement.id, v = +seg.dataset.v;
      if (id !== "seg-mode") closePanels();
      if (id === "seg-fuel") {
        // Scegliere un carburante diverso da quello dell'auto vuol dire "senza auto".
        const ac = activeCar();
        if (ac && +ac.fuel !== v) { activeCarId = ""; saveCars(); }
        settings.fuel = v; settings.brand = "";
        if (v === 3 || v === 4) settings.mode = 0; // GPL e metano sono quasi sempre solo serviti
        saveSettings(); load();
      }
      else if (id === "seg-mode") { settings.mode = v; saveSettings(); render(); }
      else if (id === "seg-radius") { settings.radius = v; saveSettings(); load(); }
      return;
    }
    const fav = t.closest("[data-fav]");
    if (fav) {
      e.stopPropagation();
      toggleFav(fav.dataset.fav);
      render();
      if (sheet.open && fav.closest("#sheet")) {
        const on = favs.has(String(fav.dataset.fav));
        fav.setAttribute("aria-pressed", String(on));
        fav.textContent = on ? "★ Preferito" : "☆ Preferito";
      }
      return;
    }
    if (t.closest("a[data-golink]")) return; // link nativo
    if (t.closest("[data-close]")) { closeSheet(); return; }
    if (t.closest("[data-retry]")) { settings.zone === "gps" && !state.gps ? locate() : load(); return; }
    if (t.closest("[data-clear]")) { settings.brand = ""; settings.fresh = false; settings.favOnly = false; render(); return; }
    const md = t.closest("[data-mode]");
    if (md) { settings.mode = +md.dataset.mode; saveSettings(); render(); return; }
    if (t.closest("[data-wider]")) { settings.radius = settings.radius < 5 ? 5 : settings.radius < 10 ? 10 : 15; saveSettings(); load(); return; }
    const open = t.closest("[data-open]");
    if (open && !open.closest("#sheet")) { openStation(open.dataset.open); return; }
  });
  document.addEventListener("input", (e) => {
    if (e.target.matches("[data-pf-input]")) onPlaceInput(e.target);
  });
  document.addEventListener("change", (e) => {
    if (currentTab === "viaggio") tripChange(e.target);
  });
  document.addEventListener("submit", (e) => {
    if (e.target.id === "car-form") { e.preventDefault(); saveCarForm(e.target); }
    if (e.target.id === "trip-form") { e.preventDefault(); tripCalc(e.target); }
    if (e.target.id === "sp-new" || e.target.id === "sp-exp") { e.preventDefault(); speseSubmit(e.target); }
    if (e.target.id === "pay-form") {
      e.preventDefault();
      const f = e.target;
      const iban = f.iban.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (iban && !/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) { window.alert("L'IBAN non sembra valido."); return; }
      store.set("pay", { name: f.name.value.trim().slice(0, 30), paypal: f.paypal.value.trim().replace(/^.*paypal\.me\//i, "").replace(/[^A-Za-z0-9._-]/g, "").slice(0, 40), iban: iban.replace(/(.{4})/g, "$1 ").trim() });
      renderAltro();
      const b = $("#pay-form button[type=submit]"); if (b) { b.textContent = "Salvato ✓"; }
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.matches("[data-pf-input]")) {
      e.preventDefault();
      const w = e.target.dataset.pfInput;
      if (trip.suggest[w] && trip.suggest[w][0]) setTripPlace(w, trip.suggest[w][0]);
      else placeSearchFallback(w);
      return;
    }
    if (e.key === "Enter" && e.target.matches("#trip-form [name=pname]")) { e.preventDefault(); addPeople([e.target.value]); return; }
    if ((e.key === "Enter" || e.key === " ") && e.target.matches("article[data-open]")) {
      e.preventDefault();
      openStation(e.target.dataset.open);
    }
  });

  $("#sel-sort").addEventListener("change", (e) => { settings.sort = e.target.value; saveSettings(); render(); });
  $("#in-timevalue").addEventListener("change", (e) => {
    const v = Math.max(0, Math.min(100, Math.round(num(e.target.value) || 0)));
    settings.timeValue = v; e.target.value = v; saveSettings(); render();
  });
  $("#sel-brand").addEventListener("change", (e) => { settings.brand = e.target.value; render(); });
  $("#tg-fresh").addEventListener("click", () => { settings.fresh = !settings.fresh; render(); });
  $("#tg-fav").addEventListener("click", () => { settings.favOnly = !settings.favOnly; render(); });
  $("#btn-refresh").addEventListener("click", () => {
    if (settings.zone === "gps") locate(); else load();
    loadHistoryMeta();
  });


  // ---------- Aggiornamenti automatici ----------
  // L'app installata (schermata Home) spesso riprende da dove era rimasta senza ricaricare.
  // Quando torna in primo piano controllo se è stata pubblicata una nuova versione: se sì, ricarico.
  const STANDALONE = (window.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
  // Con la build i nomi di JS e CSS cambiano a ogni rilascio, e index.html con loro: basta lui.
  const VERSION_FILES = ["index.html"];
  let appVersion = null, swReg = null, reloading = false;
  async function versionNow() {
    try {
      const tags = await Promise.all(VERSION_FILES.map((f) => fetch(f, { method: "HEAD", cache: "no-store" })
        .then((r) => (r.ok ? r.headers.get("etag") || r.headers.get("last-modified") || "" : ""))));
      return tags.every(Boolean) ? tags.join("|") : null;
    } catch (_) { return null; }  // offline: nessun controllo
  }
  function hardReload() {
    if (reloading) return;
    reloading = true;
    location.reload();
  }
  async function checkForUpdate() {
    if (swReg) swReg.update().catch(() => {});
    const v = await versionNow();
    if (!v) return;
    if (appVersion && v !== appVersion) hardReload();
    else appVersion = v;
  }

  // Aggiorna i dati quando l'app torna in primo piano dopo più di 10 minuti; la versione la controllo sempre.
  let hiddenAt = 0;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { hiddenAt = Date.now(); return; }
    checkForUpdate();
    if (hiddenAt && Date.now() - hiddenAt > 10 * 60e3) { settings.zone === "gps" ? locate() : load(); }
  });
  window.addEventListener("pageshow", (e) => { if (e.persisted) checkForUpdate(); });

  // ---------- Trascina in giù per aggiornare (solo app installata: nel browser c'è già) ----------
  if (STANDALONE && "ontouchstart" in window) {
    const ptr = document.createElement("div");
    ptr.className = "ptr";
    ptr.setAttribute("aria-hidden", "true");
    ptr.innerHTML = '<img src="icons/logo-mark.svg" alt="">';
    document.body.appendChild(ptr);
    const THRESHOLD = 72;
    let startY = 0, pulling = false, dist = 0;
    const blocked = (el) => el.closest("dialog[open], .engines, .pf-list, input, select, textarea");
    document.addEventListener("touchstart", (e) => {
      if (window.scrollY > 0 || e.touches.length !== 1 || blocked(e.target)) return;
      startY = e.touches[0].clientY; pulling = true; dist = 0;
    }, { passive: true });
    document.addEventListener("touchmove", (e) => {
      if (!pulling) return;
      dist = e.touches[0].clientY - startY;
      if (dist <= 0 || window.scrollY > 0) { ptr.style.transform = ""; ptr.classList.remove("on", "ready"); return; }
      const d = Math.min(110, dist * 0.55);
      ptr.classList.add("on");
      ptr.classList.toggle("ready", dist * 0.55 >= THRESHOLD);
      ptr.style.transform = `translate(-50%, ${d}px) rotate(${d * 3}deg)`;
    }, { passive: true });
    document.addEventListener("touchend", () => {
      if (!pulling) return;
      pulling = false;
      if (dist * 0.55 >= THRESHOLD) {
        ptr.classList.add("spinning");
        ptr.style.transform = "translate(-50%, 72px)";
        setTimeout(hardReload, 250);   // ricarica completa: dati freschi e, se c'è, la nuova versione
      } else {
        ptr.classList.remove("on", "ready");
        ptr.style.transform = "";
      }
    });
  }

  // ---------- Avvio ----------
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then((r) => { swReg = r; }).catch(() => {});
    // Un nuovo service worker ha preso il controllo (nuovo rilascio): ricarico una volta.
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (hadController) hardReload(); });
  }
  if (location.protocol === "https:") versionNow().then((v) => { appVersion = v; });
  loadHistoryMeta();
  getJSON(`${CFG.DATA_URL || "data"}/logos/index.json`, 10000).then((j) => { state.logos = j.logos || {}; render(); }, () => {});
  if (settings.zone === "gps") locate(); else load();
  render();
  route();
})();
