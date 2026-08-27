/* ═══════════════════════════════════════════════════════════════
   Eleven Years in the Waiting Room — application script
   All data from window.AE_MONTHLY / AE_PROVIDERS / AE_PM (real warehouse exports)
   ═══════════════════════════════════════════════════════════════ */
(function () {
'use strict';

/* fresh visits and reloads start at the top; explicit #section anchors
   still jump natively, and bfcache back/forward keeps its position.
   scroll-behavior is forced to 'auto' so the reset is instant — a smooth
   reset made every section visibly slide past on reload. */
try { if ('scrollRestoration' in history) history.scrollRestoration = 'manual'; } catch (e) {}
window.addEventListener('load', () => {
  if (!document.getElementById(location.hash.slice(1))) {
    const html = document.documentElement, prev = html.style.scrollBehavior;
    html.style.scrollBehavior = 'auto';
    window.scrollTo(0, 0);
    html.style.scrollBehavior = prev;
  }
});

const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const M = window.AE_MONTHLY, P = window.AE_PROVIDERS, PM = window.AE_PM;
const NS = 'http://www.w3.org/2000/svg';
const fmtM = n => n >= 1e6 ? (n/1e6).toFixed(n >= 1e7 ? 1 : 2) + 'M'
              : n >= 1e3 ? Math.round(n/1e3) + 'K' : String(n);
const fmtFull = n => n == null ? '—' : n.toLocaleString('en-GB');
const monthName = ym => {
  const [y, m] = ym.split('-').map(Number);
  return ['January','February','March','April','May','June','July','August','September','October','November','December'][m-1] + ' ' + y;
};
/* gold hollow diamond marking an incomplete month in our copy */
function addGapMark(svg, cx, cy, msg) {
  const g = svgEl('path', {
    class: 'gap-mark',
    d: `M${cx.toFixed(1)},${cy - 5} L${(cx + 5).toFixed(1)},${cy} L${cx.toFixed(1)},${cy + 5} L${(cx - 5).toFixed(1)},${cy} Z`,
    tabindex: '0', role: 'img', 'aria-label': msg
  }, svg);
  const act = ev => {
    const r = g.getBoundingClientRect();
    showTip(`<div class="t-date">INCOMPLETE MONTH</div>${msg}`,
      ev && ev.clientX || r.left + r.width / 2, ev && ev.clientY || r.top);
  };
  g.addEventListener('pointerenter', () => { g.setAttribute('fill', 'var(--warm)'); });
  g.addEventListener('pointermove', act);
  g.addEventListener('focus', act);
  g.addEventListener('pointerleave', () => { g.setAttribute('fill', 'none'); hideTip(); });
  g.addEventListener('blur', () => { g.setAttribute('fill', 'none'); hideTip(); });
}

function svgEl(tag, attrs, parent) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}
const tip = document.getElementById('tip');
function showTip(html, x, y) {
  tip.innerHTML = html;
  tip.classList.add('on');
  const w = tip.offsetWidth, h = tip.offsetHeight;
  let left = x + 16, top = y - h - 12;
  if (left + w > window.innerWidth - 12) left = x - w - 16;
  if (top < 8) top = y + 18;
  tip.style.left = left + 'px'; tip.style.top = top + 'px';
}
function hideTip() { tip.classList.remove('on'); }

/* ─────────────────────────── hero particle field ─────────────────────────── */
/* One particle per 20,000 real attendances, capped for frame budget.
   Each dot drifts; the cursor gently repels them. Pure decoration —
   hidden entirely under prefers-reduced-motion. */
(function heroField() {
  const canvas = document.getElementById('hero-canvas');
  if (!canvas || REDUCED) { if (canvas) canvas.style.display = 'none'; return; }
  const ctx = canvas.getContext('2d');
  const TOTAL_ATT = 261761588, PER_DOT = 20000;
  const rootStyle = getComputedStyle(document.documentElement);
  let W, H, dots = [], raf = null, mouse = { x: -9e3, y: -9e3 };
  const COUNT = Math.min(220, Math.round(TOTAL_ATT / PER_DOT / 59)); // ≈220 dots

  function size() {
    const r = canvas.getBoundingClientRect();
    W = canvas.width = r.width * devicePixelRatio;
    H = canvas.height = r.height * devicePixelRatio;
  }
  function seed() {
    dots = [];
    for (let i = 0; i < COUNT; i++) {
      dots.push({
        x: Math.random() * W, y: Math.random() * H,
        vx: (Math.random() - .5) * .12 * devicePixelRatio,
        vy: (Math.random() - .5) * .12 * devicePixelRatio,
        r: (Math.random() * 1.3 + .5) * devicePixelRatio,
        a: Math.random() * .5 + .15,
        warm: Math.random() < .12
      });
    }
  }
  function step() {
    ctx.clearRect(0, 0, W, H);
    for (const d of dots) {
      const dx = d.x - mouse.x, dy = d.y - mouse.y;
      const dist2 = dx * dx + dy * dy, R = 130 * devicePixelRatio;
      if (dist2 < R * R && dist2 > 1) {
        const f = (R * R - dist2) / (R * R) * .35;
        const dist = Math.sqrt(dist2);
        d.vx += dx / dist * f * .4; d.vy += dy / dist * f * .4;
      }
      d.vx *= .96; d.vy *= .96;
      d.vx += (Math.random() - .5) * .015; d.vy += (Math.random() - .5) * .015;
      d.x += d.vx; d.y += d.vy;
      if (d.x < -10) d.x = W + 10; if (d.x > W + 10) d.x = -10;
      if (d.y < -10) d.y = H + 10; if (d.y > H + 10) d.y = -10;
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r, 0, 7);
      // colours track the --dot-rgb / --dotwarm-rgb tokens so the field
      // recolours itself when the theme flips
      ctx.fillStyle = d.warm
        ? `rgba(${rootStyle.getPropertyValue('--dotwarm-rgb') || '251,191,36'},${d.a})`
        : `rgba(${rootStyle.getPropertyValue('--dot-rgb') || '94,234,212'},${d.a})`;
      ctx.fill();
    }
    raf = requestAnimationFrame(step);
  }
  size(); seed();
  if (!REDUCED) raf = requestAnimationFrame(step);
  let resizeTmr;
  window.addEventListener('resize', () => {          // rotation, URL-bar collapse
    clearTimeout(resizeTmr);
    resizeTmr = setTimeout(() => { size(); seed(); }, 150);
  }, { passive: true });
  window.addEventListener('pointermove', e => {
    const r = canvas.getBoundingClientRect();
    if (e.clientY < r.bottom) {
      document.body.classList.add('has-pointer');
      mouse.x = (e.clientX - r.left) * devicePixelRatio;
      mouse.y = (e.clientY - r.top) * devicePixelRatio;
    } else mouse.x = mouse.y = -9e3;
  }, { passive: true });

  // pause the whole field while the hero is off screen or the tab is hidden —
  // a decorative canvas has no business burning frames down the page
  let running = false;
  function setRunning(on) {
    if (on === running) return;
    running = on;
    if (on) { size(); seed(); raf = requestAnimationFrame(step); }
    else { cancelAnimationFrame(raf); raf = null; }
  }
  new IntersectionObserver(es => es.forEach(e => {
    setRunning(!document.hidden && e.isIntersecting && !REDUCED);
  }), { threshold: 0 }).observe(canvas);
  document.addEventListener('visibilitychange', () => {
    setRunning(!document.hidden && !REDUCED);
  });
})();

/* ─────────────────────────── hero ECG heartbeat ─────────────────────────── */
/* A calm electrocardiogram line drifting behind the particle field — the
   visual shorthand for "a system's vital signs". One static frame under
   prefers-reduced-motion; paused whenever the hero is off screen or the
   tab is hidden. */
