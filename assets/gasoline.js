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
  const GAS_DEMAND_SHARE = 0.45;  // gasoline ≈ 45% of total product supplied

  const BAR_W = 380;
  const PADDS = ["padd1","padd2","padd3","padd4","padd5"];

  const set=(id,t)=>{const e=document.getElementById(id);if(e)e.textContent=t;};

  function render(d){
    const prod=d.flows_mbd.gasoline_prod;
    const stk =d.stocks_mb.gasoline;
    const ref =d.flows_mbd.refinery_inputs;
    const gasDemand = d.flows_mbd.product_supplied * GAS_DEMAND_SHARE;
    const days = stk / gasDemand;

    set("hd_prod", prod.toFixed(1)+" mb/d");
    set("hd_stk",  Math.round(stk)+" mb");
    set("hd_days", days.toFixed(1));
    set("v_prod",  prod.toFixed(1));
    set("v_stk",   Math.round(stk));

    const prodMax = prod * Math.max(...Object.values(PROD_SHARE));
    const stkMax  = stk  * Math.max(...Object.values(STK_SHARE));

    PADDS.forEach(k=>{
      const pv = prod * PROD_SHARE[k];
      const sv = stk  * STK_SHARE[k];
      set("p_"+k, pv.toFixed(2));
      set("s_"+k, sv.toFixed(0));
      const pb=document.getElementById("pb_"+k); if(pb) pb.setAttribute("width",(pv/prodMax*BAR_W).toFixed(1));
      const sb=document.getElementById("sb_"+k); if(sb) sb.setAttribute("width",(sv/stkMax*BAR_W).toFixed(1));
    });

    set("r_prod", prod.toFixed(1)+" mb/d");
    set("r_stk",  Math.round(stk)+" mb");
    set("r_stk_5yr","~+5 mb vs 5-yr avg");
    set("r_days", days.toFixed(1)+" days");
    set("r_yld",  (prod/ref*100).toFixed(0)+"%");

    const bar=(v,max)=>Math.max(2,Math.min(100,(v/max)*100))+"%";
    const e=(id,w)=>{const x=document.getElementById(id);if(x)x.style.width=w;};
    e("bar_prod", bar(prod,12));
    e("bar_stk",  bar(stk,260));
    e("bar_days", bar(days,30));
    e("bar_yld",  bar(prod/ref,0.6));

    set("datestamp","VINTAGE · "+(d.meta.vintage||"—"));
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
