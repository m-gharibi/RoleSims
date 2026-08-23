#!/usr/bin/env node
/* =============================================================================
 * tools/test_squad.js  —  run with:  node tools/test_squad.js
 *
 * Zero dependencies. Loads sim/squad.js exactly as a browser would (it assigns
 * to `window.Squad`; we point `window` at the node global), then walks two
 * synthetic juniors through a full ten-day sprint at a synthetic company, using
 * a fake Dev that publishes the state shape SPEC §2 describes and nothing else.
 *
 * The fixture is deliberately NOT Thistle: different company, different tickets,
 * different ticket ids, people whose ids do not match anything hard-coded. Same
 * six archetypes, because the writing is what is being judged.
 *
 * SPRINT A — the junior who will not ask:
 *   D1  estimates all five tickets at the same number        -> flat_estimates
 *   D1  reads the same file five times on ROUT-4102          -> repeat_action
 *   D2  four hours on ROUT-4108, understanding flat, silent  -> silent_stuck
 *   D3  eight hours against a four-hour estimate, unrevised  -> estimate_2x
 *   D3  works past six                                       -> (first late evening)
 *   D4  ...and has still asked nobody anything               -> never_asked_day4
 *   D4  asks #eng-help instead, twice                        -> channel_stranger,
 *                                                               channel_over_mentor
 *   D5  asks Deepa forty minutes in, having tried one thing  -> ask_premature
 *   D5  picks up the shared-config chore                     -> legacy_dragons
 *   D5  100 minutes in the wiki, understanding goes backwards-> misleading_action
 *   D5  Hannah asks a question. Nobody answers it.
 *   D6  asks Deepa properly after a real timebox             -> ask_well_formed
 *   D6  ...and Hannah is still waiting                       -> hannah_silence:ev5
 *   D6  opens a PR at 14:30                                  -> pr_at_cutoff
 *   D7  first merge                                          -> first_merge
 *   D7  picks a convention without opening the style guide   -> convention_unchecked
 *   D7  finally asks, four hours and still under the line    -> ask_overdue
 *   D7  builds at 74 against a bar of 90                     -> implement_underinformed
 *   D7  opens a PR with no tests on a ticket that asked      -> no_tests_ci,
 *                                                               no_tests_review
 *   D7  two bounces on the same PR                           -> bounced_twice
 *   D8  never once looked at the history                     -> never_blamed
 *   D8  hands back ROUT-4177 after five and a half hours     -> abandon_after_investment
 *   D8  a second evening                                     -> heroics
 *   D9  Deepa is down to an hour and a half                  -> senior_budget_low
 *
 * SPRINT B — the other junior, and the only way to prove the triggers A fires
 * are actually conditional: varied estimates, `git log` on day one, a question
 * to Hannah before lunch, a timeboxed question to Deepa, tests written before
 * the PR, the style guide read before the convention is chosen, Hannah answered
 * the same afternoon, two tickets merged, nobody working late.
 *     -> ask_well_formed, first_merge, legacy_dragons, hannah_answered:ev5
 *     and NOT silent_stuck / ask_premature / ask_overdue / never_asked_day4 /
 *     never_blamed / flat_estimates / repeat_action / misleading_action /
 *     estimate_2x / heroics / implement_underinformed / no_tests_* /
 *     bounced_twice / convention_unchecked / abandon_after_investment /
 *     channel_* / hannah_silence:* / senior_budget_low / pr_at_cutoff
 *
 * Asserts in both: the right triggers fire, none fires twice, at most one
 * reactive message per tick, the drain honours LEAD > REVIEWER > MENTOR > PM >
 * CHANNEL > BOT, the queue empties by the end of the sprint, all four gates land
 * once on the right day with SPEC.md's prompt byte-verbatim, every scripted
 * event lands once and never early, message shape is valid, feeds are
 * time-ordered, squad.js never touched reveal() or _t (spied at runtime AND
 * grepped for statically), and two identical sprints produce byte-identical
 * feeds. Then prints both feeds so the writing can be read.
 * ========================================================================== */

'use strict';

var path = require('path');
var fs = require('fs');

global.window = global;
var SQUAD_PATH = path.join(__dirname, '..', 'sim', 'squad.js');
require(SQUAD_PATH);
var Squad = global.window.Squad;

/* ==================================================== the synthetic repo === */

var TICKETS = [
  { id: 'ROUT-4102', type: 'bug', priority: 'P2', reporter: 'Support', points: 3,
    title: 'Route list reorders itself after a clock change',
    description: 'Customers report the route list scrambling on the changeover day. Reproducible on any list that straddles the boundary.',
    acceptance: ['Ordering is stable across the boundary', 'A regression test covers the boundary case'] },
  { id: 'ROUT-4108', type: 'bug', priority: 'P1', reporter: 'Support', points: 3,
    title: 'Duplicate delivery notifications for two enterprise accounts',
    description: 'Two accounts receive the same notification twice. Not reproducible on staging. Escalated by the account team.',
    acceptance: ['Duplicates stop, or we document why they must not'] },
  { id: 'ROUT-4150', type: 'feature', priority: 'P3', reporter: 'Hannah Brecht', points: 5,
    title: 'Add a spreadsheet download to the driver activity report',
    description: 'Ops want the report in a spreadsheet. Add a download button beside the existing one, same columns, same filters.',
    acceptance: ['Download matches the on-screen table', 'Follows the current export conventions', 'Covered by tests'] },
  { id: 'ROUT-4177', type: 'bug', priority: 'P3', reporter: 'CI', points: 2,
    title: 'Intermittent failure in the routing test suite',
    description: 'test_routing_window_boundary fails maybe one run in six on main. It has been getting noisier.',
    acceptance: ['CI is green reliably, or we know exactly why it is not'] },
  { id: 'ROUT-4190', type: 'chore', priority: 'P3', reporter: 'Nnamdi Eze', points: 1,
    title: 'Move the lint config onto the shared preset',
    description: 'We are standardising on the shared preset across services. Bump the config and fix anything it flags. Should be quick.',
    acceptance: ['Repo uses the shared preset', 'CI lint step passes'] }
];

