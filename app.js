// PakClim — Application Logic



// ── STATE ────────────────────────────────────────────
const S = {
  lat:null, lon:null, name:'', prov:'', dist:'', count:0,
  raw:null, yearly:null, monthly:null,
  clickMode:false, selDot:null, abort:null
};

function selLoc(name, prov, dist, lat, lon, count){
  S._fullRaw = null; // reset on new location
  S.name=name; S.prov=prov; S.dist=dist; S.lat=lat; S.lon=lon; S.count=count;
  // Update header
  document.getElementById('lname').textContent    = name;
  document.getElementById('lprov').textContent    = prov.replace(/_/g,' ');
  document.getElementById('ldist').textContent    = dist ? '· '+dist : '';
  document.getElementById('lcoords').textContent  = lat.toFixed(4)+'°N  ·  '+lon.toFixed(4)+'°E';
  const lcnt = document.getElementById('lcnt');
  if(count>1){ lcnt.textContent=count+' pts'; lcnt.style.display='inline'; }
  else lcnt.style.display='none';
  document.getElementById('welState').style.display = 'none';
  document.getElementById('datState').style.display = 'flex';
  switchTab('climate');
  // ⚡ Auto-load from cache if bulk data exists for this location
  tryAutoLoad(lat, lon, name, prov, dist);
}

// ── LABELS ───────────────────────────────────────────

// ── SVG MAP — PAN / ZOOM ─────────────────────────────────────
const MAP = document.getElementById('MAP');
const MAP_W = 940, MAP_H = 1020;
let vb = {x:0, y:0, w:MAP_W, h:MAP_H};
let isDown=false, startX, startY, startVBX, startVBY, didMove=false;

function fitMap(){
  const r = MAP.getBoundingClientRect();
  if(!r.width || !r.height) return;
  const scaleX = MAP_W / r.width;
  const scaleY = MAP_H / r.height;
  const scale  = Math.max(scaleX, scaleY);
  const fitW   = r.width  * scale;
  const fitH   = r.height * scale;
  const offX   = (fitW - MAP_W) / 2;
  const offY   = (fitH - MAP_H) / 2;
  vb = {x:-offX, y:-offY, w:fitW, h:fitH};
  MAP.setAttribute('viewBox', `${-offX} ${-offY} ${fitW} ${fitH}`);
}

setTimeout(fitMap, 100);
window.addEventListener('resize', fitMap);

function setVB(x,y,w,h){
  // Clamp so at least 40% of map is always visible
  const minX = -(w * 0.6);
  const maxX = MAP_W - (w * 0.4);
  const minY = -(h * 0.6);
  const maxY = MAP_H - (h * 0.4);
  x = Math.max(minX, Math.min(maxX, x));
  y = Math.max(minY, Math.min(maxY, y));
  vb={x,y,w,h};
  MAP.setAttribute('viewBox',`${x} ${y} ${w} ${h}`);
}
function svgPt(cx,cy){
  const r=MAP.getBoundingClientRect();
  return {x:(cx-r.left)/r.width*vb.w+vb.x, y:(cy-r.top)/r.height*vb.h+vb.y};
}
function svgToGeo(sx,sy){
  const PAD=20, W=860, H=960;
  const lon = (sx-PAD)/W * (77.834-60.8786) + 60.8786;
  const lat = ((980-sy)/H) * (37.0894-23.6947) + 23.6947;
  return {lat:+lat.toFixed(4), lon:+lon.toFixed(4)};
}
function geoToSvg(lat,lon){
  const PAD=20, W=860, H=960;
  return {
    x: PAD + (lon-60.8786)/(77.834-60.8786)*W,
    y: (980) - (lat-23.6947)/(37.0894-23.6947)*H
  };
}

MAP.addEventListener('mousedown', e=>{
  if(e.button!==0) return;
  isDown=true; didMove=false;
  startX=e.clientX; startY=e.clientY;
  startVBX=vb.x; startVBY=vb.y;
});
MAP.addEventListener('mousemove', e=>{
  const pt=svgPt(e.clientX,e.clientY);
  const g=svgToGeo(pt.x,pt.y);
  document.getElementById('cbar').textContent=`Lat ${g.lat.toFixed(3)}  ·  Lon ${g.lon.toFixed(3)}`;
  if(!isDown) return;
  const dx=(e.clientX-startX)/MAP.getBoundingClientRect().width*vb.w;
  const dy=(e.clientY-startY)/MAP.getBoundingClientRect().height*vb.h;
  if(Math.abs(e.clientX-startX)+Math.abs(e.clientY-startY)>4) didMove=true;
  setVB(startVBX-dx, startVBY-dy, vb.w, vb.h);
});
MAP.addEventListener('mouseup', e=>{
  if(!isDown) return;
  isDown=false;
  if(!didMove && S.clickMode){
    const pt=svgPt(e.clientX,e.clientY);
    const g=svgToGeo(pt.x,pt.y);
    custPt(g.lat,g.lon,pt.x,pt.y);
  }
});
MAP.addEventListener('mouseleave',()=>{ isDown=false; });
MAP.addEventListener('wheel', e=>{
  e.preventDefault();
  const pt=svgPt(e.clientX,e.clientY);
  const f=e.deltaY>0?1.13:0.88;
  const nw=Math.max(150, Math.min(vb.w*2.5, vb.w*f));
  const nh=Math.max(150, Math.min(vb.h*2.5, vb.h*f));
  setVB(pt.x-(pt.x-vb.x)*nw/vb.w, pt.y-(pt.y-vb.y)*nh/vb.h, nw, nh);
},{passive:false});

// Zoom buttons
document.getElementById('zi')?.addEventListener('click',()=>{const c={x:vb.x+vb.w/2,y:vb.y+vb.h/2};setVB(c.x-vb.w*.4,c.y-vb.h*.4,vb.w*.8,vb.h*.8);});
document.getElementById('zo')?.addEventListener('click',()=>{const c={x:vb.x+vb.w/2,y:vb.y+vb.h/2};setVB(c.x-vb.w*.625,c.y-vb.h*.625,vb.w*1.25,vb.h*1.25);});
document.getElementById('zr')?.addEventListener('click', fitMap);

// ── TOOLTIP ─────────────────────────────────────────────
const TIP = document.getElementById('TIP');
function showTip(name,meta,coords,hint,e){
  document.getElementById('tipName').textContent=name;
  document.getElementById('tipMeta').textContent=meta;
  document.getElementById('tipCoords').textContent=coords;
  document.getElementById('tipHint').textContent=hint;
  TIP.style.left=(e.clientX+16)+'px';
  TIP.style.top=(e.clientY-32)+'px';
  TIP.style.display='block';
}
function hideTip(){ TIP.style.display='none'; }
// ── FIXED UNIFIED CLICK HANDLER (Prevents page reload when clicking district or tehsil) ────────────────────
MAP.addEventListener('click', function(e) {
  if (S.clickMode) return;   // custom point mode
  if (didMove) return;

  e.preventDefault();
  e.stopImmediatePropagation();
  e.stopPropagation();

  // Tehsil has higher priority
  const tpath = e.target.closest('.t-path');
  if (tpath) {
    selLoc(
      tpath.dataset.tehsil || tpath.dataset.district || 'Tehsil',
      tpath.dataset.province || '',
      tpath.dataset.district || '',
      parseFloat(tpath.dataset.lat || 0),
      parseFloat(tpath.dataset.lon || 0),
      0
    );
    return;
  }

  // District
  const dpath = e.target.closest('.d-path');
  if (dpath) {
    document.querySelectorAll('.d-path.sel-d').forEach(x => {
      x.classList.remove('sel-d');
      x.style.filter = '';
      x.style.strokeWidth = '0.8';
      x.style.stroke = '#0d0d0d';
    });
    dpath.classList.add('sel-d');
    dpath.style.filter = 'brightness(1.35) drop-shadow(0 0 8px rgba(37,99,235,0.6))';
    dpath.style.stroke = '#fff';
    dpath.style.strokeWidth = '1.5';

    selLoc(
      dpath.dataset.district.replace(/_/g,' '),
      dpath.dataset.province,
      '',
      parseFloat(dpath.dataset.lat),
      parseFloat(dpath.dataset.lon),
      0
    );
    return;
  }
}, false);

// ── DISTRICT PATHS — event delegation ────────────────────
const dlayer = document.getElementById('dlayer');
dlayer.addEventListener('mouseenter', e=>{
  const p=e.target.closest('.d-path'); if(!p) return;
  showTip(
    p.dataset.district.replace(/_/g,' '),
    'District · '+p.dataset.province.replace(/_/g,' '),
    p.dataset.lat+'°N   '+p.dataset.lon+'°E',
    'Click to select district', e
  );
  p.style.filter='brightness(1.3)';
  p.style.strokeWidth='2';
  p.style.stroke='rgba(255,255,255,0.6)';
}, true);
dlayer.addEventListener('mousemove', e=>{
  const p=e.target.closest('.d-path'); if(!p) return;
  TIP.style.left=(e.clientX+16)+'px'; TIP.style.top=(e.clientY-32)+'px';
}, true);
dlayer.addEventListener('mouseleave', e=>{
  const p=e.target.closest('.d-path'); if(!p) return;
  hideTip();
  if(!p.classList.contains('sel-d')){
    p.style.filter=''; p.style.strokeWidth='0.8'; p.style.stroke='#0d0d0d';
  }
}, true);


// ── SETTLEMENT DOTS (SVG circles) ─────────────────────────
function buildSettlementLayer(){
  const layer=document.getElementById('dotlayer');
  layer.innerHTML='';
  const NS='http://www.w3.org/2000/svg';
  _DOTS_DATA.forEach(d=>{
    const {x,y}=geoToSvg(d.la,d.lo);
    const c=document.createElementNS(NS,'circle');
    c.setAttribute('class','s-dot');
    c.setAttribute('cx',x.toFixed(2));
    c.setAttribute('cy',y.toFixed(2));
    c.setAttribute('r','3');
    c.setAttribute('fill','#ffffff');
    c.setAttribute('fill-opacity','0.9');
    c.setAttribute('stroke',d.col||'#94a3b8');
    c.setAttribute('stroke-width','1.2');
    c.setAttribute('data-name',d.n||'');
    c.setAttribute('data-lat',d.la);
    c.setAttribute('data-lon',d.lo);
    c.setAttribute('data-province',d.p||'');
    c.setAttribute('data-district',d.d||'');
    c.setAttribute('data-count',d.c||0);
    layer.appendChild(c);
  });
}

// ── DOT LAYER EVENT DELEGATION ────────────────────────────
const dotlayer = document.getElementById('dotlayer');
dotlayer.addEventListener('mouseenter', e=>{
  const dot=e.target.closest('.s-dot'); if(!dot) return;
  showTip(dot.dataset.name||'Settlement',
    (dot.dataset.province||'').replace(/_/g,' ')+(dot.dataset.district?' · '+dot.dataset.district.replace(/_/g,' '):''),
    dot.dataset.lat+'°N  '+dot.dataset.lon+'°E','Click for climate data',e);
  dot.setAttribute('r','5');
  dot.setAttribute('fill','#fbbf24');
},true);
dotlayer.addEventListener('mousemove', e=>{
  const dot=e.target.closest('.s-dot'); if(!dot) return;
  TIP.style.left=(e.clientX+16)+'px'; TIP.style.top=(e.clientY-32)+'px';
},true);
dotlayer.addEventListener('mouseleave', e=>{
  const dot=e.target.closest('.s-dot'); if(!dot) return;
  hideTip();
  if(S.selDot!==dot){ dot.setAttribute('r','3'); dot.setAttribute('fill','#ffffff'); }
},true);
dotlayer.addEventListener('click', e=>{
  e.preventDefault(); e.stopPropagation();
  const dot=e.target.closest('.s-dot'); if(!dot||didMove||S.clickMode) return;
  if(S.selDot){ S.selDot.setAttribute('r','3'); S.selDot.setAttribute('fill','#ffffff'); S.selDot.classList.remove('sel-dot'); }
  S.selDot=dot;
  dot.classList.add('sel-dot');
  dot.setAttribute('r','5'); dot.setAttribute('fill','#fbbf24');
  selLoc(dot.dataset.name||'Settlement', dot.dataset.province||'', dot.dataset.district||'',
    parseFloat(dot.dataset.lat), parseFloat(dot.dataset.lon), parseInt(dot.dataset.count)||0);
});

// ── LAYER TOGGLE BUTTONS ──────────────────────────────────
document.getElementById('bBound')?.addEventListener('click',function(){
  this.classList.toggle('on-o');
  const on=this.classList.contains('on-o');
  document.getElementById('dlayer').style.display=on?'':'none';
});
document.getElementById('bNational')?.addEventListener('click',function(){
  this.classList.toggle('on-b');
  const on=this.classList.contains('on-b');
  document.getElementById('nlayer').style.display=on?'':'none';
});
document.getElementById('bProvincial')?.addEventListener('click',function(){
  this.classList.toggle('on-b');
  const on=this.classList.contains('on-b');
  document.getElementById('player').style.display=on?'':'none';
});
document.getElementById('bTehsil')?.addEventListener('click',function(){
  this.classList.toggle('on-b');
  const on=this.classList.contains('on-b');
  const tl=document.getElementById('tlayer');
  if(tl) tl.setAttribute('display',on?'':'none');
});
document.getElementById('bDots')?.addEventListener('click',function(){
  this.classList.toggle('on-w');
  const on=this.classList.contains('on-w');
  document.getElementById('dotlayer').style.display=on?'':'none';
});
document.getElementById('bLabels')?.addEventListener('click',function(){
  this.classList.toggle('on-g');
  const on=this.classList.contains('on-g');
  document.getElementById('lblayer').setAttribute('display',on?'':'none');
});

// Province filter
document.getElementById('provFilt')?.addEventListener('change',function(){
  const pv=this.value;
  const pvSafe=pv.replace(/ /g,'_');
  document.querySelectorAll('.d-path').forEach(p=>{
    p.style.opacity=(!pv||p.dataset.province===pvSafe)?'1':'0.1';
  });
  document.querySelectorAll('.t-path').forEach(p=>{
    p.style.opacity=(!pv||p.dataset.province===pvSafe)?'1':'0.05';
  });
  document.querySelectorAll('.s-dot').forEach(d=>{
    d.style.opacity=(!pv||d.dataset.province===pvSafe)?'1':'0.08';
  });
});

// ── THEME TOGGLE ─────────────────────────────────────────
document.getElementById('themeBtn')?.addEventListener('click',function(){
  document.body.classList.toggle('dark');
  this.textContent=document.body.classList.contains('dark')?'☀️':'🌙';
  const isDark=document.body.classList.contains('dark');
  document.getElementById('mapbg0')?.setAttribute('stop-color',isDark?'#1a1f2e':'#c8d8ea');
  document.getElementById('mapbg1')?.setAttribute('stop-color',isDark?'#0d1117':'#b8cce0');
});

// ── CUSTOM COORD MODE ────────────────────────────────────
document.getElementById('cmBtn')?.addEventListener('click',function(){
  S.clickMode=!S.clickMode;
  this.classList.toggle('on',S.clickMode);
  document.getElementById('cbadge').style.display=S.clickMode?'block':'none';
  MAP.className=S.clickMode?'cross':'grab';
});
function custPt(lat,lon,sx,sy){
  S.clickMode=false;
  document.getElementById('cmBtn').classList.remove('on');
  document.getElementById('cbadge').style.display='none';
  MAP.className='grab';
  // Place marker dot
  const NS='http://www.w3.org/2000/svg';
  let cm=document.getElementById('custMarker');
  if(!cm){ cm=document.createElementNS(NS,'circle'); cm.id='custMarker'; MAP.appendChild(cm); }
  cm.setAttribute('cx',sx); cm.setAttribute('cy',sy);
  cm.setAttribute('r','6'); cm.setAttribute('fill','#fbbf24');
  cm.setAttribute('stroke','#fff'); cm.setAttribute('stroke-width','2');
  cm.style.filter='drop-shadow(0 0 6px #fbbf24)';
  selLoc('Custom Point','Custom','',lat,lon,0);
}

// ── SEARCH ───────────────────────────────────────────────
const si=document.getElementById('si'), sr=document.getElementById('sr');
// Prevent Enter key from submitting form / reloading page
if(si) si.addEventListener('keydown', e => {
  if(e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); }
});
if(si) si.addEventListener('input',()=>{
  const q=si.value.trim().toLowerCase();
  if(!q){ sr.style.display='none'; return; }
  const provColor={'Punjab':'#ff8533','Sindh':'#0dd4f0','Khyber_Pakhtunkhwa':'#ff6b6b','Balochistan':'#c88aff','Gilgit_Baltistan':'#a855f7','Azad_Kashmir':'#fb923c','Islamabad':'#e879f9'};
  const hits=ALL_DISTRICTS.filter(d=>d.n.replace(/_/g,' ').toLowerCase().includes(q)).slice(0,12);
  if(!hits.length){ sr.style.display='none'; return; }
  sr.innerHTML=hits.map(d=>`<div class="sr-item" data-la="${d.la}" data-lo="${d.lo}" data-n="${d.n}" data-p="${d.p}">
    <div class="sri-dot" style="background:${provColor[d.p]||'#94a3b8'}"></div>
    <div><div class="sri-name">${d.n.replace(/_/g,' ')}</div><div class="sri-sub">${d.p.replace(/_/g,' ')}</div></div>
  </div>`).join('');
  sr.style.display='block';
 sr.querySelectorAll('.sr-item').forEach(el=>{
  el.addEventListener('click',(e)=>{
    e.preventDefault();
    e.stopPropagation();
    si.value=''; sr.style.display='none';
    const lat=+el.dataset.la,lon=+el.dataset.lo;
    const {x,y}=geoToSvg(lat,lon);
    setVB(x-110,y-120,220,240);
    selLoc(el.dataset.n.replace(/_/g,' '),el.dataset.p,'',lat,lon,0);
  });
});
});
document.addEventListener('click',e=>{ if(!si?.contains(e.target)&&!sr?.contains(e.target)) sr.style.display='none'; });


