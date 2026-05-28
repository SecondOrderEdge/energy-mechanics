/* demand.js — Product supplied (demand) breakdown by product. */
(function(){
  "use strict";

  const SEED = {
    meta:{vintage:"WK MAY 1 2026",status:"seed"},
    flows_mbd:{product_supplied:20.4}
  };

  // Fallback shares — used per-key only when the corresponding live EIA
  // per-product supplied series is missing from data.json. Normally every
  // value below comes from live data.
  const SHARE_FALLBACK = { gas: 0.45, dist: 0.20, jet: 0.085 };

  const BAR_W = 780;
  const set=(id,t)=>{const e=document.getElementById(id);if(e)e.textContent=t;};

  function render(d){
    const f = d.flows_mbd;
    const total = f.product_supplied;
    const gas   = (typeof f.gasoline_supplied   === "number") ? f.gasoline_supplied   : total * SHARE_FALLBACK.gas;
    const dist  = (typeof f.distillate_supplied === "number") ? f.distillate_supplied : total * SHARE_FALLBACK.dist;
    const jet   = (typeof f.jet_supplied        === "number") ? f.jet_supplied        : total * SHARE_FALLBACK.jet;
    const other = Math.max(0, total - gas - dist - jet);
    const maxV  = Math.max(gas, dist, jet, other);

    set("hd_total", total.toFixed(1)+" mb/d");

    const setBar=(id,v)=>{const b=document.getElementById(id);if(b)b.setAttribute("width",(v/maxV*BAR_W).toFixed(1));};
    setBar("bar_gas",  gas);
    setBar("bar_dist", dist);
    setBar("bar_jet",  jet);
    setBar("bar_oth",  other);

    set("v_gas",  gas.toFixed(1));
    set("v_dist", dist.toFixed(1));
    set("v_jet",  jet.toFixed(1));
    set("v_oth",  other.toFixed(1));
    // Percentages now derived from the actual displayed values (live when present).
    const pct = v => (v/total*100).toFixed(0)+"%";
    set("p_gas",  pct(gas));
    set("p_dist", pct(dist));
    set("p_jet",  pct(jet));
    set("p_oth",  pct(other));

    set("r_total", total.toFixed(1)+" mb/d");
    set("r_gas",   gas.toFixed(1)+" mb/d");  set("r_gas_pct", pct(gas));
    set("r_dist",  dist.toFixed(1)+" mb/d"); set("r_dist_pct",pct(dist));
    set("r_jet",   jet.toFixed(1)+" mb/d");  set("r_jet_pct", pct(jet));

    const bar=(v,max)=>Math.max(2,Math.min(100,(v/max)*100))+"%";
    const e=(id,w)=>{const x=document.getElementById(id);if(x)x.style.width=w;};
    e("bar_gas_ro",  bar(gas,12));
    e("bar_dist_ro", bar(dist,6));
    e("bar_jet_ro",  bar(jet,3));
    if(window.EM_sparkline){
      EM_sparkline("spark_total", (d.history||{}).product_supplied, EM_color("--openings"));
      EM_rangeBadge("range_total", total, (d.ranges_5yr||{}).product_supplied, "mb/d");
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
