/* commercial.js — Commercial crude stocks by PADD with Cushing detail. */
(function(){
  "use strict";

  const SEED = {
    meta:{vintage:"WK MAY 1 2026",status:"seed"},
    stocks_mb:{commercial_crude:445},
    flows_mbd:{refinery_inputs:16.3, product_supplied:20.4}
  };

  // Approximate share of national commercial crude stocks
  const PADD_SHARE = { padd1:0.060, padd2:0.250, padd3:0.620, padd4:0.045, padd5:0.025 };
  // Working storage capacity by PADD (mb)
  const PADD_CAP   = { padd1: 35,  padd2: 175,  padd3: 415,  padd4: 35,  padd5: 60 };
  // Cushing share of PADD 2 stocks (used only as fallback when the live
  // Cushing series isn't populated by update_data.py)
  const CUSHING_SHARE_OF_PADD2 = 0.40;

  const PADDS = ["padd1","padd2","padd3","padd4","padd5"];
  const BASELINE = 380, MAX_HEIGHT = 320;

  const set=(id,t)=>{const e=document.getElementById(id);if(e)e.textContent=t;};

  function render(d){
    const total = d.stocks_mb.commercial_crude;
    const ref   = d.flows_mbd.refinery_inputs;
    const dem   = d.flows_mbd.product_supplied || ref * 1.25;
    const days  = total / ref;
    // Days at demand rate — "Days of Consumption" metric. Demand (product
    // supplied) is the right denominator when asking "how long until tank
    // bottoms" because refineries can ramp inputs but the market can't ramp
    // consumption down on demand. Always smaller than days-at-refinery.
    const daysDem = total / dem;
    // Live per-PADD breakdown if update_data.py populated it; otherwise we
    // fall back to the seeded share-of-national allocation below.
    const padd_live = d.padd_stocks_crude || {};

    set("hd_total", Math.round(total)+" mb");
    set("hd_days",  days.toFixed(1));

    // Largest PADD cap defines the max tank height
    const maxCap = Math.max(...Object.values(PADD_CAP));

    PADDS.forEach(k=>{
      const v   = (typeof padd_live[k] === "number") ? padd_live[k] : total * PADD_SHARE[k];
      const cap = PADD_CAP[k];
      const tankH = MAX_HEIGHT * (cap/maxCap);
      const fillH = tankH * Math.min(1, v/cap);
      const tankY = BASELINE - tankH;
      const fillY = BASELINE - fillH;

      const capEl = document.getElementById("cap_"+k);
      const fl    = document.getElementById("fill_"+k);
      const ln    = document.getElementById("line_"+k);
      if(capEl){capEl.setAttribute("y",tankY); capEl.setAttribute("height",tankH);}
      if(fl)   {fl.setAttribute("y",fillY); fl.setAttribute("height",fillH);}
      if(ln)   {ln.setAttribute("y1",fillY); ln.setAttribute("y2",fillY);}

      set("v_"+k, v.toFixed(0));
      set("p_"+k, (v/cap*100).toFixed(0)+"%");
    });

    const cushing = (typeof padd_live.cushing === "number")
      ? padd_live.cushing
      : total * PADD_SHARE.padd2 * CUSHING_SHARE_OF_PADD2;
    set("v_cushing", cushing.toFixed(0)+" mb");

    set("r_total", Math.round(total)+" mb");
    set("r_cushing", cushing.toFixed(0)+" mb");
    set("r_days", days.toFixed(1)+" days");
    set("r_days_demand", daysDem.toFixed(1)+" days");
    // vs 5-yr avg comes from ranges_5yr (same-week-of-year average over the
    // prior 5 years) — never hardcoded.
    const r5 = d.ranges_5yr && d.ranges_5yr.commercial_crude;
    const d5 = (r5 && typeof r5.avg === "number") ? (total - r5.avg) : null;
    set("r_5yr", d5 === null ? "—" : (d5 >= 0 ? "+" : "") + d5.toFixed(0) + " mb");

    const bar=(v,max)=>Math.max(2,Math.min(100,(v/max)*100))+"%";
    const e=(id,w)=>{const x=document.getElementById(id);if(x)x.style.width=w;};
    e("bar_cushing",bar(cushing,80));
    e("bar_days",   bar(days,40));
    e("bar_days_demand", bar(daysDem, 32));   // tighter ceiling — demand denominator gives lower numbers
    e("bar_5yr",    bar(Math.abs(d5 || 0), 50));
    if(window.EM_sparkline){
      EM_sparkline("spark_total", (d.history||{}).commercial_crude, EM_color("--crude"));
      EM_rangeBadge("range_total", total, (d.ranges_5yr||{}).commercial_crude, "mb");
    }

    set("datestamp","VINTAGE · "+(d.meta.vintage||"—"));
    if(window.EM_setNextRelease) window.EM_setNextRelease(d.meta.vintage);
    const st=document.getElementById("status");
    if(d.meta.status==="live"){st.textContent="LIVE ✓";st.classList.add("live");}
    else{st.textContent="CACHED";st.classList.remove("live");}

    wireHover();
  }

  function wireHover(){
    const frame=document.getElementById("frame");
    document.querySelectorAll(".hl").forEach(el=>{
      const k=el.getAttribute("data-k"); if(!k)return;
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
    .then(d=>{if(!d.stocks_mb)throw new Error("no stocks");render(d);})
    .catch(err=>{console.warn("data.json load failed, using seed:",err);render(SEED);});
})();
