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
  ['w4pct','dta','att','adm'].every(mk =>
    window.AE_PROVIDERS.every(p => {
      const col = C.mapMetricColor(mk, p[0]);
      return typeof col === 'string' && col.length > 0;
    })));
check('missing waits ⇒ grey bucket not invented %',
  (() => { const t0 = window.AE_PROVIDERS.find(p => !p[6]);
    return !t0 || C.mapMetricValue('w4pct', t0[0]) == null; })());

console.log(failures ? `\n${failures} FAILURES` : '\nALL CORE CHECKS PASSED');
process.exit(failures ? 1 : 0);
