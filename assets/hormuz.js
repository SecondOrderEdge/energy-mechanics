/* hormuz.js — Hormuz Watch.
   Lots of seeded data here: vessel transits, war-risk premiums, VLCC rates,
   per-country dependency, vessel-seizure events, crisis timeline. Brent + WTI
   are the only live values (pulled from data.json which update_data.py
   maintains). Update the EVENT_START constant or any seeded list below to
   refresh the page; no rebuild needed beyond a deploy. */
(function(){
  "use strict";

  // ───── editable constants ─────
  const EVENT_START = new Date("2025-06-12T00:00:00Z");   // Israel-Iran direct-strike date
  const STATUS = "ALERT";   // "OPEN" | "ALERT" | "RESTRICTED" | "CLOSED"

  // ───── flow data (producer mmbpd, bypass capacities, destination shares) ─────
  const PRODUCERS = {
    saudi:6.4, iraq:3.4, iran:1.4, uae:2.8, kuwait:2.0, qatar:0.6, bahrain:0.2
  };
  const BYPASS = { saudi:5.0, uae:1.5, iraq:1.6 };
  const DEST_SHARE = { asia:0.72, europe:0.15, americas:0.04, other:0.09 };

  // ───── stat-card current values (open-source approximations) ─────
  const STATS = {
    transits_now: 48,        // ~80% of normal 60/day baseline
    waiting:      26,
    waiting_mix:  { tankers: 14, bulk: 5, other: 7 },
    war_label:    "ELEVATED",
    war_pct:      0.32,      // 0.32% hull war premium
    war_mult:     "~2.1× normal",
    vlcc_ws:      88,        // Worldscale points · current
    vlcc_chg:     "+60% vs pre-escalation",
    dwt:          "8.2M",
    dwt_pct:      "~80% of normal",
  };

  // ───── per-country dependency on Hormuz crude (Global Trade Impact) ─────
  const COUNTRY_DEP = [
    { name:"Japan",          sev:"crit", pct:90 },
    { name:"South Korea",    sev:"crit", pct:80 },
    { name:"India",          sev:"high", pct:60 },
    { name:"China",          sev:"high", pct:40 },
    { name:"European Union", sev:"mod",  pct:20 },
    { name:"UAE",            sev:"high", pct:90 }
  ];

  // ───── regional impact heatmap cards ─────
  const REGIONAL = [
    { nm:"Japan",        sev:"crit", pct:90,
      desc:"Critically dependent on Hormuz crude. ~85% of crude imports and majority of LNG transit the strait. Sustained closure forces drawdown of national petroleum reserves." },
    { nm:"South Korea",  sev:"crit", pct:80,
      desc:"High dependency on Gulf crude and Qatari LNG. Manufacturing export chain vulnerable to sustained energy-cost increases." },
    { nm:"Iraq",         sev:"crit", pct:95,
      desc:"No usable bypass — Kirkuk-Ceyhan pipeline idle since 2023 arbitration ruling. Basra terminal handles ~95% of exports, all through Hormuz." },
    { nm:"China",        sev:"high", pct:40,
      desc:"~40% of crude imports via Hormuz; balanced by Russian ESPO, Central Asian pipeline supply, and West African seaborne. Most diversified Asian buyer." },
    { nm:"India",        sev:"high", pct:60,
      desc:"Indian Navy historically escorts tankers through Gulf of Oman during elevated risk. Russian Urals discount provides partial substitution." },
    { nm:"UAE",          sev:"high", pct:90,
      desc:"Hosts both Hormuz exit terminals AND the Habshan-Fujairah bypass; politically positioned but operationally dependent on the strait being open." },
    { nm:"European Union", sev:"mod", pct:20,
      desc:"Lower direct Hormuz exposure — Russia phase-out shifted EU toward US, North Sea, West African crude. Price transmission still meaningful." },
    { nm:"Saudi Arabia", sev:"mod", pct:90,
      desc:"Hormuz-exposed for ~90% of exports BUT operates the 5 mmbpd East-West (Petroline) pipeline to Yanbu on the Red Sea — best-positioned Gulf exporter." }
  ];

  // ───── vessel seizures (real recent events) ─────
  // side: "iran" = seized by Iran/IRGC; "usuk" = seized by US/UK/coalition
  const SEIZURES = [
    { date:"Apr 15, 2024", side:"iran", actor:"Iran (IRGC)", vessel:"MSC Aries",
      flag:"Portugal", desc:"Container vessel seized near strait by IRGC helicopter rappel team. Crew of 25 detained then mostly released.", status:"released" },
    { date:"Jan 11, 2024", side:"iran", actor:"Iran",       vessel:"St. Nikolas",
      flag:"Marshall Islands", desc:"Crude tanker (former Suez Rajan) seized by Iranian forces in Gulf of Oman. Same vessel previously held US-confiscated Iranian oil.", status:"released" },
    { date:"Apr 27, 2023", side:"iran", actor:"Iran",       vessel:"Advantage Sweet",
      flag:"Marshall Islands", desc:"Tanker chartered by Chevron seized by IRGC Navy in Gulf of Oman.", status:"released" },
    { date:"May 3, 2023",  side:"iran", actor:"Iran (IRGC)", vessel:"Niovi",
      flag:"Panama", desc:"Crude tanker seized in Strait of Hormuz, Iranian officials cited damage to Iranian vessel as pretext.", status:"released" },
    { date:"Jul 19, 2019", side:"iran", actor:"Iran (IRGC)", vessel:"Stena Impero",
      flag:"United Kingdom", desc:"British-flagged tanker seized in Strait of Hormuz; held two months in retaliation for UK seizure of Grace 1 at Gibraltar.", status:"released" },
    { date:"Apr 30, 2023", side:"usuk", actor:"United States", vessel:"Suez Rajan",
      flag:"Marshall Islands", desc:"US Justice Department forfeiture action — vessel carrying ~1 mb of Iranian crude in transit was directed to Houston for offload.", status:"released" },
    { date:"Jul 4, 2019",  side:"usuk", actor:"UK / Gibraltar", vessel:"Grace 1 (Adrian Darya 1)",
      flag:"Panama", desc:"Iranian-controlled supertanker boarded by Royal Marines off Gibraltar on suspicion of EU sanctions violation. Released six weeks later.", status:"released" },
    { date:"2023-2024",   side:"usuk", actor:"United States",  vessel:"Multiple cargoes",
      flag:"Various", desc:"DOJ civil forfeiture actions against Iranian crude shipments destined for China; cargoes redirected and sold, proceeds to compensation fund.", status:"resolved" },
    { date:"Aug 12, 2024", side:"iran", actor:"Iran",       vessel:"Various smaller incidents",
      flag:"Various", desc:"Several smaller tanker harassments and brief boardings reported through 2024; most vessels released within hours.", status:"released" }
  ];

  // ───── crisis timeline ─────
  // type: "esc"=escalation · "dip"=diplomatic · "mil"=military · "inc"=incident
  const TIMELINE = [
    { date:"JUN 13, 2025", type:"esc",
      head:"Israel launches direct strikes on Iranian targets",
      desc:"Major Israeli air campaign against Iranian nuclear infrastructure, military bases, and IRGC leadership. Marks the start of the current direct-conflict cycle the duration counter tracks." },
    { date:"JUN 23, 2025", type:"mil",
      head:"US strikes Iranian nuclear sites",
      desc:"US conducts strikes on Fordow, Natanz, and Isfahan facilities. Iran responds with missile attack on Al Udeid air base in Qatar; advance warning prevents casualties." },
    { date:"JUN 24, 2025", type:"dip",
      head:"Ceasefire announced between Israel and Iran",
      desc:"Trump-brokered ceasefire holds despite early violations. Hormuz transit continues with elevated war-risk insurance and route caution." },
    { date:"2025 H2",       type:"inc",
      head:"Tanker harassment incidents in Gulf of Oman",
      desc:"Multiple brief tanker boardings and harassment incidents reported through second half of 2025. Most vessels released within 24-72 hours." },
    { date:"APR 2024",      type:"inc",
      head:"Iran seizes MSC Aries near strait",
      desc:"IRGC commandos rappel onto Portuguese-flagged container ship via helicopter; vessel and crew detained at Bandar Abbas. Israeli ownership cited as pretext." },
    { date:"JAN 2024",      type:"inc",
      head:"Houthi attacks shut down Red Sea route",
      desc:"Bab el-Mandeb tanker traffic falls ~70% as most operators reroute around Cape of Good Hope, adding 10-14 days transit per voyage. Indirectly raises Hormuz importance for Asian flows." },
    { date:"2023",          type:"dip",
      head:"Iraq-Turkey Kirkuk-Ceyhan pipeline shuts down",
      desc:"Arbitration ruling against Turkey halts ~1.6 mmbpd nameplate northern export route. Removes one of three Hormuz bypass options indefinitely." },
    { date:"JUN 2019",      type:"inc",
      head:"Tanker attacks in Gulf of Oman; US drone downed",
      desc:"Limpet-mine attacks on two tankers in Gulf of Oman; US attributes to IRGC. Iran shoots down US RQ-4 Global Hawk drone over Strait of Hormuz. Brent jumps ~$5/bbl." },
    { date:"2015",          type:"dip",
      head:"JCPOA nuclear agreement signed",
      desc:"Iran-P5+1 deal lifts most economic sanctions in exchange for nuclear program constraints. Iranian oil exports rebound to ~2.5 mmbpd before 2018 US withdrawal." },
    { date:"1984–88",       type:"mil",
      head:"Tanker War during Iran-Iraq conflict",
      desc:"451 commercial ships attacked, 259 disabled or sunk. Strait of Hormuz remained operationally open throughout — US Navy reflagged Kuwaiti tankers under Operation Earnest Will." },
    { date:"1979",          type:"esc",
      head:"Iranian Revolution",
      desc:"Iran-US relations rupture. Oil exports halt during transition. Strait remains open but operational risk premiums emerge as a permanent feature of Gulf shipping." }
  ];

  const set = (id,t) => { const e=document.getElementById(id); if(e) e.textContent=t; };

  // ───── duration counter (ticks every minute) ─────
  function pad(n){ return String(n).padStart(2,"0"); }
  function tickDuration(){
    const now = new Date();
    const diff = now - EVENT_START;
    if (diff <= 0) {
      set("dur_days", "0"); set("dur_hours", "00"); set("dur_min", "00");
      return;
    }
    const days  = Math.floor(diff / 86_400_000);
    const hours = Math.floor((diff % 86_400_000) / 3_600_000);
    const mins  = Math.floor((diff % 3_600_000)  / 60_000);
    set("dur_days", String(days));
    set("dur_hours", pad(hours));
    set("dur_min",   pad(mins));
  }

  function renderStatus(){
    set("status_big", STATUS);
    set("status_inline", STATUS);
    // Status badge color is set in CSS via .hz-status .big (always layoff). If
    // status flips to "OPEN" we recolor green here.
    const big = document.getElementById("status_big");
    if (big && STATUS === "OPEN")        big.style.color = "var(--emp)";
    else if (big && STATUS === "ALERT")  big.style.color = "var(--unemp)";
    else if (big)                        big.style.color = "var(--layoff)";
  }

  function renderStats(){
    set("s_transits",      STATS.transits_now);
    set("s_transits_norm", "~60/day");
    set("s_transits_pct",  Math.round(STATS.transits_now / 60 * 100) + "%");

    set("s_waiting",       STATS.waiting);
    const mx = STATS.waiting_mix;
    set("s_waiting_mix",   `Tankers ${mx.tankers} · Bulk ${mx.bulk} · Other ${mx.other}`);

    set("s_war_label",     STATS.war_label);
    set("s_war_pct",       STATS.war_pct.toFixed(2) + "%");
    set("s_war_mult",      STATS.war_mult);

    set("s_vlcc",          STATS.vlcc_ws + " WS");
    set("s_vlcc_chg",      STATS.vlcc_chg);

    set("s_dwt",           STATS.dwt + " DWT");
    set("s_dwt_pct",       STATS.dwt_pct);
  }

  function renderCountryDep(){
    const el = document.getElementById("ti_dep_list");
    if (!el) return;
    el.innerHTML = COUNTRY_DEP.map(c =>
      `<div class="hz-dep-row">
         <span class="country">
           <span class="hz-sev ${c.sev}">${c.sev==="crit"?"Critical":c.sev==="high"?"High":"Moderate"}</span>
           <span class="name">${c.name}</span>
         </span>
         <span class="pct">${c.pct}% dep.</span>
       </div>`
    ).join("");
  }

  function renderRegional(){
    const el = document.getElementById("hz_regional");
    if (!el) return;
    el.innerHTML = REGIONAL.map(r =>
      `<div class="hz-rcard ${r.sev}">
         <div class="top">
           <div>
             <div class="nm">${r.nm}</div>
             <span class="hz-sev ${r.sev}">${r.sev==="crit"?"Critical":r.sev==="high"?"High":"Moderate"}</span>
           </div>
           <div class="pct">${r.pct}%</div>
         </div>
         <div class="desc">${r.desc}</div>
       </div>`
    ).join("");
  }

  function renderSeizures(){
    const iran = SEIZURES.filter(s => s.side==="iran").length;
    const usuk = SEIZURES.filter(s => s.side==="usuk").length;
    const held = SEIZURES.filter(s => s.status==="held").length;
    set("sz_iran_total", iran);
    set("sz_usuk_total", usuk);
    set("sz_held",       held);

    // Split bar widths
    const total = iran + usuk;
    const bar = document.getElementById("sz_bar");
    if (bar) {
      bar.innerHTML =
        `<div class="iran" style="width:${(iran/total*100).toFixed(1)}%;"></div>
         <div class="usuk" style="width:${(usuk/total*100).toFixed(1)}%;"></div>`;
    }

    // Events — iran left col, usuk right col, central dot
    const el = document.getElementById("sz_events");
    if (!el) return;
    el.innerHTML = SEIZURES.map(s => {
      const card = `
        <div class="date">${s.date} <span class="actor ${s.side}">${s.actor}</span></div>
        <div class="vessel">${s.vessel}<span class="flag">(${s.flag})</span></div>
        <div class="desc">${s.desc}</div>
        <div class="status ${s.status==="released"||s.status==="resolved"?"released":""}">${s.status==="held"?"Currently held":s.status==="resolved"?"Resolved":"Released"}</div>`;
      if (s.side === "iran") {
        return `<div class="hz-seizure">
                  <div class="col-iran">${card}</div>
                  <div class="center"><span class="dot iran"></span></div>
                  <div class="col-usuk"></div>
                </div>`;
      } else {
        return `<div class="hz-seizure">
                  <div class="col-iran"></div>
                  <div class="center"><span class="dot usuk"></span></div>
                  <div class="col-usuk">${card}</div>
                </div>`;
      }
    }).join("");
  }

  function renderTimeline(){
    const el = document.getElementById("hz_timeline");
    if (!el) return;
    const typeName = { esc:"Escalation", dip:"Diplomatic", mil:"Military", inc:"Incident" };
    el.innerHTML = TIMELINE.map(e =>
      `<div class="hz-cevent">
         <div class="col-date">
           <div class="d">${e.date}</div>
           <span class="hz-etype ${e.type}">${typeName[e.type]}</span>
         </div>
         <div class="col-body">
           <div class="h">${e.head}</div>
           <div class="desc">${e.desc}</div>
         </div>
       </div>`
    ).join("");
  }

  function renderSchematic(){
    // Producer volumes
    Object.keys(PRODUCERS).forEach(k => set("v_"+k, PRODUCERS[k].toFixed(1)));
    const totalProducers = Object.values(PRODUCERS).reduce((a,b)=>a+b, 0);
    set("v_total_producers", totalProducers.toFixed(1)+" mmbpd");

    // Strait throughput = total minus bypass actually used
    const bypassUsed = 3.0 + 1.0 + 0.0;
    const straitFlow = totalProducers - bypassUsed;
    set("v_strait", straitFlow.toFixed(1));

    set("v_bp_sa",  BYPASS.saudi.toFixed(1));
    set("v_bp_uae", BYPASS.uae.toFixed(1));
    set("v_bp_iq",  BYPASS.iraq.toFixed(1));

    set("v_asia",     (straitFlow * DEST_SHARE.asia    ).toFixed(1)+" mmbpd");
    set("v_europe",   (straitFlow * DEST_SHARE.europe  ).toFixed(1)+" mmbpd");
    set("v_americas", (straitFlow * DEST_SHARE.americas).toFixed(1)+" mmbpd");
    set("v_other",    (straitFlow * DEST_SHARE.other   ).toFixed(1)+" mmbpd");

    const bypassTotal = BYPASS.saudi + BYPASS.uae + BYPASS.iraq;
    const atRisk = totalProducers - bypassTotal;

    set("v_atrisk",   atRisk.toFixed(1));
    set("v_bp_total", bypassTotal.toFixed(1));
    set("v_net_risk", atRisk.toFixed(1)+" mmbpd");

    set("hd_flow",   "~"+straitFlow.toFixed(0)+" mmbpd");
    set("hd_bypass", "~"+bypassTotal.toFixed(0)+" mmbpd");
    set("hd_atrisk", "~"+atRisk.toFixed(0)+" mmbpd");
  }

  function renderLiveFromData(d){
    // As-of stamp from data.json generated_utc
    if (d && d.meta && d.meta.generated_utc) {
      const t = new Date(d.meta.generated_utc);
      const fmt = t.toISOString().replace("T"," ").slice(0,16);
      set("as_of", fmt + " UTC");
    } else {
      set("as_of", "— UTC");
    }
  }

  function wireHover(){
    const frame=document.getElementById("frame");
    if (!frame) return;
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

  function init(){
    renderStatus();
    renderStats();
    renderCountryDep();
    renderRegional();
    renderSeizures();
    renderTimeline();
    renderSchematic();
    tickDuration();
    setInterval(tickDuration, 30_000);   // refresh duration every 30s
    wireHover();
  }

  init();

  fetch("data.json", {cache:"no-store"})
    .then(r => r.ok ? r.json() : null)
    .then(d => renderLiveFromData(d || {}))
    .catch(() => renderLiveFromData({}));
})();
