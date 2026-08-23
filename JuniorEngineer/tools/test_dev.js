#!/usr/bin/env node
/* ==========================================================================
 * tools/test_dev.js — self-contained unit tests for sim/dev.js
 *
 *   node tools/test_dev.js
 *
 * Zero dependencies. Loads the module exactly the way a <script> tag would:
 * we hand it a `window` and it attaches itself to it.
 *
 * The fixture below is SYNTHETIC on purpose — these tests must not depend on
 * data/repo.js, and must not be able to pass by accident because the real
 * numbers happen to line up. Every expected value here is hand-computed from
 * the fixture in a comment next to the assertion.
 * ========================================================================== */
"use strict";

var path = require("path");
var DEV_PATH = path.join(__dirname, "..", "sim", "dev.js");

/* -------- the tiny shim: dev.js is browser code, give it a window -------- */
global.window = global;
require(DEV_PATH);
var Dev = global.window.Dev;

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

function contains(hay, needle, msg) {
  if (String(hay).indexOf(needle) === -1) {
    throw new Error((msg || "expected substring") + ": " + JSON.stringify(needle) +
      "\n          in: " + String(hay).slice(0, 400));
  }
}

function lacks(hay, needle, msg) {
  if (String(hay).indexOf(needle) !== -1) {
    throw new Error((msg || "unexpected substring") + ": " + JSON.stringify(needle));
  }
}

/* a question comfortably over RULES.minQuestionChars (25) */
var Q = "I have read the ordering module and traced the sort key; what am I missing?";
ok(Q.length >= 25, "fixture question must clear minQuestionChars");

/* ---------------------------------------------- synthetic SIM_REPO ------ */
/*
 * FOUR ACTIONS
 *   read_code  30 min
 *   read_docs  20 min
 *   git_blame  15 min
 *   just_try   45 min
 *
 * SIX TICKETS (decay 0.5 everywhere except T-2, which uses 0.9)
 *
 *  id   pts  effort  timebox  self?  cap  tests  conv         yields
 *  T-1   3    2.0     1.0     yes   100   no    —            read_code 40, read_docs -20,
 *                                                            git_blame 30, just_try 10,
 *                                                            ask_deepa 60, ask_hannah 5,
 *                                                            ask_channel 15
 *  T-2   3    1.0     1.0     NO     55   no    —            read_code 40, git_blame 30,
 *                                                            read_docs 5, just_try -10,
 *                                                            ask_deepa 80, ask_hannah 2,
 *                                                            ask_channel 0   (nobody knows)
 *  T-3   2    1.0     1.0     yes   100   YES   RightWay     read_code 50, git_blame 45,
 *                                              (trap         read_docs 10, just_try 5,
 *                                               WrongWay)    ask_deepa 40, ...
 *  T-4   5    1.0     1.0     yes   100   no    —            read_code 50, git_blame 45,
 *        needsClarification: "hannah"                        read_docs 10, just_try 5,
 *                                                            ask_hannah 30, ...
 *  T-5   1    1.0    10.0     yes   100   no    —            read_code 50, git_blame 45,
 *        scopeTrap {guardedBy:["read_docs"], naive 200,      read_docs 20, just_try -5, ...
 *                   budget 10}
 *  T-6   2    1.0     0.5     yes   100   no    —            git_blame 40, read_code 20,
 *        shouldAbandon: true                                 read_docs 5, just_try 5,
 *                                                            ask_deepa 50, ask_channel 10
 *
 *  totalPoints = 3+3+2+5+1+2 = 16 ; bestHours = 20 ; seniorBudgetHours = 10
 *  four people, all starting at trust 55.
 */
function makeRepo(over) {
  over = over || {};

  var truth = {
    tickets: {
      "T-1": {
        points: 3, needed: 70, effortHours: 2.0, decay: 0.5, timeboxHours: 1.0,
        selfFindable: true, soloCap: 100, needsTests: false,
        convention: null, conventionTrap: null,
        yields: {
          read_code: 40, read_docs: -20, git_blame: 30, just_try: 10,
          ask_deepa: 60, ask_hannah: 5, ask_channel: 15
        },
        cause: "SECRETCAUSE-T1", notes: "SECRETNOTE-T1"
      },
      "T-2": {
        points: 3, needed: 70, effortHours: 1.0, decay: 0.9, timeboxHours: 1.0,
        selfFindable: false, soloCap: 55, needsTests: false,
        convention: null, conventionTrap: null,
        yields: {
          read_code: 40, git_blame: 30, read_docs: 5, just_try: -10,
          ask_deepa: 80, ask_hannah: 2, ask_channel: 0
        },
        cause: "SECRETCAUSE-T2", notes: "SECRETNOTE-T2"
      },
      "T-3": {
        points: 2, needed: 70, effortHours: 1.0, decay: 0.5, timeboxHours: 1.0,
        selfFindable: true, soloCap: 100, needsTests: true,
        convention: "RightWay", conventionTrap: "WrongWay",
        yields: {
          read_code: 50, git_blame: 45, read_docs: 10, just_try: 5,
          ask_deepa: 40, ask_hannah: 5, ask_channel: 10
        },
        cause: "SECRETCAUSE-T3", notes: "SECRETNOTE-T3"
      },
      "T-4": {
        points: 5, needed: 70, effortHours: 1.0, decay: 0.5, timeboxHours: 1.0,
        selfFindable: true, soloCap: 100, needsTests: false,
        convention: null, conventionTrap: null, needsClarification: "hannah",
        yields: {
          read_code: 50, git_blame: 45, read_docs: 10, just_try: 5,
          ask_deepa: 20, ask_hannah: 30, ask_channel: 5
        },
        cause: "SECRETCAUSE-T4", notes: "SECRETNOTE-T4"
      },
      "T-5": {
        points: 1, needed: 70, effortHours: 1.0, decay: 0.5, timeboxHours: 10.0,
        selfFindable: true, soloCap: 100, needsTests: false,
        convention: null, conventionTrap: null,
        scopeTrap: { guardedBy: ["read_docs"], naiveFiles: 200, budget: 10 },
        yields: {
          read_code: 50, git_blame: 45, read_docs: 20, just_try: -5,
          ask_deepa: 10, ask_hannah: 5, ask_channel: 5
        },
        cause: "SECRETCAUSE-T5", notes: "SECRETNOTE-T5"
      },
      "T-6": {
        points: 2, needed: 70, effortHours: 1.0, decay: 0.5, timeboxHours: 0.5,
        selfFindable: true, soloCap: 100, needsTests: false,
        convention: null, conventionTrap: null, shouldAbandon: true,
        yields: {
          git_blame: 40, read_code: 20, read_docs: 5, just_try: 5,
          ask_deepa: 50, ask_hannah: 2, ask_channel: 10
        },
        cause: "SECRETCAUSE-T6", notes: "SECRETNOTE-T6"
      }
    },
    bestPath: { "T-1": ["read_code", "git_blame", "read_code"] },
    bestHours: 20,
    totalPoints: 16
  };

  var allTickets = [
    { id: "T-1", type: "bug", priority: "P2", reporter: "Support", points: 3,
      title: "Sort order scrambles", description: "d1", acceptance: ["a"] },
    { id: "T-2", type: "bug", priority: "P1", reporter: "Support", points: 3,
      title: "Duplicate webhooks", description: "d2", acceptance: ["a"] },
    { id: "T-3", type: "feature", priority: "P3", reporter: "PM", points: 2,
      title: "CSV export", description: "d3", acceptance: ["a"] },
    { id: "T-4", type: "feature", priority: "P1", reporter: "PM", points: 5,
      title: "Rate limiting", description: "d4", acceptance: ["a"] },
    { id: "T-5", type: "chore", priority: "P3", reporter: "Reviewer", points: 1,
      title: "Lint preset", description: "d5", acceptance: ["a"] },
    { id: "T-6", type: "bug", priority: "P3", reporter: "CI", points: 2,
      title: "Flaky test", description: "d6", acceptance: ["a"] }
  ];

  var keep = over.only || null;
  var tickets = keep
    ? allTickets.filter(function (t) { return keep.indexOf(t.id) !== -1; })
    : allTickets;

  var startTrust = over.startTrust == null ? 55 : over.startTrust;

  var repo = {
    scenario: {
      company: "Testco", product: "Test product", role: "Software Engineer I", team: "Dispatch",
      sprint: { days: 10, hoursPerDay: 6, startDay: 1 },
      codebase: { loc: 412000, ageYears: 9, langs: ["Python"], note: "old" },
      seniorBudgetHours: over.seniorBudgetHours == null ? 10 : over.seniorBudgetHours,
      brief: "brief"
    },
    tickets: tickets,
    actions: [
      { id: "read_code", name: "Read the code", minutes: 30, desc: "", caveat: "c1" },
      { id: "read_docs", name: "Read the docs", minutes: 20, desc: "", caveat: "c2" },
      { id: "git_blame", name: "git log / blame", minutes: 15, desc: "", caveat: "c3" },
      { id: "just_try", name: "Try a fix", minutes: 45, desc: "", caveat: "c4" }
    ],
    people: [
      { id: "deepa", name: "Deepa Iyer", role: "Staff Engineer", startTrust: startTrust, voice: "MENTOR", desc: "" },
      { id: "tobias", name: "Tobias Lindqvist", role: "Tech Lead", startTrust: startTrust, voice: "LEAD", desc: "" },
      { id: "nnamdi", name: "Nnamdi Eze", role: "Senior Engineer", startTrust: startTrust, voice: "REVIEWER", desc: "" },
      { id: "hannah", name: "Hannah Brecht", role: "Product Manager", startTrust: startTrust, voice: "PM", desc: "" }
    ],
    events: [],
    _truth: truth
  };
  repo.reveal = function () { return this._truth; };
  return repo;
}

