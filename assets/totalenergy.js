/* totalenergy.js — U.S. total energy Sankey (Lawrence-Livermore style).
   Renders sources → electricity → end-use sectors → useful/rejected from a
   declarative flow list in d.total_energy. */
(function(){
  "use strict";

  const SEED = {
    meta: { vintage:"ANNUAL 2023", status:"seed" },
    total_energy: {
      meta:{ vintage:"ANNUAL 2023", status:"seed", unit:"quads" },
      sources_quads:{
        petroleum:36.0, natural_gas:33.4, coal:8.51, nuclear:8.05,
        biomass:5.06, wind:4.42, solar:2.34, hydro:2.30, geothermal:0.21
      },
      sectors_quads:{
        residential:11.7, commercial:9.4, industrial:33.6, transportation:28.3
      },
      electricity_quads:{
        input:38.3, useful_out:12.7, rejected:25.6,
        to_residential:5.0, to_commercial:4.6, to_industrial:3.4, to_transport:0.03
      },
      useful_rejected_quads:{ useful:33.0, rejected:67.0 },
      flows: []
    }
  };

  // Column x positions (matches the SVG's 1200×720 viewbox)
  const X = {
    src_l:    60,  src_r:  170,
    elec_l:  470,  elec_r: 560,
    sec_l:   810,  sec_r:  890,
    fate_l: 1090,  fate_r:1170
  };
  // Vertical scale: pixels per quad. ~5 keeps 100 quads ≈ 500px tall.
  const PPQ = 5.0;
  const GAP = 10;             // px between stacked nodes
  const Y_TOP = 38;

  // Source key → CSS color expression (matches landing-card palette)
  const COL = {
    petroleum:   "var(--crude)",
    natural_gas: "var(--reserve)",
    coal:        "var(--layoff)",
    nuclear:     "var(--openings)",
    biomass:     "var(--emp)",
    wind:        "#7fb78e",
    solar:       "var(--tga)",
    hydro:       "#7aa9c7",
    geothermal:  "var(--ink-dim)"
  };
  // Sector end-use efficiency (useful share of sector total). LLNL methodology.
  const SECTOR_EFF = {
    residential: 0.65, commercial: 0.65,
    industrial: 0.49, transportation: 0.21
  };

  const NS = "http://www.w3.org/2000/svg";
  const el = (tag, attrs) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  };
  const set = (id,t) => {const e=document.getElementById(id);if(e)e.textContent=t;};

  function layoutColumn(names, heights, totalH){
    // Returns map name → { y: top, h: height }. Stacks vertically inside
    // [Y_TOP, Y_TOP+totalH], centering if there's slack.
    const sumH = names.reduce((a,n)=>a+heights[n], 0);
    const sumGap = (names.length - 1) * GAP;
    const slack = Math.max(0, totalH - sumH - sumGap);
    let y = Y_TOP + slack / 2;
    const out = {};
    names.forEach(n => {
      out[n] = { y, h: heights[n] };
      y += heights[n] + GAP;
    });
    return out;
  }

  function flowPath(x1, y1, x2, y2){
    // Cubic bezier with horizontal tangents at both ends — classic Sankey shape.
    const dx = (x2 - x1) * 0.5;
    return `M ${x1} ${y1} C ${x1+dx} ${y1}, ${x2-dx} ${y2}, ${x2} ${y2}`;
  }

  function render(d){
    const te = d.total_energy || SEED.total_energy;
    const sources = te.sources_quads || {};
    const sectors = te.sectors_quads || {};
    const elec    = te.electricity_quads || {};
    const ur      = te.useful_rejected_quads || {};
    const flowsIn = te.flows || [];

    // ---- 1. Compute node heights ----
    const SOURCE_KEYS = ["petroleum","natural_gas","coal","nuclear","biomass","wind","solar","hydro","geothermal"];
    const SECTOR_KEYS = ["residential","commercial","industrial","transportation"];

    const totalPrimary = SOURCE_KEYS.reduce((a,k)=>a+(sources[k]||0), 0);
    const totalSector  = SECTOR_KEYS.reduce((a,k)=>a+(sectors[k]||0), 0);

    const sourceH = {};
    SOURCE_KEYS.forEach(k => { sourceH[k] = (sources[k]||0) * PPQ; });
    const sectorH = {};
    SECTOR_KEYS.forEach(k => { sectorH[k] = (sectors[k]||0) * PPQ; });
    const elecH = (elec.input || 0) * PPQ;
    const fateH = {
      useful:   (ur.useful   || 0) * PPQ,
      rejected: (ur.rejected || 0) * PPQ
    };

    // Available vertical space
    const VIEW_H = 720;
    const COL_H  = VIEW_H - Y_TOP - 16;

    const srcLayout  = layoutColumn(SOURCE_KEYS, sourceH, COL_H);
    const elecLayout = layoutColumn(["electricity"], { electricity: elecH }, COL_H);
    const secLayout  = layoutColumn(SECTOR_KEYS, sectorH, COL_H);
    const fateLayout = layoutColumn(["useful","rejected"], fateH, COL_H);

    // ---- 2. Build full flow list ----
    // Start with all source→target flows from the data.
    const flows = flowsIn.map(f => ({...f}));

    // Add electricity → sector flows (after-conversion useful electricity).
    SECTOR_KEYS.forEach(s => {
      const key = s === "transportation" ? "to_transport" : "to_"+s;
      const q = elec[key] || 0;
      if (q > 0.001) flows.push({ from:"electricity", to:s, q, viaElec:true });
    });
    // Electricity → rejected pool (the ~26 quads of conversion losses).
    if (elec.rejected > 0) flows.push({ from:"electricity", to:"rejected", q: elec.rejected, viaElec:true });

    // Each sector → useful + rejected pools, split by sector efficiency.
    SECTOR_KEYS.forEach(s => {
      const q = sectors[s] || 0;
      if (q <= 0) return;
      const eff = SECTOR_EFF[s] || 0.5;
      flows.push({ from:s, to:"useful",   q: q*eff,       sector:true });
      flows.push({ from:s, to:"rejected", q: q*(1-eff),   sector:true });
    });

    // ---- 3. Resolve endpoints + draw flows ----
    // Track running offsets so stacked flows at each node don't overlap.
    const outOffset = {}, inOffset = {};
    const getEndpoint = (name, side) => {
      // side = "out" (right edge) or "in" (left edge)
      let x, y0, h;
      if (SOURCE_KEYS.includes(name)) { x = side==="out" ? X.src_r  : X.src_l;  y0 = srcLayout[name].y;  h = srcLayout[name].h; }
      else if (name === "electricity"){ x = side==="out" ? X.elec_r : X.elec_l; y0 = elecLayout.electricity.y; h = elecLayout.electricity.h; }
      else if (SECTOR_KEYS.includes(name)){ x = side==="out" ? X.sec_r  : X.sec_l;  y0 = secLayout[name].y;  h = secLayout[name].h; }
      else { x = side==="out" ? X.fate_r : X.fate_l; y0 = fateLayout[name].y; h = fateLayout[name].h; }
      return { x, y0, h };
    };

    const flowsG = document.getElementById("sk_flows");
    flowsG.innerHTML = "";

    // Sort flows so source-coloured ribbons paint in a deterministic z-order.
    // Draw widest first so thin ribbons sit on top and stay visible.
    flows.sort((a,b) => b.q - a.q);

    flows.forEach(f => {
      if (f.q <= 0.001) return;
      const src = getEndpoint(f.from, "out");
      const tgt = getEndpoint(f.to,   "in");
      const w   = Math.max(0.6, f.q * PPQ);

      const oOff = outOffset[f.from] = (outOffset[f.from] || 0);
      const iOff = inOffset[f.to]    = (inOffset[f.to]    || 0);
      const y1 = src.y0 + oOff + w/2;
      const y2 = tgt.y0 + iOff + w/2;
      outOffset[f.from] += w;
      inOffset[f.to]    += w;

      // Color: source-origin flows use source color; electricity-origin uses
      // electricity-output mix (light grey); sector→fate uses sector color
      // (which we map back to a muted grey since sectors don't have a brand).
      let color;
      if (f.viaElec)        color = "var(--ink-dim)";
      else if (f.sector)    color = (f.to === "useful" ? "var(--emp)" : "var(--layoff)");
      else                  color = COL[f.from] || "var(--ink-dim)";

      flowsG.appendChild(el("path", {
        class: "sankey-flow",
        d: flowPath(src.x, y1, tgt.x, y2),
        stroke: color,
        "stroke-width": w.toFixed(2),
        "stroke-linecap": "butt",
        opacity: f.sector ? "0.32" : (f.viaElec ? "0.25" : "0.55")
      }));
    });

    // ---- 4. Draw nodes (rectangles) ----
    const nodesG = document.getElementById("sk_nodes");
    nodesG.innerHTML = "";
    const drawNode = (x, y, h, color, w=10) => {
      nodesG.appendChild(el("rect", {
        x: x, y: y, width: w, height: Math.max(1, h),
        class: "sankey-node-rect", fill: color, opacity: "0.95"
      }));
    };
    SOURCE_KEYS.forEach(k => drawNode(X.src_r-10, srcLayout[k].y, srcLayout[k].h, COL[k]));
    drawNode(X.elec_l, elecLayout.electricity.y, elecLayout.electricity.h, "var(--ink)", 8);
    SECTOR_KEYS.forEach(k => drawNode(X.sec_l, secLayout[k].y, secLayout[k].h, "var(--ink-dim)", 8));
    drawNode(X.fate_l, fateLayout.useful.y,   fateLayout.useful.h,   "var(--emp)",    8);
    drawNode(X.fate_l, fateLayout.rejected.y, fateLayout.rejected.h, "var(--layoff)", 8);

    // ---- 5. Draw labels ----
    const labelsG = document.getElementById("sk_labels");
    labelsG.innerHTML = "";
    const label = (x, y, anchor, name, q, color) => {
      labelsG.appendChild(el("text", {
        x, y, "text-anchor": anchor, class: "sankey-node-label sankey-node",
        fill: color || "var(--ink)"
      })).textContent = name.toUpperCase().replace("_", " ");
      labelsG.appendChild(el("text", {
        x, y: y+12, "text-anchor": anchor, class: "sankey-node-val sankey-node"
      })).textContent = q.toFixed(q < 1 ? 2 : 1) + " Q";
    };
    SOURCE_KEYS.forEach(k => {
      if ((sources[k]||0) <= 0) return;
      const node = srcLayout[k];
      label(X.src_r - 14, node.y + node.h/2 + 4, "end", k, sources[k], COL[k]);
    });
    {
      const node = elecLayout.electricity;
      label(X.elec_l + 14, node.y + node.h/2 + 4, "start", "electricity", elec.input || 0, "var(--ink)");
    }
    SECTOR_KEYS.forEach(k => {
      const node = secLayout[k];
      label(X.sec_l + 14, node.y + node.h/2 + 4, "start", k, sectors[k], "var(--ink)");
    });
    label(X.fate_l + 14, fateLayout.useful.y   + fateLayout.useful.h/2   + 4, "start", "useful",   ur.useful,   "var(--emp)");
    label(X.fate_l + 14, fateLayout.rejected.y + fateLayout.rejected.h/2 + 4, "start", "rejected", ur.rejected, "var(--layoff)");

    // ---- 6. Headline + readouts ----
    set("hd_total",        totalPrimary.toFixed(0));
    const usefulPct   = (ur.useful   / totalPrimary) * 100;
    const rejectedPct = (ur.rejected / totalPrimary) * 100;
    set("hd_useful_pct",   usefulPct.toFixed(0)+"%");
    set("hd_rejected_pct", rejectedPct.toFixed(0)+"%");
    set("sub_total",       totalPrimary.toFixed(1));
    set("sub_rejected_q",  ur.rejected.toFixed(1)+" quads");

    set("r_total",        totalPrimary.toFixed(1)+" Q");
    set("r_useful",       ur.useful.toFixed(1)+" Q");
    set("r_useful_pct",   usefulPct.toFixed(0)+"% of primary energy");
    set("r_rejected",     ur.rejected.toFixed(1)+" Q");
    set("r_rejected_pct", rejectedPct.toFixed(0)+"% of primary energy");
    const fossil = (sources.petroleum||0) + (sources.natural_gas||0) + (sources.coal||0);
    const fossilPct = fossil / totalPrimary * 100;
    set("r_fossil", fossilPct.toFixed(0)+"%");

    const bar = (v,max) => Math.max(2, Math.min(100, (v/max)*100)) + "%";
    const e2 = (id,w) => {const x=document.getElementById(id); if(x) x.style.width=w;};
    e2("bar_total",    bar(totalPrimary, 120));
    e2("bar_useful",   bar(usefulPct, 50));
    e2("bar_rejected", bar(rejectedPct, 80));
    e2("bar_fossil",   bar(fossilPct, 100));

    // Vintage + status
    const meta = te.meta || {};
    set("datestamp", "VINTAGE · " + (meta.vintage || "—"));
    const st = document.getElementById("status");
    if (st) {
      if (meta.status === "live") { st.textContent = "LIVE ✓"; st.classList.add("live"); }
      else                        { st.textContent = "ANNUAL · SEED"; st.classList.remove("live"); }
    }
  }

  fetch("data.json", {cache:"no-store"})
    .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(d => render(d))
    .catch(err => { console.warn("data.json load failed, using seed:", err); render(SEED); });
})();
