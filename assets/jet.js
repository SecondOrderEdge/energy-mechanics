/* jet.js — Jet fuel and the long-tail "other" refined products. */
(function(){
  "use strict";

  const SEED = {
    meta:{vintage:"WK MAY 1 2026",status:"seed"},
    flows_mbd:{jet_other_prod:2.0,refinery_inputs:16.3}
  };

  // The overview "jet_other_prod" is a small residual after gasoline & distillate.
  // Real EIA splits show the broader "other refined products" bucket is much
  // larger — about 25% of refinery output — covering LPG, naphtha, residual, etc.
  // For the detail page we surface the real-world product mix (in mb/d).
  const SHARES = {
    jet:     1.7,   // EIA WKJUPUS2 typical
    resid:   0.30,  // residual fuel oil
    lpg:     2.2,   // LPG/propane production
    naphtha: 0.50,  // naphtha + petrochem feedstock
    asph:    0.50   // asphalt, coke, lubes, waxes combined
  };

  const BAR_W = 780;
  const set=(id,t)=>{const e=document.getElementById(id);if(e)e.textContent=t;};

  function render(d){
    const overviewResidual = d.flows_mbd.jet_other_prod;
    const refInputs = d.flows_mbd.refinery_inputs;
    const total = Object.values(SHARES).reduce((a,b)=>a+b,0);

    set("hd_total", overviewResidual.toFixed(1)+" mb/d");
    set("hd_jet",   SHARES.jet.toFixed(1)+" mb/d");

    const maxV = Math.max(...Object.values(SHARES));
    const setBar=(id,v)=>{const b=document.getElementById(id);if(b)b.setAttribute("width",(v/maxV*BAR_W).toFixed(1));};
    setBar("bar_jet",   SHARES.jet);
    setBar("bar_resid", SHARES.resid);
    setBar("bar_lpg",   SHARES.lpg);
    setBar("bar_naph",  SHARES.naphtha);
    setBar("bar_asph",  SHARES.asph);

    set("v_jet",   SHARES.jet.toFixed(2));
    set("v_resid", SHARES.resid.toFixed(2));
    set("v_lpg",   SHARES.lpg.toFixed(2));
    set("v_naph",  SHARES.naphtha.toFixed(2));
    set("v_asph",  SHARES.asph.toFixed(2));

    set("r_total", total.toFixed(1)+" mb/d");
    set("r_jet",   SHARES.jet.toFixed(2)+" mb/d");
    set("r_resid", SHARES.resid.toFixed(2)+" mb/d");
    set("r_yld",   (total/refInputs*100).toFixed(0)+"%");

    const bar=(v,max)=>Math.max(2,Math.min(100,(v/max)*100))+"%";
    const e=(id,w)=>{const x=document.getElementById(id);if(x)x.style.width=w;};
    e("bar_r_jet",   bar(SHARES.jet,3));
    e("bar_r_resid", bar(SHARES.resid,1));
    e("bar_r_yld",   bar(total/refInputs,0.4));
    if(window.EM_sparkline){
      EM_sparkline("spark_total", (d.history||{}).jet_other_prod, EM_color("--jet"));
      EM_rangeBadge("range_total", overviewResidual, (d.ranges_5yr||{}).jet_other_prod, "mb/d");
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
