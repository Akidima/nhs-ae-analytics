/* Verifies the shareable report-card SVG builder for a spread of trust
   types (major A&E, walk-in, missing trolley-wait data). Reuses the DOM/
   Leaflet stubs from the smoke harness, then drives buildShareSvg directly.
   Run: node tmp/verify_share.js */
const fs = require('fs');
const path = require('path');

// reuse the stub environment defined in smoke_map_test.js up to data loading,
// but skip its assertions and early exit
const smokeSrc = fs.readFileSync(path.join(__dirname, 'smoke_map_test.js'), 'utf8');
const cutAt = smokeSrc.indexOf('// ---- load real data files ----');
if (cutAt < 0) { console.error('harness marker not found'); process.exit(2); }
const stubSrc = smokeSrc.slice(0, cutAt) + '\nmodule.exports = {};';
new Function('require', 'module', '__dirname', 'process', stubSrc)(require, { exports: {} }, __dirname, process);

const site = path.join(__dirname, '..', 'site');
['data/data.js', 'data/geo.js', 'data/uk_geo.js', 'data/trust_hist.js', 'data-core.js']
  .forEach(f => new Function(fs.readFileSync(path.join(site, f), 'utf8'))());
new Function(fs.readFileSync(path.join(site, 'map.js'), 'utf8'))();

const C = global.window.AECORE;
const build = global.window.__aeShareSvg;

let failures = 0;
const check = (l, ok) => { console.log(`${ok ? '  ✓' : '  ✗ FAIL'} ${l}`); if (!ok) failures++; };

const samples = [
  ['RRK', 'major with full data'],
  ['R1H', 'major, second cohort'],
  ['R0A', 'busiest trust'],
];
// find one walk-in and one provider without published dta for edge coverage
const walkin = C.TRUSTS.find(t => t.kind === 'walkin' && t.att > 0);
if (walkin) samples.push([walkin.code, 'walk-in']);
const noDta = C.TRUSTS.find(t => t.dta == null && t.attCov > 0);
if (noDta) samples.push([noDta.code, 'missing trolley-wait figure']);

samples.forEach(([code, kind]) => {
  const svg = build(code);
  const t = C.BY_CODE.get(code);
  if (!svg) { check(`card SVG built for ${code} (${kind})`, false); return; }
  check(`${code} (${kind}): card builds`, true);
  check(`${code}: own name present`, svg.includes(t.name.slice(0, 20)));
  check(`${code}: code + deep link present`, svg.includes('#' + code));
  check(`${code}: no leaked placeholders`, !svg.includes('undefined') && !svg.includes('NaN'));
  check(`${code}: England line present`, svg.includes('England average'));
  check(`${code}: discovery sentence present`, svg.includes('WHAT STANDS OUT'));
});

// filename convention check via LAST_YM
check(`filename month is the latest reporting month (${C.LAST_YM})`,
  /^\d{4}-\d{2}$/.test(C.LAST_YM));

console.log(failures ? `\n${failures} FAILURES` : '\nALL SHARE-CARD CHECKS PASSED');
process.exit(failures ? 1 : 0);
