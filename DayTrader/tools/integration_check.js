#!/usr/bin/env node
/**
 * End-to-end integration check for the Day Trader sim.
 *
 * Loads the REAL data/days.js + sim/engine.js + sim/chart.js + sim/desk.js into
 * a shimmed browser-ish global, then drives a full 390-bar session through the
 * engine while rendering the chart every bar and ticking the desk.
 *
 * The headline test is the lookahead audit: day.bars is wrapped in a Proxy that
 * records every index read during Chart.render({upto:k}). If the chart ever
 * touches a bar with index > k, the player could infer the future from the price
 * axis, and the entire exercise is worthless. That is a hard failure.
 *
 * Run:  node tools/integration_check.js
 */

'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let failures = 0;
let checks = 0;

function ok(cond, label, detail) {
  checks++;
  if (cond) { console.log('  PASS  ' + label); }
  else { failures++; console.log('  FAIL  ' + label + (detail ? '\n          ' + detail : '')); }
}
function section(s) { console.log('\n' + s + '\n' + '-'.repeat(s.length)); }

// ---------------------------------------------------------------- browser shim
function makeCanvasCtx(record) {
  const noop = () => {};
  const ctx = new Proxy({}, {
    get(t, k) {
      if (k === 'canvas') return { width: 1200, height: 700, clientWidth: 1200, clientHeight: 700 };
      if (k === 'measureText') return () => ({ width: 30 });
      if (k === 'createLinearGradient') return () => ({ addColorStop: noop });
      if (k === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
      if (typeof k === 'string' && k.startsWith('__')) return undefined;
      if (k in t) return t[k];
      return noop;                       // every draw call is a no-op
    },
    set(t, k, v) { t[k] = v; return true; }
  });
  return ctx;
}

function makeCanvasEl(record) {
  return {
    width: 1200, height: 700, clientWidth: 1200, clientHeight: 700,
    style: {},
    getContext: () => makeCanvasCtx(record),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1200, height: 700 }),
    addEventListener: () => {}, removeEventListener: () => {},
    parentElement: { clientWidth: 1200, clientHeight: 700 }
  };
}

const store = {};
const sandbox = {
  console,
  setTimeout, clearTimeout, setInterval, clearInterval,
  Math, Date, JSON, Object, Array, String, Number, Boolean, Error, isNaN, parseFloat, parseInt,
  Proxy, Reflect, Map, Set, Symbol, Promise,
  localStorage: {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
    clear: () => { for (const k in store) delete store[k]; }
  },
  devicePixelRatio: 2,
  requestAnimationFrame: fn => setTimeout(() => fn(Date.now()), 0),
  cancelAnimationFrame: clearTimeout,
  document: {
    createElement: tag => (tag === 'canvas' ? makeCanvasEl() : { style: {}, addEventListener: () => {} }),
    addEventListener: () => {},
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => []
  },
  navigator: { clipboard: null, userAgent: 'node' }
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

function loadFile(rel, required) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) {
    if (required) { console.log('  MISSING FILE: ' + rel + '  (agent may still be running)'); failures++; }
    return false;
  }
  try {
    vm.runInContext(fs.readFileSync(p, 'utf8'), sandbox, { filename: rel });
    return true;
  } catch (e) {
    failures++;
    console.log('  LOAD ERROR in ' + rel + ': ' + e.message + '\n' + (e.stack || '').split('\n').slice(1, 4).join('\n'));
    return false;
  }
}

// ------------------------------------------------------------------- load all
section('Loading modules');
const gotData   = loadFile('data/days.js', true);
const gotEngine = loadFile('sim/engine.js', true);
const gotChart  = loadFile('sim/chart.js', true);
const gotDesk   = loadFile('sim/desk.js', true);
ok(gotData && !!sandbox.SIM_DAYS, 'data/days.js exposes window.SIM_DAYS');
ok(gotEngine && !!sandbox.Engine, 'sim/engine.js exposes window.Engine');
ok(gotChart && !!sandbox.Chart, 'sim/chart.js exposes window.Chart');
ok(gotDesk && !!sandbox.Desk, 'sim/desk.js exposes window.Desk');

