/* ==========================================================================
 * sim/lab.js  —  window.Lab
 *
 * Foundational ML Researcher Sim: the clock, the compute budget, the job
 * queue, the experiment cost/noise model, infra failures, and scoring.
 *
 * PURE LOGIC. No DOM access whatsoever. Loads via a plain <script src> tag
 * from a file:// page; no modules, no imports, no libraries, no build step.
 * Unit-testable under node with `global.window = global; require(...)`.
 *
 * Implements SPEC.md §2 exactly. Do not deviate: other files are built
 * against this API.
 *
 * THIS IS THE ONLY MODULE ALLOWED TO READ THE GROUND TRUTH. It calls
 * world.reveal() exactly once, at init, and uses it for two things only:
 *   (a) generating noisy observations, and
 *   (b) scoring the readout / serving the debrief AFTER submission.
 * Nothing the module hands out before submission contains truth.
 *
 * ---------------------------------------------------------------------------
 * Decisions the spec left open (documented so the other modules can rely on
 * them; none of them change a documented field):
 *
 *  - THE CLOCK RUNS ONLY DURING WORKING HOURS. Elapsed time is measured in
 *    "lab hours": 10 per day (09:00 -> 19:00), 5 days, so 0..50. Job wall
 *    clock is measured on the same clock, i.e. an 18h run eats nearly two
 *    working days. Friday's readout gate is at day 5, 16:00 => elapsed 47,
 *    and that is THE DEADLINE (`Lab.DEADLINE`). The session finishes there.
 *  - design() is a pricing preview. It returns ok:false only for
 *    STRUCTURALLY invalid input (no interventions, unknown scale/steps,
 *    bad seed count). If the design is merely unaffordable / slotless / too
 *    late, it still returns ok:true WITH cost, wallHours and sigma — showing
 *    sigma before commitment is the whole point — plus `wouldReject:true`
 *    and `warning` carrying the exact launch rejection message.
 *  - Killed jobs land in `results` with status "killed" (the spec's Result
 *    status union covers the two outcomes the lab produces on its own).
 *    They carry no observation and are excluded from calibration.
 *  - `bestSet` is searched over NON-EMPTY subsets of size <= maxInterventions.
 *  - `missed` = interventions in bestSet the player left out.
 *  - `believed` (perIntervention) = inverse-variance weighted mean of the
 *    player's own successful SOLO measurements of that intervention, or null
 *    if they never measured it alone.
 *  - `overconfident` = the truth fell inside their stated CI less than half
 *    the time.
 * ========================================================================== */
