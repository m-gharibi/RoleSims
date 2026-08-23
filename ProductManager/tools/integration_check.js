#!/usr/bin/env node
/**
 * End-to-end integration check for the Product Manager sim.
 *
 * The two load-bearing checks:
 *
 *  1. TRUTH LEAK AUDIT. window.SIM_CO.reveal() is wrapped so every call records
 *     the calling sim/ module. ONLY sim/product.js may call it, and nothing may
 *     call it before the QBR is submitted. If org.js could see the truth, the
 *     stakeholders would secretly know the right answer and the entire exercise
 *     would collapse.
 *
 *  2. BIAS DIRECTION. The whole design rests on cheap loud instruments
 *     inverting the true ranking while slow revealed-preference instruments
 *     recover it. This harness measures that empirically, through the real
 *     engine, over many seeds — not from the build script's own arithmetic.
 *
 * Run:  node tools/integration_check.js
 */

'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let failures = 0, checks = 0;
const ok = (c, label, detail) => {
  checks++;
  if (c) console.log('  PASS  ' + label);
  else { failures++; console.log('  FAIL  ' + label + (detail ? '\n          ' + detail : '')); }
};
const section = s => console.log('\n' + s + '\n' + '-'.repeat(s.length));

function makeCtx() {
  const noop = () => {};
  return new Proxy({}, {
    get(t, k) {
      if (k === 'canvas') return { width: 1200, height: 700 };
      if (k === 'measureText') return () => ({ width: 30 });
      if (k === 'createLinearGradient') return () => ({ addColorStop: noop });
      if (k in t) return t[k];
      return noop;
    },
    set(t, k, v) { t[k] = v; return true; }
  });
}
const makeCanvas = () => ({
  width: 1200, height: 700, clientWidth: 1200, clientHeight: 700, style: {},
  getContext: makeCtx,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 1200, height: 700 }),
  addEventListener: () => {}, removeEventListener: () => {},
  parentElement: { clientWidth: 1200, clientHeight: 700 }
});

function makeSandbox() {
  const store = {};
  const sb = {
    console, setTimeout, clearTimeout, setInterval, clearInterval,
    Math, Date, JSON, Object, Array, String, Number, Boolean, Error, isNaN,
    parseFloat, parseInt, Proxy, Reflect, Map, Set, Symbol, Promise, Buffer,
    atob: s => Buffer.from(s, 'base64').toString('utf8'),
    btoa: s => Buffer.from(s, 'utf8').toString('base64'),
    devicePixelRatio: 2,
    requestAnimationFrame: fn => setTimeout(() => fn(1), 0), cancelAnimationFrame: clearTimeout,
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); },
                    removeItem: k => { delete store[k]; }, clear: () => {} },
    document: { createElement: t => (t === 'canvas' ? makeCanvas() : { style: {}, addEventListener: () => {} }),
                addEventListener: () => {}, getElementById: () => null,
                querySelector: () => null, querySelectorAll: () => [] },
    navigator: { userAgent: 'node' }
  };
  sb.window = sb; sb.globalThis = sb;
  vm.createContext(sb);
  return sb;
}

function loadInto(sb, rel, required) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) { if (required) { console.log('  MISSING FILE: ' + rel); failures++; } return false; }
  try { vm.runInContext(fs.readFileSync(p, 'utf8'), sb, { filename: rel }); return true; }
  catch (e) {
    failures++;
    console.log('  LOAD ERROR ' + rel + ': ' + e.message);
    console.log('    ' + (e.stack || '').split('\n').slice(1, 3).join('\n    '));
    return false;
  }
}

section('Loading modules');
const sb = makeSandbox();
loadInto(sb, 'data/company.js', true);
loadInto(sb, 'sim/product.js', true);
loadInto(sb, 'sim/viz.js', true);
loadInto(sb, 'sim/org.js', true);
ok(!!sb.SIM_CO, 'data/company.js exposes window.SIM_CO');
ok(!!sb.Product, 'sim/product.js exposes window.Product');
ok(!!sb.Viz, 'sim/viz.js exposes window.Viz');
ok(!!sb.Org, 'sim/org.js exposes window.Org');
if (failures) { console.log('\nAborting: modules did not load.'); process.exit(1); }

