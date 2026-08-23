#!/usr/bin/env node
/* =============================================================================
 * tools/test_desk.js  —  run with:  node tools/test_desk.js
 *
 * No dependencies. Loads sim/desk.js exactly as a browser would (it assigns to
 * `window.Desk`; we just point `window` at the node global), then walks two
 * synthetic traders through two scripted sessions.
 *
 * SESSION A — the bad day. Every trigger the spec's table describes for a
 * deteriorating trader:
 *   09:36-10:12  four quick round trips, three of them losers  -> overtrading,
 *                                                                 first_win,
 *                                                                 three_losers
 *   10:16        500 shares straight after a 200-share loser   -> revenge,
 *                                                                 exposure_line
 *   10:30-10:40  it goes against him, day P&L through -900     -> loss_warn
 *   10:40-11:42  an hour of doing nothing                      -> flat60
 *   11:42-12:15  a trade whose own thesis names 178.40; the
 *                level breaks and he holds; +$435 unrealised
 *                closes at +$108                               -> thesis_level_break,
 *                                                                 giveback
 *   12:25/12:40  two entries in the lunch dead zone, one a
 *                100-share clip next to a 500-share one        -> dead_zone,
 *                                                                 sizing_inconsistent
 *   12:40-13:55  held offside 45+ minutes, then the daily
 *                loss limit trips                              -> underwater45,
 *                                                                 loss_hard
 *
 * SESSION B — the other failure mode, and the only way to prove the four
 * triggers session A must NOT fire actually work:
 *   sits out the entire opening drive       -> sitting_out_open
 *   one +$657 trade                         -> bigwin
 *   hands the whole day back by noon        -> day_giveback
 *   still holding at 15:45                  -> hold_1545
 *
 * Asserts in both: the right triggers fire, none fires twice, at most one
 * reactive message per bar, gates and scheduled events all land, message shape
 * is valid, feeds are time-ordered, and two identical runs are byte-identical.
 * Then prints both feeds so the writing can be read.
 * ========================================================================== */

'use strict';

var path = require('path');

// --- load sim/desk.js the way a <script src> would ---------------------------
global.window = global;
require(path.join(__dirname, '..', 'sim', 'desk.js'));
var Desk = global.window.Desk;

/* ------------------------------------------------------------------ fixtures */

var RULES = {
  startEquity: 25000, leverage: 4,
  maxDailyLoss: -1500, warnDailyLoss: -900,
  noNewAfterM: 955, forceFlatM: 958,
  commissionPerShare: 0.005, minCommission: 1.00
};
var FakeEngine = { RULES: RULES };

function hhmm(m) {
  function p(n) { return (n < 10 ? '0' : '') + n; }
  return p(Math.floor(m / 60)) + ':' + p(m % 60);
}

// The session currently being replayed (price path + volume path).
var CUR = null;

// Price path: linear interpolation between waypoints. Chosen so the scripted
// trades produce exactly the P&L shapes the triggers are meant to detect.
function priceAt(m) {
  var wp = CUR.wp, i;
  if (m <= wp[0][0]) return wp[0][1];
  for (i = 1; i < wp.length; i++) {
    if (m <= wp[i][0]) {
      var a = wp[i - 1], b = wp[i];
      var f = (m - a[0]) / (b[0] - a[0]);
      return Math.round((a[1] + f * (b[1] - a[1])) * 100) / 100;
    }
  }
  return wp[wp.length - 1][1];
}

function volAt(m) { return CUR.vol(m); }

/* -------------------------------------------------- a minimal synthetic book */

function Book() {
  this.shares = 0; this.avgPx = 0; this.openComm = 0; this.openM = 0;
  this.openPx = 0; this.thesis = '';
  this.realized = 0; this.commissions = 0;
  this.blotter = []; this.trades = []; this.locked = false;
  this.stats = { nTrades: 0, wins: 0, losses: 0, biggestWin: 0, biggestLoss: 0,
                 maxDrawdown: 0, peakDayPnl: 0 };
  this.fillId = 0;
}

Book.prototype.comm = function (q) { return Math.max(1.00, 0.005 * Math.abs(q)); };

Book.prototype.open = function (m, qty, dir, thesis) {
  var px = priceAt(m), c = this.comm(qty);
  this.shares = qty * dir; this.avgPx = px; this.openComm = c;
  this.openM = m; this.openPx = px; this.thesis = thesis;
  this.realized -= c; this.commissions += c;
  this.blotter.push({
    id: ++this.fillId, m: m, t: hhmm(m), side: dir > 0 ? 'BUY' : 'SELL',
    qty: qty, px: px, notional: qty * px, commission: c,
    thesis: thesis, reason: 'MANUAL'
  });
};

