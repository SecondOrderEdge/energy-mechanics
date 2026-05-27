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
})();