// ── TEHSIL PATHS — event delegation ──────────────────────
const tlayer = document.getElementById('tlayer');
if(tlayer){
  tlayer.addEventListener('mouseenter', e=>{
    const p=e.target.closest('.t-path'); if(!p) return;
    showTip(
      p.dataset.tehsil||p.dataset.district,
      'Tehsil · '+p.dataset.district+' · '+p.dataset.province.replace(/_/g,' '),
      p.dataset.lat+'°N   '+p.dataset.lon+'°E',
      'Click to select tehsil', e
    );
    p.style.filter='brightness(1.3)';
    p.style.strokeWidth='1.2';
    p.style.stroke='rgba(255,255,255,0.5)';
  }, true);
  tlayer.addEventListener('mousemove', e=>{
    const p=e.target.closest('.t-path'); if(!p) return;
    TIP.style.left=(e.clientX+16)+'px'; TIP.style.top=(e.clientY-32)+'px';
  }, true);
  tlayer.addEventListener('mouseleave', e=>{
    const p=e.target.closest('.t-path'); if(!p) return;
    hideTip();
    p.style.filter=''; p.style.strokeWidth='0.4'; p.style.stroke='#111';
  }, true);
  
// ── INIT ─────────────────────────────────────────────────
// Settlement dots removed — only national/province/district/tehsil boundaries shown
document.getElementById('dotlayer').style.display='none';

// ── COMPARE TAB ─────────────────────────────────────────
const CMP_A_COLOR = '#4a9eff';
const CMP_B_COLOR = '#f97316';
const MN_FULL  = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MN_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

let _cmpSelMonth = 0; // 0-based

// Populate year dropdowns when data is loaded
function initCmpYearPickers() {
  if(!S.yearly || !S.yearly.length) return;
  const years = S.yearly.map(y => y.year);
  const selA  = document.getElementById('cmpYearA');
  const selB  = document.getElementById('cmpYearB');
  if(!selA || !selB) return;

  selA.innerHTML = years.map(y => `<option value="${y}">${y}</option>`).join('');
  selB.innerHTML = years.map(y => `<option value="${y}">${y}</option>`).join('');

  // Default: first year vs last year
  selA.value = years[0];
  selB.value = years[years.length - 1];
}

// Build month buttons
function buildCmpMonthBtns() {
  const container = document.getElementById('cmpMonthBtns');
  if(!container) return;
  container.innerHTML = MN_SHORT.map((m,i) => `
    <button class="cmp-mo-btn${i===_cmpSelMonth?' active':''}" data-mo="${i}"
      style="padding:4px 8px;border-radius:6px;border:1.5px solid var(--border2);
      font-size:.65rem;font-weight:600;cursor:pointer;transition:all .12s;
      background:${i===_cmpSelMonth?'var(--blue)':'var(--surface2)'};
      color:${i===_cmpSelMonth?'#fff':'var(--txt2)'};"
    >${m}</button>`
  ).join('');
}

// Get daily values for a specific year+month
function getDailyData(year, monthIdx, field) {
  const result = [];
  const raw = S.raw;
  if(!raw || !raw.dates) return result;
  raw.dates.forEach((d, i) => {
    const yr = d.slice(0,4);
    const mo = d.length===8 ? parseInt(d.slice(4,6))-1 : parseInt(d.slice(5,7))-1;
    const dy = d.length===8 ? parseInt(d.slice(6,8))   : parseInt(d.slice(8,10));
    if(yr === year && mo === monthIdx) {
      const v = (raw[field]||[])[i];
      result.push({ day: dy, val: (v!=null && v>-999 && isFinite(v)) ? +v.toFixed(2) : null });
    }
  });
  result.sort((a,b) => a.day - b.day);
  return result;
}

// Get monthly averages for a specific year
function getMonthlyAvgs(year, field) {
  const byMonth = Array.from({length:12}, ()=>[]);
  const raw = S.raw;
  if(!raw || !raw.dates) return byMonth.map(()=>null);
  raw.dates.forEach((d,i) => {
    const yr = d.slice(0,4);
    const mo = d.length===8 ? parseInt(d.slice(4,6))-1 : parseInt(d.slice(5,7))-1;
    if(yr !== year || mo < 0 || mo > 11) return;
    const v = (raw[field]||[])[i];
    if(v!=null && v>-999 && isFinite(v)) byMonth[mo].push(v);
  });
  return byMonth.map(vals => vals.length ? +(vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(2) : null);
}

function destroyCmpCharts() {
  ['cmpTC','cmpPC','cmpWC','cmpDTC','cmpDPC','cmpDWC'].forEach(id => {
    const c = Chart.getChart(id); if(c) c.destroy();
  });
}

function cmpChartOpts(yLabel, title) {
  return {
    responsive:true, maintainAspectRatio:false,
    plugins:{
      legend:{ labels:{ color:'var(--txt2)', font:{size:10}, boxWidth:14 } },
      title:{ display:false }
    },
    scales:{
      x:{ ticks:{color:'var(--txt3)',font:{size:10}}, grid:{color:'rgba(148,163,184,.07)'} },
      y:{ ticks:{color:'var(--txt3)',font:{size:10}, callback:v=>v+yLabel}, grid:{color:'rgba(148,163,184,.07)'} }
    }
  };
}

function runCompare() {
  const yearA = document.getElementById('cmpYearA')?.value;
  const yearB = document.getElementById('cmpYearB')?.value;
  if(!yearA || !yearB || !S.raw) return;

  destroyCmpCharts();

  const results = document.getElementById('cmpResults');
  results.style.display = 'flex';

  // ── MONTHLY charts ──────────────────────────────────────
  const tempA  = getMonthlyAvgs(yearA, 'T2M');
  const tempB  = getMonthlyAvgs(yearB, 'T2M');
  const rainA  = getMonthlyAvgs(yearA, 'PREC');
  const rainB  = getMonthlyAvgs(yearB, 'PREC');
  const windA  = getMonthlyAvgs(yearA, 'WS2M');
  const windB  = getMonthlyAvgs(yearB, 'WS2M');

  new Chart(document.getElementById('cmpTC'), {
    type:'line',
    data:{ labels:MN_SHORT, datasets:[
      { label:yearA, data:tempA, borderColor:CMP_A_COLOR, backgroundColor:CMP_A_COLOR+'22', tension:.4, pointRadius:4, borderWidth:2, fill:false },
      { label:yearB, data:tempB, borderColor:CMP_B_COLOR, backgroundColor:CMP_B_COLOR+'22', tension:.4, pointRadius:4, borderWidth:2, fill:false }
    ]},
    options: cmpChartOpts('°C')
  });

  new Chart(document.getElementById('cmpPC'), {
    type:'bar',
    data:{ labels:MN_SHORT, datasets:[
      { label:yearA, data:rainA, backgroundColor:CMP_A_COLOR+'99', borderColor:CMP_A_COLOR, borderWidth:1.5 },
      { label:yearB, data:rainB, backgroundColor:CMP_B_COLOR+'99', borderColor:CMP_B_COLOR, borderWidth:1.5 }
    ]},
    options: cmpChartOpts('mm')
  });

  new Chart(document.getElementById('cmpWC'), {
    type:'line',
    data:{ labels:MN_SHORT, datasets:[
      { label:yearA, data:windA, borderColor:CMP_A_COLOR, tension:.4, pointRadius:3, borderWidth:2, fill:false },
      { label:yearB, data:windB, borderColor:CMP_B_COLOR, tension:.4, pointRadius:3, borderWidth:2, fill:false }
    ]},
    options: cmpChartOpts('m/s')
  });

  // ── DAILY charts for selected month ─────────────────────
  buildCmpMonthBtns();
  renderCmpDaily(yearA, yearB, _cmpSelMonth);
}

function renderCmpDaily(yearA, yearB, monthIdx) {
  ['cmpDTC','cmpDPC','cmpDWC'].forEach(id => { const c=Chart.getChart(id); if(c) c.destroy(); });

  // Update label
  const lbl = document.getElementById('cmpDailyLabel');
  if(lbl) lbl.textContent = `🌡 Daily Temperature — ${MN_FULL[monthIdx]}`;

  const daysInMonth = [31,28,31,30,31,30,31,31,30,31,30,31][monthIdx];
  const dayLabels   = Array.from({length:daysInMonth}, (_,i) => `${i+1}`);

  const buildDayArr = (year, field, days) => {
    const daily = getDailyData(year, monthIdx, field);
    const arr   = Array(days).fill(null);
    daily.forEach(({day, val}) => { if(day>=1 && day<=days) arr[day-1]=val; });
    return arr;
  };

  const dailyOpts = (yLabel) => ({
    ...cmpChartOpts(yLabel),
    animation: false,
    plugins:{
      ...cmpChartOpts(yLabel).plugins,
      tooltip:{ mode:'index', intersect:false }
    }
  });

  new Chart(document.getElementById('cmpDTC'), {
    type:'line',
    data:{ labels:dayLabels, datasets:[
      { label:yearA, data:buildDayArr(yearA,'T2M',daysInMonth),  borderColor:CMP_A_COLOR, backgroundColor:CMP_A_COLOR+'18', tension:.3, pointRadius:3, borderWidth:2, fill:true },
      { label:yearB, data:buildDayArr(yearB,'T2M',daysInMonth),  borderColor:CMP_B_COLOR, backgroundColor:CMP_B_COLOR+'18', tension:.3, pointRadius:3, borderWidth:2, fill:true }
    ]},
    options: dailyOpts('°C')
  });

  new Chart(document.getElementById('cmpDPC'), {
    type:'bar',
    data:{ labels:dayLabels, datasets:[
      { label:yearA, data:buildDayArr(yearA,'PREC',daysInMonth), backgroundColor:CMP_A_COLOR+'99', borderColor:CMP_A_COLOR, borderWidth:1 },
      { label:yearB, data:buildDayArr(yearB,'PREC',daysInMonth), backgroundColor:CMP_B_COLOR+'99', borderColor:CMP_B_COLOR, borderWidth:1 }
    ]},
    options: dailyOpts('mm')
  });

  new Chart(document.getElementById('cmpDWC'), {
    type:'line',
    data:{ labels:dayLabels, datasets:[
      { label:yearA, data:buildDayArr(yearA,'WS2M',daysInMonth), borderColor:CMP_A_COLOR, tension:.3, pointRadius:2, borderWidth:2, fill:false },
      { label:yearB, data:buildDayArr(yearB,'WS2M',daysInMonth), borderColor:CMP_B_COLOR, tension:.3, pointRadius:2, borderWidth:2, fill:false }
    ]},
    options: dailyOpts('m/s')
  });
}

// ── Wire all Compare buttons ──────────────────────────────
document.addEventListener('click', e => {
  // Compare Go button
  if(e.target.id === 'cmpGoBtn') { runCompare(); return; }

  // Month drill-down buttons
  const moBtn = e.target.closest('.cmp-mo-btn');
  if(moBtn) {
    _cmpSelMonth = parseInt(moBtn.dataset.mo);
    document.querySelectorAll('.cmp-mo-btn').forEach(b => {
      const active = parseInt(b.dataset.mo) === _cmpSelMonth;
      b.style.background = active ? 'var(--blue)' : 'var(--surface2)';
      b.style.color       = active ? '#fff' : 'var(--txt2)';
      b.style.borderColor = active ? 'var(--blue)' : 'var(--border2)';
    });
    const yearA = document.getElementById('cmpYearA')?.value;
    const yearB = document.getElementById('cmpYearB')?.value;
    if(yearA && yearB) renderCmpDaily(yearA, yearB, _cmpSelMonth);
  }
});

function renderCompare() {
  const empty   = document.getElementById('cmpEmpty');
  const content = document.getElementById('cmpContent');
  if(!empty || !content) return;

  if(!S.yearly || !S.yearly.length) {
    // No data yet — show message but still show the panel skeleton
    empty.style.display   = 'block';
    content.style.display = 'flex';
    return;
  }
  // Data available — hide message, populate dropdowns
  empty.style.display   = 'none';
  content.style.display = 'flex';
  initCmpYearPickers();
}

// ── END COMPARE TAB ───────────────────────────────────────

// ── PRESETS ──────────────────────────────────────────
document.querySelectorAll('.pb').forEach(b=>b.onclick=function(e){
  e.preventDefault();
  e.stopPropagation();
  document.querySelectorAll('.pb').forEach(x=>x.classList.remove('active'));
  this.classList.add('active');
  const t=new Date(), s=new Date(t), p=this.dataset.p;
  if(p==='1y') s.setFullYear(t.getFullYear()-1);
  else if(p==='5y') s.setFullYear(t.getFullYear()-5);
  else if(p==='10y') s.setFullYear(t.getFullYear()-10);
  else if(p==='30y') s.setFullYear(t.getFullYear()-30);
  else if(p==='bulk'){
    document.getElementById('dFrom').value = BULK_FROM;
    document.getElementById('dTo').value   = BULK_TO;
    if(S._fullRaw) applyDateFilter(BULK_FROM, BULK_TO);
    return;
  }
  else return;
  const fromStr = s.toISOString().split('T')[0];
  const toStr   = t.toISOString().split('T')[0];
  document.getElementById('dFrom').value = fromStr;
  document.getElementById('dTo').value   = toStr;

  // If we already have cached full data, slice it and re-render immediately
  // No need to re-fetch from NASA — just filter the existing raw data
  if(S.raw && S.raw.dates && S.raw.dates.length){
    applyDateFilter(fromStr, toStr);
  }
});

// ── DATE FILTER — slice raw cached data by date range, re-render instantly ───
// S._fullRaw holds the complete unfiltered dataset (set once on first load)
// S.raw is always the currently active slice shown in charts

function applyDateFilter(fromStr, toStr){
  // Ensure we always slice from the full dataset, not a previous slice
  const full = S._fullRaw || S.raw;
  if(!full || !full.dates || !full.dates.length) return;

  // Store full data once
  if(!S._fullRaw) S._fullRaw = S.raw;

  const fromD = fromStr.replace(/-/g,'');
  const toD   = toStr.replace(/-/g,'');

  // Filter indices where date is within range
  const indices = full.dates.reduce((acc, d, i) => {
    if(d >= fromD && d <= toD) acc.push(i);
    return acc;
  }, []);

  if(!indices.length){
    showErr('No data available for this date range in the cached dataset.');
    return;
  }

  // Build sliced raw object
  const sliced = {
    dates: [], T2M: [], T2M_MAX: [], T2M_MIN: [],
    PREC:  [], WS2M: [], RH2M:   [], SOLAR:   []
  };
  const fields = ['dates','T2M','T2M_MAX','T2M_MIN','PREC','WS2M','RH2M','SOLAR'];
  indices.forEach(i => {
    fields.forEach(f => { sliced[f].push(full[f][i]); });
  });

  S.raw = sliced;
  calcStats();
  renderRes();

  // Show feedback
  const pw = document.getElementById('pwrap');
  const pf = document.getElementById('pfill');
  const pl = document.getElementById('plbl');
  const pp = document.getElementById('ppct');
  const pi = document.getElementById('pinfo');
  pw.style.display = 'block';
  pf.style.width   = '100%';
  pl.textContent   = `⚡ Showing ${sliced.dates.length.toLocaleString()} days`;
  pp.textContent   = `${fromStr} → ${toStr}`;
  pi.textContent   = `Sliced from ${full.dates.length.toLocaleString()} cached days — no API call needed`;
  setTimeout(()=>{ pw.style.display='none'; }, 2200);
}

// Also apply filter when date inputs change manually
(document.getElementById('dFrom') || {}).addEventListener('change', ()=>{
  if(!S.raw) return;
  const from = document.getElementById('dFrom').value;
  const to   = document.getElementById('dTo').value;
  if(from && to) applyDateFilter(from, to);
});
(document.getElementById('dTo') || {}).addEventListener('change', ()=>{
  if(!S.raw) return;
  const from = document.getElementById('dFrom').value;
  const to   = document.getElementById('dTo').value;
  if(from && to) applyDateFilter(from, to);
});

// ── TABS ─────────────────────────────────────────────
function switchTab(n){
  document.querySelectorAll('.stab').forEach(t=>t.classList.toggle('active',t.dataset.t===n));
  document.querySelectorAll('.tp').forEach(p=>p.classList.toggle('active',p.id==='tab-'+n));
  if(n==='compare') renderCompare();
}
document.querySelectorAll('.stab').forEach(t=>t.onclick=()=>switchTab(t.dataset.t));


// ── INDEXEDDB CACHE ──────────────────────────────────────────────────────────
// Stores fetched climate data permanently in the browser database.
// Key format: "pakclim|lat|lon|from|to"  e.g. "pakclim|33.72|73.04|1994-01-01|2024-12-31"
// Data persists until the user explicitly clears it from the Cache tab.

const DB_NAME    = 'PakClimDB';
const DB_VERSION = 1;
const STORE      = 'climateData';

function dbOpen(){
  return new Promise((res,rej)=>{
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if(!db.objectStoreNames.contains(STORE)){
        const store = db.createObjectStore(STORE, {keyPath:'cacheKey'});
        store.createIndex('savedAt','savedAt',{unique:false});
      }
    };
    req.onsuccess = e => res(e.target.result);
    req.onerror   = e => rej(e.target.error);
  });
}

function cacheKey(lat,lon,from,to){
  return `pakclim|${lat}|${lon}|${from}|${to}`;
}

async function cacheGet(lat,lon,from,to){
  try{
    const db  = await dbOpen();
    const key = cacheKey(lat,lon,from,to);
    return await Promise.race([
      new Promise((res,rej)=>{
        const tx  = db.transaction(STORE,'readonly');
        const req = tx.objectStore(STORE).get(key);
        req.onsuccess = e => res(e.target.result || null);
        req.onerror   = e => rej(e.target.error);
      }),
      new Promise(res=>setTimeout(()=>res(null), 5000)) // 5s timeout → treat as cache miss
    ]);
  } catch(e){ console.warn('cacheGet error:',e); return null; }
}

async function cachePut(lat,lon,from,to,rawData,meta){
  try{
    const db  = await dbOpen();
    const key = cacheKey(lat,lon,from,to);
    const rec = {
      cacheKey: key,
      lat, lon, from, to,
      name:   meta.name   || '',
      prov:   meta.prov   || '',
      dist:   meta.dist   || '',
      savedAt: Date.now(),
      days:   rawData.dates.length,
      data:   rawData
    };
    // Add 10s timeout so cache never blocks UI
    await Promise.race([
      new Promise((res,rej)=>{
        const tx  = db.transaction(STORE,'readwrite');
        const req = tx.objectStore(STORE).put(rec);
        req.onsuccess = () => res();
        req.onerror   = e  => rej(e.target.error);
        tx.onerror    = e  => rej(e.target.error);
        tx.onabort    = e  => rej(new Error('Transaction aborted'));
      }),
      new Promise((_,rej)=>setTimeout(()=>rej(new Error('Cache timeout')),10000))
    ]);
    console.log(`[PakClim] Cached ${rec.days} days for ${meta.name}`);
  } catch(e){ console.warn('[PakClim] cachePut error (non-critical):',e); }
}

async function cacheList(){
  try{
    const db = await dbOpen();
    return await new Promise((res,rej)=>{
      const tx  = db.transaction(STORE,'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = e => res(e.target.result || []);
      req.onerror   = e => rej(e.target.error);
    });
  } catch(e){ return []; }
}

async function cacheDelete(key){
  try{
    const db = await dbOpen();
    await new Promise((res,rej)=>{
      const tx  = db.transaction(STORE,'readwrite');
      const req = tx.objectStore(STORE).delete(key);
      req.onsuccess = () => res();
      req.onerror   = e  => rej(e.target.error);
    });
  } catch(e){ console.warn('cacheDelete error:',e); }
}

async function cacheClear(){
  try{
    const db = await dbOpen();
    await new Promise((res,rej)=>{
      const tx  = db.transaction(STORE,'readwrite');
      const req = tx.objectStore(STORE).clear();
      req.onsuccess = () => res();
      req.onerror   = e  => rej(e.target.error);
    });
  } catch(e){ console.warn('cacheClear error:',e); }
}

// Estimate DB size (approximate — sums JSON length of all records)
async function cacheSize(){
  const all = await cacheList();
  let bytes = 0;
  for(const rec of all){
    bytes += JSON.stringify(rec.data).length;
  }
  return bytes;
}
// ── END INDEXEDDB CACHE ──────────────────────────────────────────────────────


// ── NASA POWER FETCH ─────────────────────────────────
const PARAMS='T2M,T2M_MAX,T2M_MIN,PRECTOTCORR,WS2M,RH2M,ALLSKY_SFC_SW_DWN';

// Try direct fetch first; if CORS fails use multiple proxy fallbacks
async function nasaFetch(url, signal){
  const proxyList = [
    { name:'Direct',
      fn: async () => {
        const r = await fetch(url, {signal, mode:'cors', redirect:'follow'});
        if(!r.ok) throw new Error('HTTP '+r.status);
        return r.json();
      }
    },
    { name:'corsproxy.io',
      fn: async () => {
        const r = await fetch('https://corsproxy.io/?'+encodeURIComponent(url), {signal, redirect:'follow'});
        if(!r.ok) throw new Error('HTTP '+r.status);
        return r.json();
      }
    },
    { name:'allorigins',
      fn: async () => {
        const r = await fetch('https://api.allorigins.win/get?url='+encodeURIComponent(url), {signal, redirect:'follow'});
        if(!r.ok) throw new Error('HTTP '+r.status);
        const w = await r.json();
        if(!w.contents) throw new Error('Empty response');
        return JSON.parse(w.contents);
      }
    },
    { name:'crossorigin.me',
      fn: async () => {
        const r = await fetch('https://crossorigin.me/'+url, {signal, redirect:'follow'});
        if(!r.ok) throw new Error('HTTP '+r.status);
        return r.json();
      }
    },
    { name:'thingproxy',
      fn: async () => {
        const r = await fetch('https://thingproxy.freeboard.io/fetch/'+url, {signal, redirect:'follow'});
        if(!r.ok) throw new Error('HTTP '+r.status);
        return r.json();
      }
    },
  ];

  const errors = [];
  for(const {name, fn} of proxyList){
    try {
      const data = await fn();
      if(data && (data.properties || data.type === 'Feature')){
        console.log('[nasaFetch] success via', name);
        return data;
      }
      errors.push(name+': invalid structure');
    } catch(e) {
      if(e.name === 'AbortError') throw e;
      errors.push(name+': '+e.message);
      console.warn('[nasaFetch]', name, 'failed:', e.message);
      continue;
    }
  }
  console.error('[nasaFetch] all failed:', errors);
  throw new Error('All proxies failed. Check internet connection.<br>Details: '+errors.slice(0,3).join(' | '));
}

// FIX: cap end date to yesterday (NASA POWER has ~5 day lag)
function safeEndDate(dateStr){
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate()-5);
  const d = new Date(dateStr);
  return (d > yesterday ? yesterday : d).toISOString().split('T')[0].replace(/-/g,'');
}
function toNASA(s){ return s.replace(/-/g,''); }
function fromNASA(s){ return s.slice(0,4)+'-'+s.slice(4,6)+'-'+s.slice(6,8); }

function makeChunks(from,to){
  const chunks=[], maxYrs=3;
  let cur=new Date(from);
  const end=new Date(to);
  while(cur<=end){
    const ce=new Date(cur);
    ce.setFullYear(ce.getFullYear()+maxYrs);
    ce.setDate(ce.getDate()-1);
    if(ce>end) ce.setTime(end.getTime());
    const s=toNASA(cur.toISOString().split('T')[0]);
    const e=safeEndDate(ce.toISOString().split('T')[0]);
    if(s<=e) chunks.push([s,e]);
    cur=new Date(ce); cur.setDate(cur.getDate()+1);
  }
  return chunks;
}
// FIXED FETCH BUTTON - Prevents page reload
const fbtn = document.getElementById('fbtn');
if (fbtn) {
  fbtn.type = 'button';
  fbtn.setAttribute('type', 'button');
  
  // Prevent any parent form submission
  const parentForm = fbtn.closest('form');
  if (parentForm) {
    parentForm.addEventListener('submit', function(e) {
      e.preventDefault();
      e.stopPropagation();
      return false;
    });
  }
  
  // Add click handler
  fbtn.addEventListener('click', async function(e) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    // autoFetch() manages its own button state (disabled/text/re-enable)
    // so we just call it directly without wrapping in finally that overrides it
    try {
      await autoFetch();
    } catch (err) {
      console.error('[fbtn] autoFetch error:', err);
      // Only reset button if autoFetch threw without cleaning up
      if (fbtn.disabled) {
        fbtn.disabled = false;
        updateFetchLabel();
      }
    }
    return false;
  }, false);
}