section('Company integrity');
{
  const C = sb.SIM_CO;
  ok(C.features.length === 10, 'ten features', 'n=' + C.features.length);
  ok(C.instruments.length === 7, 'seven instruments', 'n=' + C.instruments.length);
  ok(C.stakeholders.length === 5, 'five stakeholders');
  ok(C.instruments.every(i => i.knownCaveat && i.knownCaveat.length > 30),
     'every instrument states its blind spot up front');
  const raw = fs.readFileSync(path.join(ROOT, 'data/company.js'), 'utf8');
  ok(!/"impact"\s*:\s*\{/.test(raw), 'truth is encoded, not plaintext in the file');
  const T = C.reveal();
  ok(Object.keys(T.impact).length === 10, 'reveal() decodes the truth');
  ok(T.bestSet.length && T.bestSet.every(id => C.features.some(f => f.id === id)),
     'truth carries a legal best set', JSON.stringify(T.bestSet));
  const est = C.features.reduce((a, f) => a + f.estCost, 0);
  const real = Object.values(T.trueCost).reduce((a, b) => a + b, 0);
  ok(real > est * 1.5, 'estimates are systematically optimistic',
     `estimates ${est} vs true ${real} (${(real / est).toFixed(2)}x)`);
  // The trap is NOT that the board looks affordable — by estimate it is already
  // 137% of capacity. The trap is the SIZE of the cut: planning by estimates
  // says "cut a third", planning by reality says "cut nearly two thirds".
  const cap = C.scenario.capacity.total;
  const cutByEstimate = 1 - cap / est;
  const cutByTruth = 1 - cap / real;
  ok(cutByTruth > cutByEstimate + 0.2,
     'estimates badly understate how much must be cut',
     `by estimate cut ${(cutByEstimate * 100).toFixed(0)}%, in reality cut ${(cutByTruth * 100).toFixed(0)}%`);
  C.__truth = null;
}

section('Truth leak audit (the one that actually matters)');
{
  const s = makeSandbox();
  loadInto(s, 'data/company.js', true);
  const C = s.SIM_CO;
  const calls = [];
  let qbrDone = false;
  const orig = C.reveal.bind(C);
  C.reveal = function () {
    const stack = new Error().stack || '';
    const line = stack.split('\n').slice(1)
      .filter(l => !/integration_check\.js/.test(l))
      .find(l => /\bsim\/[\w.]+\.js/.test(l)) || 'unknown';
    calls.push({ file: (line.match(/\bsim\/[\w.]+\.js/) || ['unknown'])[0], qbrDone });
    return orig();
  };
  loadInto(s, 'sim/product.js', true);
  loadInto(s, 'sim/viz.js', true);
  loadInto(s, 'sim/org.js', true);
  const P = s.Product, O = s.Org, V = s.Viz;
  if (P && P.submitQBR) {
    const f = P.submitQBR.bind(P);
    P.submitQBR = function () { qbrDone = true; return f.apply(null, arguments); };
  }

  P.init({ co: C, seed: 20260816 });
  O.init({ co: C, product: P, onMessage: () => {} });
  const v = V.create(makeCanvas(), { theme: 'dark' });

  const ids = C.features.map(f => f.id);
  let day = 0, committed = 0, researched = 0;
  while (day < 200) {
    const st = P.getState();
    if (st.finished) break;
    if (researched < 6) {
      const r = P.research({ featureId: ids[researched % ids.length], instrumentId: 'interviews' });
      if (r && r.ok) researched++;
    }
    if (committed < 3) {
      const r = P.commit({ featureId: ids[committed], predictedImpact: 2.0,
                           rationale: 'integration harness commit rationale, long enough to pass' });
      if (r && r.ok) committed++;
    }
    try {
      v.evidence({ rows: [] }); v.gantt({ roadmap: st.roadmap, week: st.week, totalWeeks: 12 });
      v.trust({ stakeholders: [] }); v.impact({ baseline: 31.4, shipped: [], projected: st.northStarProjected });
    } catch (e) {}
    try { O.tick(st); } catch (e) {}
    P.step(); day++;
  }

  const nonProduct = calls.filter(c => !/sim\/product\.js/.test(c.file));
  ok(calls.length > 0, 'product.js consulted the truth to generate readings');
  ok(nonProduct.length === 0, 'ONLY product.js ever calls reveal()',
     'offenders: ' + JSON.stringify([...new Set(nonProduct.map(c => c.file))]));
  const pre = calls.filter(c => !c.qbrDone && !/sim\/product\.js/.test(c.file));
  ok(pre.length === 0, 'nothing reads the truth before the QBR is submitted');
  // Static backstop for the runtime audit above. Comments must be stripped
  // first — org.js documents that it never reads truth, and those very comments
  // would otherwise trip the check.
  const strip = src => src
    .replace(/\/\*[\s\S]*?\*\//g, '')          // block comments
    .replace(/(^|[^:])\/\/.*$/gm, '$1');       // line comments (leave "http://" alone)
  const orgCode = strip(fs.readFileSync(path.join(ROOT, 'sim/org.js'), 'utf8'));
  const hits = ['reveal\\s*\\(', '\\._t\\b', 'atob\\s*\\(', 'trueCost', 'bestSet']
    .filter(p => new RegExp(p).test(orgCode));
  ok(hits.length === 0, 'org.js source contains no path to the ground truth', 'matched: ' + hits.join(', '));
}

section('Bias direction — measured through the real engine');
{
  // For each instrument, average its reading per feature over many seeds and
  // check which feature it ranks first. The design requires that the loud cheap
  // channels get this WRONG and the revealed-preference ones get it RIGHT.
  const s0 = makeSandbox();
  loadInto(s0, 'data/company.js', true);
  const T = s0.SIM_CO.reveal();
  const trueBest = Object.keys(T.impact).reduce((a, b) => (T.impact[a] > T.impact[b] ? a : b));
  ok(trueBest === 'onboarding_checklist', 'the true best feature is the onboarding checklist', trueBest);

  function meanReadings(instrument, trials) {
    const totals = {}, counts = {};
    for (let t = 0; t < trials; t++) {
      const s = makeSandbox();
      loadInto(s, 'data/company.js', true);
      loadInto(s, 'sim/product.js', true);
      const C = s.SIM_CO, P = s.Product;
      P.init({ co: C, seed: 3000 + t });
      const fid = C.features[t % C.features.length].id;
      // ship-gated instruments can't be probed this way
      const r = P.research({ featureId: fid, instrumentId: instrument });
      if (!r || !r.ok) continue;
      for (let d = 0; d < 40; d++) P.step();
      const done = P.getState().research.done || [];
      done.forEach(x => {
        const id = x.featureId || x.feature;
        const val = (x.value !== undefined) ? x.value : x.reading;
        if (id && typeof val === 'number') {
          totals[id] = (totals[id] || 0) + val; counts[id] = (counts[id] || 0) + 1;
        }
      });
    }
    const out = {};
    Object.keys(totals).forEach(k => { out[k] = totals[k] / counts[k]; });
    return out;
  }

  const loudOK = [], quietOK = [];
  ['sales_anecdote', 'support_tickets'].forEach(inst => {
    const m = meanReadings(inst, 60);
    const keys = Object.keys(m);
    if (!keys.length) { loudOK.push(inst + ':no-data'); return; }
    const top = keys.reduce((a, b) => (m[a] > m[b] ? a : b));
    if (top === trueBest) loudOK.push(inst + ' found the winner (it should NOT)');
  });
  ok(loudOK.length === 0, 'the loud cheap channels do NOT surface the real winner', loudOK.join('; '));

  ['interviews', 'fake_door'].forEach(inst => {
    const m = meanReadings(inst, 60);
    const keys = Object.keys(m);
    if (!keys.length) { quietOK.push(inst + ':no-data'); return; }
    const top = keys.reduce((a, b) => (m[a] > m[b] ? a : b));
    if (top !== trueBest) quietOK.push(`${inst} ranked ${top} first, expected ${trueBest}`);
  });
  ok(quietOK.length === 0, 'revealed-preference instruments DO recover the real winner', quietOK.join('; '));
}

section('Determinism and the capacity trap');
{
  function run(seed) {
    const s = makeSandbox();
    loadInto(s, 'data/company.js', true);
    loadInto(s, 'sim/product.js', true);
    loadInto(s, 'sim/org.js', true);
    const C = s.SIM_CO, P = s.Product, O = s.Org;
    const feed = [];
    P.init({ co: C, seed });
    O.init({ co: C, product: P, onMessage: m => feed.push(m.t + '|' + m.from + '|' + m.text) });
    ['onboarding_checklist', 'template_gallery', 'perf_p95_latency'].forEach(id =>
      P.commit({ featureId: id, predictedImpact: 2, rationale: 'deterministic run for the integration harness' }));
    P.research({ featureId: 'onboarding_checklist', instrumentId: 'interviews' });
    let d = 0; while (d < 200 && !P.getState().finished) { O.tick(P.getState()); P.step(); d++; }
    const st = P.getState();
    return { shipped: (st.shipped || []).slice().sort().join(','), feed, cap: st.capacityUsed };
  }
  const a = run(20260816), b = run(20260816), c = run(77);
  ok(a.shipped === b.shipped && JSON.stringify(a.feed) === JSON.stringify(b.feed),
     'same seed replays identically');
  ok(a.feed.length > 5, 'the org actually spoke during the quarter', 'n=' + a.feed.length);

  // the three "obvious" features cost far more than their estimates suggest
  const s = makeSandbox(); loadInto(s, 'data/company.js', true);
  const C = s.SIM_CO, T = C.reveal();
  const trio = ['onboarding_checklist', 'template_gallery', 'perf_p95_latency'];
  const estSum = trio.reduce((x, id) => x + C.features.find(f => f.id === id).estCost, 0);
  const realSum = trio.reduce((x, id) => x + T.trueCost[id], 0);
  ok(realSum > estSum * 1.4, 'the headline trio costs far more than estimated',
     `est ${estSum} vs real ${realSum} eng-weeks`);
}

section('Scoring');
{
  function scoreOf(set, opts) {
    const s = makeSandbox();
    loadInto(s, 'data/company.js', true); loadInto(s, 'sim/product.js', true);
    const P = s.Product, C = s.SIM_CO;
    P.init({ co: C, seed: 11 });
    set.forEach(id => P.commit({ featureId: id, predictedImpact: 2,
                                 rationale: 'scoring fixture rationale, sufficiently long' }));
    let d = 0; while (d < 200 && !P.getState().finished) P.step(), d++;
    return P.submitQBR({ narrative: 'integration scoring fixture narrative', claimedImpact: 5 });
  }
  const T = sb.SIM_CO.reveal();
  const best = scoreOf(T.bestSet);
  ok(best && typeof best.regret === 'number', 'submitQBR returns a score', JSON.stringify(best && best.grade));
  ok(best.regret < 0.5, 'shipping the optimum yields near-zero regret', 'regret=' + best.regret);
  ok(best.grade === 'A', 'the optimum grades A', best.grade);

  const vanity = scoreOf(['dashboard_themes', 'admin_audit_log', 'sso_scim']);
  ok(vanity.vanityShipped && vanity.vanityShipped.length >= 2, 'vanity features are identified',
     JSON.stringify(vanity.vanityShipped));
  ok(['C', 'D', 'F'].includes(vanity.grade), 'shipping vanity caps the grade at C', vanity.grade);

  const md = (() => {
    const s = makeSandbox();
    loadInto(s, 'data/company.js', true); loadInto(s, 'sim/product.js', true);
    const P = s.Product;
    P.init({ co: s.SIM_CO, seed: 3 });
    P.commit({ featureId: 'onboarding_checklist', predictedImpact: 3.5, rationale: 'interviews were unambiguous here' });
    let d = 0; while (d < 200 && !P.getState().finished) P.step(), d++;
    P.submitQBR({ narrative: 'shipped the checklist', claimedImpact: 4 });
    return P.exportQBR();
  })();
  ok(typeof md === 'string' && md.length > 300, 'exportQBR produces markdown', 'len=' + (md || '').length);
  ok(!/trueCost|"impact"|gamma/.test(md), 'QBR does not leak ground truth');
}

section('Verdict');
console.log(`  ${checks - failures}/${checks} checks passed`);
if (failures) { console.log('  ' + failures + ' FAILURE(S)'); process.exit(1); }
console.log('  integration OK');
