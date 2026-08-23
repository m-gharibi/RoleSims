/* ==========================================================================
 * sim/dev.js  —  window.Dev
 *
 * Junior Software Engineer Sim: the clock, understanding, the senior-attention
 * budget, trust, PR review, and scoring.
 *
 * PURE LOGIC. No DOM access whatsoever. Loads via a plain <script src> tag from
 * a file:// page; no modules, no imports, no libraries, no build step.
 * Unit-testable under node with `global.window = global; require(...)`.
 *
 * Implements SPEC.md §2 exactly. Do not deviate: board.js, squad.js and ui.js
 * are built against this API.
 *
 * THIS IS THE ONLY FILE PERMITTED TO CALL `SIM_REPO.reveal()`. The ground truth
 * is read once at init and never leaves this module except through
 *   - resolved actions (an understanding delta and a non-specific note),
 *   - review comments (which the reviewer says out loud, in game), and
 *   - the end-of-sprint Score (the debrief).
 * `exportRetro()` contains no ground truth at all.
 *
 * ---------------------------------------------------------------------------
 * THREE PLACES WHERE THE SPEC IS SILENT AND THIS MODULE DECIDES. Documented
 * here because other modules and the tests pin them.
 *
 *  1. CHANNEL TRUST. `to:"channel"` is public, costs no senior budget and
 *     "less trust either way". #eng-help is not a person, so the halved delta
 *     lands on the one person who is always reading it and forming a delivery
 *     opinion: Tobias, the lead. See CHANNEL_TRUST_TO.
 *
 *  2. SENIOR-BUDGET COSTS. RULES gives askCostMinutes (yours) and
 *     vagueAskExtraMinutes ("Deepa has to dig, and it costs her budget too"),
 *     and says a well-formed ask "costs half the senior budget of a premature
 *     ask". So: premature = 15 + 30 = 45 min of her time, well-formed = 22.5,
 *     overdue = 15 + 30/2 = 30 (the question is fine, the context is a mess).
 *
 *  3. THE RELENT. §2 says a PR merges only at `understanding >= correctAt`,
 *     and §"Scoring" says the grade is capped at C for "merging a PR at
 *     understanding < correctAt via repeated resubmission without new
 *     investigation". Both can only be true if resubmission eventually wears
 *     the reviewer down. It does — narrowly. After RELENT_AFTER bounces, a
 *     resubmission with ZERO new investigation since the last one and EVERY
 *     other gate green gets stamped through, flagged `relented`, and it caps
 *     the grade at C. That is the cardinal sin, made reachable on purpose.
 * ========================================================================== */
