#!/usr/bin/env node
/* =============================================================================
 * tools/test_org.js  —  run with:  node tools/test_org.js
 *
 * Zero dependencies. Loads sim/org.js exactly as a browser would (it assigns to
 * `window.Org`; we point `window` at the node global), then walks two synthetic
 * PMs through a full twelve-week quarter at a synthetic company, using a fake
 * Product that publishes the state shape SPEC §2 describes.
 *
 * QUARTER A — the PM who decides fast and measures late:
 *   W1 D3   commits Live cursors with nothing measured against it   -> commit_no_research
 *   W1-W2   two commits whose only evidence is a chat with sales    -> sales_only
 *   W2 D1   a research slot has sat empty six days                  -> slot_idle
 *   W3 D2   an estimate doubles; committed work now exceeds the
 *           runway that physically remains                          -> over_capacity
 *   W4 D2   five days after the slip the plan is untouched          -> slip_ignored
 *   W4 D3   the response to being late is a new commitment          -> slip_add_scope
 *   W4      two instruments 4.1pp apart on one feature, no third    -> disagreement_unresolved
 *   W4 D1   research started on a feature already committed         -> research_after_decision
 *   W4 D5   drops the feature VP Sales championed                   -> dropped_champion
 *   W5 D2   never answers the escalation                            -> escalation_ignored:ev_deal
 *   W5 D2   sales trust falls through the floor                     -> trust_floor
 *   W6 D1   five things open, nothing shipped                       -> nothing_shipped_w6
 *   W6 D3   ten working days with nothing being measured            -> research_drought
 *   W7 D1   the deal dies; no enterprise work was ever committed    -> deal_lost
 *   W7 D2   every instrument used fails in the same direction       -> no_opposing_instruments
 *   W7 D5   ships something no reading supported                    -> shipped_unsupported
 *   W8 D1   week eight, no fake door, no A/B, ever                  -> no_revealed_pref
 *   W8 D2   answers the CEO in a day                                -> reply_ack:ev_mobile
 *   W8 D4   the customer who told you the truth follows up          -> customer_signal_ignored
 *
 * QUARTER B — the other failure mode, and the only way to prove the triggers
 * quarter A must NOT fire actually work:
 *   researches everything through instruments that disagree by construction,
 *   uses a fake door, answers every escalation the next day, commits only the
 *   two things you can screenshot, and ships nothing at all.
 *     -> polish_over_plumbing, research_no_ship, reply_ack:ev_deal, reply_ack:ev_mobile
 *     and NOT commit_no_research / sales_only / no_revealed_pref /
 *     dropped_champion / over_capacity / slip_* / nothing_shipped_w6 /
 *     research_drought / disagreement_unresolved / trust_floor /
 *     shipped_unsupported / no_opposing_instruments / customer_signal_ignored /
 *     escalation_ignored:*
 *
 * Asserts in both: the right triggers fire, none fires twice, at most one
 * reactive message per tick, the drain honours CEO > ENG > SALES > SUPPORT >
 * DESIGN > CUSTOMER, the queue empties by the end of the quarter, all four
 * gates land once at the right week with the spec's prompt verbatim, every
 * scripted event lands once and never early, message shape is valid, feeds are
 * time-ordered, org.js contains no path to ground truth, and two identical
 * quarters produce byte-identical feeds. Then prints both feeds so the writing
 * can be read.
 * ========================================================================== */

'use strict';

var path = require('path');
var fs = require('fs');

// --- load sim/org.js the way a <script src> would ----------------------------
global.window = global;
var ORG_PATH = path.join(__dirname, '..', 'sim', 'org.js');
require(ORG_PATH);
var Org = global.window.Org;

/* ================================================== the synthetic company ===
 * Deliberately NOT Lumen: different id, different product, different feature
 * ids, and stakeholder ids that do not match anything hard-coded, so the voice
 * mapping has to be derived from the published `role` strings. Same five
 * archetypes, because the writing is what is being judged.
 * ========================================================================== */

