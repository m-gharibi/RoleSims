#!/usr/bin/env node
/* ==========================================================================
 * tools/test_lab.js — self-contained unit tests for sim/lab.js
 *
 *   node tools/test_lab.js
 *
 * Zero dependencies. Loads lab.js exactly the way a <script> tag would: we
 * hand it a `window` and it attaches itself to it. The SIM_WORLD here is a
 * SYNTHETIC fixture built to the SPEC §1 schema (base64 `_t` + reveal()), so
 * these tests never touch data/world.js.
 * ========================================================================== */
"use strict";

var path = require("path");
var LAB_PATH = path.join(__dirname, "..", "sim", "lab.js");

global.window = global;
require(LAB_PATH);
var Lab = global.window.Lab;

/* ---------------------------------------------------------------- utils - */

var PASS = 0, FAIL = 0, FAILURES = [];

function test(name, fn) {
  try {
    fn();
    console.log("  PASS  " + name);
    PASS++;
  } catch (e) {
    console.log("  FAIL  " + name);
    console.log("        " + (e && e.message ? e.message : String(e)));
    FAIL++;
    FAILURES.push(name + " :: " + (e && e.message ? e.message : String(e)));
  }
}

function ok(cond, msg) { if (!cond) throw new Error(msg || "expected truthy"); }
function eq(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error((msg || "value mismatch") +
      "\n          expected: " + JSON.stringify(expected) +
      "\n          actual:   " + JSON.stringify(actual));
  }
}
function deq(actual, expected, msg) {
  var a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) {
    throw new Error((msg || "deep mismatch") +
      "\n          expected: " + b +
      "\n          actual:   " + a);
  }
}
function near(actual, expected, tol, msg) {
  tol = tol == null ? 1e-9 : tol;
  if (!(Math.abs(actual - expected) <= tol)) {
    throw new Error((msg || "value mismatch") +
      "\n          expected: " + expected + " (+/- " + tol + ")" +
      "\n          actual:   " + actual);
  }
}

/* ------------------------------------------------ synthetic SIM_WORLD --- */

var NREF = 7.0e7;

/* Ground truth chosen so every scoring answer is hand-computable.
 *   at the run scale (7e10):  (Nref/N) = 1e-3
 *     i1 = 3.0 + 2.0*1e-3 = 3.002    i5 = 0.25
 *     i2 = 2.0                       i6 = 0.10
 *     i3 = 1.0                       i7 = -0.01   (a regression)
 *     i4 = 0.5                       i8 = -2.00   (a big regression)
 *   interaction i5+i6 = +6.0  =>  best <=4 set is {i1,i2,i5,i6} = 11.352
 *   at 70M (Nref/N = 1): i1 = 5.0, the rest unchanged.
 */
var TRUTH = {
  effects: {
    i1: { c: 3.00, a: 2.0, gamma: 1.0 },
    i2: { c: 2.00, a: 0.0, gamma: 1.0 },
    i3: { c: 1.00, a: 0.0, gamma: 1.0 },
    i4: { c: 0.50, a: 0.0, gamma: 1.0 },
    i5: { c: 0.25, a: 0.0, gamma: 1.0 },
    i6: { c: 0.10, a: 0.0, gamma: 1.0 },
    i7: { c: -0.01, a: 0.0, gamma: 1.0 },
    i8: { c: -2.00, a: 0.0, gamma: 1.0 }
  },
  interactions: [
    { pair: ["i5", "i6"], delta: 6.0 },
    { pair: ["i7", "i8"], delta: 1.0 }
  ],
  notes: {
    i1: "SPOILER_SENTINEL i1 helps everywhere.",
    i2: "SPOILER_SENTINEL i2 is flat in scale.",
    i3: "SPOILER_SENTINEL i3 is small.",
    i4: "SPOILER_SENTINEL i4 is smaller.",
    i5: "SPOILER_SENTINEL i5 only pays off with i6.",
    i6: "SPOILER_SENTINEL i6 only pays off with i5.",
    i7: "SPOILER_SENTINEL i7 is a mild regression.",
    i8: "SPOILER_SENTINEL i8 is a bad regression."
  }
};

var REVEAL_CALLS = 0;

function makeWorld(truth) {
  var t = truth || TRUTH;
  var blob = Buffer.from(JSON.stringify(t), "utf8").toString("base64");
  var ivs = [];
  var ids = ["i1", "i2", "i3", "i4", "i5", "i6", "i7", "i8"];
  for (var i = 0; i < ids.length; i++) {
    ivs.push({
      id: ids[i], name: "Intervention " + ids[i].toUpperCase(),
      family: (i % 2 ? "data" : "architecture"),
      desc: "synthetic candidate " + ids[i], author: "Test Harness"
    });
  }
  return {
    scenario: {
      org: "Testlab", team: "pretraining", question: "Which four go in the run?",
      deadline: "Fri 16:00", brief: "A synthetic brief.",
      metric: { name: "LCR@128k", units: "points", desc: "synthetic metric" },
      priorEvidence: [{ text: "someone believes something", source: "internal" }],
      runScale: 7.0e10,
      maxInterventions: 4
    },
    interventions: ivs,
    scales: [
      { id: "70m", params: 7.0e7, label: "70M", computeHours: 12, wallHours: 1.5, sigma: 1.80 },
      { id: "300m", params: 3.0e8, label: "300M", computeHours: 45, wallHours: 3.0, sigma: 1.20 },
      { id: "1p4b", params: 1.4e9, label: "1.4B", computeHours: 190, wallHours: 7.0, sigma: 0.80 },
      { id: "7b", params: 7.0e9, label: "7B", computeHours: 850, wallHours: 18.0, sigma: 0.50 }
    ],
    stepOptions: [
      { id: "short", label: "5k steps", mult: 0.5 },
      { id: "std", label: "10k steps", mult: 1.0 },
      { id: "long", label: "20k steps", mult: 2.0 }
    ],
    events: [],
    _t: blob,
    reveal: function () {
      REVEAL_CALLS++;
      return JSON.parse(Buffer.from(this._t, "base64").toString("utf8"));
    }
  };
}

/* independent re-implementation of the truth model, for cross-checking */
function specEffect(id, N, truth) {
  var e = (truth || TRUTH).effects[id];
  return e.c + e.a * Math.pow(NREF / N, e.gamma);
}
function specTrue(ids, N, truth) {
  var t = truth || TRUTH, s = 0, i;
  for (i = 0; i < ids.length; i++) s += specEffect(ids[i], N, t);
  for (i = 0; i < t.interactions.length; i++) {
    var p = t.interactions[i].pair;
    if (ids.indexOf(p[0]) >= 0 && ids.indexOf(p[1]) >= 0) s += t.interactions[i].delta;
  }
  return s;
}

var HYP = "I think this intervention helps long-context recall at every scale.";

function boot(seed, truth) {
  Lab.destroy();
  Lab.init({ world: makeWorld(truth), seed: seed === undefined ? 20260816 : seed });
  return Lab;
}

function req(o) {
  var r = {
    interventions: o.interventions || ["i1"],
    scale: o.scale || "70m",
    steps: o.steps || "std",
    seeds: o.seeds === undefined ? 1 : o.seeds,
    hypothesis: o.hypothesis === undefined ? HYP : o.hypothesis,
    predictedEffect: o.predictedEffect === undefined ? 2 : o.predictedEffect,
    ciLow: o.ciLow === undefined ? 0 : o.ciLow,
    ciHigh: o.ciHigh === undefined ? 4 : o.ciHigh
  };
  return r;
}

