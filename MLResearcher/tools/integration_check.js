#!/usr/bin/env node
/**
 * End-to-end integration check for the ML Researcher sim.
 *
 * Two checks carry the weight here:
 *
 *  1. TRUTH LEAK AUDIT. window.SIM_WORLD.reveal() is wrapped so every call
 *     records the calling file from the stack. During a full simulated week,
 *     ONLY sim/lab.js may call it, and nothing may call it before the readout
 *     is submitted. If plots.js, team.js or ui.js can see the ground truth, the
 *     entire exercise is theatre.
 *
 *  2. DETERMINISM. Same seed must replay identically, or nothing about the
 *     experience is reproducible or debuggable.
 *
 * Run:  node tools/integration_check.js
 */

'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let failures = 0, checks = 0;

function ok(cond, label, detail) {
  checks++;
  if (cond) console.log('  PASS  ' + label);
  else { failures++; console.log('  FAIL  ' + label + (detail ? '\n          ' + detail : '')); }
}
function section(s) { console.log('\n' + s + '\n' + '-'.repeat(s.length)); }

// ------------------------------------------------------------- browser shim
function makeCtx() {
  const noop = () => {};
  return new Proxy({}, {
    get(t, k) {
      if (k === 'canvas') return { width: 1200, height: 700 };
      if (k === 'measureText') return () => ({ width: 30 });
      if (k === 'createLinearGradient') return () => ({ addColorStop: noop });
      if (k === 'setLineDash') return noop;
      if (k in t) return t[k];
      return noop;
    },
    set(t, k, v) { t[k] = v; return true; }
  });
}
function makeCanvas() {
  return {
    width: 1200, height: 700, clientWidth: 1200, clientHeight: 700, style: {},
    getContext: () => makeCtx(),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1200, height: 700 }),
    addEventListener: () => {}, removeEventListener: () => {},
    parentElement: { clientWidth: 1200, clientHeight: 700 }
  };
}

const store = {};
function makeSandbox() {
  const sb = {
    console, setTimeout, clearTimeout, setInterval, clearInterval,
    Math, Date, JSON, Object, Array, String, Number, Boolean, Error, isNaN,
    parseFloat, parseInt, Proxy, Reflect, Map, Set, Symbol, Promise, Buffer,
    atob: s => Buffer.from(s, 'base64').toString('utf8'),
    btoa: s => Buffer.from(s, 'utf8').toString('base64'),
    devicePixelRatio: 2,
    requestAnimationFrame: fn => setTimeout(() => fn(1), 0),
    cancelAnimationFrame: clearTimeout,
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; }, clear: () => {}
    },
    document: {
      createElement: t => (t === 'canvas' ? makeCanvas() : { style: {}, addEventListener: () => {} }),
      addEventListener: () => {}, getElementById: () => null,
      querySelector: () => null, querySelectorAll: () => []
    },
    navigator: { userAgent: 'node' }
  };
  sb.window = sb; sb.globalThis = sb;
  vm.createContext(sb);
  return sb;
}

function loadInto(sb, rel, required) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) {
    if (required) { console.log('  MISSING FILE: ' + rel); failures++; }
    return false;
  }
  try { vm.runInContext(fs.readFileSync(p, 'utf8'), sb, { filename: rel }); return true; }
  catch (e) {
    failures++;
    console.log('  LOAD ERROR ' + rel + ': ' + e.message);
    console.log('    ' + (e.stack || '').split('\n').slice(1, 3).join('\n    '));
    return false;
  }
}

// ------------------------------------------------------------------- load
section('Loading modules');
const sb = makeSandbox();
const gotWorld = loadInto(sb, 'data/world.js', true);
const gotLab   = loadInto(sb, 'sim/lab.js', true);
const gotPlots = loadInto(sb, 'sim/plots.js', true);
const gotTeam  = loadInto(sb, 'sim/team.js', true);
ok(gotWorld && !!sb.SIM_WORLD, 'data/world.js exposes window.SIM_WORLD');
ok(gotLab && !!sb.Lab, 'sim/lab.js exposes window.Lab');
ok(gotPlots && !!sb.Plots, 'sim/plots.js exposes window.Plots');
ok(gotTeam && !!sb.Team, 'sim/team.js exposes window.Team');
if (failures) { console.log('\nAborting: modules did not load.'); process.exit(1); }

