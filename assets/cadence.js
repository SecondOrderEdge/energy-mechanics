/* cadence.js — shared helper: compute the next EIA WPSR release date
   from the current data vintage and render it into #nextrelease.

   EIA convention: each WPSR is labelled by the WEEK ENDING FRIDAY of the
   data window, and is published the following WEDNESDAY (Friday + 5d).
   The next report covers the following Friday + 5d  =  vintage + 12d.

   Loaded once per page; each page's main script calls
   window.EM_setNextRelease(meta.vintage) after data loads. */
(function(){
  "use strict";

  const MONTHS = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
  const DAYS   = ["SUN","MON","TUE","WED","THU","FRI","SAT"];

  // Parse "WK MAY 15 2026" -> Date (week-ending Friday)
  function parseVintage(s){
    if(!s) return null;
    const m = String(s).match(/WK\s+([A-Z]+)\s+(\d+)\s+(\d+)/i);
    if(!m) return null;
    const mi = MONTHS.indexOf(m[1].toUpperCase());
    if(mi<0) return null;
    const d = new Date(Date.UTC(+m[3], mi, +m[2]));
    return isNaN(d) ? null : d;
  }

  function fmt(d){
    return `${DAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  }

  window.EM_setNextRelease = function(vintageStr){
    const el = document.getElementById("nextrelease");
    if(!el) return;
    const v = parseVintage(vintageStr);
    if(!v){ el.textContent = "NEXT WPSR · —"; return; }
    // Next publication = vintage Friday + 12 days = following Wednesday
    const next = new Date(v); next.setUTCDate(next.getUTCDate()+12);
    // Days until (rounded, today as UTC date)
    const today = new Date();
    const todayUTC = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
    const diff = Math.round((next - todayUTC) / 86400000);
    let suffix;
    if(diff > 1)       suffix = ` (in ${diff}d)`;
    else if(diff === 1) suffix = " (tomorrow)";
    else if(diff === 0) suffix = " (today)";
    else                suffix = ` (${Math.abs(diff)}d overdue)`;
    el.textContent = `NEXT WPSR · ${fmt(next)}${suffix}`;
  };

  // Sibling navigation: detail pages within the same domain get cycled
  // prev/next links so users can flip between them without going back to
  // the overview. Groups are ordered by how they appear on the overview
  // schematic; nav cycles (prev from first → last, next from last → first).
  const SIBLINGS = {
    electricity: ["gas", "nuclear", "coal", "wind", "solar", "hydro"],
    natgas:      ["ngstorage", "nglng", "ngproduction", "ngmexico",
                  "ngdemand", "ngrigs", "ngpipelines", "ngimports"],
    petroleum:   ["production", "imports", "refinery", "exports",
                  "gasoline", "distillate", "jet", "commercial", "spr", "demand"],
  };
  const SIBLING_NAMES = {
    gas:"Gas", nuclear:"Nuclear", coal:"Coal", wind:"Wind", solar:"Solar", hydro:"Hydro",
    ngstorage:"Storage", nglng:"LNG", ngproduction:"Production", ngmexico:"Mexico",
    ngdemand:"Demand", ngrigs:"Rigs", ngpipelines:"Pipelines", ngimports:"Canada Imports",
    production:"Production", imports:"Imports", refinery:"Refinery", exports:"Exports",
    gasoline:"Gasoline", distillate:"Distillate", jet:"Jet & Other", commercial:"Commercial",
    spr:"SPR", demand:"Demand",
  };

  function injectSiblingNav(){
    const m = window.location.pathname.match(/\/([a-z]+)\.html$/);
    if(!m) return;
    const page = m[1];
    let group = null;
    for(const g in SIBLINGS){
      if(SIBLINGS[g].indexOf(page) !== -1){ group = SIBLINGS[g]; break; }
    }
    if(!group || group.length < 2) return;
    const topnav = document.querySelector(".topnav");
    if(!topnav) return;
    if(topnav.parentNode.querySelector(".siblingnav")) return;  // idempotent

    const i = group.indexOf(page);
    const prev = group[(i - 1 + group.length) % group.length];
    const next = group[(i + 1) % group.length];

    // Cache-bust suffix — match the rest of the site's link convention.
    // Read it off any existing __BUILD__-stamped href if present, else omit.
    let suffix = "";
    const anyHref = document.querySelector('a[href*="?v="]');
    if(anyHref){
      const qm = anyHref.getAttribute("href").match(/\?v=([^&"]+)/);
      if(qm) suffix = "?v=" + qm[1];
    }

    const row = document.createElement("div");
    row.className = "siblingnav";
    row.style.cssText =
      "display:flex;justify-content:space-between;align-items:center;"
      + "font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:0.12em;"
      + "text-transform:uppercase;color:var(--ink-dim);"
      + "padding:8px 0 0;margin-bottom:18px;border-bottom:1px solid var(--line);"
      + "padding-bottom:10px;";
    row.innerHTML =
      `<a href="${prev}.html${suffix}" style="color:var(--ink-dim);text-decoration:none;">`
      + `← ${SIBLING_NAMES[prev] || prev}</a>`
      + `<span style="color:var(--ink-dim);opacity:0.55;">${i+1} / ${group.length}</span>`
      + `<a href="${next}.html${suffix}" style="color:var(--ink-dim);text-decoration:none;">`
      + `${SIBLING_NAMES[next] || next} →</a>`;
    // Hover tint matches topnav .back behavior
    row.querySelectorAll("a").forEach(a => {
      a.addEventListener("mouseenter", () => a.style.color = "var(--openings)");
      a.addEventListener("mouseleave", () => a.style.color = "var(--ink-dim)");
    });
    topnav.parentNode.insertBefore(row, topnav.nextSibling);
  }

  // Auto-injected freshness badge in the topnav. Tells the viewer when the
  // bot last successfully wrote data.json — distinct from data vintage.
  // Runs after DOMContentLoaded so .topnav is in the DOM; fetches data.json
  // once (cached by HTTP/2 alongside the page's own fetch); silently exits
  // if there's no topnav or if data.json fails to load.
  function injectRefreshBadge(){
    const topnav = document.querySelector(".topnav");
    if(!topnav) return;
    // Don't insert twice if the page reloads cadence.js for any reason
    if(topnav.querySelector(".navfresh")) return;
    const badge = document.createElement("span");
    badge.className = "navfresh";
    badge.textContent = "REFRESHED · —";
    badge.style.cssText = "color:var(--ink-dim);font-family:'IBM Plex Mono',monospace;"
      + "font-size:9.5px;letter-spacing:0.12em;text-transform:uppercase;"
      + "margin-left:auto;padding:0 14px;";
    // Insert before .navmeta if present, else append.
    const navmeta = topnav.querySelector(".navmeta");
    if(navmeta) topnav.insertBefore(badge, navmeta);
    else        topnav.appendChild(badge);

    fetch("data.json", {cache:"no-store"})
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if(!d || !d.meta || !d.meta.generated_utc){ badge.textContent = "REFRESHED · —"; return; }
        const generated = new Date(d.meta.generated_utc);
        const now = new Date();
        const diffH = (now - generated) / 3.6e6;
        let ago;
        if(diffH < 1)        ago = "< 1H AGO";
        else if(diffH < 24)  ago = Math.round(diffH) + "H AGO";
        else if(diffH < 720) ago = Math.round(diffH/24) + "D AGO";
        else                 ago = "STALE · " + Math.round(diffH/168) + "W";
        badge.textContent = "REFRESHED · " + ago;
        // Tint orange/red if the dashboard is going stale.
        if(diffH > 168)      badge.style.color = "var(--layoff)";
        else if(diffH > 24)  badge.style.color = "var(--unemp)";
      })
      .catch(() => { /* leave em-dash; never breaks the page */ });
  }

  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", function(){
      injectSiblingNav();
      injectRefreshBadge();
    });
  } else {
    injectSiblingNav();
    injectRefreshBadge();
  }
})();
