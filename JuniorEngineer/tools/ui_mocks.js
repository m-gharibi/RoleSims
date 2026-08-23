/* ============================================================================
   tools/ui_mocks.js — PREVIEW ONLY.

   Stand-ins for sim/dev.js, sim/board.js and sim/squad.js, conforming to the
   public API in SPEC.md §2–§4, so that sim/ui.js can be driven and screenshotted
   before (or independently of) the real modules.

   These mocks ARE allowed to read SIM_REPO.reveal(), because they stand in for
   dev.js, which is the one module the spec permits to read ground truth. Nothing
   in sim/ui.js reads it, which is exactly what this harness proves.

   Never loaded by index.html.
   ============================================================================ */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* seeded PRNG — mulberry32, per SPEC §2. No Math.random() anywhere.   */
  /* ------------------------------------------------------------------ */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function clamp(n, a, b) { return n < a ? a : (n > b ? b : n); }
  function num(n) { return typeof n === 'number' && isFinite(n); }
  function f1(n) { return num(n) ? n.toFixed(1) : '—'; }

  /* ================================================================== */
  /* MOCK Dev                                                           */
  /* ================================================================== */
  var RULES = {
    days: 10, hoursPerDay: 6, totalHours: 60, tickMinutes: 15,
    seniorBudgetHours: 10,
    startTrust: 55, minTrust: 0, maxTrust: 100,
    implementReadyAt: 70,
    correctAt: 90,
    reviewLagHours: { min: 2, max: 5 },
    askCostMinutes: 15,
    vagueAskExtraMinutes: 30,
    stuckHours: 3,
    minQuestionChars: 25,
    estimateRequired: true
  };

  var repo = null, truth = null, rnd = null;
  var listeners = {};
  var timer = null, speedMs = 400;
  var st = null;
  var reviewQueue = [];     // {ticketId, at}
  var answerQueue = [];     // {ticketId, at, from, text}
  var pendingBounce = {};   // ticketId -> comments from the last review
  var lastGainTick = {};    // ticketId -> hours at which understanding last rose
  var stuckAnnounced = {};
  var askRecords = [];

  function emit(ev, payload) {
    (listeners[ev] || []).forEach(function (fn) {
      try { fn(payload); } catch (e) { if (window.console) console.error('listener', ev, e); }
    });
  }

  function tt(id) { return (truth && truth.tickets && truth.tickets[id]) || {}; }

  function clockLabel() {
    var startHour = 9;
    var hh = Math.floor(st.hour), mm = Math.round((st.hour - hh) * 60);
    return 'D' + st.day + ' ' + (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm;
  }

  function recompute() {
    st.t = clockLabel();
    var spent = 0;
    st.tickets.forEach(function (t) { spent += t.hoursSpent; });
    st.hoursLeft = Math.max(0, RULES.totalHours - ((st.day - 1) * RULES.hoursPerDay + (st.hour - 9)));
    st.tick = Math.round(((st.day - 1) * RULES.hoursPerDay + (st.hour - 9)) * 60 / RULES.tickMinutes);
    var vals = [], sum = 0, n = 0;
    for (var k in st.trust) { sum += st.trust[k]; n++; }
    st.avgTrust = n ? Math.round(sum / n) : RULES.startTrust;
    st.merged = st.tickets.filter(function (t) { return t.status === 'merged'; })
                          .map(function (t) { return t.id; });
    /* stuck detection */
    st.stuckOn = null;
    st.tickets.forEach(function (t) {
      if (t.status === 'merged' || t.status === 'abandoned') return;
      if (t.hoursSpent < RULES.stuckHours) return;
      var last = lastGainTick[t.id];
      if (last === undefined) last = 0;
      if (t.hoursSpent - last >= RULES.stuckHours) st.stuckOn = t.id;
    });
    return vals;
  }

  function spendClock(hours) {
    var left = hours;
    while (left > 1e-9) {
      var dayLeft = (9 + RULES.hoursPerDay) - st.hour;
      if (dayLeft <= 1e-9) {
        if (st.day >= RULES.days) { st.finished = true; st.hour = 9 + RULES.hoursPerDay; return; }
        st.day += 1; st.hour = 9; continue;
      }
      var step = Math.min(dayLeft, left);
      st.hour += step; left -= step;
    }
    if (st.day > RULES.days) { st.finished = true; }
  }

  function chargeTicket(tid, hours) {
    var t = find(tid);
    if (t) t.hoursSpent += hours;
    spendClock(hours);
  }

  function find(tid) {
    for (var i = 0; i < st.tickets.length; i++) if (st.tickets[i].id === tid) return st.tickets[i];
    return null;
  }

  function bumpTrust(who, delta) {
    if (!who || !num(delta)) return;
    if (st.trust[who] === undefined) return;
    st.trust[who] = clamp(st.trust[who] + delta, RULES.minTrust, RULES.maxTrust);
    emit('trust', { who: who, delta: delta });
  }

  function applyUnderstanding(t, gain) {
    var tr = tt(t.id);
    var before = t.understanding;
    var u = clamp(t.understanding + gain, 0, 100);
    if (tr.selfFindable === false && num(tr.soloCap) && gain > 0 && !t._askedAnyone) {
      u = Math.min(u, tr.soloCap);
    }
    t.understanding = u;
    if (u > before) lastGainTick[t.id] = t.hoursSpent;
    return u - before;
  }

  var Dev = {
    RULES: RULES,

    init: function (opt) {
      repo = (opt && opt.repo) || window.SIM_REPO;
      truth = repo.reveal();
      rnd = mulberry32((opt && opt.seed) || 20260823);
      listeners = {};
      reviewQueue = []; answerQueue = []; pendingBounce = {};
      lastGainTick = {}; stuckAnnounced = {}; askRecords = [];
      st = {
        day: 1, hour: 9, t: 'D1 09:00', tick: 0,
        hoursLeft: RULES.totalHours,
        seniorLeft: RULES.seniorBudgetHours,
        tickets: repo.tickets.map(function (x) {
          return { id: x.id, status: 'todo', understanding: 0, hoursSpent: 0,
                   estimateHours: null, actionsUsed: {}, hasTests: false,
                   convention: null, bounces: 0, prOpenedAt: null, blockedSince: null };
        }),
        active: repo.tickets[0] ? repo.tickets[0].id : null,
        trust: {}, avgTrust: RULES.startTrust,
        merged: [], stuckOn: null, finished: false, retroSubmitted: false
      };
      repo.people.forEach(function (p) { st.trust[p.id] = num(p.startTrust) ? p.startTrust : RULES.startTrust; });
      recompute();
      return { ok: true };
    },

    getState: function () { recompute(); return st; },

    select: function (tid) {
      if (!find(tid)) return { ok: false, error: 'Pick a ticket first' };
      st.active = tid;
      return { ok: true };
    },

    estimate: function (tid, hours) {
      var t = find(tid);
      if (!t) return { ok: false, error: 'Pick a ticket first' };
      if (!num(hours) || hours <= 0) return { ok: false, error: 'That is not an estimate' };
      t.estimateHours = hours;
      return { ok: true };
    },

    investigate: function (o) {
      o = o || {};
      var t = find(o.ticketId);
      if (!t) return { ok: false, error: 'Pick a ticket first' };
      if (st.finished) return { ok: false, error: 'The sprint is over' };
      if (t.status === 'merged') return { ok: false, error: 'You already merged that' };
      if (RULES.estimateRequired && !num(t.estimateHours)) {
        return { ok: false, error: 'Estimate this ticket first' };
      }
      var a = null;
      repo.actions.forEach(function (x) { if (x.id === o.actionId) a = x; });
      if (!a) return { ok: false, error: 'No such action' };

      var tr = tt(t.id);
      var n = t.actionsUsed[a.id] || 0;
      var base = (tr.yields && num(tr.yields[a.id])) ? tr.yields[a.id] : 0;
      var decay = num(tr.decay) ? tr.decay : 0.6;
      var raw = base * Math.pow(decay, n);
      t.actionsUsed[a.id] = n + 1;
      if (t.status === 'todo') t.status = 'investigating';
      chargeTicket(t.id, (a.minutes || 15) / 60);
      var gained = applyUnderstanding(t, raw);
      var note;
      if (raw < -0.5) {
        note = 'That took you backwards. Whatever you just read describes something that is not there any more.';
      } else if (Math.abs(raw) < 0.5) {
        note = 'Nothing in here about this. Not every tool is the right tool for every ticket.';
      } else if (n > 0) {
        note = 'Some of this you had already. Rereading the same thing is not the same as progress.';
      } else {
        note = 'That helped. ' + (a.name || '') + ' on this ticket paid off.';
      }
      recompute();
      drain();
      return { ok: true, gained: Math.round(gained * 10) / 10, note: note };
    },

    ask: function (o) {
      o = o || {};
      var t = find(o.ticketId);
      if (!t) return { ok: false, error: 'Pick a ticket first' };
      if (st.finished) return { ok: false, error: 'The sprint is over' };
      var qq = String(o.question || '').trim();
      if (qq.length < RULES.minQuestionChars) return { ok: false, error: 'That question is too short to answer' };
      var to = o.to || 'deepa';
      if (to === 'deepa' && st.seniorLeft <= 0.001) {
        return { ok: false, error: 'Deepa has no time left this sprint' };
      }
      if (RULES.estimateRequired && !num(t.estimateHours)) {
        return { ok: false, error: 'Estimate this ticket first' };
      }

      var tr = tt(t.id);
      var timebox = num(tr.timeboxHours) ? tr.timeboxHours : 1.5;
      var soloLeft = repo.actions.some(function (a) {
        return (tr.yields && tr.yields[a.id] > 0) && !(t.actionsUsed[a.id] > 0);
      });
      var cls;
      if (t.hoursSpent >= 2.5 * timebox && t.understanding < RULES.implementReadyAt) cls = 'overdue';
      else if (t.hoursSpent < timebox && tr.selfFindable !== false && soloLeft) cls = 'premature';
      else cls = 'well-formed';

      var vague = qq.length < 60;
      var myMinutes = RULES.askCostMinutes + (vague ? RULES.vagueAskExtraMinutes : 0);
      chargeTicket(t.id, myMinutes / 60);

      if (to === 'deepa') {
        var senior = (cls === 'premature' ? 0.5 : 0.25) + (vague ? 0.25 : 0);
        st.seniorLeft = Math.max(0, st.seniorLeft - senior);
      }

      var yieldKey = to === 'deepa' ? 'ask_deepa' : to === 'hannah' ? 'ask_hannah' : 'ask_channel';
      var gain = (tr.yields && num(tr.yields[yieldKey])) ? tr.yields[yieldKey] : 0;
      t._askedAnyone = true;
      var trustDelta = cls === 'well-formed' ? 4 : cls === 'premature' ? -6 : -3;
      if (to === 'channel') trustDelta = Math.round(trustDelta / 2);

      var who = to === 'channel' ? null : to;
      if (who) bumpTrust(who, trustDelta);

      var answer, gained = 0;
      if (to === 'channel') {
        var lag = 0.5 + rnd() * 1.5;
        answerQueue.push({ ticketId: t.id, at: absHours() + lag, from: 'channel', gain: gain });
        answer = 'Posted in #eng-help. Someone will get to it — or they will not.';
      } else {
        gained = applyUnderstanding(t, gain);
        answer = answerFor(to, cls, t, gain);
      }
      askRecords.push({ ticketId: t.id, to: to, atHours: t.hoursSpent, classification: cls,
                        timeboxHours: timebox });
      recompute();
      drain();
      return { ok: true, answer: answer, classification: cls, trustDelta: trustDelta,
               gained: Math.round(gained * 10) / 10 };
    },

    setConvention: function (tid, name) {
      var t = find(tid);
      if (!t) return { ok: false, error: 'Pick a ticket first' };
      t.convention = String(name || '').trim() || null;
      return { ok: true };
    },

    writeTests: function (tid) {
      var t = find(tid);
      if (!t) return { ok: false, error: 'Pick a ticket first' };
      if (st.finished) return { ok: false, error: 'The sprint is over' };
      if (RULES.estimateRequired && !num(t.estimateHours)) return { ok: false, error: 'Estimate this ticket first' };
      t.hasTests = true;
      chargeTicket(tid, 0.75);
      recompute(); drain();
      return { ok: true };
    },

    implement: function (tid) {
      var t = find(tid);
      if (!t) return { ok: false, error: 'Pick a ticket first' };
      if (st.finished) return { ok: false, error: 'The sprint is over' };
      if (RULES.estimateRequired && !num(t.estimateHours)) return { ok: false, error: 'Estimate this ticket first' };
      if (t.understanding < RULES.implementReadyAt) {
        return { ok: false, error: 'You need to understand this better before you can implement it' };
      }
      var tr = tt(t.id);
      var effort = num(tr.effortHours) ? tr.effortHours : 3;
      var mult = 1 + Math.max(0, RULES.correctAt - t.understanding) / 100;
      var hours = effort * mult;
      t.status = 'implementing';
      chargeTicket(tid, hours);
      recompute(); drain();
      return { ok: true, hours: Math.round(hours * 100) / 100,
               note: mult > 1.05 ? 'Rework you paid for in advance by not understanding it first.' : '' };
    },

    openPR: function (tid) {
      var t = find(tid);
      if (!t) return { ok: false, error: 'Pick a ticket first' };
      if (st.finished) return { ok: false, error: 'The sprint is over' };
      if (t.status === 'in_review') return { ok: false, error: 'That PR is already in review' };
      if (t.status === 'merged') return { ok: false, error: 'You already merged that' };
      if (t.status !== 'implementing') {
        return { ok: false, error: 'There is nothing to review — implement it first' };
      }
      t.status = 'in_review';
      t.prOpenedAt = st.t;
      var lag = RULES.reviewLagHours.min + rnd() * (RULES.reviewLagHours.max - RULES.reviewLagHours.min);
      reviewQueue.push({ ticketId: tid, at: absHours() + lag });
      recompute();
      return { ok: true };
    },

    abandon: function (tid) {
      var t = find(tid);
      if (!t) return { ok: false, error: 'Pick a ticket first' };
      if (t.status === 'merged') return { ok: false, error: 'You already merged that' };
      t.status = 'abandoned';
      bumpTrust('tobias', tt(tid).shouldAbandon ? 2 : -4);
      recompute();
      return { ok: true };
    },

    advance: function (hours) {
      if (st.finished) return { ok: false, error: 'The sprint is over' };
      spendClock(num(hours) ? hours : 0.25);
      recompute();
      drain();
      emit('tick', st);
      if (st.day > RULES.days || (st.day === RULES.days && st.hour >= 9 + RULES.hoursPerDay)) {
        if (!st.finished) { st.finished = true; emit('sprintEnd', st); }
      }
      return { ok: true };
    },
    step: function () { return Dev.advance(RULES.tickMinutes / 60); },

    start: function () {
      if (timer) return;
      timer = setInterval(function () { Dev.advance(RULES.tickMinutes / 60); }, speedMs);
    },
    pause: function () { if (timer) { clearInterval(timer); timer = null; } },
    setSpeed: function (m) { speedMs = Math.max(60, 1600 / (m || 4)); if (timer) { Dev.pause(); Dev.start(); } },
    destroy: function () { Dev.pause(); listeners = {}; },

    on: function (ev, fn) { (listeners[ev] || (listeners[ev] = [])).push(fn); },

    submitRetro: function (o) {
      o = o || {};
      if (String(o.narrative || '').trim().length < 40) {
        return { ok: false, error: 'The narrative is too short' };
      }
      st.retroSubmitted = true;
      st.finished = true;
      Dev.pause();
      return buildScore(o);
    },

    exportRetro: function () { return buildMarkdown(); }
  };

  function absHours() { return (st.day - 1) * RULES.hoursPerDay + (st.hour - 9); }

  function answerFor(to, cls, t, gain) {
    if (to === 'hannah') {
      if (gain > 20) {
        return 'Oh — good question, and I should have written it down. Per API key, not per IP. ' +
               '600 an hour, configurable per plan. On breach it is a 429 with a Retry-After, never a ' +
               'silent drop. Ask me things like this, honestly, it saves us both a week.';
      }
      return 'I think that one is more an engineering call than a product call — Deepa or Nnamdi will ' +
             'know better than me. Happy to be asked though.';
    }
    if (cls === 'premature') {
      return 'Happy to help — but what have you tried, and what did you expect to happen? ' +
             'Have a look at it for another twenty minutes first and come back with what surprised you. ' +
             'Here is the short version anyway so you are not blocked.';
    }
    if (cls === 'overdue') {
      return 'You have been on this a while. Next time come to me at the ninety-minute mark — that is ' +
             'what the ten hours are for. Anyway: here is what is going on.';
    }
    if (gain > 40) {
      return 'Good question, and no, you were never going to find that in the repo. ' +
             'It is in a contract, not in the code — that flag is deliberate and there is an SLA behind it. ' +
             'Thank you for timeboxing it before you came.';
    }
    return 'Right — here is the piece you are missing. Nice write-up of what you tried, by the way; ' +
           'that is exactly how to ask.';
  }

  /* deliver reviews and late channel answers whose time has come */
  function drain() {
    var now = absHours();
    for (var i = reviewQueue.length - 1; i >= 0; i--) {
      if (reviewQueue[i].at <= now) {
        var job = reviewQueue.splice(i, 1)[0];
        doReview(job.ticketId);
      }
    }
    for (var j = answerQueue.length - 1; j >= 0; j--) {
      if (answerQueue[j].at <= now) {
        var a = answerQueue.splice(j, 1)[0];
        var t = find(a.ticketId);
        if (t) {
          var gained = a.gain > 0 ? applyUnderstanding(t, a.gain) : 0;
          emit('answer', {
            ticketId: a.ticketId, from: 'channel', t: st.t, day: st.day,
            answer: a.gain > 0
              ? 'someone in #eng-help: yeah we hit that last year — look at the ordering module, it builds ' +
                'the sort key off the server offset. Should be a two-line fix.'
              : 'someone in #eng-help: pretty sure you just need to bump the config? I have not looked at ' +
                'that code in a while though.'
          });
        }
      }
    }
    st.tickets.forEach(function (t) {
      if (t.status !== 'merged' && t.status !== 'abandoned' && t.hoursSpent >= RULES.stuckHours) {
        var last = lastGainTick[t.id] === undefined ? 0 : lastGainTick[t.id];
        if (t.hoursSpent - last >= RULES.stuckHours && !stuckAnnounced[t.id]) {
          stuckAnnounced[t.id] = true;
          emit('stuck', { ticketId: t.id });
        }
      }
    });
  }

  function doReview(tid) {
    var t = find(tid);
    if (!t || t.status !== 'in_review') return;
    var tr = tt(tid);
    var comments = [];
    if (t.understanding < RULES.correctAt) {
      comments.push('I asked you to walk me through the third hunk and the answer was "that is how the ' +
        'other exporter does it". That is not a reason. Come back when you can tell me why this line is here.');
    }
    if (tr.needsTests && !t.hasTests) {
      comments.push('No test covers the boundary case in the acceptance criteria. CI is green because ' +
        'nothing exercises it. Add the regression test and I will look again.');
    }
    if (tr.convention && t.convention !== tr.convention) {
      comments.push('This builds on ' + (t.convention || 'whatever was next to it') + '. We are standardising ' +
        'on ' + tr.convention + ' — the style guide is explicit about it. About sixty percent of the files ' +
        'around this one are wrong, which is why matching the neighbours bit you here.');
    }
    if (tr.scopeTrap) {
      var guarded = (tr.scopeTrap.guardedBy || []).some(function (g) {
        return g === 'ask_deepa' ? !!t._askedAnyone : !!t.actionsUsed[g];
      });
      if (!guarded) {
        comments.push('This diff touches ' + tr.scopeTrap.naiveFiles + ' files across packages three other ' +
          'teams have open branches against. Scope it to the dispatch package and it is genuinely a one-pointer.');
      }
    }
    if (tr.needsClarification && !t._askedClarifier) {
      comments.push('Before any of the code: this implements per-IP limiting, and the requirement is per-key. ' +
        'Nobody wrote that down, which is not your fault — but a message to Hannah would have caught it before ' +
        'you built it.');
    }
    var merged = comments.length === 0;
    if (merged) {
      t.status = 'merged';
      bumpTrust('nnamdi', 2);
    } else {
      t.status = 'implementing';
      t.bounces += 1;
      pendingBounce[tid] = comments;
      bumpTrust('nnamdi', -2);
    }
    recompute();
    emit('review', {
      ticketId: tid, merged: merged, comments: comments, reviewer: 'nnamdi',
      bounces: t.bounces, t: st.t, day: st.day, trustDelta: merged ? 2 : -2
    });
  }

  /* ---------- scoring ---------- */
  function buildScore(o) {
    var hoursSpent = 0, wasted = 0, bounces = 0, testsSkipped = 0, convMiss = 0;
    var perTicket = [], calRows = [], ratios = [];
    st.tickets.forEach(function (t) {
      var tr = tt(t.id);
      hoursSpent += t.hoursSpent;
      bounces += t.bounces;
      if (tr.needsTests && !t.hasTests && t.status !== 'todo') testsSkipped++;
      if (tr.convention && t.convention && t.convention !== tr.convention) convMiss++;
      repo.actions.forEach(function (a) {
        var n = t.actionsUsed[a.id] || 0;
        var y = (tr.yields && tr.yields[a.id]) || 0;
        if (n && y < 0) wasted += (n * (a.minutes || 0)) / 60;
        if (n > 2 && y >= 0) wasted += ((n - 2) * (a.minutes || 0)) / 60 * 0.5;
      });
      var merged = t.status === 'merged';
      var verdict, note = tr.notes || '';
      if (merged) verdict = t.understanding >= RULES.correctAt ? 'merged, understood' : 'merged blind';
      else if (t.status === 'abandoned') verdict = tr.shouldAbandon ? 'handed back — right call' : 'handed back too soon';
      else if (t.hoursSpent > 0) verdict = t.understanding >= RULES.implementReadyAt ? 'unfinished' : 'sunk time, no answer';
      else verdict = 'never touched';
      perTicket.push({ id: t.id, merged: merged, understanding: Math.round(t.understanding),
                       hoursSpent: t.hoursSpent, estimate: t.estimateHours,
                       verdict: verdict, note: note, cause: tr.cause });
      if (num(t.estimateHours) && t.hoursSpent > 0) {
        ratios.push({ ticketId: t.id, est: t.estimateHours, actual: t.hoursSpent,
                      ratio: t.hoursSpent / t.estimateHours });
        calRows.push({ ticketId: t.id, est: t.estimateHours, actual: t.hoursSpent });
      }
    });

    var escalation = st.tickets.map(function (t) {
      var tr = tt(t.id);
      var rec = null;
      askRecords.forEach(function (r) { if (r.ticketId === t.id && !rec) rec = r; });
      var timebox = num(tr.timeboxHours) ? tr.timeboxHours : 1.5;
      if (!rec) return { ticketId: t.id, askedAtHours: null, timeboxHours: timebox, verdict: 'never' };
      var v = rec.classification === 'well-formed' ? 'right'
            : rec.classification === 'premature' ? 'early' : 'late';
      return { ticketId: t.id, askedAtHours: rec.atHours, timeboxHours: timebox, verdict: v };
    });
    var right = escalation.filter(function (e) { return e.verdict === 'right'; }).length;
    var escalationScore = escalation.length ? right / escalation.length : 0;

    var mergedIds = st.merged.slice();
    var mergedPoints = 0, totalPoints = 0;
    repo.tickets.forEach(function (x) {
      totalPoints += x.points || 0;
      if (mergedIds.indexOf(x.id) >= 0) mergedPoints += x.points || 0;
    });

    var meanRatio = ratios.length
      ? ratios.reduce(function (a, r) { return a + r.ratio; }, 0) / ratios.length : NaN;
    var worst = null;
    ratios.forEach(function (r) { if (!worst || r.ratio > worst.ratio) worst = r; });

    var trustFinal = {}, tsum = 0, tn = 0, biggest = null;
    repo.people.forEach(function (p) {
      var v = st.trust[p.id];
      trustFinal[p.id] = v; tsum += v; tn++;
      var d = v - (num(p.startTrust) ? p.startTrust : RULES.startTrust);
      if (!biggest || Math.abs(d) > Math.abs(biggest.delta)) biggest = { who: p.id, delta: d };
    });
    var avgTrust = tn ? tsum / tn : RULES.startTrust;

    var bestHours = num(truth.bestHours) ? truth.bestHours : 30;
    var efficiency = hoursSpent > 0 ? clamp(bestHours / hoursSpent, 0, 1) : 0;

    var blindMerges = perTicket.filter(function (p) {
      return p.merged && p.understanding < RULES.correctAt;
    }).map(function (p) { return p.id; });

    var raw = 0.5 * (totalPoints ? mergedPoints / totalPoints : 0) +
              0.3 * escalationScore +
              0.2 * clamp((avgTrust - 30) / 50, 0, 1);
    var grade = raw >= 0.82 ? 'A' : raw >= 0.66 ? 'B' : raw >= 0.48 ? 'C' : raw >= 0.3 ? 'D' : 'F';
    if ((avgTrust < 40 || blindMerges.length) && 'AB'.indexOf(grade) >= 0) grade = 'C';

    return {
      merged: mergedIds, mergedPoints: mergedPoints, totalPoints: totalPoints,
      hoursSpent: hoursSpent, wastedHours: wasted, bestHours: bestHours, efficiency: efficiency,
      escalation: escalation, escalationScore: escalationScore,
      bounces: bounces, testsSkipped: testsSkipped, conventionMisses: convMiss,
      calibration: { n: ratios.length, meanRatio: meanRatio,
                     worst: worst ? { ticketId: worst.ticketId, est: worst.est, actual: worst.actual } : null,
                     optimistic: num(meanRatio) ? meanRatio > 1 : undefined,
                     rows: calRows },
      trust: { final: trustFinal, avg: avgTrust, biggest: biggest },
      shippedBelowCorrect: blindMerges,
      grade: grade, perTicket: perTicket,
      paths: truth.bestPath || {},
      narrative: o.narrative, whatIdDoDifferently: o.whatIdDoDifferently
    };
  }

  function buildMarkdown() {
    var L = [];
    L.push('# Sprint retro — Thistle, Dispatch team');
    L.push('');
    L.push('| ticket | status | understanding | estimate | actual | bounces |');
    L.push('|---|---|---:|---:|---:|---:|');
    st.tickets.forEach(function (t) {
      L.push('| ' + t.id + ' | ' + t.status + ' | ' + Math.round(t.understanding) + ' | ' +
        (num(t.estimateHours) ? f1(t.estimateHours) + 'h' : '—') + ' | ' + f1(t.hoursSpent) + 'h | ' +
        t.bounces + ' |');
    });
    L.push('');
    L.push('## Every question I asked');
    if (!askRecords.length) L.push('- none');
    askRecords.forEach(function (r) {
      L.push('- ' + r.ticketId + ' → ' + r.to + ' at ' + f1(r.atHours) + 'h (' + r.classification + ')');
    });
    L.push('');
    L.push('Deepa\'s budget left unused: ' + f1(st.seniorLeft) + 'h of ' + f1(RULES.seniorBudgetHours) + 'h.');
    return L.join('\n');
  }

  window.Dev = Dev;

  /* ================================================================== */
  /* MOCK Board — plain canvas drawings, degenerate-input safe.          */
  /* ================================================================== */
  var PAL = { bg: '#0d1117', panel: '#161b22', border: '#30363d', text: '#c9d1d9',
              dim: '#8b949e', good: '#3fb950', bad: '#f85149', warn: '#d29922',
              accent: '#39c5cf', violet: '#a371f7' };

  function Board_create(canvas, opts) {
    var api = {};
    var ctx = canvas && canvas.getContext ? canvas.getContext('2d') : null;
    var W = 0, Hh = 0;

    function fit() {
      if (!canvas || !ctx) return false;
      var dpr = window.devicePixelRatio || 1;
      var r = canvas.getBoundingClientRect();
      W = Math.max(10, Math.round(r.width));
      Hh = Math.max(10, Math.round(r.height));
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(Hh * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return true;
    }
    function clear() {
      if (!fit()) return false;
      ctx.fillStyle = '#11161d';
      ctx.fillRect(0, 0, W, Hh);
      ctx.font = '10px ui-monospace, Menlo, monospace';
      ctx.textBaseline = 'middle';
      return true;
    }
    function txt(s, x, y, col, size, align) {
      ctx.fillStyle = col || PAL.dim;
      ctx.font = (size || 10) + 'px ui-monospace, Menlo, monospace';
      ctx.textAlign = align || 'left';
      ctx.fillText(String(s), x, y);
      ctx.textAlign = 'left';
    }

    api.resize = function () { return true; };

    api.understanding = function (o) {
      if (!clear()) return;
      o = o || {};
      var hist = Array.isArray(o.history) ? o.history.filter(function (p) {
        return p && isFinite(p.h) && isFinite(p.u);
      }) : [];
      var impl = isFinite(o.implementReadyAt) ? o.implementReadyAt : 70;
      var corr = isFinite(o.correctAt) ? o.correctAt : 90;
      var L = 42, R = 12, T = 18, B = 24;
      var pw = Math.max(10, W - L - R), ph = Math.max(10, Hh - T - B);
      var maxH = 1;
      hist.forEach(function (p) { if (p.h > maxH) maxH = p.h; });
      maxH = Math.max(1, Math.ceil(maxH));
      function X(hh) { return L + (hh / maxH) * pw; }
      function Y(u) { return T + ph - (clamp(u, 0, 100) / 100) * ph; }

      ctx.strokeStyle = '#232b35'; ctx.lineWidth = 1;
      [0, 25, 50, 75, 100].forEach(function (g) {
        ctx.beginPath(); ctx.moveTo(L, Y(g)); ctx.lineTo(L + pw, Y(g)); ctx.stroke();
        txt(g, L - 6, Y(g), PAL.dim, 9, 'right');
      });
      [[impl, PAL.warn, 'implement ' + impl], [corr, PAL.good, 'review ' + corr]].forEach(function (r) {
        ctx.strokeStyle = r[1]; ctx.setLineDash([4, 3]);
        ctx.beginPath(); ctx.moveTo(L, Y(r[0])); ctx.lineTo(L + pw, Y(r[0])); ctx.stroke();
        ctx.setLineDash([]);
        txt(r[2], L + pw - 4, Y(r[0]) - 7, r[1], 9, 'right');
      });

      if (hist.length > 1) {
        ctx.strokeStyle = PAL.accent; ctx.lineWidth = 1.8;
        ctx.beginPath();
        hist.forEach(function (p, i) { if (i) ctx.lineTo(X(p.h), Y(p.u)); else ctx.moveTo(X(p.h), Y(p.u)); });
        ctx.stroke();
        var last = hist[hist.length - 1];
        ctx.fillStyle = PAL.accent;
        ctx.beginPath(); ctx.arc(X(last.h), Y(last.u), 3, 0, Math.PI * 2); ctx.fill();
      } else {
        txt('no hours on this ticket yet', L + pw / 2, T + ph / 2, PAL.dim, 11, 'center');
      }
      (o.asks || []).forEach(function (a) {
        if (!isFinite(a.atHours)) return;
        ctx.strokeStyle = PAL.violet; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(X(a.atHours), T); ctx.lineTo(X(a.atHours), T + ph); ctx.stroke();
      });
      txt('hours on ' + ((o.ticket && o.ticket.id) || 'ticket'), L, Hh - 9, PAL.dim, 9);
      txt(maxH + 'h', L + pw, Hh - 9, PAL.dim, 9, 'right');
    };

    api.timeline = function (o) {
      if (!clear()) return;
      o = o || {};
      var tk = Array.isArray(o.tickets) ? o.tickets : [];
      var days = isFinite(o.totalDays) ? o.totalDays : 10;
      var hpd = isFinite(o.hoursPerDay) ? o.hoursPerDay : 6;
      var total = Math.max(1, days * hpd);
      var L = 82, R = 8, T = 16, B = 16;
      var pw = Math.max(10, W - L - R);
      var lane = tk.length ? Math.min(26, (Hh - T - B) / tk.length) : 20;
      for (var d = 0; d <= days; d++) {
        var x = L + (d * hpd / total) * pw;
        ctx.strokeStyle = '#1e2530';
        ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, Hh - B); ctx.stroke();
        if (d < days) txt('D' + (d + 1), x + 2, T - 7, PAL.dim, 8);
      }
      tk.forEach(function (t, i) {
        var y = T + i * lane;
        txt(t.id || '', 4, y + lane / 2, PAL.text, 9);
        ctx.fillStyle = '#151b23';
        ctx.fillRect(L, y + 2, pw, Math.max(6, lane - 6));
        var cursor = 0;
        (t.segments || []).forEach(function (s) {
          var w = ((s.minutes || 0) / 60 / total) * pw;
          var col = s.kind === 'ask' ? PAL.violet : (s.gained < 0 ? PAL.bad : (s.color || PAL.accent));
          ctx.fillStyle = col;
          ctx.fillRect(L + (cursor / total) * pw, y + 2, Math.max(1.5, w), Math.max(6, lane - 6));
          cursor += (s.minutes || 0) / 60;
        });
      });
      if (!tk.length) txt('nothing on the board', W / 2, Hh / 2, PAL.dim, 11, 'center');
    };

    api.burn = function (o) {
      if (!clear()) return;
      o = o || {};
      var total = isFinite(o.totalPoints) ? o.totalPoints : (isFinite(o.points) ? o.points : 0);
      var done = isFinite(o.mergedPoints) ? o.mergedPoints : 0;
      var days = isFinite(o.totalDays) ? o.totalDays : 10;
      var day = isFinite(o.day) ? o.day : 1;
      var L = 32, R = 12, T = 16, B = 20;
      var pw = Math.max(10, W - L - R), ph = Math.max(10, Hh - T - B);
      ctx.strokeStyle = '#232b35';
      ctx.beginPath(); ctx.moveTo(L, T); ctx.lineTo(L, T + ph); ctx.lineTo(L + pw, T + ph); ctx.stroke();
      ctx.strokeStyle = PAL.dim; ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(L, T + ph); ctx.lineTo(L + pw, T); ctx.stroke();
      ctx.setLineDash([]);
      var x = L + (clamp(day / days, 0, 1)) * pw;
      var y = T + ph - (total > 0 ? clamp(done / total, 0, 1) : 0) * ph;
      ctx.strokeStyle = PAL.good; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(L, T + ph); ctx.lineTo(x, y); ctx.stroke();
      ctx.fillStyle = PAL.good;
      ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.fill();
      txt(done + ' / ' + total + ' pts', L + 6, T + 8, PAL.text, 10);
      txt('day ' + day + ' of ' + days, L + pw, Hh - 8, PAL.dim, 9, 'right');
    };

    api.trust = function (o) {
      if (!clear()) return;
      var ppl = (o && Array.isArray(o.people)) ? o.people : [];
      if (!ppl.length) { txt('no people', W / 2, Hh / 2, PAL.dim, 11, 'center'); return; }
      var L = 96, R = 46, T = 14;
      var lane = Math.min(34, (Hh - T * 2) / ppl.length);
      ppl.forEach(function (p, i) {
        var y = T + i * lane + lane / 2;
        txt(p.name || p.id, 6, y, PAL.text, 10);
        var w = Math.max(10, W - L - R);
        ctx.fillStyle = '#0b0f14'; ctx.fillRect(L, y - 5, w, 10);
        var v = isFinite(p.trust) ? p.trust : 0;
        ctx.fillStyle = v < 40 ? PAL.bad : v < 55 ? PAL.warn : PAL.good;
        ctx.fillRect(L, y - 5, w * clamp(v / 100, 0, 1), 10);
        var s = isFinite(p.start) ? p.start : 55;
        ctx.strokeStyle = PAL.dim;
        ctx.beginPath(); ctx.moveTo(L + w * clamp(s / 100, 0, 1), y - 7);
        ctx.lineTo(L + w * clamp(s / 100, 0, 1), y + 7); ctx.stroke();
        txt(Math.round(v), W - 6, y, PAL.text, 11, 'right');
      });
    };

    api.truth = function (o) {
      if (!clear()) return;
      o = o || {};
      var pt = Array.isArray(o.perTicket) ? o.perTicket : [];
      var paths = o.paths || {};
      if (!pt.length) { txt('no per-ticket truth', W / 2, Hh / 2, PAL.dim, 11, 'center'); return; }
      var L = 108, R = 10, T = 22;
      var lane = Math.min(78, (Hh - T - 12) / pt.length);
      txt('YOUR ROUTE (top) vs AN EFFICIENT ROUTE (bottom)', L, 11, PAL.dim, 9);
      pt.forEach(function (p, i) {
        var y = T + i * lane;
        txt(p.id || '', 6, y + 10, PAL.text, 10);
        txt((p.merged ? 'merged' : 'not merged'), 6, y + 24, p.merged ? PAL.good : PAL.dim, 9);
        var w = Math.max(20, W - L - R);
        var taken = Array.isArray(p.route) ? p.route : [];
        var cursor = 0, span = 0;
        taken.forEach(function (s) { span += (s.minutes || 0) / 60; });
        span = Math.max(span, 1);
        taken.forEach(function (s) {
          var sw = ((s.minutes || 0) / 60 / span) * w;
          ctx.fillStyle = s.kind === 'ask' ? PAL.violet : (s.gained < 0 ? PAL.bad : (s.color || PAL.accent));
          ctx.fillRect(L + (cursor / span) * w, y + 3, Math.max(2, sw), 13);
          cursor += (s.minutes || 0) / 60;
        });
        if (!taken.length) txt('never touched', L, y + 10, PAL.dim, 9);
        var best = paths[p.id] || [];
        var bw = best.length ? w / best.length : w;
        best.forEach(function (aid, k) {
          ctx.fillStyle = aid.indexOf('ask') === 0 ? PAL.violet : PAL.good;
          ctx.globalAlpha = 0.55;
          ctx.fillRect(L + k * bw, y + 22, Math.max(2, bw - 2), 11);
          ctx.globalAlpha = 1;
          txt(aid, L + k * bw + 2, y + 27.5, '#0d1117', 8);
        });
        ctx.strokeStyle = '#1e2530';
        ctx.beginPath(); ctx.moveTo(6, y + lane - 4); ctx.lineTo(W - 6, y + lane - 4); ctx.stroke();
      });
    };

    return api;
  }

  window.Board = { create: Board_create };

  /* ================================================================== */
  /* MOCK Squad                                                         */
  /* ================================================================== */
  var feed = [], fired = {}, onMessage = null, sRepo = null;

  window.Squad = {
    GATES: [
      { day: 1,  id: 'kickoff',  title: 'Sprint kickoff',
        prompt: 'Post your plan for the sprint and your estimates to the team in chat.' },
      { day: 3,  id: 'standup',  title: 'Standup',
        prompt: 'Yesterday, today, and blockers. Be honest about the blockers.' },
      { day: 6,  id: 'oneonone', title: '1:1 with Tobias',
        prompt: 'Tobias wants to know how it\'s going, and what you\'d want more of.' },
      { day: 10, id: 'retro',    title: 'Sprint retro',
        prompt: 'Paste your retro into chat and walk the team through the sprint.' }
    ],
    init: function (o) {
      sRepo = (o && o.repo) || window.SIM_REPO;
      feed = []; fired = {};
      onMessage = (o && o.onMessage) || null;
    },
    tick: function (state) {
      if (!sRepo || !state) return;
      (sRepo.events || []).forEach(function (e) {
        if (fired['ev:' + e.id]) return;
        if (state.day > e.day || (state.day === e.day && state.hour >= e.hour)) {
          fired['ev:' + e.id] = true;
          push({ id: e.id, day: state.day, hour: state.hour, t: state.t, from: e.from,
                 name: e.name, text: e.text, tone: e.tone, needsReply: e.needsReply });
        }
      });
      if (state.stuckOn && !fired['stuck:' + state.stuckOn]) {
        fired['stuck:' + state.stuckOn] = true;
        push({ id: 'stuck:' + state.stuckOn, t: state.t, day: state.day, from: 'LEAD',
               name: 'Tobias Lindqvist', tone: 'warn',
               text: 'You have been on ' + state.stuckOn + ' a while with nothing moving. I am not asking ' +
                     'you to be faster — I am asking you to say it out loud sooner. Silent and stuck is the ' +
                     'only thing I actually mind.' });
      }
      if (state.seniorLeft <= 2 && !fired.budget) {
        fired.budget = true;
        push({ id: 'budget', t: state.t, day: state.day, from: 'MENTOR', name: 'Deepa Iyer', tone: 'warn',
               text: 'Heads up, we are down to about two hours of me for the rest of the sprint. Save them ' +
                     'for the things that only exist in my head.' });
      }
    },
    getFeed: function () { return feed.slice(); }
  };

  function push(m) {
    feed.push(m);
    if (onMessage) { try { onMessage(m); } catch (e) {} }
  }

})();
