/* ==========================================================================
 * sim/engine.js  —  window.Engine
 *
 * Day Trader Sim: the clock, the book, the money, the risk rules.
 *
 * PURE LOGIC. No DOM access whatsoever. Loads via a plain <script src> tag
 * from a file:// page; no modules, no imports, no libraries, no build step.
 * Unit-testable under node with `global.window = global; require(...)`.
 *
 * Implements SPEC.md §2 exactly. Do not deviate: other files are built
 * against this API.
 * ========================================================================== */
;(function (global) {
  "use strict";

  /* ---------------------------------------------------------------- rules */

  var RULES = {
    startEquity:        25000,   // session 1 only; later sessions inherit
    leverage:           4,       // intraday buying power = equity * 4
    maxDailyLoss:       -1500,   // hit it -> risk flattens you and locks the day
    warnDailyLoss:      -900,    // soft warning
    noNewAfterM:        955,     // 15:55 no new/increasing positions
    forceFlatM:         958,     // 15:58 risk flattens whatever is left
    commissionPerShare: 0.005,   // each side, min $1.00 per fill
    minCommission:      1.00
  };

  var ACCOUNT_KEY = "dts.account.v1";

  /* -------------------------------------------------------------- helpers */

  function roundTo(x, d) {
    if (!isFinite(x)) return 0;
    var p = Math.pow(10, d);
    // .toFixed(6) first kills binary floating point dust (e.g. 0.1+0.2)
    return Math.round(Number((x * p).toFixed(6))) / p;
  }
  function round2(x) { return roundTo(x, 2); }
  function round4(x) { return roundTo(x, 4); }

  function pad2(n) { n = Math.floor(n); return (n < 10 ? "0" : "") + n; }

  function mToT(m) {
    var mm = ((m % 1440) + 1440) % 1440;
    return pad2(Math.floor(mm / 60)) + ":" + pad2(mm % 60);
  }

  function sgn(x) { return x > 0 ? 1 : (x < 0 ? -1 : 0); }

  function clamp(x, lo, hi) {
    if (hi < lo) { var t = lo; lo = hi; hi = t; }
    return x < lo ? lo : (x > hi ? hi : x);
  }

  function money(x) {
    var v = round2(x);
    var s = (v < 0 ? "-" : "") + "$" + Math.abs(v).toFixed(2);
    return s;
  }

  function signedMoney(x) {
    var v = round2(x);
    return (v > 0 ? "+" : (v < 0 ? "-" : "")) + "$" + Math.abs(v).toFixed(2);
  }

  function storage() {
    try {
      if (typeof localStorage !== "undefined" && localStorage) return localStorage;
    } catch (e) { /* file:// or privacy mode can throw on access */ }
    try {
      if (global && global.localStorage) return global.localStorage;
    } catch (e2) { /* ignore */ }
    return null;
  }

  function warnErr(e) {
    try {
      if (typeof console !== "undefined" && console && console.error) console.error(e);
    } catch (x) { /* ignore */ }
  }

  /* ================================================================ Engine */

  var Engine = {
    RULES: RULES,
    ACCOUNT_KEY: ACCOUNT_KEY,

    /* ---- internals (underscored; not part of the contract) --------- */
    _day: null,
    _listeners: null,
    _timer: null,
    _orderSeq: 0,
    _fillSeq: 0,

    /* ================================================== lifecycle ==== */

    /**
     * Engine.init({ day: Day, account: Account|null })
     * account null => fresh $25k.
     */
    init: function (opts) {
      opts = opts || {};
      var day = opts.day;
      if (!day || !day.bars || !day.bars.length) {
        throw new Error("Engine.init: a Day with bars is required");
      }

      this._stopTimer();
      this._day = day;
      this._listeners = { tick: [], fill: [], risk: [], close: [], reject: [] };
      this._orderSeq = 0;
      this._fillSeq = 0;

      var account = opts.account || null;
      this.account = account;
      this.startingEquity = (account && typeof account.equity === "number")
        ? account.equity
        : RULES.startEquity;

      // first RTH bar: the replay starts at the open
      var firstRth = 0;
      for (var i = 0; i < day.bars.length; i++) {
        if (day.bars[i].rth) { firstRth = i; break; }
      }
      this._firstRthIdx = firstRth;

      this.idx = firstRth;
      this.m = day.bars[firstRth].m;
      this.running = false;
      this.started = false;
      this.finished = false;
      this.locked = false;
      this.speed = 60;

      this.position = { shares: 0, avgPx: 0, openM: null, theses: [] };
      this._openComm = 0;        // commissions attributable to the open position

      this.grossRealized = 0;    // realised price P&L, before commissions
      this.commissions = 0;      // every commission paid today
      this.blotter = [];
      this.trades = [];
      this.working = [];         // resting LMT/STP orders
      this._pending = [];        // market orders awaiting the next bar

      this.peakDayPnl = 0;
      this.maxDrawdown = 0;

      this._warned = false;
      this._forceFlatDone = false;
      this.riskEvents = [];
      this.curve = [];           // [{m,t,dayPnl}] every 15 minutes

      this._sampleCurve();
      return this.getState();
    },

    /** begin replay from the open */
    start: function () {
      if (!this._day) throw new Error("Engine.start: call Engine.init first");
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
      if (!this._day || this.finished) return this.getState();
      this.started = true;
      this.running = true;
      this._startTimer();
      return this.getState();
    },

    /** 30 | 60 | 120 | 240. bar interval ms = 60000/mult */
    setSpeed: function (mult) {
      mult = Number(mult) || 60;
      if (mult <= 0) mult = 60;
      this.speed = mult;
      if (this.running) this._startTimer();   // restart at the new cadence
      return this.speed;
    },

    barIntervalMs: function () { return 60000 / this.speed; },

    /** advance exactly one bar (works while paused) */
    step: function () {
      this._advance();
      return this.getState();
    },

    destroy: function () {
      this._stopTimer();
      this.running = false;
      this._listeners = { tick: [], fill: [], risk: [], close: [], reject: [] };
      this._pending = [];
      this.working = [];
      this._day = null;
    },

    _startTimer: function () {
      this._stopTimer();
      var self = this;
      if (typeof setInterval !== "function") return;
      this._timer = setInterval(function () {
        if (!self.running) return;
        self._advance();
      }, this.barIntervalMs());
    },

    _stopTimer: function () {
      if (this._timer !== null && this._timer !== undefined) {
        if (typeof clearInterval === "function") clearInterval(this._timer);
        this._timer = null;
      }
    },

    /* ====================================================== events ==== */

    on: function (evt, fn) {
      if (!this._listeners) this._listeners = { tick: [], fill: [], risk: [], close: [], reject: [] };
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

    /* ======================================================= state ==== */

    bar: function () {
      if (!this._day) return null;
      return this._day.bars[this.idx];
    },

    markPx: function () {
      var b = this.bar();
      return b ? b.c : 0;
    },

    unrealized: function () {
      if (this.position.shares === 0) return 0;
      return round2(this.position.shares * (this.markPx() - this.position.avgPx));
    },

    realized: function () {
      return round2(this.grossRealized - this.commissions);
    },

    dayPnl: function () {
      return round2(this.realized() + this.unrealized());
    },

    equity: function () {
      return round2(this.startingEquity + this.dayPnl());
    },

    buyingPower: function () {
      return round2(this.equity() * RULES.leverage);
    },

    exposure: function () {
      return round2(Math.abs(this.position.shares) * this.markPx());
    },

    stats: function () {
      var wins = 0, losses = 0, biggestWin = 0, biggestLoss = 0;
      for (var i = 0; i < this.trades.length; i++) {
        var p = this.trades[i].pnl;
        if (p > 0) { wins++; if (p > biggestWin) biggestWin = p; }
        else if (p < 0) { losses++; if (p < biggestLoss) biggestLoss = p; }
      }
      return {
        nTrades: this.trades.length,
        wins: wins,
        losses: losses,
        biggestWin: round2(biggestWin),
        biggestLoss: round2(biggestLoss),
        maxDrawdown: round2(this.maxDrawdown),
        peakDayPnl: round2(this.peakDayPnl)
      };
    },

    /** returns a fresh object every call */
    getState: function () {
      var b = this.bar();
      return {
        m: this.m,
        bar: b ? {
          m: b.m, t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v, rth: !!b.rth
        } : null,
        idx: this.idx,
        t: mToT(this.m),
        running: !!this.running,
        locked: !!this.locked,
        finished: !!this.finished,
        position: {
          shares: this.position.shares,
          avgPx: round4(this.position.avgPx),
          openM: this.position.openM,
          thesis: this.position.theses.join(" || ")
        },
        realized: this.realized(),
        unrealized: this.unrealized(),
        dayPnl: this.dayPnl(),
        commissions: round2(this.commissions),
        equity: this.equity(),
        buyingPower: this.buyingPower(),
        exposure: this.exposure(),
        blotter: this.blotter.slice(),
        trades: this.trades.slice(),
        working: this.getWorking(),
        stats: this.stats()
      };
    },

    getDay: function () { return this._day; },

    /* ====================================================== orders ==== */

    /**
     * Engine.submit({side,qty,type,px,thesis}) -> {ok:true,order}|{ok:false,error}
     */
    submit: function (req) {
      req = req || {};
      var err = this._validate(req);
      if (err) return this._reject(err, req);

      var side = req.side;
      var qty = Math.floor(Number(req.qty));
      var type = req.type || "MKT";

      var order = {
        id: "O" + (++this._orderSeq),
        side: side,
        qty: qty,
        type: type,
        px: (type === "MKT") ? null : round4(Number(req.px)),
        thesis: typeof req.thesis === "string" ? req.thesis : "",
        submittedM: this.m,
        submittedT: mToT(this.m),
        submittedIdx: this.idx,
        status: (type === "MKT") ? "PENDING" : "WORKING",
        seq: this._orderSeq
      };

      if (type === "MKT") this._pending.push(order);
      else this.working.push(order);

      return { ok: true, order: this._copyOrder(order) };
    },

    _validate: function (req) {
      // 1. is the market even open?
      if (!this._day) return "Market closed";
      if (this.finished || this.m >= this._day.closeM) return "Market closed";

      // 2. has risk pulled your card?
      if (this.locked) return "Trading locked — you hit the daily loss limit";

      // 3. field sanity
      if (req.side !== "BUY" && req.side !== "SELL") return "Side must be BUY or SELL";
      var qty = Number(req.qty);
      if (!isFinite(qty) || qty <= 0 || Math.floor(qty) !== qty) {
        return "Quantity must be a positive whole number";
      }
      var type = req.type || "MKT";
      if (type !== "MKT" && type !== "LMT" && type !== "STP") {
        return "Order type must be MKT, LMT or STP";
      }
      var px = Number(req.px);
      if (type !== "MKT" && (!isFinite(px) || px <= 0)) {
        return (type === "LMT" ? "Limit price required" : "Stop price required");
      }

      var refPx = (type === "MKT") ? this.markPx() : px;
      var increases = this._increases(req.side, qty);

      // 4. the thesis box — the single most important learning device
      if (increases) {
        var th = (typeof req.thesis === "string") ? req.thesis.trim() : "";
        if (th.length < 10) return "Thesis required";
      }

      // 5. the 15:55 gate
      if (increases && this.m >= RULES.noNewAfterM) return "No new positions after 15:55";

      // 6. the line
      if (this._breachesBuyingPower(req.side, qty, refPx)) return "Exceeds buying power";

      return null;
    },

    _increases: function (side, qty) {
      var d = side === "BUY" ? 1 : -1;
      var ns = this.position.shares + d * qty;
      return Math.abs(ns) > Math.abs(this.position.shares);
    },

    _breachesBuyingPower: function (side, qty, px) {
      var d = side === "BUY" ? 1 : -1;
      var ns = this.position.shares + d * qty;
      var resulting = Math.abs(ns) * px;
      return round2(resulting) > this.buyingPower();
    },

    _reject: function (error, order) {
      this._emit("reject", [{ error: error, order: order }]);
      return { ok: false, error: error };
    },

    cancel: function (orderId) {
      for (var i = 0; i < this.working.length; i++) {
        if (this.working[i].id === orderId) {
          var o = this.working.splice(i, 1)[0];
          o.status = "CANCELLED";
          return { ok: true, order: this._copyOrder(o) };
        }
      }
      for (var j = 0; j < this._pending.length; j++) {
        if (this._pending[j].id === orderId) {
          var p = this._pending.splice(j, 1)[0];
          p.status = "CANCELLED";
          return { ok: true, order: this._copyOrder(p) };
        }
      }
      return { ok: false, error: "No such working order" };
    },

    /** -> [Order, ...] resting LMT/STP orders */
    getWorking: function () {
      var out = [];
      for (var i = 0; i < this.working.length; i++) out.push(this._copyOrder(this.working[i]));
      return out;
    },

    _copyOrder: function (o) {
      return {
        id: o.id, side: o.side, qty: o.qty, type: o.type, px: o.px,
        thesis: o.thesis, submittedM: o.submittedM, submittedT: o.submittedT,
        status: o.status
      };
    },

    _cancelAllWorking: function (why) {
      var w = this.working.slice();
      this.working = [];
      for (var i = 0; i < w.length; i++) {
        w[i].status = "CANCELLED";
        this._emit("reject", [{ error: why, order: this._copyOrder(w[i]) }]);
      }
      this._pending = [];
    },

    /** market-close the whole position, right now, on the current bar */
    flatten: function (reason) {
      reason = reason || "MANUAL";
      var shares = this.position.shares;
      if (shares === 0) return this.getState();
      var b = this.bar();
      if (!b) return this.getState();

      var side = shares > 0 ? "SELL" : "BUY";
      var qty = Math.abs(shares);
      var dir = shares > 0 ? -1 : 1;
      var px = this._fillPx(b.c, b, qty, dir, 1);

      var order = {
        id: "O" + (++this._orderSeq), side: side, qty: qty, type: "MKT",
        px: null, thesis: "", submittedM: this.m, submittedT: mToT(this.m),
        status: "FILLED", seq: this._orderSeq
      };
      this._applyFill(order, px, reason);
      return this.getState();
    },

    /* ================================================== fill model ==== */

    /**
     *   half_spread = max(0.01, px * 0.00015)
     *   size_impact = px * 0.00012 * min(4, qty / max(1, bar.v * 0.015))
     *   fill        = base + dir*(half_spread + size_impact)   [ *2 for stops ]
     * clamped into [bar.l, bar.h]
     */
    _fillPx: function (base, bar, qty, dir, slipMult) {
      var halfSpread = Math.max(0.01, base * 0.00015);
      var sizeImpact = base * 0.00012 * Math.min(4, qty / Math.max(1, bar.v * 0.015));
      var raw = base + dir * (slipMult || 1) * (halfSpread + sizeImpact);
      return round4(clamp(raw, bar.l, bar.h));
    },

    commissionFor: function (qty) {
      return round2(Math.max(RULES.minCommission, RULES.commissionPerShare * qty));
    },

    /* --------------------------------------------------------------
     * The book. This is the part that has to be right.
     *   - adding to a position blends avgPx
     *   - a partial close leaves avgPx alone
     *   - a full close resets it
     *   - a flip books a Trade for the old side and opens the new one
     * -------------------------------------------------------------- */
    _applyFill: function (order, px, reason) {
      var qty = order.qty;
      var d = order.side === "BUY" ? 1 : -1;
      var comm = this.commissionFor(qty);
      var pos = this.position;
      var cur = pos.shares;

      var closingQty = 0;
      if (cur !== 0 && sgn(cur) !== d) closingQty = Math.min(Math.abs(cur), qty);
      var openingQty = qty - closingQty;

      // ---- close / partially close the existing side
      if (closingQty > 0) {
        var side = cur > 0 ? "LONG" : "SHORT";
        var gross = closingQty * (px - pos.avgPx) * sgn(cur);
        var entryCommAlloc = this._openComm * (closingQty / Math.abs(cur));
        var exitCommAlloc = comm * (closingQty / qty);

        this._openComm = this._openComm - entryCommAlloc;
        this.grossRealized += gross;

        this.trades.push({
          openM: pos.openM,
          openT: mToT(pos.openM),
          closeM: this.m,
          closeT: mToT(this.m),
          side: side,
          qty: closingQty,
          entryPx: round4(pos.avgPx),
          exitPx: round4(px),
          pnl: round2(gross - entryCommAlloc - exitCommAlloc),
          grossPnl: round2(gross),
          commission: round2(entryCommAlloc + exitCommAlloc),
          holdMins: (pos.openM === null ? 0 : this.m - pos.openM),
          thesis: pos.theses.join(" || "),
          exitReason: reason
        });

        pos.shares = cur - sgn(cur) * closingQty;
        if (pos.shares === 0) {
          pos.avgPx = 0;
          pos.openM = null;
          pos.theses = [];
          this._openComm = 0;                 // kill sub-cent residue
        }
      }

      // ---- open / add to a position (this is also the far side of a flip)
      if (openingQty > 0) {
        var openComm = comm * (openingQty / qty);
        if (pos.shares === 0) {
          pos.shares = d * openingQty;
          pos.avgPx = px;                      // avgPx resets ONLY here (flat/flip)
          pos.openM = this.m;
          pos.theses = order.thesis ? [order.thesis] : [];
          this._openComm = openComm;
        } else {
          var absOld = Math.abs(pos.shares);
          pos.avgPx = (pos.avgPx * absOld + px * openingQty) / (absOld + openingQty);
          pos.shares = pos.shares + d * openingQty;
          this._openComm += openComm;
          if (order.thesis && pos.theses.indexOf(order.thesis) === -1) {
            pos.theses.push(order.thesis);
          }
        }
      }

      this.commissions = round2(this.commissions + comm);

      var fill = {
        id: "F" + (++this._fillSeq),
        orderId: order.id,
        m: this.m,
        t: mToT(this.m),
        side: order.side,
        qty: qty,
        px: round4(px),
        notional: round2(qty * px),
        commission: comm,
        thesis: order.thesis || "",
        reason: reason
      };
      order.status = "FILLED";
      order.fillPx = fill.px;
      this.blotter.push(fill);
      this._emit("fill", [fill, this.getState()]);
      return fill;
    },

    /* ==================================================== the clock ==== */

    _advance: function () {
      var day = this._day;
      if (!day || this.finished) return;

      var lastIdx = day.bars.length - 1;

      if (this.idx >= lastIdx) {
        // the tape is done — flatten anything left, close the day
        if (this.position.shares !== 0) this.flatten("EOD_FLAT");
        this.m = day.closeM + 1;
        this.finished = true;
        this.running = false;
        this._stopTimer();
        this._cancelAllWorking("Market closed");
        this._mark();
        this._sampleCurve(true);
        this._emit("tick", [this.getState()]);
        this._emit("close", [this.getSummary()]);
        return;
      }

      this.idx += 1;
      var bar = day.bars[this.idx];
      this.m = bar.m;

      // 1) market orders submitted during the previous bar fill on this one
      this._processPending(bar);
      // 2) then resting LMT/STP, deterministically by submission order
      this._processWorking(bar);
      // 3) mark to market
      this._mark();
      // 4) risk, checked every tick
      this._riskCheck();
      // 5) equity curve sample
      this._sampleCurve();

      this._emit("tick", [this.getState()]);
    },

    _processPending: function (bar) {
      if (!this._pending.length) return;
      var queue = this._pending.slice().sort(function (a, b) { return a.seq - b.seq; });
      this._pending = [];
      for (var i = 0; i < queue.length; i++) {
        var o = queue[i];
        var dir = o.side === "BUY" ? 1 : -1;
        var px = this._fillPx(bar.o, bar, o.qty, dir, 1);
        // A market order was approved when it was sent; the one-bar delay is the
        // fill model, not a second approval gate. Only a hard lock kills it.
        if (this.locked) {
          o.status = "CANCELLED";
          this._emit("reject", [{
            error: "Trading locked — you hit the daily loss limit",
            order: this._copyOrder(o)
          }]);
          continue;
        }
        this._applyFill(o, px, "MANUAL");
      }
    },

    _processWorking: function (bar) {
      if (!this.working.length) return;
      var queue = this.working.slice().sort(function (a, b) { return a.seq - b.seq; });
      for (var i = 0; i < queue.length; i++) {
        var o = queue[i];
        if (o.status !== "WORKING") continue;

        var dir = o.side === "BUY" ? 1 : -1;
        var px = null;
        var reason = null;

        if (o.type === "LMT") {
          if (o.side === "BUY" && bar.l <= o.px) { px = o.px; reason = "TARGET"; }
          else if (o.side === "SELL" && bar.h >= o.px) { px = o.px; reason = "TARGET"; }
        } else if (o.type === "STP") {
          var trig = (o.side === "BUY") ? (bar.h >= o.px) : (bar.l <= o.px);
          if (trig) {
            px = this._fillPx(bar.o, bar, o.qty, dir, 2);   // stops get worse fills
            reason = "STOP";
          }
        }

        if (px === null) continue;

        var veto = this._fillTimeVeto(o, px);
        if (veto) {
          this._removeWorking(o.id);
          o.status = "CANCELLED";
          this._emit("reject", [{ error: veto, order: this._copyOrder(o) }]);
          continue;
        }

        this._removeWorking(o.id);
        this._applyFill(o, px, reason);
      }
    },

    /** the same risk checks apply at fill time, not just at submit time */
    _fillTimeVeto: function (o, px) {
      if (this.locked) return "Trading locked — you hit the daily loss limit";
      var increases = this._increases(o.side, o.qty);
      if (increases && this.m >= RULES.noNewAfterM) return "No new positions after 15:55";
      if (this._breachesBuyingPower(o.side, o.qty, px)) return "Exceeds buying power";
      return null;
    },

    _removeWorking: function (id) {
      for (var i = 0; i < this.working.length; i++) {
        if (this.working[i].id === id) { this.working.splice(i, 1); return; }
      }
    },

    _mark: function () {
      var p = this.dayPnl();
      if (p > this.peakDayPnl) this.peakDayPnl = p;
      var dd = round2(p - this.peakDayPnl);
      if (dd < this.maxDrawdown) this.maxDrawdown = dd;
    },

    _riskCheck: function () {
      var p = this.dayPnl();

      // 1. soft warning, once
      if (!this._warned && p <= RULES.warnDailyLoss) {
        this._warned = true;
        this._risk("warn", "Down " + money(p) + " on the day. That's the warning line ("
          + money(RULES.warnDailyLoss) + "). Tighten up.", false);
      }

      // 2. the hard stop — risk pulls your card
      if (!this.locked && p <= RULES.maxDailyLoss) {
        this.locked = true;
        this.flatten("RISK_FLAT");
        this._cancelAllWorking("Trading locked — you hit the daily loss limit");
        this._mark();
        this._risk("hard", "Daily loss limit hit (" + money(this.dayPnl())
          + " vs " + money(RULES.maxDailyLoss) + "). You're flat and you're done for the day.", true);
      }

      // 3. 15:58, risk flattens whatever is left
      if (this.m >= RULES.forceFlatM && this.position.shares !== 0) {
        this.flatten("EOD_FLAT");
        this._forceFlatDone = true;
        this._mark();
        this._risk("warn", "15:58. Flattened you into the close.", false);
      }

      // 4. after the close
      if (this.m > this._day.closeM && !this.finished) {
        this.finished = true;
        this.running = false;
        this._stopTimer();
        this._emit("close", [this.getSummary()]);
      }
    },

    _risk: function (level, message, hard) {
      var ev = { m: this.m, t: mToT(this.m), level: level, message: message };
      this.riskEvents.push(ev);
      this._emit("risk", [{
        level: level, message: message, hard: !!hard, m: this.m, t: mToT(this.m),
        state: this.getState()
      }]);
    },

    _sampleCurve: function (force) {
      if (!force && (this.m % 15 !== 0)) return;
      var last = this.curve.length ? this.curve[this.curve.length - 1] : null;
      if (last && last.m === this.m) { last.dayPnl = this.dayPnl(); return; }
      this.curve.push({ m: this.m, t: mToT(this.m), dayPnl: this.dayPnl() });
    },

    /* ==================================================== summary ===== */

    getSummary: function () {
      var day = this._day || {};
      var st = this.stats();
      return {
        sessionNo: day.sessionNo,
        dayId: day.id,
        ticker: day.ticker,
        company: day.company,
        dayPnl: this.dayPnl(),
        realized: this.realized(),
        unrealized: this.unrealized(),
        commissions: round2(this.commissions),
        nTrades: st.nTrades,
        wins: st.wins,
        losses: st.losses,
        biggestWin: st.biggestWin,
        biggestLoss: st.biggestLoss,
        maxDrawdown: st.maxDrawdown,
        peakDayPnl: st.peakDayPnl,
        startEquity: round2(this.startingEquity),
        endEquity: this.equity(),
        locked: !!this.locked,
        blotter: this.blotter.slice(),
        trades: this.trades.slice(),
        riskEvents: this.riskEvents.slice(),
        curve: this.curve.slice(),
        notes: ""
      };
    },

    /* ================================================== persistence === */

    /** localStorage key "dts.account.v1" */
    loadAccount: function () {
      var ls = storage();
      if (!ls) return null;
      try {
        var raw = ls.getItem(ACCOUNT_KEY);
        if (!raw) return null;
        var acct = JSON.parse(raw);
        if (!acct || typeof acct !== "object") return null;
        if (typeof acct.equity !== "number") acct.equity = RULES.startEquity;
        if (!acct.sessions || !acct.sessions.length) acct.sessions = acct.sessions || [];
        return acct;
      } catch (e) { warnErr(e); return null; }
    },

    saveAccount: function (dayResult) {
      var res = dayResult || this.getSummary();
      var acct = this.loadAccount();
      if (!acct) {
        acct = {
          equity: (this.account && typeof this.account.equity === "number")
            ? this.account.equity : RULES.startEquity,
          sessions: []
        };
      }

      var entry = {
        sessionNo: res.sessionNo,
        ticker: res.ticker,
        dayPnl: round2(res.dayPnl),
        nTrades: res.nTrades,
        wins: res.wins,
        losses: res.losses,
        maxDrawdown: round2(res.maxDrawdown),
        endEquity: round2(res.endEquity),
        locked: !!res.locked,
        blotter: res.blotter || [],
        trades: res.trades || [],
        notes: res.notes || ""
      };

      var replaced = false;
      for (var i = 0; i < acct.sessions.length; i++) {
        if (acct.sessions[i].sessionNo === entry.sessionNo) {
          acct.sessions[i] = entry; replaced = true; break;
        }
      }
      if (!replaced) acct.sessions.push(entry);
      acct.sessions.sort(function (a, b) { return (a.sessionNo || 0) - (b.sessionNo || 0); });
      acct.equity = entry.endEquity;

      var ls = storage();
      if (ls) {
        try { ls.setItem(ACCOUNT_KEY, JSON.stringify(acct)); }
        catch (e) { warnErr(e); }
      }
      this.account = acct;
      return acct;
    },

    resetAccount: function () {
      var ls = storage();
      if (ls) { try { ls.removeItem(ACCOUNT_KEY); } catch (e) { warnErr(e); } }
      this.account = null;
      return null;
    },

    /* ================================================ the tearsheet === */

    /** markdown string the player pastes into chat for the P&L review */
    exportReview: function () {
      var day = this._day || {};
      var st = this.stats();
      var L = [];

      L.push("# P&L review — " + (day.ticker || "?") + " · session "
        + (day.sessionNo != null ? day.sessionNo : "?"));
      L.push("");
      L.push("**" + (day.company || "") + "**"
        + (day.sector ? " · " + day.sector : ""));
      L.push("");

      // ---- stat line
      L.push("## Stat line");
      L.push("");
      L.push("| metric | value |");
      L.push("|---|---|");
      L.push("| Day P&L | " + signedMoney(this.dayPnl()) + " |");
      L.push("| Realized (net of comms) | " + signedMoney(this.realized()) + " |");
      L.push("| Unrealized at close | " + signedMoney(this.unrealized()) + " |");
      L.push("| Commissions | " + money(this.commissions) + " |");
      L.push("| Round trips | " + st.nTrades + " |");
      L.push("| Wins / losses | " + st.wins + " / " + st.losses + " |");
      L.push("| Hit rate | " + (st.nTrades ? Math.round(100 * st.wins / st.nTrades) + "%" : "—") + " |");
      L.push("| Biggest win | " + signedMoney(st.biggestWin) + " |");
      L.push("| Biggest loss | " + signedMoney(st.biggestLoss) + " |");
      L.push("| Peak day P&L | " + signedMoney(st.peakDayPnl) + " |");
      L.push("| Max drawdown (peak→trough) | " + signedMoney(st.maxDrawdown) + " |");
      L.push("| Fills | " + this.blotter.length + " |");
      L.push("| Starting equity | " + money(this.startingEquity) + " |");
      L.push("| Ending equity | " + money(this.equity()) + " |");
      L.push("| Locked by risk | " + (this.locked ? "YES" : "no") + " |");
      L.push("");

      // ---- every trade
      L.push("## Trades");
      L.push("");
      if (!this.trades.length) {
        L.push("_No round trips today._");
      } else {
        L.push("| # | in | out | side | qty | entry | exit | P&L | hold | exit reason |");
        L.push("|---:|---|---|---|---:|---:|---:|---:|---:|---|");
        for (var i = 0; i < this.trades.length; i++) {
          var tr = this.trades[i];
          L.push("| " + (i + 1)
            + " | " + (tr.openT || mToT(tr.openM))
            + " | " + (tr.closeT || mToT(tr.closeM))
            + " | " + tr.side
            + " | " + tr.qty
            + " | " + tr.entryPx.toFixed(2)
            + " | " + tr.exitPx.toFixed(2)
            + " | " + signedMoney(tr.pnl)
            + " | " + tr.holdMins + "m"
            + " | " + tr.exitReason + " |");
        }
        L.push("");
        L.push("### Theses, as typed");
        L.push("");
        for (var j = 0; j < this.trades.length; j++) {
          var t2 = this.trades[j];
          L.push("**" + (j + 1) + ". " + t2.side + " " + t2.qty + " @ "
            + t2.entryPx.toFixed(2) + " → " + t2.exitPx.toFixed(2)
            + " (" + signedMoney(t2.pnl) + ", " + t2.holdMins + "m, "
            + t2.exitReason + ")**");
          L.push("> " + (t2.thesis ? t2.thesis : "_(no thesis recorded)_"));
          L.push("");
        }
      }
      L.push("");

      // ---- still open?
      if (this.position.shares !== 0) {
        L.push("## Open at export");
        L.push("");
        L.push("- " + (this.position.shares > 0 ? "LONG " : "SHORT ")
          + Math.abs(this.position.shares) + " @ " + round4(this.position.avgPx).toFixed(2)
          + " · unrealized " + signedMoney(this.unrealized()));
        L.push("- thesis: " + (this.position.theses.join(" || ") || "_(none)_"));
        L.push("");
      }

      // ---- equity curve, every 15 minutes
      L.push("## Equity curve (day P&L, every 15 min)");
      L.push("");
      if (!this.curve.length) {
        L.push("_no samples_");
      } else {
        var parts = [];
        for (var k = 0; k < this.curve.length; k++) {
          parts.push("- " + this.curve[k].t + "  " + signedMoney(this.curve[k].dayPnl));
        }
        L.push(parts.join("\n"));
      }
      L.push("");

      // ---- risk events
      L.push("## Risk events");
      L.push("");
      if (!this.riskEvents.length) {
        L.push("_None. Risk never had to talk to you._");
      } else {
        for (var r = 0; r < this.riskEvents.length; r++) {
          var re = this.riskEvents[r];
          L.push("- **" + re.t + " [" + re.level.toUpperCase() + "]** " + re.message);
        }
      }
      L.push("");

      return L.join("\n");
    }
  };

  global.Engine = Engine;

})(typeof window !== "undefined" ? window
  : (typeof globalThis !== "undefined" ? globalThis : this));
