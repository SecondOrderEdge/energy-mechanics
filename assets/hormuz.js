/* hormuz.js — Hormuz Watch. Producer volumes, bypass pipelines, destinations.
   Mostly seeded from EIA Chokepoints + OPEC MOMR + open-source tanker tracking.
   WTI is read live from data.json (single shared field already maintained by
   update_data.py). */
(function(){
  "use strict";

  // Approximate crude + condensate exports through Hormuz, mmbpd. Mid-range
  // open-source estimates. Iran is sanctions-affected and the most uncertain.
  const PRODUCERS = {
    saudi:    6.4,   // Most of Saudi crude exits via Ras Tanura → Hormuz; some via Petroline → Yanbu
    iraq:     3.4,   // Basra Oil Terminal; KRG via Ceyhan idle
    iran:     1.4,   // Kharg Island; sanctions-capped, much to China
    uae:      2.8,   // Jebel Dhanna + Das Island; some via ADCOP → Fujairah
    kuwait:   2.0,   // Mina Al-Ahmadi; no detour
    qatar:    0.6,   // Crude only (plus ~110 mtpa LNG which is its own story)
    bahrain:  0.2    // Small, refinery-imports also use strait
  };

  // Bypass-pipeline NAMEPLATE capacities (utilization is typically lower).
  const BYPASS = {
    saudi:  5.0,   // East-West "Petroline" to Yanbu (Red Sea)
    uae:    1.5,   // Habshan-Fujairah (ADCOP) to Gulf of Oman
    iraq:   1.6    // Kirkuk-Ceyhan — idle since 2023
  };

  // Destination share of Hormuz-transited crude (approx).
  const DEST_SHARE = {
    asia:     0.72,
    europe:   0.15,
    americas: 0.04,
    other:    0.09
  };

  const set = (id,t) => { const e=document.getElementById(id); if(e) e.textContent=t; };

  function render(d){
    // Producer volumes
    Object.keys(PRODUCERS).forEach(k => set("v_"+k, PRODUCERS[k].toFixed(1)));

    const totalProducers = Object.values(PRODUCERS).reduce((a,b)=>a+b, 0);
    set("v_total_producers", totalProducers.toFixed(1)+" mmbpd");

    // Strait throughput = total producers minus bypass actually used. Saudi
    // typically utilizes ~3 of 5 mmbpd Petroline. UAE Habshan-Fujairah is
    // partial. Iraq-Turkey is idle. So observed Hormuz crude ≈ producers
    // total minus ~3-4 mmbpd that takes the bypass.
    const bypassUsed = 3.0 + 1.0 + 0.0;   // Saudi 3, UAE 1, Iraq idle
    const straitFlow = totalProducers - bypassUsed;
    set("v_strait", straitFlow.toFixed(1));

    // Bypass capacities (nameplate, what's POSSIBLE if maxed)
    set("v_bp_sa",  BYPASS.saudi.toFixed(1));
    set("v_bp_uae", BYPASS.uae.toFixed(1));
    set("v_bp_iq",  BYPASS.iraq.toFixed(1));

    // Destination split (of strait flow)
    set("v_asia",     (straitFlow * DEST_SHARE.asia    ).toFixed(1)+" mmbpd");
    set("v_europe",   (straitFlow * DEST_SHARE.europe  ).toFixed(1)+" mmbpd");
    set("v_americas", (straitFlow * DEST_SHARE.americas).toFixed(1)+" mmbpd");
    set("v_other",    (straitFlow * DEST_SHARE.other   ).toFixed(1)+" mmbpd");

    // Identity strip + readouts
    const bypassTotalNameplate = BYPASS.saudi + BYPASS.uae + BYPASS.iraq;
    const atRisk = totalProducers - bypassTotalNameplate;   // worst-case "no detour"

    set("v_atrisk",   atRisk.toFixed(1));
    set("v_bp_total", bypassTotalNameplate.toFixed(1));
    set("v_net_risk", atRisk.toFixed(1)+" mmbpd");

    set("hd_flow",   "~"+straitFlow.toFixed(0)+" mmbpd");
    set("hd_bypass", "~"+bypassTotalNameplate.toFixed(0)+" mmbpd");
    set("hd_atrisk", "~"+atRisk.toFixed(0)+" mmbpd");

    set("r_flow",   straitFlow.toFixed(1)+" mmbpd");
    set("r_bypass", bypassTotalNameplate.toFixed(1)+" mmbpd");
    set("r_atrisk", atRisk.toFixed(1)+" mmbpd");

    // Live WTI from petroleum data.json — single source already wired.
    if (d && d.meta && typeof d.meta.wti === "number") {
      set("r_wti", "$"+d.meta.wti.toFixed(2));
    } else {
      set("r_wti", "—");
    }

    const bar=(v,max)=>Math.max(2,Math.min(100,(v/max)*100))+"%";
    const e=(id,w)=>{const x=document.getElementById(id);if(x)x.style.width=w;};
    e("bar_flow",   bar(straitFlow, 25));
    e("bar_bypass", bar(bypassTotalNameplate, 10));
    e("bar_atrisk", bar(atRisk, 20));
    e("bar_wti",    bar(d && d.meta && d.meta.wti ? d.meta.wti : 80, 150));

    // As-of stamp from data.json generated_utc
    if (d && d.meta && d.meta.generated_utc) {
      const t = new Date(d.meta.generated_utc);
      const fmt = t.toISOString().replace("T"," ").slice(0,16);
      set("as_of", "AS OF " + fmt + " UTC");
    } else {
      set("as_of", "AS OF — · UTC");
    }

    // Status — editorial. Hardcoded ALERT for now; flip to NORMAL when the
    // situation cools. Tied to .live class for CSS styling consistency.
    const st = document.getElementById("status");
    if (st) {
      st.textContent = "ALERT";
      st.style.color = "var(--layoff)";
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

  // Pull data.json just for the WTI value and the generated_utc timestamp.
  // Page renders fully with seeded values if the fetch fails.
  fetch("data.json", {cache:"no-store"})
    .then(r => r.ok ? r.json() : null)
    .then(d => render(d || {}))
    .catch(() => render({}));
})();