var CO = {
  scenario: {
    company: 'Halyard',
    product: 'Atlas — shared reporting for operations teams',
    role: 'Product Manager, Activation',
    northStar: { name: 'W4 team activation', units: 'pp', baseline: 28.0, desc: 'Teams with 3+ active members in week four.' },
    quarter: { weeks: 12, workDaysPerWeek: 5 },
    capacity: { engWeeksPerWeek: 4, total: 48 },
    brief: 'Take activation from 28.0 to 36.0 in one quarter.',
    ceoMandate: 'Activation from 28.0 to 36.0 by the end of the quarter.'
  },
  features: [
    { id: 'quickstart_wizard',   name: 'Quickstart wizard',   tags: ['onboarding'],           estCost: 5,  desc: 'Guided first-run setup.',            pitchedBy: 'you' },
    { id: 'template_library',    name: 'Template library',    tags: ['onboarding','workflow'], estCost: 8, desc: 'Prebuilt reports to start from.',    pitchedBy: 'you' },
    { id: 'live_cursors',        name: 'Live cursors',        tags: ['flashy','workflow'],    estCost: 10, desc: 'Multiplayer editing in the canvas.', pitchedBy: 'Marguerite (CEO)' },
    { id: 'query_latency',       name: 'Query latency work',  tags: ['infra','fix'],          estCost: 6,  desc: 'P95 from 4.1s to under 1.5s.',       pitchedBy: 'Rina (Eng)' },
    { id: 'alert_rules',         name: 'Alert rules',         tags: ['workflow'],             estCost: 6,  desc: 'Threshold alerts on any metric.',    pitchedBy: 'you' },
    { id: 'scim_provisioning',   name: 'SCIM provisioning',   tags: ['enterprise','fix'],     estCost: 8,  desc: 'SAML SSO with SCIM.',                pitchedBy: 'Dan (Sales)' },
    { id: 'theme_packs',         name: 'Theme packs',         tags: ['flashy'],               estCost: 5,  desc: 'Six accent themes and branding.',    pitchedBy: 'Kofi (Design)' }
  ],
  instruments: [
    { id: 'sales_anecdote',  name: 'Talk to sales',            days: 1,  slots: 1, knownCaveat: 'Every story is true and none of them is representative.' },
    { id: 'support_tickets', name: 'Support ticket analysis',  days: 2,  slots: 1, knownCaveat: 'Tickets come from people who stayed long enough to be frustrated.' },
    { id: 'usage_analytics', name: 'Usage analytics',          days: 5,  slots: 1, knownCaveat: 'Blind by construction to demand for what does not exist yet.' },
    { id: 'survey',          name: 'Customer survey',          days: 5,  slots: 1, knownCaveat: 'Stated preference, not revealed preference.' },
    { id: 'interviews',      name: 'Customer interviews',      days: 4,  slots: 1, knownCaveat: 'Low bias, small sample. Eight people is eight people.' },
    { id: 'fake_door',       name: 'Fake-door test',           days: 10, slots: 1, knownCaveat: 'Revealed preference and close to unbiased. Slow.' },
    { id: 'ab_test',         name: 'A/B test',                 days: 15, slots: 1, requiresShipped: true, knownCaveat: 'The cleanest number, and it arrives after the decision.' }
  ],
  stakeholders: [
    { id: 'ceo',          name: 'Marguerite Osei',  role: 'CEO',              startTrust: 60, favors: ['live_cursors'],                 opposes: [],                desc: 'Sharp, impatient, pattern-matches to competitors.' },
    { id: 'vp_sales',     name: 'Dan Reilly',       role: 'VP Sales',         startTrust: 60, favors: ['scim_provisioning'],            opposes: ['theme_packs'],   desc: 'Charming and relentless. Always one specific deal.' },
    { id: 'eng_lead',     name: 'Rina Chowdhury',   role: 'Engineering lead', startTrust: 60, favors: ['query_latency'],                opposes: ['live_cursors'],  desc: 'Dry, protective, allergic to scope creep.' },
    { id: 'design_lead',  name: 'Kofi Adeyemi',     role: 'Design lead',      startTrust: 60, favors: ['theme_packs','live_cursors'],   opposes: [],                desc: 'Real taste, drawn to visible polish.' },
    { id: 'support_lead', name: 'Tomás Vidal',      role: 'Support lead',     startTrust: 60, favors: ['query_latency'],                opposes: [],                desc: 'Buried and empirical. Speaks in ticket volumes.' }
  ],
  events: [
    { week: 1,  day: 1, id: 'ev0',  from: 'CEO',      name: 'Marguerite Osei', tone: 'pressure', needsReply: false,
      text: 'Activation is 28.0 and the board has been told 36. I do not need you to agree with the number. I need to know what you are doing about it and, more usefully, what you are not doing.' },
    { week: 1,  day: 2, id: 'ev1',  from: 'ENG',      name: 'Rina Chowdhury',  tone: 'neutral',  needsReply: false,
      text: 'Estimates are on the board. Usual caveat: that is what it looks like from out here, not what it will be. Ask me again once we are inside something.' },
    { week: 2,  day: 3, id: 'ev2',  from: 'SALES',    name: 'Dan Reilly',      tone: 'pressure', needsReply: false,
      text: 'Brightwater is 210k and they will not sign without SCIM. I am not asking you to redo the quarter. I am asking for one thing.' },
    { week: 4,  day: 2, id: 'ev_deal', from: 'SALES', name: 'Dan Reilly',      tone: 'alarm',    needsReply: true,
      text: 'Brightwater has gone to a competitive evaluation. If SCIM is not committed this week I have to tell Marguerite we lost it on product. What do you want me to say?' },
    { week: 5,  day: 1, id: 'ev4',  from: 'CEO',      name: 'Marguerite Osei', tone: 'alarm',    needsReply: false,
      text: 'Northbeam shipped multiplayer editing and it is all over our channel this morning. Tell me why we are not doing that.' },
    { week: 6,  day: 4, id: 'ev5',  from: 'CUSTOMER', name: 'Priya Raman — Head of Data, Vantiv', tone: 'neutral', needsReply: false,
      text: 'Honestly? The product is fine once you are in it. Getting my team in was the problem. Four of my six analysts never made it past the empty state.' },
    { week: 7,  day: 2, id: 'ev6',  from: 'ENG',      name: 'Rina Chowdhury',  tone: 'alarm',    needsReply: false,
      text: 'Production incident overnight. I am pulling two engineers for the rest of the week. That is about five eng-weeks off your quarter and it is not negotiable.' },
    { week: 8,  day: 1, id: 'ev_mobile', from: 'CEO', name: 'Marguerite Osei', tone: 'pressure', needsReply: true,
      text: 'I want themes in this quarter. I have said so to the board. Talk me out of it if you think I am wrong, but talk me out of it with something.' },
    { week: 9,  day: 3, id: 'ev8',  from: 'SUPPORT',  name: 'Tomás Vidal',     tone: 'warn',     needsReply: false,
      text: 'Latency complaints are up 40% month over month and it is now our top ticket driver. I am not a PM but this feels like it should be on the list.' },
    { week: 10, day: 2, id: 'ev9',  from: 'DESIGN',   name: 'Kofi Adeyemi',    tone: 'neutral',  needsReply: false,
      text: 'Whatever ships, it needs to feel like one product. Three half-finished things is worse than one finished one. I would rather we cut than smear.' },
    { week: 11, day: 1, id: 'ev10', from: 'ENG',      name: 'Rina Chowdhury',  tone: 'warn',     needsReply: false,
      text: 'Reality check on what is still open. Anything not code-complete by Friday is not shipping this quarter, and half-shipped is the same as not shipped.' },
    { week: 12, day: 3, id: 'ev11', from: 'CEO',      name: 'Marguerite Osei', tone: 'pressure', needsReply: false,
      text: 'QBR Thursday. The number, the reasoning, and what you would do differently. I have never once been annoyed by a PM who told me they were wrong early.' }
  ]
};

