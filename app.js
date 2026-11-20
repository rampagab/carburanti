// Carburanti: web app personale per i prezzi dei carburanti (dati MIMIT).
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
    { zone: "monselice", fuel: 2, mode: 1, radius: 5, sort: "price", liters: 50 },
    D,
    store.get("settings", {}),
    { brand: "", fresh: false, favOnly: false }
  );
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
  const ROAD_FACTOR = 1.3; // distanza in linea d'aria → strada (stima)
  const CAR_PRESETS = {
    1: { s: [5.5, 40], m: [6.5, 50], l: [8.5, 60] },
    2: { s: [4.5, 40], m: [5.5, 50], l: [7, 65] },
    4: { s: [7, 35], m: [8.5, 40], l: [10, 50] },
    3: { s: [3.8, 12], m: [4.5, 15], l: [5.5, 20] },
  };
  if (settings.zone !== "gps" && !places.some((p) => p.id === settings.zone)) settings.zone = "gps";
  const saveSettings = () => {
    const { zone, fuel, mode, radius, sort, liters } = settings;
    store.set("settings", { zone, fuel, mode, radius, sort, liters });
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

  function haversine(a, b) {
    const r = Math.PI / 180;
    const x = Math.sin((b.lat - a.lat) * r / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin((b.lng - a.lng) * r / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.sqrt(x));
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
    async route(a, b) {
      if (DEMO) return window.CarburantiDemo.route(a, b);
      const url = `https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=false&steps=true&alternatives=false`;
      const j = await getJSON(url, 20000);
      if (!j || j.code !== "Ok" || !j.routes || !j.routes.length) throw new Error("Percorso non trovato");
      const r = j.routes[0];
      let mw = 0;
      const roads = [];
      for (const leg of r.legs || []) {
        for (const st of leg.steps || []) {
          const refs = String(st.ref || "").split(/[;,]/).map((x) => x.replace(/\s+/g, "").toUpperCase());
          const m = refs.map((x) => x.match(/^A\d+/)).find(Boolean);
          if (m && !FREE_MOTORWAYS.has(m[0])) {
            mw += st.distance;
            if (!roads.includes(m[0])) roads.push(m[0]);
          }
        }
      }
      return { km: r.distance / 1000, min: r.duration / 60, mwKm: mw / 1000, roads };
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
    reqId: 0,
  };

  function currentCenter() {
    if (settings.zone === "gps") return state.gps;
    const z = places.find((p) => p.id === settings.zone);
    return z ? { lat: z.lat, lng: z.lng, name: z.name } : null;
  }

  // Prezzo dell'impianto per carburante + modalità scelti (il più basso, se ci sono più prodotti).
  function pick(st) {
    let best = null;
    for (const f of st.fuels) {
      if (f.fuelId !== +settings.fuel || f.isSelf !== (+settings.mode === 1) || f.price == null || f.price <= 0) continue;
      if (!best || f.price < best.price) best = f;
    }
    return best;
  }

  function priced() {
    return state.stations
      .map((s) => ({ s, f: pick(s) }))
      .filter((x) => x.f);
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

  function visible() {
    let rows = priced();
    if (settings.brand) rows = rows.filter((x) => (x.s.brand || "") === settings.brand);
    if (settings.fresh) rows = rows.filter((x) => ago(x.s.insertDate).hours <= 24);
    if (settings.favOnly) rows = rows.filter((x) => favs.has(String(x.s.id)));
    const byPrice = (a, b) => a.f.price - b.f.price || (a.s.distance ?? 99) - (b.s.distance ?? 99);
    const car = carForFuel(), ref = car && nearestRef(priced());
    const sorters = {
      price: byPrice,
      net: car && ref ? (a, b) => netSaving(b, ref, car) - netSaving(a, ref, car) || byPrice(a, b) : byPrice,
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
    const sortOpts = [["price", "Prezzo"], ["distance", "Distanza"], ["date", "Aggiornamento"]];
    if (carForFuel()) sortOpts.push(["net", "Convenienza"]);
    $("#sel-sort").innerHTML = sortOpts.map(([v, t]) => `<option value="${v}">${t}</option>`).join("");
    $("#sel-sort").value = sortOpts.some((o) => o[0] === settings.sort) ? settings.sort : "price";
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
    el.innerHTML = `<div class="card sum">
      <div class="sum-top">
        <div class="sum-main">
          <div class="eyebrow">Il più economico · ${esc(FUELS[settings.fuel])} ${+settings.mode === 1 ? "self" : "servito"}</div>
          <button class="sum-best" data-open="${esc(best.s.id)}">
            <span class="big">${price(min)}</span><span class="u">${u}</span>
          </button>
          <div class="sum-where">${esc(prettyBrand(best.s.brand))}${best.s.distance != null ? " · " + km(best.s.distance) : ""}</div>
        </div>
        <dl class="sum-stats">
          <div><dt>Media zona</dt><dd>${price(mean)}</dd></div>
          ${car ? `<div><dt>Pieno ${nf1.format(qty).replace(",0", "")} ${qu}</dt><dd>${nf2.format(min * qty)} €</dd></div>` : ""}
          <div><dt>Risparmio ${nf1.format(qty).replace(",0", "")} ${qu}</dt><dd>${nf2.format(saving)} €</dd></div>
          ${car ? "" : `<div><dt>Impianti</dt><dd>${rows.length}</dd></div>`}
        </dl>
      </div>
      ${car ? `<div class="car-line"><strong>${esc(car.name)}</strong>: ${nf2.format(car.cons / 100 * min * 100)} € ogni 100 km al prezzo migliore.<br><span class="muted">Sulle schede: quanto risparmi sul pieno rispetto al distributore più vicino, già tolto il carburante per arrivarci.</span></div>` : ""}
      ${trend}
      <div class="sum-foot muted">${esc(center ? center.name : "")} · raggio ${settings.radius} km${car ? " · " + rows.length + " impianti" : ""}${state.loading ? ' · <span class="spin" aria-label="Caricamento"></span>' : ""}</div>
    </div>`;
  }

  function cardHTML({ s, f }, min, ref, car) {
    const a = ago(s.insertDate);
    let net = "";
    if (car && ref) {
      if (ref.s.id === s.id) net = `<span class="net">il più vicino</span>`;
      else {
        const v = netSaving({ s, f }, ref, car);
        if (v >= 0.05) net = `<span class="net pos">risparmi ${nf2.format(v)} € netti</span>`;
        else if (v <= -0.05) net = `<span class="net neg">non conviene: +${nf2.format(-v)} €</span>`;
        else net = `<span class="net">come il più vicino</span>`;
      }
    }
    const stale = a.hours > 72;
    const diff = f.price - min;
    const fav = favs.has(String(s.id));
    const title = prettyBrand(s.brand);
    const sub = prettyAddress(s.address) || (isUsefulName(s.name) ? s.name : "Indirizzo non disponibile");
    const otherName = s.address && isUsefulName(s.name) && !/^[A-Z0-9 ,.'-]+$/.test(s.name) ? s.name : "";
    return `<article class="card st${diff === 0 ? " best" : ""}" data-open="${esc(s.id)}" tabindex="0" aria-label="${esc(title + ", " + price(f.price) + " " + unit(settings.fuel))}">
      <div class="st-price">
        <span class="big">${price(f.price)}</span>
        <span class="delta ${diff === 0 ? "zero" : ""}">${diff === 0 ? "Migliore" : "+" + cents(diff) + " cent"}</span>
      </div>
      <div class="st-info">
        <h3>${esc(title)}${otherName ? ` <span class="muted">· ${esc(otherName)}</span>` : ""}</h3>
        <p class="addr">${esc(sub)}</p>
        <p class="meta">${s.distance != null ? `<span>${km(s.distance)}</span>` : ""}
          <span class="${stale ? "stale" : ""}">${stale ? "⚠ " : ""}aggiornato ${esc(a.text)}</span>
          ${f.name && f.name !== FUELS[settings.fuel] ? `<span class="prod">${esc(f.name)}</span>` : ""}${net}</p>
      </div>
      <div class="st-actions">
        <button class="star" data-fav="${esc(s.id)}" aria-pressed="${fav}" aria-label="${fav ? "Rimuovi dai preferiti" : "Aggiungi ai preferiti"}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>
        </button>
        <a class="go" href="${mapsUrl(s)}" target="_blank" rel="noopener" data-go aria-label="Portami lì">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11l18-8-8 18-2-8z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg><span>Vai</span>
        </a>
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
    const car = carForFuel(), ref = car ? nearestRef(all) : null;
    let html = rows.map((r) => cardHTML(r, min, ref, car)).join("");
    if (state.error && !state.fromCache) html = `<div class="card state err small"><p>${esc(state.error)}</p><button class="btn" data-retry>Riprova</button></div>` + html;
    el.innerHTML = html;
  }

  function render() {
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

  function pricesHTML(fuels) {
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
      const sel = g.fuelId === +settings.fuel;
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
        <h2 id="sheet-title">${esc(prettyBrand(s.brand))}</h2>
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

      <section><h3>Prezzi</h3>${pricesHTML(fuels)}</section>
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

  // ---------- Impostazioni ----------
  function openSettings() {
    sheetReq++;
    const carRow = (c) => `<li>
        <button class="pl-name car-pick" data-car-use="${esc(c.id)}" aria-pressed="${c.id === activeCarId}">
          <span class="radio" aria-hidden="true"></span><span><strong>${esc(c.name)}</strong>
          <span class="muted small">${esc(FUELS[c.fuel])} · ${nf1.format(100 / c.cons)} km/${+c.fuel === 3 ? "kg" : "L"} ${c.realKml || !c.declL100 ? "reali" : "(dichiarato +" + gapFor(c) * 100 + "%)"} · serbatoio ${nf1.format(c.tank).replace(",0", "")}</span></span></button>
        <span class="pl-btns"><button class="icon-btn" data-car-edit="${esc(c.id)}" aria-label="Modifica ${esc(c.name)}">✎</button>
        <button class="icon-btn" data-car-del="${esc(c.id)}" aria-label="Elimina ${esc(c.name)}">✕</button></span></li>`;
    openSheet(`<header class="sh-head"><h2 id="sheet-title">Impostazioni</h2></header>
      <section>
        <h3>Le tue auto</h3>
        ${cars.length ? `<ul class="places cars">${cars.map(carRow).join("")}
          <li><button class="pl-name car-pick" data-car-use="" aria-pressed="${!activeCar()}"><span class="radio" aria-hidden="true"></span><span>Nessuna auto</span></button></li></ul>`
          : `<p class="muted small">Aggiungi la tua auto: l'app calcola il costo del pieno, quanto spendi ogni 100 km e se conviene andare a un distributore più lontano.</p>`}
        <button class="btn here" data-car-new>+ Aggiungi auto</button>
      </section>
      <section>
        <label class="field"><span>Litri (o kg) del pieno, senza auto</span>
          <input id="in-liters" type="number" inputmode="numeric" min="5" max="200" step="1" value="${settings.liters}"></label>
        <p class="muted small">Serve per il risparmio nel riepilogo quando non c'è un'auto per il carburante scelto.</p>
      </section>
      <section>
        <h3>Dati</h3>
        <p class="muted small">Fonte: ${DEMO ? "modalità demo (dati finti)" : "Ministero delle Imprese e del Made in Italy – Osservatorio prezzi carburanti (licenza IODL 2.0)"}.
        ${state.average && state.average.updated ? `<br>Storico aggiornato ${esc(ago(state.average.updated).text)}.` : ""}</p>
        <button class="btn" id="btn-clear-cache">Svuota i dati salvati offline</button>
        <p class="muted small">Preferiti salvati: ${favs.size}.</p>
      </section>
      <section>
        <p class="muted small">${DEMO ? '<a href="./">Esci dalla demo</a>' : '<a href="?demo=1">Apri la modalità demo</a>'}</p>
      </section>`);
    $("#in-liters").addEventListener("change", (e) => {
      const v = Math.round(+e.target.value);
      if (v >= 5 && v <= 200) { settings.liters = v; saveSettings(); render(); }
      else e.target.value = settings.liters;
    });
    $("#btn-clear-cache").addEventListener("click", (e) => {
      store.clearCache();
      e.target.textContent = "Dati offline eliminati";
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

  function openCarForm(car) {
    sheetReq++;
    const c = car || { name: "", fuel: +settings.fuel || 2, tank: "" };
    // Auto salvate prima di questa versione: il loro consumo era già quello reale.
    const real = c.realKml || (c.cons && !c.declL100 ? Math.round(1000 / c.cons) / 10 : "");
    const u = +c.fuel === 3 ? "kg" : "L";
    openSheet(`<header class="sh-head"><h2 id="sheet-title">${car ? "Modifica auto" : "Nuova auto"}</h2></header>
      <form id="car-form" class="form" novalidate data-id="${esc(car ? car.id : "")}" data-nedc="${c.nedc ? 1 : ""}" autocomplete="off">
        <fieldset class="box cfg">
          <legend>Trova la tua auto</legend>
          <label class="field"><span>Marca</span><select name="cfgMake" disabled><option value="">Carico le marche…</option></select></label>
          <div id="cfg-model"></div>
          <div id="cfg-engines"></div>
          <p class="muted small">Dati ufficiali EEA delle auto immatricolate in Italia dal 2012. Non trovi la tua? Compila i campi qui sotto.</p>
        </fieldset>
        <label class="field"><span>Nome</span><input name="name" required maxlength="40" placeholder="Es. Panda, Golf, auto di lavoro" value="${esc(c.name)}"></label>
        <label class="field"><span>Carburante</span><select name="fuel">${[2, 1, 4, 3].map((f) => `<option value="${f}"${+c.fuel === f ? " selected" : ""}>${FUELS[f]}</option>`).join("")}</select></label>

        <fieldset class="box">
          <legend>Consumo reale <span class="tag">consigliato</span></legend>
          <label class="field"><span>Quanti km fai davvero con 1 ${u}</span>
            <div class="inline"><input name="real" type="number" inputmode="decimal" step="0.1" min="3" max="100" value="${real}" placeholder="Es. 17,5"><span class="unit">km/${u}</span></div></label>
          <details class="calc"${real ? "" : " open"}>
            <summary>Calcolalo da un pieno all'altro</summary>
            <p class="muted small">Fai il pieno e azzera il contachilometri parziale. Al pieno successivo scrivi i km percorsi e i litri messi.</p>
            <div class="inline"><input name="ckm" type="number" inputmode="decimal" step="1" min="1" placeholder="km percorsi" aria-label="km percorsi">
              <input name="cl" type="number" inputmode="decimal" step="0.01" min="1" placeholder="litri messi" aria-label="litri messi">
              <button type="button" class="btn" data-car-calc>Calcola</button></div>
            <p class="muted small">Puoi anche usare la media del computer di bordo, se la ritieni affidabile.</p>
          </details>
        </fieldset>

        <fieldset class="box">
          <legend>Consumo dichiarato dalla casa <span class="tag">facoltativo</span></legend>
          <div class="inline"><input name="decl" type="number" inputmode="decimal" step="0.1" min="1" max="100" value="${c.declL100 || ""}" aria-label="Consumo dichiarato">
            <select name="unit"><option value="l100">L/100 km</option><option value="kml">km/L</option></select></div>
          <p class="muted small" id="decl-note">Usato solo se non inserisci quello reale, aumentato del ${gapFor(c) * 100}%: nella guida di tutti i giorni si consuma quasi sempre più del dato ufficiale.</p>
        </fieldset>

        <div class="field"><span>Non conosci i valori? Parti da uno tipico</span>
          <div class="preset-row"><button type="button" class="btn" data-preset="s">Piccola</button><button type="button" class="btn" data-preset="m">Media</button><button type="button" class="btn" data-preset="l">Grande / SUV</button></div></div>
        <label class="field"><span>Capienza serbatoio (${u})</span><input name="tank" type="number" inputmode="decimal" step="1" min="5" max="150" required value="${c.tank || ""}"></label>
        <p class="form-err" role="alert" hidden></p>
        <div class="preset-row"><button class="btn primary" type="submit">Salva</button><button class="btn" type="button" data-settings>Annulla</button></div>
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
      if (note) note.textContent = `Dato ufficiale ${v.nedc ? "NEDC" : "WLTP"}. Usato solo se non inserisci quello reale, aumentato del ${(v.nedc ? DECLARED_GAP_NEDC : DECLARED_GAP) * 100}%: nella guida di tutti i giorni si consuma quasi sempre più del dato ufficiale.`;
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
    useCar(id);
    openSettings();
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
  const FALLBACK_PRICE = { 1: 1.95, 2: 2.0, 3: 1.5, 4: 0.8 };
  const tripPrefs = Object.assign({ tollRate: 0.08, people: 1, roundTrip: false, cons: 6.5 }, store.get("trip", {}));
  const trip = { from: "gps", to: null, results: [], msg: "", res: null, tollReal: "", price: "" };

  function tripFuel() { const c = activeCar(); return c ? +c.fuel : +settings.fuel; }
  function defaultTripPrice() {
    const fuel = tripFuel();
    if (+settings.fuel === fuel) {
      const rows = priced();
      if (rows.length) return rows.reduce((a, x) => a + x.f.price, 0) / rows.length;
    }
    const days = state.average && state.average.days;
    const last = days && days[days.length - 1];
    const v = last && last.v && (last.v[fuel + "-1"] || last.v[fuel + "-0"]);
    return v ? v.avg : FALLBACK_PRICE[fuel];
  }
  function getPosition() {
    if (state.gps) return Promise.resolve(state.gps);
    return new Promise((ok, ko) => {
      if (!navigator.geolocation) return ko(new Error("Posizione non disponibile su questo dispositivo"));
      navigator.geolocation.getCurrentPosition(
        (p) => { state.gps = { lat: p.coords.latitude, lng: p.coords.longitude, name: "La tua posizione" }; ok(state.gps); },
        () => ko(new Error("Posizione non disponibile: scegli una partenza tra i tuoi luoghi")),
        { timeout: 12000, maximumAge: 120000 });
    });
  }
  function readTripForm() {
    const f = $("#trip-form");
    if (!f) return;
    trip.from = f.from.value;
    tripPrefs.roundTrip = f.round.checked;
    tripPrefs.people = Math.min(9, Math.max(1, Math.round(+f.people.value) || 1));
    if (f.cons) { const c = parseFloat(String(f.cons.value).replace(",", ".")); if (c >= 1 && c <= 30) tripPrefs.cons = c; }
    trip.price = f.price.value;
    const t = parseFloat(String(f.toll.value).replace(",", "."));
    if (t >= 0 && t <= 1) tripPrefs.tollRate = t;
    store.set("trip", tripPrefs);
  }

  function tripResultHTML() {
    const r = trip.res;
    if (!r) return "";
    const car = activeCar();
    const cons = car ? car.cons : tripPrefs.cons;
    const mult = tripPrefs.roundTrip ? 2 : 1;
    const priceL = parseFloat(String(trip.price).replace(",", ".")) || defaultTripPrice();
    const kmTot = r.km * mult, mwTot = r.mwKm * mult, minTot = r.min * mult;
    const liters = kmTot * cons / 100;
    const fuelCost = liters * priceL;
    const tollEst = mwTot * tripPrefs.tollRate;
    const real = parseFloat(String(trip.tollReal).replace(",", "."));
    const toll = real >= 0 ? real : tollEst;
    const total = fuelCost + toll;
    const people = tripPrefs.people;
    const u = tripFuel() === 3 ? "kg" : "L";
    const h = Math.floor(minTot / 60), m = Math.round(minTot % 60);
    const from = trip.fromPoint, to = trip.to;
    const maps = isIOS
      ? `https://maps.apple.com/?saddr=${from.lat},${from.lng}&daddr=${to.lat},${to.lng}&dirflg=d`
      : `https://www.google.com/maps/dir/?api=1&origin=${from.lat},${from.lng}&destination=${to.lat},${to.lng}&travelmode=driving`;
    return `<div class="card trip-res">
      <div class="eyebrow">Costo ${tripPrefs.roundTrip ? "andata e ritorno" : "solo andata"} · ${esc(to.name)}</div>
      <div class="trip-total"><span class="big">${nf2.format(total)}</span><span class="u">€</span></div>
      ${people > 1 ? `<div class="muted"><strong>${nf2.format(total / people)} € a testa</strong> (${people} persone)</div>` : ""}
      <dl class="trip-dl">
        <div><dt>Distanza</dt><dd>${nf1.format(kmTot)} km</dd></div>
        <div><dt>Tempo di guida</dt><dd>${h ? h + " h " : ""}${m} min</dd></div>
        <div><dt>Carburante</dt><dd>${nf1.format(liters)} ${u} · ${nf2.format(fuelCost)} €</dd></div>
        <div><dt>Autostrada a pagamento</dt><dd>${nf1.format(mwTot)} km${r.roads.length ? " · " + esc(r.roads.join(", ")) : ""}</dd></div>
        <div><dt>Pedaggi ${real >= 0 ? "(importo reale)" : "(stima)"}</dt><dd>${nf2.format(toll)} €</dd></div>
      </dl>
      <label class="field"><span>Importo reale dei pedaggi${tripPrefs.roundTrip ? " (andata e ritorno)" : ""}, se lo conosci</span>
        <input id="toll-real" type="number" inputmode="decimal" step="0.1" min="0" value="${esc(trip.tollReal)}" placeholder="${nf2.format(tollEst).replace(",", ".")}"></label>
      <a class="btn primary" href="${maps}" target="_blank" rel="noopener">Apri il percorso in Mappe</a>
      <p class="muted small">Stima: km di autostrada a pagamento × ${nf3.format(tripPrefs.tollRate)} €/km. L'importo vero dipende dalle tratte e dai caselli: lo trovi sul sito di Autostrade per l'Italia o nelle app di navigazione. Le autostrade gratuite (A2, A19, A29, A90, A91) non sono conteggiate. Consumo: ${nf1.format(cons)} ${u}/100 km${car ? " (" + esc(car.name) + ")" : ""}.</p>
    </div>`;
  }

  function tripHTML() {
    const car = activeCar();
    const fuel = tripFuel();
    const u = fuel === 3 ? "kg" : "L";
    const dest = trip.to
      ? `<div class="picked"><span><strong>${esc(trip.to.name)}</strong></span><button type="button" class="icon-btn" data-trip-clear aria-label="Cambia arrivo">✕</button></div>`
      : `<div class="inline"><input name="q" type="search" placeholder="Comune o indirizzo" enterkeyhint="search" aria-label="Cerca l'arrivo"><button class="btn" type="button" data-trip-search>Cerca</button></div>
        ${places.length ? `<div class="preset-row">${places.map((p) => `<button type="button" class="btn small-btn" data-trip-to="${esc(p.id)}">${esc(p.name)}</button>`).join("")}</div>` : ""}
        ${trip.msg ? `<p class="muted small" role="status">${trip.msg}</p>` : ""}
        ${trip.results.length ? `<ul class="results">${trip.results.map((r, i) => `<li><button type="button" data-trip-pick="${i}"><strong>${esc(r.name)}</strong><span class="muted small">${esc(r.detail || "")}</span></button></li>`).join("")}</ul>` : ""}`;
    return `<header class="sh-head"><h2 id="sheet-title">Viaggio</h2><p class="muted">Quanto costa un tragitto: carburante e pedaggi.</p></header>
      <form id="trip-form" class="form" autocomplete="off">
        <label class="field"><span>Partenza</span><select name="from">
          <option value="gps">La mia posizione</option>${places.map((p) => `<option value="${esc(p.id)}"${trip.from === p.id ? " selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label>
        <div class="field"><span>Arrivo</span>${dest}</div>
        <div class="inline trip-opts">
          <label class="check"><input type="checkbox" name="round"${tripPrefs.roundTrip ? " checked" : ""}> Andata e ritorno</label>
          <label class="check">Persone <input name="people" type="number" inputmode="numeric" min="1" max="9" value="${tripPrefs.people}"></label>
        </div>
        <div class="field"><span>Auto</span>${car
          ? `<p class="car-sum"><strong>${esc(car.name)}</strong> · ${esc(FUELS[car.fuel])} · ${nf1.format(100 / car.cons)} km/${u} <button type="button" class="linkish" data-settings>cambia</button></p>`
          : `<div class="inline"><input name="cons" type="number" inputmode="decimal" step="0.1" min="1" max="30" value="${tripPrefs.cons}" aria-label="Consumo"><span class="unit">${u}/100 km</span></div>
             <p class="muted small">Oppure <button type="button" class="linkish" data-car-new>aggiungi la tua auto</button>.</p>`}</div>
        <label class="field"><span>Prezzo ${esc(FUELS[fuel])} (€/${u})</span>
          <input name="price" type="number" inputmode="decimal" step="0.001" min="0.3" max="5" value="${esc(trip.price)}" placeholder="${defaultTripPrice().toFixed(3)}"></label>
        <label class="field"><span>Pedaggio medio (€ per km di autostrada)</span>
          <input name="toll" type="number" inputmode="decimal" step="0.001" min="0" max="1" value="${tripPrefs.tollRate}"></label>
        <p class="form-err" role="alert" hidden></p>
        <button class="btn primary" type="submit">Calcola</button>
      </form>
      <div id="trip-out" aria-live="polite">${tripResultHTML()}</div>
      <p class="muted small">Percorso calcolato con OSRM e ricerca con OpenStreetMap: ricevono solo i punti di partenza e arrivo.</p>`;
  }

  function openTrip(keepScroll) {
    sheetReq++;
    const top = sheet.scrollTop;
    openSheet(tripHTML());
    if (keepScroll) sheet.scrollTop = top;
    const real = $("#toll-real");
    if (real) real.addEventListener("change", (e) => { trip.tollReal = e.target.value; readTripForm(); openTrip(true); });
  }

  async function tripSearch() {
    const f = $("#trip-form");
    const q = f && f.q ? f.q.value.trim() : "";
    readTripForm();
    if (q.length < 2) return;
    trip.msg = "Cerco…"; trip.results = []; openTrip(true);
    try {
      trip.results = await api.geocode(q);
      trip.msg = trip.results.length ? "" : "Nessun risultato. Prova con il nome del comune.";
    } catch (err) { trip.msg = "Ricerca non riuscita: " + esc(err.message || err); }
    openTrip(true);
  }

  async function tripCalc(form) {
    readTripForm();
    const err = $(".form-err", form);
    const fail = (m) => { err.hidden = false; err.textContent = m; };
    if (!trip.to) return fail("Scegli l'arrivo.");
    let from;
    try {
      from = trip.from === "gps" ? await getPosition() : places.find((p) => p.id === trip.from);
    } catch (e) { return fail(e.message); }
    if (!from) return fail("Scegli la partenza.");
    const btn = $("button[type=submit]", form);
    btn.disabled = true; btn.textContent = "Calcolo…";
    try {
      trip.res = await api.route(from, trip.to);
      trip.fromPoint = { lat: from.lat, lng: from.lng };
      openTrip(true);
      const out = $("#trip-out");
      if (out) out.scrollIntoView({ block: "start", behavior: "smooth" });
    } catch (e) {
      btn.disabled = false; btn.textContent = "Calcola";
      fail("Percorso non calcolato: " + (e.message || e));
    }
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
      : `<p class="muted">Nessun luogo salvato. Aggiungi i posti dove fai spesso benzina: casa, lavoro, il paese dei tuoi.</p>`;
    const results = placeResults.length
      ? `<ul class="results">${placeResults.map((r, i) => `<li><button data-place-add="${i}"><strong>${esc(r.name)}</strong><span class="muted small">${esc(r.detail || "")}</span></button></li>`).join("")}</ul>`
      : "";
    return `<header class="sh-head"><h2 id="sheet-title">Luoghi</h2><p class="muted">Scegli i posti dove controlli spesso i prezzi.</p></header>
      <section>
        <form id="place-form" class="search" autocomplete="off">
          <input id="place-q" type="search" placeholder="Comune o indirizzo" enterkeyhint="search" aria-label="Cerca un luogo">
          <button class="btn primary" type="submit">Cerca</button>
        </form>
        ${msg ? `<p class="muted small" role="status">${msg}</p>` : ""}
        ${results}
        <button class="btn here" data-place-here>Salva la mia posizione attuale</button>
      </section>
      <section><h3>I tuoi luoghi</h3>${list}</section>
      <p class="muted small">La ricerca dei luoghi usa OpenStreetMap (Nominatim). I luoghi restano solo su questo dispositivo.</p>`;
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

  // ---------- Eventi ----------
  function toggleFav(id) {
    id = String(id);
    if (favs.has(id)) favs.delete(id); else favs.add(id);
    store.set("favs", [...favs]);
  }

  document.addEventListener("click", (e) => {
    const t = e.target;
    if (t.closest("[data-places]")) { placeResults = []; openPlaces(); return; }
    if (t.closest("[data-car-new]")) { openCarForm(null); return; }
    if (t.closest("[data-trip-search]")) { tripSearch(); return; }
    const tTo = t.closest("[data-trip-to]");
    if (tTo) { readTripForm(); const p = places.find((x) => x.id === tTo.dataset.tripTo); if (p) { trip.to = { ...p }; trip.res = null; } openTrip(true); return; }
    const tPick = t.closest("[data-trip-pick]");
    if (tPick) { readTripForm(); trip.to = trip.results[+tPick.dataset.tripPick]; trip.results = []; trip.res = null; openTrip(true); return; }
    if (t.closest("[data-trip-clear]")) { readTripForm(); trip.to = null; trip.res = null; trip.tollReal = ""; openTrip(true); return; }
    if (t.closest("[data-settings]")) { openSettings(); return; }
    const cUse = t.closest("[data-car-use]");
    if (cUse) { useCar(cUse.dataset.carUse); openSettings(); return; }
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
      openSettings(); return;
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
      if (id === "seg-fuel") {
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
    if (t.closest("[data-go]")) return; // link nativo
    if (t.closest("[data-close]")) { closeSheet(); return; }
    if (t.closest("[data-retry]")) { settings.zone === "gps" && !state.gps ? locate() : load(); return; }
    if (t.closest("[data-clear]")) { settings.brand = ""; settings.fresh = false; settings.favOnly = false; render(); return; }
    const md = t.closest("[data-mode]");
    if (md) { settings.mode = +md.dataset.mode; saveSettings(); render(); return; }
    if (t.closest("[data-wider]")) { settings.radius = settings.radius < 5 ? 5 : settings.radius < 10 ? 10 : 15; saveSettings(); load(); return; }
    const open = t.closest("[data-open]");
    if (open && !open.closest("#sheet")) { openStation(open.dataset.open); return; }
  });
  document.addEventListener("submit", (e) => {
    if (e.target.id === "car-form") { e.preventDefault(); saveCarForm(e.target); }
    if (e.target.id === "trip-form") { e.preventDefault(); tripCalc(e.target); }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.matches("#trip-form [name=q]")) { e.preventDefault(); tripSearch(); return; }
    if ((e.key === "Enter" || e.key === " ") && e.target.matches("article[data-open]")) {
      e.preventDefault();
      openStation(e.target.dataset.open);
    }
  });

  $("#sel-sort").addEventListener("change", (e) => { settings.sort = e.target.value; saveSettings(); render(); });
  $("#sel-brand").addEventListener("change", (e) => { settings.brand = e.target.value; render(); });
  $("#tg-fresh").addEventListener("click", () => { settings.fresh = !settings.fresh; render(); });
  $("#tg-fav").addEventListener("click", () => { settings.favOnly = !settings.favOnly; render(); });
  $("#btn-refresh").addEventListener("click", () => {
    if (settings.zone === "gps") locate(); else load();
    loadHistoryMeta();
  });
  $("#btn-settings").addEventListener("click", openSettings);
  $("#btn-trip").addEventListener("click", () => openTrip());

  // Aggiorna quando l'app torna in primo piano dopo più di 10 minuti.
  let hiddenAt = 0;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) hiddenAt = Date.now();
    else if (hiddenAt && Date.now() - hiddenAt > 10 * 60e3) { settings.zone === "gps" ? locate() : load(); }
  });

  // ---------- Avvio ----------
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  loadHistoryMeta();
  if (settings.zone === "gps") locate(); else load();
  render();
})();