function boot(seed, over) {
  Dev.destroy();
  Dev.init({ repo: makeRepo(over), seed: seed == null ? 20260823 : seed });
  return Dev;
}

/** estimate + select in one go */
function open(id, hours) {
  Dev.select(id);
  var r = Dev.estimate(id, hours == null ? 2 : hours);
  ok(r.ok, "estimate " + id + " failed: " + JSON.stringify(r));
  return r;
}

function inv(id, action) {
  var r = Dev.investigate({ ticketId: id, actionId: action });
  ok(r.ok, "investigate " + id + "/" + action + " failed: " + JSON.stringify(r));
  return r;
}

function ticket(id) {
  var s = Dev.getState();
  for (var i = 0; i < s.tickets.length; i++) if (s.tickets[i].id === id) return s.tickets[i];
  return null;
}

/** run the PR clock forward until a review lands (lag is 2–5h) */
function awaitReview(id) {
  var before = ticket(id).reviews.length;
  for (var i = 0; i < 40 && ticket(id).reviews.length === before; i++) Dev.advance(0.25);
  var revs = ticket(id).reviews;
  ok(revs.length > before, "no review landed for " + id);
  return revs[revs.length - 1];
}

console.log("\n=== sim/dev.js ===\n");

/* ==================================================================== */
console.log("-- boot & clock");

test("init returns a sane opening state", function () {
  boot();
  var s = Dev.getState();
  eq(s.day, 1, "day");
  eq(s.hour, 9, "hour");
  eq(s.t, "D1 09:00", "stamp");
  eq(s.tick, 0, "tick");
  eq(s.hoursLeft, 60, "hoursLeft");
  eq(s.seniorLeft, 10, "seniorLeft");
  eq(s.tickets.length, 6, "six tickets");
  eq(s.active, null, "nothing selected");
  eq(s.avgTrust, 55, "avg trust");
  eq(s.merged.length, 0, "nothing merged");
  eq(s.finished, false, "not finished");
  eq(s.seed, 20260823, "default seed carried");
});

test("RULES matches the spec verbatim", function () {
  var R = Dev.RULES;
  eq(R.days, 10); eq(R.hoursPerDay, 6); eq(R.totalHours, 60); eq(R.tickMinutes, 15);
  eq(R.seniorBudgetHours, 10);
  eq(R.startTrust, 55); eq(R.minTrust, 0); eq(R.maxTrust, 100);
  eq(R.implementReadyAt, 70); eq(R.correctAt, 90);
  eq(R.reviewLagHours.min, 2); eq(R.reviewLagHours.max, 5);
  eq(R.askCostMinutes, 15); eq(R.vagueAskExtraMinutes, 30);
  eq(R.stuckHours, 3); eq(R.minQuestionChars, 25);
  eq(R.estimateRequired, true);
  eq(Dev.DEFAULT_SEED, 20260823, "default seed");
});

test("the clock walks D1 09:00 -> D10 15:00 and stops", function () {
  boot();
  Dev.advance(6);                      // one whole day
  eq(Dev.getState().t, "D2 09:00", "day boundary");
  eq(Dev.getState().day, 2);
  Dev.advance(2.25);
  eq(Dev.getState().t, "D2 11:15", "quarter-hour stamp");
  eq(Dev.getState().hour, 11.25, "fractional hour");
  Dev.advance(100);                    // way past the buzzer
  var s = Dev.getState();
  eq(s.t, "D10 15:00", "the sprint ends at the end of day 10");
  eq(s.finished, true, "finished");
  eq(s.hoursLeft, 0, "no hours left");
  eq(s.tick, 240, "240 ticks of 15 minutes = 60 hours");
});

test("step() advances exactly one 15-minute tick", function () {
  boot();
  Dev.step();
  eq(Dev.getState().minutes, 15);
  eq(Dev.getState().t, "D1 09:15");
});

/* ==================================================================== */
console.log("\n-- the understanding model");

test("gained = yield * decay^(timesAlreadyDone)", function () {
  boot();
  open("T-1", 3);
  // T-1 read_code yield 40, decay 0.5
  eq(inv("T-1", "read_code").gained, 40, "1st: 40 * 0.5^0");
  eq(ticket("T-1").understanding, 40);
  eq(inv("T-1", "read_code").gained, 20, "2nd: 40 * 0.5^1");
  eq(ticket("T-1").understanding, 60);
  eq(inv("T-1", "read_code").gained, 10, "3rd: 40 * 0.5^2");
  eq(ticket("T-1").understanding, 70);
  eq(inv("T-1", "read_code").gained, 5, "4th: 40 * 0.5^3");
  eq(ticket("T-1").understanding, 75);
  // a different action has its own independent counter
  eq(inv("T-1", "git_blame").gained, 30, "git_blame 1st: 30 * 0.5^0");
  eq(ticket("T-1").understanding, 105);
  eq(inv("T-1", "git_blame").gained, 15, "git_blame 2nd: 30 * 0.5^1");
  eq(ticket("T-1").understanding, 120, "clamped at MAX_UNDERSTANDING (105+15=120)");
});

test("a negative yield SUBTRACTS understanding", function () {
  boot();
  open("T-1", 3);
  inv("T-1", "read_code");                       // 40
  var r = inv("T-1", "read_docs");               // -20 * 0.5^0
  eq(r.gained, -20, "the docs lie and it costs you");
  eq(r.negative, true, "flagged negative");
  eq(ticket("T-1").understanding, 20, "40 - 20");
  eq(inv("T-1", "read_docs").gained, -10, "-20 * 0.5^1");
  eq(ticket("T-1").understanding, 10);
  eq(inv("T-1", "read_docs").gained, -5, "-20 * 0.5^2");
  eq(ticket("T-1").understanding, 5);
});

