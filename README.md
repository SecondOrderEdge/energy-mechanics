# Energy Mechanics — Petroleum Plumbing

An interactive schematic of the U.S. petroleum balance — crude in, refining, products out —
rendered as plumbing, wired to live EIA data. Standalone static site.

- **`petroleum.html`** — the schematic
- Every pipe width ∝ its flow (million barrels/day); every tank fill ∝ its inventory level.
- Numbers come from a `data.json` that a scheduled GitHub Action regenerates from the EIA API.

Same Tier-2 architecture as the Monetary Mechanics FRED site: the data pull happens
server-side in the Action (no browser CORS), the page just reads the JSON, and a hardcoded
seed keeps it rendering even if the JSON is missing.

---

## One-time setup (~10 min)

### 1. Get a free EIA API key
https://www.eia.gov/opendata/register.php — instant.

### 2. Add the key as a repo secret
Settings → Secrets and variables → Actions → New repository secret
- Name: `EIA_API_KEY`
- Value: *(your key)*

Everything is live — including WTI (pulled from the EIA `RWTC` daily spot series).
Nothing is hardcoded.

### 3. Enable Pages
Settings → Pages → Source: **GitHub Actions**.

### 4. Run the workflow once
Actions → **Refresh EIA data** → **Run workflow**.

Live at `https://secondorderedge.github.io/energy-mechanics/petroleum.html`. The WPSR releases every
Wednesday ~10:30 ET; the Action runs Thursday mornings to catch it.

---

## Data integrity (the verification gate)

`update_data.py` runs a sanity check on every pull before it writes `data.json`. Each value
must fall inside a generous plausible range (e.g. refinery inputs 10–20 mb/d, WTI \$10–400/bbl),
and a soft balance check confirms refinery inputs don't exceed crude supply. The bounds are
wide on purpose — they catch *junk* (nulls, zeros, 10× unit glitches), not normal week-to-week
moves.

If verification fails, the script exits non-zero **without writing the file**. That means:
- the last-good `data.json` stays live (no garbage published), and
- the GitHub Action fails loudly, so you get an email.

To adjust the bounds, edit the `RANGES` dict near the bottom of `update_data.py`.

---

## Local

```bash
export EIA_API_KEY=your_key
python update_data.py        # optional; a seed data.json ships with the repo
python -m http.server 8000   # open http://localhost:8000/petroleum.html
```

---

## Data series (EIA Weekly Petroleum Status Report)

| Node | Series | What |
|------|--------|------|
| Production | WCRFPUS2 | Crude field production |
| Crude imports | WCEIMUS2 | Crude oil imports |
| Crude exports | WCREXUS2 | Crude oil exports |
| Refinery inputs | WCRRIUS2 | Refiner net crude inputs |
| Gasoline | WGFRPUS2 | Finished gasoline production |
| Distillate | WDIRPUS2 | Distillate production |
| Product supplied | WRPUPUS2 | Total products supplied (demand) |
| Commercial crude | WCESTUS1 | Crude stocks ex-SPR |
| SPR | WCSSTUS1 | Strategic Petroleum Reserve |
| Gasoline stocks | WGTSTUS1 | Total gasoline inventory |
| Distillate stocks | WDISTUS1 | Distillate inventory |
| Utilization | WPULEUS3 | Refinery % utilization |
| WTI spot | RWTC | WTI Cushing daily spot ($/bbl) |

"Jet & Other" is computed as refinery inputs − gasoline − distillate. WTI comes from the
EIA daily spot-price dataset (`petroleum/pri/spt`); all other series are weekly (`petroleum/sum/sndw`).

Built by SecondOrderEdge.
