#!/usr/bin/env python3
"""Fotografia giornaliera dei prezzi per lo storico della web app.

Eseguito ogni mattina da GitHub Actions (.github/workflows/snapshot.yml).
Solo libreria standard di Python, nessuna chiave.

Fonte principale: API del sito MIMIT (search/zone, tempo reale).
Ripiego: open data ufficiali MIMIT (CSV giornalieri, licenza IODL 2.0).

Scrive:
  data/history/{id}.json  storico per impianto (max 365 giorni)
  data/average.json       media/minimo giornaliero dell'area per carburante e modalità
  data/meta.json          ultimo aggiornamento, fonte, zone raccolte
"""
import csv
import io
import json
import math
import os
import sys
import urllib.request
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

ZONES = [
    {"name": "Monselice", "lat": 45.2414, "lng": 11.7497, "radius": 15},
    {"name": "Padova", "lat": 45.4064, "lng": 11.8768, "radius": 15},
]
BASE_FUELS = {1: "Benzina", 2: "Gasolio", 3: "Metano", 4: "GPL"}
CSV_FUELS = {"benzina": 1, "gasolio": 2, "metano": 3, "gpl": 4}
MAX_DAYS = 365

API = "https://carburanti.mise.gov.it/ospzApi/"
CSV_REGISTRY = "https://www.mimit.gov.it/images/exportCSV/anagrafica_impianti_attivi.csv"
CSV_PRICES = "https://www.mimit.gov.it/images/exportCSV/prezzo_alle_8.csv"
HEADERS = {
    "Content-Type": "application/json",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "it-IT,it;q=0.9",
    "Origin": "https://carburanti.mise.gov.it",
    "Referer": "https://carburanti.mise.gov.it/ospzSearch/zona",
    "User-Agent": "Mozilla/5.0 (compatible; carburanti-personal-snapshot/1.0)",
}

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
DATA = os.path.join(ROOT, "data")


def http(url, body=None, timeout=60):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=HEADERS, method="POST" if body is not None else "GET")
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return res.read()


def km(a_lat, a_lng, b_lat, b_lng):
    r = math.pi / 180
    x = math.sin((b_lat - a_lat) * r / 2) ** 2 + math.cos(a_lat * r) * math.cos(b_lat * r) * math.sin((b_lng - a_lng) * r / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(x))


def valid_price(p):
    return isinstance(p, (int, float)) and 0.3 < p < 5


# ---------- Fonte A: API ----------
def from_api(fetch=http):
    """Ritorna {id: {"name","brand","prices":{"2-1":2.167,...}}}."""
    stations = {}
    for z in ZONES:
        body = {"points": [{"lat": z["lat"], "lng": z["lng"]}], "radius": z["radius"], "fuelType": "0-x", "priceOrder": "asc"}
        data = json.loads(fetch(API + "search/zone", body))
        results = data.get("results") or []
        if not results:
            raise RuntimeError(f"Nessun risultato per {z['name']}")
        for r in results:
            prices = {}
            for f in r.get("fuels") or []:
                fid, p = f.get("fuelId"), f.get("price")
                if fid in BASE_FUELS and valid_price(p):
                    key = f"{fid}-{1 if f.get('isSelf') else 0}"
                    prices[key] = min(prices.get(key, 99), round(float(p), 3))
            if prices:
                stations[str(r["id"])] = {"name": r.get("name") or "", "brand": r.get("brand") or "", "prices": prices}
    return stations


# ---------- Fonte B: CSV open data ----------
def read_csv(raw):
    text = raw.decode("utf-8-sig", errors="replace")
    lines = text.splitlines()
    if lines and lines[0].lower().startswith("estrazione"):
        lines = lines[1:]
    header = lines[0]
    # Dal 10/02/2026 il separatore è cambiato: lo rilevo dall'intestazione.
    sep = max(["|", ";", ",", "\t"], key=header.count)
    return list(csv.DictReader(io.StringIO("\n".join(lines)), delimiter=sep))


def col(row, *names):
    low = {k.strip().lower(): v for k, v in row.items() if k}
    for n in names:
        if n.lower() in low:
            return (low[n.lower()] or "").strip()
    return ""


def from_csv(fetch=http):
    registry = read_csv(fetch(CSV_REGISTRY, None, 180))
    wanted = {}
    for row in registry:
        try:
            lat = float(col(row, "Latitudine").replace(",", "."))
            lng = float(col(row, "Longitudine").replace(",", "."))
        except ValueError:
            continue
        if any(km(z["lat"], z["lng"], lat, lng) <= z["radius"] for z in ZONES):
            sid = col(row, "idImpianto")
            wanted[sid] = {"name": col(row, "Nome Impianto"), "brand": col(row, "Bandiera"), "prices": {}}
    for row in read_csv(fetch(CSV_PRICES, None, 180)):
        sid = col(row, "idImpianto")
        if sid not in wanted:
            continue
        fid = CSV_FUELS.get(col(row, "descCarburante").lower())
        if not fid:
            continue
        try:
            p = round(float(col(row, "prezzo").replace(",", ".")), 3)
        except ValueError:
            continue
        if not valid_price(p):
            continue
        key = f"{fid}-{1 if col(row, 'isSelf') in ('1', 'true', 'True') else 0}"
        prices = wanted[sid]["prices"]
        prices[key] = min(prices.get(key, 99), p)
    return {k: v for k, v in wanted.items() if v["prices"]}


# ---------- Scrittura ----------
def load_json(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def save_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
        f.write("\n")


def upsert_day(days, day, value):
    days = [d for d in days if d.get("d") != day]
    days.append({"d": day, "v": value})
    days.sort(key=lambda d: d["d"])
    return days[-MAX_DAYS:]


def write(stations, source, day, now_iso, data_dir=DATA):
    for sid, s in stations.items():
        path = os.path.join(data_dir, "history", f"{sid}.json")
        h = load_json(path, {"id": int(sid) if sid.isdigit() else sid, "days": []})
        h["name"], h["brand"] = s["name"], s["brand"]
        h["days"] = upsert_day(h.get("days", []), day, s["prices"])
        save_json(path, h)

    per_key = {}
    for s in stations.values():
        for k, p in s["prices"].items():
            per_key.setdefault(k, []).append(p)
    summary = {k: {"avg": round(sum(v) / len(v), 3), "min": min(v), "n": len(v)} for k, v in sorted(per_key.items())}
    avg_path = os.path.join(data_dir, "average.json")
    avg = load_json(avg_path, {"days": []})
    avg["updated"] = now_iso
    avg["days"] = upsert_day(avg.get("days", []), day, summary)
    save_json(avg_path, avg)

    save_json(os.path.join(data_dir, "meta.json"), {
        "updated": now_iso,
        "day": day,
        "source": source,
        "stations": len(stations),
        "zones": ZONES,
    })
    return summary


def main():
    now = datetime.now(timezone.utc)
    day = now.astimezone(ZoneInfo("Europe/Rome")).date().isoformat()
    try:
        stations, source = from_api(), "api"
    except Exception as e:  # noqa: BLE001 - qualunque errore: si passa ai CSV
        print(f"API non disponibile ({e}); uso i CSV open data.", file=sys.stderr)
        stations, source = from_csv(), "csv"
    if not stations:
        print("Nessun dato raccolto.", file=sys.stderr)
        return 1
    summary = write(stations, source, day, now.isoformat(timespec="seconds"))
    print(f"{day}: {len(stations)} impianti da {source}")
    for k, v in summary.items():
        print(f"  {k}: media {v['avg']:.3f}  min {v['min']:.3f}  ({v['n']})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