test("understanding clamps to [0, 120]", function () {
  boot();
  open("T-1", 3);
  var r = inv("T-1", "read_docs");                // -20 from zero
  eq(ticket("T-1").understanding, 0, "floors at 0");
  eq(r.gained, 0, "no delta once you are already at the floor");
  boot();
  open("T-1", 3);
  for (var i = 0; i < 10; i++) Dev.investigate({ ticketId: "T-1", actionId: "read_code" });
  for (i = 0; i < 10; i++) Dev.investigate({ ticketId: "T-1", actionId: "git_blame" });
  ok(ticket("T-1").understanding <= 120, "never above 120");
  eq(ticket("T-1").understanding, 120, "and it does reach the ceiling");
  eq(Dev.MAX_UNDERSTANDING, 120);
});

test("soloCap: no sequence of solo actions can break the ceiling", function () {
  boot();
  open("T-2", 3);                                 // selfFindable false, soloCap 55
  var actions = ["read_code", "read_docs", "git_blame", "just_try"];
  var worst = 0;
  for (var round = 0; round < 12; round++) {
    for (var a = 0; a < actions.length; a++) {
      var r = Dev.investigate({ ticketId: "T-2", actionId: actions[a] });
      if (!r.ok) continue;                        // sprint may run out; ceiling still holds
      var u = ticket("T-2").understanding;
      if (u > worst) worst = u;
      ok(u <= 55 + 1e-9, "solo understanding broke the cap at " + u);
    }
  }
  eq(worst, 55, "and the cap is actually reached, not merely never approached");
  ok(ticket("T-2").understanding < 70, "so it can never be implemented alone");
});

test("soloCap does not apply to asks, and a later solo action cannot drag you down", function () {
  boot();
  open("T-2", 3);
  for (var i = 0; i < 10; i++) inv("T-2", "read_code");
  eq(ticket("T-2").understanding, 55, "pinned at the cap");
  var r = Dev.ask({ ticketId: "T-2", to: "deepa", question: Q });
  ok(r.ok, JSON.stringify(r));
  // ask_deepa 80 * 0.9^0 = 80 -> 55 + 80 = 135 -> clamped to 120
  eq(r.gained, 65, "55 -> 120 is a gain of 65");
  eq(ticket("T-2").understanding, 120, "the ask blows straight past soloCap");
  var after = inv("T-2", "read_code");
  eq(after.gained, 0, "a solo action above the cap yields nothing");
  eq(ticket("T-2").understanding, 120, "and it does NOT pull you back to 55");
});

test("selfFindable tickets are not capped", function () {
  boot();
  open("T-1", 3);
  inv("T-1", "read_code"); inv("T-1", "read_code"); inv("T-1", "git_blame");
  eq(ticket("T-1").understanding, 90, "40 + 20 + 30");
});

/* ==================================================================== */
console.log("\n-- asking");

test("premature ask: -6 trust, 45 minutes of your time, 45 of hers", function () {
  boot();
  open("T-1", 3);                                  // timebox 1.0h, nothing tried yet
  var r = Dev.ask({ ticketId: "T-1", to: "deepa", question: Q });
  ok(r.ok, JSON.stringify(r));
  eq(r.classification, "premature");
  eq(r.trustDelta, -6);
  eq(Dev.getState().trust.deepa, 49, "55 - 6");
  eq(r.seniorMinutes, 45, "askCostMinutes 15 + vagueAskExtraMinutes 30");
  near(Dev.seniorUsed, 0.75, 1e-9, "45 minutes of her 10 hours");
  eq(Dev.getState().minutes, 45, "and 45 minutes of yours");
  eq(r.gained, 60, "she still answers: ask_deepa 60");
});

test("well-formed ask by timebox: +4 trust, half a premature ask of her budget", function () {
  boot();
  open("T-1", 3);
  inv("T-1", "read_code"); inv("T-1", "read_code");   // 60 min == timeboxHours 1.0
  eq(ticket("T-1").hoursSpent, 1, "exactly on the timebox");
  var r = Dev.ask({ ticketId: "T-1", to: "deepa", question: Q });
  eq(r.classification, "well-formed");
  eq(r.trustDelta, 4);
  eq(Dev.getState().trust.deepa, 59, "55 + 4");
  eq(r.seniorMinutes, 22.5, "half of a premature ask");
  near(Dev.seniorUsed, 0.375, 1e-9);
  eq(Dev.getState().minutes, 60 + 15, "your time is just askCostMinutes");
});

test("well-formed ask because the ticket is not self-findable", function () {
  boot();
  open("T-2", 3);
  var r = Dev.ask({ ticketId: "T-2", to: "deepa", question: Q });
  eq(r.classification, "well-formed", "0 hours in, but no solo route exists");
  eq(r.trustDelta, 4);
});

test("well-formed ask because every solo avenue is exhausted", function () {
  boot();
  open("T-5", 3);                                  // timeboxHours 10 — unreachable
  inv("T-5", "read_code"); inv("T-5", "git_blame"); inv("T-5", "read_docs");
  eq(ticket("T-5").hoursSpent, 1.08, "65 minutes, nowhere near the 10h timebox");
  eq(Dev.classifyAsk("T-5"), "well-formed", "positive-yield solo actions all used up");
  var r = Dev.ask({ ticketId: "T-5", to: "deepa", question: Q });
  eq(r.classification, "well-formed");
  eq(r.trustDelta, 4);
});

test("overdue ask: -3 trust, and she notices", function () {
  boot();
  open("T-6", 3);                                  // timebox 0.5h -> overdue at 1.25h
  inv("T-6", "just_try"); inv("T-6", "just_try"); inv("T-6", "just_try");
  eq(ticket("T-6").hoursSpent, 2.25, "3 x 45 minutes");
  // just_try 5, 2.5, 1.25 = 8.75 understanding, well below implementReadyAt 70
  eq(ticket("T-6").understanding, 8.75);
  var r = Dev.ask({ ticketId: "T-6", to: "deepa", question: Q });
  eq(r.classification, "overdue");
  eq(r.trustDelta, -3);
  eq(Dev.getState().trust.deepa, 52, "55 - 3");
  eq(r.seniorMinutes, 30, "15 + 30/2");
});

test("an overdue ask is only overdue while you are still below implementReadyAt", function () {
  boot();
  open("T-1", 3);
  // 2.5 x timebox = 2.5h. read_code x5 = 150 min = 2.5h, understanding 40+20+10+5+2.5 = 77.5
  for (var i = 0; i < 5; i++) inv("T-1", "read_code");
  eq(ticket("T-1").hoursSpent, 2.5);
  eq(ticket("T-1").understanding, 77.5, "past implementReadyAt 70");
  eq(Dev.classifyAsk("T-1"), "well-formed", "late, but you are not stuck — so it is not overdue");
});

test("asking Hannah costs no senior budget", function () {
  boot();
  open("T-4", 3);
  var r = Dev.ask({ ticketId: "T-4", to: "hannah", question: Q });
  ok(r.ok);
  eq(r.seniorMinutes, 0, "the PM is not Deepa's budget");
  eq(Dev.seniorUsed, 0);
  eq(Dev.getState().seniorLeft, 10);
  eq(Dev.getState().trust.hannah, 49, "premature is still premature: 55 - 6");
  eq(Dev.getState().trust.deepa, 55, "and it does not touch Deepa");
});