Book.prototype.close = function (m, reason) {
  if (!this.shares) return;
  var px = priceAt(m), q = Math.abs(this.shares), c = this.comm(q);
  var gross = (px - this.avgPx) * this.shares;
  var pnl = gross - this.openComm - c;
  this.realized += gross - c; this.commissions += c;
  this.blotter.push({
    id: ++this.fillId, m: m, t: hhmm(m), side: this.shares > 0 ? 'SELL' : 'BUY',
    qty: q, px: px, notional: q * px, commission: c, thesis: '', reason: reason || 'MANUAL'
  });
  this.trades.push({
    openM: this.openM, closeM: m, side: this.shares > 0 ? 'LONG' : 'SHORT',
    qty: q, entryPx: this.openPx, exitPx: px, pnl: Math.round(pnl * 100) / 100,
    holdMins: m - this.openM, thesis: this.thesis, exitReason: reason || 'MANUAL'
  });
  this.stats.nTrades++;
  if (pnl > 0) { this.stats.wins++; if (pnl > this.stats.biggestWin) this.stats.biggestWin = pnl; }
  else { this.stats.losses++; if (pnl < this.stats.biggestLoss) this.stats.biggestLoss = pnl; }
  this.shares = 0; this.avgPx = 0; this.openComm = 0; this.thesis = '';
};

Book.prototype.state = function (m, idx) {
  var px = priceAt(m);
  var unreal = this.shares ? (px - this.avgPx) * this.shares : 0;
  var dayPnl = this.realized + unreal;
  if (dayPnl > this.stats.peakDayPnl) this.stats.peakDayPnl = dayPnl;
  var dd = dayPnl - this.stats.peakDayPnl;
  if (dd < this.stats.maxDrawdown) this.stats.maxDrawdown = dd;
  var equity = 25000 + dayPnl;
  return {
    m: m, idx: idx, running: true, locked: this.locked,
    bar: { m: m, t: hhmm(m), o: px, h: px + 0.05, l: px - 0.05, c: px, v: volAt(m), rth: true },
    position: { shares: this.shares, avgPx: this.avgPx },
    realized: Math.round(this.realized * 100) / 100,
    unrealized: Math.round(unreal * 100) / 100,
    dayPnl: Math.round(dayPnl * 100) / 100,
    commissions: Math.round(this.commissions * 100) / 100,
    equity: equity, buyingPower: equity * RULES.leverage,
    exposure: Math.abs(this.shares) * px,
    blotter: this.blotter, trades: this.trades, stats: this.stats
  };
};

/* ------------------------------------------------------------- the replayer */

function runSession(sess) {
  CUR = sess;
  var feed = [];
  Desk.init({ day: sess.day, engine: FakeEngine, onMessage: function (msg) { feed.push(msg); } });

  var book = new Book();
  var si = 0, idx = 0, m;

  for (m = 570; m <= 961; m++, idx++) {
    while (si < sess.script.length && sess.script[si].m === m) {
      var a = sess.script[si++];
      if (book.locked) continue;
      if (a.act === 'open') book.open(m, a.qty, a.dir, a.thesis);
      else book.close(m, 'MANUAL');
    }

    // Engine-equivalent risk enforcement: flatten and lock at the hard limit,
    // force-flat at 15:58.
    if (!book.locked) {
      var probe = book.state(m, idx);
      if (probe.dayPnl <= RULES.maxDailyLoss) {
        book.close(m, 'RISK_FLAT');
        book.locked = true;
      } else if (m >= RULES.forceFlatM && book.shares !== 0) {
        book.close(m, 'EOD_FLAT');
      }
    }

    Desk.tick(book.state(m, idx));
  }
  return { feed: feed, book: book, deskFeed: Desk.getFeed(), pending: Desk.pending() };
}

/* ============================================================ SESSION A DATA */

var LEVEL_THESIS =
  'long above 178.40 vwap reclaim, stop under 178.20, target 179.60 into the gap fill';

