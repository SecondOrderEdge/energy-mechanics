/* hydro.js — U.S. hydroelectric generation: conventional dams + pumped storage,
   top states, water-year sensitivity. Reads d.electricity.hydro_detail when
   present; falls back to seed otherwise. */
(function(){
  "use strict";

  const SEED = {
    meta:{vintage:"WK MAY 15 2026",status:"seed"},
    electricity:{
      meta:{ vintage:"WK MAY 15 2026" },
      gen_twh:{ hydro:261 },
      hydro_detail:{
        conventional_twh: 261,    // HYC — run-of-river + reservoir
        pumped_net_twh:  -5.7,    // HPS — round-trip storage, net negative
        conventional_gw:   75,
        pumped_gw:         22,
        // Top generating states, TWh/yr (approx 2025 EIA EPM Table 1.6.B)
        by_state:{
          wa:74, or:32, ny:25, ca:28, mt:11
        },
        five_yr_ago_twh:  255,
        drought_low_twh:  220,    // approx low water year (e.g. 2021)
        wet_high_twh:     310     // approx wet water year (e.g. 2017)
      },
      history:{ hydro:[252,248,245,260] }
    }
  };
  const TOTAL_US_GEN = 4242;

  const STATES = ["wa","or","ny","ca","mt"];
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
    const hd = el.hydro_detail || SEED.electricity.hydro_detail;
    const totalHyd = (el.gen_twh && el.gen_twh.hydro) || hd.conventional_twh;
    const usGen = (el.gen_twh)
      ? Object.values(el.gen_twh).reduce((a,b)=>a+b,0)
      : TOTAL_US_GEN;

    // Capacity factors
    const cfConv = hd.conventional_twh / (hd.conventional_gw * 8.76) * 100;

    // Subhead
    const swing = hd.wet_high_twh - hd.drought_low_twh;
    set("hd_total", Math.round(totalHyd).toLocaleString()+" TWh/year");
    set("hd_swing", Math.round(swing / 2));    // ± from midpoint

    // Type bars
    // For pumped, display ABSOLUTE round-trip throughput estimate (capacity ×
    // typical utilization) since net generation is negative and the bar
    // should be visible.
    const pumpedAbs = Math.abs(hd.pumped_net_twh) * 10;   // ~25 TWh round-trip rough
    const typeMax = Math.max(hd.conventional_twh, pumpedAbs);
    const setBar=(id,v)=>{const b=document.getElementById(id);if(b)b.setAttribute("width",(v/typeMax*380).toFixed(1));};
    setBar("bar_conv",   hd.conventional_twh);
    setBar("bar_pumped", pumpedAbs);
    set("v_conv",       hd.conventional_twh.toFixed(0));
    set("v_pumped",     hd.pumped_net_twh.toFixed(1)+" net");
    set("cap_conv",     hd.conventional_gw.toFixed(0));
    set("cap_pumped",   hd.pumped_gw.toFixed(0));
    set("cf_conv",      cfConv.toFixed(0)+"%");

    // Top-state bars
    const stateMax = Math.max(...STATES.map(s=>hd.by_state[s]||0));
    STATES.forEach(s=>{
      const v = hd.by_state[s] || 0;
      set("s_"+s, v.toFixed(0));
      const bar=document.getElementById("sb_"+s);
      if(bar) bar.setAttribute("width", (v/stateMax*380).toFixed(1));
    });
    const top5sum = STATES.reduce((a,s)=>a+(hd.by_state[s]||0), 0);
    set("v_top5_pct", (top5sum/totalHyd*100).toFixed(0)+"%");
    set("v_pnw_pct", (((hd.by_state.wa||0)+(hd.by_state.or||0))/totalHyd*100).toFixed(0)+"%");

    // Readouts
    set("r_total",  Math.round(totalHyd).toLocaleString()+" TWh");
    const ratio5y = totalHyd / (hd.five_yr_ago_twh || 1);
    set("r_growth", ratio5y.toFixed(2)+"× vs 5 yrs ago ("+hd.five_yr_ago_twh+" TWh)");

    set("r_swing",   "±"+Math.round(swing/2)+" TWh");
    set("r_drought", hd.drought_low_twh+" TWh");
    set("r_wet",     hd.wet_high_twh+" TWh");

    set("r_cap",   (hd.conventional_gw + hd.pumped_gw).toFixed(0)+" GW");
    set("r_share", (totalHyd/usGen*100).toFixed(1)+"%");

    const bar=(v,max)=>Math.max(2,Math.min(100,(v/max)*100))+"%";
    const e=(id,w)=>{const x=document.getElementById(id);if(x)x.style.width=w;};
    e("bar_swing", bar(swing/totalHyd, 0.5));       // 50% swing as visual ceiling
    e("bar_cap",   bar(hd.conventional_gw + hd.pumped_gw, 150));
    e("bar_share", bar(totalHyd/usGen, 0.15));

    if(window.EM_sparkline){
      EM_sparkline("spark_total", (el.history||{}).hydro, EM_color("--openings"));
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