/* ================================================= the fake Product engine ===
 * Publishes exactly the state shape SPEC §2 describes and nothing else. It has
 * no ground truth of its own: impacts, ships and slips are scripted, because
 * this file is testing the org, not the observation model.
 * ========================================================================== */

var RULES = { weeks: 12, workDays: 60, engWeeksPerWeek: 4, totalCapacity: 48, researchSlots: 2 };
var FakeProduct = { RULES: RULES };

function instrumentDays(iid) {
  for (var i = 0; i < CO.instruments.length; i++) if (CO.instruments[i].id === iid) return CO.instruments[i].days;
  return 1;
}
function featureEst(fid) {
  for (var i = 0; i < CO.features.length; i++) if (CO.features[i].id === fid) return CO.features[i].estCost;
  return 0;
}
function absDay(e) { return (e.week - 1) * 5 + e.day; }

function Sim(script) {
  this.day = 0;
  this.script = script;
  this.roadmap = [];
  this.shipped = [];
  this.running = [];
  this.done = [];
  this.capacityUsed = 0;
  this.answered = {};
  this.trust = {};
  for (var i = 0; i < CO.stakeholders.length; i++) {
    this.trust[CO.stakeholders[i].id] = CO.stakeholders[i].startTrust;
  }
}

Sim.prototype.entry = function (fid) {
  for (var i = 0; i < this.roadmap.length; i++) if (this.roadmap[i].featureId === fid) return this.roadmap[i];
  return null;
};

