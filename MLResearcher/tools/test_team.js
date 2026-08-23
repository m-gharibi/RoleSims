#!/usr/bin/env node
/* =============================================================================
 * tools/test_team.js  —  run with:  node tools/test_team.js
 *
 * No dependencies. Loads sim/team.js exactly as a browser would (it assigns to
 * `window.Team`; we just point `window` at the node global), then walks two
 * synthetic researchers through two scripted weeks, driving Team.tick() with
 * fake Lab states on a 15-minute grid from Mon 09:00 to Fri 18:45.
 *
 * WEEK A — "the small-scale week". The failure mode the sim exists to teach:
 *   Mon 09:15  three singletons fired off at once, all at 70M, all one seed
 *                                      -> all_small_scale, no_stagger, first_result
 *   Mon 11:15  a follow-up launched off a single-seed reading, 30 min old
 *                                      -> one_seed_acted
 *   Mon 11:00  a prediction of +6.00 comes back +0.20 at sigma 1.80
 *                                      -> predict_miss_2sigma
 *   Mon 12:30  a slot has sat empty since 09:15   -> slot_idle
 *   Mon 14:15  four predictions in, every one of them high  -> optimism_bias
 *   Mon 15:00  the same 300M cell launched twice, identically, unlabelled
 *                                      -> dup_no_replication_note
 *   Tue 11:15  61% of the week's compute gone, nothing above 300M
 *                                      -> budget40_no_scale, pace_early_burn
 *   Tue 16:30  a 720-hour job killed at 83%       -> kill_late
 *   Tue 18:00  Halberd's claim untouched for a full working day -> rival_ignored
 *   Wed 18:15  under 18 wall-hours left: 7B is now unreachable  -> no_time_for_scale
 *   Thu 09:00  no combination ever run, one intervention never run at all
 *                                      -> no_combo_thursday, untested_thursday
 *   Fri 09:00  three interventions with 70M-only evidence, one of them a
 *              single reading whose interval contains zero
 *                     -> small_scale_only_friday, ci_zero_treated_real
 *
 * WEEK B — "borrowed conviction". The other failure mode, and the only way to
 * prove the triggers week A must NOT fire actually work:
 *   staggered launches, real scale, combinations, one clean expensive number
 *   (precision_praise), a job that dies at half wall clock whose interventions
 *   get carried forward anyway (failed_job_carried), a combination built on a
 *   zero-crossing reading (ci_zero_treated_real, the build-on path), Halberd's
 *   number typed straight into a hypothesis (rival_borrowed), 1520 GPU-hours
 *   spent re-measuring a cell already at sigma 0.40 (remeasure_tight), and not
 *   one cell ever run twice (never_replicated).
 *
 * Asserts in both: the right triggers fire, none fires twice, at most one
 * reactive message per tick, the LEAD > OPS > RIVAL > PEER queue order holds,
 * the queue drains, gates land once at the specified day/hour with the spec's
 * prompts verbatim, scripted events all fire, message shape is valid, the feed
 * is time-ordered, the ground truth is never touched, and two identical runs
 * produce byte-identical feeds. Then prints both feeds so the writing can be
 * read and judged.
 * ========================================================================== */

'use strict';

var path = require('path');

// --- load sim/team.js the way a <script src> would ---------------------------
global.window = global;
require(path.join(__dirname, '..', 'sim', 'team.js'));
var Team = global.window.Team;

/* ------------------------------------------------------------------ fixtures */

var RULES = {
  computeBudget: 6000,
  slots: 4,
  days: 5,
  hoursPerDay: 10,
  startHour: 9,
  maxInterventions: 4,
  failureBase: 0.10,
  failureScaleMult: { '70m': 0.6, '300m': 0.9, '1p4b': 1.3, '7b': 2.0 },
  killRefund: 0.5,
  minHypothesisChars: 20
};
var FakeLab = { RULES: RULES };

var SCALES = [
  { id: '70m',  params: 7.0e7, label: '70M',  computeHours: 12,  wallHours: 1.5,  sigma: 1.80 },
  { id: '300m', params: 3.0e8, label: '300M', computeHours: 45,  wallHours: 3.0,  sigma: 1.20 },
  { id: '1p4b', params: 1.4e9, label: '1.4B', computeHours: 190, wallHours: 7.0,  sigma: 0.80 },
  { id: '7b',   params: 7.0e9, label: '7B',   computeHours: 850, wallHours: 18.0, sigma: 0.50 }
];

var STEPS = [
  { id: 'short', label: '5k steps',  mult: 0.5 },
  { id: 'std',   label: '10k steps', mult: 1.0 },
  { id: 'long',  label: '20k steps', mult: 2.0 }
];

