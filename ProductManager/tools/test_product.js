#!/usr/bin/env node
/* ==========================================================================
 * tools/test_product.js — self-contained unit tests for sim/product.js
 *
 *   node tools/test_product.js
 *
 * Zero dependencies. Loads the module exactly the way a <script> tag would:
 * we hand it a `window` and it attaches itself to it.
 *
 * The fixture below is SYNTHETIC on purpose — these tests must not depend on
 * data/company.js, and must not be able to pass by accident because the real
 * numbers happen to line up. Every expected value here is hand-computed from
 * the fixture in a comment next to the assertion.
 * ========================================================================== */
"use strict";

var path = require("path");
var PRODUCT_PATH = path.join(__dirname, "..", "sim", "product.js");

/* -------- the tiny shim: product.js is browser code, give it a window ---- */
global.window = global;
require(PRODUCT_PATH);
var Product = global.window.Product;

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

function near(actual, expected, tol, msg) {
  tol = tol == null ? 1e-9 : tol;
  if (!(Math.abs(actual - expected) <= tol)) {
    throw new Error((msg || "value mismatch") +
      "\n          expected: " + expected + " (+/- " + tol + ")" +
      "\n          actual:   " + actual);
  }
}

function deepEq(actual, expected, msg) {
  var a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) {
    throw new Error((msg || "deep mismatch") +
      "\n          expected: " + b +
      "\n          actual:   " + a);
  }
}

function rejects(res, message, msg) {
  ok(res && res.ok === false, (msg || "expected a rejection") + " (got " + JSON.stringify(res) + ")");
  eq(res.error, message, msg || "rejection message");
}

var LONG = "Because the evidence points that way and the cost is bounded.";  // >= 20 chars

/* ------------------------------------------------- synthetic SIM_CO ----- */
/*
 * six features, four instruments, five stakeholders.
 *
 *   id     tags                     estCost  trueCost  impact
 *   f_a    onboarding                  5        5        4.00
 *   f_b    onboarding, workflow       10       20        3.00   <- slips
 *   f_c    fix                         4        4        0.60
 *   f_d    flashy                      3        3        0.10   <- vanity
 *   f_f    flashy                      2        2        0.05   <- vanity
 *   f_e    enterprise                  8       13.13     7.77   <- unaffordable
 *   interaction: (f_a, f_b) +1.5
 *   scoring capacity: 12 eng-weeks
 *
 * Best affordable set under 12 eng-weeks, by hand:
 *   {f_a,f_c,f_d} cost 12 -> 4.70   <- optimum
 *   {f_a,f_c,f_f} cost 11 -> 4.65
 *   {f_a,f_c}     cost  9 -> 4.60
 *   {f_a,f_d,f_f} cost 10 -> 4.15
 *   {f_e}         cost 13.13 -> does not fit
 *   f_b at 20 eng-weeks never fits, so the +1.5 interaction is unreachable.
 */
function makeCo(over) {
  over = over || {};
  var truth = {
    impact: { f_a: 4.0, f_b: 3.0, f_c: 0.6, f_d: 0.1, f_f: 0.05, f_e: 7.77 },
    trueCost: { f_a: 5, f_b: 20, f_c: 4, f_d: 3, f_f: 2, f_e: 13.13 },
    optimism: { f_a: 1.0, f_b: 2.0, f_c: 1.0, f_d: 1.0, f_f: 1.0, f_e: 1.64 },
    tags: {
      f_a: ["onboarding"], f_b: ["onboarding", "workflow"], f_c: ["fix"],
      f_d: ["flashy"], f_f: ["flashy"], f_e: ["enterprise"]
    },
    interactions: [{ pair: ["f_a", "f_b"], delta: 1.5 }],
    bias: {
      sales_anecdote: { enterprise: 2.6, onboarding: -2.2, workflow: 0.2, fix: 0.0, flashy: 0.6, _noise: 1.5 },
      survey:         { flashy: 2.0, onboarding: -1.5, workflow: 0.3, fix: 0.4, enterprise: 0.5, _noise: 1.2 },
      interviews:     { onboarding: 0.4, workflow: 0.3, flashy: -0.1, _noise: 1.6 },
      ab_test:        { onboarding: 0.0, workflow: 0.0, flashy: 0.0, fix: 0.0, enterprise: 0.0, _noise: 0.35 }
    },
    notes: { f_a: "the quiet win", f_e: "too expensive to ever fit" },
    bestSet: ["f_a", "f_c", "f_d"], bestValue: 4.7,
    capacity: 12
  };

  var co = {
    scenario: {
      company: "Testco", product: "Test product", role: "PM",
      northStar: { name: "W4 activation", units: "pp", baseline: 30.0, desc: "the number" },
      quarter: { weeks: 12, workDaysPerWeek: 5 },
      capacity: { engWeeksPerWeek: 4, total: 48 },
      brief: "brief", ceoMandate: "30 to 40"
    },
    features: [
      { id: "f_a", name: "Alpha", tags: ["onboarding"], estCost: 5, desc: "a", pitchedBy: "you" },
      { id: "f_b", name: "Bravo", tags: ["onboarding", "workflow"], estCost: 10, desc: "b", pitchedBy: "CEO" },
      { id: "f_c", name: "Charlie", tags: ["fix"], estCost: 4, desc: "c", pitchedBy: "Support" },
      { id: "f_d", name: "Delta", tags: ["flashy"], estCost: 3, desc: "d", pitchedBy: "Design" },
      { id: "f_f", name: "Foxtrot", tags: ["flashy"], estCost: 2, desc: "f", pitchedBy: "Design" },
      { id: "f_e", name: "Echo", tags: ["enterprise"], estCost: 8, desc: "e", pitchedBy: "Sales" }
    ],
    instruments: [
      { id: "sales_anecdote", name: "Talk to sales", days: 1, slots: 1, desc: "", knownCaveat: "unrepresentative" },
      { id: "survey", name: "Customer survey", days: 2, slots: 1, desc: "", knownCaveat: "stated preference" },
      { id: "interviews", name: "Interviews", days: 4, slots: 1, desc: "", knownCaveat: "small sample" },
      { id: "ab_test", name: "A/B test", days: 3, slots: 1, requiresShipped: true, desc: "", knownCaveat: "after the fact" }
    ],
    stakeholders: [
      { id: "marguerite", name: "Marguerite", role: "CEO", startTrust: 60, favors: ["f_e", "f_b", "f_d"], opposes: [], desc: "" },
      { id: "dan", name: "Dan", role: "VP Sales", startTrust: 60, favors: ["f_e"], opposes: [], desc: "" },
      { id: "rina", name: "Rina", role: "Engineering lead", startTrust: 60, favors: ["f_c", "f_a"], opposes: [], desc: "" },
      { id: "kofi", name: "Kofi", role: "Design lead", startTrust: 60, favors: ["f_d", "f_f"], opposes: [], desc: "" },
      { id: "tomas", name: "Tomas", role: "Support lead", startTrust: 60, favors: ["f_c"], opposes: [], desc: "" }
    ],
    events: [
      { id: "ev_esc", week: 2, day: 1, from: "SALES", name: "Dan", text: "commit or I lose it",
        tone: "alarm", needsReply: true },
      { id: "ev_incident", week: 3, day: 1, from: "ENG", name: "Rina", text: "incident",
        tone: "alarm", needsReply: false, capacityDelta: -5 }
    ],
    _truth: truth
  };
  co.reveal = function () { return this._truth; };

  if (over.stakeholders) co.stakeholders = over.stakeholders;
  if (over.events) co.events = over.events;
  if (over.truth) { for (var k in over.truth) co._truth[k] = over.truth[k]; }
  return co;
}

