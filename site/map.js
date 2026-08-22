/* ═══════════════════════════ SECTION · TRUST MAP ═══════════════════════════
   Real slippy map on Leaflet (vendored locally, no build step):
   CARTO dark basemap + optional label overlay, one circle marker per NHS
   trust sized by attendances. Drag / pinch / zoom come from the library;
   hover tooltips, click-to-select, searchable sidebar and the report panel
   keep working exactly as before. Selection lives in one store shared by
   map, sidebar and report panel.                                            */
(function () {
'use strict';

const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* Leaflet + data land deferred — poll briefly rather than fail */
let waited = 0;
(function boot() {
  if (!(window.L && window.AE_MONTHLY && window.AE_PROVIDERS && window.AE_GEO)) {
    if ((waited += 100) > 12000) return;   // give up silently; page still works
    return setTimeout(boot, 100);
  }
  start();
})();

function start() {
const M = window.AE_MONTHLY, P = window.AE_PROVIDERS, GEO = window.AE_GEO;
if (!document.getElementById('ukmap')) return;

const LAST_YM = M[M.length - 1].p;
const byCode = new Map(P.map(p => [p[0], {
  code: p[0], name: p[1], kind: p[2], att: p[3],
  t1: p[4], t3: p[5], attCov: p[6], w4: p[7],
  br: p[8], adm: p[9], dta: p[10], met: p[12], months: p[11]
}]));
const geoByCode = new Map(GEO.map(g => [g[0], { lat: g[1], lon: g[2], src: g[3], detail: g[4] }]));

/* ---------- selection store (single source of truth) ---------- */
const listeners = [];
let selected = null, hover = null;
function select(code) { if (selected !== code) { selected = code; emit('select'); } }
function setHover(code) { if (hover !== code) { hover = code; emit('hover'); } }
function on(fn) { listeners.push(fn); }
function emit() { listeners.forEach(f => f(selected, hover)); }

/* ---------- shareable deep links (#CODE) ---------- */
function syncHash(code) {
  try { history.replaceState(null, '', code ? '#' + code : '#'); } catch (e) { /* no-op */ }
}
window.addEventListener('hashchange', () => {
  const c = typeof location !== 'undefined' ? location.hash.slice(1) : '';
  if (byCode.has(c) && c !== selected) select(c);
});

/* ---------- trust list (sidebar) ---------- */
const listEl = document.getElementById('trust-list');
const searchEl = document.getElementById('trust-search');
const countEl = document.getElementById('trust-count');
countEl.textContent = `(${P.filter(p => p[3] > 0).length})`;

function fmtShort(n) { return n >= 1e6 ? (n/1e6).toFixed(1)+'M' : n >= 1e3 ? Math.round(n/1e3)+'K' : ''+n; }
function perfLabel(t) {
  if (!t.attCov) return 'waits not published';
  const pct = Math.round(100 * t.w4 / t.attCov);
  return `${pct}% within 4h`;
}
function renderList(filter) {
  const q = (filter || '').trim().toLowerCase();
  const rows = P.filter(p => (!q || p[1].toLowerCase().includes(q)) && p[3] > 0);
  if (!rows.length) {
    listEl.innerHTML = '<li class="no-match">No trusts match that search.</li>';
    return;
  }
  const frag = document.createDocumentFragment();
  rows.forEach(p => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.className = 't-item' + (p[0] === selected ? ' sel' : '');
    b.setAttribute('role', 'option');
    b.setAttribute('aria-selected', String(p[0] === selected));
    b.dataset.code = p[0];
    b.innerHTML = `<span>${p[1]}</span><span class="t-code">${p[0]} · ${fmtShort(p[3])} visits</span>`;
    b.addEventListener('click', () => select(p[0]));
    b.addEventListener('pointerenter', () => setHover(p[0]));
    b.addEventListener('pointerleave', () => setHover(null));
    li.appendChild(b);
    frag.appendChild(li);
  });
  listEl.innerHTML = '';
  listEl.appendChild(frag);
}

let searchTimer;
searchEl.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => renderList(searchEl.value), 120);
});