var SESSION_A = {
  wp: [
    [570, 181.00], [576, 181.00], [584, 181.62], [588, 181.60], [594, 180.80],
    [596, 180.85], [602, 180.15], [606, 180.20], [612, 179.30], [616, 179.40],
    [630, 178.20], [640, 178.16], [660, 178.40], [702, 178.45], [710, 178.25],
    [714, 178.18], [725, 179.90], [735, 178.82], [745, 178.80], [752, 178.20],
    [760, 178.25], [766, 178.05], [800, 177.95], [812, 177.88], [835, 176.85],
    [900, 176.60], [961, 176.40]
  ],
  vol: function (m) {
    if (m === 655) return 1480000;             // participation spike -> WIRE
    if (m < 600) return 320000 - (m - 570) * 2000;
    return 150000 + ((m * 37) % 60000);        // deterministic wobble, no RNG
  },
  day: {
    id: 'day1', ticker: 'ORVX', company: 'Orvex Dynamics',
    sector: 'Enterprise software / defense analytics',
    sessionNo: 1, prevClose: 178.40, openM: 570, closeM: 960, bars: [],
    premkt: { high: 182.10, low: 176.90, last: 181.55, volume: 1840000, gapPct: 1.77 },
    brief: {
      headline: 'Orvex beats on billings, guides Q3 revenue below street',
      bullCase: 'Backlog +38% y/y, defense analytics renewal cycle intact.',
      bearCase: 'Guide implies decelerating seats; gap-ups into guidance cuts fade.',
      levels: [{ label: 'Prev close', px: 178.40 }, { label: 'Pre-mkt high', px: 182.10 }],
      pmAsk: 'One idea, sized properly, with a level that invalidates it.'
    },
    // Pre-authored feed — this is what data/days.js supplies.
    events: [
      { m: 572, from: 'WIRE', tone: 'neutral',
        text: '*ORVX OPENS AT 181.02, +1.47% VS PRIOR CLOSE 178.40' },
      { m: 585, from: 'DESK', tone: 'neutral',
        text: 'morning. gap is fading already — sellers into every 181 print. just so you know what i am seeing.' },
      { m: 618, from: 'WIRE', tone: 'neutral',
        text: '*ORVX: MORGAN KEEGAN CUTS PT TO 172 FROM 195, KEEPS HOLD' },
      { m: 690, from: 'PM', tone: 'neutral',
        text: 'Checking in. I do not need a number from you — I need the one line of reasoning you are trading off right now.' },
      { m: 830, from: 'WIRE', tone: 'neutral',
        text: '*ORVX TRADES AT SESSION LOW; DOWN 1.3% ON THE DAY' },
      { m: 900, from: 'DESK', tone: 'neutral',
        text: 'someone brought in the good coffee, it is by the printer. also last hour, mind your size.' }
    ]
  },
  script: [
    { m: 576, act: 'open',  qty: 200, dir: 1, thesis: 'opening drive, buyers holding 181 on every pullback, out under 180.70' },
    { m: 584, act: 'close' },                                   // +$122 -> first_win
    { m: 588, act: 'open',  qty: 200, dir: 1, thesis: 'second push through 181.60, expecting continuation into 182' },
    { m: 594, act: 'close' },                                   // -$162
    { m: 596, act: 'open',  qty: 200, dir: 1, thesis: 'bounce off the round number, buyers should defend it here' },
    { m: 602, act: 'close' },                                   // -$142
    { m: 606, act: 'open',  qty: 200, dir: 1, thesis: 'reclaim attempt over the hourly high, quick scalp' },
    { m: 612, act: 'close' },                                   // -$182 -> three_losers, overtrading
    { m: 616, act: 'open',  qty: 500, dir: 1, thesis: 'this has to bounce, sized up to make the morning back on one move' },
    { m: 640, act: 'close' },                                   // -$625 -> revenge, exposure_line, loss_warn
    { m: 702, act: 'open',  qty: 300, dir: 1, thesis: LEVEL_THESIS },
    { m: 735, act: 'close' },                                   // peak +$435, booked +$108 -> giveback, thesis_level_break
    { m: 745, act: 'open',  qty: 100, dir: 1, thesis: 'small starter long, lunchtime drift higher off the low' },
    { m: 752, act: 'close' },                                   // -$62 -> sizing_inconsistent, dead_zone
    { m: 760, act: 'open',  qty: 400, dir: 1, thesis: 'afternoon reversal setup, adding the size back, support has to hold' }
    // no close: it sits offside until the daily loss limit trips it out
  ]
};

/* ============================================================ SESSION B DATA */