if (failures) {
  console.log('\nAborting: modules did not load. ' + failures + ' failure(s).');
  process.exit(1);
}

const SIM_DAYS = sandbox.SIM_DAYS;
const Engine = sandbox.Engine, Chart = sandbox.Chart, Desk = sandbox.Desk;

// -------------------------------------------------------------- data sanity
section('Data integrity');
ok(SIM_DAYS.length === 3, 'three sessions present');
SIM_DAYS.forEach(d => {
  const rth = d.bars.filter(b => b.rth);
  ok(rth.length >= 385 && rth.length <= 391, `${d.ticker}: ${rth.length} RTH bars`);
  let mono = true, badOHLC = 0;
  for (let i = 1; i < d.bars.length; i++) if (d.bars[i].m <= d.bars[i - 1].m) mono = false;
  d.bars.forEach(b => {
    if (!(b.h >= b.o && b.h >= b.c && b.h >= b.l && b.l <= b.o && b.l <= b.c)) badOHLC++;
    if (![b.o, b.h, b.l, b.c].every(x => typeof x === 'number' && isFinite(x) && x > 0)) badOHLC++;
  });
  ok(mono, `${d.ticker}: bar minutes strictly increasing`);
  ok(badOHLC === 0, `${d.ticker}: OHLC self-consistent`, badOHLC + ' bad bars');
  ok(d.events.every(e => ['PM', 'RISK', 'DESK', 'WIRE'].includes(e.from)), `${d.ticker}: event voices valid`);
  ok(d.brief && d.brief.levels && d.brief.levels.length >= 3, `${d.ticker}: briefing has key levels`);
});

// ------------------------------------------------------- lookahead audit
section('Lookahead audit (the one that actually matters)');
{
  const day = SIM_DAYS[0];
  const raw = day.bars;
  let maxIdxRead = -1;
  const watched = new Proxy(raw, {
    get(t, k) {
      if (typeof k === 'string' && /^\d+$/.test(k)) {
        const i = +k;
        if (i > maxIdxRead) maxIdxRead = i;
      }
      return t[k];
    }
  });

  const chart = Chart.create(makeCanvasEl(), { theme: 'dark' });
  let violations = [];
  for (const upto of [0, 1, 5, 90, 200, 300, raw.length - 1]) {
    maxIdxRead = -1;
    try {
      chart.render({
        bars: watched, upto, window: 120,
        overlays: ['vwap', 'ema9', 'ema20'],
        levels: day.brief.levels.map(l => ({ px: l.px, label: l.label, color: '#666' })),
        markers: [], position: { shares: 0, avgPx: 0 }
      });
    } catch (e) {
      violations.push(`render(upto=${upto}) threw: ${e.message}`);
      continue;
    }
    if (maxIdxRead > upto) violations.push(`render(upto=${upto}) read bar index ${maxIdxRead}`);
  }
  ok(violations.length === 0, 'Chart never reads a bar beyond `upto`', violations.join('\n          '));
}

