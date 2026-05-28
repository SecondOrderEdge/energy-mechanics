/* ngrigs.js — Baker Hughes-style rig count by basin.
   Baker Hughes is not part of EIA, so values here are seed/representative
   until a direct Baker Hughes CSV pull is added to update_data.py. */
(function(){
  "use strict";

  const SEED = {
    natural_gas_rigs: {
      meta: { vintage: "WK MAY 23 2026", source: "baker_hughes" },
      gas: {
        haynesville: 38, appalachia: 32, other: 19,
      },
      oil: {
        permian: 305, bakken: 35, eagle_ford: 51, anadarko: 28, other: 92,
      },
      total_us: 590,
      ducs: 4500,
      history: { gas_total: [89, 92, 91, 88] },
      five_yr_avg_total: 720,
    }
  };

  const set=(id,t)=>{const e=document.getElementById(id);if(e)e.textContent=t;};

  // Baker Hughes publishes Friday 1:00 PM ET. Compute next release from vintage.
  // Vintage "WK MAY 23 2026" = week-ending Friday May 23; next release = next Friday May 30.
  function setNextRigs(vintageStr){
    const el=document.getElementById("nextrelease"); if(!el) return;
    const m=vintageStr && String(vintageStr).match(/WK\s+([A-Z]+)\s+(\d+)\s+(\d+)/i);
    const MO=["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
    const DA=["SUN","MON","TUE","WED","THU","FRI","SAT"];
    if(!m){el.textContent="NEXT RIGS · —"; return;}
    const mi=MO.indexOf(m[1].toUpperCase()); if(mi<0){el.textContent="NEXT RIGS · —"; return;}
    const v=new Date(Date.UTC(+m[3],mi,+m[2]));
    // Next Friday after the vintage Friday = +7 days
    const n=new Date(v); n.setUTCDate(n.getUTCDate()+7);
    const t=new Date(); const tu=Date.UTC(t.getUTCFullYear(),t.getUTCMonth(),t.getUTCDate());
    const diff=Math.round((n-tu)/86400000);
    let suf = diff>1?` (in ${diff}d)` : diff===1?" (tomorrow)" : diff===0?" (today)" : ` (${Math.abs(diff)}d overdue)`;
    el.textContent="NEXT RIGS · "+DA[n.getUTCDay()]+" "+MO[n.getUTCMonth()]+" "+n.getUTCDate()+suf;
  }

  function render(d){
    const r = (d && d.natural_gas_rigs) || SEED.natural_gas_rigs;
    const gas = r.gas || {};
    const oil = r.oil || {};

    const gasSum = Object.values(gas).reduce((a,b)=>a+b,0);
    const oilSum = Object.values(oil).reduce((a,b)=>a+b,0);
    const total = r.total_us || (gasSum + oilSum);

    set("hd_total", gasSum);
    set("hd_oil",   oilSum);

    // Bars
    const BAR_W = 380;
    const maxBasin = Math.max(gas.haynesville||0, gas.appalachia||0, oil.permian||0, gas.other||0);
    const setBar=(id,v)=>{const b=document.getElementById(id);if(b)b.setAttribute("width",(v/maxBasin*BAR_W).toFixed(1));};
    setBar("pb_haynesville", gas.haynesville||0);
    setBar("pb_appalachia",  gas.appalachia ||0);
    setBar("pb_permian",     oil.permian    ||0);
    setBar("pb_other",       (gas.other||0) + (oil.bakken||0) + (oil.eagle_ford||0) + (oil.anadarko||0) + (oil.other||0));
    set("p_haynesville", gas.haynesville||0);
    set("p_appalachia",  gas.appalachia ||0);
    set("p_permian",     oil.permian    ||0);
    set("p_other",       (gas.other||0) + (oil.bakken||0) + (oil.eagle_ford||0) + (oil.anadarko||0) + (oil.other||0));

    set("v_gas_sum", gasSum);
    set("v_oil_sum", oilSum);
    set("v_us_total", total);
    set("v_ducs",    "~"+(r.ducs || 4500).toLocaleString());

    set("r_gas", gasSum);
    set("r_gas_change", "—");   // would compute when we have prior-week data
    set("r_oil", oilSum);
    set("r_hayne", gas.haynesville||0);
    const fiveYr = r.five_yr_avg_total || 720;
    const delta = total - fiveYr;
    set("r_5yr", (delta>=0?"+":"")+delta);
    set("r_5yr_note", (delta>=0?"above":"below")+" 5-yr avg ("+fiveYr+")");

    const bar=(v,max)=>Math.max(2,Math.min(100,(v/max)*100))+"%";
    const e=(id,w)=>{const x=document.getElementById(id);if(x)x.style.width=w;};
    e("bar_oil",   bar(oilSum, 600));
    e("bar_hayne", bar(gas.haynesville||0, 100));
    e("bar_5yr",   bar(Math.abs(delta), 200));

    if(window.EM_sparkline){
      EM_sparkline("spark_gas", (r.history||{}).gas_total, EM_color("--reserve"));
    }

    set("datestamp","VINTAGE · "+(r.meta && r.meta.vintage || "—"));
    setNextRigs(r.meta && r.meta.vintage);

    const st = document.getElementById("status");
    if(st){
      st.textContent="CACHED"; st.classList.remove("live");
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