// ── LOCAL SQLITE SERVER INTEGRATION ─────────────────────────
const LOCAL_SERVER = 'http://127.0.0.1:8765';
let _localServerAvailable = null; // null=unchecked, true/false

let _checkServerPromise = null;
async function checkLocalServer(){
  // Always do a live check — never cache a failed result
  // because the server might not be up yet when the page first loads
  // Timeout is kept at 1500ms so a missing server fails fast and falls through to NASA
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(()=>ctrl.abort(), 1500);
    let r;
    try {
      r = await fetch(LOCAL_SERVER + '/health', {
        signal: ctrl.signal,
        mode: 'cors',
        cache: 'no-store'
      });
    } finally {
      clearTimeout(tid);
    }
    if(r && r.ok){
      _localServerAvailable = true;
      console.log('[PakClim] Local SQLite server is UP at', LOCAL_SERVER);
      const badge = document.querySelector('.badge-nasa');
      if(badge){ badge.textContent = '● Local DB'; badge.style.color='#4ade80'; }
    } else {
      _localServerAvailable = false;
    }
  } catch(e) {
    _localServerAvailable = false;
    console.warn('[PakClim] Server check failed:', e.message);
  }
  return _localServerAvailable;
}

// ⚡ FAST: fetch pre-aggregated summary (yearly + normals) — ~10ms
async function summaryFetch(lat, lon){
  const url = `${LOCAL_SERVER}/summary?lat=${lat}&lon=${lon}`;
  const r   = await fetch(url, {signal: AbortSignal.timeout(5000)});
  if(!r.ok) throw new Error(`Summary: HTTP ${r.status}`);
  const res = await r.json();
  if(res.error) throw new Error(res.error);
  return res;
}

// Full daily data fetch
async function localFetch(lat, lon, from, to){
  const url = `${LOCAL_SERVER}/climate?lat=${lat}&lon=${lon}&from=${from}&to=${to}`;
  const r   = await fetch(url, {signal: AbortSignal.timeout(60000)});
  if(!r.ok) throw new Error(`Local server: HTTP ${r.status}`);
  const res = await r.json();
  if(res.error) throw new Error(res.error);
  return res.data;
}

// Convert summary → raw format AND directly populate S.yearly + S.monthly
// so renderRes() works immediately without waiting for daily data
function applySummaryToState(summary){
  const sy = summary.yearly;
  const sn = summary.normals;

  // ── Build S.yearly directly from server yearly_stats ──────
  S.yearly = sy.years.map((yr, i) => ({
    year:      String(yr),
    avgTemp:   sy.T2M[i],
    maxTemp:   sy.T2M_MAX_PEAK[i],
    minTemp:   sy.T2M_MIN_PEAK[i],
    totalPrec: sy.PREC[i] ?? 0,
    avgWind:   sy.WS2M[i],
    avgSolar:  sy.SOLAR[i],
  }));

  // ── Build S.monthly from climate normals ───────────────────
  const MN_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  S.monthly = sn.months.map((mo, i) => ({
    month:        mo,
    avgTemp:      sn.T2M[i],
    avgDailyPrec: sn.PREC[i],
    avgWind:      sn.WS2M[i],
    avgSolar:     sn.SOLAR_norm ? sn.SOLAR[i] : sn.SOLAR[i],
  }));
  // Ensure all 12 months present
  for(let m=1; m<=12; m++){
    if(!S.monthly.find(x=>x.month===m))
      S.monthly.push({month:m, avgTemp:null, avgDailyPrec:null, avgWind:null, avgSolar:null});
  }
  S.monthly.sort((a,b)=>a.month-b.month);

  // ── Build minimal S.raw so renderRes() doesn't crash ──────
  // One row per month per year (enough for KPI cards + charts)
  const dates=[], T2M=[], T2M_MAX=[], T2M_MIN=[], PREC=[], WS2M=[], RH2M=[], SOLAR=[];
  const pad2 = n => String(n).padStart(2,'0');
  sy.years.forEach((yr, yi) => {
    for(let mo=1; mo<=12; mo++){
      dates.push(`${yr}${pad2(mo)}15`);
      T2M.push(sy.T2M[yi] ?? null);
      T2M_MAX.push(sy.T2M_MAX[yi] ?? null);
      T2M_MIN.push(sy.T2M_MIN[yi] ?? null);
      PREC.push(sy.PREC[yi] != null ? +(sy.PREC[yi]/12).toFixed(2) : null);
      WS2M.push(sy.WS2M[yi] ?? null);
      RH2M.push(sy.RH2M[yi] ?? null);
      SOLAR.push(sy.SOLAR[yi] ?? null);
    }
  });
  S.raw = { dates, T2M, T2M_MAX, T2M_MIN, PREC, WS2M, RH2M, SOLAR, _isSummary:true };
  S._fullRaw = null; // daily not loaded yet
}

// Server check is done on-demand per fetch — not cached at page load
// ── END LOCAL SERVER INTEGRATION ───────────────────────────

async function autoFetch(){
  if(!S.lat||!S.lon) return;
  // ── Use selected decade or year ───────────────────────
  const {from, to} = getFromTo();

  const btn=document.getElementById('fbtn');
  const pw=document.getElementById('pwrap');
  const pf=document.getElementById('pfill');
  const pl=document.getElementById('plbl');
  const pp=document.getElementById('ppct');
  const pi=document.getElementById('pinfo');

  const safetyTimer = setTimeout(()=>{
    if(btn) { btn.disabled=false; updateFetchLabel(); }
    if(pw) pw.style.display='none';
  }, 45000);

  try {

  // ── CHECK CACHE FIRST ────────────────────────────────
  btn.disabled=true;
  btn.innerHTML='<div class="spin"></div> Checking cache…';
  pw.style.display='block';
  pf.style.width='0';
  document.getElementById('cres').style.display='none';

  // First try exact match
  let cached = await cacheGet(S.lat, S.lon, from, to);

  // If no exact match, check if we have a WIDER cached range that covers the request
  if(!cached){
    cached = await cacheGet(S.lat, S.lon, BULK_FROM, BULK_TO);
    if(cached){
      // Slice the cached data to the requested date range
      applyDateFilter(from, to);
      btn.disabled=false;
      updateFetchLabel();
      pw.style.display='none';
      pl.textContent='⚡ Sliced from cached 30yr data';
      pp.textContent='100%';
      pf.style.width='100%';
      pi.textContent=`Showing ${from} → ${to}  ·  from ${cached.days.toLocaleString()} cached days`;
      pw.style.display='block';
      setTimeout(()=>pw.style.display='none', 2500);
      return;
    }
  }

  if(cached){
    // ⚡ Exact cache hit
    btn.disabled=false;
    updateFetchLabel();
    pw.style.display='none';
    S.raw = cached.data;
    S._fullRaw = cached.data;
    calcStats(); renderRes();
    pl.textContent='⚡ Loaded from cache';
    pp.textContent='100%';
    pf.style.width='100%';
    pi.textContent=`${cached.days.toLocaleString()} days  ·  saved ${new Date(cached.savedAt).toLocaleDateString()}`;
    pw.style.display='block';
    setTimeout(()=>pw.style.display='none', 2000);
    if(document.querySelector('.stab[data-t="export"].active')) renderCacheTab();
    return;
  }

  // ── CACHE MISS — try local server first, then NASA ──────────
  if(S.abort) S.abort.abort();
  S.abort = new AbortController();

  btn.innerHTML='<div class="spin"></div> Fetching …';

  // ── TRY LOCAL SQLITE SERVER ───────────────────────────────
  const serverAvailable = await checkLocalServer();
  if(serverAvailable){
    try{
      const _label = _selectedYear ? String(_selectedYear) : _selectedDecadeFrom + 's';
      pl.textContent=`⚡ Loading ${_label} from local DB…`;
      pp.textContent='50%'; pf.style.width='50%';
      const rd = await localFetch(S.lat, S.lon, from, to);
      if(!rd || !rd.dates || !rd.dates.length) throw new Error('No data from local server');
      pf.style.width='100%'; pp.textContent='100%'; pl.textContent='Processing…';
      S.raw=rd; S._fullRaw=rd; calcStats(); renderRes();
      btn.disabled=false; updateFetchLabel();
      pl.textContent='⚡ Loaded from local DB — '+rd.dates.length.toLocaleString()+' days';
      pp.textContent='100%'; pf.style.width='100%';
      pw.style.display='block';
      setTimeout(()=>pw.style.display='none', 2000);
      // Cache it for offline use
      cachePut(S.lat, S.lon, from, to, rd, {name:S.name,prov:S.prov,dist:S.dist}).catch(()=>{});
      return;
    } catch(localErr){
      console.warn('[PakClim] Local server fetch failed, falling back to NASA:', localErr.message);
      _localServerAvailable = false;
    }
  }

  // ── FALLBACK: fetch from NASA in chunks ───────────────────
  const chunks=makeChunks(from,to);
  if(!chunks.length){ showErr('Date range invalid or too recent.'); btn.disabled=false; updateFetchLabel(); return; }

  const cb={T2M:{},T2M_MAX:{},T2M_MIN:{},PRECTOTCORR:{},WS2M:{},RH2M:{},ALLSKY_SFC_SW_DWN:{}};
  let errs=0;

  for(let i=0;i<chunks.length;i++){
    const [s,e]=chunks[i];
    pl.textContent=`Chunk ${i+1}/${chunks.length}  ·  ${s.slice(0,4)}–${e.slice(0,4)}`;
    pp.textContent=Math.round(i/chunks.length*100)+'%';
    pf.style.width=(i/chunks.length*100)+'%';
    pi.textContent='Pending: '+chunks.slice(i+1).map(c=>c[0].slice(0,4)).join(' · ');
    try{
      const url=`https://power.larc.nasa.gov/api/temporal/daily/point?parameters=${PARAMS}&community=RE&longitude=${S.lon}&latitude=${S.lat}&start=${s}&end=${e}&format=JSON`;
      const j = await nasaFetch(url, S.abort.signal);
      const data=j.properties?.parameter;
      if(!data) throw new Error('No parameter data in response');
      Object.keys(cb).forEach(k=>{ if(data[k]) Object.assign(cb[k],data[k]); });
    } catch(err){
      if(err.name==='AbortError') return;
      console.warn('Chunk error:',err.message);
      errs++;
      if(errs>=2){
        showErr('⚠ Cannot reach NASA API or local server.<br><b>Fix:</b> Run <code>python pakclim_server.py --db weather_data.db</code> then reload.<br><small>'+err.message+'</small>');
        btn.disabled=false; updateFetchLabel();
        pw.style.display='none'; return;
      }
    }
    if(i<chunks.length-1) await new Promise(r=>setTimeout(r,1500));
  }

  pf.style.width='100%'; pp.textContent='100%'; pl.textContent='Processing…';

  // Build arrays
  const allDates=Object.keys(cb.T2M).sort();
  if(!allDates.length){ showErr('No data returned. Try a different date range.'); btn.disabled=false; updateFetchLabel(); pw.style.display='none'; return; }

  const rd={dates:[],T2M:[],T2M_MAX:[],T2M_MIN:[],PREC:[],WS2M:[],RH2M:[],SOLAR:[]};
  allDates.forEach(d=>{
    const t=cb.T2M[d]; if(!(t>-999)) return;
    rd.dates.push(d);
    rd.T2M.push(t);
    rd.T2M_MAX.push(cb.T2M_MAX[d]>-999?cb.T2M_MAX[d]:null);
    rd.T2M_MIN.push(cb.T2M_MIN[d]>-999?cb.T2M_MIN[d]:null);
    rd.PREC.push(cb.PRECTOTCORR[d]>-999?cb.PRECTOTCORR[d]:null);
    rd.WS2M.push(cb.WS2M[d]>-999?cb.WS2M[d]:null);
    rd.RH2M.push(cb.RH2M[d]>-999?cb.RH2M[d]:null);
    rd.SOLAR.push(cb.ALLSKY_SFC_SW_DWN[d]>-999?cb.ALLSKY_SFC_SW_DWN[d]:null);
  });

  // ── RENDER RESULTS IMMEDIATELY (don't wait for cache) ────
  S.raw=rd; S._fullRaw=rd; calcStats(); renderRes();
  btn.disabled=false; updateFetchLabel();
  pw.style.display='none';

  // ── SAVE TO CACHE IN BACKGROUND ───────────────────────
  pl.textContent='💾 Saving to cache…';
  cachePut(S.lat, S.lon, from, to, rd, {
    name: S.name, prov: S.prov, dist: S.dist
  }).then(()=>{
    console.log('[PakClim] Cached successfully');
  }).catch(e=>{
    console.warn('[PakClim] Cache save failed (non-critical):', e);
  });

  } catch(err) {
    if(err.name !== 'AbortError'){
      console.error('[autoFetch] error:', err);
      showErr('⚠ Fetch error: ' + err.message);
    }
  } finally {
    clearTimeout(safetyTimer);
    btn.disabled=false;
    updateFetchLabel();
  }
}