var SESSION_B = {
  wp: [
    [570, 100.00], [605, 100.00], [640, 102.20], [660, 102.00], [720, 100.50],
    [900, 100.60], [945, 100.40], [961, 100.30]
  ],
  vol: function (m) { return 200000 + ((m * 23) % 40000); },   // no spike, no WIRE
  day: {
    id: 'day2', ticker: 'VLTA', company: 'Voltara Grid', sector: 'Utilities / grid storage',
    sessionNo: 2, prevClose: 99.10, openM: 570, closeM: 960, bars: [],
    premkt: { high: 100.40, low: 98.80, last: 100.05, volume: 620000, gapPct: 0.96 },
    brief: { headline: '', bullCase: '', bearCase: '', levels: [], pmAsk: '' },
    events: [
      { m: 573, from: 'WIRE', tone: 'neutral',
        text: '*VLTA OPENS AT 100.00; GRID STORAGE PEERS BID PRE-MARKET' }
    ]
  },
  script: [
    { m: 605, act: 'open',  qty: 300, dir: 1, thesis: 'opening range broke clean, buyers in size, out under 99.60' },
    { m: 640, act: 'close' },                                   // +$657 -> bigwin, first_win
    { m: 660, act: 'open',  qty: 300, dir: 1, thesis: 'buying the pullback, trend day until proven otherwise' },
    { m: 720, act: 'close' },                                   // -$453 -> day_giveback
    { m: 900, act: 'open',  qty: 200, dir: 1, thesis: 'late-day drift into the bell, small size, happy to hold it' }
    // no close: still on at 15:45 -> hold_1545, then EOD force-flat
  ]
};

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

function checkCommon(tag, sess, run) {
  var feed = run.feed;
  var counts = triggerCounts(feed);

  ok(run.deskFeed.length === feed.length, tag + ': getFeed() matches the onMessage stream',
     run.deskFeed.length + ' vs ' + feed.length);

  // nothing fires twice
  Object.keys(counts).forEach(function (id) {
    ok(counts[id] === 1, tag + ': no trigger fires twice: ' + id, 'count=' + counts[id]);
  });

  // at most one reactive message per bar
  var perBar = {};
  feed.forEach(function (x) { if (x.kind === 'reactive') perBar[x.m] = (perBar[x.m] || 0) + 1; });
  Object.keys(perBar).forEach(function (bm) {
    ok(perBar[bm] <= 1, tag + ': at most one reactive message on bar ' + bm, 'got ' + perBar[bm]);
  });

  ok(run.pending === 0, tag + ': reactive queue fully drained by the close', 'pending=' + run.pending);

  // scheduled events: all fired, once, never early
  var sched = feed.filter(function (x) { return x.kind === 'scheduled'; });
  ok(sched.length === sess.day.events.length, tag + ': all scheduled events fired',
     sched.length + '/' + sess.day.events.length);
  sess.day.events.forEach(function (e) {
    var hits = sched.filter(function (x) { return x.text === e.text; });
    ok(hits.length === 1, tag + ': scheduled event fired once: m=' + e.m, 'count=' + hits.length);
    if (hits.length) ok(hits[0].m >= e.m, tag + ': scheduled event not early: m=' + e.m);
  });

  // gates
  var gates = feed.filter(function (x) { return x.kind === 'gate'; });
  ok(gates.length === 3, tag + ': all three gates fired', 'got ' + gates.length);
  Desk.GATES.forEach(function (g) {
    var hits = gates.filter(function (x) { return x.gate === g.id; });
    ok(hits.length === 1, tag + ': gate fired once: ' + g.id, 'count=' + hits.length);
    if (hits.length) ok(hits[0].text === g.prompt, tag + ': gate text is the spec prompt verbatim: ' + g.id);
    if (hits.length) ok(hits[0].m >= g.m, tag + ': gate not early: ' + g.id);
  });

  // message shape
  var VOICES = { PM: 1, RISK: 1, DESK: 1, WIRE: 1 };
  var TONES = { neutral: 1, pressure: 1, warn: 1, praise: 1, alarm: 1 };
  feed.forEach(function (x, i) {
    ok(typeof x.m === 'number' && typeof x.t === 'string', tag + ': msg[' + i + '] has m/t');
    ok(!!VOICES[x.from], tag + ': msg[' + i + '] valid from: ' + x.from);
    ok(typeof x.name === 'string' && x.name.length > 0, tag + ': msg[' + i + '] has name');
    ok(typeof x.text === 'string' && x.text.length > 0, tag + ': msg[' + i + '] has text');
    ok(!!TONES[x.tone], tag + ': msg[' + i + '] valid tone: ' + x.tone);
    ok(x.text.indexOf('{') < 0, tag + ': msg[' + i + '] has no unfilled placeholder', x.text);
  });

  // ordering
  for (var oi = 1; oi < feed.length; oi++) {
    ok(feed[oi].m >= feed[oi - 1].m, tag + ': feed is time-ordered at index ' + oi);
  }
  return counts;
}