test("the channel is free, costs half the trust, and replies after a delay", function () {
  boot();
  open("T-1", 3);
  var r = Dev.ask({ ticketId: "T-1", to: "channel", question: Q });
  ok(r.ok);
  eq(r.classification, "premature");
  eq(r.trustDelta, -3, "half of -6, rounded");
  eq(Dev.getState().trust[Dev.CHANNEL_TRUST_TO], 52, "55 - 3");
  eq(r.seniorMinutes, 0, "free");
  eq(r.pending, true, "async");
  ok(r.etaMinutes >= 30 && r.etaMinutes <= 120, "delay in [30,120], got " + r.etaMinutes);
  eq(r.gained, 0, "nothing has landed yet");
  eq(ticket("T-1").understanding, 0);
  Dev.advance(3);                                    // well past 120 minutes
  eq(ticket("T-1").understanding, 15, "ask_channel yield 15 lands late");
});

test("the channel does not answer when nobody there knows", function () {
  boot();
  open("T-2", 3);                                    // ask_channel yield 0
  var r = Dev.ask({ ticketId: "T-2", to: "channel", question: Q });
  ok(r.ok);
  Dev.advance(3);
  eq(ticket("T-2").understanding, 0, "two people speculate, neither about your problem");
});

test("Deepa's budget is a real ceiling", function () {
  boot(null, { seniorBudgetHours: 0.5 });            // 30 minutes, total
  open("T-1", 3);
  var r1 = Dev.ask({ ticketId: "T-1", to: "deepa", question: Q });
  ok(r1.ok, "the first ask goes through");
  eq(Dev.getState().seniorLeft, 0, "a 45-minute ask eats a 30-minute budget");
  rejects(Dev.ask({ ticketId: "T-1", to: "deepa", question: Q }),
    "Deepa has no time left this sprint");
  ok(Dev.ask({ ticketId: "T-1", to: "hannah", question: Q }).ok, "Hannah is still free");
  ok(Dev.ask({ ticketId: "T-1", to: "channel", question: Q }).ok, "so is the channel");
});

test("repeated asks decay like everything else", function () {
  boot();
  open("T-1", 3);
  var a = Dev.ask({ ticketId: "T-1", to: "deepa", question: Q });
  eq(a.gained, 60, "ask_deepa 60 * 0.5^0");
  var b = Dev.ask({ ticketId: "T-1", to: "deepa", question: Q });
  eq(b.gained, 30, "ask_deepa 60 * 0.5^1");
});

/* ==================================================================== */
console.log("\n-- implement");

test("implement() is gated on understanding, not on time", function () {
  boot();
  open("T-1", 2);
  inv("T-1", "read_code");                            // 40
  rejects(Dev.implement("T-1"), "You need to understand this better before you can implement it");
  inv("T-1", "git_blame");                            // 70 = implementReadyAt
  ok(Dev.implement("T-1").ok, "70 is exactly enough to open the box");
});

test("implement() cost scales with the understanding you skipped", function () {
  boot();
  open("T-1", 2);
  inv("T-1", "read_code"); inv("T-1", "git_blame");    // 70
  var before = Dev.getState().minutes;
  var r = Dev.implement("T-1");
  // effortHours 2.0 * (1 + max(0, 90 - 70)/100) = 2.0 * 1.2 = 2.4h = 144 min
  eq(r.hours, 2.4, "2.0 * 1.2");
  eq(r.minutes, 144);
  eq(r.reworkHours, 0.4, "0.4h of pure rework");
  eq(Dev.getState().minutes - before, 144, "and the clock really moved");
});

test("implement() at correctAt costs exactly effortHours", function () {
  boot();
  open("T-1", 2);
  inv("T-1", "read_code"); inv("T-1", "read_code"); inv("T-1", "git_blame");   // 90
  eq(ticket("T-1").understanding, 90);
  var r = Dev.implement("T-1");
  eq(r.hours, 2, "no shortfall, no rework");
  eq(r.reworkHours, 0);
});

test("implement() above correctAt is not cheaper than effortHours", function () {
  boot();
  open("T-1", 2);
  inv("T-1", "read_code"); inv("T-1", "read_code");
  inv("T-1", "git_blame"); inv("T-1", "git_blame");     // 40+20+30+15 = 105
  eq(ticket("T-1").understanding, 105);
  eq(Dev.implement("T-1").hours, 2, "max(0, ...) floors the scaling at 1x");
});

/* ==================================================================== */
console.log("\n-- PR review");

test("clean merge", function () {
  boot();
  open("T-1", 2);
  inv("T-1", "read_code"); inv("T-1", "read_code"); inv("T-1", "git_blame");  // 90
  Dev.implement("T-1");
  var pr = Dev.openPR("T-1");
  ok(pr.ok);
  ok(pr.reviewInHours >= 2 && pr.reviewInHours <= 5, "lag in [2,5], got " + pr.reviewInHours);
  eq(ticket("T-1").status, "in_review");
  var rev = awaitReview("T-1");
  eq(rev.merged, true, "merged: " + JSON.stringify(rev.reasons));
  deepEq(rev.reasons, []);
  eq(ticket("T-1").status, "merged");
  eq(ticket("T-1").bounces, 0);
  eq(Dev.getState().merged.join(","), "T-1");
  eq(Dev.getState().trust.nnamdi, 58, "55 + 3 on a clean merge");
  eq(Dev.getState().trust.tobias, 57, "55 + 2");
});

test("bounce: understanding below correctAt", function () {
  boot();
  open("T-1", 2);
  inv("T-1", "read_code"); inv("T-1", "git_blame");     // 70, below correctAt 90
  Dev.implement("T-1");
  Dev.openPR("T-1");
  var rev = awaitReview("T-1");
  eq(rev.merged, false);
  deepEq(rev.reasons, ["understanding"], "only understanding failed");
  contains(rev.comments.join(" "), "Walk me through why this fixes it");
  contains(rev.comments.join(" "), "90", "the comment names the bar");
  eq(ticket("T-1").bounces, 1);
  eq(ticket("T-1").status, "implementing", "a bounce is not fatal");
  eq(Dev.getState().trust.nnamdi, 53, "55 - 2");
});

test("bounce: no tests on a ticket that needs them", function () {
  boot();
  open("T-3", 2);
  inv("T-3", "read_code"); inv("T-3", "git_blame");     // 50 + 45 = 95
  eq(ticket("T-3").understanding, 95);
  Dev.setConvention("T-3", "RightWay");
  Dev.implement("T-3");
  Dev.openPR("T-3");
  var rev = awaitReview("T-3");
  eq(rev.merged, false);
  deepEq(rev.reasons, ["tests"], "tests, and nothing else");
  contains(rev.comments.join(" "), "no new tests");
  contains(rev.comments.join(" "), "regression test");
});

test("bounce: the convention trap", function () {
  boot();
  open("T-3", 2);
  inv("T-3", "read_code"); inv("T-3", "git_blame");     // 95
  Dev.writeTests("T-3");
  Dev.setConvention("T-3", "WrongWay");                 // what the neighbours taught you
  Dev.implement("T-3");
  Dev.openPR("T-3");
  var rev = awaitReview("T-3");
  eq(rev.merged, false);
  deepEq(rev.reasons, ["convention"]);
  contains(rev.comments.join(" "), "WrongWay", "names what you picked");
  contains(rev.comments.join(" "), "RightWay", "and what it should have been");
  contains(rev.comments.join(" "), "deprecated");
  // choosing correctly clears it
  Dev.setConvention("T-3", "RightWay");
  Dev.openPR("T-3");
  eq(awaitReview("T-3").merged, true, "right pattern, tests present, understood");
});

test("bounce: no convention chosen at all", function () {
  boot();
  open("T-3", 2);
  inv("T-3", "read_code"); inv("T-3", "git_blame");
  Dev.writeTests("T-3");
  Dev.implement("T-3");
  Dev.openPR("T-3");
  var rev = awaitReview("T-3");
  deepEq(rev.reasons, ["convention"]);
  contains(rev.comments.join(" "), "RightWay");
});