/* RULES are a live object; some tests need a friendlier cluster. */
function withRules(patch, fn) {
  var saved = {}, k;
  for (k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) {
    saved[k] = Lab.RULES[k];
    Lab.RULES[k] = patch[k];
  }
  try { return fn(); }
  finally { for (k in saved) if (Object.prototype.hasOwnProperty.call(saved, k)) Lab.RULES[k] = saved[k]; }
}

/* ======================================================================== */
console.log("");
console.log("ML Researcher Sim — lab unit tests");
console.log("lab: " + LAB_PATH);
console.log("");

/* -- 0. constants + wiring ------------------------------------------------ */

console.log("[ constants and wiring ]");

test("RULES match the spec exactly", function () {
  var R = Lab.RULES;
  eq(R.computeBudget, 6000, "computeBudget");
  eq(R.slots, 4, "slots");
  eq(R.days, 5, "days");
  eq(R.hoursPerDay, 10, "hoursPerDay");
  eq(R.startHour, 9, "startHour");
  eq(R.maxInterventions, 4, "maxInterventions");
  eq(R.failureBase, 0.10, "failureBase");
  eq(R.failureScaleMult["70m"], 0.6, "failureScaleMult 70m");
  eq(R.failureScaleMult["300m"], 0.9, "failureScaleMult 300m");
  eq(R.failureScaleMult["1p4b"], 1.3, "failureScaleMult 1p4b");
  eq(R.failureScaleMult["7b"], 2.0, "failureScaleMult 7b");
  eq(R.killRefund, 0.5, "killRefund");
  eq(R.minHypothesisChars, 20, "minHypothesisChars");
});

test("init decodes the base64 truth via world.reveal(), exactly once", function () {
  REVEAL_CALLS = 0;
  boot();
  eq(REVEAL_CALLS, 1, "reveal() call count");
  // and a pile of API traffic must not call it again
  Lab.design(req({}));
  Lab.launch(req({}));
  Lab.advance(3);
  Lab.getState();
  eq(REVEAL_CALLS, 1, "reveal() must be called once, at init");
});

test("default seed is 20260816 and init reports it", function () {
  Lab.destroy();
  Lab.init({ world: makeWorld() });
  eq(Lab.getState().seed, 20260816, "default seed");
});

test("fresh state is Mon 09:00 with the full budget", function () {
  var s = boot().getState !== undefined ? Lab.getState() : null;
  eq(s.day, 1, "day"); eq(s.hour, 9, "hour"); eq(s.t, "Mon 09:00", "t");
  eq(s.tick, 0, "tick");
  eq(s.computeUsed, 0, "computeUsed");
  eq(s.computeRemaining, 6000, "computeRemaining");
  eq(s.budgetPct, 0, "budgetPct");
  eq(s.slotsUsed, 0, "slotsUsed"); eq(s.slotsFree, 4, "slotsFree");
  eq(s.finished, false, "finished"); eq(s.readoutSubmitted, false, "readoutSubmitted");
  eq(s.deadline.t, "Fri 16:00", "deadline label");
});

/* -- 1. the cost / wall / sigma arithmetic -------------------------------- */

console.log("");
console.log("[ cost, wall-clock and sigma ]");

test("cost/wallHours/sigma match hand-computed values (1.4B, long, 3 seeds)", function () {
  boot();
  var d = Lab.design(req({ interventions: ["i1"], scale: "1p4b", steps: "long", seeds: 3 }));
  ok(d.ok, "design ok");
  // cost = 190 * 2.0 * 3 = 1140
  eq(d.cost, 1140, "cost");
  // wall = 7.0 * 2.0 = 14 (seeds do NOT add wall time)
  eq(d.wallHours, 14, "wallHours");
  // sigma = 0.80 / sqrt(3) / sqrt(2) = 0.3265986...
  near(d.sigma, 0.80 / Math.sqrt(3) / Math.sqrt(2), 1e-6, "sigma");
  near(d.ci95, 1.96 * d.sigma, 1e-4, "95% half-width");
});

test("cost/wall/sigma for a fractional-cost design (300M, short, 1 seed)", function () {
  boot();
  var d = Lab.design(req({ scale: "300m", steps: "short", seeds: 1 }));
  eq(d.cost, 22.5, "cost 45*0.5*1");
  eq(d.wallHours, 1.5, "wall 3.0*0.5");
  near(d.sigma, 1.20 / Math.sqrt(0.5), 1e-6, "sigma 1.2/sqrt(1)/sqrt(0.5)");
});

test("every (scale, steps, seeds) combination follows the three formulas", function () {
  boot();
  var W = Lab.getWorld();
  for (var a = 0; a < W.scales.length; a++) {
    for (var b = 0; b < W.stepOptions.length; b++) {
      for (var n = 1; n <= 8; n++) {
        var sc = W.scales[a], st = W.stepOptions[b];
        var d = Lab.design(req({ scale: sc.id, steps: st.id, seeds: n }));
        near(d.cost, sc.computeHours * st.mult * n, 1e-6, "cost " + sc.id + "/" + st.id + "/" + n);
        near(d.wallHours, sc.wallHours * st.mult, 1e-6, "wall " + sc.id + "/" + st.id);
        near(d.sigma, sc.sigma / Math.sqrt(n) / Math.sqrt(st.mult), 1e-6, "sigma " + sc.id + "/" + st.id + "/" + n);
      }
    }
  }
});

test("seeds cut sigma as 1/sqrt(n), cost linearly, and wall-clock NOT AT ALL", function () {
  boot();
  var base = Lab.design(req({ scale: "1p4b", steps: "std", seeds: 1 }));
  var seedCounts = [1, 2, 4, 8, 9, 16];
  for (var i = 0; i < seedCounts.length; i++) {
    var n = seedCounts[i];
    var d = Lab.design(req({ scale: "1p4b", steps: "std", seeds: n }));
    near(d.sigma, base.sigma / Math.sqrt(n), 1e-6, "sigma with " + n + " seeds");
    near(d.cost, base.cost * n, 1e-6, "cost with " + n + " seeds");
    eq(d.wallHours, base.wallHours, "wallHours must not move with " + n + " seeds");
    eq(d.etaDay, base.etaDay, "etaDay must not move with seeds");
    eq(d.etaHour, base.etaHour, "etaHour must not move with seeds");
  }
  // 4 seeds must halve sigma exactly
  near(Lab.design(req({ scale: "70m", seeds: 4 })).sigma, 1.80 / 2, 1e-9, "4 seeds halves sigma");
});

test("steps multiplier moves cost, wall AND sigma together", function () {
  boot();
  var s = Lab.design(req({ scale: "70m", steps: "short", seeds: 1 }));
  var m = Lab.design(req({ scale: "70m", steps: "std", seeds: 1 }));
  var l = Lab.design(req({ scale: "70m", steps: "long", seeds: 1 }));
  near(s.cost, 6, 1e-9, "short cost"); near(m.cost, 12, 1e-9); near(l.cost, 24, 1e-9);
  near(s.wallHours, 0.75, 1e-9, "short wall"); near(m.wallHours, 1.5, 1e-9); near(l.wallHours, 3, 1e-9);
  near(l.sigma, 1.80 / Math.sqrt(2), 1e-6, "long sigma");
  near(s.sigma, 1.80 / Math.sqrt(0.5), 1e-6, "short sigma");
});

