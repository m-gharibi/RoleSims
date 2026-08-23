#!/usr/bin/env node
/**
 * End-to-end integration check for the Junior Engineer sim.
 *
 * The load-bearing checks:
 *
 *  1. TRUTH LEAK AUDIT. window.SIM_REPO.reveal() is wrapped so every call records
 *     the calling sim/ module. ONLY sim/dev.js may call it. If squad.js could see
 *     the truth, Deepa would secretly know which tickets are unsolvable, and the
 *     entire premise collapses.
 *
 *  2. THE CENTRAL SYMMETRY, measured through the real engine. BUG-2201 and
 *     BUG-2207 look identical on the board: both bugs, both from Support. One is
 *     solvable by reading; the other is capped below the implement bar no matter
 *     how many hours you spend. This harness brute-forces both and asserts the
 *     asymmetry actually holds in the shipped engine, not just in the builder.
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
    localStorage: { getItem: k => (k in store ? store[k] : null),
                    setItem: (k, v) => { store[k] = String(v); },
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
loadInto(sb, 'data/repo.js', true);
loadInto(sb, 'sim/dev.js', true);
loadInto(sb, 'sim/board.js', true);
loadInto(sb, 'sim/squad.js', true);
ok(!!sb.SIM_REPO, 'data/repo.js exposes window.SIM_REPO');
ok(!!sb.Dev, 'sim/dev.js exposes window.Dev');
ok(!!sb.Board, 'sim/board.js exposes window.Board');
ok(!!sb.Squad, 'sim/squad.js exposes window.Squad');
if (failures) { console.log('\nAborting: modules did not load.'); process.exit(1); }

section('Repo integrity');
{
  const R = sb.SIM_REPO;
  ok(R.tickets.length === 6, 'six tickets', 'n=' + R.tickets.length);
  ok(R.actions.length >= 6, 'the investigation action set is present');
  ok(R.actions.every(a => a.caveat && a.caveat.length > 20), 'every action states its caveat up front');
  ok(R.people.length === 4, 'four people');
  ok(R.scenario.seniorBudgetHours === 10, 'Deepa has a ten-hour budget');
  const raw = fs.readFileSync(path.join(ROOT, 'data/repo.js'), 'utf8');
  ok(!/selfFindable/.test(raw), 'truth is encoded, not plaintext in the file');
  const T = R.reveal();
  ok(Object.keys(T.tickets).length === 6, 'reveal() decodes the truth');
  ok(T.tickets['BUG-2207'].selfFindable === false, 'BUG-2207 is flagged unsolvable alone');
  ok(T.tickets['BUG-2201'].selfFindable === true, 'BUG-2201 is flagged solvable alone');
  ok(T.tickets['BUG-2201'].yields.read_docs < 0, 'the docs actively mislead on BUG-2201');
  ok(T.tickets['FEAT-2189'].yields.read_docs > T.tickets['FEAT-2189'].yields.read_code,
     'and the docs are the BEST source on FEAT-2189 — the inverse lesson');
  R.__truth = null;
}

section('Truth leak audit (the one that actually matters)');
{
  const s = makeSandbox();
  loadInto(s, 'data/repo.js', true);
  const R = s.SIM_REPO;
  const calls = [];
  let retroDone = false;
  const orig = R.reveal.bind(R);
  R.reveal = function () {
    const stack = new Error().stack || '';
    const line = stack.split('\n').slice(1)
      .filter(l => !/integration_check\.js/.test(l))
      .find(l => /\bsim\/[\w.]+\.js/.test(l)) || 'unknown';
    calls.push({ file: (line.match(/\bsim\/[\w.]+\.js/) || ['unknown'])[0], retroDone });
    return orig();
  };
  loadInto(s, 'sim/dev.js', true);
  loadInto(s, 'sim/board.js', true);
  loadInto(s, 'sim/squad.js', true);
  const D = s.Dev, Q = s.Squad, B = s.Board;
  if (D && D.submitRetro) {
    const f = D.submitRetro.bind(D);
    D.submitRetro = function () { retroDone = true; return f.apply(null, arguments); };
  }
  D.init({ repo: R, seed: 20260823 });
  Q.init({ repo: R, dev: D, onMessage: () => {} });
  const b = B.create(makeCanvas(), { theme: 'dark' });

  const ids = R.tickets.map(t => t.id);
  ids.forEach(id => { try { D.estimate(id, 4); } catch (e) {} });
  let n = 0, ticks = 0;
  while (ticks < 3000) {
    const st = D.getState();
    if (st.finished) break;
    const tid = ids[n % ids.length];
    try { D.select(tid); } catch (e) {}
    try { D.investigate({ ticketId: tid, actionId: 'read_code' }); } catch (e) {}
    if (ticks % 40 === 0) n++;
    try {
      b.timeline({ tickets: st.tickets, day: st.day, totalDays: 10, hoursPerDay: 6 });
      b.trust({ people: [] });
    } catch (e) {}
    try { Q.tick(D.getState()); } catch (e) {}
    D.step(); ticks++;
  }
  const nonDev = calls.filter(c => !/sim\/dev\.js/.test(c.file));
  ok(calls.length > 0, 'dev.js consulted the truth to resolve actions');
  ok(nonDev.length === 0, 'ONLY dev.js ever calls reveal()',
     'offenders: ' + JSON.stringify([...new Set(nonDev.map(c => c.file))]));
  const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const sq = strip(fs.readFileSync(path.join(ROOT, 'sim/squad.js'), 'utf8'));
  const hits = ['reveal\\s*\\(', '\\._t\\b', 'atob\\s*\\(', 'selfFindable', 'soloCap']
    .filter(p => new RegExp(p).test(sq));
  ok(hits.length === 0, 'squad.js source contains no path to the ground truth', 'matched: ' + hits.join(', '));
}

section('The central symmetry — measured through the real engine');
{
  // Brute-force every solo action many times on each ticket and see where
  // understanding tops out. This is the whole design in one test.
  function bruteForce(ticketId) {
    const s = makeSandbox();
    loadInto(s, 'data/repo.js', true);
    loadInto(s, 'sim/dev.js', true);
    const D = s.Dev;
    D.init({ repo: s.SIM_REPO, seed: 5 });
    try { D.estimate(ticketId, 6); } catch (e) {}
    try { D.select(ticketId); } catch (e) {}
    const solo = s.SIM_REPO.actions.map(a => a.id);
    let best = 0;
    for (let round = 0; round < 12; round++) {
      for (const a of solo) {
        try { D.investigate({ ticketId, actionId: a }); } catch (e) {}
        const t = D.getState().tickets.find(x => x.id === ticketId);
        if (t && t.understanding > best) best = t.understanding;
      }
    }
    return best;
  }
  const RULES = sb.Dev.RULES || { implementReadyAt: 70 };
  const u2201 = bruteForce('BUG-2201');
  const u2207 = bruteForce('BUG-2207');
  console.log(`  BUG-2201 solo ceiling: ${u2201.toFixed(0)}   BUG-2207 solo ceiling: ${u2207.toFixed(0)}`);
  ok(u2201 >= RULES.implementReadyAt,
     'BUG-2201 IS solvable by solo investigation', 'reached ' + u2201.toFixed(0));
  ok(u2207 < RULES.implementReadyAt,
     'BUG-2207 is NOT solvable alone, at any effort — the soloCap holds',
     'reached ' + u2207.toFixed(0) + ', bar is ' + RULES.implementReadyAt);
  ok(u2201 - u2207 > 25, 'the two lookalike bugs diverge sharply in solvability');

  // and asking must break the ceiling
  const s = makeSandbox();
  loadInto(s, 'data/repo.js', true); loadInto(s, 'sim/dev.js', true);
  const D = s.Dev;
  D.init({ repo: s.SIM_REPO, seed: 5 });
  D.estimate('BUG-2207', 4); D.select('BUG-2207');
  for (let i = 0; i < 8; i++) D.investigate({ ticketId: 'BUG-2207', actionId: 'git_blame' });
  const before = D.getState().tickets.find(t => t.id === 'BUG-2207').understanding;
  const r = D.ask({ ticketId: 'BUG-2207', to: 'deepa',
                    question: 'I have been through git blame and the delivery code and I cannot find why dedupe is off for these accounts. Is there history here?' });
  const after = D.getState().tickets.find(t => t.id === 'BUG-2207').understanding;
  ok(r && r.ok, 'asking Deepa succeeds', JSON.stringify(r && r.error));
  ok(after > before + 40, 'and it breaks the ceiling that solo work could not',
     `${before.toFixed(0)} -> ${after.toFixed(0)}`);
}

section('Negative yields, decay, and the ask economy');
{
  const s = makeSandbox();
  loadInto(s, 'data/repo.js', true); loadInto(s, 'sim/dev.js', true);
  const D = s.Dev;
  D.init({ repo: s.SIM_REPO, seed: 9 });
  D.estimate('BUG-2201', 4); D.select('BUG-2201');
  D.investigate({ ticketId: 'BUG-2201', actionId: 'read_code' });
  const u1 = D.getState().tickets.find(t => t.id === 'BUG-2201').understanding;
  D.investigate({ ticketId: 'BUG-2201', actionId: 'read_docs' });
  const u2 = D.getState().tickets.find(t => t.id === 'BUG-2201').understanding;
  ok(u2 < u1, 'reading the stale docs on BUG-2201 moves you BACKWARDS', `${u1.toFixed(0)} -> ${u2.toFixed(0)}`);

  // decay: the 4th read_code must be worth far less than the 1st
  const s2 = makeSandbox();
  loadInto(s2, 'data/repo.js', true); loadInto(s2, 'sim/dev.js', true);
  const D2 = s2.Dev;
  D2.init({ repo: s2.SIM_REPO, seed: 9 });
  D2.estimate('BUG-2201', 4); D2.select('BUG-2201');
  const gains = [];
  let prev = 0;
  for (let i = 0; i < 4; i++) {
    D2.investigate({ ticketId: 'BUG-2201', actionId: 'read_code' });
    const u = D2.getState().tickets.find(t => t.id === 'BUG-2201').understanding;
    gains.push(u - prev); prev = u;
  }
  console.log('  read_code gains:', gains.map(g => g.toFixed(1)).join(' -> '));
  ok(gains[3] < gains[0] * 0.35, 'the fourth pass through the same file is worth a fraction of the first',
     gains.map(g => g.toFixed(1)).join(' -> '));

  // senior budget is a hard ceiling
  const s3 = makeSandbox();
  loadInto(s3, 'data/repo.js', true); loadInto(s3, 'sim/dev.js', true);
  const D3 = s3.Dev;
  D3.init({ repo: s3.SIM_REPO, seed: 9 });
  s3.SIM_REPO.tickets.forEach(t => D3.estimate(t.id, 4));
  let rejected = null, asks = 0;
  for (let i = 0; i < 80 && !rejected; i++) {
    const tid = s3.SIM_REPO.tickets[i % 6].id;
    const r = D3.ask({ ticketId: tid, to: 'deepa',
                       question: 'A sufficiently long question about this ticket that passes the minimum length check.' });
    if (r && r.ok === false) rejected = r.error; else asks++;
  }
  ok(!!rejected, 'Deepa\'s budget eventually runs out', 'asks accepted: ' + asks);
  ok(/no time left/i.test(rejected || ''), 'and the rejection says so plainly', rejected);
}

section('Determinism');
{
  function run(seed) {
    const s = makeSandbox();
    loadInto(s, 'data/repo.js', true);
    loadInto(s, 'sim/dev.js', true);
    loadInto(s, 'sim/squad.js', true);
    const D = s.Dev, Q = s.Squad;
    const feed = [];
    D.init({ repo: s.SIM_REPO, seed });
    Q.init({ repo: s.SIM_REPO, dev: D, onMessage: m => feed.push(m.t + '|' + m.from + '|' + m.text) });
    s.SIM_REPO.tickets.forEach(t => D.estimate(t.id, 4));
    D.select('BUG-2201');
    // Exercise the STOCHASTIC paths deliberately: the review lag and the channel
    // reply delay are the only places this engine consumes randomness. A run that
    // only investigates is deterministic by construction and proves nothing.
    let n = 0, opened = false;
    try { D.ask({ ticketId: 'BUG-2201', to: 'channel',
                  question: 'Has anyone seen the dispatch ordering scramble across a DST boundary before?' }); } catch (e) {}
    while (n < 3000 && !D.getState().finished) {
      if (n % 3 === 0) { try { D.investigate({ ticketId: 'BUG-2201', actionId: 'read_code' }); } catch (e) {} }
      const t = D.getState().tickets.find(x => x.id === 'BUG-2201');
      if (!opened && t && t.understanding >= 90) {
        try { D.writeTests('BUG-2201'); D.implement('BUG-2201'); D.openPR('BUG-2201'); opened = true; } catch (e) {}
      }
      Q.tick(D.getState());
      D.step(); n++;
    }
    const st = D.getState();
    return { merged: (st.merged || []).join(','), feed,
             u: st.tickets.map(t => t.understanding.toFixed(2)).join(','),
             // review lag / channel delay land in the per-ticket timing
             timing: st.tickets.map(t => (t.prOpenedAt || '-') + ':' + t.status).join(',') };
  }
  const a = run(20260823), b = run(20260823), c = run(4242);
  ok(a.u === b.u && JSON.stringify(a.feed) === JSON.stringify(b.feed), 'same seed replays identically');
  ok(a.feed.length > 5, 'the squad actually spoke during the sprint', 'n=' + a.feed.length);
  const differs = a.u !== c.u || a.timing !== c.timing ||
                  JSON.stringify(a.feed) !== JSON.stringify(c.feed);
  ok(differs, 'a different seed produces a different sprint',
     `same-seed timing ${a.timing} vs other-seed ${c.timing}`);
}

section('The traps, through the engine');
{
  function fresh(seed) {
    const s = makeSandbox();
    loadInto(s, 'data/repo.js', true); loadInto(s, 'sim/dev.js', true);
    s.Dev.init({ repo: s.SIM_REPO, seed: seed || 3 });
    return s.Dev;
  }
  // FEAT-2195: implementing without asking Hannah must bounce on requirements
  const D = fresh();
  D.estimate('FEAT-2195', 6); D.select('FEAT-2195');
  for (let i = 0; i < 10; i++) D.investigate({ ticketId: 'FEAT-2195', actionId: 'read_code' });
  D.ask({ ticketId: 'FEAT-2195', to: 'deepa', question: 'How does the gateway middleware chain work in this service, roughly?' });
  const t = D.getState().tickets.find(x => x.id === 'FEAT-2195');
  if (t.understanding >= (D.RULES.implementReadyAt || 70)) {
    D.writeTests('FEAT-2195');
    D.implement('FEAT-2195');
    D.openPR('FEAT-2195');
    for (let i = 0; i < 200; i++) D.step();
    const after = D.getState().tickets.find(x => x.id === 'FEAT-2195');
    ok(after.status !== 'merged', 'FEAT-2195 does not merge without asking the PM to clarify',
       'status=' + after.status + ' bounces=' + after.bounces);
  } else {
    ok(true, 'FEAT-2195 could not even reach the implement bar without the PM (also acceptable)');
  }

  // CHORE-2150: implementing without the scope guard must bounce on blast radius
  const D2 = fresh(11);
  D2.estimate('CHORE-2150', 1); D2.select('CHORE-2150');
  for (let i = 0; i < 12; i++) D2.investigate({ ticketId: 'CHORE-2150', actionId: 'read_code' });
  const c = D2.getState().tickets.find(x => x.id === 'CHORE-2150');
  if (c.understanding >= (D2.RULES.implementReadyAt || 70)) {
    D2.implement('CHORE-2150'); D2.openPR('CHORE-2150');
    for (let i = 0; i < 200; i++) D2.step();
    const after = D2.getState().tickets.find(x => x.id === 'CHORE-2150');
    ok(after.status !== 'merged', 'CHORE-2150 bounces when nobody asked about blast radius',
       'status=' + after.status);
  } else {
    ok(true, 'CHORE-2150 not reachable without the scope conversation (also acceptable)');
  }
}

section('Scoring and export');
{
  const s = makeSandbox();
  loadInto(s, 'data/repo.js', true); loadInto(s, 'sim/dev.js', true);
  const D = s.Dev;
  D.init({ repo: s.SIM_REPO, seed: 21 });
  s.SIM_REPO.tickets.forEach(t => D.estimate(t.id, 4));
  // abandon the flake, which is the correct call
  D.select('BUG-2214');
  D.investigate({ ticketId: 'BUG-2214', actionId: 'git_blame' });
  D.investigate({ ticketId: 'BUG-2214', actionId: 'search_slack' });
  D.abandon('BUG-2214');
  while (!D.getState().finished) D.step();
  const score = D.submitRetro({ narrative: 'integration harness retro narrative',
                                whatIdDoDifferently: 'ask sooner on the tribal knowledge ticket' });
  ok(score && typeof score.grade === 'string', 'submitRetro returns a score', JSON.stringify(score && score.grade));
  ok(Array.isArray(score.escalation), 'the score carries per-ticket escalation verdicts');
  const flake = (score.perTicket || []).find(p => p.id === 'BUG-2214');
  ok(flake && /abandon|correct|right|hand/i.test(JSON.stringify(flake)),
     'abandoning the flaky test is scored as a correct call', JSON.stringify(flake));
  const md = D.exportRetro();
  ok(typeof md === 'string' && md.length > 300, 'exportRetro produces markdown', 'len=' + (md || '').length);
  ok(!/selfFindable|soloCap|yields/.test(md), 'the retro does NOT leak ground truth');
}

section('Verdict');
console.log(`  ${checks - failures}/${checks} checks passed`);
if (failures) { console.log('  ' + failures + ' FAILURE(S)'); process.exit(1); }
console.log('  integration OK');