test("bounce: needsClarification bounces at ANY understanding", function () {
  boot();
  open("T-4", 2);
  inv("T-4", "read_code"); inv("T-4", "git_blame");     // 50 + 45 = 95, well past correctAt
  eq(ticket("T-4").understanding, 95);
  Dev.implement("T-4");
  Dev.openPR("T-4");
  var rev = awaitReview("T-4");
  eq(rev.merged, false, "understanding was never the problem");
  deepEq(rev.reasons, ["clarification"]);
  contains(rev.comments.join(" "), "Hannah Brecht", "names the person to go and ask");
  // asking the RIGHT person clears it; asking anyone else does not
  Dev.ask({ ticketId: "T-4", to: "deepa", question: Q });
  Dev.openPR("T-4");
  deepEq(awaitReview("T-4").reasons, ["clarification"], "Deepa cannot answer for Hannah");
  Dev.ask({ ticketId: "T-4", to: "hannah", question: Q });
  Dev.openPR("T-4");
  eq(awaitReview("T-4").merged, true, "one message to the PM was the whole ticket");
});

test("bounce: the scope trap", function () {
  boot();
  open("T-5", 2);
  inv("T-5", "read_code"); inv("T-5", "git_blame");     // 50 + 45 = 95, no read_docs
  var im = Dev.implement("T-5");
  eq(im.filesTouched, 200, "unguarded: the naive diff");
  eq(im.scopeBudget, 10);
  Dev.openPR("T-5");
  var rev = awaitReview("T-5");
  eq(rev.merged, false);
  deepEq(rev.reasons, ["scope"]);
  contains(rev.comments.join(" "), "200 files");
  contains(rev.comments.join(" "), "budget of 10");
  // the guard is one of scopeTrap.guardedBy
  inv("T-5", "read_docs");
  var im2 = Dev.implement("T-5");
  eq(im2.filesTouched, 5, "guarded: scoped to the package that asked for it");
  Dev.openPR("T-5");
  eq(awaitReview("T-5").merged, true);
});

test("bounces stack and every failing gate is named", function () {
  boot();
  open("T-3", 2);
  inv("T-3", "read_code");                              // 50 only: below correctAt
  eq(ticket("T-3").understanding, 50);
  rejects(Dev.implement("T-3"), "You need to understand this better before you can implement it");
  inv("T-3", "git_blame");                              // 95
  inv("T-3", "just_try");                               // +5 -> 100
  Dev.setConvention("T-3", "WrongWay");
  Dev.implement("T-3");
  Dev.openPR("T-3");
  var rev = awaitReview("T-3");
  deepEq(rev.reasons, ["tests", "convention"], "both, in review order");
  ok(rev.comments.length >= 3, "one comment per problem, plus CI");
});

/* ==================================================================== */
console.log("\n-- abandon");

test("abandoning a misfiled ticket is the right answer and scores positively", function () {
  boot();
  open("T-6", 1);
  inv("T-6", "git_blame");                              // 40 — enough to know it is not yours
  var r = Dev.abandon("T-6");
  ok(r.ok);
  eq(r.trustDelta, 5, "handing it back with what you found is a contribution");
  eq(ticket("T-6").status, "abandoned");
  eq(Dev.getState().trust.tobias, 60, "55 + 5");
  var sc = Dev.submitRetro({ narrative: "n", whatIdDoDifferently: "w" });
  deepEq(sc.rightAbandons, ["T-6"]);
  deepEq(sc.wrongAbandons, []);
  eq(sc.deliveredPoints, 2, "+2 points, the full value of the ticket");
  eq(sc.perTicket[5].outcome.indexOf("correctly handed back"), 0);
});

test("abandoning a solvable ticket is penalised", function () {
  boot();
  open("T-1", 2);
  inv("T-1", "read_code");
  var r = Dev.abandon("T-1");
  eq(r.trustDelta, -5);
  eq(Dev.getState().trust.tobias, 50, "55 - 5");
  var sc = Dev.submitRetro({ narrative: "n", whatIdDoDifferently: "w" });
  deepEq(sc.wrongAbandons, ["T-1"]);
  deepEq(sc.rightAbandons, []);
  eq(sc.deliveredPoints, -1.5, "-3/2");
  contains(sc.perTicket[0].outcome, "yours to finish");
});

test("merging a fix for a misfiled ticket is a false fix", function () {
  boot();
  open("T-6", 1);
  inv("T-6", "git_blame"); inv("T-6", "git_blame");      // 40 + 20 = 60
  inv("T-6", "read_code");                              // + 20 = 80
  inv("T-6", "git_blame");                              // + 10 = 90
  eq(ticket("T-6").understanding, 90);
  Dev.implement("T-6");
  Dev.openPR("T-6");
  eq(awaitReview("T-6").merged, true, "nothing in review catches a misfiled ticket");
  var sc = Dev.submitRetro({ narrative: "n", whatIdDoDifferently: "w" });
  deepEq(sc.falseFixes, ["T-6"]);
  eq(sc.deliveredPoints, -2, "the points come straight back off");
  contains(sc.perTicket[5].outcome, "false fix");
});

/* ==================================================================== */
console.log("\n-- rejections");

test("every documented rejection message", function () {
  boot();
  // "Pick a ticket first"
  rejects(Dev.investigate({ actionId: "read_code" }), "Pick a ticket first");
  rejects(Dev.ask({ to: "deepa", question: Q }), "Pick a ticket first");

  // "Estimate this ticket first"
  Dev.select("T-1");
  rejects(Dev.investigate({ ticketId: "T-1", actionId: "read_code" }), "Estimate this ticket first");
  rejects(Dev.ask({ ticketId: "T-1", to: "deepa", question: Q }), "Estimate this ticket first");
  rejects(Dev.implement("T-1"), "Estimate this ticket first");
  rejects(Dev.writeTests("T-1"), "Estimate this ticket first");

  // "That question is too short to answer"
  open("T-1", 2);
  rejects(Dev.ask({ ticketId: "T-1", to: "deepa", question: "why?" }),
    "That question is too short to answer");

  // "You need to understand this better before you can implement it"
  rejects(Dev.implement("T-1"), "You need to understand this better before you can implement it");

  // "That PR is already in review"
  inv("T-1", "read_code"); inv("T-1", "read_code"); inv("T-1", "git_blame");
  Dev.implement("T-1");
  ok(Dev.openPR("T-1").ok);
  rejects(Dev.openPR("T-1"), "That PR is already in review");
  rejects(Dev.implement("T-1"), "That PR is already in review");

  // "You already merged that"
  awaitReview("T-1");
  eq(ticket("T-1").status, "merged");
  rejects(Dev.investigate({ ticketId: "T-1", actionId: "read_code" }), "You already merged that");
  rejects(Dev.openPR("T-1"), "You already merged that");
  rejects(Dev.abandon("T-1"), "You already merged that");

  // "Deepa has no time left this sprint"  (its own boot)
  boot(null, { seniorBudgetHours: 0.1 });
  open("T-1", 2);
  Dev.ask({ ticketId: "T-1", to: "deepa", question: Q });
  rejects(Dev.ask({ ticketId: "T-1", to: "deepa", question: Q }),
    "Deepa has no time left this sprint");

  // "The sprint is over"  (both routes: the buzzer, and the retro)
  boot();
  Dev.advance(60);
  rejects(Dev.estimate("T-1", 2), "The sprint is over");
  rejects(Dev.investigate({ ticketId: "T-1", actionId: "read_code" }), "The sprint is over");
  rejects(Dev.abandon("T-1"), "The sprint is over");

  boot();
  open("T-1", 2);
  Dev.submitRetro({ narrative: "n", whatIdDoDifferently: "w" });
  rejects(Dev.investigate({ ticketId: "T-1", actionId: "read_code" }), "The sprint is over");
  rejects(Dev.submitRetro({ narrative: "n" }), "The sprint is over");
});

