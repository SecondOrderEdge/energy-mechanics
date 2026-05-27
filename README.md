# Energy Mechanics — U.S. petroleum balance

Interactive schematic of the U.S. petroleum system — crude in, refining, products out, with
the Strategic Petroleum Reserve overlaid — rendered as plumbing and wired to live EIA data.
Static site; no backend.

**Live:** https://secondorderedge.github.io/energy-mechanics/

---

## Pages

| URL | What |
|---|---|
| `index.html` | Landing page with cards linking every section |
| `petroleum.html` | The overview schematic — every node is clickable |
| `production.html` | Crude production by PADD + top producing states |
| `imports.html` | Crude imports by source country + grade mix |
| `refinery.html` | Refinery throughput, PADD utilization, yield mix |
| `exports.html` | Crude exports by destination + port allocations |
| `gasoline.html` | Gasoline production + stocks by PADD |
| `distillate.html` | Distillate (diesel + heating oil) by PADD |
| `jet.html` | Jet fuel + the long-tail products (LPG, naphtha, etc.) |
| `commercial.html` | Commercial crude stocks by PADD with Cushing called out |
| `spr.html` | SPR drawdown across four salt-dome sites |
| `demand.html` | Product supplied breakdown by product category |

Every page carries the same masthead grammar, a 4-week sparkline + "vs 5-yr range" indicator
on every readout, and the EIA series ID footnoted on each node so the data lineage is
inspectable.

---

## Architecture

- **Static site, no backend.** All HTML/CSS/JS. GitHub Pages serves it directly.
- **One JSON file (`data.json`)** holds every number. The HTML reads it on page load.
- **GitHub Action (`update_data.py`)** pulls the EIA v2 API, computes 4-week trailing windows
  and same-week-of-year 5-yr ranges, and overwrites `data.json` every Thursday morning ET
  (the day after the EIA WPSR Wednesday release).
- **Cache-busting**: the workflow stamps each asset URL with the short commit SHA before
  uploading the Pages artifact (`assets/petroleum.js?v=e05097fa`), so browsers always pick up
  the latest JS/CSS without a manual hard refresh.
- **Seed fallback**: `data.json` is checked in with sensible seed values so the page renders
  correctly even before the first cron run.

---

## One-time setup (~10 min)

1. **Get a free EIA API key**: https://www.eia.gov/opendata/register.php (instant).
2. **Add it as a repo secret**: Settings → Secrets and variables → Actions → New repository
   secret. Name: `EIA_API_KEY`, value: *(your key)*.
3. **Enable Pages**: Settings → Pages → Source: **GitHub Actions**.
4. **Run the workflow once**: Actions → "Refresh EIA data" → "Run workflow".

The cron schedule is Thursdays at 14:00 UTC (~10:00 ET) — right after EIA publishes Wed at
10:30 ET. You can trigger it manually any time from the Actions tab.

---

## Local development

```bash
export EIA_API_KEY=your_key       # only if you want to refresh data.json locally
python update_data.py             # optional — seed data.json works fine
python -m http.server 8000        # open http://localhost:8000/
```

The `?v=__BUILD__` placeholders in the HTML are stamped by the deploy workflow only — locally
they're just literal strings, which work the same since query parameters don't affect file
resolution.

---

## Data integrity (the verification gate)

`update_data.py` runs a sanity check on every pull before it writes `data.json`. Each value
must fall inside a generous plausible range (refinery inputs 10–20 mb/d, WTI $10–400/bbl,
etc.); a soft balance check confirms refinery inputs don't exceed crude supply. The bounds
are wide — they catch *junk* (nulls, zeros, 10× unit glitches), not normal week-to-week moves.

If verification fails, the script exits non-zero **without writing the file**. That means:

- The last-good `data.json` stays live (no garbage published).
- The GitHub Action fails loudly, so you get an email.

Adjust bounds in the `RANGES` dict near the bottom of `update_data.py`.

---

## Live data vs. seeded breakdowns

| Layer | Status |
|---|---|
| National flows (production, imports, refinery inputs, exports, gasoline / distillate / jet output, product supplied) | **Live** — weekly EIA WPSR |
| National stocks (commercial crude, SPR, gasoline, distillate) | **Live** — weekly EIA WPSR |
| Refinery utilization | **Live** — weekly EIA WPSR |
| WTI Cushing spot | **Live** — daily EIA |
| 4-week trailing sparklines | **Live** — derived from history fetch |
| Same-week-of-year 5-yr ranges | **Live** — derived from history fetch |
| Commercial crude stocks by PADD + Cushing | **Best-effort live** — series IDs WCESTP11–51 wrapped in try/except; seeded fallback if any fail |
| Production by state (TX/NM/ND/...) | **Seeded** — needs monthly PSM endpoint wired in |
| Imports by country | **Seeded** — needs monthly CIMS endpoint wired in |
| Exports by destination | **Seeded** — needs monthly CEMS endpoint wired in |
| Gasoline / distillate / jet production by PADD | **Seeded** — same pattern as commercial crude PADD ready to extend |

Every detail page's footnote names the specific EIA series that would turn its seeded
breakdown live. The seeded allocations are scaled from the live national totals, so they
move correctly week-to-week — they're just less precise than per-PADD or per-country fetches.

---

## EIA series reference

| Node | Series | Unit | Notes |
|---|---|---|---|
| Production | `WCRFPUS2` | mb/d | Crude field production, U.S. |
| Crude imports | `WCEIMUS2` | mb/d | Total crude imports |
| Crude exports | `WCREXUS2` | mb/d | Total crude exports |
| Refinery inputs | `WCRRIUS2` | mb/d | Refiner net crude inputs |
| Gasoline | `WGFRPUS2` | mb/d | Finished motor gasoline, refiner net |
| Distillate | `WDIRPUS2` | mb/d | Distillate fuel oil, refiner net |
| Product supplied | `WRPUPUS2` | mb/d | Total products supplied (demand proxy) |
| Commercial crude | `WCESTUS1` | mb | Crude stocks ex-SPR |
| SPR | `WCSSTUS1` | mb | Strategic Petroleum Reserve total |
| Gasoline stocks | `WGTSTUS1` | mb | Total motor gasoline stocks |
| Distillate stocks | `WDISTUS1` | mb | Distillate stocks |
| Utilization | `WPULEUS3` | % | Refinery utilization |
| WTI spot | `RWTC` | $/bbl | WTI Cushing daily spot |
| Cushing stocks | `W_EPC0_SAX_YCUOK_MBBL` | mb | Cushing OK delivery point |
| Comm. crude PADD 1–5 | `WCESTP11`–`WCESTP51` | mb | Best-effort; soft-fail on failure |

"Jet & Other" on the overview is a derived residual: refinery inputs − gasoline − distillate.
On `jet.html` it's expanded into its underlying products using EIA refiner-output data.

---

## License

MIT (see `LICENSE`). Built by Second Order Edge.