Sim.prototype.step = function () {
  this.day++;
  var d = this.day, i, a;

  // 1. research that finishes today lands as a reading
  var stillRunning = [];
  for (i = 0; i < this.running.length; i++) {
    a = this.running[i];
    if (a.endDay <= d) {
      this.done.push({ featureId: a.featureId, instrumentId: a.instrumentId, value: a.value, day: d });
    } else {
      a.daysLeft = a.endDay - d;
      a.progress = 1 - (a.daysLeft / instrumentDays(a.instrumentId));
      stillRunning.push(a);
    }
  }
  this.running = stillRunning;

  // 2. the PM's actions for today
  for (i = 0; i < this.script.length; i++) {
    var s = this.script[i];
    if (s.day !== d) continue;
    if (s.act === 'commit') {
      this.roadmap.push({
        featureId: s.fid, status: 'queued', progress: 0, engWeeksSpent: 0,
        predictedImpact: s.predicted, rationale: s.rationale
      });
    } else if (s.act === 'drop') {
      var e1 = this.entry(s.fid); if (e1) e1.status = 'dropped';
    } else if (s.act === 'ship') {
      var e2 = this.entry(s.fid);
      if (e2) { e2.status = 'shipped'; e2.progress = 1; }
      this.shipped.push(s.fid);
    } else if (s.act === 'slip') {
      var e3 = this.entry(s.fid); if (e3) e3.revisedEstimate = s.to;
    } else if (s.act === 'research') {
      this.running.push({
        featureId: s.fid, instrumentId: s.iid, value: s.value,
        startDay: d, endDay: d + instrumentDays(s.iid),
        daysLeft: instrumentDays(s.iid), progress: 0
      });
    } else if (s.act === 'reply') {
      this.answered[s.id] = true;
    } else if (s.act === 'trust') {
      this.trust[s.id] = Math.max(0, Math.min(100, this.trust[s.id] + s.delta));
    }
  }

  // 3. the build queue eats capacity, in order, one item at a time
  for (i = 0; i < this.roadmap.length; i++) {
    var e = this.roadmap[i];
    if (e.status === 'dropped' || e.status === 'shipped') continue;
    e.status = 'building';
    e.engWeeksSpent = Math.round((e.engWeeksSpent + RULES.engWeeksPerWeek / 5) * 100) / 100;
    var est = e.revisedEstimate || featureEst(e.featureId);
    e.progress = est > 0 ? Math.min(1, e.engWeeksSpent / est) : 0;
    this.capacityUsed = Math.round((this.capacityUsed + RULES.engWeeksPerWeek / 5) * 100) / 100;
    break;
  }

  // 4. escalations still waiting on the player
  var open = [];
  for (i = 0; i < CO.events.length; i++) {
    var ce = CO.events[i];
    if (!ce.needsReply) continue;
    if (absDay(ce) > d) continue;
    if (this.answered[ce.id]) continue;
    open.push({ id: ce.id, from: ce.from, text: ce.text, week: ce.week, day: ce.day, needsReply: true });
  }

  var week = Math.floor((d - 1) / 5) + 1;
  var tsum = 0, n = 0;
  for (var k in this.trust) if (Object.prototype.hasOwnProperty.call(this.trust, k)) { tsum += this.trust[k]; n++; }

  return {
    day: d, week: week, t: 'W' + week + ' D' + (((d - 1) % 5) + 1),
    capacityUsed: this.capacityUsed,
    capacityLeft: Math.round((RULES.totalCapacity - this.capacityUsed) * 100) / 100,
    roadmap: this.roadmap.map(function (x) {
      var c = {}; for (var kk in x) if (Object.prototype.hasOwnProperty.call(x, kk)) c[kk] = x[kk];
      return c;
    }),
    shipped: this.shipped.slice(),
    research: { running: this.running.slice(), done: this.done.slice() },
    trust: this.trust,
    avgTrust: n ? Math.round(tsum / n) : 0,
    northStarProjected: 28.0 + this.shipped.length * 0.9,
    openEvents: open,
    finished: d >= 60,
    qbrSubmitted: false
  };
};