var ACTIONS = [
  { id: 'reproduce',    name: 'Reproduce it locally', minutes: 30, desc: '', caveat: '' },
  { id: 'read_code',    name: 'Read the code',        minutes: 30, desc: '', caveat: '' },
  { id: 'read_docs',    name: 'Read the docs',        minutes: 20, desc: '', caveat: '' },
  { id: 'git_blame',    name: 'git log / blame',      minutes: 15, desc: '', caveat: '' },
  { id: 'search_slack', name: 'Search old messages',  minutes: 15, desc: '', caveat: '' },
  { id: 'run_tests',    name: 'Run the test suite',   minutes: 15, desc: '', caveat: '' },
  { id: 'just_try',     name: 'Try a fix and see',    minutes: 45, desc: '', caveat: '' }
];

var PEOPLE = [
  { id: 'd_iyer',  name: 'Deepa Iyer',       role: 'Staff Engineer — your onboarding buddy', startTrust: 55, voice: 'MENTOR',   desc: '' },
  { id: 't_lind',  name: 'Tobias Lindqvist', role: 'Tech Lead',                              startTrust: 55, voice: 'LEAD',     desc: '' },
  { id: 'n_eze',   name: 'Nnamdi Eze',       role: 'Senior Engineer — your reviewer',        startTrust: 55, voice: 'REVIEWER', desc: '' },
  { id: 'h_brecht',name: 'Hannah Brecht',    role: 'Product Manager',                        startTrust: 55, voice: 'PM',       desc: '' }
];

var EVENTS = [
  { id: 'ev0', day: 1, hour: 9.0,  from: 'LEAD',     name: 'Tobias Lindqvist', tone: 'neutral', needsReply: false,
    text: 'Morning, and welcome. Five tickets on the board. I do not expect all five — I expect you to tell me early which ones are not going to happen. Estimate them before you start, and post your plan.' },
  { id: 'ev1', day: 1, hour: 9.5,  from: 'MENTOR',   name: 'Deepa Iyer', tone: 'neutral', needsReply: false,
    text: 'Hi! I am your onboarding buddy. Honest warning: I have about ten hours for you this sprint, so use me well. Rule of thumb I give everyone — timebox it, then come. Do not spend a day proving you did not need me.' },
  { id: 'ev2', day: 1, hour: 10.0, from: 'REVIEWER', name: 'Nnamdi Eze', tone: 'neutral', needsReply: false,
    text: 'I do most of the reviews. Two things and we will get along fine: tests on anything behavioural, and be able to explain your own diff. I bounce code the author cannot walk me through, and it is nothing personal.' },
  { id: 'ev3', day: 2, hour: 9.25, from: 'MENTOR',   name: 'Deepa Iyer', tone: 'neutral', needsReply: false,
    text: 'One thing about this repo before you get too deep: the wiki is nine years old and nobody has ever deleted a page. Some of it is load-bearing, some describes code that no longer exists. `git log` has never lied to me.' },
  { id: 'ev4', day: 4, hour: 11.0, from: 'BOT',      name: 'CI', tone: 'alarm', needsReply: false,
    text: 'INCIDENT #4471 OPENED — routing-api p99 latency above threshold. All hands acknowledge.' },
  { id: 'ev5', day: 5, hour: 14.0, from: 'PM',       name: 'Hannah Brecht', tone: 'neutral', needsReply: true, ticketId: 'ROUT-4150',
    text: 'Quick question — is the spreadsheet download nearly done? The partner call is Thursday and I would love to say it is in.' },
  { id: 'ev6', day: 7, hour: 9.5,  from: 'REVIEWER', name: 'Nnamdi Eze', tone: 'neutral', needsReply: false,
    text: 'Heads up, my review queue is deep this week. Anything you open late in the day is getting looked at the following morning. Factor that into what you think "done by Friday" means.' },
  { id: 'ev7', day: 9, hour: 9.0,  from: 'LEAD',     name: 'Tobias Lindqvist', tone: 'warn', needsReply: false,
    text: 'Code freeze is end of day tomorrow. Anything not merged by then rolls to next sprint, and that is fine — I would much rather roll a ticket than merge something nobody had time to review properly.' },
  { id: 'ev8', day: 10, hour: 14.0, from: 'LEAD',    name: 'Tobias Lindqvist', tone: 'neutral', needsReply: false,
    text: 'Retro shortly. The only question I actually care about: what do you know now that you wish you had known on Monday?' }
];

/* The ground truth, and the two tripwires on it. squad.js must never reach
 * either one — not the decoded object, not the encoded blob. */
var TRUTH_JSON = JSON.stringify({ tickets: {}, bestPath: {}, bestHours: 26.25 });
var TRUTH_B64 = Buffer.from(TRUTH_JSON, 'utf8').toString('base64');
var touched = { reveal: 0, _t: 0 };

var REPO = {
  scenario: {
    company: 'Ferrule', product: 'Dispatch for field-service teams',
    role: 'Software Engineer I', team: 'Routing',
    sprint: { days: 10, hoursPerDay: 6, startDay: 1 },
    codebase: { loc: 412000, ageYears: 9, langs: ['Python', 'TypeScript'], note: 'Nine years old.' },
    seniorBudgetHours: 10,
    brief: 'First sprint on the Routing team.'
  },
  tickets: TICKETS,
  actions: ACTIONS,
  people: PEOPLE,
  askTargets: [
    { id: 'deepa',   name: 'Deepa Iyer', costsSeniorBudget: true,  minutes: 15, caveat: '' },
    { id: 'hannah',  name: 'Hannah Brecht', costsSeniorBudget: false, minutes: 10, caveat: '' },
    { id: 'channel', name: '#eng-help', costsSeniorBudget: false, minutes: 10, caveat: '' }
  ],
  events: EVENTS
};

