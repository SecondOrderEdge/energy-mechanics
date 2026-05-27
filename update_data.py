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
# CORE series — these MUST succeed; missing values fail verify() and the build.
FLOW_SERIES = {
    "production":      "WCRFPUS2",   # Field production of crude oil
    "crude_imports":   "WCEIMUS2",   # Crude oil imports
    "crude_exports":   "WCREXUS2",   # Crude oil exports
    "refinery_inputs": "WCRRIUS2",   # Refiner net crude inputs
    "gasoline_prod":   "WGFRPUS2",   # Finished motor gasoline, refiner net production
    "distillate_prod": "WDIRPUS2",   # Distillate fuel oil, refiner net production
    "product_supplied":"WRPUPUS2",   # Total products supplied (demand proxy)
}
# OPTIONAL flow series — best-effort; missing keys fall back to JS seed allocations.
EXTRA_FLOW_SERIES = {
    # Per-product supplied — feeds demand.js breakdown (replaces hardcoded shares)
    "gasoline_supplied":  "WGFUPUS2",
    "distillate_supplied":"WDIUPUS2",
    "jet_supplied":       "WKJUPUS2",
    "residual_supplied":  "WRESPUS2",
    "propane_supplied":   "WPRPUS2",
    # Refiner net production of secondary products — feeds jet.js expansion
    "jet_refprod":        "WKJRPUS2",
    "residual_refprod":   "WRERPUS2",
}
STOCK_SERIES = {
    "commercial_crude":"WCESTUS1",   # Commercial crude stocks (excl. SPR)
    "spr":             "WCSSTUS1",   # SPR crude stocks
    "gasoline":        "WGTSTUS1",   # Total motor gasoline stocks
    "distillate":      "WDISTUS1",   # Distillate stocks
}
# Refinery utilization (percent) — its own series
UTIL_SERIES = "WPULEUS3"

# Weekly PADD-level series (best-guess against legacy EIA naming).
# Every fetch is soft-failing — wrong IDs just mean the seeded allocation in
# the corresponding detail page's JS stays in effect that week.
PADD_COMM_CRUDE_SERIES = {
    "padd1":   "WCESTP11",
    "padd2":   "WCESTP21",
    "padd3":   "WCESTP31",
    "padd4":   "WCESTP41",
    "padd5":   "WCESTP51",
    "cushing": "W_EPC0_SAX_YCUOK_MBBL",
}
PADD_REFINERY_INPUTS = {  # refiner net crude inputs
    "padd1": "WCRRIP12", "padd2": "WCRRIP22", "padd3": "WCRRIP32",
    "padd4": "WCRRIP42", "padd5": "WCRRIP52",
}
PADD_GASOLINE_PROD = {     # finished motor gasoline, refiner net production
    "padd1": "WGFRPP12", "padd2": "WGFRPP22", "padd3": "WGFRPP32",
    "padd4": "WGFRPP42", "padd5": "WGFRPP52",
}
PADD_DISTILLATE_PROD = {   # distillate, refiner net production
    "padd1": "WDIRPP12", "padd2": "WDIRPP22", "padd3": "WDIRPP32",
    "padd4": "WDIRPP42", "padd5": "WDIRPP52",
}
PADD_GASOLINE_STOCKS = {   # total motor gasoline stocks
    "padd1": "WGTSTP11", "padd2": "WGTSTP21", "padd3": "WGTSTP31",
    "padd4": "WGTSTP41", "padd5": "WGTSTP51",
}
PADD_DISTILLATE_STOCKS = { # distillate stocks
    "padd1": "WDISTP11", "padd2": "WDISTP21", "padd3": "WDISTP31",
    "padd4": "WDISTP41", "padd5": "WDISTP51",
}