function runQuarter(script) {
  var feed = [];
  Org.init({ co: CO, product: FakeProduct, onMessage: function (m) { feed.push(m); } });
  var sim = new Sim(script);
  for (var d = 1; d <= 60; d++) Org.tick(sim.step());
  return { feed: feed, orgFeed: Org.getFeed(), pending: Org.pending(), sim: sim };
}

/* ================================================================ QUARTER A */

var SCRIPT_A = [
  // W1: one measurement, then a commitment that has nothing to do with it
  { day: 2,  act: 'research', fid: 'quickstart_wizard', iid: 'sales_anecdote', value: 1.8 },
  { day: 3,  act: 'commit',   fid: 'live_cursors',      predicted: 3.5, rationale: 'The CEO keeps bringing it up and Northbeam shipped theirs.' },
  { day: 4,  act: 'commit',   fid: 'quickstart_wizard', predicted: 2.0, rationale: 'Sales says new teams get lost in the empty state.' },
  { day: 5,  act: 'research', fid: 'scim_provisioning', iid: 'sales_anecdote', value: 4.2 },
  { day: 6,  act: 'commit',   fid: 'scim_provisioning', predicted: 4.0, rationale: 'Dan has a named deal blocked on it.' },

  // W2: two instruments on the same question, both blind in the same direction
  { day: 7,  act: 'research', fid: 'query_latency',     iid: 'support_tickets', value: -0.5 },
  { day: 8,  act: 'commit',   fid: 'template_library',  predicted: 2.5, rationale: 'Feels like the natural partner to the wizard.' },
  { day: 10, act: 'research', fid: 'query_latency',     iid: 'usage_analytics', value: 3.6 },

  // W3: another commitment, then the estimate on the big one doubles
  { day: 11, act: 'commit',   fid: 'alert_rules',       predicted: 1.5, rationale: 'Cheap, and people ask for it.' },
  { day: 12, act: 'slip',     fid: 'live_cursors',      to: 24 },

  // W4: research on a decision already made, then more scope, then a drop
  { day: 16, act: 'research', fid: 'alert_rules',       iid: 'support_tickets', value: 0.4 },
  { day: 18, act: 'commit',   fid: 'theme_packs',       predicted: 2.0, rationale: 'Design has been asking all quarter and it is only five weeks.' },
  { day: 20, act: 'drop',     fid: 'scim_provisioning' },
  { day: 20, act: 'trust',    id: 'vp_sales', delta: -12 },

  // W5: the escalation from W4 D2 goes unanswered, and it costs
  { day: 22, act: 'trust',    id: 'vp_sales', delta: -15 },

  // W7: one thing finally goes out, and nothing measured ever supported it
  { day: 35, act: 'ship',     fid: 'template_library' },

  // W8: at least the CEO gets an answer the next day
  { day: 37, act: 'reply',    id: 'ev_mobile' }
];

/* ================================================================ QUARTER B */

var SCRIPT_B = [
  // Two instruments per question, chosen because they fail differently
  { day: 1,  act: 'research', fid: 'live_cursors', iid: 'fake_door',       value: 2.4 },
  { day: 1,  act: 'research', fid: 'live_cursors', iid: 'interviews',      value: 3.0 },
  { day: 5,  act: 'research', fid: 'theme_packs',  iid: 'interviews',      value: 1.9 },
  { day: 9,  act: 'research', fid: 'theme_packs',  iid: 'survey',          value: 2.6 },
  { day: 11, act: 'research', fid: 'alert_rules',  iid: 'usage_analytics', value: 1.2 },

  // ...and then commits only the two things you can screenshot, and ships none
  { day: 12, act: 'commit',   fid: 'live_cursors', predicted: 2.4, rationale: 'Fake door converted at twice the rate of the control panel.' },
  { day: 15, act: 'commit',   fid: 'theme_packs',  predicted: 2.0, rationale: 'Survey and interviews both put it near the top.' },

  // Answers everybody, immediately
  { day: 18, act: 'reply',    id: 'ev_deal' },
  { day: 37, act: 'reply',    id: 'ev_mobile' },

  // ...and keeps asking questions all quarter, which is why the drought and the
  // customer follow-up never fire for this PM even though the board never moves
  { day: 20, act: 'research', fid: 'quickstart_wizard', iid: 'survey',          value: 2.2 },
  { day: 30, act: 'research', fid: 'alert_rules',       iid: 'interviews',      value: 1.5 },
  { day: 40, act: 'research', fid: 'template_library',  iid: 'usage_analytics', value: 0.9 },
  { day: 48, act: 'research', fid: 'quickstart_wizard', iid: 'support_tickets', value: 1.7 },
  { day: 52, act: 'research', fid: 'template_library',  iid: 'interviews',      value: 1.1 },
  { day: 56, act: 'research', fid: 'alert_rules',       iid: 'survey',          value: 1.9 }
];

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