test("failure probability formula, capped at 0.45", function () {
  boot();
  near(Lab.failureProb("70m", 1.0), 0.06, 1e-9, "70m std");
  near(Lab.failureProb("300m", 0.5), 0.045, 1e-9, "300m short");
  near(Lab.failureProb("1p4b", 2.0), 0.26, 1e-9, "1p4b long");
  near(Lab.failureProb("7b", 2.0), 0.40, 1e-9, "7b long");
  withRules({ failureBase: 0.5 }, function () {
    near(Lab.failureProb("7b", 2.0), 0.45, 1e-9, "cap");
  });
});

/* -- 2. clock and ETA ----------------------------------------------------- */

console.log("");
console.log("[ clock, ETA and the deadline ]");

test("the clock maps elapsed lab-hours onto day/hour/label", function () {
  boot();
  eq(Lab.stamp(0).t, "Mon 09:00");
  eq(Lab.stamp(1.5).t, "Mon 10:30");
  eq(Lab.stamp(9.75).t, "Mon 18:45");
  eq(Lab.stamp(10).t, "Tue 09:00");
  eq(Lab.stamp(10).day, 2);
  eq(Lab.stamp(24.25).t, "Wed 13:15");
  eq(Lab.stamp(47).t, "Fri 16:00");
});

test("step() is 15 minutes and the tick counter follows", function () {
  boot();
  Lab.step();
  var s = Lab.getState();
  eq(s.t, "Mon 09:15", "one tick"); eq(s.tick, 1, "tick 1"); eq(s.hour, 9.25, "hour");
  for (var i = 0; i < 7; i++) Lab.step();
  s = Lab.getState();
  eq(s.t, "Mon 11:00", "eight ticks"); eq(s.tick, 8, "tick 8");
});

test("design() reports the ETA of the job, crossing day boundaries", function () {
  boot();
  var d = Lab.design(req({ scale: "7b", steps: "long", seeds: 1 }));
  eq(d.wallHours, 36, "36 lab-hours");
  eq(d.etaDay, 4, "etaDay");           // 36h = 3 full days + 6h
  eq(d.etaHour, 15, "etaHour");
  eq(d.etaT, "Thu 15:00", "etaT");
  ok(d.beforeDeadline, "still fits");
});

test("advance() cannot run past Friday's readout, and fires the deadline event", function () {
  boot();
  var fired = 0;
  Lab.on("deadline", function () { fired++; });
  Lab.advance(1000);
  var s = Lab.getState();
  eq(s.t, "Fri 16:00", "clamped to the deadline");
  eq(s.finished, true, "finished");
  eq(fired, 1, "deadline fired once");
  eq(s.hoursToDeadline, 0, "no hours left");
});

/* -- 3. design() is pure -------------------------------------------------- */

console.log("");
console.log("[ design() purity ]");

test("design() has no side effects on state", function () {
  boot();
  Lab.launch(req({ scale: "70m" }));
  Lab.advance(0.5);
  var before = JSON.stringify(Lab.getState());
  for (var i = 0; i < 100; i++) {
    Lab.design(req({ interventions: ["i1", "i2"], scale: "7b", steps: "long", seeds: (i % 8) + 1 }));
    Lab.design(req({ interventions: ["i5"], scale: "300m", steps: "short", seeds: 1 }));
    Lab.design({ interventions: [], scale: "70m" });          // rejected designs too
    Lab.design({ interventions: ["i1"], scale: "nope" });
  }
  eq(JSON.stringify(Lab.getState()), before, "state must be untouched by design()");
});

test("design() consumes NO randomness — 400 calls cannot perturb a later launch", function () {
  function session(withDesigns) {
    boot(20260816);
    if (withDesigns) {
      for (var i = 0; i < 400; i++) {
        Lab.design(req({ interventions: ["i1", "i7"], scale: "1p4b", steps: "long", seeds: (i % 16) + 1 }));
      }
    }
    Lab.launch(req({ interventions: ["i1"], scale: "70m", steps: "std", seeds: 1 }));
    Lab.advance(2);
    if (withDesigns) { for (var j = 0; j < 400; j++) Lab.design(req({ scale: "7b" })); }
    Lab.launch(req({ interventions: ["i5", "i6"], scale: "300m", steps: "long", seeds: 2 }));
    Lab.advance(8);
    return JSON.stringify(Lab.getResults());
  }
  var a = session(false), b = session(true);
  eq(b, a, "the PRNG stream must be identical with and without design() calls");
});

/* -- 4. determinism ------------------------------------------------------- */

console.log("");
console.log("[ determinism ]");

function scriptedSession(seed) {
  boot(seed);
  Lab.launch(req({ interventions: ["i1"], scale: "70m", steps: "std", seeds: 2, predictedEffect: 4, ciLow: 2, ciHigh: 6 }));
  Lab.launch(req({ interventions: ["i2", "i3"], scale: "300m", steps: "short", seeds: 1, predictedEffect: 3, ciLow: 1, ciHigh: 5 }));
  Lab.advance(2);
  Lab.launch(req({ interventions: ["i5", "i6"], scale: "1p4b", steps: "std", seeds: 4, predictedEffect: 6, ciLow: 4, ciHigh: 8 }));
  Lab.launch(req({ interventions: ["i7"], scale: "1p4b", steps: "long", seeds: 1, predictedEffect: 0, ciLow: -2, ciHigh: 2 }));
  Lab.advance(3);
  var st = Lab.getState();
  if (st.running.length) Lab.kill(st.running[0].id);
  Lab.advance(6);
  Lab.launch(req({ interventions: ["i4"], scale: "7b", steps: "std", seeds: 2, predictedEffect: 1, ciLow: -1, ciHigh: 3 }));
  Lab.advance(40);
  var score = Lab.submitReadout({ interventions: ["i1", "i2", "i5", "i6"], confidence: 70, rationale: "the scaling curves" });
  return JSON.stringify({ results: Lab.getResults(), score: score, state: Lab.getState() });
}

test("the same seed replays a whole session byte-identically", function () {
  var a = scriptedSession(20260816);
  var b = scriptedSession(20260816);
  eq(b, a, "identical seed => identical session");
  ok(a.length > 500, "the session actually produced something");
});

test("a different seed produces a different session", function () {
  var a = scriptedSession(20260816);
  var b = scriptedSession(777);
  ok(a !== b, "seed 777 must not replay seed 20260816");
});

test("the default seed is used when none is given, and replays", function () {
  Lab.destroy(); Lab.init({ world: makeWorld() });
  Lab.launch(req({ scale: "70m", seeds: 3 })); Lab.advance(3);
  var a = JSON.stringify(Lab.getResults());
  var b = scriptedSessionFirstResult(20260816);
  function scriptedSessionFirstResult(seed) {
    boot(seed);
    Lab.launch(req({ scale: "70m", seeds: 3 })); Lab.advance(3);
    return JSON.stringify(Lab.getResults());
  }
  eq(a, b, "no-seed init must equal seed 20260816");
});

/* -- 5. launch validation and rejections ---------------------------------- */

console.log("");
console.log("[ rejections ]");

test('"Pick at least one intervention"', function () {
  boot();
  eq(Lab.launch(req({ interventions: [] })).error, "Pick at least one intervention");
  eq(Lab.design({ interventions: [], scale: "70m" }).error, "Pick at least one intervention");
  eq(Lab.design({ interventions: [], scale: "70m" }).ok, false);
});

test('"Hypothesis required" below minHypothesisChars', function () {
  boot();
  eq(Lab.launch(req({ hypothesis: "" })).error, "Hypothesis required");
  eq(Lab.launch(req({ hypothesis: "too short" })).error, "Hypothesis required");
  eq(Lab.launch(req({ hypothesis: "                                 " })).error, "Hypothesis required");
  eq(Lab.launch(req({ hypothesis: "12345678901234567890" })).ok, true, "exactly 20 chars is enough");
});

