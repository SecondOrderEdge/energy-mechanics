/* demand.js — Product supplied (demand) breakdown by product. */
(function(){
  "use strict";

  const SEED = {
    meta:{vintage:"WK MAY 1 2026",status:"seed"},
    flows_mbd:{product_supplied:20.4}
  };

  const SHARE = {
    gas:   0.45,   // motor gasoline
    dist:  0.20,   // distillate (diesel + heating)
    jet:   0.085,  // jet fuel
    other: 0.265   // LPG + naphtha + resid + asphalt + lubes + coke
  };

  const BAR_W = 780;
  const set=(id,t)=>{const e=document.getElementById(id);if(e)e.textContent=t;};

  function render(d){
    const total = d.flows_mbd.product_supplied;
    const gas   = total * SHARE.gas;
    const dist  = total * SHARE.dist;
    const jet   = total * SHARE.jet;
    const other = total * SHARE.other;
    const maxV  = gas; // gasoline is always the largest

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
    set("p_gas",  (SHARE.gas*100).toFixed(0)+"%");
    set("p_dist", (SHARE.dist*100).toFixed(0)+"%");
    set("p_jet",  (SHARE.jet*100).toFixed(0)+"%");
    set("p_oth",  (SHARE.other*100).toFixed(0)+"%");

    set("r_total", total.toFixed(1)+" mb/d");
    set("r_gas",   gas.toFixed(1)+" mb/d");  set("r_gas_pct",(SHARE.gas*100).toFixed(0)+"%");
    set("r_dist",  dist.toFixed(1)+" mb/d"); set("r_dist_pct",(SHARE.dist*100).toFixed(0)+"%");
    set("r_jet",   jet.toFixed(1)+" mb/d");  set("r_jet_pct",(SHARE.jet*100).toFixed(0)+"%");

    const bar=(v,max)=>Math.max(2,Math.min(100,(v/max)*100))+"%";
    const e=(id,w)=>{const x=document.getElementById(id);if(x)x.style.width=w;};
    e("bar_total",   bar(total,25));
    e("bar_gas_ro",  bar(gas,12));
    e("bar_dist_ro", bar(dist,6));
    e("bar_jet_ro",  bar(jet,3));

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
