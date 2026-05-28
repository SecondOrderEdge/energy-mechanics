/* naturalgas.js — Energy Mechanics · U.S. natural gas balance.
   Reads data.json's natural_gas block; falls back to SEED for offline / cached
   load paths. Storage is the headline weekly indicator (EIA Natural Gas
   Weekly, released Thursdays 10:30 ET); production / consumption-by-sector /
   imports / exports come from the Natural Gas Monthly. */
(function(){
  "use strict";

  const SEED = {
    meta:{vintage:"WK MAY 15 2026",status:"seed"},
    natural_gas:{
      flows_bcfd:{
        production:105.0, imports:8.0,
        rescom:22.0, industrial:24.0, electric:37.0,
        lng_exports:14.0, mexico_exports:6.0
      },
      stocks_bcf:{ working_gas:2500 },
      meta:{ henry_hub:3.50 },
      history:{
        supply:       [113, 112, 112, 111],
        working_gas:  [2500, 2450, 2400, 2340],
        lng_exports:  [14.0, 13.8, 13.5, 13.2],
        henry_hub:    [3.50, 3.30, 3.20, 3.40]
      },
      ranges_5yr:{
        supply:       {min: 95,   avg: 102,  max: 108},
        working_gas:  {min: 1850, avg: 2200, max: 2700},
        lng_exports:  {min: 6,    avg: 10,   max: 13},
        henry_hub:    {min: 2.50, avg: 3.30, max: 8.50}
      }
    }
  };

  const set=(id,t)=>{const e=document.getElementById(id);if(e)e.textContent=t;};
  const PIPE_WIDTH = 3.5;

  const PIPES = {
    production:"p_prod", imports:"p_imp",
    rescom:"p_rc", industrial:"p_ind", electric:"p_elec",
    lng_exports:"p_lng", mexico_exports:"p_mex"
  };

  // Working gas storage cavern visual: bottom at y=600, top at y=470,
  // current fill scaled against design capacity 4300 bcf (industry max ~5-yr peak).
  const STORAGE_TOP = 470, STORAGE_BOTTOM = 600, STORAGE_DESIGN = 4300;

  // EIA NGW storage report comes out 6 days AFTER the week-ending Friday
  // (Thursday of the next week), vs WPSR's 5-day lag (Wednesday). The next
  // report after the current vintage is therefore vintage + 13 days.
  function setNextNGWPSR(vintageStr){
    const el = document.getElementById("nextrelease");
    if(!el) return;
    const m = vintageStr && String(vintageStr).match(/WK\s+([A-Z]+)\s+(\d+)\s+(\d+)/i);
    const MONTHS = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
    const DAYS   = ["SUN","MON","TUE","WED","THU","FRI","SAT"];
    if(!m){ el.textContent = "NEXT NGW · —"; return; }
    const mi = MONTHS.indexOf(m[1].toUpperCase());
    if(mi<0){ el.textContent = "NEXT NGW · —"; return; }
    const v = new Date(Date.UTC(+m[3], mi, +m[2]));
    const next = new Date(v); next.setUTCDate(next.getUTCDate()+13);
    const today = new Date();
    const todayUTC = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
    const diff = Math.round((next - todayUTC) / 86400000);
    let suffix;
    if(diff > 1)        suffix = " (in "+diff+"d)";
    else if(diff === 1) suffix = " (tomorrow)";
    else if(diff === 0) suffix = " (today)";
    else                suffix = " ("+Math.abs(diff)+"d overdue)";
    el.textContent = "NEXT NGW · "+DAYS[next.getUTCDay()]+" "+MONTHS[next.getUTCMonth()]+" "+next.getUTCDate()+suffix;
  }

  function render(d){
    // The natgas block lives under d.natural_gas to keep the petroleum-side of
    // data.json untouched. Tolerate missing keys gracefully.
    const ng = d.natural_gas || SEED.natural_gas;
    const f  = ng.flows_bcfd || {};
    const s  = ng.stocks_bcf || {};
    const m  = ng.meta || {};
    const supply = (f.production || 0) + (f.imports || 0);
    const totalDemand = (f.rescom||0) + (f.industrial||0) + (f.electric||0) + (f.lng_exports||0) + (f.mexico_exports||0);
    // "Pipeline trunk" = supply that's flowing to demand (excludes storage flow,
    // which is bi-directional and small relative to throughput).
    const pipeNet = totalDemand - (f.mexico_exports||0);

    set("hd_prod", (f.production||0).toFixed(0)+" bcf/d");
    set("hd_lng",  (f.lng_exports||0).toFixed(0)+" bcf/d");

    set("v_prod",   (f.production||0).toFixed(1));
    set("v_imp",    (f.imports||0).toFixed(1));
    set("v_supply", supply.toFixed(1));
    set("v_pipe",   pipeNet.toFixed(1));
    set("v_rc",     (f.rescom||0).toFixed(1));
    set("v_ind",    (f.industrial||0).toFixed(1));
    set("v_elec",   (f.electric||0).toFixed(1));
    set("v_lng",    (f.lng_exports||0).toFixed(1));
    set("v_mex",    (f.mexico_exports||0).toFixed(1)+" bcf/d");
    set("v_storage", Math.round(s.working_gas||0).toLocaleString());
    set("v_hh",     "$"+(m.henry_hub||0).toFixed(2));

    // Storage delta vs 5-yr avg
    const r5y = ng.ranges_5yr || {};
    const stAvg = r5y.working_gas && r5y.working_gas.avg;
    if(typeof stAvg === "number" && s.working_gas){
      const dlt = Math.round(s.working_gas - stAvg);
      const txt = (dlt >= 0 ? "+" : "") + dlt + " bcf";
      set("v_stordelta", txt);
      set("r_storage_delta", txt + " vs 5-yr avg");
    }

    // Pipes — uniform width across the schematic (same convention as petroleum)
    Object.keys(PIPES).forEach(k=>{
      const path = document.getElementById(PIPES[k]); if(!path) return;
      path.setAttribute("stroke-width", PIPE_WIDTH.toFixed(2));
      if(!path.hasAttribute("opacity")) path.setAttribute("opacity","0.45");
      const anim = path.cloneNode(false);
      anim.removeAttribute("id");
      anim.setAttribute("class","flow flow-dash");
      anim.setAttribute("opacity","1");
      path.parentNode.appendChild(anim);
    });

    // Working gas storage tank fill (capped at 96%, floor 6% so the bar always shows)
    const stFill = document.getElementById("fill_storage");
    const stLine = document.getElementById("line_storage");
    if(stFill && s.working_gas){
      const frac = Math.max(0.06, Math.min(0.96, s.working_gas / STORAGE_DESIGN));
      const fh = (STORAGE_BOTTOM - STORAGE_TOP) * frac;
      const fy = STORAGE_BOTTOM - fh;
      stFill.setAttribute("y", fy);
      stFill.setAttribute("height", fh);
      if(stLine){ stLine.setAttribute("y1", fy); stLine.setAttribute("y2", fy); }
    }

    // Readouts
    set("r_supply",  supply.toFixed(1)+" bcf/d");
    set("r_storage", Math.round(s.working_gas||0).toLocaleString()+" bcf");
    set("r_lng",     (f.lng_exports||0).toFixed(1)+" bcf/d");
    set("r_hh",      "$"+(m.henry_hub||0).toFixed(2));

    // Sparklines + range badges (live where update_data.py wired history; seeded otherwise)
    const hist = ng.history || {};
    if(window.EM_sparkline){
      EM_sparkline("spark_supply",  hist.supply,       EM_color("--reserve"));
      EM_sparkline("spark_storage", hist.working_gas,  EM_color("--reserve"));
      EM_sparkline("spark_lng",     hist.lng_exports,  EM_color("--layoff"));
      EM_sparkline("spark_hh",      hist.henry_hub,    EM_color("--tga"));
      EM_rangeBadge("range_supply",  supply,             r5y.supply,      "bcf/d");
      EM_rangeBadge("range_storage", s.working_gas,      r5y.working_gas, "bcf");
      EM_rangeBadge("range_lng",     f.lng_exports,      r5y.lng_exports, "bcf/d");
      EM_rangeBadge("range_hh",      m.henry_hub,        r5y.henry_hub,   "$/MMBtu");
    }

    // Vintage + next NGW release stamp (Thursday 10:30 ET cadence, 6 days after week-ending Friday)
    const vintage = (ng.meta && ng.meta.vintage) || d.meta && d.meta.vintage;
    set("datestamp","VINTAGE · "+(vintage||"—"));
    setNextNGWPSR(vintage);

    const st = document.getElementById("status");
    if(st){
      if((d.meta && d.meta.status==="live") || (ng.meta && ng.meta.status==="live")){
        st.textContent = "LIVE ✓"; st.classList.add("live");
      } else {
        st.textContent = "CACHED"; st.classList.remove("live");
      }
    }

    wireHover();
  }

  function wireHover(){
    const frame = document.getElementById("frame");
    document.querySelectorAll(".hl").forEach(el=>{
      const k = el.getAttribute("data-k"); if(!k) return;
      el.addEventListener("mouseenter",()=>{
        frame.classList.add("dim");
        document.querySelectorAll('.hl[data-k="'+k+'"]').forEach(n=>n.classList.add("on"));
      });
      el.addEventListener("mouseleave",()=>{
        frame.classList.remove("dim");
        document.querySelectorAll(".hl").forEach(n=>n.classList.remove("on"));
      });
    });
  }

  fetch("data.json",{cache:"no-store"})
    .then(r=>{if(!r.ok)throw new Error(r.status);return r.json();})
    .then(d=>render(d))
    .catch(err=>{console.warn("data.json load failed, using seed:",err);render(SEED);});
})();