var INTERVENTIONS = [
  { id: 'rope_scaling_v2',     name: 'RoPE scaling v2',          family: 'architecture' },
  { id: 'doc_packing_boundary', name: 'Doc packing boundaries',  family: 'data' },
  { id: 'long_ctx_data_mix',   name: 'Long-context data mix',    family: 'data' },
  { id: 'qk_norm',             name: 'QK-norm',                  family: 'architecture' },
  { id: 'mup_transfer',        name: 'muP transfer',             family: 'optimization' },
  { id: 'sliding_window_attn', name: 'Sliding-window attention', family: 'architecture' },
  { id: 'z_loss_aux',          name: 'Auxiliary z-loss',         family: 'optimization' },
  { id: 'lr_decay_late',       name: 'Late LR decay',            family: 'optimization' }
];

// The team must never read the ground truth. These two spies prove it.
var truthTouched = false;
var revealCalled = false;

function makeWorld(events) {
  var w = {
    scenario: {
      org: 'Meridian Labs', team: 'Pretraining / long-context',
      question: 'Which recipe changes survive to 70B?',
      deadline: 'Friday 16:00',
      brief: 'Four changes, at most, for the 70B run. Recipe locks Friday.',
      metric: { name: 'LCR@128k', units: 'points', desc: 'Long-context retrieval, 128k window' },
      priorEvidence: [{ text: 'RoPE scaling helped at 1.4B last quarter', source: 'internal' }],
      runScale: 7.0e10,
      maxInterventions: 4
    },
    interventions: INTERVENTIONS,
    scales: SCALES,
    stepOptions: STEPS,
    events: events,
    reveal: function () { revealCalled = true; return { effects: {}, interactions: [], notes: {} }; }
  };
  Object.defineProperty(w, '_t', {
    enumerable: true,
    get: function () { truthTouched = true; return 'e30='; }
  });
  return w;
}

/* ------------------------------------------------------------ the fake Lab
 * A scripted stand-in for sim/lab.js: it publishes exactly the state shape the
 * spec defines, on exactly the 15-minute grid Lab.step() uses, and nothing else.
 * Every observation here is authored by the script — there is no model, no
 * PRNG, and no truth, so the test is as deterministic as the module under test.
 * ------------------------------------------------------------------------- */

var DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

function pad2(n) { return (n < 10 ? '0' : '') + Math.floor(n); }
function hhmm(h) {
  var hr = Math.floor(h), mi = Math.round((h - hr) * 60);
  return pad2(hr) + ':' + pad2(mi);
}
function Wof(day, hour) { return (day - 1) * RULES.hoursPerDay + (hour - RULES.startHour); }
function dayOfW(w) { return Math.floor(w / RULES.hoursPerDay) + 1; }
function hourOfW(w) { return RULES.startHour + (w - (dayOfW(w) - 1) * RULES.hoursPerDay); }

function scaleById(id) {
  for (var i = 0; i < SCALES.length; i++) if (SCALES[i].id === id) return SCALES[i];
  return SCALES[0];
}
function stepMult(id) {
  for (var i = 0; i < STEPS.length; i++) if (STEPS[i].id === id) return STEPS[i].mult;
  return 1;
}

function Lab(script) {
  this.script = script.slice().sort(function (a, b) {
    return (a.day - b.day) || (a.hour - b.hour) || (a.act === 'kill' ? -1 : 1);
  });
  this.si = 0;
  this.jobs = {};        // id -> job record
  this.running = [];
  this.results = [];
  this.used = 0;
  this.tick = 0;
}

Lab.prototype.launch = function (a) {
  var sc = scaleById(a.scale), mult = stepMult(a.steps);
  var cost = sc.computeHours * mult * a.seeds;
  var wall = sc.wallHours * mult;
  var lw = Wof(a.day, a.hour);
  var revealAt = lw + wall * (a.failAtFrac || 1);
  var job = {
    id: a.id,
    interventions: a.ivs.slice(),
    scale: a.scale, steps: a.steps, seeds: a.seeds,
    cost: cost, wallHours: wall,
    launchedAt: { day: a.day, hour: a.hour },
    etaAt: { day: dayOfW(lw + wall), hour: hourOfW(lw + wall) },
    progress: 0,
    hypothesis: a.hyp,
    predictedEffect: a.pred,
    ciLow: a.pciLow, ciHigh: a.pciHigh,
    _lw: lw, _wall: wall, _revealAt: revealAt, _spec: a
  };
  this.jobs[a.id] = job;
  this.running.push(job);
  this.used += cost;
};

Lab.prototype.kill = function (id) {
  for (var i = 0; i < this.running.length; i++) {
    if (this.running[i].id !== id) continue;
    var j = this.running.splice(i, 1)[0];
    this.used -= RULES.killRefund * j.cost * (1 - j.progress);   // half the unspent
    return;
  }
};