// ── RENDER ───────────────────────────────────────────
const vf=a=>a.filter(x=>x!=null);
const av=a=>{const b=vf(a);return b.length?b.reduce((s,x)=>s+x,0)/b.length:NaN;};
const fT=n=>isNaN(n)?'—':n.toFixed(1)+'°';
const fP=n=>isNaN(n)?'—':n.toFixed(0)+'mm';
const fW=n=>isNaN(n)?'—':n.toFixed(1)+'m/s';
const MN=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const GC={x:{ticks:{color:'#94a3b8',font:{size:11},maxTicksLimit:12},grid:{color:'rgba(0,0,0,0.06)'}},
          y:{ticks:{color:'#94a3b8',font:{size:11}},grid:{color:'rgba(0,0,0,0.06)'}}};

// ── ANIMATED CHART ENGINE ────────────────────────────
// A glowing dot travels the chart line automatically when data loads.
// Custom Chart.js plugin draws the dot + tooltip label at each frame.
// Uses requestAnimationFrame for smooth interpolation between points.

const chartInstances = {}; // id → {chart, raf, playing}

// Unit helper
function chartUnit(id){
  if(/TC|yTC|mTC|exDC/.test(id)) return '°C';
  if(/PC|yRC|mRC/.test(id))      return ' mm';
  if(/WC|mWC/.test(id))          return ' m/s';
  if(/SC/.test(id))               return ' kWh/m²';
  return '';
}

// Temp color ramp
function tempColor(v){
  if(v>=42) return '#ff2222';
  if(v>=38) return '#ff4444';
  if(v>=34) return '#f97316';
  if(v>=28) return '#fbbf24';
  if(v>=20) return '#4ade80';
  if(v>=10) return '#22d3ee';
  return '#60a5fa';
}

function mkC(id, type, labels, datasets){
  // Stop any existing animation for this chart
  if(chartInstances[id]){
    cancelAnimationFrame(chartInstances[id].raf);
    chartInstances[id].chart.destroy();
    delete chartInstances[id];
  }
  const ex = Chart.getChart(id); if(ex) ex.destroy();
  const ctx = document.getElementById(id); if(!ctx) return;

  // State for travelling dot
  const state = {
    t: 0,          // fractional index 0..N-1 (float for smooth travel)
    playing: true,
    raf: null,
    chart: null,
    speed: 0.012,   // points per frame
  };
  chartInstances[id] = state;

  const isTemp = /TC|yTC|mTC/.test(id);
  const unit   = chartUnit(id);

  // Custom plugin: draws the animated dot + floating label
  const dotPlugin = {
    id: 'travelDot',
    afterDatasetsDraw(chart) {
      if(!chart._dotT && chart._dotT !== 0) return;
      const t    = chart._dotT;
      const n    = labels.length;
      if(n < 2) return;

      // Find first dataset with data
      let dsIdx = 0;
      for(let di=0; di<chart.data.datasets.length; di++){
        if(chart.data.datasets[di].data.some(v=>v!=null)){ dsIdx=di; break; }
      }
      const meta = chart.getDatasetMeta(dsIdx);
      if(!meta.data.length) return;

      const i0 = Math.floor(t) % n;
      const i1 = Math.ceil(t)  % n;
      const f  = t - Math.floor(t);

      const p0 = meta.data[i0];
      const p1 = meta.data[i1];
      if(!p0 || !p1) return;

      // Interpolate x/y
      const x = p0.x + (p1.x - p0.x) * f;
      const y = p0.y + (p1.y - p0.y) * f;

      // Interpolate value
      const v0 = chart.data.datasets[dsIdx].data[i0];
      const v1 = chart.data.datasets[dsIdx].data[i1];
      const val = (v0!=null && v1!=null) ? v0 + (v1-v0)*f
                : (v0!=null ? v0 : v1);

      const label = labels[i0] || '';
      const valStr = val!=null ? (typeof val==='number' ? val.toFixed(1) : val)+unit : '—';
      const dotColor = isTemp && typeof val==='number' ? tempColor(val)
                     : (chart.data.datasets[dsIdx].borderColor || '#4a9eff');

      const c2 = chart.ctx;
      c2.save();

      // Vertical dashed line from dot to x-axis
      c2.setLineDash([3,3]);
      c2.strokeStyle = `${dotColor}44`;
      c2.lineWidth = 1;
      c2.beginPath();
      c2.moveTo(x, chart.chartArea.bottom);
      c2.lineTo(x, y);
      c2.stroke();
      c2.setLineDash([]);

      // Outer glow ring
      const grd = c2.createRadialGradient(x, y, 2, x, y, 14);
      grd.addColorStop(0, `${dotColor}55`);
      grd.addColorStop(1, `${dotColor}00`);
      c2.beginPath();
      c2.arc(x, y, 14, 0, Math.PI*2);
      c2.fillStyle = grd;
      c2.fill();

      // Dot
      c2.beginPath();
      c2.arc(x, y, 5, 0, Math.PI*2);
      c2.fillStyle = '#ffffff';
      c2.fill();
      c2.strokeStyle = dotColor;
      c2.lineWidth = 2.5;
      c2.stroke();

      // Floating label box above the dot
      const lbl = `${label}  ${valStr}`;
      c2.font = "bold 9px 'JetBrains Mono', monospace";
      const tw = c2.measureText(lbl).width;
      const bw = tw + 14, bh = 18, br = 5;
      let bx = x - bw/2;
      let by = y - 32;
      // keep inside chart
      bx = Math.max(chart.chartArea.left, Math.min(chart.chartArea.right - bw, bx));
      by = Math.max(chart.chartArea.top,  by);

      // Box background
      c2.beginPath();
      c2.roundRect(bx, by, bw, bh, br);
      c2.fillStyle = 'rgba(4,12,28,.92)';
      c2.fill();
      c2.strokeStyle = `${dotColor}aa`;
      c2.lineWidth = 1;
      c2.stroke();

      // Label text
      c2.fillStyle = '#ffffff';
      c2.textAlign = 'left';
      c2.textBaseline = 'middle';
      c2.fillText(lbl, bx+7, by+bh/2);

      c2.restore();
    }
  };

  const chart = new Chart(ctx, {
    type,
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      animation: { duration: 600, easing: 'easeOutQuart' },
      plugins: {
        legend: { display: datasets.length>1, labels:{color:'#94a3b8',font:{size:11},boxWidth:12} },
        tooltip: { enabled: false }  // disabled — our dot label replaces it
      },
      scales: {
        x: { ticks:{color:'#94a3b8',font:{size:11},maxTicksLimit:12}, grid:{color:'rgba(0,0,0,0.06)'} },
        y: { ticks:{color:'#94a3b8',font:{size:11}}, grid:{color:'rgba(0,0,0,0.06)'} }
      }
    },
    plugins: [dotPlugin]
  });

  state.chart = chart;

  // Speed: faster for more points so it finishes in ~8 seconds
  const n = labels.length;
  state.speed = Math.max(0.006, Math.min(0.06, n / 1600));

  // Start animation after Chart.js initial draw (600ms)
  setTimeout(()=>{
    function animate(){
      if(!state.playing){ state.raf = null; return; }
      state.t += state.speed;
      if(state.t >= n - 1) state.t = 0; // loop
      chart._dotT = state.t;
      chart.update('none');
      state.raf = requestAnimationFrame(animate);
    }
    state.raf = requestAnimationFrame(animate);
  }, 650);

  return chart;
}


// calcStats — stats are computed inline in renderRes; this is a no-op stub
function calcStats(){
  try {
    if(!S.raw || !S.raw.dates || !S.raw.dates.length) return;
    const rd = S.raw;

    // Helper: safe numeric check
    const ok = v => v != null && v !== undefined && v > -999 && isFinite(v);

    // Helper: extract month from date string (handles both "2024-01-15" and "20240115")
    const getYr = d => d.length === 8 ? d.slice(0,4) : d.slice(0,4);
    const getMo = d => d.length === 8 ? parseInt(d.slice(4,6)) : parseInt(d.slice(5,7));

    // Safe array accessors
    const T2M     = rd.T2M     || [];
    const T2M_MAX = rd.T2M_MAX || [];
    const T2M_MIN = rd.T2M_MIN || [];
    const PREC    = rd.PREC    || [];
    const WS2M    = rd.WS2M    || [];
    const SOLAR   = rd.SOLAR   || [];

    // ── Build S.yearly ──
    const yMap = {};
    rd.dates.forEach((d,i) => {
      const yr = getYr(d);
      if(!yr || yr.length !== 4) return;
      if(!yMap[yr]) yMap[yr] = {year:yr, temps:[], maxTemps:[], minTemps:[], prec:[], wind:[], solar:[]};
      if(ok(T2M[i]))     yMap[yr].temps.push(T2M[i]);
      if(ok(T2M_MAX[i])) yMap[yr].maxTemps.push(T2M_MAX[i]);
      if(ok(T2M_MIN[i])) yMap[yr].minTemps.push(T2M_MIN[i]);
      if(ok(PREC[i]))    yMap[yr].prec.push(PREC[i]);
      if(ok(WS2M[i]))    yMap[yr].wind.push(WS2M[i]);
      if(ok(SOLAR[i]))   yMap[yr].solar.push(SOLAR[i]);
    });

    const avg = arr => arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : null;

    S.yearly = Object.values(yMap)
      .sort((a,b) => a.year.localeCompare(b.year))
      .map(y => ({
        year:      y.year,
        avgTemp:   avg(y.temps),
        maxTemp:   y.maxTemps.length ? Math.max(...y.maxTemps) : null,
        minTemp:   y.minTemps.length ? Math.min(...y.minTemps) : null,
        totalPrec: y.prec.length     ? y.prec.reduce((a,b)=>a+b,0) : 0,
        avgWind:   avg(y.wind),
        avgSolar:  avg(y.solar),
      }));

    // ── Build S.monthly ──
    const mMap = {};
    for(let i=1; i<=12; i++) mMap[i] = {month:i, temps:[], prec:[], wind:[], solar:[]};
    rd.dates.forEach((d,i) => {
      const mo = getMo(d);
      if(!mo || mo < 1 || mo > 12) return;
      if(ok(T2M[i]))  mMap[mo].temps.push(T2M[i]);
      if(ok(PREC[i])) mMap[mo].prec.push(PREC[i]);
      if(ok(WS2M[i])) mMap[mo].wind.push(WS2M[i]);
      if(ok(SOLAR[i]))mMap[mo].solar.push(SOLAR[i]);
    });

    S.monthly = Object.values(mMap).map(m => ({
      month:        m.month,
      avgTemp:      avg(m.temps) !== null ? +avg(m.temps).toFixed(2) : null,
      avgDailyPrec: m.prec.length  ? +avg(m.prec).toFixed(2)  : 0,
      avgWind:      avg(m.wind)  !== null ? +avg(m.wind).toFixed(2)  : null,
      avgSolar:     avg(m.solar) !== null ? +avg(m.solar).toFixed(2) : null,
    }));

  } catch(e) {
    console.error('[calcStats] error:', e);
    S.yearly  = S.yearly  || [];
    S.monthly = S.monthly || [];
  }
}

function renderRes(){
  const rd=S.raw, cr=document.getElementById('cres');
  cr.className='fi'; cr.style.display='flex';
  const nD=rd.dates.length, nY=new Set(rd.dates.map(d=>d.slice(0,4))).size;
  const aT=av(rd.T2M), mxT=Math.max(...vf(rd.T2M_MAX)), mnT=Math.min(...vf(rd.T2M_MIN));
  const aP=vf(rd.PREC).reduce((a,b)=>a+b,0)/nY, aW=av(rd.WS2M);
  cr.innerHTML=`
    <div class="ksec"><div class="slbl">${nY} yrs · ${nD.toLocaleString()} days</div>
      <div class="kgrid">
        <div class="kpi"><div class="kv">${fT(aT)}</div><div class="kl">Mean Temp</div></div>
        <div class="kpi"><div class="kv hot">${fT(mxT)}</div><div class="kl">Record High</div></div>
        <div class="kpi"><div class="kv cold">${fT(mnT)}</div><div class="kl">Record Low</div></div>
        <div class="kpi"><div class="kv rain">${fP(aP)}</div><div class="kl">Avg Annual Rain</div></div>
        <div class="kpi"><div class="kv wind">${fW(aW)}</div><div class="kl">Mean Wind</div></div>
        <div class="kpi"><div class="kv">${fT(mxT-mnT)}</div><div class="kl">Temp Range</div></div>
      </div></div>
    <div class="csec">
      <div class="chd"><div class="ctit">Temperature</div>
        <div class="ctabs">
          <button class="ctab active" data-c="T" data-m="mo">Monthly</button>
          <button class="ctab" data-c="T" data-m="yr">Yearly</button>
          <button class="ctab" data-c="T" data-m="dy">Daily</button>
        </div></div>
      <div class="cwrap"><canvas id="mainTC"></canvas></div></div>
    <div class="csec">
      <div class="chd"><div class="ctit">Precipitation</div>
        <div class="ctabs">
          <button class="ctab active" data-c="P" data-m="mo">Monthly</button>
          <button class="ctab" data-c="P" data-m="yr">Yearly</button>
          <button class="ctab" data-c="P" data-m="dy">Daily</button>
        </div></div>
      <div class="cwrap"><canvas id="mainPC"></canvas></div></div>
    <div class="csec">
      <div class="chd"><div class="ctit">Wind Speed (m/s)</div>
        <div class="ctabs">
          <button class="ctab active" data-c="W" data-m="mo">Monthly</button>
          <button class="ctab" data-c="W" data-m="yr">Yearly</button>
          <button class="ctab" data-c="W" data-m="dy">Daily</button>
        </div></div>
      <div class="cwrap"><canvas id="mainWC"></canvas></div></div>
    <div class="csec"><div class="chd"><div class="ctit">Solar Radiation (kWh/m²/day)</div>
        <div class="ctabs">
          <button class="ctab active" data-c="S" data-m="mo">Monthly</button>
          <button class="ctab" data-c="S" data-m="dy">Daily</button>
        </div></div>
      <div class="cwrap"><canvas id="mainSC"></canvas></div></div>`;

  document.querySelectorAll('.ctab').forEach(t=>t.onclick=function(){
    const c=this.dataset.c, m=this.dataset.m;
    document.querySelectorAll(`.ctab[data-c="${c}"]`).forEach(x=>x.classList.toggle('active',x===this));
    if(c==='T') drawT(m);
    else if(c==='P') drawP(m);
    else if(c==='W') drawW(m);
    else if(c==='S') drawSol(m);
  });
  drawT('mo'); drawP('mo'); drawW('mo'); drawSol('mo');
  renderYearly(); renderMonthly(); renderExplorer(); renderCompare(1);
  document.getElementById('expInfo').textContent=`${S.name} · ${nY} yrs · ${nD.toLocaleString()} days`;
}

// helper: thin daily data for performance (max ~400 pts)
function thinDaily(dates, vals, step){
  const s=step||Math.max(1,Math.floor(dates.length/400));
  const lb=[], dv=[];
  for(let i=0;i<dates.length;i+=s){
    const d=dates[i]; lb.push(d.slice(0,4)+'-'+d.slice(4,6)+'-'+d.slice(6,8));
    dv.push(vals[i]);
  }
  return {lb,dv};
}

function drawT(m){
  if(m==='mo') mkC('mainTC','line',MN,[{label:'Mean °C',data:S.monthly.map(x=>x.avgTemp),borderColor:'#4a9eff',backgroundColor:'rgba(74,158,255,.08)',fill:true,tension:.4,pointRadius:3,borderWidth:1.5}]);
  else if(m==='yr'){ const yr=S.yearly; mkC('mainTC','line',yr.map(y=>y.year),[
    {label:'Avg',data:yr.map(y=>y.avgTemp?+y.avgTemp.toFixed(2):null),borderColor:'#4a9eff',fill:false,tension:.3,pointRadius:2,borderWidth:1.5},
    {label:'Max',data:yr.map(y=>y.maxTemp?+y.maxTemp.toFixed(1):null),borderColor:'#7b2fbe',fill:false,tension:.3,pointRadius:0,borderWidth:1,borderDash:[3,3]},
    {label:'Min',data:yr.map(y=>y.minTemp?+y.minTemp.toFixed(1):null),borderColor:'#8b1a1a',fill:false,tension:.3,pointRadius:0,borderWidth:1,borderDash:[3,3]}
  ]); }
  else if(m==='dy'){ const {lb,dv}=thinDaily(S.raw.dates,S.raw.T2M); mkC('mainTC','line',lb,[{label:'Daily °C',data:dv,borderColor:'#4a9eff',backgroundColor:'rgba(74,158,255,.05)',fill:true,tension:.1,pointRadius:0,borderWidth:1}]); }
}
function drawP(m){
  if(m==='mo') mkC('mainPC','bar',MN,[{label:'Avg Daily mm',data:S.monthly.map(x=>x.avgDailyPrec),backgroundColor:'rgba(6,182,212,.45)',borderColor:'#06b6d4',borderWidth:1}]);
  else if(m==='yr'){ const yr=S.yearly; mkC('mainPC','bar',yr.map(y=>y.year),[{label:'Annual mm',data:yr.map(y=>+y.totalPrec.toFixed(0)),backgroundColor:'rgba(6,182,212,.4)',borderColor:'#06b6d4',borderWidth:1}]); }
  else if(m==='dy'){ const {lb,dv}=thinDaily(S.raw.dates,S.raw.PREC); mkC('mainPC','bar',lb,[{label:'Daily mm',data:dv,backgroundColor:'rgba(6,182,212,.5)',borderColor:'#06b6d4',borderWidth:0}]); }
}
function drawW(m){
  if(m==='yr'){ const yr=S.yearly; mkC('mainWC','line',yr.map(y=>y.year),[{label:'Avg m/s',data:yr.map(y=>y.avgWind?+y.avgWind.toFixed(2):null),borderColor:'#8b1a1a',fill:false,tension:.3,pointRadius:2,borderWidth:1.5}]); }
  else if(m==='dy'){ const {lb,dv}=thinDaily(S.raw.dates,S.raw.WS2M); mkC('mainWC','line',lb,[{label:'Daily m/s',data:dv,borderColor:'#8b1a1a',backgroundColor:'rgba(34,197,94,.05)',fill:true,tension:.1,pointRadius:0,borderWidth:1}]); }
  else mkC('mainWC','line',MN,[{label:'m/s',data:S.monthly.map(x=>x.avgWind),borderColor:'#8b1a1a',backgroundColor:'rgba(34,197,94,.07)',fill:true,tension:.4,pointRadius:3,borderWidth:1.5}]);
}
function drawSol(m){
  const md={}; S.raw.dates.forEach((d,i)=>{ const mo=parseInt(d.slice(4,6)); if(!md[mo]) md[mo]=[]; if(S.raw.SOLAR[i]!=null) md[mo].push(S.raw.SOLAR[i]); });
  if(m==='dy'){ const {lb,dv}=thinDaily(S.raw.dates,S.raw.SOLAR); mkC('mainSC','line',lb,[{label:'kWh/m²/d',data:dv,borderColor:'#eab308',backgroundColor:'rgba(234,179,8,.05)',fill:true,tension:.1,pointRadius:0,borderWidth:1}]); }
  else{ const v=Array.from({length:12},(_,i)=>{ const a=md[i+1]||[]; return a.length?+(a.reduce((s,x)=>s+x,0)/a.length).toFixed(2):null; }); mkC('mainSC','line',MN,[{label:'kWh/m²/d',data:v,borderColor:'#eab308',backgroundColor:'rgba(234,179,8,.07)',fill:true,tension:.4,pointRadius:3,borderWidth:1.5}]); }
}

