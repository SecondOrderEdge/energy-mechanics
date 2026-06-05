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
# EIA Drilling Productivity Report — monthly per-basin rig counts, DUCs, etc.
# Stands in for Baker Hughes weekly data (which has no public JSON API).
# Previously tried /crd/dwply (HTTPError); /crd/dwc (drilled & completed wells)
# is the documented sub-endpoint exposing rig counts.
BASE_DPR    = "https://api.eia.gov/v2/petroleum/crd/dwc/data/"

# Electricity dataset paths (Electric Power Monthly)
BASE_ELEC_OP     = "https://api.eia.gov/v2/electricity/electric-power-operational-data/data/"
BASE_ELEC_RETAIL = "https://api.eia.gov/v2/electricity/retail-sales/data/"
# Operating-generator capacity (EIA-860, record-level — one row per generator).
# Different endpoint from the operational-data one; the latter has generation
# columns but no capacity. Sum-over-generators for fleet totals.
BASE_ELEC_CAP    = "https://api.eia.gov/v2/electricity/operating-generator-capacity/data/"

# Monthly Energy Review — aggregated U.S. energy accounting in quad BTU.
# Series faceted by MSN codes; values come back in billion BTU (÷1e6 → quads).
BASE_MER = "https://api.eia.gov/v2/total-energy/data/"

# Natural gas dataset paths
BASE_NG_STOR_WKLY = "https://api.eia.gov/v2/natural-gas/stor/wkly/data/"
BASE_NG_PRICE     = "https://api.eia.gov/v2/natural-gas/pri/fut/data/"
BASE_NG_PROD      = "https://api.eia.gov/v2/natural-gas/prod/sum/data/"
BASE_NG_CONS      = "https://api.eia.gov/v2/natural-gas/cons/sum/data/"
BASE_NG_MOVE_EXP  = "https://api.eia.gov/v2/natural-gas/move/expc/data/"
BASE_NG_MOVE_IMP  = "https://api.eia.gov/v2/natural-gas/move/impc/data/"

# WTI Cushing spot price (daily), $/bbl
WTI_SERIES   = "RWTC"
BRENT_SERIES = "RBRTE"   # Europe Brent Spot Price FOB, $/bbl, daily
# Wholesale product spot prices for the 3-2-1 crack spread ($/gal × 42 → $/bbl).
# NY Harbor is the canonical pricing point. First attempt used "EPMRR" (typo);
# EIA uses "EPMRU" for Regular Unleaded gasoline. Soft-fail per series.
GASOLINE_SPOT_SERIES   = "EER_EPMRU_PF4_Y35NY_DPG"   # NY Harbor Regular Conventional Gasoline
DISTILLATE_SPOT_SERIES = "EER_EPD2DXL0_PF4_Y35NY_DPG" # NY Harbor ULSD No.2

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

# Natural gas — weekly working gas in storage (EIA Natural Gas Weekly, Thu 10:30 ET).
# The v2 stor/wkly endpoint's `series` facet refuses every form of the legacy
# NW2_EPG0_SWO_R48_BCF ID (with or without unit suffix). The structural facets
# (duoarea/product/process) are what v2 actually accepts here — keys below are
# our internal names; values are the duoarea region codes.
NG_STOR_AREAS = {
    "working_gas":   "R48",   # Lower 48 total
    "east":          "R31",
    "midwest":       "R32",
    "south_central": "R33",   # Salt + non-salt domes (TX/LA) — largest after East
    "mountain":      "R34",   # CO/UT/WY — smallest
    "pacific":       "R35",   # CA/OR/WA
}
# Henry Hub natural gas spot price (daily, $/MMBtu)
NG_HH_SERIES = "RNGWHHD"