(function heroEcg() {
  const canvas = document.getElementById('ecg-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const rootStyle = getComputedStyle(document.documentElement);
  let W = 0, H = 0, raf = null, last = null, phase = 0;
  const PERIOD = 520;   // px between heartbeats
  const SPEED = 130;    // drift, px per second
  const g = (u, c, w, a) => a * Math.exp(-((u - c) ** 2) / (2 * w * w));
  // P wave up, Q dip, tall R spike, S recovery, T wave — classic lead-II
  const beat = u => -g(u, .14, .05, .18) + g(u, .295, .010, .10)
                  - g(u, .325, .011, .85) + g(u, .352, .013, .24)
                  - g(u, .52, .055, .20);
  function size() {
    const r = canvas.getBoundingClientRect();
    W = canvas.width = r.width * devicePixelRatio;
    H = canvas.height = r.height * devicePixelRatio;
  }
  function paint(ts) {
    if (last != null) phase = (phase + Math.min(ts - last, 60) / 1000 * SPEED) % PERIOD;
    last = ts;
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = (rootStyle.getPropertyValue('--accent') || '#005EB8').trim();
    ctx.lineWidth = 1.6 * devicePixelRatio;
    ctx.globalAlpha = .3;
    ctx.beginPath();
    const step = 4 * devicePixelRatio,
          amp = H * .16,                     // H is already device pixels
          base = H * .55;
    for (let x = 0; x <= W + step; x += step) {
      const u = (((x / devicePixelRatio + phase) / PERIOD) % 1 + 1) % 1;
      const y = base + beat(u) * amp;
      x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  function loop(ts) { paint(ts); raf = requestAnimationFrame(loop); }
  function setRunning(on) {
    if (on) {
      size(); last = null;
      if (REDUCED) { paint(0); stop(); }              // single static frame
      else if (!raf) raf = requestAnimationFrame(loop);
    } else stop();
  }
  function stop() { if (raf) { cancelAnimationFrame(raf); raf = null; } }
  setRunning(true);
  let resizeTmr;
  window.addEventListener('resize', () => {          // rotation, URL-bar collapse
    clearTimeout(resizeTmr);
    resizeTmr = setTimeout(() => {
      size();
      if (REDUCED) { paint(0); stop(); }             // refresh the static frame
    }, 150);
  }, { passive: true });
  new IntersectionObserver(es => es.forEach(e =>
    setRunning(!document.hidden && e.isIntersecting)), { threshold: 0 }).observe(canvas);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else if (!REDUCED && !raf) { size(); last = null; raf = requestAnimationFrame(loop); }
  });
})();

/* ─────────────────────────── headline performance gauge ─────────────────── */
/* First-screen answer to "how is the NHS doing?": latest national 4-hour
   performance against the 95% promise, from the same AE_MONTHLY export that
   powers the trend charts. Arc fills left→right on a full 0–100 scale so the
   gauge never exaggerates; the gold tick marks the 95% target.             */
(function heroGauge() {
  const el = document.getElementById('hero-gauge');
  if (!el || !window.AE_MONTHLY) return;
  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const rows = window.AE_MONTHLY.filter(r => r.pp != null && r.n >= 150 && r.pp <= 100);
  const last = rows[rows.length - 1];
  if (!last) { el.hidden = true; return; }
  const perf = Math.round(last.pp * 10) / 10;
  const MN = ['January','February','March','April','May','June',
              'July','August','September','October','November','December'];
  const [y, m] = last.p.split('-').map(Number);
  const label = MN[m - 1] + ' ' + y;

  // fill the arc: pathLength=100 → dasharray in percentage points
  const val = el.querySelector('#g-val');
  val.setAttribute('stroke-dasharray', perf + ' ' + (100 - perf));
  val.setAttribute('aria-hidden', 'true');

  // target tick at 95% along the same arc (r 42→54)
  const a = Math.PI * (1 - .95);
  const px = r => 60 + r * Math.cos(a), py = r => 64 - r * Math.sin(a);
  const tick = el.querySelector('#g-target');
  tick.setAttribute('x1', px(42).toFixed(1)); tick.setAttribute('y1', py(42).toFixed(1));
  tick.setAttribute('x2', px(54).toFixed(1)); tick.setAttribute('y2', py(54).toFixed(1));

  // text equivalents: visible caption + svg aria-label
  const cap = el.querySelector('#g-cap');
  cap.innerHTML = `About <b class="num">${perf.toFixed(1)}%</b> were seen within 4 hours in
    ${label} (the last reported month) — the NHS promise is <b class="num">95%</b>.
    Trust pages compare against the rolling 12-month average instead.`;
  const svg = el.querySelector('svg');
  svg.setAttribute('aria-label',
    `Gauge: ${perf} percent of patients in England were seen within four hours in ${label}. ` +
    `The target is 95 percent. Gold tick marks the target; teal arc shows performance.`);

  // count-up like the hero stats beside it
  const numEl = el.querySelector('#g-vnum');
  if (REDUCED) { numEl.textContent = perf.toFixed(1); return; }
  const t0 = performance.now(), dur = 1200;
  (function frame(t) {
    const k = Math.min(1, (t - t0) / dur);
    const eased = 1 - Math.pow(1 - k, 3);
    numEl.textContent = (perf * eased).toFixed(1);
    if (k < 1) requestAnimationFrame(frame);
  })(t0);
})();

/* ─────────────────────────── count-up hero stats ─────────────────────────── */
(function heroCounts() {
  const els = document.querySelectorAll('[data-count]');
  const run = el => {
    const target = +el.dataset.count, dur = REDUCED ? 0 : 1600;
    const t0 = performance.now();
    const short = target >= 1e6;
    (function frame(t) {
      const k = dur ? Math.min(1, (t - t0) / dur) : 1;
      const eased = 1 - Math.pow(1 - k, 3);
      const v = Math.round(target * eased);
      el.textContent = short ? fmtM(v) : v.toLocaleString('en-GB');
      if (k < 1) requestAnimationFrame(frame);
    })(t0);
  };
  const io = new IntersectionObserver(es => es.forEach(e => {
    if (e.isIntersecting) { run(e.target); io.unobserve(e.target); }
  }), { threshold: .4 });
  els.forEach(el => io.observe(el));
})();

/* ─────────────────────────── reveal on scroll ─────────────────────────── */
(function reveals() {
  const els = document.querySelectorAll('.reveal');
  if (REDUCED) { els.forEach(e => e.classList.add('in')); return; }
  const io = new IntersectionObserver(es => es.forEach(e => {
    if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }), { threshold: .12, rootMargin: '0px 0px -6% 0px' });
  els.forEach(e => io.observe(e));
})();

/* ─────────────────────────── progress bar + ticker ─────────────────────────── */
(function chrome() {
  const bar = document.getElementById('progress');
  // rAF-throttled: at most one style write per frame, instead of one per scroll event
  let ticking = false;
  window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const h = document.documentElement;
      bar.style.width = (h.scrollTop / (h.scrollHeight - h.clientHeight) * 100) + '%';
      ticking = false;
    });
  }, { passive: true });

  const track = document.querySelector('#ticker .track');
  const items = [
    ['261.8M visits', 'var(--accent)'], ['65.3M emergency admissions', 'var(--cool)'],
    ['43.7M 4-hour breaches since Apr 2017', 'var(--hot)'],
    ['553,345 twelve-hour trolley waits, last 12m', 'var(--hot)'],
    ['204 sites reported last year', 'var(--accent)'],
    ['63 organisations renamed along the way', 'var(--dim)'],
    ['46 arrivals every minute, day and night', 'var(--warm)'],
    ['July 2015: the only month in eleven years to meet the 95% promise', 'var(--warm)']
  ];
  const mk = dup => items.map(([t, c]) =>
    `<span class="tick-item${dup ? ' dup' : ''}"><span class="sw" style="background:${c}"></span>${t}</span>`).join('');
  // second copy drives the desktop marquee loop; hidden on mobile
  track.innerHTML = mk(false) + mk(true);
})();

/* ─────────────────────────── light / dark theme ─────────────────────────── */
/* One class on <html> flips every token. Pre-paint snippet in <head> applies
   the saved/system choice before first paint; this wires the button, persists
   the choice and broadcasts 'ae-theme' (the map listens to swap its tiles).  */
