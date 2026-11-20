#!/usr/bin/env python3
"""Database marca › modello › motorizzazione per il configuratore auto della web app.

Fonte: Agenzia europea dell'ambiente (EEA), "Monitoring of CO2 emissions from passenger cars"
(licenza CC BY 4.0), auto immatricolate in Italia. Interrogata con l'API pubblica DiscoData, senza chiave.

Scrive data/cars/index.json (marche) e data/cars/{marca}.json (modelli e motorizzazioni).
Da rilanciare al massimo una volta l'anno, quando l'EEA pubblica un nuovo anno (workflow "Database auto").
Solo libreria standard.
"""
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

YEARS = range(2012, 2031)          # gli anni non ancora pubblicati restituiscono semplicemente zero righe
MIN_REGISTRATIONS = 5             # sotto questa soglia: importazioni o errori di registrazione
MIN_MODEL_REGISTRATIONS = 100     # modelli più rari: allestimenti speciali, carrozzieri
URL = "https://discodata.eea.europa.eu/sql"
TABLE = "[CO2Emission].[latest].[co2cars]"
# Carburante EEA → (id carburante dell'app, ibrida)
FUELS = {
    "PETROL": (1, False), "PETROL/ELECTRIC": (1, True),
    "DIESEL": (2, False), "DIESEL/ELECTRIC": (2, True),
    "NG": (3, False), "NG-BIOMETHANE": (3, False), "NG/BIOMETHANE": (3, False),
    "LPG": (4, False),
}
# kg di CO2 per litro (per kg nel caso del metano): servono quando manca il consumo dichiarato.
CO2_PER_UNIT = {1: 2.31, 2: 2.64, 3: 2.66, 4: 1.64}

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "cars")


