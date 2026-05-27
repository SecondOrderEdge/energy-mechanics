/* charts.js — shared visualization helpers for readout cards.

   Loaded once per page; each page's main script calls:
     EM_sparkline(svgId, values, color)
     EM_rangeBadge(elId, current, range5yr, unit)

   Both no-op silently if the element or data is missing — pages that
   don't yet have history wired won't break. */
(function(){
  "use strict";

  // 4-week trailing sparkline. `values` is most-recent-first; we reverse
  // for left-to-right time. SVG viewBox is 0 0 100 24 (set in HTML).
  window.EM_sparkline = function(svgId, values, color){
    const svg = document.getElementById(svgId);
    if(!svg) return;
    if(!values || values.length < 2){ svg.innerHTML = ""; return; }
    const data = values.slice().reverse();
    const n = data.length;
    const min = Math.min.apply(null, data);
    const max = Math.max.apply(null, data);
    const span = (max - min) || 1;
    // 2px padding top/bottom inside 24px viewport
    const pts = data.map(function(v,i){
      const x = (i/(n-1))*100;
      const y = 22 - ((v - min)/span)*20;
      return [x, y];
    });
    const dPath = pts.map(function(p,i){return (i===0?"M":"L")+p[0].toFixed(1)+","+p[1].toFixed(1);}).join(" ");
    const last = pts[pts.length-1];
    svg.innerHTML =
      '<path class="spark-line" d="'+dPath+'" stroke="'+color+'"/>' +
      '<circle cx="'+last[0].toFixed(1)+'" cy="'+last[1].toFixed(1)+'" r="2.2" fill="'+color+'"/>';
  };

  // "vs 5-yr range" status line. EIA convention: same week-of-year, prior 5 years.
  window.EM_rangeBadge = function(id, current, range, unit){
    const el = document.getElementById(id);
    if(!el) return;
    if(!range || range.min == null){ el.textContent = "—"; el.className = "range"; return; }
    const min = range.min, max = range.max;
    let cls, label;
    if(current < min)      { cls = "below";  label = "below 5-yr range"; }
    else if(current > max) { cls = "above";  label = "above 5-yr range"; }
    else                   { cls = "within"; label = "within 5-yr range"; }
    const glyph = cls === "below" ? "▼" : cls === "above" ? "▲" : "◆";
    const fmt = function(n){ return (Math.abs(n) >= 100 ? Math.round(n) : n.toFixed(1)); };
    el.textContent = glyph+" "+label+" · "+fmt(min)+"–"+fmt(max)+" "+unit;
    el.className = "range " + cls;
  };

  // Convenience: resolve a CSS custom property to its current value as a string.
  window.EM_color = function(name){
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  };
})();