(function theme() {
  const btn = document.getElementById('theme-toggle');
  const root = document.documentElement;
  if (!btn) return;
  const SUN = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4.4"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.2 5.2l2.1 2.1M16.7 16.7l2.1 2.1M18.8 5.2l-2.1 2.1M7.3 16.7l-2.1 2.1"/></svg>';
  const MOON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.6 14.1A8.8 8.8 0 0 1 9.9 3.4a8.8 8.8 0 1 0 10.7 10.7Z"/></svg>';
  function paint() {
    const light = root.classList.contains('light');
    btn.innerHTML = light ? MOON : SUN;
    const lbl = light ? 'Switch to dark theme' : 'Switch to light theme';
    btn.setAttribute('aria-label', lbl);
    btn.setAttribute('title', lbl);
  }
  window.__aeSetTheme = function (mode, persist = true) {
    root.classList.toggle('light', mode === 'light');
    if (persist) { try { localStorage.setItem('ae-theme', mode); } catch (e) {} }
    paint();
    window.dispatchEvent(new CustomEvent('ae-theme', { detail: mode }));
  };
  btn.addEventListener('click', () => {
    window.__aeSetTheme(root.classList.contains('light') ? 'dark' : 'light');
  });
  // initial paint — runs after DOM ready so pre-paint class is present
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', paint, { once: true });
  } else {
    paint();
  }
})();

/* ═══════════════════════════ CHART 1 · THE SLIDE ═══════════════════════════ */
/* National monthly % within 4h. Series = attendance-weighted published
   performance (NHS methodology), so pre-2017 months are real, not gaps.
   Annotated at July 2015 (the one target month), June 2018, Nov 2022, today. */