test('"Predicted effect required" for a missing number or an inverted CI', function () {
  boot();
  // raw requests: the req() helper would fill the defaults back in
  function raw(o) {
    var r = { interventions: ["i1"], scale: "70m", steps: "std", seeds: 1, hypothesis: HYP };
    for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) r[k] = o[k];
    return r;
  }
  eq(Lab.launch(raw({ ciLow: 0, ciHigh: 4 })).error, "Predicted effect required", "no prediction at all");
  eq(Lab.launch(raw({ predictedEffect: NaN, ciLow: 0, ciHigh: 4 })).error, "Predicted effect required");
  eq(Lab.launch(raw({ predictedEffect: "banana", ciLow: 0, ciHigh: 4 })).error, "Predicted effect required");
  eq(Lab.launch(raw({ predictedEffect: Infinity, ciLow: 0, ciHigh: 4 })).error, "Predicted effect required");
  eq(Lab.launch(raw({ predictedEffect: 2 })).error, "Predicted effect required", "no CI");
  eq(Lab.launch(raw({ predictedEffect: 2, ciLow: 5, ciHigh: 1 })).error, "Predicted effect required", "inverted CI");
  eq(Lab.launch(raw({ predictedEffect: 2, ciLow: 2, ciHigh: 2 })).error, "Predicted effect required", "zero-width CI");
  eq(Lab.launch(raw({ predictedEffect: 2, ciHigh: 4 })).error, "Predicted effect required", "half a CI");
  eq(Lab.launch(raw({ predictedEffect: 0, ciLow: -1, ciHigh: 1 })).ok, true, "zero is a fine prediction");
  eq(Lab.launch(raw({ predictedEffect: "2.5", ciLow: "0", ciHigh: "4" })).ok, true, "numeric strings are fine");
});

test('"No free slots — you have 4 jobs running"', function () {
  boot();
  for (var i = 0; i < 4; i++) {
    eq(Lab.launch(req({ scale: "70m", steps: "short" })).ok, true, "launch " + i);
  }
  eq(Lab.getState().slotsFree, 0, "slots full");
  eq(Lab.launch(req({ scale: "70m" })).error, "No free slots — you have 4 jobs running");
  // the preview still prices it, and says why it would be rejected
  var d = Lab.design(req({ scale: "70m" }));
  eq(d.ok, true, "design still previews");
  eq(d.warning, "No free slots — you have 4 jobs running");
  eq(d.wouldReject, true);
  // freeing a slot re-opens it
  Lab.kill(Lab.getState().running[0].id);
  eq(Lab.launch(req({ scale: "70m" })).ok, true, "slot freed");
});

test('"Not enough compute — that costs N GPU-hours, you have M"', function () {
  boot();
  eq(Lab.launch(req({ scale: "7b", steps: "long", seeds: 4 })).error,
     "Not enough compute — that costs 6800 GPU-hours, you have 6000");
  withRules({ computeBudget: 30 }, function () {
    boot();
    eq(Lab.launch(req({ scale: "300m", steps: "short" })).ok, true, "22.5 of 30");
    eq(Lab.getState().computeRemaining, 7.5, "remaining");
    eq(Lab.launch(req({ scale: "70m", steps: "std" })).error,
       "Not enough compute — that costs 12 GPU-hours, you have 7.5");
  });
});

test('"It won\'t finish before Friday\'s readout"', function () {
  boot();
  Lab.advance(40);                                  // Fri 09:00, 7 lab-hours left
  eq(Lab.getState().t, "Fri 09:00");
  eq(Lab.launch(req({ scale: "7b", steps: "std" })).error, "It won't finish before Friday's readout");
  eq(Lab.design(req({ scale: "7b", steps: "std" })).warning, "It won't finish before Friday's readout");
  eq(Lab.design(req({ scale: "7b", steps: "std" })).beforeDeadline, false);
  eq(Lab.launch(req({ scale: "1p4b", steps: "std" })).ok, true, "7.0h exactly fits");
  eq(Lab.launch(req({ scale: "1p4b", steps: "long" })).error, "It won't finish before Friday's readout");
});

test('"The readout is already submitted"', function () {
  boot();
  Lab.submitReadout({ interventions: ["i1"], confidence: 50, rationale: "gut" });
  eq(Lab.launch(req({})).error, "The readout is already submitted");
  eq(Lab.submitReadout({ interventions: ["i2"] }).error, "The readout is already submitted");
  eq(Lab.design(req({})).warning, "The readout is already submitted");
});

test("unknown ids, scales, steps and silly seed counts are rejected", function () {
  boot();
  eq(Lab.launch(req({ interventions: ["nope"] })).error, "Unknown intervention: nope");
  eq(Lab.launch(req({ scale: "900b" })).error, "Unknown scale: 900b");
  eq(Lab.launch(req({ steps: "forever" })).error, "Unknown steps option: forever");
  eq(Lab.launch(req({ seeds: 0 })).error, "Seeds must be a whole number between 1 and 16");
  eq(Lab.launch(req({ seeds: 2.5 })).error, "Seeds must be a whole number between 1 and 16");
  eq(Lab.launch(req({ seeds: 99 })).error, "Seeds must be a whole number between 1 and 16");
});

test("readout enforces at most maxInterventions", function () {
  boot();
  eq(Lab.submitReadout({ interventions: ["i1", "i2", "i3", "i4", "i5"] }).error,
     "You can recommend at most 4 interventions");
  eq(Lab.submitReadout({ interventions: [] }).error, "Pick at least one intervention");
  eq(Lab.submitReadout({ interventions: ["i1", "i2", "i3", "i4"] }).ok, true);
});

/* -- 6. the job lifecycle, budget and refunds ----------------------------- */

console.log("");
console.log("[ jobs, budget and refunds ]");

test("launch charges the full cost immediately and takes a slot", function () {
  withRules({ failureBase: 0 }, function () {
    boot();
    var r = Lab.launch(req({ scale: "1p4b", steps: "std", seeds: 2 }));
    ok(r.ok, "launched");
    eq(r.job.cost, 380, "190*1*2");
    var s = Lab.getState();
    eq(s.computeUsed, 380, "charged at launch");
    eq(s.computeRemaining, 5620, "remaining");
    near(s.budgetPct, 6.3, 0.051, "budgetPct");
    eq(s.slotsUsed, 1, "slot taken");
    eq(s.running[0].progress, 0, "no progress yet");
    Lab.advance(3.5);
    near(Lab.getState().running[0].progress, 0.5, 1e-6, "halfway");
    Lab.advance(3.5);
    eq(Lab.getState().slotsUsed, 0, "job done");
    eq(Lab.getResults()[0].status, "ok", "and it succeeded");
  });
});

test("a successful result carries observedEffect, sigma and a 95% CI", function () {
  withRules({ failureBase: 0 }, function () {
    boot();
    Lab.launch(req({ interventions: ["i2"], scale: "70m", steps: "std", seeds: 4 }));
    Lab.advance(2);
    var r = Lab.getResults()[0];
    eq(r.status, "ok");
    near(r.sigma, 0.9, 1e-9, "sigma with 4 seeds at 70M");
    ok(typeof r.observedEffect === "number" && isFinite(r.observedEffect), "observedEffect is a number");
    near(r.ciLow95, r.observedEffect - 1.96 * r.sigma, 1e-4, "ciLow95");
    near(r.ciHigh95, r.observedEffect + 1.96 * r.sigma, 1e-4, "ciHigh95");
    eq(r.finishedAt.t, "Mon 10:30", "finished after 1.5 wall hours");
  });
});

