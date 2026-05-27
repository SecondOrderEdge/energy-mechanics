/* imports.js — Crude imports by country of origin (seed allocations). */
(function(){
  "use strict";

  const SEED = {
    meta:{vintage:"WK MAY 1 2026",status:"seed"},
    flows_mbd:{crude_imports:6.0,refinery_inputs:16.3}
  };

  const COUNTRY_SHARE = {
    canada:   0.610,
    mexico:   0.085,
    saudi:    0.075,
    colombia: 0.055,
    iraq:     0.040
    // ~0.135 residual not visualized (Guyana, Nigeria, Algeria, others)
  };
  const GRADE_SHARE = { heavy:0.70, medium:0.18, light:0.12 };
  const OPEC_SHARE  = 0.135;

  const REF=8, REFW=8, MINW=1.5, MAXW=10;
  const widthFor=v=>Math.max(MINW,Math.min(MAXW,(Math.max(v,0)/REF)*REFW));
  const PIPES={canada:"p_canada",mexico:"p_mexico",saudi:"p_saudi",colombia:"p_colombia",iraq:"p_iraq"};

  const set=(id,t)=>{const e=document.getElementById(id);if(e)e.textContent=t;};

  function render(d){
    const total=d.flows_mbd.crude_imports;
    const refInputs=d.flows_mbd.refinery_inputs;

    set("hd_total", total.toFixed(1)+" mb/d");
    set("v_total", total.toFixed(1));

    Object.keys(COUNTRY_SHARE).forEach(k=>{
      const v=total*COUNTRY_SHARE[k];
      set("v_"+k, v.toFixed(2));
      const p=document.getElementById(PIPES[k]); if(p){
        p.setAttribute("stroke-width", widthFor(v).toFixed(2));
        p.setAttribute("opacity","0.5");
        const anim=p.cloneNode(false);
        anim.removeAttribute("id");
        anim.setAttribute("class","flow flow-dash");
        anim.setAttribute("opacity","1");
        p.parentNode.appendChild(anim);
      }
    });

    set("g_heavy", (total*GRADE_SHARE.heavy).toFixed(2));
    set("g_med",   (total*GRADE_SHARE.medium).toFixed(2));
    set("g_light", (total*GRADE_SHARE.light).toFixed(2));
    set("g_opec",  (OPEC_SHARE*100).toFixed(0)+"%");
    set("g_can_pct",(COUNTRY_SHARE.canada*100).toFixed(0)+"%");
    set("g_top3", ((COUNTRY_SHARE.canada+COUNTRY_SHARE.mexico+COUNTRY_SHARE.saudi)*100).toFixed(0)+"%");

    set("r_total",  total.toFixed(1)+" mb/d");
    set("r_canada", (total*COUNTRY_SHARE.canada).toFixed(1)+" mb/d");
    set("r_canada_pct",(COUNTRY_SHARE.canada*100).toFixed(0)+"% of imports");
    set("r_opec",   (OPEC_SHARE*100).toFixed(0)+"%");
    set("r_dep",    (total/refInputs*100).toFixed(0)+"%");

    const bar=(v,max)=>Math.max(2,Math.min(100,(v/max)*100))+"%";
    const e=(id,w)=>{const x=document.getElementById(id);if(x)x.style.width=w;};
    e("bar_total",  bar(total,10));
    e("bar_canada", bar(total*COUNTRY_SHARE.canada,5));
    e("bar_opec",   bar(OPEC_SHARE,0.7));
    e("bar_dep",    bar(total/refInputs,0.5));

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
