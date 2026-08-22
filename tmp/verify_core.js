/* Headless verification of the authoritative data layer (data-core.js):
   trust→period→record correctness, compare joins on matching periods,
   regional aggregates recomputed independently, insight determinism,
   deep-link parsing, CSV export integrity, missing-data handling.       */
const fs = require('fs');
const path = require('path');
const site = path.join(__dirname, '..', 'site');

let failures = 0;
const check = (label, ok) => {
  console.log(`${ok ? '  \u2713' : '  \u2717 FAIL'} ${label}`);
  if (!ok) failures++;
};
global.window = global;

new Function(fs.readFileSync(path.join(site, 'data/data.js'), 'utf8'))();
new Function(fs.readFileSync(path.join(site, 'data/geo.js'), 'utf8'))();
new Function(fs.readFileSync(path.join(site, 'data/trust_hist.js'), 'utf8'))();
new Function(fs.readFileSync(path.join(site, 'data-core.js'), 'utf8'))();
const C = global.window.AECORE;

/* ---- 1. trust→period→record ---- */
const rec = C.recordAt('RRK', '2026-07');
check('UHB 2026-07 record exists', !!rec);
check('UHB 2026-07 attendances = 48,100 (packed precision)', rec && rec.att === 48100);
check('UHB 2026-07 within-4h = 34,160', rec && rec.w4 === 34160);
check('UHB 2026-07 ≈71.0% within 4h', rec && Math.abs(100 * rec.w4 / rec.att - 71.0) < 0.06);
check('breaches derived = att − w4 = 13,940', rec && rec.br === 13940);
check('period before archive returns null (no invention)', C.recordAt('RRK', '2017-03') === null);

const latest = C.currentRecord('RRK', null);
check('currentRecord(null) = latest published month', latest && latest.ym === C.LAST_YM && latest.cov);

// several other trusts show their own records
const r1h = C.currentRecord('R1H', null), t = C.BY_CODE.get('R1H');
check('Barts roll-up matches its own provider row',
  t.att === 495188 && Math.abs(100 * t.w4 / t.attCov - 100 * 360169 / 495188) < 1e-9);
check("Barts' latest month belongs to its own history",
  r1h && C.history('R1H').some(h => h.ym === r1h.ym));

/* ---- 2. compare uses one shared basis ---- */
const cmpMonth = C.compareRows(['RRK', 'R1H'], '2026-07');
check('month compare joins each trust to ITS OWN row',
  cmpMonth[0].att === 48100 && cmpMonth[1].att === C.recordAt('R1H', '2026-07').att);
const cmpRoll = C.compareRows(['RRK', 'R1H']);
check('rollup compare matches provider table',
  cmpRoll[0].att === C.BY_CODE.get('RRK').att &&
  cmpRoll[1].att === C.BY_CODE.get('R1H').att &&
  cmpRoll[1].att === 495188);   // Barts' published roll-up, read from the CSV above
const cmpMissing = C.compareRows(['RRK'], '2015-01');
check('compare before archive ⇒ null metrics, never zero',
  cmpMissing.length === 1 && cmpMissing[0].att == null && cmpMissing[0].perf == null);

/* ---- 3. regional aggregates recomputed independently ---- */
const mids = window.AE_PROVIDERS.filter(p => C.regionOf(p[0]) === 'Midlands' && p[6] > 0);
let cov = 0, w4 = 0;
mids.forEach(p => { cov += p[6]; w4 += p[7]; });
const rs = C.regionStats('Midlands');
check(`Midlands region has ${mids.length} reporting trusts`, mids.length >= 10);
check('Midlands perf matches independent recompute',
  Math.abs(rs.perf - 100 * w4 / cov) < 1e-9 && rs.n === mids.length);
check('every region average comes from real rows (cov > 0)',
  ['North East and Yorkshire','North West','Midlands','East of England','London','South East','South West']
    .every(r => { const s = C.regionStats(r); return !s || s.cov > 0; }));

const unplaced = window.AE_PROVIDERS.filter(p => !C.regionOf(p[0]));
console.log(`  · trusts without derivable region: ${unplaced.length}${unplaced.length ? ' (' + unplaced.slice(0,5).map(u=>u.code).join(',') + ')' : ''}`);
check('region derivation covers ≥95% of providers', unplaced.length <= window.AE_PROVIDERS.length * 0.05);

