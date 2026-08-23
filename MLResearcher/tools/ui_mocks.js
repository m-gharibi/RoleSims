/* ============================================================================
   ui_mocks.js — MOCK MODULES FOR UI PREVIEW ONLY.  NOT PART OF THE PRODUCT.

   Defines window.SIM_WORLD, window.Lab, window.Plots and window.Team so that
   sim/ui.js can be developed, screenshotted and smoke-tested without the real
   data/world.js, sim/lab.js, sim/plots.js or sim/team.js.

   These implementations conform to the public API in SPEC.md §1–§4 and are
   deliberately simple. The real modules are written by other agents; nothing
   in sim/ui.js may depend on anything beyond what is implemented here.
   ============================================================================ */
(function () {
  'use strict';

  var NREF = 7.0e7;

  /* ====================================================================== */
  /* window.SIM_WORLD                                                       */
  /* ====================================================================== */
  var TRUTH = {
    effects: {
      rope_scaling_v2:      { c:  2.60, a:  0.30, gamma: 1.00 },
      doc_packing_boundary: { c:  1.20, a:  0.90, gamma: 0.50 },
      long_ctx_data_mix:    { c:  3.10, a: -1.50, gamma: 0.70 },
      mup_transfer:         { c:  0.40, a:  2.60, gamma: 0.90 },
      attn_sink_tokens:     { c: -0.90, a:  1.80, gamma: 0.60 },
      qk_norm:              { c:  0.80, a:  0.20, gamma: 1.00 },
      curriculum_reorder:   { c: -0.20, a:  0.50, gamma: 0.40 },
      z_loss_stabilizer:    { c:  1.50, a:  0.10, gamma: 1.00 }
    },
    interactions: [
      { pair: ['doc_packing_boundary', 'long_ctx_data_mix'], delta:  2.70 },
      { pair: ['rope_scaling_v2', 'long_ctx_data_mix'],      delta: -1.40 }
    ],
    notes: {
      rope_scaling_v2: 'A genuine, scale-stable win. Cheap to measure, cheap to ship.',
      doc_packing_boundary: 'Small on its own; most of its value only shows up alongside the long-context mix.',
      long_ctx_data_mix: 'Gets BETTER with scale — measuring it only at 70M understates it badly.',
      mup_transfer: 'A small-scale mirage. Almost all of the gain is gone by 7B and it is worth nothing at 70B.',
      attn_sink_tokens: 'Positive below ~1B, NEGATIVE at run scale. The trap of this whole exercise.',
      qk_norm: 'Small, real, stable. Boring and correct.',
      curriculum_reorder: 'Mildly negative at scale and expensive to measure. Nothing to see here.',
      z_loss_stabilizer: 'Reliable stability win that holds across scales.'
    }
  };

  window.SIM_WORLD = {
    scenario: {
      org: 'Northlight AI',
      team: 'Pretraining · Recipe',
      question: 'Which changes go into the 70B long-context run that locks on Friday?',
      deadline: 'Friday 16:00',
      brief: 'The 70B run starts Monday next week and it is the only one we get this quarter. ' +
             'Eight changes are on the table, each with a champion who is sure about it. ' +
             'You have the small-model cluster for five days and 6000 GPU-hours. ' +
             'Nobody has measured any of this at 70B and nobody will before the run.',
      metric: { name: 'LCR@128k', units: 'points',
                desc: 'long-context retrieval accuracy at a 128k context, in percentage points' },
      priorEvidence: [
        { text: 'RoPE scaling v2 gave +2.4 points on the 1.4B ablation last quarter.',
          source: 'internal note, Pretraining, March' },
        { text: 'muP transfer looked enormous at 70M — the champion is quoting +3.',
          source: 'Ana, hallway' },
        { text: 'Attention sink tokens are widely reported as a free win.',
          source: 'external paper, unreplicated here' }
      ],
      runScale: 7.0e10,
      maxInterventions: 4
    },
    interventions: [
      { id: 'rope_scaling_v2', name: 'RoPE scaling v2', family: 'architecture', cost: 'low',
        desc: 'Recomputed rotary base with an interpolation schedule tuned for 128k.', author: 'Ana Beltrán' },
      { id: 'doc_packing_boundary', name: 'Doc-boundary packing', family: 'data', cost: 'low',
        desc: 'Stop packing unrelated documents across the attention boundary.', author: 'Ana Beltrán' },
      { id: 'long_ctx_data_mix', name: 'Long-context data mix', family: 'data', cost: 'medium',
        desc: 'Reweight the corpus toward genuinely long documents.', author: 'Yuki Tanaka' },
      { id: 'mup_transfer', name: 'muP transfer', family: 'optimization', cost: 'medium',
        desc: 'Width-invariant parameterisation so LR transfers across scale.', author: 'Halberd' },
      { id: 'attn_sink_tokens', name: 'Attention sink tokens', family: 'architecture', cost: 'low',
        desc: 'Prepend learned sink tokens to stabilise long-range attention.', author: 'Halberd' },
      { id: 'qk_norm', name: 'QK normalisation', family: 'architecture', cost: 'low',
        desc: 'RMSNorm on queries and keys before the dot product.', author: 'Rasheed' },
      { id: 'curriculum_reorder', name: 'Curriculum reorder', family: 'data', cost: 'high',
        desc: 'Order the corpus short-to-long across training.', author: 'Halberd' },
      { id: 'z_loss_stabilizer', name: 'Z-loss stabiliser', family: 'objective', cost: 'medium',
        desc: 'Auxiliary z-loss on the softmax logits to stop late-run drift.', author: 'Yuki Tanaka' }
    ],
    scales: [
      { id: '70m',  params: 7.0e7, label: '70M',  computeHours: 12,  wallHours: 1.5,  sigma: 1.80 },
      { id: '300m', params: 3.0e8, label: '300M', computeHours: 45,  wallHours: 3.0,  sigma: 1.20 },
      { id: '1p4b', params: 1.4e9, label: '1.4B', computeHours: 190, wallHours: 7.0,  sigma: 0.80 },
      { id: '7b',   params: 7.0e9, label: '7B',   computeHours: 850, wallHours: 18.0, sigma: 0.50 }
    ],
    stepOptions: [
      { id: 'short', label: '5k steps',  mult: 0.5 },
      { id: 'std',   label: '10k steps', mult: 1.0 },
      { id: 'long',  label: '20k steps', mult: 2.0 }
    ],
    events: [],
    _t: '(mock — not encoded)',
    reveal: function () { return TRUTH; }
  };

  /* ====================================================================== */
  /* window.Lab                                                             */
  /* ====================================================================== */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  var RULES = {
    computeBudget: 6000, slots: 4, days: 5, hoursPerDay: 10, startHour: 9,
    maxInterventions: 4, failureBase: 0.10,
    failureScaleMult: { '70m': 0.6, '300m': 0.9, '1p4b': 1.3, '7b': 2.0 },
    killRefund: 0.5, minHypothesisChars: 20
  };
  var FAILS = ['preempted', 'loss diverged (NaN at step ~4200)', 'OOM on shard 3',
               'dataloader deadlock', 'checkpoint corrupt'];

  var L = {
    world: null, rnd: null, absHour: 0, tick: 0, jobs: [], results: [],
    used: 0, seq: 1, timer: 0, speed: 4, running: false,
    submitted: false, listeners: {}, spare: null
  };

  function absToDayHour(a) {
    var d = Math.floor(a / RULES.hoursPerDay) + 1;
    var hr = RULES.startHour + (a - (d - 1) * RULES.hoursPerDay);
    if (d > RULES.days) { d = RULES.days; hr = RULES.startHour + RULES.hoursPerDay; }
    return { day: d, hour: hr };
  }
  function DAY(a) { return absToDayHour(a).day; }
  function HR(a) { return absToDayHour(a).hour; }
  function fmtT(a) {
    var x = absToDayHour(a);
    var names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
    var t = Math.round(x.hour * 60);
    function p2(n) { return (n < 10 ? '0' : '') + n; }
    return (names[x.day - 1] || ('D' + x.day)) + ' ' + p2(Math.floor(t / 60)) + ':' + p2(t % 60);
  }
  function gauss() {
    if (L.spare !== null) { var s = L.spare; L.spare = null; return s; }
    var u = 0, v = 0, r = 0;
    do { u = L.rnd() * 2 - 1; v = L.rnd() * 2 - 1; r = u * u + v * v; } while (r === 0 || r >= 1);
    var f = Math.sqrt(-2 * Math.log(r) / r);
    L.spare = v * f;
    return u * f;
  }
  function scaleOf(sid) {
    var s = L.world.scales;
    for (var i = 0; i < s.length; i++) if (s[i].id === sid) return s[i];
    return null;
  }
  function stepsOf(sid) {
    var s = L.world.stepOptions;
    for (var i = 0; i < s.length; i++) if (s[i].id === sid) return s[i];
    return null;
  }
  function trueEffect(ids, N) {
    var tot = 0;
    ids.forEach(function (i) {
      var e = TRUTH.effects[i];
      if (e) tot += e.c + e.a * Math.pow(NREF / N, e.gamma);
    });
    TRUTH.interactions.forEach(function (it) {
      if (ids.indexOf(it.pair[0]) >= 0 && ids.indexOf(it.pair[1]) >= 0) tot += it.delta;
    });
    return tot;
  }
  function emit(name, payload) {
    (L.listeners[name] || []).forEach(function (fn) {
      try { fn(payload, Lab.getState()); } catch (e) { /* ignore listener errors */ }
    });
  }

  var Lab = {
    RULES: RULES,

    init: function (opt) {
      L.world = (opt && opt.world) || window.SIM_WORLD;
      L.rnd = mulberry32((opt && opt.seed) || 20260816);
      L.absHour = 0; L.tick = 0; L.jobs = []; L.results = [];
      L.used = 0; L.seq = 1; L.submitted = false; L.spare = null;
      return true;
    },

    getState: function () {
      var x = absToDayHour(L.absHour);
      return {
        day: x.day, hour: x.hour, t: fmtT(L.absHour), tick: L.tick,
        computeUsed: Math.round(L.used), computeRemaining: Math.round(RULES.computeBudget - L.used),
        budgetPct: (L.used / RULES.computeBudget) * 100,
        slotsUsed: L.jobs.length, slotsFree: RULES.slots - L.jobs.length,
        running: L.jobs.map(function (j) {
          return {
            id: j.id, interventions: j.interventions.slice(), scale: j.scale, steps: j.steps,
            seeds: j.seeds, cost: j.cost, wallHours: j.wallHours,
            launchedAt: { day: DAY(j.t0), hour: HR(j.t0) },
            etaAt: { day: DAY(j.t1), hour: HR(j.t1) },
            progress: Math.max(0, Math.min(1, (L.absHour - j.t0) / (j.t1 - j.t0))),
            hypothesis: j.hypothesis, predictedEffect: j.predictedEffect,
            ciLow: j.ciLow, ciHigh: j.ciHigh
          };
        }),
        results: L.results.slice(),
        finished: L.absHour >= RULES.days * RULES.hoursPerDay,
        readoutSubmitted: L.submitted
      };
    },

    design: function (o) {
      o = o || {};
      var ids = o.interventions || [];
      if (!ids.length) return { ok: false, error: 'Pick at least one intervention' };
      var sc = scaleOf(o.scale), st = stepsOf(o.steps);
      if (!sc) return { ok: false, error: 'Unknown scale "' + o.scale + '"' };
      if (!st) return { ok: false, error: 'Unknown step option "' + o.steps + '"' };
      var seeds = Math.max(1, Math.round(o.seeds || 1));
      var cost = sc.computeHours * st.mult * seeds;
      var wall = sc.wallHours * st.mult;
      var sigma = sc.sigma / Math.sqrt(seeds) / Math.sqrt(st.mult);
      var eta = L.absHour + wall;
      return {
        ok: true, cost: cost, wallHours: wall, sigma: sigma,
        etaDay: DAY(eta), etaHour: HR(eta),
        etaPastDeadline: eta > RULES.days * RULES.hoursPerDay
      };
    },

    launch: function (o) {
      o = o || {};
      if (L.submitted) return { ok: false, error: 'The readout is already submitted' };
      var ids = o.interventions || [];
      if (!ids.length) return { ok: false, error: 'Pick at least one intervention' };
      if (L.jobs.length >= RULES.slots) {
        return { ok: false, error: 'No free slots — you have ' + RULES.slots + ' jobs running' };
      }
      var d = Lab.design(o);
      if (!d.ok) return { ok: false, error: d.error };
      if (d.cost > RULES.computeBudget - L.used) {
        return { ok: false, error: 'Not enough compute — that costs ' + Math.round(d.cost) +
          ' GPU-hours, you have ' + Math.round(RULES.computeBudget - L.used) };
      }
      if (!o.hypothesis || String(o.hypothesis).trim().length < RULES.minHypothesisChars) {
        return { ok: false, error: 'Hypothesis required' };
      }
      if (typeof o.predictedEffect !== 'number' || !isFinite(o.predictedEffect) ||
          !(o.ciLow < o.ciHigh)) {
        return { ok: false, error: 'Predicted effect required' };
      }
      if (L.absHour + d.wallHours > RULES.days * RULES.hoursPerDay) {
        return { ok: false, error: "It won't finish before Friday's readout" };
      }

      var st = stepsOf(o.steps);
      var p = Math.min(0.45, RULES.failureBase * (RULES.failureScaleMult[o.scale] || 1) * st.mult);
      var willFail = L.rnd() < p;
      var failAt = willFail ? (0.2 + L.rnd() * 0.7) : 1;
      var reason = FAILS[Math.floor(L.rnd() * FAILS.length)];

      var job = {
        id: 'J' + (L.seq++), interventions: ids.slice(), scale: o.scale, steps: o.steps,
        seeds: Math.max(1, Math.round(o.seeds || 1)), cost: d.cost, wallHours: d.wallHours,
        sigma: d.sigma, t0: L.absHour, t1: L.absHour + d.wallHours * failAt,
        fullT1: L.absHour + d.wallHours, willFail: willFail, failReason: reason, failFrac: failAt,
        hypothesis: o.hypothesis, predictedEffect: o.predictedEffect,
        ciLow: o.ciLow, ciHigh: o.ciHigh
      };
      L.jobs.push(job);
      L.used += d.cost;
      return { ok: true, job: job };
    },

    kill: function (jobId) {
      for (var i = 0; i < L.jobs.length; i++) {
        if (L.jobs[i].id === jobId) {
          var j = L.jobs[i];
          var prog = Math.max(0, Math.min(1, (L.absHour - j.t0) / (j.fullT1 - j.t0)));
          L.used -= j.cost * (1 - prog) * RULES.killRefund;
          L.jobs.splice(i, 1);
          return { ok: true, refund: j.cost * (1 - prog) * RULES.killRefund };
        }
      }
      return { ok: false, error: 'No such job' };
    },

    step: function () { advance(0.25); },
    advance: function (hours) { advance(hours); },

    start: function () {
      L.running = true;
      if (L.timer) return;
      L.timer = window.setInterval(function () {
        if (!L.running) return;
        advance(0.25);
      }, Math.max(60, Math.round(600 / (L.speed || 1))));
    },
    pause: function () { L.running = false; },
    resume: function () { L.running = true; if (!L.timer) Lab.start(); },
    setSpeed: function (m) {
      L.speed = m;
      if (L.timer) { window.clearInterval(L.timer); L.timer = 0; if (L.running) Lab.start(); }
    },
    destroy: function () { if (L.timer) window.clearInterval(L.timer); L.timer = 0; L.running = false; },

    on: function (name, fn) {
      (L.listeners[name] = L.listeners[name] || []).push(fn);
    },

    submitReadout: function (o) {
      o = o || {};
      var chosen = (o.interventions || []).slice();
      var runN = L.world.scenario.runScale;
      var got = trueEffect(chosen, runN);

      /* brute force the best subset of size <= max */
      var all = L.world.interventions.map(function (i) { return i.id; });
      var best = -1e9, bestSet = [];
      var n = all.length;
      for (var m = 1; m < (1 << n); m++) {
        var set = [], k = 0;
        for (var b = 0; b < n; b++) if (m & (1 << b)) { set.push(all[b]); k++; }
        if (k > RULES.maxInterventions) continue;
        var v = trueEffect(set, runN);
        if (v > best) { best = v; bestSet = set; }
      }
      var regret = best - got;
      var frac = best > 0 ? regret / best : 1;
      var grade = frac < 0.10 ? 'A' : frac < 0.25 ? 'B' : frac < 0.45 ? 'C' : frac < 0.70 ? 'D' : 'F';
      var shipped = chosen.some(function (i) { return trueEffect([i], runN) < 0; });
      if (shipped && 'AB'.indexOf(grade) >= 0) grade = 'C';

      var missed = bestSet.filter(function (i) { return chosen.indexOf(i) < 0; });

      /* calibration over every prediction on record */
      var preds = L.results.filter(function (r) { return typeof r.predictedEffect === 'number'; });
      var hits = 0, sumAbs = 0, sumSigned = 0;
      preds.forEach(function (r) {
        var sc = scaleOf(r.scale);
        var tv = trueEffect(r.interventions, sc ? sc.params : NREF);
        if (tv >= r.ciLow && tv <= r.ciHigh) hits++;
        sumAbs += Math.abs(r.predictedEffect - tv);
        sumSigned += (r.predictedEffect - tv);
      });
      var hitRate = preds.length ? hits / preds.length : 0;

      var per = L.world.interventions.map(function (iv) {
        var solo = L.results.filter(function (r) {
          return r.status === 'ok' && r.interventions.length === 1 && r.interventions[0] === iv.id;
        });
        var believed = null;
        if (solo.length) {
          var w = 0, ws = 0;
          solo.forEach(function (r) { var wt = 1 / (r.sigma * r.sigma); ws += r.observedEffect * wt; w += wt; });
          believed = ws / w;
        }
        var tv = trueEffect([iv.id], runN);
        var isChosen = chosen.indexOf(iv.id) >= 0;
        var verdict = isChosen && tv < 0 ? 'REGRESSION SHIPPED'
          : isChosen && tv > 0 ? 'correct pick'
          : !isChosen && bestSet.indexOf(iv.id) >= 0 ? 'missed'
          : 'correctly avoided';
        return { id: iv.id, believed: believed, truthAtRunScale: tv, chosen: isChosen, verdict: verdict };
      });

      L.submitted = true;
      Lab.pause();

      return {
        ok: true,
        chosen: chosen, trueEffectAtRunScale: got, bestPossible: best, bestSet: bestSet,
        regret: regret, grade: grade, shippedRegression: shipped, missed: missed,
        computeSpent: Math.round(L.used),
        computeEfficiency: L.used ? got / (L.used / 1000) : 0,
        confidence: o.confidence, rationale: o.rationale,
        calibration: {
          n: preds.length, hitRate: hitRate,
          meanAbsError: preds.length ? sumAbs / preds.length : 0,
          bias: preds.length ? sumSigned / preds.length : 0,
          overconfident: preds.length >= 3 && hitRate < 0.8
        },
        perIntervention: per
      };
    },

    exportReadout: function () {
      var Lm = [];
      Lm.push('# Readout — ' + L.world.scenario.org);
      Lm.push('');
      Lm.push('_(mock Lab.exportReadout — the real one lives in sim/lab.js)_');
      Lm.push('');
      Lm.push('| interventions | scale | steps | seeds | GPU-h | predicted | your CI | observed | sigma | status |');
      Lm.push('|---|---|---|---:|---:|---:|---|---:|---:|---|');
      L.results.forEach(function (r) {
        Lm.push('| ' + r.interventions.join(' + ') + ' | ' + r.scale + ' | ' + r.steps + ' | ' +
          r.seeds + ' | ' + Math.round(r.cost) + ' | ' + r.predictedEffect + ' | [' + r.ciLow + ', ' +
          r.ciHigh + '] | ' + (r.status === 'ok' ? r.observedEffect.toFixed(2) : '—') + ' | ' +
          r.sigma.toFixed(2) + ' | ' + (r.status === 'ok' ? 'ok' : 'FAILED: ' + r.failReason) + ' |');
      });
      Lm.push('');
      Lm.push('Compute spent: ' + Math.round(L.used) + ' / ' + RULES.computeBudget + ' GPU-h.');
      return Lm.join('\n');
    }
  };

  function advance(hours) {
    if (L.submitted) return;
    var end = RULES.days * RULES.hoursPerDay;
    var target = Math.min(end, L.absHour + hours);
    /* complete jobs in order */
    var guard = 0;
    while (guard++ < 500) {
      var next = null;
      for (var i = 0; i < L.jobs.length; i++) {
        if (L.jobs[i].t1 <= target && (!next || L.jobs[i].t1 < next.t1)) next = L.jobs[i];
      }
      if (!next) break;
      L.absHour = next.t1;
      finishJob(next);
    }
    L.absHour = target;
    L.tick = Math.round(L.absHour * 4);
    emit('tick', Lab.getState());
    if (L.absHour >= end) emit('deadline', null);
  }

  function finishJob(j) {
    var idx = L.jobs.indexOf(j);
    if (idx >= 0) L.jobs.splice(idx, 1);
    var base = {
      id: j.id, interventions: j.interventions.slice(), scale: j.scale, steps: j.steps,
      seeds: j.seeds, cost: j.cost, wallHours: j.wallHours,
      launchedAt: { day: DAY(j.t0), hour: HR(j.t0) },
      etaAt: { day: DAY(j.fullT1), hour: HR(j.fullT1) },
      progress: 1, hypothesis: j.hypothesis, predictedEffect: j.predictedEffect,
      ciLow: j.ciLow, ciHigh: j.ciHigh, sigma: j.sigma,
      finishedAt: { day: DAY(j.t1), hour: HR(j.t1) }
    };
    if (j.willFail) {
      L.used -= j.cost * (1 - j.failFrac);
      base.status = 'failed';
      base.failReason = j.failReason;
      L.results.push(base);
      emit('fail', base);
      emit('result', base);
    } else {
      var sc = scaleOf(j.scale);
      var tv = trueEffect(j.interventions, sc.params);
      var obs = tv + gauss() * j.sigma;
      base.status = 'ok';
      base.observedEffect = obs;
      base.ciLow95 = obs - 1.96 * j.sigma;
      base.ciHigh95 = obs + 1.96 * j.sigma;
      L.results.push(base);
      emit('result', base);
    }
  }

  window.Lab = Lab;

  /* ====================================================================== */
  /* window.Plots — a deliberately small but real canvas renderer           */
  /* ====================================================================== */
  var C = { bg: '#0d1117', panel: '#161b22', border: '#30363d', text: '#c9d1d9',
            dim: '#8b949e', good: '#3fb950', bad: '#f85149', warn: '#d29922', accent: '#39c5cf' };

  function Plot(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.resize();
  }
  Plot.prototype.resize = function () {
    var dpr = window.devicePixelRatio || 1;
    var r = this.cv.getBoundingClientRect();
    var w = Math.max(10, Math.round(r.width)), hh = Math.max(10, Math.round(r.height));
    this.cv.width = Math.round(w * dpr);
    this.cv.height = Math.round(hh * dpr);
    this.w = w; this.h = hh;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  Plot.prototype._clear = function () {
    var g = this.ctx;
    g.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);
    g.clearRect(0, 0, this.w, this.h);
    g.fillStyle = '#11161d';
    g.fillRect(0, 0, this.w, this.h);
    g.font = '10px ui-monospace, Menlo, monospace';
    g.textBaseline = 'middle';
  };

  Plot.prototype._scaleAxes = function (series, runScale, curves) {
    var xs = [7e7, 1.05 * (runScale || 7e10)];
    var lo = 1e9, hi = -1e9;
    (series || []).forEach(function (s) {
      (s.points || []).forEach(function (p) {
        lo = Math.min(lo, p.ciLow, p.effect); hi = Math.max(hi, p.ciHigh, p.effect);
      });
    });
    (curves || []).forEach(function (c) {
      for (var i = 0; i <= 10; i++) {
        var N = Math.pow(10, Math.log10(7e7) + (Math.log10(xs[1]) - Math.log10(7e7)) * i / 10);
        var v = c.fn(N);
        if (isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
      }
    });
    if (lo > hi) { lo = -1; hi = 1; }
    lo = Math.min(lo, 0); hi = Math.max(hi, 0);
    var pad = Math.max(0.6, (hi - lo) * 0.14);
    return { x0: 6e7, x1: xs[1] * 1.1, y0: lo - pad, y1: hi + pad };
  };

  Plot.prototype._frame = function (ax, metric, runScale) {
    var g = this.ctx;
    var L = 42, R = 12, T = 12, B = 24;
    var pw = this.w - L - R, ph = this.h - T - B;
    var lx0 = Math.log10(ax.x0), lx1 = Math.log10(ax.x1);
    var self = this;
    var X = function (p) { return L + ((Math.log10(p) - lx0) / (lx1 - lx0)) * pw; };
    var Y = function (v) { return T + (1 - (v - ax.y0) / (ax.y1 - ax.y0)) * ph; };

    /* y grid */
    g.strokeStyle = '#1b2028'; g.lineWidth = 1;
    var steps = 5;
    for (var i = 0; i <= steps; i++) {
      var v = ax.y0 + (ax.y1 - ax.y0) * i / steps;
      var y = Math.round(Y(v)) + 0.5;
      g.beginPath(); g.moveTo(L, y); g.lineTo(L + pw, y); g.stroke();
      g.fillStyle = C.dim; g.textAlign = 'right';
      g.fillText(v.toFixed(1), L - 5, y);
    }
    /* zero line */
    if (ax.y0 < 0 && ax.y1 > 0) {
      g.strokeStyle = '#4a545f'; g.lineWidth = 1;
      var yz = Math.round(Y(0)) + 0.5;
      g.beginPath(); g.moveTo(L, yz); g.lineTo(L + pw, yz); g.stroke();
    }
    /* x ticks */
    var ticks = [7e7, 3e8, 1.4e9, 7e9, 7e10];
    g.textAlign = 'center';
    ticks.forEach(function (t) {
      if (t < ax.x0 || t > ax.x1) return;
      var x = Math.round(X(t)) + 0.5;
      g.strokeStyle = '#1b2028';
      g.beginPath(); g.moveTo(x, T); g.lineTo(x, T + ph); g.stroke();
      g.fillStyle = C.dim;
      g.fillText(t >= 1e9 ? (t / 1e9 >= 10 ? Math.round(t / 1e9) + 'B' : (t / 1e9).toFixed(1) + 'B')
                          : Math.round(t / 1e6) + 'M', x, T + ph + 11);
    });
    /* run scale marker */
    if (runScale && runScale >= ax.x0 && runScale <= ax.x1) {
      var xr = Math.round(X(runScale)) + 0.5;
      g.save();
      g.setLineDash([4, 3]); g.strokeStyle = C.warn; g.lineWidth = 1;
      g.beginPath(); g.moveTo(xr, T); g.lineTo(xr, T + ph); g.stroke();
      g.restore();
      g.save();
      g.translate(xr - 5, T + 6);
      g.rotate(Math.PI / 2);
      g.fillStyle = C.warn; g.textAlign = 'left';
      g.fillText('RUN SCALE — you have no data here', 0, 0);
      g.restore();
    }
    g.textAlign = 'left';
    g.fillStyle = C.dim;
    g.fillText(metric || '', L + 3, T + 7);
    return { X: X, Y: Y, L: L, T: T, pw: pw, ph: ph };
  };

  Plot.prototype.scaling = function (o) {
    o = o || {};
    this._clear();
    var ax = this._scaleAxes(o.series, o.runScale, null);
    var fr = this._frame(ax, o.metric, o.runScale);
    var g = this.ctx;
    (o.series || []).forEach(function (s) {
      var pts = (s.points || []).slice().sort(function (a, b) { return a.params - b.params; });
      g.strokeStyle = s.color || C.accent; g.lineWidth = 1.6;
      g.beginPath();
      pts.forEach(function (p, i) {
        var x = fr.X(p.params), y = fr.Y(p.effect);
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      });
      g.stroke();
      pts.forEach(function (p) {
        var x = fr.X(p.params);
        g.strokeStyle = s.color || C.accent; g.lineWidth = 1;
        g.beginPath(); g.moveTo(x, fr.Y(p.ciLow)); g.lineTo(x, fr.Y(p.ciHigh)); g.stroke();
        g.beginPath(); g.moveTo(x - 3, fr.Y(p.ciLow)); g.lineTo(x + 3, fr.Y(p.ciLow));
        g.moveTo(x - 3, fr.Y(p.ciHigh)); g.lineTo(x + 3, fr.Y(p.ciHigh)); g.stroke();
        g.fillStyle = s.color || C.accent;
        g.beginPath(); g.arc(x, fr.Y(p.effect), 2.6, 0, 6.284); g.fill();
      });
    });
    /* legend */
    var ly = fr.T + 18;
    (o.series || []).slice(0, 8).forEach(function (s) {
      g.fillStyle = s.color || C.accent;
      g.fillRect(fr.L + 6, ly - 3, 6, 6);
      g.fillStyle = C.dim; g.textAlign = 'left';
      g.fillText(String(s.label).slice(0, 24), fr.L + 16, ly);
      ly += 11;
    });
  };

  Plot.prototype.truth = function (o) {
    o = o || {};
    this._clear();
    var ax = this._scaleAxes(o.series, o.runScale, o.truthCurves);
    var fr = this._frame(ax, o.metric, o.runScale);
    var g = this.ctx;
    (o.truthCurves || []).forEach(function (c) {
      g.save();
      g.setLineDash([5, 3]);
      g.strokeStyle = c.color || C.dim; g.lineWidth = 1.4; g.globalAlpha = 0.9;
      g.beginPath();
      for (var i = 0; i <= 60; i++) {
        var lx = Math.log10(ax.x0) + (Math.log10(ax.x1) - Math.log10(ax.x0)) * i / 60;
        var N = Math.pow(10, lx);
        var v = c.fn(N);
        if (i === 0) g.moveTo(fr.X(N), fr.Y(v)); else g.lineTo(fr.X(N), fr.Y(v));
      }
      g.stroke();
      g.restore();
    });
    (o.series || []).forEach(function (s) {
      (s.points || []).forEach(function (p) {
        var x = fr.X(p.params);
        g.strokeStyle = s.color || C.accent; g.lineWidth = 1;
        g.beginPath(); g.moveTo(x, fr.Y(p.ciLow)); g.lineTo(x, fr.Y(p.ciHigh)); g.stroke();
        g.fillStyle = s.color || C.accent;
        g.beginPath(); g.arc(x, fr.Y(p.effect), 3, 0, 6.284); g.fill();
      });
    });
    var ly = fr.T + 6;
    (o.truthCurves || []).slice(0, 9).forEach(function (c) {
      g.fillStyle = c.color || C.dim;
      g.fillRect(fr.L + 8, ly - 3, 6, 6);
      g.fillStyle = C.dim; g.textAlign = 'left';
      g.fillText(String(c.label).slice(0, 22), fr.L + 18, ly);
      ly += 11;
    });
  };

  Plot.prototype.forest = function (o) {
    o = o || {};
    this._clear();
    var rows = (o.rows || []).slice();
    var g = this.ctx;
    if (!rows.length) return;
    var lo = 1e9, hi = -1e9;
    rows.forEach(function (r) { lo = Math.min(lo, r.ciLow); hi = Math.max(hi, r.ciHigh); });
    lo = Math.min(lo, 0); hi = Math.max(hi, 0);
    var pad = Math.max(0.4, (hi - lo) * 0.1);
    lo -= pad; hi += pad;
    var Lx = Math.min(168, Math.round(this.w * 0.52)), R = 10, T = 8, B = 18;
    var pw = this.w - Lx - R;
    var rowH = Math.max(9, Math.min(18, (this.h - T - B) / rows.length));
    var X = function (v) { return Lx + ((v - lo) / (hi - lo)) * pw; };
    /* zero line */
    var xz = Math.round(X(0)) + 0.5;
    g.strokeStyle = '#4a545f';
    g.beginPath(); g.moveTo(xz, T); g.lineTo(xz, T + rowH * rows.length); g.stroke();
    rows.forEach(function (r, i) {
      var y = T + rowH * i + rowH / 2;
      var crosses = r.ciLow <= 0 && r.ciHigh >= 0;
      g.globalAlpha = crosses ? 0.42 : 1;
      g.fillStyle = C.dim; g.textAlign = 'right';
      g.fillText(String(r.label).slice(0, Math.floor((Lx - 10) / 6.1)), Lx - 6, y);
      g.strokeStyle = crosses ? C.dim : (r.effect > 0 ? C.good : C.bad);
      g.lineWidth = 1;
      g.beginPath(); g.moveTo(X(r.ciLow), y); g.lineTo(X(r.ciHigh), y); g.stroke();
      g.beginPath(); g.moveTo(X(r.ciLow), y - 3); g.lineTo(X(r.ciLow), y + 3);
      g.moveTo(X(r.ciHigh), y - 3); g.lineTo(X(r.ciHigh), y + 3); g.stroke();
      g.fillStyle = crosses ? C.dim : (r.effect > 0 ? C.good : C.bad);
      g.fillRect(X(r.effect) - 2, y - 2, 4, 4);
      g.globalAlpha = 1;
    });
    g.fillStyle = C.dim; g.textAlign = 'center';
    g.fillText(lo.toFixed(1), Lx, this.h - 7);
    g.fillText('0', xz, this.h - 7);
    g.fillText(hi.toFixed(1), Lx + pw, this.h - 7);
  };

  Plot.prototype.budget = function () { /* not used by the console layout */ };

  window.Plots = {
    create: function (canvas) { return new Plot(canvas); }
  };

  /* ====================================================================== */
  /* window.Team                                                            */
  /* ====================================================================== */
  var SCRIPT = [
    { at: 0.25, from: 'PEER', name: 'Ana Beltrán', tone: 'neutral',
      text: 'Morning! I put muP at the top of my list — it looked enormous at 70M. Curious what you find.' },
    { at: 1.5, from: 'RIVAL', name: 'Team Halberd', tone: 'pressure',
      text: 'Internal note: attention sink tokens +1.1 LCR@128k. Measured at 70M, 1 seed. Recommending it for the run.' },
    { at: 3.0, from: 'OPS', name: 'Rasheed', tone: 'neutral',
      text: 'Cluster note: 7B jobs are queueing behind an eval sweep. Preemption risk is elevated today.' },
    { at: 6.0, from: 'LEAD', name: 'Dr. Yuki Tanaka', tone: 'pressure',
      text: 'At what scale did you measure that, and why do you think it holds at 70B?' },
    { at: 12.0, from: 'PEER', name: 'Ana Beltrán', tone: 'neutral',
      text: 'Has anyone actually tried the data mix and the packing change together? They feel related.' },
    { at: 18.0, from: 'OPS', name: 'Rasheed', tone: 'warn',
      text: 'Taking one of your slots for a priority eval. You are down to 3 until Thursday.' },
    { at: 26.0, from: 'LEAD', name: 'Dr. Yuki Tanaka', tone: 'pressure',
      text: 'Midweek: I want your current belief per intervention with a number and a CI, not adjectives.' },
    { at: 34.0, from: 'RIVAL', name: 'Team Halberd', tone: 'alarm',
      text: 'We are dropping the curriculum reorder. Too expensive, no signal. Your call whether you burn compute on it.' },
    { at: 42.0, from: 'LEAD', name: 'Dr. Yuki Tanaka', tone: 'warn',
      text: 'Friday tomorrow. Whatever is still running now is what you will have.' }
  ];

  var TState = { feed: [], sent: {}, fired: {}, lab: null };

  window.Team = {
    GATES: [
      { day: 1, hour: 9,  id: 'plan', title: 'Research plan',
        prompt: 'Before you burn a GPU-hour: post your plan to Yuki in chat.' },
      { day: 3, hour: 14, id: 'midweek', title: 'Midweek review',
        prompt: "Yuki wants your current belief, your evidence, and what you'd cut." },
      { day: 5, hour: 16, id: 'readout', title: 'Friday readout',
        prompt: 'Paste your readout into chat and defend the recommendation.' }
    ],
    init: function (o) {
      TState.feed = []; TState.sent = {}; TState.fired = {};
      TState.lab = o && o.lab;
      TState.onMessage = o && o.onMessage;
      return true;
    },
    tick: function (st) {
      if (!st) return;
      var abs = (st.day - 1) * 10 + (st.hour - 9);
      var names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
      function p2(n) { return (n < 10 ? '0' : '') + n; }
      var t = names[st.day - 1] + ' ' + p2(Math.floor(st.hour)) + ':' + p2(Math.round((st.hour % 1) * 60));
      for (var i = 0; i < SCRIPT.length; i++) {
        var s = SCRIPT[i];
        if (TState.sent[i] || abs < s.at) continue;
        TState.sent[i] = true;
        var m = { day: st.day, hour: st.hour, t: t, from: s.from, name: s.name, text: s.text, tone: s.tone };
        TState.feed.push(m);
        if (TState.onMessage) TState.onMessage(m);
        return;   /* at most one message per tick */
      }
      /* one reactive trigger: three or more runs at the smallest scale */
      var small = (st.results || []).filter(function (r) { return r.scale === '70m'; }).length;
      if (small >= 3 && !TState.fired.smallOnly) {
        TState.fired.smallOnly = true;
        var m2 = { day: st.day, hour: st.hour, t: t, from: 'LEAD', name: 'Dr. Yuki Tanaka',
                   tone: 'pressure',
                   text: 'Three runs at 70M. Small-scale evidence does not transfer by itself — ' +
                         'what makes you think the ordering survives to 70B?' };
        TState.feed.push(m2);
        if (TState.onMessage) TState.onMessage(m2);
      }
    },
    getFeed: function () { return TState.feed.slice(); }
  };
})();
