# Energy Mechanics — U.S. energy system as live schematics

Interactive schematics of the U.S. energy system — petroleum, natural gas, electricity, and
the full LLNL-style total-energy Sankey — rendered as plumbing diagrams and Sankey ribbons
wired to live EIA data. Static site; no backend; refreshes weekly.

**Live:** https://secondorderedge.github.io/energy-mechanics/

---

## What's in here

Four overview schematics on the landing page, each clickable into deep-dive detail pages:

| Overview | Status | Detail pages |
|---|---|---|
| **Petroleum** (`petroleum.html`) | Live — weekly EIA WPSR | production, imports, refinery, exports, gasoline, distillate, jet, commercial, SPR, demand |
| **Natural Gas** (`naturalgas.html`) | Live — weekly storage + monthly NGM | storage, LNG, production, Mexico exports, demand, rigs, pipelines, Canada imports |
| **Electricity** (`electricity.html`) | Live — monthly EPM + EIA-860 capacity | gas, nuclear, coal, wind, solar, hydro |
| **Total Energy** (`totalenergy.html`) | Live — monthly MER + LLNL flow structure | (single Sankey page) |

Plus `about.html` for the full methodology and data sources, and 30+ pages total.

Each detail page carries the same masthead grammar, a 4-week sparkline + "vs 5-yr range"
indicator on every readout, and source EIA series IDs footnoted on each node so the data
lineage is inspectable.

---

## Architecture

- **Static site, no backend.** All HTML/CSS/JS. GitHub Pages serves it directly.
- **One JSON file (`data.json`)** holds every number. Every schematic reads it on page load.
- **GitHub Action (`update_data.py`)** pulls the EIA v2 API, computes 4-week trailing
  windows, same-week-of-year 5-yr ranges, and trailing-12-month sums for monthly series.
  Writes a single `data.json` and commits the change.
- **Cron** runs Thursdays at 14:00 UTC and 18:00 UTC — two attempts so holiday-delayed
  WPSR releases (Memorial Day, Labor Day, Thanksgiving, Christmas) still get caught the
  same week. Manual `workflow_dispatch` works any time.
- **Cache-busting**: the workflow stamps each asset URL with the short commit SHA before
  uploading the Pages artifact (`assets/petroleum.js?v=e05097fa`). Browsers always pick up
  fresh JS/CSS without manual refresh, but cache normally between deploys.
- **Soft-fail per series**: each EIA call is wrapped in try/except. A wrong series ID
  falls back to the previous value; the page stays populated and the workflow log shows
  which fetches failed for the next iteration.
- **Verify gate**: every value is sanity-checked against plausible bounds before
  `data.json` is written. Failure exits non-zero — the last-good `data.json` stays live.
- **Auto-injected freshness signals**: every detail page gets a "REFRESHED · Xh ago"
  badge in the topnav (red after a week — a stuck workflow becomes visible), plus prev/next
  sibling navigation linking across pages in the same domain.

---

## Data sources

| Domain | Source | Cadence |
|---|---|---|
| Petroleum flows + stocks + PADD | EIA Weekly Petroleum Status Report | Weekly (Wed ~10:30 ET) |
| Petroleum monthly | EIA Petroleum Supply Monthly — imports by country, exports by destination | Monthly (~end of month) |
| Natural gas flows | EIA Natural Gas Monthly — production, consumption by sector, LNG/pipeline exports/imports | Monthly |
| Natural gas storage | EIA Weekly Natural Gas Storage Report — working gas by region (R31–R35 + R48) | Weekly (Thu 10:30 ET) |
| Henry Hub | EIA daily price series | Daily |
| Electricity generation | EIA Electric Power Monthly — net generation by fuel + by state | Monthly (~25th) |
| Electricity capacity | EIA Form 860 via `operating-generator-capacity` — paginated sum across all generators | Monthly |
| Total energy | EIA Monthly Energy Review (MER) — primary energy consumption by source, in quads | Monthly + annual |
| Sankey flow structure | LLNL annual U.S. Energy Flow Chart | Annual (October) |
| Drilling rigs | EIA Drilling Productivity Report — per-basin rig counts (stand-in for Baker Hughes weekly) | Monthly |