function boot(seed, over) {
  Product.destroy();
  Product.init({ co: makeCo(over), seed: seed == null ? 20260816 : seed });
  return Product;
}

/* capture emitted events of one kind */
function capture(kind) {
  var got = [];
  Product.on(kind, function (x) { got.push(x); });
  return got;
}

function stdev(xs) {
  var n = xs.length, m = 0, i;
  for (i = 0; i < n; i++) m += xs[i];
  m /= n;
  var s = 0;
  for (i = 0; i < n; i++) s += (xs[i] - m) * (xs[i] - m);
  return Math.sqrt(s / (n - 1));
}
function mean(xs) {
  var s = 0;
  for (var i = 0; i < xs.length; i++) s += xs[i];
  return s / xs.length;
}

/* ======================================================================== */
console.log("");
console.log("Product Manager Sim — product.js unit tests");
console.log("module: " + PRODUCT_PATH);
console.log("");

/* -- 0. the contract constants ------------------------------------------- */

test("RULES match the spec exactly", function () {
  var R = Product.RULES;
  eq(R.weeks, 12, "weeks");
  eq(R.workDays, 60, "workDays");
  eq(R.engWeeksPerWeek, 4, "engWeeksPerWeek");
  eq(R.totalCapacity, 48, "totalCapacity");
  eq(R.researchSlots, 2, "researchSlots");
  eq(R.startTrust, 60, "startTrust");
  eq(R.minTrust, 0, "minTrust");
  eq(R.maxTrust, 100, "maxTrust");
  eq(R.trustHitForNo, 12, "trustHitForNo");
  eq(R.trustGainForYes, 8, "trustGainForYes");
  eq(R.lowTrustEng, 40, "lowTrustEng");
  eq(R.lowTrustCeo, 35, "lowTrustCeo");
  eq(R.highTrustFavour, 75, "highTrustFavour");
  eq(R.slipWarnAt, 0.6, "slipWarnAt");
  eq(R.minRationaleChars, 20, "minRationaleChars");
  eq(Product.DEFAULT_SEED, 20260816, "default seed");
});

test("init produces a clean opening state", function () {
  var st = boot().getState();
  eq(st.day, 0, "day");
  eq(st.week, 1, "week");
  eq(st.t, "W1 D0", "stamp");
  eq(st.capacityUsed, 0, "capacityUsed");
  eq(st.capacityLeft, 48, "capacityLeft = min(48 budget, 0.8*60 days)");
  eq(st.capacityPerDay, 0.8, "0.8 eng-weeks a day");
  eq(st.roadmap.length, 0, "empty roadmap");
  eq(st.shipped.length, 0, "nothing shipped");
  eq(st.avgTrust, 60, "everyone starts at 60");
  eq(st.finished, false, "not finished");
  eq(st.research.slotsFree, 2, "two research slots");
  eq(st.northStarBaseline, 30.0, "baseline");
});

test("the calendar maps days to W#/D# the way the spec shows", function () {
  var P = boot();
  eq(P.weekOf(27), 6, "day 27 is week 6");
  P.advance(27);
  eq(P.getState().t, "W6 D2", "day 27 reads W6 D2");
  P.advance(33);
  eq(P.getState().day, 60, "60 working days in the quarter");
  eq(P.getState().t, "W12 D5", "the last day is W12 D5");
  eq(P.getState().finished, true, "the quarter ends itself");
});

/* -- 1. determinism ------------------------------------------------------ */

function scriptedRun(seed) {
  boot(seed);
  var readings = capture("reading");
  var ships = capture("ship");
  var slips = capture("slip");
  Product.research({ featureId: "f_b", instrumentId: "survey" });
  Product.research({ featureId: "f_a", instrumentId: "sales_anecdote" });
  Product.advance(3);
  Product.commit({ featureId: "f_a", predictedImpact: 3.2, rationale: LONG });
  Product.research({ featureId: "f_c", instrumentId: "interviews" });
  Product.advance(9);
  Product.commit({ featureId: "f_b", predictedImpact: 2.0, rationale: LONG });
  Product.advance(15);
  return JSON.stringify({
    state: Product.getState(),
    readings: readings, ships: ships, slips: slips
  });
}

test("the same seed replays byte-identically", function () {
  var a = scriptedRun(20260816);
  var b = scriptedRun(20260816);
  eq(a === b, true, "identical transcripts for the same seed");
  ok(a.length > 500, "the transcript is non-trivial");
});

test("a different seed produces a different transcript", function () {
  var a = scriptedRun(20260816);
  var b = scriptedRun(7);
  ok(a !== b, "different seeds must diverge");
  // and specifically the readings differ, not just some timestamp
  var ra = JSON.parse(a).readings, rb = JSON.parse(b).readings;
  eq(ra.length, rb.length, "same number of readings");
  var anyDiff = false;
  for (var i = 0; i < ra.length; i++) if (ra[i].value !== rb[i].value) anyDiff = true;
  ok(anyDiff, "at least one reading value differs");
});

test("getState() consumes no randomness", function () {
  boot(20260816);
  Product.advance(4);
  var before = Product.getState();
  for (var i = 0; i < 50; i++) Product.getState();
  var after = Product.getState();
  Product.advance(1);
  var a1 = Product.getState().northStarProjected;

  boot(20260816);
  Product.advance(5);
  eq(deepEq(before, after) === undefined, true, "state is stable across calls");
  eq(a1, Product.getState().northStarProjected, "the random stream is untouched by getState");
});

/* -- 2. the observation model -------------------------------------------- */

test("reading = trueImpact + Σ tag bias + gaussian noise (2000 draws)", function () {
  boot(20260816);
  // f_b tags [onboarding, workflow]; survey bias onboarding -1.5, workflow +0.3
  // mean = 3.0 - 1.5 + 0.3 = 1.8 ; sd = 1.2
  var xs = [], i;
  for (i = 0; i < 2000; i++) xs.push(Product._reading("f_b", "survey", false));
  var m = mean(xs), s = stdev(xs);
  var se = 1.2 / Math.sqrt(2000);
  near(m, 1.8, 3 * se, "sample mean within 3 standard errors of 1.8 (se=" + se.toFixed(4) + ")");
  near(s, 1.2, 1.2 * 0.05, "sample sd within 5% of 1.2");
});