/* ==================================================================== */
console.log("\n-- escalation, calibration, waste");

test("escalation verdicts: early / right / late / never", function () {
  // early
  boot();
  open("T-1", 2);
  Dev.ask({ ticketId: "T-1", to: "deepa", question: Q });
  var sc = Dev.submitRetro({ narrative: "n" });
  eq(sc.escalation.length, 1);
  eq(sc.escalation[0].verdict, "early");
  eq(sc.escalation[0].askedAtHours, 0, "asked with nothing tried");
  eq(sc.escalation[0].timeboxHours, 1);
  eq(sc.escalation[0].credit, Dev.ESCALATION_CREDIT.early);

  // right
  boot();
  open("T-1", 2);
  inv("T-1", "read_code"); inv("T-1", "read_code");
  Dev.ask({ ticketId: "T-1", to: "deepa", question: Q });
  sc = Dev.submitRetro({ narrative: "n" });
  eq(sc.escalation[0].verdict, "right");
  eq(sc.escalation[0].askedAtHours, 1, "one hour in, exactly the timebox");
  eq(sc.escalationScore, 1);

  // late
  boot();
  open("T-6", 2);
  inv("T-6", "just_try"); inv("T-6", "just_try"); inv("T-6", "just_try");
  Dev.ask({ ticketId: "T-6", to: "deepa", question: Q });
  sc = Dev.submitRetro({ narrative: "n" });
  eq(sc.escalation[0].verdict, "late");
  eq(sc.escalation[0].askedAtHours, 2.25);

  // never, and correctly so — solved alone, and it was solvable alone
  boot();
  open("T-1", 2);
  inv("T-1", "read_code"); inv("T-1", "read_code"); inv("T-1", "git_blame");
  Dev.implement("T-1"); Dev.openPR("T-1"); awaitReview("T-1");
  sc = Dev.submitRetro({ narrative: "n" });
  eq(sc.escalation[0].verdict, "never");
  eq(sc.escalation[0].askedAtHours, null);
  eq(sc.escalation[0].credit, 1, "independence, correctly exercised");

  // never, and it cost you the ticket
  boot();
  open("T-2", 2);
  inv("T-2", "read_code"); inv("T-2", "read_code");
  sc = Dev.submitRetro({ narrative: "n" });
  eq(sc.escalation[0].verdict, "never");
  eq(sc.escalation[0].credit, 0, "silence on a ticket only Deepa could unlock");
  eq(sc.escalationScore, 0);
});

test("escalationScore averages the per-ticket credits", function () {
  boot();
  open("T-1", 2);
  Dev.ask({ ticketId: "T-1", to: "deepa", question: Q });          // early -> 0.3
  open("T-2", 2);
  Dev.ask({ ticketId: "T-2", to: "deepa", question: Q });          // well-formed -> right -> 1
  var sc = Dev.submitRetro({ narrative: "n" });
  eq(sc.escalation.length, 2);
  eq(sc.escalationScore, 0.65, "(0.3 + 1) / 2");
});

test("calibration arithmetic", function () {
  boot();
  open("T-1", 0.5);
  inv("T-1", "read_code"); inv("T-1", "read_code");    // 60 min = 1.0h vs 0.5h estimated
  open("T-3", 1);
  inv("T-3", "read_code");                             // 30 min = 0.5h vs 1.0h estimated
  open("T-5", 4);                                      // estimated but never worked
  var sc = Dev.submitRetro({ narrative: "n" });
  var c = sc.calibration;
  eq(c.n, 2, "only tickets both estimated AND worked");
  eq(c.rows[0].ratio, 2, "1.0 / 0.5");
  eq(c.rows[1].ratio, 0.5, "0.5 / 1.0");
  eq(c.meanRatio, 1.25, "(2 + 0.5) / 2");
  eq(c.optimistic, true, "you take longer than you say");
  eq(c.worst.ticketId, "T-1");
  eq(c.worst.est, 0.5);
  eq(c.worst.actual, 1);
});

test("wastedHours counts negative-yield work and work past the point it can pay", function () {
  boot();
  open("T-1", 2);
  inv("T-1", "read_code");                       // 40 — useful
  inv("T-1", "git_blame");                       // 70 — useful
  inv("T-1", "read_code");                       // 90 — useful (lands exactly on correctAt)
  inv("T-1", "read_code");                       // 30 min, started at 90: nothing left to buy
  inv("T-1", "read_docs");                       // 20 min, negative yield
  var sc = Dev.submitRetro({ narrative: "n" });
  eq(sc.wastedHours, 0.83, "(30 + 20) / 60");
  eq(sc.hoursSpent, 2.08, "125 minutes total");
});

test("wastedHours on a capped ticket counts the solo work that could never land", function () {
  boot();
  open("T-2", 2);
  for (var i = 0; i < 6; i++) inv("T-2", "read_code");   // 6 x 30 = 180 min
  // #1 gains 40; #2 raw 36 but the cap only lets 15 of it land; #3..#6 gain
  // nothing at all — four half-hours proving something unprovable.
  eq(ticket("T-2").understanding, 55);
  var sc = Dev.submitRetro({ narrative: "n" });
  eq(sc.wastedHours, 2, "4 x 30 minutes past the point solo work could pay");
});

/* ==================================================================== */
console.log("\n-- the stuck detector");

test("stuck fires after RULES.stuckHours with no understanding gained", function () {
  boot();
  var got = [];
  Dev.on("stuck", function (x) { got.push(x); });
  open("T-2", 2);
  inv("T-2", "read_code");                       // last gain here
  for (var i = 0; i < 20; i++) inv("T-2", "read_code");   // capped: no gain, ever again
  ok(got.length >= 1, "the lead should have heard about this");
  eq(got[0].ticketId, "T-2");
  ok(got[0].idleHours >= Dev.RULES.stuckHours, "idle at least stuckHours");
  eq(got[0].asked, false, "and you never asked anyone");
  eq(Dev.getState().stuckOn, "T-2");
});

/* ==================================================================== */
console.log("\n-- grading");

test("grade cap: finishing under 40 average trust", function () {
  boot(null, { only: ["T-1"], startTrust: 30 });
  open("T-1", 2);
  inv("T-1", "read_code"); inv("T-1", "read_code"); inv("T-1", "git_blame");   // 90
  Dev.implement("T-1"); Dev.openPR("T-1");
  eq(awaitReview("T-1").merged, true);
  var sc = Dev.submitRetro({ narrative: "n", whatIdDoDifferently: "w" });
  // delivery 3/3 = 1 ; escalation 1 ; trust (30+32+33+30)/4 = 31.25 -> 31.3
  eq(sc.delivery, 1);
  eq(sc.escalationScore, 1);
  eq(sc.trust.avg, 31.3, "avgTrust reports to one decimal");
  eq(sc.composite, 0.8626, "0.5 + 0.3 + 0.2*0.313 — an A before the modifier");
  eq(sc.grade, "C", "capped");
  eq(sc.modifiers.length, 1);
  contains(sc.modifiers[0], "capped at C");
  contains(sc.modifiers[0], "31.3");
});