;(function (global) {
  "use strict";

  /* ---------------------------------------------------------------- rules */

  var RULES = {
    computeBudget: 6000,     // GPU-hours for the week
    slots:         4,        // concurrent jobs (your allocation)
    days:          5,
    hoursPerDay:   10,       // 09:00 -> 19:00
    startHour:     9,
    maxInterventions: 4,     // enforced at readout
    failureBase:   0.10,     // base per-job infra failure probability
    failureScaleMult: { "70m": 0.6, "300m": 0.9, "1p4b": 1.3, "7b": 2.0 },
    killRefund:    0.5,      // fraction of UNSPENT compute returned on kill
    minHypothesisChars: 20
  };

  var NREF        = 7.0e7;   // reference scale for the effect law
  var TICK        = 0.25;    // one tick = 15 minutes
  var FAIL_CAP    = 0.45;    // failure probability cap
  var CI_Z        = 1.96;    // 95% two-sided normal quantile
  var MAX_SEEDS   = 16;      // sanity bound on the seed count
  var DAY_NAMES   = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  // Friday's readout gate (Team.GATES readout: day 5, hour 16).
  var DEADLINE    = { day: 5, hour: 16 };

  var FAIL_REASONS = [
    "preempted",
    "loss diverged (NaN at step ~X)",
    "OOM on shard 3",
    "dataloader deadlock",
    "checkpoint corrupt"
  ];

  var BUDGET_MARKS = [0.5, 0.75, 0.9, 1.0];

  /* -------------------------------------------------------------- helpers */

  function roundTo(x, d) {
    if (!isFinite(x)) return 0;
    var p = Math.pow(10, d);
    // .toFixed(6) first kills binary floating point dust (e.g. 0.1+0.2)
    return Math.round(Number((x * p).toFixed(6))) / p;
  }
  function round1(x) { return roundTo(x, 1); }
  function round2(x) { return roundTo(x, 2); }
  function round3(x) { return roundTo(x, 3); }
  function round4(x) { return roundTo(x, 4); }
  function round6(x) { return roundTo(x, 6); }

  function pad2(n) { n = Math.floor(n); return (n < 10 ? "0" : "") + n; }

  function clamp(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }

  function isNum(x) { return typeof x === "number" && isFinite(x); }

  /** GPU-hour figure for a human sentence: integers stay integers. */
  function gh(x) {
    var v = round2(x);
    if (Math.abs(v - Math.round(v)) < 1e-9) return String(Math.round(v));
    return String(round1(v));
  }

  function warnErr(e) {
    try {
      if (typeof console !== "undefined" && console && console.error) console.error(e);
    } catch (x) { /* ignore */ }
  }

  /** shallow copy, dropping every underscore-prefixed (private) key */
  function pub(o) {
    var out = {}, k;
    for (k in o) {
      if (!Object.prototype.hasOwnProperty.call(o, k)) continue;
      if (k.charAt(0) === "_") continue;
      var v = o[k];
      if (v && typeof v === "object" && !(v instanceof Function)) {
        if (Object.prototype.toString.call(v) === "[object Array]") out[k] = v.slice();
        else { var c = {}, kk; for (kk in v) if (Object.prototype.hasOwnProperty.call(v, kk)) c[kk] = v[kk]; out[k] = c; }
      } else out[k] = v;
    }
    return out;
  }

  function uniq(a) {
    var seen = {}, out = [], i;
    for (i = 0; i < a.length; i++) {
      if (!Object.prototype.hasOwnProperty.call(seen, a[i])) { seen[a[i]] = 1; out.push(a[i]); }
    }
    return out;
  }

  function has(arr, x) {
    for (var i = 0; i < arr.length; i++) if (arr[i] === x) return true;
    return false;
  }

  /* ----------------------------------------------------------------- PRNG */

  /** mulberry32 — small, fast, and exactly reproducible from a 32-bit seed. */
  function mulberry32(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) | 0;
      var t = s;
      t = Math.imul(t ^ (t >>> 15), 1 | t);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ================================================================== Lab */

  var Lab = {
    RULES: RULES,
    NREF: NREF,
    TICK: TICK,
    DEADLINE: DEADLINE,
    FAIL_REASONS: FAIL_REASONS.slice(),
    DEFAULT_SEED: 20260816,

    /* ---- internals (underscored; not part of the contract) --------- */
    _world: null,
    _truth: null,
    _rand: null,
    _listeners: null,
    _timer: null,
    _jobSeq: 0,
    _budgetMark: 0,

    /* ================================================== lifecycle ==== */

    /**
     * Lab.init({ world, seed })
     * world defaults to the global SIM_WORLD; seed defaults to 20260816.
     */
    init: function (opts) {
      opts = opts || {};
      var world = opts.world || (global && global.SIM_WORLD) || null;
      if (!world || !world.interventions || !world.scales || !world.stepOptions) {
        throw new Error("Lab.init: a SIM_WORLD with interventions, scales and stepOptions is required");
      }
      if (typeof world.reveal !== "function") {
        throw new Error("Lab.init: world.reveal() is required (the encoded ground truth)");
      }

      this._stopTimer();
      this._world = world;
      this._truth = world.reveal();      // <- the ONLY reveal() call in the codebase
      if (!this._truth || !this._truth.effects) {
        throw new Error("Lab.init: world.reveal() did not return an effects table");
      }

      this.seed = isNum(opts.seed) ? (opts.seed >>> 0) : this.DEFAULT_SEED;
      this._rand = mulberry32(this.seed);
      this._listeners = { tick: [], result: [], fail: [], deadline: [], budget: [] };
      this._jobSeq = 0;
      this._budgetMark = 0;

      this.elapsed = 0;                  // lab hours since Mon 09:00
      this.running = [];
      this.results = [];
      this.computeUsed = 0;
      this.computeRefunded = 0;
      this.computeCharged = 0;           // gross, before refunds
      this.finished = false;
      this.readoutSubmitted = false;
      this.readout = null;
      this.score = null;
      this.playing = false;
      this.speed = 1;

      return this.getState();
    },

    /** total lab hours in the week (days * hoursPerDay) */
    totalHours: function () { return RULES.days * RULES.hoursPerDay; },

    /** elapsed-hours coordinate of Friday's readout */
    deadlineHours: function () {
      return (DEADLINE.day - 1) * RULES.hoursPerDay + (DEADLINE.hour - RULES.startHour);
    },

    start: function () {
      if (!this._world) throw new Error("Lab.start: call Lab.init first");
      if (this.finished) return this.getState();
      this.playing = true;
      this._startTimer();
      return this.getState();
    },

    pause: function () {
      this.playing = false;
      this._stopTimer();
      return this.getState();
    },

    resume: function () {
      if (!this._world || this.finished) return this.getState();
      this.playing = true;
      this._startTimer();
      return this.getState();
    },

    setSpeed: function (mult) {
      var m = Number(mult);
      this.speed = (isFinite(m) && m > 0) ? m : 1;
      if (this.playing) this._startTimer();   // restart at the new cadence
      return this.getState();
    },

    /** wall-clock ms between ticks at the current speed */
    tickIntervalMs: function () { return 1000 / this.speed; },

    destroy: function () {
      this._stopTimer();
      this.playing = false;
      this._listeners = { tick: [], result: [], fail: [], deadline: [], budget: [] };
      this.running = [];
      this.results = [];
      this._world = null;
      this._truth = null;
    },

    _startTimer: function () {
      this._stopTimer();
      var self = this;
      if (typeof setInterval !== "function") return;
      this._timer = setInterval(function () {
        if (!self.playing) return;
        self.step();
      }, this.tickIntervalMs());
    },

    _stopTimer: function () {
      if (this._timer !== null && this._timer !== undefined) {
        if (typeof clearInterval === "function") clearInterval(this._timer);
        this._timer = null;
      }
    },

    /* ====================================================== events ==== */

    on: function (evt, fn) {
      if (!this._listeners) this._listeners = { tick: [], result: [], fail: [], deadline: [], budget: [] };
      if (!this._listeners[evt]) this._listeners[evt] = [];
      this._listeners[evt].push(fn);
      return this;
    },

    off: function (evt, fn) {
      if (!this._listeners || !this._listeners[evt]) return this;
      if (!fn) { this._listeners[evt] = []; return this; }
      var a = this._listeners[evt];
      for (var i = a.length - 1; i >= 0; i--) if (a[i] === fn) a.splice(i, 1);
      return this;
    },

    /** are there any listeners? lets hot paths skip building a state object */
    _hasListeners: function (evt) {
      return !!(this._listeners && this._listeners[evt] && this._listeners[evt].length);
    },

    _emit: function (evt, args) {
      if (!this._listeners || !this._listeners[evt]) return;
      var a = this._listeners[evt].slice();
      for (var i = 0; i < a.length; i++) {
        try { a[i].apply(null, args); }
        catch (e) { warnErr(e); }   // a bad listener must never stop the clock
      }
    },

    /* ======================================================== clock ==== */

    /** elapsed lab hours -> { day, hour, t } */
    stamp: function (elapsed) {
      var hpd = RULES.hoursPerDay;
      var e = round6(Math.max(0, elapsed));
      var day = Math.floor(e / hpd + 1e-9) + 1;
      var within = e - (day - 1) * hpd;
      if (within < 0) within = 0;
      var hour = round6(RULES.startHour + within);
      var hh = Math.floor(hour + 1e-9);
      var mm = Math.round((hour - hh) * 60);
      if (mm >= 60) { mm -= 60; hh += 1; }
      var name = DAY_NAMES[(day - 1) % DAY_NAMES.length] || ("D" + day);
      return { day: day, hour: hour, t: name + " " + pad2(hh) + ":" + pad2(mm) };
    },

    now: function () { return this.stamp(this.elapsed); },

    /** advance one 15-minute tick */
    step: function () {
      return this.advance(TICK);
    },

    /** fast-forward `hours`; jobs complete in chronological order */
    advance: function (hours) {
      if (this.readoutSubmitted) return this.getState();   // the week is over
      var h = Number(hours);
      if (!isFinite(h) || h <= 0) h = TICK;
      return this._advanceTo(this.elapsed + h);
    },

    _advanceTo: function (target) {
      var dl = this.deadlineHours();
      if (target > dl) target = dl;

      this._completeDue();

      var guard = 0;
      while (this.elapsed < target - 1e-9) {
        if (++guard > 200000) break;      // paranoia; must never trigger

        var next = target;

        // the next 15-minute boundary
        var nb = round6((Math.floor(this.elapsed / TICK + 1e-9) + 1) * TICK);
        if (nb < next - 1e-12) next = nb;

        // the next job reveal
        for (var i = 0; i < this.running.length; i++) {
          var ra = this.running[i]._revealAt;
          if (ra > this.elapsed + 1e-9 && ra < next - 1e-12) next = ra;
        }

        this.elapsed = round6(next);
        this._completeDue();
        if (this._hasListeners("tick")) this._emit("tick", [this.getState()]);
      }

      if (this.elapsed >= dl - 1e-9 && !this.finished) this._hitDeadline();
      return this.getState();
    },

    _hitDeadline: function () {
      this.finished = true;
      this.playing = false;
      this._stopTimer();
      // anything still on the cluster is worthless now: no refund, no result.
      while (this.running.length) {
        var job = this.running.shift();
        var res = this._finishJob(job, "killed", "unfinished at the readout deadline", this.jobProgress(job));
        this.results.push(res);
        if (this._hasListeners("fail")) this._emit("fail", [pub(res), this.getState()]);
      }
      this._emit("deadline", [this.getState()]);
    },

    /* ================================================= world lookup ==== */

    getWorld: function () { return this._world; },

    scaleById: function (id) {
      if (!this._world) return null;
      if (id && typeof id === "object" && id.id) id = id.id;
      var s = this._world.scales;
      for (var i = 0; i < s.length; i++) if (s[i].id === id) return s[i];
      return null;
    },

    stepsById: function (id) {
      if (!this._world) return null;
      if (id && typeof id === "object" && id.id) id = id.id;
      var s = this._world.stepOptions;
      for (var i = 0; i < s.length; i++) if (s[i].id === id) return s[i];
      return null;
    },

    interventionById: function (id) {
      if (!this._world) return null;
      var s = this._world.interventions;
      for (var i = 0; i < s.length; i++) if (s[i].id === id) return s[i];
      return null;
    },

    interventionIds: function () {
      var out = [], s = this._world ? this._world.interventions : [];
      for (var i = 0; i < s.length; i++) out.push(s[i].id);
      return out;
    },

    /* ============================================ the truth (private) == */

    /** solo effect of one intervention at scale N */
    _effectOf: function (id, N) {
      var e = this._truth.effects[id];
      if (!e) return 0;
      var c = isNum(e.c) ? e.c : 0;
      var a = isNum(e.a) ? e.a : 0;
      var g = isNum(e.gamma) ? e.gamma : 1;
      return c + a * Math.pow(NREF / N, g);
    },

    /** trueEffect(set, N) — solo terms plus every pairwise term whose BOTH
     *  members are in the set. Scale-independent interaction deltas. */
    _trueEffect: function (ids, N) {
      var sum = 0, i;
      var set = uniq(ids || []);
      for (i = 0; i < set.length; i++) sum += this._effectOf(set[i], N);
      var ix = (this._truth && this._truth.interactions) || [];
      for (i = 0; i < ix.length; i++) {
        var p = ix[i] && ix[i].pair;
        if (!p || p.length < 2) continue;
        if (has(set, p[0]) && has(set, p[1])) sum += (isNum(ix[i].delta) ? ix[i].delta : 0);
      }
      return sum;
    },

    /* ================================================== the model ==== */

    /** cost / wallHours / sigma — SPEC §2, implemented exactly. */
    _price: function (scale, steps, seeds) {
      var cost      = scale.computeHours * steps.mult * seeds;
      var wallHours = scale.wallHours * steps.mult;              // seeds are data-parallel
      var sigma     = scale.sigma / Math.sqrt(seeds) / Math.sqrt(steps.mult);
      return { cost: round2(cost), wallHours: round4(wallHours), sigma: round6(sigma) };
    },

    /** p = failureBase * failureScaleMult[scale] * steps.mult, capped */
    failureProb: function (scaleId, mult) {
      if (scaleId && typeof scaleId === "object" && scaleId.id) scaleId = scaleId.id;
      var m = RULES.failureScaleMult[scaleId];
      if (!isNum(m)) m = 1;
      return Math.min(FAIL_CAP, RULES.failureBase * m * mult);
    },

    /** N(0,1) via Box-Muller. Consumes EXACTLY two uniforms. */
    _gauss: function () {
      var u1 = 1 - this._rand();      // (0,1]
      var u2 = this._rand();          // [0,1)
      return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    },

    /* ================================================== validation ==== */

    /**
     * Resolve + validate a design. Returns { error } or the resolved parts.
     * Consumes no randomness and mutates nothing.
     */
    _resolve: function (req) {
      req = req || {};
      var ids = req.interventions;
      if (typeof ids === "string") ids = [ids];
      if (!ids || !ids.length) return { error: "Pick at least one intervention" };
      ids = uniq(ids);
      for (var i = 0; i < ids.length; i++) {
        if (!this.interventionById(ids[i])) return { error: "Unknown intervention: " + ids[i] };
      }

      var scale = this.scaleById(req.scale);
      if (!scale) return { error: "Unknown scale: " + String(req.scale) };

      var stepsId = (req.steps === undefined || req.steps === null) ? "std" : req.steps;
      var steps = this.stepsById(stepsId);
      if (!steps) return { error: "Unknown steps option: " + String(req.steps) };

      var seeds = (req.seeds === undefined || req.seeds === null) ? 1 : Number(req.seeds);
      if (!isFinite(seeds) || Math.floor(seeds) !== seeds || seeds < 1 || seeds > MAX_SEEDS) {
        return { error: "Seeds must be a whole number between 1 and " + MAX_SEEDS };
      }

      return { interventions: ids, scale: scale, steps: steps, seeds: seeds };
    },

    /* ====================================================== design ==== */

    /**
     * Lab.design({ interventions, scale, steps, seeds })
     *   -> { ok:true, cost, wallHours, sigma, etaDay, etaHour, ... }
     *   -> { ok:false, error }
     *
     * A PRICING PREVIEW. Absolutely no side effects and no PRNG consumption:
     * calling it a thousand times cannot perturb a later launch.
     */
    design: function (req) {
      if (!this._world) return { ok: false, error: "The lab is not initialised" };
      var r = this._resolve(req);
      if (r.error) return { ok: false, error: r.error };

      var p     = this._price(r.scale, r.steps, r.seeds);
      var eta   = this.stamp(this.elapsed + p.wallHours);
      var rem   = this.computeRemaining();
      var free  = RULES.slots - this.running.length;
      var late  = (this.elapsed + p.wallHours) > this.deadlineHours() + 1e-9;

      var warning = null;
      if (this.readoutSubmitted) warning = "The readout is already submitted";
      else if (free <= 0) warning = "No free slots — you have " + this.running.length + " jobs running";
      else if (p.cost > rem + 1e-9) warning = "Not enough compute — that costs " + gh(p.cost) + " GPU-hours, you have " + gh(rem);
      else if (late) warning = "It won't finish before Friday's readout";

      return {
        ok: true,
        interventions: r.interventions.slice(),
        scale: r.scale.id,
        steps: r.steps.id,
        seeds: r.seeds,
        cost: p.cost,
        wallHours: p.wallHours,
        sigma: p.sigma,
        ci95: round4(CI_Z * p.sigma),           // half-width of the 95% CI you are buying
        etaDay: eta.day,
        etaHour: eta.hour,
        etaT: eta.t,
        failureProb: round4(this.failureProb(r.scale.id, r.steps.mult)),
        computeRemainingAfter: round2(rem - p.cost),
        affordable: p.cost <= rem + 1e-9,
        slotsFree: Math.max(0, free),
        beforeDeadline: !late,
        wouldReject: warning !== null,
        warning: warning
      };
    },

    /* ====================================================== launch ==== */

    /**
     * Lab.launch({ interventions, scale, steps, seeds,
     *              hypothesis, predictedEffect, ciLow, ciHigh })
     *   -> { ok:true, job } | { ok:false, error }
     *
     * Everything random about the job is drawn HERE, at launch: whether infra
     * eats it, when the failure surfaces, why, and the noise on the answer.
     * That makes the session replay identically no matter how the player
     * drives the clock afterwards.
     */
    launch: function (req) {
      if (!this._world) return { ok: false, error: "The lab is not initialised" };
      if (this.readoutSubmitted) return { ok: false, error: "The readout is already submitted" };

      var r = this._resolve(req);
      if (r.error) return { ok: false, error: r.error };
      req = req || {};

      var hyp = (req.hypothesis === undefined || req.hypothesis === null) ? "" : String(req.hypothesis);
      if (hyp.replace(/\s+/g, " ").trim().length < RULES.minHypothesisChars) {
        return { ok: false, error: "Hypothesis required" };
      }

      var pred = Number(req.predictedEffect);
      var lo = Number(req.ciLow), hi = Number(req.ciHigh);
      if (!isNum(pred) || !isNum(lo) || !isNum(hi) || !(lo < hi)) {
        return { ok: false, error: "Predicted effect required" };
      }

      if (this.running.length >= RULES.slots) {
        return { ok: false, error: "No free slots — you have " + this.running.length + " jobs running" };
      }

      var p = this._price(r.scale, r.steps, r.seeds);
      var rem = this.computeRemaining();
      if (p.cost > rem + 1e-9) {
        return { ok: false, error: "Not enough compute — that costs " + gh(p.cost) + " GPU-hours, you have " + gh(rem) };
      }

      var etaEl = round6(this.elapsed + p.wallHours);
      if (etaEl > this.deadlineHours() + 1e-9) {
        return { ok: false, error: "It won't finish before Friday's readout" };
      }

      /* ---- draws, in a fixed order (see the determinism contract) ---- */
      var failP = this.failureProb(r.scale.id, r.steps.mult);
      var failed = this._rand() < failP;
      var failFrac = 0, failReason = null, obs = 0;

      if (failed) {
        failFrac = round6(0.2 + 0.7 * this._rand());              // uniform 0.2 .. 0.9
        var ri = Math.floor(this._rand() * FAIL_REASONS.length);
        if (ri >= FAIL_REASONS.length) ri = FAIL_REASONS.length - 1;
        var stepGuess = Math.floor(this._rand() * 9 + 1) * 500;   // always drawn: fixed stream shape
        failReason = FAIL_REASONS[ri].replace("~X", "~" + stepGuess);
      } else {
        var truth = this._trueEffect(r.interventions, r.scale.params);
        obs = round4(truth + this._gauss() * p.sigma);
      }

      var launchedAt = this.stamp(this.elapsed);
      var etaAt = this.stamp(etaEl);

      var job = {
        id: "J" + (++this._jobSeq),
        interventions: r.interventions.slice(),
        scale: r.scale.id,
        scaleLabel: r.scale.label,
        steps: r.steps.id,
        stepsLabel: r.steps.label,
        seeds: r.seeds,
        cost: p.cost,
        wallHours: p.wallHours,
        sigma: p.sigma,
        launchedAt: { day: launchedAt.day, hour: launchedAt.hour, t: launchedAt.t },
        etaAt: { day: etaAt.day, hour: etaAt.hour, t: etaAt.t },
        progress: 0,
        hypothesis: hyp,
        predictedEffect: pred,
        ciLow: lo,
        ciHigh: hi,

        _jobIdx: this._jobSeq,          // stable tie-break for simultaneous reveals
        _launchEl: this.elapsed,
        _etaEl: etaEl,
        _revealAt: failed ? round6(this.elapsed + p.wallHours * failFrac) : etaEl,
        _failed: failed,
        _failFrac: failFrac,
        _failReason: failReason,
        _obs: obs
      };

      this.computeUsed = round2(this.computeUsed + p.cost);
      this.computeCharged = round2(this.computeCharged + p.cost);
      this.running.push(job);
      this._checkBudget();

      return { ok: true, job: pub(job) };
    },

    /* ======================================================== kill ==== */

    /** Kill a running job. Refunds killRefund * the UNSPENT compute. */
    kill: function (jobId) {
      if (!this._world) return { ok: false, error: "The lab is not initialised" };
      var idx = -1;
      for (var i = 0; i < this.running.length; i++) if (this.running[i].id === jobId) { idx = i; break; }
      if (idx < 0) return { ok: false, error: "No such running job: " + String(jobId) };

      var job = this.running[idx];
      var prog = this.jobProgress(job);
      var refund = round2(RULES.killRefund * job.cost * (1 - prog));
      this.computeUsed = round2(this.computeUsed - refund);
      this.computeRefunded = round2(this.computeRefunded + refund);

      this.running.splice(idx, 1);
      var res = this._finishJob(job, "killed", "killed by you at " + Math.round(prog * 100) + "% complete", prog);
      res.refund = refund;
      this.results.push(res);
      this._emit("fail", [pub(res), this.getState()]);
      return { ok: true, refund: refund, result: pub(res), progress: round4(prog) };
    },

    /* ================================================== completion ==== */

    jobProgress: function (job) {
      if (!job.wallHours) return 1;
      return clamp((this.elapsed - job._launchEl) / job.wallHours, 0, 1);
    },

    _completeDue: function () {
      var due = [], i;
      for (i = 0; i < this.running.length; i++) {
        if (this.running[i]._revealAt <= this.elapsed + 1e-9) due.push(this.running[i]);
      }
      if (!due.length) return;
      due.sort(function (a, b) {
        if (a._revealAt !== b._revealAt) return a._revealAt - b._revealAt;
        return a._jobIdx - b._jobIdx;
      });
      for (i = 0; i < due.length; i++) this._completeJob(due[i]);
    },

    _completeJob: function (job) {
      for (var i = 0; i < this.running.length; i++) {
        if (this.running[i] === job) { this.running.splice(i, 1); break; }
      }

      var res;
      if (job._failed) {
        // refund the compute the job never got to burn
        var refund = round2(job.cost * (1 - job._failFrac));
        this.computeUsed = round2(this.computeUsed - refund);
        this.computeRefunded = round2(this.computeRefunded + refund);
        res = this._finishJob(job, "failed", job._failReason, job._failFrac);
        res.refund = refund;
        this.results.push(res);
        this._checkBudget();
        if (this._hasListeners("fail")) this._emit("fail", [pub(res), this.getState()]);
      } else {
        res = this._finishJob(job, "ok", null, 1);
        res.observedEffect = job._obs;
        res.ciLow95 = round4(job._obs - CI_Z * job.sigma);
        res.ciHigh95 = round4(job._obs + CI_Z * job.sigma);
        res.crossesZero = (res.ciLow95 <= 0 && res.ciHigh95 >= 0);
        this.results.push(res);
        if (this._hasListeners("result")) this._emit("result", [pub(res), this.getState()]);
      }
      return res;
    },

    /** Result = { ...Job, status, failReason, observed..., finishedAt } */
    _finishJob: function (job, status, failReason, progress) {
      var fin = this.stamp(this.elapsed);
      var res = pub(job);
      res.status = status;
      res.failReason = failReason || null;
      res.progress = round4(progress);
      res.observedEffect = null;
      res.ciLow95 = null;
      res.ciHigh95 = null;
      res.crossesZero = false;
      res.refund = 0;
      res.finishedAt = { day: fin.day, hour: fin.hour, t: fin.t };
      res._launchEl = job._launchEl;
      res._etaEl = job._etaEl;
      res._revealEl = job._revealAt;
      return res;
    },

    /* ======================================================= state ==== */

    computeRemaining: function () { return round2(RULES.computeBudget - this.computeUsed); },

    _checkBudget: function () {
      var frac = this.computeUsed / RULES.computeBudget;
      while (this._budgetMark < BUDGET_MARKS.length && frac >= BUDGET_MARKS[this._budgetMark] - 1e-9) {
        var mark = BUDGET_MARKS[this._budgetMark];
        this._budgetMark++;
        if (!this._hasListeners("budget")) continue;
        this._emit("budget", [{
          mark: mark,
          used: this.computeUsed,
          remaining: this.computeRemaining(),
          pct: round1(frac * 100)
        }, this.getState()]);
      }
    },

    getState: function () {
      var now = this.stamp(this.elapsed);
      var runOut = [], i;
      for (i = 0; i < this.running.length; i++) {
        var j = pub(this.running[i]);
        j.progress = round4(this.jobProgress(this.running[i]));
        j.hoursLeft = round4(Math.max(0, this.running[i]._etaEl - this.elapsed));
        runOut.push(j);
      }
      var resOut = [];
      for (i = 0; i < this.results.length; i++) resOut.push(pub(this.results[i]));

      return {
        day: now.day,
        hour: now.hour,
        t: now.t,
        tick: Math.floor(this.elapsed / TICK + 1e-9),
        elapsedHours: round4(this.elapsed),
        computeUsed: round2(this.computeUsed),
        computeRemaining: this.computeRemaining(),
        computeRefunded: round2(this.computeRefunded),
        budgetPct: round1(this.computeUsed / RULES.computeBudget * 100),
        slotsUsed: this.running.length,
        slotsFree: Math.max(0, RULES.slots - this.running.length),
        running: runOut,
        results: resOut,
        finished: this.finished,
        readoutSubmitted: this.readoutSubmitted,
        deadline: { day: DEADLINE.day, hour: DEADLINE.hour, t: this.stamp(this.deadlineHours()).t },
        hoursToDeadline: round4(Math.max(0, this.deadlineHours() - this.elapsed)),
        playing: this.playing,
        speed: this.speed,
        seed: this.seed
      };
    },

    getResults: function () {
      var out = [];
      for (var i = 0; i < this.results.length; i++) out.push(pub(this.results[i]));
      return out;
    },

    getScore: function () { return this.score ? pub(this.score) : null; },

    /* ==================================================== scoring ==== */

    /** every non-empty subset of ids with size <= k */
    _subsets: function (ids, k) {
      var out = [];
      var n = ids.length;
      var total = 1 << n;
      for (var m = 1; m < total; m++) {
        var set = [], bits = 0;
        for (var b = 0; b < n; b++) {
          if (m & (1 << b)) { set.push(ids[b]); bits++; }
        }
        if (bits <= k) out.push(set);
      }
      return out;
    },

    /**
     * Lab.submitReadout({ interventions, confidence, rationale }) -> Score
     * (or { ok:false, error })
     */
    submitReadout: function (req) {
      if (!this._world) return { ok: false, error: "The lab is not initialised" };
      if (this.readoutSubmitted) return { ok: false, error: "The readout is already submitted" };
      req = req || {};

      var ids = req.interventions;
      if (typeof ids === "string") ids = [ids];
      if (!ids || !ids.length) return { ok: false, error: "Pick at least one intervention" };
      ids = uniq(ids);
      for (var i = 0; i < ids.length; i++) {
        if (!this.interventionById(ids[i])) return { ok: false, error: "Unknown intervention: " + ids[i] };
      }
      if (ids.length > RULES.maxInterventions) {
        return { ok: false, error: "You can recommend at most " + RULES.maxInterventions + " interventions" };
      }

      var runScale = (this._world.scenario && this._world.scenario.runScale) || 7.0e10;
      var maxK = (this._world.scenario && this._world.scenario.maxInterventions) || RULES.maxInterventions;

      /* ---- what they shipped, and what they could have shipped ------ */
      var chosenTrue = this._trueEffect(ids, runScale);

      var all = this.interventionIds();
      var subs = this._subsets(all, maxK);
      var bestVal = -Infinity, bestSet = [];
      for (i = 0; i < subs.length; i++) {
        var v = this._trueEffect(subs[i], runScale);
        if (v > bestVal + 1e-12) { bestVal = v; bestSet = subs[i].slice(); }
      }

      var regret = bestVal - chosenTrue;
      if (regret < 0) regret = 0;                 // can't beat the brute-force optimum
      var ratio = bestVal > 1e-12 ? (regret / bestVal) : (regret > 1e-12 ? 1 : 0);

      var grade = ratio < 0.10 ? "A" : ratio < 0.25 ? "B" : ratio < 0.45 ? "C" : ratio < 0.70 ? "D" : "F";

      /* ---- the cardinal sin: shipping a regression into the big run - */
      var shippedRegression = false;
      for (i = 0; i < ids.length; i++) {
        if (this._effectOf(ids[i], runScale) < 0) { shippedRegression = true; break; }
      }
      if (shippedRegression && (grade === "A" || grade === "B")) grade = "C";

      /* ---- good ones left on the floor ------------------------------ */
      var missed = [];
      for (i = 0; i < bestSet.length; i++) if (!has(ids, bestSet[i])) missed.push(bestSet[i]);

      /* ---- calibration, over their own successful experiments ------- */
      var cal = this._calibration();

      /* ---- per intervention ----------------------------------------- */
      var per = [];
      for (i = 0; i < all.length; i++) {
        var id = all[i];
        var truthAt = round4(this._effectOf(id, runScale));
        var chosen = has(ids, id);
        var inBest = has(bestSet, id);
        var verdict;
        if (chosen && truthAt < 0) verdict = "shipped a regression";
        else if (chosen && inBest) verdict = "correct — kept a winner";
        else if (chosen) verdict = "positive, but not top-" + maxK;
        else if (inBest) verdict = "missed — should have shipped it";
        else if (truthAt < 0) verdict = "correctly skipped a regression";
        else verdict = "correctly left out";

        per.push({
          id: id,
          name: (this.interventionById(id) || {}).name || id,
          believed: this._believed(id),
          tested: this._testCount(id),
          truthAtRunScale: truthAt,
          chosen: chosen,
          inBestSet: inBest,
          verdict: verdict,
          note: (this._truth.notes && this._truth.notes[id]) || null
        });
      }

      var spent = round2(this.computeUsed);
      var score = {
        ok: true,
        chosen: ids.slice(),
        confidence: isNum(Number(req.confidence)) ? Number(req.confidence) : null,
        rationale: req.rationale ? String(req.rationale) : "",
        runScale: runScale,
        trueEffectAtRunScale: round4(chosenTrue),
        bestPossible: round4(bestVal),
        bestSet: bestSet.slice(),
        regret: round4(regret),
        regretRatio: round4(ratio),
        grade: grade,
        shippedRegression: shippedRegression,
        missed: missed,
        computeSpent: spent,
        computeCharged: round2(this.computeCharged),
        computeRefunded: round2(this.computeRefunded),
        computeWastedOnFailures: round2(this._failedSpend()),
        computeEfficiency: spent > 0 ? round3(chosenTrue / (spent / 1000)) : 0,
        experiments: this.results.length,
        calibration: cal,
        perIntervention: per,
        submittedAt: { day: this.stamp(this.elapsed).day, hour: this.stamp(this.elapsed).hour, t: this.stamp(this.elapsed).t }
      };

      this.readout = { interventions: ids.slice(), confidence: score.confidence, rationale: score.rationale };
      this.readoutSubmitted = true;
      this.finished = true;
      this.playing = false;
      this._stopTimer();
      this.score = score;
      return pub(score);
    },

    /** compute actually consumed by jobs that failed or were killed */
    _failedSpend: function () {
      var s = 0;
      for (var i = 0; i < this.results.length; i++) {
        var r = this.results[i];
        if (r.status === "ok") continue;
        s += r.cost - (r.refund || 0);
      }
      return s;
    },

    /** inverse-variance weighted mean of the player's SOLO measurements */
    _believed: function (id) {
      var wsum = 0, num = 0;
      for (var i = 0; i < this.results.length; i++) {
        var r = this.results[i];
        if (r.status !== "ok") continue;
        if (r.interventions.length !== 1 || r.interventions[0] !== id) continue;
        var w = 1 / (r.sigma * r.sigma);
        wsum += w; num += w * r.observedEffect;
      }
      return wsum > 0 ? round4(num / wsum) : null;
    },

    _testCount: function (id) {
      var n = 0;
      for (var i = 0; i < this.results.length; i++) {
        var r = this.results[i];
        if (r.status !== "ok") continue;
        if (has(r.interventions, id)) n++;
      }
      return n;
    },

    /**
     * Calibration: for every successful experiment, did the TRUTH at the
     * scale they ran fall inside the CI they stated before launching?
     */
    _calibration: function () {
      var n = 0, hits = 0, abs = 0, signed = 0;
      var rows = [];
      for (var i = 0; i < this.results.length; i++) {
        var r = this.results[i];
        if (r.status !== "ok") continue;
        var sc = this.scaleById(r.scale);
        var truth = this._trueEffect(r.interventions, sc.params);
        var hit = (truth >= r.ciLow && truth <= r.ciHigh);
        var err = r.predictedEffect - truth;
        n++;
        if (hit) hits++;
        abs += Math.abs(err);
        signed += err;
        rows.push({
          jobId: r.id,
          interventions: r.interventions.slice(),
          scale: r.scale,
          predicted: r.predictedEffect,
          ciLow: r.ciLow,
          ciHigh: r.ciHigh,
          observed: r.observedEffect,
          truth: round4(truth),
          error: round4(err),
          hit: hit
        });
      }
      var hitRate = n ? round4(hits / n) : 0;
      return {
        n: n,
        hits: hits,
        hitRate: hitRate,
        meanAbsError: n ? round4(abs / n) : 0,
        bias: n ? round4(signed / n) : 0,
        overconfident: n > 0 && hitRate < 0.5,
        rows: rows
      };
    },

    /* ================================================== the debrief ==== */

    /**
     * Ground truth for the debrief screen. Returns null until the readout is
     * submitted — no module may see this before then.
     * `curve(id)` gives plots.js the smooth true-effect function.
     */
    getDebrief: function () {
      if (!this.readoutSubmitted) return null;
      var self = this, out = { runScale: (this._world.scenario || {}).runScale || 7.0e10, interventions: [], interactions: [] };
      var ids = this.interventionIds();
      for (var i = 0; i < ids.length; i++) {
        (function (id) {
          out.interventions.push({
            id: id,
            name: (self.interventionById(id) || {}).name || id,
            note: (self._truth.notes && self._truth.notes[id]) || null,
            truthAtRunScale: round4(self._effectOf(id, out.runScale)),
            fn: function (N) { return self._effectOf(id, N); }
          });
        })(ids[i]);
      }
      var ix = this._truth.interactions || [];
      for (i = 0; i < ix.length; i++) out.interactions.push({ pair: ix[i].pair.slice(), delta: ix[i].delta });
      out.score = this.score ? pub(this.score) : null;
      return out;
    },

    /* ==================================================== markdown ==== */

    /**
     * Lab.exportReadout() -> markdown for pasting into chat.
     * CONTAINS NO GROUND TRUTH: only what the player predicted, what the
     * cluster observed, and what it cost.
     */
    exportReadout: function () {
      if (!this._world) return "";
      var sc = this._world.scenario || {};
      var metric = (sc.metric && sc.metric.name) || "effect";
      var L = [], i;

      L.push("# Readout — " + (sc.team || "pretraining") + " / " + (sc.org || ""));
      L.push("");
      L.push("**Question:** " + (sc.question || "(not stated)"));
      L.push("**Run scale:** " + fmtParams(sc.runScale || 7.0e10));
      L.push("**Metric:** " + metric + (sc.metric && sc.metric.units ? " (" + sc.metric.units + ")" : ""));
      L.push("**Submitted:** " + (this.readoutSubmitted ? this.stamp(this.elapsed).t : "NOT YET SUBMITTED — draft"));
      L.push("");

      L.push("## Recommendation");
      L.push("");
      if (this.readout && this.readout.interventions.length) {
        for (i = 0; i < this.readout.interventions.length; i++) {
          var iv = this.interventionById(this.readout.interventions[i]) || { id: this.readout.interventions[i] };
          L.push((i + 1) + ". **" + (iv.name || iv.id) + "** (`" + (iv.id) + "`)");
        }
        L.push("");
        if (this.readout.confidence !== null && this.readout.confidence !== undefined) {
          L.push("Confidence: **" + this.readout.confidence + "**");
          L.push("");
        }
        L.push(this.readout.rationale || "_(no rationale given)_");
      } else {
        L.push("_No recommendation submitted yet._");
      }
      L.push("");

      /* ------------------------------------------------- experiments -- */
      L.push("## Experiments (" + this.results.length + " finished, " + this.running.length + " still running)");
      L.push("");
      L.push("| # | interventions | scale | steps | seeds | GPU-h | sigma | predicted (CI) | observed (95% CI) | status |");
      L.push("|---|---|---|---|---|---|---|---|---|---|");
      var rows = this.results.concat([]);
      for (i = 0; i < rows.length; i++) {
        var r = rows[i];
        var predS = fmtNum(r.predictedEffect) + " [" + fmtNum(r.ciLow) + ", " + fmtNum(r.ciHigh) + "]";
        var obsS = (r.status === "ok")
          ? fmtNum(r.observedEffect) + " [" + fmtNum(r.ciLow95) + ", " + fmtNum(r.ciHigh95) + "]"
          : "—";
        var stat = r.status === "ok" ? "ok" : (r.status + ": " + (r.failReason || ""));
        L.push("| " + r.id + " | " + r.interventions.join(" + ") + " | " + (r.scaleLabel || r.scale) +
               " | " + (r.stepsLabel || r.steps) + " | " + r.seeds + " | " + gh(r.cost) +
               " | " + fmtNum(r.sigma) + " | " + predS + " | " + obsS + " | " + stat + " |");
      }
      if (!rows.length) L.push("| — | _no experiments finished_ | | | | | | | | |");
      L.push("");

      /* ------------------------------------------------- hypotheses --- */
      L.push("### Hypotheses");
      L.push("");
      for (i = 0; i < rows.length; i++) {
        L.push("- **" + rows[i].id + "** (" + rows[i].interventions.join(" + ") + " @ " +
               (rows[i].scaleLabel || rows[i].scale) + "): " + rows[i].hypothesis);
      }
      if (!rows.length) L.push("- _none_");
      L.push("");

      /* ------------------------------------------------- compute ------ */
      var wasted = this._failedSpend();
      var pct = this.computeUsed > 0 ? round1(wasted / this.computeUsed * 100) : 0;
      L.push("## Compute");
      L.push("");
      L.push("- Budget: **" + gh(RULES.computeBudget) + "** GPU-hours");
      L.push("- Spent (net of refunds): **" + gh(this.computeUsed) + "** (" + round1(this.computeUsed / RULES.computeBudget * 100) + "%)");
      L.push("- Charged before refunds: " + gh(this.computeCharged) + ", refunded " + gh(this.computeRefunded));
      L.push("- Burned on failed or killed jobs: **" + gh(wasted) + "** GPU-hours (" + pct + "% of spend)");
      L.push("");

      /* ------------------------------------------------- calibration -- */
      // Observed-based ONLY: comparing against the truth would leak it.
      var n = 0, hits = 0, abs = 0, signed = 0;
      L.push("## Calibration (predicted vs measured)");
      L.push("");
      L.push("| # | predicted | stated CI | observed | error | inside stated CI |");
      L.push("|---|---|---|---|---|---|");
      for (i = 0; i < rows.length; i++) {
        var rr = rows[i];
        if (rr.status !== "ok") continue;
        var hit = (rr.observedEffect >= rr.ciLow && rr.observedEffect <= rr.ciHigh);
        var e = rr.predictedEffect - rr.observedEffect;
        n++; if (hit) hits++; abs += Math.abs(e); signed += e;
        L.push("| " + rr.id + " | " + fmtNum(rr.predictedEffect) + " | [" + fmtNum(rr.ciLow) + ", " + fmtNum(rr.ciHigh) +
               "] | " + fmtNum(rr.observedEffect) + " | " + fmtSigned(e) + " | " + (hit ? "yes" : "no") + " |");
      }
      if (!n) L.push("| — | _no successful experiments_ | | | | |");
      L.push("");
      if (n) {
        L.push("- Hit rate: **" + round2(hits / n) + "** (" + hits + "/" + n + ")");
        L.push("- Mean absolute error: **" + fmtNum(abs / n) + "** " + metric + " points");
        L.push("- Signed bias: **" + fmtSigned(signed / n) + "** (positive = you predicted more than you measured)");
      }
      L.push("");
      L.push("_Ground truth is not in this document._");
      return L.join("\n");
    }
  };

  /* --------------------------------------------------- tiny formatters -- */

  function fmtNum(x) {
    if (x === null || x === undefined || !isFinite(x)) return "—";
    return (Math.round(x * 100) / 100).toFixed(2);
  }
  function fmtSigned(x) {
    if (x === null || x === undefined || !isFinite(x)) return "—";
    var v = Math.round(x * 100) / 100;
    return (v > 0 ? "+" : "") + v.toFixed(2);
  }
  function fmtParams(n) {
    if (n >= 1e12) return (n / 1e12) + "T";
    if (n >= 1e9) return (n / 1e9) + "B";
    if (n >= 1e6) return (n / 1e6) + "M";
    return String(n);
  }

  /* ------------------------------------------------------------- export */

  var host = (typeof window !== "undefined" && window) ? window : global;
  host.Lab = Lab;

})(typeof globalThis !== "undefined" ? globalThis : this);