test("a different instrument lies in a different direction, same feature", function () {
  boot(20260816);
  // f_e tags [enterprise]; sales_anecdote enterprise +2.6 -> mean 7.77+2.6 = 10.37, sd 1.5
  var xs = [], i;
  for (i = 0; i < 2000; i++) xs.push(Product._reading("f_e", "sales_anecdote", false));
  var se = 1.5 / Math.sqrt(2000);
  near(mean(xs), 10.37, 3 * se, "sales overstates the enterprise feature by exactly 2.6");
  near(stdev(xs), 1.5, 1.5 * 0.05, "sample sd within 5% of 1.5");

  // the same feature through the survey: enterprise +0.5 -> 8.27, sd 1.2
  var ys = [];
  for (i = 0; i < 2000; i++) ys.push(Product._reading("f_e", "survey", false));
  near(mean(ys), 8.27, 3 * (1.2 / Math.sqrt(2000)), "the survey lies by +0.5 instead");
});

test("multi-tag bias sums, and the unbiased favour removes bias but not noise", function () {
  boot(20260816);
  // f_b through interviews: onboarding +0.4, workflow +0.3 -> 3.7, sd 1.6
  var xs = [], i;
  for (i = 0; i < 2000; i++) xs.push(Product._reading("f_b", "interviews", false));
  near(mean(xs), 3.7, 3 * (1.6 / Math.sqrt(2000)), "biases add across tags");

  var ys = [];
  for (i = 0; i < 2000; i++) ys.push(Product._reading("f_b", "interviews", true));
  near(mean(ys), 3.0, 3 * (1.6 / Math.sqrt(2000)), "unbiased reading centres on the truth");
  near(stdev(ys), 1.6, 1.6 * 0.05, "and keeps the instrument's noise");
});

test("readings arrive through the queue after instrument.days working days", function () {
  boot(20260816);
  var got = capture("reading");
  var r = Product.research({ featureId: "f_a", instrumentId: "survey" });  // 2 days
  eq(r.ok, true, "accepted");
  eq(r.activity.days, 2, "two days");
  Product.step();
  eq(got.length, 0, "nothing after one day");
  eq(Product.getState().research.running.length, 1, "still running");
  Product.step();
  eq(got.length, 1, "the reading lands on day 2");
  eq(got[0].featureId, "f_a", "for the right feature");
  eq(got[0].instrumentId, "survey", "with the right instrument");
  eq(Product.getState().research.running.length, 0, "slot released");
  eq(Product.getState().research.done.length, 1, "and recorded");
  eq(Product.getState().instrumentUse.survey, 1, "instrument use counted");
});

/* -- 3. capacity arithmetic and the ships-only-when-finished rule --------- */

test("0.8 eng-weeks a day, and a feature ships only when trueCost is consumed", function () {
  boot();
  Product.commit({ featureId: "f_a", predictedImpact: 4, rationale: LONG });  // trueCost 5
  Product.advance(6);                       // 6 * 0.8 = 4.8
  var st = Product.getState();
  eq(st.capacityUsed, 4.8, "4.8 eng-weeks consumed");
  eq(st.roadmap[0].status, "building", "still building at 4.8 of 5");
  eq(st.roadmap[0].engWeeksSpent, 4.8, "spent");
  eq(st.roadmap[0].progress, 0.96, "96% built is not shipped");
  eq(st.shipped.length, 0, "nothing shipped");
  eq(st.northStarProjected === 30.0, false, "projected is measured with noise");

  Product.step();                            // day 7: only 0.2 more is needed
  st = Product.getState();
  eq(st.shipped.join(","), "f_a", "ships the moment trueCost is fully consumed");
  eq(st.roadmap[0].status, "shipped", "status");
  eq(st.roadmap[0].engWeeksSpent, 5, "and consumes exactly trueCost, not more");
  eq(st.capacityUsed, 5, "the leftover 0.6 is not burned when there is nothing to build");
});

test("leftover capacity rolls onto the next feature the same day", function () {
  boot();
  Product.commit({ featureId: "f_a", predictedImpact: 4, rationale: LONG });   // trueCost 5
  Product.commit({ featureId: "f_c", predictedImpact: 1, rationale: LONG });   // trueCost 4
  Product.advance(7);                        // 5.6 eng-weeks total
  var st = Product.getState();
  eq(st.capacityUsed, 5.6, "5.6 consumed in seven days");
  eq(st.roadmap[0].status, "shipped", "Alpha shipped");
  eq(st.roadmap[1].engWeeksSpent, 0.6, "the 0.6 remainder went to Charlie");
  Product.advance(5);                        // + 4.0 => Charlie at 4.6 > 4
  st = Product.getState();
  eq(st.shipped.join(","), "f_a,f_c", "both shipped, in roadmap order");
  eq(st.capacityUsed, 9, "capacityUsed is the sum of the two true costs");
});

test("the build queue respects roadmap order and setRoadmap only moves unstarted work", function () {
  boot();
  Product.commit({ featureId: "f_a", predictedImpact: 4, rationale: LONG });
  Product.commit({ featureId: "f_c", predictedImpact: 1, rationale: LONG });
  Product.commit({ featureId: "f_d", predictedImpact: 1, rationale: LONG });
  Product.advance(2);                        // Alpha is in flight
  var res = Product.setRoadmap(["f_d", "f_c", "f_a"]);
  eq(res.ok, true, "accepted");
  var rm = Product.getState().roadmap;
  eq(rm[0].featureId, "f_a", "the in-flight feature stays at the head");
  eq(rm[0].status, "building", "and is still building");
  eq(rm[1].featureId, "f_d", "queued work reorders");
  eq(rm[2].featureId, "f_c", "in the order given");
});

test("capacityLeft is bounded by the calendar as well as the budget", function () {
  boot();
  Product.advance(56);
  var st = Product.getState();
  // budget 48 - 5 (the week-3 incident) = 43 ; calendar 0.8 * 4 = 3.2
  eq(st.capacityBudget, 43, "the incident took five eng-weeks off the quarter");
  eq(st.capacityLeft, 3.2, "four working days left = 3.2 eng-weeks");
});

/* -- 4. unfinished work is worth exactly zero ---------------------------- */

