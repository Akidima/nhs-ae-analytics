/* Headless smoke test for the Leaflet trust map + theme toggle.
   Minimal DOM + Leaflet stubs. Loads map.js (which wires map + theme-aware tiles/markers)
   and app.js only for the theme controller. */
const fs = require('fs');
const path = require('path');
const site = path.join(__dirname, '..', 'site');

let failures = 0;
function check(label, ok) {
  console.log(`${ok ? '  \u2713' : '  \u2717 FAIL'} ${label}`);
  if (!ok) failures++;
}

// ---- minimal DOM/canvas stubs ----
const elements = new Map();
class El {
  constructor(tag) {
    this.tagName = tag; this.children = []; this.style = {}; this.dataset = {};
    this._listeners = {}; this.hidden = false; this.textContent = ''; this._html = '';
    this.classList = { 
    _s: new Set(), 
    add(x) { this._s.add(x); }, 
    remove(x) { this._s.delete(x); }, 
    toggle(x, f) { if (f === undefined) { this._s.has(x) ? this._s.delete(x) : this._s.add(x); } else if (f) this._s.add(x); else this._s.delete(x); return this._s.has(x); },
    contains(x) { return this._s.has(x); } 
  };
  }
  set innerHTML(v) { this._html = v; this.children = []; }
  get innerHTML() { return this._html; }
  appendChild(c) { this.children.push(c); c.parentNode = this; return c; }
  setAttribute(k, v) { this[k] = v; }
  getAttribute(k) { return this[k]; }
  addEventListener(t, fn) { (this._listeners[t] ||= []).push(fn); }
  removeEventListener() {}
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  querySelectorAll(sel) {
    const cls = sel.startsWith('.') ? sel.slice(1) : null;
    const out = [];
    const walk = n => {
      if (cls && ((n.className || '').split(/\s+/).includes(cls))) out.push(n);
      (n.children || []).forEach(walk);
    };
    walk(this);
    return out;
  }
  getBoundingClientRect() { return { width: 900, height: 560, left: 0, top: 0 }; }
  getContext() { return new Proxy({}, { get: () => () => {} }); }
  focus() {}
}
const doc2 = new El('#document');
doc2.getElementById = id => elements.get(id) || null;
doc2.createElement = t => new El(t);
doc2.createDocumentFragment = () => new El('#fragment');
doc2.addEventListener = () => {};
doc2.querySelector = sel => {
  if (sel === '[data-jump]') { const b = new El('button'); b.dataset.jump = 'RRK'; return b; }
  return null;
};
doc2.querySelectorAll = () => [];
doc2.body = new El('body');
doc2.documentElement = new El('html');
doc2.visibilityState = 'visible';
global.document = doc2;

global.window = global;
global.addEventListener = (t, fn) => { (global._ge = global._ge || {})[t] = global._ge[t] || []; global._ge[t].push(fn); };
global.removeEventListener = () => {};
global.dispatchEvent = (e) => { (global._ge[e.type] || []).forEach(fn => fn(e)); };
global.innerWidth = 1280; global.innerHeight = 800;
global.navigator = {};
global.devicePixelRatio = 1;
global.requestAnimationFrame = cb => setTimeout(() => cb(performance.now()), 8);
global.cancelAnimationFrame = clearTimeout;
global.matchMedia = () => ({ matches: false, addEventListener() {} });
global.IntersectionObserver = class { constructor(cb){} observe(){} unobserve(){} disconnect(){} };
global.performance = require('perf_hooks').performance;

// ---- stubs for theme ----
global.localStorage = { _s: {}, getItem(k) { return this._s[k] || null; }, setItem(k, v) { this._s[k] = v; } };
global.CustomEvent = class { constructor(t, o) { this.type = t; this.detail = o && o.detail; } };
global.getComputedStyle = () => ({ getPropertyValue(p) {
  const map2 = { '--wash': '7,9,14', '--panel-wash': '13,18,32', '--mapbg': '#0b1322',
    '--dot-rgb': '94,234,212', '--dotwarm-rgb': '251,191,36',
    '--accent': '#5eead4', '--cool': '#7dd3fc', '--ink': '#e8edf6', '--muted': '#9aa7bd', '--dim': '#5c6a82' };
  return map2[p] || '';
} });

// ---- elements both modules touch ----
['ukmap','map-stage','map-hint','map-reset','trust-list','trust-search',
 'trust-count','trust-report','tr-empty','tr-body','theme-toggle',
 'hero-canvas','tip','ticker','progress','glow','map-by','map-legend'].forEach(id => {
  const e = new El(id === 'ukmap' ? 'div' : id === 'trust-list' ? 'ul' :
    id === 'trust-search' ? 'input' : id === 'theme-toggle' ? 'button' :
    id === 'hero-canvas' ? 'canvas' : id === 'ticker' ? 'div' :
    id === 'map-by' ? 'select' : id === 'map-legend' ? 'div' : 'div');
  if (id === 'ticker') { e.innerHTML = '<div class="track"></div>'; }
  elements.set(id, e);
});
elements.get('tip').getBoundingClientRect = () => ({ width: 180, height: 60, left: 0, top: 0 });

