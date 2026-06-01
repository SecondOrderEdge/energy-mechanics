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
    document.addEventListener("DOMContentLoaded", injectRefreshBadge);
  } else {
    injectRefreshBadge();
  }
})();