test("half-built work scores zero and shows up as wasted capacity", function () {
  boot();
  Product.commit({ featureId: "f_e", predictedImpact: 6, rationale: LONG });  // trueCost 13.13
  Product.advance(10);                       // 8.0 eng-weeks in
  var st = Product.getState();
  eq(st.roadmap[0].status, "building", "still building");
  eq(st.roadmap[0].engWeeksSpent, 8, "8 eng-weeks sunk");
  eq(st.shipped.length, 0, "and nothing shipped");

  var sc = Product.submitQBR({ narrative: "We bet the quarter on Echo and did not land it.", claimedImpact: 6 });
  eq(sc.shippedSet.length, 0, "shipped nothing");
  eq(sc.delta, 0, "zero north-star delta — no partial credit");
  eq(sc.northStarActual, 30.0, "the metric never moved");
  eq(sc.wastedCapacity, 8, "8 eng-weeks of sunk work");
  eq(sc.perFeature[5].id, "f_e", "Echo is the last fixture feature");
  eq(sc.perFeature[5].verdict.indexOf("unfinished") === 0, true, "verdict names it: " + sc.perFeature[5].verdict);
  eq(sc.grade, "F", "regret is the whole optimum");
});

/* -- 5. the slip reveal --------------------------------------------------- */

test("a slip fires at 0.6 of the ESTIMATE with the revised number", function () {
  boot();
  var slips = capture("slip");
  Product.commit({ featureId: "f_b", predictedImpact: 3, rationale: LONG }); // est 10, true 20
  Product.advance(7);                        // 5.6 eng-weeks < 0.6 * 10 = 6
  eq(slips.length, 0, "no slip at 5.6 of an estimated 10");
  eq(Product.getState().roadmap[0].revisedEstimate, null, "no revision yet");
  Product.step();                            // 6.4 >= 6
  eq(slips.length, 1, "the slip lands the day the 60% line is crossed");
  eq(slips[0].featureId, "f_b", "feature");
  eq(slips[0].estimate, 10, "the estimate the player was given");
  eq(slips[0].revisedEstimate, 20, "the revised estimate is the real cost");
  eq(slips[0].overBy, 10, "ten eng-weeks over");
  eq(slips[0].engWeeksSpent, 6.4, "spent at the moment of the reveal");
  eq(Product.getState().roadmap[0].revisedEstimate, 20, "carried on the roadmap entry");
  eq(Product.getState().roadmap[0].progress, 0.32, "progress is re-based on the revision");
  Product.advance(5);
  eq(slips.length, 1, "and it only fires once");
});

test("no slip when the estimate was honest", function () {
  boot();
  var slips = capture("slip");
  Product.commit({ featureId: "f_a", predictedImpact: 4, rationale: LONG }); // est 5 == true 5
  Product.advance(10);
  eq(slips.length, 0, "an honest estimate never slips");
  eq(Product.getState().shipped.join(","), "f_a", "it just ships");
});

/* -- 6. research rules and every documented rejection --------------------- */

test("ab_test is rejected before ship and accepted after", function () {
  boot();
  rejects(Product.research({ featureId: "f_a", instrumentId: "ab_test" }),
    "You can only A/B test something that has shipped", "before ship");
  Product.commit({ featureId: "f_a", predictedImpact: 4, rationale: LONG });
  Product.advance(7);
  eq(Product.getState().shipped.join(","), "f_a", "Alpha shipped");
  var r = Product.research({ featureId: "f_a", instrumentId: "ab_test" });
  eq(r.ok, true, "accepted once it has shipped");
  eq(r.activity.instrumentId, "ab_test", "the clean instrument, after the decision");
  // and still rejected for anything else
  rejects(Product.research({ featureId: "f_c", instrumentId: "ab_test" }),
    "You can only A/B test something that has shipped", "another unshipped feature");
});

test("every documented rejection message, exactly as specced", function () {
  boot();
  // "No free research slots"
  eq(Product.research({ featureId: "f_a", instrumentId: "survey" }).ok, true, "slot 1");
  eq(Product.research({ featureId: "f_b", instrumentId: "interviews" }).ok, true, "slot 2");
  rejects(Product.research({ featureId: "f_c", instrumentId: "sales_anecdote" }),
    "No free research slots", "third concurrent activity");

  // "That research is already running"
  rejects(Product.research({ featureId: "f_a", instrumentId: "survey" }),
    "That research is already running", "same pair twice");

  // "Rationale required"
  rejects(Product.commit({ featureId: "f_a", predictedImpact: 4, rationale: "too short" }),
    "Rationale required", "short rationale");
  rejects(Product.commit({ featureId: "f_a", predictedImpact: 4 }),
    "Rationale required", "missing rationale");

  // "Predicted impact required"
  rejects(Product.commit({ featureId: "f_a", rationale: LONG }),
    "Predicted impact required", "missing forecast");
  rejects(Product.commit({ featureId: "f_a", predictedImpact: "", rationale: LONG }),
    "Predicted impact required", "empty forecast");

  // "You can only A/B test something that has shipped"
  rejects(Product.research({ featureId: "f_a", instrumentId: "ab_test" }),
    "You can only A/B test something that has shipped", "ab_test");

  // "That feature already shipped — you can't drop it"
  eq(Product.commit({ featureId: "f_a", predictedImpact: 4, rationale: LONG }).ok, true, "commit Alpha");
  Product.advance(7);
  rejects(Product.drop("f_a"), "That feature already shipped — you can't drop it", "dropping a shipped feature");

  // "Not enough capacity left this quarter"
  Product.advance(51);                       // day 58, two days left = 1.6 eng-weeks
  eq(Product.getState().capacityLeft, 1.6, "1.6 eng-weeks left on the calendar");
  rejects(Product.commit({ featureId: "f_c", predictedImpact: 1, rationale: LONG }),
    "Not enough capacity left this quarter", "a 4-week feature into 1.6 weeks");

  // "The quarter is over"
  Product.advance(5);
  eq(Product.getState().finished, true, "quarter over");
  rejects(Product.research({ featureId: "f_c", instrumentId: "survey" }), "The quarter is over", "research");
  rejects(Product.commit({ featureId: "f_c", predictedImpact: 1, rationale: LONG }), "The quarter is over", "commit");
  rejects(Product.drop("f_c"), "The quarter is over", "drop");
});

/* -- 7. trust mechanics and their feedback loops -------------------------- */

test("dropping a champion's feature costs trust, shipping one earns it", function () {
  boot();
  var moves = capture("trust");
  Product.commit({ featureId: "f_c", predictedImpact: 1, rationale: LONG });   // rina + tomas favour it
  Product.drop("f_c");
  eq(Product.getState().trust.rina, 48, "rina -12");
  eq(Product.getState().trust.tomas, 48, "tomas -12");
  eq(Product.getState().trust.kofi, 60, "kofi is unaffected");
  ok(moves.length >= 2, "trust events emitted");

  Product.commit({ featureId: "f_d", predictedImpact: 0.5, rationale: LONG }); // kofi + marguerite
  Product.advance(4);                        // trueCost 3 -> 3.2 by day 4
  eq(Product.getState().shipped.join(","), "f_d", "Delta shipped");
  eq(Product.getState().trust.kofi, 68, "kofi +8");
  eq(Product.getState().trust.marguerite, 68, "marguerite +8");
});

