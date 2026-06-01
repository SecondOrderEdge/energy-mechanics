/* ngstorage.js — Working gas storage by EIA region.
   Reads natural_gas.stocks_bcf.regional (populated by update_data.py from
   NW2_EPG0_SWO_R31..R35_BCF) and falls back to a share-allocation of the
   Lower-48 total when regional values aren't yet present.

   Tank heights are scaled by each region's typical recent peak (a fixed
   constant per region — EIA doesn't publish a single "capacity" number).
   The dashed line on each tank is the same-week-of-year 5-yr average. */
(function(){
  "use strict";

  const SEED = {
    meta:{vintage:"WK MAY 15 2026",status:"seed"},
    natural_gas:{
      meta:{vintage:"WK MAY 15 2026"},
      stocks_bcf:{
        working_gas:2483,
        regional:{
          east:447, midwest:539, south_central:993, mountain:213, pacific:292
        }
      },
      history:{ working_gas:[2483,2400,2310,2220] },
      ranges_5yr:{ working_gas:{min:1850,avg:2200,max:2700,n:5} }
    }
  };

  // Per-region recent peak (bcf), used as a "tank height" proxy since EIA
  // doesn't publish a single capacity figure. Approximate recent 5-yr high.
  const REGION_PEAK = {
    east:          1000,
    midwest:       1180,
    mountain:       240,
    pacific:        360,
    south_central: 1180,
  };
  // Per-region share of Lower-48 working gas (fallback when regional values
  // aren't returned by update_data.py).
  const REGION_SHARE = {
    east:0.235, midwest:0.295, mountain:0.085, pacific:0.115, south_central:0.270,
  };
  // Per-region same-week 5-yr avg (rough; live values will come from update_data.py later)
  const REGION_AVG = {
    east:560, midwest:720, mountain:185, pacific:295, south_central:640,
  };

  const REGIONS = ["east","midwest","mountain","pacific","south_central"];
  const BASELINE = 380, MAX_HEIGHT = 320;

  const set=(id,t)=>{const e=document.getElementById(id);if(e)e.textContent=t;};

  // EIA NGW publishes Thursday 10:30 ET, ~6 days after the week-ending Friday
  // → next release = vintage Friday + 13 days. Inline copy of naturalgas.js logic.
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

  // Cycle phase from week-of-year. April–October = injection, Nov–March = withdrawal.
  function cyclePhase(vintageStr){
    const m = vintageStr && String(vintageStr).match(/WK\s+([A-Z]+)\s+(\d+)\s+(\d+)/i);
    const MONTHS = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
    if(!m) return {phase:"—", pct:0, note:"—"};
    const mi = MONTHS.indexOf(m[1].toUpperCase());
    if(mi<0) return {phase:"—", pct:0, note:"—"};
    const day = +m[2];
    // April (month 3, 0-indexed) through October (month 9) = injection season
    const inSeason = (mi >= 3 && mi <= 9);
    const phase = inSeason ? "INJECT" : "WITHDRAW";
    // Position within the season — rough day-of-season as a percentage
    let dayOfSeason, seasonDays;
    if(inSeason){
      // April 1 = day 0 of injection season (~214 days through Oct 31)
      dayOfSeason = (mi - 3) * 30 + day;
      seasonDays  = 214;
    } else {
      // Nov 1 = day 0 of withdrawal season (~151 days through Mar 31)
      const winterMonth = (mi >= 10) ? (mi - 10) : (mi + 2);
      dayOfSeason = winterMonth * 30 + day;
      seasonDays  = 151;
    }
    const pct = Math.max(0, Math.min(100, (dayOfSeason / seasonDays) * 100));
    return { phase, pct, note: pct.toFixed(0) + "% through "+phase.toLowerCase()+" season" };
  }

  function render(d){
    const ng = d.natural_gas || SEED.natural_gas;
    const stk = (ng.stocks_bcf || {});
    const total = stk.working_gas || 0;
    const regional = stk.regional || {};
    const r5y = ng.ranges_5yr || {};

    set("hd_total", Math.round(total).toLocaleString()+" bcf");

    let summed = 0;
    const maxPeak = Math.max(...Object.values(REGION_PEAK));

    REGIONS.forEach(k=>{
      const v   = (typeof regional[k] === "number") ? regional[k] : total * REGION_SHARE[k];
      summed += v;
      const peak = REGION_PEAK[k];
      const tankH = MAX_HEIGHT * (peak / maxPeak);
      const fillH = tankH * Math.min(1, v/peak);
      const tankY = BASELINE - tankH;
      const fillY = BASELINE - fillH;
      // Same-week 5-yr avg line for this region — seeded for now
      const avg = REGION_AVG[k];
      const avgH = tankH * Math.min(1, avg/peak);
      const avgY = BASELINE - avgH;

      const cap = document.getElementById("cap_"+k);
      const fl  = document.getElementById("fill_"+k);
      const ln  = document.getElementById("line_"+k);
      const av  = document.getElementById("avg_"+k);
      if(cap){cap.setAttribute("y",tankY); cap.setAttribute("height",tankH);}
      if(fl) {fl.setAttribute("y",fillY); fl.setAttribute("height",fillH);}
      if(ln) {ln.setAttribute("y1",fillY); ln.setAttribute("y2",fillY);}
      if(av) {av.setAttribute("y1",avgY); av.setAttribute("y2",avgY);}

      set("v_"+k, Math.round(v).toLocaleString());
      // Delta vs 5-yr avg per region
      if(k !== "south_central"){
        const dlt = Math.round(v - avg);
        set("d_"+k, (dlt >= 0 ? "+" : "") + dlt + " vs 5yr");
      }
    });

    set("v_sum", Math.round(summed).toLocaleString());

    // Readouts
    set("r_total", Math.round(total).toLocaleString()+" bcf");
    const r5yWG = r5y.working_gas;
    if(r5yWG && typeof r5yWG.avg === "number"){
      const dlt = Math.round(total - r5yWG.avg);
      set("r_delta", (dlt >= 0 ? "+" : "") + dlt + " bcf vs 5-yr avg");
    } else { set("r_delta", "—"); }

    // Find largest region (live regional if present, else share-derived)
    const sizes = REGIONS.map(k => ({
      k,
      v: (typeof regional[k] === "number") ? regional[k] : total*REGION_SHARE[k],
    })).sort((a,b)=>b.v-a.v);
    const top = sizes[0];
    set("r_largest", Math.round(top.v).toLocaleString()+" bcf");
    const NAMES = {east:"East",midwest:"Midwest",mountain:"Mountain",pacific:"Pacific",south_central:"South-Central"};
    set("r_largest_name", NAMES[top.k]);

    // Days of supply at ~100 bcf/d Lower-48 demand
    const days = total / 100;
    set("r_days", days.toFixed(1)+" days");

    // Cycle phase
    const vintage = (ng.meta && ng.meta.vintage) || d.meta && d.meta.vintage;
    const phase = cyclePhase(vintage);
    set("r_phase", phase.phase);
    set("r_phase_note", phase.note);

    const bar=(v,max)=>Math.max(2,Math.min(100,(v/max)*100))+"%";
    const e=(id,w)=>{const x=document.getElementById(id);if(x)x.style.width=w;};
    e("bar_largest", bar(top.v, REGION_PEAK[top.k] || 1200));
    e("bar_days",    bar(days, 40));
    e("bar_phase",   bar(phase.pct, 100));

    // Sparkline + range badge on total
    if(window.EM_sparkline){
      EM_sparkline("spark_total", (ng.history||{}).working_gas, EM_color("--reserve"));
      EM_rangeBadge("range_total", total, r5yWG, "bcf");
    }

    set("datestamp","VINTAGE · "+(vintage||"—"));
    setNextNGW(vintage);

    const st = document.getElementById("status");
    if(st){
      if((d.meta && d.meta.status==="live") || (ng.meta && ng.meta.status==="live")){
        st.textContent="LIVE ✓"; st.classList.add("live");
      } else {
        st.textContent="CACHED"; st.classList.remove("live");
      }
    }

    wireHover();
  }

  function wireHover(){
    const frame = document.getElementById("frame");
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