// --------------------------------------------------------- world integrity
section('World integrity');
{
  const W = sb.SIM_WORLD;
  ok(W.interventions.length === 8, 'eight interventions', 'n=' + W.interventions.length);
  ok(W.scales.length === 4, 'four scales');
  ok(typeof W._t === 'string' && W._t.length > 100, 'ground truth is encoded, not plaintext');
  const raw = fs.readFileSync(path.join(ROOT, 'data/world.js'), 'utf8');
  ok(!/qk_norm"\s*:\s*\{\s*"c"/.test(raw), 'truth coefficients are not readable in the file');
  const T = W.reveal();
  ok(T && T.effects && Object.keys(T.effects).length === 8, 'reveal() decodes the truth');
  ok(Array.isArray(T.bestSet) && T.bestSet.length <= W.scenario.maxInterventions,
     'truth carries a legal optimal set', JSON.stringify(T && T.bestSet));
  W.__truth = null;   // reset cache so the leak audit below sees fresh calls
}

// --------------------------------------------------- TRUTH LEAK AUDIT
section('Truth leak audit (the one that actually matters)');
{
  const sb2 = makeSandbox();
  loadInto(sb2, 'data/world.js', true);

  // wrap reveal() to record who called it
  const calls = [];
  let readoutDone = false;          // tracked externally: getState() is not safe to call during init
  const W = sb2.SIM_WORLD;
  const orig = W.reveal.bind(W);
  W.reveal = function () {
    // Find the first frame belonging to a sim/ module. Frames inside this
    // harness (the wrapper itself) must be skipped or they shadow the real caller.
    const stack = new Error().stack || '';
    const line = stack.split('\n').slice(1)
      .filter(l => !/integration_check\.js/.test(l))
      .find(l => /\bsim\/[\w.]+\.js/.test(l)) || 'unknown';
    const file = (line.match(/\bsim\/[\w.]+\.js/) || ['unknown'])[0];
    calls.push({ file, readoutSubmitted: readoutDone });
    return orig();
  };

  loadInto(sb2, 'sim/lab.js', true);
  // wrap submitReadout so we know when peeking at the truth becomes legitimate
  if (sb2.Lab && sb2.Lab.submitReadout) {
    const sr = sb2.Lab.submitReadout.bind(sb2.Lab);
    sb2.Lab.submitReadout = function () { readoutDone = true; return sr.apply(null, arguments); };
  }
  loadInto(sb2, 'sim/plots.js', true);
  loadInto(sb2, 'sim/team.js', true);

  const Lab = sb2.Lab, Team = sb2.Team, Plots = sb2.Plots;
  Lab.init({ world: W, seed: 20260816 });
  Team.init({ world: W, lab: Lab, onMessage: () => {} });
  const plot = Plots.create(makeCanvas(), { theme: 'dark' });

  // run a plausible week
  let launched = 0, ticks = 0;
  const ids = W.interventions.map(i => i.id);
  while (ticks < 1000) {
    const st = Lab.getState();
    if (st.finished) break;
    if (st.slotsFree > 0 && launched < 10) {
      const pick = [ids[launched % ids.length]];
      const r = Lab.launch({
        interventions: pick, scale: launched < 7 ? '70m' : '300m', steps: 'std', seeds: 2,
        hypothesis: 'testing ' + pick[0] + ' for a positive effect on long-context retrieval',
        predictedEffect: 1.0, ciLow: -1.0, ciHigh: 3.0
      });
      if (r && r.ok) launched++;
    }
    // draw with whatever we have — plots must never need the truth
    try {
      plot.forest({ rows: Lab.getState().results.filter(r => r.status === 'ok').map(r => ({
        label: r.interventions.join('+'), effect: r.observedEffect, ciLow: r.ciLow95, ciHigh: r.ciHigh95, n: r.seeds
      })) });
      plot.scaling({ series: [], runScale: W.scenario.runScale, metric: 'LCR@128k' });
    } catch (e) { /* plot errors surfaced separately below */ }
    try { Team.tick(Lab.getState()); } catch (e) {}
    Lab.step(); ticks++;
  }

  const preReadout = calls.filter(c => !c.readoutSubmitted);
  const nonLab = calls.filter(c => !/sim\/lab\.js/.test(c.file));
  ok(launched > 0, 'experiments actually launched during the audit', 'launched=' + launched);
  ok(calls.length > 0, 'lab.js consulted the truth to generate observations');
  ok(nonLab.length === 0, 'ONLY lab.js ever calls reveal()',
     'offenders: ' + JSON.stringify([...new Set(nonLab.map(c => c.file))]));

  // scoring may legitimately read truth; check nothing else did before readout
  const badPre = preReadout.filter(c => !/sim\/lab\.js/.test(c.file));
  ok(badPre.length === 0, 'nothing reads the truth before the readout is submitted',
     JSON.stringify([...new Set(badPre.map(c => c.file))]));
}

// --------------------------------------------------------- determinism
section('Determinism');
{
  function runWeek(seed) {
    const s = makeSandbox();
    loadInto(s, 'data/world.js', true);
    loadInto(s, 'sim/lab.js', true);
    loadInto(s, 'sim/team.js', true);
    const W = s.SIM_WORLD, Lab = s.Lab, Team = s.Team;
    const feed = [];
    Lab.init({ world: W, seed });
    Team.init({ world: W, lab: Lab, onMessage: m => feed.push(m.t + '|' + m.from + '|' + m.text) });
    const ids = W.interventions.map(i => i.id);
    let n = 0, ticks = 0;
    while (ticks < 1000) {
      const st = Lab.getState();
      if (st.finished) break;
      if (st.slotsFree > 0 && n < 12) {
        const r = Lab.launch({
          interventions: [ids[n % ids.length]], scale: '70m', steps: 'std', seeds: 2,
          hypothesis: 'probing intervention number ' + n + ' for a real effect',
          predictedEffect: 1.0, ciLow: -1, ciHigh: 3
        });
        if (r && r.ok) n++;
      }
      Team.tick(Lab.getState());
      Lab.step(); ticks++;
    }
    const st = Lab.getState();
    return {
      results: st.results.map(r => [r.interventions.join('+'), r.status, r.observedEffect, r.failReason].join(':')),
      feed
    };
  }
  const a = runWeek(20260816), b = runWeek(20260816), c = runWeek(99);
  ok(a.results.length > 0, 'the week produced results', 'n=' + a.results.length);
  ok(JSON.stringify(a.results) === JSON.stringify(b.results), 'same seed -> identical results');
  ok(JSON.stringify(a.feed) === JSON.stringify(b.feed), 'same seed -> identical team feed');
  ok(JSON.stringify(a.results) !== JSON.stringify(c.results), 'different seed -> different results');
}

// ------------------------------------------------- design() purity + noise
section('Pricing preview and observation model');
{
  const s = makeSandbox();
  loadInto(s, 'data/world.js', true); loadInto(s, 'sim/lab.js', true);
  const W = s.SIM_WORLD, Lab = s.Lab;

  Lab.init({ world: W, seed: 7 });
  const d1 = Lab.design({ interventions: ['qk_norm'], scale: '70m', steps: 'std', seeds: 1 });
  ok(d1.ok && Math.abs(d1.cost - 12) < 1e-6, 'cost = 12 GPU-h for 70M/std/1seed', JSON.stringify(d1));
  ok(Math.abs(d1.sigma - 1.80) < 1e-6, 'sigma = 1.80 at 70M/std/1seed', 'got ' + d1.sigma);
  const d4 = Lab.design({ interventions: ['qk_norm'], scale: '70m', steps: 'std', seeds: 4 });
  ok(Math.abs(d4.sigma - 0.90) < 1e-6, 'four seeds halve sigma', 'got ' + d4.sigma);
  ok(Math.abs(d4.wallHours - d1.wallHours) < 1e-9, 'seeds cost compute but not wall-clock');
  ok(Math.abs(d4.cost - 48) < 1e-6, 'four seeds cost 4x', 'got ' + d4.cost);

  // purity: hammering design() must not perturb the PRNG
  function firstObs(nDesignCalls) {
    const s2 = makeSandbox();
    loadInto(s2, 'data/world.js', true); loadInto(s2, 'sim/lab.js', true);
    const L = s2.Lab;
    L.init({ world: s2.SIM_WORLD, seed: 4242 });
    for (let i = 0; i < nDesignCalls; i++) L.design({ interventions: ['qk_norm'], scale: '70m', steps: 'std', seeds: 2 });
    L.launch({ interventions: ['qk_norm'], scale: '70m', steps: 'std', seeds: 2,
               hypothesis: 'qk norm should help attention sharpness measurably',
               predictedEffect: 2, ciLow: 0, ciHigh: 4 });
    for (let i = 0; i < 400; i++) L.step();
    const r = L.getState().results[0];
    return r ? r.observedEffect + ':' + r.status : 'none';
  }
  ok(firstObs(0) === firstObs(250), 'design() is pure — 250 calls do not shift the PRNG',
     firstObs(0) + ' vs ' + firstObs(250));

  // the observed effects must actually centre on the truth
  const T = W.reveal();
  const NREF = T.nref, N = 7.0e7;
  const truthQK = T.effects.qk_norm.c + T.effects.qk_norm.a * Math.pow(NREF / N, T.effects.qk_norm.gamma);
  let sum = 0, sum2 = 0, m = 0;
  for (let trial = 0; trial < 400; trial++) {
    const s3 = makeSandbox();
    loadInto(s3, 'data/world.js', true); loadInto(s3, 'sim/lab.js', true);
    const L = s3.Lab;
    L.init({ world: s3.SIM_WORLD, seed: 1000 + trial });
    L.launch({ interventions: ['qk_norm'], scale: '70m', steps: 'std', seeds: 1,
               hypothesis: 'measuring the qk_norm effect at the cheapest scale',
               predictedEffect: 2, ciLow: 0, ciHigh: 4 });
    for (let i = 0; i < 400; i++) L.step();
    const r = L.getState().results[0];
    if (r && r.status === 'ok') { sum += r.observedEffect; sum2 += r.observedEffect ** 2; m++; }
  }
  const mean = sum / m, sd = Math.sqrt(sum2 / m - mean * mean);
  const se = 1.8 / Math.sqrt(m);
  ok(m > 250, 'enough successful draws for a statistical check', 'n=' + m);
  ok(Math.abs(mean - truthQK) < 4 * se,
     'observations are unbiased around the true effect',
     `mean ${mean.toFixed(3)} vs truth ${truthQK.toFixed(3)} (se ${se.toFixed(3)})`);
  ok(Math.abs(sd - 1.8) / 1.8 < 0.15, 'observed spread matches sigma', 'sd=' + sd.toFixed(3));
}

// ------------------------------------------------------------- scoring
section('Readout scoring');
{
  const s = makeSandbox();
  loadInto(s, 'data/world.js', true); loadInto(s, 'sim/lab.js', true);
  const W = s.SIM_WORLD, Lab = s.Lab, T = W.reveal();

  function scoreOf(set) {
    const s2 = makeSandbox();
    loadInto(s2, 'data/world.js', true); loadInto(s2, 'sim/lab.js', true);
    s2.Lab.init({ world: s2.SIM_WORLD, seed: 5 });
    return s2.Lab.submitReadout({ interventions: set, confidence: 0.6, rationale: 'integration test rationale' });
  }

  const best = scoreOf(T.bestSet);
  ok(best && Math.abs(best.regret) < 1e-6, 'the optimal set scores zero regret',
     JSON.stringify(best && { r: best.regret, g: best.grade }));
  ok(best.grade === 'A', 'optimal set grades A', best && best.grade);

  const naive = scoreOf(['qk_norm', 'attn_sink_tokens', 'rope_scaling_v2', 'depth_over_width']);
  ok(naive.regret > 5, 'the "trust cheap evidence" pick has large regret', 'regret=' + naive.regret.toFixed(2));
  ok(naive.shippedRegression === true, 'including attn_sink_tokens is flagged as a shipped regression');
  ok(['C', 'D', 'F'].includes(naive.grade), 'shipping a regression caps the grade at C', 'grade=' + naive.grade);

  const tooMany = scoreOf(['qk_norm', 'attn_sink_tokens', 'rope_scaling_v2', 'depth_over_width', 'lr_warmup_long']);
  ok(tooMany && tooMany.error || tooMany === null || (tooMany && tooMany.grade),
     'submitting more than maxInterventions is handled');

  const md = (() => {
    const s2 = makeSandbox();
    loadInto(s2, 'data/world.js', true); loadInto(s2, 'sim/lab.js', true);
    s2.Lab.init({ world: s2.SIM_WORLD, seed: 5 });
    s2.Lab.launch({ interventions: ['rope_scaling_v2'], scale: '70m', steps: 'std', seeds: 2,
                    hypothesis: 'rope scaling should give a durable positive effect here',
                    predictedEffect: 2.5, ciLow: 1, ciHigh: 4 });
    for (let i = 0; i < 400; i++) s2.Lab.step();
    s2.Lab.submitReadout({ interventions: ['rope_scaling_v2'], confidence: 0.7, rationale: 'only real evidence' });
    return s2.Lab.exportReadout();
  })();
  ok(typeof md === 'string' && md.length > 300, 'exportReadout() produces markdown', 'len=' + (md || '').length);
  ok(/hypothes/i.test(md), 'readout includes the recorded hypotheses');
  ok(!/gamma/i.test(md) && !/"c":/.test(md), 'readout does NOT leak truth coefficients');
}

section('Verdict');
console.log(`  ${checks - failures}/${checks} checks passed`);
if (failures) { console.log('  ' + failures + ' FAILURE(S)'); process.exit(1); }
console.log('  integration OK');
