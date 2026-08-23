/* =============================================================================
 * sim/desk.js  —  window.Desk
 *
 * The desk feed. Four voices, two sources of messages (scheduled + reactive),
 * three gates. No DOM, no imports, no libraries. Loaded with a plain
 * <script src> tag from file://.
 *
 * Contract (SPEC §4):
 *   Desk.init({ day, engine, onMessage })
 *   Desk.tick(state)        // called by ui.js on every engine tick
 *   Desk.getFeed()          // -> [msg, ...]
 *   Desk.GATES              // -> [ {m, id, title, prompt}, ... ]
 *
 * Msg = { m, t, from:"PM"|"RISK"|"DESK"|"WIRE", name, text,
 *         tone:"neutral"|"pressure"|"warn"|"praise"|"alarm" }
 *   plus two additive, non-breaking fields that ui.js may ignore:
 *   kind: "scheduled"|"gate"|"reactive",  trigger: "<trigger id>" (reactive only),
 *   gate: "<gate id>" (gate messages only).
 *
 * -----------------------------------------------------------------------------
 * THE VOICES — hold these consistently.
 *
 *   PM   Dana Whitfield        Demanding, fair, relentlessly about REASONING and
 *                              not outcome. Will praise a good process that lost
 *                              money and question a sloppy trade that made it.
 *                              Terse. Numerate. Never cruel.
 *   RISK Marcus Reed           Unsentimental. Cares about size, exposure, loss.
 *                              Speaks in numbers and limits. Escalates coldly.
 *   DESK Priya (equities desk) Warm, human, lowercase, occasionally distracting,
 *                              sometimes has a read on the tape. She is what makes
 *                              this feel like a floor instead of a simulator.
 *   WIRE                       A news terminal. ALL CAPS, wire-service register,
 *                              leading asterisk, no analysis, ever.
 *
 * -----------------------------------------------------------------------------
 * DETERMINISM. Every trigger has 3-5 phrasings. The one used is chosen by
 * hash(day.id + trigger id) + number of messages emitted so far, modulo the
 * variant count. That is a pure function of the session, so a replay of the same
 * session produces a byte-identical feed, while a different day — or the same day
 * traded differently — draws different words. Nothing here is random.
 * ========================================================================== */