test("FEEDBACK LOOP 1 — eng trust below 40 inflates every future estimate by 30%", function () {
  boot();
  eq(Product.displayedEstimate("f_d"), 3, "Delta shows at 3 eng-weeks");
  Product.commit({ featureId: "f_c", predictedImpact: 1, rationale: LONG });
  Product.commit({ featureId: "f_a", predictedImpact: 4, rationale: LONG });
  Product.drop("f_c");
  eq(Product.getState().trust.rina, 48, "rina at 48, still above the line");
  eq(Product.getState().estimateInflation, false, "no padding yet");
  Product.drop("f_a");
  eq(Product.getState().trust.rina, 36, "rina at 36, below lowTrustEng");
  eq(Product.getState().estimateInflation, true, "padding latched on");
  eq(Product.displayedEstimate("f_d"), 3.9, "3 -> 3.9 (+30%)");
  eq(Product.displayedEstimate("f_b"), 13, "10 -> 13 (+30%)");
  var r = Product.commit({ featureId: "f_d", predictedImpact: 0.5, rationale: LONG });
  eq(r.entry.estimate, 3.9, "the padded number is what lands on the roadmap");
  eq(Product.getState().capacityCommitted, 3.9, "and what the capacity plan is built from");
  // the truth underneath is untouched: it still builds in 3 eng-weeks
  Product.advance(4);
  eq(Product.getState().shipped.join(","), "f_d", "padding does not change the real cost");
});

test("FEEDBACK LOOP 2 — CEO trust below 35 inserts an undroppable feature", function () {
  boot();
  var events = capture("event");
  Product.commit({ featureId: "f_b", predictedImpact: 3, rationale: LONG });
  Product.commit({ featureId: "f_d", predictedImpact: 0.5, rationale: LONG });
  Product.commit({ featureId: "f_e", predictedImpact: 6, rationale: LONG });
  Product.drop("f_b"); Product.drop("f_d"); Product.drop("f_e");
  eq(Product.getState().trust.marguerite, 24, "three of her features dropped: 60 - 36");
  eq(Product.getState().roadmap.length, 3, "all three sit dropped");

  Product.advance(4);
  var ins = Product.getState().roadmap.filter(function (e) { return e.insertedBy === "ceo"; });
  eq(ins.length, 0, "nothing inserted mid-week");
  Product.step();                            // day 5 — the week boundary
  var rm = Product.getState().roadmap;
  eq(rm[0].featureId, "f_e", "she puts her feature at the head of the roadmap");
  eq(rm[0].status, "queued", "and it is live again");
  eq(rm[0].insertedBy, "ceo", "flagged as an override");
  eq(rm[0].lockedUntilWeek, 4, "locked for three weeks (week 1 + 3)");
  var ce = events.filter(function (e) { return e.type === "ceoInsert"; });
  eq(ce.length, 1, "an event announced it");

  rejects(Product.drop("f_e"),
    "Marguerite put that on the roadmap — you can't drop it until week 4", "cannot drop it");
  Product.advance(15);                       // into week 4
  eq(Product.getState().week, 4, "week 4");
  eq(Product.drop("f_e").ok, true, "the lock expires after three weeks");
});

test("FEEDBACK LOOP 3 — trust above 75 grants exactly one favour", function () {
  boot();
  eq(Product.getState().favours.length, 0, "no favours at 60");
  Product.commit({ featureId: "f_d", predictedImpact: 0.5, rationale: LONG }); // kofi favours
  Product.commit({ featureId: "f_f", predictedImpact: 0.5, rationale: LONG }); // kofi favours
  Product.advance(7);                        // 3 + 2 = 5 eng-weeks, both ship
  eq(Product.getState().shipped.join(","), "f_d,f_f", "both shipped");
  eq(Product.getState().trust.kofi, 76, "kofi at 60 + 8 + 8");
  var favs = Product.getState().favours;
  eq(favs.length, 1, "one favour granted");
  eq(favs[0].stakeholderId, "kofi", "from kofi");
  eq(favs[0].used, false, "unused");
  deepEq(favs[0].kinds, ["unbiased", "capacity", "absorb"], "three kinds offered");

  rejects(Product.useFavour({ stakeholderId: "dan", kind: "capacity" }),
    "No favour available from that stakeholder", "dan owes you nothing");
  rejects(Product.useFavour({ stakeholderId: "kofi", kind: "sandwich" }),
    "Unknown favour: sandwich", "unknown kind");

  var before = Product.getState().capacityBudget;
  var r = Product.useFavour({ stakeholderId: "kofi", kind: "capacity" });
  eq(r.ok, true, "favour used");
  eq(Product.getState().capacityBudget, before + 4, "+4 eng-weeks of capacity");
  rejects(Product.useFavour({ stakeholderId: "kofi", kind: "capacity" }),
    "That favour is already used", "only one favour per stakeholder");
});

test("the unbiased-reading favour applies to the next reading only", function () {
  boot();
  Product.commit({ featureId: "f_d", predictedImpact: 0.5, rationale: LONG });
  Product.commit({ featureId: "f_f", predictedImpact: 0.5, rationale: LONG });
  Product.advance(7);
  eq(Product.useFavour({ stakeholderId: "kofi", kind: "unbiased" }).ok, true, "favour taken");
  var got = capture("reading");
  Product.research({ featureId: "f_a", instrumentId: "sales_anecdote" });  // 1 day
  Product.step();
  eq(got[0].unbiased, true, "the first reading after the favour is unbiased");
  Product.research({ featureId: "f_a", instrumentId: "sales_anecdote" });
  Product.step();
  eq(got[1].unbiased, false, "the next one is back to lying");
});

test("escalations: answering moves trust, ignoring one costs 15", function () {
  boot();
  Product.advance(6);                        // the week-2 escalation fires on day 6
  var open = Product.getState().openEvents;
  eq(open.length, 1, "one open escalation");
  eq(open[0].id, "ev_esc", "the sales one");
  var r = Product.respond({ eventId: "ev_esc", choice: "no", rationale: LONG });
  eq(r.ok, true, "answered");
  eq(Product.getState().trust.dan, 54, "a no WITH a reason is half price (-6)");
  eq(Product.getState().openEvents.length, 0, "closed");
  rejects(Product.respond({ eventId: "ev_esc", choice: "yes" }), "That event is already answered", "twice");
  rejects(Product.respond({ eventId: "nope", choice: "yes" }), "No such event", "unknown event");
  rejects(Product.respond({ eventId: "ev_incident", choice: "yes" }),
    "That event doesn't need a reply", "not an escalation");

  boot();
  Product.advance(6);
  Product.respond({ eventId: "ev_esc", choice: "no" });
  eq(Product.getState().trust.dan, 48, "a no with no reason costs the full 12");

  boot();
  Product.advance(6);
  Product.respond({ eventId: "ev_esc", choice: "yes" });
  eq(Product.getState().trust.dan, 68, "saying yes earns 8");

  boot();
  Product.advance(11);                       // five working days of silence
  eq(Product.getState().trust.dan, 45, "ignoring an escalation costs 15");
  eq(Product.getState().openEvents.length, 0, "and closes it against you");
});

