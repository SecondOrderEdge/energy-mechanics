/* spr.js — Energy Mechanics · SPR site detail.
   Reads data.json for the EIA weekly total, allocates per-site by capacity
   share (DOE per-site monthly data not yet wired into update_data.py). */
(function(){
  "use strict";

  const SEED = {
    meta:{vintage:"WK MAY 1 2026",status:"seed"},
    stocks_mb:{spr:374.0},
    flows_mbd:{refinery_inputs:16.0,product_supplied:20.4},
    context:{spr_released_since_march:17.5,spr_capacity:714,spr_peak:727}
  };

  // Design capacities (mb) — DOE Quick Facts
  const SITES = [
    {key:"bryan",  id:"bryan_mound",    cap:254},
    {key:"west",   id:"west_hackberry", cap:227},
    {key:"big",    id:"big_hill",       cap:170},
    {key:"bayou",  id:"bayou_choctaw",  cap: 76}
  ];
  const DESIGN_CAP = SITES.reduce((a,s)=>a+s.cap,0);    // 727 mb
  const PEAK = 727;

  // Tank layout in the SVG: shared baseline at y=400, max tank height 320 (Bryan).
  const BASELINE=400, MAX_HEIGHT=320;

  const set=(id,t)=>{const e=document.getElementById(id);if(e)e.textContent=t;};

  function render(d){
    const total=d.stocks_mb.spr;
    const peakDraw=PEAK-total;
    const recent=d.context.spr_released_since_march;
    const refineryRate=d.flows_mbd.refinery_inputs;
    const demandRate=d.flows_mbd.product_supplied || refineryRate*1.25;
    const daysAtRefRate=total/refineryRate;
    // Days at demand rate — the "weeks of insurance" view. SPR ÷ daily
    // product supplied tells you how long the reserve alone could replace
    // total consumption, assuming markets, not refineries, set the limit.
    const daysAtDemRate=total/demandRate;

    // tanks: height scales with capacity, fill scales with current allocation
    let summed=0;
    SITES.forEach(s=>{
      const fill = total * (s.cap/DESIGN_CAP);
      summed += fill;
      const tankH  = MAX_HEIGHT * (s.cap/254);          // tallest tank == Bryan
      const fillH  = tankH * (fill/s.cap);
      const tankY  = BASELINE - tankH;
      const fillY  = BASELINE - fillH;

      const cap = document.getElementById("cap_"+s.key);
      const fl  = document.getElementById("fill_"+s.key);
      const ln  = document.getElementById("line_"+s.key);
      if(cap){cap.setAttribute("y",tankY); cap.setAttribute("height",tankH);}
      if(fl) {fl.setAttribute("y",fillY); fl.setAttribute("height",fillH);}
      if(ln) {ln.setAttribute("y1",fillY); ln.setAttribute("y2",fillY);}

      set("v_"+s.key, fill.toFixed(0));
      set("p_"+s.key, (fill/s.cap*100).toFixed(0)+"%");
    });
    set("v_sum", summed.toFixed(0));

    // readouts
    set("r_total", Math.round(total)+" mb");
    set("r_pct",   (total/d.context.spr_capacity*100).toFixed(1)+"% of "+d.context.spr_capacity+" mb working cap");
    set("r_drawn", Math.round(peakDraw)+" mb");
    set("r_recent", recent.toFixed(1)+" mb");
    set("r_pace",   (recent/8).toFixed(1)+" mb/wk avg");  // rough Mar→May ~8 weeks
    set("r_days",   daysAtRefRate.toFixed(0)+" days");
    set("r_days_demand", daysAtDemRate.toFixed(0)+" days");

    const bar=(v,max)=>Math.max(2,Math.min(100,(v/max)*100))+"%";
    const e=(id,w)=>{const x=document.getElementById(id);if(x)x.style.width=w;};
    e("bar_drawn",  bar(peakDraw, PEAK));
    e("bar_recent", bar(recent, 30));     // 30 mb = "a lot" in a quarter
    e("bar_days",   bar(daysAtRefRate, 30));
    e("bar_days_demand", bar(daysAtDemRate, 24));
    if(window.EM_sparkline){
      EM_sparkline("spark_total", (d.history||{}).spr, EM_color("--layoff"));
      EM_rangeBadge("range_total", total, (d.ranges_5yr||{}).spr, "mb");
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