// ---- minimal Leaflet stub ----
function chain(obj) { obj.addTo = () => obj; return obj; }
const mapApi = {
  createPane: () => ({ style: {} }), getPane: () => ({ style: {} }),
  attributionControl: { setPrefix(){} },
  tileLayerAdded: [],
  fitBounds() {}, setMaxBounds() {}, getCenter: () => ({ lat: 54.5, lng: -3 }),
  getZoom: () => 5.5, flyTo() {}, closeTooltip() {}, invalidateSize() {},
  setView() {}
};
global.L = {
  map: () => mapApi,
  latLngBounds: () => ({ pad: () => ({}) }),
  tileLayer: (url, opts) => chain({ _url: url, _opts: opts, setUrl(u) { this._url = u; }, on(){} }),
  circleMarker: (ll, opts) => {
    const m = {
      _latlng: ll, _opts: opts,
      bindTooltip() { return m; }, on() { return m; }, addTo() { return m; },
      setStyle(o) { Object.assign(m._opts, o); }, bringToFront() {}
    };
    global.__markers = global.__markers || [];
    global.__markers.push(m);
    return m;
  }
};

// ---- load real data files ----
new Function(fs.readFileSync(path.join(site, 'data/data.js'), 'utf8'))();
new Function(fs.readFileSync(path.join(site, 'data/geo.js'), 'utf8'))();
new Function(fs.readFileSync(path.join(site, 'data/uk_geo.js'), 'utf8'))();
new Function(fs.readFileSync(path.join(site, 'data/trust_hist.js'), 'utf8'))();
new Function(fs.readFileSync(path.join(site, 'data-core.js'), 'utf8'))();

// ---- load the real map module ----
new Function(fs.readFileSync(path.join(site, 'map.js'), 'utf8'))();

// ---- load ONLY the theme IIFE from app.js (it's the last IIFE in the file) ----
const appJs = fs.readFileSync(path.join(site, 'app.js'), 'utf8');
const themeBlock = appJs.match(/\(function theme\(\) \{[\s\S]*?\}\)\(\);/)[0];
new Function(themeBlock)();

setTimeout(() => {
  console.log('markers created:', (global.__markers || []).length);
  check('one marker per placed trust with activity', (global.__markers || []).length ===
    window.AE_PROVIDERS.filter(p => p[3] > 0 && window.AE_GEO.some(g => g[0] === p[0])).length);

  // flatten (renderList appends a DocumentFragment)
  const flat = [];
  const walk = n => (n.children || []).forEach(c => { flat.push(c); walk(c); });
  walk(elements.get('trust-list'));
  const items = flat.filter(e => e._listeners && e._listeners.click);
  console.log('list buttons rendered:', items.length);
  check('list buttons rendered', items.length > 100);

  // find Birmingham item and click it
  const uhb = items.find(b => b.innerHTML.includes('University Hospitals Birmingham'));
  check('UHB present in list', !!uhb);
  if (!uhb) process.exit(1);
  uhb._listeners.click.forEach(f => f());

  setTimeout(() => {
    const trBody = elements.get('tr-body');
    const out = trBody.innerHTML;
    check('UHB name shown', out.includes('University Hospitals Birmingham NHS Foundation Trust'));
    check('kicker shows code RRK', out.includes('RRK'));
    check('metric: people arrived', out.includes('people arrived'));
    check('metric: left within 4 hours', out.includes('left within 4 hours'));
    check('metric: waited longer than 4h', out.includes('waited longer than 4h'));
    check('metric: trolley 12h+', new RegExp('waited on a trolley 12h\\+[^<]*<\\/span><span class="v num">([\\d,]+|Data unavailable)</span>').test(out));
    check('sparkline drawn', out.includes('<svg class="tr-spark"'));
    const engPct = window.AECORE.england12m().perf.toFixed(1) + '%';
    check(`england comparison computed from data (${engPct})`, out.includes(engPct));
    check('ods placement note', out.includes('B15 2GW'));
    check('report not the loading skeleton', !out.includes('tr-loading'));
    check('regional context present', out.includes('Where this trust sits') && out.includes('Midlands'));
    check('insights section present', out.includes('What stands out?'));
    check('patient journey present', out.includes('The patient journey'));
    check('about-this-data present', out.includes('About this data'));
    check('period selector present', out.includes('Reporting period timeline'));
    check('draggable timeline slider rendered', out.includes('per-range'));
    check('performance context line present', out.includes('Performance context') && out.includes('England'));
    check('data-quality pill present', out.includes('Data status') || out.includes('complete window'));
    check('best/worst period chips present', out.includes('best ·') && out.includes('hardest ·'));
    check('performance heatmap present with legend',
      out.includes('Performance heatmap') && out.includes('waits not published'));
    check('heatmap cells carry accessible labels', out.includes('aria-label="July 2026:'));
    check('compare affordance present', out.includes('+ compare'));
    // UHB's own numbers must come from its own history row (2026-07: 48,100 packed / 34,160 within 4h)
    check("UHB report shows UHB's July 2026 attendance", /48,100/.test(out));

    // selected marker got restyled (radius bump + full opacity)
    const sel = global.__markers.find(m => m._opts.fillOpacity === 1);
    check('selected marker highlighted on map', !!sel);

    // ---- theme toggle behaviour ----
    const btn = elements.get('theme-toggle');
    check('toggle button painted with sun icon (dark mode)', btn.innerHTML.includes('circle cx="12"'));
    btn._listeners.click.forEach(f => f());
    check('light class applied to <html>', global.document.documentElement.classList.contains('light'));
    check('choice persisted to localStorage', global.localStorage.getItem('ae-theme') === 'light');
    check('toggle now shows moon icon', btn.innerHTML.includes('20.6'));
    btn._listeners.click.forEach(f => f());
    check('toggles back to dark', !global.document.documentElement.classList.contains('light'));

    console.log(failures ? `\n${failures} FAILURES` : '\nALL CHECKS PASSED');
    process.exit(failures ? 1 : 0);
  }, 400);
}, 300);