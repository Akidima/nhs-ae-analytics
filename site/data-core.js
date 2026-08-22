/* ═══════════════════════════ AUTHORITATIVE DATA LAYER ═══════════════════════════
   One flow for every component (map, sidebar, report, compare):

     Selected Trust → Selected reporting period → Record → Calculated metrics → UI

   Reads only the cleaned warehouse exports (window.AE_*). Never invents values:
   any metric that isn't published for a trust/period comes back as null and the
   UI renders "Data unavailable". Regions are reference metadata derived from each
   trust's own registered postcode (or its existing placement record) — regional
   averages are then aggregated from real trust rows only.                          */
(function () {
'use strict';

const M   = window.AE_MONTHLY  || [];
const P   = window.AE_PROVIDERS || [];
const GEO = window.AE_GEO || [];
const TH  = window.AE_TRUST_HIST || null;
const TM  = window.AE_TRUST_MONTHS || [];

const MN = ['January','February','March','April','May','June',
            'July','August','September','October','November','December'];

/* ---------- NHS England region from reference metadata ----------
   ods placements carry a registered postcode; approx placements already
   carry a region label in their detail field. Postcode area → region is
   static reference data (NHS England regions), not statistics.        */
const AREAS = {
  'North East and Yorkshire': ['NE','SR','TS','DL','DH','HG','YO','LS','WF','BD','HD','HX','HU','DN','S'],
  'North West':  ['L','PR','FY','BB','BL','M','WA','WN','OL','SK','CW','CH','CA','LA'],
  Midlands:      ['B','DY','WS','WV','CV','ST','TF','WR','SY','HR','DE','LE','NN','NG','LN'],
  'East of England': ['CB','IP','NR','CM','CO','SS','AL','SG','LU','MK','HP','WD','PE'],
  London:        ['E','EC','N','NW','SE','SW','W','WC','BR','CR','DA','HA','IG','KT','SM','TW','UB','EN','RM'],
  'South East':  ['BN','RH','ME','CT','TN','GU','PO','SO','RG','OX','SL'],
  'South West':  ['BA','BS','BH','GL','TA','DT','EX','PL','TQ','TR','SN','SP']
};
const AREA_TO_REGION = {};
Object.keys(AREAS).forEach(r => AREAS[r].forEach(a => { AREA_TO_REGION[a] = r; }));
const APPROX_LABEL_TO_REGION = {
  'North East and Yorkshire': 'North East and Yorkshire', 'North West': 'North West',
  'West Midlands': 'Midlands', 'East Midlands': 'Midlands', 'East of England': 'East of England',
  London: 'London', 'South East': 'South East', 'South West': 'South West'
};

function regionOf(code) {
  const g = GEO_BY_CODE.get(code);
  if (!g) return null;
  if (g.src === 'approx') return APPROX_LABEL_TO_REGION[g.detail] || null;
  const m = String(g.detail || '').replace(/ /g, '').match(/^[A-Z]{1,2}/);
  return m ? (AREA_TO_REGION[m[0]] || null) : null;
}

/* ---------- normalised provider roll-ups (last 12 reported months) ---------- */
const GEO_BY_CODE = new Map(GEO.map(g => [g[0], { lat: g[1], lon: g[2], src: g[3], detail: g[4] }]));
const TRUSTS = P.map(p => ({
  code: p[0], name: p[1], kind: p[2],
  att: p[3], t1: p[4], t3: p[5], attCov: p[6], w4: p[7],
  br: p[8], adm: p[9], dta: p[10], months: p[11], met: p[12],
  region: regionOf(p[0])
}));
const BY_CODE = new Map(TRUSTS.map(t => [t.code, t]));

/* ---------- per-trust monthly history, unpacked once and memoised ---------- */
const histCache = new Map();
function history(code) {
  if (!TH || !TM || !TH[code]) return null;
  if (histCache.has(code)) return histCache.get(code);
  const packed = TH[code];
  let rows;
  if (typeof packed[0] === 'number') {                 // form A: contiguous months
    rows = packed.slice(1).map((r, i) => mkRow(TM[packed[0] + i], r));
  } else {                                             // form B: gap-encoded months
    let idx = packed[0].i;
    rows = packed.slice(1).map((r, k) => {
      if (k) idx += packed[0].g[k - 1];
      return mkRow(TM[idx], r);
    });
  }
  histCache.set(code, rows);
  return rows;
  function mkRow(ym, r) {
    return {
      ym,
      att: r[0] * 10,
      cov: r[1] === 1,
      w4: r[2] * 10,
      br: r[1] === 1 ? Math.max(r[0] * 10 - r[2] * 10, 0) : null,
      t1att: r[3] != null ? r[3] * 1000 : null,
      t1br:  r[4] != null ? r[4] * 1000 : null,
      adm:   r[5] != null ? r[5] * 1000 : null,
      dta:   r[6] != null ? r[6] * 1000 : null
    };
  }
}

/* ---------- Trust → period → record (the single selection flow) ---------- */
function recordAt(code, ym) {
  const rows = history(code);
  if (!rows) return null;
  return rows.find(r => r.ym === ym) || null;          // null ⇒ Data unavailable
}
/* The record a view should show for a period: the exact month when the user
   picked one, otherwise the most recent month with published waits. */
function currentRecord(code, periodYm) {
  if (periodYm) return recordAt(code, periodYm);
  const rows = history(code);
  if (!rows) return null;
  for (let i = rows.length - 1; i >= 0; i--) if (rows[i].cov && rows[i].att) return rows[i];
  return rows[rows.length - 1] || null;
}

/* ---------- reporting periods actually present in the cleaned data ---------- */
const PERIODS = TM.slice();

/* ---------- England aggregates, computed — never hard-coded ---------- */
let eng12 = null;
function england12m() {
  if (eng12) return eng12;
  let cov = 0, w4 = 0, att = 0, br = 0, adm = 0, dta = 0;
  TRUSTS.forEach(t => {
    cov += t.attCov || 0; w4 += t.w4 || 0; att += t.att || 0;
    br += t.br != null ? t.br : (t.attCov != null ? Math.max(t.attCov - t.w4, 0) : 0);
    adm += t.adm || 0; dta += t.dta || 0;
  });
  eng12 = { cov, w4, att, br, adm, dta,
    perf: cov > 0 ? 100 * w4 / cov : null };
  return eng12;
}
/* national single-month row from AE_MONTHLY ({p,a,am,d,n,pp,...}) */
function englandMonth(ym) { return M.find(r => r.p === ym) || null; }

/* ---------- regional aggregates from real trust rows only ---------- */
const regionCache = new Map();
function regionStats(region) {
  if (!region) return null;
  if (regionCache.has(region)) return regionCache.get(region);
  const members = TRUSTS.filter(t => t.region === region && t.attCov > 0);
  if (!members.length) { regionCache.set(region, null); return null; }
  let cov = 0, w4 = 0, att = 0, br = 0, adm = 0, dta = 0;
  members.forEach(t => {
    cov += t.attCov; w4 += t.w4; att += t.att;
    br += t.br != null ? t.br : Math.max(t.attCov - t.w4, 0);
    adm += t.adm || 0; dta += t.dta || 0;
  });
  const out = { region, n: members.length, cov, w4, att, br, adm, dta,
    perf: cov > 0 ? 100 * w4 / cov : null };
  regionCache.set(region, out);
  return out;
}

/* ---------- deterministic insights ("What stands out?") ----------
   Every rule states its comparison basis and reporting period. Facts only:
   no causal claims, no invented benchmarks.                            */
function insights(code) {
  const out = [];
  const t = BY_CODE.get(code);
  if (!t) return out;
  const lastYm = PERIODS[PERIODS.length - 1];
  const winLabel = `12 months to ${monthLabel(lastYm)}`;

  if (t.attCov > 0) {
    const perf = 100 * t.w4 / t.attCov;
    const eng = england12m();
    if (eng.perf != null) {
      const d = perf - eng.perf;
      out.push({ tone: d >= 0 ? 'good' : 'hot', icon: d >= 0 ? '▲' : '▼',
        text: `${perf.toFixed(1)}% of arrivals left within 4 hours over the ${winLabel} — ` +
          `${Math.abs(d).toFixed(1)} percentage points ${d >= 0 ? 'above' : 'below'} ` +
          `the England average (${eng.perf.toFixed(1)}%).` });
    }
    const reg = t.region ? regionStats(t.region) : null;
    if (reg && reg.n >= 3 && reg.perf != null) {
      const d = perf - reg.perf;
      out.push({ tone: d >= 0 ? 'good' : 'watch', icon: d >= 0 ? '▲' : '▼',
        text: `Compared with ${reg.n} other trusts in the ${t.region} region ` +
          `(${reg.perf.toFixed(1)}% within 4h, same ${winLabel}), this trust sits ` +
          `${Math.abs(d).toFixed(1)} points ${d >= 0 ? 'above' : 'below'} its region.` });
    }
    // trend: latest 12 covered months vs previous 12, attendance-weighted
    const rows = (history(code) || []).filter(h => h.cov && h.att);
    const avg = rs => rs.length ? 100 * rs.reduce((s, h) => s + h.w4, 0) / rs.reduce((s, h) => s + h.att, 0) : null;
    const nowA = avg(rows.slice(-12)), beforeA = avg(rows.slice(-24, -12));
    if (nowA != null && beforeA != null) {
      const dd = nowA - beforeA;
      if (Math.abs(dd) >= 0.5) out.push({ tone: dd >= 0 ? 'good' : 'hot', icon: dd >= 0 ? '↗' : '↘',
        text: `Performance ${dd >= 0 ? 'improved' : 'declined'} by ${Math.abs(dd).toFixed(1)} points: ` +
          `${nowA.toFixed(1)}% in the latest 12 reported months vs ${beforeA.toFixed(1)}% in the previous 12.` });
      else out.push({ tone: 'flat', icon: '=',
        text: `Performance held broadly steady: ${nowA.toFixed(1)}% in the latest 12 reported months vs ` +
          `${beforeA.toFixed(1)}% in the previous 12.` });
    }
    // extremes across this trust's own archive
    let best = null, worst = null;
    rows.forEach(h => {
      const v = 100 * h.w4 / h.att;
      if (!isFinite(v)) return;
      if (!best || v > best.v) best = { ym: h.ym, v };
      if (!worst || v < worst.v) worst = { ym: h.ym, v };
    });
    if (best && worst && best.ym !== worst.ym) {
      out.push({ tone: 'fact', icon: '·',
        text: `Across this trust's published history, its best month was ${monthLabel(best.ym)} ` +
          `(${best.v.toFixed(1)}%) and its hardest was ${monthLabel(worst.ym)} (${worst.v.toFixed(1)}%).` });
    }
  }
  if (t.dta != null && t.adm != null && t.adm > 0) {
    const share = 100 * t.dta / t.adm;
    out.push({ tone: share >= 8 ? 'hot' : 'watch', icon: '⏱',
      text: `In the ${winLabel}, there were ${fmt(t.dta)} occasions where a patient waited 12+ hours on a trolley after a decision to admit — ` +
        `about ${share.toFixed(1)}% of emergency admissions involved such a wait first.` });
  }
  return out;
}

/* ---------- plain-English explainers generated from actual metrics ---------- */
function explainer(key, v, ctx) {
  switch (key) {
    case 'att':
      return v == null ? null :
        `About ${fmt(v)} people arrived at this trust's A&E doors over the last 12 months — roughly ${fmt(Math.round(v / 365))} every day.`;
    case 'w4':
      return v == null ? null :
        ctx.perf == null ? null :
        `About ${Math.round(ctx.perf)} out of every 100 people who arrived left the emergency department within four hours. The NHS promise is 95 out of 100.`;
    case 'br':
      return v == null ? null :
        `${fmt(v)} visits ended more than four hours after arrival. A breach means the 4-hour promise was missed for that visit.`;
    case 'dta':
      return v == null ? null :
        `On ${fmt(v)} occasions, doctors had decided to admit someone to a ward, but no bed was ready — so they waited 12 hours or more in A&E first.`;
    case 'adm':
      return v == null ? null :
        `About ${fmt(v)} people were kept in hospital as emergency admissions rather than sent home — roughly 1 in every ${Math.max(1, Math.round(ctx.att / v))} arrivals.`;
    default:
      return null;
  }
}

/* ---------- formatting helpers shared by all components ---------- */
function fmt(n) { return n == null ? '—' : Math.round(n).toLocaleString('en-GB'); }
function fmtShort(n) {
  return n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'K' : '' + Math.round(n);
}
function monthLabel(ym) {
  if (!ym) return '';
  const [y, m] = ym.split('-').map(Number);
  return MN[m - 1] + ' ' + y;
}

/* ---------- deep links: #CODE or #CODE@YYYY-MM ---------- */
function parseHash() {
  const raw = (typeof location !== 'undefined' ? location.hash.slice(1) : '');
  if (!raw) return { code: null, period: null };
  const dec = decodeURIComponent(raw);
  const at = dec.indexOf('@');
  const code = at >= 0 ? dec.slice(0, at) : dec;
  const period = at >= 0 ? dec.slice(at + 1) : null;
  return {
    code: BY_CODE.has(code) ? code : null,
    period: period && PERIODS.includes(period) ? period : null
  };
}
function buildHash(code, period) {
  return code ? '#' + code + (period && PERIODS.includes(period) ? '@' + period : '') : '#';
}

/* ---------- CSV export of the currently selected trust report ---------- */
function reportCsv(code) {
  const t = BY_CODE.get(code);
  if (!t) return '';
  const lines = [
    ['NHS A&E monthly report — cleaned dataset (fct_ae_activity)'],
    ['Trust', t.name], ['Code', t.code], ['Type', t.kind],
    ['Region', t.region || 'Not available'], ['Generated', new Date().toISOString().slice(0, 10)],
    [],
    ['month', 'attendances', 'waits_published', 'within_4h', 'breaches_over_4h',
     'type1_attendance', 'type1_breaches', 'emergency_admissions', 'trolley_waits_12h_plus']
  ];
  const rows = history(code) || [];
  rows.forEach(r => lines.push([
    r.ym, r.att, r.cov ? 'yes' : 'no', r.cov ? r.w4 : '', r.cov ? r.br : '',
    r.t1att != null ? r.t1att : '', r.t1br != null ? r.t1br : '',
    r.adm != null ? r.adm : '', r.dta != null ? r.dta : ''
  ].join(',')));
  lines.push([], ['# last-12-month roll-up'], [
    'attendances', 'covered_attendances', 'within_4h', 'breaches', 'admissions', 'trolley_12h'
  ].join(','));
  lines.push([t.att, t.attCov, t.w4, t.br != null ? t.br : '', t.adm != null ? t.adm : '', t.dta != null ? t.dta : ''].join(','));
  return lines.map(l => Array.isArray(l) ? l.join(',') : l).join('\n');
}

/* ---------- map colouring by metric (buckets computed from real data) ---------- */
const MAP_METRICS = {
  type: { label: 'Trust type', buckets: null },
  w4pct: { label: 'Left within 4 hours (%)', buckets: [
    { max: 60, color: 'var(--hot)', label: 'under 60%' },
    { max: 70, color: '#fb923c', label: '60–69%' },
    { max: 80, color: 'var(--warm)', label: '70–79%' },
    { max: 95, color: 'var(--cool)', label: '80–94%' },
    { max: Infinity, color: 'var(--accent)', label: '95%+' }] },
  dta: { label: 'Trolley waits 12h+', buckets: [
    { max: 0, color: '#334155', label: 'none published' },
    { max: 1000, color: 'rgba(251,113,133,.35)', label: 'under 1,000' },
    { max: 5000, color: 'rgba(251,113,133,.6)', label: '1–5K' },
    { max: 15000, color: 'var(--hot)', label: '5–15K' },
    { max: Infinity, color: '#be123c', label: 'over 15K' }] },
  att: { label: 'Total arrivals', buckets: [
    { max: 50000, color: 'rgba(125,211,252,.45)', label: 'under 50K' },
    { max: 150000, color: 'rgba(125,211,252,.7)', label: '50–150K' },
    { max: 300000, color: 'var(--cool)', label: '150–300K' },
    { max: 500000, color: 'var(--warm)', label: '300–500K' },
    { max: Infinity, color: 'var(--accent)', label: 'over 500K' }] },
  adm: { label: 'Admissions', buckets: [
    { max: 20000, color: 'rgba(167,139,250,.4)', label: 'under 20K' },
    { max: 50000, color: 'rgba(167,139,250,.65)', label: '20–50K' },
    { max: 90000, color: '#a78bfa', label: '50–90K' },
    { max: Infinity, color: '#7c3aed', label: 'over 90K' }] }
};
function mapMetricValue(metric, code) {
  const t = BY_CODE.get(code);
  if (!t) return null;
  if (metric === 'w4pct') return t.attCov > 0 ? 100 * t.w4 / t.attCov : null;
  if (metric === 'dta') return t.dta != null ? t.dta : 0;
  if (metric === 'att') return t.att;
  if (metric === 'adm') return t.adm != null ? t.adm : 0;
  return null;
}
function mapMetricColor(metric, code) {
  const def = MAP_METRICS[metric];
  if (!def || !def.buckets) return null;
  const v = mapMetricValue(metric, code);
  if (v == null) return '#475569';
  return def.buckets.find(b => v <= b.max).color;
}

/* ---------- comparison across trusts, always on one shared basis ----------
   With a period argument every trust is measured on that exact reporting
   month; without it, each trust's last-12-reported-months roll-up is used.
   Trusts with no published figure come back with null metrics — never zero. */
function compareRows(codes, ym) {
  const eng = england12m();
  const decorate = m => Object.assign(m, {
    vsEngland: m.perf != null && eng.perf != null ? m.perf - eng.perf : null,
    dtaShare: m.dta != null && m.adm ? 100 * m.dta / m.adm : null
  });
  if (ym) {
    return codes.map(c => {
      const t = BY_CODE.get(c); if (!t) return null;
      const r = recordAt(c, ym);
      return decorate({
        code: c, name: t.name, kind: t.kind,
        shortName: shortName(t.name),
        att: r ? r.att : null,
        perf: r && r.cov && r.att ? 100 * r.w4 / r.att : null,
        br: r && r.cov ? r.br : null,
        adm: r ? r.adm : null,
        dta: r ? r.dta : null
      });
    }).filter(Boolean);
  }
  return codes.map(c => {
    const t = BY_CODE.get(c); if (!t) return null;
    return decorate({
      code: c, name: t.name, kind: t.kind,
      shortName: shortName(t.name),
      att: t.att, perf: t.attCov > 0 ? 100 * t.w4 / t.attCov : null,
      br: t.br != null ? t.br : (t.attCov != null ? Math.max(t.attCov - t.w4, 0) : null),
      dta: t.dta, adm: t.adm
    });
  }).filter(Boolean);
}
function shortName(name) {
  const cut = name.replace(/ NHS Foundation Trust$| NHS Trust$| Care NHS Foundation Trust$/i, '');
  return cut.length > 22 ? cut.slice(0, 21) + '…' : cut;
}

window.AECORE = {
  TRUSTS, BY_CODE, GEO_BY_CODE, PERIODS, MONTHS: MN,
  history, recordAt, currentRecord,
  england12m, englandMonth, regionOf, regionStats,
  insights, explainer, fmt, fmtShort, monthLabel,
  parseHash, buildHash, reportCsv,
  MAP_METRICS, mapMetricValue, mapMetricColor, compareRows,
  LAST_YM: TM[TM.length - 1] || (M.length ? M[M.length - 1].p : null)
};
})();