// ── EXPLORER: Year → Month → Day ─────────────────────
function renderExplorer(){
  if(!S.raw){ return; }
  document.getElementById('exEmpty').style.display='none';
  document.getElementById('exContent').style.display='flex';
  // build year list
  const years=[...new Set(S.raw.dates.map(d=>d.slice(0,4)))].sort();
  const yg=document.getElementById('exYearGrid');
  yg.innerHTML=years.map(y=>`<button class="ex-yr" data-y="${y}">${y}</button>`).join('');
  document.getElementById('exYears').style.display='block';
  document.getElementById('exMonths').style.display='none';
  document.getElementById('exDays').style.display='none';
  updateBread(null,null);
  yg.querySelectorAll('.ex-yr').forEach(b=>b.onclick=function(){
    yg.querySelectorAll('.ex-yr').forEach(x=>x.classList.remove('active'));
    this.classList.add('active');
    showExMonths(this.dataset.y);
  });
}

function updateBread(year, month){
  const el=document.getElementById('exBread');
  let h=`<span class="ex-bread-item" id="bHome">All Years</span>`;
  if(year){ h+=`<span class="ex-bread-sep"> › </span><span class="${month?'ex-bread-item':''}\" ${month?'id="bYear"':''}>${year}</span>`; }
  if(month){ h+=`<span class="ex-bread-sep"> › </span><span>${MN[month-1]}</span>`; }
  el.innerHTML=h;
  el.querySelector('#bHome')?.addEventListener('click',()=>{ renderExplorer(); switchTab('explorer'); });
  el.querySelector('#bYear')?.addEventListener('click',()=>{ showExMonths(year); });
}

function showExMonths(year){
  document.getElementById('exYears').style.display='none';
  document.getElementById('exDays').style.display='none';
  const sec=document.getElementById('exMonths');
  sec.style.display='block';
  document.getElementById('exMonthTitle').textContent=`${year} — Select a Month`;
  updateBread(year, null);

  // Get data for this year
  const rd=S.raw;
  const yIdx=rd.dates.reduce((acc,d,i)=>{ if(d.startsWith(year)) acc.push(i); return acc; },[]);

  // Monthly summary for this year
  const mData={};
  for(let m=1;m<=12;m++) mData[m]={T:[],P:[],W:[]};
  yIdx.forEach(i=>{
    const m=parseInt(rd.dates[i].slice(4,6));
    if(rd.T2M[i]!=null) mData[m].T.push(rd.T2M[i]);
    if(rd.PREC[i]!=null) mData[m].P.push(rd.PREC[i]);
    if(rd.WS2M[i]!=null) mData[m].W.push(rd.WS2M[i]);
  });
  const mavg=a=>a.length?+(a.reduce((s,x)=>s+x,0)/a.length).toFixed(1):null;
  const msum=a=>a.length?+(a.reduce((s,x)=>s+x,0)).toFixed(0):null;

  // Month buttons with mini stats
  const mg=document.getElementById('exMonthGrid');
  mg.innerHTML=MN.map((mn,i)=>{
    const m=i+1, t=mavg(mData[m].T), p=msum(mData[m].P);
    const tStr=t!=null?`<span style="color:#4a9eff;font-size:.68rem">${t}°</span>`:'';
    const pStr=p!=null?`<span style="color:#06b6d4;font-size:.65rem">${p}mm</span>`:'';
    return `<button class="ex-mo" data-y="${year}" data-m="${m}">
      <div style="font-weight:700;font-size:.72rem">${mn}</div>
      <div style="display:flex;gap:.2rem;justify-content:center;margin-top:.1rem">${tStr}${pStr}</div>
    </button>`;
  }).join('');

  // Draw year-overview chart
  const mc=document.getElementById('exMonthCharts');
  mc.innerHTML=`<canvas id="exMC" style="max-height:120px"></canvas>`;
  const temps=Array.from({length:12},(_,i)=>mavg(mData[i+1].T));
  const precs=Array.from({length:12},(_,i)=>msum(mData[i+1].P));
  const exMChart=Chart.getChart('exMC'); if(exMChart) exMChart.destroy();
  new Chart(document.getElementById('exMC'),{
    type:'bar',
    data:{labels:MN,datasets:[
      {label:'Rain mm',data:precs,backgroundColor:'rgba(6,182,212,.45)',borderColor:'#06b6d4',borderWidth:1,yAxisID:'y1'},
      {label:'Avg°C',data:temps,type:'line',borderColor:'#4a9eff',backgroundColor:'transparent',pointRadius:3,borderWidth:2,tension:.4,yAxisID:'y2'}
    ]},
    options:{responsive:true,maintainAspectRatio:true,
      plugins:{legend:{display:true,labels:{color:'#94a3b8',font:{size:7},boxWidth:8}}},
      scales:{
        x:{ticks:{color:'#94a3b8',font:{size:7}},grid:{color:'rgba(0,0,0,0.06)'}},
        y1:{position:'left',ticks:{color:'#06b6d4',font:{size:7}},grid:{color:'rgba(30,50,80,.2)'}},
        y2:{position:'right',ticks:{color:'#4a9eff',font:{size:7}},grid:{display:false}}
      }}
  });

  mg.querySelectorAll('.ex-mo').forEach(b=>b.onclick=function(){
    mg.querySelectorAll('.ex-mo').forEach(x=>x.classList.remove('active'));
    this.classList.add('active');
    showExDays(this.dataset.y, parseInt(this.dataset.m));
  });
}

function showExDays(year, month){
  document.getElementById('exDays').style.display='block';
  document.getElementById('exDayTitle').textContent=`${MN[month-1]} ${year} — Day by Day`;
  updateBread(year, month);

  const rd=S.raw;
  const ym=year+String(month).padStart(2,'0');
  const rows=rd.dates.reduce((acc,d,i)=>{
    if(d.startsWith(ym)) acc.push({
      date:d, day:parseInt(d.slice(6,8)),
      T:rd.T2M[i], Tmax:rd.T2M_MAX[i], Tmin:rd.T2M_MIN[i],
      P:rd.PREC[i], W:rd.WS2M[i], H:rd.RH2M[i], S:rd.SOLAR[i]
    });
    return acc;
  },[]);

  if(!rows.length){ document.getElementById('exDayTable').innerHTML='<div class="empty">No data for this month.</div>'; return; }

  // Daily chart
  const dc=document.getElementById('exDayChart');
  dc.innerHTML='<canvas id="exDC"></canvas>';
  const exDChart=Chart.getChart('exDC'); if(exDChart) exDChart.destroy();
  new Chart(document.getElementById('exDC'),{
    type:'bar',
    data:{labels:rows.map(r=>r.day),datasets:[
      {label:'Rain mm',data:rows.map(r=>r.P),backgroundColor:'rgba(6,182,212,.5)',borderColor:'#06b6d4',borderWidth:0,yAxisID:'y1'},
      {label:'Max°C',data:rows.map(r=>r.Tmax),type:'line',borderColor:'#7b2fbe',backgroundColor:'transparent',pointRadius:2,borderWidth:1.5,tension:.3,yAxisID:'y2'},
      {label:'Avg°C',data:rows.map(r=>r.T),type:'line',borderColor:'#4a9eff',backgroundColor:'transparent',pointRadius:2,borderWidth:2,tension:.3,yAxisID:'y2'},
      {label:'Min°C',data:rows.map(r=>r.Tmin),type:'line',borderColor:'#8b1a1a',backgroundColor:'transparent',pointRadius:2,borderWidth:1.5,tension:.3,yAxisID:'y2'}
    ]},
    options:{responsive:true,maintainAspectRatio:true,
      plugins:{legend:{display:true,labels:{color:'#94a3b8',font:{size:7},boxWidth:8}}},
      scales:{
        x:{ticks:{color:'#94a3b8',font:{size:7}},grid:{color:'rgba(30,50,80,.2)'},title:{display:true,text:'Day',color:'#94a3b8',font:{size:7}}},
        y1:{position:'left',ticks:{color:'#06b6d4',font:{size:7}},grid:{color:'rgba(30,50,80,.2)'}},
        y2:{position:'right',ticks:{color:'#4a9eff',font:{size:7}},grid:{display:false}}
      }}
  });

  // Daily table
  const maxT=Math.max(...rows.map(r=>r.Tmax||0));
  const minT=Math.min(...rows.map(r=>r.Tmin!=null?r.Tmin:999));
  document.getElementById('exDayTable').innerHTML=`
    <table class="day-tbl">
      <thead><tr><th>Day</th><th>Avg°</th><th>Max</th><th>Min</th><th>Rain</th><th>Wind</th><th>Hum</th><th>Solar</th></tr></thead>
      <tbody>${rows.map(r=>`<tr>
        <td style="color:var(--txt)">${r.day}</td>
        <td>${r.T!=null?r.T.toFixed(1)+'°':'—'}</td>
        <td class="${r.Tmax===maxT?'day-hot':''}">${r.Tmax!=null?r.Tmax.toFixed(1)+'°':'—'}</td>
        <td class="${r.Tmin===minT?'day-cold':''}">${r.Tmin!=null?r.Tmin.toFixed(1)+'°':'—'}</td>
        <td class="${r.P>0?'day-rain':''}">${r.P!=null?r.P.toFixed(1):'—'}</td>
        <td class="day-wind">${r.W!=null?r.W.toFixed(1):'—'}</td>
        <td>${r.H!=null?Math.round(r.H)+'%':'—'}</td>
        <td>${r.S!=null?r.S.toFixed(1):'—'}</td>
      </tr>`).join('')}</tbody>
    </table>`;
}

// ── YEARLY INTERACTIVE ──────────────────────────────
let ySelYear = null;   // currently selected year string
let yTChart = null, yRChart = null, yWChart = null;
let yTPlaying = true, yRPlaying = true, yWPlaying = true;
let yTRaf = null, yRRaf = null, yWRaf = null;
let yTt = 0, yRt = 0, yWt = 0;
const Y_SPEED = 0.007; // slow, readable speed

function ySelYearFn(yearStr) {
  ySelYear = yearStr;
  const yr = S.yearly;
  const y = yr.find(x => x.year === yearStr);
  if (!y) return;
  document.getElementById('ykYear').textContent = yearStr;
  document.getElementById('ykMax').innerHTML  = `${y.maxTemp?.toFixed(1)||'—'} <span>Max°C</span>`;
  document.getElementById('ykMin').innerHTML  = `${y.minTemp?.toFixed(1)||'—'} <span>Min°C</span>`;
  document.getElementById('ykAvg').innerHTML  = `${y.avgTemp?.toFixed(1)||'—'} <span>Avg°C</span>`;
  document.getElementById('ykRain').innerHTML = `${y.totalPrec?.toFixed(0)||'—'} <span>Rain mm</span>`;
  document.getElementById('ykWind').innerHTML = `${y.avgWind?.toFixed(1)||'—'} <span>Wind m/s</span>`;
  // highlight year buttons
  document.querySelectorAll('.yyr-btn').forEach(b => b.classList.toggle('active', b.dataset.y === yearStr));
  // highlight table row
  document.querySelectorAll('#ytw tr[data-y]').forEach(r => r.classList.toggle('ytbl-sel', r.dataset.y === yearStr));
  // pin dot on charts
  [yTChart, yRChart, yWChart].forEach(c => { if(c){ c._pinYear = yearStr; c.update('none'); } });
}

function mkYChart(id, type, labels, datasets, onClickYear) {
  const ex = Chart.getChart(id); if(ex) ex.destroy();
  const ctx = document.getElementById(id); if(!ctx) return null;
  const n = labels.length;
  const isTemp = id === 'yTC';
  const yUnit = id === 'yTC' ? '°C' : id === 'yRC' ? ' mm' : ' m/s';

  // Self-contained travel-dot plugin for yearly charts
  const dotPlugin = {
    id: 'travelDotY',
    afterDatasetsDraw(chart) {
      if(!chart._dotT && chart._dotT !== 0) return;
      const t = chart._dotT;
      if(n < 2) return;
      let dsIdx = 0;
      for(let di=0; di<chart.data.datasets.length; di++){
        if(!chart.data.datasets[di].hidden && chart.data.datasets[di].data.some(v=>v!=null)){ dsIdx=di; break; }
      }
      const meta = chart.getDatasetMeta(dsIdx);
      if(!meta || !meta.data.length) return;
      const i0 = Math.floor(t) % n;
      const i1 = Math.min(Math.ceil(t), n-1);
      const f  = t - Math.floor(t);
      const p0 = meta.data[i0], p1 = meta.data[i1];
      if(!p0 || !p1) return;
      const x = p0.x + (p1.x - p0.x) * f;
      const y = p0.y + (p1.y - p0.y) * f;
      const v0 = chart.data.datasets[dsIdx].data[i0];
      const v1 = chart.data.datasets[dsIdx].data[i1];
      const val = (v0!=null && v1!=null) ? v0+(v1-v0)*f : (v0!=null?v0:v1);
      const label = labels[i0] || '';
      const valStr = val!=null ? val.toFixed(1)+yUnit : '—';
      const dotColor = isTemp && typeof val==='number' ? tempColor(val)
                     : (chart.data.datasets[dsIdx].borderColor || '#4a9eff');
      const c2 = chart.ctx;
      c2.save();
      c2.setLineDash([3,3]);
      c2.strokeStyle = dotColor+'44'; c2.lineWidth=1;
      c2.beginPath(); c2.moveTo(x,chart.chartArea.bottom); c2.lineTo(x,y); c2.stroke();
      c2.setLineDash([]);
      const grd = c2.createRadialGradient(x,y,2,x,y,14);
      grd.addColorStop(0,dotColor+'55'); grd.addColorStop(1,dotColor+'00');
      c2.beginPath(); c2.arc(x,y,14,0,Math.PI*2); c2.fillStyle=grd; c2.fill();
      c2.beginPath(); c2.arc(x,y,5,0,Math.PI*2);
      c2.fillStyle='#ffffff'; c2.fill();
      c2.strokeStyle=dotColor; c2.lineWidth=2.5; c2.stroke();
      const lbl = label+'  '+valStr;
      c2.font = "bold 9px 'JetBrains Mono',monospace";
      const tw = c2.measureText(lbl).width;
      const bw=tw+14, bh=18, br=5;
      let bx=x-bw/2, by=y-32;
      bx=Math.max(chart.chartArea.left, Math.min(chart.chartArea.right-bw, bx));
      by=Math.max(chart.chartArea.top, by);
      c2.beginPath(); c2.roundRect(bx,by,bw,bh,br);
      c2.fillStyle='rgba(4,12,28,.92)'; c2.fill();
      c2.strokeStyle=dotColor+'aa'; c2.lineWidth=1; c2.stroke();
      c2.fillStyle='#ffffff'; c2.textAlign='left'; c2.textBaseline='middle';
      c2.fillText(lbl, bx+7, by+bh/2);
      c2.restore();
    }
  };

  // pin-year plugin: draws a vertical highlight for selected year
  const pinPlugin = {
    id: 'pinYear',
    afterDatasetsDraw(chart) {
      const yr = chart._pinYear;
      if (!yr) return;
      const idx = labels.indexOf(yr);
      if (idx < 0) return;
      const meta = chart.getDatasetMeta(0);
      if (!meta.data[idx]) return;
      const x = meta.data[idx].x;
      const { top, bottom } = chart.chartArea;
      const c2 = chart.ctx;
      c2.save();
      c2.strokeStyle = 'rgba(255,200,80,.6)';
      c2.lineWidth = 1.5;
      c2.setLineDash([3, 3]);
      c2.beginPath(); c2.moveTo(x, top); c2.lineTo(x, bottom); c2.stroke();
      c2.setLineDash([]);
      // dot marker on dataset 0
      const val = chart.data.datasets[0].data[idx];
      if (val != null) {
        const y = meta.data[idx].y;
        c2.beginPath(); c2.arc(x, y, 5, 0, Math.PI*2);
        c2.fillStyle = '#ffd700'; c2.fill();
        c2.strokeStyle = '#fff'; c2.lineWidth = 1.5; c2.stroke();
      }
      c2.restore();
    }
  };

  const chart = new Chart(ctx, {
    type,
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      animation: { duration: 500, easing: 'easeOutQuart' },
      onClick(evt) {
        const pts = chart.getElementsAtEventForMode(evt, 'index', { intersect: false }, true);
        if (pts.length) { onClickYear(labels[pts[0].index]); }
      },
      onHover(evt, els) { ctx.style.cursor = els.length ? 'pointer' : 'default'; },
      plugins: {
        legend: { display: datasets.length > 1, labels: { color: '#6a85a8', font: { size: 8 }, boxWidth: 10 } },
        tooltip: {
          enabled: true,
          backgroundColor: 'rgba(4,12,28,.92)',
          titleColor: '#ffd700',
          bodyColor: '#a0b4cc',
          borderColor: '#1e3a5f',
          borderWidth: 1,
          titleFont: { family: "'JetBrains Mono',monospace", size: 9 },
          bodyFont: { family: "'JetBrains Mono',monospace", size: 8 },
          callbacks: {
            title: items => items[0].label,
            label: item => ` ${item.dataset.label}: ${item.formattedValue}${isTemp ? '°C' : item.datasetIndex === 0 && id === 'yRC' ? ' mm' : ''}`
          }
        }
      },
      scales: {
        x: { ticks: { color: '#3a5070', font: { size: 8 }, maxTicksLimit: 12 }, grid: { color: 'rgba(0,0,0,0.06)' } },
        y: { ticks: { color: '#3a5070', font: { size: 8 } }, grid: { color: 'rgba(0,0,0,0.06)' } }
      }
    },
    plugins: [dotPlugin, pinPlugin]
  });

  chart._pinYear = null;
  return chart;
}

