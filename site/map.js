/* ═══════════════════════════ SECTION · TRUST MAP ═══════════════════════════
   Real slippy map on Leaflet (vendored locally, no build step):
   CARTO dark basemap + optional label overlay, one circle marker per NHS
   trust sized by attendances. Drag / pinch / zoom come from the library;
   hover tooltips, click-to-select, searchable sidebar and the report panel
   keep working exactly as before.

   All trust→period→record→metric logic lives in data-core.js (AECORE) —
   this file only renders what AECORE returns, so the map, sidebar,
   comparison, regional context and export can never disagree.           */
(function () {
'use strict';

const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* Leaflet + data land deferred — poll briefly rather than fail.
   Once ready, heavy map init is kept OFF the initial-render critical path:
   it starts immediately for trust deep links (#RRK…), otherwise when the
   map section nears the viewport, with a short fallback timer so keyboard
   and assistive-tech users are never stuck waiting on scroll events.      */
let waited = 0;
(function boot() {
  if (!(window.L && window.AE_MONTHLY && window.AE_PROVIDERS && window.AE_GEO && window.AECORE)) {
    if ((waited += 100) > 12000) return;   // give up silently; page still works
    return setTimeout(boot, 100);
  }
  const sec = document.getElementById('trustmap');
  const deepLink = /^#[A-Z0-9]{3,6}(@|$)/.test((typeof location !== 'undefined' && location.hash) || '');
  let started = false;
  const go = () => { if (!started) { started = true; start(); } };
  if (deepLink || !sec || !('IntersectionObserver' in window)) return go();
  try {
    const io = new IntersectionObserver((es, io2) => es.forEach(e => {
      if (e.isIntersecting) { io2.disconnect(); go(); }
    }), { rootMargin: '300px' });
    io.observe(sec);
    setTimeout(go, 1200);                  // fallback: never block interaction long
  } catch (e) { go(); }
})();

function start() {
const C = window.AECORE;
const M = window.AE_MONTHLY, P = C.TRUSTS, GEO = window.AE_GEO;
if (!document.getElementById('ukmap')) return;

/* ---------- selection store (single source of truth) ----------
   selected: trust code · selPeriod: YYYY-MM | null (= latest reported) */
const listeners = [];
let selected = null, hover = null, selPeriod = null;
let interacted = false;              // true once a real user action picks a trust
function emit(ev) { listeners.forEach(f => f(selected, hover, ev)); }
function select(code, ev) { if (selected !== code || ev === 'period') { selected = code; emit('select'); } }
function setHover(code) { if (hover !== code) { hover = code; emit('hover'); } }
function on(fn) { listeners.push(fn); }

/* ---------- shareable deep links (#CODE or #CODE@YYYY-MM) ---------- */
function syncHash(push) {
  try {
    const h = C.buildHash(selected, selPeriod);
    const url = h === '#' ? location.pathname + location.search : h;
    if (push) history.pushState({ ae: selected, period: selPeriod }, '', url);
    else history.replaceState({ ae: selected, period: selPeriod }, '', url);
  } catch (e) { /* no-op */ }
}
let userNavigating = false;   // true once the visitor has moved at all
/* one applier for both hashchange (anchor jumps) and popstate (back/forward
   between trust views pushed via pushState) */
let restoring = false;                 // browser-driven moves must never re-push
function applyRoute() {
  const req = C.parseHash();
  const codeChanged = !!req.code && req.code !== selected;
  const periodChanged = (req.period || null) !== selPeriod;
  if (!codeChanged && !periodChanged) return;      // plain section anchors fall through
  restoring = true;
  try {
    if (codeChanged) { selPeriod = req.period || null; interacted = true; select(req.code); }
    else setPeriod(req.period || null, false);
  } finally { restoring = false; }
}
window.addEventListener('hashchange', applyRoute);
window.addEventListener('popstate', e => {
  // restore state from the entry itself when present, else from the hash
  if (e.state && 'ae' in e) { /* state carries ae via custom key below */ }
  applyRoute();
});

/* ---------- trust list (sidebar search) ---------- */
const listEl = document.getElementById('trust-list');
const searchEl = document.getElementById('trust-search');
const countEl = document.getElementById('trust-count');
countEl.textContent = `(${P.filter(p => p.att > 0).length})`;

function perfLabel(t) {
  if (!t.attCov) return 'waits not published';
  const pct = Math.round(100 * t.w4 / t.attCov);
  return `${pct}% within 4h`;
}
function renderList(filter) {
  const q = (filter || '').trim().toLowerCase();
  const rows = P.filter(p => (!q || p.name.toLowerCase().includes(q))
    && (!regionFilter || p.region === regionFilter) && p.att > 0);
  if (!rows.length) {
    listEl.innerHTML = '<li class="no-match">No trusts match that search.</li>';
    return;
  }
  const frag = document.createDocumentFragment();
  rows.forEach(p => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.className = 't-item' + (p.code === selected ? ' sel' : '');
    b.setAttribute('role', 'option');
    b.setAttribute('aria-selected', String(p.code === selected));
    b.dataset.code = p.code;
    b.innerHTML = `<span>${p.name}</span><span class="t-code">${p.code}${p.region ? ' · ' + p.region : ''} · ${C.fmtShort(p.att)} visits${p.monthsTag}</span>`;
    b.addEventListener('click', () => { interacted = true; select(p.code); });
    b.addEventListener('pointerenter', () => setHover(p.code));
    b.addEventListener('pointerleave', () => setHover(null));
    li.appendChild(b);
    frag.appendChild(li);
  });
  listEl.innerHTML = '';
  listEl.appendChild(frag);
}

/* ── regional map filter ── */
let regionFilter = '';
const regionEl = document.getElementById('region-filter');
if (regionEl) {
  [...new Set(P.map(t => t.region).filter(Boolean))].sort()
    .forEach(r => {
      const o = document.createElement('option');
      o.value = r; o.textContent = r;
      regionEl.appendChild(o);
    });
  regionEl.addEventListener('change', () => {
    regionFilter = regionEl.value;
    renderList(searchEl.value);
    applyRegionFilter(true);
  });
}
function applyRegionFilter(fit) {
  const pts = [];
  markersByCode.forEach((m, code) => {
    const inReg = !regionFilter || C.BY_CODE.get(code).region === regionFilter;
    if (inReg) { m.addTo(map); const g2 = C.GEO_BY_CODE.get(code); if (g2) pts.push([g2.lat, g2.lon]); }
    else map.removeLayer(m);
  });
  if (fit && pts.length > 1)
    map.flyToBounds(L.latLngBounds(pts).pad(0.15), { duration: REDUCED ? 0 : .8, maxZoom: 9 });
}

let searchTimer;
searchEl.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => renderList(searchEl.value), 120);
});

P.forEach(tt => { tt.monthsTag = tt.months < 12 ? ` [${tt.months}/12 months]` : ''; });

const jumpEl = document.querySelector('[data-jump]');
if (jumpEl) jumpEl.addEventListener('click', function () {
  interacted = true;
  select(this.dataset.jump);
});

/* ---------- Leaflet map ---------- */
const map = L.map('ukmap', {
  zoomControl: true,
  attributionControl: true,
  minZoom: 5,                        // can't zoom out far enough to see France
  maxZoom: 9,
  zoomSnap: 0.5,
  maxBoundsViscosity: 1.0,           // hard wall: no panning beyond the UK frame
  preferCanvas: true,
  scrollWheelZoom: !REDUCED          // reduced-motion users zoom with buttons/double-click
});
map.attributionControl.setPrefix(false);

// pane for place-name labels sitting above the plain dark tiles
map.createPane('aeLabels');
map.getPane('aeLabels').style.zIndex = 450;
map.getPane('aeLabels').style.pointerEvents = 'none';

const BASE = {
  dark: { base: 'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png',
          labels: 'https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png' },
  light: { base: 'https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png',
           labels: 'https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png' }
};
const FALLBACK = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
function isLight() { return document.documentElement.classList.contains('light'); }
let labelLayer;
let baseLayer = L.tileLayer(BASE[isLight() ? 'light' : 'dark'].base, {
  subdomains: 'abcd', maxZoom: 9,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
}).addTo(map);

// CARTO is keyless, but keep the map usable if a tile edge or rate limit
// returns an API-key response. The accessible trust list remains the source
// of truth while the fallback layer loads.
let fallbackActive = false;
let tileFailures = 0;
const fallbackLayer = L.tileLayer(FALLBACK, {
  maxZoom: 9,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
});
baseLayer.on('tileerror', () => {
  tileFailures++;
  if (tileFailures < 2 || fallbackActive) return;
  fallbackActive = true;
  map.removeLayer(baseLayer);
  map.removeLayer(labelLayer);
  fallbackLayer.addTo(map);
  const hint = document.getElementById('map-hint');
  if (hint) hint.textContent = 'OpenStreetMap base map · trust data remains available in the list';
});

labelLayer = L.tileLayer(BASE[isLight() ? 'light' : 'dark'].labels, {
  subdomains: 'abcd', maxZoom: 9, pane: 'aeLabels', opacity: .82, interactive: false
}).addTo(map);