Lab.prototype.state = function (day, hour) {
  var w = Wof(day, hour), i, j, a;

  // scripted actions due on this tick
  while (this.si < this.script.length &&
         (this.script[this.si].day < day ||
          (this.script[this.si].day === day && this.script[this.si].hour <= hour + 1e-9))) {
    a = this.script[this.si++];
    if (a.act === 'kill') this.kill(a.id); else this.launch(a);
  }

  // progress + completion
  var stillRunning = [];
  for (i = 0; i < this.running.length; i++) {
    j = this.running[i];
    j.progress = Math.max(0, Math.min(1, (w - j._lw) / j._wall));
    if (w >= j._revealAt - 1e-9) {
      var s = j._spec;
      var res = {
        id: j.id, interventions: j.interventions.slice(),
        scale: j.scale, steps: j.steps, seeds: j.seeds,
        cost: j.cost, wallHours: j.wallHours,
        launchedAt: j.launchedAt, etaAt: j.etaAt,
        progress: (s.status === 'failed') ? (s.failAtFrac || 0.5) : 1,
        hypothesis: j.hypothesis, predictedEffect: j.predictedEffect,
        ciLow: j.ciLow, ciHigh: j.ciHigh,
        status: s.status || 'ok',
        failReason: s.failReason || null,
        observedEffect: (s.status === 'failed') ? null : s.obs,
        sigma: (s.status === 'failed') ? null : s.sigma,
        ciLow95: (s.status === 'failed') ? null : round2(s.obs - 1.96 * s.sigma),
        ciHigh95: (s.status === 'failed') ? null : round2(s.obs + 1.96 * s.sigma),
        finishedAt: { day: day, hour: hour }
      };
      if (s.status === 'failed') {
        this.used -= j.cost * (1 - (s.failAtFrac || 0.5));       // unconsumed refunded
      }
      this.results.push(res);
    } else {
      stillRunning.push(j);
    }
  }
  this.running = stillRunning;

  var runOut = [];
  for (i = 0; i < this.running.length; i++) {
    j = this.running[i];
    runOut.push({
      id: j.id, interventions: j.interventions.slice(), scale: j.scale,
      steps: j.steps, seeds: j.seeds, cost: j.cost, wallHours: j.wallHours,
      launchedAt: j.launchedAt, etaAt: j.etaAt, progress: j.progress,
      hypothesis: j.hypothesis, predictedEffect: j.predictedEffect,
      ciLow: j.ciLow, ciHigh: j.ciHigh
    });
  }

  return {
    day: day, hour: hour, t: DAY_NAMES[day - 1] + ' ' + hhmm(hour), tick: this.tick++,
    computeUsed: round2(this.used),
    computeRemaining: round2(RULES.computeBudget - this.used),
    budgetPct: round2(100 * this.used / RULES.computeBudget),
    slotsUsed: runOut.length, slotsFree: RULES.slots - runOut.length,
    running: runOut, results: this.results.slice(),
    finished: false, readoutSubmitted: false
  };
};

function round2(x) { return Math.round(x * 100) / 100; }

/* ------------------------------------------------------------- the replayer */

function runWeek(sess) {
  var feed = [];
  var world = makeWorld(sess.events);
  Team.init({ world: world, lab: FakeLab, onMessage: function (m) { feed.push(m); } });

  var lab = new Lab(sess.script);
  var day, h;
  for (day = 1; day <= RULES.days; day++) {
    for (h = RULES.startHour; h < RULES.startHour + RULES.hoursPerDay; h += 0.25) {
      Team.tick(lab.state(day, round2(h)));
    }
  }
  return { feed: feed, teamFeed: Team.getFeed(), pending: Team.pending(), lab: lab };
}

/* ================================================================ WEEK A DATA
 * Every launch is a singleton, almost all of them tiny, the predictions are all
 * optimistic, the money goes early and goes on 300M, and the one intervention
 * another team claimed is never touched.
 * ========================================================================== */

var EVENTS_A = [
  { day: 1, hour: 9.25, from: 'OPS', tone: 'neutral',
    text: 'Allocation confirmed: 6,000 GPU-hours, 4 concurrent slots, expiring Friday 19:00. Unused hours do not roll over and cannot be traded.' },
  { day: 1, hour: 13, from: 'PEER', tone: 'neutral',
    text: 'Morning. I pulled last quarter\'s long-context numbers into the shared sheet if you want a prior. Fair warning, they are all 1.4B and the eval changed in March, so treat them as vibes.' },
  { day: 2, hour: 10, from: 'RIVAL', tone: 'neutral',
    text: '[halberd-internal] Sliding-window attention: +3.1 LCR@128k at 70M, 1 seed, 5k steps. Recommending it for the run. Cheap, clean, no downside observed.',
    claims: [{ intervention: 'sliding_window_attn', effect: 3.10, scale: '70m' }] },
  { day: 3, hour: 9.5, from: 'OPS', tone: 'warn',
    text: 'Cluster notice: rack 14 is drained for a firmware roll until 14:00. Expect elevated preemption on 300M and above. No compensation for lost jobs.' },
  { day: 3, hour: 15, from: 'PEER', tone: 'neutral',
    text: 'Yuki asked me the same thing she always asks: what would change your mind. I did not have an answer and it ruined my afternoon. Passing that on as a gift.' },
  { day: 4, hour: 11, from: 'RIVAL', tone: 'neutral',
    text: '[halberd-internal] Note: our doc-packing result did not reproduce at 1.4B. Withdrawing it from our recommendation. Sliding-window stands.' }
];