function yStartAnim(which) {
  const yr = S.yearly;
  const labels = yr.map(y => y.year);
  const n = labels.length;
  const speed = Math.max(Y_SPEED, Math.min(0.02, n / 1800));

  function loopT() {
    if (!yTPlaying) { yTRaf = null; return; }
    yTt = (yTt + speed) % (n - 1);
    if (yTChart) { yTChart._dotT = yTt; yTChart.update('none'); }
    yTRaf = requestAnimationFrame(loopT);
  }
  function loopR() {
    if (!yRPlaying) { yRRaf = null; return; }
    yRt = (yRt + speed) % (n - 1);
    if (yRChart) { yRChart._dotT = yRt; yRChart.update('none'); }
    yRRaf = requestAnimationFrame(loopR);
  }
  function loopW() {
    if (!yWPlaying) { yWRaf = null; return; }
    yWt = (yWt + speed) % (n - 1);
    if (yWChart) { yWChart._dotT = yWt; yWChart.update('none'); }
    yWRaf = requestAnimationFrame(loopW);
  }
  if (which === 'T' || which === 'all') { cancelAnimationFrame(yTRaf); loopT(); }
  if (which === 'R' || which === 'all') { cancelAnimationFrame(yRRaf); loopR(); }
  if (which === 'W' || which === 'all') { cancelAnimationFrame(yWRaf); loopW(); }
}

function renderYearly(){
  const yr = S.yearly;
  if (!yr?.length) {
    document.getElementById('yEmpty').style.display = 'block';
    document.getElementById('yContent').style.display = 'none';
    return;
  }
  document.getElementById('yEmpty').style.display = 'none';
  document.getElementById('yContent').style.display = 'flex';

  const labels = yr.map(y => y.year);
  const avgTemps = yr.map(y => y.avgTemp ? +y.avgTemp.toFixed(2) : null);
  const maxTemps = yr.map(y => y.maxTemp ? +y.maxTemp.toFixed(1) : null);
  const minTemps = yr.map(y => y.minTemp ? +y.minTemp.toFixed(1) : null);
  const rains    = yr.map(y => +(y.totalPrec||0).toFixed(0));
  const winds    = yr.map(y => y.avgWind ? +y.avgWind.toFixed(2) : null);

  // ── Temperature chart ──
  yTChart = mkYChart('yTC', 'line', labels, [
    { label: 'Avg °C', data: avgTemps, borderColor: '#4a9eff', backgroundColor: 'rgba(74,158,255,.08)', fill: true, tension: .3, pointRadius: 2, borderWidth: 1.5 },
    { label: 'Max',    data: maxTemps, borderColor: '#7b2fbe', fill: false, tension: .3, pointRadius: 0, borderWidth: 1, borderDash: [3,3] },
    { label: 'Min',    data: minTemps, borderColor: '#8b1a1a', fill: false, tension: .3, pointRadius: 0, borderWidth: 1, borderDash: [3,3] }
  ], ySelYearFn);

  // temperature band toggle
  document.getElementById('yTband').onchange = function() {
    if (!yTChart) return;
    const show = this.checked;
    yTChart.data.datasets[1].hidden = !show;
    yTChart.data.datasets[2].hidden = !show;
    yTChart.update();
  };
  // hide band by default
  yTChart.data.datasets[1].hidden = true;
  yTChart.data.datasets[2].hidden = true;
  yTChart.update('none');

  // ── Rainfall chart ──
  const avgRain = rains.reduce((a,b)=>a+b,0)/rains.length;
  yRChart = mkYChart('yRC', 'bar', labels, [
    { label: 'Rain mm', data: rains, backgroundColor: rains.map(v => v > avgRain ? 'rgba(6,182,212,.55)' : 'rgba(6,182,212,.25)'), borderColor: '#06b6d4', borderWidth: 1 }
  ], ySelYearFn);

  // avg line toggle
  document.getElementById('yRavg').onchange = function() {
    if (!yRChart) return;
    const show = this.checked;
    if (show) {
      if (yRChart.data.datasets.length < 2) {
        yRChart.data.datasets.push({ label: 'Avg', data: labels.map(()=>+avgRain.toFixed(1)), type: 'line', borderColor: '#f97316', borderWidth: 1, pointRadius: 0, borderDash: [4,3] });
      }
    } else {
      if (yRChart.data.datasets.length > 1) yRChart.data.datasets.pop();
    }
    yRChart.update();
  };

  // ── Wind chart ──
  yWChart = mkYChart('yWC', 'line', labels, [
    { label: 'm/s', data: winds, borderColor: '#8b1a1a', backgroundColor: 'rgba(34,197,94,.07)', fill: true, tension: .3, pointRadius: 2, borderWidth: 1.5 }
  ], ySelYearFn);

  // ── Play/pause buttons ──
  const _el_yTplay = document.getElementById('yTplay'); if(_el_yTplay) _el_yTplay.onclick = function() {
    yTPlaying = !yTPlaying;
    this.textContent = yTPlaying ? '⏸' : '▶';
    if (yTPlaying) yStartAnim('T');
  };
  const _el_yTreset = document.getElementById('yTreset'); if(_el_yTreset) _el_yTreset.onclick = () => { yTt = 0; if(yTChart){ yTChart._dotT=0; yTChart.update('none'); } };
  const _el_yRplay = document.getElementById('yRplay'); if(_el_yRplay) _el_yRplay.onclick = function() {
    yRPlaying = !yRPlaying;
    this.textContent = yRPlaying ? '⏸' : '▶';
    if (yRPlaying) yStartAnim('R');
  };
  const _el_yRreset = document.getElementById('yRreset'); if(_el_yRreset) _el_yRreset.onclick = () => { yRt = 0; if(yRChart){ yRChart._dotT=0; yRChart.update('none'); } };
  const _el_yWplay = document.getElementById('yWplay'); if(_el_yWplay) _el_yWplay.onclick = function() {
    yWPlaying = !yWPlaying;
    this.textContent = yWPlaying ? '⏸' : '▶';
    if (yWPlaying) yStartAnim('W');
  };
  const _el_yWreset = document.getElementById('yWreset'); if(_el_yWreset) _el_yWreset.onclick = () => { yWt = 0; if(yWChart){ yWChart._dotT=0; yWChart.update('none'); } };

  // ── Year picker ──
  const grid = document.getElementById('yYearGrid');
  grid.innerHTML = labels.map(y => `<button class="yyr-btn" data-y="${y}">${y}</button>`).join('');
  grid.querySelectorAll('.yyr-btn').forEach(b => b.onclick = () => ySelYearFn(b.dataset.y));

  // ── Summary table ──
  const mp = Math.max(...rains);
  document.getElementById('ytw').innerHTML = `
    <table class="ytbl" style="font-size:.68rem">
      <thead><tr>
        <th style="padding:5px 4px">Year</th>
        <th style="padding:5px 4px">Avg°C</th>
        <th style="padding:5px 4px;color:#ef4444">Max</th>
        <th style="padding:5px 4px;color:#60a5fa">Min</th>
        <th style="padding:5px 4px">Rain</th>
        <th style="padding:5px 4px;color:#22c55e">Wind</th>
      </tr></thead>
      <tbody>${yr.map(y=>`
        <tr data-y="${y.year}" style="cursor:pointer" onclick="ySelYearFn('${y.year}')">
          <td style="font-weight:700;padding:5px 4px">${y.year}</td>
          <td style="padding:5px 4px">${y.avgTemp?.toFixed(1)||'—'}</td>
          <td style="color:#ef4444;padding:5px 4px">${y.maxTemp?.toFixed(1)||'—'}</td>
          <td style="color:#60a5fa;padding:5px 4px">${y.minTemp?.toFixed(1)||'—'}</td>
          <td style="padding:5px 4px">
            ${y.totalPrec?.toFixed(0)||'—'}
            <span class="hb" style="width:${Math.round((y.totalPrec||0)/mp*28)}px;background:#06b6d4"></span>
          </td>
          <td style="color:#22c55e;padding:5px 4px">${y.avgWind?.toFixed(1)||'—'}</td>
        </tr>`).join('')}
      </tbody>
    </table>`;

  // ── Select latest year initially ──
  ySelYearFn(labels[labels.length - 1]);

  // ── Start animations ──
  yTPlaying = true; yRPlaying = true; yWPlaying = true;
  yTt = 0; yRt = 0; yWt = 0;
  document.getElementById('yTplay').textContent = '⏸';
  document.getElementById('yRplay').textContent = '⏸';
  document.getElementById('yWplay').textContent = '⏸';
  setTimeout(() => yStartAnim('all'), 550);
}
function renderMonthly(){
  const mo=S.monthly;
  if(!mo?.length){ document.getElementById('mEmpty').style.display='block'; document.getElementById('mContent').style.display='none'; return; }
  document.getElementById('mEmpty').style.display='none'; document.getElementById('mContent').style.display='flex';
  mkC('mTC','line',MN,[{label:'Mean °C',data:mo.map(m=>m.avgTemp),borderColor:'#ff6b35',backgroundColor:'rgba(255,107,53,.08)',fill:true,tension:.4,pointRadius:4,borderWidth:2}]);
  mkC('mRC','bar',MN,[{label:'Avg Daily mm',data:mo.map(m=>m.avgDailyPrec),backgroundColor:'rgba(6,182,212,.45)',borderColor:'#06b6d4',borderWidth:1}]);
  mkC('mWC','line',MN,[{label:'m/s',data:mo.map(m=>m.avgWind),borderColor:'#8b1a1a',backgroundColor:'rgba(34,197,94,.07)',fill:true,tension:.4,pointRadius:4,borderWidth:2}]);
}

// ── EXPORT ───────────────────────────────────────────
const dl=(c,fn)=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([c],{type:'text/csv'}));a.download=fn;a.click();};
const _el_eCSV = document.getElementById('eCSV'); if(_el_eCSV) _el_eCSV.onclick=()=>{
  if(!S.raw){alert('No data');return;}
  const rd=S.raw; let c='Date,T2M,T2M_MAX,T2M_MIN,PREC_mm,WS2M,RH2M,SOLAR\n';
  rd.dates.forEach((d,i)=>c+=`${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)},${rd.T2M[i]??''},${rd.T2M_MAX[i]??''},${rd.T2M_MIN[i]??''},${rd.PREC[i]??''},${rd.WS2M[i]??''},${rd.RH2M[i]??''},${rd.SOLAR[i]??''}\n`);
  dl(c,S.name.replace(/ /g,'_')+'_daily.csv');
};
const _el_eYCSV = document.getElementById('eYCSV'); if(_el_eYCSV) _el_eYCSV.onclick=()=>{
  if(!S.yearly){alert('No data');return;} let c='Year,AvgTemp,MaxTemp,MinTemp,TotalPrec_mm,AvgWind\n';
  S.yearly.forEach(y=>c+=`${y.year},${y.avgTemp?.toFixed(2)||''},${y.maxTemp?.toFixed(1)||''},${y.minTemp?.toFixed(1)||''},${y.totalPrec?.toFixed(1)||''},${y.avgWind?.toFixed(2)||''}\n`);
  dl(c,S.name.replace(/ /g,'_')+'_yearly.csv');
};
const _el_eMCSV = document.getElementById('eMCSV'); if(_el_eMCSV) _el_eMCSV.onclick=()=>{
  if(!S.monthly){alert('No data');return;} let c='Month,AvgTemp,AvgDailyPrec_mm,AvgWind\n';
  S.monthly.forEach(m=>c+=`${MN[m.month-1]},${m.avgTemp||''},${m.avgDailyPrec||''},${m.avgWind||''}\n`);
  dl(c,S.name.replace(/ /g,'_')+'_monthly.csv');
};
const _el_eJSON = document.getElementById('eJSON'); if(_el_eJSON) _el_eJSON.onclick=()=>{
  if(!S.raw){alert('No data');return;}
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([JSON.stringify({location:{name:S.name,lat:S.lat,lon:S.lon},data:S.raw},null,2)],{type:'application/json'}));
  a.download=S.name.replace(/ /g,'_')+'_raw.json'; a.click();
};
function showErr(m){ const cr=document.getElementById('cres'); cr.innerHTML=`<div class="err">⚠ ${m}</div>`; cr.style.display='flex'; }



// ── CACHE TAB ────────────────────────────────────────────────────────────────
async function renderCacheTab(){
  const listEl    = document.getElementById('cacheList');
  const storageEl = document.getElementById('cacheStorageInfo');
  if(!listEl) return;

  listEl.innerHTML = '<div style="color:var(--txt3);font-size:.72rem;padding:8px 0">Loading…</div>';

  const all  = await cacheList();
  const size = await cacheSize();
  const kb   = (size/1024).toFixed(1);
  const mb   = (size/1024/1024).toFixed(2);

  storageEl.textContent = all.length
    ? `${all.length} location${all.length>1?'s':''} cached  ·  ~${mb} MB used`
    : 'No cached data yet.';

  if(!all.length){
    listEl.innerHTML = `
      <div style="text-align:center;padding:24px 0;color:var(--txt3);font-size:.75rem;line-height:1.8">
        No data cached yet.<br>
        Fetch a location to store it permanently.
      </div>`;
    return;
  }

  // Sort by most recently saved
  all.sort((a,b)=>b.savedAt-a.savedAt);

  listEl.innerHTML = '';
  for(const rec of all){
    const date  = new Date(rec.savedAt).toLocaleDateString('en-PK',{day:'2-digit',month:'short',year:'numeric'});
    const recKb = (JSON.stringify(rec.data).length/1024).toFixed(0);
    const div   = document.createElement('div');
    div.style.cssText = `
      background:var(--surface2);border:1px solid var(--border);border-radius:10px;
      padding:10px 13px;display:flex;align-items:flex-start;gap:10px;
    `;
    div.innerHTML = `
      <div style="flex:1;min-width:0">
        <div style="font-weight:700;font-size:.82rem;color:var(--txt);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
          ${rec.name || 'Unknown Location'}
        </div>
        <div style="font-size:.68rem;color:var(--txt3);margin-top:2px">
          ${rec.prov ? rec.prov.replace(/_/g,' ') : ''}${rec.dist ? ' · '+rec.dist.replace(/_/g,' ') : ''}
        </div>
        <div style="font-size:.65rem;color:var(--txt3);margin-top:4px;font-family:'JetBrains Mono',monospace;display:flex;gap:10px;flex-wrap:wrap">
          <span title="Coordinates">📍 ${rec.lat}, ${rec.lon}</span>
          <span title="Date range">📅 ${rec.from} → ${rec.to}</span>
          <span title="Days of data">📊 ${rec.days.toLocaleString()} days</span>
          <span title="Cache size">💾 ${recKb} KB</span>
          <span title="Saved on" style="color:var(--blue)">⚡ ${date}</span>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0">
        <button data-key="${rec.cacheKey}" data-lat="${rec.lat}" data-lon="${rec.lon}"
          data-from="${rec.from}" data-to="${rec.to}"
          class="cache-load-btn"
          style="font-family:'Plus Jakarta Sans',sans-serif;font-size:.65rem;font-weight:600;
            padding:4px 9px;border-radius:6px;border:1.5px solid var(--blue);
            background:var(--blue-light);color:var(--blue);cursor:pointer;transition:all .13s;white-space:nowrap">
          ⚡ Load
        </button>
        <button data-key="${rec.cacheKey}"
          class="cache-del-btn"
          style="font-family:'Plus Jakarta Sans',sans-serif;font-size:.65rem;font-weight:600;
            padding:4px 9px;border-radius:6px;border:1.5px solid rgba(220,38,38,.3);
            background:var(--red-light);color:var(--red);cursor:pointer;transition:all .13s">
          🗑 Delete
        </button>
      </div>
    `;
    listEl.appendChild(div);
  }

  // Load button: restore this cached record into the app
  listEl.querySelectorAll('.cache-load-btn').forEach(btn=>{
    btn.onclick = async ()=>{
      const key  = btn.dataset.key;
      const all2 = await cacheList();
      const rec2 = all2.find(r=>r.cacheKey===key);
      if(!rec2) return;
      // Restore state
      S.lat=rec2.lat; S.lon=rec2.lon;
      S.name=rec2.name; S.prov=rec2.prov; S.dist=rec2.dist;
      document.getElementById('dFrom').value = rec2.from;
      document.getElementById('dTo').value   = rec2.to;
      S.raw = rec2.data;
      S._fullRaw = rec2.data;
      calcStats(); renderRes();
      // Show location info
      document.getElementById('lname').textContent   = rec2.name || `${rec2.lat}, ${rec2.lon}`;
      document.getElementById('lprov').textContent   = (rec2.prov||'').replace(/_/g,' ');
      document.getElementById('ldist').textContent   = (rec2.dist||'').replace(/_/g,' ');
      document.getElementById('lcoords').textContent = `${rec2.lat}°N  ${rec2.lon}°E`;
      document.getElementById('welState').style.display  = 'none';
      document.getElementById('datState').style.display  = 'flex';
      // Switch to climate tab
      document.querySelectorAll('.stab').forEach(t=>t.classList.remove('active'));
      document.querySelectorAll('.tp').forEach(t=>t.classList.remove('active'));
      document.querySelector('.stab[data-t="climate"]').classList.add('active');
      document.getElementById('tab-climate').classList.add('active');
    };
  });

  // Delete button
  listEl.querySelectorAll('.cache-del-btn').forEach(btn=>{
    btn.onclick = async ()=>{
      if(!confirm('Delete this cached location?')) return;
      await cacheDelete(btn.dataset.key);
      renderCacheTab();
    };
  });
}

// Wire up cache tab buttons
const _el_cacheRefreshBtn = document.getElementById('cacheRefreshBtn'); if(_el_cacheRefreshBtn) _el_cacheRefreshBtn.onclick  = ()=> renderCacheTab();
const _el_cacheClearAllBtn = document.getElementById('cacheClearAllBtn'); if(_el_cacheClearAllBtn) _el_cacheClearAllBtn.onclick = async ()=>{
  if(!confirm('Delete ALL cached climate data? This cannot be undone.')) return;
  await cacheClear();
  renderCacheTab();
};

