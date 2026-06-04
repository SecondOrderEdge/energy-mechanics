/* chokepoints.js — World oil transit chokepoints. Seeded from EIA's
   annual World Oil Transit Chokepoints report. Volumes don't change
   week-to-week so no live wiring; values are total crude + products
   in million barrels per day. */
(function(){
  "use strict";

  // EIA estimates — total crude + petroleum products (mmbpd). Cape of Good
  // Hope is included for context as the natural detour for Suez and
  // Bab el-Mandeb; it isn't a chokepoint per se.
  const FLOWS = {
    malacca:  24.0,
    hormuz:   21.0,
    suez:      9.2,   // Suez Canal + SUMED pipeline combined
    bab:       6.2,
    cape:      6.5,   // detour volume (variable)
    turkish:   2.4,
    panama:    1.6
  };
  const SEABORNE_TOTAL = 70.0;   // approx total seaborne oil trade

  const ITEMS = ["malacca","hormuz","suez","bab","cape","turkish","panama"];
  const BAR_W = 380;

  const set=(id,t)=>{const e=document.getElementById(id);if(e)e.textContent=t;};

  function render(){
    // Per-chokepoint bars
    const maxV = Math.max(...Object.values(FLOWS));
    ITEMS.forEach(k=>{
      set("p_"+k, FLOWS[k].toFixed(1));
      const b=document.getElementById("pb_"+k);
      if(b) b.setAttribute("width", (FLOWS[k]/maxV*BAR_W).toFixed(1));
    });

    // Subhead + headline
    set("hd_hormuz", "~"+FLOWS.hormuz.toFixed(0)+" mmbpd");
    set("v_top2",  (FLOWS.hormuz+FLOWS.malacca).toFixed(1));
    set("v_redsea",(FLOWS.suez+FLOWS.bab).toFixed(1));

    // Readouts
    set("r_hormuz", FLOWS.hormuz.toFixed(1)+" mmbpd");
    // "Total chokepoint flows" — sum of 6 chokepoints (excl. Cape, which
    // is the detour route, not a chokepoint). Sums to >40 because individual
    // tankers cross multiple chokepoints in sequence (e.g. Hormuz then Bab
    // then Suez), so this is a counting metric not a unique-volume metric.
    const totalChoke = ITEMS.filter(k=>k!=="cape")
                            .reduce((a,k)=>a+FLOWS[k], 0);
    set("r_total", totalChoke.toFixed(0)+" mmbpd");
    set("r_hormuz_share", (FLOWS.hormuz/SEABORNE_TOTAL*100).toFixed(0)+"%");

    // Bar visualizations on readouts
    const bar=(v,max)=>Math.max(2,Math.min(100,(v/max)*100))+"%";
    const e=(id,w)=>{const x=document.getElementById(id);if(x)x.style.width=w;};
    e("bar_hormuz",       bar(FLOWS.hormuz, 30));
    e("bar_total",        bar(totalChoke,   80));
    e("bar_hormuz_share", bar(FLOWS.hormuz/SEABORNE_TOTAL, 0.40));

    // Vintage / status — annual report, no live data, badge stays SEED.
    const status = document.getElementById("status");
    if(status) status.textContent = "SEED · ANNUAL";

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

  // No data.json dependency — render immediately.
  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", render);
  } else {
    render();
  }
})();