function hypA(s) { return s; }

var SCRIPT_A = [
  // Mon: three singletons, all 70M, all one seed, all fired off together.
  { day: 1, hour: 9.25, act: 'launch', id: 'j1', ivs: ['rope_scaling_v2'], scale: '70m', steps: 'std', seeds: 1,
    hyp: hypA('RoPE scaling v2 should help long-context retrieval, prior work saw a clear win'),
    pred: 5.00, pciLow: 3.00, pciHigh: 7.00, obs: 2.40, sigma: 1.80, status: 'ok' },
  { day: 1, hour: 9.25, act: 'launch', id: 'j2', ivs: ['qk_norm'], scale: '70m', steps: 'std', seeds: 1,
    hyp: hypA('QK-norm stabilises attention logits at long context, expect a modest gain'),
    pred: 3.00, pciLow: 1.50, pciHigh: 4.50, obs: 1.10, sigma: 1.80, status: 'ok' },
  { day: 1, hour: 9.5, act: 'launch', id: 'j3', ivs: ['mup_transfer'], scale: '70m', steps: 'std', seeds: 1,
    hyp: hypA('muP transfer should let the LR carry cleanly, big win expected on retrieval'),
    pred: 6.00, pciLow: 4.00, pciHigh: 8.00, obs: 0.20, sigma: 1.80, status: 'ok' },

  // Mon 11:15: extends QK-norm off a 30-minute-old single-seed reading.
  { day: 1, hour: 11.25, act: 'launch', id: 'j4', ivs: ['qk_norm'], scale: '70m', steps: 'long', seeds: 1,
    hyp: hypA('QK-norm looked positive at 10k steps, running it longer to confirm the trend'),
    pred: 2.50, pciLow: 1.00, pciHigh: 4.00, obs: 0.90, sigma: 1.27, status: 'ok' },

  // Mon 15:00: the same 300M cell, twice, identically, with nothing said about it.
  { day: 1, hour: 15, act: 'launch', id: 'j5', ivs: ['doc_packing_boundary'], scale: '300m', steps: 'long', seeds: 8,
    hyp: hypA('Doc packing boundaries at 300M, twenty thousand steps, eight seeds for a tight number'),
    pred: 2.00, pciLow: 1.00, pciHigh: 3.00, obs: 1.80, sigma: 0.30, status: 'ok' },
  { day: 1, hour: 15, act: 'launch', id: 'j6', ivs: ['doc_packing_boundary'], scale: '300m', steps: 'long', seeds: 8,
    hyp: hypA('Doc packing boundaries at 300M, twenty thousand steps, eight seeds, want a tight number'),
    pred: 2.00, pciLow: 1.00, pciHigh: 3.00, obs: 2.10, sigma: 0.30, status: 'ok' },

  // Tue 11:15: three more 300M burns, 2,160 GPU-hours in one click.
  { day: 2, hour: 11.25, act: 'launch', id: 'j7', ivs: ['long_ctx_data_mix'], scale: '300m', steps: 'long', seeds: 8,
    hyp: hypA('Long-context data mix at 300M, expecting the biggest single effect of the week'),
    pred: 3.50, pciLow: 2.00, pciHigh: 5.00, obs: 2.90, sigma: 0.30, status: 'ok' },
  { day: 2, hour: 11.25, act: 'launch', id: 'j8', ivs: ['z_loss_aux'], scale: '300m', steps: 'long', seeds: 8,
    hyp: hypA('Auxiliary z-loss should stabilise the tail of training and hold retrieval up'),
    pred: 1.00, pciLow: 0.20, pciHigh: 1.80, obs: 1.40, sigma: 0.30, status: 'ok' },
  { day: 2, hour: 11.25, act: 'launch', id: 'j9', ivs: ['lr_decay_late'], scale: '300m', steps: 'long', seeds: 8,
    hyp: hypA('Late LR decay, expecting a small positive, mostly running it to close the gap'),
    pred: 1.50, pciLow: 0.50, pciHigh: 2.50, obs: -0.60, sigma: 0.30, status: 'ok' },

  // Tue 16:30: kills the data-mix job at 88% because they got bored of waiting.
  { day: 2, hour: 16.5, act: 'kill', id: 'j7' }
];

