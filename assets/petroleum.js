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
    context:{refinery_utilization:90.1,spr_released_since_march:17.5,spr_capacity:714,crude_vs_5yr_pct:0.1}
  };

  const set=(id,t)=>{const e=document.getElementById(id);if(e)e.textContent=t;};
  const mbd=v=>v.toFixed(1)+" mb/d";
  const mb =v=>Math.round(v)+" mb";

  // pipe width: 16 mb/d (refinery throughput) -> 13px; clamp [1.5, 16]
  const REF=16, REFW=13, MINW=1.5, MAXW=16;
  const widthFor=v=>Math.max(MINW,Math.min(MAXW,(Math.max(v,0)/REF)*REFW));

  const PIPES={
    production:"p_prod", crude_imports:"p_imp", crude_exports:"p_cex",
    gasoline_prod:"p_gas", distillate_prod:"p_dist", jet_other_prod:"p_jet"
  };

  function midpoint(p){const L=p.getTotalLength();return p.getPointAtLength(L*0.5);}

  function render(d){
    const f=d.flows_mbd, s=d.stocks_mb, c=d.context;
    const supply=f.production+f.crude_imports;

    set("v_prod",mbd(f.production));
    set("v_imp", mbd(f.crude_imports));
    set("v_supply",mbd(supply));
    set("v_ref", f.refinery_inputs.toFixed(1));
    set("v_util",(c.refinery_utilization).toFixed(1)+"%");
    set("v_gas", mbd(f.gasoline_prod));
    set("v_dist",mbd(f.distillate_prod));
    set("v_jet", mbd(f.jet_other_prod));
    set("v_demand",mbd(f.product_supplied));
    set("v_cex", f.crude_exports.toFixed(1));
    set("v_comm",mb(s.commercial_crude));
    set("v_spr", mb(s.spr));
    set("v_sprdraw",(c.spr_released_since_march).toFixed(1)+" mb");
    set("v_gasstk",mb(s.gasoline));
    set("v_wti","$"+d.meta.wti.toFixed(2));

    // readouts
    set("r_supply",supply.toFixed(1)+" mb/d");
    set("r_ref", f.refinery_inputs.toFixed(1)+" mb/d");
    set("r_util",(c.refinery_utilization).toFixed(1)+"%");
    set("r_demand",f.product_supplied.toFixed(1)+" mb/d");
    set("r_spr", Math.round(s.spr)+" mb");
    const e=(id,w)=>{const x=document.getElementById(id);if(x)x.style.width=w;};
    const bar=(v,max)=>Math.max(2,Math.min(100,(v/max)*100))+"%";
    e("bar_supply",bar(supply,25));
    e("bar_ref",bar(f.refinery_inputs,20));
    e("bar_demand",bar(f.product_supplied,25));
    e("bar_spr",bar(s.spr,c.spr_capacity));   // SPR vs full 714 mb capacity

    // proportional pipes + animated overlay
    const labelG=document.getElementById("flowlabels"); labelG.innerHTML="";
    Object.keys(PIPES).forEach(k=>{
      const path=document.getElementById(PIPES[k]); if(!path)return;
      const val=f[k], w=widthFor(val);
      path.setAttribute("stroke-width",w.toFixed(2));
      const anim=path.cloneNode(false);
      anim.removeAttribute("id"); anim.removeAttribute("marker-end");
      anim.setAttribute("class","flow flow-dash");
      anim.setAttribute("opacity","0.9");
      path.parentNode.appendChild(anim);
      // label positioned 62% along the pipe — keeps it clear of the source
      // node boxes (whose own value text would otherwise collide at the midpoint)
      const L=path.getTotalLength();
      const p=path.getPointAtLength(L*0.62), txt=val.toFixed(1);
      const pad=3,charW=6.0,bw=txt.length*charW+pad*2,bh=14;
      const bg=document.createElementNS("http://www.w3.org/2000/svg","rect");
      bg.setAttribute("x",p.x-bw/2);bg.setAttribute("y",p.y-bh/2);
      bg.setAttribute("width",bw);bg.setAttribute("height",bh);
      bg.setAttribute("rx",2);bg.setAttribute("class","flowlbl-bg");
      const t=document.createElementNS("http://www.w3.org/2000/svg","text");
      t.setAttribute("x",p.x);t.setAttribute("y",p.y+3.5);
      t.setAttribute("text-anchor","middle");t.setAttribute("class","flowlbl");
      t.setAttribute("fill",path.getAttribute("stroke"));t.textContent=txt;
      const g=document.createElementNS("http://www.w3.org/2000/svg","g");
      g.setAttribute("class","hl");g.setAttribute("data-k",k);
      g.appendChild(bg);g.appendChild(t);labelG.appendChild(g);
    });

    // buffer tank fills
    fillTank("crude",  s.commercial_crude/600);   // commercial crude vs ~600 mb working
    fillTank("spr",    s.spr/c.spr_capacity);      // SPR vs full capacity (shows depletion)
    fillTank("gasstk", s.gasoline/260);            // gasoline vs ~260 mb working

    set("datestamp","VINTAGE · "+(d.meta.vintage||"—"));
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
