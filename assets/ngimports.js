/* ngimports.js — Canada → U.S. pipeline gas imports.
   Per-pipeline values are a seeded allocation against the live national
   imports total from update_data.py (flows_bcfd.imports). */
(function(){
  "use strict";

  const SEED = {
    meta:{vintage:"WK MAY 15 2026",status:"seed"},
    natural_gas:{
      meta:{vintage:"WK MAY 15 2026"},
      flows_bcfd:{ imports:8.0, production:105.0 }
    }
  };

  // Capacity-weighted shares of the five major Canadian border crossings.
  // Sum < 1.0 — the rest is Champlain VT, Highgate VT, Sault Ste Marie MI,
  // and smaller laterals.
  const CROSSING_SHARE = {
    niagara:   0.25,   // TC Mainline + Iroquois — historically biggest, declining
    emerson:   0.22,   // Northern Border + Alliance + Viking into Chicago
    kingsgate: 0.20,   // GTN into Pacific NW + N. California
    sumas:     0.18,   // Westcoast → NW Pipeline → PNW
    morgan:    0.08,   // Williston Basin Interstate
  };
  // Approx U.S.→Canada reverse-flow ratio (summer ON exports, etc.)
  // Net imports = gross × (1 − REVERSE_RATIO).
  const REVERSE_RATIO = 0.20;
  const BAR_W = 380;
  const CROSSINGS = Object.keys(CROSSING_SHARE);

  const set=(id,t)=>{const e=document.getElementById(id);if(e)e.textContent=t;};

  function setNextNGW(vintageStr){
    const el=document.getElementById("nextrelease"); if(!el) return;
    const m=vintageStr && String(vintageStr).match(/WK\s+([A-Z]+)\s+(\d+)\s+(\d+)/i);
    const MO=["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
    const DA=["SUN","MON","TUE","WED","THU","FRI","SAT"];
    if(!m){el.textContent="NEXT NGW · —"; return;}
    const mi=MO.indexOf(m[1].toUpperCase()); if(mi<0){el.textContent="NEXT NGW · —"; return;}
    const v=new Date(Date.UTC(+m[3],mi,+m[2])); const n=new Date(v); n.setUTCDate(n.getUTCDate()+13);
    const t=new Date(); const tu=Date.UTC(t.getUTCFullYear(),t.getUTCMonth(),t.getUTCDate());
    const diff=Math.round((n-tu)/86400000);
    let suf = diff>1?` (in ${diff}d)` : diff===1?" (tomorrow)" : diff===0?" (today)" : ` (${Math.abs(diff)}d overdue)`;
    el.textContent="NEXT NGW · "+DA[n.getUTCDay()]+" "+MO[n.getUTCMonth()]+" "+n.getUTCDate()+suf;
  }

  function render(d){
    const ng = d.natural_gas || SEED.natural_gas;
    const f = ng.flows_bcfd || {};
    const total = f.imports || 8.0;
    const production = f.production || 105.0;
    const totalSupply = production + total;
    const netImports = total * (1 - REVERSE_RATIO);

    set("hd_total", total.toFixed(1));
    set("hd_net",   netImports.toFixed(1));

    // Per-crossing allocation
    const vals = {};
    CROSSINGS.forEach(k=>{ vals[k] = total * CROSSING_SHARE[k]; });
    const maxV = Math.max(...Object.values(vals));
    CROSSINGS.forEach(k=>{
      set("p_"+k, vals[k].toFixed(1));
      const b=document.getElementById("pb_"+k);
      if(b) b.setAttribute("width", (vals[k]/maxV*BAR_W).toFixed(1));
    });
    set("v_sum", Object.values(vals).reduce((a,b)=>a+b,0).toFixed(1));

    set("r_total", total.toFixed(1)+" bcf/d");
    set("r_share", (total/totalSupply*100).toFixed(1)+"%");
    set("r_share_note", `${total.toFixed(1)} imports + ${production.toFixed(0)} production = ${totalSupply.toFixed(0)} supply`);
    const western = vals.kingsgate + vals.sumas + vals.morgan;
    set("r_western", western.toFixed(1)+" bcf/d");
    set("r_net", netImports.toFixed(1)+" bcf/d");

    const bar=(v,max)=>Math.max(2,Math.min(100,(v/max)*100))+"%";
    const e=(id,w)=>{const x=document.getElementById(id);if(x)x.style.width=w;};
    e("bar_total",   bar(total, 12));
    e("bar_share",   bar(total/totalSupply, 0.15));
    e("bar_western", bar(western, total));
    e("bar_net",     bar(netImports, total));

    const vintage = (ng.meta && ng.meta.vintage) || d.meta && d.meta.vintage;
    set("datestamp","VINTAGE · "+(vintage||"—"));
    setNextNGW(vintage);

    const st = document.getElementById("status");
    if(st){
      if((d.meta && d.meta.status==="live") || (ng.meta && ng.meta.status==="live")){
        st.textContent="LIVE ✓"; st.classList.add("live");
      } else { st.textContent="CACHED"; st.classList.remove("live"); }
    }
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
    .then(d=>render(d))
    .catch(err=>{console.warn("data.json load failed, using seed:",err);render(SEED);});
})();