/* ---- 4. insights deterministic + period-labelled ---- */
const i1 = JSON.stringify(C.insights('RRK')), i2 = JSON.stringify(C.insights('RRK'));
check('insights deterministic', i1 === i2 && C.insights('RRK').length >= 3);
check('insights name their comparison basis',
  /England average|previous|region|history/i.test(i1));
check('explainer generates plain English from real value',
  C.explainer('w4', 34160, { perf: 71.0 }).includes('71 out of every 100'));

/* ---- 5. deep links ---- */
check('buildHash encodes code+period', C.buildHash('RRK', '2025-07') === '#RRK@2025-07');
check('buildHash drops invalid periods', C.buildHash('RRK', '1999-01') === '#RRK');

/* ---- 6. CSV export reflects the selected trust's own archive ---- */
const csv = C.reportCsv('RRK');
check('CSV carries UHB identity', csv.includes('University Hospitals Birmingham'));
check('CSV has monthly rows with no fabricated numbers', csv.split('\n').length > 60 && !csv.includes('NaN'));

/* ---- 7. map metric encoding ---- */
check('map colour buckets resolve for every metric/trust',
  ['w4pct','dta','att','adm','chg'].every(mk =>
    window.AE_PROVIDERS.every(p => {
      const col = C.mapMetricColor(mk, p[0]);
      return typeof col === 'string' && col.length > 0;
    })));
check('missing waits ⇒ grey bucket not invented %',
  (() => { const t0 = window.AE_PROVIDERS.find(p => !p[6]);
    return !t0 || C.mapMetricValue('w4pct', t0[0]) == null; })());

/* ---- 8. performance context (now / previous / England / region) ---- */
const cxM = C.contextFor('RRK', '2026-07');
check('month context: UHB Jul-2026 perf ≈71.0', Math.abs(cxM.perf - 71.0) < 0.06);
check('month context prev = nearest earlier published month',
  cxM.prevYm === '2026-06' && Math.abs(cxM.prev - 68.9) < 0.06);
const engJul = C.englandMonthPerf('2026-07');
check('England month context from published series (75.37)',
  engJul != null && Math.abs(engJul - 75.37) < 0.01);
const regJul = C.regionMonthStats('Midlands', '2026-07');
const mrows = window.AE_PROVIDERS.filter(p => C.regionOf(p[0]) === 'Midlands')
  .map(p => C.recordAt(p[0], '2026-07')).filter(r => r && r.cov && r.att);
let mcov = 0, mw4 = 0;
mrows.forEach(r => { mcov += r.att; mw4 += r.w4; });
check('region-month aggregate matches independent recompute (' + mrows.length + ' trusts)',
  regJul.n === mrows.length && Math.abs(regJul.perf - 100 * mw4 / mcov) < 1e-9);
const cxR = C.contextFor('RRK', null);
check('roll12 context has now/prev/england/region',
  cxR.basis === 'roll12' && cxR.perf != null && cxR.prev != null &&
  cxR.eng != null && cxR.reg != null);

/* ---- 9. change-vs-previous map metric ---- */
const julR = C.recordAt('RRK', '2026-07'), junRec = C.recordAt('RRK', '2026-06');
const chgUHB = C.mapMetricChange('RRK', '2026-07');
const expectedChg = 100 * (julR.w4 / julR.att - junRec.w4 / junRec.att);
check('chg(Jul) = perf(Jul) − perf(Jun)', Math.abs(chgUHB - expectedChg) < 1e-9);
check('chg before first published month ⇒ null (no invention)',
  C.mapMetricChange('RRK', '2017-04') === null);
check('period-aware buckets: month scale differs from annual scale',
  C.mapMetricBuckets('dta', true)[2].max < C.mapMetricBuckets('dta', false)[2].max);
check('month-basis map value for dta uses the monthly record',
  C.mapMetricValue('dta', 'RRK', '2026-07') === 2000 &&
  C.mapMetricValue('dta', 'RRK') === 22004);

console.log(failures ? `\n${failures} FAILURES` : '\nALL CORE CHECKS PASSED');
process.exit(failures ? 1 : 0);
