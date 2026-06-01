/* ngmexico.js — U.S. → Mexico pipeline gas exports.
   Per-pipeline values are a seeded allocation against the live national
   mexico_exports total from update_data.py. */
(function(){
  "use strict";

  const SEED = {
    meta:{vintage:"WK MAY 15 2026",status:"seed"},
    natural_gas:{
      meta:{vintage:"WK MAY 15 2026"},
      flows_bcfd:{ mexico_exports:6.6, lng_exports:19.1 }
    }
  };

  // Capacity-weighted shares of the major south-bound crossings.
  // Sum < 100% — the rest is smaller laterals in AZ/CA/TX.
  const CROSSING_SHARE = {
    sur_tx:      0.32,   // Sur de Texas-Tuxpan (subsea)
    roadrunner:  0.20,
    trans_pecos: 0.22,
    comanche:    0.18,
  };
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
    const total = f.mexico_exports || 6.0;
    const lng   = f.lng_exports || 14.0;
    const totalExports = total + lng;

    set("hd_total", total.toFixed(1)+" bcf/d");

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
    set("r_share", (total/totalExports*100).toFixed(0)+"%");
    set("r_share_note", `${total.toFixed(1)} pipe + ${lng.toFixed(1)} LNG = ${totalExports.toFixed(1)} total`);
    const permianOutlet = vals.roadrunner + vals.trans_pecos + vals.comanche;
    set("r_permian", permianOutlet.toFixed(1)+" bcf/d");

    const bar=(v,max)=>Math.max(2,Math.min(100,(v/max)*100))+"%";
    const e=(id,w)=>{const x=document.getElementById(id);if(x)x.style.width=w;};
    e("bar_total",   bar(total, 10));
    e("bar_share",   bar(total/totalExports, 0.5));
    e("bar_permian", bar(permianOutlet, total));

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