See [`about.html`](https://secondorderedge.github.io/energy-mechanics/about.html) on the
live site for the full methodology, including the MER-actuals-vs-LLNL-fossil-equivalent
methodology choice for the Sankey, the 5-yr range band computation, T12M for monthly
data, and known limitations.

---

## One-time setup (~10 min)

1. **Get a free EIA API key**: https://www.eia.gov/opendata/register.php (instant).
2. **Add it as a repo secret**: Settings → Secrets and variables → Actions → New repository
   secret. Name: `EIA_API_KEY`, value: *(your key)*.
3. **Enable Pages**: Settings → Pages → Source: **GitHub Actions**.
4. **Run the workflow once**: Actions → "Refresh EIA data" → "Run workflow".

---

## Local development

```bash
export EIA_API_KEY=your_key       # only if you want to refresh data.json locally
python update_data.py             # optional — committed data.json works fine
python -m http.server 8000        # open http://localhost:8000/
```

The `?v=__BUILD__` placeholders in the HTML are stamped by the deploy workflow only —
locally they're just literal strings, which work the same since query parameters don't
affect file resolution.

---

## Data integrity

Several safety nets keep junk out of the live site:

- **Verify gate** (`verify()` in `update_data.py`) checks every value against plausible
  bounds: WTI ∈ [$10, $400], refinery utilization ∈ [50, 102]%, total U.S. primary energy
  ∈ [60, 140] quads, NG storage regions, electricity generation per fuel, etc. Failure
  exits non-zero and the previous `data.json` stays in place.
- **Soft balance check** confirms refinery inputs don't exceed crude supply.
- **Soft-fail per series**: a single bad EIA endpoint can't take down the whole build —
  it falls back to the previous value with a stderr note.
- **Per-source bounds inside live-data builders** for MER quads (catches unit-conversion
  errors that would otherwise produce 0.04-quad-petroleum values that pass the
  aggregate-sum check but render the Sankey nonsensical).
- **Strict live/seed status reporting**: status badges flip to "CACHED" when nothing
  resolved this run, so a stuck workflow doesn't silently keep claiming LIVE.

Adjust bounds in the `RANGES`, `NG_RANGES`, and `ELEC_RANGES` dicts near the bottom of
`update_data.py`.

---

## Live-data coverage

| Layer | Status |
|---|---|
| Petroleum: national flows + stocks + utilization + WTI | **Live** — weekly WPSR |
| Petroleum: PADD 1–5 breakdowns (crude, gasoline, distillate stocks + production) | **Live** — WCESTP11–51 family |
| Petroleum: monthly imports by country (CA, MX, SA, CO) | **Live** — PSM |
| Petroleum: monthly exports by destination (CN, KR) | **Live** — PSM |
| Natural gas: weekly working gas storage (Lower 48 + 5 regions) | **Live** — structural facets on stor/wkly |
| Natural gas: monthly production, imports, consumption by sector, LNG/pipeline exports | **Live** — NGM |
| Natural gas: Henry Hub daily | **Live** |
| Electricity: net generation by fuel (gas/nuc/coal/wind/solar/hydro/biomass) | **Live** — EPM |
| Electricity: by-state for each major fuel (top 5 states each) | **Live** — EPM by location |
| Electricity: solar utility/distributed split, coal rank (BIT/SUB/LIG), pumped storage | **Live** — EPM fueltypes |
| Electricity: retail sales by sector (residential/commercial/industrial) | **Live** — EIA-861 retail-sales |
| Electricity: nameplate capacity per fuel (paginated across thousands of generators) | **Live** — EIA-860 operating-generator-capacity |
| Total energy: primary consumption by 7 of 9 sources (petroleum, NG, coal, nuclear, biomass, wind, solar, geo) | **Live** — MER |
| Total energy: flow distribution shape | **Seeded** — LLNL annual chart |
| Drilling rigs by basin | **Seeded** — DPR endpoint URL pending validation |
| 4-week trailing sparklines + same-week-of-year 5-yr ranges | **Live** — derived from history fetch |

Every detail page's footnote names the specific EIA series it pulls from. Seeded
allocations scale from live national totals so they move correctly week-to-week —
they're just less precise than per-fuel or per-region fetches.

---

## Repo layout

```
update_data.py         # the workflow script — pulls EIA, writes data.json
data.json              # the single source of truth, refreshed weekly
index.html             # landing page (4 cards + hero stats + freshness badge)
about.html             # methodology + data sources
petroleum.html         # overview schematic
naturalgas.html        # overview schematic
electricity.html       # overview schematic
totalenergy.html       # LLNL Sankey
{petroleum,ng*,solar,wind,...}.html   # 24 detail pages
assets/
  style.css            # shared blueprint aesthetic + mobile responsive
  charts.js            # EM_sparkline, EM_rangeBadge, EM_color helpers
  cadence.js           # EM_setNextRelease helper, auto-injects refresh-ago badge
                       # and prev/next sibling nav on every page that loads it
  petroleum.js         # one JS file per page; reads data.json, populates the SVG
  naturalgas.js, electricity.js, totalenergy.js, ...
  favicon.svg
.github/workflows/
  refresh.yml          # cron + manual + push triggers
```

---

## License

MIT (see `LICENSE`). Built by Second Order Edge.
