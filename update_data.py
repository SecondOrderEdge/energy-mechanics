#!/usr/bin/env python3
"""
update_data.py  ·  Petroleum balance data refresh
---------------------------------------------------
Pulls the latest weekly observations from the EIA v2 API for every series
used by the petroleum-balance infographic and writes data.json.

Runs headless in a GitHub Action (server-side -> no browser CORS), and
locally too:

    export EIA_API_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
    python update_data.py

Free EIA key (instant): https://www.eia.gov/opendata/register.php

EIA v2 weekly petroleum series live under the petroleum/sum/sndw dataset,
keyed by `series` IDs (the same WPSR codes shown on the chart nodes).
"""

import os
import sys
import json
import time
import datetime as dt
from urllib.request import urlopen, Request
from urllib.parse import urlencode
from urllib.error import URLError, HTTPError

KEY = os.environ.get("EIA_API_KEY", "").strip()
# Weekly supply/disposition dataset (WPSR balance sheet)
BASE_SNDW = "https://api.eia.gov/v2/petroleum/sum/sndw/data/"
# Daily spot-price dataset (WTI Cushing etc.)
BASE_SPT  = "https://api.eia.gov/v2/petroleum/pri/spt/data/"

# WTI Cushing spot price (daily), $/bbl
WTI_SERIES = "RWTC"

# EIA weekly series IDs (WPSR). Units: MBBL/D for flows, MBBL for stocks.
FLOW_SERIES = {
    "production":      "WCRFPUS2",   # Field production of crude oil
    "crude_imports":   "WCEIMUS2",   # Crude oil imports
    "crude_exports":   "WCREXUS2",   # Crude oil exports
    "refinery_inputs": "WCRRIUS2",   # Refiner net crude inputs
    "gasoline_prod":   "WGFRPUS2",   # Finished motor gasoline, refiner net production
    "distillate_prod": "WDIRPUS2",   # Distillate fuel oil, refiner net production
    "product_supplied":"WRPUPUS2",   # Total products supplied (demand proxy)
}
STOCK_SERIES = {
    "commercial_crude":"WCESTUS1",   # Commercial crude stocks (excl. SPR)
    "spr":             "WCSSTUS1",   # SPR crude stocks
    "gasoline":        "WGTSTUS1",   # Total motor gasoline stocks
    "distillate":      "WDISTUS1",   # Distillate stocks
}
# Refinery utilization (percent) — its own series
UTIL_SERIES = "WPULEUS3"


def eia_latest(series_id, base=BASE_SNDW, frequency="weekly", retries=3):
    """Return (value: float, period: 'YYYY-MM-DD') of the most recent obs."""
    params = {
        "api_key": KEY,
        "frequency": frequency,
        "data[0]": "value",
        "facets[series][]": series_id,
        "sort[0][column]": "period",
        "sort[0][direction]": "desc",
        "offset": 0,
        "length": 5,
    }
    url = base + "?" + urlencode(params)
    for attempt in range(retries):
        try:
            req = Request(url, headers={"User-Agent": "petroleum-plumbing/1.0"})
            with urlopen(req, timeout=30) as r:
                payload = json.load(r)
            rows = payload.get("response", {}).get("data", [])
            for row in rows:
                v = row.get("value")
                if v not in (None, "", "."):
                    return float(v), row.get("period")
            raise ValueError(f"no valid obs for {series_id}")
        except (URLError, HTTPError, ValueError, KeyError) as e:
            if attempt == retries - 1:
                raise
            time.sleep(1.5 * (attempt + 1))


def pull(group):
    out, periods = {}, {}
    for k, sid in group.items():
        val, period = eia_latest(sid)
        out[k], periods[k] = val, period
        print(f"  {k:18s} {sid:10s} = {val:>10,.1f}  ({period})")
    return out, periods


def vintage(period_str):
    d = dt.datetime.strptime(period_str, "%Y-%m-%d")
    return "WK " + d.strftime("%b %-d %Y").upper()