// ---- SESSION A --------------------------------------------------------------
var runA = runSession(SESSION_A);
var countsA = checkCommon('A', SESSION_A, runA);

[
  'overtrading', 'first_win', 'three_losers', 'revenge', 'exposure_line',
  'loss_warn', 'flat60', 'thesis_level_break', 'giveback', 'dead_zone',
  'sizing_inconsistent', 'underwater45', 'loss_hard', 'wire_vol'
].forEach(function (id) {
  ok(countsA[id] === 1, 'A: trigger fired exactly once: ' + id, 'count=' + (countsA[id] || 0));
});
['bigwin', 'hold_1545', 'sitting_out_open', 'day_giveback'].forEach(function (id) {
  ok(!countsA[id], 'A: trigger correctly did NOT fire: ' + id);
});
ok(runA.book.locked === true, 'A: synthetic book hit the hard risk stop');
ok(runA.book.shares === 0, 'A: risk flattened the position');
// the hard stop must be the alarm-toned message and must reach the feed the bar it trips
var hard = runA.feed.filter(function (x) { return x.trigger === 'loss_hard'; })[0];
ok(hard && hard.tone === 'alarm' && hard.from === 'RISK', 'A: hard stop is an alarm from RISK');

// ---- SESSION B --------------------------------------------------------------
var runB = runSession(SESSION_B);
var countsB = checkCommon('B', SESSION_B, runB);

['sitting_out_open', 'bigwin', 'day_giveback', 'hold_1545', 'first_win'].forEach(function (id) {
  ok(countsB[id] === 1, 'B: trigger fired exactly once: ' + id, 'count=' + (countsB[id] || 0));
});
['loss_hard', 'loss_warn', 'overtrading', 'revenge'].forEach(function (id) {
  ok(!countsB[id], 'B: trigger correctly did NOT fire: ' + id);
});
var late = runB.feed.filter(function (x) { return x.trigger === 'hold_1545'; })[0];
ok(late && late.m >= 945 && late.m <= 957, 'B: 15:45 warning lands inside its window',
   late ? 'm=' + late.m : 'missing');

// ---- determinism ------------------------------------------------------------
var runA2 = runSession(SESSION_A);
ok(JSON.stringify(runA2.feed) === JSON.stringify(runA.feed),
   'two identical sessions produce byte-identical feeds');

var ALT = JSON.parse(JSON.stringify(SESSION_A));
ALT.vol = SESSION_A.vol; ALT.day.id = 'day3'; ALT.day.ticker = 'KRDN';
var runAlt = runSession(ALT);
function reactiveText(run) {
  return run.feed.filter(function (x) { return x.kind === 'reactive'; })
                 .map(function (x) { return x.text; }).join('|');
}
ok(reactiveText(runAlt) !== reactiveText(runA), 'a different day draws different phrasings');
ok(triggerCounts(runAlt.feed).loss_hard === 1, 'the same trades still fire the same triggers on another day');

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

function printFeed(title, sess, run) {
  console.log('');
  console.log('================================================================================');
  console.log(' ' + title);
  console.log('================================================================================');
  run.feed.forEach(function (x) {
    if (x.kind === 'gate') { console.log(''); console.log('  ### GATE — ' + x.title); }
    var head = '  ' + padR('[' + x.t + ']', 8) + padR(x.from, 6) +
               padR(x.from === 'WIRE' ? '' : x.name, 22) + '| ';
    console.log(head + wrap(x.text, 92, '                                              '));
  });
  console.log('');
  console.log(' triggers fired, in order:');
  run.feed.forEach(function (x) {
    if (x.kind === 'reactive') console.log('   ' + padR(x.t, 8) + padR(x.from, 6) + x.trigger);
  });
  console.log('');
  console.log(' day P&L ' + run.book.realized.toFixed(2) +
              '   trades ' + run.book.stats.nTrades +
              '   W/L ' + run.book.stats.wins + '/' + run.book.stats.losses +
              '   locked ' + run.book.locked);
}

printFeed('SESSION A — ' + SESSION_A.day.ticker + ' — overtrade, revenge, giveback, hard stop',
          SESSION_A, runA);
printFeed('SESSION B — ' + SESSION_B.day.ticker + ' — sat out the open, one big winner, gave the day back, held into the bell',
          SESSION_B, runB);

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