// theme flips swap the basemap and repaint markers to stay legible
window.addEventListener('ae-theme', () => {
  if (fallbackActive) return;
  const set = BASE[isLight() ? 'light' : 'dark'];
  baseLayer.setUrl(set.base);
  labelLayer.setUrl(set.labels);
  applyMarkerStates();
});

// frame Great Britain (+NI) and hard-limit panning to the UK — no France
const GB_BOUNDS = L.latLngBounds([49.8, -8.2], [59.2, 2.0]);
map.fitBounds(GB_BOUNDS, { padding: [8, 8] });
map.setMaxBounds(GB_BOUNDS);
const HOME = { center: map.getCenter(), zoom: map.getZoom() };

/* ---------- markers ---------- */
let mapMetric = 'type';               // current "Map by" selection
function markerColors() {
  const cs = getComputedStyle(document.documentElement);
  return { accent: cs.getPropertyValue('--accent').trim() || '#005EB8',
           cool: cs.getPropertyValue('--cool').trim() || '#009639',
           hot: cs.getPropertyValue('--hot').trim() || '#003087' };
}
const markersByCode = new Map();

P.forEach(t => {
  const g = C.GEO_BY_CODE.get(t.code);
  if (!g || t.att <= 0) return;                 // no coordinate or no recent activity
  const major = t.kind === 'major';
  const m = L.circleMarker([g.lat, g.lon], {
    radius: Math.min(11, major ? 4 + Math.sqrt(t.att) / 260 : 3),
    color: markerColors().accent,
    weight: g.src === 'approx' ? 1.6 : 1.2,
    dashArray: g.src === 'approx' ? '2 2' : null,
    opacity: .85,
    fillColor: markerColors().accent,
    fillOpacity: major ? .72 : .5
  });
  m.on('mouseover', () => setHover(t.code));
  m.on('mouseout', () => setHover(null));
  m.on('click', () => { interacted = true; select(t.code); });
  m.bindTooltip(markerTooltipHtml(t.code),
    { className: 'ae-tip', direction: 'top', offset: [0, -6], sticky: false, opacity: 1 });
  m.addTo(map);
  markersByCode.set(t.code, m);
});

function markerTooltipHtml(code) {
  const t = C.BY_CODE.get(code), g = C.GEO_BY_CODE.get(code);
  const metricLine = mapMetricLine(code);
  return `<div class="mt-name">${t.name}</div>
     <div class="mt-sub">${C.fmtShort(t.att)} visits${t.attCov ? ' · ' + perfLabel(t) : ''}${t.monthsTag}</div>
     ${metricLine ? `<div class="mt-sub">${metricLine}</div>` : ''}
     <div class="mt-sub">${t.kind === 'major' ? 'big A&amp;E hospital' : t.kind === 'walkin' ? 'walk-in / community sites' : 'single-speciality site'}${g.src === 'approx' ? ' · <b>≈</b> region-level position' : ''}</div>
      ${g.src === 'ods' ? '<div class="mt-sub" style="color:#768692">whole-trust total · placed at registered HQ</div>' : ''}
      <div class="mt-sub" style="margin-top:3px;color:#768692">click for full report</div>`;
}

/* ---------- Map-by control (analytical colouring) ---------- */
const mapByEl = document.getElementById('map-by');
const legendEl = document.getElementById('map-legend');

function mapMetricLine(code) {
  if (mapMetric === 'type') return '';
  const def = C.MAP_METRICS[mapMetric];
  const v = C.mapMetricValue(mapMetric, code, selPeriod);
  const basis = selPeriod ? ` · ${C.monthLabel(selPeriod)}` : '';
  if (mapMetric === 'w4pct') return v == null ? `${def.label}: waits not published`
    : `${def.label}: ${v.toFixed(1)}%${basis}`;
  if (mapMetric === 'chg') return v == null ? `${def.label}: no comparable earlier data`
    : `${def.label}: ${v >= 0 ? '+' : ''}${v.toFixed(1)}pp${basis}`;
  return `${def.label}: ${v == null ? 'not published' : C.fmt(v)}${basis}`;
}

function renderLegend() {
  if (!legendEl) return;
  const def = C.MAP_METRICS[mapMetric];
  if (!def.buckets) {
    legendEl.innerHTML = '<span class="ml-title">Coloured by front-door type:</span>' +
      '<span class="ml-item"><span class="ml-sw" style="background:var(--accent)"></span>major A&amp;E</span>' +
      '<span class="ml-item"><span class="ml-sw" style="background:var(--cool)"></span>walk-in / community</span>' +
      '<span class="ml-note">dot size = attendances, last 12 months · dashed ring ≈ approximate location</span>';
    return;
  }
  const buckets = C.mapMetricBuckets(mapMetric, !!selPeriod);
  const note = mapMetric === 'chg'
    ? (selPeriod ? 'vs previous published month · grey = not comparable' : 'latest 12m vs previous 12m')
    : (selPeriod ? `one month · ${C.monthLabel(selPeriod)}` : 'last 12 months');
  legendEl.innerHTML = `<span class="ml-title">${def.label}:</span>` +
    buckets.map(b => `<span class="ml-item"><span class="ml-sw" style="background:${b.color}"></span>${b.label}</span>`).join('') +
    `<span class="ml-note">${note} · dot size = attendance</span>`;
}

function applyMarkerStates() {
  const Cs = markerColors();
  markersByCode.forEach((m, code) => {
    const isSel = code === selected, isHov = code === hover;
    const t = C.BY_CODE.get(code);
    const base = Math.min(11, t.kind === 'major' ? 4 + Math.sqrt(t.att) / 260 : 3);
    let color;
    if (mapMetric === 'type') color = t.kind === 'major' ? Cs.accent : Cs.cool;
    else color = C.mapMetricColor(mapMetric, code, selPeriod) || '#768692';
    m.setStyle({
      radius: base + (isSel ? 4 : isHov ? 2.5 : 0),
      weight: isSel ? 3 : 1.2,
      color: isSel ? Cs.accent : color,
      fillColor: color,
      fillOpacity: isSel ? 1 : mapMetric === 'type' && t.kind !== 'major' ? .5 : .78
    });
    if (m._path) m._path.classList.toggle('ae-marker-selected', isSel);
    if (isSel) m.bringToFront();
  });
}

/* tooltips only need repainting when the metric or theme changes —
   not on every hover emit */
function refreshTooltips() {
  markersByCode.forEach((m, code) =>
    m.setTooltipContent ? m.setTooltipContent(markerTooltipHtml(code)) : null);
}

/* legend + colours + tooltips all depend on (mapMetric, selPeriod):
   repaint them together, and only when one of the two actually moved */
let analysisKey;
function updateMapAnalysis() {
  const key = mapMetric + '@' + (selPeriod || 'latest');
  if (key === analysisKey) return;
  analysisKey = key;
  renderLegend();
  applyMarkerStates();
  refreshTooltips();
}

/* the one mutation point for the reporting period: URL, map analysis and
   the report panel always move together */
function setPeriod(p, push) {
  if (selPeriod === p && !push) return;
  selPeriod = p;
  syncHash(push !== false && userNavigating);
  updateMapAnalysis();
  if (selected) renderReport(selected);
}

if (mapByEl) {
  Object.keys(C.MAP_METRICS).forEach(k => {
    const o = document.createElement('option');
    o.value = k; o.textContent = C.MAP_METRICS[k].label;
    mapByEl.appendChild(o);
  });
  mapByEl.addEventListener('change', () => {
    mapMetric = mapByEl.value;
    updateMapAnalysis();
  });
}

/* ---------- report panel ---------- */
const trBody = document.getElementById('tr-body');
function animatePanel() {
  trBody.classList.remove('tr-in');
  void trBody.offsetHeight;          // restart the entrance animation
  trBody.classList.add('tr-in');
}

/* ---------- compare mode (pin 2–4 trusts, same reporting basis) ---------- */
let cmpCodes = [];
let cyMode = false;                       // Rolling 12m | Calendar year
const CY = C.lastCompleteYear();
function toggleCompare(code) {
  const i = cmpCodes.indexOf(code);
  if (i >= 0) cmpCodes.splice(i, 1);
  else { if (cmpCodes.length >= 4) cmpCodes.shift(); cmpCodes.push(code); }
  renderReport(selected);
}
const CMP_HUES = ['#005EB8', '#009639', '#41B6E6', '#003087'];