test("a scripted capacityDelta event takes eng-weeks off the quarter", function () {
  boot();
  eq(Product.getState().capacityBudget, 48, "48 to start");
  Product.advance(11);                       // the week-3 incident
  eq(Product.getState().capacityBudget, 43, "five eng-weeks gone");
});

/* -- 8. the north star ---------------------------------------------------- */

test("northStarProjected counts shipped features only, with noise until the end", function () {
  boot();
  Product.commit({ featureId: "f_a", predictedImpact: 4, rationale: LONG });
  Product.advance(6);                        // 4.8 of 5 — not shipped
  var st = Product.getState();
  near(st.northStarProjected, 30.0, 3.0, "still hovering around the baseline");
  eq(Product.getState().shipped.length, 0, "nothing shipped yet");

  Product.advance(1);                        // ships
  var samples = [];
  for (var i = 0; i < 6; i++) { Product.step(); samples.push(Product.getState().northStarProjected); }
  var moved = false;
  for (i = 0; i < samples.length; i++) {
    near(samples[i], 34.0, 3.0, "projected sits near 30 + 4.0");
    if (samples[i] !== 34.0) moved = true;
  }
  ok(moved, "and is measured with noise, not handed over clean");

  Product.advance(60);
  eq(Product.getState().finished, true, "quarter over");
  eq(Product.getState().northStarProjected, 34.0, "at the end the number is exact");
});

/* -- 9. scoring ----------------------------------------------------------- */

test("bestSet is brute-forced against the capacity constraint and interactions", function () {
  boot();
  var sc = Product.submitQBR({ narrative: "Nothing shipped, filing the paperwork anyway.", claimedImpact: 0 });
  deepEq(sc.bestSet, ["f_a", "f_c", "f_d"], "hand-computed optimum under 12 eng-weeks");
  eq(sc.bestPossible, 4.7, "4.0 + 0.6 + 0.1 = 4.7 for exactly 12 eng-weeks");
  eq(sc.capacityConstraint, 12, "the constraint came from the truth object");
  eq(sc.regret, 4.7, "shipping nothing means all of it is regret");
  eq(sc.regretRatio, 1, "ratio 1");
  eq(sc.grade, "F", "grade F");
  deepEq(sc.missedWins, ["f_a", "f_c", "f_d"], "all three missed");
});

test("the interaction bonus is respected when it is affordable", function () {
  Product.destroy();
  // same features, but Bravo is cheap: {f_a,f_b} = 4.0 + 3.0 + 1.5 = 8.5 for 10 eng-weeks,
  // and nothing else fits alongside it (the cheapest leftover is 3 eng-weeks, total 13 > 12).
  Product.init({ co: makeCo({ truth: { trueCost: { f_a: 5, f_b: 5, f_c: 4, f_d: 3, f_f: 3, f_e: 13.13 } } }), seed: 1 });
  var sc = Product.submitQBR({ narrative: "Filing an empty quarter for the arithmetic.", claimedImpact: 0 });
  deepEq(sc.bestSet, ["f_a", "f_b"], "the pair beats anything else at 12 eng-weeks");
  eq(sc.bestPossible, 8.5, "4.0 + 3.0 + 1.5 interaction");
  // without the interaction the greedy pick would be {f_a,f_c,f_d} = 4.7; the pair wins on the bonus
  ok(sc.bestPossible > 4.7, "the interaction is what makes the pair optimal");
});

test("shipping the optimum scores A; regret is clamped at zero", function () {
  boot();
  Product.commit({ featureId: "f_a", predictedImpact: 4, rationale: LONG });
  Product.commit({ featureId: "f_c", predictedImpact: 0.5, rationale: LONG });
  Product.advance(12);                       // 9.6 eng-weeks: both ship (5 + 4)
  eq(Product.getState().shipped.join(","), "f_a,f_c", "both shipped");
  var sc = Product.submitQBR({ narrative: "Two boring things that both landed.", claimedImpact: 4.6 });
  eq(sc.delta, 4.6, "4.0 + 0.6");
  eq(sc.northStarActual, 34.6, "30 + 4.6");
  eq(sc.bestPossible, 4.7, "optimum");
  near(sc.regret, 0.1, 1e-9, "regret 0.1");
  near(sc.regretRatio, 0.0213, 5e-5, "0.1 / 4.7");
  eq(sc.grade, "A", "under the 0.10 band");
  eq(sc.vanityShipped.length, 0, "no vanity");
  deepEq(sc.missedWins, ["f_d"], "left the cheap vanity win on the floor");
  eq(sc.claimError, 0, "claimed exactly what they got");
  eq(sc.wastedCapacity, 0, "nothing sunk");
  eq(sc.perFeature[0].verdict, "correct — shipped a winner", "Alpha verdict");
  eq(sc.perFeature[1].verdict, "correctly left out", "Bravo verdict");
});

test("MODIFIER 1 — two vanity features cap the grade at C", function () {
  boot();
  Product.commit({ featureId: "f_a", predictedImpact: 4, rationale: LONG });
  Product.commit({ featureId: "f_c", predictedImpact: 0.5, rationale: LONG });
  Product.commit({ featureId: "f_d", predictedImpact: 2, rationale: LONG });
  Product.commit({ featureId: "f_f", predictedImpact: 2, rationale: LONG });
  Product.advance(18);                       // 14.4 eng-weeks: 5+4+3+2 = 14 all ship
  var st = Product.getState();
  eq(st.shipped.join(","), "f_a,f_c,f_d,f_f", "all four shipped");
  ok(st.avgTrust >= 40, "trust is fine, so this cap is about vanity only (avg " + st.avgTrust + ")");
  var sc = Product.submitQBR({ narrative: "We shipped four things and the number moved.", claimedImpact: 4.75 });
  eq(sc.delta, 4.75, "4.0 + 0.6 + 0.1 + 0.05");
  eq(sc.regret, 0, "they beat the affordable optimum, so regret clamps to zero");
  deepEq(sc.vanityShipped, ["f_d", "f_f"], "two features with true impact < 0.5");
  eq(sc.grade, "C", "A on the metric, capped at C for the vanity");
  ok(sc.modifiers.join(" ").indexOf("capped at C") > -1, "and the score says so: " + sc.modifiers.join(" | "));
  eq(sc.perFeature[3].verdict, "vanity — shipped, moved nothing", "Delta verdict");
});