Object.defineProperty(REPO, '_t', {
  enumerable: true, configurable: true,
  get: function () { touched._t++; return TRUTH_B64; }
});
REPO.reveal = function () { touched.reveal++; return JSON.parse(TRUTH_JSON); };

/* ================================================== the fake Dev engine ====
 * Publishes exactly the state shape SPEC §2 describes. It has no ground truth
 * of its own: understanding deltas, bounces and merges are scripted, because
 * this file is testing the squad, not the resolution model.
 * ======================================================================== */

var RULES = {
  days: 10, hoursPerDay: 6, totalHours: 60, tickMinutes: 15, startHour: 9,
  seniorBudgetHours: 10,
  startTrust: 55, minTrust: 0, maxTrust: 100,
  implementReadyAt: 70, correctAt: 90,
  reviewLagHours: { min: 2, max: 5 },
  askCostMinutes: 15, vagueAskExtraMinutes: 30,
  stuckHours: 3, minQuestionChars: 25, estimateRequired: true
};
var FakeDev = { RULES: RULES };

var ASK_MINUTES = { deepa: 15, hannah: 10, channel: 10 };
var ACTION_MINUTES = {};
ACTIONS.forEach(function (a) { ACTION_MINUTES[a.id] = a.minutes; });

function Sim(script, lateDays) {
  var self = this;
  this.tickNo = 0;
  this.seniorLeft = RULES.seniorBudgetHours;
  this.merged = [];
  this.answered = [];
  this.late = {};
  (lateDays || []).forEach(function (d) { self.late[d] = true; });
  this.byKey = {};
  script.forEach(function (s) {
    var k = s.d + '@' + s.h.toFixed(2);
    if (!self.byKey[k]) self.byKey[k] = [];
    self.byKey[k].push(s);
  });
  this.t = {};
  TICKETS.forEach(function (x) {
    self.t[x.id] = {
      id: x.id, status: 'todo', understanding: 0, hoursSpent: 0,
      estimateHours: 0, actionsUsed: {}, hasTests: false, convention: null,
      bounces: 0, prOpenedAt: null, blockedSince: null
    };
  });
  this.trust = { deepa: 55, tobias: 55, nnamdi: 55, hannah: 55 };
}

Sim.prototype.apply = function (s) {
  var t = this.t[s.tid], k;
  if (s.act === 'est') { t.estimateHours = s.hours; }
  else if (s.act === 'reest') { t.estimateHours = s.hours; }
  else if (s.act === 'do') {
    k = s.action;
    t.actionsUsed[k] = (t.actionsUsed[k] || 0) + 1;
    t.hoursSpent = round2(t.hoursSpent + ACTION_MINUTES[k] / 60);
    t.understanding = clamp(round2(t.understanding + s.gain));
    if (t.status === 'todo') t.status = 'investigating';
  } else if (s.act === 'ask') {
    k = 'ask_' + s.to;
    t.actionsUsed[k] = (t.actionsUsed[k] || 0) + 1;
    t.hoursSpent = round2(t.hoursSpent + ASK_MINUTES[s.to] / 60);
    t.understanding = clamp(round2(t.understanding + (s.gain || 0)));
    if (s.to === 'deepa') this.seniorLeft = round2(Math.max(0, this.seniorLeft - (s.cost || 0.25)));
    if (t.status === 'todo') t.status = 'investigating';
  } else if (s.act === 'conv') { t.convention = s.name; }
  else if (s.act === 'tests') { t.hasTests = true; t.hoursSpent = round2(t.hoursSpent + 0.75); }
  else if (s.act === 'build') { t.status = 'implementing'; t.hoursSpent = round2(t.hoursSpent + (s.hours || 1)); }
  else if (s.act === 'pr') { t.status = 'in_review'; t.prOpenedAt = s.d + '@' + s.h; }
  else if (s.act === 'bounce') { t.bounces++; t.status = 'implementing'; }
  else if (s.act === 'merge') { t.status = 'merged'; this.merged.push(t.id); }
  else if (s.act === 'abandon') { t.status = 'abandoned'; }
  else if (s.act === 'reply') { this.answered.push(s.id); }
};

Sim.prototype.step = function (day, hour) {
  this.tickNo++;
  var k = day + '@' + hour.toFixed(2), i;
  var list = this.byKey[k] || [];
  for (i = 0; i < list.length; i++) this.apply(list[i]);

  var used = 0, out = [], id;
  for (id in this.t) {
    if (!Object.prototype.hasOwnProperty.call(this.t, id)) continue;
    used += this.t[id].hoursSpent;
    out.push(copy(this.t[id]));
  }
  var openEvents = [];
  for (i = 0; i < EVENTS.length; i++) {
    var e = EVENTS[i];
    if (!e.needsReply) continue;
    if (e.day > day || (e.day === day && e.hour > hour)) continue;
    if (this.answered.indexOf(e.id) >= 0) continue;
    openEvents.push({ id: e.id, from: e.from, needsReply: true });
  }
  var tsum = 0, n = 0;
  for (id in this.trust) if (Object.prototype.hasOwnProperty.call(this.trust, id)) { tsum += this.trust[id]; n++; }

  return {
    day: day, hour: hour, t: 'D' + day + ' ' + hhmm(hour), tick: this.tickNo,
    hoursLeft: round2(RULES.totalHours - used),
    seniorLeft: this.seniorLeft,
    tickets: out,
    active: null,
    trust: this.trust, avgTrust: Math.round(tsum / n),
    merged: this.merged.slice(),
    stuckOn: null,
    openEvents: openEvents,
    answeredEvents: this.answered.slice(),
    finished: (day >= 10 && hour >= 14.75),
    retroSubmitted: false
  };
};

