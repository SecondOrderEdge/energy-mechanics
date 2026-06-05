/* petroleum.js — Energy Mechanics · U.S. petroleum balance plumbing
   Pipe width ∝ flow (mb/d); tank fill ∝ inventory level. Reads data.json. */
(function(){
  "use strict";

  const SEED = {
    meta:{vintage:"WK MAY 1 2026",status:"seed",wti:105.38},
    flows_mbd:{production:13.4,crude_imports:5.5,refinery_inputs:16.0,crude_exports:4.1,
               gasoline_prod:9.6,distillate_prod:4.9,jet_other_prod:4.6,
               product_supplied:20.3,product_exports:6.6},
    stocks_mb:{commercial_crude:461.6,spr:397.9,gasoline:229.0,distillate:105.0},
    context:{refinery_utilization:90.1,spr_released_since_march:17.5,spr_capacity:714,crude_vs_5yr_pct:0.1},
    history:{
      crude_supply:    [18.9,19.3,19.2,18.9],
      refinery_inputs: [16.0,15.8,15.6,15.3],
      product_supplied:[20.3,20.1,19.9,19.6],
      spr:             [397.9,399.1,401.7,404.5]
    },
    ranges_5yr:{
      crude_supply:    {min:17.4,avg:18.6,max:19.6},
      refinery_inputs: {min:14.9,avg:15.7,max:16.6},
      product_supplied:{min:18.5,avg:19.7,max:20.8},
      spr:             {min:350,avg:525,max:645}
    }
  };

  const set=(id,t)=>{const e=document.getElementById(id);if(e)e.textContent=t;};
  const mbd=v=>v.toFixed(1)+" mb/d";
  const mb =v=>Math.round(v)+" mb";

  // Uniform pipe width across the schematic. Color identifies each product;
  // the headline numbers carry the magnitudes.
  const PIPE_WIDTH = 3.5;
  const widthFor = _v => PIPE_WIDTH;

  const PIPES={
    production:"p_prod", crude_imports:"p_imp", crude_exports:"p_cex",
    gasoline_prod:"p_gas", distillate_prod:"p_dist", jet_other_prod:"p_jet"
  };

  function render(d){
    const f=d.flows_mbd, s=d.stocks_mb, c=d.context;
    const supply=f.production+f.crude_imports;

    // bare numbers — every flow node carries its own "mb/d" sub-label in HTML
    set("v_prod",f.production.toFixed(1));
    set("v_imp", f.crude_imports.toFixed(1));
    set("v_supply",supply.toFixed(1));
    set("v_ref", f.refinery_inputs.toFixed(1));
    set("v_util",(c.refinery_utilization).toFixed(1)+"%");
    set("v_gas", f.gasoline_prod.toFixed(1));
    set("v_dist",f.distillate_prod.toFixed(1));
    set("v_jet", f.jet_other_prod.toFixed(1));
    set("v_demand",f.product_supplied.toFixed(1));
    // compact crude-exports box uses inline "5.6 mb/d"
    set("v_cex", mbd(f.crude_exports));
    set("v_comm",mb(s.commercial_crude));

    // Days-of-cover at current demand rate (product supplied, not refinery
    // throughput — "Days of Consumption" framing, since refinery rate can be
    // ramped but demand can't). Surfaces stress that an absolute-mb readout
    // hides: stocks growing is OK if demand grew with them.
    const demandRate = f.product_supplied || 1;
    set("v_comm_days", (s.commercial_crude / demandRate).toFixed(1));

    set("v_spr", mb(s.spr));
    // SPR days of cover at current demand — the "weeks of insurance" view.
    set("v_spr_days", (s.spr / demandRate).toFixed(0));

    // SPR fill/drain mode — driven by 4-week delta in history.spr (most-recent
    // first). Drain → red arrow up to refinery + ▼ glyph. Fill → green arrow
    // reversed (refinery down to tank) + ▲. Idle (|delta| < 0.5) → grey, ◆.
    const sprHist = (d.history || {}).spr || [];
    let sprDelta = null;
    if (sprHist.length >= 4) sprDelta = sprHist[0] - sprHist[3];
    const sprPath  = document.getElementById("p_spr");
    const sprGlyph = document.getElementById("g_sprdelta");
    const sprLabel = document.getElementById("l_sprdelta");
    // Geometry of the SPR connector path:
    //   drain:  SPR tank top (565,470) → refinery (520,342)
    //   fill:   refinery (520,342)     → SPR tank top (565,470)  [reversed]
    const D_DRAIN = "M 565 470 C 565 430 540 380 520 342";
    const D_FILL  = "M 520 342 C 540 380 565 430 565 470";
    if (sprDelta == null) {
      // No history → keep the existing visual but blank the caption.
      set("v_sprdraw", "—");
      if (sprGlyph) sprGlyph.textContent = "◆";
      if (sprLabel) sprLabel.textContent = "no recent data";
    } else if (sprDelta < -0.5) {
      // DRAINING — red, ▼, arrow points up to refinery
      if (sprPath) {
        sprPath.setAttribute("d", D_DRAIN);
        sprPath.setAttribute("stroke", "var(--layoff)");
        sprPath.setAttribute("marker-end", "url(#ah-spr-drain)");
        sprPath.setAttribute("opacity", "0.6");
      }
      if (sprGlyph){ sprGlyph.textContent = "▼"; sprGlyph.setAttribute("fill", "var(--layoff)"); }
      set("v_sprdraw", sprDelta.toFixed(1)+" mb");
      if (sprLabel) sprLabel.textContent = "4-wk draw";
    } else if (sprDelta > 0.5) {
      // FILLING — green, ▲, arrow reversed (refinery down to SPR)
      if (sprPath) {
        sprPath.setAttribute("d", D_FILL);
        sprPath.setAttribute("stroke", "var(--emp)");
        sprPath.setAttribute("marker-end", "url(#ah-spr-fill)");
        sprPath.setAttribute("opacity", "0.6");
      }
      if (sprGlyph){ sprGlyph.textContent = "▲"; sprGlyph.setAttribute("fill", "var(--emp)"); }
      set("v_sprdraw", "+"+sprDelta.toFixed(1)+" mb");
      if (sprLabel) sprLabel.textContent = "4-wk fill";
    } else {
      // IDLE — within ±0.5 mb over 4 weeks. Grey, fade the arrow.
      if (sprPath) {
        sprPath.setAttribute("stroke", "var(--ink-dim)");
        sprPath.setAttribute("opacity", "0.25");
      }
      if (sprGlyph){ sprGlyph.textContent = "◆"; sprGlyph.setAttribute("fill", "var(--ink-dim)"); }
      set("v_sprdraw", sprDelta.toFixed(1)+" mb");
      if (sprLabel) sprLabel.textContent = "4-wk flat";
    }
    set("v_gasstk",mb(s.gasoline));
    set("v_wti","$"+d.meta.wti.toFixed(2));
    // Real-dollar context. Without a wired CPI series, we annotate against
    // FRED CPIAUCSL-deflated reference points: 2005-2025 average WTI ≈ $99
    // in 2026 dollars, 2008 peak ≈ $213. Tells viewers whether today's
    // price is high or low *by historical real standards*.
    set("v_wti_real", "20-yr real avg ~$99 · 2008 peak $213 (in 2026$)");

    // readouts
    set("r_supply",supply.toFixed(1)+" mb/d");
    set("r_ref", f.refinery_inputs.toFixed(1)+" mb/d");
    set("r_util",(c.refinery_utilization).toFixed(1)+"%");
    set("r_demand",f.product_supplied.toFixed(1)+" mb/d");
    set("r_spr", Math.round(s.spr)+" mb");

    // Sparkline (4-week trailing) + 5-yr range indicator on each readout card.
    // Helpers live in assets/charts.js (window.EM_*).
    const hist = d.history || {};
    const r5y  = d.ranges_5yr || {};
    const C = window.EM_color;
    EM_sparkline("spark_supply", hist.crude_supply,     C("--crude"));
    EM_sparkline("spark_ref",    hist.refinery_inputs,  C("--crude"));
    EM_sparkline("spark_demand", hist.product_supplied, C("--gasoline"));
    EM_sparkline("spark_spr",    hist.spr,              C("--layoff"));
    EM_rangeBadge("range_supply", supply,             r5y.crude_supply,     "mb/d");
    EM_rangeBadge("range_ref",    f.refinery_inputs,  r5y.refinery_inputs,  "mb/d");
    EM_rangeBadge("range_demand", f.product_supplied, r5y.product_supplied, "mb/d");
    EM_rangeBadge("range_spr",    s.spr,              r5y.spr,              "mb");

    // proportional pipes + animated overlay (clean lines, no midpoint labels)
    Object.keys(PIPES).forEach(k=>{
      const path=document.getElementById(PIPES[k]); if(!path)return;
      const val=f[k], w=widthFor(val);
      path.setAttribute("stroke-width",w.toFixed(2));
      // dim the base so the bright dashed overlay reads as motion
      if(!path.hasAttribute("opacity")) path.setAttribute("opacity","0.45");
      const anim=path.cloneNode(false);
      anim.removeAttribute("id");
      anim.setAttribute("class","flow flow-dash");
      anim.setAttribute("opacity","1");
      path.parentNode.appendChild(anim);
    });

    // buffer tank fills
    fillTank("crude",  s.commercial_crude/600);   // commercial crude vs ~600 mb working
    fillTank("spr",    s.spr/c.spr_capacity);      // SPR vs full capacity (shows depletion)
    fillTank("gasstk", s.gasoline/260);            // gasoline vs ~260 mb working

    set("datestamp","VINTAGE · "+(d.meta.vintage||"—"));
    if(window.EM_setNextRelease) window.EM_setNextRelease(d.meta.vintage);
    const st=document.getElementById("status");
    if(d.meta.status==="live"){st.textContent="LIVE ✓";st.classList.add("live");}
    else{st.textContent="CACHED";st.classList.remove("live");}

    wireHover();
  }

  // fill a tank: key matches fill_<key>/line_<key>; all tanks share y=470, h=130
  function fillTank(key,frac){
    const fill=document.getElementById("fill_"+key);
    const line=document.getElementById("line_"+key);
    if(!fill)return;
    frac=Math.max(0.06,Math.min(0.96,frac));
    const top=470, hh=130, fh=hh*frac, fy=top+(hh-fh);
    fill.setAttribute("y",fy);fill.setAttribute("height",fh);
    if(line){line.setAttribute("y1",fy);line.setAttribute("y2",fy);}
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
    .then(d=>{if(!d.flows_mbd)throw new Error("no flows");render(d);})
    .catch(err=>{console.warn("data.json load failed, using seed:",err);render(SEED);});
})();
