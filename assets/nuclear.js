/* nuclear.js — U.S. nuclear generation: PWR vs BWR designs, top states,
   capacity-factor explainer. Reads d.electricity.nuclear_detail when present;
   falls back to seed for offline / not-yet-wired paths. */
(function(){
  "use strict";

  const SEED = {
    meta:{vintage:"WK MAY 15 2026",status:"seed"},
    electricity:{
      meta:{ vintage:"WK MAY 15 2026" },
      gen_twh:{ nuclear:770 },
      nuclear_detail:{
        pwr_twh:     530,   // Pressurized Water Reactors — Westinghouse/CE/B&W
        bwr_twh:     240,   // Boiling Water Reactors — GE
        pwr_gw:       67,   // nameplate
        bwr_gw:       28,
        reactors_pwr: 65,
        reactors_bwr: 29,
        // Top generating states, TWh/yr (approx 2024 EIA EPM Table 1.6.B)
        by_state:{
          il:95, pa:75, sc:52, al:45, nc:42
        },
        five_yr_ago_twh: 790  // higher than today — Indian Point + Palisades retirements
      },
      history:{ nuclear:[770,772,778,775] }
    }
  };
  const TOTAL_US_GEN = 4242;

  const STATES = ["il","pa","sc","al","nc"];
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
    const nd = el.nuclear_detail || SEED.electricity.nuclear_detail;
    const totalNuc = (el.gen_twh && el.gen_twh.nuclear) || (nd.pwr_twh + nd.bwr_twh);
    const usGen = (el.gen_twh)
      ? Object.values(el.gen_twh).reduce((a,b)=>a+b,0)
      : TOTAL_US_GEN;

    // Capacity factors per design (TWh/yr ÷ (GW × 8760h/1000))
    const cfPwr = nd.pwr_twh / (nd.pwr_gw * 8.76) * 100;
    const cfBwr = nd.bwr_twh / (nd.bwr_gw * 8.76) * 100;
    const cfAvg = totalNuc / ((nd.pwr_gw + nd.bwr_gw) * 8.76) * 100;

    set("hd_total", Math.round(totalNuc).toLocaleString()+" TWh/year");
    set("hd_cf",    cfAvg.toFixed(0)+"%");
    set("hd_units", (nd.reactors_pwr + nd.reactors_bwr) + " operating reactors");

    // Type bars
    const typeMax = Math.max(nd.pwr_twh, nd.bwr_twh);
    const setBar=(id,v)=>{const b=document.getElementById(id);if(b)b.setAttribute("width",(v/typeMax*380).toFixed(1));};
    setBar("bar_pwr", nd.pwr_twh);
    setBar("bar_bwr", nd.bwr_twh);
    set("v_pwr",   nd.pwr_twh.toFixed(0));
    set("v_bwr",   nd.bwr_twh.toFixed(0));
    set("cap_pwr", nd.pwr_gw.toFixed(0));
    set("cap_bwr", nd.bwr_gw.toFixed(0));
    set("n_pwr",   nd.reactors_pwr);
    set("n_bwr",   nd.reactors_bwr);
    set("cf_pwr",  cfPwr.toFixed(0)+"%");
    set("cf_bwr",  cfBwr.toFixed(0)+"%");
    set("src_pwr", nd.reactors_pwr);
    set("src_bwr", nd.reactors_bwr);

    // Top-state bars
    const stateMax = Math.max(...STATES.map(s=>nd.by_state[s]||0));
    STATES.forEach(s=>{
      const v = nd.by_state[s] || 0;
      set("s_"+s, v.toFixed(0));
      const bar=document.getElementById("sb_"+s);
      if(bar) bar.setAttribute("width", (v/stateMax*380).toFixed(1));
    });
    const top5sum = STATES.reduce((a,s)=>a+(nd.by_state[s]||0), 0);
    set("v_top5_pct", (top5sum/totalNuc*100).toFixed(0)+"%");

    // Readouts
    set("r_total", Math.round(totalNuc).toLocaleString()+" TWh");
    const ratio = totalNuc / (nd.five_yr_ago_twh || 1);
    const dir   = ratio >= 1 ? "× vs 5 yrs ago" : "× vs 5 yrs ago (retirements)";
    set("r_growth", ratio.toFixed(2)+dir+" ("+nd.five_yr_ago_twh+" TWh)");
    set("r_cap",   (nd.pwr_gw + nd.bwr_gw).toFixed(0)+" GW");
    set("r_cf",    cfAvg.toFixed(0)+"%");
    set("r_share", (totalNuc/usGen*100).toFixed(1)+"%");

    const bar=(v,max)=>Math.max(2,Math.min(100,(v/max)*100))+"%";
    const e=(id,w)=>{const x=document.getElementById(id);if(x)x.style.width=w;};
    e("bar_cap",   bar(nd.pwr_gw + nd.bwr_gw, 120));
    e("bar_cf",    bar(cfAvg, 100));    // 100% as visual ceiling (~93% is the real max)
    e("bar_share", bar(totalNuc/usGen, 0.25));

    if(window.EM_sparkline){
      EM_sparkline("spark_total", (el.history||{}).nuclear, EM_color("--openings"));
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