function round2(x) { return Math.round(x * 100) / 100; }
function clamp(x) { return Math.max(0, Math.min(100, x)); }
function hhmm(h) {
  var hh = Math.floor(h + 1e-9), mm = Math.round((h - hh) * 60);
  return (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm;
}
function copy(o) {
  var c = {}, k;
  for (k in o) if (Object.prototype.hasOwnProperty.call(o, k)) {
    c[k] = (k === 'actionsUsed') ? copy(o[k]) : o[k];
  }
  return c;
}

function runSprint(script, lateDays) {
  var feed = [];
  Squad.init({ repo: REPO, dev: FakeDev, onMessage: function (m) { feed.push(m); } });
  var sim = new Sim(script, lateDays);
  for (var day = 1; day <= 10; day++) {
    var end = (lateDays && lateDays.indexOf(day) >= 0) ? 17.0 : 15.0;
    for (var hour = 9.0; hour < end - 1e-9; hour = round2(hour + 0.25)) {
      Squad.tick(sim.step(day, hour));
    }
  }
  return { feed: feed, squadFeed: Squad.getFeed(), pending: Squad.pending(), sim: sim };
}

/* ================================================================ SPRINT A ===
 * The junior who will not ask. Every number below is a deliberate behaviour,
 * annotated with the trigger it is there to provoke.
 * ========================================================================== */

var A = [];
function a(d, h, act, tid, extra) {
  var s = { d: d, h: h, act: act, tid: tid };
  if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) s[k] = extra[k];
  A.push(s);
  return s;
}

/* --- D1: five identical estimates, then five reads of the same file -------- */
a(1, 9.00, 'est', 'ROUT-4102', { hours: 4 });
a(1, 9.00, 'est', 'ROUT-4108', { hours: 4 });
a(1, 9.00, 'est', 'ROUT-4150', { hours: 4 });
a(1, 9.00, 'est', 'ROUT-4177', { hours: 4 });
a(1, 9.00, 'est', 'ROUT-4190', { hours: 4 });          // -> flat_estimates
a(1, 9.25, 'do', 'ROUT-4102', { action: 'reproduce', gain: 12 });
a(1, 9.75, 'do', 'ROUT-4102', { action: 'read_code', gain: 14 });
a(1, 10.25, 'do', 'ROUT-4102', { action: 'read_code', gain: 9 });
a(1, 10.75, 'do', 'ROUT-4102', { action: 'read_code', gain: 5 });   // -> repeat_action
a(1, 11.25, 'do', 'ROUT-4102', { action: 'read_code', gain: 3 });
a(1, 11.75, 'do', 'ROUT-4102', { action: 'read_code', gain: 2 });   // five reads
a(1, 12.25, 'do', 'ROUT-4102', { action: 'run_tests', gain: 6 });   // 3 distinct avenues, 3.25h
[12.5, 13.0, 13.5, 14.0].forEach(function (h, i) {
  a(1, h, 'do', 'ROUT-4177', { action: 'read_code', gain: [10, 8, 6, 4][i] });
});

/* --- D2: four hours on the P1, understanding barely moves, nobody told ----- */
[9.0, 9.5, 10.0, 10.5, 11.0, 11.5, 12.0, 12.5].forEach(function (h) {
  a(2, h, 'do', 'ROUT-4108', { action: 'read_code', gain: 0.4 });   // -> silent_stuck at 3h
});
[13.0, 13.5, 14.0].forEach(function (h, i) {
  a(2, h, 'do', 'ROUT-4177', { action: 'read_code', gain: [3, 2, 2][i] });
});

/* --- D3: eight hours against a four-hour estimate, and a first late one ---- */
[9.0, 9.5, 10.0, 10.5, 11.0, 11.5, 12.0, 12.5].forEach(function (h) {
  a(3, h, 'do', 'ROUT-4108', { action: 'read_code', gain: 0.4 });   // -> estimate_2x at 8h
});
[13.0, 13.5, 14.0, 14.5, 15.0, 15.5, 16.0].forEach(function (h, i) {
  a(3, h, 'do', 'ROUT-4177', { action: 'read_code', gain: [2, 1, 1, 1, 1, 1, 1][i] });
});

/* --- D4: still no questions, then the wrong place to put them -------------- */
//        09:00 -> never_asked_day4
a(4, 10.0, 'ask', 'ROUT-4108', { to: 'channel', gain: 1 });         // -> channel_stranger (+45m)
a(4, 13.0, 'ask', 'ROUT-4108', { to: 'channel', gain: 1 });         // -> channel_over_mentor
[11.0, 11.5, 12.0, 12.5].forEach(function (h, i) {
  a(4, h, 'do', 'ROUT-4150', { action: 'read_code', gain: [12, 10, 0, 0][i] });
});

/* --- D5: the chore, the premature ask, and 100 minutes in the wiki --------- */
a(5, 9.00, 'do', 'ROUT-4190', { action: 'read_docs', gain: 2 });
a(5, 9.25, 'ask', 'ROUT-4190', { to: 'deepa', gain: 30, cost: 1.5 }); // -> ask_premature
//        ...and ROUT-4190's own words are a blast radius               -> legacy_dragons
a(5, 9.75, 'do', 'ROUT-4190', { action: 'read_docs', gain: -5 });
a(5, 10.25, 'do', 'ROUT-4190', { action: 'read_docs', gain: -5 });
a(5, 10.75, 'do', 'ROUT-4190', { action: 'read_docs', gain: -4 });
a(5, 11.25, 'do', 'ROUT-4190', { action: 'read_docs', gain: -4 });   // -> misleading_action
[12.0, 12.5, 13.0, 13.5].forEach(function (h, i) {
  a(5, h, 'do', 'ROUT-4150', { action: 'read_code', gain: [8, 6, 5, 4][i] });
});
//        14:00 Hannah asks a question (scripted ev5). It is not answered.

