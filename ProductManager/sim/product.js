/* ==========================================================================
 * sim/product.js  —  window.Product
 *
 * Product Manager Sim: the calendar, engineering capacity, the research queue,
 * the roadmap, trust, and scoring.
 *
 * PURE LOGIC. No DOM access whatsoever. Loads via a plain <script src> tag
 * from a file:// page; no modules, no imports, no libraries, no build step.
 * Unit-testable under node with `global.window = global; require(...)`.
 *
 * Implements SPEC.md §2 exactly. Do not deviate: other files are built
 * against this API.
 *
 * THIS IS THE ONLY FILE PERMITTED TO CALL `SIM_CO.reveal()`. The ground truth
 * is read once at init and never leaves this module except through readings
 * (biased + noisy), slip revisions (which the game deliberately discloses),
 * and the end-of-quarter Score.
 *
 * Hooks other modules use:
 *   Product.capacityDelta(engWeeks, reason)   // the week-7 incident, favours
 *   Product.useFavour({stakeholderId, kind})  // high-trust favours
 *   Product.getFeatures()                     // features with DISPLAYED estimates
 * ========================================================================== */
;(function (global) {
  "use strict";

  /* ---------------------------------------------------------------- rules */

  var RULES = {
    weeks: 12, workDays: 60, engWeeksPerWeek: 4, totalCapacity: 48,
    researchSlots: 2,               // concurrent research activities
    startTrust: 60, minTrust: 0, maxTrust: 100,
    trustHitForNo: 12,              // saying no to a favoured feature
    trustGainForYes: 8,
    lowTrustEng: 40,                // below this, estimates inflate 30%
    lowTrustCeo: 35,                // below this, the CEO inserts a feature
    highTrustFavour: 75,            // above this, a stakeholder does you a favour
    slipWarnAt: 0.6,                // fraction of ESTIMATE at which a slip is revealed
    minRationaleChars: 20
  };

  /* Constants that are not part of the RULES contract but are part of the
   * model. Exposed on Product so tests and the UI can read them. */
  var DEFAULT_SEED   = 20260816;
  var ENG_PAD        = 0.30;   // estimate inflation once eng trust is low
  var NS_NOISE       = 0.60;   // pp of measurement noise on the mid-flight north star
  var HIT_TOLERANCE  = 1.00;   // pp: a forecast "hits" if |predicted - truth| <= this
  var IGNORE_AFTER   = 5;      // working days before an unanswered escalation is "ignored"
  var IGNORE_HIT     = 15;     // trust cost of ignoring an escalation
  var CEO_LOCK_WEEKS = 3;      // weeks a CEO-inserted feature cannot be dropped
  var FAVOUR_CAPACITY = 4;     // eng-weeks granted by the capacity favour
  var VANITY_AT      = 0.5;    // true impact below this = vanity
  var FAVOUR_KINDS   = ["unbiased", "capacity", "absorb"];

  /* -------------------------------------------------------------- helpers */

  function roundTo(x, d) {
    if (!isFinite(x)) return 0;
    var p = Math.pow(10, d);
    // .toFixed(6) first kills binary floating point dust (e.g. 0.1+0.2)
    return Math.round(Number((x * p).toFixed(6))) / p;
  }
  function round1(x) { return roundTo(x, 1); }
  function round2(x) { return roundTo(x, 2); }
  function round4(x) { return roundTo(x, 4); }
  function round6(x) { return roundTo(x, 6); }

  function isNum(x) { return typeof x === "number" && isFinite(x); }
  function num(x) { return isNum(x) ? x : (isFinite(Number(x)) ? Number(x) : 0); }

  function clamp(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }

  function has(arr, x) {
    if (!arr) return false;
    for (var i = 0; i < arr.length; i++) if (arr[i] === x) return true;
    return false;
  }

  function uniq(arr) {
    var out = [];
    for (var i = 0; i < arr.length; i++) if (!has(out, arr[i])) out.push(arr[i]);
    return out;
  }

  function warnErr(e) {
    try {
      if (typeof console !== "undefined" && console && console.error) console.error(e);
    } catch (x) { /* ignore */ }
  }

  function pp(x) { return (x >= 0 ? "+" : "") + round1(x).toFixed(1); }
  function ew(x) { return round1(x).toFixed(1); }

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

  /* ============================================================== Product */

  var Product = {
    RULES: RULES,
    DEFAULT_SEED: DEFAULT_SEED,
    ENG_PAD: ENG_PAD,
    NS_NOISE: NS_NOISE,
    HIT_TOLERANCE: HIT_TOLERANCE,
    IGNORE_AFTER_DAYS: IGNORE_AFTER,
    IGNORE_TRUST_HIT: IGNORE_HIT,
    CEO_LOCK_WEEKS: CEO_LOCK_WEEKS,
    FAVOUR_CAPACITY: FAVOUR_CAPACITY,
    VANITY_AT: VANITY_AT,
    FAVOUR_KINDS: FAVOUR_KINDS.slice(),

    /* ---- internals (underscored; not part of the contract) --------- */
    _co: null,
    _truth: null,
    _rand: null,
    _listeners: null,
    _timer: null,
    _seq: 0,

    /* ================================================== lifecycle ==== */

    /**
     * Product.init({ co, seed })
     * co defaults to the global SIM_CO; seed defaults to 20260816.
     */
    init: function (opts) {
      opts = opts || {};
      var co = opts.co || (global && global.SIM_CO) || null;
      if (!co || !co.features || !co.features.length || !co.instruments || !co.instruments.length) {
        throw new Error("Product.init: a SIM_CO with features and instruments is required");
      }
      if (typeof co.reveal !== "function") {
        throw new Error("Product.init: co.reveal() is required (the encoded ground truth)");
      }

      this._stopTimer();
      this._co = co;
      this._truth = co.reveal();     // <- the ONLY reveal() call in the codebase
      if (!this._truth || !this._truth.impact || !this._truth.trueCost || !this._truth.bias) {
        throw new Error("Product.init: co.reveal() did not return impact/trueCost/bias");
      }

      this.seed = isNum(opts.seed) ? (opts.seed >>> 0) : DEFAULT_SEED;
      this._rand = mulberry32(this.seed);
      this._listeners = {
        tick: [], reading: [], ship: [], slip: [], trust: [], event: [], quarterEnd: [], reject: []
      };
      this._seq = 0;

      /* ---- calendar ------------------------------------------------ */
      this.day = 0;                  // completed working days, 0..60
      this.running = false;
      this.started = false;
      this.finished = false;
      this.speed = 2;                // working days per real second
      this.qbrSubmitted = false;
      this.qbr = null;
      this.score = null;

      /* ---- capacity ------------------------------------------------ */
      this.perDay = RULES.engWeeksPerWeek / (co.scenario && co.scenario.quarter
        && co.scenario.quarter.workDaysPerWeek ? co.scenario.quarter.workDaysPerWeek : 5);
      this.capacityBudget = RULES.totalCapacity;
      this.capacityUsed = 0;
      this.capacityLedger = [];      // [{day, week, t, engWeeks, reason}]

      /* ---- roadmap / research -------------------------------------- */
      this.roadmap = [];
      this.shipped = [];
      this.researchRunning = [];
      this.readings = [];
      this.commits = [];
      this.slips = [];
      this.instrumentUse = {};
      for (var i = 0; i < co.instruments.length; i++) this.instrumentUse[co.instruments[i].id] = 0;

      /* ---- people -------------------------------------------------- */
      this.trust = {};
      this.trustLog = [];
      this.favours = [];
      var sh = co.stakeholders || [];
      for (i = 0; i < sh.length; i++) {
        this.trust[sh[i].id] = isNum(sh[i].startTrust) ? sh[i].startTrust : RULES.startTrust;
      }
      this._engId = this._roleId(/eng/i, "rina");
      this._ceoId = this._roleId(/ceo|chief exec/i, "marguerite");
      this._engPad = false;          // latches on the first time eng trust goes low
      this._unbiasedCredits = 0;
      this._absorbCredits = 0;

      /* ---- events -------------------------------------------------- */
      this._events = [];
      var evs = co.events || [];
      for (i = 0; i < evs.length; i++) {
        var e = evs[i];
        var w = isNum(e.week) ? e.week : 1;
        var d = isNum(e.day) ? e.day : 1;
        this._events.push({
          id: e.id || ("ev" + i),
          fireDay: clamp((w - 1) * 5 + d, 1, RULES.workDays),
          week: w, day: d,
          from: e.from || "CEO", name: e.name || "",
          text: e.text || "", tone: e.tone || "neutral",
          needsReply: !!e.needsReply,
          featureId: e.featureId || null,
          capacityDelta: isNum(e.capacityDelta) ? e.capacityDelta : 0,
          fired: false, answered: false, ignored: false, absorbed: false,
          choice: null, rationale: "", openedDay: null
        });
      }
      this._events.sort(function (a, b) { return a.fireDay - b.fireDay; });
      this.openEvents = [];
      this.firedEvents = [];

      /* ---- the metric ---------------------------------------------- */
      var ns = (co.scenario && co.scenario.northStar) || {};
      this.baseline = isNum(ns.baseline) ? ns.baseline : 0;
      this._nsNoise = 0;

      return this.getState();
    },

    _roleId: function (re, fallback) {
      var sh = (this._co && this._co.stakeholders) || [];
      for (var i = 0; i < sh.length; i++) {
        if (re.test(String(sh[i].role || "")) || re.test(String(sh[i].id || ""))) return sh[i].id;
      }
      for (i = 0; i < sh.length; i++) if (sh[i].id === fallback) return fallback;
      return sh.length ? sh[0].id : fallback;
    },

    /** begin the quarter on a timer */
    start: function () {
      if (!this._co) throw new Error("Product.start: call Product.init first");
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
      if (!this._co || this.finished) return this.getState();
      this.started = true;
      this.running = true;
      this._startTimer();
      return this.getState();
    },

    /** working days per real second */
    setSpeed: function (mult) {
      mult = Number(mult) || 2;
      if (mult <= 0) mult = 2;
      this.speed = mult;
      if (this.running) this._startTimer();
      return this.speed;
    },

    dayIntervalMs: function () { return 1000 / this.speed; },

    destroy: function () {
      this._stopTimer();
      this.running = false;
      this._listeners = {
        tick: [], reading: [], ship: [], slip: [], trust: [], event: [], quarterEnd: [], reject: []
      };
      this._co = null;
      this._truth = null;
      this.roadmap = [];
      this.researchRunning = [];
      this.openEvents = [];
    },

    _startTimer: function () {
      this._stopTimer();
      var self = this;
      if (typeof setInterval !== "function") return;
      this._timer = setInterval(function () {
        if (!self.running) return;
        self.step();
      }, this.dayIntervalMs());
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

    /* ==================================================== calendar ==== */

    /** week number for a completed-day count (day 0 reads as week 1) */
    weekOf: function (day) {
      if (day <= 0) return 1;
      return Math.min(RULES.weeks, Math.floor((day - 1) / 5) + 1);
    },

    week: function () { return this.weekOf(this.day); },

    dayOfWeek: function () { return this.day - 5 * (this.week() - 1); },

    stamp: function () { return "W" + this.week() + " D" + this.dayOfWeek(); },

    daysLeft: function () { return Math.max(0, RULES.workDays - this.day); },

    /** whole working weeks of runway left */
    weeksLeft: function () { return Math.floor(this.daysLeft() / 5); },

    /* ======================================================== truth ==== */
    /* Everything below this line reads ground truth. Nothing above it does,
     * and nothing outside this module may. */

    _impactOf: function (fid) {
      return num(this._truth.impact[fid]);
    },

    _trueCostOf: function (fid) {
      var t = this._truth.trueCost[fid];
      if (isNum(t)) return t;
      var f = this.featureById(fid);
      return f ? num(f.estCost) : 0;
    },

    _tagsOf: function (fid) {
      var t = this._truth.tags && this._truth.tags[fid];
      if (t && t.length) return t;
      var f = this.featureById(fid);
      return (f && f.tags) || [];
    },

    /** true north-star value of a shipped set, interactions included */
    _valueOf: function (ids) {
      var v = 0, i;
      for (i = 0; i < ids.length; i++) v += this._impactOf(ids[i]);
      var inter = this._truth.interactions || [];
      for (i = 0; i < inter.length; i++) {
        var p = inter[i].pair || [];
        if (p.length === 2 && has(ids, p[0]) && has(ids, p[1])) v += num(inter[i].delta);
      }
      return round4(v);
    },

    /** N(0,1) via Box-Muller. Consumes EXACTLY two uniforms. */
    _gauss: function () {
      var u1 = 1 - this._rand();      // (0,1]
      var u2 = this._rand();          // [0,1)
      return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    },

    /**
     * reading = trueImpact + Σ_{tag} bias[instrument][tag] + gauss(0, _noise)
     * The gaussian is ALWAYS drawn (even for an unbiased favour, even for a
     * zero-noise instrument) so the random stream shape never depends on state.
     */
    _reading: function (featureId, instrumentId, unbiased) {
      var b = (this._truth.bias && this._truth.bias[instrumentId]) || {};
      var tags = this._tagsOf(featureId);
      var bias = 0;
      if (!unbiased) {
        for (var i = 0; i < tags.length; i++) bias += num(b[tags[i]]);
      }
      var noise = num(b._noise);
      var g = this._gauss();
      return round2(this._impactOf(featureId) + bias + g * noise);
    },

    /* ===================================================== lookups ==== */

    featureById: function (id) {
      var fs = (this._co && this._co.features) || [];
      for (var i = 0; i < fs.length; i++) if (fs[i].id === id) return fs[i];
      return null;
    },

    instrumentById: function (id) {
      var is = (this._co && this._co.instruments) || [];
      for (var i = 0; i < is.length; i++) if (is[i].id === id) return is[i];
      return null;
    },

    stakeholderById: function (id) {
      var sh = (this._co && this._co.stakeholders) || [];
      for (var i = 0; i < sh.length; i++) if (sh[i].id === id) return sh[i];
      return null;
    },

    entryFor: function (fid) {
      for (var i = 0; i < this.roadmap.length; i++) if (this.roadmap[i].featureId === fid) return this.roadmap[i];
      return null;
    },

    /** the estimate the player is shown — padded once engineering trust is low */
    displayedEstimate: function (fid) {
      var f = this.featureById(fid);
      if (!f) return 0;
      var e = num(f.estCost);
      return this._engPad ? round2(e * (1 + ENG_PAD)) : round2(e);
    },

    /** features as the player sees them: DISPLAYED estimates, no truth */
    getFeatures: function () {
      var fs = (this._co && this._co.features) || [];
      var out = [];
      for (var i = 0; i < fs.length; i++) {
        var f = fs[i];
        var e = this.entryFor(f.id);
        out.push({
          id: f.id, name: f.name, tags: (f.tags || []).slice(), desc: f.desc || "",
          estCost: this.displayedEstimate(f.id),
          baseEstCost: round2(num(f.estCost)),
          padded: !!this._engPad,
          owner: f.owner || null, pitchedBy: f.pitchedBy || "",
          status: e ? e.status : "none",
          readings: this.readingsFor(f.id)
        });
      }
      return out;
    },

    readingsFor: function (fid) {
      var out = [];
      for (var i = 0; i < this.readings.length; i++) {
        if (this.readings[i].featureId === fid) out.push(this._copyReading(this.readings[i]));
      }
      return out;
    },

    _copyReading: function (r) {
      return {
        id: r.id, featureId: r.featureId, featureName: r.featureName,
        instrumentId: r.instrumentId, instrumentName: r.instrumentName,
        value: r.value, day: r.day, week: r.week, t: r.t, unbiased: !!r.unbiased
      };
    },

    /* ======================================================= trust ==== */

    _setTrust: function (id, delta, reason) {
      if (!(id in this.trust)) return;
      var from = this.trust[id];
      var to = clamp(Math.round(from + delta), RULES.minTrust, RULES.maxTrust);
      if (to === from) return;
      this.trust[id] = to;
      var rec = {
        day: this.day, week: this.week(), t: this.stamp(),
        stakeholderId: id, name: (this.stakeholderById(id) || {}).name || id,
        from: from, to: to, delta: to - from, reason: reason || ""
      };
      this.trustLog.push(rec);
      this._emit("trust", [rec]);
      this._checkTrustEffects();
    },

    _checkTrustEffects: function () {
      // engineering pads its estimates and never un-pads them
      if (!this._engPad && this.trust[this._engId] < RULES.lowTrustEng) {
        this._engPad = true;
        this._fire({
          type: "estimateInflation", from: "ENG",
          stakeholderId: this._engId,
          text: "Estimates are going up 30% across the board. You'll get the padded number from now on."
        });
      }
      // a stakeholder who trusts you does you exactly one favour
      var ids = Object.keys(this.trust);
      for (var i = 0; i < ids.length; i++) {
        if (this.trust[ids[i]] > RULES.highTrustFavour && !this._favourFor(ids[i])) {
          var s = this.stakeholderById(ids[i]) || {};
          var fav = {
            stakeholderId: ids[i], name: s.name || ids[i], role: s.role || "",
            grantedDay: this.day, grantedWeek: this.week(),
            kinds: FAVOUR_KINDS.slice(), used: false, kind: null
          };
          this.favours.push(fav);
          this._fire({
            type: "favour", from: "CEO", stakeholderId: ids[i],
            text: (s.name || ids[i]) + " owes you one: an unbiased reading, +"
              + FAVOUR_CAPACITY + " eng-weeks, or absorbing an escalation."
          });
        }
      }
    },

    _favourFor: function (id) {
      for (var i = 0; i < this.favours.length; i++) if (this.favours[i].stakeholderId === id) return this.favours[i];
      return null;
    },

    /** Product.useFavour({stakeholderId, kind}) */
    useFavour: function (req) {
      req = req || {};
      var fav = this._favourFor(req.stakeholderId);
      if (!fav) return this._reject("No favour available from that stakeholder");
      if (fav.used) return this._reject("That favour is already used");
      var kind = String(req.kind || "");
      if (!has(FAVOUR_KINDS, kind)) return this._reject("Unknown favour: " + kind);

      fav.used = true;
      fav.kind = kind;
      fav.usedDay = this.day;
      if (kind === "unbiased") this._unbiasedCredits += 1;
      else if (kind === "capacity") this.capacityDelta(FAVOUR_CAPACITY, "favour from " + fav.name);
      else if (kind === "absorb") this._absorbCredits += 1;

      this._fire({
        type: "favourUsed", from: "CEO", stakeholderId: fav.stakeholderId,
        text: fav.name + " called in the favour: " + kind + "."
      });
      return { ok: true, favour: this._copyFavour(fav) };
    },

    _copyFavour: function (f) {
      return {
        stakeholderId: f.stakeholderId, name: f.name, role: f.role,
        grantedDay: f.grantedDay, grantedWeek: f.grantedWeek,
        kinds: f.kinds.slice(), used: !!f.used, kind: f.kind
      };
    },

    _championsOf: function (fid) {
      var sh = (this._co && this._co.stakeholders) || [];
      var out = [];
      for (var i = 0; i < sh.length; i++) if (has(sh[i].favors, fid)) out.push(sh[i].id);
      return out;
    },

    avgTrust: function () {
      var ids = Object.keys(this.trust);
      if (!ids.length) return 0;
      var s = 0;
      for (var i = 0; i < ids.length; i++) s += this.trust[ids[i]];
      return round1(s / ids.length);
    },

    /* ==================================================== capacity ==== */

    /**
     * Adjust the quarter's capacity budget. Used by the week-7 incident
     * (negative) and the capacity favour (positive). Never changes what has
     * already been consumed.
     */
    capacityDelta: function (engWeeks, reason) {
      var d = num(engWeeks);
      if (!d) return this.capacityBudget;
      this.capacityBudget = round6(Math.max(0, this.capacityBudget + d));
      this.capacityLedger.push({
        day: this.day, week: this.week(), t: this.stamp(),
        engWeeks: round2(d), reason: reason || ""
      });
      this._fire({
        type: "capacity", from: "ENG",
        text: (d < 0 ? "Lost " : "Gained ") + ew(Math.abs(d)) + " eng-weeks"
          + (reason ? " — " + reason : "") + "."
      });
      return this.capacityBudget;
    },

    /** eng-weeks still available: the smaller of the budget and the calendar */
    capacityLeft: function () {
      var byBudget = round6(this.capacityBudget - this.capacityUsed);
      var byTime = round6(this.perDay * this.daysLeft());
      return round2(Math.max(0, Math.min(byBudget, byTime)));
    },

    /** eng-weeks of outstanding work already on the roadmap (displayed estimates) */
    capacityCommitted: function () {
      var s = 0;
      for (var i = 0; i < this.roadmap.length; i++) {
        var e = this.roadmap[i];
        if (e.status !== "queued" && e.status !== "building") continue;
        var target = isNum(e.revisedEstimate) ? e.revisedEstimate : e.estimate;
        s += Math.max(0, target - e.engWeeksSpent);
      }
      return round2(s);
    },

    /* ==================================================== research ==== */

    /**
     * Product.research({featureId, instrumentId}) -> {ok, activity}|{ok:false,error}
     */
    research: function (req) {
      req = req || {};
      if (this.finished || this.qbrSubmitted) return this._reject("The quarter is over");
      var f = this.featureById(req.featureId);
      if (!f) return this._reject("No such feature");
      var ins = this.instrumentById(req.instrumentId);
      if (!ins) return this._reject("No such instrument");

      // the cleanest instrument arrives after the decision is made
      var needsShipped = (ins.requiresShipped === true) || ins.id === "ab_test";
      if (needsShipped && !has(this.shipped, f.id)) {
        return this._reject("You can only A/B test something that has shipped");
      }

      var i;
      for (i = 0; i < this.researchRunning.length; i++) {
        if (this.researchRunning[i].featureId === f.id
          && this.researchRunning[i].instrumentId === ins.id) {
          return this._reject("That research is already running");
        }
      }

      var need = isNum(ins.slots) ? ins.slots : 1;
      if (this.slotsUsed() + need > RULES.researchSlots) return this._reject("No free research slots");

      var days = Math.max(1, Math.round(num(ins.days) || 1));
      var act = {
        id: "R" + (++this._seq),
        featureId: f.id, featureName: f.name,
        instrumentId: ins.id, instrumentName: ins.name,
        knownCaveat: ins.knownCaveat || "",
        slots: need,
        startDay: this.day, days: days, endDay: this.day + days
      };
      this.researchRunning.push(act);
      this.instrumentUse[ins.id] = (this.instrumentUse[ins.id] || 0) + 1;
      return { ok: true, activity: this._copyActivity(act) };
    },

    slotsUsed: function () {
      var s = 0;
      for (var i = 0; i < this.researchRunning.length; i++) s += this.researchRunning[i].slots;
      return s;
    },

    _copyActivity: function (a) {
      var left = Math.max(0, a.endDay - this.day);
      return {
        id: a.id, featureId: a.featureId, featureName: a.featureName,
        instrumentId: a.instrumentId, instrumentName: a.instrumentName,
        knownCaveat: a.knownCaveat, slots: a.slots,
        startDay: a.startDay, days: a.days, endDay: a.endDay,
        daysLeft: left,
        progress: a.days > 0 ? round4(clamp((a.days - left) / a.days, 0, 1)) : 1
      };
    },

    /** completions are processed in start order — a fixed random stream */
    _runResearch: function () {
      if (!this.researchRunning.length) return;
      var still = [];
      for (var i = 0; i < this.researchRunning.length; i++) {
        var a = this.researchRunning[i];
        if (a.endDay > this.day) { still.push(a); continue; }
        var unbiased = false;
        if (this._unbiasedCredits > 0) { unbiased = true; this._unbiasedCredits -= 1; }
        var r = {
          id: "D" + (++this._seq),
          activityId: a.id,
          featureId: a.featureId, featureName: a.featureName,
          instrumentId: a.instrumentId, instrumentName: a.instrumentName,
          value: this._reading(a.featureId, a.instrumentId, unbiased),
          unbiased: unbiased,
          day: this.day, week: this.week(), t: this.stamp()
        };
        this.readings.push(r);
        this._emit("reading", [this._copyReading(r)]);
      }
      this.researchRunning = still;
    },

    /* ===================================================== roadmap ==== */

    /**
     * Product.commit({featureId, predictedImpact, rationale})
     * Every commit is a forecast on the record. That is the calibration data.
     */
    commit: function (req) {
      req = req || {};
      if (this.finished || this.qbrSubmitted) return this._reject("The quarter is over");
      var f = this.featureById(req.featureId);
      if (!f) return this._reject("No such feature");

      var predicted = Number(req.predictedImpact);
      if (req.predictedImpact === null || req.predictedImpact === undefined
        || req.predictedImpact === "" || !isFinite(predicted)) {
        return this._reject("Predicted impact required");
      }
      var rationale = (typeof req.rationale === "string") ? req.rationale.trim() : "";
      if (rationale.length < RULES.minRationaleChars) return this._reject("Rationale required");

      var e = this.entryFor(f.id);
      if (e && (e.status === "queued" || e.status === "building")) {
        return this._reject("That feature is already on the roadmap");
      }
      if (e && e.status === "shipped") return this._reject("That feature already shipped");

      var est = this.displayedEstimate(f.id);
      if (est > this.capacityLeft() + 1e-9) return this._reject("Not enough capacity left this quarter");

      if (e) {
        // re-committing something you dropped: the work already done is not lost
        e.status = "queued";
        e.estimate = est;
        e.droppedDay = null;
        this._moveToQueueTail(e);
      } else {
        e = this._newEntry(f.id, est);
        this.roadmap.push(e);
      }

      var rec = {
        featureId: f.id, featureName: f.name,
        predictedImpact: round2(predicted), rationale: rationale,
        estimate: est, day: this.day, week: this.week(), t: this.stamp(),
        researchCount: this.readingsFor(f.id).length
      };
      this.commits.push(rec);
      this._fire({
        type: "commit", from: "ENG", featureId: f.id,
        text: "Committed " + f.name + " (" + ew(est) + " eng-weeks estimated, forecast "
          + pp(predicted) + "pp)."
      });
      return { ok: true, entry: this._copyEntry(e), commit: rec };
    },

    _newEntry: function (fid, est) {
      return {
        featureId: fid,
        status: "queued",
        engWeeksSpent: 0,
        estimate: est,
        revisedEstimate: null,
        slipped: false,
        insertedBy: null,
        lockedUntilWeek: 0,
        startedDay: null,
        shippedDay: null,
        shippedWeek: null,
        droppedDay: null
      };
    },

    _moveToQueueTail: function (e) {
      var i = this.roadmap.indexOf(e);
      if (i >= 0) this.roadmap.splice(i, 1);
      // after the last queued/building entry, before dropped ones
      var at = this.roadmap.length;
      for (var j = this.roadmap.length - 1; j >= 0; j--) {
        if (this.roadmap[j].status === "dropped") at = j; else break;
      }
      this.roadmap.splice(at, 0, e);
    },

    /**
     * Product.setRoadmap([featureIds]) — ordered; only affects UNSTARTED work.
     * Shipped and in-flight entries keep their place at the head; dropped
     * entries sink to the tail. Ids not already on the roadmap are ignored
     * (commit is the only way on, because commit demands a forecast).
     */
    setRoadmap: function (ids) {
      if (this.finished || this.qbrSubmitted) return this._reject("The quarter is over");
      ids = uniq((ids || []).slice());
      var locked = [], queued = [], dropped = [], i;
      for (i = 0; i < this.roadmap.length; i++) {
        var e = this.roadmap[i];
        if (e.status === "shipped" || e.status === "building") locked.push(e);
        else if (e.status === "dropped") dropped.push(e);
        else queued.push(e);
      }
      var ordered = [];
      for (i = 0; i < ids.length; i++) {
        for (var j = 0; j < queued.length; j++) {
          if (queued[j].featureId === ids[i] && ordered.indexOf(queued[j]) === -1) {
            ordered.push(queued[j]); break;
          }
        }
      }
      for (i = 0; i < queued.length; i++) if (ordered.indexOf(queued[i]) === -1) ordered.push(queued[i]);
      this.roadmap = locked.concat(ordered, dropped);
      return { ok: true, roadmap: this.getRoadmap() };
    },

    /**
     * Product.drop(featureId) — costs trust with everyone who championed it.
     */
    drop: function (fid) {
      if (this.finished || this.qbrSubmitted) return this._reject("The quarter is over");
      var e = this.entryFor(fid);
      if (!e) return this._reject("That feature is not on the roadmap");
      if (e.status === "shipped") return this._reject("That feature already shipped — you can't drop it");
      if (e.status === "dropped") return this._reject("That feature is already dropped");
      if (e.insertedBy === "ceo" && this.week() < e.lockedUntilWeek) {
        return this._reject("Marguerite put that on the roadmap — you can't drop it until week "
          + e.lockedUntilWeek);
      }

      e.status = "dropped";
      e.droppedDay = this.day;
      this._moveToQueueTail(e);

      var f = this.featureById(fid) || { name: fid };
      var champs = this._championsOf(fid);
      for (var i = 0; i < champs.length; i++) {
        this._setTrust(champs[i], -RULES.trustHitForNo, "you dropped " + f.name);
      }
      this._fire({
        type: "drop", from: "ENG", featureId: fid,
        text: "Dropped " + f.name + (champs.length ? " — that lands on " + champs.length + " desk(s)." : ".")
      });
      return { ok: true, entry: this._copyEntry(e), champions: champs.slice() };
    },

    getRoadmap: function () {
      var out = [];
      for (var i = 0; i < this.roadmap.length; i++) out.push(this._copyEntry(this.roadmap[i]));
      return out;
    },

    _copyEntry: function (e) {
      var f = this.featureById(e.featureId) || {};
      var target = isNum(e.revisedEstimate) ? e.revisedEstimate : e.estimate;
      var progress = e.status === "shipped" ? 1
        : (target > 0 ? round4(clamp(e.engWeeksSpent / target, 0, 1)) : 0);
      return {
        featureId: e.featureId,
        name: f.name || e.featureId,
        status: e.status,
        progress: progress,
        engWeeksSpent: round2(e.engWeeksSpent),
        estimate: e.estimate,
        revisedEstimate: e.revisedEstimate,
        slipped: !!e.slipped,
        insertedBy: e.insertedBy,
        lockedUntilWeek: e.lockedUntilWeek,
        startedDay: e.startedDay,
        shippedDay: e.shippedDay,
        shippedWeek: e.shippedWeek,
        droppedDay: e.droppedDay
      };
    },

    /* ================================================= the builder ==== */

    _nextBuildable: function () {
      for (var i = 0; i < this.roadmap.length; i++) {
        var e = this.roadmap[i];
        if (e.status === "queued" || e.status === "building") return e;
      }
      return null;
    },

    /**
     * One working day of engineering. `engWeeksPerWeek/5` eng-weeks go into the
     * roadmap in order; when a feature completes mid-day the remainder rolls
     * onto the next one. A feature ships ONLY when its trueCost is fully
     * consumed — there is no partial credit anywhere in this sim.
     */
    _build: function () {
      var budgetLeft = round6(this.capacityBudget - this.capacityUsed);
      var pool = Math.min(this.perDay, Math.max(0, budgetLeft));
      var guard = 0;
      while (pool > 1e-9 && guard++ < 200) {
        var e = this._nextBuildable();
        if (!e) break;
        if (e.status === "queued") {
          e.status = "building";
          e.startedDay = this.day;
        }
        var trueCost = this._trueCostOf(e.featureId);
        var need = round6(trueCost - e.engWeeksSpent);
        if (need <= 1e-9) { this._ship(e); continue; }
        var take = Math.min(pool, need);
        e.engWeeksSpent = round6(e.engWeeksSpent + take);
        this.capacityUsed = round6(this.capacityUsed + take);
        pool = round6(pool - take);
        this._checkSlip(e, trueCost);
        if (e.engWeeksSpent >= trueCost - 1e-9) this._ship(e);
      }
    },

    /**
     * At `slipWarnAt` of the ESTIMATE, if the true cost is worse than the
     * estimate, engineering finally says so and hands over a revised number.
     */
    _checkSlip: function (e, trueCost) {
      if (e.slipped) return;
      var f = this.featureById(e.featureId) || {};
      var rawEst = num(f.estCost);
      if (trueCost <= rawEst) return;
      if (e.engWeeksSpent + 1e-9 < RULES.slipWarnAt * e.estimate) return;

      e.slipped = true;
      e.revisedEstimate = round1(trueCost);
      var rec = {
        featureId: e.featureId, name: f.name || e.featureId,
        estimate: e.estimate, revisedEstimate: e.revisedEstimate,
        overBy: round2(e.revisedEstimate - e.estimate),
        engWeeksSpent: round2(e.engWeeksSpent),
        day: this.day, week: this.week(), t: this.stamp()
      };
      this.slips.push(rec);
      this._emit("slip", [rec]);
    },

    _ship: function (e) {
      var f = this.featureById(e.featureId) || {};
      e.status = "shipped";
      e.engWeeksSpent = round6(this._trueCostOf(e.featureId));
      e.shippedDay = this.day;
      e.shippedWeek = this.week();
      if (!has(this.shipped, e.featureId)) this.shipped.push(e.featureId);

      var rec = {
        featureId: e.featureId, name: f.name || e.featureId,
        day: this.day, week: this.week(), t: this.stamp(),
        engWeeksSpent: round2(e.engWeeksSpent),
        estimate: e.estimate
      };
      this._emit("ship", [rec]);

      var champs = this._championsOf(e.featureId);
      for (var i = 0; i < champs.length; i++) {
        this._setTrust(champs[i], RULES.trustGainForYes, "you shipped " + (f.name || e.featureId));
      }
    },

    /* ================================================== escalations ==== */

    _fire: function (ev) {
      var e = {
        id: ev.id || ("x" + (++this._seq)),
        type: ev.type || "event",
        from: ev.from || "CEO",
        name: ev.name || "",
        text: ev.text || "",
        tone: ev.tone || "neutral",
        needsReply: !!ev.needsReply,
        featureId: ev.featureId || null,
        stakeholderId: ev.stakeholderId || null,
        day: this.day, week: this.week(), t: this.stamp()
      };
      this.firedEvents.push(e);
      this._emit("event", [e]);
      return e;
    },

    _fireScripted: function () {
      for (var i = 0; i < this._events.length; i++) {
        var e = this._events[i];
        if (e.fired || e.fireDay !== this.day) continue;
        e.fired = true;
        e.openedDay = this.day;
        if (e.capacityDelta) this.capacityDelta(e.capacityDelta, e.name || e.id);
        this._fire({
          id: e.id, type: "scripted", from: e.from, name: e.name, text: e.text,
          tone: e.tone, needsReply: e.needsReply, featureId: e.featureId
        });
        if (e.needsReply) this.openEvents.push(e);
      }
    },

    _stakeholderForVoice: function (from) {
      switch (String(from || "").toUpperCase()) {
        case "CEO": return this._ceoId;
        case "ENG": return this._engId;
        case "SALES": return this._roleId(/sales/i, "dan");
        case "DESIGN": return this._roleId(/design/i, "kofi");
        case "SUPPORT": return this._roleId(/support/i, "tomas");
        default: return null;
      }
    },

    /**
     * Product.respond({eventId, choice, rationale})
     *   choice "yes"|"accept"   -> +trustGainForYes
     *   choice "no"|"decline"   -> -trustHitForNo, halved if you give a reason
     *   choice "defer"          -> -trustHitForNo/2
     * Marguerite respects a no with a reason and punishes a no with a process.
     */
    respond: function (req) {
      req = req || {};
      if (this.qbrSubmitted) return this._reject("The quarter is over");
      var ev = null;
      for (var i = 0; i < this._events.length; i++) if (this._events[i].id === req.eventId) ev = this._events[i];
      if (!ev) return this._reject("No such event");
      if (!ev.needsReply) return this._reject("That event doesn't need a reply");
      if (ev.answered) return this._reject("That event is already answered");
      if (ev.ignored) return this._reject("That event is already answered");

      var raw = String(req.choice || "").toLowerCase();
      if (!raw) return this._reject("Choice required");
      var choice;
      if (raw === "yes" || raw === "accept" || raw === "commit") choice = "accept";
      else if (raw === "no" || raw === "decline" || raw === "reject") choice = "decline";
      else if (raw === "defer" || raw === "later") choice = "defer";
      else return this._reject("Choice must be yes, no or defer");

      var rationale = (typeof req.rationale === "string") ? req.rationale.trim() : "";
      var who = this._stakeholderForVoice(ev.from);
      var delta = 0;
      if (choice === "accept") delta = RULES.trustGainForYes;
      else if (choice === "decline") {
        delta = -RULES.trustHitForNo;
        if (rationale.length >= RULES.minRationaleChars) delta = -Math.round(RULES.trustHitForNo / 2);
      } else {
        delta = -Math.round(RULES.trustHitForNo / 2);
      }

      if (delta < 0 && this._absorbCredits > 0) {
        this._absorbCredits -= 1;
        ev.absorbed = true;
        delta = 0;
      }

      ev.answered = true;
      ev.choice = choice;
      ev.rationale = rationale;
      ev.answeredDay = this.day;
      this._closeOpen(ev.id);
      if (who && delta) this._setTrust(who, delta, "you answered " + ev.id + ": " + choice);

      return {
        ok: true,
        event: this._copyEvent(ev),
        trustDelta: delta,
        absorbed: !!ev.absorbed
      };
    },

    _closeOpen: function (id) {
      for (var i = this.openEvents.length - 1; i >= 0; i--) {
        if (this.openEvents[i].id === id) this.openEvents.splice(i, 1);
      }
    },

    /** an escalation left open too long is an answer of its own */
    _checkIgnored: function (force) {
      for (var i = this.openEvents.length - 1; i >= 0; i--) {
        var ev = this.openEvents[i];
        var age = this.day - ev.openedDay;
        if (!force && age < IGNORE_AFTER) continue;
        ev.ignored = true;
        ev.ignoredDay = this.day;
        var who = this._stakeholderForVoice(ev.from);
        var hit = IGNORE_HIT;
        if (this._absorbCredits > 0) { this._absorbCredits -= 1; ev.absorbed = true; hit = 0; }
        this.openEvents.splice(i, 1);
        if (who && hit) this._setTrust(who, -hit, "you never answered " + ev.id);
      }
    },

    _copyEvent: function (e) {
      return {
        id: e.id, type: "scripted", from: e.from, name: e.name, text: e.text,
        tone: e.tone, needsReply: !!e.needsReply, featureId: e.featureId,
        week: e.week, day: e.day, fireDay: e.fireDay,
        answered: !!e.answered, ignored: !!e.ignored, absorbed: !!e.absorbed,
        choice: e.choice, rationale: e.rationale, openedDay: e.openedDay,
        daysOpen: e.openedDay === null ? 0 : Math.max(0, this.day - e.openedDay)
      };
    },

    getOpenEvents: function () {
      var out = [];
      for (var i = 0; i < this.openEvents.length; i++) out.push(this._copyEvent(this.openEvents[i]));
      return out;
    },

    /* ============================================ the CEO's override ==== */

    _ceoInsert: function () {
      if (this.trust[this._ceoId] >= RULES.lowTrustCeo) return;
      var ceo = this.stakeholderById(this._ceoId) || {};
      var wants = (ceo.favors || []).slice();
      var pick = null, i;
      for (i = 0; i < wants.length; i++) {
        if (this._insertable(wants[i])) { pick = wants[i]; break; }
      }
      if (!pick) {
        var fs = (this._co && this._co.features) || [];
        for (i = 0; i < fs.length; i++) if (this._insertable(fs[i].id)) { pick = fs[i].id; break; }
      }
      if (!pick) return;

      var f = this.featureById(pick) || {};
      var e = this.entryFor(pick);
      if (!e) {
        e = this._newEntry(pick, this.displayedEstimate(pick));
        this.roadmap.push(e);
      }
      e.status = "queued";
      e.droppedDay = null;
      e.estimate = this.displayedEstimate(pick);
      e.insertedBy = "ceo";
      e.lockedUntilWeek = this.week() + CEO_LOCK_WEEKS;

      // head of the roadmap: ahead of everything queued, behind work in flight
      var idx = this.roadmap.indexOf(e);
      if (idx >= 0) this.roadmap.splice(idx, 1);
      var at = this.roadmap.length;
      for (i = 0; i < this.roadmap.length; i++) {
        var o = this.roadmap[i];
        if (o.status === "shipped" || o.status === "building") continue;
        at = i; break;
      }
      this.roadmap.splice(at, 0, e);

      this._fire({
        type: "ceoInsert", from: "CEO", stakeholderId: this._ceoId, featureId: pick,
        tone: "alarm",
        text: "I've put " + (f.name || pick) + " at the top of the roadmap. It stays there until week "
          + e.lockedUntilWeek + "."
      });
    },

    _insertable: function (fid) {
      var e = this.entryFor(fid);
      if (!e) return true;
      return e.status === "dropped";
    },

    /* ==================================================== the clock ==== */

    /** advance exactly one working day (works while paused) */
    step: function () {
      if (!this._co || this.finished) return this.getState();

      this.day += 1;

      // 1) research first: completions can unlock an A/B test the same day
      this._runResearch();
      // 2) engineering
      this._build();
      // 3) the calendar's scripted noise
      this._fireScripted();
      // 4) escalations you never answered
      this._checkIgnored(false);
      // 5) the week boundary belongs to the CEO
      if (this.day % 5 === 0) this._ceoInsert();
      // 6) the metric, measured with noise until the quarter closes
      this._nsNoise = this._gauss() * NS_NOISE;

      if (this.day >= RULES.workDays) {
        this.day = RULES.workDays;
        this.finished = true;
        this.running = false;
        this._stopTimer();
        this._checkIgnored(true);
        this._nsNoise = 0;
        this._emit("tick", [this.getState()]);
        this._emit("quarterEnd", [this.getState()]);
        return this.getState();
      }

      this._emit("tick", [this.getState()]);
      return this.getState();
    },

    /** advance n working days */
    advance: function (days) {
      var n = Math.max(0, Math.floor(Number(days) || 0));
      for (var i = 0; i < n && !this.finished; i++) this.step();
      return this.getState();
    },

    /* ======================================================= state ==== */

    /** true north-star level right now (shipped only). No noise. */
    northStarActual: function () {
      return round1(this.baseline + this._valueOf(this.shipped));
    },

    /** what the PM can see: shipped only, plus measurement noise until the end */
    northStarProjected: function () {
      var v = this.baseline + this._valueOf(this.shipped);
      if (!this.finished) v += this._nsNoise;
      return round1(v);
    },

    /** returns a fresh object every call. Consumes no randomness. */
    getState: function () {
      var run = [], i;
      for (i = 0; i < this.researchRunning.length; i++) run.push(this._copyActivity(this.researchRunning[i]));
      var done = [];
      for (i = 0; i < this.readings.length; i++) done.push(this._copyReading(this.readings[i]));
      var favs = [];
      for (i = 0; i < this.favours.length; i++) favs.push(this._copyFavour(this.favours[i]));
      var trust = {};
      var ids = Object.keys(this.trust);
      for (i = 0; i < ids.length; i++) trust[ids[i]] = this.trust[ids[i]];
      var use = {};
      var iid = Object.keys(this.instrumentUse);
      for (i = 0; i < iid.length; i++) use[iid[i]] = this.instrumentUse[iid[i]];

      return {
        day: this.day,
        week: this.week(),
        dayOfWeek: this.dayOfWeek(),
        t: this.stamp(),
        daysLeft: this.daysLeft(),
        weeksToQBR: Math.max(0, RULES.weeks - this.week()),
        running: !!this.running,
        started: !!this.started,
        finished: !!this.finished,
        qbrSubmitted: !!this.qbrSubmitted,

        capacityUsed: round2(this.capacityUsed),
        capacityLeft: this.capacityLeft(),
        capacityBudget: round2(this.capacityBudget),
        capacityTotal: RULES.totalCapacity,
        capacityPerDay: round2(this.perDay),
        capacityCommitted: this.capacityCommitted(),

        roadmap: this.getRoadmap(),
        shipped: this.shipped.slice(),
        research: {
          running: run, done: done,
          slotsUsed: this.slotsUsed(),
          slotsFree: Math.max(0, RULES.researchSlots - this.slotsUsed())
        },
        instrumentUse: use,

        trust: trust,
        avgTrust: this.avgTrust(),
        favours: favs,
        estimateInflation: !!this._engPad,

        northStar: (this._co.scenario && this._co.scenario.northStar) || null,
        northStarBaseline: this.baseline,
        northStarProjected: this.northStarProjected(),

        openEvents: this.getOpenEvents(),
        slips: this.slips.slice(),
        commits: this.commits.slice(),
        seed: this.seed
      };
    },

    /* ===================================================== scoring ==== */

    /** every subset of ids whose total trueCost fits the capacity constraint */
    _bestAffordable: function (cap) {
      var fs = (this._co && this._co.features) || [];
      var ids = [];
      for (var i = 0; i < fs.length; i++) ids.push(fs[i].id);
      var n = ids.length;
      var bestVal = 0, bestSet = [];

      if (n > 20) {              // pathological data: fall back to greedy by ratio
        var order = ids.slice().sort(function (a, b) {
          var ra = this._impactOf(a) / Math.max(0.01, this._trueCostOf(a));
          var rb = this._impactOf(b) / Math.max(0.01, this._trueCostOf(b));
          return rb - ra;
        }.bind(this));
        var spend = 0, pick = [];
        for (i = 0; i < order.length; i++) {
          var c = this._trueCostOf(order[i]);
          if (this._impactOf(order[i]) <= 0) continue;
          if (spend + c > cap + 1e-9) continue;
          pick.push(order[i]); spend += c;
        }
        return { value: this._valueOf(pick), set: pick.sort() };
      }

      var total = 1 << n;
      for (var m = 0; m < total; m++) {
        var set = [], cost = 0;
        for (i = 0; i < n; i++) {
          if (m & (1 << i)) { set.push(ids[i]); cost += this._trueCostOf(ids[i]); }
        }
        if (cost > cap + 1e-9) continue;
        var v = this._valueOf(set);
        if (v > bestVal + 1e-9) { bestVal = v; bestSet = set; }
        else if (Math.abs(v - bestVal) <= 1e-9 && bestSet.length && set.length) {
          // deterministic tie-break: fewer features, then lexicographic
          var a = set.slice().sort().join(","), b = bestSet.slice().sort().join(",");
          if (set.length < bestSet.length || (set.length === bestSet.length && a < b)) bestSet = set;
        }
      }
      return { value: round4(bestVal), set: bestSet.slice().sort() };
    },

    /** the player's own forecasts, marked against the truth */
    _calibration: function () {
      var seen = {}, rows = [], i;
      // one forecast per feature: the most recent commit wins
      for (i = 0; i < this.commits.length; i++) seen[this.commits[i].featureId] = this.commits[i];
      var fids = Object.keys(seen);
      fids.sort();
      var n = 0, hits = 0, abs = 0, signed = 0;
      for (i = 0; i < fids.length; i++) {
        var c = seen[fids[i]];
        var truth = round4(this._impactOf(c.featureId));
        var err = round4(c.predictedImpact - truth);
        var hit = Math.abs(err) <= HIT_TOLERANCE + 1e-9;
        n++; if (hit) hits++;
        abs += Math.abs(err); signed += err;
        rows.push({
          featureId: c.featureId, name: c.featureName,
          predicted: c.predictedImpact, truth: truth,
          error: err, absError: round4(Math.abs(err)), hit: hit,
          shipped: has(this.shipped, c.featureId),
          week: c.week, t: c.t, rationale: c.rationale
        });
      }
      return {
        n: n,
        hits: hits,
        hitRate: n ? round4(hits / n) : 0,
        meanAbsError: n ? round4(abs / n) : 0,
        bias: n ? round4(signed / n) : 0,      // >0 = you talked your book
        overconfident: n > 0 && (hits / n) < 0.5,
        tolerance: HIT_TOLERANCE,
        rows: rows
      };
    },

    _believed: function (fid) {
      var s = 0, n = 0;
      for (var i = 0; i < this.readings.length; i++) {
        if (this.readings[i].featureId !== fid) continue;
        s += this.readings[i].value; n++;
      }
      return n ? round2(s / n) : null;
    },

    _predictedFor: function (fid) {
      var p = null;
      for (var i = 0; i < this.commits.length; i++) if (this.commits[i].featureId === fid) p = this.commits[i].predictedImpact;
      return p;
    },

    /** eng-weeks sunk into things that never shipped */
    wastedCapacity: function () {
      var s = 0;
      for (var i = 0; i < this.roadmap.length; i++) {
        var e = this.roadmap[i];
        if (e.status === "shipped") continue;
        s += e.engWeeksSpent;
      }
      return round2(s);
    },

    /**
     * Product.submitQBR({narrative, claimedImpact}) -> Score
     * Ends the quarter. Unfinished work is worth exactly zero.
     */
    submitQBR: function (req) {
      req = req || {};
      if (this.qbrSubmitted) return this._reject("The QBR is already submitted");

      var claimed = Number(req.claimedImpact);
      if (req.claimedImpact === null || req.claimedImpact === undefined
        || req.claimedImpact === "" || !isFinite(claimed)) {
        return this._reject("Predicted impact required");
      }
      var narrative = (typeof req.narrative === "string") ? req.narrative.trim() : "";
      if (narrative.length < RULES.minRationaleChars) return this._reject("Rationale required");

      this._stopTimer();
      this.running = false;
      this.finished = true;
      this._checkIgnored(true);
      this._nsNoise = 0;
      this.qbrSubmitted = true;
      this.qbr = {
        narrative: narrative, claimedImpact: round2(claimed),
        day: this.day, week: this.week(), t: this.stamp()
      };

      var i, id;
      var shippedSet = this.shipped.slice();
      var achieved = this._valueOf(shippedSet);
      var cap = isNum(this._truth.capacity) ? this._truth.capacity : RULES.totalCapacity;
      var best = this._bestAffordable(cap);
      var bestValue = best.value, bestSet = best.set;

      var regret = round4(Math.max(0, bestValue - achieved));
      var ratio = bestValue > 1e-9 ? round4(regret / bestValue) : (regret > 1e-9 ? 1 : 0);
      var grade = ratio < 0.10 ? "A" : ratio < 0.25 ? "B" : ratio < 0.45 ? "C" : ratio < 0.70 ? "D" : "F";

      /* ---- the two hard modifiers ---------------------------------- */
      var vanity = [];
      for (i = 0; i < shippedSet.length; i++) {
        if (this._impactOf(shippedSet[i]) < VANITY_AT) vanity.push(shippedSet[i]);
      }
      var avg = this.avgTrust();
      var modifiers = [];
      if (vanity.length >= 2 && (grade === "A" || grade === "B")) {
        grade = "C";
        modifiers.push("capped at C: shipped " + vanity.length + " features with no measurable impact");
      } else if (vanity.length >= 2) {
        modifiers.push("shipped " + vanity.length + " features with no measurable impact");
      }
      if (avg < 40 && (grade === "A" || grade === "B")) {
        grade = "C";
        modifiers.push("capped at C: you finished the quarter with the organisation at " + avg + " trust");
      } else if (avg < 40) {
        modifiers.push("you finished the quarter with the organisation at " + avg + " trust");
      }

      /* ---- missed wins --------------------------------------------- */
      var missed = [];
      for (i = 0; i < bestSet.length; i++) if (!has(shippedSet, bestSet[i])) missed.push(bestSet[i]);

      /* ---- trust ---------------------------------------------------- */
      var finalTrust = {}, lost = [];
      var sh = (this._co.stakeholders || []);
      for (i = 0; i < sh.length; i++) {
        id = sh[i].id;
        finalTrust[id] = this.trust[id];
        var start = isNum(sh[i].startTrust) ? sh[i].startTrust : RULES.startTrust;
        if (this.trust[id] < start) {
          lost.push({
            id: id, name: sh[i].name, role: sh[i].role,
            from: start, to: this.trust[id], delta: this.trust[id] - start
          });
        }
      }

      /* ---- per feature ---------------------------------------------- */
      var per = [];
      var fs = this._co.features || [];
      for (i = 0; i < fs.length; i++) {
        var f = fs[i];
        var e = this.entryFor(f.id);
        var truth = round4(this._impactOf(f.id));
        var isShipped = has(shippedSet, f.id);
        var inBest = has(bestSet, f.id);
        var sunk = e ? round2(e.engWeeksSpent) : 0;
        var verdict;
        if (isShipped && truth < VANITY_AT) verdict = "vanity — shipped, moved nothing";
        else if (isShipped && inBest) verdict = "correct — shipped a winner";
        else if (isShipped) verdict = "shipped, but it wasn't the best use of the capacity";
        else if (e && e.status === "building" && sunk > 0) verdict = "unfinished — " + ew(sunk) + " eng-weeks, zero credit";
        else if (e && e.status === "dropped" && inBest) verdict = "dropped a winner";
        else if (e && e.status === "dropped") verdict = "correctly dropped";
        else if (inBest) verdict = "missed — should have shipped it";
        else if (e && e.status === "queued" && sunk > 0) verdict = "unfinished — " + ew(sunk) + " eng-weeks, zero credit";
        else verdict = "correctly left out";

        per.push({
          id: f.id, name: f.name, tags: (f.tags || []).slice(),
          believed: this._believed(f.id),
          predicted: this._predictedFor(f.id),
          truth: truth,
          trueCost: round2(this._trueCostOf(f.id)),
          estCost: round2(num(f.estCost)),
          shipped: isShipped,
          inBestSet: inBest,
          status: e ? e.status : "none",
          engWeeksSpent: sunk,
          readings: this.readingsFor(f.id).length,
          verdict: verdict,
          note: (this._truth.notes && this._truth.notes[f.id]) || null
        });
      }

      var actual = round1(this.baseline + achieved);
      var score = {
        ok: true,
        narrative: narrative,
        claimedImpact: round2(claimed),
        shippedSet: shippedSet.slice(),
        northStarBaseline: this.baseline,
        northStarActual: actual,
        delta: round4(achieved),
        claimError: round4(claimed - achieved),
        bestPossible: round4(bestValue),
        bestSet: bestSet.slice(),
        capacityConstraint: cap,
        regret: regret,
        regretRatio: ratio,
        grade: grade,
        modifiers: modifiers,
        wastedCapacity: this.wastedCapacity(),
        capacityUsed: round2(this.capacityUsed),
        capacityBudget: round2(this.capacityBudget),
        capacityIdle: round2(Math.max(0, this.capacityBudget - this.capacityUsed)),
        vanityShipped: vanity,
        missedWins: missed,
        slips: this.slips.slice(),
        trust: { final: finalTrust, avg: avg, lost: lost },
        calibration: this._calibration(),
        instrumentUse: (function (u) {
          var o = {}, k = Object.keys(u);
          for (var j = 0; j < k.length; j++) o[k[j]] = u[k[j]];
          return o;
        })(this.instrumentUse),
        perFeature: per,
        submittedAt: { day: this.day, week: this.week(), t: this.stamp() }
      };

      this.score = score;
      this._emit("quarterEnd", [this.getState()]);
      return score;
    },

    getScore: function () { return this.score; },

    /* ================================================== the QBR doc ==== */

    /**
     * Markdown for chat. Contains ONLY what the player was told during the
     * quarter plus, once the quarter is closed, the realised impact of what
     * they actually shipped. No true costs (beyond slips the game disclosed),
     * no bias table, no impacts of anything that did not ship.
     */
    exportQBR: function () {
      var co = this._co || {};
      var sc = (co.scenario || {});
      var ns = sc.northStar || {};
      var L = [], i;

      L.push("# QBR — " + (sc.company || "?") + " · " + (ns.name || "north star"));
      L.push("");
      L.push("**" + this.stamp() + "** · week " + this.week() + " of " + RULES.weeks
        + " · " + (this.finished ? "quarter closed" : "in flight"));
      L.push("");

      /* ---- the narrative ------------------------------------------- */
      L.push("## The quarter, in my words");
      L.push("");
      L.push(this.qbr && this.qbr.narrative ? this.qbr.narrative : "_(no narrative submitted)_");
      L.push("");
      if (this.qbr && isNum(this.qbr.claimedImpact)) {
        L.push("**Claimed impact:** " + pp(this.qbr.claimedImpact) + " " + (ns.units || "pp"));
        L.push("");
      }

      /* ---- the number ---------------------------------------------- */
      L.push("## The number");
      L.push("");
      L.push("| metric | value |");
      L.push("|---|---|");
      L.push("| Baseline | " + round1(this.baseline).toFixed(1) + " " + (ns.units || "pp") + " |");
      if (this.finished) {
        L.push("| Actual at quarter end | " + this.northStarActual().toFixed(1) + " |");
        L.push("| Delta | " + pp(this.northStarActual() - this.baseline) + " |");
      } else {
        L.push("| Projected (measured, noisy) | " + this.northStarProjected().toFixed(1) + " |");
      }
      L.push("| Features shipped | " + this.shipped.length + " |");
      L.push("| Avg trust | " + this.avgTrust() + " |");
      L.push("");

      /* ---- what shipped -------------------------------------------- */
      L.push("## What shipped");
      L.push("");
      if (!this.shipped.length) {
        L.push("_Nothing shipped. Everything on the board is worth zero._");
      } else {
        L.push("| feature | shipped | eng-weeks | predicted | " + (this.finished ? "actual |" : "|"));
        L.push("|---|---|---:|---:|" + (this.finished ? "---:|" : ""));
        for (i = 0; i < this.shipped.length; i++) {
          var e = this.entryFor(this.shipped[i]) || {};
          var f = this.featureById(this.shipped[i]) || {};
          var pr = this._predictedFor(this.shipped[i]);
          L.push("| " + (f.name || this.shipped[i])
            + " | W" + (e.shippedWeek || "?")
            + " | " + ew(e.engWeeksSpent || 0)
            + " | " + (pr === null ? "—" : pp(pr))
            + (this.finished ? " | " + pp(this._impactOf(this.shipped[i])) + " |" : " |"));
        }
      }
      L.push("");

      /* ---- what slipped -------------------------------------------- */
      L.push("## What slipped");
      L.push("");
      if (!this.slips.length) {
        L.push("_No slips were revealed this quarter._");
      } else {
        L.push("| feature | estimated | revised | over by | revealed |");
        L.push("|---|---:|---:|---:|---|");
        for (i = 0; i < this.slips.length; i++) {
          var s = this.slips[i];
          L.push("| " + s.name + " | " + ew(s.estimate) + " | " + ew(s.revisedEstimate)
            + " | " + pp(s.overBy) + " | " + s.t + " |");
        }
      }
      L.push("");

      /* ---- unfinished ---------------------------------------------- */
      var open = [];
      for (i = 0; i < this.roadmap.length; i++) {
        var r = this.roadmap[i];
        if (r.status === "queued" || r.status === "building") open.push(r);
      }
      L.push("## Unfinished at the buzzer (worth zero)");
      L.push("");
      if (!open.length) {
        L.push("_Nothing left in flight._");
      } else {
        L.push("| feature | status | eng-weeks sunk |");
        L.push("|---|---|---:|");
        for (i = 0; i < open.length; i++) {
          var fo = this.featureById(open[i].featureId) || {};
          L.push("| " + (fo.name || open[i].featureId) + " | " + open[i].status
            + " | " + ew(open[i].engWeeksSpent) + " |");
        }
      }
      L.push("");

      /* ---- dropped ------------------------------------------------- */
      var dropped = [];
      for (i = 0; i < this.roadmap.length; i++) if (this.roadmap[i].status === "dropped") dropped.push(this.roadmap[i]);
      if (dropped.length) {
        L.push("## Dropped");
        L.push("");
        for (i = 0; i < dropped.length; i++) {
          var fd = this.featureById(dropped[i].featureId) || {};
          L.push("- " + (fd.name || dropped[i].featureId)
            + (dropped[i].engWeeksSpent > 0 ? " (after " + ew(dropped[i].engWeeksSpent) + " eng-weeks)" : ""));
        }
        L.push("");
      }

      /* ---- the evidence -------------------------------------------- */
      L.push("## Research readings");
      L.push("");
      if (!this.readings.length) {
        L.push("_No research was run. Every decision below was a hunch._");
      } else {
        L.push("| " + (ns.units || "pp") + " | feature | instrument | when |");
        L.push("|---:|---|---|---|");
        for (i = 0; i < this.readings.length; i++) {
          var rd = this.readings[i];
          L.push("| " + pp(rd.value) + " | " + rd.featureName + " | " + rd.instrumentName
            + (rd.unbiased ? " (unbiased)" : "") + " | " + rd.t + " |");
        }
      }
      L.push("");

      /* ---- forecasts ------------------------------------------------ */
      L.push("## Forecasts on the record");
      L.push("");
      if (!this.commits.length) {
        L.push("_No commits were made._");
      } else {
        L.push("| feature | predicted | " + (this.finished ? "actual | " : "") + "when | rationale |");
        L.push("|---|---:|" + (this.finished ? "---:|" : "") + "---|---|");
        var seen = {};
        for (i = 0; i < this.commits.length; i++) seen[this.commits[i].featureId] = this.commits[i];
        var keys = Object.keys(seen); keys.sort();
        for (i = 0; i < keys.length; i++) {
          var c = seen[keys[i]];
          var actualCell = "";
          if (this.finished) {
            actualCell = has(this.shipped, c.featureId)
              ? (pp(this._impactOf(c.featureId)) + " | ")
              : "not shipped | ";
          }
          L.push("| " + c.featureName + " | " + pp(c.predictedImpact) + " | "
            + actualCell + c.t + " | " + c.rationale.replace(/\|/g, "/") + " |");
        }
      }
      L.push("");

      /* ---- capacity ------------------------------------------------- */
      L.push("## Capacity accounting");
      L.push("");
      L.push("| line | eng-weeks |");
      L.push("|---|---:|");
      L.push("| Budget for the quarter | " + ew(this.capacityBudget) + " |");
      L.push("| Consumed | " + ew(this.capacityUsed) + " |");
      L.push("| Of which shipped | " + ew(this.capacityUsed - this.wastedCapacity()) + " |");
      L.push("| Of which sunk into unshipped work | " + ew(this.wastedCapacity()) + " |");
      L.push("| Never used | " + ew(Math.max(0, this.capacityBudget - this.capacityUsed)) + " |");
      if (this.capacityLedger.length) {
        L.push("");
        for (i = 0; i < this.capacityLedger.length; i++) {
          var cl = this.capacityLedger[i];
          L.push("- " + cl.t + " · " + pp(cl.engWeeks) + " eng-weeks — " + cl.reason);
        }
      }
      L.push("");

      /* ---- the ledger ----------------------------------------------- */
      L.push("## Trust ledger");
      L.push("");
      L.push("| person | role | start | end | delta |");
      L.push("|---|---|---:|---:|---:|");
      var sh = co.stakeholders || [];
      for (i = 0; i < sh.length; i++) {
        var st = isNum(sh[i].startTrust) ? sh[i].startTrust : RULES.startTrust;
        var en = this.trust[sh[i].id];
        L.push("| " + sh[i].name + " | " + sh[i].role + " | " + st + " | " + en
          + " | " + (en - st > 0 ? "+" : "") + (en - st) + " |");
      }
      L.push("");
      if (this.trustLog.length) {
        L.push("### What moved it");
        L.push("");
        for (i = 0; i < this.trustLog.length; i++) {
          var tl = this.trustLog[i];
          L.push("- " + tl.t + " · " + tl.name + " " + (tl.delta > 0 ? "+" : "") + tl.delta
            + " — " + tl.reason);
        }
        L.push("");
      }

      /* ---- escalations ---------------------------------------------- */
      var answered = [];
      for (i = 0; i < this._events.length; i++) {
        if (this._events[i].needsReply) answered.push(this._events[i]);
      }
      if (answered.length) {
        L.push("## Escalations");
        L.push("");
        for (i = 0; i < answered.length; i++) {
          var ev = answered[i];
          if (!ev.fired) continue;
          L.push("- **" + ev.from + " (W" + ev.week + ")** — "
            + (ev.answered ? ("answered `" + ev.choice + "`"
              + (ev.rationale ? ": " + ev.rationale : ""))
              : (ev.ignored ? "never answered" : "still open")));
        }
        L.push("");
      }

      return L.join("\n");
    }
  };

  global.Product = Product;

})(typeof window !== "undefined" ? window
  : (typeof globalThis !== "undefined" ? globalThis : this));
