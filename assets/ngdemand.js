/* ngdemand.js — Consumption by end-use sector + seasonal cycle context. */
(function(){
  "use strict";

  const SEED = {
    meta:{vintage:"WK MAY 15 2026",status:"seed"},
    natural_gas:{
      meta:{vintage:"WK MAY 15 2026"},
      flows_bcfd:{
        production:105.0, imports:8.0,
        rescom:22.0, industrial:24.0, electric:37.0
      }
    }
  };
  // Other = lease fuel + pipeline + vehicle (small bucket, seeded since
  // EIA reports it as several sub-lines)
  const OTHER_FALLBACK = 9.0;

  const BAR_W = 380;
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

  // Decide which sector is structurally dominating right now from the vintage month.
  function seasonalNote(vintageStr){
    const m=vintageStr && String(vintageStr).match(/WK\s+([A-Z]+)/i);
    const MO=["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
    if(!m) return {label:"—", note:"—"};
    const mi = MO.indexOf(m[1].toUpperCase());
    if(mi<0) return {label:"—", note:"—"};
    if(mi <= 1 || mi === 11)      return {label:"WINTER HEATING PEAK", note:"Residential/commercial doubles. Storage withdrawing."};
    if(mi >= 6 && mi <= 8)        return {label:"SUMMER COOLING PEAK", note:"Electric-power burn peaks for AC load. Storage near max."};
    if(mi >= 2 && mi <= 4)        return {label:"SPRING SHOULDER", note:"Heating fades, injection begins. Lowest weather volatility."};
    if(mi >= 9 && mi <= 10)       return {label:"FALL SHOULDER", note:"Injection wrapping up. Pre-winter inventory check."};
    return {label:"—", note:"—"};
  }

  function render(d){
    const ng = d.natural_gas || SEED.natural_gas;
    const f = ng.flows_bcfd || {};
    const electric = f.electric    || 0;
    const indus    = f.industrial  || 0;
    const rescom   = f.rescom      || 0;
    const other    = (typeof f.other === "number") ? f.other : OTHER_FALLBACK;
    const total    = electric + indus + rescom + other;
    const supply   = (f.production || 0) + (f.imports || 0);

    const maxV = Math.max(electric, indus, rescom, other);
    const setBar=(id,v)=>{const b=document.getElementById(id);if(b)b.setAttribute("width",(v/maxV*BAR_W).toFixed(1));};
    setBar("pb_electric",   electric);
    setBar("pb_industrial", indus);
    setBar("pb_rescom",     rescom);
    setBar("pb_other",      other);

    set("p_electric",   electric.toFixed(1));
    set("p_industrial", indus.toFixed(1));
    set("p_rescom",     rescom.toFixed(1));
    set("p_other",      other.toFixed(1));
    set("v_sum",        total.toFixed(0));
    set("v_supply",     supply.toFixed(0));

    // Seasonal cycle panel
    const vintage = (ng.meta && ng.meta.vintage) || d.meta && d.meta.vintage;
    const cyc = seasonalNote(vintage);
    set("hd_cycle", cyc.label);
    set("hd_cycle_note", cyc.note);

    // Readouts
    const pct = v => (total > 0 ? (v/total*100).toFixed(0)+"%" : "—");
    set("r_electric",   electric.toFixed(1)+" bcf/d"); set("r_electric_pct",   pct(electric)+" of demand");
    set("r_industrial", indus.toFixed(1)+" bcf/d");    set("r_industrial_pct", pct(indus)+" of demand");
    set("r_rescom",     rescom.toFixed(1)+" bcf/d");   set("r_rescom_pct",     pct(rescom)+" · highly seasonal");
    set("r_total",      total.toFixed(1)+" bcf/d");

    const bar=(v,max)=>Math.max(2,Math.min(100,(v/max)*100))+"%";
    const e=(id,w)=>{const x=document.getElementById(id);if(x)x.style.width=w;};
    e("bar_electric",   bar(electric, total));
    e("bar_industrial", bar(indus, total));
    e("bar_rescom",     bar(rescom, total));
    e("bar_total",      bar(total, 120));

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
