/* refinery.js — Refinery throughput, utilization by PADD, and product yield. */
(function(){
  "use strict";

  const SEED = {
    meta:{vintage:"WK MAY 1 2026",status:"seed"},
    flows_mbd:{refinery_inputs:16.3,gasoline_prod:9.3,distillate_prod:5.0,jet_other_prod:2.0},
    context:{refinery_utilization:91.6}
  };

  // EIA Refinery Capacity Report — operable atmospheric distillation, mb/d
  const PADD_CAPACITY = {
    padd1:0.8, padd2:4.1, padd3:9.7, padd4:0.7, padd5:2.7
  };
  // Throughput share of national (rough, derived from PADD-level reporting)
  const PADD_SHARE = {
    padd1:0.040, padd2:0.225, padd3:0.555, padd4:0.040, padd5:0.140
  };
  const TOTAL_CAP = Object.values(PADD_CAPACITY).reduce((a,b)=>a+b,0);
  const BAR_W = 280;

  const set=(id,t)=>{const e=document.getElementById(id);if(e)e.textContent=t;};

  function render(d){
    const total=d.flows_mbd.refinery_inputs;
    const util =d.context.refinery_utilization;
    const gas =d.flows_mbd.gasoline_prod;
    const dist=d.flows_mbd.distillate_prod;
    const jet =d.flows_mbd.jet_other_prod;
    // EIA "jet & other" residual covers jet + other refined products; split ~50/50
    const jetActual = jet * 0.55;
    const other     = total * 0.10 + (jet - jetActual);   // approx residual category
    const gain = (gas+dist+jet) - total;

    set("hd_total", total.toFixed(1)+" mb/d");
    set("hd_util",  util.toFixed(1)+"% utilization");
    set("v_total", total.toFixed(1));
    set("v_util",  util.toFixed(1)+"%");

    // Live per-PADD refinery inputs when present; otherwise seeded share allocation
    const padd_live = d.padd_refinery_inputs || {};
    Object.keys(PADD_CAPACITY).forEach(k=>{
      const thru = (typeof padd_live[k] === "number") ? padd_live[k] : (total * PADD_SHARE[k]);
      const cap  = PADD_CAPACITY[k];
      const u    = thru/cap;
      set("u_"+k, (u*100).toFixed(0)+"%");
      const bar = document.getElementById("ub_"+k);
      if(bar) bar.setAttribute("width", (Math.min(1,u)*BAR_W).toFixed(1));
    });

    // Yield bars (max width 200)
    const yieldMax = Math.max(gas, dist, jetActual, other);
    const ybar=(id,v)=>{const b=document.getElementById(id);if(b)b.setAttribute("width",(v/yieldMax*200).toFixed(1));};
    ybar("yb_gas",   gas);
    ybar("yb_dist",  dist);
    ybar("yb_jet",   jetActual);
    ybar("yb_other", other);
    set("y_gas",  gas.toFixed(1));
    set("y_dist", dist.toFixed(1));
    set("y_jet",  jetActual.toFixed(1));
    set("y_other",other.toFixed(1));
    set("yp_gas", (gas/total*100).toFixed(0)+"%");
    set("yp_dist",(dist/total*100).toFixed(0)+"%");
    set("yp_jet", (jetActual/total*100).toFixed(0)+"%");
    set("y_gain", gain.toFixed(2));

    // Readouts
    set("r_total", total.toFixed(1)+" mb/d");
    set("r_util",  util.toFixed(1)+"%");
    set("r_gasy",  gas.toFixed(1)+" mb/d");
    set("r_gasy_pct",(gas/total*100).toFixed(0)+"% of barrel");
    set("r_disty", dist.toFixed(1)+" mb/d");
    set("r_disty_pct",(dist/total*100).toFixed(0)+"% of barrel");

    const bar=(v,max)=>Math.max(2,Math.min(100,(v/max)*100))+"%";
    const e=(id,w)=>{const x=document.getElementById(id);if(x)x.style.width=w;};
    e("bar_util", bar(util,100));
    e("bar_gasy", bar(gas/total,0.55));
    e("bar_disty",bar(dist/total,0.35));
    if(window.EM_sparkline){
      EM_sparkline("spark_total", (d.history||{}).refinery_inputs, EM_color("--crude"));
      EM_rangeBadge("range_total", total, (d.ranges_5yr||{}).refinery_inputs, "mb/d");
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
    .then(d=>{if(!d.flows_mbd)throw new Error("no flows");render(d);})
    .catch(err=>{console.warn("data.json load failed, using seed:",err);render(SEED);});
})();