test("MODIFIER 2 — finishing under 40 avg trust caps the grade at C", function () {
  Product.destroy();
  // a cast where the CEO cares about none of it (so she never overrides the
  // roadmap) and the other four all champion the three features we drop.
  var cast = [
    { id: "marguerite", name: "Marguerite", role: "CEO", startTrust: 60, favors: [], opposes: [] },
    { id: "dan", name: "Dan", role: "VP Sales", startTrust: 60, favors: ["f_b", "f_d", "f_e"], opposes: [] },
    { id: "rina", name: "Rina", role: "Engineering lead", startTrust: 60, favors: ["f_b", "f_d", "f_e"], opposes: [] },
    { id: "kofi", name: "Kofi", role: "Design lead", startTrust: 60, favors: ["f_b", "f_d", "f_e"], opposes: [] },
    { id: "tomas", name: "Tomas", role: "Support lead", startTrust: 60, favors: ["f_b", "f_d", "f_e"], opposes: [] }
  ];
  Product.init({ co: makeCo({ stakeholders: cast, events: [] }), seed: 20260816 });

  Product.commit({ featureId: "f_b", predictedImpact: 3, rationale: LONG });
  Product.commit({ featureId: "f_d", predictedImpact: 1, rationale: LONG });
  Product.commit({ featureId: "f_e", predictedImpact: 6, rationale: LONG });
  Product.drop("f_b"); Product.drop("f_d"); Product.drop("f_e");
  eq(Product.getState().trust.rina, 24, "three noes each: 60 - 36");
  eq(Product.getState().trust.marguerite, 60, "the CEO is untouched, so no override");
  eq(Product.getState().avgTrust, 31.2, "(60 + 24*4) / 5");

  Product.commit({ featureId: "f_a", predictedImpact: 4, rationale: LONG });
  Product.commit({ featureId: "f_c", predictedImpact: 0.5, rationale: LONG });
  Product.advance(12);
  eq(Product.getState().shipped.join(","), "f_a,f_c", "the right two shipped anyway");

  var sc = Product.submitQBR({ narrative: "I won the number and lost the room.", claimedImpact: 4.6 });
  near(sc.regretRatio, 0.0213, 5e-5, "still an A on the metric");
  eq(sc.vanityShipped.length, 0, "no vanity features");
  eq(sc.trust.avg, 31.2, "avg trust under 40");
  eq(sc.grade, "C", "capped at C by the organisation");
  ok(sc.modifiers.join(" ").indexOf("31.2 trust") > -1, "the reason is spelled out: " + sc.modifiers.join(" | "));
  eq(sc.trust.lost.length, 4, "four people ended below where they started");
});

test("grade bands sit exactly where the spec puts them", function () {
  function gradeFor(shipIds) {
    boot();
    for (var i = 0; i < shipIds.length; i++) {
      Product.commit({ featureId: shipIds[i], predictedImpact: 1, rationale: LONG });
    }
    Product.advance(30);
    return Product.submitQBR({ narrative: "A quarter happened and here is the number.", claimedImpact: 1 });
  }
  // {f_a,f_c} -> 4.6, ratio 0.021 -> A   (covered above)
  // {f_a}     -> 4.0, regret 0.7 / 4.7 = 0.1489 -> B
  eq(gradeFor(["f_a"]).grade, "B", "ratio 0.149 is a B");
  // {f_c,f_d} -> 0.7, regret 4.0 / 4.7 = 0.851 -> F
  eq(gradeFor(["f_c", "f_d"]).grade, "F", "ratio 0.851 is an F");
  // {f_b} -> 3.0, regret 1.7 / 4.7 = 0.362 -> C
  var sc = gradeFor(["f_b"]);
  eq(sc.shippedSet.join(","), "f_b", "Bravo shipped (20 eng-weeks, 25 days)");
  eq(sc.grade, "C", "ratio 0.362 is a C");
});

test("calibration arithmetic on a hand-computed fixture", function () {
  boot();
  Product.commit({ featureId: "f_a", predictedImpact: 4.0, rationale: LONG });   // truth 4.0  -> err  0.0 hit
  Product.commit({ featureId: "f_c", predictedImpact: 3.0, rationale: LONG });   // truth 0.6  -> err +2.4 miss
  Product.commit({ featureId: "f_d", predictedImpact: 0.2, rationale: LONG });   // truth 0.1  -> err +0.1 hit
  var sc = Product.submitQBR({ narrative: "Three forecasts on the record, marked.", claimedImpact: 7.2 });
  var c = sc.calibration;
  eq(c.n, 3, "three forecasts");
  eq(c.hits, 2, "two inside the 1.0pp tolerance");
  near(c.hitRate, 0.6667, 1e-4, "2/3");
  near(c.meanAbsError, 0.8333, 1e-4, "(0 + 2.4 + 0.1) / 3");
  near(c.bias, 0.8333, 1e-4, "signed error mean: they talked their book");
  eq(c.overconfident, false, "hit rate is above half");
  eq(c.tolerance, 1, "the tolerance is disclosed");
  eq(c.rows.length, 3, "one row per forecast");
  eq(c.rows[0].featureId, "f_a", "rows sorted by id");
  eq(c.rows[1].error, 2.4, "Charlie error");
  eq(c.rows[1].hit, false, "Charlie missed");
  eq(c.rows[2].truth, 0.1, "Delta truth");
});

test("calibration marks a systematically overconfident PM", function () {
  boot();
  Product.commit({ featureId: "f_c", predictedImpact: 5.0, rationale: LONG });  // err +4.4
  Product.commit({ featureId: "f_d", predictedImpact: 4.0, rationale: LONG });  // err +3.9
  var sc = Product.submitQBR({ narrative: "I believed the survey and I was wrong.", claimedImpact: 9 });
  eq(sc.calibration.hitRate, 0, "nothing landed inside a point");
  eq(sc.calibration.overconfident, true, "flagged");
  near(sc.calibration.bias, 4.15, 1e-9, "(4.4 + 3.9) / 2");
});

test("instrumentUse counts every activity started, per instrument", function () {
  boot();
  Product.research({ featureId: "f_a", instrumentId: "survey" });
  Product.research({ featureId: "f_b", instrumentId: "survey" });
  Product.advance(2);
  Product.research({ featureId: "f_c", instrumentId: "sales_anecdote" });
  Product.advance(2);
  var sc = Product.submitQBR({ narrative: "Three studies and a shrug at the end.", claimedImpact: 0 });
  eq(sc.instrumentUse.survey, 2, "two surveys");
  eq(sc.instrumentUse.sales_anecdote, 1, "one chat with sales");
  eq(sc.instrumentUse.interviews, 0, "instruments never used are still reported");
  eq(sc.instrumentUse.ab_test, 0, "including the one you could not run");
});