/* --- D6: one good question, one late PR, and Hannah still waiting ---------- */
a(6, 9.00, 'ask', 'ROUT-4102', { to: 'deepa', gain: 45, cost: 0.5 });  // -> ask_well_formed
a(6, 9.50, 'build', 'ROUT-4102', { hours: 1.5 });                      // at 96: no complaint
a(6, 11.0, 'tests', 'ROUT-4102', {});
//        13:00 -> hannah_silence:ev5
a(6, 14.5, 'pr', 'ROUT-4102', {});                                     // -> pr_at_cutoff
[12.0, 12.5].forEach(function (h, i) {
  a(6, h, 'do', 'ROUT-4150', { action: 'read_code', gain: [5, 5][i] });
});

/* --- D7: the first merge, and everything that goes wrong on the big one ---- */
a(7, 9.00, 'merge', 'ROUT-4102', {});                                  // -> first_merge
a(7, 9.25, 'conv', 'ROUT-4150', { name: 'LegacyExporter' });           // -> convention_unchecked
a(7, 10.0, 'ask', 'ROUT-4150', { to: 'deepa', gain: 10, cost: 0.75 }); // -> ask_overdue
a(7, 11.0, 'do', 'ROUT-4150', { action: 'read_code', gain: 9 });
a(7, 12.0, 'build', 'ROUT-4150', { hours: 1 });                        // -> implement_underinformed
a(7, 13.0, 'pr', 'ROUT-4150', {});                                     // -> no_tests_ci, no_tests_review
a(7, 13.5, 'bounce', 'ROUT-4150', {});
a(7, 14.0, 'bounce', 'ROUT-4150', {});                                 // -> bounced_twice

/* --- D8: no history, all sprint; a ticket handed back; a second evening ---- */
//        09:00 -> never_blamed
a(8, 10.0, 'ask', 'ROUT-4150', { to: 'deepa', gain: 8, cost: 2.0 });
a(8, 11.0, 'ask', 'ROUT-4177', { to: 'deepa', gain: 8, cost: 2.0 });
a(8, 13.0, 'abandon', 'ROUT-4177', {});                                // -> abandon_after_investment
[15.0, 15.5, 16.0].forEach(function (h) {
  a(8, h, 'do', 'ROUT-4150', { action: 'read_code', gain: 1 });         // -> heroics (2nd evening)
});

/* --- D9/D10: the budget runs out and the sprint runs down ------------------ */
a(9, 10.0, 'ask', 'ROUT-4150', { to: 'deepa', gain: 5, cost: 1.75 });   // -> senior_budget_low
a(9, 11.0, 'do', 'ROUT-4150', { action: 'run_tests', gain: 2 });
a(10, 10.0, 'do', 'ROUT-4150', { action: 'run_tests', gain: 1 });

/* ================================================================ SPRINT B ===
 * The junior who learned it the other way round.
 * ========================================================================== */

var B = [];
function b(d, h, act, tid, extra) {
  var s = { d: d, h: h, act: act, tid: tid };
  if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) s[k] = extra[k];
  B.push(s);
  return s;
}

b(1, 9.00, 'est', 'ROUT-4102', { hours: 3 });
b(1, 9.00, 'est', 'ROUT-4108', { hours: 6 });
b(1, 9.00, 'est', 'ROUT-4150', { hours: 8 });
b(1, 9.00, 'est', 'ROUT-4177', { hours: 2 });
b(1, 9.00, 'est', 'ROUT-4190', { hours: 3 });
b(1, 9.25, 'do', 'ROUT-4102', { action: 'reproduce', gain: 18 });
b(1, 9.75, 'do', 'ROUT-4102', { action: 'git_blame', gain: 14 });      // history, day one
b(1, 10.0, 'do', 'ROUT-4102', { action: 'read_code', gain: 20 });
b(1, 10.5, 'ask', 'ROUT-4150', { to: 'hannah', gain: 22 });            // the PM, before lunch
b(1, 11.0, 'do', 'ROUT-4102', { action: 'run_tests', gain: 8 });
b(1, 11.5, 'ask', 'ROUT-4102', { to: 'deepa', gain: 34, cost: 0.5 });  // -> ask_well_formed
b(1, 12.0, 'build', 'ROUT-4102', { hours: 1.5 });
b(1, 13.5, 'tests', 'ROUT-4102', {});

b(2, 9.00, 'pr', 'ROUT-4102', {});
b(2, 10.0, 'do', 'ROUT-4190', { action: 'read_docs', gain: 30 });      // -> legacy_dragons
b(2, 10.5, 'do', 'ROUT-4190', { action: 'git_blame', gain: 20 });
b(2, 11.0, 'do', 'ROUT-4190', { action: 'read_code', gain: 22 });
b(2, 11.5, 'conv', 'ROUT-4190', { name: 'ExportPipeline' });          // docs read first: no complaint
b(2, 12.0, 'do', 'ROUT-4190', { action: 'run_tests', gain: 20 });
b(2, 13.0, 'build', 'ROUT-4190', { hours: 1 });

b(3, 9.00, 'merge', 'ROUT-4102', {});                                  // -> first_merge
b(3, 9.50, 'tests', 'ROUT-4190', {});
b(3, 10.5, 'pr', 'ROUT-4190', {});
b(3, 11.5, 'do', 'ROUT-4150', { action: 'read_docs', gain: 20 });
b(3, 12.0, 'do', 'ROUT-4150', { action: 'read_code', gain: 18 });
b(3, 12.5, 'do', 'ROUT-4150', { action: 'git_blame', gain: 10 });

