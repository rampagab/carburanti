// Modalità demo (?demo=1): dati finti ma realistici, nessuna chiamata di rete.
// Varianti utili per i test: ?demo=empty (nessun risultato), ?demo=error (errore).
(function () {
  "use strict";

  // Generatore pseudo-casuale deterministico: stessa zona, stessi dati.
  function rng(seed) {
    let s = seed >>> 0 || 1;
    return function () {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
    return h >>> 0;
  }
  const r3 = (n) => Math.round(n * 1000) / 1000;

  // Sposta un punto di `km` nella direzione `deg`.
  function offset(lat, lng, km, deg) {
    const b = (deg * Math.PI) / 180;
    const dLat = (km * Math.cos(b)) / 111.32;
    const dLng = (km * Math.sin(b)) / (111.32 * Math.cos((lat * Math.PI) / 180));
    return { lat: lat + dLat, lng: lng + dLng };
  }
  function haversine(a, b) {
    const R = 6371, rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  }

  // Impianti di esempio attorno a Monselice (prezzi gasolio self reali del 20/11/2026).
  const MONSELICE = { lat: 45.2414, lng: 11.7497 };
  const SAMPLES = [
    { name: "Car Service Srl", brand: "PompeBianche", km: 0.72, deg: 40, diesel: 2.167, street: "Via Valli 12" },
    { name: "Monselice", brand: "Api-Ip", km: 2.57, deg: 200, diesel: 2.169, street: "Via Padova 88" },
    { name: "1390", brand: "Tamoil", km: 1.26, deg: 300, diesel: 2.169, street: "Via Costa Calcinara 41" },
    { name: "TAMOIL MONSELICE VIALE REPUBBLICA, 32", brand: "Tamoil", km: 0.73, deg: 120, diesel: 2.177, street: "Viale Della Repubblica 32" },
    { name: "VEGA MONSELICE VIA VOLTA", brand: "Vega", km: 0.85, deg: 160, diesel: 2.179, street: "Via Volta 9" },
    { name: "VEGA MONSELICE VIA MOTTA", brand: "Vega", km: 3.9, deg: 80, diesel: 2.179, street: "Via Motta 3" },
  ];
  const BRANDS = ["Agip Eni", "Q8", "Api-Ip", "Esso", "Tamoil", "PompeBianche", "Vega", "Repsol", "Costantin", "Beyfin"];
  const STREETS = ["Via Roma", "Via Garibaldi", "Via Padova", "Via Venezia", "Via Matteotti", "Via dell'Industria", "Viale Stazione", "Via Mazzini", "Strada Statale 16", "Via Europa"];

  const stationsCache = {};

  function buildStations(center) {
    const key = center.lat.toFixed(3) + "," + center.lng.toFixed(3);
    if (stationsCache[key]) return stationsCache[key];
    const rnd = rng(hash(key));
    const now = Date.now();
    const town = haversine(center, MONSELICE) < 2 ? "35043 MONSELICE (PD)" : "35100 PADOVA (PD)";
    const list = [];
    const isMonselice = town.includes("MONSELICE");

    const n = 34;
    for (let i = 0; i < n; i++) {
      const s = isMonselice && SAMPLES[i] ? SAMPLES[i] : null;
      const km = s ? s.km : 0.3 + rnd() * 14.5;
      const pos = offset(center.lat, center.lng, km, s ? s.deg : rnd() * 360);
      const brand = s ? s.brand : BRANDS[Math.floor(rnd() * BRANDS.length)];
      const diesel = s ? s.diesel : r3(2.168 + rnd() * 0.06 + (brand === "Agip Eni" || brand === "Q8" ? 0.03 : 0));
      const petrol = r3(diesel - 0.14 + rnd() * 0.04);
      const servito = 0.12 + rnd() * 0.1;
      const id = 40000 + (hash(key + i) % 59999);
      // Ultimo aggiornamento: per lo più recente, qualche dato vecchio.
      const hoursAgo = i % 11 === 7 ? 80 + rnd() * 200 : rnd() < 0.7 ? rnd() * 20 : 20 + rnd() * 50;
      const insertDate = new Date(now - hoursAgo * 3600e3).toISOString();

      const fuels = [
        { id: id * 10 + 1, price: diesel, name: "Gasolio", fuelId: 2, isSelf: true },
        { id: id * 10 + 2, price: r3(diesel + servito), name: "Gasolio", fuelId: 2, isSelf: false },
        { id: id * 10 + 3, price: petrol, name: "Benzina", fuelId: 1, isSelf: true },
        { id: id * 10 + 4, price: r3(petrol + servito), name: "Benzina", fuelId: 1, isSelf: false },
      ];
      if (rnd() < 0.3) fuels.push({ id: id * 10 + 5, price: r3(diesel + 0.09), name: "Blue Diesel", fuelId: 2, isSelf: true });
      if (rnd() < 0.4) fuels.push({ id: id * 10 + 6, price: r3(0.719 + rnd() * 0.08), name: "GPL", fuelId: 4, isSelf: false });
      if (rnd() < 0.2) fuels.push({ id: id * 10 + 7, price: r3(1.459 + rnd() * 0.15), name: "Metano", fuelId: 3, isSelf: false });

      const street = s ? s.street : STREETS[Math.floor(rnd() * STREETS.length)] + " " + (1 + Math.floor(rnd() * 150));
      list.push({
        id, name: s ? s.name : String(1000 + Math.floor(rnd() * 9000)), brand,
        location: pos, insertDate, fuels,
        address: street + " - " + town,
        _rnd: rnd(),
      });
    }
    stationsCache[key] = list;
    return list;
  }

  const byId = {};
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));
  const variant = new URLSearchParams(location.search).get("demo");

  async function search({ lat, lng, radius, fuel }) {
    await delay(450);
    if (variant === "error") throw new Error("Errore simulato (demo)");
    if (variant === "empty") return { success: true, center: { lat, lng }, results: [] };
    const center = { lat: +lat, lng: +lng };
    const results = buildStations(center)
      .map((s) => {
        byId[s.id] = s;
        return { ...s, distance: haversine(center, s.location).toFixed(2) };
      })
      .filter((s) => +s.distance <= radius)
      .filter((s) => !fuel || s.fuels.some((f) => f.fuelId === +fuel));
    return { success: true, center, results };
  }

  async function station(id) {
    await delay(300);
    const s = byId[id];
    if (!s) throw new Error("Impianto non trovato");
    const rnd = rng(id);
    const all = [
      { id: "1", description: "Food&Beverage" }, { id: "2", description: "Officina" },
      { id: "3", description: "Autolavaggio" }, { id: "4", description: "Bancomat" },
      { id: "5", description: "Servizi per disabili" }, { id: "6", description: "Wi-Fi" },
      { id: "7", description: "Area camper" },
    ];
    const services = all.filter(() => rnd() < 0.4);
    const known = rnd() < 0.5;
    const orariapertura = [1, 2, 3, 4, 5, 6, 7].map((d) => ({
      giornoSettimanaId: d,
      flagH24: false,
      flagChiusura: known && d === 7,
      flagNonComunicato: !known,
      flagOrarioContinuato: false,
      oraAperturaMattina: known ? "07:00" : null, oraChiusuraMattina: known ? "12:30" : null,
      oraAperturaPomeriggio: known ? "15:00" : null, oraChiusuraPomeriggio: known ? "19:30" : null,
    }));
    return {
      id: s.id, name: s.name, nomeImpianto: s.name, address: s.address, brand: s.brand,
      fuels: s.fuels.map((f) => ({ ...f, serviceAreaId: s.id, insertDate: s.insertDate, validityDate: s.insertDate })),
      phoneNumber: rnd() < 0.7 ? "0429 7" + String(Math.floor(rnd() * 90000) + 10000) : null,
      email: null, website: null, company: s.brand.toUpperCase() + " RETE SRL (demo)",
      services, orariapertura,
    };
  }

  // Storico finto: passeggiata casuale che termina sul prezzo attuale.
  function walk(seed, end, days, step) {
    const rnd = rng(seed);
    const out = new Array(days);
    let p = end;
    for (let i = days - 1; i >= 0; i--) {
      out[i] = r3(p);
      if (rnd() < 0.45) p += (rnd() - 0.55) * step;
    }
    return out;
  }
  function isoDay(offsetDays) {
    const d = new Date(Date.now() - offsetDays * 864e5);
    return d.toISOString().slice(0, 10);
  }

  async function history(id) {
    await delay(200);
    const s = byId[id];
    if (!s) return null;
    const days = 120;
    const series = {};
    for (const f of s.fuels) {
      const k = f.fuelId + "-" + (f.isSelf ? 1 : 0);
      if (series[k] !== undefined) continue;
      const cheapest = Math.min(...s.fuels.filter((g) => g.fuelId === f.fuelId && g.isSelf === f.isSelf).map((g) => g.price));
      series[k] = walk(id + f.fuelId * 7 + (f.isSelf ? 1 : 0), cheapest, days, 0.012);
    }
    const out = [];
    for (let i = 0; i < days; i++) {
      const v = {};
      for (const k in series) v[k] = series[k][i];
      out.push({ d: isoDay(days - 1 - i), v });
    }
    return { id, days: out };
  }

  async function average() {
    await delay(150);
    const days = 120;
    const base = { "2-1": 2.181, "2-0": 2.33, "1-1": 2.04, "1-0": 2.2, "4-0": 0.759, "3-0": 1.529 };
    const series = {};
    for (const k in base) series[k] = walk(hash(k), base[k], days, 0.008);
    const out = [];
    for (let i = 0; i < days; i++) {
      const v = {};
      for (const k in series) v[k] = { avg: series[k][i], min: r3(series[k][i] - 0.025), n: 40 };
      out.push({ d: isoDay(days - 1 - i), v });
    }
    return { updated: new Date().toISOString(), days: out };
  }

  const TOWNS = [
    ["Monselice (PD)", 45.2414, 11.7497], ["Padova (PD)", 45.4064, 11.8768], ["Este (PD)", 45.2283, 11.6563],
    ["Abano Terme (PD)", 45.3605, 11.7886], ["Rovigo (RO)", 45.0698, 11.7902], ["Vicenza (VI)", 45.5455, 11.5354],
    ["Venezia (VE)", 45.4408, 12.3155], ["Verona (VR)", 45.4384, 10.9916], ["Battaglia Terme (PD)", 45.2894, 11.7811],
  ];
  async function geocode(q) {
    await delay(300);
    const s = q.toLowerCase();
    return TOWNS.filter((t) => t[0].toLowerCase().includes(s))
      .map(([name, lat, lng]) => ({ name, detail: name.replace(/ \(.*/, "") + ", Veneto, Italia (demo)", lat, lng }));
  }

  async function route(a, b) {
    await delay(500);
    const km = haversine(a, b) * 1.3;
    const mwKm = km > 25 ? km * 0.7 : 0;
    return { km, min: km / 80 * 60, mwKm, roads: mwKm ? ["A13"] : [] };
  }

  window.CarburantiDemo = { search, station, history, average, geocode, route };
})();