test("grade cap: merging below correctAt by resubmitting until it goes through", function () {
  boot(null, { only: ["T-1"] });
  open("T-1", 2);
  inv("T-1", "read_code"); inv("T-1", "git_blame");        // 70 — below correctAt 90
  Dev.implement("T-1");
  Dev.openPR("T-1");
  deepEq(awaitReview("T-1").reasons, ["understanding"], "bounce 1");
  Dev.openPR("T-1");                                       // no new investigation
  deepEq(awaitReview("T-1").reasons, ["understanding"], "bounce 2");
  eq(ticket("T-1").bounces, 2);
  Dev.openPR("T-1");                                       // still nothing new
  var rev = awaitReview("T-1");
  eq(rev.merged, true, "the reviewer runs out of Thursday");
  eq(rev.relented, true);
  contains(rev.comments.join(" "), "cannot explain");
  eq(ticket("T-1").understanding, 70, "and you still do not understand it");

  var sc = Dev.submitRetro({ narrative: "n", whatIdDoDifferently: "w" });
  deepEq(sc.shippedBlind, ["T-1"]);
  eq(sc.grade, "C", "the cardinal sin caps it");
  contains(sc.modifiers.join(" "), "capped at C");
  contains(sc.modifiers.join(" "), "resubmitting");
  contains(sc.perTicket[0].outcome, "could not explain");
});

test("no relent when there IS new investigation between submissions", function () {
  boot(null, { only: ["T-1"] });
  open("T-1", 2);
  inv("T-1", "read_code"); inv("T-1", "git_blame");        // 70
  Dev.implement("T-1");
  Dev.openPR("T-1"); awaitReview("T-1");
  Dev.openPR("T-1"); awaitReview("T-1");
  eq(ticket("T-1").bounces, 2);
  inv("T-1", "just_try");                                  // +10 -> 80, still below 90
  Dev.openPR("T-1");
  var rev = awaitReview("T-1");
  eq(rev.merged, false, "you did the work, so he holds the line");
  eq(rev.relented, false);
  eq(ticket("T-1").bounces, 3);
});

test("a clean sprint grades well and carries no modifiers", function () {
  boot(null, { only: ["T-1"] });
  open("T-1", 2.5);
  inv("T-1", "read_code"); inv("T-1", "read_code"); inv("T-1", "git_blame");
  Dev.implement("T-1"); Dev.openPR("T-1"); awaitReview("T-1");
  var sc = Dev.submitRetro({ narrative: "n", whatIdDoDifferently: "w" });
  eq(sc.grade, "A");
  deepEq(sc.modifiers, []);
  deepEq(sc.merged, ["T-1"]);
  eq(sc.mergedPoints, 3);
  eq(sc.totalPoints, 3);
  eq(sc.bounces, 0);
  eq(sc.testsSkipped, 0);
  eq(sc.conventionMisses, 0);
  deepEq(sc.shippedBlind, []);
});

test("testsSkipped and conventionMisses are counted per ticket", function () {
  boot();
  open("T-3", 2);
  inv("T-3", "read_code"); inv("T-3", "git_blame");
  Dev.setConvention("T-3", "WrongWay");
  Dev.implement("T-3");
  Dev.openPR("T-3"); awaitReview("T-3");       // no tests + wrong convention
  Dev.openPR("T-3"); awaitReview("T-3");       // same again
  var sc = Dev.submitRetro({ narrative: "n" });
  eq(sc.testsSkipped, 1, "one ticket, however many attempts");
  eq(sc.conventionMisses, 1);
  eq(sc.bounces, 2);
});

test("efficiency compares your hours to the ideal sprint", function () {
  boot();
  open("T-1", 2);
  Dev.advance(20);                              // 20h of wall clock, bestHours is 20
  var sc = Dev.submitRetro({ narrative: "n" });
  eq(sc.bestHours, 20);
  eq(sc.hoursSpent, 20);
  eq(sc.efficiency, 1);

  boot();
  open("T-1", 2);
  Dev.advance(40);                              // 40h for a 20h ideal sprint
  eq(Dev.submitRetro({ narrative: "n" }).efficiency, 0.5, "20 / 40");

  boot();
  open("T-1", 2);
  Dev.advance(2);                               // quit on day 1
  eq(Dev.submitRetro({ narrative: "n" }).efficiency, 1,
    "capped: giving up early is not hyper-efficiency");
});

/* ==================================================================== */
console.log("\n-- determinism");

/** a scripted sprint that touches every source of randomness */
function scriptedRun(seed, pokeState) {
  boot(seed);
  open("T-1", 2);
  Dev.ask({ ticketId: "T-1", to: "channel", question: Q });      // channel delay (gauss)
  if (pokeState) for (var k = 0; k < 25; k++) Dev.getState();
  inv("T-1", "read_code"); inv("T-1", "read_code"); inv("T-1", "git_blame");
  if (pokeState) for (k = 0; k < 25; k++) Dev.getState();
  Dev.implement("T-1");
  Dev.openPR("T-1");                                             // review lag (uniform)
  awaitReview("T-1");
  open("T-3", 1);
  inv("T-3", "read_code"); inv("T-3", "git_blame");
  Dev.writeTests("T-3");
  Dev.setConvention("T-3", "RightWay");
  Dev.ask({ ticketId: "T-3", to: "channel", question: Q });
  Dev.implement("T-3");
  Dev.openPR("T-3");
  awaitReview("T-3");
  if (pokeState) for (k = 0; k < 25; k++) Dev.getState();
  var state = Dev.getState();
  var score = Dev.submitRetro({ narrative: "n", whatIdDoDifferently: "w" });
  return { state: state, score: score, retro: Dev.exportRetro() };
}

test("the same seed replays byte-identically", function () {
  var a = scriptedRun(20260823, false);
  var b = scriptedRun(20260823, false);
  eq(JSON.stringify(a.state), JSON.stringify(b.state), "state diverged");
  eq(JSON.stringify(a.score), JSON.stringify(b.score), "score diverged");
  eq(a.retro, b.retro, "retro markdown diverged");
});

test("a different seed produces a different sprint", function () {
  var a = scriptedRun(20260823, false);
  var b = scriptedRun(12345, false);
  ok(JSON.stringify(a.state) !== JSON.stringify(b.state),
    "seed 12345 replayed identically to the default seed");
});

test("getState() consumes no randomness", function () {
  var a = scriptedRun(20260823, false);
  var b = scriptedRun(20260823, true);      // 100 extra getState() calls, sprinkled through
  eq(JSON.stringify(a.state), JSON.stringify(b.state), "getState() moved the PRNG");
  eq(JSON.stringify(a.score), JSON.stringify(b.score));
});

test("Math.random is never called", function () {
  var real = Math.random;
  var calls = 0;
  Math.random = function () { calls++; return real(); };
  try {
    scriptedRun(777, true);
    boot();
    open("T-2", 2);
    Dev.ask({ ticketId: "T-2", to: "channel", question: Q });
    Dev.advance(10);
  } finally {
    Math.random = real;
  }
  eq(calls, 0, "dev.js reached for Math.random " + calls + " time(s)");
});

/* ==================================================================== */
console.log("\n-- the retro document");

test("exportRetro() is markdown and leaks no ground truth", function () {
  var r = scriptedRun(20260823, false);
  var md = r.retro;
  contains(md, "# Sprint retro");
  contains(md, "## Merged");
  contains(md, "## Not merged, and why");
  contains(md, "## Time ledger");
  contains(md, "## Estimate vs actual");
  contains(md, "## Every question I asked");
  contains(md, "## Review log");
  contains(md, "## Trust ledger");
  contains(md, "T-1");
  contains(md, "Deepa Iyer");

  // the truth stays behind the curtain
  lacks(md, "SECRETCAUSE", "leaked a cause");
  lacks(md, "SECRETNOTE", "leaked a debrief note");
  lacks(md, "selfFindable");
  lacks(md, "soloCap");
  lacks(md, "timebox");
  lacks(md, "effortHours");
  lacks(md, "bestPath");
  lacks(md, "bestHours");
  lacks(md, "shouldAbandon");
  lacks(md, "needsClarification");
  lacks(md, "scopeTrap");
  lacks(md, "yield");

  // but the debrief Score is allowed to tell you everything
  ok(r.score.perTicket[0].cause.indexOf("SECRETCAUSE") === 0, "the score carries the cause");
  ok(r.score.perTicket[0].note.indexOf("SECRETNOTE") === 0, "and the debrief note");
});