(function () {
  'use strict';

  /* ---------------------------------------------------------------- voices */

  var NAMES = {
    PM:   'Dana Whitfield',
    RISK: 'Marcus Reed',
    DESK: 'Priya (equities desk)',
    WIRE: 'WIRE'
  };

  // Drain order when several reactive messages are queued: RISK > PM > DESK > WIRE.
  var PRIORITY = { RISK: 1, PM: 2, DESK: 3, WIRE: 4 };

  var DEFAULT_RULES = {
    startEquity: 25000,
    leverage: 4,
    maxDailyLoss: -1500,
    warnDailyLoss: -900,
    noNewAfterM: 955,
    forceFlatM: 958,
    commissionPerShare: 0.005,
    minCommission: 1.00
  };

  /* ------------------------------------------------------------ formatting */

  function pad2(n) { n = Math.floor(n); return (n < 10 ? '0' : '') + n; }

  function hhmm(m) {
    m = Math.max(0, Math.floor(m || 0));
    return pad2(Math.floor(m / 60) % 24) + ':' + pad2(m % 60);
  }

  function group(numStr) {
    var p = String(numStr).split('.');
    p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return p.join('.');
  }

  // signed, for P&L:  +$380.00 / -$1,204.50
  function money(n) {
    n = n || 0;
    return (n < 0 ? '-$' : '+$') + group(Math.abs(n).toFixed(2));
  }

  // unsigned, for limits and notionals:  $1,500.00
  function usd(n) { return '$' + group(Math.abs(n || 0).toFixed(2)); }

  function qtyStr(n) { return group(String(Math.abs(Math.round(n || 0)))); }

  function px2(n) { return (n || 0).toFixed(2); }

  function pctStr(x) { return (isFinite(x) ? (x * 100).toFixed(0) : '0') + '%'; }

  function sign(n) { return n > 0 ? 1 : (n < 0 ? -1 : 0); }

  function clip(s, n) {
    s = String(s || '');
    return s.length <= n ? s : s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…';
  }

  // {placeholder} substitution
  function fill(tpl, data) {
    return String(tpl).replace(/\{(\w+)\}/g, function (whole, k) {
      return (data && data[k] !== undefined && data[k] !== null) ? String(data[k]) : whole;
    });
  }

  // djb2 — small, stable, no dependencies. Used only for deterministic variant choice.
  function hashStr(s) {
    var h = 5381, i;
    s = String(s);
    for (i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return h;
  }

  /* ---------------------------------------------------------------- state */

  var S = null;   // session state; rebuilt by Desk.init

  function freshState() {
    return {
      day: null, engine: null, onMessage: null, rules: DEFAULT_RULES,

      feed: [],            // every Msg emitted, in order
      queue: [],           // reactive candidates waiting for a free bar
      fired: {},           // trigger id -> true (once per session)
      seq: 0,              // queue tiebreaker
      emitCount: 0,        // drives deterministic phrasing choice

      events: [],          // day.events sorted by m
      eventFired: [],      // parallel array of booleans
      gateFired: {},

      lastM: null,
      lastDrainM: null,    // the bar on which a reactive message last went out

      /* ---- book, reconstructed purely from the state stream ---- */
      prevShares: 0,
      leg: null,           // the position currently open (see openLeg)
      legNo: 0,
      seenTrades: 0,       // index into state.trades
      closedTrades: 0,
      consecLosers: 0,
      lastLoss: null,      // { m, qty, pnl } — the most recent realized loser
      entrySizes: [],      // every opening/adding clip, in shares
      deadZoneEntries: 0,  // entries opened between 12:00 and 14:00
      flatSinceM: null,
      peakDayPnl: 0,
      peakDayPnlM: null,
      volHist: [],         // RTH bar volumes, for the wire's participation print
      anyFill: false
    };
  }

  /* --------------------------------------------------------------- emitting */

  function emit(from, text, tone, state, extra) {
    var msg = {
      m: state ? state.m : 0,
      t: (state && state.bar && state.bar.t) ? state.bar.t : hhmm(state ? state.m : 0),
      from: from,
      name: NAMES[from] || from,
      text: text,
      tone: tone || 'neutral'
    };
    if (extra) {
      for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) msg[k] = extra[k];
    }
    S.feed.push(msg);
    S.emitCount++;
    if (typeof S.onMessage === 'function') {
      try { S.onMessage(msg); } catch (e) { /* a broken listener must not kill the desk */ }
    }
    return msg;
  }

  // Deterministic phrasing: stable per (day, trigger), shifted by how much has
  // already been said today. Reproducible; never random.
  function pick(id, variants) {
    var dayId = (S.day && (S.day.id || S.day.ticker)) || 'day';
    var i = (hashStr(dayId + '|' + id) + S.emitCount) % variants.length;
    return variants[i];
  }

  /**
   * Queue a reactive message. Returns true if this trigger fired now.
   * Text is rendered at DETECTION time (so the numbers are the numbers of the
   * moment it happened) but stamped with the time it actually goes out.
   */
  function trig(id, from, tone, variants, data, opts) {
    if (S.fired[id]) return false;
    S.fired[id] = true;
    S.queue.push({
      id: id,
      from: from,
      tone: tone,
      text: fill(pick(id, variants), data || {}),
      prio: (opts && opts.urgent) ? 0 : (PRIORITY[from] || 5),
      seq: S.seq++,
      expiresM: (opts && opts.expiresM != null) ? opts.expiresM : null
    });
    return true;
  }

  // At most ONE reactive message per bar. RISK first, then PM, then DESK, then WIRE.
  function drain(state) {
    if (!S.queue.length) return null;
    var live = [], i;
    for (i = 0; i < S.queue.length; i++) {
      var c = S.queue[i];
      if (c.expiresM != null && state.m > c.expiresM) continue;  // stale, drop it
      live.push(c);
    }
    S.queue = live;
    if (!S.queue.length) return null;
    S.queue.sort(function (a, b) { return (a.prio - b.prio) || (a.seq - b.seq); });
    var c2 = S.queue.shift();
    return emit(c2.from, c2.text, c2.tone, state, { kind: 'reactive', trigger: c2.id });
  }

  /* ------------------------------------------------------- thesis parsing */

  /**
   * Pull the invalidation level out of the trader's own words.
   * We accept any number in the thesis that reads like a price near the entry,
   * and take the one on the wrong side of the trade closest to entry — that is
   * the level they said would prove them wrong. Decimals win over bare integers
   * so "200 shares" doesn't get mistaken for a level.
   */
  function parseLevel(thesis, entryPx, dir) {
    if (!thesis || !entryPx || !dir) return null;
    var re = /\d+(?:\.\d+)?/g, mres, withDot = [], plain = [], v;
    while ((mres = re.exec(String(thesis))) !== null) {
      v = parseFloat(mres[0]);
      if (!isFinite(v) || v <= 0) continue;
      if (Math.abs(v - entryPx) / entryPx > 0.08) continue;        // not a nearby price
      if (Math.abs(v - entryPx) < entryPx * 0.0002) continue;      // that's the entry itself
      (mres[0].indexOf('.') >= 0 ? withDot : plain).push(v);
    }
    var cands = withDot.length ? withDot : plain;
    if (!cands.length) return null;
    var best = null, k;
    for (k = 0; k < cands.length; k++) {
      v = cands[k];
      if (dir > 0 && v < entryPx) { if (best === null || v > best) best = v; }
      if (dir < 0 && v > entryPx) { if (best === null || v < best) best = v; }
    }
    return best;
  }

  function lastThesis(state) {
    var b = state.blotter || [], i;
    for (i = b.length - 1; i >= 0; i--) {
      if (b[i] && typeof b[i].thesis === 'string' && b[i].thesis.length) return b[i].thesis;
    }
    return '';
  }

  /* ------------------------------------------------------------ bookkeeping
   * Everything the reactive triggers need is derived here, from the state
   * stream alone. Engine is never asked for anything it doesn't already publish.
   * -------------------------------------------------------------------- */

  function openLeg(state, shares) {
    S.legNo++;
    var pos = state.position || {};
    var entryPx = pos.avgPx || (state.bar ? state.bar.c : 0);
    var dir = sign(shares);
    var th = lastThesis(state);
    S.leg = {
      no: S.legNo,
      openM: state.m,
      dir: dir,
      side: dir > 0 ? 'LONG' : 'SHORT',
      entryPx: entryPx,
      thesis: th,
      level: parseLevel(th, entryPx, dir),
      peakUnreal: 0,
      realized: 0,          // realized P&L booked while this leg was open
      underwaterSinceM: null,
      breachBars: 0,
      maxShares: Math.abs(shares)
    };
    return S.leg;
  }

  function closeLeg() {
    var leg = S.leg;
    S.leg = null;
    return leg;
  }

  /**
   * Consume one state snapshot. Returns the per-tick event bundle the trigger
   * evaluator needs: trades closed on this bar, clips added, leg just closed.
   */
  function updateBook(state) {
    var ev = { newTrades: [], entries: [], legClosed: null };
    var pos = state.position || { shares: 0, avgPx: 0 };
    var shares = pos.shares || 0;
    var prev = S.prevShares;
    var trades = state.trades || [];
    var i, tr;

    if (state.bar && state.bar.rth !== false) S.volHist.push(state.bar.v || 0);
    if ((state.blotter || []).length) S.anyFill = true;

    if ((state.dayPnl || 0) > S.peakDayPnl) {
      S.peakDayPnl = state.dayPnl || 0;
      S.peakDayPnlM = state.m;
    }

    // --- newly closed round trips (processed BEFORE the position transition,
    //     so the closing trade is still attributed to the leg that produced it)
    while (S.seenTrades < trades.length) {
      tr = trades[S.seenTrades++];
      if (!tr) continue;
      ev.newTrades.push(tr);
      S.closedTrades++;
      if (S.leg) S.leg.realized += (tr.pnl || 0);
      if ((tr.pnl || 0) > 0) {
        S.consecLosers = 0;
      } else if ((tr.pnl || 0) < 0) {
        S.consecLosers++;
        // The seed of revenge sizing: remember what the last loser cost and how big it was.
        S.lastLoss = { m: state.m, qty: Math.abs(tr.qty || 0), pnl: tr.pnl || 0 };
      }
    }

    // --- position transitions
    if (prev === 0 && shares !== 0) {
      openLeg(state, shares);
      ev.entries.push(Math.abs(shares));
    } else if (prev !== 0 && shares === 0) {
      ev.legClosed = closeLeg();
    } else if (prev !== 0 && shares !== 0) {
      if (sign(shares) !== sign(prev)) {              // reversed
        ev.legClosed = closeLeg();
        openLeg(state, shares);
        ev.entries.push(Math.abs(shares));
      } else if (Math.abs(shares) > Math.abs(prev)) { // added
        ev.entries.push(Math.abs(shares) - Math.abs(prev));
        if (S.leg) S.leg.maxShares = Math.max(S.leg.maxShares, Math.abs(shares));
      }
    }

    for (i = 0; i < ev.entries.length; i++) {
      S.entrySizes.push(ev.entries[i]);
      if (state.m >= 720 && state.m < 840) S.deadZoneEntries++;
    }

    // --- live leg: peak unrealized and how long it has been offside
    if (S.leg && shares !== 0) {
      var u = state.unrealized || 0;
      if (u > S.leg.peakUnreal) S.leg.peakUnreal = u;
      if (u < 0) {
        if (S.leg.underwaterSinceM === null) S.leg.underwaterSinceM = state.m;
      } else if (u > 0) {
        S.leg.underwaterSinceM = null;
      }
    }

    // --- how long we have been doing nothing
    if (shares === 0) {
      if (S.flatSinceM === null) S.flatSinceM = state.m;
    } else {
      S.flatSinceM = null;
    }

    S.prevShares = shares;
    return ev;
  }

  /* ============================================================== TRIGGERS
   * Each block: what it detects, and the lesson it is there to teach.
   * Evaluated in order of urgency; only the first one to reach a free bar
   * speaks, the rest wait their turn.
   * ====================================================================== */

  function evaluate(state, ev) {
    var R = S.rules;
    var pos = state.position || { shares: 0, avgPx: 0 };
    var shares = pos.shares || 0;
    var dayPnl = state.dayPnl || 0;
    var bp = state.buyingPower || 0;
    var exposure = state.exposure || 0;
    var px = (state.bar && state.bar.c) || pos.avgPx || 0;
    var i, tr;

    /* ---- 1. HARD DAILY LOSS LIMIT ------------------------------------- RISK
     * Lesson: the limit is not advice. It is the mechanism that guarantees there
     * is a tomorrow. Nobody argues with it, least of all the person who hit it. */
    if (dayPnl <= R.maxDailyLoss) {
      trig('loss_hard', 'RISK', 'alarm', [
        'That is the limit. {pnl} against {max}. You are flat and you are done for the day. We will talk tomorrow.',
        'Stop. {pnl}. I am flattening you and pulling the card. Nothing personal — it is the rule that keeps you employed.',
        'Daily loss limit hit at {pnl}. Position gone, account locked. Write down what you would do differently now, while it still stings.',
        '{pnl}. Done. Card is pulled. The limit is not a punishment, it is the reason you get to trade on Monday.'
      ], { pnl: money(dayPnl), max: usd(R.maxDailyLoss) }, { urgent: true });
    }

    /* ---- 2. SOFT LOSS WARNING ----------------------------------------- RISK
     * Lesson: the loss that ends a career is never the one that trips the limit,
     * it is the one taken while trying to make back the one before it. */
    if (dayPnl <= R.warnDailyLoss && dayPnl > R.maxDailyLoss) {
      trig('loss_warn', 'RISK', 'warn', [
        'Down {pnl}. Your limit is {max}. That is {room} of room and I am counting it out loud from here.',
        '{pnl} on the day. That is the warn line. The next decision is the one that matters — make it smaller, not bigger.',
        'You are {pnl}. I have watched the next twenty minutes of this movie before. Cut size or stand down. Your call, but make it.',
        'Warn level: {pnl} against a {max} limit. Nothing is wrong yet. What would be wrong is the next trade being your biggest.'
      ], {
        pnl: money(dayPnl),
        max: usd(R.maxDailyLoss),
        room: usd(dayPnl - R.maxDailyLoss)
      });
    }

    if (state.locked) { return; }   // card pulled; the desk stops coaching a closed book

    /* ---- 3. REVENGE SIZING -------------------------------------------- RISK
     * Detects: the first entry after a realized loser that is >=1.5x the size of
     * the loser, within 20 minutes of it.
     * Lesson: size is a statement about conviction. When size jumps right after
     * a loss, the variable that changed was not the setup, it was the mood. */
    if (ev.entries.length && S.lastLoss) {
      var clipQty = ev.entries[0];
      var gapM = state.m - S.lastLoss.m;
      var oldQty = S.lastLoss.qty || 0;
      if (oldQty > 0 && gapM <= 20 && clipQty >= 1.5 * oldQty) {
        trig('revenge', 'RISK', 'warn', [
          'You just lost {loss} and came back with {newQty} shares against {oldQty}. That is revenge sizing. Name it out loud so you can stop doing it.',
          'Last trade lost {loss}. This one is {mult}x the size, {mins} minutes later. That is not a setup, that is a mood.',
          '{oldQty} to {newQty} straight after a loser. Size follows conviction, not anger. Cut it, or justify it to me right now.',
          'Bigger size immediately after a loss. Flagged. If the setup genuinely improved in {mins} minutes, tell me what improved.'
        ], {
          loss: money(S.lastLoss.pnl),
          newQty: qtyStr(clipQty),
          oldQty: qtyStr(oldQty),
          mult: (clipQty / oldQty).toFixed(1),
          mins: gapM
        });
      }
      S.lastLoss = null;   // "right after" means right after; one entry consumes it
    }

    /* ---- 4. EXPOSURE AGAINST THE LINE --------------------------------- RISK
     * Lesson: size is the first risk decision and the only one you make with a
     * clear head. At 85% of the line, a 1% move is the whole day. */
    if (bp > 0 && exposure > 0.80 * bp) {
      var frac = exposure / bp;
      trig('exposure_line', 'RISK', 'warn', [
        'Exposure {exp} against a {bp} line. That is {pct} used. I want the plan and the stop, in that order.',
        'You are at {pct} of your line. I am not saying no. I am saying say it out loud: what takes you out, and where.',
        '{pct} of buying power in one name. At that size a 1% move against you is {onePct}. Is that the number you meant to risk?',
        'Size check. {pct} of the line, {exp} on. Either you have a stop or you have a hope. Tell me which.'
      ], {
        exp: usd(exposure), bp: usd(bp), pct: pctStr(frac), onePct: usd(exposure * 0.01)
      });
    }

    /* ---- 5. STILL HOLDING AT 15:45 ------------------------------------ RISK
     * Lesson: an exit you do not choose is an exit the closing auction chooses
     * for you, and it never chooses kindly. */
    if (state.m >= 945 && shares !== 0) {
      trig('hold_1545', 'RISK', 'warn', [
        '15:45. You are still holding {qty}. Twelve minutes, then I do it for you at whatever the tape gives us.',
        'Twelve minutes to the auto-flat. {qty} shares on. Do not make me be the one who exits your trade.',
        '15:45 and you are {side} {qty}. Closing prints get ugly and they do not care about your average. Out on your terms or out on mine.',
        'Position still open at 15:45. Force-flat at 15:58 and I do not negotiate with the close.'
      ], {
        qty: qtyStr(shares),
        side: shares > 0 ? 'long' : 'short'
      }, { expiresM: (R.forceFlatM || 958) - 1 });
    }

    /* ---- 6. TRADING THROUGH YOUR OWN LEVEL ------------------------ PM (extra)
     * Detects: the thesis typed on entry named a price; the tape has closed
     * through it for two bars; the position is still on.
     * Lesson: a thesis with a level in it is a contract you wrote with yourself.
     * The moment discipline dies is the moment the level moves after the fact. */
    if (S.leg && S.leg.level && shares !== 0 && px > 0) {
      var lvl = S.leg.level;
      var tol = lvl * 0.0005;
      var broken = (S.leg.dir > 0) ? (px < lvl - tol) : (px > lvl + tol);
      S.leg.breachBars = broken ? S.leg.breachBars + 1 : 0;
      if (S.leg.breachBars >= 2) {
        trig('thesis_level_break', 'PM', 'pressure', [
          'You wrote: "{thesis}". That level was {level}. We are {px}. You are still in it. Was the level wrong, or is this the part where the discipline goes?',
          'Your own thesis named {level}. Print is {px} and you are still {side}. Either update the thesis out loud or take the loss you already defined.',
          '{level} was your line — your words, not mine. It is gone. Holding past your own level is how a small loss becomes the day.',
          'You named {level}. The tape says {px}. I do not mind you being wrong. I mind you moving the line after the fact.'
        ], {
          thesis: clip(S.leg.thesis, 72),
          level: px2(lvl),
          px: px2(px),
          side: S.leg.dir > 0 ? 'long' : 'short'
        });
      }
    }

    /* ---- 7. GAVE BACK A WINNER ----------------------------------------- PM
     * Detects: a leg whose peak unrealized was meaningful and which closed for
     * <=40% of that peak (i.e. gave back more than 60%).
     * Lesson: entries are half the job. A trade with no exit plan is a trade you
     * are running with the part of your brain that hates being wrong. */
    if (ev.legClosed) {
      var lc = ev.legClosed;
      var peak = lc.peakUnreal || 0;
      var got = lc.realized || 0;
      if (peak >= 120 && got <= 0.40 * peak) {
        trig('giveback', 'PM', 'pressure', [
          'You were up {peak} on that one and closed it at {final}. Walk me through the moment you decided not to take it.',
          '{peak} down to {final}. I do not mind giving some back — that is how you let a winner run. {gave} of it is not letting it run, it is not looking.',
          'That trade peaked at {peak}. You booked {final}. Where was your out? Say a number next time, and say it before you are in.',
          'Peak {peak}, exit {final}. Good entry, no exit plan. Half of this job is the second half.',
          'Held {mins} minutes, gave back {gave} of the best mark. The entry was fine. Show me the rule that would have kept {peak}.'
        ], {
          peak: money(peak),
          final: money(got),
          gave: pctStr(peak > 0 ? (peak - got) / peak : 0),
          mins: Math.max(0, state.m - (lc.openM || state.m))
        });
      }
    }

    /* ---- 8. HELD UNDERWATER 45+ MINUTES -------------------------------- PM
     * Lesson: time is information. Forty-five minutes of red is the market
     * telling you the reason you gave for the trade is no longer operating. */
    if (S.leg && shares !== 0 && S.leg.underwaterSinceM !== null &&
        (state.m - S.leg.underwaterSinceM) > 45) {
      trig('underwater45', 'PM', 'pressure', [
        'You have been underwater on this for {mins} minutes. You typed "{thesis}". Is that still true, or are you just hoping it comes back?',
        '{mins} minutes offside. Either the reason you got in is still there or it is not. Tell me which, then act like it.',
        'That position has not been green in {mins} minutes. Time is information. What is it telling you?',
        'Held {mins} minutes, all of it red, {unreal} at the mark. I would rather you be wrong and out than right and stuck.'
      ], {
        mins: state.m - S.leg.underwaterSinceM,
        thesis: clip(S.leg.thesis, 64),
        unreal: money(state.unrealized || 0)
      });
    }

    /* ---- 9. GAVE BACK THE DAY ------------------------------------ PM (extra)
     * Detects: peak day P&L >= +$400, now down to <=35% of it.
     * Lesson: the day's P&L is itself a position. Making a good day and keeping
     * one are two separate skills, and the second is the one nobody practises. */
    if (S.peakDayPnl >= 400 && dayPnl <= 0.35 * S.peakDayPnl && state.m >= 600) {
      trig('day_giveback', 'PM', 'pressure', [
        'You were {peak} at {peakT}. You are {now}. That is {gave} of the day handed back. The morning was the trade — what changed after it?',
        'Peak day P&L {peak}, now {now}. Protecting a good day is a skill, and it is a different skill from making one.',
        '{peak} at {peakT}, {now} now. Nothing you have done since improved this day. What is the rule that stops this next time?'
      ], {
        peak: money(S.peakDayPnl),
        peakT: hhmm(S.peakDayPnlM || 0),
        now: money(dayPnl),
        gave: pctStr(S.peakDayPnl > 0 ? (S.peakDayPnl - dayPnl) / S.peakDayPnl : 0)
      });
    }

    /* ---- 10. THREE CONSECUTIVE LOSERS ---------------------------------- PM
     * Lesson: three in a row is not variance, it is a read that has stopped
     * working. The cheapest trade of the day is the one you do not take. */
    if (S.consecLosers >= 3) {
      trig('three_losers', 'PM', 'pressure', [
        'Three in a row. Stop. Walk to the window, count to sixty, then come back and tell me the plan. Not the trade — the plan.',
        'That is three consecutive losers. The market is not wrong; the read is. Stand down until you can say what changed.',
        'Three straight. Do nothing for ten minutes. Then one sentence for me: what setup, what level, what size.',
        'Three losses back to back, {pnl} on the day. The next click is the most expensive one you will make today. Make it slowly.'
      ], { pnl: money(dayPnl) });
    }

    /* ---- 11. TRADING THE DEAD ZONE ------------------------------- PM (extra)
     * Detects: a second entry opened between 12:00 and 14:00.
     * Lesson: midday is the lowest-volume, lowest-information tape of the day.
     * Ranges compress, stops get picked off, nothing follows through. Most
     * mornings are given back between noon and two by people who were bored. */
    if (S.deadZoneEntries >= 2 && state.m >= 720 && state.m < 900) {
      trig('dead_zone', 'PM', 'pressure', [
        'Second entry inside the lunch hour. Volume is the lowest it will be all day and so is the information in every tick. What is your edge in this tape?',
        'You are trading 12:00 to 14:00. Ranges compress, stops get picked, nothing follows through. If this is not a planned setup, it is boredom with a keyboard.',
        'Two entries in the dead zone. Show me the level. If you cannot name one, that trade is entertainment and I am paying for it.'
      ], {});
    }

    /* ---- 12. INCONSISTENT SIZING --------------------------------- PM (extra)
     * Detects: >=3 entries where the largest clip is >=3x the smallest.
     * Lesson: if position size is not a deliberate unit, then one trade you did
     * not choose carefully decides your month. Vary size on purpose or not at all. */
    if (S.entrySizes.length >= 3) {
      var mn = Infinity, mx = 0;
      for (i = 0; i < S.entrySizes.length; i++) {
        if (S.entrySizes[i] < mn) mn = S.entrySizes[i];
        if (S.entrySizes[i] > mx) mx = S.entrySizes[i];
      }
      if (mn > 0 && mx >= 3 * mn) {
        trig('sizing_inconsistent', 'PM', 'pressure', [
          'Your clips today: {list}. That is a {mult}x spread. If every trade is the same quality of idea, why is it not the same size? If it is not, tell me what makes the big one big.',
          '{mx} shares on one, {mn} on another. Position size is a statement about conviction. Right now yours is unreadable.',
          'Sizing is all over the map ({list}). Pick a unit. Vary it deliberately, with a reason you can say in one sentence, or do not vary it.'
        ], {
          list: S.entrySizes.join(' / '),
          mult: (mx / mn).toFixed(1),
          mx: qtyStr(mx),
          mn: qtyStr(mn)
        });
      }
    }

    /* ---- 13. FLAT AN HOUR MID-SESSION ---------------------------------- PM
     * Lesson: patience is a position only if you can name what ends it.
     * Otherwise it is avoidance, and avoidance costs the same as a loss. */
    if (shares === 0 && S.flatSinceM !== null && (state.m - S.flatSinceM) >= 60 &&
        state.m >= 630 && state.m <= 930) {
      trig('flat60', 'PM', 'pressure', [
        'You have been flat {mins} minutes. You are not paid to watch. What are you waiting for — say the setup out loud.',
        '{mins} minutes with no position. If nothing is there, fine. But I want to hear the level you are waiting for.',
        'An hour flat. Patience is a position if you can name what ends it. Can you?',
        'Flat since {since}. Sitting out is a decision — make it a deliberate one and tell me the trigger you are waiting on.'
      ], { mins: state.m - S.flatSinceM, since: hhmm(S.flatSinceM) });
    }

    /* ---- 14. OVERTRADING THE FIRST HOUR ------------------------------ DESK
     * Lesson: four round trips before 10:30 is not opportunity, it is a
     * heart-rate problem, and the commissions are real money. */
    if (S.closedTrades >= 4 && state.m < 630) {
      trig('overtrading', 'DESK', 'warn', [
        'four round trips and it is not even 10:30 — you hunting, or just clicking?',
        'hey. that is 4 trades in the first hour. i did that in 2019 and my p&l looked like a heart monitor. breathe for a sec?',
        '{n} round trips before 10:30. that is {c} of commission before you have had a single good idea. you good?',
        'you are trading like the tape owes you money. get a water. let one setup come to you.'
      ], { n: S.closedTrades, c: usd(state.commissions || 0) });
    }

    /* ---- 15. SAT OUT THE OPENING DRIVE -------------------------- DESK (extra)
     * Detects: 10:00 and not a single fill.
     * Lesson: 09:30-10:00 carries the widest ranges and the deepest liquidity of
     * the day. Sitting it out is allowed; sitting it out and then chasing a
     * thinner tape at 11:15 is how the day quietly gets worse. */
    if (state.m >= 600 && !S.anyFill && shares === 0) {
      trig('sitting_out_open', 'DESK', 'neutral', [
        'half nine to ten is gone and you have not printed a ticket. that half hour is a third of the day’s range. what were you waiting on?',
        'no fills through the open. fair enough if nothing set up — just know the volume is leaving now, not arriving.',
        'you sat out the opening drive. that is allowed. be honest with yourself though: no setup, or no nerve?'
      ], {});
    }

    /* ---- 16. FIRST GREEN CLOSE-OUT ----------------------------------- DESK
     * Lesson: notice the good ones. A day where you only mark the losses trains
     * you to hate your own job. */
    for (i = 0; i < ev.newTrades.length; i++) {
      tr = ev.newTrades[i];
      if ((tr.pnl || 0) > 0) {
        trig('first_win', 'DESK', 'praise', [
          'there we go. green one on the board.',
          'nice, first one closed green. that is the one that makes the day feel possible.',
          'booked. {pnl}. take two seconds to notice it, then reset.',
          'first green trade of the day. i am keeping count.'
        ], { pnl: money(tr.pnl) });
        break;
      }
    }

    /* ---- 17. A GENUINELY BIG WINNER ---------------------------------- DESK
     * Lesson: write down what you saw while you can still see it. The good
     * trades are the ones you forget, because nothing hurt. */
    for (i = 0; i < ev.newTrades.length; i++) {
      tr = ev.newTrades[i];
      if ((tr.pnl || 0) > 400) {
        trig('bigwin', 'DESK', 'praise', [
          'ok that is {pnl} on one trade. nice. what was the read?',
          '{pnl} on that one. tell me you saw it before it went — i want the setup.',
          'big one. {pnl}. write down what you saw right now, while you still remember it.',
          'nice trade, {pnl}. the good ones are worth a note. future you will not remember this.'
        ], { pnl: money(tr.pnl) });
        break;
      }
    }

    /* ---- 18. VOLUME EXPANSION ---------------------------------- WIRE (extra)
     * Detects: a bar printing >=3x the trailing 20-bar average volume.
     * Lesson: participation confirms a move. The terminal prints the fact and
     * nothing else — what it means is your job, not the wire's. */
    if (S.volHist.length >= 21) {
      var n = S.volHist.length;
      var cur = S.volHist[n - 1], sum = 0;
      for (i = n - 21; i < n - 1; i++) sum += S.volHist[i];
      var avg = sum / 20;
      if (avg > 0 && cur >= 3 * avg) {
        trig('wire_vol', 'WIRE', 'neutral', [
          '*{tk} VOLUME SPIKE — {x}X TRAILING 20-BAR AVERAGE ON {v} SHARES',
          '*{tk} TRADING VOLUME SURGES AT {t} ET; {x}X 20-BAR AVERAGE',
          '*{tk} SEES HEAVY PRINTS — SINGLE-MINUTE VOLUME {x}X RECENT AVERAGE'
        ], {
          tk: (S.day && S.day.ticker) || 'STOCK',
          x: (cur / avg).toFixed(1),
          v: qtyStr(cur),
          t: hhmm(state.m)
        });
      }
    }
  }

  /* ------------------------------------------------------ scheduled + gates */

  function fireScheduled(state, out) {
    var i, e, from, msg;
    for (i = 0; i < S.events.length; i++) {
      if (S.eventFired[i]) continue;
      e = S.events[i];
      if (state.m < e.m) continue;                     // not yet
      S.eventFired[i] = true;
      from = e.from || 'WIRE';
      msg = emit(
        from,
        e.text || e.headline || e.message || '',
        e.tone || (from === 'WIRE' ? 'neutral' : 'neutral'),
        state,
        { kind: 'scheduled', name: e.name || NAMES[from] || from }
      );
      out.push(msg);
    }
  }

  function fireGates(state, out) {
    // Which voice hands you the gate. The open and the close belong to the PM;
    // the midday book review belongs to risk.
    var VOICE = { open: 'PM', midday: 'RISK', close: 'PM' };
    var i, g, msg;
    for (i = 0; i < Desk.GATES.length; i++) {
      g = Desk.GATES[i];
      if (S.gateFired[g.id]) continue;
      if (state.m < g.m) continue;
      S.gateFired[g.id] = true;
      msg = emit(VOICE[g.id] || 'PM', g.prompt, 'pressure', state, {
        kind: 'gate', gate: g.id, title: g.title
      });
      out.push(msg);
    }
  }

  /* ------------------------------------------------------------------- API */

  var Desk = {

    // Verbatim from SPEC §4. ui.js renders the modal; Desk only owns these.
    GATES: [
      { m: 570, id: 'open',   title: 'Pitch your plan',
        prompt: 'Before the bell: post your plan to your PM in chat.' },
      { m: 720, id: 'midday', title: 'Midday risk check',
        prompt: 'Marcus wants your book, your P&L, and what you’re doing about it.' },
      { m: 961, id: 'close',  title: 'P&L review',
        prompt: 'Paste your tearsheet into chat. Dana will go trade by trade.' }
    ],

    NAMES: NAMES,

    init: function (opts) {
      opts = opts || {};
      S = freshState();
      S.day = opts.day || null;
      S.engine = opts.engine || null;
      S.onMessage = opts.onMessage || null;

      var R = (S.engine && S.engine.RULES) || null;
      S.rules = {};
      var k;
      for (k in DEFAULT_RULES) if (Object.prototype.hasOwnProperty.call(DEFAULT_RULES, k)) {
        S.rules[k] = (R && R[k] !== undefined) ? R[k] : DEFAULT_RULES[k];
      }

      var evs = (S.day && S.day.events) ? S.day.events.slice() : [];
      evs.sort(function (a, b) { return (a.m || 0) - (b.m || 0); });
      S.events = evs;
      S.eventFired = [];
      for (var i = 0; i < evs.length; i++) S.eventFired.push(false);

      return Desk;
    },

    /**
     * Called on every engine tick. Emits, in this order:
     *   - every scheduled day.events[] item now due,
     *   - every gate now due,
     *   - at most ONE reactive message for this bar.
     * Returns the messages emitted on this call (ui.js may ignore it; the
     * onMessage callback is the primary channel).
     */
    tick: function (state) {
      var out = [];
      if (!S || !state) return out;

      fireScheduled(state, out);
      fireGates(state, out);

      var ev = updateBook(state);
      evaluate(state, ev);

      if (S.lastDrainM !== state.m) {           // one reactive message per bar
        var msg = drain(state);
        if (msg) { S.lastDrainM = state.m; out.push(msg); }
      }

      S.lastM = state.m;
      return out;
    },

    getFeed: function () { return S ? S.feed.slice() : []; },

    // Additive helpers — ui.js is free to ignore them; nothing in the contract
    // depends on their existence.
    pending: function () { return S ? S.queue.length : 0; },
    gateFor: function (m) {
      for (var i = 0; i < Desk.GATES.length; i++) if (Desk.GATES[i].m === m) return Desk.GATES[i];
      return null;
    }
  };

  window.Desk = Desk;

})();