const jumpEl = document.querySelector('[data-jump]');
if (jumpEl) jumpEl.addEventListener('click', function () {
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
function isLight() { return document.documentElement.classList.contains('light'); }
let baseLayer = L.tileLayer(BASE[isLight() ? 'light' : 'dark'].base, {
  subdomains: 'abcd', maxZoom: 9,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
}).addTo(map);

let labelLayer = L.tileLayer(BASE[isLight() ? 'light' : 'dark'].labels, {
  subdomains: 'abcd', maxZoom: 9, pane: 'aeLabels', opacity: .82, interactive: false
}).addTo(map);

// theme flips swap the basemap and repaint markers to stay legible
window.addEventListener('ae-theme', () => {
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

/* ---------- trust markers ---------- */
function markerColors() {
  const cs = getComputedStyle(document.documentElement);
  return { accent: cs.getPropertyValue('--accent').trim() || '#5eead4',
           cool: cs.getPropertyValue('--cool').trim() || '#7dd3fc' };
}
const markersByCode = new Map();

P.forEach(p => {
  const g = geoByCode.get(p[0]);
  if (!g || p[3] <= 0) return;                 // no coordinate or no recent activity
  const t = byCode.get(p[0]);
  const major = t.kind === 'major';
  const C = markerColors();
  const m = L.circleMarker([g.lat, g.lon], {
    radius: Math.min(11, major ? 4 + Math.sqrt(t.att) / 260 : 3),
    color: major ? C.accent : C.cool,
    weight: g.src === 'approx' ? 1.6 : 1.2,
    dashArray: g.src === 'approx' ? '2 2' : null,
    opacity: .85,
    fillColor: major ? C.accent : C.cool,
    fillOpacity: major ? .72 : .5
  });
  m.bindTooltip(
    `<div class="mt-name">${t.name}</div>
     <div class="mt-sub">${fmtShort(t.att)} visits · ${perfLabel(t)}</div>
     <div class="mt-sub">${major ? 'big A&amp;E hospital' : 'walk-in / community sites'}${g.src === 'approx' ? ' · <b>≈</b> region-level position' : ''}</div>
     <div class="mt-sub" style="margin-top:3px;color:#5c6a82">click for full report</div>`,
    { className: 'ae-tip', direction: 'top', offset: [0, -6], sticky: false, opacity: 1 });
  m.on('mouseover', () => setHover(p[0]));
  m.on('mouseout', () => setHover(null));
  m.on('click', () => { skipFly = p[0]; select(p[0]); skipFly = null; });
  m.addTo(map);
  markersByCode.set(p[0], m);
});

function applyMarkerStates() {
  const C = markerColors();
  markersByCode.forEach((m, code) => {
    const isSel = code === selected, isHov = code === hover;
    const t = byCode.get(code);
    const base = Math.min(11, t.kind === 'major' ? 4 + Math.sqrt(t.att) / 260 : 3);
    m.setStyle({
      radius: base + (isSel ? 4 : isHov ? 2.5 : 0),
      weight: isSel ? 3 : 1.2,
      fillOpacity: isSel ? 1 : t.kind === 'major' ? .72 : .5
    });
    if (t.kind !== 'major') m.setStyle({ color: C.cool, fillColor: C.cool });
    else m.setStyle({ color: C.accent, fillColor: C.accent });
    if (isSel) m.bringToFront();
  });
}

/* ---------- report panel ---------- */
const trBody = document.getElementById('tr-body');
function unpackTrustHistory(code) {
  const packed = window.AE_TRUST_HIST && window.AE_TRUST_HIST[code];
  if (!packed) return null;
  const months = window.AE_TRUST_MONTHS;
  // form A: [startIdx, rows...] contiguous months
  if (typeof packed[0] === 'number') {
    return packed.slice(1).map((r, i) => mkRow(months[packed[0] + i], r));
  }
  // form B: [{i, g:[gaps]}, rows...] with month gaps between rows
  let idx = packed[0].i;
  return packed.slice(1).map((r, k) => {
    if (k) idx += packed[0].g[k - 1];
    return mkRow(months[idx], r);
  });
  function mkRow(ym, r) {
    return { ym, att: r[0] * 10, cov: r[1] === 1, w4: r[2] * 10,
      t1: r[3], b1: r[4], adm: r[5], dta: r[6] };
  }
}
function fmtFull(n) { return n == null ? '—' : n.toLocaleString('en-GB'); }

function animatePanel() {
  trBody.classList.remove('tr-in');
  void trBody.offsetHeight;          // restart the entrance animation
  trBody.classList.add('tr-in');
}

function animatePanel() {
  trBody.classList.remove('tr-in');
  void trBody.offsetHeight;          // restart the entrance animation
  trBody.classList.add('tr-in');
}

/* ---------- compare mode (pin up to two trusts) ---------- */
let cmpCodes = [];
function toggleCompare(code) {
  const i = cmpCodes.indexOf(code);
  if (i >= 0) cmpCodes.splice(i, 1);
  else { if (cmpCodes.length >= 2) cmpCodes.shift(); cmpCodes.push(code); }
  renderReport(selected);
}
function cmpSparkPath(code) {
  const hist = unpackTrustHistory(code);
  if (!hist) return '';
  const pts = hist.filter(h => h.cov).map(h => 100 * h.w4 / h.att).filter(isFinite);
  if (pts.length < 2) return '';
  const W = 280, H = 74, pad = 4;
  const y = v => pad + (1 - (Math.min(Math.max(v, 40), 100) - 40) / 60) * (H - 2 * pad);
  const line = pts.map((v, i) => (i ? 'L' : 'M') + (pad + i / (pts.length - 1) * (W - 2 * pad)).toFixed(1) + ',' + y(v).toFixed(1)).join('');
  return `<path d="${line}" fill="none" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
}
function buildCompareBlock() {
  if (!cmpCodes.length) return '';
  if (cmpCodes.length < 2) {
    const t0 = byCode.get(cmpCodes[0]);
    return `<div class="tr-block"><h4>Compare</h4><div class="tr-note">Pinned <b>${t0 ? t0.name : cmpCodes[0]}</b>.
      Open another trust and press <b>+ compare</b> to see them side by side.
      <button class="linklike" id="tr-cmp-clear">clear</button></div></div>`;
  }
  const [ca, cb] = cmpCodes, ta = byCode.get(ca), tb = byCode.get(cb);
  if (!ta || !tb) { cmpCodes = []; return ''; }
  const perf = x => x != null ? x.toFixed(1) + '%' : '—';
  const pa = ta.attCov ? 100 * ta.w4 / ta.attCov : null;
  const pb = tb.attCov ? 100 * tb.w4 / tb.attCov : null;
  const brT = t => t.br != null ? t.br : (t.attCov != null ? Math.max(t.attCov - t.w4, 0) : null);
  const rows = [
    ['attended · last 12 mo', fmtFull(ta.att), fmtFull(tb.att)],
    ['left within 4 hours', perf(pa), perf(pb)],
    ['waited longer than 4h', brT(ta) != null ? fmtFull(brT(ta)) : '—', brT(tb) != null ? fmtFull(brT(tb)) : '—'],
    ['waited on a trolley 12h+', ta.dta != null ? fmtFull(ta.dta) : '—', tb.dta != null ? fmtFull(tb.dta) : '—'],
    ['emergency admissions', ta.adm != null ? fmtFull(ta.adm) : '—', tb.adm != null ? fmtFull(tb.adm) : '—'],
    ['met the 95% promise', `${ta.met} of ${ta.months}`, `${tb.met} of ${tb.months}`]
  ];
  const sa = cmpSparkPath(ca).replace('<path ', '<path stroke="var(--accent)" ');
  const sb = cmpSparkPath(cb).replace('<path ', '<path stroke="var(--cool)" ');
  return `<div class="tr-block"><h4>Side by side
      <button class="linklike" id="tr-cmp-clear">clear</button></h4>
    <div class="tr-cmp-names"><span class="a">${ta.name}</span><span class="b">${tb.name}</span></div>
    <div class="tr-cmp">${rows.map(r =>
      `<div class="tr-cmp-row"><span class="n">${r[0]}</span><span class="a num">${r[1]}</span><span class="b num">${r[2]}</span></div>`).join('')}
    </div>
    ${sa || sb ? `<svg class="tr-spark" viewBox="0 0 280 74" role="img" aria-label="Monthly four-hour performance of both trusts overlaid">
      <line x1="4" x2="276" y1="${(4 + (1 - (95 - 40) / 60) * 66).toFixed(1)}" y2="${(4 + (1 - (95 - 40) / 60) * 66).toFixed(1)}"
        stroke="#fbbf24" stroke-dasharray="4 4" opacity=".8"/>${sa}${sb}</svg>
      <div class="tr-note"><span style="color:var(--accent)">▬ first trust</span> ·
      <span style="color:var(--cool)">▬ second trust</span> · dashed gold is the 95% promise.</div>` : ''}`;
}

function renderReport(code) {
  const t = byCode.get(code), g = geoByCode.get(code);
  if (!t || !g) return;
  const hist = unpackTrustHistory(code);

  // headline metrics: latest reported month (with breach data preferred)
  let row = null;
  if (hist) {
    for (let i = hist.length - 1; i >= 0; i--) { if (hist[i].cov) { row = hist[i]; break; } }
    if (!row) row = hist[hist.length - 1];
  }
  const l12perf = t.attCov ? Math.round(100 * t.w4 / t.attCov * 10) / 10 : null;

  // rolling-twelve-month roll-ups straight from the provider table
  const brTotal = t.br != null ? t.br : (t.attCov != null ? Math.max(t.attCov - t.w4, 0) : null);
  const brShare = brTotal != null && t.attCov ? Math.round(1000 * brTotal / t.attCov) / 10 : null;
  const admShare = t.adm != null && t.att ? Math.round(1000 * t.adm / t.att) / 10 : null;
  const perDay = t.att ? Math.round(t.att / 365) : null;

  // records across this trust's whole published archive
  let bestM = null, worstM = null, busyM = null;
  if (hist) {
    for (const h of hist) {
      if (!busyM || h.att > busyM.att) busyM = h;
      if (!h.cov || !h.att) continue;
      const v = 100 * h.w4 / h.att;
      if (!isFinite(v)) continue;
      if (!bestM || v > bestM.v) bestM = { ym: h.ym, v };
      if (!worstM || v < worstM.v) worstM = { ym: h.ym, v };
    }
  }
  function mLabel(ym) {
    const [y, m] = ym.split('-').map(Number);
    return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m - 1] + ' ' + y;
  }

  // national rank: where this trust sits on % within 4h across all ranked trusts
  let rankInfo = null;
  if (l12perf != null) {
    const ranked = P.filter(p => p[6] > 0)
      .map(p => ({ code: p[0], pct: 100 * p[7] / p[6] }))
      .sort((a, b) => b.pct - a.pct);
    const pos = ranked.findIndex(r => r.code === code);
    if (pos >= 0) {
      const quart = pos < ranked.length / 4 ? 'top quarter' :
                    pos < ranked.length / 2 ? 'upper half' :
                    pos < ranked.length * 3 / 4 ? 'lower half' : 'bottom quarter';
      rankInfo = { pos: pos + 1, total: ranked.length, quart };
    }
  }

  // year-on-year change (percentage points) from the monthly history
  let trendD = null;
  if (hist && l12perf != null) {
    const covRows = hist.filter(h => h.cov);
    const tail = covRows.slice(-12), prev = covRows.slice(-24, -12);
    const avg = rows => rows.length ? rows.reduce((s, h) => s + h.w4, 0) / rows.reduce((s, h) => s + h.att, 0) * 100 : null;
    const now = avg(tail), before = avg(prev);
    if (now != null && before != null && isFinite(before)) trendD = now - before;
  }

  const kindName = t.kind === 'major' ? 'major A&E trust'
                 : t.kind === 'walkin' ? 'walk-in / community sites'
                 : 'single-speciality site';

  // ── compact scorecard: everything above the fold, nothing to scroll ──
  const tiles = [
    { k: 'attended · last 12 months', v: t.att != null ? fmtFull(t.att) : 'Data unavailable',
      x: perDay ? `${fmtShort(perDay)} arrivals a day` : '', cls: '' },
    { k: 'left within 4 hours', v: l12perf != null ? l12perf.toFixed(1) + '%' : 'Data unavailable',
      x: l12perf == null ? '' : l12perf >= 95 ? 'promise kept on average'
        : l12perf < 75.1 ? 'below England average' : 'above England average',
      cls: l12perf == null ? '' : (l12perf >= 95 ? 'good' : l12perf < 60 ? 'hot' : '') },
    { k: 'waited longer than 4h', v: brTotal != null ? fmtFull(brTotal) : 'Data unavailable',
      x: brShare != null ? `${brShare}% of visits breached` : '',
      cls: brShare != null && brShare >= 30 ? 'hot' : '' },
    { k: 'waited on a trolley 12h+', v: t.dta != null ? fmtFull(t.dta) : 'Data unavailable',
      x: t.dta ? 'no ward bed after decision to admit' : '', cls: '' },
    { k: 'emergency admissions', v: t.adm != null ? fmtFull(t.adm) : 'Data unavailable',
      x: admShare != null ? `${admShare}% of arrivals admitted` : '', cls: '' },
    { k: 'met the 95% promise', v: `${t.met} of ${t.months} months`,
      x: t.met === 0 ? 'not once in the window' : '', cls: t.met ? 'good' : '' },
    { k: 'busiest month on record', v: busyM ? fmtFull(busyM.att) : '—',
      x: busyM ? mLabel(busyM.ym) : '', cls: '' }
  ];
  if (rankInfo) tiles.push({ k: 'performance rank · England',
    v: `#${rankInfo.pos} of ${rankInfo.total}`, x: `${rankInfo.quart} on four-hour waits`, cls: '' });
  if (trendD != null) tiles.push({ k: 'vs previous 12 months',
    v: `${trendD >= 0 ? '+' : ''}${trendD.toFixed(1)}pp`,
    x: trendD >= 0 ? 'improving' : 'declining', cls: trendD >= 0 ? 'good' : 'hot' });

  const tileRow = mm => `<div class="tr-stat ${mm.cls}">
    <span class="k">${mm.k}</span><span class="v num">${mm.v}</span>${mm.x ? `<span class="x">${mm.x}</span>` : ''}</div>`;

  // the most recent month as a single line
  const lmPerf = row && row.cov && row.att ? Math.round(1000 * row.w4 / row.att) / 10 : null;
  const lmLine = row ? `<div class="tr-block"><h4>Latest month · ${mLabel(row.ym)}</h4>
    <div class="tr-note"><b class="num">${fmtFull(row.att)}</b> people arrived ·
    <b class="num">${lmPerf != null ? lmPerf.toFixed(1) + '%' : '—'}</b> left within 4 hours${row.dta != null ? ` · <b class="num">${fmtFull(Math.round(row.dta * 1000))}</b> waited on a trolley 12h+` : ''}.</div></div>` : '';

  // trend sparkline (monthly % within 4h)
  let sparkSvg = '', sparkNote = '';
  if (hist) {
    const pts = hist.filter(h => h.cov).map(h => ({ ym: h.ym, v: 100 * h.w4 / h.att }))
      .filter(p => isFinite(p.v));
    if (pts.length > 3) {
      const W2 = 280, H2 = 74, pad = 4;
      const xs = pts.map((_, i) => pad + i / (pts.length - 1) * (W2 - 2*pad));
      const ys = pts.map(p => pad + (1 - (Math.min(Math.max(p.v, 40), 100) - 40) / 60) * (H2 - 2*pad));
      const path = xs.map((x, i) => (i ? 'L' : 'M') + x.toFixed(1) + ',' + ys[i].toFixed(1)).join('');
      sparkSvg = `<svg class="tr-spark" viewBox="0 0 ${W2} ${H2}" role="img"
        aria-label="Monthly share seen within four hours, ${pts[0].ym} to ${pts[pts.length-1].ym}: started near ${pts[0].v.toFixed(0)} percent, now about ${pts[pts.length-1].v.toFixed(0)} percent">
        <line x1="${pad}" x2="${W2-pad}" y1="${pad + (1-(95-40)/60)*(H2-2*pad)}" y2="${pad + (1-(95-40)/60)*(H2-2*pad)}" stroke="#fbbf24" stroke-dasharray="4 4" opacity=".8"/>
        <path d="${path}" fill="none" stroke="#5eead4" stroke-width="2"/>
        <circle cx="${xs[xs.length-1]}" cy="${ys[ys.length-1]}" r="3.4" fill="#5eead4"/></svg>`;
      sparkNote = `<div class="tr-note">Each point is one month. The dashed line is the
        95% promise. <span class="say">Best month ${Math.max(...pts.map(p=>p.v)).toFixed(0)}% ·
        worst ${Math.min(...pts.map(p=>p.v)).toFixed(0)}%</span>.</div>`;
    }
  }

  // type split (real Type 1 / Type 3 volumes from the provider table)
  let splitHtml = '';
  if (t.kind === 'major') {
    const tot = (t.t1 || 0) + (t.t3 || 0);
    const s1 = tot ? Math.round(100 * t.t1 / tot) : null;
    splitHtml = `<div class="tr-block"><h4>The front doors</h4>
      <div class="tr-note"><b>Major A&amp;E trust.</b> Last year its consultant-led (Type 1) departments handled
      <b class="num">${t.t1 ? fmtFull(t.t1) : '—'}</b> visits${s1 != null ? ` — <b class="num">${s1}%</b> of its front-door traffic` : ''}, against
      <b class="num">${t.t3 ? fmtFull(t.t3) : '—'}</b> at walk-in / urgent-care doors.</div>
      ${tot ? `<div class="tr-split"><span style="flex:${t.t1};background:rgba(94,234,212,.75)"></span><span style="flex:${t.t3};background:rgba(125,211,252,.55)"></span></div>
      <div class="tr-split-legend"><span>Type 1 consultant-led A&amp;E${s1 != null ? ' · ' + s1 + '%' : ''}</span>
      <span>walk-in / urgent care${s1 != null ? ' · ' + (100 - s1) + '%' : ''}</span></div>` : ''}</div>`;
  } else {
    splitHtml = `<div class="tr-block"><h4>The front doors</h4><div class="tr-note">${
      t.kind === 'walkin'
        ? '<b>Walk-in / community site.</b> Minor injuries and urgent care without an appointment — a smaller world with no ward bottleneck behind the door.'
        : '<b>Single-speciality service.</b> e.g. eye casualty — low volume, specialist care.'}</div></div>`;
  }

  const cmpBtn = `<button class="linklike" id="tr-compare"
    title="${cmpCodes.includes(code) ? 'Remove from comparison' : 'Pin for side-by-side comparison'}">${cmpCodes.includes(code) ? '✓ comparing' : '+ compare'}</button>`;

  trBody.hidden = false;
  trBody.innerHTML = `
    <div class="tr-kicker">Trust report<span style="color:var(--dim)">·</span><span class="num">${code}</span>${cmpBtn}</div>
    <div class="tr-name">${t.name}</div>
    <div class="tr-window num">${kindName} · ${t.months} reporting months · to ${mLabel(LAST_YM)}</div>

    <div class="tr-statgrid">${tiles.map(tileRow).join('')}</div>

    ${lmLine}

    ${sparkSvg ? `<div class="tr-block"><h4>The eleven-year slide at this trust</h4>${sparkSvg}${sparkNote}</div>` :
       `<div class="tr-unavailable">Monthly waiting-time history isn't available for this site in the cleaned dataset.</div>`}

    <div class="tr-block"><h4>Compared with England</h4>
      <div class="tr-note">This trust: <b class="num">${l12perf != null ? l12perf.toFixed(1)+'%' : '—'}</b> within 4 hours
      over the last twelve months. England as a whole:
      <b class="num">75.1%</b>. ${l12perf != null ? (l12perf >= 75.1 ? 'So this trust performs <b>better than average</b>.' : 'So this trust performs <b>worse than average</b>.') : ''}</div></div>

    ${splitHtml}

    ${buildCompareBlock()}

    <div class="tr-block"><h4>About this location</h4>
      <div class="tr-note">${g.src === 'ods'
        ? `Placed at its registered headquarters postcode (<span class="num">${g.detail}</span>) via NHS Digital.`
        : g.src.startsWith('osm') ? 'Placed from OpenStreetMap hospital operator records.'
        : g.src === 'wd' ? 'Placed from its Wikidata headquarters coordinate.'
        : `Position approximate (${g.detail}) — no official coordinate was available.`}</div></div>`;
  const btn = document.getElementById('tr-compare');
  if (btn) btn.addEventListener('click', () => toggleCompare(code));
  const clear = document.getElementById('tr-cmp-clear');
  if (clear) clear.addEventListener('click', () => { cmpCodes = []; renderReport(selected); });
  animatePanel();
}

/* ---------- wire the store ---------- */
let skipFly = null;                 // marker clicks already centre themselves
let lastSel = null;                 // work happens only when selection changes,

on((sel, hov) => {
  // cheap visual states react to every emit (hover included)
  listEl.querySelectorAll('.t-item').forEach(b => {
    const on_ = b.dataset.code === sel;
    b.classList.toggle('sel', on_);
    b.setAttribute('aria-selected', String(on_));
  });
  applyMarkerStates();

  if (sel === lastSel) return;      // hover-only change → stop here
  lastSel = sel;
  if (!sel) return;                 // panel always keeps the last report

  syncHash(sel);

  trBody.hidden = false;
  const rep = document.getElementById('trust-report');
  if (rep) rep.scrollTop = 0;
  renderReport(sel);                // immediately — no skeleton, no delay

  // narrow layouts stack the report below the map — bring it into view
  if (rep && rep.getBoundingClientRect().top > window.innerHeight * .55)
    rep.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'nearest' });

  // camera follows selections made from the list / links (not marker clicks)
  if (sel !== skipFly) {
    const g = geoByCode.get(sel);
    if (g && map.getZoom() < 6)     // only fly in when zoomed out; never fight the user's zoom
      map.flyTo([g.lat, g.lon], Math.min(Math.max(map.getZoom(), 6), 7),
        { duration: REDUCED ? 0 : .8 });
  }
});

/* ---------- reset view ---------- */
document.getElementById('map-reset').addEventListener('click', () => {
  map.flyTo(HOME.center, HOME.zoom, { duration: REDUCED ? 0 : .8 });
});

renderList('');
applyMarkerStates();

// open with a story on screen: #CODE deep link wins, else Birmingham
const hashReq = typeof location !== 'undefined' ? location.hash.slice(1) : '';
select(byCode.has(hashReq) ? hashReq : (byCode.has('RRK') ? 'RRK' : P.find(p => p[3] > 0)[0]));

// Leaflet initialised while the section may be display-blocked far below the
// fold — re-measure once it actually scrolls into view.
new IntersectionObserver((es, io) => es.forEach(e => {
  if (e.isIntersecting) { map.invalidateSize(); io.disconnect(); }
}), { threshold: .05 }).observe(document.getElementById('ukmap'));

window.addEventListener('resize', () => map.invalidateSize(), { passive: true });

if (REDUCED) map.setView(HOME.center, HOME.zoom, { animate: false });

// debug/testing hook (used by tmp/smoke checks & console poking)
window.__aeMap = map;
}   // end start()
})();