// ------------------------------------------------- full session end-to-end
section('Full session end-to-end (day 1, 390 bars)');
{
  const day = SIM_DAYS[0];
  sandbox.localStorage.clear();

  let deskMsgs = [];
  let riskEvents = [];
  let closeSummary = null;

  Engine.init({ day, account: null });
  Engine.on('risk', e => riskEvents.push(e));
  Engine.on('close', s => { closeSummary = s; });

  Desk.init({ day, engine: Engine, onMessage: m => deskMsgs.push(m) });

  const chart = Chart.create(makeCanvasEl(), { theme: 'dark' });

  const st0 = Engine.getState();
  ok(st0.equity === 25000, 'fresh account starts at $25,000', 'got ' + st0.equity);
  ok(Math.abs(st0.buyingPower - 100000) < 1, 'buying power is 4x equity', 'got ' + st0.buyingPower);

  // thesis requirement
  const noThesis = Engine.submit({ side: 'BUY', qty: 100, type: 'MKT' });
  ok(noThesis && noThesis.ok === false, 'order without thesis is rejected', JSON.stringify(noThesis));

  // buying power enforcement
  const huge = Engine.submit({ side: 'BUY', qty: 100000, type: 'MKT', thesis: 'testing the buying power limit' });
  ok(huge && huge.ok === false, 'oversized order is rejected', JSON.stringify(huge));

  // drive the whole session
  let steps = 0, renderErrors = 0, stepErrors = 0, boughtAt = null, soldAt = null;
  let pnlSamples = [];
  while (steps < 600) {
    let st;
    try { st = Engine.getState(); } catch (e) { stepErrors++; break; }
    if (st.m > day.closeM) break;

    // buy a little after the open, sell mid-session — exercises the accounting
    if (st.m === 580 && st.position.shares === 0) {
      const r = Engine.submit({ side: 'BUY', qty: 200, type: 'MKT', thesis: 'gap and go, holding above VWAP, out below 189' });
      if (r && r.ok) boughtAt = st.m;
    }
    if (st.m === 700 && st.position.shares > 0) {
      const r = Engine.submit({ side: 'SELL', qty: 200, type: 'MKT', thesis: 'taking it off' });
      if (r && r.ok) soldAt = st.m;
    }
    // and a short later, to exercise the other side
    if (st.m === 800 && st.position.shares === 0) {
      Engine.submit({ side: 'SELL', qty: 100, type: 'MKT', thesis: 'fading into the close, stop above the high' });
    }

    try {
      chart.render({
        bars: day.bars, upto: st.idx, window: 120,
        overlays: ['vwap', 'ema9', 'ema20'],
        levels: day.brief.levels.map(l => ({ px: l.px, label: l.label, color: '#666' })),
        markers: st.blotter.map(f => ({ m: f.m, px: f.px, side: f.side, qty: f.qty })),
        position: st.position
      });
    } catch (e) { renderErrors++; if (renderErrors === 1) console.log('        first render error: ' + e.message); }

    try { Desk.tick(st); } catch (e) { if (!stepErrors) console.log('        desk error: ' + e.message); stepErrors++; }

    if (st.m % 15 === 0) pnlSamples.push([st.t, st.dayPnl]);

    try { Engine.step(); } catch (e) { stepErrors++; if (stepErrors < 3) console.log('        step error: ' + e.message); break; }
    steps++;
  }

  ok(stepErrors === 0, 'session advanced without throwing', stepErrors + ' errors');
  ok(renderErrors === 0, 'chart rendered every bar without throwing', renderErrors + ' errors');
  ok(steps > 380, 'advanced through the full session', 'steps=' + steps);

  const st = Engine.getState();
  ok(boughtAt !== null && soldAt !== null, 'round trip executed');
  ok(st.blotter.length >= 3, 'blotter recorded the fills', 'n=' + st.blotter.length);
  ok(st.trades.length >= 1, 'closed trades recorded', 'n=' + st.trades.length);
  ok(st.position.shares === 0, 'flat at the end of the session', 'shares=' + st.position.shares);
  ok(st.commissions > 0, 'commissions were charged', 'c=' + st.commissions);

  // P&L arithmetic must tie out against the blotter
  let cash = 0, sh = 0;
  st.blotter.forEach(f => {
    const sign = f.side === 'BUY' ? 1 : -1;
    sh += sign * f.qty;
    cash -= sign * f.qty * f.px;
    cash -= f.commission;
  });
  ok(sh === 0, 'blotter nets to flat', 'net shares ' + sh);
  ok(Math.abs(cash - st.realized) < 0.02,
     'realized P&L ties to the blotter', `blotter ${cash.toFixed(2)} vs engine ${st.realized.toFixed(2)}`);
  ok(Math.abs(st.equity - (25000 + st.dayPnl)) < 0.02, 'equity = start + dayPnl');

  // desk actually said things
  const voices = new Set(deskMsgs.map(m => m.from));
  ok(deskMsgs.length >= 8, 'desk produced a real feed', 'n=' + deskMsgs.length);
  ok(voices.has('WIRE'), 'news wire fired');
  ok(voices.has('PM') || voices.has('RISK'), 'PM or risk spoke');
  const perBar = {};
  deskMsgs.forEach(m => { perBar[m.m] = (perBar[m.m] || 0) + 1; });

  // review export
  let review = '';
  try { review = Engine.exportReview(); } catch (e) { review = ''; }
  ok(typeof review === 'string' && review.length > 300, 'exportReview() produced a tearsheet',
     'len=' + (review || '').length);
  ok(/thes[ie]s/i.test(review), 'tearsheet includes the typed thesis');
  ok(/Equity curve/i.test(review), 'tearsheet includes the equity curve');
  ok(/Risk events/i.test(review), 'tearsheet includes risk events');

  console.log('\n  --- session result ---');
  console.log('  trades: ' + st.trades.length + '  fills: ' + st.blotter.length +
              '  dayPnl: $' + st.dayPnl.toFixed(2) + '  equity: $' + st.equity.toFixed(2));
  console.log('  desk messages: ' + deskMsgs.length);
  console.log('\n  --- first 12 desk messages ---');
  deskMsgs.slice(0, 12).forEach(m => {
    console.log('  ' + m.t + '  ' + String(m.from).padEnd(5) + ' ' + String(m.text).slice(0, 96));
  });
}