;(function (global) {
  "use strict";

  /* ---------------------------------------------------------------- rules */

  var RULES = {
    days: 10, hoursPerDay: 6, totalHours: 60, tickMinutes: 15,
    seniorBudgetHours: 10,
    startTrust: 55, minTrust: 0, maxTrust: 100,
    implementReadyAt: 70,        // understanding needed to open a PR at all
    correctAt: 90,               // understanding for a PR that survives review
    reviewLagHours: { min: 2, max: 5 },
    askCostMinutes: 15,          // your time
    vagueAskExtraMinutes: 30,    // Deepa has to dig, and it costs her budget too
    stuckHours: 3,               // no understanding gained for this long = stuck
    minQuestionChars: 25,
    estimateRequired: true
  };

  /* Model constants that are not part of the RULES contract. Exposed on Dev
   * so the UI and the tests can read them. */
  var DEFAULT_SEED    = 20260823;
  var DAY_START_HOUR  = 9;          // the working day is 09:00 -> 15:00
  var MAX_UNDERSTANDING = 120;      // total understanding clamps to [0, 120]
  var ASK_TARGETS     = ["deepa", "hannah", "channel"];

  var TRUST_PREMATURE     = -6;
  var TRUST_WELLFORMED    = 4;
  var TRUST_OVERDUE       = -3;
  var TRUST_BOUNCE        = -2;     // per bounce, with the reviewer
  var TRUST_MERGE         = 3;      // reviewer, on a clean merge
  var TRUST_MERGE_LEAD    = 2;      // lead, on a clean merge
  var TRUST_ABANDON_RIGHT = 5;      // handing back a misfiled ticket is a contribution
  var TRUST_ABANDON_WRONG = -5;

  var CHANNEL_TRUST_FACTOR = 0.5;   // see note 1 at the top of the file
  var CHANNEL_TRUST_TO     = "tobias";

  /* senior-budget minutes per ask classification — see note 2 */
  var SENIOR_MINUTES = {
    "premature":   RULES.askCostMinutes + RULES.vagueAskExtraMinutes,        // 45
    "well-formed": (RULES.askCostMinutes + RULES.vagueAskExtraMinutes) / 2,  // 22.5
    "overdue":     RULES.askCostMinutes + RULES.vagueAskExtraMinutes / 2     // 30
  };
  /* your own minutes per ask classification */
  var PLAYER_ASK_MINUTES = {
    "premature":   RULES.askCostMinutes + RULES.vagueAskExtraMinutes,        // 45
    "well-formed": RULES.askCostMinutes,                                     // 15
    "overdue":     RULES.askCostMinutes                                      // 15
  };

  var TESTS_MINUTES = 45;

  var CHANNEL_DELAY_MIN  = 30;
  var CHANNEL_DELAY_MAX  = 120;
  var CHANNEL_DELAY_MEAN = 75;
  var CHANNEL_DELAY_SD   = 20;

  var RELENT_AFTER = 2;             // see note 3

  var GRADE_WEIGHTS = { delivery: 0.5, escalation: 0.3, trust: 0.2 };
  var GRADE_CUTS    = [[0.85, "A"], [0.70, "B"], [0.55, "C"], [0.40, "D"]];

  /* escalation credit per verdict */
  var ESCALATION_CREDIT = { right: 1, late: 0.4, early: 0.3, never: 0 };

  /* -------------------------------------------------------------- helpers */

  function roundTo(x, d) {
    if (!isFinite(x)) return 0;
    var p = Math.pow(10, d);
    return Math.round(Number((x * p).toFixed(6))) / p;
  }
  function round1(x) { return roundTo(x, 1); }
  function round2(x) { return roundTo(x, 2); }
  function round4(x) { return roundTo(x, 4); }

  function isNum(x) { return typeof x === "number" && isFinite(x); }
  function num(x) { return isNum(x) ? x : (isFinite(Number(x)) ? Number(x) : 0); }
  function clamp(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }

  function has(arr, x) {
    if (!arr) return false;
    for (var i = 0; i < arr.length; i++) if (arr[i] === x) return true;
    return false;
  }

  function pad2(n) { return (n < 10 ? "0" : "") + n; }

  function warnErr(e) {
    try {
      if (typeof console !== "undefined" && console && console.error) console.error(e);
    } catch (x) { /* ignore */ }
  }

  function h1(x) { return round1(x).toFixed(1); }
  function sgn(x) { return (x > 0 ? "+" : "") + round1(x); }

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

  /* ================================================================== Dev */

  var Dev = {
    RULES: RULES,
    DEFAULT_SEED: DEFAULT_SEED,
    DAY_START_HOUR: DAY_START_HOUR,
    MAX_UNDERSTANDING: MAX_UNDERSTANDING,
    ASK_TARGETS: ASK_TARGETS.slice(),
    SENIOR_MINUTES: SENIOR_MINUTES,
    PLAYER_ASK_MINUTES: PLAYER_ASK_MINUTES,
    TESTS_MINUTES: TESTS_MINUTES,
    TRUST_PREMATURE: TRUST_PREMATURE,
    TRUST_WELLFORMED: TRUST_WELLFORMED,
    TRUST_OVERDUE: TRUST_OVERDUE,
    TRUST_BOUNCE: TRUST_BOUNCE,
    TRUST_MERGE: TRUST_MERGE,
    TRUST_MERGE_LEAD: TRUST_MERGE_LEAD,
    TRUST_ABANDON_RIGHT: TRUST_ABANDON_RIGHT,
    TRUST_ABANDON_WRONG: TRUST_ABANDON_WRONG,
    CHANNEL_TRUST_FACTOR: CHANNEL_TRUST_FACTOR,
    CHANNEL_TRUST_TO: CHANNEL_TRUST_TO,
    RELENT_AFTER: RELENT_AFTER,
    GRADE_WEIGHTS: GRADE_WEIGHTS,
    ESCALATION_CREDIT: ESCALATION_CREDIT,

    /* ---- internals (underscored; not part of the contract) --------- */
    _repo: null,
    _truth: null,
    _rand: null,
    _listeners: null,
    _timer: null,
    _seq: 0,

    /* ================================================== lifecycle ==== */

    /**
     * Dev.init({ repo, seed })
     * repo defaults to the global SIM_REPO; seed defaults to 20260823.
     */
    init: function (opts) {
      opts = opts || {};
      var repo = opts.repo || (global && global.SIM_REPO) || null;
      if (!repo || !repo.tickets || !repo.tickets.length || !repo.actions || !repo.actions.length) {
        throw new Error("Dev.init: a SIM_REPO with tickets and actions is required");
      }
      if (typeof repo.reveal !== "function") {
        throw new Error("Dev.init: repo.reveal() is required (the encoded ground truth)");
      }

      this._stopTimer();
      this._repo = repo;
      this._truth = repo.reveal();          // <- the ONLY reveal() call in the codebase
      if (!this._truth || !this._truth.tickets) {
        throw new Error("Dev.init: repo.reveal() did not return a tickets map");
      }

      this.seed = isNum(opts.seed) ? (opts.seed >>> 0) : DEFAULT_SEED;
      this._rand = mulberry32(this.seed);
      this._listeners = {
        tick: [], review: [], answer: [], trust: [], stuck: [], sprintEnd: [], reject: []
      };
      this._seq = 0;

      /* ---- the clock ------------------------------------------------ */
      this.totalMinutes = RULES.days * RULES.hoursPerDay * 60;   // 3600
      this.minutes = 0;
      this.running = false;
      this.started = false;
      this.finished = false;
      this.retroSubmitted = false;
      this.retro = null;
      this.score = null;
      this.speed = 4;              // ticks per real second

      /* ---- the senior-attention budget ------------------------------ */
      var sc = repo.scenario || {};
      this.seniorBudget = isNum(sc.seniorBudgetHours) ? sc.seniorBudgetHours : RULES.seniorBudgetHours;
      this.seniorUsed = 0;

      /* ---- tickets --------------------------------------------------- */
      this.tickets = [];
      this._byId = {};
      for (var i = 0; i < repo.tickets.length; i++) {
        var src = repo.tickets[i];
        var tr = this._t(src.id);
        var tk = {
          id: src.id,
          title: src.title || src.id,
          type: src.type || "task",
          priority: src.priority || "P3",
          reporter: src.reporter || "",
          description: src.description || "",
          acceptance: (src.acceptance || []).slice(),
          points: isNum(src.points) ? src.points : num(tr.points),

          status: "todo",
          understanding: 0,
          minutesSpent: 0,
          estimateHours: null,
          estimatedAt: null,
          actionsUsed: {},
          hasTests: false,
          convention: null,
          bounces: 0,
          prOpenedAt: null,
          reviewDueAt: null,
          blockedSince: null,
          implemented: false,
          implementedAt: null,
          implementedAtUnderstanding: null,
          filesTouched: 0,
          scopeBudget: null,
          mergedAt: null,
          abandonedAt: null,
          relented: false,

          history: [],
          asks: [],
          reviews: [],

          _askedPeople: {},
          _lastGainAt: null,
          _stuckFlagged: false,
          _workCount: 0,          // investigate + ask events, for "new investigation"
          _workAtSubmit: null,
          _newSinceSubmit: 0,
          _prsWithoutTests: 0,
          _prsWrongConvention: 0
        };
        this.tickets.push(tk);
        this._byId[tk.id] = tk;
      }

      /* ---- people ---------------------------------------------------- */
      this.trust = {};
      this.startTrust = {};
      this.trustLog = [];
      var people = repo.people || [];
      for (i = 0; i < people.length; i++) {
        var st = isNum(people[i].startTrust) ? people[i].startTrust : RULES.startTrust;
        this.trust[people[i].id] = st;
        this.startTrust[people[i].id] = st;
      }

      this.active = null;
      this.stuckOn = null;
      this.askLog = [];
      this.reviewLog = [];
      this.pendingChannel = [];

      return this.getState();
    },

    /** begin the sprint on a timer */
    start: function () {
      if (!this._repo) throw new Error("Dev.start: call Dev.init first");
      if (this.finished) return this.getState();
      this.started = true;
      this.running = true;
      this._emit("tick", [this.getState()]);
      this._startTimer();
      return this.getState();
    },

    pause: function () {
      this.running = false;
      this._stopTimer();
      return this.getState();
    },

    resume: function () {
      if (!this._repo || this.finished) return this.getState();
      this.started = true;
      this.running = true;
      this._startTimer();
      return this.getState();
    },

    /** ticks per real second */
    setSpeed: function (mult) {
      mult = Number(mult) || 4;
      if (mult <= 0) mult = 4;
      this.speed = mult;
      if (this.running) this._startTimer();
      return this.speed;
    },

    tickIntervalMs: function () { return 1000 / this.speed; },

    destroy: function () {
      this._stopTimer();
      this.running = false;
      this._listeners = {
        tick: [], review: [], answer: [], trust: [], stuck: [], sprintEnd: [], reject: []
      };
      this._repo = null;
      this._truth = null;
      this.tickets = [];
      this._byId = {};
      this.pendingChannel = [];
    },

    _startTimer: function () {
      this._stopTimer();
      var self = this;
      if (typeof setInterval !== "function") return;
      this._timer = setInterval(function () {
        if (!self.running) return;
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
      if (!this._listeners) this._listeners = {};
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

    _has: function (evt) {
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

    _reject: function (error) {
      this._emit("reject", [{ error: error }]);
      return { ok: false, error: error };
    },

    /* ==================================================== the clock ==== */

    dayOf: function (mins) {
      return Math.min(RULES.days - 1, Math.floor(mins / (RULES.hoursPerDay * 60))) + 1;
    },

    day: function () { return this.dayOf(this.minutes); },

    _intoDay: function (mins) {
      var d = this.dayOf(mins) - 1;
      return mins - d * RULES.hoursPerDay * 60;
    },

    /** clock hour, 9.0 .. 15.0 */
    hour: function () { return round2(DAY_START_HOUR + this._intoDay(this.minutes) / 60); },

    stampAt: function (mins) {
      var d = Math.min(RULES.days - 1, Math.floor(mins / (RULES.hoursPerDay * 60)));
      var into = mins - d * RULES.hoursPerDay * 60;
      var hh = DAY_START_HOUR + Math.floor(into / 60);
      var mm = Math.round(into % 60);
      return "D" + (d + 1) + " " + pad2(hh) + ":" + pad2(mm);
    },

    stamp: function () { return this.stampAt(this.minutes); },

    tickIndex: function () { return Math.floor(this.minutes / RULES.tickMinutes); },

    elapsedHours: function () { return round2(this.minutes / 60); },

    hoursLeft: function () { return round2(Math.max(0, this.totalMinutes - this.minutes) / 60); },

    seniorLeft: function () {
      return round2(Math.max(0, this.seniorBudget - this.seniorUsed));
    },

    /**
     * Spend `mins` minutes of the sprint, optionally charged to a ticket.
     * Per-tick effects (channel replies, reviews landing, the stuck detector)
     * fire on every 15-minute boundary crossed.
     */
    _spend: function (mins, ticket) {
      var n = Math.max(0, Math.round(num(mins)));
      for (var i = 0; i < n; i++) {
        if (this.finished) break;
        this.minutes += 1;
        if (ticket) ticket.minutesSpent += 1;
        if (this.minutes % RULES.tickMinutes === 0) this._tickEffects();
        if (this.minutes >= this.totalMinutes) { this._finish(); break; }
      }
      return this.minutes;
    },

    _tickEffects: function () {
      this._resolveChannel();
      this._resolveReviews();
      this._checkStuck();
      if (this._has("tick")) this._emit("tick", [this.getState()]);
    },

    _finish: function () {
      if (this.finished) return;
      this.minutes = this.totalMinutes;
      this.finished = true;
      this.running = false;
      this._stopTimer();
      this._emit("sprintEnd", [this.getState()]);
    },

    /** advance exactly one 15-minute tick (works while paused) */
    step: function () {
      if (!this._repo || this.finished) return this.getState();
      this._spend(RULES.tickMinutes, null);
      return this.getState();
    },

    /** advance n hours of wall clock, rounded up to whole ticks */
    advance: function (hours) {
      var mins = Math.max(0, Math.round(num(hours) * 60));
      if (mins % RULES.tickMinutes !== 0) {
        mins = Math.ceil(mins / RULES.tickMinutes) * RULES.tickMinutes;
      }
      this._spend(mins, null);
      return this.getState();
    },

    /* ======================================================== truth ==== */
    /* Everything below reads ground truth. Nothing above it does, and nothing
     * outside this module may. */

    _t: function (id) {
      var t = (this._truth && this._truth.tickets && this._truth.tickets[id]) || {};
      return {
        points: isNum(t.points) ? t.points : 0,
        needed: isNum(t.needed) ? t.needed : RULES.implementReadyAt,
        effortHours: isNum(t.effortHours) ? t.effortHours : 2,
        decay: isNum(t.decay) ? t.decay : 0.6,
        timeboxHours: isNum(t.timeboxHours) ? t.timeboxHours : 1.5,
        selfFindable: t.selfFindable !== false,
        soloCap: isNum(t.soloCap) ? t.soloCap : 100,
        needsTests: !!t.needsTests,
        convention: t.convention || null,
        conventionTrap: t.conventionTrap || null,
        shouldAbandon: !!t.shouldAbandon,
        needsClarification: t.needsClarification || null,
        scopeTrap: t.scopeTrap || null,
        yields: t.yields || t.yield || {},
        cause: t.cause || "",
        notes: t.notes || ""
      };
    },

    /** N(0,1) via Box-Muller. Consumes EXACTLY two uniforms. */
    _gauss: function () {
      var u1 = 1 - this._rand();      // (0,1]
      var u2 = this._rand();          // [0,1)
      return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    },

    /* ===================================================== lookups ==== */

    ticketById: function (id) { return (this._byId && this._byId[id]) || null; },

    actionById: function (id) {
      var as = (this._repo && this._repo.actions) || [];
      for (var i = 0; i < as.length; i++) if (as[i].id === id) return as[i];
      return null;
    },

    personById: function (id) {
      var ps = (this._repo && this._repo.people) || [];
      for (var i = 0; i < ps.length; i++) if (ps[i].id === id) return ps[i];
      return null;
    },

    personName: function (id) {
      var p = this.personById(id);
      return (p && p.name) || id;
    },

    /**
     * The action list as the player sees it: cost, caveat, how many times it
     * has already been run, and a diminishing-returns indicator. The indicator
     * is derived from the decay constant on purpose — SPEC §5 requires it.
     * It never discloses the yield.
     */
    getActions: function (ticketId) {
      var tk = this.ticketById(ticketId || this.active);
      var as = (this._repo && this._repo.actions) || [];
      var out = [];
      for (var i = 0; i < as.length; i++) {
        var a = as[i];
        var used = tk ? (tk.actionsUsed[a.id] || 0) : 0;
        var decay = tk ? this._t(tk.id).decay : 0.6;
        out.push({
          id: a.id, name: a.name || a.id, minutes: num(a.minutes),
          desc: a.desc || "", caveat: a.caveat || "",
          timesUsed: used,
          returnFactor: round2(Math.pow(decay, used)),
          diminished: used > 0
        });
      }
      return out;
    },

    /**
     * Convention choices for a ticket, sorted so the ordering is not a tell.
     * Empty when the ticket has no convention decision to make.
     */
    getConventions: function (ticketId) {
      var tk = this.ticketById(ticketId || this.active);
      if (!tk) return [];
      var t = this._t(tk.id);
      if (!t.convention && !t.conventionTrap) return [];
      var out = [];
      if (t.convention) out.push(t.convention);
      if (t.conventionTrap && t.conventionTrap !== t.convention) out.push(t.conventionTrap);
      out.sort();
      return out;
    },

    /* ======================================================= trust ==== */

    _setTrust: function (id, delta, reason) {
      if (!id || !(id in this.trust) || !delta) return 0;
      var from = this.trust[id];
      var to = clamp(Math.round(from + delta), RULES.minTrust, RULES.maxTrust);
      if (to === from) return 0;
      this.trust[id] = to;
      var rec = {
        minutes: this.minutes, day: this.day(), t: this.stamp(),
        personId: id, name: this.personName(id),
        from: from, to: to, delta: to - from, reason: reason || ""
      };
      this.trustLog.push(rec);
      this._emit("trust", [rec]);
      return to - from;
    },

    avgTrust: function () {
      var ids = Object.keys(this.trust);
      if (!ids.length) return 0;
      var s = 0;
      for (var i = 0; i < ids.length; i++) s += this.trust[ids[i]];
      return round1(s / ids.length);
    },

    /* =============================================== understanding ==== */

    /**
     * Apply an understanding delta.
     *
     *   gained = yields[action] * decay^(timesAlreadyDone)
     *
     * A NEGATIVE yield subtracts — that is how a wrong wiki page or a red
     * herring is modelled, and it is deliberately not floored at zero.
     * Total understanding clamps to [0, MAX_UNDERSTANDING].
     *
     * For a ticket whose answer is not self-findable, no NON-ASK action may
     * ever raise understanding above `soloCap`. The ceiling is applied against
     * `max(soloCap, understandingBefore)` so that a solo action performed after
     * an ask never drags you back down — it simply cannot lift you.
     */
    _applyGain: function (tk, raw, isAsk) {
      var t = this._t(tk.id);
      var before = tk.understanding;
      var after = clamp(before + raw, 0, MAX_UNDERSTANDING);
      if (!isAsk && t.selfFindable === false) {
        after = Math.min(after, Math.max(t.soloCap, before));
      }
      after = round4(after);
      tk.understanding = after;
      var gained = round4(after - before);
      if (gained > 0) {
        tk._lastGainAt = this.minutes;
        tk._stuckFlagged = false;
        if (this.stuckOn === tk.id) this.stuckOn = null;
      }
      return gained;
    },

    /** the raw, undecayed-then-decayed yield of one performance of an action */
    _rawYield: function (tk, key) {
      var t = this._t(tk.id);
      var base = num(t.yields[key]);
      var used = tk.actionsUsed[key] || 0;
      return round4(base * Math.pow(t.decay, used));
    },

    /* ================================================== the guards ==== */

    _needTicket: function (ticketId) {
      var id = ticketId || this.active;
      if (!id) return { err: "Pick a ticket first" };
      var tk = this.ticketById(id);
      if (!tk) return { err: "No such ticket: " + id };
      return { tk: tk };
    },

    /** the standard gate every work verb passes through */
    _gate: function (ticketId, opts) {
      opts = opts || {};
      if (this.retroSubmitted || this.finished) return { err: "The sprint is over" };
      var g = this._needTicket(ticketId);
      if (g.err) return g;
      var tk = g.tk;
      if (tk.status === "merged") return { err: "You already merged that" };
      if (tk.status === "abandoned") return { err: "You handed that one back" };
      if (opts.needEstimate && RULES.estimateRequired && !isNum(tk.estimateHours)) {
        return { err: "Estimate this ticket first" };
      }
      return { tk: tk };
    },

    /* ======================================================= verbs ==== */

    select: function (ticketId) {
      var tk = this.ticketById(ticketId);
      if (!tk) return this._reject("No such ticket: " + ticketId);
      this.active = tk.id;
      return { ok: true, ticketId: tk.id };
    },

    /** required before any work starts — this is the calibration record */
    estimate: function (ticketId, hours) {
      if (this.retroSubmitted || this.finished) return this._reject("The sprint is over");
      var g = this._needTicket(ticketId);
      if (g.err) return this._reject(g.err);
      var h = Number(hours);
      if (!isFinite(h) || h <= 0) return this._reject("An estimate in hours is required");
      var tk = g.tk;
      var first = !isNum(tk.estimateHours);
      tk.estimateHours = round2(h);
      if (first) tk.estimatedAt = this.minutes;
      tk.estimateRevisions = (tk.estimateRevisions || 0) + (first ? 0 : 1);
      return { ok: true, ticketId: tk.id, estimateHours: tk.estimateHours, revised: !first };
    },

    /**
     * Dev.investigate({ ticketId, actionId })
     * -> { ok, gained, understanding, note, minutes } | { ok:false, error }
     */
    investigate: function (req) {
      req = req || {};
      var g = this._gate(req.ticketId, { needEstimate: true });
      if (g.err) return this._reject(g.err);
      var tk = g.tk;
      var act = this.actionById(req.actionId);
      if (!act) return this._reject("No such action: " + req.actionId);

      var raw = this._rawYield(tk, act.id);
      var mins = Math.max(0, Math.round(num(act.minutes)));
      var startMin = this.minutes;

      if (tk.status === "todo") tk.status = "investigating";
      if (tk._lastGainAt === null) tk._lastGainAt = this.minutes;

      this._spend(mins, tk);

      /* read AFTER the clock moves: a channel reply can land mid-action */
      var before = tk.understanding;
      tk.actionsUsed[act.id] = (tk.actionsUsed[act.id] || 0) + 1;
      tk._workCount += 1;
      var gained = this._applyGain(tk, raw, false);

      var wasted = (gained <= 0) || (before >= RULES.correctAt);
      var note;
      if (gained < 0) {
        note = "Worse than useless. What you just read describes something that is not there any more.";
      } else if (raw > 0 && gained === 0) {
        note = "Nothing new. You have squeezed this one dry — or whatever is missing was never written down here.";
      } else if (gained === 0) {
        note = "Nothing. That avenue has nothing left in it.";
      } else if (gained < 8) {
        note = "A little. Mostly confirmation of things you already suspected.";
      } else if (gained < 25) {
        note = "Useful. A piece of the shape you did not have before.";
      } else {
        note = "That was the thread. Whole sections of this make sense now.";
      }

      var rec = {
        seq: ++this._seq,
        kind: "action",
        actionId: act.id,
        label: act.name || act.id,
        t: this.stamp(),
        startHours: round2(startMin / 60),
        endHours: round2(this.minutes / 60),
        cost: round2(mins / 60),
        minutes: mins,
        gained: gained,
        rawYield: raw,
        before: round2(before),
        understanding: round2(tk.understanding),
        negative: gained < 0,
        wasted: wasted,
        repeat: tk.actionsUsed[act.id] - 1
      };
      tk.history.push(rec);

      return {
        ok: true, ticketId: tk.id, actionId: act.id,
        gained: gained, understanding: round2(tk.understanding),
        minutes: mins, hours: round2(mins / 60),
        note: note, negative: gained < 0, wasted: wasted
      };
    },

    /* ====================================================== asking ==== */

    /** true when at least one positive-yield solo action has never been run */
    _soloAvenueLeft: function (tk) {
      var t = this._t(tk.id);
      var as = (this._repo && this._repo.actions) || [];
      for (var i = 0; i < as.length; i++) {
        var id = as[i].id;
        if (num(t.yields[id]) > 0 && !(tk.actionsUsed[id] > 0)) return true;
      }
      return false;
    },

    /**
     * Classify an ask against the timebox. SPEC §2:
     *  - premature   : spent < timebox AND selfFindable AND a solo avenue is unused
     *  - overdue     : spent >= 2.5 * timebox AND still below implementReadyAt
     *  - well-formed : spent >= timebox, or not selfFindable, or solo exhausted
     */
    classifyAsk: function (ticketId) {
      var tk = this.ticketById(ticketId || this.active);
      if (!tk) return null;
      var t = this._t(tk.id);
      var spent = tk.minutesSpent / 60;
      if (spent >= 2.5 * t.timeboxHours && tk.understanding < RULES.implementReadyAt) return "overdue";
      if (spent < t.timeboxHours && t.selfFindable === true && this._soloAvenueLeft(tk)) return "premature";
      return "well-formed";
    },

    /**
     * Dev.ask({ ticketId, to:"deepa"|"hannah"|"channel", question })
     * -> { ok, answer, classification, trustDelta } | { ok:false, error }
     */
    ask: function (req) {
      req = req || {};
      var g = this._gate(req.ticketId, { needEstimate: true });
      if (g.err) return this._reject(g.err);
      var tk = g.tk;

      var to = String(req.to || "");
      if (!has(ASK_TARGETS, to)) return this._reject("Ask Deepa, Hannah or the channel");

      var question = (typeof req.question === "string") ? req.question.trim() : "";
      if (question.length < RULES.minQuestionChars) {
        return this._reject("That question is too short to answer");
      }
      if (to === "deepa" && this.seniorLeft() <= 0) {
        return this._reject("Deepa has no time left this sprint");
      }

      var cls = this.classifyAsk(tk.id);
      var key = "ask_" + to;
      var startMin = this.minutes;
      var spentBefore = round2(tk.minutesSpent / 60);

      /* ---- trust ---------------------------------------------------- */
      var base = cls === "premature" ? TRUST_PREMATURE
        : (cls === "overdue" ? TRUST_OVERDUE : TRUST_WELLFORMED);
      var target = to === "channel" ? CHANNEL_TRUST_TO : to;
      var delta = to === "channel"
        ? (base < 0 ? -Math.round(Math.abs(base) * CHANNEL_TRUST_FACTOR)
                    : Math.round(base * CHANNEL_TRUST_FACTOR))
        : base;
      this._setTrust(target, delta, cls + " question on " + tk.id
        + (to === "channel" ? " (in #eng-help)" : ""));

      /* ---- her budget ------------------------------------------------ */
      var seniorMin = 0;
      if (to === "deepa") {
        seniorMin = SENIOR_MINUTES[cls];
        /* NOT rounded — her budget is accumulated at full precision and only
         * rounded for display, or 22.5-minute answers would drift. */
        this.seniorUsed = Math.min(this.seniorBudget, this.seniorUsed + seniorMin / 60);
      }

      /* ---- your time -------------------------------------------------- */
      var mins = PLAYER_ASK_MINUTES[cls];
      if (tk.status === "todo") tk.status = "investigating";
      if (tk._lastGainAt === null) tk._lastGainAt = this.minutes;
      this._spend(mins, tk);

      /* ---- the answer -------------------------------------------------- */
      var raw = this._rawYield(tk, key);
      tk.actionsUsed[key] = (tk.actionsUsed[key] || 0) + 1;
      tk._workCount += 1;
      tk._askedPeople[to] = true;

      var gained = 0, answer, pending = false, etaMinutes = 0;

      if (to === "channel") {
        /* async: the reply lands after a simulated delay, and only if anyone
         * in #eng-help actually knows */
        var d = CHANNEL_DELAY_MEAN + this._gauss() * CHANNEL_DELAY_SD;
        etaMinutes = clamp(Math.round(d), CHANNEL_DELAY_MIN, CHANNEL_DELAY_MAX);
        pending = true;
        this.pendingChannel.push({
          ticketId: tk.id, dueAt: this.minutes + etaMinutes,
          gain: raw > 0 ? raw : 0, answered: raw > 0, question: question
        });
        answer = "Posted to #eng-help. Somebody will get to it, or somebody won't.";
      } else {
        gained = this._applyGain(tk, raw, true);
        answer = this._answerText(to, cls, gained);
        this._emit("answer", [{
          ticketId: tk.id, to: to, name: this.personName(to),
          classification: cls, gained: gained, answer: answer, t: this.stamp()
        }]);
      }

      var rec = {
        seq: ++this._seq,
        kind: "ask",
        actionId: key,
        label: "ask " + (to === "channel" ? "#eng-help" : this.personName(to)),
        to: to,
        t: this.stampAt(startMin),
        startHours: round2(startMin / 60),
        endHours: round2(this.minutes / 60),
        cost: round2(mins / 60),
        minutes: mins,
        question: question,
        classification: cls,
        trustDelta: delta,
        trustTarget: target,
        seniorMinutes: seniorMin,
        spentBefore: spentBefore,
        gained: gained,
        pending: pending,
        etaMinutes: etaMinutes,
        before: round2(tk.understanding - gained),
        understanding: round2(tk.understanding),
        negative: gained < 0,
        wasted: gained < 0
      };
      tk.history.push(rec);
      tk.asks.push(rec);
      this.askLog.push({
        ticketId: tk.id, to: to, classification: cls, question: question,
        trustDelta: delta, seniorMinutes: seniorMin, gained: gained,
        t: rec.t, spentBefore: spentBefore
      });

      return {
        ok: true, ticketId: tk.id, to: to,
        answer: answer, classification: cls, trustDelta: delta,
        gained: gained, understanding: round2(tk.understanding),
        seniorMinutes: seniorMin, seniorLeft: this.seniorLeft(),
        pending: pending, etaMinutes: etaMinutes
      };
    },

    _answerText: function (to, cls, gained) {
      var who = this.personName(to);
      if (cls === "premature") {
        if (to === "hannah") {
          return who + ": \"Happily — though hang on, is that not in the ticket? ... No. "
            + "No, it is not. Fair enough.\" She answers, and she is pleased you asked.";
        }
        return who + ": \"What have you tried, and what did you expect to happen?\" "
          + "The answer comes anyway, and you can hear the other thing not being said.";
      }
      if (cls === "overdue") {
        return who + ": \"How long have you been on this? ... Right. Next time, come at the "
          + "hour mark. That is not a telling-off, it is arithmetic.\"";
      }
      if (gained >= 40) {
        return who + ": \"Ah — that one. Let me save you two days.\" Ninety seconds later you "
          + "have the whole shape of it.";
      }
      if (gained >= 15) {
        return who + ": \"Mostly you have it. Here is the piece you are missing.\"";
      }
      if (gained > 0) {
        return who + ": \"You are ahead of me on this one, honestly. Keep pulling.\"";
      }
      return who + ": \"I do not think I can add anything you have not already found.\"";
    },

    _resolveChannel: function () {
      if (!this.pendingChannel.length) return;
      var still = [];
      for (var i = 0; i < this.pendingChannel.length; i++) {
        var p = this.pendingChannel[i];
        if (p.dueAt > this.minutes) { still.push(p); continue; }
        var tk = this.ticketById(p.ticketId);
        if (!tk) continue;
        var gained = p.answered ? this._applyGain(tk, p.gain, true) : 0;
        var answer = p.answered
          ? "#eng-help: someone who has been here longer than you replies with the thing you needed."
          : "#eng-help: two people speculate confidently, neither of them about your problem.";
        var rec = {
          seq: ++this._seq, kind: "channel", actionId: "ask_channel",
          label: "#eng-help replies", to: "channel",
          t: this.stamp(),
          startHours: round2(this.minutes / 60), endHours: round2(this.minutes / 60),
          cost: 0, minutes: 0, gained: gained,
          before: round2(tk.understanding - gained),
          understanding: round2(tk.understanding),
          negative: gained < 0, wasted: false, answered: !!p.answered
        };
        tk.history.push(rec);
        this._emit("answer", [{
          ticketId: tk.id, to: "channel", name: "#eng-help",
          classification: null, gained: gained, answer: answer, t: this.stamp()
        }]);
      }
      this.pendingChannel = still;
    },

    /* ============================================== tests / scope ===== */

    setConvention: function (ticketId, name) {
      var g = this._gate(ticketId, {});
      if (g.err) return this._reject(g.err);
      var n = (typeof name === "string") ? name.trim() : "";
      if (!n) return this._reject("Pick a convention");
      g.tk.convention = n;
      return { ok: true, ticketId: g.tk.id, convention: n };
    },

    writeTests: function (ticketId) {
      var g = this._gate(ticketId, { needEstimate: true });
      if (g.err) return this._reject(g.err);
      var tk = g.tk;
      var startMin = this.minutes;
      if (tk.status === "todo") tk.status = "investigating";
      this._spend(TESTS_MINUTES, tk);
      tk.hasTests = true;
      tk.history.push({
        seq: ++this._seq, kind: "tests", actionId: "write_tests", label: "write tests",
        t: this.stampAt(startMin),
        startHours: round2(startMin / 60), endHours: round2(this.minutes / 60),
        cost: round2(TESTS_MINUTES / 60), minutes: TESTS_MINUTES,
        gained: 0, before: round2(tk.understanding), understanding: round2(tk.understanding),
        negative: false, wasted: false
      });
      return { ok: true, ticketId: tk.id, hasTests: true, minutes: TESTS_MINUTES };
    },

    /**
     * Dev.implement(ticketId)
     *
     * Allowed only at understanding >= implementReadyAt. Costs
     *   effortHours * (1 + max(0, correctAt - understanding) / 100)
     * — understanding you skipped, you pay back as rework.
     *
     * Also resolves the scope trap: if NONE of `scopeTrap.guardedBy` was
     * performed before this point, the diff balloons to `naiveFiles`.
     */
    implement: function (ticketId) {
      var g = this._gate(ticketId, { needEstimate: true });
      if (g.err) return this._reject(g.err);
      var tk = g.tk;
      if (tk.status === "in_review") return this._reject("That PR is already in review");
      if (tk.understanding < RULES.implementReadyAt) {
        return this._reject("You need to understand this better before you can implement it");
      }

      var t = this._t(tk.id);
      var shortfall = Math.max(0, RULES.correctAt - tk.understanding);
      var hours = round4(t.effortHours * (1 + shortfall / 100));
      var mins = Math.max(1, Math.round(hours * 60));
      var startMin = this.minutes;

      /* ---- the scope trap -------------------------------------------- */
      if (t.scopeTrap) {
        var guarded = false;
        var gb = t.scopeTrap.guardedBy || [];
        for (var i = 0; i < gb.length; i++) if (tk.actionsUsed[gb[i]] > 0) guarded = true;
        tk.scopeBudget = isNum(t.scopeTrap.budget) ? t.scopeTrap.budget : null;
        tk.filesTouched = guarded
          ? Math.max(1, Math.round(num(t.scopeTrap.budget) / 2))
          : num(t.scopeTrap.naiveFiles);
        tk.scopeGuarded = guarded;
      } else {
        tk.scopeBudget = null;
        tk.filesTouched = 0;
        tk.scopeGuarded = true;
      }

      tk.status = "implementing";
      this._spend(mins, tk);
      tk.implemented = true;
      tk.implementedAt = this.minutes;
      tk.implementedAtUnderstanding = round2(tk.understanding);

      tk.history.push({
        seq: ++this._seq, kind: "implement", actionId: "implement", label: "implement",
        t: this.stampAt(startMin),
        startHours: round2(startMin / 60), endHours: round2(this.minutes / 60),
        cost: round2(mins / 60), minutes: mins,
        gained: 0, before: round2(tk.understanding), understanding: round2(tk.understanding),
        negative: false, wasted: false,
        rework: round2((mins / 60) - t.effortHours)
      });

      return {
        ok: true, ticketId: tk.id,
        hours: round2(mins / 60), minutes: mins,
        baseHours: round2(t.effortHours),
        reworkHours: round2((mins / 60) - t.effortHours),
        understanding: round2(tk.understanding),
        filesTouched: tk.filesTouched, scopeBudget: tk.scopeBudget
      };
    },

    /* ==================================================== PR review ==== */

    openPR: function (ticketId) {
      var g = this._gate(ticketId, { needEstimate: true });
      if (g.err) return this._reject(g.err);
      var tk = g.tk;
      if (tk.status === "in_review") return this._reject("That PR is already in review");
      if (!tk.implemented) return this._reject("Implement it before you open a pull request");

      var lo = RULES.reviewLagHours.min, hi = RULES.reviewLagHours.max;
      var lag = lo + this._rand() * (hi - lo);
      lag = Math.round(lag * 4) / 4;                 // quarter-hour granularity
      var lagMin = Math.round(lag * 60);

      tk._newSinceSubmit = tk._workAtSubmit === null
        ? tk._workCount
        : (tk._workCount - tk._workAtSubmit);
      tk._workAtSubmit = tk._workCount;

      var t = this._t(tk.id);
      if (t.needsTests && !tk.hasTests) tk._prsWithoutTests += 1;
      if (t.convention && tk.convention !== t.convention) tk._prsWrongConvention += 1;

      tk.status = "in_review";
      tk.prOpenedAt = this.minutes;
      tk.reviewDueAt = this.minutes + lagMin;
      tk.prsOpened = (tk.prsOpened || 0) + 1;

      tk.history.push({
        seq: ++this._seq, kind: "pr", actionId: "open_pr", label: "open PR",
        t: this.stamp(),
        startHours: round2(this.minutes / 60), endHours: round2(this.minutes / 60),
        cost: 0, minutes: 0, gained: 0,
        before: round2(tk.understanding), understanding: round2(tk.understanding),
        negative: false, wasted: false
      });

      return {
        ok: true, ticketId: tk.id,
        reviewInHours: round2(lagMin / 60), reviewDueAt: tk.reviewDueAt,
        understanding: round2(tk.understanding)
      };
    },

    _resolveReviews: function () {
      for (var i = 0; i < this.tickets.length; i++) {
        var tk = this.tickets[i];
        if (tk.status !== "in_review") continue;
        if (tk.reviewDueAt === null || tk.reviewDueAt > this.minutes) continue;
        this._review(tk);
      }
    },

    /**
     * The review. Merges only if ALL hold:
     *   1. understanding >= correctAt
     *   2. hasTests, if the ticket needs them
     *   3. the right convention was selected
     *   4. filesTouched <= the scope budget
     *   5. the requirement was clarified with the person who owns it
     * Anything else bounces, with comments that name what failed.
     */
    _review: function (tk) {
      var t = this._t(tk.id);
      var comments = [], reasons = [];

      if (t.needsClarification && !tk._askedPeople[t.needsClarification]) {
        reasons.push("clarification");
        comments.push("Nnamdi: This does not do what the ticket actually needs, and I do not think "
          + "the ticket says what it needs. Go and ask " + this.personName(t.needsClarification)
          + " what they meant before you write another line of this.");
      }
      if (tk.scopeBudget !== null && tk.filesTouched > tk.scopeBudget) {
        reasons.push("scope");
        comments.push("Nnamdi: This diff touches " + tk.filesTouched + " files against a budget of "
          + tk.scopeBudget + ". Three other teams have branches open against those packages. "
          + "Scope it to what the ticket asked for.");
      }
      var understood = tk.understanding >= RULES.correctAt;
      if (!understood) {
        reasons.push("understanding");
        comments.push("Nnamdi: Walk me through why this fixes it. You are at "
          + round1(tk.understanding) + " on my rough scale and I need " + RULES.correctAt
          + " — I do not merge code the author cannot explain.");
      }
      if (t.needsTests && !tk.hasTests) {
        reasons.push("tests");
        comments.push("CI: no new tests on a behavioural change.");
        comments.push("Nnamdi: This needs a regression test for the case in the ticket. "
          + "Otherwise we find out from a customer.");
      }
      if (t.convention) {
        if (tk.convention === t.conventionTrap && t.conventionTrap) {
          reasons.push("convention");
          comments.push("Nnamdi: You copied " + t.conventionTrap + " from the files next door. "
            + "About sixty percent of that neighbourhood is deprecated. This should be built on "
            + t.convention + ".");
        } else if (tk.convention !== t.convention) {
          reasons.push("convention");
          comments.push("Nnamdi: Wrong pattern for this part of the tree. This should be built on "
            + t.convention + (tk.convention ? ", not " + tk.convention : "") + ".");
        }
      }

      /* the relent — see note 3 at the top of the file */
      var relented = false;
      if (reasons.length === 1 && reasons[0] === "understanding"
        && tk.bounces >= RELENT_AFTER && tk._newSinceSubmit === 0) {
        relented = true;
        reasons = [];
        comments = ["Nnamdi: I have asked you this twice and the answer has not changed. "
          + "It is Thursday and I am not going to be the reason this slips. Merging — "
          + "but you and I both know you cannot explain this one."];
      }

      var merged = reasons.length === 0;
      var rec = {
        seq: ++this._seq,
        ticketId: tk.id,
        t: this.stamp(),
        minutes: this.minutes,
        hours: round2(this.minutes / 60),
        merged: merged,
        relented: relented,
        reasons: reasons.slice(),
        comments: comments.slice(),
        understanding: round2(tk.understanding),
        attempt: tk.prsOpened || 1
      };

      if (merged) {
        tk.status = "merged";
        tk.mergedAt = this.minutes;
        tk.relented = relented;
        if (!relented) {
          this._setTrust("nnamdi", TRUST_MERGE, "clean merge on " + tk.id);
          this._setTrust("tobias", TRUST_MERGE_LEAD, tk.id + " merged");
        }
      } else {
        tk.bounces += 1;
        tk.status = "implementing";
        tk.reviewDueAt = null;
        this._setTrust("nnamdi", TRUST_BOUNCE, "PR bounced on " + tk.id + ": " + reasons.join(", "));
      }

      tk.reviews.push(rec);
      tk.history.push({
        seq: ++this._seq, kind: "review", actionId: "review",
        label: merged ? "merged" : "bounced",
        t: rec.t,
        startHours: rec.hours, endHours: rec.hours, cost: 0, minutes: 0,
        gained: 0, before: rec.understanding, understanding: rec.understanding,
        negative: !merged, wasted: false, reasons: reasons.slice()
      });
      this.reviewLog.push(rec);
      this._emit("review", [rec]);
      return rec;
    },

    /* ===================================================== abandon ==== */

    /**
     * Hand it back. Costs trust — unless the ticket was misfiled, in which case
     * telling the team so IS doing it, and it earns trust instead.
     */
    abandon: function (ticketId) {
      if (this.retroSubmitted || this.finished) return this._reject("The sprint is over");
      var g = this._needTicket(ticketId);
      if (g.err) return this._reject(g.err);
      var tk = g.tk;
      if (tk.status === "merged") return this._reject("You already merged that");
      if (tk.status === "abandoned") return this._reject("You handed that one back");

      var t = this._t(tk.id);
      tk.status = "abandoned";
      tk.abandonedAt = this.minutes;
      tk.reviewDueAt = null;
      var right = t.shouldAbandon;
      var delta = right ? TRUST_ABANDON_RIGHT : TRUST_ABANDON_WRONG;
      this._setTrust("tobias", delta, right
        ? "handed " + tk.id + " back with what you found"
        : "gave up on " + tk.id);

      tk.history.push({
        seq: ++this._seq, kind: "abandon", actionId: "abandon", label: "handed back",
        t: this.stamp(),
        startHours: round2(this.minutes / 60), endHours: round2(this.minutes / 60),
        cost: 0, minutes: 0, gained: 0,
        before: round2(tk.understanding), understanding: round2(tk.understanding),
        negative: !right, wasted: false
      });

      return { ok: true, ticketId: tk.id, trustDelta: delta };
    },

    /* ================================================= the detector ==== */

    _checkStuck: function () {
      for (var i = 0; i < this.tickets.length; i++) {
        var tk = this.tickets[i];
        if (tk.status !== "investigating" && tk.status !== "implementing") continue;
        if (tk._lastGainAt === null || tk._stuckFlagged) continue;
        var idle = (this.minutes - tk._lastGainAt) / 60;
        if (idle < RULES.stuckHours) continue;
        tk._stuckFlagged = true;
        tk.blockedSince = round2(tk._lastGainAt / 60);
        this.stuckOn = tk.id;
        this._emit("stuck", [{
          ticketId: tk.id, t: this.stamp(),
          idleHours: round2(idle), blockedSince: tk.blockedSince,
          understanding: round2(tk.understanding),
          asked: tk.asks.length > 0
        }]);
      }
    },

    /* ======================================================= state ==== */

    _copyTicket: function (tk) {
      var used = {}, k = Object.keys(tk.actionsUsed);
      for (var i = 0; i < k.length; i++) used[k[i]] = tk.actionsUsed[k[i]];
      var hist = [];
      for (i = 0; i < tk.history.length; i++) hist.push(tk.history[i]);
      return {
        id: tk.id, title: tk.title, type: tk.type, priority: tk.priority,
        reporter: tk.reporter, description: tk.description,
        acceptance: tk.acceptance.slice(), points: tk.points,
        status: tk.status,
        understanding: round2(tk.understanding),
        hoursSpent: round2(tk.minutesSpent / 60),
        minutesSpent: tk.minutesSpent,
        estimateHours: tk.estimateHours,
        actionsUsed: used,
        hasTests: !!tk.hasTests,
        convention: tk.convention,
        bounces: tk.bounces,
        prsOpened: tk.prsOpened || 0,
        prOpenedAt: tk.prOpenedAt === null ? null : round2(tk.prOpenedAt / 60),
        reviewDueAt: tk.reviewDueAt === null ? null : round2(tk.reviewDueAt / 60),
        blockedSince: tk.blockedSince,
        implemented: !!tk.implemented,
        filesTouched: tk.filesTouched,
        scopeBudget: tk.scopeBudget,
        relented: !!tk.relented,
        asks: tk.asks.slice(),
        reviews: tk.reviews.slice(),
        history: hist
      };
    },

    /** returns a fresh object every call. Consumes no randomness. */
    getState: function () {
      var tks = [], i;
      for (i = 0; i < this.tickets.length; i++) tks.push(this._copyTicket(this.tickets[i]));
      var trust = {}, ids = Object.keys(this.trust);
      for (i = 0; i < ids.length; i++) trust[ids[i]] = this.trust[ids[i]];
      var merged = [];
      for (i = 0; i < this.tickets.length; i++) {
        if (this.tickets[i].status === "merged") merged.push(this.tickets[i].id);
      }
      return {
        day: this.day(),
        hour: this.hour(),
        t: this.stamp(),
        tick: this.tickIndex(),
        minutes: this.minutes,
        hoursSpent: this.elapsedHours(),
        hoursLeft: this.hoursLeft(),
        seniorLeft: this.seniorLeft(),
        seniorBudget: round2(this.seniorBudget),
        tickets: tks,
        active: this.active,
        trust: trust,
        avgTrust: this.avgTrust(),
        merged: merged,
        stuckOn: this.stuckOn,
        running: !!this.running,
        started: !!this.started,
        finished: !!this.finished,
        retroSubmitted: !!this.retroSubmitted,
        seed: this.seed
      };
    },

    /* ===================================================== scoring ==== */

    /** hours burned in negative-yield work, or in solo work that could no
     *  longer pay (nothing left to learn from it, or already past correctAt) */
    wastedHours: function () {
      var m = 0;
      for (var i = 0; i < this.tickets.length; i++) {
        var h = this.tickets[i].history;
        for (var j = 0; j < h.length; j++) {
          var r = h[j];
          if (r.kind === "action" && r.wasted) m += r.minutes;
          else if (r.kind === "ask" && r.gained < 0) m += r.minutes;
        }
      }
      return round2(m / 60);
    },

    _escalationRows: function () {
      var rows = [];
      for (var i = 0; i < this.tickets.length; i++) {
        var tk = this.tickets[i];
        var t = this._t(tk.id);
        if (tk.minutesSpent <= 0 && !tk.asks.length) continue;
        var first = tk.asks.length ? tk.asks[0] : null;
        var verdict, credit;
        if (first) {
          verdict = first.classification === "premature" ? "early"
            : (first.classification === "overdue" ? "late" : "right");
          credit = ESCALATION_CREDIT[verdict];
        } else {
          verdict = "never";
          var resolved = tk.status === "merged"
            || (tk.status === "abandoned" && t.shouldAbandon);
          var neededHelp = (t.selfFindable === false) || !!t.needsClarification;
          credit = (!neededHelp && resolved) ? 1 : 0;
        }
        rows.push({
          ticketId: tk.id,
          askedAtHours: first ? first.spentBefore : null,
          timeboxHours: t.timeboxHours,
          verdict: verdict,
          credit: credit,
          classification: first ? first.classification : null,
          to: first ? first.to : null
        });
      }
      return rows;
    },

    _calibration: function () {
      var rows = [], n = 0, sum = 0, worst = null;
      for (var i = 0; i < this.tickets.length; i++) {
        var tk = this.tickets[i];
        if (!isNum(tk.estimateHours) || tk.minutesSpent <= 0) continue;
        var actual = round2(tk.minutesSpent / 60);
        var ratio = round4(actual / tk.estimateHours);
        n++; sum += ratio;
        var row = { ticketId: tk.id, est: tk.estimateHours, actual: actual, ratio: ratio };
        rows.push(row);
        if (!worst || ratio > worst.ratio) worst = row;
      }
      var mean = n ? round2(sum / n) : 0;
      return {
        n: n,
        meanRatio: mean,
        worst: worst ? { ticketId: worst.ticketId, est: worst.est, actual: worst.actual, ratio: worst.ratio } : null,
        optimistic: n > 0 && mean > 1,
        rows: rows
      };
    },

    /**
     * Dev.submitRetro({ narrative, whatIdDoDifferently }) -> Score
     * Ends the sprint. Anything still in review at the buzzer is worth zero.
     */
    submitRetro: function (req) {
      req = req || {};
      if (this.retroSubmitted) return this._reject("The sprint is over");
      this._stopTimer();
      this.running = false;
      this.retroSubmitted = true;
      this.retro = {
        narrative: (typeof req.narrative === "string") ? req.narrative.trim() : "",
        whatIdDoDifferently: (typeof req.whatIdDoDifferently === "string")
          ? req.whatIdDoDifferently.trim() : "",
        t: this.stamp(), day: this.day()
      };

      var i, tk, t;

      /* ---- delivery -------------------------------------------------- */
      var merged = [], mergedPoints = 0, totalPoints = 0, delivered = 0;
      var falseFixes = [], wrongAbandons = [], rightAbandons = [], shippedBlind = [];
      for (i = 0; i < this.tickets.length; i++) {
        tk = this.tickets[i]; t = this._t(tk.id);
        totalPoints += tk.points;
        if (tk.status === "merged") {
          merged.push(tk.id);
          mergedPoints += tk.points;
          if (t.shouldAbandon) { falseFixes.push(tk.id); delivered -= tk.points; }
          else delivered += tk.points;
          if (tk.relented || tk.understanding < RULES.correctAt) shippedBlind.push(tk.id);
        } else if (tk.status === "abandoned") {
          if (t.shouldAbandon) { rightAbandons.push(tk.id); delivered += tk.points; }
          else { wrongAbandons.push(tk.id); delivered -= tk.points / 2; }
        }
      }

      /* ---- escalation ------------------------------------------------- */
      var esc = this._escalationRows();
      var escSum = 0;
      for (i = 0; i < esc.length; i++) escSum += esc[i].credit;
      var escScore = esc.length ? round2(escSum / esc.length) : 0;

      /* ---- hygiene ---------------------------------------------------- */
      var bounces = 0, testsSkipped = 0, conventionMisses = 0;
      for (i = 0; i < this.tickets.length; i++) {
        tk = this.tickets[i];
        bounces += tk.bounces;
        if (tk._prsWithoutTests > 0) testsSkipped += 1;
        if (tk._prsWrongConvention > 0) conventionMisses += 1;
      }

      /* ---- trust ------------------------------------------------------ */
      var finalTrust = {}, biggest = null, ids = Object.keys(this.trust);
      for (i = 0; i < ids.length; i++) {
        finalTrust[ids[i]] = this.trust[ids[i]];
        var d = this.trust[ids[i]] - (this.startTrust[ids[i]] || 0);
        if (!biggest || Math.abs(d) > Math.abs(biggest.delta)) {
          biggest = { who: ids[i], name: this.personName(ids[i]), delta: d };
        }
      }
      var avg = this.avgTrust();

      /* ---- the grade --------------------------------------------------- */
      var delivery = totalPoints > 0 ? clamp(delivered / totalPoints, 0, 1) : 0;
      var trustScore = clamp(avg / 100, 0, 1);
      var composite = round4(GRADE_WEIGHTS.delivery * delivery
        + GRADE_WEIGHTS.escalation * escScore
        + GRADE_WEIGHTS.trust * trustScore);
      var grade = "F";
      for (i = 0; i < GRADE_CUTS.length; i++) {
        if (composite >= GRADE_CUTS[i][0]) { grade = GRADE_CUTS[i][1]; break; }
      }

      var modifiers = [];
      if (avg < 40) {
        if (grade === "A" || grade === "B") {
          grade = "C";
          modifiers.push("capped at C: you finished the sprint with the team at " + avg + " trust");
        } else {
          modifiers.push("you finished the sprint with the team at " + avg + " trust");
        }
      }
      if (shippedBlind.length) {
        if (grade === "A" || grade === "B") {
          grade = "C";
          modifiers.push("capped at C: merged " + shippedBlind.join(", ")
            + " below " + RULES.correctAt + " understanding by resubmitting it until it went through");
        } else {
          modifiers.push("merged " + shippedBlind.join(", ") + " without understanding it");
        }
      }

      /* ---- per ticket ---------------------------------------------------- */
      var per = [];
      for (i = 0; i < this.tickets.length; i++) {
        tk = this.tickets[i]; t = this._t(tk.id);
        var row = null;
        for (var j = 0; j < esc.length; j++) if (esc[j].ticketId === tk.id) row = esc[j];
        var outcome;
        if (tk.status === "merged" && t.shouldAbandon) {
          outcome = "false fix — this ticket was misfiled and you shipped a change for it";
        } else if (tk.status === "merged" && tk.relented) {
          outcome = "merged, but you could not explain it and the reviewer gave up asking";
        } else if (tk.status === "merged") {
          outcome = "merged";
        } else if (tk.status === "abandoned" && t.shouldAbandon) {
          outcome = "correctly handed back — that is a contribution, not a failure";
        } else if (tk.status === "abandoned") {
          outcome = "handed back, but this one was yours to finish";
        } else if (tk.status === "in_review") {
          outcome = "still in review at the buzzer — worth zero";
        } else if (tk.minutesSpent > 0) {
          outcome = "unfinished after " + h1(tk.minutesSpent / 60) + "h";
        } else {
          outcome = "never started";
        }
        per.push({
          id: tk.id, title: tk.title, points: tk.points,
          merged: tk.status === "merged",
          status: tk.status,
          understanding: round2(tk.understanding),
          hoursSpent: round2(tk.minutesSpent / 60),
          estimate: tk.estimateHours,
          bounces: tk.bounces,
          hasTests: !!tk.hasTests,
          convention: tk.convention,
          verdict: row ? row.verdict : "never",
          outcome: outcome,
          cause: t.cause,
          note: t.notes
        });
      }

      var hoursSpent = this.elapsedHours();
      var bestHours = isNum(this._truth.bestHours) ? this._truth.bestHours : 0;

      var score = {
        ok: true,
        merged: merged.slice(),
        mergedPoints: mergedPoints,
        totalPoints: totalPoints,
        deliveredPoints: round2(delivered),
        hoursSpent: hoursSpent,
        wastedHours: this.wastedHours(),
        bestHours: bestHours,
        /* bestHours / hoursSpent, capped at 1: you cannot be more efficient than
         * the ideal route, and quitting on day 2 must not read as 2.7x. */
        efficiency: hoursSpent > 0 ? round2(Math.min(1, bestHours / hoursSpent)) : 0,
        escalation: esc,
        escalationScore: escScore,
        bounces: bounces,
        testsSkipped: testsSkipped,
        conventionMisses: conventionMisses,
        falseFixes: falseFixes.slice(),
        rightAbandons: rightAbandons.slice(),
        wrongAbandons: wrongAbandons.slice(),
        shippedBlind: shippedBlind.slice(),
        calibration: this._calibration(),
        trust: { final: finalTrust, avg: avg, biggest: biggest, start: this.startTrust },
        delivery: round2(delivery),
        composite: composite,
        grade: grade,
        modifiers: modifiers,
        perTicket: per,
        bestPath: (this._truth.bestPath) || {},
        seniorUsed: round2(this.seniorUsed),
        seniorBudget: round2(this.seniorBudget),
        retro: this.retro,
        submittedAt: { day: this.day(), t: this.stamp() }
      };

      this.score = score;
      this.finished = true;
      this._emit("sprintEnd", [this.getState()]);
      return score;
    },

    getScore: function () { return this.score; },

    /* ================================================== the retro ==== */

    /**
     * Markdown for chat. Contains ONLY what the player was told during the
     * sprint: statuses, hours, understanding (which the UI showed all along),
     * the review comments Nnamdi actually wrote, the asks the player sent, and
     * the trust ledger. NO GROUND TRUTH — no causes, no debrief notes, no
     * yields, no timeboxes, no efficient route, no verdicts.
     */
    exportRetro: function () {
      var repo = this._repo || {};
      var sc = repo.scenario || {};
      var L = [], i, j, tk;

      L.push("# Sprint retro — " + (sc.company || "?") + " · " + (sc.team || "team"));
      L.push("");
      L.push("**" + this.stamp() + "** · day " + this.day() + " of " + RULES.days
        + " · " + (this.retroSubmitted ? "sprint closed" : "in flight"));
      L.push("");

      if (this.retro && this.retro.narrative) {
        L.push("## The sprint, in my words");
        L.push("");
        L.push(this.retro.narrative);
        L.push("");
      }
      if (this.retro && this.retro.whatIdDoDifferently) {
        L.push("## What I would do differently");
        L.push("");
        L.push(this.retro.whatIdDoDifferently);
        L.push("");
      }

      /* ---- merged --------------------------------------------------- */
      var mergedT = [], openT = [];
      for (i = 0; i < this.tickets.length; i++) {
        if (this.tickets[i].status === "merged") mergedT.push(this.tickets[i]);
        else openT.push(this.tickets[i]);
      }

      L.push("## Merged");
      L.push("");
      if (!mergedT.length) {
        L.push("_Nothing merged._");
      } else {
        L.push("| ticket | points | hours | estimate | bounces | tests |");
        L.push("|---|---:|---:|---:|---:|---|");
        for (i = 0; i < mergedT.length; i++) {
          tk = mergedT[i];
          L.push("| " + tk.id + " — " + tk.title + " | " + tk.points
            + " | " + h1(tk.minutesSpent / 60)
            + " | " + (isNum(tk.estimateHours) ? h1(tk.estimateHours) : "—")
            + " | " + tk.bounces
            + " | " + (tk.hasTests ? "yes" : "no") + " |");
        }
      }
      L.push("");

      /* ---- not merged ------------------------------------------------ */
      L.push("## Not merged, and why");
      L.push("");
      if (!openT.length) {
        L.push("_Everything on the board merged._");
      } else {
        for (i = 0; i < openT.length; i++) {
          tk = openT[i];
          var why;
          if (tk.status === "abandoned") why = "handed back";
          else if (tk.status === "in_review") why = "still in review when the sprint ended";
          else if (tk.status === "todo") why = "never started";
          else if (tk.understanding < RULES.implementReadyAt) {
            why = "understanding at " + round1(tk.understanding) + ", implementation opens at "
              + RULES.implementReadyAt;
          } else if (!tk.implemented) why = "understood but never implemented";
          else why = "implemented but never got through review";
          L.push("- **" + tk.id + "** — " + tk.title + " · " + why
            + " · " + h1(tk.minutesSpent / 60) + "h spent"
            + (tk.bounces ? ", " + tk.bounces + " bounce(s)" : ""));
        }
      }
      L.push("");

      /* ---- the time ledger -------------------------------------------- */
      L.push("## Time ledger");
      L.push("");
      L.push("| ticket | status | hours | understanding | asks | PRs |");
      L.push("|---|---|---:|---:|---:|---:|");
      for (i = 0; i < this.tickets.length; i++) {
        tk = this.tickets[i];
        L.push("| " + tk.id + " | " + tk.status
          + " | " + h1(tk.minutesSpent / 60)
          + " | " + round1(tk.understanding)
          + " | " + tk.asks.length
          + " | " + (tk.prsOpened || 0) + " |");
      }
      L.push("| **total** |  | **" + h1(this.minutes / 60) + "** |  |  |  |");
      L.push("");

      /* ---- estimates --------------------------------------------------- */
      L.push("## Estimate vs actual");
      L.push("");
      var cal = this._calibration();
      if (!cal.n) {
        L.push("_No ticket was both estimated and worked._");
      } else {
        L.push("| ticket | estimate | actual | ratio |");
        L.push("|---|---:|---:|---:|");
        for (i = 0; i < cal.rows.length; i++) {
          L.push("| " + cal.rows[i].ticketId + " | " + h1(cal.rows[i].est)
            + " | " + h1(cal.rows[i].actual) + " | " + round2(cal.rows[i].ratio) + "× |");
        }
        L.push("");
        L.push("Mean ratio **" + cal.meanRatio + "×**"
          + (cal.optimistic ? " — optimistic." : " — not optimistic.")
          + (cal.worst ? " Worst: " + cal.worst.ticketId + " (" + h1(cal.worst.est)
            + "h estimated, " + h1(cal.worst.actual) + "h actual)." : ""));
      }
      L.push("");

      /* ---- asks --------------------------------------------------------- */
      L.push("## Every question I asked");
      L.push("");
      if (!this.askLog.length) {
        L.push("_I did not ask anyone anything for the whole sprint._");
      } else {
        L.push("| when | ticket | who | classification | hours in | question |");
        L.push("|---|---|---|---|---:|---|");
        for (i = 0; i < this.askLog.length; i++) {
          var a = this.askLog[i];
          L.push("| " + a.t + " | " + a.ticketId
            + " | " + (a.to === "channel" ? "#eng-help" : this.personName(a.to))
            + " | " + a.classification
            + " | " + h1(a.spentBefore)
            + " | " + String(a.question).replace(/\|/g, "/") + " |");
        }
      }
      L.push("");

      /* ---- bounces ------------------------------------------------------- */
      L.push("## Review log");
      L.push("");
      if (!this.reviewLog.length) {
        L.push("_No pull request went to review._");
      } else {
        for (i = 0; i < this.reviewLog.length; i++) {
          var r = this.reviewLog[i];
          L.push("- **" + r.t + " · " + r.ticketId + " · attempt " + r.attempt + "** — "
            + (r.merged ? "merged" : "bounced (" + r.reasons.join(", ") + ")"));
          for (j = 0; j < r.comments.length; j++) L.push("  - " + r.comments[j]);
        }
      }
      L.push("");

      /* ---- trust ---------------------------------------------------------- */
      L.push("## Trust ledger");
      L.push("");
      L.push("| person | role | start | end | delta |");
      L.push("|---|---|---:|---:|---:|");
      var ps = repo.people || [];
      for (i = 0; i < ps.length; i++) {
        var st = isNum(this.startTrust[ps[i].id]) ? this.startTrust[ps[i].id] : RULES.startTrust;
        var en = this.trust[ps[i].id];
        L.push("| " + ps[i].name + " | " + (ps[i].role || "") + " | " + st + " | " + en
          + " | " + sgn(en - st) + " |");
      }
      L.push("");
      L.push("Deepa's time: **" + h1(this.seniorUsed) + "h of " + h1(this.seniorBudget)
        + "h** used.");
      L.push("");
      if (this.trustLog.length) {
        L.push("### What moved it");
        L.push("");
        for (i = 0; i < this.trustLog.length; i++) {
          var tl = this.trustLog[i];
          L.push("- " + tl.t + " · " + tl.name + " " + sgn(tl.delta) + " — " + tl.reason);
        }
        L.push("");
      }

      return L.join("\n");
    }
  };

  global.Dev = Dev;

})(typeof window !== "undefined" ? window
  : (typeof globalThis !== "undefined" ? globalThis : this));
