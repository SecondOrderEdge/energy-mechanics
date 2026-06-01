/* coal.js — U.S. coal generation: bituminous (Appalachian) vs subbituminous
   (Powder River Basin) vs lignite, top states, retirement-curve story.
   Reads d.electricity.coal_detail when present; falls back to seed otherwise. */
(function(){
  "use strict";

  const SEED = {
    meta:{vintage:"WK MAY 15 2026",status:"seed"},
    electricity:{
      meta:{ vintage:"WK MAY 15 2026" },
      gen_twh:{ coal:672 },
      coal_detail:{
        bit_twh: 240,   // Bituminous — Appalachian + Illinois Basin
        sub_twh: 395,   // Subbituminous — Powder River Basin (WY/MT)
        lig_twh:  37,   // Lignite — TX (East TX mines), ND
        by_state:{
          tx:94, wv:50, ky:40, in:38, mo:35
        },
        peak_twh:           2010,    // all-time U.S. coal generation peak (TWh, 2007 calendar)
        peak_year:          2007,
        plants_operating:    175,    // current operating coal-fired plants
        plants_retired_2010: 372,    // operating - retired-since-2010 (very rough)
        five_yr_ago_twh:     940
      },
      history:{ coal:[672,681,695,712] }
    }
  };
  const TOTAL_US_GEN = 4242;

  const STATES = ["tx","wv","ky","in","mo"];
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
    const cd = el.coal_detail || SEED.electricity.coal_detail;
    const totalCoal = (el.gen_twh && el.gen_twh.coal) || (cd.bit_twh + cd.sub_twh + cd.lig_twh);
    const usGen = (el.gen_twh)
      ? Object.values(el.gen_twh).reduce((a,b)=>a+b,0)
      : TOTAL_US_GEN;

    const rankSum = cd.bit_twh + cd.sub_twh + cd.lig_twh;
    const dropPct = (1 - totalCoal / cd.peak_twh) * 100;

    set("hd_total",  Math.round(totalCoal).toLocaleString()+" TWh/year");
    set("hd_peak",   cd.peak_twh.toLocaleString());
    set("hd_peakyr", cd.peak_year);
    set("hd_drop",   dropPct.toFixed(0));

    // Rank bars (sub + bit; lignite is small, shown as the residual in legend only)
    const typeMax = Math.max(cd.sub_twh, cd.bit_twh);
    const setBar=(id,v)=>{const b=document.getElementById(id);if(b)b.setAttribute("width",(v/typeMax*380).toFixed(1));};
    setBar("bar_sub", cd.sub_twh);
    setBar("bar_bit", cd.bit_twh);
    set("v_sub", cd.sub_twh.toFixed(0));
    set("v_bit", cd.bit_twh.toFixed(0));
    set("sh_sub", (cd.sub_twh / rankSum * 100).toFixed(0)+"%");
    set("sh_bit", (cd.bit_twh / rankSum * 100).toFixed(0)+"%");

    // Top-state bars
    const stateMax = Math.max(...STATES.map(s=>cd.by_state[s]||0));
    STATES.forEach(s=>{
      const v = cd.by_state[s] || 0;
      set("s_"+s, v.toFixed(0));
      const bar=document.getElementById("sb_"+s);
      if(bar) bar.setAttribute("width", (v/stateMax*380).toFixed(1));
    });
    const top5sum = STATES.reduce((a,s)=>a+(cd.by_state[s]||0), 0);
    set("v_top5_pct", (top5sum/totalCoal*100).toFixed(0)+"%");
    set("v_plants_retired", cd.plants_retired_2010);

    // Readouts
    set("r_total", Math.round(totalCoal).toLocaleString()+" TWh");
    const ratio5y = totalCoal / (cd.five_yr_ago_twh || 1);
    set("r_growth", ratio5y.toFixed(2)+"× vs 5 yrs ago ("+cd.five_yr_ago_twh+" TWh)");

    set("r_vs_peak",  "−"+dropPct.toFixed(0)+"%");
    set("r_peak_yr",  cd.peak_year);
    set("r_peak_twh", cd.peak_twh.toLocaleString());

    set("r_plants", cd.plants_operating);
    set("r_share",  (totalCoal/usGen*100).toFixed(1)+"%");

    const bar=(v,max)=>Math.max(2,Math.min(100,(v/max)*100))+"%";
    const e=(id,w)=>{const x=document.getElementById(id);if(x)x.style.width=w;};
    // vs peak: fill = remaining share of peak (visual contraction)
    e("bar_vs_peak", bar(totalCoal / cd.peak_twh, 1));
    e("bar_plants",  bar(cd.plants_operating, 600));    // 600 ~= 2010 fleet size
    e("bar_share",   bar(totalCoal/usGen, 0.50));        // 50% as visual ceiling (peak share)

    if(window.EM_sparkline){
      EM_sparkline("spark_total", (el.history||{}).coal, EM_color("--layoff"));
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
