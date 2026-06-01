/* electricity.js — U.S. electricity grid: generation mix → grid → demand.
   Reads data.json's electricity block (peer to natural_gas / petroleum
   sections). Falls back to inline SEED for offline / cached load paths.

   Electricity is monthly-cadence data, not weekly — EIA Electric Power
   Monthly drops ~25th of each month for prior-prior-month values. */
(function(){
  "use strict";

  const SEED = {
    meta:{vintage:"WK MAY 15 2026",status:"seed"},
    electricity:{
      meta:{ vintage:"WK MAY 15 2026" },
      gen_twh:{
        gas:1812, nuclear:786, coal:715, wind:467,
        solar:309, hydro:261, biomass:46
      },
      demand_twh:{ residential:1508, commercial:1503, industrial:1043 },
      losses_twh:210,
      history:{ total:[4396,4360,4280,4220] },
      ranges_5yr:{ total:{min:4000,avg:4150,max:4300,n:5} }
    }
  };

  // Emission factors, g CO₂ per kWh of generation
  const CO2 = {
    gas:400, nuclear:0, coal:900, wind:0,
    solar:0, hydro:0, biomass:230  // biomass has lifecycle carbon
  };

  const SOURCES  = ["gas","nuclear","coal","wind","solar","hydro","biomass"];
  const CARBON_FREE = ["nuclear","wind","solar","hydro"];
  const PIPES = {
    gas:"p_gas", nuclear:"p_nuc", coal:"p_coal", wind:"p_wind",
    solar:"p_sol", hydro:"p_hyd", biomass:"p_bio",
    res:"p_res", com:"p_com", ind:"p_ind", loss:"p_loss"
  };
  const PIPE_WIDTH = 3.5;
  const MIX_BAR_W  = 1040;
  const MIX_BAR_X  = 40;

  const set=(id,t)=>{const e=document.getElementById(id);if(e)e.textContent=t;};

  // EIA Electric Power Monthly publishes ~25th of each month, covering data
  // two months prior. We don't have a weekly-style vintage; just show a
  // generic next-EPM stamp computed from today.
  function setNextEPM(){
    const el=document.getElementById("nextrelease"); if(!el) return;
    const today=new Date();
    // Next EPM = 25th of current month if not yet past, else 25th of next month
    const y=today.getUTCFullYear(), m=today.getUTCMonth(), d=today.getUTCDate();
    let next;
    if(d < 25) next = new Date(Date.UTC(y, m, 25));
    else       next = new Date(Date.UTC(y, m+1, 25));
    const todayUTC=Date.UTC(y,m,d);
    const diff=Math.round((next-todayUTC)/86400000);
    const MO=["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
    let suf = diff>1?` (in ${diff}d)` : diff===1?" (tomorrow)" : diff===0?" (today)" : "";
    el.textContent="NEXT EPM · "+MO[next.getUTCMonth()]+" "+next.getUTCDate()+suf;
  }

  function render(d){
    const el = d.electricity || SEED.electricity;
    const gen = el.gen_twh || {};
    const dem = el.demand_twh || {};
    const losses = el.losses_twh || 0;

    const total = SOURCES.reduce((a,k)=>a+(gen[k]||0),0);
    set("hd_total", Math.round(total).toLocaleString()+" TWh/year");
    set("v_grid", Math.round(total).toLocaleString());

    // Per-source values + percentage labels on the schematic nodes
    SOURCES.forEach(k=>{
      const v = gen[k] || 0;
      set("v_"+k, Math.round(v).toLocaleString()+" TWh");
      set("p_"+k, (v/total*100).toFixed(0)+"% of mix");
    });

    // Demand & losses
    const res = dem.residential || 0;
    const com = dem.commercial || 0;
    const ind = dem.industrial || 0;
    set("v_res",  Math.round(res).toLocaleString());
    set("v_com",  Math.round(com).toLocaleString());
    set("v_ind",  Math.round(ind).toLocaleString());
    set("v_loss", Math.round(losses).toLocaleString());

    // Pipes (uniform width across schematic, matching petroleum/natgas)
    Object.keys(PIPES).forEach(k=>{
      const path=document.getElementById(PIPES[k]); if(!path) return;
      path.setAttribute("stroke-width", PIPE_WIDTH.toFixed(2));
      if(!path.hasAttribute("opacity")) path.setAttribute("opacity","0.45");
      const anim=path.cloneNode(false);
      anim.removeAttribute("id");
      anim.setAttribute("class","flow flow-dash");
      anim.setAttribute("opacity","1");
      path.parentNode.appendChild(anim);
    });

    // Carbon intensity (g CO₂ / kWh, weighted average)
    const carbonG = SOURCES.reduce((a,k)=>a + (gen[k]||0) * CO2[k], 0) / total;
    set("v_carbon", Math.round(carbonG));

    // Carbon-free share
    const cf = CARBON_FREE.reduce((a,k)=>a + (gen[k]||0), 0);
    set("v_cf", (cf/total*100).toFixed(0)+"%");

    // Stacked generation-mix bar (every source as a segment)
    let cursor = MIX_BAR_X;
    SOURCES.forEach(k=>{
      const w = (gen[k]||0) / total * MIX_BAR_W;
      const rect = document.getElementById("mix_"+k);
      if(rect){ rect.setAttribute("x", cursor.toFixed(1)); rect.setAttribute("width", w.toFixed(1)); }
      cursor += w;
      set("lp_"+k, ((gen[k]||0)/total*100).toFixed(0)+"%");
    });

    // Readouts
    set("r_total",  Math.round(total).toLocaleString()+" TWh");
    set("r_cf",     (cf/total*100).toFixed(0)+"%");
    const renew = (gen.wind||0) + (gen.solar||0);
    set("r_renew",  Math.round(renew).toLocaleString()+" TWh");
    set("r_renew_pct", (renew/total*100).toFixed(0)+"% of total");
    set("r_carbon", Math.round(carbonG)+" g CO₂/kWh");

    const bar=(v,max)=>Math.max(2,Math.min(100,(v/max)*100))+"%";
    const e=(id,w)=>{const x=document.getElementById(id);if(x)x.style.width=w;};
    e("bar_cf",     bar(cf/total, 1));
    e("bar_renew",  bar(renew/total, 0.40));
    e("bar_carbon", bar(carbonG, 600));      // 600 g/kWh as visual ceiling

    if(window.EM_sparkline){
      EM_sparkline("spark_total", (el.history||{}).total, EM_color("--ink"));
      EM_rangeBadge("range_total", total, (el.ranges_5yr||{}).total, "TWh");
    }

    // Vintage + next-release stamp
    const vintage = (el.meta && el.meta.vintage) || d.meta && d.meta.vintage;
    set("datestamp","VINTAGE · "+(vintage||"—"));
    setNextEPM();

    const st = document.getElementById("status");
    if(st){
      if((d.meta && d.meta.status==="live") || (el.meta && el.meta.status==="live")){
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
