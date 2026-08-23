/* ============================================================================
   tools/ui_mocks.js  —  FAKE Engine / Chart / Desk / SIM_DAYS for UI testing.

   NOT part of the product. Loaded only by tools/ui_preview.html, in place of
   data/days.js + sim/engine.js + sim/chart.js + sim/desk.js, so that sim/ui.js
   can be exercised end-to-end before the real modules exist.

   These mocks conform to the public API in SPEC.md §1–§4 (that is the point);
   they are deliberately simpler than the real thing internally.
   ============================================================================ */
(function () {
  'use strict';

  /* ---------------------------------------------------------------- */
  /* seeded PRNG so the synthetic tape is reproducible                  */
  /* ---------------------------------------------------------------- */
  function rng(seed) {
    var s = seed >>> 0;
    return function () {
      s ^= s << 13; s >>>= 0;
      s ^= s >> 17;
      s ^= s << 5;  s >>>= 0;
      return s / 4294967296;
    };
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function hhmm(m) { return pad2(Math.floor(m / 60) % 24) + ':' + pad2(m % 60); }
  function r2(x) { return Math.round(x * 100) / 100; }

  /* ---------------------------------------------------------------- */
  /* SIM_DAYS — three synthetic days                                    */
  /* ---------------------------------------------------------------- */
  function makeBars(seed, prevClose, gapPct, drift, vol) {
    var rnd = rng(seed);
    var bars = [];
    var px = prevClose * (1 + gapPct / 100);

    /* sparse pre-market: 08:00 -> 09:29 every 5 minutes */
    for (var m = 480; m < 570; m += 5) {
      var o = px;
      px = px * (1 + (rnd() - 0.5) * vol * 0.6);
      var c = px;
      var hi = Math.max(o, c) * (1 + rnd() * vol * 0.3);
      var lo = Math.min(o, c) * (1 - rnd() * vol * 0.3);
      bars.push({ m: m, t: hhmm(m), o: r2(o), h: r2(hi), l: r2(lo), c: r2(c),
                  v: Math.round(8000 + rnd() * 40000), rth: false });
    }

    /* RTH: 09:30 -> 15:59, contiguous */
    for (var k = 0; k < 390; k++) {
      var mm = 570 + k;
      var o2 = px;
      /* U-shaped volume, mean-reverting-ish drift with a trend leg midday */
      var trend = drift * (k < 60 ? 1.6 : k < 200 ? 0.5 : -0.8);
      px = px * (1 + trend / 10000 + (rnd() - 0.5) * vol);
      var c2 = px;
      var h2 = Math.max(o2, c2) * (1 + rnd() * vol * 0.5);
      var l2 = Math.min(o2, c2) * (1 - rnd() * vol * 0.5);
      var uShape = 1 + 2.2 * Math.exp(-k / 45) + 1.6 * Math.exp(-(389 - k) / 40);
      bars.push({ m: mm, t: hhmm(mm), o: r2(o2), h: r2(h2), l: r2(l2), c: r2(c2),
                  v: Math.round((25000 + rnd() * 60000) * uShape), rth: true });
    }
    return bars;
  }

  function premktStats(bars, prevClose) {
    var pm = bars.filter(function (b) { return b.rth === false; });
    var hi = -Infinity, lo = Infinity, v = 0;
    pm.forEach(function (b) { hi = Math.max(hi, b.h); lo = Math.min(lo, b.l); v += b.v; });
    var last = pm.length ? pm[pm.length - 1].c : prevClose;
    return { high: r2(hi), low: r2(lo), last: r2(last), volume: v,
             gapPct: r2(((last - prevClose) / prevClose) * 100) };
  }

  function mkDay(cfg) {
    var bars = makeBars(cfg.seed, cfg.prevClose, cfg.gapPct, cfg.drift, cfg.vol);
    return {
      id: cfg.id, ticker: cfg.ticker, company: cfg.company, sector: cfg.sector,
      sessionNo: cfg.sessionNo, prevClose: cfg.prevClose, openM: 570, closeM: 960,
      bars: bars,
      premkt: premktStats(bars, cfg.prevClose),
      brief: cfg.brief,
      events: cfg.events
    };
  }

  window.SIM_DAYS = [
    mkDay({
      id: 'day1', ticker: 'ORVX', company: 'Orvex Dynamics',
      sector: 'Enterprise software / defense analytics', sessionNo: 1,
      prevClose: 178.40, gapPct: 1.77, drift: 4, vol: 0.0016, seed: 12345,
      brief: {
        headline: 'Orvex beat on revenue and guided the December quarter above the street, ' +
          'but flagged a slower federal renewal cycle. The stock is indicated up ~1.8% ' +
          'pre-market on 1.8m shares — thin for a print like this.',
        bullCase: 'Guide is above consensus, backlog up 22% y/y, and the sell side will ' +
          'mark up targets into the open. Gaps like this on a beat tend to trend.',
        bearCase: 'The federal comment is the tell. Last two quarters the gap faded by ' +
          '11:00 as the desk sold into strength. 182 is old supply.',
        levels: [
          { label: 'Prev close', px: 178.40 },
          { label: 'Pre-mkt high', px: 182.10 },
          { label: 'Gap fill', px: 179.20 },
          { label: 'Old supply', px: 184.00 }
        ],
        pmAsk: 'I want one idea, sized properly, with an invalidation level you actually ' +
          'respect. Do not average down into a fade. Tell me before the bell.'
      },
      events: [
        { m: 575, from: 'WIRE', name: 'Newswire', tone: 'neutral',
          text: 'ORVX opens up 1.9%. Early volume 3.1x the 20-day average.' },
        { m: 601, from: 'DESK', name: 'Priya (equities desk)', tone: 'neutral',
          text: 'Two accounts hitting our bid in size at 181.80. Someone wants out.' },
        { m: 645, from: 'PM', name: 'Dana Whitfield', tone: 'pressure',
          text: 'It is 10:45. Where are you, and what is your risk?' },
        { m: 690, from: 'WIRE', name: 'Newswire', tone: 'neutral',
          text: 'Sector peer TRNL cuts FY guide; group trades off in sympathy.' },
        { m: 780, from: 'DESK', name: 'Priya (equities desk)', tone: 'neutral',
          text: 'Lunch lull. Spreads widening. Do not force it.' },
        { m: 900, from: 'PM', name: 'Dana Whitfield', tone: 'pressure',
          text: 'One hour. Tell me what you are carrying into the close, if anything.' }
      ]
    }),
    mkDay({
      id: 'day2', ticker: 'HLDR', company: 'Halder Bioscience',
      sector: 'Biotech / late-stage oncology', sessionNo: 2,
      prevClose: 64.15, gapPct: -4.2, drift: -6, vol: 0.0029, seed: 987654,
      brief: {
        headline: 'Halder\'s phase-2 readout hit the primary endpoint but missed on ' +
          'duration of response. Down 4.2% pre-market on heavy volume.',
        bullCase: 'The primary endpoint is what the FDA cares about. Oversold gaps in ' +
          'biotech reclaim the pre-market low more often than not.',
        bearCase: 'Duration of response is the whole commercial argument. Real money sells ' +
          'this for a week, not a morning.',
        levels: [
          { label: 'Prev close', px: 64.15 },
          { label: 'Pre-mkt low', px: 60.80 },
          { label: '200-day', px: 62.40 }
        ],
        pmAsk: 'You are carrying yesterday\'s damage. Half size until you are right twice. ' +
          'I want to hear the words "I am flat and waiting" if that is the honest answer.'
      },
      events: [
        { m: 572, from: 'RISK', name: 'Marcus Reed', tone: 'warn',
          text: 'You start today with less equity than yesterday. Your line moved with it.' },
        { m: 620, from: 'WIRE', name: 'Newswire', tone: 'neutral',
          text: 'HLDR: two analysts move to Hold, one keeps Buy with a lower target.' },
        { m: 735, from: 'PM', name: 'Dana Whitfield', tone: 'neutral',
          text: 'Midday. What did the tape tell you that the brief did not?' }
      ]
    }),
    mkDay({
      id: 'day3', ticker: 'CMTQ', company: 'Comtiq Industrial',
      sector: 'Industrials / grid equipment', sessionNo: 3,
      prevClose: 41.02, gapPct: 0.15, drift: 1, vol: 0.0011, seed: 555111,
      brief: {
        headline: 'No news. Comtiq opens flat into a Fed minutes release at 14:00. ' +
          'Pre-market volume is negligible.',
        bullCase: 'Coiled range for six sessions. Whichever way it resolves after 14:00 ' +
          'usually runs into the close.',
        bearCase: 'There is nothing here before 14:00. Every trade you take this morning ' +
          'is a trade you invented.',
        levels: [
          { label: 'Prev close', px: 41.02 },
          { label: 'Range high', px: 41.60 },
          { label: 'Range low', px: 40.55 }
        ],
        pmAsk: 'The hard session. Most of today, the correct trade is no trade. ' +
          'Show me you can sit still and still be paid.'
      },
      events: [
        { m: 690, from: 'DESK', name: 'Priya (equities desk)', tone: 'neutral',
          text: 'Nothing happening. Someone brought donuts. That is the news.' },
        { m: 840, from: 'WIRE', name: 'Newswire', tone: 'neutral',
          text: 'FED MINUTES: members saw scope for patience on further tightening.' },
        { m: 843, from: 'PM', name: 'Dana Whitfield', tone: 'pressure',
          text: 'There is your catalyst. Do not chase the first candle.' }
      ]
    })
  ];

  /* ================================================================== */
  /* MOCK ENGINE                                                        */
  /* ================================================================== */
  var RULES = {
    startEquity: 25000, leverage: 4, maxDailyLoss: -1500, warnDailyLoss: -900,
    noNewAfterM: 955, forceFlatM: 958, commissionPerShare: 0.005, minCommission: 1.00
  };

  var E = {
    RULES: RULES,
    _h: {}, _day: null, _idx: 0, _timer: null, _speed: 60, _running: false,
    _locked: false, _carried: 0, _startEq: RULES.startEquity,
    _pos: { shares: 0, avgPx: 0 }, _realized: 0, _comm: 0,
    _blotter: [], _trades: [], _working: [], _pending: [], _orderSeq: 1,
    _lot: null, _stats: null, _curve: [], _warned: false, _riskEvents: [],
    _peak: 0, _dd: 0
  };

  function emit(name, a, b) {
    (E._h[name] || []).forEach(function (fn) {
      try { fn(a, b); } catch (e) { console.error('[mock engine] handler error', e); }
    });
  }

  E.on = function (name, fn) { (E._h[name] = E._h[name] || []).push(fn); };

  E.init = function (opt) {
    E.destroy();
    E._h = {};
    E._day = opt.day;
    E._carried = (opt.account && typeof opt.account.equity === 'number')
      ? opt.account.equity - RULES.startEquity : 0;
    E._startEq = RULES.startEquity + E._carried;
    /* start on the last pre-market bar so the first tick is the open */
    var i = 0;
    while (i < E._day.bars.length - 1 && E._day.bars[i + 1].rth === false) i++;
    E._idx = i;
    E._pos = { shares: 0, avgPx: 0 };
    E._realized = 0; E._comm = 0;
    E._blotter = []; E._trades = []; E._working = []; E._pending = [];
    E._orderSeq = 1; E._lot = null; E._locked = false; E._running = false;
    E._warned = false; E._riskEvents = []; E._curve = []; E._peak = 0; E._dd = 0;
    E._stats = { nTrades: 0, wins: 0, losses: 0, biggestWin: 0, biggestLoss: 0,
                 maxDrawdown: 0, peakDayPnl: 0 };
  };

  E.destroy = function () {
    if (E._timer) { clearInterval(E._timer); E._timer = null; }
    E._running = false;
  };

  E.setSpeed = function (mult) {
    E._speed = mult;
    if (E._running) { E.pause(); E.resume(); }
  };

  E.start = function () { E._running = true; arm(); emit('tick', E.getState()); };
  E.pause = function () { E._running = false; if (E._timer) { clearInterval(E._timer); E._timer = null; } };
  E.resume = function () { if (!E._running) { E._running = true; arm(); } };
  function arm() {
    if (E._timer) clearInterval(E._timer);
    E._timer = setInterval(advance, Math.max(40, 60000 / E._speed));
  }
  E.step = function () { advance(); };

  function bar() { return E._day.bars[E._idx]; }
  function nextBar() { return E._day.bars[E._idx + 1] || bar(); }

  function advance() {
    if (E._idx >= E._day.bars.length - 1) {
      E.pause();
      emit('close', summary());
      return;
    }
    E._idx++;
    var b = bar();

    processPending(b);
    processWorking(b);

    /* risk */
    var st = E.getState();
    if (!E._locked && st.dayPnl <= RULES.maxDailyLoss) {
      E._locked = true;
      E.flatten('RISK_FLAT');
      var msg = 'You are down ' + st.dayPnl.toFixed(0) + '. You are done. I am flattening you.';
      E._riskEvents.push({ m: b.m, level: 'hard', message: msg });
      emit('risk', { level: 'hard', hard: true, message: msg, state: E.getState() });
    } else if (!E._warned && st.dayPnl <= RULES.warnDailyLoss) {
      E._warned = true;
      var w = 'Down ' + st.dayPnl.toFixed(0) + ' against a ' + RULES.maxDailyLoss + ' limit.';
      E._riskEvents.push({ m: b.m, level: 'warn', message: w });
      emit('risk', { level: 'warn', message: w, state: E.getState() });
    }
    if (b.m >= RULES.forceFlatM && E._pos.shares !== 0) E.flatten('EOD_FLAT');

    /* equity curve every 15 min */
    if (b.rth && b.m % 15 === 0) E._curve.push({ t: b.t, dayPnl: r2(E.getState().dayPnl) });

    var s2 = E.getState();
    E._peak = Math.max(E._peak, s2.dayPnl);
    E._dd = Math.min(E._dd, s2.dayPnl - E._peak);
    E._stats.peakDayPnl = r2(E._peak);
    E._stats.maxDrawdown = r2(E._dd);

    emit('tick', E.getState());

    if (b.m > E._day.closeM) { E.pause(); emit('close', summary()); }
  }

  function commission(qty) { return Math.max(RULES.minCommission, RULES.commissionPerShare * qty); }

  function mktFill(o, nb, mult) {
    var p = nb.o;
    var halfSpread = Math.max(0.01, p * 0.00015);
    var impact = p * 0.00012 * Math.min(4, o.qty / Math.max(1, nb.v * 0.015));
    var dir = o.side === 'BUY' ? 1 : -1;
    var f = nb.o + dir * (halfSpread + impact) * (mult || 1);
    return Math.max(nb.l, Math.min(nb.h, f));
  }

  function processPending(nb) {
    var list = E._pending; E._pending = [];
    list.forEach(function (o) { doFill(o, r2(mktFill(o, nb, 1)), nb, o.reason || 'MANUAL'); });
  }

  function processWorking(nb) {
    var keep = [];
    E._working.forEach(function (o) {
      if (o.type === 'LMT') {
        var hit = o.side === 'BUY' ? nb.l <= o.px : nb.h >= o.px;
        if (hit) { doFill(o, o.px, nb, 'MANUAL'); return; }
      } else if (o.type === 'STP') {
        var trig = o.side === 'BUY' ? nb.h >= o.px : nb.l <= o.px;
        if (trig) { doFill(o, r2(mktFill(o, nb, 2)), nb, 'STOP'); return; }
      }
      keep.push(o);
    });
    E._working = keep;
  }

  function doFill(o, px, b, reason) {
    var qty = o.qty;
    var c = r2(commission(qty));
    E._comm = r2(E._comm + c);
    var dir = o.side === 'BUY' ? 1 : -1;
    var pos = E._pos.shares;

    if (pos !== 0 && (pos > 0) !== (dir > 0)) {
      /* reducing / closing */
      var closeQty = Math.min(Math.abs(pos), qty);
      var pnl = (px - E._pos.avgPx) * closeQty * (pos > 0 ? 1 : -1);
      E._realized = r2(E._realized + pnl - c);
      if (E._lot) {
        var t = {
          openM: E._lot.m, closeM: b.m, side: pos > 0 ? 'LONG' : 'SHORT',
          qty: closeQty, entryPx: E._pos.avgPx, exitPx: px, pnl: r2(pnl - c),
          holdMins: b.m - E._lot.m, thesis: E._lot.thesis, exitReason: reason
        };
        E._trades.push(t);
        E._stats.nTrades++;
        if (t.pnl > 0) { E._stats.wins++; E._stats.biggestWin = Math.max(E._stats.biggestWin, t.pnl); }
        else { E._stats.losses++; E._stats.biggestLoss = Math.min(E._stats.biggestLoss, t.pnl); }
      }
      var remain = pos + dir * qty;
      if (Math.abs(remain) < 0.5) { E._pos = { shares: 0, avgPx: 0 }; E._lot = null; }
      else if ((remain > 0) !== (pos > 0)) {
        E._pos = { shares: remain, avgPx: px };
        E._lot = { m: b.m, thesis: o.thesis || '' };
      } else {
        E._pos.shares = remain;
      }
    } else {
      /* opening / increasing */
      var newShares = pos + dir * qty;
      E._pos.avgPx = r2(pos === 0 ? px
        : (E._pos.avgPx * Math.abs(pos) + px * qty) / (Math.abs(pos) + qty));
      E._pos.shares = newShares;
      if (!E._lot) E._lot = { m: b.m, thesis: o.thesis || '' };
      else if (o.thesis) E._lot.thesis = E._lot.thesis + ' | ' + o.thesis;
    }

    var fill = {
      id: 'f' + (E._blotter.length + 1), m: b.m, t: b.t, side: o.side, qty: qty,
      px: r2(px), notional: r2(px * qty), commission: c,
      thesis: o.thesis || '', reason: reason
    };
    E._blotter.push(fill);
    emit('fill', fill, E.getState());
  }

  E.getState = function () {
    var b = bar() || { c: E._day ? E._day.prevClose : 0 };
    var last = b.c;
    var unreal = E._pos.shares ? (last - E._pos.avgPx) * E._pos.shares : 0;
    var dayPnl = r2(E._realized + unreal);
    var equity = r2(E._startEq + dayPnl);
    return {
      m: b.m, bar: b, idx: E._idx,
      running: E._running, locked: E._locked,
      position: { shares: E._pos.shares, avgPx: E._pos.avgPx },
      realized: r2(E._realized), unrealized: r2(unreal), dayPnl: dayPnl,
      commissions: E._comm, equity: equity,
      buyingPower: r2(equity * RULES.leverage),
      exposure: r2(Math.abs(E._pos.shares) * last),
      blotter: E._blotter.slice(), trades: E._trades.slice(),
      stats: {
        nTrades: E._stats.nTrades, wins: E._stats.wins, losses: E._stats.losses,
        biggestWin: r2(E._stats.biggestWin), biggestLoss: r2(E._stats.biggestLoss),
        maxDrawdown: r2(E._stats.maxDrawdown), peakDayPnl: r2(E._stats.peakDayPnl)
      }
    };
  };

  E.submit = function (o) {
    var st = E.getState();
    if (E._locked) return { ok: false, error: 'Trading locked — you hit the daily loss limit' };
    if (st.m > E._day.closeM) return { ok: false, error: 'Market closed' };

    var dir = o.side === 'BUY' ? 1 : -1;
    var pos = st.position.shares;
    var increasing = pos === 0 || (pos > 0) === (dir > 0);

    if (increasing && (!o.thesis || String(o.thesis).trim().length < 10)) {
      var e1 = { ok: false, error: 'Thesis required' };
      emit('reject', { error: e1.error, order: o }); return e1;
    }
    if (increasing && st.m >= RULES.noNewAfterM) {
      var e2 = { ok: false, error: 'No new positions after 15:55' };
      emit('reject', { error: e2.error, order: o }); return e2;
    }
    var refPx = o.type === 'MKT' ? st.bar.c : o.px;
    var newExp = Math.abs(pos + dir * o.qty) * refPx;
    if (newExp > st.equity * RULES.leverage) {
      var e3 = { ok: false, error: 'Exceeds buying power' };
      emit('reject', { error: e3.error, order: o }); return e3;
    }

    var order = { id: 'o' + (E._orderSeq++), side: o.side, qty: o.qty, type: o.type,
                  px: o.px, thesis: o.thesis || '' };
    if (o.type === 'MKT') E._pending.push(order);
    else E._working.push(order);
    return { ok: true, order: order };
  };

  E.cancel = function (oid) {
    E._working = E._working.filter(function (o) { return o.id !== oid; });
    return { ok: true };
  };
  E.getWorking = function () { return E._working.slice(); };

  E.flatten = function (reason) {
    if (!E._pos.shares) return { ok: false, error: 'already flat' };
    E._pending.push({ id: 'o' + (E._orderSeq++), side: E._pos.shares > 0 ? 'SELL' : 'BUY',
                      qty: Math.abs(E._pos.shares), type: 'MKT', thesis: '',
                      reason: reason || 'MANUAL' });
    return { ok: true };
  };

  function summary() {
    var st = E.getState();
    return { dayPnl: st.dayPnl, equity: st.equity, stats: st.stats, locked: st.locked };
  }

  /* mock persistence uses its own key so it never touches real play data */
  var KEY = 'dts.mock.account.v1';
  E.loadAccount = function () {
    try {
      var raw = window.localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  };
  E.saveAccount = function (dayResult) {
    var a = E.loadAccount() || { equity: RULES.startEquity, sessions: [] };
    a.sessions.push(dayResult);
    a.equity = dayResult.endEquity;
    try { window.localStorage.setItem(KEY, JSON.stringify(a)); } catch (e) {}
    return a;
  };
  E.resetAccount = function () { try { window.localStorage.removeItem(KEY); } catch (e) {} };

  E.exportReview = function () {
    var st = E.getState();
    var L = [];
    L.push('# ' + E._day.ticker + ' — session ' + E._day.sessionNo + ' P&L review  [MOCK]');
    L.push('');
    L.push('**Day P&L ' + st.dayPnl.toFixed(2) + '** · realized ' + st.realized.toFixed(2) +
           ' · commissions ' + st.commissions.toFixed(2) + ' · end equity ' + st.equity.toFixed(2));
    L.push('Trades ' + st.stats.nTrades + ' · W/L ' + st.stats.wins + '/' + st.stats.losses +
           ' · biggest win ' + st.stats.biggestWin + ' · biggest loss ' + st.stats.biggestLoss +
           ' · max DD ' + st.stats.maxDrawdown + (st.locked ? ' · **RISK LOCKED**' : ''));
    L.push('');
    L.push('## Trades');
    L.push('| in | out | side | qty | entry | exit | P&L | hold | exit | thesis |');
    L.push('|---|---|---|---:|---:|---:|---:|---:|---|---|');
    st.trades.forEach(function (t) {
      L.push('| ' + hhmm(t.openM) + ' | ' + hhmm(t.closeM) + ' | ' + t.side + ' | ' + t.qty +
        ' | ' + t.entryPx.toFixed(2) + ' | ' + t.exitPx.toFixed(2) + ' | ' + t.pnl.toFixed(2) +
        ' | ' + t.holdMins + 'm | ' + t.exitReason + ' | ' + String(t.thesis).replace(/\|/g, '/') + ' |');
    });
    L.push('');
    L.push('## Equity curve (every 15 min)');
    E._curve.forEach(function (p) { L.push('- ' + p.t + '  ' + p.dayPnl.toFixed(2)); });
    if (E._riskEvents.length) {
      L.push(''); L.push('## Risk events');
      E._riskEvents.forEach(function (r) { L.push('- ' + hhmm(r.m) + ' [' + r.level + '] ' + r.message); });
    }
    return L.join('\n');
  };

  window.Engine = E;

  /* ================================================================== */
  /* MOCK CHART — simple but honest candles, respects `upto`             */
  /* ================================================================== */
  window.Chart = {
    create: function (canvas, opts) {
      var ctx = canvas.getContext('2d');
      var dpr = window.devicePixelRatio || 1;
      var W = 0, H = 0;
      var inst = {};
      var cross = null;

      function resize() {
        var r = canvas.getBoundingClientRect();
        W = Math.max(50, Math.round(r.width));
        H = Math.max(50, Math.round(r.height));
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      inst.resize = resize;

      canvas.addEventListener('mousemove', function (ev) {
        var r = canvas.getBoundingClientRect();
        cross = { x: ev.clientX - r.left, y: ev.clientY - r.top };
        if (inst._last) inst.render(inst._last);
      });
      canvas.addEventListener('mouseleave', function () {
        cross = null; if (inst._last) inst.render(inst._last);
      });

      inst.render = function (o) {
        inst._last = o;
        if (!W || !H) resize();
        var bars = o.bars || [];
        var upto = Math.min(o.upto === undefined ? bars.length - 1 : o.upto, bars.length - 1);
        if (upto < 0) { ctx.clearRect(0, 0, W, H); return; }
        var win = o.window || 120;
        var from = Math.max(0, upto - win + 1);
        var vis = bars.slice(from, upto + 1);   /* NEVER beyond upto */
        if (!vis.length) return;

        var padR = 54, padB = 20, padT = 6, padL = 4;
        var volH = Math.round((H - padT - padB) * 0.22);
        var priceH = H - padT - padB - volH - 4;

        var hi = -Infinity, lo = Infinity, maxV = 0;
        vis.forEach(function (b) { hi = Math.max(hi, b.h); lo = Math.min(lo, b.l); maxV = Math.max(maxV, b.v); });
        (o.levels || []).forEach(function (l) {
          if (l.px > lo * 0.97 && l.px < hi * 1.03) { hi = Math.max(hi, l.px); lo = Math.min(lo, l.px); }
        });
        var padPx = (hi - lo) * 0.06 || 0.5;
        hi += padPx; lo -= padPx;

        var cw = (W - padL - padR) / vis.length;
        var x = function (i) { return padL + i * cw + cw / 2; };
        var y = function (p) { return padT + (hi - p) / (hi - lo) * priceH; };

        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = '#0d1117'; ctx.fillRect(0, 0, W, H);
        ctx.font = '10px ui-monospace, Menlo, monospace';
        ctx.textBaseline = 'middle';

        /* grid + price axis */
        ctx.strokeStyle = '#1b2028'; ctx.lineWidth = 1;
        for (var g = 0; g <= 4; g++) {
          var py = padT + (priceH / 4) * g;
          ctx.beginPath(); ctx.moveTo(padL, py + 0.5); ctx.lineTo(W - padR, py + 0.5); ctx.stroke();
          ctx.fillStyle = '#8b949e';
          ctx.fillText((hi - (hi - lo) * g / 4).toFixed(2), W - padR + 6, py);
        }

        /* levels */
        (o.levels || []).forEach(function (l) {
          var ly = y(l.px);
          if (ly < padT || ly > padT + priceH) return;
          ctx.strokeStyle = l.color || '#666'; ctx.setLineDash([2, 3]);
          ctx.beginPath(); ctx.moveTo(padL, ly + .5); ctx.lineTo(W - padR, ly + .5); ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = l.color || '#666'; ctx.fillText(l.label || '', padL + 3, ly - 6);
        });

        /* candles + volume */
        var bw = Math.max(1, Math.min(9, cw * 0.66));
        vis.forEach(function (b, i) {
          var up = b.c >= b.o;
          var dim = b.rth === false;
          ctx.strokeStyle = dim ? (up ? '#2b6c39' : '#6b2b2b') : (up ? '#3fb950' : '#f85149');
          ctx.fillStyle = ctx.strokeStyle;
          var xi = x(i);
          ctx.beginPath(); ctx.moveTo(xi, y(b.h)); ctx.lineTo(xi, y(b.l)); ctx.stroke();
          var yo = y(b.o), yc = y(b.c);
          ctx.fillRect(xi - bw / 2, Math.min(yo, yc), bw, Math.max(1, Math.abs(yc - yo)));
          var vh = maxV ? (b.v / maxV) * volH : 0;
          ctx.globalAlpha = dim ? 0.25 : 0.5;
          ctx.fillRect(xi - bw / 2, H - padB - vh, bw, vh);
          ctx.globalAlpha = 1;
        });

        /* open separator */
        for (var i2 = 1; i2 < vis.length; i2++) {
          if (vis[i2].rth && vis[i2 - 1].rth === false) {
            ctx.strokeStyle = '#39c5cf'; ctx.globalAlpha = .5;
            ctx.beginPath(); ctx.moveTo(x(i2) - cw / 2, padT); ctx.lineTo(x(i2) - cw / 2, H - padB); ctx.stroke();
            ctx.globalAlpha = 1;
          }
        }

        /* overlays: crude EMA9 so the legend is not a lie */
        if ((o.overlays || []).indexOf('ema9') >= 0) {
          ctx.strokeStyle = '#d29922'; ctx.beginPath();
          var k = 2 / 10, ema = vis[0].c;
          vis.forEach(function (b, i) {
            ema = b.c * k + ema * (1 - k);
            if (i === 0) ctx.moveTo(x(i), y(ema)); else ctx.lineTo(x(i), y(ema));
          });
          ctx.stroke();
        }

        /* markers */
        (o.markers || []).forEach(function (mk) {
          var i3 = -1;
          for (var j = 0; j < vis.length; j++) if (vis[j].m === mk.m) { i3 = j; break; }
          if (i3 < 0) return;
          var mx = x(i3), buy = mk.side === 'BUY';
          var my = buy ? y(vis[i3].l) + 9 : y(vis[i3].h) - 9;
          ctx.fillStyle = buy ? '#3fb950' : '#f85149';
          ctx.beginPath();
          if (buy) { ctx.moveTo(mx, my - 6); ctx.lineTo(mx - 5, my + 2); ctx.lineTo(mx + 5, my + 2); }
          else { ctx.moveTo(mx, my + 6); ctx.lineTo(mx - 5, my - 2); ctx.lineTo(mx + 5, my - 2); }
          ctx.closePath(); ctx.fill();
        });

        /* avg price line */
        if (o.position && o.position.shares) {
          var ay = y(o.position.avgPx);
          ctx.strokeStyle = '#39c5cf'; ctx.setLineDash([4, 3]);
          ctx.beginPath(); ctx.moveTo(padL, ay + .5); ctx.lineTo(W - padR, ay + .5); ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = '#39c5cf';
          ctx.fillText('AVG ' + o.position.avgPx.toFixed(2), padL + 3, ay + 8);
        }

        /* time axis */
        ctx.fillStyle = '#8b949e';
        vis.forEach(function (b, i) {
          if (b.m % 30 === 0) ctx.fillText(b.t, x(i) - 12, H - padB + 10);
        });

        /* legend */
        ctx.fillStyle = '#8b949e';
        ctx.fillText('MOCK CHART · vwap/ema9/ema20 (ema9 only) · bars ' + (from + 1) + '–' + (upto + 1),
                     padL + 4, padT + 8);

        /* crosshair */
        if (cross) {
          ctx.strokeStyle = '#39c5cf'; ctx.globalAlpha = .45;
          ctx.beginPath(); ctx.moveTo(cross.x + .5, padT); ctx.lineTo(cross.x + .5, H - padB);
          ctx.moveTo(padL, cross.y + .5); ctx.lineTo(W - padR, cross.y + .5); ctx.stroke();
          ctx.globalAlpha = 1;
          var pxAt = hi - ((cross.y - padT) / priceH) * (hi - lo);
          ctx.fillStyle = '#39c5cf';
          ctx.fillText(pxAt.toFixed(2), Math.min(cross.x + 5, W - padR - 40), Math.max(10, cross.y - 8));
        }
      };

      resize();
      return inst;
    }
  };

  /* ================================================================== */
  /* MOCK DESK                                                          */
  /* ================================================================== */
  var D = {
    GATES: [
      { m: 570, id: 'open',   title: 'Pitch your plan',
        prompt: 'Before the bell: post your plan to your PM in chat.' },
      { m: 720, id: 'midday', title: 'Midday risk check',
        prompt: 'Marcus wants your book, your P&L, and what you\'re doing about it.' },
      { m: 961, id: 'close',  title: 'P&L review',
        prompt: 'Paste your tearsheet into chat. Dana will go trade by trade.' }
    ],
    _feed: [], _day: null, _cb: null, _fired: {}, _lastFireM: -1, _queue: []
  };

  D.init = function (o) {
    D._day = o.day; D._cb = o.onMessage;
    D._feed = []; D._fired = {}; D._lastFireM = -1; D._queue = [];
    D.push({ m: 565, t: '09:25', from: 'PM', name: 'Dana Whitfield', tone: 'neutral',
      text: 'Morning. ' + (o.day.brief && o.day.brief.pmAsk ? o.day.brief.pmAsk : 'Let\'s go.') });
    D.push({ m: 566, t: '09:26', from: 'DESK', name: 'Priya (equities desk)', tone: 'neutral',
      text: 'Coffee\'s burnt again. ' + o.day.ticker + ' looks busy pre-market — good luck.' });
  };

  D.push = function (msg) {
    D._feed.push(msg);
    if (D._cb) D._cb(msg);
  };

  D.getFeed = function () { return D._feed.slice(); };

  D.tick = function (st) {
    var m = st.m;
    /* scheduled */
    (D._day.events || []).forEach(function (ev, i) {
      var key = 'ev' + i;
      if (!D._fired[key] && m >= ev.m) {
        D._fired[key] = true;
        D._queue.push({ m: ev.m, t: hhmm(ev.m), from: ev.from, name: ev.name,
                        text: ev.text, tone: ev.tone || 'neutral' });
      }
    });

    /* reactive (subset — enough to exercise the UI) */
    var linePct = st.buyingPower ? (st.exposure / st.buyingPower) * 100 : 0;
    if (linePct > 80) react('bigline', m, 'RISK', 'Marcus Reed', 'warn',
      'You are at ' + linePct.toFixed(0) + '% of your line. Tell me the plan.');
    if (st.dayPnl <= -900) react('warn900', m, 'RISK', 'Marcus Reed', 'warn',
      'Down ' + st.dayPnl.toFixed(0) + '. Two hundred more and I take the book off you.');
    if (st.dayPnl <= -1500) react('hard1500', m, 'RISK', 'Marcus Reed', 'alarm',
      'You are done. I am flattening you.');
    if (st.stats.nTrades >= 4 && m < 630) react('overtrade', m, 'DESK', 'Priya (equities desk)', 'neutral',
      'Four round trips and it is not 10:30. Are you trading or fidgeting?');
    var lastT = st.trades[st.trades.length - 1];
    if (lastT && lastT.pnl > 0) react('firstwin', m, 'DESK', 'Priya (equities desk)', 'praise',
      'There you go. Clean one.');
    if (lastT && lastT.pnl > 400) react('bigwin', m, 'DESK', 'Priya (equities desk)', 'praise',
      'Nice. What was the read?');
    if (m >= 945 && st.position.shares !== 0) react('lateheld', m, 'RISK', 'Marcus Reed', 'warn',
      'Twelve minutes. Do not make me do it.');

    /* at most one reactive per bar; queue the rest */
    if (D._queue.length && D._lastFireM !== m) {
      D._lastFireM = m;
      D.push(D._queue.shift());
    }
  };

  function react(key, m, from, name, tone, text) {
    if (D._fired[key]) return;
    D._fired[key] = true;
    D._queue.push({ m: m, t: hhmm(m), from: from, name: name, tone: tone, text: text });
  }

  window.Desk = D;

  console.log('[ui_mocks] loaded: SIM_DAYS(' + window.SIM_DAYS.length + '), Engine, Chart, Desk');
})();
