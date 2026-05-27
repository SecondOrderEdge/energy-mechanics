/* production.js — Crude production by PADD + top states.
   PADD/state breakdowns are scaled allocations of the EIA weekly national
   total until per-PADD/per-state monthly data is wired in. */
(function(){
  "use strict";

  const SEED = {
    meta:{vintage:"WK MAY 1 2026",status:"seed"},
    flows_mbd:{production:13.7}
  };

  // Production share of national (sums to 1.0)
  const PADD_SHARE = {
    padd3: 0.580,  // Gulf Coast (TX, LA, NM, etc.) — Permian, Eagle Ford, offshore
    padd2: 0.275,  // Midwest — Bakken, Niobrara
    padd5: 0.060,  // West Coast — CA, AK
    padd4: 0.070,  // Rockies — CO, WY
    padd1: 0.015   // East — mostly residual
  };
  const STATE_SHARE = {
    tx: 0.42, nm: 0.14, nd: 0.085, co: 0.035, ok: 0.030,
    ak: 0.030, ca: 0.020, wy: 0.018
  };
  const SHALE_SHARE = 0.66;  // tight oil ~66% of national output

  // pipe widths
  const REF=14, REFW=8, MINW=1.5, MAXW=12;
  const widthFor=v=>Math.max(MINW,Math.min(MAXW,(Math.max(v,0)/REF)*REFW));
  const PIPES={padd1:"p_padd1",padd2:"p_padd2",padd3:"p_padd3",padd4:"p_padd4",padd5:"p_padd5"};

  const set=(id,t)=>{const e=document.getElementById(id);if(e)e.textContent=t;};

  function render(d){
    const total=d.flows_mbd.production;

    set("hd_total", total.toFixed(1)+" mb/d");
    set("v_total", total.toFixed(1));

    Object.keys(PADD_SHARE).forEach(k=>{
      const v = total * PADD_SHARE[k];
      set("v_"+k, v.toFixed(1));
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

    Object.keys(STATE_SHARE).forEach(k=>set("s_"+k,(total*STATE_SHARE[k]).toFixed(2)));
    set("s_perm",(total*(STATE_SHARE.tx*0.55 + STATE_SHARE.nm*0.95)).toFixed(2));

    // readouts
    set("r_total", total.toFixed(1)+" mb/d");
    const gulf=total*PADD_SHARE.padd3;
    set("r_gulf", gulf.toFixed(1)+" mb/d");
    set("r_gulf_pct",(PADD_SHARE.padd3*100).toFixed(0)+"% of national");
    set("r_shale",(total*SHALE_SHARE).toFixed(1)+" mb/d");
    set("r_yoy", "+0.6 mb/d");

    const bar=(v,max)=>Math.max(2,Math.min(100,(v/max)*100))+"%";
    const e=(id,w)=>{const x=document.getElementById(id);if(x)x.style.width=w;};
    e("bar_total", bar(total,16));
    e("bar_gulf",  bar(gulf,10));
    e("bar_shale", bar(total*SHALE_SHARE,12));
    e("bar_yoy",   bar(0.6,2));

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