# Monthly Natural Gas Monthly (NGM) flow series — best-guess against EIA naming.
# Units: most NG flow series are MMcf for the month; we scale by ~30 to get
# bcf/d for display (close enough; refine if precision matters).
NG_PRODUCTION_SERIES = {
    "production": "N9050US2",   # dry production (move/sum endpoint)
}
NG_IMPORTS_SERIES = {
    "imports":    "N9100US2",   # natural gas imports total (move/impc endpoint)
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

# MER MSN codes for primary energy consumption by source, U.S. total.
# Confirmed live (returned data in latest run): PMTCBUS, CLTCBUS, NUETBUS,
# BMTCBUS, WYTCBUS, SOTCBUS, GETCBUS. NGTCBUS + HYTCBUS returned no-obs —
# alternatives below. Soft-fails per series so a bad code keeps that source
# at its seeded LLNL value rather than killing the run.
MER_SOURCE_MSN = {
    "petroleum":   "PMTCBUS",
    "natural_gas": "NNTCBUS",   # try the dry-gas variant; NGTCBUS returned no-obs
    "coal":        "CLTCBUS",
    "nuclear":     "NUETBUS",   # NUETBUS is electricity-sector (the only nuclear consumption)
    "biomass":     "BMTCBUS",
    "wind":        "WYTCBUS",
    "solar":       "SOTCBUS",
    "hydro":       "HYTPBUS",   # try production variant; TCBUS & EGBUS both failed
    "geothermal":  "GETCBUS",
}
# MSN codes for electric power sector inputs + losses (intermediate node).
MER_ELEC_MSN = {
    "input":       "TEPSBUS",   # Total energy consumed for electricity generation
    "losses":      "ELNIBUS",   # Electrical system energy losses (rejected)
}
# EIA Drilling Productivity Report — area facets are the 7 named DPR regions.
# Best-guess area string values; soft-fails to seed if the area name is wrong.
DPR_REGIONS = {
    "permian":     "Permian Region",
    "bakken":      "Bakken Region",
    "eagle_ford":  "Eagle Ford Region",
    "anadarko":    "Anadarko Region",
    "appalachia":  "Appalachia Region",
    "haynesville": "Haynesville Region",
    "niobrara":    "Niobrara Region",
}
# How Baker Hughes-style oil/gas split applies to each basin. Values are the
# share of the basin's rigs that target oil (the rest targets gas). Used to
# allocate DPR rigs into oil/gas buckets that the ngrigs page expects.
DPR_BASIN_OIL_SHARE = {
    "permian":     0.95,
    "bakken":      0.97,
    "eagle_ford":  0.70,
    "anadarko":    0.60,
    "appalachia":  0.05,
    "haynesville": 0.02,
    "niobrara":    0.85,
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


def build_rigs(prev_rigs):
    """Pull EIA Drilling Productivity Report per-basin rig counts as a stand-in
    for Baker Hughes weekly data (which has no public JSON API). DPR publishes
    monthly with ~1-month lag; that's fine for a directional indicator. The
    ngrigs page expects an oil/gas split per basin — DPR reports rigs as a
    single basin number, so we apportion via DPR_BASIN_OIL_SHARE seeded
    convention.

    prev_rigs: previous data.json's natural_gas_rigs block (seed fallback).
    Soft-fails per region — wrong area name keeps that region at seed."""
    seed = prev_rigs or {}
    prev_gas = seed.get("gas", {}) or {}
    prev_oil = seed.get("oil", {}) or {}

    # Pull latest rig count per region.
    print("Pulling DPR rig counts by basin…")
    basin_rigs = {}
    latest_period = None
    for key, area in DPR_REGIONS.items():
        try:
            monthly = eia_monthly_series(BASE_DPR, facets={"area": area},
                                          data_col="rigs", length=12)
            if not monthly:
                # Some DPR sub-endpoints expose rig count under a different
                # column name; try the alt before giving up.
                monthly = eia_monthly_series(BASE_DPR, facets={"area": area},
                                              data_col="value", length=12)
            if not monthly:
                raise ValueError("no rig obs")
            basin_rigs[key] = int(round(monthly[0][1]))
            latest_period = monthly[0][0] if latest_period is None else max(latest_period, monthly[0][0])
            print(f"  rigs.{key:12s} {area:22s} = {basin_rigs[key]:>4d}  ({monthly[0][0]})")
        except Exception as exc:
            print(f"  rigs.{key:12s} {area:22s} = FAIL ({type(exc).__name__}); seed fallback", file=sys.stderr)

    # If nothing resolved, preserve seed verbatim — explicitly seed status.
    if not basin_rigs:
        out = dict(seed)
        out.setdefault("meta", {})
        out["meta"].setdefault("vintage", "—")
        out["meta"].setdefault("source",  "baker_hughes_seed")
        out["meta"]["status"] = "seed"
        return out

    # Apportion per-basin DPR rigs into oil/gas buckets the page expects.
    gas_bucket = {"haynesville": 0, "appalachia": 0, "other": 0}
    oil_bucket = {"permian": 0, "bakken": 0, "eagle_ford": 0, "anadarko": 0, "other": 0}
    for key, count in basin_rigs.items():
        oil_share = DPR_BASIN_OIL_SHARE.get(key, 0.5)
        oil_n = int(round(count * oil_share))
        gas_n = count - oil_n
        if key in oil_bucket: oil_bucket[key] += oil_n
        else:                 oil_bucket["other"] += oil_n
        if key in gas_bucket: gas_bucket[key] += gas_n
        else:                 gas_bucket["other"] += gas_n

    # For any bucket key we didn't touch live, preserve the seeded value
    # (e.g. "other" categories that aren't covered by the 7 DPR basins).
    for k, v in prev_gas.items(): gas_bucket.setdefault(k, v)
    for k, v in prev_oil.items(): oil_bucket.setdefault(k, v)

    total_us = sum(gas_bucket.values()) + sum(oil_bucket.values())

    # Vintage: month_vintage of latest period if any live, else seed.
    vintage = month_vintage(latest_period) if latest_period else (
        seed.get("meta", {}).get("vintage") or "—")

    return {
        "meta": {
            "vintage": vintage,
            "source":  "eia_dpr",
            "status":  "live",
            "note":    "EIA Drilling Productivity Report monthly per-basin rig count, allocated to oil/gas by basin convention",
        },
        "gas":               gas_bucket,
        "oil":               oil_bucket,
        "total_us":          total_us,
        "ducs":              seed.get("ducs", 4500),
        "history":           seed.get("history", {"gas_total": [89, 92, 91, 88]}),
        "gas_total_5yr_range": seed.get("gas_total_5yr_range",
                                        {"min": 65, "avg": 110, "max": 160, "n": 5}),
        "five_yr_avg_total": seed.get("five_yr_avg_total", 720),
    }


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
    live = False  # flip true the moment any EIA fetch resolves

    # ---- Weekly working gas in storage (the headline indicator) ----
    # Uses structural facets (duoarea/product/process) — the `series` facet
    # rejected every form of the legacy NW2_EPG0_SWO_R*_BCF IDs.
    print("Pulling NG working gas in storage (weekly)…")
    stor_latest, stor_periods, stor_hist, stor_5yr = {}, {}, {}, {}
    for name, area in NG_STOR_AREAS.items():
        try:
            weekly = eia_monthly_series(
                BASE_NG_STOR_WKLY,
                facets={"duoarea": area, "product": "EPG0", "process": "SWO"},
                data_col="value", frequency="weekly", length=320,
            )
            if not weekly:
                raise ValueError("no obs")
            stor_latest[name]  = weekly[0][1]
            stor_periods[name] = weekly[0][0]
            stor_hist[name]    = [round(v, 0) for _, v in weekly[:4]]
            stor_5yr[name]     = range_5yr(weekly, scale=1.0)
            print(f"  storage.{name:14s} {area:5s} = {weekly[0][1]:>6.0f} bcf  ({weekly[0][0]})")
        except Exception as exc:
            print(f"  storage.{name:14s} {area:5s} = FAIL ({type(exc).__name__})", file=sys.stderr)

    # Map the working_gas key (Lower 48 total) into stocks_bcf for naturalgas.js
    if "working_gas" in stor_latest:
        stocks["working_gas"] = round(stor_latest["working_gas"], 0)
        history["working_gas"] = stor_hist["working_gas"]
        ranges_5yr["working_gas"] = stor_5yr["working_gas"]
        meta["vintage"] = vintage(stor_periods["working_gas"])
        live = True
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
        live = True
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
    print("Pulling NG production (monthly)…")
    prod = fetch_monthly_group(NG_PRODUCTION_SERIES,
        base=BASE_NG_PROD, scale=MONTHLY_SCALE, label="ng_prod")
    print("Pulling NG imports (monthly)…")
    imp_in = fetch_monthly_group(NG_IMPORTS_SERIES,
        base=BASE_NG_MOVE_IMP, scale=MONTHLY_SCALE, label="ng_imp")
    print("Pulling NG consumption by sector (monthly)…")
    cons = fetch_monthly_group(NG_CONSUMPTION_SERIES,
        base=BASE_NG_CONS, scale=MONTHLY_SCALE, label="ng_cons")
    print("Pulling NG exports (monthly)…")
    exp = fetch_monthly_group(NG_EXPORTS_SERIES,
        base=BASE_NG_MOVE_EXP, scale=MONTHLY_SCALE, label="ng_exp")

    # Merge into flows_bcfd, summing residential + commercial as the
    # naturalgas.js "rescom" expects.
    if "production" in prod:        flows["production"]    = round(prod["production"], 1); live = True
    if "imports"    in imp_in:      flows["imports"]       = round(imp_in["imports"], 1);  live = True
    if "industrial" in cons:        flows["industrial"]    = round(cons["industrial"], 1); live = True
    if "electric"   in cons:        flows["electric"]      = round(cons["electric"], 1);   live = True
    if "rescom" in cons and "commercial" in cons:
        flows["rescom"] = round(cons["rescom"] + cons["commercial"], 1); live = True
    elif "rescom" in cons:
        flows["rescom"] = round(cons["rescom"], 1); live = True
    if "lng_exports"    in exp:     flows["lng_exports"]    = round(exp["lng_exports"], 1);    live = True
    if "mexico_exports" in exp:     flows["mexico_exports"] = round(exp["mexico_exports"], 1); live = True

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

    # Live = any EIA fetch resolved this run. The previous check on
    # "working_gas in stocks" was a footgun — prev-preservation happens above
    # this line, so once a working_gas value was ever cached we'd report live
    # forever even if every subsequent fetch failed. Strict reporting is
    # important: stale prev-cached values still get displayed (so the page
    # doesn't go blank), but the status badge tells viewers whether the data
    # actually refreshed this run.
    meta["status"] = "live" if live else "seed"
    meta.setdefault("vintage", prev_meta.get("vintage", "—"))

    return {
        "meta":        meta,
        "flows_bcfd":  flows,
        "stocks_bcf":  stocks,
        "history":     history,
        "ranges_5yr":  ranges_5yr,
    }


def _eia_rows_faceted(base, frequency, facets, data_col, length, retries=3, offset=0):
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
        ("offset", str(offset)),
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


def _eia_rows_faceted_paginated(base, frequency, facets, data_col, max_rows=20000, page_size=5000):
    """Loop _eia_rows_faceted with increasing offset until the API returns
    fewer rows than page_size (signaling the last page). Use for record-level
    endpoints like operating-generator-capacity where a fuel can have many
    thousand rows and the 5000-row default truncates mid-fleet."""
    all_rows = []
    offset = 0
    while len(all_rows) < max_rows:
        page = _eia_rows_faceted(base, frequency, facets, data_col,
                                  length=page_size, offset=offset)
        if not page:
            break
        all_rows.extend(page)
        if len(page) < page_size:
            break  # last page
        offset += page_size
    return all_rows


def eia_monthly_series(base, facets, data_col="generation", length=120, frequency="monthly"):
    """Pull observations for a faceted query and sum within each period.
    Default frequency is monthly; pass frequency="weekly" for endpoints like
    natural-gas/stor/wkly. Returns [(period, value), ...] most recent first."""
    rows = _eia_rows_faceted(base, frequency, facets, data_col, length)
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


def eia_capacity_gw(facets):
    """Sum nameplate-capacity-mw across all matching generators in the latest
    month, return GW. Paginates through the EIA-860 operating-generator-
    capacity endpoint — a single fuel like NG or SUN has ~5k–15k generator
    rows nationwide, so the 5000-row default truncates mid-fleet."""
    rows = _eia_rows_faceted_paginated(BASE_ELEC_CAP, "monthly", facets,
                                        data_col="nameplate-capacity-mw")
    if not rows:
        raise ValueError("no capacity obs")
    # Group by period, sum capacity, take the latest period.
    by_period = {}
    for row in rows:
        v = row.get("nameplate-capacity-mw")
        p = row.get("period")
        if v in (None, "", ".") or not p:
            continue
        try:
            by_period[p] = by_period.get(p, 0.0) + float(v)
        except (TypeError, ValueError):
            continue
    if not by_period:
        raise ValueError("no usable capacity rows")
    latest = max(by_period.keys())
    return round(by_period[latest] / 1000.0, 1)


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

    # Gas split by prime mover (CCGT vs SCGT vs steam) — kept seeded.
    # The v2 operational-data endpoint doesn't accept a `primeMover` facet
    # (returns HTTPError); the prime-mover breakdown lives in EIA-860 instead
    # and would need a separate wiring pass. Leaving as seed for now.

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

    # ---- Nameplate capacity per fuel (EIA-860 operating-generator-capacity) ----
    # This endpoint is record-level (one row per generator), faceted by
    # energy_source_code (BIT/SUB/LIG/NG/NUC/WND/SUN/WAT/...). Coal needs the
    # three rank codes combined; conventional vs pumped hydro both use WAT
    # fuel but differ on prime_mover_code (PS = pumped storage). Where EIA
    # doesn't break out a sub-tech (PWR/BWR, CCGT/SCGT), seeded sub-ratios
    # scale against the live total.
    print("Pulling nameplate capacity by fuel (GW)…")

    def _cap_pull(facets, label):
        try:
            gw = eia_capacity_gw(facets)
            print(f"  cap.{label:18s} = {gw:>6.1f} GW")
            return gw
        except Exception as exc:
            print(f"  cap.{label:18s} = FAIL ({type(exc).__name__}); seed fallback", file=sys.stderr)
            return None

    op_facet = {"status": "OP"}   # operating units only

    # Solar — separate codes for utility-scale (SUN) vs distributed-PV (DPV).
    util_gw = _cap_pull({"energy_source_code": "SUN", **op_facet}, "solar.utility")
    dist_gw = _cap_pull({"energy_source_code": "DPV", **op_facet}, "solar.dist")
    if util_gw is not None: solar_detail["utility_gw"]     = util_gw
    if dist_gw is not None: solar_detail["distributed_gw"] = dist_gw
    if util_gw is not None or dist_gw is not None: live = True

    # Wind — single WND fuel code; offshore stays at the seeded ~few GW.
    wind_gw = _cap_pull({"energy_source_code": "WND", **op_facet}, "wind.total")
    if wind_gw is not None:
        prev_off = (prev_elec or {}).get("wind_detail", {}).get("offshore_gw", 4)
        wind_detail["offshore_gw"] = prev_off
        wind_detail["onshore_gw"]  = round(max(0, wind_gw - prev_off), 1)
        live = True

    # Nuclear — aggregate NUC; PWR/BWR sub-split via seeded ratio.
    nuc_gw = _cap_pull({"energy_source_code": "NUC", **op_facet}, "nuclear.total")
    if nuc_gw is not None:
        prev_nd  = (prev_elec or {}).get("nuclear_detail", {})
        seed_pwr = prev_nd.get("pwr_gw", 67)
        seed_bwr = prev_nd.get("bwr_gw", 28)
        ratio = seed_pwr / (seed_pwr + seed_bwr) if (seed_pwr + seed_bwr) > 0 else 0.7
        nuclear_detail["pwr_gw"] = round(nuc_gw * ratio,        1)
        nuclear_detail["bwr_gw"] = round(nuc_gw * (1 - ratio),  1)
        live = True

    # Coal — sum BIT + SUB + LIG (EIA-860 reports each rank separately).
    coal_gw = _cap_pull({"energy_source_code": ["BIT", "SUB", "LIG"], **op_facet}, "coal.total")
    if coal_gw is not None:
        coal_detail["total_gw"] = coal_gw
        live = True

    # Hydro — both use WAT fuel; conventional vs pumped split via prime mover.
    # HY = conventional hydro, PS = pumped storage.
    hyc_gw = _cap_pull({"energy_source_code": "WAT", "prime_mover_code": "HY", **op_facet}, "hydro.conv")
    hps_gw = _cap_pull({"energy_source_code": "WAT", "prime_mover_code": "PS", **op_facet}, "hydro.pumped")
    if hyc_gw is not None: hydro_detail["conventional_gw"] = hyc_gw
    if hps_gw is not None: hydro_detail["pumped_gw"]       = hps_gw
    if hyc_gw is not None or hps_gw is not None: live = True

    # Gas — aggregate NG; CCGT/SCGT sub-split via seeded ratio.
    gas_gw = _cap_pull({"energy_source_code": "NG", **op_facet}, "gas.total")
    if gas_gw is not None:
        prev_gd  = (prev_elec or {}).get("gas_detail", {})
        seed_cc  = prev_gd.get("ccgt_gw", 280)
        seed_gt  = prev_gd.get("scgt_gw", 150)
        ratio = seed_cc / (seed_cc + seed_gt) if (seed_cc + seed_gt) > 0 else 0.65
        gas_detail["ccgt_gw"] = round(gas_gw * ratio,        1)
        gas_detail["scgt_gw"] = round(gas_gw * (1 - ratio),  1)
        live = True

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


def build_total_energy(prev_te):
    """Pull EIA Monthly Energy Review (MER) primary-energy consumption by
    source, and rescale the LLNL Sankey's flow distribution to live magnitudes.

    Strategy: LLNL's flow chart describes the *shape* of U.S. energy flows
    (which source goes where, and how much electricity gets converted to waste
    heat). MER provides the *magnitudes* — total U.S. quads per source,
    updated monthly. We keep the LLNL flow ratios as the structural seed and
    rescale each flow by its source's live/seed factor. Sectors and the
    electricity intermediate are then derived from the scaled flow set.

    prev_te: the previous data.json's total_energy block (used as the
    seed when MER fetches fail). Pass {} on first run.

    Soft-fails per series — any MSN that fails to resolve leaves that source
    at its seeded magnitude, so wrong codes degrade gracefully."""
    seed = prev_te or {}
    sources_seed = seed.get("sources_quads", {}) or {}
    flows_seed   = seed.get("flows", []) or []
    elec_seed    = seed.get("electricity_quads", {}) or {}
    meta_seed    = seed.get("meta", {}) or {}

    sources_live = {}
    latest_period = None

    print("Pulling MER primary energy by source (monthly)…")
    # Per-source plausible quads bounds. If a fetched value lands outside
    # the band we treat it as junk (most likely a unit mismatch or wrong
    # MSN) and fall back to seed. Prevents a bad code from killing the
    # build via the verify gate downstream.
    MER_BOUNDS = {
        "petroleum":   (25, 50),
        "natural_gas": (20, 45),
        "coal":        (3,  20),
        "nuclear":     (4,  12),
        "biomass":     (2,  10),
        "wind":        (1,  10),
        "solar":       (0.5, 8),
        "hydro":       (1,   5),
        "geothermal":  (0.05, 1),
    }
    for name, msn in MER_SOURCE_MSN.items():
        try:
            monthly = eia_monthly_series(BASE_MER, facets={"msn": msn},
                                         data_col="value")
            t12 = t12m_series(monthly)
            if not t12:
                raise ValueError("insufficient months")
            # MER consumption series report monthly values in Trillion Btu;
            # T12M sum is annual Trillion Btu; ÷1000 → quads (10^15 Btu).
            q = round(t12[0][1] / 1.0e3, 2)
            lo, hi = MER_BOUNDS.get(name, (0, 1000))
            if not (lo <= q <= hi):
                raise ValueError(f"value {q} out of plausible range [{lo},{hi}] — likely wrong MSN or unit")
            sources_live[name] = q
            latest_period = t12[0][0] if latest_period is None else min(latest_period, t12[0][0])
            print(f"  mer.{name:12s} {msn:8s} T12M = {q:>6.2f} quads  ({t12[0][0]})")
        except Exception as exc:
            print(f"  mer.{name:12s} {msn:8s} = FAIL ({type(exc).__name__}: {exc}); seed fallback",
                  file=sys.stderr)

    # Combine: live where we got it, seed elsewhere.
    sources_quads = {k: sources_live.get(k, sources_seed.get(k, 0.0))
                     for k in MER_SOURCE_MSN.keys()}

    # Per-source scale factor for rescaling flows.
    scale = {}
    for k in sources_quads:
        seed_v = sources_seed.get(k, 0.0)
        scale[k] = (sources_quads[k] / seed_v) if seed_v > 0 else 1.0

    # Rescale every flow by its source's scale factor (preserves LLNL shape).
    flows = []
    for f in flows_seed:
        sk = f.get("from"); tk = f.get("to"); q = f.get("q", 0.0)
        if sk is None or tk is None: continue
        new_q = round(q * scale.get(sk, 1.0), 3)
        flows.append({"from": sk, "to": tk, "q": new_q})

    # Compute sector totals from inbound flows. Sectors get direct-from-source
    # flows + electricity-to-sector flows. The latter we compute next.
    SECTOR_KEYS = ["residential", "commercial", "industrial", "transportation"]

    # Electricity input = sum of scaled flows whose target is "electricity".
    elec_input = sum(f["q"] for f in flows if f["to"] == "electricity")

    # Electricity in→out efficiency from the seed; carry through to live magnitudes.
    seed_elec_input = elec_seed.get("input", 0.0)
    if seed_elec_input > 0:
        elec_eff = elec_seed.get("useful_out", 0.0) / seed_elec_input
    else:
        elec_eff = 0.33    # LLNL canonical thermal-conversion efficiency
    elec_useful   = round(elec_input * elec_eff, 2)
    elec_rejected = round(elec_input - elec_useful, 2)

    # Electricity → sector flows, scaled by the live elec_input / seed_input.
    elec_scale = (elec_input / seed_elec_input) if seed_elec_input > 0 else 1.0
    elec_to = {
        "residential":    round(elec_seed.get("to_residential", 0.0) * elec_scale, 2),
        "commercial":     round(elec_seed.get("to_commercial",  0.0) * elec_scale, 2),
        "industrial":     round(elec_seed.get("to_industrial",  0.0) * elec_scale, 2),
        "transportation": round(elec_seed.get("to_transport",   0.0) * elec_scale, 2),
    }

    # Sector totals = direct flows (sources→sector) + electricity→sector.
    sectors_quads = {}
    for sk in SECTOR_KEYS:
        direct = sum(f["q"] for f in flows if f["to"] == sk)
        sectors_quads[sk] = round(direct + elec_to[sk], 2)

    # Useful/rejected pools — LLNL methodology by end-use sector.
    SECTOR_EFF = {"residential": 0.65, "commercial": 0.65,
                  "industrial": 0.49, "transportation": 0.21}
    useful_q   = sum(sectors_quads[s] * SECTOR_EFF[s] for s in SECTOR_KEYS)
    rejected_q = sum(sectors_quads[s] * (1 - SECTOR_EFF[s]) for s in SECTOR_KEYS) + elec_rejected
    useful_rejected = {
        "useful":   round(useful_q,   1),
        "rejected": round(rejected_q, 1),
    }

    electricity_quads = {
        "input":       round(elec_input,   2),
        "useful_out":  elec_useful,
        "rejected":    elec_rejected,
        "to_residential": elec_to["residential"],
        "to_commercial":  elec_to["commercial"],
        "to_industrial":  elec_to["industrial"],
        "to_transport":   elec_to["transportation"],
    }

    # Meta: live if at least one MER source resolved.
    if sources_live:
        vintage = month_vintage(latest_period) if latest_period else meta_seed.get("vintage", "ANNUAL")
        status = "live"
    else:
        vintage = meta_seed.get("vintage", "ANNUAL")
        status = meta_seed.get("status", "seed")

    return {
        "meta": {
            "vintage":     vintage,
            "release":     "EIA Monthly Energy Review · structure from LLNL Energy Flow Chart",
            "release_url": "https://flowcharts.llnl.gov/commodities/energy",
            "status":      status,
            "unit":        "quads",
            "unit_long":   "quadrillion BTU",
        },
        "sources_quads":         sources_quads,
        "sectors_quads":         sectors_quads,
        "electricity_quads":     electricity_quads,
        "useful_rejected_quads": useful_rejected,
        "flows":                 flows,
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
    prev_ng, prev_elec, prev_te, prev_rigs = {}, {}, {}, {}
    try:
        with open("data.json") as pf:
            prev = json.load(pf)
            prev_ng   = prev.get("natural_gas", {})       or {}
            prev_elec = prev.get("electricity", {})       or {}
            prev_te   = prev.get("total_energy", {})      or {}
            prev_rigs = prev.get("natural_gas_rigs", {})  or {}
    except Exception:
        pass
    natural_gas  = build_natural_gas(prev_ng)
    electricity  = build_electricity(prev_elec)
    total_energy = build_total_energy(prev_te)
    rigs         = build_rigs(prev_rigs)

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

    print("Pulling Brent spot (daily)…")
    brent = None
    try:
        brent, brent_date = eia_latest(BRENT_SERIES, base=BASE_SPT, frequency="daily")
        print(f"  brent              {BRENT_SERIES:10s} = {brent:>10,.2f}  ({brent_date})")
    except Exception as e:
        print(f"  Brent fetch failed ({e}); leaving as None", file=sys.stderr)

    # 3-2-1 crack spread — refining-margin "canary." Standard formula:
    # 2 bbl gasoline + 1 bbl distillate − 3 bbl crude, divided by 3 → margin
    # per crude barrel. Product prices come back in $/gal; ×42 → $/bbl.
    # Soft-fails to seed if either spot series fails.
    crack_spread = None
    print("Pulling product spot prices for 3-2-1 crack spread…")
    try:
        gas_gal, gas_date  = eia_latest(GASOLINE_SPOT_SERIES,   base=BASE_SPT, frequency="daily")
        dist_gal, dist_date = eia_latest(DISTILLATE_SPOT_SERIES, base=BASE_SPT, frequency="daily")
        gas_bbl, dist_bbl = gas_gal * 42, dist_gal * 42
        crack_spread = round((2*gas_bbl + 1*dist_bbl - 3*wti) / 3, 2)
        print(f"  gasoline spot      {GASOLINE_SPOT_SERIES:28s} = ${gas_gal:>5.3f}/gal (${gas_bbl:.2f}/bbl)  ({gas_date})")
        print(f"  distillate spot    {DISTILLATE_SPOT_SERIES:28s} = ${dist_gal:>5.3f}/gal (${dist_bbl:.2f}/bbl)  ({dist_date})")
        print(f"  3-2-1 crack spread = ${crack_spread:.2f}/bbl")
    except Exception as exc:
        print(f"  crack spread       = FAIL ({type(exc).__name__}); seed fallback", file=sys.stderr)

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
            "brent": round(brent, 2) if brent is not None else None,
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
            "crack_spread_321": crack_spread,   # None if either spot fetch failed; consumer falls back to seed
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
        # Natural gas + electricity + total-energy domains — peers to petroleum
        "natural_gas":               natural_gas,
        "electricity":               electricity,
        "total_energy":              total_energy,
        "natural_gas_rigs":          rigs,
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

    # Total energy — sanity bounds on aggregate primary energy. Only enforced
    # when the block ran live (else build_total_energy fell back to seed and
    # the values are guaranteed sensible). Per-source bounds in
    # build_total_energy already discard junk before it reaches the verify gate.
    te = data.get("total_energy", {}) or {}
    if (te.get("meta") or {}).get("status") == "live":
        srcs = te.get("sources_quads") or {}
        if srcs:
            total_primary = sum(srcs.values())
            if not (60 <= total_primary <= 140):
                problems.append(f"total_energy primary sum={total_primary:.1f} outside [60,140] quads")

    if problems:
        print("VERIFICATION FAILED — not writing data.json:", file=sys.stderr)
        for p in problems:
            print("  - " + p, file=sys.stderr)
        sys.exit(2)
    print("Verification passed ✓")


if __name__ == "__main__":
    main()
