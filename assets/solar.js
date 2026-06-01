/* solar.js — U.S. solar generation: utility-scale vs distributed, top states,
   capacity-factor explainer. Reads d.electricity.solar_detail when present;
   falls back to seed for offline / not-yet-wired paths. */
(function(){
  "use strict";

  const SEED = {
    meta:{vintage:"WK MAY 15 2026",status:"seed"},
    electricity:{
      meta:{ vintage:"WK MAY 15 2026" },
      gen_twh:{ solar:309 },
      solar_detail:{
        utility_twh:    372,    // PPA-contracted solar farms (≥ 1 MW) — live SUB
        distributed_twh: 95,    // residential + commercial rooftop / behind-the-meter — live DPV
        utility_gw:     130,    // utility-scale nameplate capacity (~live SUN cap)
        distributed_gw:  55,    // distributed nameplate capacity (seeded, no live source)
        // Top generating states, TWh/yr (approx 2025 EIA EPM Table 1.6.B)
        by_state:{
          ca:57, tx:63, fl:26, nc:13, az_nv:30
        },
        five_yr_ago_twh: 115    // for the "tripled in 5 years" callout
      },
      history:{ solar:[372,360,340,320] }
    }
  };
  const TOTAL_US_GEN = 4242;   // for share-of-US calculations; replace with live total when present

  const STATES = ["ca","tx","fl","nc","az_nv"];
  const set=(id,t)=>{const e=document.getElementById(id);if(e)e.textContent=t;};

  function setNextEPM(){
    const el=document.getElementById("nextrelease"); if(!el) return;
    const today=new Date();
    const y=today.getUTCFullYear(), m=today.getUTCMonth(), d=today.getUTCDate();
    const next = (d < 25) ? new Date(Date.UTC(y, m, 25)) : new Date(Date.UTC(y, m+1, 25));
    const todayUTC=Date.UTC(y,m,d);
    const diff=Math.round((next-todayUTC)/86400000);
    const MO=["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
    let suf = diff>1?` (in ${diff}d)` : diff===1?" (tomorrow)" : diff===0?" (today)" : "";
    el.textContent="NEXT EPM · "+MO[next.getUTCMonth()]+" "+next.getUTCDate()+suf;
  }

  function render(d){
    const el = d.electricity || SEED.electricity;
    const sd = el.solar_detail || SEED.electricity.solar_detail;
    const totalSolar = (el.gen_twh && el.gen_twh.solar) || (sd.utility_twh + sd.distributed_twh);
    const usGen = (el.gen_twh)
      ? Object.values(el.gen_twh).reduce((a,b)=>a+b,0)
      : TOTAL_US_GEN;

    // Headline + capacity factors
    const cfUtility    = sd.utility_twh    / (sd.utility_gw    * 8.76) * 100;   // (TWh/yr) / (GW × 8760h/1000)
    const cfDist       = sd.distributed_twh / (sd.distributed_gw * 8.76) * 100;
    const cfAvg        = totalSolar / ((sd.utility_gw + sd.distributed_gw) * 8.76) * 100;

    set("hd_total", Math.round(totalSolar).toLocaleString()+" TWh/year");
    set("hd_cf",    cfAvg.toFixed(0)+"%");

    // Type bars
    const typeMax = Math.max(sd.utility_twh, sd.distributed_twh);
    const setBar=(id,v)=>{const b=document.getElementById(id);if(b)b.setAttribute("width",(v/typeMax*380).toFixed(1));};
    setBar("bar_utility",     sd.utility_twh);
    setBar("bar_distributed", sd.distributed_twh);
    set("v_utility",     sd.utility_twh.toFixed(0));
    set("v_distributed", sd.distributed_twh.toFixed(0));
    set("cap_utility",     sd.utility_gw.toFixed(0));
    set("cap_distributed", sd.distributed_gw.toFixed(0));
    set("cf_utility",      cfUtility.toFixed(0)+"%");
    set("cf_distributed",  cfDist.toFixed(0)+"%");

    // Top-state bars
    const stateMax = Math.max(...STATES.map(s=>sd.by_state[s]||0));
    STATES.forEach(s=>{
      const v = sd.by_state[s] || 0;
      set("s_"+s, v.toFixed(0));
      const bar=document.getElementById("sb_"+s);
      if(bar) bar.setAttribute("width", (v/stateMax*380).toFixed(1));
    });
    const top5sum = STATES.reduce((a,s)=>a+(sd.by_state[s]||0), 0);
    set("v_top5_pct", (top5sum/totalSolar*100).toFixed(0)+"%");

    // Readouts
    set("r_total", Math.round(totalSolar).toLocaleString()+" TWh");
    const growth = totalSolar / (sd.five_yr_ago_twh || 1);
    set("r_growth", growth.toFixed(1)+"× vs 5 yrs ago ("+sd.five_yr_ago_twh+" TWh)");
    set("r_cap",   (sd.utility_gw + sd.distributed_gw).toFixed(0)+" GW");
    set("r_cf",    cfAvg.toFixed(0)+"%");
    set("r_share", (totalSolar/usGen*100).toFixed(1)+"%");

    const bar=(v,max)=>Math.max(2,Math.min(100,(v/max)*100))+"%";
    const e=(id,w)=>{const x=document.getElementById(id);if(x)x.style.width=w;};
    e("bar_cap",   bar(sd.utility_gw + sd.distributed_gw, 250));
    e("bar_cf",    bar(cfAvg, 35));     // 35% as visual ceiling near theoretical max
    e("bar_share", bar(totalSolar/usGen, 0.15));

    if(window.EM_sparkline){
      EM_sparkline("spark_total", (el.history||{}).solar, EM_color("--tga"));
    }

    const vintage = (el.meta && el.meta.vintage) || d.meta && d.meta.vintage;
    set("datestamp","VINTAGE · "+(vintage||"—"));
    setNextEPM();

    const st = document.getElementById("status");
    if(st){
      if((d.meta && d.meta.status==="live") || (el.meta && el.meta.status==="live")){
        st.textContent="LIVE ✓"; st.classList.add("live");
      } else { st.textContent="CACHED"; st.classList.remove("live"); }
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