var VOICES = { CEO: 1, SALES: 1, ENG: 1, DESIGN: 1, SUPPORT: 1, CUSTOMER: 1 };
var TONES = { neutral: 1, pressure: 1, warn: 1, praise: 1, alarm: 1 };

function checkCommon(tag, run) {
  var feed = run.feed;
  var counts = triggerCounts(feed);

  ok(run.orgFeed.length === feed.length, tag + ': getFeed() matches the onMessage stream',
     run.orgFeed.length + ' vs ' + feed.length);

  // nothing fires twice
  Object.keys(counts).forEach(function (id) {
    ok(counts[id] === 1, tag + ': no trigger fires twice: ' + id, 'count=' + counts[id]);
  });

  // at most one reactive message per tick
  var perDay = {};
  feed.forEach(function (x) { if (x.kind === 'reactive') perDay[x.day] = (perDay[x.day] || 0) + 1; });
  Object.keys(perDay).forEach(function (dd) {
    ok(perDay[dd] <= 1, tag + ': at most one reactive message on day ' + dd, 'got ' + perDay[dd]);
  });

  // priority ordering: if a message was already waiting when an earlier one went
  // out, the one that went out first must not be lower priority.
  var reactive = feed.filter(function (x) { return x.kind === 'reactive'; });
  for (var i = 0; i < reactive.length; i++) {
    for (var j = i + 1; j < reactive.length; j++) {
      if (reactive[j].queuedDay > reactive[i].day) continue;   // wasn't in the queue yet
      ok(Org.PRIORITY[reactive[i].from] <= Org.PRIORITY[reactive[j].from],
         tag + ': drain honours priority: ' + reactive[i].trigger + ' before ' + reactive[j].trigger,
         reactive[i].from + '(' + Org.PRIORITY[reactive[i].from] + ') vs ' +
         reactive[j].from + '(' + Org.PRIORITY[reactive[j].from] + ')');
    }
  }

  ok(run.pending === 0, tag + ': reactive queue fully drained by the QBR', 'pending=' + run.pending);

  // scripted events: all fired, once, never early
  var sched = feed.filter(function (x) { return x.kind === 'scripted'; });
  ok(sched.length === CO.events.length, tag + ': all scripted events fired',
     sched.length + '/' + CO.events.length);
  CO.events.forEach(function (e) {
    var hits = sched.filter(function (x) { return x.eventId === e.id; });
    ok(hits.length === 1, tag + ': scripted event fired once: ' + e.id, 'count=' + hits.length);
    if (hits.length) {
      ok(hits[0].day >= absDay(e), tag + ': scripted event not early: ' + e.id);
      ok(hits[0].text === e.text, tag + ': scripted event text verbatim: ' + e.id);
      ok(hits[0].name === e.name, tag + ': scripted event byline: ' + e.id);
      ok(!!hits[0].needsReply === !!e.needsReply, tag + ': needsReply carried through: ' + e.id);
    }
  });

  // gates: once each, at the right week, prompt verbatim
  var gates = feed.filter(function (x) { return x.kind === 'gate'; });
  ok(gates.length === 4, tag + ': all four gates fired', 'got ' + gates.length);
  Org.GATES.forEach(function (g) {
    var hits = gates.filter(function (x) { return x.gate === g.id; });
    ok(hits.length === 1, tag + ': gate fired once: ' + g.id, 'count=' + hits.length);
    if (hits.length) {
      ok(hits[0].text === g.prompt, tag + ': gate prompt verbatim: ' + g.id, hits[0].text);
      ok(hits[0].week === g.week, tag + ': gate lands in its week: ' + g.id, 'week=' + hits[0].week);
      ok(hits[0].title === g.title, tag + ': gate carries its title: ' + g.id);
    }
  });

  // message shape
  feed.forEach(function (x, i) {
    ok(typeof x.day === 'number' && typeof x.week === 'number' && typeof x.t === 'string',
       tag + ': msg[' + i + '] has day/week/t');
    ok(!!VOICES[x.from], tag + ': msg[' + i + '] valid from: ' + x.from);
    ok(typeof x.name === 'string' && x.name.length > 0, tag + ': msg[' + i + '] has a byline');
    ok(typeof x.text === 'string' && x.text.length > 0, tag + ': msg[' + i + '] has text');
    ok(!!TONES[x.tone], tag + ': msg[' + i + '] valid tone: ' + x.tone);
    ok(typeof x.needsReply === 'boolean', tag + ': msg[' + i + '] has needsReply');
    ok(x.text.indexOf('{') < 0, tag + ': msg[' + i + '] has no unfilled placeholder', x.text);
    ok(x.t === 'W' + x.week + ' D' + (((x.day - 1) % 5) + 1), tag + ': msg[' + i + '] stamp agrees with day');
  });

  // ordering
  for (var oi = 1; oi < feed.length; oi++) {
    ok(feed[oi].day >= feed[oi - 1].day, tag + ': feed is time-ordered at index ' + oi);
  }
  return counts;
}

