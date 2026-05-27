/* exports.js — Crude exports by destination country (seed allocations). */
(function(){
  "use strict";

  const SEED = {
    meta:{vintage:"WK MAY 1 2026",status:"seed"},
    flows_mbd:{crude_exports:5.6,production:13.7}
  };

  const DEST_SHARE = {
    china:       0.18,
    korea:       0.15,
    netherlands: 0.13,
    india:       0.10,
    uk:          0.07
    // ~0.37 residual (other Asia, other EU, Latin America, etc.)
  };
  const DEST_NAME = {
    china:"China", korea:"South Korea", netherlands:"Netherlands",
    india:"India", uk:"United Kingdom"
  };

  const PIPE_WIDTH = 3.5;
  const widthFor = _v => PIPE_WIDTH;
  const PIPES={china:"p_china",korea:"p_korea",netherlands:"p_neth",india:"p_india",uk:"p_uk"};

  const set=(id,t)=>{const e=document.getElementById(id);if(e)e.textContent=t;};

  function render(d){
    const total=d.flows_mbd.crude_exports;
    const production=d.flows_mbd.production;

    set("hd_total", total.toFixed(1)+" mb/d");
    set("v_total", total.toFixed(1));

    let topKey=null, topVal=0;
    Object.keys(DEST_SHARE).forEach(k=>{
      const v=total*DEST_SHARE[k];
      if(v>topVal){topVal=v;topKey=k;}
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

    const asia=total*(DEST_SHARE.china+DEST_SHARE.korea+DEST_SHARE.india);
    set("r_total", total.toFixed(1)+" mb/d");
    set("r_top",   topVal.toFixed(2)+" mb/d");
    set("r_top_name", DEST_NAME[topKey] || "—");
    set("r_asia",  asia.toFixed(1)+" mb/d");
    set("r_share", (total/production*100).toFixed(0)+"%");

    const bar=(v,max)=>Math.max(2,Math.min(100,(v/max)*100))+"%";
    const e=(id,w)=>{const x=document.getElementById(id);if(x)x.style.width=w;};
    e("bar_top",   bar(topVal,2));
    e("bar_asia",  bar(asia,5));
    e("bar_share", bar(total/production,0.6));
    if(window.EM_sparkline){
      EM_sparkline("spark_total", (d.history||{}).crude_exports, EM_color("--crude"));
      EM_rangeBadge("range_total", total, (d.ranges_5yr||{}).crude_exports, "mb/d");
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
