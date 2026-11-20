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
    const [street, rest] = String(a).split(" - ");
    const fixCase = (s) => s.toLowerCase().replace(/(^|[\s'(-])(\p{L})/gu, (m, p, c) => p + c.toUpperCase())
      .replace(/\b(Della|Delle|Dello|Degli|Dei|Del|Di|Da|Al|Alla|E)\b/g, (w) => w.toLowerCase())
      .replace(/\b(Dell|Dall|Nell|Sull)'/g, (w) => w.toLowerCase()).replace(/'(\p{L})/gu, (m, c) => "'" + c.toUpperCase())
      .replace(/^\p{L}/u, (c) => c.toUpperCase());
    let out = fixCase(street.trim());
    if (rest) {
      const m = rest.match(/^\s*\d{5}\s+(.+?)\s*(\(([A-Z]{2})\))?\s*$/);
      out += ", " + (m ? fixCase(m[1]) + (m[3] ? " (" + m[3] + ")" : "") : rest.trim());
    }
    return out;
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
    reqId: 0,
  };

  function currentCenter() {
    if (settings.zone === "gps") return state.gps;
    const z = (CFG.ZONES || []).find((z) => z.id === settings.zone) || (CFG.ZONES || [])[0];
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

  function visible() {
    let rows = priced();
    if (settings.brand) rows = rows.filter((x) => (x.s.brand || "") === settings.brand);
    if (settings.fresh) rows = rows.filter((x) => ago(x.s.insertDate).hours <= 24);
    if (settings.favOnly) rows = rows.filter((x) => favs.has(String(x.s.id)));
    const byPrice = (a, b) => a.f.price - b.f.price || (a.s.distance ?? 99) - (b.s.distance ?? 99);
    const sorters = {
      price: byPrice,
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
      if (settings.zone === "gps") return locate();
      return;
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
          ? "Permesso di posizione negato. Su iPhone: Impostazioni › Privacy › Localizzazione › Safari. Oppure scegli una zona."
          : "Posizione non trovata. Riprova o scegli una zona.";
        render();
      },
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 120000 }
    );
  }

  // ---------- Render ----------
  function renderControls() {
    const zones = [{ id: "gps", name: "Vicino a me" }].concat(CFG.ZONES || []);
    $("#zones").innerHTML = zones.map((z) =>
      `<button role="radio" aria-checked="${settings.zone === z.id}" data-zone="${esc(z.id)}">${z.id === "gps" ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2v3M12 19v3M2 12h3M19 12h3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="12" r="6" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="2" fill="currentColor"/></svg>' : ""}${esc(z.name)}</button>`
    ).join("");
    const segs = { "#seg-fuel": settings.fuel, "#seg-mode": settings.mode, "#seg-radius": settings.radius };
    for (const sel in segs) {
      $$(sel + " button").forEach((b) => {
        b.setAttribute("role", "radio");
        b.setAttribute("aria-checked", String(String(b.dataset.v) === String(segs[sel])));
      });
    }
    $("#sel-sort").value = settings.sort;
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

  function trendInfo() {
    const avg = state.average;
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
    const saving = (mean - min) * settings.liters;
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
        <span><strong>Media area ${label}</strong>${advice ? `<br><span class="muted">${advice}</span>` : ""}</span></div>`;
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
          <div><dt>Risparmio ${settings.liters} ${+settings.fuel === 3 ? "kg" : "L"}</dt><dd>${nf2.format(saving)} €</dd></div>
          <div><dt>Impianti</dt><dd>${rows.length}</dd></div>
        </dl>
      </div>
      ${trend}
      <div class="sum-foot muted">${esc(center ? center.name : "")} · raggio ${settings.radius} km${state.loading ? ' · <span class="spin" aria-label="Caricamento"></span>' : ""}</div>
    </div>`;
  }

  function cardHTML({ s, f }, min) {
    const a = ago(s.insertDate);
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
          ${f.name && f.name !== FUELS[settings.fuel] ? `<span class="prod">${esc(f.name)}</span>` : ""}</p>
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
        el.innerHTML = `<div class="card state err"><h2>Non riesco a caricare i prezzi</h2><p>${esc(state.error)}</p><button class="btn" data-retry>Riprova</button></div>`;
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
    let html = rows.map((r) => cardHTML(r, min)).join("");
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
      return `<p class="muted">Storico non ancora disponibile: si costruisce giorno per giorno con la raccolta automatica.</p>`;
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
    openSheet(`<header class="sh-head"><h2 id="sheet-title">Impostazioni</h2></header>
      <section>
        <label class="field"><span>Litri (o kg) del pieno</span>
          <input id="in-liters" type="number" inputmode="numeric" min="5" max="200" step="1" value="${settings.liters}"></label>
        <p class="muted small">Serve per calcolare il risparmio nel riepilogo.</p>
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

  // ---------- Eventi ----------
  function toggleFav(id) {
    id = String(id);
    if (favs.has(id)) favs.delete(id); else favs.add(id);
    store.set("favs", [...favs]);
  }

  document.addEventListener("click", (e) => {
    const t = e.target;
    const zone = t.closest("[data-zone]");
    if (zone) {
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
  document.addEventListener("keydown", (e) => {
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
    api.average().then((a) => { if (a) { state.average = a; render(); } });
  });
  $("#btn-settings").addEventListener("click", openSettings);

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
  api.average().then((a) => { if (a) { state.average = a; render(); } });
  if (settings.zone === "gps") locate(); else load();
  render();
})();
