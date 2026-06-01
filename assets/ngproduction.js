/* ngproduction.js — U.S. natural gas production by EIA DPR basin.
   Seeded share-of-national allocation pending DPR series wiring in
   update_data.py. */
(function(){
  "use strict";

  const SEED = {
    meta:{vintage:"WK MAY 15 2026",status:"seed"},
    natural_gas:{
      meta:{vintage:"WK MAY 15 2026"},
      flows_bcfd:{ production:126.3 },
      history:{ supply:[134,132,131,129] },
      ranges_5yr:{ supply:{min:108,avg:119,max:130,n:5} }
    }
  };

  // Approximate share of U.S. dry production. The five DPR basins together
  // are ~85% of national output; the residual (~15%) is Gulf of Mexico,
  // conventional Rockies, Bakken associated gas, and other non-DPR.
  const BASIN_SHARE = {
    appalachia:  0.330,   // Marcellus + Utica
    permian:     0.235,   // associated with crude
    haynesville: 0.155,
    anadarko:    0.080,
    eagle_ford:  0.060,
  };
  const BASIN_BAR_W = 380;
  const BASINS = Object.keys(BASIN_SHARE);
  const DPR_SUM_SHARE = BASINS.reduce((a,k)=>a+BASIN_SHARE[k],0);

  const set=(id,t)=>{const e=document.getElementById(id);if(e)e.textContent=t;};

  function setNextNGW(vintageStr){
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
    const ng = d.natural_gas || SEED.natural_gas;
    const f = ng.flows_bcfd || {};
    const total = f.production || 105.0;
    set("hd_total", total.toFixed(0)+" bcf/d");

    // Per-basin values (live when populated by update_data.py, seeded otherwise)
    const live = ng.production_by_basin || {};
    const vals = {};
    BASINS.forEach(k=>{
      vals[k] = (typeof live[k] === "number") ? live[k] : (total * BASIN_SHARE[k]);
    });
    const maxV = Math.max(...Object.values(vals));
    BASINS.forEach(k=>{
      set("p_"+k, vals[k].toFixed(1));
      const bar = document.getElementById("pb_"+k);
      if(bar) bar.setAttribute("width", (vals[k]/maxV*BASIN_BAR_W).toFixed(1));
    });

    const dpr_sum = Object.values(vals).reduce((a,b)=>a+b,0);
    set("v_sum", dpr_sum.toFixed(0));
    set("v_sum_pct", (dpr_sum/total*100).toFixed(0));

    set("r_total", total.toFixed(0)+" bcf/d");
    set("r_marcellus", vals.appalachia.toFixed(0)+" bcf/d");
    set("r_marcellus_pct", (vals.appalachia/total*100).toFixed(0)+"% of national");
    set("r_permian", vals.permian.toFixed(0)+" bcf/d");
    set("r_dpr_sum", dpr_sum.toFixed(0)+" bcf/d");
    set("r_dpr_pct", (dpr_sum/total*100).toFixed(0)+"% of national");

    const bar=(v,max)=>Math.max(2,Math.min(100,(v/max)*100))+"%";
    const e=(id,w)=>{const x=document.getElementById(id);if(x)x.style.width=w;};
    e("bar_marcellus", bar(vals.appalachia, total));
    e("bar_permian",   bar(vals.permian, total));
    e("bar_dpr",       bar(dpr_sum/total, 1));

    if(window.EM_sparkline){
      // National production history isn't yet wired; supply proxy works for the trend shape
      EM_sparkline("spark_total", (ng.history||{}).supply, EM_color("--reserve"));
      EM_rangeBadge("range_total", total, (ng.ranges_5yr||{}).supply, "bcf/d");
    }

    const vintage = (ng.meta && ng.meta.vintage) || d.meta && d.meta.vintage;
    set("datestamp","VINTAGE · "+(vintage||"—"));
    setNextNGW(vintage);

    const st = document.getElementById("status");
    if(st){
      if((d.meta && d.meta.status==="live") || (ng.meta && ng.meta.status==="live")){
        st.textContent="LIVE ✓"; st.classList.add("live");
      } else {
        st.textContent="CACHED"; st.classList.remove("live");
      }
    }

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
    .then(d=>render(d))
    .catch(err=>{console.warn("data.json load failed, using seed:",err);render(SEED);});
})();