/* ================================================================ WEEK B DATA
 * Staggered, real scale, combinations — and a different set of mistakes.
 * ========================================================================== */

var EVENTS_B = [
  { day: 1, hour: 9.25, from: 'OPS', tone: 'neutral',
    text: 'Allocation confirmed: 6,000 GPU-hours, 4 concurrent slots, expiring Friday 19:00. Unused hours do not roll over and cannot be traded.' },
  { day: 2, hour: 10, from: 'RIVAL', tone: 'neutral',
    text: '[halberd-internal] Sliding-window attention: +3.1 LCR@128k at 70M, 1 seed, 5k steps. Recommending it for the run. Cheap, clean, no downside observed.',
    claims: [{ intervention: 'sliding_window_attn', effect: 3.10, scale: '70m' }] },
  { day: 2, hour: 14, from: 'PEER', tone: 'neutral',
    text: 'Unrelated, but the 1.4B queue is basically empty this afternoon. If you were ever going to buy an expensive number, today is cheap in wall clock.' },
  { day: 4, hour: 9.5, from: 'OPS', tone: 'warn',
    text: 'Priority shift: inference-serving evals take precedence from 12:00 Thursday. Your slots are unaffected. Your queue position is not.' }
];

var SCRIPT_B = [
  // Mon 09:15: one careful 70M run, four seeds. Still comes back straddling zero.
  { day: 1, hour: 9.25, act: 'launch', id: 'b1', ivs: ['rope_scaling_v2'], scale: '70m', steps: 'std', seeds: 4,
    hyp: 'RoPE scaling v2 at 70M with four seeds, cheap read before committing anything larger',
    pred: 1.50, pciLow: 0.00, pciHigh: 3.00, obs: 1.20, sigma: 0.90, status: 'ok' },

  // Mon 11:15: the expensive, deliberate one.
  { day: 1, hour: 11.25, act: 'launch', id: 'b2', ivs: ['doc_packing_boundary'], scale: '1p4b', steps: 'std', seeds: 4,
    hyp: 'Doc packing boundaries at 1.4B, four seeds, aiming for an interval that excludes zero',
    pred: 2.20, pciLow: 1.20, pciHigh: 3.20, obs: 2.60, sigma: 0.40, status: 'ok' },

  // Tue 09:00: a combination built on the 70M RoPE reading, which straddles zero.
  //            It then dies at half its wall clock.
  { day: 2, hour: 9, act: 'launch', id: 'b3', ivs: ['rope_scaling_v2', 'qk_norm'], scale: '300m', steps: 'std', seeds: 2,
    hyp: 'RoPE v2 plus QK-norm together at 300M, expecting the effects to roughly add',
    pred: 3.00, pciLow: 1.50, pciHigh: 4.50, obs: 2.20, sigma: 0.85,
    status: 'failed', failAtFrac: 0.5, failReason: 'loss diverged (NaN at step ~4200)' },

  // Tue 12:00: carries QK-norm forward as if the dead job had told them something.
  { day: 2, hour: 12, act: 'launch', id: 'b4', ivs: ['qk_norm', 'z_loss_aux'], scale: '300m', steps: 'std', seeds: 2,
    hyp: 'QK-norm looked fine before the crash, pairing it with z-loss for stability at 300M',
    pred: 2.00, pciLow: 0.50, pciHigh: 3.50, obs: 1.90, sigma: 0.85, status: 'ok' },

  // Wed 09:00: Halberd's number, typed straight into the hypothesis, in a bundle.
  { day: 3, hour: 9, act: 'launch', id: 'b5', ivs: ['sliding_window_attn', 'rope_scaling_v2'], scale: '1p4b', steps: 'std', seeds: 4,
    hyp: 'Halberd measured +3.1 for sliding-window attention, stacking it with RoPE v2 at 1.4B',
    pred: 3.10, pciLow: 1.60, pciHigh: 4.60, obs: 0.30, sigma: 0.40, status: 'ok' },

  // Thu 09:00: 1,520 GPU-hours re-measuring a cell already known to sigma 0.40.
  { day: 4, hour: 9, act: 'launch', id: 'b6', ivs: ['doc_packing_boundary'], scale: '1p4b', steps: 'long', seeds: 4,
    hyp: 'Doc packing at 1.4B again, longer schedule, want to be really sure of this one',
    pred: 2.60, pciLow: 1.80, pciHigh: 3.40, obs: 2.45, sigma: 0.28, status: 'ok' }
];

var WEEK_A = { name: 'A', events: EVENTS_A, script: SCRIPT_A };
var WEEK_B = { name: 'B', events: EVENTS_B, script: SCRIPT_B };