def query(sql):
    # Il server rifiuta ORDER BY e COUNT(*): uso solo GROUP BY e funzioni di aggregazione.
    qs = urllib.parse.urlencode({"query": sql, "p": 1, "nrOfHits": 200000})
    req = urllib.request.Request(URL + "?" + qs, headers={"User-Agent": "carburanti-personal-app/1.0", "Accept": "application/json"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=300) as r:
                return json.load(r).get("results") or []
        except Exception as e:  # noqa: BLE001
            if attempt == 3:
                raise
            print(f"  nuovo tentativo ({e})", file=sys.stderr)
            time.sleep(5 * (attempt + 1))


def year_rows(year):
    return query(
        f"SELECT Mk, Cn, Ft, [Ec (cm3)] AS cc, [Ep (KW)] AS kw, AVG(Fc) AS fc, "
        f"AVG([Ewltp (g/km)]) AS wltp, AVG([Enedc (g/km)]) AS nedc, AVG([E (g/km)]) AS e, SUM(R) AS n "
        f"FROM {TABLE} WHERE MS='IT' AND Year={int(year)} "
        f"GROUP BY Mk, Cn, Ft, [Ec (cm3)], [Ep (KW)]"
    )


# Nomi di marca scritti in modi diversi nei dati EEA → un solo nome.
MAKE_RULES = [
    (r"^MERCEDES[- ]?AMG", "MERCEDES-AMG"), (r"^MERCEDES", "MERCEDES-BENZ"), (r"^(VOLKSWAGEN|VW)\b", "VOLKSWAGEN"),
    (r"^FIAT\b", "FIAT"), (r"^FORD\b", "FORD"), (r"^JAGUAR\b", "JAGUAR"), (r"^LAND ?ROVER", "LAND ROVER"),
    (r"^MITSUBISHI", "MITSUBISHI"), (r"^MORGAN", "MORGAN"), (r"^ROLLS[- ]?ROYCE", "ROLLS-ROYCE"),
    (r"ALPINE", "ALPINE"), (r"^SSANG", "SSANGYONG"), (r"^LANCIA\b", "LANCIA"), (r"^DR\b", "DR"),
    (r"^ALFA\b", "ALFA ROMEO"), (r"^BMW\b", "BMW"), (r"^ROVER", "ROVER"), (r"^LYNK", "LYNK & CO"),
    (r"^CITRO", "CITROEN"), (r"^SKODA", "SKODA"), (r"^HYUNDAI", "HYUNDAI"), (r"^KIA\b", "KIA"), (r"^TOYOTA", "TOYOTA"),
    (r"^RENAULT", "RENAULT"), (r"^PEUGEOT", "PEUGEOT"), (r"^OPEL", "OPEL"), (r"^NISSAN", "NISSAN"), (r"^SUZUKI", "SUZUKI"),
]


def clean_make(mk):
    m = re.sub(r"\s+", " ", (mk or "").upper().strip())
    for pat, name in MAKE_RULES:
        if re.search(pat, m):
            return name
    return m


def clean_model(make, cn):
    m = re.sub(r"[^A-Z0-9+\-. ]", " ", (cn or "").upper())
    m = re.sub(r"\s+", " ", m).strip()
    for prefix in sorted({make, make.split(" ")[0].split("-")[0], "ALFA", "VW", "MERCEDES-BENZ", "MERCEDES BENZ", "MERCEDES", "MB", "LANCIA"}, key=len, reverse=True):
        if m.startswith(prefix + " ") and len(m) > len(prefix) + 1:
            m = m[len(prefix) + 1:]
    return m


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def main():
    agg = {}
    for y in YEARS:
        rows = year_rows(y)
        print(f"{y}: {len(rows)} combinazioni")
        for r in rows:
            ft = (r.get("Ft") or "").upper().strip()
            if ft not in FUELS:
                continue
            fuel, hybrid = FUELS[ft]
            make = clean_make(r.get("Mk"))
            model = clean_model(make, r.get("Cn"))
            cc, kw, n = r.get("cc"), r.get("kw"), r.get("n") or 0
            if not make or not model or not kw or n <= 0:
                continue
            # Fino al 2016 la CO2 (ciclo NEDC) sta nella colonna "E (g/km)".
            old = r.get("nedc") or r.get("e")
            co2 = r.get("wltp") or old
            nedc = not r.get("wltp") and bool(old)
            # Consumo dichiarato (L/100 km, kg/100 km per il metano). Per GPL e metano il campo Fc
            # spesso si riferisce alla benzina: per loro uso sempre la CO2.
            fc = r.get("fc") if fuel in (1, 2) else None
            l100 = fc if fc and 1 < fc < 30 else (co2 / 10 / CO2_PER_UNIT[fuel] if co2 else None)
            if not l100 or l100 < 1.5 or l100 > 30:
                continue
            if hybrid and co2 and co2 < 70:
                continue  # ibride plug-in: il dato ufficiale non rappresenta il consumo a batteria scarica
            key = (make, model, fuel, hybrid, int(round(cc or 0, -1)), int(kw))
            a = agg.setdefault(key, {"n": 0, "sum": 0.0, "y0": y, "y1": y, "nedc": 0})
            a["n"] += n
            a["sum"] += l100 * n
            a["y0"], a["y1"] = min(a["y0"], y), max(a["y1"], y)
            a["nedc"] += n if nedc else 0

    # Stesso modello scritto in modi diversi ("500L" / "500 L"): unisco e tengo il nome più usato.
    by_compact, names = {}, {}
    for (make, model, *_), a in agg.items():
        ck = (make, re.sub(r"[\s.\-]", "", model))
        names.setdefault(ck, {}).setdefault(model, 0)
        names[ck][model] += a["n"]
    display = {ck: max(v.items(), key=lambda kv: kv[1])[0] for ck, v in names.items()}
    merged = {}
    for (make, model, fuel, hybrid, cc, kw), a in agg.items():
        key = (make, display[(make, re.sub(r"[\s.\-]", "", model))], fuel, hybrid, cc, kw)
        m = merged.setdefault(key, {"n": 0, "sum": 0.0, "y0": a["y0"], "y1": a["y1"], "nedc": 0})
        m["n"] += a["n"]; m["sum"] += a["sum"]; m["nedc"] += a["nedc"]
        m["y0"], m["y1"] = min(m["y0"], a["y0"]), max(m["y1"], a["y1"])
    model_total = {}
    for (make, model, *_), a in merged.items():
        model_total[(make, model)] = model_total.get((make, model), 0) + a["n"]

    makes = {}
    for (make, model, fuel, hybrid, cc, kw), a in merged.items():
        # Allestimenti speciali e carrozzieri con poche immatricolazioni: li tralascio.
        if a["n"] < MIN_REGISTRATIONS or model_total[(make, model)] < MIN_MODEL_REGISTRATIONS:
            continue
        v = {"f": fuel, "cc": cc or None, "kw": kw, "l": round(a["sum"] / a["n"], 1), "y": [a["y0"], a["y1"]], "n": a["n"]}
        if hybrid:
            v["h"] = 1
        if a["nedc"] > a["n"] / 2:
            v["nedc"] = 1
        makes.setdefault(make, {}).setdefault(model, []).append(v)

    os.makedirs(OUT, exist_ok=True)
    for f in os.listdir(OUT):
        if f.endswith(".json"):
            os.remove(os.path.join(OUT, f))
    index = []
    for make, models in makes.items():
        total = sum(v["n"] for vs in models.values() for v in vs)
        out_models = []
        for model, vs in models.items():
            vs.sort(key=lambda v: (v["f"], v.get("h", 0), v["cc"] or 0, v["kw"]))
            out_models.append({"m": model, "n": sum(v["n"] for v in vs), "v": vs})
        out_models.sort(key=lambda m: m["m"])
        s = slug(make)
        with open(os.path.join(OUT, s + ".json"), "w", encoding="utf-8") as fh:
            json.dump({"make": make, "models": out_models}, fh, ensure_ascii=False, separators=(",", ":"))
        index.append({"make": make, "file": s, "n": total, "models": len(out_models)})
    index.sort(key=lambda m: m["make"])
    with open(os.path.join(OUT, "index.json"), "w", encoding="utf-8") as fh:
        json.dump({
            "source": "EEA – Monitoring of CO2 emissions from passenger cars (CC BY 4.0), immatricolazioni in Italia",
            "years": [min(a["y0"] for a in agg.values()), max(a["y1"] for a in agg.values())],
            "makes": index,
        }, fh, ensure_ascii=False, separators=(",", ":"))
    variants = sum(len(vs) for mk in makes.values() for vs in mk.values())
    print(f"{len(index)} marche, {variants} motorizzazioni")
    return 0


if __name__ == "__main__":
    sys.exit(main())
