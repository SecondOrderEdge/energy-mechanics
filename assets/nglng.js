/* nglng.js — LNG exports by terminal and destination region.
   Terminal-level monthly data isn't yet wired into update_data.py; values
   here are an allocation of the live d.natural_gas.flows_bcfd.lng_exports
   total against each terminal's nameplate capacity. Once EIA's
   liquefaction-capacity series is plumbed in, the per-terminal numbers go
   live and the fallback share path drops out. */
(function(){
  "use strict";

  const SEED = {
    meta:{vintage:"WK MAY 15 2026",status:"seed"},
    natural_gas:{
      meta:{vintage:"WK MAY 15 2026"},
      flows_bcfd:{ lng_exports:14.0, production:105.0 },
      history:{ lng_exports:[14.0,13.8,13.5,13.2] },
      ranges_5yr:{ lng_exports:{min:6,avg:10,max:13,n:5} }
    }
  };

  // Eight operating terminals, nameplate feed gas in bcf/d.
  // Sources: EIA Liquefaction Capacity Report + operator disclosures.
  const TERMINALS = [
    { key:"sabine",      name:"Sabine Pass",      cap:4.4, ramping:false },
    { key:"corpus",      name:"Corpus Christi",   cap:2.6, ramping:false },
    { key:"cameron",     name:"Cameron",          cap:2.1, ramping:false },
    { key:"freeport",    name:"Freeport",         cap:2.1, ramping:false },
    { key:"calcasieu",   name:"Calcasieu Pass",   cap:1.4, ramping:false },
    { key:"plaquemines", name:"Plaquemines",      cap:3.4, ramping:true  },  // ramping to nameplate
    { key:"cove",        name:"Cove Point",       cap:0.8, ramping:false },
    { key:"elba",        name:"Elba Island",      cap:0.4, ramping:false },
  ];
  const NAMEPLATE_TOTAL = TERMINALS.reduce((a,t)=>a+t.cap,0);  // ~17.2 bcf/d

  // Destination region shares (rough recent monthly mix; seeded until
  // update_data.py pulls the per-country CIMS-equivalent for LNG).
  const DEST_SHARE = { europe:0.58, asia:0.32, other:0.10 };
  const DEST_BAR_W = 780;

  // SVG geometry — tank height range. Tanks are bottom-aligned at y=290,
  // height scales with nameplate (biggest = MAX_HEIGHT).
  const BASELINE = 290, MAX_HEIGHT = 220, TANK_TOP_MIN = 70;
  const maxCap = Math.max(...TERMINALS.map(t=>t.cap));

  const set=(id,t)=>{const e=document.getElementById(id);if(e)e.textContent=t;};

  function setNextNGW(vintageStr){
    const el = document.getElementById("nextrelease");
    if(!el) return;
    const m = vintageStr && String(vintageStr).match(/WK\s+([A-Z]+)\s+(\d+)\s+(\d+)/i);
    const MONTHS = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
    const DAYS   = ["SUN","MON","TUE","WED","THU","FRI","SAT"];
    if(!m){ el.textContent = "NEXT NGW · —"; return; }
    const mi = MONTHS.indexOf(m[1].toUpperCase());
    if(mi<0){ el.textContent = "NEXT NGW · —"; return; }
    const v = new Date(Date.UTC(+m[3], mi, +m[2]));
    const next = new Date(v); next.setUTCDate(next.getUTCDate()+13);
    const today = new Date();
    const todayUTC = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
    const diff = Math.round((next - todayUTC) / 86400000);
    let suffix;
    if(diff > 1)        suffix = " (in "+diff+"d)";
    else if(diff === 1) suffix = " (tomorrow)";
    else if(diff === 0) suffix = " (today)";
    else                suffix = " ("+Math.abs(diff)+"d overdue)";
    el.textContent = "NEXT NGW · "+DAYS[next.getUTCDay()]+" "+MONTHS[next.getUTCMonth()]+" "+next.getUTCDate()+suffix;
  }

  // Allocate the live national LNG export total to each terminal.
  // Approach: utilization-weighted — assume mature terminals run near 90%
  // and Plaquemines (ramping) at a lower rate; remaining demand for feed
  // gas is solved so the eight terminals sum to the live total.
  function allocateTerminals(totalLNG){
    const matureUtil = 0.92;
    const rampUtil   = 0.50;   // Plaquemines partial-train startup
    const expected = TERMINALS.reduce((a,t)=>a + t.cap*(t.ramping?rampUtil:matureUtil), 0);
    // Scale so the allocation lands on the live national total.
    const scale = totalLNG / expected;
    return TERMINALS.map(t=>{
      const util = (t.ramping ? rampUtil : matureUtil) * scale;
      const feed = Math.max(0, Math.min(t.cap, t.cap * util));
      return { ...t, feed, util: feed / t.cap };
    });
  }

  function render(d){
    const ng = d.natural_gas || SEED.natural_gas;
    const f  = ng.flows_bcfd || {};
    const totalLNG = (typeof f.lng_exports === "number") ? f.lng_exports : 14.0;
    const production = (typeof f.production === "number") ? f.production : 105.0;

    set("hd_total", totalLNG.toFixed(1)+" bcf/d");

    // Allocate to terminals
    const alloc = allocateTerminals(totalLNG);
    let summed = 0;
    alloc.forEach(t=>{
      summed += t.feed;
      const tankH = MAX_HEIGHT * (t.cap / maxCap);
      const fillH = tankH * Math.min(1, t.util);
      const tankY = BASELINE - tankH;
      const fillY = BASELINE - fillH;
      const cap = document.getElementById("cap_"+t.key);
      const fl  = document.getElementById("fill_"+t.key);
      const ln  = document.getElementById("line_"+t.key);
      if(cap){ cap.setAttribute("y",tankY); cap.setAttribute("height",tankH); }
      if(fl) { fl.setAttribute("y",fillY); fl.setAttribute("height",fillH); }
      if(ln) { ln.setAttribute("y1",fillY); ln.setAttribute("y2",fillY); }
      set("v_"+t.key, t.feed.toFixed(1));
      set("u_"+t.key, (t.util*100).toFixed(0)+"%");
    });
    set("v_sum", summed.toFixed(1));

    // Destination breakdown bars (sized against Europe share which is largest)
    const europe = totalLNG * DEST_SHARE.europe;
    const asia   = totalLNG * DEST_SHARE.asia;
    const other  = totalLNG * DEST_SHARE.other;
    const dmax   = Math.max(europe, asia, other);
    const setBar=(id,v)=>{const b=document.getElementById(id);if(b)b.setAttribute("width",(v/dmax*DEST_BAR_W).toFixed(1));};
    setBar("bar_europe", europe);
    setBar("bar_asia",   asia);
    setBar("bar_other",  other);
    set("v_europe", europe.toFixed(1)+" bcf/d");
    set("v_asia",   asia.toFixed(1)+" bcf/d");
    set("v_other",  other.toFixed(1)+" bcf/d");

    // Readouts
    set("r_total",  totalLNG.toFixed(1)+" bcf/d");
    set("r_share",  (totalLNG/production*100).toFixed(0)+"%");
    set("r_europe", europe.toFixed(1)+" bcf/d");
    set("r_europe_pct", (DEST_SHARE.europe*100).toFixed(0)+"% of cargoes");
    set("r_util",   (totalLNG/NAMEPLATE_TOTAL*100).toFixed(0)+"%");

    const bar=(v,max)=>Math.max(2,Math.min(100,(v/max)*100))+"%";
    const e=(id,w)=>{const x=document.getElementById(id);if(x)x.style.width=w;};
    e("bar_share",     bar(totalLNG/production, 0.20));
    e("bar_europe_ro", bar(DEST_SHARE.europe, 1));
    e("bar_util",      bar(totalLNG/NAMEPLATE_TOTAL, 1));

    if(window.EM_sparkline){
      EM_sparkline("spark_total", (ng.history||{}).lng_exports, EM_color("--layoff"));
      EM_rangeBadge("range_total", totalLNG, (ng.ranges_5yr||{}).lng_exports, "bcf/d");
    }

    const vintage = (ng.meta && ng.meta.vintage) || d.meta && d.meta.vintage;
    set("datestamp","VINTAGE · "+(vintage||"—"));
    setNextNGW(vintage);

    const st = document.getElementById("status");
    if(st){
      if((d.meta && d.meta.status==="live") || (ng.meta && ng.meta.status==="live")){
        st.textContent = "LIVE ✓"; st.classList.add("live");
      } else {
        st.textContent = "CACHED"; st.classList.remove("live");
      }
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