// Auto-render cache tab when it becomes active
document.querySelectorAll('.stab').forEach(tab=>{
  tab.addEventListener('click', ()=>{
    if(tab.dataset.t === 'export') renderCacheTab();
  });
});

// Initial load of cache tab content
renderCacheTab();
// ── END CACHE TAB ────────────────────────────────────────────────────────────


// ── BULK FETCH SYSTEM ────────────────────────────────────────────────────────
const ALL_DISTRICTS = [{"n": "Bagh", "p": "Azad_Kashmir", "la": 34.0072, "lo": 73.7283}, {"n": "Bhimber", "p": "Azad_Kashmir", "la": 33.0673, "lo": 74.0272}, {"n": "Jhelum_Valley", "p": "Azad_Kashmir", "la": 34.166, "lo": 73.7439}, {"n": "Haveli", "p": "Azad_Kashmir", "la": 33.9343, "lo": 74.0312}, {"n": "Kotli", "p": "Azad_Kashmir", "la": 33.4841, "lo": 73.8041}, {"n": "Mirpur", "p": "Azad_Kashmir", "la": 33.2449, "lo": 73.7862}, {"n": "Muzaffarabad", "p": "Azad_Kashmir", "la": 34.2649, "lo": 73.6509}, {"n": "Neelum", "p": "Azad_Kashmir", "la": 34.8034, "lo": 74.1778}, {"n": "Poonch", "p": "Azad_Kashmir", "la": 33.8034, "lo": 73.7957}, {"n": "Sudhnoti", "p": "Azad_Kashmir", "la": 33.7075, "lo": 73.7547}, {"n": "Awaran", "p": "Balochistan", "la": 26.0916, "lo": 65.3282}, {"n": "Barkhan", "p": "Balochistan", "la": 30.0046, "lo": 69.5158}, {"n": "Chagai", "p": "Balochistan", "la": 28.73, "lo": 64.0956}, {"n": "Dera_Bugti", "p": "Balochistan", "la": 29.0797, "lo": 69.009}, {"n": "Gwadar", "p": "Balochistan", "la": 25.4725, "lo": 63.2837}, {"n": "Harnai", "p": "Balochistan", "la": 30.1211, "lo": 67.7935}, {"n": "Jaffarabad", "p": "Balochistan", "la": 28.2548, "lo": 68.0381}, {"n": "Jhal_Magsi", "p": "Balochistan", "la": 28.4873, "lo": 67.5246}, {"n": "Kachhi", "p": "Balochistan", "la": 29.3413, "lo": 67.4995}, {"n": "Kalat", "p": "Balochistan", "la": 29.1646, "lo": 66.7194}, {"n": "Kech", "p": "Balochistan", "la": 25.9336, "lo": 63.2677}, {"n": "Kharan", "p": "Balochistan", "la": 28.8229, "lo": 65.732}, {"n": "Khuzdar", "p": "Balochistan", "la": 27.2021, "lo": 66.6464}, {"n": "Killa_Abdullah", "p": "Balochistan", "la": 30.6447, "lo": 66.6762}, {"n": "Killa_Saifullah", "p": "Balochistan", "la": 30.9477, "lo": 68.2644}, {"n": "Kohlu", "p": "Balochistan", "la": 29.7157, "lo": 69.0117}, {"n": "Lasbela", "p": "Balochistan", "la": 25.8548, "lo": 66.4067}, {"n": "Lehri", "p": "Balochistan", "la": 28.9861, "lo": 68.0277}, {"n": "Loralai", "p": "Balochistan", "la": 30.4895, "lo": 68.5915}, {"n": "Mastung", "p": "Balochistan", "la": 29.7075, "lo": 66.7097}, {"n": "Musakhel", "p": "Balochistan", "la": 30.915, "lo": 69.8094}, {"n": "Nasirabad", "p": "Balochistan", "la": 28.6342, "lo": 68.1056}, {"n": "Nushki", "p": "Balochistan", "la": 29.3825, "lo": 65.867}, {"n": "Panjgur", "p": "Balochistan", "la": 26.7816, "lo": 64.0931}, {"n": "Pishin", "p": "Balochistan", "la": 30.7024, "lo": 67.1957}, {"n": "Quetta", "p": "Balochistan", "la": 30.1498, "lo": 66.8777}, {"n": "Sherani", "p": "Balochistan", "la": 31.5386, "lo": 69.7985}, {"n": "Sibi", "p": "Balochistan", "la": 29.7699, "lo": 67.9013}, {"n": "Sohbatpur", "p": "Balochistan", "la": 28.5151, "lo": 68.7063}, {"n": "Washuk", "p": "Balochistan", "la": 27.6953, "lo": 64.5868}, {"n": "Zhob", "p": "Balochistan", "la": 31.1633, "lo": 69.1511}, {"n": "Ziarat", "p": "Balochistan", "la": 30.3895, "lo": 67.8278}, {"n": "Shaheed_Sikandarabad", "p": "Balochistan", "la": 28.3222, "lo": 66.176}, {"n": "Duki", "p": "Balochistan", "la": 30.1578, "lo": 69.0961}, {"n": "Chaman", "p": "Balochistan", "la": 30.7653, "lo": 66.5611}, {"n": "Astore", "p": "Gilgit_Baltistan", "la": 35.2629, "lo": 74.8707}, {"n": "Diamir", "p": "Gilgit_Baltistan", "la": 35.4217, "lo": 74.3051}, {"n": "Ghanche", "p": "Gilgit_Baltistan", "la": 35.2471, "lo": 77.4397}, {"n": "Ghizer", "p": "Gilgit_Baltistan", "la": 36.3242, "lo": 73.8961}, {"n": "Gilgit", "p": "Gilgit_Baltistan", "la": 35.9111, "lo": 74.3909}, {"n": "Hunza", "p": "Gilgit_Baltistan", "la": 36.4442, "lo": 75.0699}, {"n": "Skardu", "p": "Gilgit_Baltistan", "la": 35.2267, "lo": 75.5606}, {"n": "Nagar", "p": "Gilgit_Baltistan", "la": 36.2644, "lo": 74.675}, {"n": "Kharmang", "p": "Gilgit_Baltistan", "la": 34.945, "lo": 75.6965}, {"n": "Shigar", "p": "Gilgit_Baltistan", "la": 35.6673, "lo": 76.4815}, {"n": "Darel", "p": "Gilgit_Baltistan", "la": 35.7414, "lo": 73.8643}, {"n": "Tangir", "p": "Gilgit_Baltistan", "la": 35.7931, "lo": 73.3319}, {"n": "Gupis-Yasin", "p": "Gilgit_Baltistan", "la": 36.1731, "lo": 73.363}, {"n": "Rondu", "p": "Gilgit_Baltistan", "la": 35.5849, "lo": 75.0619}, {"n": "Islamabad", "p": "Islamabad", "la": 33.705, "lo": 73.1055}, {"n": "Abbottabad", "p": "Khyber_Pakhtunkhwa", "la": 34.326, "lo": 72.0361}, {"n": "Bajaur", "p": "Khyber_Pakhtunkhwa", "la": 34.6685, "lo": 71.5142}, {"n": "Bannu", "p": "Khyber_Pakhtunkhwa", "la": 32.9549, "lo": 70.6153}, {"n": "Batagram", "p": "Khyber_Pakhtunkhwa", "la": 34.7749, "lo": 73.1237}, {"n": "Buner", "p": "Khyber_Pakhtunkhwa", "la": 34.4309, "lo": 72.531}, {"n": "Charsadda", "p": "Khyber_Pakhtunkhwa", "la": 34.2301, "lo": 71.7314}, {"n": "Chitral_Lower", "p": "Khyber_Pakhtunkhwa", "la": 35.8305, "lo": 71.9513}, {"n": "Chitral_Upper", "p": "Khyber_Pakhtunkhwa", "la": 36.4324, "lo": 72.9259}, {"n": "D_I_Khan", "p": "Khyber_Pakhtunkhwa", "la": 32.0302, "lo": 70.6516}, {"n": "Hangu", "p": "Khyber_Pakhtunkhwa", "la": 33.4354, "lo": 70.9213}, {"n": "Haripur", "p": "Khyber_Pakhtunkhwa", "la": 34.08, "lo": 72.94}, {"n": "Karak", "p": "Khyber_Pakhtunkhwa", "la": 33.1847, "lo": 71.1056}, {"n": "Khyber", "p": "Khyber_Pakhtunkhwa", "la": 33.9247, "lo": 71.0384}, {"n": "Kohat", "p": "Khyber_Pakhtunkhwa", "la": 33.5572, "lo": 71.4814}, {"n": "Kohistan_Lower", "p": "Khyber_Pakhtunkhwa", "la": 35.1555, "lo": 72.9073}, {"n": "Kohistan_Upper", "p": "Khyber_Pakhtunkhwa", "la": 35.504, "lo": 73.2921}, {"n": "Kolai_Palas_Kohistan", "p": "Khyber_Pakhtunkhwa", "la": 35.026, "lo": 73.2089}, {"n": "Kurram", "p": "Khyber_Pakhtunkhwa", "la": 33.6466, "lo": 70.4764}, {"n": "Lakki_Marwat", "p": "Khyber_Pakhtunkhwa", "la": 32.5829, "lo": 70.7509}, {"n": "Lower_Dir", "p": "Khyber_Pakhtunkhwa", "la": 34.842, "lo": 71.8952}, {"n": "Malakand", "p": "Khyber_Pakhtunkhwa", "la": 34.5345, "lo": 71.9225}, {"n": "Mansehra", "p": "Khyber_Pakhtunkhwa", "la": 34.6467, "lo": 73.4724}, {"n": "Mardan", "p": "Khyber_Pakhtunkhwa", "la": 34.3229, "lo": 72.1147}, {"n": "Mohmand", "p": "Khyber_Pakhtunkhwa", "la": 34.468, "lo": 71.4053}, {"n": "North_Waziristan", "p": "Khyber_Pakhtunkhwa", "la": 32.9151, "lo": 70.0898}, {"n": "Nowshera", "p": "Khyber_Pakhtunkhwa", "la": 33.9579, "lo": 71.9444}, {"n": "Orakzai", "p": "Khyber_Pakhtunkhwa", "la": 33.7169, "lo": 70.9806}, {"n": "Peshawar", "p": "Khyber_Pakhtunkhwa", "la": 33.8969, "lo": 71.6363}, {"n": "Shangla", "p": "Khyber_Pakhtunkhwa", "la": 34.8315, "lo": 72.7388}, {"n": "South_Waziristan", "p": "Khyber_Pakhtunkhwa", "la": 32.4223, "lo": 69.9739}, {"n": "Swabi", "p": "Khyber_Pakhtunkhwa", "la": 34.1756, "lo": 72.4469}, {"n": "Swat", "p": "Khyber_Pakhtunkhwa", "la": 35.2764, "lo": 72.4567}, {"n": "Tank", "p": "Khyber_Pakhtunkhwa", "la": 32.367, "lo": 70.3306}, {"n": "Tor_Ghar", "p": "Khyber_Pakhtunkhwa", "la": 34.5472, "lo": 72.8245}, {"n": "Upper_Dir", "p": "Khyber_Pakhtunkhwa", "la": 35.3407, "lo": 72.0867}, {"n": "Attock", "p": "Punjab", "la": 33.4612, "lo": 72.463}, {"n": "Bahawalnagar", "p": "Punjab", "la": 29.6923, "lo": 72.9059}, {"n": "Bahawalpur", "p": "Punjab", "la": 29.2902, "lo": 71.894}, {"n": "Bhakkar", "p": "Punjab", "la": 31.636, "lo": 71.4669}, {"n": "Chakwal", "p": "Punjab", "la": 32.8932, "lo": 72.5566}, {"n": "Chiniot", "p": "Punjab", "la": 31.7451, "lo": 72.8312}, {"n": "Dera_Ghazi_Khan", "p": "Punjab", "la": 30.2792, "lo": 70.599}, {"n": "Faisalabad", "p": "Punjab", "la": 31.1288, "lo": 73.1339}, {"n": "Gujranwala", "p": "Punjab", "la": 32.1464, "lo": 74.1005}, {"n": "Gujrat", "p": "Punjab", "la": 32.6462, "lo": 73.9902}, {"n": "Hafizabad", "p": "Punjab", "la": 32.0066, "lo": 73.4868}, {"n": "Jhang", "p": "Punjab", "la": 31.1389, "lo": 72.1933}, {"n": "Jhelum", "p": "Punjab", "la": 32.8294, "lo": 73.2127}, {"n": "Kasur", "p": "Punjab", "la": 31.116, "lo": 74.0824}, {"n": "Khanewal", "p": "Punjab", "la": 30.3361, "lo": 71.9651}, {"n": "Khushab", "p": "Punjab", "la": 32.1942, "lo": 72.1413}, {"n": "Lahore", "p": "Punjab", "la": 31.4512, "lo": 74.2632}, {"n": "Leiah", "p": "Punjab", "la": 30.9423, "lo": 71.2613}, {"n": "Lodhran", "p": "Punjab", "la": 29.6819, "lo": 71.7062}, {"n": "Mandi_Bahauddin", "p": "Punjab", "la": 32.4195, "lo": 73.4498}, {"n": "Mianwali", "p": "Punjab", "la": 32.6948, "lo": 71.5944}, {"n": "Multan", "p": "Punjab", "la": 29.9039, "lo": 71.4012}, {"n": "Muzaffargarh", "p": "Punjab", "la": 29.9517, "lo": 71.0371}, {"n": "Nankana_Sahib", "p": "Punjab", "la": 31.4532, "lo": 73.6292}, {"n": "Narowal", "p": "Punjab", "la": 32.1802, "lo": 74.8234}, {"n": "Okara", "p": "Punjab", "la": 30.6827, "lo": 73.5969}, {"n": "Pakpattan", "p": "Punjab", "la": 30.3399, "lo": 73.2348}, {"n": "Rahim_Yar_Khan", "p": "Punjab", "la": 28.6427, "lo": 70.4406}, {"n": "Rajanpur", "p": "Punjab", "la": 29.1364, "lo": 70.2815}, {"n": "Rawalpindi", "p": "Punjab", "la": 33.4689, "lo": 73.05}, {"n": "Sahiwal", "p": "Punjab", "la": 30.5506, "lo": 72.8889}, {"n": "Sargodha", "p": "Punjab", "la": 32.03, "lo": 72.7622}, {"n": "Sheikhupura", "p": "Punjab", "la": 31.7239, "lo": 74.0371}, {"n": "Sialkot", "p": "Punjab", "la": 32.3569, "lo": 74.5095}, {"n": "Toba_Tek_Singh", "p": "Punjab", "la": 30.8416, "lo": 72.566}, {"n": "Vehari", "p": "Punjab", "la": 29.9858, "lo": 72.3693}, {"n": "Badin", "p": "Sindh", "la": 24.8185, "lo": 68.8243}, {"n": "Central_Karachi", "p": "Sindh", "la": 24.9484, "lo": 67.0567}, {"n": "Dadu", "p": "Sindh", "la": 26.9033, "lo": 67.6876}, {"n": "East_Karachi", "p": "Sindh", "la": 24.9279, "lo": 67.1169}, {"n": "Ghotki", "p": "Sindh", "la": 27.9457, "lo": 69.5001}, {"n": "Hyderabad", "p": "Sindh", "la": 25.3085, "lo": 68.4711}, {"n": "Jacobabad", "p": "Sindh", "la": 28.1215, "lo": 68.488}, {"n": "Jamshoro", "p": "Sindh", "la": 25.7735, "lo": 67.8119}, {"n": "Kambar_Shahdad_Kot", "p": "Sindh", "la": 27.5728, "lo": 67.8568}, {"n": "Kashmore", "p": "Sindh", "la": 28.2026, "lo": 69.2178}, {"n": "Khairpur", "p": "Sindh", "la": 27.0261, "lo": 68.7853}, {"n": "Korangi_Karachi", "p": "Sindh", "la": 24.8358, "lo": 67.1497}, {"n": "Larkana", "p": "Sindh", "la": 27.5089, "lo": 68.1812}, {"n": "Malir_Karachi", "p": "Sindh", "la": 25.0157, "lo": 67.2865}, {"n": "Matiari", "p": "Sindh", "la": 25.7963, "lo": 68.4793}, {"n": "Mirpur_Khas", "p": "Sindh", "la": 25.3649, "lo": 69.1936}, {"n": "Naushahro_Feroze", "p": "Sindh", "la": 26.8861, "lo": 68.1163}, {"n": "Sanghar", "p": "Sindh", "la": 25.8964, "lo": 69.1388}, {"n": "Shaheed_Benazir_Abad", "p": "Sindh", "la": 26.3589, "lo": 68.3672}, {"n": "Shikarpur", "p": "Sindh", "la": 27.9382, "lo": 68.6267}, {"n": "South_Karachi", "p": "Sindh", "la": 24.881, "lo": 66.9506}, {"n": "Sujawal", "p": "Sindh", "la": 24.426, "lo": 68.0562}, {"n": "Sukkur", "p": "Sindh", "la": 27.6463, "lo": 69.0708}, {"n": "Tando_Allahyar", "p": "Sindh", "la": 25.4656, "lo": 68.7612}, {"n": "Tando_Muhammad_Khan", "p": "Sindh", "la": 25.0304, "lo": 68.5408}, {"n": "Tharparkar", "p": "Sindh", "la": 24.9917, "lo": 69.8926}, {"n": "Thatta", "p": "Sindh", "la": 24.6482, "lo": 67.7073}, {"n": "Umer_Kot", "p": "Sindh", "la": 25.4027, "lo": 69.7883}, {"n": "West_Karachi", "p": "Sindh", "la": 24.9757, "lo": 67.0247}, {"n": "Indian_Illegally_Occupied_Jammu_Kashmir", "p": "Indian_Illegally_Occupied_Jammu_Kashmir", "la": 33.3469, "lo": 76.1671}];
const BULK_FROM = '1995-01-01';
const BULK_TO   = '2025-12-31';

// ── DECADE + YEAR PICKER ──────────────────────────────────────
let _selectedDecadeFrom = 2010;
let _selectedDecadeTo   = 2019;
let _selectedYear       = null; // null = whole decade

function getFromTo() {
  if (_selectedYear) {
    return { from: _selectedYear + '-01-01', to: _selectedYear + '-12-31' };
  }
  return { from: _selectedDecadeFrom + '-01-01', to: _selectedDecadeTo + '-12-31' };
}