function buildCompareBlock() {
  if (!cmpCodes.length) return '';
  if (cmpCodes.length < 2) {
    const t0 = C.BY_CODE.get(cmpCodes[0]);
    return `<div class="tr-block"><h4>Compare trusts</h4><div class="tr-note">Pinned <b>${t0 ? t0.name : cmpCodes[0]}</b>.
      Open another trust and press <b>+ compare</b> to see 2–4 trusts side by side.
      <button class="linklike" id="tr-cmp-clear">clear</button></div></div>`;
  }
  let rowsData, basis;
  if (!selPeriod && cyMode) {
    const engY = C.englandYear(CY);
    rowsData = cmpCodes.map(c => {
      const t0 = C.BY_CODE.get(c); if (!t0) return null;
      const r = C.yearRecord(c, CY);
      return { code: c, name: t0.name, kind: t0.kind, shortName: C.shortName(t0.name),
        att: r ? r.att : null,
        perf: r && r.att ? 100 * r.w4 / r.att : null,
        br: r ? r.br : null, dta: r ? r.dta : null, adm: r ? r.adm : null,
        vsEngland: r && engY ? 100 * r.w4 / r.att - engY.perf : null,
        dtaShare: r && r.dta != null && r.adm ? 100 * r.dta / r.adm : null };
    }).filter(Boolean);
    basis = `the same calendar year — Jan–Dec ${CY}`;
  } else {
    rowsData = C.compareRows(cmpCodes, selPeriod);
    basis = selPeriod
      ? `one month — ${C.monthLabel(selPeriod)}`
      : `the same window — the last 12 reported months`;
  }
  // metric definitions: [key, label, unit, higherIsBetter]
  const defs = [
    ['perf', 'Left within 4 hours', '%', true],
    ['att', 'People arrived', '', true],
    ['br', 'Waited longer than 4h', '', false],
    ['adm', 'Emergency admissions', '', true],
    ['dta', 'Waited on a trolley 12h+', '', false]
  ];
  const fmtVal = (k, v) => v == null ? '<span class="nodata">no data</span>'
    : k === 'perf' ? v.toFixed(1) + '%' : C.fmt(v);
  const barRow = (k, label, unit) => {
    const vals = rowsData.map(r => r[k]);
    const maxV = Math.max(...vals.filter(v => v != null), 0);
    const any = vals.some(v => v != null);
    return `<div class="tr-cmp-metric">
      <div class="tr-cmp-mlabel">${label}${k === 'br' || k === 'dta' ? ' <span class="dir-hint">↓ lower is better</span>' :
        k === 'perf' || k === 'adm' ? ' <span class="dir-hint">↑ higher is better</span>' :
        ' <span class="dir-hint">context</span>'}</div>
      ${any ? rowsData.map((r, i) => r[k] == null
        ? `<div class="tr-cmp-brow"><span class="tr-cmp-bname">${r.shortName}</span><span class="tr-cmp-btrack"><span class="nodata-inline">no data published</span></span></div>`
        : `<div class="tr-cmp-brow"><span class="tr-cmp-bname">${r.shortName}</span>
             <span class="tr-cmp-btrack"><span class="tr-cmp-bar" style="width:${Math.max(2, 100 * r[k] / maxV)}%;background:${CMP_HUES[i]}"></span></span>
             <span class="tr-cmp-bval num">${fmtVal(k, r[k])}${k === 'dta' && r.dtaShare != null ? ` <em>(${r.dtaShare.toFixed(1)}% of adm.)</em>` : ''}</span></div>`
      ).join('')
      : `<div class="tr-cmp-brow"><span class="nodata-inline">no trust published this measure for ${basis}</span></div>`}
    </div>`;
  };
  return `<div class="tr-block"><h4>Compare trusts
      <button class="linklike" id="tr-cmp-clear">clear</button></h4>
    <div class="tr-note">All figures cover <b>${basis}</b>${selPeriod ? '' : ', matching each trust\u2019s own reporting'}.
      Bars are scaled within each metric; percentages and counts are kept apart.</div>
    <div class="tr-cmp-names">${rowsData.map((r, i) =>
      `<span style="color:${CMP_HUES[i]}">▬ ${r.name}</span>`).join('')}</div>
    ${defs.map(d => barRow(...d)).join('')}
    <div class="tr-note">Missing bars mean the NHS did not publish that figure for a trust in this period — they are never shown as zero.</div></div>`;
}

/* ---------- patient-journey flow (overlaps stated explicitly) ---------- */
function buildJourney(t, rec) {
  if (cyMode && !rec) {
    return `<div class="tr-block"><h4>The patient journey</h4>
      <div class="tr-unavailable">No complete calendar-year data is available for this trust.</div></div>`;
  }
  if (!rec || !rec.cov || !rec.att) {
    // trusts with an exact 12-month roll-up but no monthly archive can still
    // show the journey at full precision — clearly labelled as the window
    if (!selPeriod && t.attCov > 0) {
      rec = { ym: null, cov: true, att: t.att, w4: t.w4,
              br: t.br != null ? t.br : Math.max(t.attCov - t.w4, 0),
              adm: t.adm, dta: t.dta };
    } else {
      return `<div class="tr-block"><h4>The patient journey</h4>
        <div class="tr-unavailable">Waiting-time detail isn't published for this period, so the journey can't be drawn.</div></div>`;
    }
  }
  const when = rec.labelOverride || (rec.ym ? C.monthLabel(rec.ym) : 'the last 12 reported months');
  const w4pct = Math.round(rec.w4 / rec.att * 1000) / 10;
  const br = rec.br != null ? rec.br : Math.max(rec.att - rec.w4, 0);
  const pctOfAtt = v => rec.att ? Math.max(2, Math.min(100, 100 * v / rec.att)) : 2;
  const steps = [
    { v: C.fmt(rec.att), k: 'attendances', cls: '', w: 100, note: 'every arrival recorded at A&E doors' },
    { v: w4pct.toFixed(1) + '%', k: 'left within 4 hours', cls: 'good', w: Math.min(100, w4pct), note: `${C.fmt(rec.w4)} arrivals` },
    { v: C.fmt(br), k: 'waited longer than 4h', cls: 'hot', w: pctOfAtt(br), note: `${w4pct >= 0 ? (100 - w4pct).toFixed(1) : '—'}% of arrivals` },
    { v: rec.adm != null ? C.fmt(rec.adm) : '—', k: 'admitted to a ward', cls: '', w: rec.adm != null ? pctOfAtt(rec.adm) : 2, note: 'different measure: admissions, not a subset of the wait split' },
    { v: rec.dta != null ? C.fmt(rec.dta) : '—', k: 'waited on a trolley 12h+', cls: 'hot', w: rec.dta != null && rec.adm ? Math.max(2, Math.min(100, 100 * rec.dta / rec.adm)) : 2, note: 'after the decision to admit — % bar shows share of admissions' }
  ];
  return `<div class="tr-block"><h4>The patient journey · ${when}</h4>
    <div class="journey">${steps.map((st, i) =>
      `${i ? '<div class="j-arrow" aria-hidden="true">→</div>' : ''}
       <div class="j-step ${st.cls}"><span class="j-v num">${st.v}</span><span class="j-k">${st.k}</span>
       <span class="j-bar" style="width:${st.w.toFixed(1)}%" role="img"
         aria-label="bar: ${st.w.toFixed(0)} percent of attendances scale"></span>
       <span class="j-n">${st.note}</span></div>`).join('')}</div>
    <div class="tr-note"><b>Read carefully:</b> these measures come from different parts of the monthly return.
      The 4-hour split covers every arrival; admissions and trolley waits follow the admission pathway, so they
      overlap rather than stack. This chart shows scale, not mutually exclusive buckets.</div></div>`;
}

/* ---------- explainable metric tiles ---------- */
let expSeq = 0;
function tile(t) {
  const kHtml = t.gloss
    ? `<button class="gl" type="button" data-term="${t.gloss}">${t.k}</button>` : t.k;
  const badgeHtml = t.badge || '';
  if (!t.explain) return `<div class="tr-stat ${t.cls || ''}">
    <span class="k">${kHtml}</span><span class="v num">${t.v}</span>
    ${t.x ? `<span class="x">${t.x}</span>` : ''}${badgeHtml}</div>`;
  const id = 'exp' + (++expSeq);
  return `<div class="tr-stat ${t.cls || ''}">
    <span class="k">${kHtml}</span><span class="v num">${t.v}</span>
    ${t.x ? `<span class="x">${t.x}</span>` : ''}${badgeHtml}
    <button class="linklike exp-btn" type="button" aria-expanded="false"
      aria-controls="${id}">What does this mean?</button>
    <div class="explainer" id="${id}" hidden>${t.explain}</div></div>`;
}
function wireExplainers(root) {
  root.querySelectorAll('.exp-btn').forEach(btn => {
    const box = document.getElementById(btn.getAttribute('aria-controls'));
    if (!box) return;
    btn.addEventListener('click', () => {
      box.hidden = !box.hidden;
      btn.setAttribute('aria-expanded', String(!box.hidden));
    });
  });
}