def main():
    if not KEY:
        print("ERROR: EIA_API_KEY not set.", file=sys.stderr)
        sys.exit(1)

    print("Pulling petroleum flows…")
    flows, fp = pull(FLOW_SERIES)
    print("Pulling petroleum stocks…")
    stocks, sp = pull(STOCK_SERIES)
    print("Pulling refinery utilization…")
    util, _ = eia_latest(UTIL_SERIES)
    print(f"  refinery_utilization {UTIL_SERIES} = {util:.1f}%")

    print("Pulling WTI Cushing spot (daily)…")
    try:
        wti, wti_date = eia_latest(WTI_SERIES, base=BASE_SPT, frequency="daily")
        print(f"  wti                {WTI_SERIES:10s} = {wti:>10,.2f}  ({wti_date})")
    except Exception as e:
        # last resort: previous data.json value, else a sane default
        print(f"  WTI fetch failed ({e}); falling back to prior value", file=sys.stderr)
        prev = 0.0
        try:
            with open("data.json") as pf:
                prev = float(json.load(pf)["meta"]["wti"])
        except Exception:
            prev = 0.0
        wti = prev if prev > 0 else 80.0

    # EIA WPSR reports flows in thousand bbl/day and stocks in thousand bbl.
    # The infographic wants flows in million bbl/day and stocks in million bbl,
    # so divide both groups by 1000.
    for k in flows:
        flows[k] = flows[k] / 1000.0
    for k in stocks:
        stocks[k] = stocks[k] / 1000.0

    # derive "jet & other" as refinery output not in gasoline/distillate
    jet_other = max(0.0, flows["refinery_inputs"]
                    - flows["gasoline_prod"] - flows["distillate_prod"])

    data = {
        "meta": {
            "vintage": vintage(fp["refinery_inputs"]),
            "release": "EIA Weekly Petroleum Status Report",
            "generated_utc": dt.datetime.now(dt.timezone.utc)
                               .strftime("%Y-%m-%dT%H:%M:%SZ"),
            "status": "live",
            "wti": round(wti, 2),
        },
        "flows_mbd": {
            "production":       round(flows["production"], 1),
            "crude_imports":    round(flows["crude_imports"], 1),
            "refinery_inputs":  round(flows["refinery_inputs"], 1),
            "crude_exports":    round(flows["crude_exports"], 1),
            "gasoline_prod":    round(flows["gasoline_prod"], 1),
            "distillate_prod":  round(flows["distillate_prod"], 1),
            "jet_other_prod":   round(jet_other, 1),
            "product_supplied": round(flows["product_supplied"], 1),
        },
        "stocks_mb": {
            "commercial_crude": round(stocks["commercial_crude"], 1),
            "spr":              round(stocks["spr"], 1),
            "gasoline":         round(stocks["gasoline"], 1),
            "distillate":       round(stocks["distillate"], 1),
        },
        "context": {
            "refinery_utilization": round(util, 1),
            "spr_released_since_march": 17.5,   # narrative annotation; update as needed
            "spr_capacity": 714,
        },
    }

    verify(data)

    with open("data.json", "w") as f:
        json.dump(data, f, indent=2)
    print(f"\nWrote data.json  ·  {data['meta']['vintage']}")


# ---- verification gate ----------------------------------------------------
# Plausible ranges (mb/d for flows, mb for stocks, $/bbl for WTI). Generous
# bounds — we're catching junk (zeros, nulls, unit errors, 10x glitches),
# not policing normal week-to-week moves.
RANGES = {
    "flows_mbd": {
        "production":      (5, 25),
        "crude_imports":   (1, 15),
        "refinery_inputs": (10, 20),
        "crude_exports":   (0.5, 10),
        "gasoline_prod":   (5, 13),
        "distillate_prod": (2, 8),
        "jet_other_prod":  (0.5, 10),
        "product_supplied":(12, 26),
    },
    "stocks_mb": {
        "commercial_crude": (300, 600),
        "spr":              (200, 727),
        "gasoline":         (180, 290),
        "distillate":       (80, 200),
    },
}

def verify(data):
    """Raise SystemExit if any value looks like junk. Keeps a bad pull from
    overwriting good data on the live site."""
    problems = []
    for group, fields in RANGES.items():
        for k, (lo, hi) in fields.items():
            v = data.get(group, {}).get(k)
            if v is None:
                problems.append(f"{group}.{k} missing")
            elif not (lo <= v <= hi):
                problems.append(f"{group}.{k}={v} outside [{lo},{hi}]")
    wti = data["meta"].get("wti", 0)
    if not (10 <= wti <= 400):
        problems.append(f"meta.wti={wti} outside [10,400]")
    util = data["context"].get("refinery_utilization", 0)
    if not (50 <= util <= 102):
        problems.append(f"refinery_utilization={util} outside [50,102]")
    # soft balance check: refinery inputs shouldn't exceed total crude supply + a buffer
    supply = data["flows_mbd"]["production"] + data["flows_mbd"]["crude_imports"]
    if data["flows_mbd"]["refinery_inputs"] > supply + 4:
        problems.append("refinery_inputs implausibly exceed crude supply")
    if problems:
        print("VERIFICATION FAILED — not writing data.json:", file=sys.stderr)
        for p in problems:
            print("  - " + p, file=sys.stderr)
        sys.exit(2)
    print("Verification passed ✓")


if __name__ == "__main__":
    main()