test("infra failures: rate matches p, refund = cost * (1 - fraction burned)", function () {
  var n = 3000;
  withRules({ computeBudget: 1e9, slots: 1e9 }, function () {
    boot(4242);
    var costEach = 12;                    // 70m std 1 seed
    for (var i = 0; i < n; i++) {
      var r = Lab.launch(req({ interventions: ["i2"], scale: "70m", steps: "std", seeds: 1 }));
      ok(r.ok, "launch " + i + (r.error ? (": " + r.error) : ""));
    }
    Lab.advance(2);
    var res = Lab.getResults();
    eq(res.length, n, "all finished");

    var failed = 0, okCount = 0, i2;
    for (i2 = 0; i2 < res.length; i2++) {
      var r2 = res[i2];
      if (r2.status === "failed") {
        failed++;
        // the reveal fraction is uniform on [0.2, 0.9]
        ok(r2.progress >= 0.2 - 1e-9 && r2.progress <= 0.9 + 1e-9, "fail fraction in range: " + r2.progress);
        // refund the UNCONSUMED compute
        near(r2.refund, costEach * (1 - r2.progress), 0.011, "refund arithmetic");
        ok(/^(preempted|loss diverged \(NaN at step ~\d+\)|OOM on shard 3|dataloader deadlock|checkpoint corrupt)$/
            .test(r2.failReason), "fail reason from the list: " + r2.failReason);
        eq(r2.observedEffect, null, "a failed job yields no measurement");
        // and it surfaced EARLIER than its advertised ETA
        ok(r2.finishedAt.hour < r2.etaAt.hour - 1e-9, "failure surfaced before the ETA");
      } else { okCount++; }
    }
    var p = 0.10 * 0.6 * 1.0;             // = 0.06
    var expect = n * p, sd = Math.sqrt(n * p * (1 - p));
    ok(Math.abs(failed - expect) < 4 * sd,
       "failure rate " + (failed / n) + " vs p=" + p + " (failed=" + failed + ", expected~" + expect + ")");
    eq(failed + okCount, n, "accounting");

    // budget accounting: charged - refunded = used
    var st = Lab.getState();
    near(st.computeUsed, n * costEach - st.computeRefunded, 0.01, "used = charged - refunded");
    ok(st.computeRefunded > 0, "something was refunded");
  });
});

test("failures are decided at LAUNCH but only revealed part-way through", function () {
  withRules({ computeBudget: 1e9, slots: 1e9 }, function () {
    boot(99);
    for (var i = 0; i < 40; i++) Lab.launch(req({ interventions: ["i2"], scale: "7b", steps: "std", seeds: 1 }));
    // 7b std wall = 18h. Nothing may be revealed before 0.2*18 = 3.6h.
    Lab.advance(3.5);
    eq(Lab.getResults().length, 0, "nothing revealed before 20% of wall time");
    Lab.advance(14.6);                     // to 18.1h: everything resolved
    var res = Lab.getResults();
    eq(res.length, 40, "all resolved by the ETA");
    var anyFailed = false;
    for (var j = 0; j < res.length; j++) if (res[j].status === "failed") anyFailed = true;
    ok(anyFailed, "with p=0.20 over 40 jobs, some must fail");
  });
});

test("kill refunds killRefund * the unspent compute", function () {
  withRules({ failureBase: 0 }, function () {
    boot();
    var j = Lab.launch(req({ scale: "1p4b", steps: "std", seeds: 1 })).job;
    eq(j.cost, 190, "cost");
    Lab.advance(3.5);                       // 50% of a 7h run
    var k = Lab.kill(j.id);
    ok(k.ok, "killed");
    near(k.progress, 0.5, 1e-6, "progress");
    near(k.refund, 0.5 * 190 * 0.5, 1e-6, "refund = 0.5 * 190 * (1 - 0.5)");
    var s = Lab.getState();
    near(s.computeUsed, 190 - 47.5, 1e-6, "used after refund");
    eq(s.slotsUsed, 0, "slot freed");
    var r = Lab.getResults()[0];
    eq(r.status, "killed", "recorded as killed");
    eq(r.observedEffect, null, "no measurement from a killed job");
    ok(/killed by you at 50% complete/.test(r.failReason), "reason: " + r.failReason);
    eq(Lab.kill(j.id).ok, false, "cannot kill it twice");
    eq(Lab.kill("nope").error, "No such running job: nope");
  });
});

test("killing at 0% refunds half the cost; at 100% refunds nothing", function () {
  withRules({ failureBase: 0 }, function () {
    boot();
    var a = Lab.launch(req({ scale: "1p4b" })).job;
    near(Lab.kill(a.id).refund, 95, 1e-6, "half of 190 back if you kill instantly");
    boot();
    var b = Lab.launch(req({ scale: "1p4b", steps: "long" })).job;   // 14h wall, cost 380
    Lab.advance(13.9999);
    var k = Lab.kill(b.id);
    ok(k.refund < 0.02, "almost nothing back at 100%: " + k.refund);
  });
});

test("budget events fire once per threshold", function () {
  boot();
  var marks = [];
  Lab.on("budget", function (b) { marks.push(b.mark); });
  Lab.launch(req({ scale: "7b", steps: "long", seeds: 2 }));    // 3400 = 56.7%
  deq(marks, [0.5], "half the budget");
  Lab.launch(req({ scale: "7b", steps: "std", seeds: 2 }));     // +1700 = 85%
  deq(marks, [0.5, 0.75], "three quarters");
});

test("nothing the lab hands out before the debrief leaks the truth", function () {
  withRules({ failureBase: 0 }, function () {
    boot();
    Lab.launch(req({ interventions: ["i1"], scale: "70m" }));
    var st = Lab.getState();
    var k, job = st.running[0];
    for (k in job) ok(k.charAt(0) !== "_", "running job leaks private field " + k);
    Lab.advance(2);
    var res = Lab.getResults()[0];
    for (k in res) ok(k.charAt(0) !== "_", "result leaks private field " + k);
    ok(JSON.stringify(st).indexOf("SPOILER_SENTINEL") < 0, "state must not carry truth notes");
    eq(Lab.getDebrief(), null, "no debrief before submission");
    Lab.submitReadout({ interventions: ["i1"], confidence: 60, rationale: "x" });
    ok(Lab.getDebrief() !== null, "debrief available after submission");
    ok(typeof Lab.getDebrief().interventions[0].fn === "function", "truth curve for plots.truth()");
    near(Lab.getDebrief().interventions[0].fn(7.0e7), 5.0, 1e-9, "i1 at 70M");
    near(Lab.getDebrief().interventions[0].fn(7.0e10), 3.002, 1e-9, "i1 at the run scale");
  });
});

/* -- 7. the observation model --------------------------------------------- */

console.log("");
console.log("[ the observation model ]");