/* ---------- main report renderer ---------- */
function renderReport(code) {
  const t = C.BY_CODE.get(code), g = C.GEO_BY_CODE.get(code);
  if (!t || !g) return;
  const hist = C.history(code);
  const eng = C.england12m();
  const ctx = C.contextFor(code, selPeriod);
  // monthly counts are packed at ÷1,000 precision — disclose when coarse
  const rNote = v => (v != null && v > 0 && v < 10000)
    ? ' · rounded to nearest 1K' : '';

  /* --- the one authoritative record for the selected period --- */
  const rec = C.currentRecord(code, selPeriod);        // exact month or latest covered
  const monthMode = !!selPeriod;

  const l12perf = t.attCov ? Math.round(100 * t.w4 / t.attCov * 10) / 10 : null;
  const brTotal = t.br != null ? t.br : (t.attCov != null ? Math.max(t.attCov - t.w4, 0) : null);
  const brShare = brTotal != null && t.attCov ? Math.round(1000 * brTotal / t.attCov) / 10 : null;
  const admShare = t.adm != null && t.att ? Math.round(1000 * t.adm / t.att) / 10 : null;
  const perDay = t.att ? Math.round(t.att / 365) : null;

  /* calendar-year mode: aggregate the most recent complete Jan–Dec */
  const yrRec = cyMode ? C.yearRecord(code, CY) : null;
  const eff = cyMode ? (yrRec || t) : t;   // what the headline tiles describe
  const effPerf = cyMode ? (yrRec && yrRec.att ? 100 * yrRec.w4 / yrRec.att : null) : l12perf;

  /* acute change (10): latest published month vs the rolling average */
  let rollupBadge = null;
  if (!monthMode && l12perf != null) {
    const latest = C.currentRecord(code, null);
    if (latest && latest.cov && latest.att) {
      const mPct = Math.round(1000 * latest.w4 / latest.att) / 10;
      const d = Math.round((mPct - l12perf) * 10) / 10;
      if (Math.abs(d) > 10)
        rollupBadge = `<span class="acute-badge ${d >= 0 ? 'up' : 'down'}">` +
          `${d >= 0 ? '▲' : '▼'} ${Math.abs(d).toFixed(0)}pp vs avg (${C.monthLabel(latest.ym)})</span>`;
    }
  }

  /* records across this trust's whole published archive */
  let bestM = null, worstM = null, busyM = null;
  if (hist) for (const h of hist) {
    if (!busyM || h.att > busyM.att) busyM = h;
    if (!h.cov || !h.att) continue;
    const v = 100 * h.w4 / h.att;
    if (!isFinite(v)) continue;
    if (!bestM || v > bestM.v) bestM = { ym: h.ym, v };
    if (!worstM || v < worstM.v) worstM = { ym: h.ym, v };
  }

  /* national rank on % within 4h across ranked trusts */
  let rankInfo = null;
  if (l12perf != null) {
    const ranked = P.filter(p => p.attCov > 0)
      .map(p => ({ code: p.code, pct: 100 * p.w4 / p.attCov }))
      .sort((a, b) => b.pct - a.pct);
    const pos = ranked.findIndex(r => r.code === code);
    if (pos >= 0) {
      const quart = pos < ranked.length / 4 ? 'top quarter' :
                    pos < ranked.length / 2 ? 'upper half' :
                    pos < ranked.length * 3 / 4 ? 'lower half' : 'bottom quarter';
      rankInfo = { pos: pos + 1, total: ranked.length, quart };
    }
  }

  /* year-on-year change (percentage points) from monthly history */
  let trendD = null;
  if (hist && l12perf != null) {
    const covRows = hist.filter(h => h.cov);
    const avg = rs => rs.length ? rs.reduce((s, h) => s + h.w4, 0) / rs.reduce((s, h) => s + h.att, 0) * 100 : null;
    const now = avg(covRows.slice(-12)), before = avg(covRows.slice(-24, -12));
    if (now != null && before != null && isFinite(before)) trendD = now - before;
  }

  const kindName = t.kind === 'major' ? 'major A&E trust'
                 : t.kind === 'walkin' ? 'walk-in / community sites'
                 : 'single-speciality site';

  /* --- headline tiles: either one month, or the 12-month roll-up --- */
  let tiles, headLabel;
  if (monthMode && (!rec || !rec.cov || !rec.att)) {
    headLabel = `REPORTING MONTH · ${C.monthLabel(selPeriod).toUpperCase()} · NO DATA PUBLISHED`;
    tiles = [
      { k: `attended · ${C.monthLabel(selPeriod)}`, v: rec && rec.att ? C.fmt(rec.att) : 'Data unavailable', x: '', cls: '' },
      { k: 'left within 4 hours', v: 'Data unavailable', x: 'waits not published for this month', cls: '' },
      { k: 'waited longer than 4h', v: 'Data unavailable', x: '', cls: '' },
      { k: 'waited on a trolley 12h+', v: rec && rec.dta != null ? C.fmt(rec.dta) : 'Data unavailable', x: '', cls: '' },
      { k: 'emergency admissions', v: rec && rec.adm != null ? C.fmt(rec.adm) : 'Data unavailable', x: '', cls: '' }
    ];
  } else if (monthMode) {
    const pct = Math.round(1000 * rec.w4 / rec.att) / 10;
    headLabel = `ONE REPORTING MONTH · ${C.monthLabel(selPeriod).toUpperCase()} · NOT THE 12-MONTH AVERAGE`;
    tiles = [
      { k: 'attendances', v: C.fmt(rec.att),
        x: perDay ? `${C.fmtShort(Math.round(rec.att / 30))} arrivals a day` : '', cls: '',
        explain: C.explainer('att', rec.att, { att: rec.att }) },
      { k: 'left within 4 hours', v: pct.toFixed(1) + '%',
        x: pct >= 95 ? 'promise kept this month' : pct < 60 ? 'a very difficult month' : '',
        cls: pct >= 95 ? 'good' : pct < 60 ? 'hot' : '',
        explain: C.explainer('w4', rec.w4, { perf: pct }) },
      { k: 'waited longer than 4h', gloss: 'breach', v: C.fmt(rec.br != null ? rec.br : Math.max(rec.att - rec.w4, 0)),
        x: `${(100 - pct).toFixed(1)}% of visits breached`, cls: (100 - pct) >= 30 ? 'hot' : '',
        explain: C.explainer('br', rec.br != null ? rec.br : Math.max(rec.att - rec.w4, 0), {}) },
      { k: 'waited on a trolley 12h+', gloss: 'trolley', v: rec.dta != null ? C.fmt(rec.dta) : 'Data unavailable',
        x: (rec.dta != null ? 'no ward bed after decision to admit' : 'not published this month') + rNote(rec.dta), cls: '',
        explain: rec.dta != null ? C.explainer('dta', rec.dta, {}) : null },
      { k: 'emergency admissions', v: rec.adm != null ? C.fmt(rec.adm) : 'Data unavailable',
        x: (rec.adm != null && rec.att ? `${Math.round(1000 * rec.adm / rec.att) / 10}% of arrivals admitted` : '') + rNote(rec.adm), cls: '',
        explain: rec.adm != null ? C.explainer('adm', rec.adm, { att: rec.att }) : null }
    ];
  } else {
    headLabel = cyMode
      ? `CALENDAR YEAR ${CY} · JAN–DEC · ${yrRec ? yrRec.months : 0} MONTHS PUBLISHED`
      : `ROLLING WINDOW · LAST ${t.months} REPORTED MONTHS · TO ${C.monthLabel(C.LAST_YM).toUpperCase()}`;
    tiles = [
      { k: cyMode ? `attendances · calendar year ${CY}` : 'attended · last 12 months',
        v: eff.att != null ? C.fmt(eff.att) : 'Data unavailable',
        x: perDay ? `${C.fmtShort(perDay)} arrivals a day` : '', cls: '',
        explain: C.explainer('att', eff.att, { att: eff.att }) },
      { k: 'left within 4 hours', badge: rollupBadge, v: effPerf != null ? effPerf.toFixed(1) + '%' : 'Data unavailable',
        x: effPerf == null ? '' : effPerf >= 95 ? 'promise kept on average'
          : effPerf < eng.perf ? 'below England average' : 'above England average',
        cls: effPerf == null ? '' : (effPerf >= 95 ? 'good' : effPerf < 60 ? 'hot' : ''),
        explain: C.explainer('w4', eff.w4, { perf: effPerf }) },
      { k: 'waited longer than 4h', gloss: 'breach',
        v: (cyMode ? yrRec.br : brTotal) != null ? C.fmt(cyMode ? yrRec.br : brTotal) : 'Data unavailable',
        x: (!cyMode && brShare != null) ? `${brShare}% of visits breached`
          : (cyMode && yrRec && yrRec.att ? `${Math.round(1000 * yrRec.br / yrRec.att) / 10}% of visits breached` : ''),
        cls: brShare != null && brShare >= 30 ? 'hot' : '',
        explain: C.explainer('br', cyMode ? yrRec.br : brTotal, {}) },
      { k: 'waited on a trolley 12h+', gloss: 'trolley',
        v: (cyMode ? yrRec.dta : t.dta) != null ? C.fmt(cyMode ? yrRec.dta : t.dta) : 'Data unavailable',
        x: (cyMode ? yrRec.dta : t.dta) ? 'no ward bed after decision to admit' : '', cls: '',
        explain: C.explainer('dta', cyMode ? yrRec.dta : t.dta, {}) },
      { k: 'emergency admissions', v: (cyMode ? yrRec.adm : t.adm) != null ? C.fmt(cyMode ? yrRec.adm : t.adm) : 'Data unavailable',
        x: (!cyMode && admShare != null) ? `${admShare}% of arrivals admitted`
          : (cyMode && yrRec && yrRec.adm != null && yrRec.att ? `${Math.round(1000 * yrRec.adm / yrRec.att) / 10}% of arrivals admitted` : ''), cls: '',
        explain: C.explainer('adm', cyMode ? yrRec.adm : t.adm, { att: eff.att }) },
      { k: 'met the 95% promise', v: `${t.met} of ${t.months} months`,
        x: t.met === 0 ? 'not once in the window' : '', cls: t.met ? 'good' : '' },
      { k: 'busiest month on record', v: busyM ? C.fmt(busyM.att) : '—',
        x: busyM ? C.monthLabel(busyM.ym) : '', cls: '' }
    ];
    if (rankInfo) tiles.push({ k: 'performance rank · England',
      v: `#${rankInfo.pos} of ${rankInfo.total}`, x: `${rankInfo.quart} on four-hour waits`, cls: '' });
    if (trendD != null) tiles.push({ k: 'vs previous 12 months',
      v: `${trendD >= 0 ? '+' : ''}${trendD.toFixed(1)}pp`,
      x: trendD >= 0 ? 'improving' : 'declining', cls: trendD >= 0 ? 'good' : 'hot' });
  }

  /* --- draggable reporting-period timeline ---
     Right end of the slider = "latest". Dragging or arrowing anywhere else
     pins that exact month; every component reads the same selPeriod.     */
  const periodsBar = (() => {
    if (!hist || !hist.length) return '';
    const maxI = C.PERIODS.length - 1;
    const cur = selPeriod || C.LAST_YM;
    const idx = Math.max(0, C.PERIODS.indexOf(cur));
    return `<div class="tr-period" role="group" aria-label="Reporting period timeline">
      <button type="button" class="per-btn" id="per-prev"
        aria-label="Previous reporting period">←</button>
      <div class="per-track">
        <input type="range" class="per-range" id="per-range" min="0" max="${maxI}" value="${idx}" step="1"
          aria-label="Drag to change reporting period, ${C.monthLabel(C.PERIODS[0])} to ${C.monthLabel(C.LAST_YM)}"
          aria-valuetext="${monthMode ? C.monthLabel(selPeriod) : 'Latest · ' + C.monthLabel(C.LAST_YM)}" />
        <div class="per-ends"><span>${C.PERIODS[0].slice(2, 4)}</span><span>${C.LAST_YM.slice(2, 4)}</span></div>
      </div>
      <button type="button" class="per-btn" id="per-next"
        aria-label="Next reporting period">→</button>
      <span class="per-label num">${monthMode ? C.monthLabel(selPeriod) : 'Latest · ' + C.monthLabel(C.LAST_YM)}</span>
    </div>`;
  })();

  /* trend chart (monthly % within 4h) */
  let sparkSvg = '', sparkNote = '', sparkMeta = null;
  if (hist) {
    const pts = hist.filter(h => h.cov).map(h => ({
      ym: h.ym, v: 100 * h.w4 / h.att, att: h.att, br: h.br != null ? h.br : h.att - h.w4,
      adm: h.adm != null ? Math.round(h.adm * 1000) : null,
      dta: h.dta != null ? Math.round(h.dta * 1000) : null
    })).filter(p => isFinite(p.v));
    if (pts.length > 3) {
      const W2 = 280, H2 = 96, padL = 6, padT = 6;
      const ih = H2 - padT - 16;
      const xs = i => padL + i / (pts.length - 1) * (W2 - 2 * padL);
      const ys = p => padT + (1 - (Math.min(Math.max(p.v, 40), 100) - 40) / 60) * ih;
      const path = pts.map((p, i) => (i ? 'L' : 'M') + xs(i).toFixed(1) + ',' + ys(p).toFixed(1)).join('');
      const yLine = (padT + (1 - .9167) * ih).toFixed(1);
      const years = pts.map((p, i) => ({ p, i }))
        .filter(({ p }) => p.ym.endsWith('-01'))
        .map(({ p, i }) => `<text x="${xs(i).toFixed(1)}" y="${H2 - 4}" font-size="8"
          fill="#768692" text-anchor="middle">${p.ym.slice(2, 4)}</text>`).join('');
      sparkMeta = { pts };
      // mark the selected period on the timeline
      const selPt = selPeriod ? pts.find(p => p.ym === selPeriod) : pts[pts.length - 1];
      const selMark = selPt ? `<circle cx="${xs(pts.indexOf(selPt)).toFixed(1)}" cy="${ys(selPt).toFixed(1)}"
        r="4.6" fill="none" stroke="var(--warm)" stroke-width="2"/>` : '';
      sparkSvg = `<div class="tr-sparkwrap"><svg class="tr-spark" viewBox="0 0 ${W2} ${H2}" role="img"
        aria-label="Monthly share seen within four hours, ${pts[0].ym} to ${pts[pts.length-1].ym}: started near ${pts[0].v.toFixed(0)} percent, now about ${pts[pts.length-1].v.toFixed(0)} percent. Touch or hover any point for that month's details.">
        <line x1="${padL}" x2="${W2-padL}" y1="${yLine}" y2="${yLine}" stroke="#41B6E6" stroke-dasharray="4 4" opacity=".8"/>
        <path d="${path}" fill="none" stroke="#005EB8" stroke-width="2"/>
        <circle cx="${xs(pts.length-1).toFixed(1)}" cy="${ys(pts[pts.length-1]).toFixed(1)}" r="3.4" fill="#005EB8"/>
        ${selMark}
        <circle class="pt-hl" r="4" fill="#FFFFFF" stroke="#005EB8" stroke-width="2" opacity="0"/>
        ${years}
        ${pts.map((p, i) => `<circle class="tr-pt" data-i="${i}" data-ym="${p.ym}" cx="${xs(i).toFixed(1)}" cy="${ys(p).toFixed(1)}" r="7" fill="transparent"/>`).join('')}
      </svg><div class="tr-tip" hidden></div></div>`;
      sparkNote = `<div class="tr-note">Touch or hover any point for that month's numbers — tap a point again to pin
        that reporting period above. The dashed line is the 95% promise. <span class="say">Best month
        ${Math.max(...pts.map(p=>p.v)).toFixed(0)}% · worst ${Math.min(...pts.map(p=>p.v)).toFixed(0)}%</span>.</div>`;
    }
  }

  /* --- performance context for the headline metric (same basis everywhere) --- */
  const ctxLine = (() => {
    if (!ctx || ctx.perf == null) return '';
    const pp = (a, b) => a == null || b == null ? null : Math.round((a - b) * 100) / 100;
    const dPrev = pp(ctx.perf, ctx.prev), dEng = pp(ctx.perf, ctx.eng), dReg = pp(ctx.perf, ctx.reg);
    const seg = (label, val, delta, refLabel) => {
      if (val == null) return `<span class="ctx-item"><span class="ctx-k">${label}</span><span class="nodata-inline">not published</span></span>`;
      return `<span class="ctx-item"><span class="ctx-k">${label}</span><span class="num">${val.toFixed(1)}%</span>` +
        (delta != null ? ` <span class="ctx-d ${delta >= 0 ? 'up' : 'down'} num">${delta >= 0 ? '+' : ''}${delta.toFixed(1)}pp</span>` : '') +
        (refLabel ? `<span class="ctx-ref">${refLabel}</span>` : '') + '</span>';
    };
    const prevLbl = ctx.basis === 'month'
      ? (ctx.prevYm ? 'vs ' + C.monthLabel(ctx.prevYm) : '')
      : 'vs previous 12m';
    return `<div class="tr-ctx" role="group" aria-label="Performance context">
      ${seg('This period', ctx.perf)}
      ${seg(prevLbl, ctx.prev)}
      ${seg(ctx.basis === 'month' ? 'England · that month' : 'England · rolling 12-mo avg', ctx.eng, dEng)}
      ${ctx.regN >= 3 ? seg('Region (' + ctx.regN + ' trusts)', ctx.reg, dReg) : ''}
      ${dPrev != null && Math.abs(dPrev) >= 0.05
        ? `<div class="tr-note">So 4-hour performance ${dPrev >= 0 ? 'improved' : 'declined'} by
           <b class="num">${Math.abs(dPrev).toFixed(1)} percentage points</b> versus the previous
           ${ctx.basis === 'month' ? 'published month' : '12 months'}.</div>`
        : ''}
    </div>`;
  })();

  /* --- data-quality status for the current view --- */
  const dq = (() => {
    if (monthMode) {
      if (!rec) return { cls: 'warn', icon: '!', text: `no report published for this trust in ${C.monthLabel(selPeriod)}` };
      if (!rec.cov) return { cls: 'warn', icon: '!', text: 'attendance counts only — waits not published this month' };
      return { cls: 'ok', icon: '●', text: 'complete report' };
    }
    return t.months >= 12 ? { cls: 'ok', icon: '●', text: 'complete window' }
      : { cls: 'warn', icon: '!', text: `${t.months} of 12 recent reporting periods available` };
  })();
  const dqPill = `<span class="dq ${dq.cls}" title="${dq.text}"><span aria-hidden="true">${dq.icon}</span> <span class="sr-only">Data status: </span>${dq.text}</span>`;

  /* --- best & worst published periods — clickable shortcuts --- */
  const bwChips = bestM && worstM && bestM.ym !== worstM.ym ? `
    <div class="tr-bestworst">
      <button type="button" class="bw-chip good" data-goto-ym="${bestM.ym}"
        title="Open ${C.monthLabel(bestM.ym)}">▲ best · ${C.monthLabel(bestM.ym)} (${bestM.v.toFixed(1)}%)</button>
      <button type="button" class="bw-chip hot" data-goto-ym="${worstM.ym}"
        title="Open ${C.monthLabel(worstM.ym)}">▼ hardest · ${C.monthLabel(worstM.ym)} (${worstM.v.toFixed(1)}%)</button>
    </div>` : '';

  /* --- optional deeper exploration: month × month heatmap --- */
  const heatmap = (() => {
    if (!hist || hist.length < 24) return '';
    const years = {};
    hist.forEach(h => {
      const y = h.ym.slice(0, 4);
      (years[y] = years[y] || {})[h.ym.slice(5, 7)] = h;
    });
    const bucketCls = v => v >= 95 ? 'b95' : v >= 80 ? 'b80' : v >= 70 ? 'b70' : v >= 60 ? 'b60' : 'bx';
    const rows = Object.keys(years).sort().map(y => {
      let cells = '';
      for (let mth = 1; mth <= 12; mth++) {
        const k = String(mth).padStart(2, '0');
        const h = years[y][k];
        if (!h) { cells += '<div class="hm-cell none" role="presentation"></div>'; continue; }
        if (!h.cov || !h.att) {
          cells += `<div class="hm-cell miss" title="${C.monthLabel(h.ym)} — waits not published"></div>`;
          continue;
        }
        const v = 100 * h.w4 / h.att;
        const engV = C.englandMonthPerf(h.ym);
        cells += `<button type="button" class="hm-cell ${bucketCls(v)}" data-goto-ym="${h.ym}"
          title="${C.monthLabel(h.ym)}: ${v.toFixed(1)}% within 4h${engV != null ? ` (England ${engV.toFixed(1)}%)` : ''} — click to open"
          aria-label="${C.monthLabel(h.ym)}: ${v.toFixed(1)} percent within four hours${engV != null ? `, England ${engV.toFixed(1)} percent` : ''}. Click to open this period."></button>`;
      }
      return `<div class="hm-row"><span class="hm-year num">${y}</span>${cells}</div>`;
    }).join('');
    return `<details class="about-data hm-wrap"><summary>Performance heatmap · every reported month</summary>
      <div class="hm" role="grid" aria-label="Monthly four-hour performance heatmap; each cell is one month, click to open it">
        ${rows}
      </div>
      <div class="hm-scale">
        <span>hardest</span>
        <span class="hm-cell bx"></span><span class="hm-cell b60"></span><span class="hm-cell b70"></span>
        <span class="hm-cell b80"></span><span class="hm-cell b95"></span>
        <span>&nbsp;95%+ promise met</span>
        <span class="hm-cell miss"></span><span>= waits not published</span>
        <span class="hm-cell none"></span><span>= no report that month</span>
      </div></details>`;
  })();

  /* front-door type split */
  let splitHtml = '';
  if (t.kind === 'major') {
    const tot = (t.t1 || 0) + (t.t3 || 0);
    const s1 = tot ? Math.round(100 * t.t1 / tot) : null;
    splitHtml = `<div class="tr-block"><h4>The front doors</h4>
      <div class="tr-note"><b>Major A&amp;E trust.</b> Last year its consultant-led (Type 1) departments handled
      <b class="num">${t.t1 ? C.fmt(t.t1) : '—'}</b> visits${s1 != null ? ` — <b class="num">${s1}%</b> of its front-door traffic` : ''}, against
      <b class="num">${t.t3 ? C.fmt(t.t3) : '—'}</b> at walk-in / urgent-care doors.</div>
      ${tot ? `<div class="tr-split"><span style="flex:${t.t1};background:rgba(94,234,212,.75)"></span><span style="flex:${t.t3};background:rgba(125,211,252,.55)"></span></div>
      <div class="tr-split-legend"><span>Type 1 consultant-led A&amp;E${s1 != null ? ' · ' + s1 + '%' : ''}</span>
      <span>walk-in / urgent care${s1 != null ? ' · ' + (100 - s1) + '%' : ''}</span></div>` : ''}</div>`;
  } else {
    splitHtml = `<div class="tr-block"><h4>The front doors</h4><div class="tr-note">${
      t.kind === 'walkin'
        ? '<b>Walk-in / community site.</b> Minor injuries and urgent care without an appointment — a smaller world with no ward bottleneck behind the door.'
        : '<b>Single-speciality service.</b> e.g. eye casualty — low volume, specialist care.'}</div></div>`;
  }

  /* regional context — computed from real trust rows only */
  const coh = C.cohortStats(code);
  let regionHtml = '';
  const reg = t.region ? C.regionStats(t.region) : null;
  regionHtml = `<div class="tr-block"><h4>Where this trust sits</h4><div class="tr-note">
    ${t.region ? `Region: <b>${t.region}</b>. ` : '<span class="nodata-inline">region not derivable for this site.</span> '}
    ${reg && reg.perf != null
      ? `Across its <b>${reg.n}</b> reporting trusts, ${t.region} averaged <b class="num">${reg.perf.toFixed(1)}%</b> within 4 hours
         over the same window. `
      : ''}${eng.perf != null ? `England average · rolling 12 months: <b class="num">${eng.perf.toFixed(1)}%</b>. ` : ''}
    ${l12perf != null && reg && reg.perf != null
      ? l12perf >= reg.perf
        ? `So this trust performs <b>better than</b> its regional average.`
        : `So this trust performs <b>below</b> its regional average.` : ''}
    ${reg ? `<div class="mini-bars">
      ${[['This trust', l12perf],
         [t.region || 'Region', reg ? reg.perf : null],
         coh ? [`Similar size · ${coh.label} (${coh.n})`, coh.perf] : null,
         ['England', eng.perf]].filter(Boolean).map(([k, v], i) =>
        `<div class="mb-row"><span class="mb-k">${k}</span>
         <span class="mb-track">${v != null ? `<span class="mb-bar hue${i}" style="width:${Math.max(2, (v - 40) / 60 * 100)}%"></span>` : '<span class="nodata-inline">no data</span>'}</span>
         <span class="mb-v num">${v != null ? v.toFixed(1) + '%' : '—'}</span></div>`).join('')}
    </div>` : ''}
    <span class="x-note">Bars share one 40–100% scale. “Similar size” aggregates same-type trusts in the same
    attendance quartile (${coh ? coh.n : 0} peers) — real rows, no re-weighting. Regional averages aggregate real monthly reports from trusts placed
    in the region by their registered postcode — nothing is estimated.</span></div></div>`;

  /* deterministic insights */
  const insList = C.insights(code);
  const insHtml = insList.length ? `<div class="tr-block"><h4>What stands out?</h4><ul class="insights">${
    insList.map(i => `<li class="ins-${i.tone}"><span class="ins-icon" aria-hidden="true">${i.icon}</span>${i.text}</li>`).join('')
  }</ul><div class="tr-note">Every statement above is computed from the cleaned monthly reports and names its own
    comparison basis. No causes are claimed — patterns only.</div></div>` : '';

  /* transparency footer */
  const pubMonths = hist ? hist.filter(h => h.cov).length : 0;
  const totMonths = hist ? hist.length : 0;
  const aboutHtml = `<details class="about-data"><summary>About this data</summary><ul>
    <li><b>Source:</b> NHS England monthly “A&amp;E Attendances and Emergency Admissions” statistics, cleaned and
      reconciled in the warehouse table <code>fct_ae_activity</code> (one row per site per month).</li>
    <li><b>Reporting period shown:</b> ${monthMode ? C.monthLabel(selPeriod) + ' (single month)' :
      `last ${t.months} reported months, ending ${C.monthLabel(C.LAST_YM)}`}.</li>
    <li><b>Coverage:</b> waiting-time detail published for <b>${pubMonths}</b> of ${totMonths} months since April 2017
      in this trust's archive. Months marked “Data unavailable” have no published figures — nothing is estimated.</li>
    <li><b>Region:</b> derived from the trust's registered headquarters postcode (${g.src === 'ods' ? C.GEO_BY_CODE.get(code).detail : 'placement record'});
      regional averages sum real reports from trusts in the same region.</li>
    <li><b>Precision:</b> single-month counts of admissions and trolley waits are shown rounded to the nearest
      thousand (${'~'}±500); attendances and 4-hour waits to the nearest ten. Rolling 12-month figures and all
      percentages are computed at full precision.</li>
    <li><b>Limitations:</b> the 4-hour clock runs from arrival to departure, including waits after a decision to admit;
      these figures measure waits, not outcomes; organisations sometimes merge or rename (history stays attached by code).</li>
  </ul></details>`;

  /* actions: export + share */
  const actionsHtml = `<div class="tr-actions">
     <button class="linklike" id="tr-csv" type="button">Download CSV</button>
     <button class="linklike" id="tr-share" type="button">Share card (PNG)</button>
     <button class="linklike" id="tr-copy" type="button">Copy link</button>
     <button class="linklike" id="tr-print" type="button">Print / PDF</button>
  </div>`;

  /* assemble */
  trBody.hidden = false;
  trBody.innerHTML = `
    <div class="tr-kicker">Trust report<span style="color:var(--dim)">·</span><span class="num">${code}</span>
      <button class="linklike" id="tr-compare" type="button"
        title="${cmpCodes.includes(code) ? 'Remove from comparison' : 'Pin for side-by-side comparison (2–4 trusts)'}">${cmpCodes.includes(code) ? '✓ comparing' : '+ compare'}</button></div>
    <div class="tr-name">${t.name}</div>
    <div class="tr-window num">${kindName}${t.region ? ' · ' + t.region : ''} · ${headLabel}</div>
    ${dqPill}
    ${!monthMode && hist ? `<div class="basis-toggle" role="group" aria-label="Reporting basis">
      <button type="button" class="bt-btn ${!cyMode ? 'on' : ''}" data-basis="roll"
        aria-pressed="${!cyMode}">Rolling 12m</button>
      <button type="button" class="bt-btn ${cyMode ? 'on' : ''}" data-basis="cy"
        aria-pressed="${cyMode}">Calendar year</button>
    </div>` : ''}

    ${periodsBar}
    ${monthMode && (!rec || !rec.cov) ? `<div class="tr-unavailable">The NHS did not publish complete waiting-time
      figures for this trust in ${selPeriod ? C.monthLabel(selPeriod) : 'this month'}, so the affected metrics read
      “Data unavailable” rather than an invented number.</div>` : ''}

    <div class="tr-statgrid">${tiles.map(tile).join('')}</div>

    ${ctxLine}

    ${buildJourney(t, monthMode ? rec
      : (cyMode && yrRec ? Object.assign({}, yrRec, { ym: null, labelOverride: `calendar year ${CY}` }) : rec))}

    ${sparkSvg ? `<div class="tr-block"><h4>The eleven-year slide at this trust</h4>${sparkSvg}${sparkNote}${bwChips}</div>` :
       `<div class="tr-unavailable">Monthly waiting-time history isn't available for this site in the cleaned dataset.</div>`}

    ${heatmap}

    ${regionHtml}

    ${splitHtml}

    ${buildCompareBlock()}

    ${insHtml}

    ${actionsHtml}

    ${aboutHtml}

    <div class="tr-block"><h4>About this location</h4>
      <div class="tr-note">${g.src === 'ods'
        ? `Placed at its registered headquarters postcode (<span class="num">${g.detail}</span>) via NHS Digital.`
        : g.src.startsWith('osm') ? 'Placed from OpenStreetMap hospital operator records.'
        : g.src === 'wd' ? 'Placed from its Wikidata headquarters coordinate.'
        : `Position approximate (${g.detail}) — no official coordinate was available.`}</div></div>`;

  /* wire controls created above */
  const btn = document.getElementById('tr-compare');
  if (btn) btn.addEventListener('click', () => toggleCompare(code));
  const clear = document.getElementById('tr-cmp-clear');
  if (clear) clear.addEventListener('click', () => { cmpCodes = []; renderReport(selected); });

  const prevB = document.getElementById('per-prev');
  if (prevB) prevB.addEventListener('click', () => stepPeriod(-1));
  const nextB = document.getElementById('per-next');
  if (nextB) nextB.addEventListener('click', () => stepPeriod(+1));
  const range = document.getElementById('per-range');
  if (range) {
    const maxV = +range.max;
    const labelFor = v => v >= maxV ? 'Latest · ' + C.monthLabel(C.LAST_YM)
                                   : C.monthLabel(C.PERIODS[v]);
    const lab = trBody.querySelector('.per-label');
    // while dragging: live-preview the label only — the heavy panel rebuild
    // waits for release, so the thumb never loses its drag
    range.addEventListener('input', () => {
      const txt = labelFor(+range.value);
      if (lab) lab.textContent = txt;
      range.setAttribute('aria-valuetext', txt);
    });
    range.addEventListener('change', () => {         // commit on release / arrow key
      interacted = true;
      setPeriod(+range.value >= maxV ? null : C.PERIODS[+range.value]);
    });
    range.addEventListener('keydown', ev => ev.stopPropagation()); // arrows move the timeline, not the page
  }
  trBody.querySelectorAll('[data-goto-ym]').forEach(b =>
    b.addEventListener('click', () => gotoPeriod(b.dataset.gotoYm)));
  trBody.querySelectorAll('.bt-btn').forEach(b =>
    b.addEventListener('click', () => {
      const next = b.dataset.basis === 'cy';
      if (next === cyMode) return;
      cyMode = next;
      renderReport(selected);          // session-level choice; not in the URL
    }));

  wireExplainers(trBody);

  const csvBtn = document.getElementById('tr-csv');
  if (csvBtn) csvBtn.addEventListener('click', () => downloadCsv(code));
  const shareBtn = document.getElementById('tr-share');
  if (shareBtn) {
    shareBtn.addEventListener('click', () => {
      shareBtn.textContent = '⏳ rendering…';
      renderShareCard(code, () => { shareBtn.textContent = 'Share card (PNG)'; });
    });
  }
  const copyBtn = document.getElementById('tr-copy');
  if (copyBtn) copyBtn.addEventListener('click', async () => {
    const url = location.origin + location.pathname + C.buildHash(code, selPeriod);
    try { await navigator.clipboard.writeText(url); copyBtn.textContent = '✓ copied';
      setTimeout(() => { copyBtn.textContent = 'Copy link'; }, 1600); }
    catch (e) { window.prompt('Copy this link:', url); }
  });
  const printBtn = document.getElementById('tr-print');
  if (printBtn) printBtn.addEventListener('click', () => window.print());

  // clicking a spark point pins that month as the reporting period
  const wrapEl = trBody.querySelector('.tr-sparkwrap');
  if (wrapEl && sparkMeta) {
    const tip = wrapEl.querySelector('.tr-tip');
    const hl = wrapEl.querySelector('.pt-hl');
    const { pts } = sparkMeta;
    const show = c => {
      const p = pts[+c.dataset.i];
      hl.setAttribute('cx', c.getAttribute('cx'));
      hl.setAttribute('cy', c.getAttribute('cy'));
      hl.setAttribute('opacity', '1');
      if (!tip) return;
      tip.hidden = false;
      tip.innerHTML =
        `<div class="t-date">${C.monthLabel(p.ym).toUpperCase()}</div>
         <b class="num" style="font-size:15px">${p.v.toFixed(1)}%</b> seen within 4 hours<br>
         <span class="num">${C.fmt(p.att)}</span> arrived ·
         <span class="num">${C.fmt(p.br)}</span> waited longer than 4h` +
        (p.dta != null ? `<br><span class="num">${C.fmt(p.dta)}</span> trolley waits 12h+` : '') +
        (p.adm != null ? ` · <span class="num">${C.fmt(p.adm)}</span> admitted` : '');
      const wr = wrapEl.getBoundingClientRect();
      tip.style.left = Math.min(Math.max(
        (+c.getAttribute('cx')) / 280 * wr.width - 60, 0), Math.max(wr.width - 130, 0)) + 'px';
    };
    const hideTip = () => { if (tip) tip.hidden = true; hl.setAttribute('opacity', '0'); };
    wrapEl.querySelectorAll('.tr-pt').forEach(c => {
      c.addEventListener('pointerenter', () => show(c));
      c.addEventListener('pointerleave', hideTip);
      c.addEventListener('click', () => {                       // pin the period
        interacted = true;
        setPeriod((selPeriod === c.dataset.ym) ? null : c.dataset.ym);
      });
    });
    wrapEl.addEventListener('pointerleave', hideTip);
  }
  animatePanel();
}

/* ← Previous period | APRIL 2026 | Next period → */
function stepPeriod(dir) {
  const idx = C.PERIODS.indexOf(selPeriod || C.LAST_YM);
  const next = C.PERIODS[idx + dir];
  if (!next && !(dir > 0 && selPeriod)) return;
  setPeriod(dir > 0 ? (idx === C.PERIODS.length - 1 ? null : next) : next);
}

/* open an exact reporting period (best/worst chips, heatmap cells) */
function gotoPeriod(ym) {
  if (!C.PERIODS.includes(ym)) return;
  interacted = true;
  setPeriod(ym === C.LAST_YM ? null : ym);
}

/* ───────────── shareable trust report card (PNG, client-side) ─────────────
   1200×630 social-size summary of the selected trust, drawn as pure SVG in
   the site's palette and rasterised through <canvas>. No external fonts,
   images or libraries → untainted canvas, instant generation. Every value
   comes from data-core for THIS trust only.                                */
function escXml(s) {
  return String(s).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}
function wrapFor(text, maxChars) {
  const words = String(text).split(' '), lines = [];
  let cur = '';
  words.forEach(w => {
    if ((cur + ' ' + w).trim().length > maxChars && cur) { lines.push(cur.trim()); cur = w; }
    else cur += ' ' + w;
  });
  if (cur.trim()) lines.push(cur.trim());
  return lines;
}
/* deterministic per-trust "biggest discovery": strongest stat this trust's
   own data supports */
function trustDiscovery(t) {
  if (t.dta != null && t.adm != null && t.adm > 0) {
    return C.fmt(t.dta) + ' times last year, a patient waited 12+ hours on a trolley after doctors had decided to admit them — ' +
      (Math.round(1000 * t.dta / t.adm) / 10) + '% of all emergency admissions.';
  }
  if (t.br != null && t.attCov > 0) {
    return C.fmt(t.br) + ' visits waited longer than four hours last year — ' +
      (Math.round(1000 * t.br / t.attCov) / 10) + '% of everyone who arrived.';
  }
  return 'This site kept the 95% promise in ' + t.met + ' of its ' + t.months + ' recent reporting months.';
}

function downloadCsv(code) {
  const csv = C.reportCsv(code);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `ae-report-${code}${selPeriod ? '-' + selPeriod : ''}.csv`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 400);
}

function buildShareSvg(code) {
  const t = C.BY_CODE.get(code);
  if (!t) return null;
  const ctx = C.contextFor(code, null);
  const perf = ctx && ctx.perf != null ? ctx.perf : null;
  const engP = ctx ? ctx.eng : null;
  const dEng = perf != null && engP != null ? perf - engP : null;
  // hex mirrors of the site tokens — SVG rasterised via <img> cannot read
  // CSS custom properties
  const P = { bg: '#FFFFFF', line: '#E8EDEE', dim: '#768692', muted: '#425563',
              ink: '#231F20', accent: '#005EB8', warm: '#41B6E6', hot: '#003087' };
  const W = 1200, H = 630;

  const nameLines = wrapFor(t.name, 34).slice(0, 2);
  let yName = 158;
  const nameSvg = nameLines.map((l, i) =>
    '<text x="70" y="' + (yName + i * 52) + '" font-family="Georgia,serif" font-size="' +
    (nameLines.length > 1 ? 40 : 46) + '" fill="' + P.ink + '">' + escXml(l) + '</text>').join('');
  yName += nameLines.length * 52 - 10;

  const discLines = wrapFor(trustDiscovery(t), 46).slice(0, 3);
  const discSvg = discLines.map((l, i) =>
    '<text x="620" y="' + (yName + 66 + i * 38) +
    '" font-family="Helvetica,Arial,sans-serif" font-size="25" fill="' + P.muted + '">' +
    escXml(l) + '</text>').join('');

  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">' +
    '<rect width="' + W + '" height="' + H + '" fill="' + P.bg + '"/>' +
    '<rect width="' + W + '" height="5" fill="' + P.accent + '"/>' +
    '<rect x="60" y="42" width="96" height="38" rx="4" fill="#005EB8"/>' +
    '<text x="108" y="68" text-anchor="middle" font-family="Arial,sans-serif" font-style="italic" font-weight="700" font-size="26" fill="#ffffff">NHS</text>' +
    '<text x="176" y="67" font-family="Menlo,Consolas,monospace" font-size="19" letter-spacing="3" fill="' + P.dim + '">A&amp;E · TRUST REPORT</text>' +
    '<text x="' + (W - 60) + '" y="67" text-anchor="end" font-family="Menlo,Consolas,monospace" font-size="17" fill="' + P.warm + '">' +
      escXml('last 12 months · to ' + C.monthLabel(C.LAST_YM)) + '</text>' +
    nameSvg +
    '<rect x="70" y="' + (yName - 26) + '" width="118" height="30" rx="15" fill="none" stroke="' + P.line + '"/>' +
    '<text x="129" y="' + (yName - 5) + '" text-anchor="middle" font-family="Menlo,Consolas,monospace" font-size="16" fill="' + P.muted + '">' + escXml(code) + '</text>' +
    (t.region ? '<text x="204" y="' + (yName - 4) + '" font-family="Helvetica,Arial,sans-serif" font-size="18" fill="' + P.dim + '">' + escXml(t.region) + '</text>' : '') +
    '<text x="64" y="' + (yName + 96) + '" font-family="Georgia,serif" font-size="104" fill="' + P.accent + '">' +
      (perf != null ? perf.toFixed(1) + '%' : 'n/a') + '</text>' +
    '<text x="70" y="' + (yName + 132) + '" font-family="Menlo,Consolas,monospace" font-size="16" letter-spacing="2" fill="' + P.muted + '">LEFT WITHIN 4 HOURS · LAST 12 MONTHS</text>' +
    '<line x1="600" y1="' + (yName - 30) + '" x2="600" y2="' + (H - 120) + '" stroke="' + P.line + '"/>' +
    '<text x="632" y="' + (yName + 4) + '" font-family="Helvetica,Arial,sans-serif" font-size="27" fill="' + P.ink + '">England average: ' +
      (engP != null ? engP.toFixed(1) + '%' : 'n/a') + '</text>' +
    (dEng != null ? '<text x="632" y="' + (yName + 42) + '" font-family="Helvetica,Arial,sans-serif" font-size="27" fill="' +
      (dEng >= 0 ? P.accent : P.hot) + '">' + (dEng >= 0 ? '+' : '') + dEng.toFixed(1) + ' percentage points vs England</text>' : '') +
    '<text x="632" y="' + (yName + 92) + '" font-family="Menlo,Consolas,monospace" font-size="15" letter-spacing="3" fill="' + P.warm + '">WHAT STANDS OUT</text>' +
    discSvg +
    '<rect x="60" y="' + (H - 78) + '" width="' + (W - 120) + '" height="1" fill="' + P.line + '"/>' +
    '<text x="60" y="' + (H - 44) + '" font-family="Menlo,Consolas,monospace" font-size="16" fill="' + P.accent + '">akidima.github.io/nhs-ae-analytics/#' + escXml(code) + '</text>' +
    '<text x="' + (W - 60) + '" y="' + (H - 44) + '" text-anchor="end" font-family="Menlo,Consolas,monospace" font-size="15" fill="' + P.dim + '">Data © NHS England · OGL v3 · cleaned monthly reports</text>' +
    '</svg>';
  return svg;
}

function renderShareCard(code, done) {
  const svg = buildShareSvg(code);
  if (!svg) { if (done) done(); return; }
  const W = 1200, H = 630;
  // rasterise natively: same-origin blob SVG → canvas → PNG (untainted)
  const img = new Image();
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  img.onload = () => {
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    cv.getContext('2d').drawImage(img, 0, 0);
    URL.revokeObjectURL(url);
    cv.toBlob(blob => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = code + '-' + C.LAST_YM + '-report.png';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 400);
      done();
    }, 'image/png');
  };
  img.onerror = () => { URL.revokeObjectURL(url); done(); };
  img.src = url;
}

/* ---------- wire the store ---------- */
let lastSel = null, lastPeriod = null;
on((sel, hov, ev) => {
  // map legend/tooltips must match the current (metric, period) pair
  updateMapAnalysis();
  // cheap visual states react to every emit (hover included)
  listEl.querySelectorAll('.t-item').forEach(b => {
    const on_ = b.dataset.code === sel;
    b.classList.toggle('sel', on_);
    b.setAttribute('aria-selected', String(on_));
  });
  applyMarkerStates();

  if (ev === 'period' || (sel === lastSel && selPeriod !== lastPeriod)) {
    lastPeriod = selPeriod;
    if (sel) renderReport(sel);
    return;
  }
  if (sel === lastSel) return;      // hover-only change → stop here
  lastSel = sel;
  lastPeriod = selPeriod;
  if (!sel) return;                 // panel always keeps the last report

  userNavigating = true;
  syncHash(!restoring);             // pick = new entry; restore = replace, keep forward stack

  trBody.hidden = false;
  const rep = document.getElementById('trust-report');
  if (rep) rep.scrollTop = 0;
  renderReport(sel);                // immediately — no skeleton, no delay

  // narrow layouts stack the report below the map — bring it into view,
  // but only for genuine user selections (never on initial page load)
  if (interacted && rep && rep.getBoundingClientRect().top > window.innerHeight * .55)
    rep.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'nearest' });

  // every selection — marker, list or link — flies the camera to the
  // trust's actual location and zooms in close enough to read it
  const g = C.GEO_BY_CODE.get(sel);
  if (g) {
    const hintEl = document.getElementById('map-hint');
    if (hintEl) hintEl.textContent = 'locating ' + (C.BY_CODE.get(sel).name.split(' ')[0]) + '…';
    requestAnimationFrame(() => {
      map.invalidateSize();          // guard against stale size after layout shifts
      map.flyTo([g.lat, g.lon], Math.min(Math.max(map.getZoom(), 7.5), 9),
        { duration: REDUCED ? 0 : .8 });
      setTimeout(() => { if (hintEl) hintEl.textContent =
        'drag to pan · scroll to zoom · click a marker — markers show whole-trust totals at HQ postcodes'; }, REDUCED ? 0 : 900);
    });
  }
});

/* ---------- reset view ---------- */
document.getElementById('map-reset').addEventListener('click', () => {
  map.flyTo(HOME.center, HOME.zoom, { duration: REDUCED ? 0 : .8 });
});

renderList('');
updateMapAnalysis();

// open with a story on screen: #CODE[@period] deep link wins, else Birmingham.
// Restore-first: this runs before any scroll logic and replaces — never pushes.
const deep = C.parseHash();
selPeriod = deep.period;
select(deep.code || (C.BY_CODE.has('RRK') ? 'RRK' : P.find(p => p.att > 0).code));
syncHash(false);

// Leaflet initialised while the section may be display-blocked far below the
// fold — re-measure once it actually scrolls into view.
new IntersectionObserver((es, io) => es.forEach(e => {
  if (e.isIntersecting) { map.invalidateSize(); io.disconnect(); }
}), { threshold: .05 }).observe(document.getElementById('ukmap'));

window.addEventListener('resize', () => map.invalidateSize(), { passive: true });

if (REDUCED) map.setView(HOME.center, HOME.zoom, { animate: false });

// debug/testing hook (used by tmp/smoke checks & console poking)
window.__aeMap = map;
window.__aeShareSvg = buildShareSvg;
}   // end start()
})();
