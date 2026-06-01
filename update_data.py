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
# Monthly movement datasets (imports by country, exports by destination)
BASE_IMPCUS = "https://api.eia.gov/v2/petroleum/move/impcus/data/"
BASE_EXPC   = "https://api.eia.gov/v2/petroleum/move/expc/data/"
# Monthly crude production by state (Petroleum Supply Monthly)
BASE_CRPDN  = "https://api.eia.gov/v2/petroleum/crd/crpdn_adc_mbblpd/data/"

# Electricity dataset paths (Electric Power Monthly)
BASE_ELEC_OP     = "https://api.eia.gov/v2/electricity/electric-power-operational-data/data/"
BASE_ELEC_RETAIL = "https://api.eia.gov/v2/electricity/retail-sales/data/"

# Natural gas dataset paths
BASE_NG_STOR_WKLY = "https://api.eia.gov/v2/natural-gas/stor/wkly/data/"
BASE_NG_PRICE     = "https://api.eia.gov/v2/natural-gas/pri/fut/data/"
BASE_NG_PROD      = "https://api.eia.gov/v2/natural-gas/prod/sum/data/"
BASE_NG_CONS      = "https://api.eia.gov/v2/natural-gas/cons/sum/data/"
BASE_NG_MOVE_EXP  = "https://api.eia.gov/v2/natural-gas/move/expc/data/"
BASE_NG_MOVE_IMP  = "https://api.eia.gov/v2/natural-gas/move/impc/data/"

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

# Monthly series — soft-fail and consume by detail pages.
# These are best-guess against EIA legacy naming. If the format is wrong
# the cron logs the failure and the seeded JS fallback stays in effect.
IMPORTS_BY_COUNTRY = {     # monthly crude imports, mb/d
    "canada":   "MCRIMUSCA2", "mexico":   "MCRIMUSMX2",
    "saudi":    "MCRIMUSSA2", "colombia": "MCRIMUSCO2",
    "iraq":     "MCRIMUSIZ2",
}
IMPORTS_AGGREGATES = {     # monthly aggregate-region imports, mb/d
    "opec":   "MCRIMUSOPEC2",   # OPEC total
    "non_opec":"MCRIMUSNOPEC2", # non-OPEC total
}
EXPORTS_BY_DEST = {        # monthly crude exports by destination
    "china":       "MCREXCH2",  "korea":     "MCREXKS2",
    "netherlands": "MCREXNL2",  "india":     "MCREXIN2",
    "uk":          "MCREXUK2",
}
PRODUCTION_BY_STATE = {    # monthly crude production by state, mb/d
    "tx": "MCRFPTX2", "nm": "MCRFPNM2", "nd": "MCRFPND2",
    "co": "MCRFPCO2", "ok": "MCRFPOK2", "ak": "MCRFPAK2",
    "ca": "MCRFPCA2", "wy": "MCRFPWY2",
}

# Natural gas — weekly working gas in storage (EIA Natural Gas Weekly, Thu 10:30 ET)
NG_STORAGE_SERIES = {
    "working_gas":   "NW2_EPG0_SWO_R48_BCF",   # Lower 48 total
    "east":          "NW2_EPG0_SWO_R31_BCF",
    "midwest":       "NW2_EPG0_SWO_R32_BCF",
    "mountain":      "NW2_EPG0_SWO_R33_BCF",
    "pacific":       "NW2_EPG0_SWO_R34_BCF",
    "south_central": "NW2_EPG0_SWO_R35_BCF",
}
# Henry Hub natural gas spot price (daily, $/MMBtu)
NG_HH_SERIES = "RNGWHHD"

# Monthly Natural Gas Monthly (NGM) flow series — best-guess against EIA naming.
# Units: most NG flow series are MMcf for the month; we scale by ~30 to get
# bcf/d for display (close enough; refine if precision matters).
NG_PRODUCTION_SERIES = {
    "production": "N9050US2",   # dry production
    "imports":    "N9100US2",   # natural gas imports total
}
NG_CONSUMPTION_SERIES = {
    "rescom":     "N3010US2",   # residential (will sum with commercial below)
    "commercial": "N3020US2",   # commercial
    "industrial": "N3035US2",   # industrial
    "electric":   "N3045US2",   # electric power
}
NG_EXPORTS_SERIES = {
    "lng_exports":    "N9133US2",   # LNG exports
    "mexico_exports": "N9132MX2",   # pipeline exports to Mexico (best guess)
}