b(4, 9.00, 'merge', 'ROUT-4190', {});
b(4, 10.0, 'do', 'ROUT-4177', { action: 'run_tests', gain: 20 });
b(4, 10.5, 'do', 'ROUT-4177', { action: 'git_blame', gain: 26 });
b(4, 11.0, 'do', 'ROUT-4177', { action: 'search_slack', gain: 28 });
b(4, 11.5, 'abandon', 'ROUT-4177', {});                                // 1.0h in: not a sunk day

b(5, 9.00, 'ask', 'ROUT-4150', { to: 'hannah', gain: 20 });
b(5, 10.0, 'do', 'ROUT-4150', { action: 'read_code', gain: 14 });
b(5, 14.25, 'reply', null, { id: 'ev5' });                             // -> hannah_answered:ev5

b(6, 9.0, 'do', 'ROUT-4150', { action: 'run_tests', gain: 10 });
b(6, 10.0, 'build', 'ROUT-4150', { hours: 2 });
b(6, 12.5, 'tests', 'ROUT-4150', {});
b(7, 10.0, 'pr', 'ROUT-4150', {});
b(8, 10.0, 'do', 'ROUT-4108', { action: 'git_blame', gain: 22 });
b(8, 10.5, 'do', 'ROUT-4108', { action: 'search_slack', gain: 18 });
b(9, 10.0, 'ask', 'ROUT-4108', { to: 'deepa', gain: 40, cost: 0.75 });

/* --------------------------------------------------------------- assertions */

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

var VOICES = { MENTOR: 1, LEAD: 1, REVIEWER: 1, PM: 1, CHANNEL: 1, BOT: 1 };
var TONES = { neutral: 1, pressure: 1, warn: 1, praise: 1, alarm: 1 };

function checkCommon(tag, run) {
  var feed = run.feed;
  var counts = triggerCounts(feed);

  ok(run.squadFeed.length === feed.length, tag + ': getFeed() matches the onMessage stream',
     run.squadFeed.length + ' vs ' + feed.length);

  Object.keys(counts).forEach(function (id) {
    ok(counts[id] === 1, tag + ': no trigger fires twice: ' + id, 'count=' + counts[id]);
  });

  // at most one reactive message per tick
  var perTick = {};
  feed.forEach(function (x) { if (x.kind === 'reactive') perTick[x.tick] = (perTick[x.tick] || 0) + 1; });
  Object.keys(perTick).forEach(function (tk) {
    ok(perTick[tk] <= 1, tag + ': at most one reactive message on tick ' + tk, 'got ' + perTick[tk]);
  });

  // priority: if a message was already waiting when an earlier one went out, the
  // one that went out first must not be lower priority.
  var reactive = feed.filter(function (x) { return x.kind === 'reactive'; });
  for (var i = 0; i < reactive.length; i++) {
    for (var j = i + 1; j < reactive.length; j++) {
      if (reactive[j].queuedAt > reactive[i].tick) continue;    // was not in the queue yet
      ok(Squad.PRIORITY[reactive[i].from] <= Squad.PRIORITY[reactive[j].from],
         tag + ': drain honours priority: ' + reactive[i].trigger + ' before ' + reactive[j].trigger,
         reactive[i].from + '(' + Squad.PRIORITY[reactive[i].from] + ') vs ' +
         reactive[j].from + '(' + Squad.PRIORITY[reactive[j].from] + ')');
    }
  }

  ok(run.pending === 0, tag + ': reactive queue fully drained by the retro', 'pending=' + run.pending);

  // scripted events: all fired, once, never early, verbatim
  var sched = feed.filter(function (x) { return x.kind === 'scripted'; });
  ok(sched.length === EVENTS.length, tag + ': all scripted events fired',
     sched.length + '/' + EVENTS.length);
  EVENTS.forEach(function (e) {
    var hits = sched.filter(function (x) { return x.eventId === e.id; });
    ok(hits.length === 1, tag + ': scripted event fired once: ' + e.id, 'count=' + hits.length);
    if (hits.length) {
      ok(hits[0].day > e.day || (hits[0].day === e.day && hits[0].hour >= e.hour - 1e-9),
         tag + ': scripted event not early: ' + e.id);
      ok(hits[0].text === e.text, tag + ': scripted event text verbatim: ' + e.id);
      ok(hits[0].name === e.name, tag + ': scripted event byline: ' + e.id);
      ok(hits[0].from === e.from, tag + ': scripted event voice: ' + e.id);
      ok(!!hits[0].needsReply === !!e.needsReply, tag + ': needsReply carried through: ' + e.id);
    }
  });

  // gates: once each, on the right day, prompt verbatim
  var gates = feed.filter(function (x) { return x.kind === 'gate'; });
  ok(gates.length === 4, tag + ': all four gates fired', 'got ' + gates.length);
  Squad.GATES.forEach(function (g) {
    var hits = gates.filter(function (x) { return x.gate === g.id; });
    ok(hits.length === 1, tag + ': gate fired once: ' + g.id, 'count=' + hits.length);
    if (hits.length) {
      ok(hits[0].text === g.prompt, tag + ': gate prompt verbatim: ' + g.id, hits[0].text);
      ok(hits[0].day === g.day, tag + ': gate lands on its day: ' + g.id, 'day=' + hits[0].day);
      ok(hits[0].title === g.title, tag + ': gate carries its title: ' + g.id);
      ok(hits[0].from === 'LEAD', tag + ': gates come from the lead: ' + g.id);
    }
  });

  // message shape
  feed.forEach(function (x, i) {
    ok(typeof x.day === 'number' && typeof x.hour === 'number' && typeof x.t === 'string',
       tag + ': msg[' + i + '] has day/hour/t');
    ok(!!VOICES[x.from], tag + ': msg[' + i + '] valid from: ' + x.from);
    ok(typeof x.name === 'string' && x.name.length > 0, tag + ': msg[' + i + '] has a byline');
    ok(typeof x.text === 'string' && x.text.length > 0, tag + ': msg[' + i + '] has text');
    ok(!!TONES[x.tone], tag + ': msg[' + i + '] valid tone: ' + x.tone);
    ok(typeof x.needsReply === 'boolean', tag + ': msg[' + i + '] has needsReply');
    ok(x.text.indexOf('{') < 0, tag + ': msg[' + i + '] has no unfilled placeholder', x.text);
    ok(x.t === 'D' + x.day + ' ' + hhmm(x.hour), tag + ': msg[' + i + '] stamp agrees with the clock',
       x.t + ' vs D' + x.day + ' ' + hhmm(x.hour));
  });

  // ordering
  for (var oi = 1; oi < feed.length; oi++) {
    ok(feed[oi].day > feed[oi - 1].day ||
       (feed[oi].day === feed[oi - 1].day && feed[oi].hour >= feed[oi - 1].hour - 1e-9),
       tag + ': feed is time-ordered at index ' + oi);
  }
  return counts;
}