(function slideChart() {
  const svg = document.getElementById('slide-chart');
  if (!svg) return;
  const W = 1000, H = 430, m = { t: 26, r: 24, b: 44, l: 52 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const data = M.map((r, i) => ({ i, ym: r.p, perf: r.pp, n: r.n, breaches: r.b, w: r.wc, ac: r.ac }));
  const x = i => m.l + i / (data.length - 1) * iw;
  const y = v => m.t + (1 - (v - 60) / 40) * ih;   // domain 60–100

  // grid + y labels
  for (let v = 60; v <= 100; v += 10) {
    svgEl('line', { class: 'gridline', x1: m.l, x2: W - m.r, y1: y(v), y2: y(v) }, svg);
    svgEl('text', { class: 'axis', x: m.l - 10, y: y(v) + 4, 'text-anchor': 'end' }, svg)
      .textContent = v + '%';
  }
  // x labels: January of each year
  data.forEach(d => {
    if (d.ym.endsWith('-01'))
      svgEl('text', { class: 'axis', x: x(d.i), y: H - m.b + 22, 'text-anchor': 'middle' }, svg)
        .textContent = d.ym.slice(0, 4);
  });
  // pandemic band
  const iMar20 = data.findIndex(d => d.ym === '2020-03');
  const iJan22 = data.findIndex(d => d.ym === '2022-01');
  svgEl('rect', { class: 'era-band', x: x(iMar20), width: x(iJan22) - x(iMar20), y: m.t, height: ih }, svg);
  svgEl('line', { class: 'era-line', x1: x(iMar20), x2: x(iMar20), y1: m.t, y2: m.t + ih }, svg);
  svgEl('text', { class: 'anno', x: x(iMar20) + 8, y: m.t + 16 }, svg).textContent = 'pandemic arrives';

  // 95% target
  svgEl('line', { class: 'target-line', x1: m.l, x2: W - m.r, y1: y(95), y2: y(95) }, svg);
  svgEl('text', { class: 'target-label', x: W - m.r - 4, y: y(95) - 7, 'text-anchor': 'end' }, svg)
    .textContent = 'THE 95% PROMISE';

  // the line, split into visible runs (nulls/sparse months = gaps)
  const okPt = d => d.perf != null && d.perf <= 100 && d.n >= 150;
  const runs = [];
  let cur = [];
  data.forEach(d => { if (okPt(d)) cur.push(d); else { if (cur.length) runs.push(cur); cur = []; } });
  if (cur.length) runs.push(cur);

  const linePath = run => run.map((d, j) => (j ? 'L' : 'M') + x(d.i).toFixed(1) + ',' + y(d.perf).toFixed(1)).join('');
  const path = svgEl('path', {
    d: runs.map(linePath).join(' '), fill: 'none', stroke: 'var(--accent)',
    'stroke-width': 2.4, 'stroke-linejoin': 'round', 'stroke-linecap': 'round'
  }, svg);
  if (!REDUCED) {
    const len = path.getTotalLength();
    path.style.strokeDasharray = len;
    path.style.strokeDashoffset = len;
    new IntersectionObserver((es, io) => es.forEach(e => {
      if (!e.isIntersecting) return;
      path.style.transition = 'stroke-dashoffset 2.6s cubic-bezier(.4,0,.2,1)';
      path.style.strokeDashoffset = '0';
      io.disconnect();
    }), { threshold: .3 }).observe(svg);
  }

  // dots + hit areas
  const g = svgEl('g', {}, svg);
  data.forEach(d => {
    if (!okPt(d)) return;
    svgEl('circle', { cx: x(d.i), cy: y(d.perf), r: 2.6, fill: 'var(--accent)', opacity: .85 }, g);
  });
  data.forEach(d => {
    if (!okPt(d)) return;
    const hit = svgEl('rect', { x: x(d.i) - iw / data.length / 2, y: m.t, width: iw / data.length, height: ih, fill: 'transparent' }, svg);
    const dot = document.createElementNS(NS, 'circle');
    const brTxt = (d.breaches != null && d.ac > 0)
      ? `<div style="color:var(--hot);font-size:12px;margin-top:3px">${Math.round(d.ac - d.w).toLocaleString('en-GB')} waited too long</div>` : '';
    const html = `<div class="t-date">${monthName(d.ym).toUpperCase()}</div>
      <div class="t-big num">${d.perf.toFixed(1)}%</div> seen within 4 hours${brTxt}`;
    hit.setAttribute('tabindex', '0');
    hit.setAttribute('role', 'img');
    hit.setAttribute('aria-label',
      `${monthName(d.ym)}: ${d.perf.toFixed(1)} percent seen within four hours` +
      (d.breaches != null ? `, ${(d.ac - d.w).toLocaleString('en-GB')} waited longer` : ''));
    const activate = ev => {
      dot.setAttribute('r', 5.5); dot.setAttribute('fill', '#FFFFFF');
      dot.setAttribute('cx', x(d.i)); dot.setAttribute('cy', y(d.perf));
      g.appendChild(dot);
      const r = hit.getBoundingClientRect();
      showTip(html, ev && ev.clientX || r.left + r.width / 2, ev && ev.clientY || r.top + r.height / 2);
    };
    hit.addEventListener('pointerenter', ev => {
      activate(ev);
    });
    hit.addEventListener('focus', activate);
    hit.addEventListener('pointermove', ev => showTip(html, ev.clientX, ev.clientY));
    hit.addEventListener('pointerleave', () => { hideTip(); if (dot.parentNode) dot.remove(); });
    hit.addEventListener('blur', () => { hideTip(); if (dot.parentNode) dot.remove(); });
    hit.dataset.i = d.i;
  });
  // arrow keys walk the timeline while focus stays inside the chart
  svgEl('desc', {}, svg).textContent =
    'Use left and right arrow keys to move between months.';
  const hits = [...svg.querySelectorAll('rect[tabindex="0"]')]
    .sort((a2, b2) => (+a2.dataset.i) - (+b2.dataset.i));
  svg.addEventListener('keydown', ev => {
    if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
    const i = hits.indexOf(document.activeElement);
    if (i < 0) return;
    ev.preventDefault();
    const nxt = hits[Math.max(0, Math.min(hits.length - 1, i + (ev.key === 'ArrowRight' ? 1 : -1)))];
    if (nxt !== document.activeElement) nxt.focus();
  });

  // annotations: the one target month, the 2018 high, the 2022 low, today
  const iJul15 = data.findIndex(d => d.ym === '2015-07');
  svgEl('circle', { cx: x(iJul15), cy: y(data[iJul15].perf), r: 4.5, fill: 'var(--warm)' }, svg);
  svgEl('text', { class: 'anno-strong', x: x(iJul15) + 8, y: y(data[iJul15].perf) - 10, fill: 'var(--warm)' }, svg)
    .textContent = '95.0% — the only month at target';
  const iJun18 = data.findIndex(d => d.ym === '2018-06');
  svgEl('circle', { cx: x(iJun18), cy: y(data[iJun18].perf), r: 4, fill: 'var(--accent)' }, svg);
  svgEl('text', { class: 'anno-strong', x: Math.min(x(iJun18) + 6, W - m.r - 120), y: y(data[iJun18].perf) - 12 }, svg)
    .textContent = '90.8% — June 2018';
  const iNov22 = data.findIndex(d => d.ym === '2022-11');
  svgEl('circle', { cx: x(iNov22), cy: y(data[iNov22].perf), r: 4, fill: 'var(--hot)' }, svg);
  svgEl('text', { class: 'anno-strong', x: x(iNov22) - 6, y: y(data[iNov22].perf) + 20, 'text-anchor': 'middle', fill: 'var(--hot)' }, svg)
    .textContent = '69.0% — the low, Nov 2022';
  const iLast = data.length - 1;
  svgEl('circle', { cx: x(iLast), cy: y(data[iLast].perf), r: 4.5, fill: 'var(--warm)' }, svg);
  svgEl('text', { class: 'anno-strong', x: x(iLast) - 4, y: y(data[iLast].perf) - 12, 'text-anchor': 'end', fill: 'var(--warm)' }, svg)
    .textContent = '75.4% — July 2026';

  // April 2020: recording-guidance change — hover/focus for the caveat
  {
    const iA = data.findIndex(d => d.ym === '2020-04');
    if (iA >= 0) {
      const msg = 'NHS changed A&E recording guidance here due to COVID-19; direct pre/post comparisons require caution.';
      const hit = svgEl('rect', {
        x: x(iA) - 8, y: m.t, width: 16, height: ih,
        fill: 'transparent', cursor: 'help', tabindex: '0', role: 'img', 'aria-label': msg
      }, svg);
      const act = ev => {
        const r = hit.getBoundingClientRect();
        showTip(`<div class="t-date">APRIL 2020 · DATA BREAK</div>${msg}`,
          ev && ev.clientX || r.left + r.width / 2, ev && ev.clientY || r.top);
      };
      hit.addEventListener('pointerenter', act);
      hit.addEventListener('pointermove', act);
      hit.addEventListener('focus', act);
      hit.addEventListener('pointerleave', hideTip);
      hit.addEventListener('blur', hideTip);
    }
  }

  /* historical context events — dated facts from the period, short labels */
  [
    { ym: '2021-12', label: 'omicron wave', ly: m.t + ih * .18 },
    // anchored on Jan-2023: Dec-2022 is an incomplete month in our copy
    { ym: '2023-01', label: "nurses' strikes (from Dec '22)", ly: m.t + ih * .34 }
  ].forEach(ev => {
    const i = data.findIndex(d => d.ym === ev.ym);
    if (i < 0 || !okPt(data[i])) return;
    svgEl('line', { class: 'era-line', x1: x(i), x2: x(i), y1: m.t, y2: m.t + ih }, svg);
    const tx = svgEl('text', { class: 'anno', x: x(i) + 6, y: ev.ly }, svg);
    tx.textContent = ev.label;
  });

  /* visible markers for incomplete months in our copy (see caveats):
     months absent from the series or too sparse to draw. Gold hollow
     diamonds on the baseline; hover for the reason.                    */
  function incompleteMonths() {
    const have = new Map(M.map(r => [r.p, r]));
    const out = [];
    let [yy, mm] = M[0].p.split('-').map(Number);
    const end = M[M.length - 1].p;
    while (true) {
      const p = yy + '-' + String(mm).padStart(2, '0');
      if (p > end) break;
      const r = have.get(p);
      if (!r || !(r.n >= 150) || r.pp == null || r.pp > 100) out.push(p);
      mm++; if (mm > 12) { mm = 1; yy++; }
    }
    return out;
  }
  window.__aeIncompleteMonths = incompleteMonths();
  incompleteMonths().forEach(ym => {
    let li = -1, ri = -1;
    for (let k = 0; k < data.length; k++) {
      if (data[k].ym < ym) li = data[k].i;
      if (ri < 0 && data[k].ym > ym) ri = data[k].i;
    }
    if (li < 0 && ri < 0) return;
    const cx = li >= 0 && ri >= 0 ? (x(li) + x(ri)) / 2 : (li >= 0 ? x(li) : x(ri));
    addGapMark(svg, cx, m.t + ih + 8,
      `${monthName(ym)} — incomplete month in our copy (few or no provider files). National figures for this month should be read with care.`);
  });
})();

(function chartSummaries() {
  function summarize(id, html) {
    const svg = document.getElementById(id);
    if (!svg) return;
    const p = document.createElement('p');
    p.className = 'sr-only';
    p.id = id + '-summary';
    p.innerHTML = html;
    svg.setAttribute('aria-describedby', p.id);
    svg.insertAdjacentElement('afterend', p);
  }
  const valid = M.filter(r => r.pp != null && r.n >= 150 && r.pp <= 100);
  if (valid.length) {
    const f = valid[0], l = valid[valid.length - 1];
    let best = valid[0], worst = valid[0];
    valid.forEach(r => { if (r.pp > best.pp) best = r; if (r.pp < worst.pp) worst = r; });
    summarize('slide-chart',
      `National trend, ${monthName(f.p)} to ${monthName(l.p)}: performance started at ` +
      `${f.pp.toFixed(1)} percent within four hours and ended at ${l.pp.toFixed(1)} percent. ` +
      `The strongest month was ${monthName(best.p)} at ${best.pp.toFixed(1)} percent; ` +
      `the weakest was ${monthName(worst.p)} at ${worst.pp.toFixed(1)} percent. ` +
      `The 95 percent target has been met once in this period.`);
  }
  if (M.length) {
    const tr = M.filter(r => r.p >= '2017-01' && r.d != null);
    const first = tr[0], last = tr[tr.length - 1];
    summarize('trolley-chart',
      `Twelve-hour trolley waits rose from ${(first.d).toLocaleString('en-GB')} in ` +
      `${monthName(first.p)} to ${(last.d).toLocaleString('en-GB')} in ${monthName(last.p)}.`);
  }
})();

/* ═══════════════════════════ CHART 2 · TWO WORLDS ═══════════════════════════ */
/* Type-1 vs walk-in vs all, monthly, Apr 2017 → Jul 2026. */
(function doorsChart() {
  const svg = document.getElementById('doors-chart');
  if (!svg) return;
  const W = 1000, H = 380, m = { t: 24, r: 24, b: 42, l: 52 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const from = M.findIndex(r => r.p === '2017-04');
  const data = M.slice(from).map((r, j) => {
    const cov = r.ac != null && r.ac > 0 && r.n >= 150;   // full-coverage months only
    return {
      i: j, ym: r.p, n: r.n,
      all: cov ? 100 * r.wc / r.ac : null,
      t1: (cov && r.x1 > 0 && r.y1 != null) ? 100 * (r.x1 - r.y1) / r.x1 : null,
      t3: (cov && r.x3 > 0 && r.y3 != null) ? 100 * (r.x3 - r.y3) / r.x3 : null
    };
  });
  const x = i => m.l + i / (data.length - 1) * iw;
  const y = v => m.t + (1 - (v - 50) / 50) * ih;   // domain 50–100

  for (let v = 50; v <= 100; v += 10) {
    svgEl('line', { class: 'gridline', x1: m.l, x2: W - m.r, y1: y(v), y2: y(v) }, svg);
    svgEl('text', { class: 'axis', x: m.l - 10, y: y(v) + 4, 'text-anchor': 'end' }, svg).textContent = v + '%';
  }
  data.forEach(d => { if (d.ym.endsWith('-01'))
    svgEl('text', { class: 'axis', x: x(d.i), y: H - m.b + 20, 'text-anchor': 'middle' }, svg).textContent = d.ym.slice(0, 4); });

  svgEl('line', { class: 'target-line', x1: m.l, x2: W - m.r, y1: y(95), y2: y(95) }, svg);
  svgEl('text', { class: 'target-label', x: m.l + 6, y: y(95) - 7 }, svg).textContent = '95% PROMISE';

  const series = [
    { key: 't3', color: 'var(--cool)', label: 'walk-in / urgent care' },
    { key: 'all', color: 'var(--accent)', label: 'all A&E' },
    { key: 't1', color: 'var(--hot)', label: 'consultant-led (Type 1)' }
  ];
  series.forEach(s => {
    let dstr = '', pen = false;
    data.forEach(d => {
      if (d[s.key] == null) { pen = false; return; }
      dstr += (pen ? 'L' : 'M') + x(d.i).toFixed(1) + ',' + y(d[s.key]).toFixed(1);
      pen = true;
    });
    svgEl('path', { d: dstr, fill: 'none', stroke: s.color, 'stroke-width': 2.2,
      'stroke-linejoin': 'round', 'stroke-linecap': 'round', opacity: .95 }, svg);
  });

  // hover: vertical guide + all three values
  const guide = svgEl('line', { x1: 0, x2: 0, y1: m.t, y2: m.t + ih, stroke: 'var(--line2)',
    'stroke-width': 1, visibility: 'hidden' }, svg);
  const hit = svgEl('rect', { x: m.l, y: m.t, width: iw, height: ih, fill: 'transparent' }, svg);
  hit.addEventListener('pointermove', ev => {
    const r = svg.getBoundingClientRect();
    const px = (ev.clientX - r.left) / r.width * W;
    const i = Math.max(0, Math.min(data.length - 1, Math.round((px - m.l) / iw * (data.length - 1))));
    const d = data[i];
    if (d.all == null) { hideTip(); guide.setAttribute('visibility', 'hidden'); return; }
    guide.setAttribute('x1', x(i)); guide.setAttribute('x2', x(i));
    guide.setAttribute('visibility', 'visible');
    const row = (c, k, v) => `<div style="display:flex;gap:8px;align-items:center"><span style="width:9px;height:9px;border-radius:2px;background:${c}"></span>${k}&nbsp; <b class="num" style="margin-left:auto">${v}%</b></div>`;
    showTip(`<div class="t-date">${monthName(d.ym).toUpperCase()}</div>` +
      row('var(--hot)', 'Type 1 big A&E', d.t1.toFixed(1)) +
      row('var(--cool)', 'Walk-in centres', d.t3.toFixed(1)) +
      row('var(--accent)', 'All A&E', d.all.toFixed(1)), ev.clientX, ev.clientY);
  });
  hit.addEventListener('pointerleave', () => { guide.setAttribute('visibility', 'hidden'); hideTip(); });

  // end labels (computed from the series itself)
  const last = data[data.length - 1], first = data[0];
  svgEl('text', { class: 'anno-strong', x: x(0) + 2, y: y(first.t1) - 10, 'text-anchor': 'start', fill: 'var(--hot)' }, svg)
    .textContent = first.t1.toFixed(1) + '%';
  svgEl('text', { class: 'anno-strong', x: x(data.length - 1) - 2, y: y(last.t1) + 20, 'text-anchor': 'end', fill: 'var(--hot)' }, svg)
    .textContent = last.t1.toFixed(1) + '% today';
  svgEl('text', { class: 'anno-strong', x: x(data.length - 1) - 2, y: y(last.t3) - 10, 'text-anchor': 'end', fill: 'var(--cool)' }, svg)
    .textContent = last.t3.toFixed(1) + '% today';
  svgEl('text', { class: 'anno-strong', x: x(data.length - 1) - 2, y: y(last.all) + 20, 'text-anchor': 'end', fill: 'var(--accent)' }, svg)
    .textContent = last.all.toFixed(1) + '% today';
})();

/* ═══════════════════════════ CHART 3 · TROLLEY WAITS ═══════════════════════════ */
(function trolleyChart() {
  const svg = document.getElementById('trolley-chart');
  if (!svg) return;
  const W = 1000, H = 360, m = { t: 24, r: 20, b: 42, l: 56 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const data = M.filter(r => r.p >= '2017-01').map((r, j) => ({ j, ym: r.p, d: r.d, n: r.n }));
  const maxV = 72000;
  const x = j => m.l + j / (data.length - 1) * iw;
  const y = v => m.t + (1 - v / maxV) * ih;
  const bw = Math.max(2.5, iw / data.length * .68);

  for (let v = 0; v <= maxV; v += 18000) {
    svgEl('line', { class: 'gridline', x1: m.l, x2: W - m.r, y1: y(v), y2: y(v) }, svg);
    svgEl('text', { class: 'axis', x: m.l - 10, y: y(v) + 4, 'text-anchor': 'end' }, svg)
      .textContent = v === 0 ? '0' : (v / 1000) + 'K';
  }
  data.forEach(d => { if (d.ym.endsWith('-01') && d.ym.slice(3) === '01')
    svgEl('text', { class: 'axis', x: x(d.j), y: H - m.b + 20, 'text-anchor': 'middle' }, svg).textContent = d.ym.slice(0, 4); });

  // covid note band
  const iMar20 = data.findIndex(d => d.ym === '2020-03');
  svgEl('line', { class: 'era-line', x1: x(iMar20), x2: x(iMar20), y1: m.t, y2: m.t + ih }, svg);
  svgEl('text', { class: 'anno', x: x(iMar20) + 6, y: m.t + 14 }, svg).textContent = 'pandemic begins';

  const bars = [];
  data.forEach(d => {
    if (d.d == null) return;
    const b = svgEl('rect', { x: x(d.j) - bw / 2, y: y(d.d), width: bw, height: m.t + ih - y(d.d),
      fill: d.d > 40000 ? '#003087' : '#005EB8' }, svg);
    b.dataset.ym = d.ym; b.dataset.d = d.d;
    bars.push(b);
  });
  // incomplete-month markers (Dec-25 hole etc.) — never rendered as zero bars
  (window.__aeIncompleteMonths || []).forEach(ym => {
    if (ym < '2017-01') return;
    let li = -1, ri = -1;
    data.forEach((d, j) => {
      if (d.ym < ym) li = j;
      if (ri < 0 && d.ym > ym) ri = j;
    });
    if (li < 0 && ri < 0) return;
    const cx = li >= 0 && ri >= 0 ? (x(li) + x(ri)) / 2 : (li >= 0 ? x(li) : x(ri));
    addGapMark(svg, cx, m.t + ih + 8,
      `${monthName(ym)} — incomplete month in our copy; no reliable trolley-wait figure.`);
  });

  // annotations: Jan21 vs Jan26
  const jan21 = data.find(d => d.ym === '2021-01'), jan26 = data.find(d => d.ym === '2026-01');
  svgEl('text', { class: 'anno-strong', x: x(data.indexOf(jan21)), y: y(jan21.d) - 8, 'text-anchor': 'middle' }, svg)
    .textContent = '3,825';
  svgEl('text', { class: 'anno-strong', x: x(data.indexOf(jan26)), y: y(jan26.d) - 8, 'text-anchor': 'middle', fill: 'var(--hot)' }, svg)
    .textContent = '71,517';

  bars.forEach(b => {
    b.addEventListener('pointerenter', ev => {
      b.setAttribute('opacity', '.85');
      showTip(`<div class="t-date">${monthName(b.dataset.ym).toUpperCase()}</div>
        <div class="t-big num" style="color:var(--hot)">+${(+b.dataset.d).toLocaleString('en-GB')}</div>
        patients waited 12h+ for a ward bed after admission was decided`, ev.clientX, ev.clientY);
    });
    b.addEventListener('pointerleave', () => { b.setAttribute('opacity', '1'); hideTip(); });
  });

  if (!REDUCED) {
    const finalBars = bars.map(b => ({ b, fy: b.getAttribute('y'), fh: b.getAttribute('height') }));
    new IntersectionObserver((es, io) => es.forEach(e => {
      if (!e.isIntersecting) return;
      io.disconnect();
      finalBars.forEach(({ b, fy, fh }, k) => {
        const delay = Math.min(k * 9, 900);
        b.style.transition = `y .7s cubic-bezier(.22,.6,.2,1) ${delay}ms, height .7s cubic-bezier(.22,.6,.2,1) ${delay}ms`;
        requestAnimationFrame(() => { b.setAttribute('y', fy); b.setAttribute('height', fh); });
      });
    }), { threshold: .25 }).observe(svg);
  }
})();

/* ═══════════════════════════ CHART 4 · SEASONS ═══════════════════════════ */
(function seasonChart() {
  const svg = document.getElementById('season-chart');
  if (!svg) return;
  // Verified in Postgres over full-coverage months only.
  const perf = [73.6, 74.0, 75.3, 77.8, 77.2, 77.7, 77.3, 78.9, 76.1, 76.6, 74.2, 74.3];
  const idx  = [97, 92, 101, 94, 103, 102, 105, 100, 101, 104, 101, 100];
  const MN = ['J','F','M','A','M','J','J','A','S','O','N','D'];
  const W = 640, H = 340, m = { t: 26, r: 46, b: 34, l: 40 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const x = i => m.l + (i + .5) / 12 * iw;
  const yP = v => m.t + (1 - (v - 70) / 12) * ih;      // perf domain 70–82
  const yI = v => m.t + (1 - (v - 85) / 25) * ih;      // index domain 85–110

  for (let v = 70; v <= 82; v += 4) {
    svgEl('line', { class: 'gridline', x1: m.l, x2: m.l + iw, y1: yP(v), y2: yP(v) }, svg);
    svgEl('text', { class: 'axis', x: m.l - 8, y: yP(v) + 4, 'text-anchor': 'end' }, svg).textContent = v + '%';
  }
  svgEl('text', { class: 'axis', x: m.l + iw + 8, y: yI(100) + 4 }, svg).textContent = '100';
  svgEl('text', { class: 'axis', x: m.l + iw + 8, y: yI(90) + 4 }, svg).textContent = '90';
  MN.forEach((mm, i) => svgEl('text', { class: 'axis', x: x(i), y: H - m.b + 18, 'text-anchor': 'middle' }, svg).textContent = mm);

  idx.forEach((v, i) => {
    const bw = iw / 12 * .52;
    svgEl('rect', { x: x(i) - bw / 2, y: yI(v), width: bw, height: m.t + ih - yI(v),
      fill: '#E8EDEE', stroke: '#41B6E6', 'stroke-width': 1 }, svg);
  });
  let dstr = '';
  perf.forEach((v, i) => { dstr += (i ? 'L' : 'M') + x(i).toFixed(1) + ',' + yP(v).toFixed(1); });
  const path = svgEl('path', { d: dstr, fill: 'none', stroke: 'var(--accent)', 'stroke-width': 2.6,
    'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, svg);
  if (!REDUCED) {
    const len = path.getTotalLength();
    path.style.strokeDasharray = len; path.style.strokeDashoffset = len;
    new IntersectionObserver((es, io) => es.forEach(e => {
      if (!e.isIntersecting) return;
      path.style.transition = 'stroke-dashoffset 1.8s ease-out';
      path.style.strokeDashoffset = '0'; io.disconnect();
    }), { threshold: .4 }).observe(svg);
  }
  perf.forEach((v, i) => {
    const c = svgEl('circle', { cx: x(i), cy: yP(v), r: 3.4, fill: 'var(--accent)', class: 'season-dot' }, svg);
    c.addEventListener('pointerenter', ev => {
      c.setAttribute('r', 6);
      showTip(`<div class="t-date">${['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'][i]}</div>
        <div class="t-big num">${v}%</div> seen within 4h · busyness <b class="num">${idx[i]}</b> vs avg`,
        ev.clientX, ev.clientY);
    });
    c.addEventListener('pointerleave', () => { c.setAttribute('r', 3.4); hideTip(); });
  });
  // highlight annotations
  svgEl('text', { class: 'anno-strong', x: x(6), y: yI(105) - 8, 'text-anchor': 'middle', fill: 'var(--cool)' }, svg)
    .textContent = 'busiest';
  svgEl('text', { class: 'anno-strong', x: x(7), y: yP(78.9) - 12, 'text-anchor': 'middle', fill: 'var(--accent)' }, svg)
    .textContent = 'best care';
  svgEl('text', { class: 'anno-strong', x: x(0) + 14, y: yP(73.6) + 20, 'text-anchor': 'middle', fill: 'var(--hot)' }, svg)
    .textContent = 'worst care';
})();

/* ═══════════════════════════ SECTION · EXPLORE ═══════════════════════════ */
(function explorer() {
  const svg = document.getElementById('scatter-chart');
  if (!svg) return;
  const W = 1000, H = 460, m = { t: 30, r: 26, b: 52, l: 60 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const state = { kind: 'all' };

  const x = v => m.l + (Math.log10(Math.max(v, 300)) - Math.log10(300)) / (Math.log10(900000) - Math.log10(300)) * iw;
  const y = v => m.t + (1 - (v - 30) / 70) * ih;

  // static furniture
  for (let v = 40; v <= 100; v += 20) {
    svgEl('line', { class: 'gridline', x1: m.l, x2: W - m.r, y1: y(v), y2: y(v) }, svg);
    svgEl('text', { class: 'axis', x: m.l - 10, y: y(v) + 4, 'text-anchor': 'end' }, svg).textContent = v + '%';
  }
  [1000, 10000, 100000].forEach(v => {
    svgEl('line', { class: 'gridline', x1: x(v), x2: x(v), y1: m.t, y2: m.t + ih }, svg);
    svgEl('text', { class: 'axis', x: x(v), y: H - m.b + 20, 'text-anchor': 'middle' }, svg)
      .textContent = v >= 1000 ? (v/1000) + 'K' : v;
  });
  svgEl('text', { class: 'axis', x: m.l + iw / 2, y: H - 8, 'text-anchor': 'middle' }, svg)
    .textContent = '← quieter sites        attendances (log scale)        busier sites →';
  svgEl('text', { class: 'axis', x: m.l - 38, y: m.t + ih / 2, 'text-anchor': 'middle',
    transform: `rotate(-90 ${m.l - 38} ${m.t + ih / 2})` }, svg).textContent = '% seen within 4 hours';
  svgEl('line', { class: 'target-line', x1: m.l, x2: W - m.r, y1: y(95), y2: y(95) }, svg);
  svgEl('text', { class: 'target-label', x: W - m.r - 6, y: y(95) - 7, 'text-anchor': 'end' }, svg)
    .textContent = 'THE 95% PROMISE';

  const gDots = svgEl('g', {}, svg);
  const gLabels = svgEl('g', {}, svg);

  function compute() {
    // one row per provider, last 12 calendar months (pre-aggregated in AE_PROVIDERS)
    const rows = [];
    for (const p of P) {
      if (state.kind !== 'all' && p[2] !== state.kind) continue;
      rows.push({
        code: p[0], name: p[1], kind: p[2],
        att: p[3], perf: p[6] > 0 ? 100 * p[7] / p[6] : null, met: p[12], months: p[11]
      });
    }
    return rows;
  }

  function render() {
    gDots.innerHTML = ''; gLabels.innerHTML = '';
    const rows = compute();
    let totAtt = 0, met = 0, n = rows.length;
    rows.forEach(d => {
      totAtt += d.att; met += d.met;
      const r = d.kind === 'major' ? 4 + Math.sqrt(d.att) / 26 : 3 + Math.sqrt(d.att) / 34;
      const c = svgEl('circle', {
        cx: x(d.att), cy: d.perf == null ? m.t + ih * .5 : y(d.perf),
        r, fill: d.kind === 'major' ? 'var(--accent)' : 'var(--cool)',
        'fill-opacity': .55, stroke: d.kind === 'major' ? 'var(--accent)' : 'var(--cool)',
        'stroke-opacity': .9, 'stroke-width': 1, tabindex: '0',
        role: 'img', 'aria-label': `${d.name}: ${d.att.toLocaleString('en-GB')} attendances` +
          (d.perf == null ? '' : `, ${d.perf.toFixed(1)} percent within four hours`)
      }, gDots);
      c._d = d;
      c.classList.add('scatter-dot');
      const act = ev => {
        showTip(`<div class="t-date" style="color:${d.kind === 'major' ? 'var(--accent)' : 'var(--cool)'}">
            ${d.kind === 'major' ? 'BIG A&E HOSPITAL' : 'WALK-IN CENTRE'}</div>
          <div style="font-weight:650;line-height:1.3;margin-bottom:5px">${d.name}</div>
          <b class="num">${fmtFull(d.att)}</b> attended over the last 12 months<br>
          ${d.perf == null ? 'waits not published this period'
            : `<b class="num" style="font-size:16px">${d.perf.toFixed(1)}%</b> seen within 4 hours · met the 95% promise in <b class="num">${d.met}/${d.months}</b> months`}
          <div style="color:var(--dim);font-size:11px;margin-top:5px">code ${d.code}</div>`, ev.clientX, ev.clientY);
      };
      c.addEventListener('pointerenter', act);
      c.addEventListener('focus', act);
      c.addEventListener('pointerleave', hideTip);
      c.addEventListener('blur', hideTip);
    });
    // label the extremes (only when showing everyone)
    if (state.kind === 'all') {
      const sorted = [...rows].sort((a, b) => b.att - a.att);
      const busiest = sorted[0];
      const withPerf = rows.filter(r => r.perf != null);
      const best = [...withPerf].sort((a, b) => b.perf - a.perf)[0];
      const worst = [...withPerf].sort((a, b) => a.perf - b.perf)[0];
      [[busiest, 'busiest', 'middle', -12], [best, 'best in England', 'start', -12],
       [worst, 'toughest in England', 'end', 16]].forEach(([d, tag, anchor, dy]) => {
        if (!d) return;
        const t = svgEl('text', {
          x: x(d.att), y: y(d.perf == null ? 65 : d.perf) + dy, 'text-anchor': anchor, class: 'anno-strong'
        }, gLabels);
        t.textContent = tag;
      });
    }
    // roving focus: only the first dot is tabbable; arrows move between dots
    const dots = [...gDots.querySelectorAll('.scatter-dot')];
    dots.forEach((c2, i2) => c2.setAttribute('tabindex', i2 === 0 ? '0' : '-1'));
    svg.setAttribute('tabindex', '0');
    if (!svg.dataset.kbd) {
      svg.dataset.kbd = '1';
      svg.addEventListener('keydown', ev => {
        if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
        const cur = document.activeElement;
        const i2 = dots.indexOf(cur);
        if (i2 < 0) { dots[0].focus(); return; }
        ev.preventDefault();
        const n2 = dots[Math.max(0, Math.min(dots.length - 1, i2 + (ev.key === 'ArrowRight' ? 1 : -1)))];
        if (n2 !== cur) { cur.setAttribute('tabindex', '-1'); n2.setAttribute('tabindex', '0'); n2.focus(); }
      });
    }
    document.getElementById('ex-count').textContent =
      `Showing ${n} site${n === 1 ? '' : 's'} · ${fmtFull(totAtt)} attendances in view · ${fmtFull(met)} site-months met the 95% promise`;
    document.getElementById('ex-summary').innerHTML =
      `Right now you're looking at <b>${n} site${n === 1 ? '' : 's'}</b> over <b>the last 12 months</b>` +
      (state.kind === 'major' ? ' — <b>big A&amp;E hospitals only</b>. Notice how few sit above the gold line.' :
       state.kind === 'walkin' ? ' — <b>walk-in centres only</b>. Almost everything floats above the gold line.' :
       '. Most big hospitals (larger dots) sit <b>below the gold line</b>; walk-in centres (small dots) float above it.') +
      ` <span style="color:var(--dim)">Each dot is one site's whole recent year — hover for its story.</span>`;
  }

  document.querySelectorAll('.seg button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.seg button').forEach(b => b.setAttribute('aria-pressed', 'false'));
      btn.setAttribute('aria-pressed', 'true');
      state.kind = btn.dataset.kind;
      render();
    });
  });
  render();
})();

/* ═══════════════════════════ doors tab-cards ═══════════════════════════ */
(function doorTabs() {
  const details = {
    major: `<b>Type 1 departments carry almost two-thirds of all demand — and nearly all of the waiting problem.</b>
      In the last twelve months, only about <b class="num">61% of Type&nbsp;1 arrivals</b> met the 4-hour standard,
      while walk-in centres managed <b class="num">96.9%</b>.
      <span class="say">This may suggest the queue isn't really about minor injuries — it's concentrated at the big hospital front doors.</span>`,
    walkin: `<b>Walk-in and urgent-care centres are the quiet success story.</b> They handled
      <b class="num">88.6 million visits</b> over eleven years — a third of all demand — and in the last twelve months
      kept <b class="num">96.9%</b> within four hours. <span class="say">This may suggest that when care is walk-in by
      design, with no bed bottleneck behind it, the 4-hour promise survives.</span>`,
    other: `<b>Type 2 — single-speciality units like eye casualty — are a rounding error:</b> just
      <b class="num">2.2%</b> of all visits. They exist in the data, but they don't move the national story.
      <span class="say">The real contest is between Type 1 hospitals and Type 3 walk-in centres.</span>`
  };
  const box = document.getElementById('door-detail');
  document.querySelectorAll('.door').forEach(d => {
    d.addEventListener('click', () => {
      document.querySelectorAll('.door').forEach(x => { x.classList.remove('sel'); x.setAttribute('aria-selected', 'false'); });
      d.classList.add('sel'); d.setAttribute('aria-selected', 'true');
      box.style.opacity = 0;
      setTimeout(() => { box.innerHTML = details[d.dataset.door]; box.style.opacity = 1; }, REDUCED ? 0 : 160);
    });
  });
})();

/* ═══════════════════════════ inline glossary ═══════════════════════════ */
/* Dotted-underline terms open a plain-English tooltip on hover/tap/focus.
   Definitions reuse the site's own metric language — nothing invented.   */
(function glossary() {
  const TERMS = {
    trolley: 'A “trolley wait” is time spent in A&E after doctors have decided to admit someone to a ward, while they wait for a bed to become free.',
    breach: 'A breach is a visit that ended more than four hours after arrival — the 4-hour promise was missed for that visit.',
    type1: 'Type 1 departments are consultant-led A&Es — the classic hospital emergency department, distinct from walk-in/urgent-care centres.'
  };
  document.querySelectorAll('.gl[data-term]').forEach(el => {
    const term = TERMS[el.dataset.term];
    if (!term) return;
    el.setAttribute('aria-label', el.textContent.trim() + ' — what does this mean?');
    const act = () => {
      const r = el.getBoundingClientRect();
      showTip(`<div class="t-date">PLAIN ENGLISH</div>${term}`, r.left + r.width / 2, r.top);
    };
    el.addEventListener('pointerenter', act);
    el.addEventListener('focus', act);
    el.addEventListener('pointerleave', hideTip);
    el.addEventListener('blur', hideTip);
    el.addEventListener('click', ev => { ev.preventDefault(); act(); });
    el.addEventListener('keydown', ev => { if (ev.key === 'Escape') hideTip(); });
  });
})();

/* ═══════════════════════ chart data-table fallbacks ═══════════════════════
   Every major chart gains an optional real <table> built from the same
   arrays the SVG uses — screen-reader friendly and useful for everyone.   */
(function chartTables() {
  const fmtPct = v => v == null ? '' : v.toFixed(1) + '%';
  function table(headers, rows) {
    return '<table><thead><tr>' + headers.map(h => `<th scope="col">${h}</th>`).join('') +
      '</tr></thead><tbody>' + rows.map(r =>
        '<tr>' + r.map(c => `<td${typeof c === 'number' ? ' class="num"' : ''}>${c}</td>`).join('') + '</tr>'
      ).join('') + '</tbody></table>';
  }
  function attach(svgId, headers, rowsFn) {
    const svg = document.getElementById(svgId);
    if (!svg) return;
    const wrap = svg.closest('.chart-wrap') || svg.parentElement;
    const det = document.createElement('details');
    det.className = 'chart-table';
    det.innerHTML = '<summary>View the numbers behind this chart</summary><div class="ct-wrap"></div>';
    det.addEventListener('toggle', () => {           // build once, on first open
      if (!det.open || det.querySelector('table')) return;
      det.querySelector('.ct-wrap').innerHTML = table(headers(), rowsFn());
    });
    wrap.insertAdjacentElement('afterend', det);
  }
  attach('slide-chart',
    () => ['Month', '% seen within 4 hours', 'Providers reporting'],
    () => M.filter(r => r.pp != null && r.n >= 150 && r.pp <= 100)
           .map(r => [monthName(r.p), r.pp.toFixed(1) + '%', r.n])
      .concat((window.__aeIncompleteMonths || [])
        .map(g => [monthName(g), 'incomplete month — excluded from the line', ''])));
  attach('doors-chart',
    () => ['Month', 'All A&E', 'Consultant-led (Type 1)', 'Walk-in / urgent care'],
    () => M.slice(M.findIndex(r => r.p === '2017-04'))
      .filter(r => r.ac > 0 && r.n >= 150)
      .map(r => [monthName(r.p),
        fmtPct(100 * r.wc / r.ac),
        (r.x1 > 0 && r.y1 != null) ? fmtPct(100 * (r.x1 - r.y1) / r.x1) : '',
        (r.x3 > 0 && r.y3 != null) ? fmtPct(100 * (r.x3 - r.y3) / r.x3) : '']));
  attach('trolley-chart',
    () => ['Month', '12-hour trolley waits'],
    () => M.filter(r => r.p >= '2017-01' && r.d != null)
           .map(r => [monthName(r.p), (+r.d).toLocaleString('en-GB')])
      .concat((window.__aeIncompleteMonths || []).filter(g => g >= '2017-01')
        .map(g => [monthName(g), 'incomplete month — no figure'])));
  attach('season-chart',
    () => ['Calendar month', '% seen within 4 hours (11-year avg)', 'Busyness vs average'],
    () => {
      const MN2 = ['January','February','March','April','May','June','July','August','September','October','November','December'];
      const perf = [73.6, 74.0, 75.3, 77.8, 77.2, 77.7, 77.3, 78.9, 76.1, 76.6, 74.2, 74.3];
      const idx = [97, 92, 101, 94, 103, 102, 105, 100, 101, 104, 101, 100];
      return MN2.map((m2, i) => [m2, perf[i].toFixed(1) + '%', idx[i]]);
    });
})();

/* ═══════════════ best & worst 10 major trusts (static, accessible) ═════════ */
(function extremeTables() {
  const host = document.getElementById('extreme-tables');
  if (!host) return;
  const majors = P.filter(p => p[2] === 'major' && p[6] > 0)
    .map(p => ({ name: p[1], code: p[0],
      pct: Math.round(1000 * p[7] / p[6]) / 10,
      att: p[3] }))
    .sort((a2, b2) => b2.pct - a2.pct);
  if (majors.length < 20) return;
  const mk = (title, rows) =>
    `<h4>${title}</h4><table><caption class="sr-only">${title}, by share seen within four hours over the last 12 reported months</caption>
     <thead><tr><th scope="col">#</th><th scope="col">Trust</th><th scope="col">% within 4h</th></tr></thead>
     <tbody>${rows.map((r, i) =>
       `<tr><td class="num">${i + 1}</td><td>${r.name}</td><td class="num">${r.pct.toFixed(1)}%</td></tr>`).join('')}</tbody></table>`;
  host.innerHTML =
    `<div class="viz-head" style="margin-top:26px"><div class="legend"><span class="li">Same numbers, no hovering —
     the ten strongest and ten weakest major A&amp;E trusts over the last 12 reported months.</span></div></div>
     <div class="extreme-grid">${mk('10 best performing major trusts', majors.slice(0, 10))}
     ${mk('10 worst performing major trusts', majors.slice(-10).reverse())}</div>`;
})();

/* ═══════════════════════ dataset download (OGL v3) ═══════════════════════ */
/* Client-side exports straight from the page's own warehouse exports —
   no pipeline changes. Licence text travels inside every file.            */
(function datasetExport() {
  const OGL = '# Source: NHS England monthly "A&E Attendances and Emergency Admissions"\n' +
    '# statistics — cleaned monthly reports (one row per site per month).\n' +
    '# Contains public sector information licensed under the Open Government Licence v3:\n' +
    '#   https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/\n';
  function dl(name, text, mime) {
    const b = new Blob([text], { type: mime });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 400);
  }
  const btn = id => document.getElementById(id);
  const nCsv = () => {
    let [y0, m0] = M[0].p.split('-').map(Number);
    const end = M[M.length - 1].p;
    const have = new Map(M.map(r => [r.p, r]));
    const rows = [];
    while (true) {
      const p = y0 + '-' + String(m0).padStart(2, '0');
      if (p > end) break;
      const r = have.get(p);
      if (r) rows.push([p, r.a ?? '', r.am ?? '', r.d ?? '', r.n ?? '', r.ac ?? '', r.wc ?? '', r.pp ?? ''].join(','));
      else rows.push(p);
      m0++; if (m0 > 12) { m0 = 1; y0++; }
    } // missing months are exported as bare period markers, never zeros
    return OGL + '# Missing periods are listed as bare dates — they are gaps in our copy, not zeros.\n' +
      'period,attendances,emergency_admissions,twelve_hour_trolley_waits,providers_reporting,' +
      'covered_attendances,within_4h,published_within_4h_pct\n' + rows.join('\n');
  };
  const pCsv = () => OGL + '# Rolling last-12-reported-months roll-up per reporting site.\n' +
    'org_code,org_name,site_type,attendances,type1_attendance,type3_attendance,' +
    'covered_attendances,within_4h,breaches,emergency_admissions,trolley_waits_12h,reported_months,months_met_95pct\n' +
    P.map(p => [p[0], '"' + p[1].replace(/"/g, '""') + '"', p[2],
      ...p.slice(3)].join(',')).join('\n');
  const jAll = () => JSON.stringify({
    license: 'Contains public sector information licensed under the Open Government Licence v3',
    source: 'NHS England monthly A&E statistics — cleaned monthly reports (fct_ae_activity)',
    generated: new Date().toISOString().slice(0, 10),
    window: { first: M.length ? M[0].p : null, last: M.length ? M[M.length - 1].p : null },
    national_monthly: M,
    providers_last_12_months: C0(),
    trust_history: window.AE_TRUST_HIST ? { months: window.AE_TRUST_MONTHS, packed: window.AE_TRUST_HIST } : null,
    packing: { row: '[att/10, waitsPublished(0/1), within4/10, t1Att/1000, t1Breaches/1000, admissions/1000, trolley12h/1000]' }
  });
  function C0() { return (window.AE_PROVIDERS || []).map((p, i) => ({ code: p[0], name: p[1], kind: p[2], att: p[3], attT1: p[4], attT3: p[5], covered: p[6], within4: p[7], breaches: p[8], admissions: p[9], trolley12h: p[10], months: p[11], met95: p[12], _i: i })).map(o => { delete o._i; return o; }); }
  [['dl-nat-csv', () => dl('nhs-ae-national-monthly.csv', nCsv(), 'text/csv;charset=utf-8')],
   ['dl-prov-csv', () => dl('nhs-ae-providers-last12.csv', pCsv(), 'text/csv;charset=utf-8')],
   ['dl-json', () => dl('nhs-ae-cleaned-dataset.json', jAll(), 'application/json')]
  ].forEach(([id, fn]) => {
    const b = btn(id);
    if (b) b.addEventListener('click', () => { try { fn(); } catch (e) { console.error(e); } });
  });
})();

})();