def fetch_padd_group(group, scale=1000.0, label="?"):
    """Fetch latest + 5-yr range for each series in group; soft-fail per series.
    Returns (latest_dict, ranges5y_dict) with only the keys that succeeded."""
    latest, ranges5y = {}, {}
    for k, sid in group.items():
        try:
            hist = eia_history(sid)
            latest[k]   = round(hist[0][1] / scale, 1)
            ranges5y[k] = range_5yr(hist, scale=scale)
            print(f"  {label}.{k:6s} {sid:24s} = {latest[k]:>6.2f}")
        except Exception as exc:
            print(f"  {label}.{k:6s} {sid:24s} = FAIL ({type(exc).__name__}); seed fallback", file=sys.stderr)
    return latest, ranges5y


def eia_latest(series_id, base=BASE_SNDW, frequency="weekly", retries=3):
    """Return (value: float, period: 'YYYY-MM-DD') of the most recent obs."""
    rows = _eia_rows(series_id, base, frequency, length=5, retries=retries)
    for row in rows:
        v = row.get("value")
        if v not in (None, "", "."):
            return float(v), row.get("period")
    raise ValueError(f"no valid obs for {series_id}")


def eia_history(series_id, base=BASE_SNDW, frequency="weekly", length=320, retries=3):
    """Return list of (period 'YYYY-MM-DD', value: float) most recent first.

    320 weekly obs ~= 6 years — comfortably covers the 5-yr same-week
    lookup plus the 4-week trailing window."""
    rows = _eia_rows(series_id, base, frequency, length=length, retries=retries)
    out = []
    for row in rows:
        v = row.get("value")
        if v not in (None, "", "."):
            out.append((row.get("period"), float(v)))
    if not out:
        raise ValueError(f"no obs for {series_id}")
    return out


def _eia_rows(series_id, base, frequency, length, retries):
    params = {
        "api_key": KEY,
        "frequency": frequency,
        "data[0]": "value",
        "facets[series][]": series_id,
        "sort[0][column]": "period",
        "sort[0][direction]": "desc",
        "offset": 0,
        "length": length,
    }
    url = base + "?" + urlencode(params)
    for attempt in range(retries):
        try:
            req = Request(url, headers={"User-Agent": "petroleum-plumbing/1.0"})
            with urlopen(req, timeout=45) as r:
                payload = json.load(r)
            return payload.get("response", {}).get("data", [])
        except (URLError, HTTPError, ValueError, KeyError):
            if attempt == retries - 1:
                raise
            time.sleep(1.5 * (attempt + 1))


def trailing(history, n=4, scale=1.0):
    """Last n observations, most recent first, scaled (e.g. /1000 mbbl→mmbl)."""
    return [round(v / scale, 2) for _, v in history[:n]]


def range_5yr(history, scale=1.0):
    """EIA-style 5-year band: min/avg/max of the same ISO-week-of-year
    across the previous 5 calendar years. Returns None if insufficient data."""
    if not history:
        return None
    latest_period, _ = history[0]
    latest_dt = dt.datetime.strptime(latest_period, "%Y-%m-%d")
    target_week = latest_dt.isocalendar()[1]
    target_year = latest_dt.year
    matches = []
    for period, value in history:
        d = dt.datetime.strptime(period, "%Y-%m-%d")
        iso_year, iso_week, _ = d.isocalendar()
        if (iso_week == target_week
                and d.year < target_year
                and d.year >= target_year - 5):
            matches.append(value / scale)
    if not matches:
        return None
    return {
        "min": round(min(matches), 2),
        "avg": round(sum(matches) / len(matches), 2),
        "max": round(max(matches), 2),
        "n":   len(matches),
    }


def pull(group):
    """Latest value per series. Kept for back-compat with older callers."""
    out, periods = {}, {}
    for k, sid in group.items():
        val, period = eia_latest(sid)
        out[k], periods[k] = val, period
        print(f"  {k:18s} {sid:10s} = {val:>10,.1f}  ({period})")
    return out, periods