// -------------------------------------------------- risk limit + persistence
section('Risk limit and account carry-over');
{
  const day = SIM_DAYS[2];   // CYNT: trends down all day, so a big long will bleed
  sandbox.localStorage.clear();
  Engine.init({ day, account: null });
  let hardRisk = null;
  Engine.on('risk', e => { if (e.level === 'hard') hardRisk = e; });

  let steps = 0;
  while (steps < 600) {
    const st = Engine.getState();
    if (st.m > day.closeM) break;
    if (st.m === 575 && st.position.shares === 0 && !st.locked) {
      Engine.submit({ side: 'BUY', qty: 600, type: 'MKT', thesis: 'buying the partnership headline, deliberately oversized for the test' });
    }
    Engine.step(); steps++;
  }
  const st = Engine.getState();
  ok(hardRisk !== null, 'hard risk limit tripped on a losing oversized position');
  ok(st.locked === true, 'book is locked after the risk stop');
  ok(st.position.shares === 0, 'risk flattened the position');
  const after = Engine.submit({ side: 'BUY', qty: 100, type: 'MKT', thesis: 'trying to trade after being locked out' });
  ok(after && after.ok === false, 'no orders accepted once locked');
  console.log('  dayPnl at lock: $' + st.dayPnl.toFixed(2));

  // persistence
  try {
    Engine.saveAccount(st);
    const acct = Engine.loadAccount();
    ok(acct && typeof acct.equity === 'number', 'account persisted and reloaded',
       JSON.stringify(acct && { equity: acct.equity, n: (acct.sessions || []).length }));
    ok(acct.equity < 25000, 'equity carried the loss forward', 'equity=' + (acct && acct.equity));
  } catch (e) {
    ok(false, 'account persistence works', e.message);
  }
}

// ------------------------------------------------------------------- verdict
section('Verdict');
console.log(`  ${checks - failures}/${checks} checks passed`);
if (failures) { console.log('  ' + failures + ' FAILURE(S)'); process.exit(1); }
console.log('  integration OK');
