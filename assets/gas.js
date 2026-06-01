/* gas.js — U.S. gas-fired electricity: CCGT vs SCGT, top states, post-coal
   swing-fuel story. Reads d.electricity.gas_detail when present; falls back
   to seed otherwise. */
(function(){
  "use strict";

  const SEED = {
    meta:{vintage:"WK MAY 15 2026",status:"seed"},
    electricity:{
      meta:{ vintage:"WK MAY 15 2026" },
      gen_twh:{ gas:1812 },
      gas_detail:{
        ccgt_twh:  1490,   // Combined cycle — baseload, ~60% efficient
        scgt_twh:   285,   // Simple cycle (peakers) — fast ramp, ~35% efficient
        steam_twh:   37,   // Legacy gas-steam — small, retiring
        ccgt_gw:    332,
        scgt_gw:    179,
        by_state:{
          tx:285, fl:195, pa:143, ca:69, oh:82
        },
        coal_displaced_2010_twh: 900,
        five_yr_ago_twh:         1680
      },
      history:{ gas:[1806,1790,1740,1695] }
    }
  };
  const TOTAL_US_GEN = 4242;

  const STATES = ["tx","fl","pa","ca","oh"];
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
    const gd = el.gas_detail || SEED.electricity.gas_detail;
    const totalGas = (el.gen_twh && el.gen_twh.gas) || (gd.ccgt_twh + gd.scgt_twh + gd.steam_twh);
    const usGen = (el.gen_twh)
      ? Object.values(el.gen_twh).reduce((a,b)=>a+b,0)
      : TOTAL_US_GEN;

    // Capacity factors (TWh/yr ÷ (GW × 8760h/1000))
    const cfCCGT = gd.ccgt_twh / (gd.ccgt_gw * 8.76) * 100;
    const cfSCGT = gd.scgt_twh / (gd.scgt_gw * 8.76) * 100;
    const cfAvg  = totalGas   / ((gd.ccgt_gw + gd.scgt_gw) * 8.76) * 100;

    set("hd_total",     Math.round(totalGas).toLocaleString()+" TWh/year");
    set("hd_displaced", gd.coal_displaced_2010_twh.toLocaleString());

    // Tech bars
    const typeMax = Math.max(gd.ccgt_twh, gd.scgt_twh);
    const setBar=(id,v)=>{const b=document.getElementById(id);if(b)b.setAttribute("width",(v/typeMax*380).toFixed(1));};
    setBar("bar_ccgt", gd.ccgt_twh);
    setBar("bar_scgt", gd.scgt_twh);
    set("v_ccgt",   gd.ccgt_twh.toFixed(0));
    set("v_scgt",   gd.scgt_twh.toFixed(0));
    set("cap_ccgt", gd.ccgt_gw.toFixed(0));
    set("cap_scgt", gd.scgt_gw.toFixed(0));
    set("cf_ccgt",  cfCCGT.toFixed(0)+"%");
    set("cf_scgt",  cfSCGT.toFixed(0)+"%");

    // Top-state bars
    const stateMax = Math.max(...STATES.map(s=>gd.by_state[s]||0));
    STATES.forEach(s=>{
      const v = gd.by_state[s] || 0;
      set("s_"+s, v.toFixed(0));
      const bar=document.getElementById("sb_"+s);
      if(bar) bar.setAttribute("width", (v/stateMax*380).toFixed(1));
    });
    const top5sum = STATES.reduce((a,s)=>a+(gd.by_state[s]||0), 0);
    set("v_top5_pct", (top5sum/totalGas*100).toFixed(0)+"%");
    set("v_tx_pct",   ((gd.by_state.tx||0)/totalGas*100).toFixed(0)+"%");

    // Readouts
    set("r_total", Math.round(totalGas).toLocaleString()+" TWh");
    const ratio5y = totalGas / (gd.five_yr_ago_twh || 1);
    set("r_growth", ratio5y.toFixed(2)+"× vs 5 yrs ago ("+gd.five_yr_ago_twh.toLocaleString()+" TWh)");

    set("r_cap",   (gd.ccgt_gw + gd.scgt_gw).toFixed(0)+" GW");
    set("r_cf",    cfAvg.toFixed(0)+"%");
    set("r_share", (totalGas/usGen*100).toFixed(1)+"%");

    const bar=(v,max)=>Math.max(2,Math.min(100,(v/max)*100))+"%";
    const e=(id,w)=>{const x=document.getElementById(id);if(x)x.style.width=w;};
    e("bar_cap",   bar(gd.ccgt_gw + gd.scgt_gw, 500));
    e("bar_cf",    bar(cfAvg, 70));    // 70% as visual ceiling (CCGT can hit 90% in winter)
    e("bar_share", bar(totalGas/usGen, 0.50));

    if(window.EM_sparkline){
      EM_sparkline("spark_total", (el.history||{}).gas, EM_color("--emp"));
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