test("exportRetro() records every ask with its classification", function () {
  boot();
  open("T-1", 2);
  Dev.ask({ ticketId: "T-1", to: "deepa", question: "Where does the sort key actually get built?" });
  inv("T-1", "read_code");
  Dev.ask({ ticketId: "T-1", to: "hannah", question: "Which regions are in scope for this fix?" });
  var md = Dev.exportRetro();
  contains(md, "premature");
  contains(md, "Where does the sort key actually get built?");
  contains(md, "Which regions are in scope for this fix?");
  contains(md, "Hannah Brecht");
});

test("exportRetro() survives an untouched sprint", function () {
  boot();
  var md = Dev.exportRetro();
  contains(md, "_Nothing merged._");
  contains(md, "I did not ask anyone anything");
  contains(md, "_No pull request went to review._");
});

/* ==================================================================== */
console.log("\n-- odds and ends");

test("getActions() shows cost, caveat and diminishing returns, never a yield", function () {
  boot();
  open("T-1", 2);
  inv("T-1", "read_code");
  var as = Dev.getActions("T-1");
  eq(as.length, 4);
  eq(as[0].id, "read_code");
  eq(as[0].minutes, 30);
  eq(as[0].caveat, "c1");
  eq(as[0].timesUsed, 1);
  eq(as[0].returnFactor, 0.5, "decay 0.5 ^ 1");
  eq(as[0].diminished, true);
  eq(as[1].timesUsed, 0);
  eq(as[1].returnFactor, 1);
  eq(as[1].diminished, false);
  ok(!("yield" in as[0]) && !("gained" in as[0]), "no yields on the action list");
});

test("getConventions() offers the choice without giving it away", function () {
  boot();
  deepEq(Dev.getConventions("T-3"), ["RightWay", "WrongWay"], "sorted, so order is not a tell");
  deepEq(Dev.getConventions("T-1"), [], "no decision to make here");
});

test("estimate() is required, positive, and revisable", function () {
  boot();
  rejects(Dev.estimate("T-1", 0), "An estimate in hours is required");
  rejects(Dev.estimate("T-1", -3), "An estimate in hours is required");
  rejects(Dev.estimate("T-1", "soon"), "An estimate in hours is required");
  ok(Dev.estimate("T-1", 3).ok);
  eq(ticket("T-1").estimateHours, 3);
  var r = Dev.estimate("T-1", 6);
  eq(r.revised, true, "a stale estimate can be updated");
  eq(ticket("T-1").estimateHours, 6);
});

test("select() and the active ticket", function () {
  boot();
  rejects(Dev.select("NOPE"), "No such ticket: NOPE");
  ok(Dev.select("T-4").ok);
  eq(Dev.getState().active, "T-4");
  Dev.estimate("T-4", 2);
  ok(Dev.investigate({ actionId: "read_code" }).ok, "falls back to the active ticket");
  eq(ticket("T-4").understanding, 50);
});

test("writeTests() costs 45 minutes and sets the flag", function () {
  boot();
  open("T-3", 2);
  var before = Dev.getState().minutes;
  var r = Dev.writeTests("T-3");
  ok(r.ok);
  eq(r.minutes, 45);
  eq(Dev.getState().minutes - before, 45);
  eq(ticket("T-3").hasTests, true);
});

test("history is complete enough for Board.timeline / Board.understanding", function () {
  boot();
  open("T-1", 2);
  inv("T-1", "read_code");
  inv("T-1", "read_docs");
  Dev.ask({ ticketId: "T-1", to: "deepa", question: Q });
  var h = ticket("T-1").history;
  eq(h.length, 3);
  eq(h[0].kind, "action");
  eq(h[0].cost, 0.5, "30 minutes");
  eq(h[0].startHours, 0);
  eq(h[0].endHours, 0.5);
  eq(h[0].negative, false);
  eq(h[1].kind, "action");
  eq(h[1].negative, true, "the timeline must be able to paint this red");
  eq(h[2].kind, "ask");
  eq(h[2].to, "deepa");
  // 50 minutes in, git_blame still untried: premature, and the history says so
  eq(h[2].classification, "premature");
  eq(h[2].spentBefore, 0.83, "the timeline can mark exactly when you cracked");
  ok(typeof h[2].t === "string" && h[2].t.charAt(0) === "D", "asks carry a stamp to mark");
});

test("listeners are fired and a throwing listener never stops the clock", function () {
  boot();
  var realErr = console.error;
  console.error = function () {};          // the throwing listener is on purpose
  try {
  var ticks = 0, reviews = 0, answers = 0, trusts = 0, ends = 0;
  Dev.on("tick", function () { ticks++; });
  Dev.on("tick", function () { throw new Error("bad listener"); });
  Dev.on("review", function () { reviews++; });
  Dev.on("answer", function () { answers++; });
  Dev.on("trust", function () { trusts++; });
  Dev.on("sprintEnd", function () { ends++; });
  open("T-1", 2);
  inv("T-1", "read_code"); inv("T-1", "read_code"); inv("T-1", "git_blame");
  Dev.ask({ ticketId: "T-1", to: "deepa", question: Q });
  Dev.implement("T-1"); Dev.openPR("T-1"); awaitReview("T-1");
  ok(ticks > 0, "tick");
  eq(reviews, 1, "review");
  eq(answers, 1, "answer");
  ok(trusts >= 2, "trust");
  Dev.advance(60);
  eq(ends, 1, "sprintEnd exactly once");
  } finally { console.error = realErr; }
});

test("degenerate input does not throw", function () {
  boot();
  ok(Dev.getActions("NOPE").length === 4, "unknown ticket still lists actions");
  deepEq(Dev.getConventions("NOPE"), []);
  eq(Dev.classifyAsk("NOPE"), null);
  Dev.advance(NaN);
  Dev.advance(-5);
  eq(Dev.getState().minutes, 0, "garbage advances are no-ops");
  Dev.select("T-1"); Dev.estimate("T-1", 2);
  rejects(Dev.investigate({ ticketId: "T-1", actionId: "nope" }), "No such action: nope");
  rejects(Dev.ask({ ticketId: "T-1", to: "santa", question: Q }),
    "Ask Deepa, Hannah or the channel");
  ok(Dev.exportRetro().length > 0);
  ok(JSON.stringify(Dev.getState()).length > 0);
});

test("only dev.js reads the truth — reveal() is called exactly once per init", function () {
  var repo = makeRepo();
  var calls = 0;
  var inner = repo.reveal;
  repo.reveal = function () { calls++; return inner.call(this); };
  Dev.destroy();
  Dev.init({ repo: repo, seed: 1 });
  Dev.select("T-1"); Dev.estimate("T-1", 2);
  Dev.investigate({ ticketId: "T-1", actionId: "read_code" });
  Dev.getState();
  Dev.submitRetro({ narrative: "n" });
  Dev.exportRetro();
  eq(calls, 1, "the truth is read once, at init, and never again");
});

/* ---------------------------------------------------------------- report */

console.log("\n" + (FAIL === 0
  ? "ALL " + PASS + " TESTS PASSED"
  : PASS + " passed, " + FAIL + " FAILED"));
if (FAIL) {
  console.log("");
  for (var i = 0; i < FAILURES.length; i++) console.log("  * " + FAILURES[i]);
}
console.log("");
process.exit(FAIL ? 1 : 0);