test("observations are gaussian around the TRUE effect with the stated sigma", function () {
  var n = 2000;
  withRules({ computeBudget: 1e9, slots: 1e9, failureBase: 0 }, function () {
    boot(1234567);
    for (var i = 0; i < n; i++) {
      var r = Lab.launch(req({ interventions: ["i2"], scale: "70m", steps: "std", seeds: 1 }));
      ok(r.ok, "launch " + i + (r.error ? (": " + r.error) : ""));
    }
    Lab.advance(2);
    var res = Lab.getResults();
    eq(res.length, n, "all resolved");

    var truth = specTrue(["i2"], 7.0e7);      // = 2.0
    eq(truth, 2, "fixture truth");
    var sigma = 1.80;
    eq(res[0].sigma, sigma, "reported sigma");

    var sum = 0, i2;
    for (i2 = 0; i2 < n; i2++) {
      eq(res[i2].status, "ok", "no failures with failureBase 0");
      sum += res[i2].observedEffect;
    }
    var mean = sum / n;
    var ss = 0;
    for (i2 = 0; i2 < n; i2++) ss += Math.pow(res[i2].observedEffect - mean, 2);
    var sd = Math.sqrt(ss / (n - 1));

    var se = sigma / Math.sqrt(n);
    ok(Math.abs(mean - truth) < 3 * se,
       "sample mean " + mean.toFixed(4) + " must be within 3 SE (" + (3 * se).toFixed(4) + ") of " + truth);
    ok(Math.abs(sd - sigma) / sigma < 0.05,
       "sample sd " + sd.toFixed(4) + " must be within 5% of sigma " + sigma);
  });
});

test("more seeds really do tighten the empirical spread by 1/sqrt(n)", function () {
  var n = 800;
  withRules({ computeBudget: 1e9, slots: 1e9, failureBase: 0 }, function () {
    function spread(seedCount) {
      boot(31337);
      for (var i = 0; i < n; i++) Lab.launch(req({ interventions: ["i2"], scale: "70m", seeds: seedCount }));
      Lab.advance(2);
      var res = Lab.getResults(), s = 0, ss = 0, j;
      for (j = 0; j < n; j++) s += res[j].observedEffect;
      var m = s / n;
      for (j = 0; j < n; j++) ss += Math.pow(res[j].observedEffect - m, 2);
      return Math.sqrt(ss / (n - 1));
    }
    var s1 = spread(1), s4 = spread(4);
    ok(Math.abs(s4 - s1 / 2) / (s1 / 2) < 0.12, "4 seeds should roughly halve the spread: " + s1 + " -> " + s4);
  });
});

test("interaction terms are added only when BOTH members are in the set", function () {
  withRules({ failureBase: 0, slots: 8, computeBudget: 1e9 }, function () {
    boot();
    Lab.launch(req({ interventions: ["i5"], scale: "70m", predictedEffect: 0, ciLow: -1, ciHigh: 1 }));
    Lab.launch(req({ interventions: ["i6"], scale: "70m", predictedEffect: 0, ciLow: -1, ciHigh: 1 }));
    Lab.launch(req({ interventions: ["i5", "i6"], scale: "70m", predictedEffect: 0, ciLow: -1, ciHigh: 1 }));
    Lab.launch(req({ interventions: ["i5", "i7"], scale: "70m", predictedEffect: 0, ciLow: -1, ciHigh: 1 }));
    Lab.advance(2);
    var sc = Lab.submitReadout({ interventions: ["i1"], confidence: 50, rationale: "-" });
    var rows = sc.calibration.rows;
    eq(rows.length, 4, "four calibrated rows");
    near(rows[0].truth, 0.25, 1e-9, "i5 alone");
    near(rows[1].truth, 0.10, 1e-9, "i6 alone");
    near(rows[2].truth, 0.25 + 0.10 + 6.0, 1e-9, "i5+i6 gets the +6.0 interaction");
    near(rows[3].truth, 0.25 - 0.01, 1e-9, "i5+i7 gets no interaction");
  });
});

test("the scale law: effect_i(N) = c + a*(Nref/N)^gamma", function () {
  withRules({ failureBase: 0, slots: 8, computeBudget: 1e9 }, function () {
    boot();
    var W = Lab.getWorld();
    for (var i = 0; i < W.scales.length; i++) {
      Lab.launch(req({ interventions: ["i1"], scale: W.scales[i].id, predictedEffect: 0, ciLow: -1, ciHigh: 1 }));
    }
    Lab.advance(40);
    var sc = Lab.submitReadout({ interventions: ["i1"], confidence: 50, rationale: "-" });
    var rows = sc.calibration.rows;
    for (var j = 0; j < rows.length; j++) {
      var params = W.scales[j].params;
      near(rows[j].truth, specEffect("i1", params), 1e-4, "i1 truth at " + W.scales[j].label);
    }
    near(rows[0].truth, 5.0, 1e-9, "i1 at 70M = c + a = 5.0");
  });
});

/* -- 8. scoring ----------------------------------------------------------- */

console.log("");
console.log("[ scoring ]");

/** independent brute force over the fixture, for cross-checking bestPossible */
function bruteBest(k) {
  var ids = ["i1", "i2", "i3", "i4", "i5", "i6", "i7", "i8"];
  var best = -Infinity, bestSet = null;
  for (var m = 1; m < (1 << 8); m++) {
    var set = [], b;
    for (b = 0; b < 8; b++) if (m & (1 << b)) set.push(ids[b]);
    if (set.length > k) continue;
    var v = specTrue(set, 7.0e10);
    if (v > best + 1e-12) { best = v; bestSet = set; }
  }
  return { best: best, set: bestSet };
}

test("bestPossible/bestSet found by brute force match the hand-computed optimum", function () {
  boot();
  var sc = Lab.submitReadout({ interventions: ["i1"], confidence: 50, rationale: "-" });
  // Hand-computed: i1=3.002, i2=2, i5=0.25, i6=0.10, plus the +6.0 (i5,i6) term.
  near(sc.bestPossible, 11.352, 1e-9, "bestPossible");
  deq(sc.bestSet, ["i1", "i2", "i5", "i6"], "bestSet");
  // and an independent brute force agrees
  var bf = bruteBest(4);
  near(sc.bestPossible, bf.best, 1e-9, "matches independent brute force");
  deq(sc.bestSet.slice().sort(), bf.set.slice().sort(), "same set");
});

test("trueEffectAtRunScale includes interactions; regret and grade follow", function () {
  boot();
  var sc = Lab.submitReadout({ interventions: ["i1", "i2", "i5", "i6"], confidence: 90, rationale: "-" });
  near(sc.trueEffectAtRunScale, 11.352, 1e-9, "the optimum itself");
  near(sc.regret, 0, 1e-9, "no regret");
  eq(sc.grade, "A", "grade");
  eq(sc.shippedRegression, false, "no regression");
  deq(sc.missed, [], "nothing missed");
});

test("grade bands on regret / bestPossible", function () {
  function gradeOf(ids) {
    boot();
    return Lab.submitReadout({ interventions: ids, confidence: 50, rationale: "-" });
  }
  var b = 11.352;

  var a = gradeOf(["i1", "i2", "i5", "i6"]);
  near(a.regretRatio, 0, 1e-9); eq(a.grade, "A");

  // 2 + 1 + 0.25 + 0.10 + 6.0 = 9.35 -> regret 2.002, ratio 0.1764 -> B
  var bb = gradeOf(["i2", "i3", "i5", "i6"]);
  near(bb.trueEffectAtRunScale, 9.35, 1e-9, "chosen truth");
  near(bb.regret, b - 9.35, 1e-6, "regret");
  near(bb.regretRatio, (b - 9.35) / b, 1e-4, "ratio");
  eq(bb.grade, "B", "0.176 -> B");
  deq(bb.missed, ["i1"], "left the big one out");

  // 3.002 + 2 + 1 + 0.5 = 6.502 -> ratio 0.4272 -> C
  var c = gradeOf(["i1", "i2", "i3", "i4"]);
  near(c.trueEffectAtRunScale, 6.502, 1e-9);
  near(c.regretRatio, (b - 6.502) / b, 1e-4);
  eq(c.grade, "C", "0.427 -> C");
  deq(c.missed.slice().sort(), ["i5", "i6"], "missed the pair");

  // 3.002 + 2 + 0.25 = 5.252 -> ratio 0.5374 -> D
  var d = gradeOf(["i1", "i2", "i5"]);
  near(d.trueEffectAtRunScale, 5.252, 1e-9);
  eq(d.grade, "D", "0.537 -> D");

  // 2 + 1 = 3.0 -> ratio 0.7357 -> F
  var f = gradeOf(["i2", "i3"]);
  near(f.trueEffectAtRunScale, 3.0, 1e-9);
  ok((b - 3.0) / b >= 0.70, "ratio past the D band");
  eq(f.grade, "F", "0.736 -> F");
});

