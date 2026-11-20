#!/usr/bin/env python3
"""Loghi dei marchi dei distributori, presi dal sito dell'Osservatorio prezzi carburanti (MIMIT).

Usa l'endpoint pubblico registry/alllogos (lo stesso della mappa del sito) e salva, per ogni marchio,
il logo quadrato 50×50 in data/logos/{marchio}.png, più data/logos/index.json che collega il nome
del marchio (normalizzato) al file. I loghi sono marchi dei rispettivi titolari e servono solo a
riconoscere il distributore. Solo libreria standard.
"""
import base64
import json
import os
import re
import sys
import urllib.request

URL = "https://carburanti.mise.gov.it/ospzApi/registry/alllogos"
HEADERS = {
    "Accept": "application/json",
    "Referer": "https://carburanti.mise.gov.it/ospzSearch/zona",
    "User-Agent": "Mozilla/5.0 (compatible; carburanti-personal-app/1.0)",
}
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "logos")


def key(name):
    """Stessa normalizzazione usata dall'app: "Agip Eni" e "AgipEni" → "agipeni"."""
    return re.sub(r"[^a-z0-9]", "", (name or "").lower())


def main():
    req = urllib.request.Request(URL, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=120) as r:
        data = json.load(r)
    items = data.get("loghi") if isinstance(data, dict) else data
    os.makedirs(OUT, exist_ok=True)
    for f in os.listdir(OUT):
        if f.endswith(".png"):
            os.remove(os.path.join(OUT, f))
    index, by_content = {}, {}
    for it in items or []:
        name = it.get("bandiera") or ""
        k = key(name)
        logo = next((m for m in it.get("logoMarkerList") or [] if m.get("tipoFile") == "logo" and m.get("content")), None)
        if not k or not logo or (logo.get("estensione") or "png").lower() != "png":
            continue
        raw = base64.b64decode(logo["content"])
        if not raw.startswith(b"\x89PNG") or len(raw) > 60000:
            continue
        # Loghi identici (es. "Pompe Bianche" e altri senza marchio) condividono un solo file.
        file = by_content.get(raw)
        if not file:
            file = k + ".png"
            with open(os.path.join(OUT, file), "wb") as fh:
                fh.write(raw)
            by_content[raw] = file
        index[k] = file
    with open(os.path.join(OUT, "index.json"), "w", encoding="utf-8") as fh:
        json.dump({"source": "MIMIT – Osservatorio prezzi carburanti (registry/alllogos)", "logos": index}, fh, ensure_ascii=False, separators=(",", ":"))
    print(f"{len(index)} marchi, {len(by_content)} file")
    return 0


if __name__ == "__main__":
    sys.exit(main())
