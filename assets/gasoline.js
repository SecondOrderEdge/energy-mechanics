/* gasoline.js — Gasoline production + stocks by PADD. */
(function(){
  "use strict";

  const SEED = {
    meta:{vintage:"WK MAY 1 2026",status:"seed"},
    flows_mbd:{gasoline_prod:9.3,product_supplied:20.4,refinery_inputs:16.3},
    stocks_mb:{gasoline:214}
  };

  const PROD_SHARE = { padd1:0.115, padd2:0.230, padd3:0.495, padd4:0.040, padd5:0.120 };
  const STK_SHARE  = { padd1:0.265, padd2:0.235, padd3:0.380, padd4:0.040, padd5:0.080 };
  const GAS_DEMAND_SHARE_FALLBACK = 0.45;  // used only if WGFUPUS2 didn't resolve

  const BAR_W = 380;
  const PADDS = ["padd1","padd2","padd3","padd4","padd5"];

  const set=(id,t)=>{const e=document.getElementById(id);if(e)e.textContent=t;};

  function render(d){
    const prod=d.flows_mbd.gasoline_prod;
    const stk =d.stocks_mb.gasoline;
    const ref =d.flows_mbd.refinery_inputs;
    const gasDemand = (typeof d.flows_mbd.gasoline_supplied === "number")
      ? d.flows_mbd.gasoline_supplied
      : d.flows_mbd.product_supplied * GAS_DEMAND_SHARE_FALLBACK;
    const days = stk / gasDemand;

    set("hd_prod", prod.toFixed(1)+" mb/d");
    set("hd_stk",  Math.round(stk)+" mb");
    set("hd_days", days.toFixed(1));
    set("v_prod",  prod.toFixed(1));
    set("v_stk",   Math.round(stk));

    // Live per-PADD values when update_data.py populated them; seed allocations otherwise
    const prod_live = d.padd_gasoline_prod   || {};
    const stk_live  = d.padd_gasoline_stocks || {};
    const prodVals = PADDS.map(k => (typeof prod_live[k] === "number") ? prod_live[k] : prod * PROD_SHARE[k]);
    const stkVals  = PADDS.map(k => (typeof stk_live[k]  === "number") ? stk_live[k]  : stk  * STK_SHARE[k]);
    const prodMax  = Math.max(...prodVals);
    const stkMax   = Math.max(...stkVals);

    PADDS.forEach((k, i) => {
      const pv = prodVals[i];
      const sv = stkVals[i];
      set("p_"+k, pv.toFixed(2));
      set("s_"+k, sv.toFixed(0));
      const pb=document.getElementById("pb_"+k); if(pb) pb.setAttribute("width",(pv/prodMax*BAR_W).toFixed(1));
      const sb=document.getElementById("sb_"+k); if(sb) sb.setAttribute("width",(sv/stkMax*BAR_W).toFixed(1));
    });

    set("r_prod", prod.toFixed(1)+" mb/d");
    set("r_stk",  Math.round(stk)+" mb");
    const stkAvg = (d.ranges_5yr && d.ranges_5yr.gasoline && d.ranges_5yr.gasoline.avg);
    if(typeof stkAvg === "number"){
      const dlt = Math.round(stk - stkAvg);
      set("r_stk_5yr", (dlt >= 0 ? "+" : "") + dlt + " mb vs 5-yr avg");
    } else { set("r_stk_5yr", "—"); }
    set("r_days", days.toFixed(1)+" days");
    set("r_yld",  (prod/ref*100).toFixed(0)+"%");

    const bar=(v,max)=>Math.max(2,Math.min(100,(v/max)*100))+"%";
    const e=(id,w)=>{const x=document.getElementById(id);if(x)x.style.width=w;};
    e("bar_days", bar(days,30));
    e("bar_yld",  bar(prod/ref,0.6));
    if(window.EM_sparkline){
      EM_sparkline("spark_prod", (d.history||{}).gasoline_prod, EM_color("--gasoline"));
      EM_rangeBadge("range_prod", prod, (d.ranges_5yr||{}).gasoline_prod, "mb/d");
      EM_sparkline("spark_stk",  (d.history||{}).gasoline,       EM_color("--gasoline"));
      EM_rangeBadge("range_stk", stk, (d.ranges_5yr||{}).gasoline, "mb");
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
