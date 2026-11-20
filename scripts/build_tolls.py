#!/usr/bin/env python3
"""Tariffe di pedaggio stimate per autostrada (classe A, auto) per il pianificatore di viaggio.

Fonti, tutte pubbliche e senza chiave:
- Autostrade per l'Italia, "Come si calcola il pedaggio": tariffe unitarie €/km (IVA inclusa)
  di pianura e di montagna per la classe A. Se la pagina non è raggiungibile uso i valori qui sotto.
- Autorità di Regolazione dei Trasporti (ART) su dati.gov.it, licenza CC BY 4.0:
  D17 "La rete autostradale" (tratte, concessionaria, km a pedaggio) e
  D22 "Ripartizione rete autostradale montagna/pianura" (quota di montagna per concessionaria).

Per ogni autostrada (A4, A13, ...) calcola la quota di montagna media, pesata sui km delle concessionarie
che la gestiscono, e quindi una tariffa €/km. Il pedaggio vero dipende dai caselli e dalla concessionaria
(alcune hanno tariffe più alte): resta una stima, che nell'app si può correggere con l'importo reale.

Scrive data/tolls.json. Solo libreria standard.
"""
import csv
import io
import json
import os
import re
import sys
import urllib.request
from datetime import date

ASPI_URL = "https://www.autostrade.it/it/servizi-al-cliente/pedaggio/come-si-calcola-il-pedaggio"
# Valori pubblicati da Autostrade per l'Italia, aggiornati al 1° gennaio 2026 (IVA 22% inclusa).
FALLBACK = {"pianura": 0.07869, "montagna": 0.09315, "valid_from": "2026-01-01"}
ART = "https://bdt.autorita-trasporti.it/wp-content/uploads/dcat/"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "tolls.json")
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; carburanti-personal-app/1.0)"}


def get(url, timeout=60):
    with urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS), timeout=timeout) as r:
        return r.read()


def aspi_tariffs():
    try:
        html = get(ASPI_URL).decode("utf-8", "replace")
        text = re.sub(r"<[^>]+>", " ", html)
        text = re.sub(r"\s+", " ", text)
        num = r"(0,\d{4,5})"
        p = re.search(r"Tariffa di pianura[^0-9]*" + num, text)
        m = re.search(r"Tariffa di montagna[^0-9]*" + num, text)
        when = re.search(r"aggiornate al (\d{1,2}°? \w+ \d{4})", text)
        if p and m:
            vals = {"pianura": float(p.group(1).replace(",", ".")), "montagna": float(m.group(1).replace(",", "."))}
            if 0.03 < vals["pianura"] < 0.3 and 0.03 < vals["montagna"] < 0.3:
                vals["valid_from"] = when.group(1) if when else ""
                vals["source"] = "autostrade.it"
                return vals
    except Exception as e:  # noqa: BLE001
        print(f"Tariffe Autostrade non lette ({e}): uso i valori di riserva.", file=sys.stderr)
    return {**FALLBACK, "source": "valori di riserva (Autostrade per l'Italia, 2026)"}


def art_csv(name, years):
    for y in years:
        try:
            raw = get(f"{ART}{name}{y}.csv").decode("utf-8-sig", "replace")
            if raw.strip():
                return list(csv.DictReader(io.StringIO(raw), delimiter=";")), y
        except Exception:  # noqa: BLE001
            continue
    raise RuntimeError(f"{name}: nessun anno disponibile")


def num(s):
    try:
        return float(str(s).replace(".", "").replace(",", ".")) if re.search(r"\d", str(s)) else 0.0
    except ValueError:
        return 0.0


def main():
    tariffs = aspi_tariffs()
    years = list(range(date.today().year, 2021, -1))
    d17, y17 = art_csv("D17-La-rete-autostradale-", years)
    d22, y22 = art_csv("D22-Ripartizione-rete-autostradale-montagna-pianura-anno-", years)

    share = {}
    for r in d22:
        ab = (r.get("Abbreviazione") or "").strip()
        if ab:
            share[ab] = num(r.get("%montagna"))
    avg_share = sum(share.values()) / len(share) if share else 0.25

    refs = {}
    for r in d17:
        km = num(r.get("KmPedaggiati"))
        if km <= 0:
            continue
        ab = (r.get("Denominazione breve azienda") or "").strip()
        s = share.get(ab, share.get((r.get("Concessione") or "").strip(), avg_share))
        tratta = r.get("Tratta") or ""
        for ref in set(re.findall(r"\bA\d+", tratta.upper())):
            x = refs.setdefault(ref, {"km": 0.0, "mkm": 0.0, "conc": set()})
            x["km"] += km
            x["mkm"] += km * s
            x["conc"].add(ab)

    out_refs = {}
    for ref, x in sorted(refs.items(), key=lambda kv: int(kv[0][1:])):
        s = x["mkm"] / x["km"]
        rate = tariffs["pianura"] * (1 - s) + tariffs["montagna"] * s
        out_refs[ref] = {"rate": round(rate, 5), "mont": round(s, 2), "conc": sorted(c for c in x["conc"] if c)}

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({
            "updated": date.today().isoformat(),
            "class": "A",
            "tariffs": tariffs,
            "default_rate": round(tariffs["pianura"] * (1 - avg_share) + tariffs["montagna"] * avg_share, 5),
            "rounding": 0.10,
            "sources": [
                f"Autostrade per l'Italia – tariffe unitarie classe A ({tariffs.get('source')})",
                f"ART – D17 La rete autostradale {y17}, D22 Ripartizione montagna/pianura {y22} (CC BY 4.0)",
            ],
            "refs": out_refs,
        }, f, ensure_ascii=False, separators=(",", ":"))
        f.write("\n")
    print(f"Tariffe {tariffs['pianura']} / {tariffs['montagna']} €/km ({tariffs.get('source')}); {len(out_refs)} autostrade")
    for ref, v in list(out_refs.items())[:40]:
        print(f"  {ref}: {v['rate']:.4f} €/km  montagna {v['mont']:.0%}  {', '.join(v['conc'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