# Electric Power Monthly — net generation by fuel type, all sectors, US total.
# Units: thousand MWh (= GWh) per month. We sum trailing 12 months → TWh/year.
# Fuel codes are EIA-923 fueltypeids:
#   NG=natural gas, NUC=nuclear, COW=all coal, WND=wind,
#   SUN=all solar (utility PV+thermal+distributed PV),
#   HYC=conventional hydro, BIO=total biomass
ELEC_GEN_FUELS = {
    "gas":     "NG",
    "nuclear": "NUC",
    "coal":    "COW",
    "wind":    "WND",
    "solar":   "SUN",
    "hydro":   "HYC",
    "biomass": "BIO",
}
# Utility-scale vs distributed solar split (for solar.html).
#   SUB = utility-scale solar (PV + thermal); DPV = small-scale / distributed PV
ELEC_SOLAR_SPLIT = {
    "utility":     "SUB",
    "distributed": "DPV",
}
# Top solar-generating states (uses total solar SUN at state level).
# AZ + NV combined to match the solar.html "az_nv" bucket.
ELEC_SOLAR_BY_STATE = {
    "ca":    ["CA"],
    "tx":    ["TX"],
    "fl":    ["FL"],
    "nc":    ["NC"],
    "az_nv": ["AZ", "NV"],
}
# Top wind-generating states (uses WND at state level). TX dominates;
# Plains corridor IA+KS+OK is the rest of the top tier; IL is the Midwest leader.
ELEC_WIND_BY_STATE = {
    "tx": ["TX"], "ia": ["IA"], "ok": ["OK"], "ks": ["KS"], "il": ["IL"],
}
# Top nuclear-generating states (uses NUC at state level).
# IL = Constellation's 6-reactor fleet, biggest nuclear state by generation.
ELEC_NUC_BY_STATE = {
    "il": ["IL"], "pa": ["PA"], "sc": ["SC"], "al": ["AL"], "nc": ["NC"],
}
# Top coal-generating states (uses COW at state level). TX still leads despite
# rapid retirement curve; WV+KY are Appalachian basin; IN+MO are Midwest.
ELEC_COAL_BY_STATE = {
    "tx": ["TX"], "wv": ["WV"], "ky": ["KY"], "in": ["IN"], "mo": ["MO"],
}
# Coal rank split — Powder River subbituminous dominates fuel mix today,
# Appalachian bituminous is the declining historical core.
ELEC_COAL_RANKS = {
    "bit": "BIT",   # Bituminous (Appalachian, Illinois Basin)
    "sub": "SUB",   # Subbituminous (Powder River Basin, WY/MT)
    "lig": "LIG",   # Lignite (TX, ND)
}
# Top hydro-generating states (uses HYC at state level). PNW dominates: WA
# alone is ~30% of U.S. hydro in a normal water year. CA swings wildly with
# drought; MT rounds out the Rockies/PNW core.
ELEC_HYDRO_BY_STATE = {
    "wa": ["WA"], "or": ["OR"], "ny": ["NY"], "ca": ["CA"], "mt": ["MT"],
}
# Top gas-generating states (uses NG at state level). TX dominates by a wide
# margin (~25% of U.S. gas-fired generation); FL + PA round out the top tier;
# CA + OH cover the Southwest + Midwest gas-heavy regions.
ELEC_GAS_BY_STATE = {
    "tx": ["TX"], "fl": ["FL"], "pa": ["PA"], "ca": ["CA"], "oh": ["OH"],
}
# Gas-fired technology split by prime mover (EIA-923 primeMover facet).
# CC = combined cycle (~60% LHV efficiency, baseload-ish)
# GT = combustion turbine simple cycle (~35%, peakers)
# ST = legacy gas steam (small + retiring)
# IC = internal combustion (small + niche)
# These IDs may or may not be queryable as facets; soft-fails to seed if not.
ELEC_GAS_PRIMEMOVERS = {
    "ccgt": "CC",
    "scgt": "GT",
    "steam": "ST",
}
# Retail sales by sector — EIA-861, US total. Units: million kWh (= GWh) per month.
ELEC_RETAIL_SECTORS = {
    "residential": "RES",
    "commercial":  "COM",
    "industrial":  "IND",
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


def fetch_monthly_group(group, base=BASE_SNDW, scale=1.0, label="?"):
    """Same as fetch_padd_group but for monthly series under a non-default
    EIA dataset path (movements, state production, etc.). Soft-fails per
    series so a single wrong ID doesn't take out the whole group."""
    latest = {}
    for k, sid in group.items():
        try:
            v, period = eia_latest(sid, base=base, frequency="monthly")
            latest[k] = round(v / scale, 2)
            print(f"  {label}.{k:12s} {sid:16s} = {latest[k]:>8.2f}  ({period})")
        except Exception as exc:
            print(f"  {label}.{k:12s} {sid:16s} = FAIL ({type(exc).__name__}); seed fallback", file=sys.stderr)
    return latest


def build_natural_gas(prev_ng):
    """Fetch everything for the natural_gas block in data.json. Soft-fails
    per series — anything that doesn't resolve is omitted, and naturalgas.js
    falls back to its inline SEED for that key.

    prev_ng: the previous data.json's natural_gas block (used to preserve
    seeded keys whose live fetch fails). Pass {} for first run."""
    flows = {}
    stocks = {}
    history = {}
    ranges_5yr = {}
    meta = {}

    # ---- Weekly working gas in storage (the headline indicator) ----
    print("Pulling NG working gas in storage (weekly)…")
    stor_latest, stor_periods, stor_hist, stor_5yr = pull_with_history(
        NG_STORAGE_SERIES, scale=1.0)
    # Map the working_gas key (Lower 48 total) into stocks_bcf for naturalgas.js
    if "working_gas" in stor_latest:
        stocks["working_gas"] = round(stor_latest["working_gas"], 0)
        history["working_gas"] = stor_hist["working_gas"]
        ranges_5yr["working_gas"] = stor_5yr["working_gas"]
        meta["vintage"] = vintage(stor_periods["working_gas"])
    # Regional storage breakdown — store as-is for future regional detail page
    regional = {k: round(v, 0) for k, v in stor_latest.items() if k != "working_gas"}
    if regional:
        stocks["regional"] = regional

    # ---- Daily Henry Hub spot price ----
    print("Pulling Henry Hub spot (daily)…")
    try:
        hh, hh_date = eia_latest(NG_HH_SERIES, base=BASE_NG_PRICE, frequency="daily")
        meta["henry_hub"] = round(hh, 2)
        meta["henry_hub_date"] = hh_date
        print(f"  henry_hub          {NG_HH_SERIES:18s} = {hh:>6.2f}  ({hh_date})")
        # Daily history → take last ~28 obs and downsample weekly for sparkline
        try:
            hh_hist = eia_history(NG_HH_SERIES, base=BASE_NG_PRICE,
                                  frequency="daily", length=30)
            # Take every ~5 trading days for a 4-week sparkline
            weekly_hh = [round(v, 2) for _, v in hh_hist[::5][:4]]
            if len(weekly_hh) >= 2:
                history["henry_hub"] = weekly_hh
        except Exception as exc:
            print(f"  henry_hub history  = FAIL ({type(exc).__name__})", file=sys.stderr)
    except Exception as exc:
        print(f"  henry_hub          {NG_HH_SERIES:18s} = FAIL ({type(exc).__name__})", file=sys.stderr)

    # ---- Monthly NGM flows (production, imports, consumption, exports) ----
    # EIA reports these in MMcf for the month; scale=30000 approximates bcf/d
    # (1000 mmcf/bcf × ~30 days/month). Refine if you need exact day counts.
    MONTHLY_SCALE = 30000.0
    print("Pulling NG production + imports (monthly)…")
    prod_imp = fetch_monthly_group(NG_PRODUCTION_SERIES,
        base=BASE_NG_PROD, scale=MONTHLY_SCALE, label="ng_prod")
    print("Pulling NG consumption by sector (monthly)…")
    cons = fetch_monthly_group(NG_CONSUMPTION_SERIES,
        base=BASE_NG_CONS, scale=MONTHLY_SCALE, label="ng_cons")
    print("Pulling NG exports (monthly)…")
    exp = fetch_monthly_group(NG_EXPORTS_SERIES,
        base=BASE_NG_MOVE_EXP, scale=MONTHLY_SCALE, label="ng_exp")

    # Merge into flows_bcfd, summing residential + commercial as the
    # naturalgas.js "rescom" expects.
    if "production" in prod_imp:    flows["production"]    = round(prod_imp["production"], 1)
    if "imports"    in prod_imp:    flows["imports"]       = round(prod_imp["imports"], 1)
    if "industrial" in cons:        flows["industrial"]    = round(cons["industrial"], 1)
    if "electric"   in cons:        flows["electric"]      = round(cons["electric"], 1)
    if "rescom" in cons and "commercial" in cons:
        flows["rescom"] = round(cons["rescom"] + cons["commercial"], 1)
    elif "rescom" in cons:
        flows["rescom"] = round(cons["rescom"], 1)
    if "lng_exports"    in exp:     flows["lng_exports"]    = round(exp["lng_exports"], 1)
    if "mexico_exports" in exp:     flows["mexico_exports"] = round(exp["mexico_exports"], 1)

    # ---- Compose supply history if production + imports are present ----
    # (No live monthly history yet — defer to next pass; sparkline for "supply"
    # stays on the seeded values unless we wire monthly history here.)

    # ---- Preserve any seeded keys whose live fetch failed ----
    prev_flows  = (prev_ng or {}).get("flows_bcfd", {})
    prev_stocks = (prev_ng or {}).get("stocks_bcf", {})
    prev_meta   = (prev_ng or {}).get("meta", {})
    prev_hist   = (prev_ng or {}).get("history", {})
    prev_5yr    = (prev_ng or {}).get("ranges_5yr", {})
    for k, v in prev_flows.items():
        flows.setdefault(k, v)
    for k, v in prev_stocks.items():
        stocks.setdefault(k, v)
    if "henry_hub" not in meta and "henry_hub" in prev_meta:
        meta["henry_hub"] = prev_meta["henry_hub"]
    for k, v in prev_hist.items():
        history.setdefault(k, v)
    for k, v in prev_5yr.items():
        ranges_5yr.setdefault(k, v)

    # Mark live if at least the headline storage number succeeded
    meta["status"] = "live" if "working_gas" in stocks else "seed"
    meta.setdefault("vintage", prev_meta.get("vintage", "—"))

    return {
        "meta":        meta,
        "flows_bcfd":  flows,
        "stocks_bcf":  stocks,
        "history":     history,
        "ranges_5yr":  ranges_5yr,
    }


def _eia_rows_faceted(base, frequency, facets, data_col, length, retries=3):
    """Generic EIA v2 fetch for endpoints that filter by named facets
    (fueltypeid, sectorid, location, stateid, …) instead of `series`.
    facets values may be str or list; lists become repeated facets[...][].
    Returns the raw `response.data` list (one row per facet combination)."""
    params = [
        ("api_key", KEY),
        ("frequency", frequency),
        ("data[0]", data_col),
        ("sort[0][column]", "period"),
        ("sort[0][direction]", "desc"),
        ("offset", "0"),
        ("length", str(length)),
    ]
    for fkey, fval in facets.items():
        vals = fval if isinstance(fval, list) else [fval]
        for v in vals:
            params.append((f"facets[{fkey}][]", str(v)))
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


def eia_monthly_series(base, facets, data_col="generation", length=120):
    """Pull monthly observations for a faceted query and sum within each
    period (a single (period, location, sector, fueltype) tuple maps to one
    row, but facets like multi-state lists return one row per element).
    Returns [(period 'YYYY-MM', value: float), ...] most recent first."""
    rows = _eia_rows_faceted(base, "monthly", facets, data_col, length)
    by_period = {}
    for row in rows:
        v = row.get(data_col)
        if v in (None, "", "."):
            continue
        p = row.get("period")
        if not p:
            continue
        try:
            by_period[p] = by_period.get(p, 0.0) + float(v)
        except (TypeError, ValueError):
            continue
    return sorted(by_period.items(), key=lambda kv: kv[0], reverse=True)


def t12m_series(monthly):
    """Convert monthly [(period, value), ...] (newest first) into rolling-annual
    [(period, sum_of_trailing_12), ...] (newest first). Drops months without
    a full 12-month look-back."""
    n = len(monthly)
    out = []
    for i in range(n - 11):
        p, _ = monthly[i]
        s = sum(v for _, v in monthly[i:i+12])
        out.append((p, s))
    return out


def t12m_5yr_range(t12m, scale=1.0):
    """5-yr same-month band for a rolling-annual series (avoids seasonality)."""
    if not t12m:
        return None
    latest_p, _ = t12m[0]
    ly, lm = int(latest_p[:4]), int(latest_p[5:7])
    matches = []
    for p, v in t12m:
        y, m = int(p[:4]), int(p[5:7])
        if m == lm and y < ly and y >= ly - 5:
            matches.append(v / scale)
    if not matches:
        return None
    return {
        "min": round(min(matches), 1),
        "avg": round(sum(matches) / len(matches), 1),
        "max": round(max(matches), 1),
        "n":   len(matches),
    }


def month_vintage(period_str):
    """Format a YYYY-MM EIA monthly period as 'MO MMM YYYY'."""
    d = dt.datetime.strptime(period_str, "%Y-%m")
    return "MO " + d.strftime("%b %Y").upper()


def build_electricity(prev_elec):
    """Pull EIA Electric Power Monthly: generation by fuel, retail sales by
    sector, solar utility/distributed split, top solar states. Values are
    trailing-12-month sums in TWh so the headline numbers update smoothly
    each month rather than swinging seasonally.

    Soft-fails per series — any key that doesn't resolve is preserved from
    prev_elec (which seeds the page on a brand-new repo)."""
    gen_twh, demand_twh = {}, {}
    solar_detail, wind_detail = {}, {}
    nuclear_detail, coal_detail, hydro_detail, gas_detail = {}, {}, {}, {}
    history, ranges_5yr, meta = {}, {}, {}
    live = False  # flip true on first successful EIA fetch

    # ---- Generation by fuel (US total, all sectors) ----
    print("Pulling Electric Power Monthly generation by fuel…")
    fuel_t12m = {}
    for name, fid in ELEC_GEN_FUELS.items():
        try:
            monthly = eia_monthly_series(
                BASE_ELEC_OP,
                facets={"fueltypeid": fid, "location": "US", "sectorid": "99"},
            )
            t12 = t12m_series(monthly)
            if not t12:
                raise ValueError("insufficient months")
            gen_twh[name] = round(t12[0][1] / 1000.0, 0)
            fuel_t12m[name] = t12
            live = True
            print(f"  gen.{name:8s} {fid:4s} T12M = {gen_twh[name]:>6.0f} TWh  ({t12[0][0]})")
        except Exception as exc:
            print(f"  gen.{name:8s} {fid:4s} = FAIL ({type(exc).__name__}); seed fallback", file=sys.stderr)

    # vintage = earliest "most-recent month" across fuels (slowest publisher wins)
    if fuel_t12m:
        latest_period = min(t[0][0] for t in fuel_t12m.values())
        meta["vintage"] = month_vintage(latest_period)

    # history.total = trailing 4 months of all-fuel T12M sums, in TWh
    if fuel_t12m:
        n = min(len(t) for t in fuel_t12m.values())
        total_t12m = []
        for i in range(n):
            p = next(iter(fuel_t12m.values()))[i][0]
            tot = sum(t[i][1] for t in fuel_t12m.values())
            total_t12m.append((p, tot))
        history["total"] = [round(v / 1000.0, 0) for _, v in total_t12m[:4]]
        rng = t12m_5yr_range(total_t12m, scale=1000.0)
        if rng:
            ranges_5yr["total"] = rng

    # history.solar + history.wind = trailing 4 months of T12M, plus the
    # same-month 5-yr-ago T12M for the "X× vs 5 yrs ago" callouts
    def _hist_and_5yago(fuel_key, detail):
        if fuel_key not in fuel_t12m: return
        history[fuel_key] = [round(v / 1000.0, 0) for _, v in fuel_t12m[fuel_key][:4]]
        ly, lm = int(fuel_t12m[fuel_key][0][0][:4]), int(fuel_t12m[fuel_key][0][0][5:7])
        target = f"{ly-5:04d}-{lm:02d}"
        for p, v in fuel_t12m[fuel_key]:
            if p == target:
                detail["five_yr_ago_twh"] = round(v / 1000.0, 0)
                break
    _hist_and_5yago("solar",   solar_detail)
    _hist_and_5yago("wind",    wind_detail)
    _hist_and_5yago("nuclear", nuclear_detail)
    _hist_and_5yago("coal",    coal_detail)
    _hist_and_5yago("hydro",   hydro_detail)
    _hist_and_5yago("gas",     gas_detail)

    # ---- Solar utility/distributed split ----
    print("Pulling solar utility/distributed split…")
    for name, fid in ELEC_SOLAR_SPLIT.items():
        try:
            monthly = eia_monthly_series(
                BASE_ELEC_OP,
                facets={"fueltypeid": fid, "location": "US", "sectorid": "99"},
            )
            t12 = t12m_series(monthly)
            if not t12:
                raise ValueError("insufficient months")
            solar_detail[f"{name}_twh"] = round(t12[0][1] / 1000.0, 0)
            live = True
            print(f"  solar.{name:11s} {fid:4s} T12M = {solar_detail[f'{name}_twh']:>5.0f} TWh")
        except Exception as exc:
            print(f"  solar.{name:11s} {fid:4s} = FAIL ({type(exc).__name__}); seed fallback", file=sys.stderr)

    # ---- Solar by state (top 5 generating states, total solar SUN) ----
    print("Pulling solar by state…")
    by_state = {}
    for key, locs in ELEC_SOLAR_BY_STATE.items():
        try:
            monthly = eia_monthly_series(
                BASE_ELEC_OP,
                facets={"fueltypeid": "SUN", "location": locs, "sectorid": "99"},
            )
            t12 = t12m_series(monthly)
            if t12:
                by_state[key] = round(t12[0][1] / 1000.0, 0)
                live = True
                print(f"  solar.state.{key:6s} {','.join(locs):8s} T12M = {by_state[key]:>4.0f} TWh")
        except Exception as exc:
            print(f"  solar.state.{key:6s} = FAIL ({type(exc).__name__})", file=sys.stderr)
    if by_state:
        solar_detail["by_state"] = by_state

    # ---- Wind by state (top 5 generating states) ----
    print("Pulling wind by state…")
    wind_by_state = {}
    for key, locs in ELEC_WIND_BY_STATE.items():
        try:
            monthly = eia_monthly_series(
                BASE_ELEC_OP,
                facets={"fueltypeid": "WND", "location": locs, "sectorid": "99"},
            )
            t12 = t12m_series(monthly)
            if t12:
                wind_by_state[key] = round(t12[0][1] / 1000.0, 0)
                live = True
                print(f"  wind.state.{key:6s} {','.join(locs):8s} T12M = {wind_by_state[key]:>4.0f} TWh")
        except Exception as exc:
            print(f"  wind.state.{key:6s} = FAIL ({type(exc).__name__})", file=sys.stderr)
    if wind_by_state:
        wind_detail["by_state"] = wind_by_state

    # ---- Nuclear by state (top 5 generating states) ----
    print("Pulling nuclear by state…")
    nuc_by_state = {}
    for key, locs in ELEC_NUC_BY_STATE.items():
        try:
            monthly = eia_monthly_series(
                BASE_ELEC_OP,
                facets={"fueltypeid": "NUC", "location": locs, "sectorid": "99"},
            )
            t12 = t12m_series(monthly)
            if t12:
                nuc_by_state[key] = round(t12[0][1] / 1000.0, 0)
                live = True
                print(f"  nuc.state.{key:6s} {','.join(locs):8s} T12M = {nuc_by_state[key]:>4.0f} TWh")
        except Exception as exc:
            print(f"  nuc.state.{key:6s} = FAIL ({type(exc).__name__})", file=sys.stderr)
    if nuc_by_state:
        nuclear_detail["by_state"] = nuc_by_state

    # ---- Coal by state (top 5 generating states) ----
    print("Pulling coal by state…")
    coal_by_state = {}
    for key, locs in ELEC_COAL_BY_STATE.items():
        try:
            monthly = eia_monthly_series(
                BASE_ELEC_OP,
                facets={"fueltypeid": "COW", "location": locs, "sectorid": "99"},
            )
            t12 = t12m_series(monthly)
            if t12:
                coal_by_state[key] = round(t12[0][1] / 1000.0, 0)
                live = True
                print(f"  coal.state.{key:6s} {','.join(locs):8s} T12M = {coal_by_state[key]:>4.0f} TWh")
        except Exception as exc:
            print(f"  coal.state.{key:6s} = FAIL ({type(exc).__name__})", file=sys.stderr)
    if coal_by_state:
        coal_detail["by_state"] = coal_by_state

    # ---- Gas by state (top 5 generating states) ----
    print("Pulling gas by state…")
    gas_by_state = {}
    for key, locs in ELEC_GAS_BY_STATE.items():
        try:
            monthly = eia_monthly_series(
                BASE_ELEC_OP,
                facets={"fueltypeid": "NG", "location": locs, "sectorid": "99"},
            )
            t12 = t12m_series(monthly)
            if t12:
                gas_by_state[key] = round(t12[0][1] / 1000.0, 0)
                live = True
                print(f"  gas.state.{key:6s} {','.join(locs):8s} T12M = {gas_by_state[key]:>4.0f} TWh")
        except Exception as exc:
            print(f"  gas.state.{key:6s} = FAIL ({type(exc).__name__})", file=sys.stderr)
    if gas_by_state:
        gas_detail["by_state"] = gas_by_state

    # ---- Gas split by prime mover (CCGT vs SCGT vs steam) ----
    # primeMover facet may not be available in v2 operational-data; soft-fail
    # to keep the seeded technology split intact if it isn't.
    print("Pulling gas split by prime mover…")
    for name, pm in ELEC_GAS_PRIMEMOVERS.items():
        try:
            monthly = eia_monthly_series(
                BASE_ELEC_OP,
                facets={"fueltypeid": "NG", "primeMover": pm,
                        "location": "US", "sectorid": "99"},
            )
            t12 = t12m_series(monthly)
            if not t12:
                raise ValueError("insufficient months")
            gas_detail[f"{name}_twh"] = round(t12[0][1] / 1000.0, 0)
            live = True
            print(f"  gas.tech.{name:5s} {pm:3s} T12M = {gas_detail[f'{name}_twh']:>5.0f} TWh")
        except Exception as exc:
            print(f"  gas.tech.{name:5s} {pm:3s} = FAIL ({type(exc).__name__}); seed fallback", file=sys.stderr)

    # ---- Hydro by state (top 5 generating states) ----
    print("Pulling hydro by state…")
    hyd_by_state = {}
    for key, locs in ELEC_HYDRO_BY_STATE.items():
        try:
            monthly = eia_monthly_series(
                BASE_ELEC_OP,
                facets={"fueltypeid": "HYC", "location": locs, "sectorid": "99"},
            )
            t12 = t12m_series(monthly)
            if t12:
                hyd_by_state[key] = round(t12[0][1] / 1000.0, 0)
                live = True
                print(f"  hydro.state.{key:6s} {','.join(locs):8s} T12M = {hyd_by_state[key]:>4.0f} TWh")
        except Exception as exc:
            print(f"  hydro.state.{key:6s} = FAIL ({type(exc).__name__})", file=sys.stderr)
    if hyd_by_state:
        hydro_detail["by_state"] = hyd_by_state

    # ---- Pumped storage net generation (HPS) ----
    # Net is structurally negative (round-trip losses ~20%). We store the raw
    # value so the page can display either the net loss OR the absolute
    # round-trip throughput, as appropriate.
    print("Pulling hydro pumped storage (HPS, US total)…")
    try:
        monthly = eia_monthly_series(
            BASE_ELEC_OP,
            facets={"fueltypeid": "HPS", "location": "US", "sectorid": "99"},
        )
        t12 = t12m_series(monthly)
        if t12:
            hydro_detail["pumped_net_twh"] = round(t12[0][1] / 1000.0, 1)
            live = True
            print(f"  hydro.pumped_net    HPS  T12M = {hydro_detail['pumped_net_twh']:>5.1f} TWh")
    except Exception as exc:
        print(f"  hydro.pumped_net    HPS  = FAIL ({type(exc).__name__}); seed fallback", file=sys.stderr)

    # ---- Coal rank split (bituminous / subbituminous / lignite) ----
    print("Pulling coal rank split…")
    for name, fid in ELEC_COAL_RANKS.items():
        try:
            monthly = eia_monthly_series(
                BASE_ELEC_OP,
                facets={"fueltypeid": fid, "location": "US", "sectorid": "99"},
            )
            t12 = t12m_series(monthly)
            if not t12:
                raise ValueError("insufficient months")
            coal_detail[f"{name}_twh"] = round(t12[0][1] / 1000.0, 0)
            live = True
            print(f"  coal.rank.{name:4s} {fid:4s} T12M = {coal_detail[f'{name}_twh']:>5.0f} TWh")
        except Exception as exc:
            print(f"  coal.rank.{name:4s} {fid:4s} = FAIL ({type(exc).__name__}); seed fallback", file=sys.stderr)

    # ---- Retail sales by sector (US total) ----
    print("Pulling retail sales by sector…")
    for name, sid in ELEC_RETAIL_SECTORS.items():
        try:
            monthly = eia_monthly_series(
                BASE_ELEC_RETAIL,
                facets={"sectorid": sid, "stateid": "US"},
                data_col="sales",
            )
            t12 = t12m_series(monthly)
            if not t12:
                raise ValueError("insufficient months")
            demand_twh[name] = round(t12[0][1] / 1000.0, 0)
            live = True
            print(f"  retail.{name:11s} {sid:4s} T12M = {demand_twh[name]:>5.0f} TWh")
        except Exception as exc:
            print(f"  retail.{name:11s} {sid:4s} = FAIL ({type(exc).__name__}); seed fallback", file=sys.stderr)

    # ---- Preserve seeded keys whose live fetch failed ----
    prev_gen  = (prev_elec or {}).get("gen_twh", {})
    prev_dem  = (prev_elec or {}).get("demand_twh", {})
    prev_meta = (prev_elec or {}).get("meta", {})
    prev_sd   = (prev_elec or {}).get("solar_detail", {})
    prev_wd   = (prev_elec or {}).get("wind_detail", {})
    prev_nd   = (prev_elec or {}).get("nuclear_detail", {})
    prev_cd   = (prev_elec or {}).get("coal_detail", {})
    prev_hd   = (prev_elec or {}).get("hydro_detail", {})
    prev_gd   = (prev_elec or {}).get("gas_detail", {})
    prev_hist = (prev_elec or {}).get("history", {})
    prev_5yr  = (prev_elec or {}).get("ranges_5yr", {})
    for k, v in prev_gen.items():    gen_twh.setdefault(k, v)
    for k, v in prev_dem.items():    demand_twh.setdefault(k, v)
    for k, v in prev_sd.items():     solar_detail.setdefault(k, v)
    for k, v in prev_wd.items():     wind_detail.setdefault(k, v)
    for k, v in prev_nd.items():     nuclear_detail.setdefault(k, v)
    for k, v in prev_cd.items():     coal_detail.setdefault(k, v)
    for k, v in prev_hd.items():     hydro_detail.setdefault(k, v)
    for k, v in prev_gd.items():     gas_detail.setdefault(k, v)
    for k, v in prev_hist.items():   history.setdefault(k, v)
    for k, v in prev_5yr.items():    ranges_5yr.setdefault(k, v)
    meta.setdefault("vintage", prev_meta.get("vintage", "—"))

    # ---- Losses ≈ generation − retail sales (coarse balance, ignores net
    # exports to Canada/Mexico — order-of-magnitude only) ----
    if gen_twh and demand_twh:
        losses = max(0.0, sum(gen_twh.values()) - sum(demand_twh.values()))
    else:
        losses = (prev_elec or {}).get("losses_twh", 0)

    meta["status"] = "live" if live else prev_meta.get("status", "seed")

    return {
        "meta":         meta,
        "gen_twh":      gen_twh,
        "demand_twh":   demand_twh,
        "losses_twh":   round(losses, 0),
        "solar_detail":   solar_detail,
        "wind_detail":    wind_detail,
        "nuclear_detail": nuclear_detail,
        "coal_detail":    coal_detail,
        "hydro_detail":   hydro_detail,
        "gas_detail":     gas_detail,
        "history":        history,
        "ranges_5yr":   ranges_5yr,
    }


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

    # Monthly endpoints — imports by country, exports by destination,
    # production by state. Each series soft-fails; if 0 of these resolve
    # the detail pages keep using their seeded share allocations.
    print("Pulling imports by country (monthly)…")
    imports_country = fetch_monthly_group(IMPORTS_BY_COUNTRY, base=BASE_IMPCUS, label="imp_country")
    print("Pulling imports aggregates (OPEC/non-OPEC, monthly)…")
    imports_aggregates = fetch_monthly_group(IMPORTS_AGGREGATES, base=BASE_IMPCUS, label="imp_agg")
    print("Pulling exports by destination (monthly)…")
    exports_dest    = fetch_monthly_group(EXPORTS_BY_DEST,    base=BASE_EXPC,   label="exp_dest")
    print("Pulling production by state (monthly)…")
    prod_state      = fetch_monthly_group(PRODUCTION_BY_STATE,base=BASE_CRPDN,  label="prod_state")

    # ---- Natural gas + electricity domains ----
    # Load previous blocks (if data.json exists) so seeded keys survive a
    # failed fetch and each page stays populated.
    prev_ng, prev_elec = {}, {}
    try:
        with open("data.json") as pf:
            prev = json.load(pf)
            prev_ng   = prev.get("natural_gas", {}) or {}
            prev_elec = prev.get("electricity", {}) or {}
    except Exception:
        pass
    natural_gas = build_natural_gas(prev_ng)
    electricity = build_electricity(prev_elec)

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
        # Monthly breakdowns — partial population allowed
        "imports_by_country":        imports_country,
        "imports_aggregates":        imports_aggregates,
        "exports_by_destination":    exports_dest,
        "production_by_state":       prod_state,
        # Natural gas + electricity domains — peers to the petroleum blocks above
        "natural_gas":               natural_gas,
        "electricity":               electricity,
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

# Natural gas plausible bounds. Bounds are wide on purpose — same philosophy
# as the petroleum ranges (catch junk, not normal moves). Storage range
# allows for both seasonal extremes.
NG_RANGES = {
    "flows_bcfd": {
        "production":     (60, 130),
        "imports":        (2, 15),
        "rescom":         (6, 80),    # winter peak vs summer trough
        "industrial":     (12, 40),
        "electric":       (15, 55),
        "lng_exports":    (1, 25),
        "mexico_exports": (1, 12),
    },
    "stocks_bcf": {
        "working_gas":    (800, 4500),
    },
    "henry_hub":          (0.50, 25.0),
}

# Electricity plausible bounds — annual-rate T12M sums in TWh. Bounds are
# wide; same philosophy as the petroleum/NG ranges.
ELEC_RANGES = {
    "gen_twh": {
        "gas":     (1000, 2500),
        "nuclear": (500,  900),
        "coal":    (150,  1500),
        "wind":    (200,  900),
        "solar":   (100,  900),
        "hydro":   (150,  400),
        "biomass": (15,   100),
    },
    "demand_twh": {
        "residential": (1000, 2000),
        "commercial":  (1000, 1800),
        "industrial":  (700,  1400),
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

    # Natural gas — only check the keys that were actually fetched live.
    # Missing keys are fine; they're handled by seed fallback in the JS.
    ng = data.get("natural_gas", {}) or {}
    for k, (lo, hi) in NG_RANGES["flows_bcfd"].items():
        v = ng.get("flows_bcfd", {}).get(k)
        if v is not None and not (lo <= v <= hi):
            problems.append(f"natural_gas.flows_bcfd.{k}={v} outside [{lo},{hi}]")
    for k, (lo, hi) in NG_RANGES["stocks_bcf"].items():
        v = ng.get("stocks_bcf", {}).get(k)
        if v is not None and not (lo <= v <= hi):
            problems.append(f"natural_gas.stocks_bcf.{k}={v} outside [{lo},{hi}]")
    hh = (ng.get("meta", {}) or {}).get("henry_hub")
    if hh is not None:
        lo, hi = NG_RANGES["henry_hub"]
        if not (lo <= hh <= hi):
            problems.append(f"natural_gas.meta.henry_hub={hh} outside [{lo},{hi}]")

    # Electricity — soft check, only flag keys actually present this run
    elec = data.get("electricity", {}) or {}
    for k, (lo, hi) in ELEC_RANGES["gen_twh"].items():
        v = elec.get("gen_twh", {}).get(k)
        if v is not None and not (lo <= v <= hi):
            problems.append(f"electricity.gen_twh.{k}={v} outside [{lo},{hi}]")
    for k, (lo, hi) in ELEC_RANGES["demand_twh"].items():
        v = elec.get("demand_twh", {}).get(k)
        if v is not None and not (lo <= v <= hi):
            problems.append(f"electricity.demand_twh.{k}={v} outside [{lo},{hi}]")

    if problems:
        print("VERIFICATION FAILED — not writing data.json:", file=sys.stderr)
        for p in problems:
            print("  - " + p, file=sys.stderr)
        sys.exit(2)
    print("Verification passed ✓")


if __name__ == "__main__":
    main()