test("shipping a regression caps the grade at C", function () {
  boot();
  // 3.002 + 0.25 + 0.10 + 6.0 - 0.01 = 9.342 -> ratio 0.1771, which is a B...
  var sc = Lab.submitReadout({ interventions: ["i1", "i5", "i6", "i7"], confidence: 80, rationale: "-" });
  near(sc.trueEffectAtRunScale, 9.342, 1e-9, "chosen truth");
  near(sc.regretRatio, (11.352 - 9.342) / 11.352, 1e-4, "ratio is in the B band");
  ok(sc.regretRatio < 0.25 && sc.regretRatio >= 0.10, "...definitely B territory");
  eq(sc.shippedRegression, true, "i7 is negative at the run scale");
  eq(sc.grade, "C", "...but the cap forces C");

  // the cap never IMPROVES a grade
  boot();
  var bad = Lab.submitReadout({ interventions: ["i8"], confidence: 10, rationale: "-" });
  near(bad.trueEffectAtRunScale, -2, 1e-9);
  eq(bad.shippedRegression, true);
  eq(bad.grade, "F", "still F");
});

test("perIntervention verdicts, missed list and truth notes", function () {
  withRules({ failureBase: 0 }, function () {
    boot();
    Lab.launch(req({ interventions: ["i1"], scale: "70m", seeds: 4 }));
    Lab.advance(2);
    var sc = Lab.submitReadout({ interventions: ["i1", "i2", "i3", "i7"], confidence: 50, rationale: "-" });
    var by = {};
    for (var i = 0; i < sc.perIntervention.length; i++) by[sc.perIntervention[i].id] = sc.perIntervention[i];
    eq(sc.perIntervention.length, 8, "one row per intervention");
    near(by.i1.truthAtRunScale, 3.002, 1e-9, "i1 truth");
    eq(by.i1.verdict, "correct — kept a winner");
    eq(by.i7.verdict, "shipped a regression");
    eq(by.i8.verdict, "correctly skipped a regression");
    eq(by.i5.verdict, "missed — should have shipped it");
    eq(by.i3.verdict, "positive, but not top-4");
    eq(by.i4.verdict, "correctly left out");
    deq(sc.missed.slice().sort(), ["i5", "i6"], "missed");
    ok(/SPOILER_SENTINEL/.test(by.i1.note), "debrief note is present in the SCORE (post-submission)");
    // believed = their own solo measurement of i1
    ok(by.i1.believed !== null, "i1 was measured solo");
    eq(by.i1.tested, 1, "tested once");
    eq(by.i2.believed, null, "i2 never measured");
    eq(by.i2.tested, 0);
  });
});

test("computeSpent / efficiency / failure accounting on the score", function () {
  withRules({ failureBase: 0 }, function () {
    boot();
    Lab.launch(req({ scale: "1p4b", steps: "std", seeds: 2 }));   // 380
    Lab.advance(7);
    var j = Lab.launch(req({ scale: "70m", steps: "std", seeds: 1 })).job;   // 12
    Lab.kill(j.id);                                               // refunds 6
    var sc = Lab.submitReadout({ interventions: ["i1", "i2", "i5", "i6"], confidence: 50, rationale: "-" });
    near(sc.computeCharged, 392, 1e-6, "charged");
    near(sc.computeRefunded, 6, 1e-6, "refunded");
    near(sc.computeSpent, 386, 1e-6, "net spent");
    near(sc.computeWastedOnFailures, 6, 1e-6, "the killed job burned 6");
    near(sc.computeEfficiency, 11.352 / (386 / 1000), 0.01, "points per 1000 GPU-hours");
    eq(sc.experiments, 2, "two finished jobs");
  });
});

/* -- 9. calibration ------------------------------------------------------- */

console.log("");
console.log("[ calibration ]");

test("calibration arithmetic on a fixture with known answers", function () {
  withRules({ failureBase: 0, slots: 8 }, function () {
    boot();
    // truths at 70M: i2=2.0, i3=1.0, i4=0.5, i6=0.1
    Lab.launch(req({ interventions: ["i2"], scale: "70m", predictedEffect: 2.0, ciLow: 1.0, ciHigh: 3.0 }));  // hit,  err  0.0
    Lab.launch(req({ interventions: ["i3"], scale: "70m", predictedEffect: 3.0, ciLow: 2.5, ciHigh: 3.5 }));  // miss, err +2.0
    Lab.launch(req({ interventions: ["i4"], scale: "70m", predictedEffect: 0.0, ciLow: -1.0, ciHigh: 1.0 })); // hit,  err -0.5
    Lab.launch(req({ interventions: ["i6"], scale: "70m", predictedEffect: 1.1, ciLow: 1.0, ciHigh: 1.2 }));  // miss, err +1.0
    Lab.advance(2);
    var sc = Lab.submitReadout({ interventions: ["i1"], confidence: 50, rationale: "-" });
    var c = sc.calibration;
    eq(c.n, 4, "n");
    eq(c.hits, 2, "hits");
    near(c.hitRate, 0.5, 1e-9, "hitRate 2/4");
    near(c.meanAbsError, (0 + 2.0 + 0.5 + 1.0) / 4, 1e-9, "meanAbsError 0.875");
    near(c.bias, (0 + 2.0 - 0.5 + 1.0) / 4, 1e-9, "signed bias +0.625");
    eq(c.overconfident, false, "exactly half is not (yet) overconfident");
    deq([c.rows[0].hit, c.rows[1].hit, c.rows[2].hit, c.rows[3].hit], [true, false, true, false], "per-row hits");
    near(c.rows[1].truth, 1.0, 1e-9, "truth for i3 at 70M");
    near(c.rows[1].error, 2.0, 1e-9, "signed error");
  });
});

test("overconfident when the truth falls inside the stated CI less than half the time", function () {
  withRules({ failureBase: 0, slots: 8 }, function () {
    boot();
    Lab.launch(req({ interventions: ["i2"], scale: "70m", predictedEffect: 9, ciLow: 8.9, ciHigh: 9.1 }));
    Lab.launch(req({ interventions: ["i3"], scale: "70m", predictedEffect: 9, ciLow: 8.9, ciHigh: 9.1 }));
    Lab.launch(req({ interventions: ["i4"], scale: "70m", predictedEffect: 0.5, ciLow: 0.4, ciHigh: 0.6 }));
    Lab.advance(2);
    var c = Lab.submitReadout({ interventions: ["i1"], confidence: 99, rationale: "-" }).calibration;
    eq(c.n, 3); eq(c.hits, 1);
    near(c.hitRate, 1 / 3, 1e-4);
    eq(c.overconfident, true, "1 in 3 is overconfident");
    near(c.bias, ((9 - 2) + (9 - 1) + 0) / 3, 1e-9, "wildly optimistic");
  });
});