// ---- QUARTER A --------------------------------------------------------------
var runA = runQuarter(SCRIPT_A);
var countsA = checkCommon('A', runA);

var EXPECT_A = [
  'commit_no_research', 'sales_only', 'slot_idle', 'over_capacity', 'slip_ignored',
  'slip_add_scope', 'disagreement_unresolved', 'research_after_decision',
  'dropped_champion', 'escalation_ignored:ev_deal', 'trust_floor',
  'nothing_shipped_w6', 'research_drought', 'deal_lost', 'no_opposing_instruments',
  'shipped_unsupported', 'no_revealed_pref', 'reply_ack:ev_mobile',
  'customer_signal_ignored'
];
EXPECT_A.forEach(function (id) {
  ok(countsA[id] === 1, 'A: trigger fired exactly once: ' + id, 'count=' + (countsA[id] || 0));
});
['polish_over_plumbing', 'research_no_ship', 'reply_ack:ev_deal', 'escalation_ignored:ev_mobile']
  .forEach(function (id) { ok(!countsA[id], 'A: trigger correctly did NOT fire: ' + id); });

// voices: the person who lost something is the person who speaks
function byTrigger(run, id) {
  var hit = run.feed.filter(function (x) { return x.trigger === id; });
  return hit.length ? hit[0] : null;
}
var dropped = byTrigger(runA, 'dropped_champion');
ok(dropped && dropped.from === 'SALES' && dropped.name === 'Dan Reilly',
   'A: the dropped feature is mourned by the person who championed it',
   dropped ? dropped.from + '/' + dropped.name : 'missing');
var silence = byTrigger(runA, 'escalation_ignored:ev_deal');
ok(silence && silence.from === 'SALES' && silence.tone === 'alarm',
   'A: unanswered escalation comes back in the escalator’s voice');
ok(silence && silence.day >= 22 && silence.day <= 28,
   'A: the chase lands inside its window, not stale', silence ? 'day=' + silence.day : 'missing');
var ack = byTrigger(runA, 'reply_ack:ev_mobile');
ok(ack && ack.from === 'CEO' && ack.tone === 'praise',
   'A: answering the CEO in a day is acknowledged as such');
var cust = byTrigger(runA, 'customer_signal_ignored');
ok(cust && cust.from === 'CUSTOMER' && cust.name.indexOf('Priya') === 0,
   'A: the customer follow-up keeps the original byline',
   cust ? cust.name : 'missing');
ok(byTrigger(runA, 'nothing_shipped_w6') && byTrigger(runA, 'nothing_shipped_w6').week === 6,
   'A: the week-6 alarm lands in week 6');

// ---- QUARTER B --------------------------------------------------------------
var runB = runQuarter(SCRIPT_B);
var countsB = checkCommon('B', runB);