function updateFetchLabel() {
  const lbl = document.getElementById('fetchRangeLabel');
  const btn = document.getElementById('fbtn');
  if (_selectedYear) {
    if (lbl) lbl.textContent = _selectedYear + ' · ~365 days';
    if (btn) btn.textContent = 'Fetch ' + _selectedYear + ' Data';
  } else {
    const days = (_selectedDecadeTo - _selectedDecadeFrom + 1) * 365;
    if (lbl) lbl.textContent = _selectedDecadeFrom + '-' + _selectedDecadeTo + ' · ~' + days.toLocaleString() + ' days';
   const label = (_selectedDecadeTo - _selectedDecadeFrom <= 10) 
  ? _selectedDecadeFrom + 's Data' 
  : _selectedDecadeFrom + '–' + _selectedDecadeTo + ' Data';
if (btn) btn.textContent = 'Fetch ' + label;
  }
}

function populateYearDrill(fromYear, toYear) {
  const sel = document.getElementById('yearPicker');
  if (!sel) return;
  sel.innerHTML = '<option value="">— all years in decade —</option>';
  for (let y = toYear; y >= fromYear; y--) {
    const opt = document.createElement('option');
    opt.value = y;
    opt.textContent = y;
    sel.appendChild(opt);
  }
  sel.value = '';
}

// Decade button clicks
document.addEventListener('click', e => {
  const b = e.target.closest('.dec-btn');
  if (!b) return;
  document.querySelectorAll('.dec-btn').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  _selectedDecadeFrom = parseInt(b.dataset.from);
  _selectedDecadeTo   = parseInt(b.dataset.to);
  _selectedYear       = null;
  populateYearDrill(_selectedDecadeFrom, _selectedDecadeTo);
  const sel = document.getElementById('yearPicker');
  if (sel) sel.value = '';
  updateFetchLabel();
});

// Year drill-down change
document.addEventListener('change', e => {
  if (e.target.id !== 'yearPicker') return;
  _selectedYear = e.target.value ? parseInt(e.target.value) : null;
  updateFetchLabel();
});

// Clear year selection
document.addEventListener('click', e => {
  if (e.target.id !== 'yearDrillClear') return;
  _selectedYear = null;
  const sel = document.getElementById('yearPicker');
  if (sel) sel.value = '';
  updateFetchLabel();
});
// ── END DECADE + YEAR PICKER ──────────────────────────────────


// ── UPDATE autoFetch to use BULK dates when district clicked ─────────────────
// When a district is clicked, auto-load from cache if available (bulk dates)
const _origSelLoc = typeof selLoc === 'function' ? selLoc : null;

// Patch: after district is selected — 3-stage load strategy
async function tryAutoLoad(lat, lon, name, prov, dist){

  const pw  = document.getElementById('pwrap');
  const pf  = document.getElementById('pfill');
  const pl  = document.getElementById('plbl');
  const pp  = document.getElementById('ppct');
  const pi  = document.getElementById('pinfo');
  const btn = document.getElementById('fbtn');

  const showBar = (msg, pct, color) => {
    if(!pw) return;
    pw.style.display='block';
    if(pf){ pf.style.width=pct+'%'; if(color) pf.style.background=color; }
    if(pl) pl.textContent=msg;
    if(pp) pp.textContent=pct+'%';
  };
  const hideBar = (delay=1800) => { if(pw) setTimeout(()=>{ pw.style.display='none'; if(pf) pf.style.background=''; }, delay); };

  // Populate year drill for default decade and set label
  populateYearDrill(_selectedDecadeFrom, _selectedDecadeTo);
  updateFetchLabel();

  // Always do a live check so Go Live / file:// differences don't matter
  // Use a short timeout so a missing server fails fast instead of hanging
  const serverUp = await Promise.race([
    checkLocalServer(),
    new Promise(res => setTimeout(() => res(false), 2000))
  ]);
  if(!serverUp){
    showBar('Server offline — run Pakclim_server.py', 100, 'linear-gradient(90deg,#ef4444,#b91c1c)');
    hideBar(4000);
    return;
  }

  // Fetch selected decade directly
  try {
    const {from, to} = getFromTo();
    const label = _selectedYear ? String(_selectedYear) : _selectedDecadeFrom + 's';

    if(btn){ btn.disabled=true; }
    showBar('Loading ' + label + ' data...', 30, 'linear-gradient(90deg,#1d56d8,#4338ca)');
    if(pi) pi.textContent = 'Fetching ' + from + ' to ' + to + '...';

    const rd = await localFetch(lat, lon, from, to);
    if(!rd || !rd.dates || !rd.dates.length) throw new Error('No data returned');

    if(Math.abs(S.lat - lat) < 0.01 && Math.abs(S.lon - lon) < 0.01){
      S.raw = rd; S._fullRaw = rd;
      calcStats(); renderRes();
      if(btn){ btn.disabled=false; updateFetchLabel(); }
      showBar(label + ' loaded - ' + rd.dates.length.toLocaleString() + ' days', 100, 'linear-gradient(90deg,#16a34a,#059669)');
      if(pi) pi.textContent = rd.dates.length.toLocaleString() + ' days · ' + from.slice(0,4) + '-' + to.slice(0,4);
      hideBar(2000);
    }
  } catch(e){
    console.warn('[PakClim] fetch failed:', e.message);
    showBar('Fetch failed: ' + e.message, 100, 'linear-gradient(90deg,#ef4444,#b91c1c)');
    if(btn){ btn.disabled=false; updateFetchLabel(); }
    hideBar(4000);
  }
}

// ── END BULK FETCH SYSTEM ────────────────────────────────────────────────────


// ── SIDEBAR TOGGLE ────────────────────────────────────────
(function(){
  const btn  = document.getElementById('sideToggle');
  const side = document.querySelector('.side');
  if(!btn || !side) return;

  let open = true;

  btn.addEventListener('click', () => {
    open = !open;
    if(open){
      side.classList.remove('collapsed');
      btn.classList.add('open');
      btn.textContent = '❯';
      btn.title = 'Hide panel';
    } else {
      side.classList.add('collapsed');
      btn.classList.remove('open');
      btn.style.right = '12px';
      btn.textContent = '❮';
      btn.title = 'Show panel';
    }
  });

  // Keep toggle button position in sync with panel
  const observer = new MutationObserver(() => {
    if(!side.classList.contains('collapsed')){
      btn.style.right = 'calc(var(--panel-w) + 12px)';
    } else {
      btn.style.right = '12px';
    }
  });
  observer.observe(side, { attributes:true, attributeFilter:['class'] });
})();
// ── END SIDEBAR TOGGLE ────────────────────────────────────
}




// ══════════════════════════════════════════════════════════════════
// PakClim — Simple Decade Trend Viewer
// Shows how much temp/rain/wind changed per decade or over 30 years
// ══════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  document.head.insertAdjacentHTML('beforeend', `<style>
    .dtr-wrap { padding: 12px 13px; }

    /* Period toggle */
    .dtr-toggle {
      display: flex; gap: 6px; margin-bottom: 14px; flex-shrink: 0;
    }
    .dtr-btn {
      flex: 1; padding: 7px 10px; border-radius: 8px; border: 1.5px solid var(--border2);
      background: transparent; color: var(--txt3); font-size: .68rem; font-weight: 600;
      font-family: inherit; cursor: pointer; transition: all .15s;
    }
    .dtr-btn:hover { color: var(--txt1); border-color: var(--txt3); }
    .dtr-btn.active { background: rgba(14,165,233,.15); border-color: #0ea5e9; color: #38bdf8; }

    /* Variable cards */
    .dtr-card {
      border-radius: 11px; border: 1px solid var(--border2);
      overflow: hidden; margin-bottom: 10px;
    }
    .dtr-card-head {
      padding: 9px 13px 8px;
      display: flex; align-items: center; justify-content: space-between;
    }
    .dtr-card-label { font-size: .7rem; font-weight: 700; }
    .dtr-card-avg   { font-size: .62rem; color: var(--txt3); }

    /* Change badge */
    .dtr-badge {
      font-size: .65rem; font-weight: 700; padding: 3px 9px;
      border-radius: 20px; white-space: nowrap;
    }
    .dtr-badge.up   { background: rgba(239,68,68,.15);  color: #f87171; }
    .dtr-badge.dn   { background: rgba(96,165,250,.15);  color: #60a5fa; }
    .dtr-badge.flat { background: rgba(148,163,184,.12); color: #94a3b8; }

    /* Period rows */
    .dtr-rows { padding: 4px 13px 10px; }
    .dtr-row {
      display: flex; align-items: center; gap: 10px;
      padding: 7px 0; border-bottom: 1px solid rgba(255,255,255,.05);
    }
    .dtr-row:last-child { border-bottom: none; }
    .dtr-row-lbl  { font-size: .66rem; font-weight: 700; color: var(--txt2); width: 58px; flex-shrink: 0; }
    .dtr-row-bar-wrap { flex: 1; height: 10px; background: rgba(255,255,255,.07); border-radius: 5px; overflow: hidden; }
    .dtr-row-bar  { height: 100%; border-radius: 5px; width: 0; transition: width .65s cubic-bezier(.4,0,.2,1); }
    .dtr-row-val  { font-size: .68rem; font-weight: 700; width: 52px; text-align: right; flex-shrink: 0; }
    .dtr-row-chg  { font-size: .62rem; width: 48px; text-align: right; flex-shrink: 0; }

    /* Summary sentence */
    .dtr-summary {
      margin: 4px 13px 10px; padding: 8px 10px;
      background: rgba(255,255,255,.04); border-radius: 8px;
      font-size: .65rem; color: var(--txt2); line-height: 1.75;
      border-left: 3px solid var(--dtr-accent, #0ea5e9);
    }

    /* No data */
    .dtr-empty {
      text-align: center; padding: 30px 14px; color: var(--txt3);
    }

    #dtr-area::-webkit-scrollbar { width: 3px; }
    #dtr-area::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 2px; }
  `);

  const f1 = v => (v != null && isFinite(v)) ? (+v).toFixed(1) : '—';
  const f2 = v => (v != null && isFinite(v)) ? (+v).toFixed(2) : '—';
  const mavg = arr => arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : null;

  let _period = 'decade'; // 'decade' | '30yr'

  // ── Compute period averages from S.yearly ────────────────────
  function getPeriodData(field) {
    const yearly = (S.yearly || []).filter(y => y[field] != null && isFinite(y[field]));
    if (!yearly.length) return null;

    if (_period === 'decade') {
      // Group by decade
      const dec = {};
      yearly.forEach(y => {
        const dk = Math.floor(+y.year / 10) * 10;
        if (!dec[dk]) dec[dk] = [];
        dec[dk].push(y[field]);
      });
      return Object.entries(dec)
        .sort((a,b) => +a[0] - +b[0])
        .map(([dk, vals]) => ({
          label: `${dk}s`,
          avg: +mavg(vals).toFixed(2),
          count: vals.length,
        }));
    } else {
      // '30yr' — split into equal thirds (or two halves if < 20yr)
      const n = yearly.length;
      if (n < 6) return null;
      const sliceSize = Math.floor(n / 3);
      const parts = [
        yearly.slice(0, sliceSize),
        yearly.slice(sliceSize, sliceSize * 2),
        yearly.slice(sliceSize * 2),
      ];
      return parts.map((part, i) => ({
        label: `${part[0].year}–${part[part.length-1].year}`,
        avg: +mavg(part.map(y => y[field])).toFixed(2),
        count: part.length,
      }));
    }
  }

  // ── Build one variable card ───────────────────────────────────
  function buildCard(cfg) {
    const rows = getPeriodData(cfg.field);
    if (!rows || rows.length < 2) return '';

    const vals = rows.map(r => r.avg);
    const mxVal = Math.max(...vals);
    const mnVal = Math.min(...vals);
    const totalChange = +(vals[vals.length-1] - vals[0]).toFixed(2);
    const direction = totalChange > (cfg.threshold || 0.05) ? 'up'
                    : totalChange < -(cfg.threshold || 0.05) ? 'dn' : 'flat';
    const arrow = direction==='up' ? '↑' : direction==='dn' ? '↓' : '→';
    const overallAvg = +mavg(vals).toFixed(1);

    // Badge text
    const badgeText = Math.abs(totalChange) < (cfg.threshold || 0.05)
      ? '→ No change'
      : `${arrow} ${totalChange > 0 ? '+' : ''}${totalChange}${cfg.unit} total`;

    const uid = () => 'dr' + Math.random().toString(36).slice(2, 7);
    const animItems = [];

    const rowsHtml = rows.map((r, i) => {
      const pct = Math.max(5, ((r.avg - mnVal) / (mxVal - mnVal || 1)) * 88 + 5);
      const id = uid();
      animItems.push({ id, pct });

      // Change from previous period
      const prev = i > 0 ? rows[i-1].avg : null;
      const chg = prev != null ? +(r.avg - prev).toFixed(2) : null;
      let chgHtml = '';
      if (chg != null) {
        const isUp = chg > (cfg.threshold || 0.05);
        const isDn = chg < -(cfg.threshold || 0.05);
        chgHtml = isUp
          ? `<span style="color:#f87171">+${chg}${cfg.unit}</span>`
          : isDn
          ? `<span style="color:#60a5fa">${chg}${cfg.unit}</span>`
          : `<span style="color:#94a3b8">≈</span>`;
      }

      return `<div class="dtr-row">
        <div class="dtr-row-lbl">${r.label}</div>
        <div class="dtr-row-bar-wrap">
          <div id="${id}" class="dtr-row-bar" style="background:${cfg.color};transition-delay:${i * 0.09}s"></div>
        </div>
        <div class="dtr-row-val" style="color:${cfg.color}">${f1(r.avg)}${cfg.unit}</div>
        <div class="dtr-row-chg">${chgHtml}</div>
      </div>`;
    }).join('');

    // Animate bars
    setTimeout(() => {
      animItems.forEach(({ id, pct }) => {
        const el = document.getElementById(id);
        if (el) el.style.width = pct + '%';
      });
    }, 60);

    // Summary sentence
    const first = rows[0], last = rows[rows.length-1];
    let summary = '';
    if (direction === 'up') {
      summary = `<strong style="color:${cfg.color}">${cfg.label} increased by ${totalChange > 0 ? '+' : ''}${totalChange}${cfg.unit}</strong> from ${first.label} (${f1(first.avg)}${cfg.unit}) to ${last.label} (${f1(last.avg)}${cfg.unit}).`;
    } else if (direction === 'dn') {
      summary = `<strong style="color:${cfg.color}">${cfg.label} decreased by ${totalChange}${cfg.unit}</strong> from ${first.label} (${f1(first.avg)}${cfg.unit}) to ${last.label} (${f1(last.avg)}${cfg.unit}).`;
    } else {
      summary = `<strong style="color:#94a3b8">${cfg.label} remained stable</strong> — avg ${overallAvg}${cfg.unit}. No significant change detected.`;
    }

    return `<div class="dtr-card" style="border-color:${cfg.color}44;--dtr-accent:${cfg.color}">
      <div class="dtr-card-head" style="background:${cfg.color}0e">
        <div>
          <div class="dtr-card-label" style="color:${cfg.color}">${cfg.icon} ${cfg.label}</div>
          <div class="dtr-card-avg">Overall avg: ${overallAvg}${cfg.unit}</div>
        </div>
        <span class="dtr-badge ${direction}">${badgeText}</span>
      </div>
      <div class="dtr-rows">${rowsHtml}</div>
      <div class="dtr-summary" style="border-left-color:${cfg.color}">${summary}</div>
    </div>`;
  }

  // ── Variable definitions ──────────────────────────────────────
  const VARS = [
    { label:'Temperature', icon:'🌡️', field:'avgTemp',   unit:'°C',    color:'#f97316', threshold:0.1  },
    { label:'Rainfall',    icon:'🌧️', field:'totalPrec', unit:'mm',    color:'#3b82f6', threshold:5    },
    { label:'Wind Speed',  icon:'💨', field:'avgWind',   unit:' m/s',  color:'#a78bfa', threshold:0.05 },
  ];

  // ── Main render ───────────────────────────────────────────────
  function render() {
    const area = document.getElementById('dtr-area');
    if (!area) return;

    if (!S.yearly?.length) {
      area.innerHTML = `<div class="dtr-empty">
        <div style="font-size:1.4rem;margin-bottom:8px">📍</div>
        <div style="font-size:.72rem;font-weight:600;color:var(--txt2);margin-bottom:4px">Select a district</div>
        <div style="font-size:.62rem;line-height:1.8">Click any district on the map.<br>Trend data loads automatically.</div>
      </div>`;
      return;
    }

    const loc = S.name||'', prov=(S.prov||'').replace(/_/g,' ');
    const nYr = S.yearly.length;
    const yr1 = S.yearly[0]?.year, yr2 = S.yearly[nYr-1]?.year;

    area.innerHTML = `<div class="dtr-wrap">
      <!-- Location header -->
      <div style="font-size:.72rem;font-weight:700;color:var(--txt1);margin-bottom:3px">📍 ${loc}, ${prov}</div>
      <div style="font-size:.61rem;color:var(--txt3);margin-bottom:12px">${nYr} years of data · ${yr1}–${yr2} · NASA POWER</div>

      <!-- Period toggle -->
      <div class="dtr-toggle">
        <button type="button" class="dtr-btn ${_period==='decade'?'active':''}" id="dtr-decade">By decade</button>
        <button type="button" class="dtr-btn ${_period==='30yr'?'active':''}" id="dtr-30yr">Full period (3 parts)</button>
      </div>

      <!-- Cards -->
      ${VARS.map(v => buildCard(v)).join('')}
    </div>`;

    // Wire period buttons
    document.getElementById('dtr-decade')?.addEventListener('click', () => {
      _period = 'decade';
      render();
    });
    document.getElementById('dtr-30yr')?.addEventListener('click', () => {
      _period = '30yr';
      render();
    });
  }

  // ── Auto-render on district change ────────────────────────────
  let _lastLoc = '';
  setInterval(() => {
    if (S.name && S.name !== _lastLoc && S.yearly?.length) {
      _lastLoc = S.name;
      const tab = document.getElementById('tab-ai');
      if (tab?.classList.contains('active')) render();
    }
  }, 900);

  // ── Render when tab opened ────────────────────────────────────
  document.querySelector('.stab[data-t="ai"]')?.addEventListener('click', () => {
    setTimeout(() => { if (S.yearly?.length) render(); }, 100);
  });

})();
// ── END DECADE TREND VIEWER ───────────────────────────────────────