test("failed and killed jobs are excluded from calibration", function () {
  withRules({ slots: 8 }, function () {
    boot();
    withRules({ failureBase: 0 }, function () {
      Lab.launch(req({ interventions: ["i2"], scale: "70m", predictedEffect: 2, ciLow: 1, ciHigh: 3 }));
    });
    var k = Lab.launch(req({ interventions: ["i3"], scale: "70m", predictedEffect: 2, ciLow: 1, ciHigh: 3 }));
    Lab.kill(k.job.id);
    Lab.advance(2);
    var sc = Lab.submitReadout({ interventions: ["i1"], confidence: 50, rationale: "-" });
    eq(Lab.getResults().length, 2, "two results");
    eq(sc.calibration.n, 1, "only the successful one is calibrated");
  });
});

/* -- 10. the exported markdown -------------------------------------------- */

console.log("");
console.log("[ exportReadout ]");

test("exportReadout returns markdown with the recommendation, experiments and compute", function () {
  withRules({ failureBase: 0, slots: 8 }, function () {
    boot();
    Lab.launch(req({ interventions: ["i1"], scale: "70m", seeds: 2, predictedEffect: 4, ciLow: 2, ciHigh: 6 }));
    Lab.launch(req({ interventions: ["i5", "i6"], scale: "300m", steps: "long", predictedEffect: 6, ciLow: 3, ciHigh: 9 }));
    Lab.advance(8);
    Lab.submitReadout({ interventions: ["i1", "i2", "i5", "i6"], confidence: 75, rationale: "MY-RATIONALE-TOKEN" });
    var md = Lab.exportReadout();
    ok(typeof md === "string" && md.length > 200, "markdown produced");
    ok(md.indexOf("## Recommendation") >= 0, "recommendation section");
    ok(md.indexOf("MY-RATIONALE-TOKEN") >= 0, "rationale included");
    ok(md.indexOf("Confidence: **75**") >= 0, "confidence included");
    ok(md.indexOf("## Experiments") >= 0, "experiments section");
    ok(md.indexOf("## Compute") >= 0, "compute section");
    ok(md.indexOf("## Calibration") >= 0, "calibration section");
    ok(md.indexOf("### Hypotheses") >= 0, "hypotheses");
    ok(md.indexOf(HYP) >= 0, "the actual hypothesis text");
    ok(md.indexOf("J1") >= 0 && md.indexOf("J2") >= 0, "both jobs listed");
    ok(md.indexOf("i5 + i6") >= 0, "combination spelled out");
    ok(/Burned on failed or killed jobs/.test(md), "failure fraction reported");
    ok(/Budget: \*\*6000\*\*/.test(md), "budget line");
  });
});

test("exportReadout NEVER leaks ground truth", function () {
  withRules({ failureBase: 0, slots: 8 }, function () {
    boot();
    Lab.launch(req({ interventions: ["i1"], scale: "70m" }));
    Lab.launch(req({ interventions: ["i5", "i6"], scale: "70m" }));
    Lab.advance(2);
    Lab.submitReadout({ interventions: ["i1", "i2", "i5", "i6"], confidence: 75, rationale: "-" });
    var md = Lab.exportReadout();
    ok(md.indexOf("SPOILER_SENTINEL") < 0, "no truth notes");
    ok(md.indexOf("11.352") < 0, "no bestPossible");
    ok(md.indexOf("3.002") < 0, "no per-intervention truth");
    ok(md.toLowerCase().indexOf("regret") < 0, "no regret");
    ok(md.indexOf("bestPossible") < 0 && md.toLowerCase().indexOf("grade") < 0, "no grade");
    ok(md.indexOf("Ground truth is not in this document") >= 0, "and it says so");
    // the base64 blob must not be in there either
    ok(md.indexOf(Lab.getWorld()._t.slice(0, 24)) < 0, "no encoded truth blob");
  });
});

test("exportReadout works before submission (as a draft)", function () {
  withRules({ failureBase: 0 }, function () {
    boot();
    Lab.launch(req({ interventions: ["i1"], scale: "70m" }));
    Lab.advance(2);
    var md = Lab.exportReadout();
    ok(md.indexOf("NOT YET SUBMITTED") >= 0, "flagged as a draft");
    ok(md.indexOf("No recommendation submitted yet") >= 0, "no recommendation yet");
    ok(md.indexOf("SPOILER_SENTINEL") < 0, "still no truth");
  });
});

/* -- 11. events ------------------------------------------------------------ */

console.log("");
console.log("[ events ]");

test("result / fail / tick events fire with the right payloads", function () {
  withRules({ failureBase: 0 }, function () {
    boot();
    var results = [], fails = [], ticks = 0;
    Lab.on("result", function (r) { results.push(r); });
    Lab.on("fail", function (r) { fails.push(r); });
    Lab.on("tick", function () { ticks++; });
    Lab.launch(req({ interventions: ["i1"], scale: "70m" }));
    Lab.advance(2);
    eq(results.length, 1, "one result");
    eq(fails.length, 0, "no failures");
    eq(results[0].status, "ok");
    ok(ticks >= 8, "ticks fired: " + ticks);
    var j = Lab.launch(req({ interventions: ["i2"], scale: "70m" })).job;
    Lab.kill(j.id);
    eq(fails.length, 1, "a kill counts as a fail event");
    eq(fails[0].status, "killed");
  });
  // a throwing listener must never stop the clock
  withRules({ failureBase: 0 }, function () {
    boot();
    var saved = console.error; console.error = function () {};
    Lab.on("tick", function () { throw new Error("bad listener"); });
    Lab.advance(1);
    console.error = saved;
    eq(Lab.getState().t, "Mon 10:00", "clock survived");
  });
});

test("a job landing exactly on the deadline still lands, and the week then ends", function () {
  withRules({ failureBase: 0 }, function () {
    boot();
    Lab.advance(40);                                        // Fri 09:00
    var j = Lab.launch(req({ scale: "1p4b", steps: "std" })).job;   // 7.0h wall -> Fri 16:00
    eq(j.etaAt.t, "Fri 16:00", "ETA is the deadline itself");
    eq(Lab.getState().computeUsed, 190, "charged at launch");
    Lab.advance(3);
    eq(Lab.getState().slotsUsed, 1, "still running mid-afternoon");
    var fired = 0;
    Lab.on("deadline", function () { fired++; });
    Lab.advance(10);                                        // runs into the deadline
    var s = Lab.getState();
    eq(s.t, "Fri 16:00", "clamped");
    eq(s.finished, true, "week over");
    eq(fired, 1, "deadline fired");
    eq(s.slotsUsed, 0, "cluster drained");
    var r = Lab.getResults()[0];
    eq(r.id, j.id, "same job");
    eq(r.status, "ok", "it finished in time");
    eq(s.computeUsed, 190, "no refund at the end of the week");
    // and the readout still works after the bell
    ok(Lab.submitReadout({ interventions: ["i1"], confidence: 50, rationale: "-" }).ok, "readout after the deadline");
  });
});

test("the clock refuses to move once the readout is in", function () {
  boot();
  Lab.advance(5);
  Lab.submitReadout({ interventions: ["i1"], confidence: 50, rationale: "-" });
  var t = Lab.getState().t;
  Lab.advance(10); Lab.step();
  eq(Lab.getState().t, t, "frozen at " + t);
  eq(Lab.getState().finished, true, "and finished");
});

/* ======================================================================== */
console.log("");
console.log("========================================");
console.log("  " + PASS + " passed, " + FAIL + " failed");
if (FAIL) {
  console.log("");
  for (var f = 0; f < FAILURES.length; f++) console.log("  * " + FAILURES[f]);
}
console.log("========================================");
console.log("");
process.exit(FAIL ? 1 : 0);
