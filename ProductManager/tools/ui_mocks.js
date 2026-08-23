/* ============================================================================
   tools/ui_mocks.js — FAKE Product / Viz / Org for UI development only.
   Loaded by tools/ui_preview.html INSTEAD of sim/product.js, sim/viz.js and
   sim/org.js. Conforms to the public APIs in SPEC.md §2–§4 closely enough to
   exercise every screen in sim/ui.js. Nothing here ships.

   The mock Product plays the role product.js plays, so it is the one module
   allowed to read SIM_CO.reveal() — it does so to produce plausible biased
   readings and a plausible score. sim/ui.js never touches it.
   ============================================================================ */
(function () {
  'use strict';

  /* ---------------------------------------------------------------- */
  /* seeded PRNG                                                       */
  /* ---------------------------------------------------------------- */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gauss(rnd) {
    var u = 0, v = 0;
    while (u === 0) u = rnd();
    while (v === 0) v = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  function hash(s) {
    var hh = 2166136261;
    for (var i = 0; i < s.length; i++) { hh ^= s.charCodeAt(i); hh = Math.imul(hh, 16777619); }
    return (hh >>> 0);
  }

  /* ================================================================ */
  /* MOCK PRODUCT                                                      */
  /* ================================================================ */
  var RULES = {
    weeks: 12, workDays: 60, engWeeksPerWeek: 4, totalCapacity: 48,
    researchSlots: 2, startTrust: 60, minTrust: 0, maxTrust: 100,
    trustHitForNo: 12, trustGainForYes: 8, lowTrustEng: 40, lowTrustCeo: 35,
    highTrustFavour: 75, slipWarnAt: 0.6, minRationaleChars: 20
  };

  var co = null, truth = null, rnd = null, timer = null, speed = 4;
  var listeners = {};
  var st = null;
  var forecasts = {}, instrumentUse = {}, slipSeen = {}, answeredEvents = {};

  function emit(evt, payload) {
    (listeners[evt] || []).forEach(function (fn) {
      try { fn(payload); } catch (e) { console.error('[mock] listener for ' + evt + ' threw', e); }
    });
  }

  function tOf(day) {
    var w = Math.floor((day - 1) / 5) + 1;
    var d = ((day - 1) % 5) + 1;
    return 'W' + w + ' D' + d;
  }

  function fresh() {
    var trust = {};
    (co.stakeholders || []).forEach(function (s) { trust[s.id] = s.startTrust || RULES.startTrust; });
    return {
      day: 1, week: 1, t: tOf(1),
      capacityUsed: 0, capacityLeft: RULES.totalCapacity,
      roadmap: [], shipped: [],
      research: { running: [], done: [] },
      trust: trust, avgTrust: 60,
      northStarProjected: (co.scenario.northStar && co.scenario.northStar.baseline) || 31.4,
      openEvents: [], finished: false, qbrSubmitted: false
    };
  }

  function estOf(fid) {
    var f = (co.features || []).filter(function (x) { return x.id === fid; })[0];
    return f && typeof f.estCost === 'number' ? f.estCost : 5;
  }
  function trueCostOf(fid) {
    return (truth && truth.trueCost && truth.trueCost[fid]) || estOf(fid) * 1.4;
  }
  function trueImpactOf(fid) {
    if (truth && truth.impact && typeof truth.impact[fid] === 'number') return truth.impact[fid];
    return ((hash(fid) % 400) / 100) - 0.5;
  }
  function tagsOf(fid) {
    var f = (co.features || []).filter(function (x) { return x.id === fid; })[0];
    return (f && f.tags) || [];
  }

  function recompute() {
    var ids = Object.keys(st.trust);
    var sum = 0;
    ids.forEach(function (k) { sum += st.trust[k]; });
    st.avgTrust = ids.length ? Math.round(sum / ids.length) : 60;
    /* eng-weeks still BUYABLE this quarter: the calendar takes them whether you
       spend them or not, which is what makes over-committing lethal */
    st.capacityLeft = Math.max(0, Math.round(
      (RULES.workDays - st.day + 1) * (RULES.engWeeksPerWeek / 5) * 10) / 10);
    st.t = tOf(st.day);
    st.week = Math.floor((st.day - 1) / 5) + 1;
  }

  function bumpTrust(who, delta, reason) {
    if (!(who in st.trust)) return;
    st.trust[who] = Math.max(0, Math.min(100, st.trust[who] + delta));
    emit('trust', { who: who, delta: delta, value: st.trust[who], reason: reason || '' });
  }

  var MockProduct = {
    RULES: RULES,

    init: function (opt) {
      opt = opt || {};
      co = opt.co || window.SIM_CO;
      rnd = mulberry32(opt.seed || 20260816);
      try { truth = co.reveal(); } catch (e) { truth = null; }
      listeners = {};
      forecasts = {}; instrumentUse = {}; slipSeen = {}; answeredEvents = {};
      st = fresh();
      recompute();
      return st;
    },

    getState: function () {
      /* hand out a shallow-ish copy so the UI cannot mutate engine state */
      return {
        day: st.day, week: st.week, t: st.t,
        capacityUsed: st.capacityUsed, capacityLeft: st.capacityLeft,
        roadmap: st.roadmap.map(function (r) {
          return { featureId: r.featureId, status: r.status, progress: r.progress,
                   engWeeksSpent: r.engWeeksSpent, revisedEstimate: r.revisedEstimate,
                   predictedImpact: r.predictedImpact, locked: r.locked };
        }),
        shipped: st.shipped.slice(),
        research: {
          running: st.research.running.map(function (a) {
            return { featureId: a.featureId, instrumentId: a.instrumentId,
                     days: a.days, daysLeft: a.daysLeft, progress: 1 - a.daysLeft / a.days };
          }),
          done: st.research.done.slice()
        },
        trust: JSON.parse(JSON.stringify(st.trust)),
        avgTrust: st.avgTrust,
        northStarProjected: st.northStarProjected,
        openEvents: st.openEvents.slice(),
        finished: st.finished,
        qbrSubmitted: st.qbrSubmitted
      };
    },

    research: function (o) {
      o = o || {};
      if (st.finished) return { ok: false, error: 'The quarter is over' };
      var inst = (co.instruments || []).filter(function (x) { return x.id === o.instrumentId; })[0];
      if (!inst) return { ok: false, error: 'No such instrument' };
      if (inst.requiresShipped && st.shipped.indexOf(o.featureId) < 0) {
        return { ok: false, error: 'You can only A/B test something that has shipped' };
      }
      if (st.research.running.length >= RULES.researchSlots) {
        return { ok: false, error: 'No free research slots' };
      }
      var dupe = st.research.running.some(function (a) {
        return a.featureId === o.featureId && a.instrumentId === o.instrumentId;
      });
      if (dupe) return { ok: false, error: 'That research is already running' };
      var act = { featureId: o.featureId, instrumentId: o.instrumentId,
                  days: inst.days || 1, daysLeft: inst.days || 1, startDay: st.day };
      st.research.running.push(act);
      instrumentUse[o.instrumentId] = (instrumentUse[o.instrumentId] || 0) + 1;
      return { ok: true, activity: act };
    },

    commit: function (o) {
      o = o || {};
      if (st.finished) return { ok: false, error: 'The quarter is over' };
      if (typeof o.predictedImpact !== 'number' || !isFinite(o.predictedImpact)) {
        return { ok: false, error: 'Predicted impact required' };
      }
      if (!o.rationale || String(o.rationale).trim().length < RULES.minRationaleChars) {
        return { ok: false, error: 'Rationale required' };
      }
      var existing = st.roadmap.filter(function (r) { return r.featureId === o.featureId; })[0];
      if (existing && existing.status !== 'dropped') return { ok: false, error: 'Already on the roadmap' };
      if (existing) {
        existing.status = 'queued';
        existing.predictedImpact = o.predictedImpact;
      } else {
        st.roadmap.push({ featureId: o.featureId, status: 'queued', progress: 0,
                          engWeeksSpent: 0, revisedEstimate: null,
                          predictedImpact: o.predictedImpact });
      }
      forecasts[o.featureId] = { predictedImpact: o.predictedImpact, rationale: o.rationale, day: st.day };
      return { ok: true };
    },

    drop: function (fid) {
      var r = st.roadmap.filter(function (x) { return x.featureId === fid; })[0];
      if (!r) return { ok: false, error: 'Not on the roadmap' };
      if (r.status === 'shipped') return { ok: false, error: "That feature already shipped — you can't drop it" };
      if (r.locked) return { ok: false, error: 'The CEO inserted this one — you cannot drop it yet' };
      r.status = 'dropped';
      (co.stakeholders || []).forEach(function (s) {
        if ((s.favors || []).indexOf(fid) >= 0) bumpTrust(s.id, -RULES.trustHitForNo, 'you dropped something they championed');
      });
      recompute();
      return { ok: true };
    },

    setRoadmap: function (order) {
      if (!Array.isArray(order)) return { ok: false, error: 'setRoadmap wants an array of feature ids' };
      var seen = {}, next = [];
      order.forEach(function (fid) {
        var r = st.roadmap.filter(function (x) { return x.featureId === fid; })[0];
        if (r && !seen[fid]) { seen[fid] = 1; next.push(r); }
      });
      st.roadmap.forEach(function (r) { if (!seen[r.featureId]) next.push(r); });
      /* started work keeps its place */
      next.sort(function (a, b) {
        var rank = function (x) { return x.status === 'shipped' ? 0 : x.status === 'building' ? 1 : 2; };
        return rank(a) - rank(b);
      });
      st.roadmap = next;
      return { ok: true };
    },

    respond: function (o) {
      o = o || {};
      var idx = -1;
      st.openEvents.forEach(function (e, i) { if (e.id === o.eventId) idx = i; });
      if (idx < 0) return { ok: false, error: 'No such open escalation' };
      var ev = st.openEvents[idx];
      st.openEvents.splice(idx, 1);
      answeredEvents[ev.id] = o.choice;
      var who = { CEO: 'marguerite', SALES: 'dan', ENG: 'rina', DESIGN: 'kofi', SUPPORT: 'tomas' }[ev.from];
      if (who) bumpTrust(who, o.choice === 'commit' ? 6 : (o.choice === 'decline' ? -4 : 0), 'you answered');
      recompute();
      return { ok: true };
    },

    step: function () { return MockProduct.advance(1); },

    advance: function (days) {
      days = days || 1;
      for (var i = 0; i < days && !st.finished; i++) oneDay();
      return st;
    },

    start: function () {
      if (timer) return;
      timer = setInterval(function () {
        if (st.finished) { MockProduct.pause(); return; }
        oneDay();
      }, Math.max(80, 900 / speed));
    },
    pause: function () { if (timer) { clearInterval(timer); timer = null; } },
    setSpeed: function (m) {
      speed = m || 4;
      if (timer) { MockProduct.pause(); MockProduct.start(); }
    },
    destroy: function () { MockProduct.pause(); listeners = {}; },

    on: function (evt, fn) {
      (listeners[evt] = listeners[evt] || []).push(fn);
      return function () {
        listeners[evt] = (listeners[evt] || []).filter(function (f) { return f !== fn; });
      };
    },

    submitQBR: function (o) {
      o = o || {};
      if (st.qbrSubmitted) return { ok: false, error: 'Already submitted' };
      if (typeof o.claimedImpact !== 'number' || !isFinite(o.claimedImpact)) {
        return { ok: false, error: 'Claimed impact required' };
      }
      st.qbrSubmitted = true;
      st.narrative = o.narrative || '';
      st.claimedImpact = o.claimedImpact;
      return buildScore();
    },

    exportQBR: function () { return buildMarkdown(); }
  };

  function oneDay() {
    st.day += 1;
    if (st.day > RULES.workDays) { st.day = RULES.workDays; finish(); return; }
    recompute();

    /* research */
    var stillRunning = [];
    st.research.running.forEach(function (a) {
      a.daysLeft -= 1;
      if (a.daysLeft <= 0) {
        var reading = makeReading(a.featureId, a.instrumentId);
        st.research.done.push(reading);
        emit('reading', reading);
      } else stillRunning.push(a);
    });
    st.research.running = stillRunning;

    /* build */
    var perDay = RULES.engWeeksPerWeek / 5;
    var budget = perDay;
    for (var i = 0; i < st.roadmap.length && budget > 0.0001; i++) {
      var r = st.roadmap[i];
      if (r.status !== 'queued' && r.status !== 'building') continue;
      if (st.capacityLeft <= 0) break;
      r.status = 'building';
      var tc = trueCostOf(r.featureId);
      var take = Math.min(budget, tc - r.engWeeksSpent, st.capacityLeft);
      r.engWeeksSpent += take;
      st.capacityUsed += take;
      budget -= take;
      recompute();
      r.progress = Math.min(1, r.engWeeksSpent / tc);

      var est = estOf(r.featureId);
      if (!slipSeen[r.featureId] && r.engWeeksSpent >= est * RULES.slipWarnAt && tc > est) {
        slipSeen[r.featureId] = 1;
        r.revisedEstimate = Math.round(tc * 10) / 10;
        emit('slip', { featureId: r.featureId, estimate: est, revisedEstimate: r.revisedEstimate });
      }
      if (r.engWeeksSpent >= tc - 0.0001) {
        r.status = 'shipped';
        r.progress = 1;
        st.shipped.push(r.featureId);
        (co.stakeholders || []).forEach(function (s) {
          if ((s.favors || []).indexOf(r.featureId) >= 0) bumpTrust(s.id, RULES.trustGainForYes, 'you shipped what they wanted');
        });
        emit('ship', { featureId: r.featureId });
      }
    }

    /* north star, measured with noise until the end */
    var base = (co.scenario.northStar && co.scenario.northStar.baseline) || 31.4;
    var real = base;
    st.shipped.forEach(function (fid) { real += trueImpactOf(fid); });
    (truth && truth.interactions || []).forEach(function (ix) {
      if (ix.pair.every(function (p) { return st.shipped.indexOf(p) >= 0; })) real += ix.delta;
    });
    st.northStarProjected = Math.round((real + gauss(rnd) * 0.45) * 10) / 10;

    /* scripted escalations become open events */
    (co.events || []).forEach(function (ev) {
      if (!ev.needsReply || answeredEvents[ev.id]) return;
      var evDay = (ev.week - 1) * 5 + (ev.day || 1);
      if (st.day === evDay) {
        st.openEvents.push(ev);
        emit('event', ev);
      }
    });

    recompute();
    emit('tick', MockProduct.getState());
    if (st.day >= RULES.workDays) finish();
  }

  function finish() {
    if (st.finished) return;
    st.finished = true;
    MockProduct.pause();
    recompute();
    emit('quarterEnd', MockProduct.getState());
  }

  function makeReading(fid, iid) {
    var v = trueImpactOf(fid);
    var bias = (truth && truth.bias && truth.bias[iid]) || { _noise: 1.2 };
    tagsOf(fid).forEach(function (t) { if (typeof bias[t] === 'number') v += bias[t]; });
    v += gauss(rnd) * (bias._noise || 1);
    return {
      featureId: fid, instrumentId: iid,
      value: Math.round(v * 10) / 10,
      day: st.day, t: tOf(st.day)
    };
  }

  function buildScore() {
    var base = (co.scenario.northStar && co.scenario.northStar.baseline) || 31.4;
    var actual = base;
    st.shipped.forEach(function (fid) { actual += trueImpactOf(fid); });
    (truth && truth.interactions || []).forEach(function (ix) {
      if (ix.pair.every(function (p) { return st.shipped.indexOf(p) >= 0; })) actual += ix.delta;
    });
    actual = Math.round(actual * 10) / 10;
    var delta = Math.round((actual - base) * 10) / 10;
    var best = (truth && truth.bestValue) || 13.4;
    var bestSet = (truth && truth.bestSet) || [];
    var regret = Math.max(0, Math.round((best - delta) * 100) / 100);
    var ratio = best > 0 ? regret / best : 1;
    var grade = ratio < 0.10 ? 'A' : ratio < 0.25 ? 'B' : ratio < 0.45 ? 'C' : ratio < 0.70 ? 'D' : 'F';

    var wasted = 0;
    st.roadmap.forEach(function (r) {
      if (r.status !== 'shipped') wasted += r.engWeeksSpent || 0;
    });
    wasted = Math.round(wasted * 10) / 10;

    var vanity = st.shipped.filter(function (fid) { return trueImpactOf(fid) < 0.5; });
    var missed = bestSet.filter(function (fid) { return st.shipped.indexOf(fid) < 0; });

    if (vanity.length >= 2 && 'AB'.indexOf(grade) >= 0) grade = 'C';
    if (st.avgTrust < 40 && 'AB'.indexOf(grade) >= 0) grade = 'C';

    var perFeature = (co.features || []).map(function (f) {
      var fc = forecasts[f.id];
      var tv = trueImpactOf(f.id);
      var shippedIt = st.shipped.indexOf(f.id) >= 0;
      var verdict;
      if (shippedIt && tv < 0.5) verdict = 'vanity — shipped, worth nothing';
      else if (shippedIt && tv >= 2) verdict = 'real win, correctly called';
      else if (shippedIt) verdict = 'shipped, modest';
      else if (bestSet.indexOf(f.id) >= 0) verdict = 'missed win — it was in the best set';
      else if ((st.roadmap.filter(function (r) { return r.featureId === f.id; })[0] || {}).engWeeksSpent > 0)
        verdict = 'half-built, worth zero';
      else verdict = 'correctly left alone';
      /* what the instruments told you, averaged — NOT your forecast */
      var rs = st.research.done.filter(function (r) { return r.featureId === f.id; });
      var believed = rs.length
        ? Math.round((rs.reduce(function (a, r) { return a + r.value; }, 0) / rs.length) * 100) / 100
        : null;
      return {
        id: f.id,
        name: f.name,
        believed: believed,
        predicted: fc ? fc.predictedImpact : null,
        truth: tv,
        shipped: shippedIt,
        verdict: verdict
      };
    });

    var withF = perFeature.filter(function (p) { return typeof p.predicted === 'number'; });
    var errs = withF.map(function (p) { return p.predicted - p.truth; });
    var mae = errs.length ? errs.reduce(function (a, b) { return a + Math.abs(b); }, 0) / errs.length : 0;
    var bias = errs.length ? errs.reduce(function (a, b) { return a + b; }, 0) / errs.length : 0;
    var hits = errs.filter(function (e) { return Math.abs(e) <= 1.0; }).length;

    var lost = Object.keys(st.trust).filter(function (k) { return st.trust[k] < 45; });

    return {
      shippedSet: st.shipped.slice(),
      northStarActual: actual,
      delta: delta,
      bestPossible: best,
      bestSet: bestSet,
      regret: regret,
      grade: grade,
      wastedCapacity: wasted,
      vanityShipped: vanity,
      missedWins: missed,
      trust: { final: JSON.parse(JSON.stringify(st.trust)), avg: st.avgTrust, lost: lost },
      calibration: {
        n: withF.length,
        hitRate: withF.length ? hits / withF.length : 0,
        meanAbsError: Math.round(mae * 100) / 100,
        bias: Math.round(bias * 100) / 100,
        overconfident: bias > 0.5
      },
      instrumentUse: JSON.parse(JSON.stringify(instrumentUse)),
      perFeature: perFeature
    };
  }

  function buildMarkdown() {
    var L = [];
    var nm = function (fid) {
      var f = (co.features || []).filter(function (x) { return x.id === fid; })[0];
      return f ? f.name : fid;
    };
    L.push('# QBR — ' + co.scenario.company + ', ' + co.scenario.northStar.name);
    L.push('');
    L.push('## Narrative');
    L.push(st.narrative || '(none)');
    L.push('');
    L.push('**Claimed impact:** ' + (st.claimedImpact === undefined ? '—' : st.claimedImpact) + ' pp');
    L.push('');
    L.push('## What shipped');
    if (!st.shipped.length) L.push('- nothing');
    st.shipped.forEach(function (fid) { L.push('- ' + nm(fid)); });
    L.push('');
    L.push('## What slipped');
    st.roadmap.forEach(function (r) {
      if (r.revisedEstimate) {
        L.push('- ' + nm(r.featureId) + ': estimated ' + estOf(r.featureId) +
               ' ew, revised to ' + r.revisedEstimate + ' ew');
      }
    });
    L.push('');
    L.push('## Research readings');
    L.push('| feature | instrument | reading | day |');
    L.push('|---|---|---:|---:|');
    st.research.done.forEach(function (r) {
      L.push('| ' + nm(r.featureId) + ' | ' + r.instrumentId + ' | ' + r.value + ' | ' + r.day + ' |');
    });
    L.push('');
    L.push('## Predicted vs shipped');
    L.push('| feature | predicted | shipped | rationale |');
    L.push('|---|---:|---|---|');
    Object.keys(forecasts).forEach(function (fid) {
      L.push('| ' + nm(fid) + ' | ' + forecasts[fid].predictedImpact + ' | ' +
        (st.shipped.indexOf(fid) >= 0 ? 'yes' : 'no') + ' | ' +
        String(forecasts[fid].rationale).replace(/\|/g, '/') + ' |');
    });
    L.push('');
    L.push('## Capacity');
    L.push('- spent ' + st.capacityUsed.toFixed(1) + ' of ' + RULES.totalCapacity + ' eng-weeks');
    L.push('');
    L.push('## Trust ledger');
    (co.stakeholders || []).forEach(function (s) {
      L.push('- ' + s.name + ' (' + s.role + '): ' + st.trust[s.id]);
    });
    L.push('');
    L.push('_(mock exportQBR — no ground truth in here)_');
    return L.join('\n');
  }

  window.Product = MockProduct;

  /* ================================================================ */
  /* MOCK VIZ                                                          */
  /* ================================================================ */
  var C = {
    bg: '#11161d', panel: '#161b22', border: '#30363d', text: '#c9d1d9',
    dim: '#8b949e', green: '#3fb950', red: '#f85149', amber: '#d29922', cyan: '#39c5cf'
  };

  function VizInstance(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.last = null;
    this.resize();
  }
  VizInstance.prototype.resize = function () {
    var c = this.canvas;
    var dpr = window.devicePixelRatio || 1;
    var w = c.clientWidth || c.parentNode.clientWidth || 300;
    var hgt = c.clientHeight || c.parentNode.clientHeight || 200;
    c.width = Math.max(1, Math.round(w * dpr));
    c.height = Math.max(1, Math.round(hgt * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.W = w; this.H = hgt;
    if (this.last) this[this.last.m](this.last.a);
  };
  VizInstance.prototype._begin = function (m, a) {
    this.last = { m: m, a: a };
    var g = this.ctx;
    if (this.canvas.clientWidth !== this.W || this.canvas.clientHeight !== this.H) {
      this.last = null; this.resize(); this.last = { m: m, a: a };
    }
    g.clearRect(0, 0, this.W, this.H);
    g.fillStyle = C.bg;
    g.fillRect(0, 0, this.W, this.H);
    g.font = '10px ui-monospace, Menlo, monospace';
    g.textBaseline = 'middle';
    return g;
  };

  VizInstance.prototype.evidence = function (a) {
    var g = this._begin('evidence', a);
    var rows = (a && a.rows) || [];
    var L = 118, R = this.W - 14, T = 20, B = this.H - 18;
    var lo = -3, hi = 8;
    rows.forEach(function (r) {
      (r.readings || []).forEach(function (d) {
        if (typeof d.value === 'number') { lo = Math.min(lo, d.value - 1); hi = Math.max(hi, d.value + 1); }
      });
    });
    var x = function (v) { return L + ((v - lo) / (hi - lo)) * (R - L); };
    /* axis */
    g.strokeStyle = C.border; g.lineWidth = 1;
    g.beginPath(); g.moveTo(L, T - 6); g.lineTo(L, B); g.stroke();
    for (var t = Math.ceil(lo); t <= hi; t += 2) {
      g.strokeStyle = t === 0 ? '#3d4753' : '#1c222b';
      g.beginPath(); g.moveTo(x(t), T - 4); g.lineTo(x(t), B); g.stroke();
      g.fillStyle = C.dim; g.textAlign = 'center';
      g.fillText(String(t), x(t), B + 8);
    }
    var rh = rows.length ? Math.min(30, (B - T) / rows.length) : 20;
    rows.forEach(function (r, i) {
      var y = T + i * rh + rh / 2;
      g.fillStyle = C.text; g.textAlign = 'right';
      g.fillText(String(r.feature || '').slice(0, 18), L - 8, y);
      g.strokeStyle = '#1c222b';
      g.beginPath(); g.moveTo(L, y); g.lineTo(R, y); g.stroke();
      (r.readings || []).forEach(function (d) {
        if (typeof d.value !== 'number') return;
        g.fillStyle = d.color || C.cyan;
        g.beginPath(); g.arc(x(d.value), y, 4, 0, Math.PI * 2); g.fill();
      });
      if (typeof r.predicted === 'number') {
        g.strokeStyle = C.cyan; g.lineWidth = 1.5;
        g.beginPath(); g.moveTo(x(r.predicted), y - 7); g.lineTo(x(r.predicted), y + 7); g.stroke();
        g.lineWidth = 1;
      }
    });
  };

  VizInstance.prototype.gantt = function (a) {
    var g = this._begin('gantt', a);
    var rm = (a && a.roadmap) || [];
    var wk = (a && a.week) || 1, tw = (a && a.totalWeeks) || 12;
    var L = 92, R = this.W - 10, T = 16, B = this.H - 14;
    var x = function (w) { return L + (w / tw) * (R - L); };
    g.strokeStyle = '#1c222b';
    for (var w = 0; w <= tw; w++) {
      g.beginPath(); g.moveTo(x(w), T - 6); g.lineTo(x(w), B); g.stroke();
    }
    g.fillStyle = C.dim; g.textAlign = 'left';
    g.fillText('W1', L + 1, T - 10);
    g.textAlign = 'right'; g.fillText('W' + tw, R, T - 10);
    /* end-of-quarter cliff */
    g.strokeStyle = C.red; g.lineWidth = 2;
    g.beginPath(); g.moveTo(R, T - 6); g.lineTo(R, B); g.stroke();
    g.lineWidth = 1;
    /* now */
    g.strokeStyle = C.cyan;
    g.beginPath(); g.moveTo(x(wk), T - 6); g.lineTo(x(wk), B); g.stroke();

    var live = rm.filter(function (r) { return r.status !== 'dropped'; });
    var rh = live.length ? Math.min(20, (B - T) / live.length) : 16;
    var cursor = 0;
    live.forEach(function (r, i) {
      var y = T + i * rh + 2;
      var est = r.revisedEstimate || r.estCost || 5;
      var weeks = est / 4;
      var start = r.status === 'shipped' ? Math.max(0, cursor) : cursor;
      cursor += weeks;
      g.fillStyle = C.text; g.textAlign = 'right'; g.font = '9px ui-monospace, Menlo, monospace';
      g.fillText(String(r.name || r.featureId || '').slice(0, 13), L - 6, y + rh / 2 - 2);
      var col = r.status === 'shipped' ? C.green : r.status === 'building' ? C.amber : '#2b4a55';
      g.fillStyle = col;
      var x0 = x(start), x1 = x(Math.min(tw + 2, start + weeks));
      g.fillRect(x0, y, Math.max(2, x1 - x0), rh - 5);
      if (start + weeks > tw) {
        g.fillStyle = 'rgba(248,81,73,.45)';
        g.fillRect(x(tw), y, Math.max(2, x1 - x(tw)), rh - 5);
      }
    });
    g.font = '10px ui-monospace, Menlo, monospace';
  };

  VizInstance.prototype.trust = function (a) {
    var g = this._begin('trust', a);
    var s = (a && a.stakeholders) || [];
    var L = 128, R = this.W - 46, T = 24;
    var rh = Math.min(38, (this.H - T - 14) / Math.max(1, s.length));
    s.forEach(function (p, i) {
      var y = T + i * rh + rh / 2;
      g.fillStyle = C.text; g.textAlign = 'right';
      g.fillText(String(p.name || '').slice(0, 20), L - 8, y);
      g.fillStyle = '#0b0f14'; g.fillRect(L, y - 7, R - L, 14);
      var v = typeof p.trust === 'number' ? p.trust : 0;
      g.fillStyle = v < 35 ? C.red : v < 55 ? C.amber : C.green;
      g.fillRect(L, y - 7, ((R - L) * v) / 100, 14);
      g.fillStyle = C.text; g.textAlign = 'left';
      g.fillText(String(Math.round(v)), R + 8, y);
    });
    g.fillStyle = C.dim; g.textAlign = 'left';
    g.fillText('trust 0–100 · below 40 engineering pads its estimates', 12, 12);
  };

  VizInstance.prototype.impact = function (a) {
    var g = this._begin('impact', a);
    var base = (a && a.baseline) || 0;
    var proj = (a && a.projected);
    var sh = (a && a.shipped) || [];
    var L = 60, R = this.W - 18, T = 26, B = this.H - 26;
    var lo = base - 2, hi = Math.max(base + 12, (proj || base) + 3);
    var y = function (v) { return B - ((v - lo) / (hi - lo)) * (B - T); };
    g.strokeStyle = C.border;
    g.beginPath(); g.moveTo(L, T); g.lineTo(L, B); g.lineTo(R, B); g.stroke();
    g.strokeStyle = '#3d4753'; g.setLineDash([4, 4]);
    g.beginPath(); g.moveTo(L, y(base)); g.lineTo(R, y(base)); g.stroke();
    g.setLineDash([]);
    g.fillStyle = C.dim; g.textAlign = 'right';
    g.fillText(base.toFixed(1), L - 6, y(base));
    if (typeof proj === 'number') {
      g.strokeStyle = C.green; g.lineWidth = 2;
      g.beginPath(); g.moveTo(L, y(proj)); g.lineTo(R, y(proj)); g.stroke();
      g.lineWidth = 1;
      g.fillStyle = C.green; g.textAlign = 'left';
      g.fillText('projected ' + proj.toFixed(1), L + 8, y(proj) - 10);
    }
    var bw = Math.min(70, (R - L) / Math.max(1, sh.length + 1));
    sh.forEach(function (s, i) {
      var x0 = L + 20 + i * (bw + 10);
      var d = typeof s.delta === 'number' ? s.delta : 1;
      g.fillStyle = C.cyan;
      g.fillRect(x0, y(base + d), bw, Math.max(2, y(base) - y(base + d)));
      g.fillStyle = C.dim; g.textAlign = 'center';
      g.fillText(String(s.name || '').slice(0, 10), x0 + bw / 2, B + 12);
    });
    g.fillStyle = C.dim; g.textAlign = 'left';
    g.fillText('only shipped work counts', 12, 12);
  };

  VizInstance.prototype.truth = function (a) {
    var g = this._begin('truth', a);
    var pf = (a && a.perFeature) || [];
    var insts = (a && a.instruments) || [];
    var L = 132, R = this.W - 20, T = 26, B = this.H - 22;
    var lo = -6, hi = 6;
    var x = function (v) { return (L + R) / 2 + (v / hi) * ((R - L) / 2); };
    g.fillStyle = C.dim; g.textAlign = 'left';
    g.fillText('reading minus truth, grouped by instrument — the offset IS the bias', 12, 12);
    var rh = insts.length ? Math.min(46, (B - T) / insts.length) : 30;
    g.strokeStyle = '#3d4753';
    g.beginPath(); g.moveTo(x(0), T); g.lineTo(x(0), B); g.stroke();
    insts.forEach(function (ins, i) {
      var y0 = T + i * rh;
      var yc = y0 + rh / 2;
      g.fillStyle = ins.color || C.cyan; g.textAlign = 'right';
      g.fillText(String(ins.name || '').slice(0, 20), L - 10, yc);
      g.strokeStyle = '#1c222b';
      g.beginPath(); g.moveTo(L, yc); g.lineTo(R, yc); g.stroke();
      var sum = 0, n = 0;
      pf.forEach(function (p) {
        (p.readings || []).forEach(function (r) {
          if (r.instrument !== ins.id || typeof r.value !== 'number' || typeof p.truth !== 'number') return;
          var e = r.value - p.truth;
          sum += e; n++;
          g.fillStyle = ins.color || C.cyan;
          g.globalAlpha = 0.85;
          g.beginPath(); g.arc(x(Math.max(lo, Math.min(hi, e))), yc, 4, 0, Math.PI * 2); g.fill();
          g.globalAlpha = 1;
        });
      });
      if (n) {
        var m = sum / n;
        g.strokeStyle = '#e6edf3'; g.lineWidth = 2;
        g.beginPath(); g.moveTo(x(m), yc - 12); g.lineTo(x(m), yc + 12); g.stroke();
        g.lineWidth = 1;
        g.fillStyle = '#e6edf3'; g.textAlign = 'left';
        g.fillText('mean ' + (m > 0 ? '+' : '') + m.toFixed(1), x(m) + 6, yc - 16);
      } else {
        g.fillStyle = '#5b636d'; g.textAlign = 'left';
        g.fillText('never used', L + 8, yc);
      }
    });
  };

  window.Viz = {
    create: function (canvas, opts) {
      if (!canvas || !canvas.getContext) throw new Error('Viz.create needs a canvas');
      return new VizInstance(canvas, opts);
    }
  };

  /* ================================================================ */
  /* MOCK ORG                                                          */
  /* ================================================================ */
  var orgFeed = [], orgSent = {}, orgCo = null, orgOnMessage = null, reactive = {};

  var MockOrg = {
    GATES: [
      { week: 1,  id: 'roadmap',  title: 'Roadmap review',
        prompt: 'Post your quarter plan and priority order to the room in chat.' },
      { week: 6,  id: 'midqtr',   title: 'Mid-quarter review',
        prompt: 'Marguerite wants the number, what changed, and what you\'re cutting.' },
      { week: 11, id: 'shipcut',  title: 'Ship-or-cut call',
        prompt: 'Say what ships, what slips, and who you\'re about to disappoint.' },
      { week: 12, id: 'qbr',      title: 'QBR',
        prompt: 'Paste your QBR into chat and defend the quarter.' }
    ],

    init: function (o) {
      o = o || {};
      orgCo = o.co || window.SIM_CO;
      orgOnMessage = o.onMessage || null;
      orgFeed = []; orgSent = {}; reactive = {};
      MockOrg.tick({ day: 1, week: 1, t: 'W1 D1' });
      return MockOrg;
    },

    tick: function (state) {
      if (!state) return;
      var day = state.day || 1;
      (orgCo.events || []).forEach(function (ev) {
        var evDay = (ev.week - 1) * 5 + (ev.day || 1);
        if (day >= evDay && !orgSent[ev.id]) {
          orgSent[ev.id] = 1;
          push({ id: ev.id, day: evDay, week: ev.week, t: 'W' + ev.week + ' D' + (ev.day || 1),
                 from: ev.from, name: ev.name, text: ev.text, tone: ev.tone,
                 needsReply: !!ev.needsReply });
        }
      });
      /* a couple of reactive triggers, one per tick max */
      var committed = (state.roadmap || []).filter(function (r) {
        return r.status === 'queued' || r.status === 'building';
      });
      var need = committed.reduce(function (a, r) {
        var est = r.revisedEstimate || 5;
        return a + Math.max(0, est - (r.engWeeksSpent || 0));
      }, 0);
      if (!reactive.over && need > (state.capacityLeft || 0) && committed.length) {
        reactive.over = 1;
        push({ id: 'rx:over', day: day, week: state.week, t: state.t, from: 'ENG',
               name: 'Rina Chowdhury', tone: 'warn',
               text: 'You have more committed than you have left. The arithmetic does not care about your plan — pick what dies now, not in week eleven.' });
        return;
      }
      if (!reactive.blind && day > 10 && !((state.research || {}).done || []).length) {
        reactive.blind = 1;
        push({ id: 'rx:blind', day: day, week: state.week, t: state.t, from: 'CEO',
               name: 'Marguerite Osei', tone: 'pressure',
               text: 'Two weeks in and no research has come back. You are flying blind and calling it decisiveness.' });
        return;
      }
      if (!reactive.hunch && committed.length && !((state.research || {}).done || []).length) {
        reactive.hunch = 1;
        push({ id: 'rx:hunch', day: day, week: state.week, t: state.t, from: 'ENG',
               name: 'Rina Chowdhury', tone: 'neutral',
               text: 'We are starting something you have run zero research on. Just want that on the record before my team burns four weeks on it.' });
      }
    },

    getFeed: function () { return orgFeed.slice(); }
  };

  function push(m) {
    orgFeed.push(m);
    if (orgOnMessage) { try { orgOnMessage(m); } catch (e) {} }
  }

  window.Org = MockOrg;

  console.log('[ui_mocks] Product/Viz/Org mocks installed. SIM_CO =',
    window.SIM_CO ? window.SIM_CO.scenario.company : 'MISSING');
})();