[
  'polish_over_plumbing', 'research_no_ship', 'reply_ack:ev_deal',
  'reply_ack:ev_mobile', 'slot_idle', 'deal_lost', 'over_capacity'
].forEach(function (id) {
  ok(countsB[id] === 1, 'B: trigger fired exactly once: ' + id, 'count=' + (countsB[id] || 0));
});
[
  'commit_no_research', 'sales_only', 'no_revealed_pref', 'dropped_champion',
  'slip_ignored', 'slip_add_scope', 'nothing_shipped_w6',
  'research_drought', 'disagreement_unresolved', 'trust_floor',
  'shipped_unsupported', 'no_opposing_instruments', 'customer_signal_ignored',
  'research_after_decision', 'escalation_ignored:ev_deal', 'escalation_ignored:ev_mobile'
].forEach(function (id) { ok(!countsB[id], 'B: trigger correctly did NOT fire: ' + id); });

// B's capacity warning is the honest one: two weeks left, five eng-weeks queued.
var overB = byTrigger(runB, 'over_capacity');
ok(overB && overB.week >= 10, 'B: the capacity arithmetic only bites once the runway is short',
   overB ? 'week=' + overB.week : 'missing');

// ---- determinism ------------------------------------------------------------
var runA2 = runQuarter(SCRIPT_A);
ok(JSON.stringify(runA2.feed) === JSON.stringify(runA.feed),
   'two identical quarters produce byte-identical feeds');
function reactiveText(run) {
  return run.feed.filter(function (x) { return x.kind === 'reactive'; })
                 .map(function (x) { return x.text; }).join('|');
}
ok(reactiveText(runB) !== reactiveText(runA), 'a quarter played differently draws different words');

// ---- org.js can never see the truth -----------------------------------------
// Strip comments, then look for any route into the encoded ground truth.
var SRC = fs.readFileSync(ORG_PATH, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
[['reveal(', 'calls reveal()'], ['__truth', 'reads the decoded truth'],
 ['._t', 'reads the encoded truth blob'], ['atob(', 'decodes base64'],
 ['trueCost', 'reads true costs'], ['bestSet', 'reads the optimal set']
].forEach(function (p) {
  ok(SRC.indexOf(p[0]) < 0, 'org.js never reads ground truth: ' + p[1]);
});
ok(SRC.indexOf('Math.random') < 0, 'org.js contains no Math.random');
ok(SRC.indexOf('require(') < 0 && SRC.indexOf('import ') < 0, 'org.js has no imports');

// ---- the gates are a hard contract: check them against SPEC.md itself -------
var SPEC = fs.readFileSync(path.join(__dirname, '..', 'SPEC.md'), 'utf8');
ok(Org.GATES.length === 4, 'Org.GATES has four gates', 'got ' + Org.GATES.length);
Org.GATES.forEach(function (g) {
  ok(SPEC.indexOf(g.prompt) > 0, 'gate prompt is byte-verbatim from SPEC.md: ' + g.id, g.prompt);
  ok(SPEC.indexOf(g.title) > 0, 'gate title is byte-verbatim from SPEC.md: ' + g.id, g.title);
});
[[1, 'roadmap'], [6, 'midqtr'], [11, 'shipcut'], [12, 'qbr']].forEach(function (p, i) {
  ok(Org.GATES[i].week === p[0] && Org.GATES[i].id === p[1],
     'gate ' + i + ' is week ' + p[0] + ' / ' + p[1],
     Org.GATES[i].week + '/' + Org.GATES[i].id);
});

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
    var head = '  ' + padR('[' + x.t + ']', 9) + padR(x.from, 9) + padR(x.name, 28) + '| ';
    console.log(head + wrap(x.text + (x.needsReply ? '   [REPLY REQUIRED]' : ''), 88,
                            '                                                  '));
  });
  console.log('');
  console.log(' reactive triggers, in the order they were spoken:');
  run.feed.forEach(function (x) {
    if (x.kind === 'reactive') {
      console.log('   ' + padR(x.t, 9) + padR(x.from, 9) +
                  padR(x.trigger, 34) + 'queued W' +
                  (Math.floor((x.queuedDay - 1) / 5) + 1) + ' D' + (((x.queuedDay - 1) % 5) + 1));
    }
  });
  console.log('');
  console.log(' shipped ' + JSON.stringify(run.sim.shipped) +
              '   capacity used ' + run.sim.capacityUsed.toFixed(1) +
              '   readings ' + run.sim.done.length +
              '   messages ' + run.feed.length);
}

printFeed('QUARTER A — decides fast, measures late, says no without saying it', runA);
printFeed('QUARTER B — measures everything, ships nothing, commits only what photographs well', runB);

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