/* ------------------------------------------------------------- assertions */

var failures = [], checks = 0;

function ok(cond, label, detail) {
  checks++;
  if (!cond) failures.push(label + (detail ? '  (' + detail + ')' : ''));
}

function triggerCounts(feed) {
  var c = {};
  feed.forEach(function (x) { if (x.kind === 'reactive') c[x.trigger] = (c[x.trigger] || 0) + 1; });
  return c;
}

var PRIO = { LEAD: 1, OPS: 2, RIVAL: 3, PEER: 4 };

function checkCommon(tag, sess, run) {
  var feed = run.feed;
  var counts = triggerCounts(feed);
  var i, j;

  ok(run.teamFeed.length === feed.length, tag + ': getFeed() matches the onMessage stream',
     run.teamFeed.length + ' vs ' + feed.length);

  // --- nothing fires twice
  Object.keys(counts).forEach(function (id) {
    ok(counts[id] === 1, tag + ': no trigger fires twice: ' + id, 'count=' + counts[id]);
  });

  // --- at most one reactive message per tick
  var perTick = {};
  feed.forEach(function (x) {
    if (x.kind !== 'reactive') return;
    var k = x.day + '@' + x.hour;
    perTick[k] = (perTick[k] || 0) + 1;
  });
  Object.keys(perTick).forEach(function (k) {
    ok(perTick[k] <= 1, tag + ': at most one reactive message on tick ' + k, 'got ' + perTick[k]);
  });

  // --- priority: a lower-priority message never overtakes a higher-priority one
  //     that was already waiting, and equal priorities go out in detection order.
  var react = feed.filter(function (x) { return x.kind === 'reactive'; });
  for (i = 0; i < react.length; i++) {
    for (j = i + 1; j < react.length; j++) {
      var early = react[i], late = react[j];          // early was EMITTED first
      if (late.queuedAt > early.queuedAt) continue;   // it was not yet waiting
      ok(PRIO[late.from] >= PRIO[early.from],
         tag + ': queue order LEAD>OPS>RIVAL>PEER holds for ' + late.trigger + ' vs ' + early.trigger,
         late.from + '(q' + late.queuedAt + ') emitted after ' + early.from + '(q' + early.queuedAt + ')');
      if (PRIO[late.from] === PRIO[early.from]) {
        ok(late.queuedAt >= early.queuedAt,
           tag + ': equal-priority messages drain in detection order: ' + late.trigger);
      }
    }
  }

  ok(run.pending === 0, tag + ': reactive queue fully drained by Friday close', 'pending=' + run.pending);

  // --- scripted events: all fired, once, never early
  var sched = feed.filter(function (x) { return x.kind === 'scripted'; });
  ok(sched.length === sess.events.length, tag + ': all scripted events fired',
     sched.length + '/' + sess.events.length);
  sess.events.forEach(function (e) {
    var hits = sched.filter(function (x) { return x.text === e.text; });
    ok(hits.length === 1, tag + ': scripted event fired once: d' + e.day + ' ' + e.hour,
       'count=' + hits.length);
    if (hits.length) {
      ok(hits[0].day > e.day || (hits[0].day === e.day && hits[0].hour >= e.hour),
         tag + ': scripted event not early: d' + e.day + ' ' + e.hour);
      ok(hits[0].from === e.from, tag + ': scripted event keeps its voice: ' + e.from);
    }
  });

  // --- gates: once each, exactly on the specified day/hour, prompt verbatim
  var gates = feed.filter(function (x) { return x.kind === 'gate'; });
  ok(gates.length === 3, tag + ': all three gates fired', 'got ' + gates.length);
  Team.GATES.forEach(function (g) {
    var hits = gates.filter(function (x) { return x.gate === g.id; });
    ok(hits.length === 1, tag + ': gate fired once: ' + g.id, 'count=' + hits.length);
    if (!hits.length) return;
    ok(hits[0].text === g.prompt, tag + ': gate prompt is verbatim from the spec: ' + g.id,
       JSON.stringify(hits[0].text));
    ok(hits[0].day === g.day && Math.abs(hits[0].hour - g.hour) < 1e-9,
       tag + ': gate fires at the specified day/hour: ' + g.id,
       'got d' + hits[0].day + ' ' + hits[0].hour + ', want d' + g.day + ' ' + g.hour);
    ok(hits[0].from === 'LEAD', tag + ': gate comes from the lead: ' + g.id);
    ok(hits[0].title === g.title, tag + ': gate carries its title: ' + g.id);
  });

  // --- message shape
  var VOICES = { LEAD: 1, OPS: 1, PEER: 1, RIVAL: 1 };
  var TONES = { neutral: 1, pressure: 1, warn: 1, praise: 1, alarm: 1 };
  feed.forEach(function (x, ix) {
    ok(typeof x.day === 'number' && typeof x.hour === 'number' && typeof x.t === 'string',
       tag + ': msg[' + ix + '] has day/hour/t');
    ok(!!VOICES[x.from], tag + ': msg[' + ix + '] valid from: ' + x.from);
    ok(typeof x.name === 'string' && x.name.length > 0, tag + ': msg[' + ix + '] has a name');
    ok(typeof x.text === 'string' && x.text.length > 0, tag + ': msg[' + ix + '] has text');
    ok(!!TONES[x.tone], tag + ': msg[' + ix + '] valid tone: ' + x.tone);
    ok(x.text.indexOf('{') < 0, tag + ': msg[' + ix + '] has no unfilled placeholder', x.text);
    ok(x.name === Team.NAMES[x.from], tag + ': msg[' + ix + '] uses the cast name for ' + x.from);
  });

  // --- ordering
  for (i = 1; i < feed.length; i++) {
    var a = feed[i - 1], b = feed[i];
    ok(b.day > a.day || (b.day === a.day && b.hour >= a.hour),
       tag + ': feed is time-ordered at index ' + i);
  }
  return counts;
}