test("submitQBR validates its own inputs and only fires once", function () {
  boot();
  rejects(Product.submitQBR({ narrative: LONG }), "Predicted impact required", "no claimed impact");
  rejects(Product.submitQBR({ narrative: "short", claimedImpact: 1 }), "Rationale required", "no narrative");
  eq(Product.submitQBR({ narrative: "A perfectly adequate narrative for a QBR.", claimedImpact: 1 }).ok,
    true, "accepted");
  rejects(Product.submitQBR({ narrative: LONG, claimedImpact: 1 }), "The QBR is already submitted", "twice");
  eq(Product.getState().finished, true, "the quarter is closed by the QBR");
});

/* -- 10. the exported document ------------------------------------------- */

test("exportQBR is markdown with the sections the spec asks for", function () {
  boot();
  Product.research({ featureId: "f_a", instrumentId: "survey" });
  Product.commit({ featureId: "f_a", predictedImpact: 4, rationale: "Interviews and the funnel both point here." });
  Product.commit({ featureId: "f_b", predictedImpact: 3, rationale: "The CEO wants it and it tested well." });
  Product.advance(20);                       // Alpha ships, Bravo slips and does not finish
  Product.submitQBR({ narrative: "We shipped the checklist and ate a slip on co-editing.", claimedImpact: 4 });
  var md = Product.exportQBR();

  ok(typeof md === "string" && md.length > 400, "a non-trivial string");
  eq(md.indexOf("# QBR"), 0, "starts with the title");
  ok(md.indexOf("## The quarter, in my words") > -1, "narrative section");
  ok(md.indexOf("We shipped the checklist and ate a slip on co-editing.") > -1, "the narrative as typed");
  ok(md.indexOf("## What shipped") > -1, "shipped section");
  ok(md.indexOf("## What slipped") > -1, "slip section");
  ok(md.indexOf("## Research readings") > -1, "every reading");
  ok(md.indexOf("Customer survey") > -1, "with the instrument used");
  ok(md.indexOf("## Forecasts on the record") > -1, "predicted vs actual");
  ok(md.indexOf("## Capacity accounting") > -1, "capacity accounting");
  ok(md.indexOf("## Trust ledger") > -1, "trust ledger");
  ok(md.indexOf("Unfinished at the buzzer") > -1, "and the worthless work");
  ok(md.indexOf("Alpha") > -1 && md.indexOf("Bravo") > -1, "the features by name");
  ok(md.indexOf("Interviews and the funnel both point here.") > -1, "rationales are on the record");
  // the slip WAS disclosed in-game, so it belongs in the document
  ok(md.indexOf("20.0") > -1, "the revised estimate the game already told them");
});

test("exportQBR leaks no ground truth", function () {
  boot();
  Product.research({ featureId: "f_e", instrumentId: "sales_anecdote" });
  Product.commit({ featureId: "f_a", predictedImpact: 4, rationale: LONG });
  Product.commit({ featureId: "f_c", predictedImpact: 1, rationale: LONG });
  Product.commit({ featureId: "f_e", predictedImpact: 6, rationale: LONG });   // never finishes
  Product.advance(12);
  eq(Product.getState().shipped.join(","), "f_a,f_c", "Echo is still in flight");
  Product.submitQBR({ narrative: "Two shipped, one never landed, here is why.", claimedImpact: 4.6 });
  var md = Product.exportQBR();

  // Echo never shipped: neither its true impact (7.77) nor its true cost (13.13) may appear
  eq(md.indexOf("7.77"), -1, "no true impact of an unshipped feature");
  eq(md.indexOf("13.13"), -1, "no true cost anywhere");
  eq(md.toLowerCase().indexOf("bias"), -1, "no bias table");
  eq(md.indexOf("trueCost"), -1, "no truth field names");
  ok(md.indexOf("Echo | not shipped") > -1 || md.indexOf("not shipped") > -1,
    "unshipped commits are marked, not scored");
  // but the realised impact of what DID ship is fair game once the quarter closed
  ok(md.indexOf("+4.0") > -1, "Alpha's realised impact is reported");
});

test("exportQBR works mid-quarter and reports the noisy projection instead", function () {
  boot();
  Product.commit({ featureId: "f_a", predictedImpact: 4, rationale: LONG });
  Product.advance(9);
  var md = Product.exportQBR();
  ok(md.indexOf("in flight") > -1, "marked as in flight");
  ok(md.indexOf("Projected (measured, noisy)") > -1, "no clean readout mid-flight");
  eq(md.indexOf("Actual at quarter end"), -1, "and no actual until the quarter closes");
});

/* -- 11. defensive ------------------------------------------------------- */

test("degenerate input is rejected rather than thrown at the player", function () {
  boot();
  rejects(Product.research({ featureId: "nope", instrumentId: "survey" }), "No such feature", "bad feature");
  rejects(Product.research({ featureId: "f_a", instrumentId: "nope" }), "No such instrument", "bad instrument");
  rejects(Product.commit({ featureId: "nope", predictedImpact: 1, rationale: LONG }), "No such feature", "bad commit");
  rejects(Product.drop("nope"), "That feature is not on the roadmap", "dropping nothing");
  eq(Product.commit({ featureId: "f_a", predictedImpact: 1, rationale: LONG }).ok, true, "commit");
  rejects(Product.commit({ featureId: "f_a", predictedImpact: 1, rationale: LONG }),
    "That feature is already on the roadmap", "double commit");
  eq(Product.setRoadmap(["nope", "f_a"]).ok, true, "unknown ids in setRoadmap are ignored");
  eq(Product.getState().roadmap.length, 1, "and nothing is invented");
  eq(Product.advance(-3).day, 0, "negative advance does nothing");
});

test("init throws only on genuinely unusable data", function () {
  var threw = false;
  try { Product.init({ co: { features: [], instruments: [] } }); } catch (e) { threw = true; }
  eq(threw, true, "no features is fatal");
  threw = false;
  try { Product.init({ co: { features: [{ id: "x" }], instruments: [{ id: "y" }] } }); } catch (e2) { threw = true; }
  eq(threw, true, "no reveal() is fatal");
});

/* ======================================================================== */

console.log("");
console.log("------------------------------------------------------------");
if (FAIL === 0) {
  console.log("PASS  " + PASS + "/" + (PASS + FAIL) + " tests passed.");
  console.log("------------------------------------------------------------");
  console.log("");
  process.exit(0);
} else {
  console.log("FAIL  " + FAIL + " of " + (PASS + FAIL) + " tests failed:");
  for (var i = 0; i < FAILURES.length; i++) console.log("   - " + FAILURES[i]);
  console.log("------------------------------------------------------------");
  console.log("");
  process.exit(1);
}