def pull_with_history(group, scale=1.0):
    """Latest value + 4-week trailing + 5-yr range per series. Soft-fails per
    series — a single wrong ID is skipped with a stderr note, not raised.
    Callers must tolerate missing keys (every consumer already does)."""
    latest, periods, history, ranges = {}, {}, {}, {}
    for k, sid in group.items():
        try:
            hist = eia_history(sid)
        except Exception as exc:
            print(f"  {k:20s} {sid:24s} = FAIL ({type(exc).__name__}); seed fallback", file=sys.stderr)
            continue
        latest[k]  = hist[0][1]
        periods[k] = hist[0][0]
        history[k] = trailing(hist, n=4, scale=scale)
        ranges[k]  = range_5yr(hist, scale=scale)
        rng = ranges[k]
        rng_str = (f"  5y[{rng['min']:.1f}/{rng['avg']:.1f}/{rng['max']:.1f}]"
                   if rng else "")
        print(f"  {k:20s} {sid:24s} = {latest[k]:>10,.1f}  ({periods[k]}){rng_str}")
    return latest, periods, history, ranges


def vintage(period_str):
    d = dt.datetime.strptime(period_str, "%Y-%m-%d")
    return "WK " + d.strftime("%b %-d %Y").upper()


def main():
    if not KEY:
        print("ERROR: EIA_API_KEY not set.", file=sys.stderr)
        sys.exit(1)

    # CORE flows: pull latest + 4-week trailing + 5-yr range. EIA reports MBBL/D;
    # we want million bbl/day -> scale by 1000.
    print("Pulling petroleum flows (with history)…")
    flows, fp, flow_hist, flow_5yr = pull_with_history(FLOW_SERIES, scale=1000.0)
    for k in flows:
        flows[k] = flows[k] / 1000.0

    # EXTRA flows: per-product supplied + secondary refiner production.
    # Soft-fails per series; missing keys fall back to seed allocations in JS.
    print("Pulling per-product supplied + secondary refiner production…")
    extra_flows, _, extra_hist, extra_5yr = pull_with_history(EXTRA_FLOW_SERIES, scale=1000.0)
    for k in extra_flows:
        extra_flows[k] = extra_flows[k] / 1000.0

    # Stocks: same treatment. EIA reports MBBL; we want mmbl.
    print("Pulling petroleum stocks (with history)…")
    stocks, sp, stock_hist, stock_5yr = pull_with_history(STOCK_SERIES, scale=1000.0)
    for k in stocks:
        stocks[k] = stocks[k] / 1000.0

    print("Pulling refinery utilization…")
    util, _ = eia_latest(UTIL_SERIES)
    print(f"  refinery_utilization {UTIL_SERIES} = {util:.1f}%")

    # Per-PADD weekly series. Each fetch is best-effort; wrong IDs just mean
    # the detail page's JS keeps using its seeded allocation that week.
    print("Pulling commercial crude by PADD…")
    padd_crude,        padd_crude_5yr        = fetch_padd_group(PADD_COMM_CRUDE_SERIES,   label="crude")
    print("Pulling refinery inputs by PADD…")
    padd_ref_inputs,   padd_ref_inputs_5yr   = fetch_padd_group(PADD_REFINERY_INPUTS,     label="ref_in")
    print("Pulling gasoline production by PADD…")
    padd_gas_prod,     padd_gas_prod_5yr     = fetch_padd_group(PADD_GASOLINE_PROD,       label="gas_p")
    print("Pulling distillate production by PADD…")
    padd_dist_prod,    padd_dist_prod_5yr    = fetch_padd_group(PADD_DISTILLATE_PROD,     label="dist_p")
    print("Pulling gasoline stocks by PADD…")
    padd_gas_stocks,   padd_gas_stocks_5yr   = fetch_padd_group(PADD_GASOLINE_STOCKS,     label="gas_s")
    print("Pulling distillate stocks by PADD…")
    padd_dist_stocks,  padd_dist_stocks_5yr  = fetch_padd_group(PADD_DISTILLATE_STOCKS,   label="dist_s")

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

    # derive "jet & other" as refinery output not in gasoline/distillate
    jet_other = max(0.0, flows["refinery_inputs"]
                    - flows["gasoline_prod"] - flows["distillate_prod"])
    # derived "jet_other" history/range from the constituent series, week by week
    jo_hist = []
    if all(k in flow_hist for k in ("refinery_inputs","gasoline_prod","distillate_prod")):
        for i in range(min(len(flow_hist["refinery_inputs"]),
                           len(flow_hist["gasoline_prod"]),
                           len(flow_hist["distillate_prod"]))):
            v = (flow_hist["refinery_inputs"][i]
                 - flow_hist["gasoline_prod"][i]
                 - flow_hist["distillate_prod"][i])
            jo_hist.append(max(0.0, round(v, 2)))
    flow_hist["jet_other_prod"] = jo_hist
    # 5-yr range for jet_other_prod: combine via mid-points of the constituent ranges
    if all(k in flow_5yr and flow_5yr[k] for k in
           ("refinery_inputs","gasoline_prod","distillate_prod")):
        ri, gp, dp = flow_5yr["refinery_inputs"], flow_5yr["gasoline_prod"], flow_5yr["distillate_prod"]
        flow_5yr["jet_other_prod"] = {
            "min": round(max(0.0, ri["min"] - gp["max"] - dp["max"]), 2),
            "avg": round(max(0.0, ri["avg"] - gp["avg"] - dp["avg"]), 2),
            "max": round(max(0.0, ri["max"] - gp["min"] - dp["min"]), 2),
            "n":   min(ri.get("n",0), gp.get("n",0), dp.get("n",0)),
        }

    # derived "crude supply" history/range = production + imports
    sup_hist = []
    if "production" in flow_hist and "crude_imports" in flow_hist:
        for i in range(min(len(flow_hist["production"]),
                           len(flow_hist["crude_imports"]))):
            sup_hist.append(round(flow_hist["production"][i] + flow_hist["crude_imports"][i], 2))
    flow_hist["crude_supply"] = sup_hist
    if (flow_5yr.get("production") and flow_5yr.get("crude_imports")):
        p5, i5 = flow_5yr["production"], flow_5yr["crude_imports"]
        flow_5yr["crude_supply"] = {
            "min": round(p5["min"] + i5["min"], 2),
            "avg": round(p5["avg"] + i5["avg"], 2),
            "max": round(p5["max"] + i5["max"], 2),
            "n":   min(p5.get("n",0), i5.get("n",0)),
        }

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
            # Optional per-product supplied + secondary refiner production —
            # whichever ones the cron succeeded in fetching get added here.
            **{k: round(v, 2) for k, v in extra_flows.items()},
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
        # 4-week trailing values, most recent first (incl. current). Used for
        # sparklines on the readout cards.
        "history": {**flow_hist, **stock_hist, **extra_hist},
        # 5-yr min/avg/max for the same ISO-week-of-year. Used for the
        # "above/within/below 5-yr range" indicators.
        "ranges_5yr": {**flow_5yr, **stock_5yr, **extra_5yr},
        # Per-PADD breakdowns (best-effort; partial population allowed).
        # Detail pages fall back to seeded allocations for any missing key.
        "padd_stocks_crude":         padd_crude,
        "padd_stocks_crude_5yr":     padd_crude_5yr,
        "padd_refinery_inputs":      padd_ref_inputs,
        "padd_refinery_inputs_5yr":  padd_ref_inputs_5yr,
        "padd_gasoline_prod":        padd_gas_prod,
        "padd_gasoline_prod_5yr":    padd_gas_prod_5yr,
        "padd_distillate_prod":      padd_dist_prod,
        "padd_distillate_prod_5yr":  padd_dist_prod_5yr,
        "padd_gasoline_stocks":      padd_gas_stocks,
        "padd_gasoline_stocks_5yr":  padd_gas_stocks_5yr,
        "padd_distillate_stocks":    padd_dist_stocks,
        "padd_distillate_stocks_5yr":padd_dist_stocks_5yr,
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