/* ---- WEEK A ---------------------------------------------------------------- */

var runA = runWeek(WEEK_A);
var countsA = checkCommon('A', WEEK_A, runA);

[
  'all_small_scale', 'no_stagger', 'first_result', 'one_seed_acted',
  'predict_miss_2sigma', 'optimism_bias', 'slot_idle', 'dup_no_replication_note',
  'budget40_no_scale', 'pace_early_burn', 'kill_late', 'rival_ignored',
  'no_combo_thursday', 'no_time_for_scale', 'untested_thursday',
  'small_scale_only_friday', 'ci_zero_treated_real', 'rival_pressure'
].forEach(function (id) {
  ok(countsA[id] === 1, 'A: trigger fired exactly once: ' + id, 'count=' + (countsA[id] || 0));
});

['never_replicated', 'remeasure_tight', 'failed_job_carried', 'rival_borrowed',
 'precision_praise'].forEach(function (id) {
  ok(!countsA[id], 'A: trigger correctly did NOT fire: ' + id);
});

function at(run, trigger) {
  var hit = run.feed.filter(function (x) { return x.trigger === trigger; })[0];
  return hit || null;
}

var mSmall = at(runA, 'all_small_scale');
ok(mSmall && mSmall.day === 1, 'A: the small-scale warning lands on Monday, while it can still be acted on',
   mSmall ? 'd' + mSmall.day : 'missing');

var mSeed = at(runA, 'one_seed_acted');
ok(mSeed && mSeed.from === 'LEAD' && mSeed.day === 1,
   'A: the single-seed challenge comes from Yuki, on the day it happened');

var mPace = at(runA, 'pace_early_burn');
ok(mPace && mPace.day <= 2, 'A: the pacing warning expires rather than surfacing after Tuesday',
   mPace ? 'd' + mPace.day : 'missing');

var mKill = at(runA, 'kill_late');
ok(mKill && mKill.from === 'OPS' && mKill.day === 2 && mKill.hour <= 17.5,
   'A: the kill notice reaches the feed within an hour or not at all',
   mKill ? 'd' + mKill.day + ' ' + mKill.hour : 'missing');

var mFri = at(runA, 'small_scale_only_friday');
ok(mFri && mFri.day === 5 && mFri.hour < 16,
   'A: the Friday scale challenge arrives BEFORE the readout gate',
   mFri ? 'd' + mFri.day + ' ' + mFri.hour : 'missing');

var mCi = at(runA, 'ci_zero_treated_real');
ok(mCi && mCi.text.indexOf('RoPE scaling v2') >= 0,
   'A: the zero-crossing challenge names the intervention it is about');

// The one Halberd claimed is the one that never got run.
var mRiv = at(runA, 'rival_ignored');
ok(mRiv && mRiv.text.indexOf('Sliding-window attention') >= 0,
   'A: the ignored-rival-claim message names the claimed intervention');

/* ---- WEEK B ---------------------------------------------------------------- */

var runB = runWeek(WEEK_B);
var countsB = checkCommon('B', WEEK_B, runB);

[
  'first_result', 'precision_praise', 'ci_zero_treated_real', 'failed_job_carried',
  'rival_borrowed', 'remeasure_tight', 'never_replicated', 'predict_miss_2sigma'
].forEach(function (id) {
  ok(countsB[id] === 1, 'B: trigger fired exactly once: ' + id, 'count=' + (countsB[id] || 0));
});

