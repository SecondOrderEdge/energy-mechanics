/* wind.js — U.S. wind generation: onshore vs offshore, top states,
   capacity-factor explainer. Reads d.electricity.wind_detail when present;
   falls back to seed for offline / not-yet-wired paths. */
(function(){
  "use strict";

  const SEED = {
    meta:{vintage:"WK MAY 15 2026",status:"seed"},
    electricity:{
      meta:{ vintage:"WK MAY 15 2026" },
      gen_twh:{ wind:467 },
      wind_detail:{
        onshore_twh:   457,   // land-based farms — 99% of U.S. wind
        offshore_twh:   10,   // Vineyard Wind, South Fork, Coastal VA
        onshore_gw:    156,   // installed nameplate (live ~160 incl. ~4 offshore)
        offshore_gw:     4,
        // Top generating states, TWh/yr (approx 2024 EIA EPM Table 1.6.B)
        by_state:{
          tx:132, ia:43, ok:40, ks:30, il:25
        },
        five_yr_ago_twh: 310  // for the "X× vs 5 yrs ago" callout
      },
      history:{ wind:[440,432,425,415] }
    }
  };
  const TOTAL_US_GEN = 4242;   // for share-of-US fallback if gen_twh missing

  const STATES = ["tx","ia","ok","ks","il"];
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
    const wd = el.wind_detail || SEED.electricity.wind_detail;
    const totalWind = (el.gen_twh && el.gen_twh.wind) || (wd.onshore_twh + wd.offshore_twh);
    const usGen = (el.gen_twh)
      ? Object.values(el.gen_twh).reduce((a,b)=>a+b,0)
      : TOTAL_US_GEN;

    // Headline + capacity factors
    const cfOn  = wd.onshore_twh  / (wd.onshore_gw  * 8.76) * 100;   // (TWh/yr) / (GW × 8760h/1000)
    const cfOff = wd.offshore_twh / (wd.offshore_gw * 8.76) * 100;
    const cfAvg = totalWind / ((wd.onshore_gw + wd.offshore_gw) * 8.76) * 100;

    set("hd_total", Math.round(totalWind).toLocaleString()+" TWh/year");

    // Top-5 share for the subhead "Plains corridor" callout
    const top5sum = STATES.reduce((a,s)=>a+(wd.by_state[s]||0), 0);
    set("hd_top", (top5sum/totalWind*100).toFixed(0)+"%");

    // Type bars (onshore vs offshore)
    const typeMax = Math.max(wd.onshore_twh, wd.offshore_twh);
    const setBar=(id,v)=>{const b=document.getElementById(id);if(b)b.setAttribute("width",(v/typeMax*380).toFixed(1));};
    setBar("bar_onshore",  wd.onshore_twh);
    setBar("bar_offshore", wd.offshore_twh);
    set("v_onshore",   wd.onshore_twh.toFixed(0));
    set("v_offshore",  wd.offshore_twh.toFixed(0));
    set("cap_onshore", wd.onshore_gw.toFixed(0));
    set("cap_offshore",wd.offshore_gw.toFixed(0));
    set("cf_onshore",  cfOn.toFixed(0)+"%");
    set("cf_offshore", cfOff.toFixed(0)+"%");

    // Top-state bars
    const stateMax = Math.max(...STATES.map(s=>wd.by_state[s]||0));
    STATES.forEach(s=>{
      const v = wd.by_state[s] || 0;
      set("s_"+s, v.toFixed(0));
      const bar=document.getElementById("sb_"+s);
      if(bar) bar.setAttribute("width", (v/stateMax*380).toFixed(1));
    });
    set("v_top5_pct", (top5sum/totalWind*100).toFixed(0)+"%");

    // Readouts
    set("r_total", Math.round(totalWind).toLocaleString()+" TWh");
    const growth = totalWind / (wd.five_yr_ago_twh || 1);
    set("r_growth", growth.toFixed(1)+"× vs 5 yrs ago ("+wd.five_yr_ago_twh+" TWh)");
    set("r_cap",   (wd.onshore_gw + wd.offshore_gw).toFixed(0)+" GW");
    set("r_cf",    cfAvg.toFixed(0)+"%");
    set("r_share", (totalWind/usGen*100).toFixed(1)+"%");

    const bar=(v,max)=>Math.max(2,Math.min(100,(v/max)*100))+"%";
    const e=(id,w)=>{const x=document.getElementById(id);if(x)x.style.width=w;};
    e("bar_cap",   bar(wd.onshore_gw + wd.offshore_gw, 250));
    e("bar_cf",    bar(cfAvg, 50));     // 50% as visual ceiling near best onshore Plains sites
    e("bar_share", bar(totalWind/usGen, 0.20));

    if(window.EM_sparkline){
      EM_sparkline("spark_total", (el.history||{}).wind, EM_color("--emp"));
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