function byTrigger(run, id) {
  var hit = run.feed.filter(function (x) { return x.trigger === id; });
  return hit.length ? hit[0] : null;
}

/* ---- SPRINT A -------------------------------------------------------------- */

var runA = runSprint(A, [3, 8]);
var countsA = checkCommon('A', runA);

var EXPECT_A = [
  'flat_estimates', 'repeat_action', 'silent_stuck', 'estimate_2x',
  'never_asked_day4', 'channel_stranger', 'channel_over_mentor',
  'ask_premature', 'legacy_dragons', 'misleading_action',
  'ask_well_formed', 'hannah_silence:ev5', 'pr_at_cutoff',
  'first_merge', 'convention_unchecked', 'ask_overdue',
  'implement_underinformed', 'no_tests_ci', 'no_tests_review',
  'bounced_twice', 'never_blamed', 'abandon_after_investment',
  'heroics', 'senior_budget_low'
];
EXPECT_A.forEach(function (id) {
  ok(countsA[id] === 1, 'A: trigger fired exactly once: ' + id, 'count=' + (countsA[id] || 0));
});
['hannah_answered:ev5'].forEach(function (id) {
  ok(!countsA[id], 'A: trigger correctly did NOT fire: ' + id);
});
ok(EXPECT_A.length >= 20, 'A exercises the whole table', EXPECT_A.length + ' triggers');

// the right voice says the right thing
[['silent_stuck', 'LEAD'], ['never_asked_day4', 'LEAD'], ['estimate_2x', 'LEAD'],
 ['heroics', 'LEAD'], ['abandon_after_investment', 'LEAD'], ['flat_estimates', 'LEAD'],
 ['ask_premature', 'MENTOR'], ['ask_well_formed', 'MENTOR'], ['ask_overdue', 'MENTOR'],
 ['repeat_action', 'MENTOR'], ['misleading_action', 'MENTOR'], ['legacy_dragons', 'MENTOR'],
 ['senior_budget_low', 'MENTOR'], ['channel_over_mentor', 'MENTOR'],
 ['implement_underinformed', 'REVIEWER'], ['bounced_twice', 'REVIEWER'],
 ['convention_unchecked', 'REVIEWER'], ['first_merge', 'REVIEWER'], ['pr_at_cutoff', 'REVIEWER'],
 ['no_tests_review', 'REVIEWER'], ['no_tests_ci', 'BOT'],
 ['channel_stranger', 'CHANNEL'], ['hannah_silence:ev5', 'PM']
].forEach(function (p) {
  var m = byTrigger(runA, p[0]);
  ok(m && m.from === p[1], 'A: ' + p[0] + ' is spoken by ' + p[1], m ? m.from : 'missing');
});

// CI speaks before the reviewer does, exactly as the spec's table asks
var ci = byTrigger(runA, 'no_tests_ci'), rv = byTrigger(runA, 'no_tests_review');
ok(ci && rv && (ci.day < rv.day || (ci.day === rv.day && ci.hour <= rv.hour)),
   'A: the coverage gate is BOT first, then REVIEWER');

// the good moment is genuinely warm, and it is the only praise from the reviewer
var fm = byTrigger(runA, 'first_merge');
ok(fm && fm.tone === 'praise', 'A: the first merge is praised, not merely logged');
var wf = byTrigger(runA, 'ask_well_formed');
ok(wf && wf.tone === 'praise', 'A: a well-formed question is praised explicitly');

// timing of the time-critical ones
var ss = byTrigger(runA, 'silent_stuck');
ok(ss && ss.day === 2, 'A: stuckness is flagged the day it happens', ss ? 'day=' + ss.day : 'missing');
var na = byTrigger(runA, 'never_asked_day4');
ok(na && na.day === 4, 'A: the no-questions nudge lands on day 4', na ? 'day=' + na.day : 'missing');
var cut = byTrigger(runA, 'pr_at_cutoff');
ok(cut && cut.day === 6 && cut.hour >= 14.5, 'A: the cutoff note lands the same afternoon',
   cut ? 'D' + cut.day + ' ' + hhmm(cut.hour) : 'missing');
var hs = byTrigger(runA, 'hannah_silence:ev5');
ok(hs && hs.day === 6 && hs.needsReply === true,
   'A: the PM chases the next day, and still wants an answer',
   hs ? 'day=' + hs.day + ' needsReply=' + hs.needsReply : 'missing');
var st = byTrigger(runA, 'channel_stranger');
ok(st && st.name.indexOf('#eng-help') === 0 && st.day === 4,
   'A: the channel reply is async and carries a stranger\'s byline', st ? st.name : 'missing');