['all_small_scale', 'no_stagger', 'no_combo_thursday', 'dup_no_replication_note',
 'pace_early_burn', 'budget40_no_scale', 'kill_late', 'no_time_for_scale'].forEach(function (id) {
  ok(!countsB[id], 'B: trigger correctly did NOT fire: ' + id);
});

var mBorrow = at(runB, 'rival_borrowed');
ok(mBorrow && mBorrow.from === 'LEAD' && mBorrow.text.indexOf('Sliding-window attention') >= 0,
   'B: the borrowed-claim challenge is Yuki, and it names the claim');
ok(mBorrow && mBorrow.day === 3, 'B: it fires on the launch that leaned on the claim',
   mBorrow ? 'd' + mBorrow.day : 'missing');

var mFail = at(runB, 'failed_job_carried');
ok(mFail && mFail.text.indexOf('b3') >= 0 && mFail.text.indexOf('QK-norm') >= 0,
   'B: the dead-job challenge names the job that died and what was carried forward');

var mRem = at(runB, 'remeasure_tight');
ok(mRem && mRem.day === 4, 'B: the re-measurement challenge fires at launch, not at result',
   mRem ? 'd' + mRem.day : 'missing');

var mRep = at(runB, 'never_replicated');
ok(mRep && mRep.day === 5 && mRep.hour < 16,
   'B: the replication regret arrives before the readout, not after');

/* ---- the hard constraint --------------------------------------------------- */

ok(revealCalled === false, 'team.js never called world.reveal()');
ok(truthTouched === false, 'team.js never touched world._t');

/* ---- determinism ----------------------------------------------------------- */

var runA2 = runWeek(WEEK_A);
ok(JSON.stringify(runA2.feed) === JSON.stringify(runA.feed),
   'two identical runs produce byte-identical feeds');

// A different scenario draws different words from the same triggers.
var ALT = { name: 'ALT', events: EVENTS_A, script: SCRIPT_A };
var origMake = makeWorld;
function reactiveText(run) {
  return run.feed.filter(function (x) { return x.kind === 'reactive'; })
                 .map(function (x) { return x.text; }).join('|');
}
// Re-run week A under a different scenario key by mutating the world factory once.
makeWorld = function (events) {
  var w = origMake(events);
  w.scenario.org = 'Kestrel Research';
  w.scenario.question = 'Which changes survive to 400B?';
  return w;
};
var runAlt = runWeek(ALT);
makeWorld = origMake;

ok(reactiveText(runAlt) !== reactiveText(runA), 'a different scenario draws different phrasings');
ok(triggerCounts(runAlt.feed).kill_late === 1,
   'the same week still fires the same triggers under a different scenario');

/* ---------------------------------------------------------------- printing */

function wrap(s, width, indent) {
  var words = String(s).split(/\s+/), lines = [], cur = '';
  words.forEach(function (w) {
    if (!cur.length) cur = w;
    else if ((cur + ' ' + w).length <= width) cur += ' ' + w;
    else { lines.push(cur); cur = w; }
  });
  if (cur.length) lines.push(cur);
  return lines.map(function (l, i) { return (i ? indent : '') + l; }).join('\n');
}

function padR(s, n) { s = String(s); while (s.length < n) s += ' '; return s; }

function printFeed(title, run) {
  console.log('');
  console.log('================================================================================');
  console.log(' ' + title);
  console.log('================================================================================');
  run.feed.forEach(function (x) {
    if (x.kind === 'gate') { console.log(''); console.log('  ### GATE — ' + x.title); }
    var head = '  ' + padR('[' + x.t + ']', 12) + padR(x.from, 6) +
               padR(x.from === 'RIVAL' ? '' : x.name, 19) + '| ';
    console.log(head + wrap(x.text, 88, '                                             '));
  });
  console.log('');
  console.log(' reactive triggers, in the order they went out:');
  run.feed.forEach(function (x) {
    if (x.kind === 'reactive') {
      console.log('   ' + padR(x.t, 11) + padR(x.from, 6) + padR(x.tone, 9) + x.trigger);
    }
  });
  console.log('');
  console.log(' compute spent ' + Math.round(run.lab.used) + ' / ' + RULES.computeBudget +
              '   jobs launched ' + Object.keys(run.lab.jobs).length +
              '   results ' + run.lab.results.length +
              '   messages ' + run.feed.length);
}

printFeed('WEEK A — everything at 70M, one seed, money gone by Tuesday', runA);
printFeed('WEEK B — real scale, real combinations, borrowed conviction', runB);

console.log('');
console.log('--------------------------------------------------------------------------------');
if (failures.length) {
  console.log(' FAIL — ' + failures.length + ' of ' + checks + ' checks failed:');
  failures.forEach(function (f) { console.log('   x ' + f); });
  console.log('');
  process.exit(1);
} else {
  console.log(' PASS — all ' + checks + ' checks passed.');
  console.log('');
  process.exit(0);
}