var nb = byTrigger(runA, 'never_blamed');
ok(nb && nb.day >= 8 && nb.day <= 9, 'A: the git-history nudge lands while it can still be used',
   nb ? 'day=' + nb.day : 'missing');

// the reactive feed must never name a ticket the player has not touched
ok(byTrigger(runA, 'legacy_dragons').text.indexOf('ROUT-4190') >= 0,
   'A: the dragons warning names the chore the player actually picked up');

/* ---- SPRINT B -------------------------------------------------------------- */

var runB = runSprint(B, []);
var countsB = checkCommon('B', runB);

['ask_well_formed', 'first_merge', 'legacy_dragons', 'hannah_answered:ev5'].forEach(function (id) {
  ok(countsB[id] === 1, 'B: trigger fired exactly once: ' + id, 'count=' + (countsB[id] || 0));
});
[
  'silent_stuck', 'ask_premature', 'ask_overdue', 'never_asked_day4', 'never_blamed',
  'flat_estimates', 'repeat_action', 'misleading_action', 'estimate_2x', 'heroics',
  'implement_underinformed', 'no_tests_ci', 'no_tests_review', 'bounced_twice',
  'convention_unchecked', 'abandon_after_investment', 'channel_over_mentor',
  'channel_stranger', 'hannah_silence:ev5', 'senior_budget_low', 'pr_at_cutoff'
].forEach(function (id) { ok(!countsB[id], 'B: trigger correctly did NOT fire: ' + id); });

var ha = byTrigger(runB, 'hannah_answered:ev5');
ok(ha && ha.from === 'PM' && ha.tone === 'praise',
   'B: answering the PM the same afternoon is acknowledged as such');

/* ---- determinism ----------------------------------------------------------- */

var runA2 = runSprint(A, [3, 8]);
ok(JSON.stringify(runA2.feed) === JSON.stringify(runA.feed),
   'two identical sprints produce byte-identical feeds');

function reactiveText(run) {
  return run.feed.filter(function (x) { return x.kind === 'reactive'; })
                 .map(function (x) { return x.text; }).join('|');
}
ok(reactiveText(runB) !== reactiveText(runA), 'a sprint played differently draws different words');

/* ---- squad.js can never see the truth -------------------------------------- */

ok(touched.reveal === 0, 'squad.js never called repo.reveal()', 'calls=' + touched.reveal);
ok(touched._t === 0, 'squad.js never read repo._t', 'reads=' + touched._t);

var SRC = fs.readFileSync(SQUAD_PATH, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
[['reveal(', 'calls reveal()'], ['__truth', 'reads the decoded truth'],
 ['._t', 'reads the encoded truth blob'], ["['_t']", 'reads the truth blob by index'],
 ['atob(', 'decodes base64'], ['selfFindable', 'reads solvability'],
 ['timeboxHours', 'reads the true timebox'], ['conventionTrap', 'reads the trap'],
 ['soloCap', 'reads the solo ceiling'], ['needsTests', 'reads the tests flag'],
 ['yield', 'reads action yields'], ['bestPath', 'reads the optimal route']
].forEach(function (p) {
  ok(SRC.indexOf(p[0]) < 0, 'squad.js never reads ground truth: ' + p[1]);
});
ok(SRC.indexOf('Math.random') < 0, 'squad.js contains no Math.random');
ok(SRC.indexOf('require(') < 0 && SRC.indexOf('import ') < 0, 'squad.js has no imports');
[['document.', 'reaches for the document'], ['getElementById', 'queries the DOM'],
 ['createElement', 'builds DOM nodes'], ['addEventListener', 'binds DOM events'],
 ['querySelector', 'queries the DOM'], ['canvas', 'draws']
].forEach(function (p) {
  ok(SRC.indexOf(p[0]) < 0, 'squad.js touches no DOM: ' + p[1]);
});

/* ---- the gates are a hard contract: check them against SPEC.md itself ------ */

var SPEC = fs.readFileSync(path.join(__dirname, '..', 'SPEC.md'), 'utf8');
ok(Squad.GATES.length === 4, 'Squad.GATES has four gates', 'got ' + Squad.GATES.length);
Squad.GATES.forEach(function (g) {
  ok(SPEC.indexOf(g.prompt) > 0, 'gate prompt is byte-verbatim from SPEC.md: ' + g.id, g.prompt);
  ok(SPEC.indexOf(g.title) > 0, 'gate title is byte-verbatim from SPEC.md: ' + g.id, g.title);
});
[[1, 'kickoff'], [3, 'standup'], [6, 'oneonone'], [10, 'retro']].forEach(function (p, i) {
  ok(Squad.GATES[i].day === p[0] && Squad.GATES[i].id === p[1],
     'gate ' + i + ' is day ' + p[0] + ' / ' + p[1],
     Squad.GATES[i].day + '/' + Squad.GATES[i].id);
});

/* ------------------------------------------------------------------ printing */

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
    var head = '  ' + padR('[' + x.t + ']', 12) + padR(x.from, 9) + padR(x.name, 33) + '| ';
    console.log(head + wrap(x.text + (x.needsReply ? '   [REPLY REQUIRED]' : ''), 84,
                            '                                                         '));
  });
  console.log('');
  console.log(' reactive triggers, in the order they were spoken:');
  run.feed.forEach(function (x) {
    if (x.kind === 'reactive') {
      console.log('   ' + padR(x.t, 12) + padR(x.from, 9) + padR(x.tone, 9) +
                  padR(x.trigger, 28) + 'detected on tick ' + x.queuedAt);
    }
  });
  console.log('');
  console.log(' merged ' + JSON.stringify(run.sim.merged) +
              '   Deepa left ' + run.sim.seniorLeft.toFixed(2) + 'h' +
              '   messages ' + run.feed.length);
}

printFeed('SPRINT A — the junior who will not ask', runA);
printFeed('SPRINT B — the junior who asks, and asks well', runB);

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
