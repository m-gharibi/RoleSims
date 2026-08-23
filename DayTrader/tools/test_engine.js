#!/usr/bin/env node
/* ==========================================================================
 * tools/test_engine.js — self-contained unit tests for sim/engine.js
 *
 *   node tools/test_engine.js
 *
 * Zero dependencies. Loads the engine exactly the way a <script> tag would:
 * we hand it a `window` and it attaches itself to it.
 * ========================================================================== */
"use strict";

var path = require("path");
var ENGINE_PATH = path.join(__dirname, "..", "sim", "engine.js");

/* -------- the tiny shim: engine.js is browser code, give it a window ----- */
global.window = global;
require(ENGINE_PATH);
var Engine = global.window.Engine;

/* ---------------------------------------------------------------- utils - */

var PASS = 0, FAIL = 0, FAILURES = [];
var CURRENT = "(none)";

function test(name, fn) {
  CURRENT = name;
  try {
    fn();
    console.log("  PASS  " + name);
    PASS++;
  } catch (e) {
    console.log("  FAIL  " + name);
    console.log("        " + (e && e.message ? e.message : String(e)));
    FAIL++;
    FAILURES.push(name + " :: " + (e && e.message ? e.message : String(e)));
  }
}

function ok(cond, msg) {
  if (!cond) throw new Error(msg || "expected truthy");
}
function eq(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error((msg || "value mismatch") +
      "\n          expected: " + JSON.stringify(expected) +
      "\n          actual:   " + JSON.stringify(actual));
  }
}
function near(actual, expected, tol, msg) {
  tol = tol == null ? 1e-9 : tol;
  if (!(Math.abs(actual - expected) <= tol)) {
    throw new Error((msg || "value mismatch") +
      "\n          expected: " + expected + " (+/- " + tol + ")" +
      "\n          actual:   " + actual);
  }
}

function roundTo(x, d) { var p = Math.pow(10, d); return Math.round(Number((x * p).toFixed(6))) / p; }
function round2(x) { return roundTo(x, 2); }
function round4(x) { return roundTo(x, 4); }
function pad2(n) { return (n < 10 ? "0" : "") + n; }
function mToT(m) { return pad2(Math.floor(m / 60)) + ":" + pad2(m % 60); }

/* Independent re-implementation of the SPEC fill model, for cross-checking. */
function specFill(base, bar, qty, dir, mult) {
  var halfSpread = Math.max(0.01, base * 0.00015);
  var sizeImpact = base * 0.00012 * Math.min(4, qty / Math.max(1, bar.v * 0.015));
  var raw = base + dir * (mult || 1) * (halfSpread + sizeImpact);
  return round4(Math.min(bar.h, Math.max(bar.l, raw)));
}
function commissionFor(qty) { return round2(Math.max(1.00, 0.005 * qty)); }

/* ------------------------------------------------- synthetic Day builder - */

var DEFAULT_BAR = { o: 100.00, h: 100.50, l: 99.50, c: 100.00, v: 100000 };

/**
 * Builds a Day matching the SPEC §1 schema: 2 sparse pre-market bars, then a
 * contiguous RTH tape m=570..959 (390 bars). `overrides` is { m: {o,h,l,c,v} }.
 */
function makeDay(overrides) {
  var bars = [
    { m: 540, t: "09:00", o: 99.80, h: 100.20, l: 99.60, c: 100.00, v: 50000, rth: false },
    { m: 555, t: "09:15", o: 100.00, h: 100.20, l: 99.80, c: 100.00, v: 60000, rth: false }
  ];
  for (var m = 570; m <= 959; m++) {
    var b = {
      m: m, t: mToT(m),
      o: DEFAULT_BAR.o, h: DEFAULT_BAR.h, l: DEFAULT_BAR.l, c: DEFAULT_BAR.c,
      v: DEFAULT_BAR.v, rth: true
    };
    if (overrides && overrides[m]) {
      var ov = overrides[m];
      for (var k in ov) if (Object.prototype.hasOwnProperty.call(ov, k)) b[k] = ov[k];
    }
    bars.push(b);
  }
  return {
    id: "dayT", ticker: "TSTX", company: "Testex Corp", sector: "Testing",
    sessionNo: 1, prevClose: 100.00, openM: 570, closeM: 960,
    bars: bars,
    premkt: { high: 100.20, low: 99.60, last: 100.00, volume: 110000, gapPct: 0 },
    brief: {
      headline: "Nothing happened overnight.",
      bullCase: "It goes up.", bearCase: "It goes down.",
      levels: [{ label: "Prev close", px: 100.00 }],
      pmAsk: "Trade it."
    },
    events: []
  };
}

/** bar object as the engine sees it, for cross-checking fill maths */
function barAt(day, m) {
  for (var i = 0; i < day.bars.length; i++) if (day.bars[i].m === m) return day.bars[i];
  throw new Error("no bar at m=" + m);
}

function boot(day, account) {
  Engine.destroy();
  Engine.init({ day: day, account: account || null });
  return Engine;
}

var THESIS = "Buying the opening drive, stop under the low.";

/* ======================================================================== */
console.log("");
console.log("Day Trader Sim — engine unit tests");
console.log("engine: " + ENGINE_PATH);
console.log("");

/* -- 0. sanity on the constants and the fill formula itself --------------- */

test("RULES constants match the spec", function () {
  var R = Engine.RULES;
  eq(R.startEquity, 25000, "startEquity");
  eq(R.leverage, 4, "leverage");
  eq(R.maxDailyLoss, -1500, "maxDailyLoss");
  eq(R.warnDailyLoss, -900, "warnDailyLoss");
  eq(R.noNewAfterM, 955, "noNewAfterM");
  eq(R.forceFlatM, 958, "forceFlatM");
  eq(R.commissionPerShare, 0.005, "commissionPerShare");
  eq(R.minCommission, 1.00, "minCommission");
});

test("fill model matches the spec formula to the 4th decimal", function () {
  var day = makeDay();
  boot(day);
  // hand-computed: half_spread = max(0.01, 100*0.00015) = 0.015
  //                size_impact = 100*0.00012*min(4, 100/1500) = 0.0008
  //                fill        = 100 + 0.0158 = 100.0158
  var b = barAt(day, 571);
  eq(specFill(100, b, 100, 1, 1), 100.0158, "spec helper self-check");

  var r = Engine.submit({ side: "BUY", qty: 100, type: "MKT", thesis: THESIS });
  ok(r.ok, "submit should be accepted: " + r.error);
  Engine.step();                                   // fills on bar m=571
  var st = Engine.getState();
  eq(st.blotter.length, 1, "one fill");
  eq(st.blotter[0].px, 100.0158, "market buy fill price");
  eq(st.blotter[0].m, 571, "fills on the NEXT bar, not the submit bar");
  eq(st.blotter[0].reason, "MANUAL", "reason");
  eq(st.blotter[0].commission, 1.00, "min commission floor applies to 100 shares");
});

/* -- 1. long round trip -------------------------------------------------- */

test("(1) long round trip books exactly the right P&L net of commissions", function () {
  var day = makeDay({
    576: { o: 101.20, h: 101.60, l: 100.90, c: 101.30, v: 200000 }
  });
  boot(day);

  var r = Engine.submit({ side: "BUY", qty: 300, type: "MKT", thesis: THESIS });
  ok(r.ok, "buy accepted: " + r.error);
  Engine.step();                                   // fills at m=571
  var entry = specFill(barAt(day, 571).o, barAt(day, 571), 300, +1, 1);
  var st = Engine.getState();
  eq(st.position.shares, 300, "long 300");
  eq(st.position.avgPx, entry, "avg price is the fill price");
  eq(st.commissions, 1.50, "300 shares * 0.005 = 1.50");

  // hold to m=575, then sell into the pop on m=576
  while (Engine.getState().m < 575) Engine.step();
  var r2 = Engine.submit({ side: "SELL", qty: 300, type: "MKT" });
  ok(r2.ok, "closing order needs no thesis: " + r2.error);
  Engine.step();                                   // fills at m=576
  var exitBar = barAt(day, 576);
  var exit = specFill(exitBar.o, exitBar, 300, -1, 1);

  var gross = (exit - entry) * 300;
  var comms = commissionFor(300) * 2;              // 1.50 + 1.50
  var expected = round2(gross - comms);

  st = Engine.getState();
  eq(st.position.shares, 0, "flat");
  eq(st.position.avgPx, 0, "avg price resets on flat");
  eq(st.unrealized, 0, "no unrealized when flat");
  eq(st.commissions, 3.00, "commissions both sides");
  eq(st.realized, expected, "realized P&L exact to the cent");
  eq(st.dayPnl, expected, "dayPnl == realized when flat");
  eq(st.equity, round2(25000 + expected), "equity");
  eq(st.buyingPower, round2(round2(25000 + expected) * 4), "buying power = equity * 4");

  eq(st.trades.length, 1, "one round trip");
  var tr = st.trades[0];
  eq(tr.side, "LONG", "trade side");
  eq(tr.qty, 300, "trade qty");
  eq(tr.entryPx, entry, "trade entry");
  eq(tr.exitPx, exit, "trade exit");
  eq(tr.openM, 571, "openM");
  eq(tr.closeM, 576, "closeM");
  eq(tr.holdMins, 5, "hold time in minutes");
  eq(tr.thesis, THESIS, "thesis stored as typed");
  eq(tr.exitReason, "MANUAL", "exit reason");
  eq(tr.pnl, round2(gross - comms), "trade P&L net of both commissions");
  ok(expected > 0, "this one should be a winner (sanity)");
  eq(st.stats.wins, 1, "one win");
  eq(st.stats.losses, 0, "no losses");
  eq(st.stats.biggestWin, tr.pnl, "biggest win");
});

/* -- 2. short round trip ------------------------------------------------- */

test("(2) short round trip books exactly the right P&L net of commissions", function () {
  var day = makeDay({
    574: { o: 98.40, h: 98.70, l: 98.10, c: 98.30, v: 150000 }
  });
  boot(day);

  var r = Engine.submit({ side: "SELL", qty: 200, type: "MKT", thesis: "Fading the failed breakout at the highs." });
  ok(r.ok, "short from flat accepted: " + r.error);
  Engine.step();                                   // fills at m=571
  var eBar = barAt(day, 571);
  var entry = specFill(eBar.o, eBar, 200, -1, 1);

  var st = Engine.getState();
  eq(st.position.shares, -200, "short 200 (negative shares)");
  eq(st.position.avgPx, entry, "avg price");
  eq(st.exposure, round2(200 * barAt(day, 571).c), "exposure is abs(shares)*price");

  while (Engine.getState().m < 573) Engine.step();
  // mark-to-market check while still open, at m=573 (c = 100.00)
  st = Engine.getState();
  eq(st.unrealized, round2(-200 * (100.00 - entry)), "unrealized for a short");

  var r2 = Engine.submit({ side: "BUY", qty: 200, type: "MKT" });
  ok(r2.ok, "cover accepted: " + r2.error);
  Engine.step();                                   // fills at m=574
  var xBar = barAt(day, 574);
  var exit = specFill(xBar.o, xBar, 200, +1, 1);

  var gross = (entry - exit) * 200;                // short: sell high, buy low
  var comms = commissionFor(200) * 2;              // 1.00 + 1.00
  var expected = round2(gross - comms);

  st = Engine.getState();
  eq(st.position.shares, 0, "flat");
  eq(st.position.avgPx, 0, "avg resets on flat");
  eq(st.realized, expected, "realized P&L exact to the cent");
  eq(st.dayPnl, expected, "dayPnl");
  eq(st.commissions, 2.00, "commissions both sides");
  eq(st.trades.length, 1, "one round trip");
  eq(st.trades[0].side, "SHORT", "trade side");
  eq(st.trades[0].pnl, expected, "trade P&L");
  ok(expected > 0, "short into a drop should win (sanity)");
});

/* -- 2b. adds and partial closes ----------------------------------------- */

test("(2b) adding blends avgPx; a partial close leaves it alone", function () {
  var day = makeDay({
    573: { o: 102.00, h: 102.40, l: 101.80, c: 102.00, v: 120000 },
    575: { o: 103.00, h: 103.40, l: 102.60, c: 103.00, v: 120000 }
  });
  boot(day);

  Engine.submit({ side: "BUY", qty: 100, type: "MKT", thesis: THESIS });
  Engine.step();                                                   // m=571
  var f1 = specFill(barAt(day, 571).o, barAt(day, 571), 100, 1, 1);

  Engine.submit({ side: "BUY", qty: 200, type: "MKT", thesis: "Adding on the reclaim of VWAP." });
  Engine.step();                                                   // m=572
  var f2 = specFill(barAt(day, 572).o, barAt(day, 572), 200, 1, 1);

  var blended = round4((f1 * 100 + f2 * 200) / 300);
  var st = Engine.getState();
  eq(st.position.shares, 300, "long 300 after the add");
  near(st.position.avgPx, blended, 0.00005, "blended average price");

  // partial close of 100 on m=573
  Engine.submit({ side: "SELL", qty: 100, type: "MKT" });
  Engine.step();                                                   // m=573
  var x1 = specFill(barAt(day, 573).o, barAt(day, 573), 100, -1, 1);

  st = Engine.getState();
  eq(st.position.shares, 200, "200 left");
  near(st.position.avgPx, blended, 0.00005, "avgPx must NOT move on a partial close");
  eq(st.trades.length, 1, "one closed trade");
  eq(st.trades[0].qty, 100, "partial trade qty");

  // exact realized: gross on 100 shares, minus every commission paid so far
  var grossRealized = (x1 - st.position.avgPx) * 100;
  var totalComms = commissionFor(100) + commissionFor(200) + commissionFor(100); // 1 + 1 + 1
  eq(st.commissions, round2(totalComms), "all commissions accrue immediately");
  eq(st.realized, round2(grossRealized - totalComms), "realized = gross realized - all commissions");
  eq(st.dayPnl, round2(st.realized + st.unrealized), "dayPnl = realized + unrealized");
});

/* -- 3. the flip --------------------------------------------------------- */

test("(3) long -> short flip books the long trade and opens the short", function () {
  var day = makeDay({
    573: { o: 104.00, h: 104.50, l: 103.50, c: 104.00, v: 180000 }
  });
  boot(day);

  Engine.submit({ side: "BUY", qty: 100, type: "MKT", thesis: THESIS });
  Engine.step();                                                   // m=571
  var entry = specFill(barAt(day, 571).o, barAt(day, 571), 100, 1, 1);

  while (Engine.getState().m < 572) Engine.step();
  var flipThesis = "Blow-off top, flipping short into the fade.";
  var r = Engine.submit({ side: "SELL", qty: 300, type: "MKT", thesis: flipThesis });
  ok(r.ok, "flip accepted: " + r.error);
  Engine.step();                                                   // m=573
  var fBar = barAt(day, 573);
  var flipPx = specFill(fBar.o, fBar, 300, -1, 1);

  var st = Engine.getState();

  // the long portion closed
  eq(st.trades.length, 1, "exactly one closed trade from the flip");
  var tr = st.trades[0];
  eq(tr.side, "LONG", "closed side");
  eq(tr.qty, 100, "closed qty = the old position, not the order qty");
  eq(tr.entryPx, entry, "entry");
  eq(tr.exitPx, flipPx, "exit");
  eq(tr.thesis, THESIS, "the CLOSED trade keeps the thesis it was opened on");

  var grossLong = (flipPx - entry) * 100;
  var entryComm = commissionFor(100);                    // 1.00, all of it on 100 shares
  var exitCommAlloc = commissionFor(300) * (100 / 300);  // 1.50 * 1/3 = 0.50
  eq(tr.pnl, round2(grossLong - entryComm - exitCommAlloc), "flip trade P&L");

  // the short portion opened
  eq(st.position.shares, -200, "new short of 200");
  eq(st.position.avgPx, flipPx, "avgPx RESETS on a flip");
  eq(st.position.openM, 573, "the short's clock starts at the flip");
  eq(st.position.thesis, flipThesis, "the new position carries the flip thesis");

  // money
  eq(st.commissions, round2(commissionFor(100) + commissionFor(300)), "2.50 of commissions");
  eq(st.realized, round2(grossLong - 2.50), "realized = gross realized - ALL commissions paid");
  var mark = barAt(day, 573).c;
  eq(st.unrealized, round2(-200 * (mark - flipPx)), "unrealized on the new short");
  eq(st.dayPnl, round2(st.realized + st.unrealized), "dayPnl");

  // and now close the short too; realized must stay exact
  while (Engine.getState().m < 574) Engine.step();
  Engine.submit({ side: "BUY", qty: 200, type: "MKT" });
  Engine.step();                                                   // m=575
  var cBar = barAt(day, 575);
  var cover = specFill(cBar.o, cBar, 200, 1, 1);
  st = Engine.getState();
  eq(st.position.shares, 0, "flat again");
  eq(st.trades.length, 2, "two round trips");
  eq(st.trades[1].side, "SHORT", "second trade is the short");
  eq(st.trades[1].qty, 200, "short qty");
  var grossShort = (flipPx - cover) * 200;
  var allComms = commissionFor(100) + commissionFor(300) + commissionFor(200); // 1 + 1.5 + 1
  eq(st.commissions, round2(allComms), "all commissions");
  eq(st.realized, round2(grossLong + grossShort - allComms), "realized after the full sequence");
  eq(st.dayPnl, st.realized, "flat => dayPnl == realized");
});

/* -- 4. buying power ----------------------------------------------------- */

test("(4) buying power is enforced (exposure > equity * 4)", function () {
  var day = makeDay();
  boot(day);
  var st = Engine.getState();
  eq(st.equity, 25000, "fresh account equity");
  eq(st.buyingPower, 100000, "4x leverage");

  var rejects = [];
  Engine.on("reject", function (r) { rejects.push(r); });

  // 1500 * 100.00 = 150,000 > 100,000
  var bad = Engine.submit({ side: "BUY", qty: 1500, type: "MKT", thesis: THESIS });
  eq(bad.ok, false, "oversized order must be rejected");
  eq(bad.error, "Exceeds buying power", "rejection reason");
  eq(rejects.length, 1, "reject event emitted");
  eq(rejects[0].error, "Exceeds buying power", "reject event carries the reason");

  // exactly at the line is allowed: 1000 * 100.00 = 100,000
  var atLine = Engine.submit({ side: "BUY", qty: 1000, type: "MKT", thesis: THESIS });
  eq(atLine.ok, true, "exactly at the line is allowed: " + atLine.error);
  Engine.step();
  eq(Engine.getState().position.shares, 1000, "filled");

  // now anything that increases is over the line
  var more = Engine.submit({ side: "BUY", qty: 100, type: "MKT", thesis: THESIS });
  eq(more.ok, false, "adding on top must be rejected");
  eq(more.error, "Exceeds buying power", "rejection reason");

  // ...but reducing is always fine
  var out = Engine.submit({ side: "SELL", qty: 500, type: "MKT" });
  eq(out.ok, true, "a reducing order is never a buying-power problem: " + out.error);

  // the check is applied to LMT/STP at their own price, at submit time too
  Engine.step();                                          // the sell fills, 500 left
  eq(Engine.getState().position.shares, 500, "500 left");
  var w = Engine.submit({ side: "BUY", qty: 900, type: "LMT", px: 99.60, thesis: "Bidding the pullback into support." });
  eq(w.ok, false, "1400 shares @ 99.60 = 139,440 is over the line");
  eq(w.error, "Exceeds buying power", "limit orders are checked at their own price");
  var w2 = Engine.submit({ side: "BUY", qty: 400, type: "LMT", px: 99.60, thesis: "Bidding the pullback into support." });
  eq(w2.ok, true, "900 shares @ 99.60 = 89,640 fits: " + w2.error);
  Engine.cancel(w2.order.id);
});

/* -- 4b. working order vetoed at fill time ------------------------------- */

test("(4b) a working order that breaches buying power at fill time is cancelled", function () {
  // Start flat, rest a big buy limit, then get long enough that the limit
  // would breach when it finally fills.
  var day = makeDay({
    574: { o: 99.00, h: 99.20, l: 98.50, c: 99.00, v: 100000 }   // limit trades here
  });
  boot(day);

  var rejects = [];
  Engine.on("reject", function (r) { rejects.push(r); });

  // rest a 700-share buy limit down at 98.60 (700 * 98.60 = 69,020 — fine now)
  var w = Engine.submit({ side: "BUY", qty: 700, type: "LMT", px: 98.60, thesis: "Scaling in at the value area low." });
  ok(w.ok, "limit accepted: " + w.error);
  eq(Engine.getWorking().length, 1, "one working order");

  // meanwhile get long 500 at the market -> 1200 shares would be ~118k, over the line
  var mk = Engine.submit({ side: "BUY", qty: 500, type: "MKT", thesis: "Starter position on the open." });
  ok(mk.ok, "market accepted: " + mk.error);

  while (Engine.getState().m < 574) Engine.step();

  var st = Engine.getState();
  eq(st.position.shares, 500, "the limit must NOT have filled");
  eq(Engine.getWorking().length, 0, "the working order was cancelled");
  var bp = rejects.filter(function (r) { return r.error === "Exceeds buying power"; });
  eq(bp.length, 1, "one buying-power reject event at fill time");
  eq(bp[0].order.type, "LMT", "it was the limit order");
});

/* -- 5. thesis ----------------------------------------------------------- */

test("(5) the thesis box is mandatory on entries and adds, not on exits", function () {
  var day = makeDay();
  boot(day);

  var a = Engine.submit({ side: "BUY", qty: 100, type: "MKT" });
  eq(a.ok, false, "no thesis at all must be rejected");
  eq(a.error, "Thesis required", "rejection reason");

  var b = Engine.submit({ side: "BUY", qty: 100, type: "MKT", thesis: "up" });
  eq(b.ok, false, "a thesis under 10 chars must be rejected");
  eq(b.error, "Thesis required", "rejection reason");

  var c = Engine.submit({ side: "BUY", qty: 100, type: "MKT", thesis: "         " });
  eq(c.ok, false, "whitespace is not a thesis");
  eq(c.error, "Thesis required", "rejection reason");

  var d = Engine.submit({ side: "BUY", qty: 100, type: "MKT", thesis: THESIS });
  eq(d.ok, true, "a real thesis is accepted: " + d.error);
  Engine.step();

  // adding requires one too
  var e = Engine.submit({ side: "BUY", qty: 100, type: "MKT" });
  eq(e.ok, false, "increasing an existing position still needs a thesis");
  eq(e.error, "Thesis required", "rejection reason");

  // reducing does not
  var f = Engine.submit({ side: "SELL", qty: 100, type: "MKT" });
  eq(f.ok, true, "closing needs no thesis: " + f.error);

  // a flip DOES need one (it opens a new position)
  Engine.step();
  eq(Engine.getState().position.shares, 0, "flat");
  Engine.submit({ side: "BUY", qty: 100, type: "MKT", thesis: THESIS });
  Engine.step();
  var g = Engine.submit({ side: "SELL", qty: 300, type: "MKT" });
  eq(g.ok, false, "a flip opens a position, so it needs a thesis");
  eq(g.error, "Thesis required", "rejection reason");
});

/* -- 6. the daily loss limit --------------------------------------------- */

test("(6) hitting maxDailyLoss flattens the book and locks the day", function () {
  var day = makeDay({
    575: { o: 98.00, h: 98.20, l: 97.80, c: 98.00, v: 100000 }
  });
  boot(day);

  var risks = [];
  Engine.on("risk", function (r) { risks.push(r); });

  var r = Engine.submit({ side: "BUY", qty: 1000, type: "MKT", thesis: THESIS });
  ok(r.ok, "max size accepted: " + r.error);
  Engine.step();                                                   // fills m=571
  var entry = specFill(barAt(day, 571).o, barAt(day, 571), 1000, 1, 1);
  eq(Engine.getState().position.shares, 1000, "long 1000");
  eq(Engine.getState().locked, false, "not locked yet");

  while (Engine.getState().m < 575) Engine.step();

  var st = Engine.getState();
  eq(st.locked, true, "risk pulled the card");
  eq(st.position.shares, 0, "flattened");

  // the flatten happens on the current bar at its close, with normal slippage
  var fb = barAt(day, 575);
  var exit = specFill(fb.c, fb, 1000, -1, 1);
  var gross = (exit - entry) * 1000;
  var comms = commissionFor(1000) * 2;             // 5.00 + 5.00
  eq(st.realized, round2(gross - comms), "realized after the forced flatten");
  eq(st.dayPnl, st.realized, "flat => dayPnl == realized");
  ok(st.dayPnl <= Engine.RULES.maxDailyLoss, "we are indeed through the limit");

  var lastFill = st.blotter[st.blotter.length - 1];
  eq(lastFill.reason, "RISK_FLAT", "the exit is tagged RISK_FLAT");
  eq(st.trades[st.trades.length - 1].exitReason, "RISK_FLAT", "trade exit reason");

  // both a warn and a hard event
  var warns = risks.filter(function (x) { return x.level === "warn"; });
  var hards = risks.filter(function (x) { return x.level === "hard"; });
  ok(warns.length >= 1, "a soft warning fired");
  eq(hards.length, 1, "exactly one hard risk event");
  eq(hards[0].hard, true, "hard:true on the payload");
  ok(typeof hards[0].message === "string" && hards[0].message.length > 0, "it says something");

  // no further orders
  var after = Engine.submit({ side: "BUY", qty: 100, type: "MKT", thesis: THESIS });
  eq(after.ok, false, "locked book takes no orders");
  eq(after.error, "Trading locked — you hit the daily loss limit", "rejection reason");
  var after2 = Engine.submit({ side: "SELL", qty: 100, type: "MKT" });
  eq(after2.ok, false, "not even a sell");
  eq(after2.error, "Trading locked — you hit the daily loss limit", "rejection reason");

  // the soft warning is emitted at most once
  var before = risks.filter(function (x) { return x.level === "warn"; }).length;
  Engine.step(); Engine.step();
  eq(risks.filter(function (x) { return x.level === "warn"; }).length, before,
    "the warning does not repeat every bar");

  // drawdown tracking
  ok(st.stats.maxDrawdown <= st.dayPnl + 0.01, "maxDrawdown captured the decline");
  ok(st.stats.maxDrawdown < 0, "maxDrawdown is negative");
});

/* -- 6b. drawdown / peak ------------------------------------------------- */

test("(6b) maxDrawdown is the largest peak-to-trough decline in dayPnl", function () {
  var day = makeDay({
    572: { o: 102.00, h: 102.20, l: 101.80, c: 102.00, v: 100000 },  // +2/sh peak
    573: { o: 99.00, h: 99.20, l: 98.80, c: 99.00, v: 100000 },  // trough
    574: { o: 101.00, h: 101.20, l: 100.80, c: 101.00, v: 100000 }   // partial recovery
  });
  boot(day);
  Engine.submit({ side: "BUY", qty: 100, type: "MKT", thesis: THESIS });
  Engine.step();                                                   // m=571, fill
  var entry = specFill(barAt(day, 571).o, barAt(day, 571), 100, 1, 1);

  Engine.step();                                                   // m=572, peak
  var peak = Engine.getState().dayPnl;
  Engine.step();                                                   // m=573, trough
  var trough = Engine.getState().dayPnl;
  Engine.step();                                                   // m=574, recovery

  var st = Engine.getState();
  eq(st.stats.peakDayPnl, round2(peak), "peakDayPnl");
  eq(st.stats.maxDrawdown, round2(trough - peak), "maxDrawdown = trough - peak");
  ok(st.stats.maxDrawdown < 0, "negative");
  // sanity that our marks are what we think they are
  eq(peak, round2(100 * (102.00 - entry) - 1.00), "peak mark");
  eq(trough, round2(100 * (99.00 - entry) - 1.00), "trough mark");
});

/* -- 7. forced flat at 15:58 --------------------------------------------- */

test("(7) risk force-flattens at 15:58 and the day closes cleanly", function () {
  var day = makeDay();
  boot(day);

  var closes = [];
  Engine.on("close", function (s) { closes.push(s); });

  Engine.submit({ side: "BUY", qty: 100, type: "MKT", thesis: THESIS });
  Engine.step();
  eq(Engine.getState().position.shares, 100, "long into the close");

  // walk to 15:57 — still holding
  while (Engine.getState().m < 957) Engine.step();
  eq(Engine.getState().m, 957, "at 15:57");
  eq(Engine.getState().position.shares, 100, "still holding at 15:57");

  // the 15:55 gate is live
  var late = Engine.submit({ side: "BUY", qty: 100, type: "MKT", thesis: THESIS });
  eq(late.ok, false, "no new positions after 15:55");
  eq(late.error, "No new positions after 15:55", "rejection reason");
  var lateOut = Engine.submit({ side: "SELL", qty: 100, type: "MKT" });
  eq(lateOut.ok, true, "but you may always get out: " + lateOut.error);
  Engine.cancel(lateOut.order.id);

  Engine.step();                                                   // -> 15:58
  var st = Engine.getState();
  eq(st.m, 958, "at 15:58");
  eq(st.position.shares, 0, "risk flattened you");
  var lastFill = st.blotter[st.blotter.length - 1];
  eq(lastFill.reason, "EOD_FLAT", "tagged EOD_FLAT");
  eq(lastFill.m, 958, "flattened exactly at 15:58");
  eq(st.trades[st.trades.length - 1].exitReason, "EOD_FLAT", "trade exit reason");

  // run the tape out
  var guard = 0;
  while (!Engine.getState().finished && guard++ < 20) Engine.step();
  st = Engine.getState();
  eq(st.finished, true, "the session finished");
  eq(st.m, 961, "clock parks past the close (closeM + 1)");
  eq(closes.length, 1, "exactly one close event");
  eq(closes[0].ticker, "TSTX", "the summary knows the ticker");
  eq(closes[0].nTrades, st.trades.length, "summary trade count");
  eq(closes[0].endEquity, st.equity, "summary equity");

  // equity curve sampled every 15 minutes
  var curve = closes[0].curve;
  ok(curve.length > 20, "there are curve samples (" + curve.length + ")");
  eq(curve[0].m, 570, "first sample at the open");
  for (var i = 0; i < curve.length - 1; i++) {
    eq(curve[i].m % 15, 0, "sample at " + curve[i].t + " is on a 15-minute boundary");
  }
});

/* -- 8. stops fill worse than market ------------------------------------- */

test("(8) stop orders fill with double the slippage of an equivalent market order", function () {
  var day = makeDay({
    571: { o: 100.00, h: 100.80, l: 99.50, c: 100.40, v: 100000 }
  });
  boot(day);

  // a market buy and a buy-stop above the market, both sent on bar 570,
  // both filling on bar 571 (h=100.80 triggers the 100.20 stop)
  var mk = Engine.submit({ side: "BUY", qty: 100, type: "MKT", thesis: THESIS });
  ok(mk.ok, "market accepted: " + mk.error);
  var stp = Engine.submit({ side: "BUY", qty: 100, type: "STP", px: 100.20, thesis: "Breakout stop entry over the pre-market high." });
  ok(stp.ok, "stop accepted: " + stp.error);
  eq(Engine.getWorking().length, 1, "the stop rests as a working order");

  Engine.step();                                                   // both fill on m=571

  var st = Engine.getState();
  eq(st.position.shares, 200, "both filled");
  eq(Engine.getWorking().length, 0, "the stop is no longer working");
  eq(st.blotter.length, 2, "two fills");

  var mkFill = st.blotter[0], stFill = st.blotter[1];
  eq(mkFill.reason, "MANUAL", "market fill reason");
  eq(stFill.reason, "STOP", "stop fill reason");

  var bar = barAt(day, 571);
  var expMk = specFill(bar.o, bar, 100, +1, 1);
  var expSt = specFill(bar.o, bar, 100, +1, 2);
  eq(mkFill.px, expMk, "market fill price");
  eq(stFill.px, expSt, "stop fill price (double slippage)");
  ok(stFill.px > mkFill.px, "a buy stop pays MORE than a market order: "
    + stFill.px + " vs " + mkFill.px);
  near(stFill.px - bar.o, 2 * (mkFill.px - bar.o), 1e-9, "exactly double the slippage");

  // and the sell side: a sell stop gets a WORSE (lower) price
  var day2 = makeDay({
    571: { o: 100.00, h: 100.50, l: 99.20, c: 99.60, v: 100000 }
  });
  boot(day2);
  Engine.submit({ side: "SELL", qty: 100, type: "MKT", thesis: "Short the failed reclaim of the open." });
  Engine.submit({ side: "SELL", qty: 100, type: "STP", px: 99.50, thesis: "Stop out under the morning low." });
  Engine.step();
  var s2 = Engine.getState();
  var b2 = barAt(day2, 571);
  eq(s2.blotter[0].px, specFill(b2.o, b2, 100, -1, 1), "market sell fill");
  eq(s2.blotter[1].px, specFill(b2.o, b2, 100, -1, 2), "sell stop fill");
  ok(s2.blotter[1].px < s2.blotter[0].px, "a sell stop receives LESS than a market order");
});

/* -- 8b. limit orders ----------------------------------------------------- */

test("(8b) limit orders rest, fill at the limit price, and can be cancelled", function () {
  var day = makeDay({
    573: { o: 99.90, h: 100.10, l: 99.30, c: 99.80, v: 100000 }   // trades through 99.40
  });
  boot(day);

  var r = Engine.submit({ side: "BUY", qty: 100, type: "LMT", px: 99.40, thesis: "Bidding the flush into support." });
  ok(r.ok, "limit accepted: " + r.error);
  Engine.step();                                                   // m=571, l=99.50 -> no fill
  eq(Engine.getState().position.shares, 0, "not filled above the limit");
  eq(Engine.getWorking().length, 1, "still resting");

  Engine.step();                                                   // m=572, still no
  eq(Engine.getState().position.shares, 0, "still unfilled");

  Engine.step();                                                   // m=573, l=99.30 <= 99.40
  var st = Engine.getState();
  eq(st.position.shares, 100, "filled");
  eq(st.blotter[0].px, 99.40, "limit fills AT the limit price");
  eq(st.blotter[0].reason, "TARGET", "limit fill reason");
  eq(Engine.getWorking().length, 0, "no longer working");

  // cancellation
  var r2 = Engine.submit({ side: "SELL", qty: 100, type: "LMT", px: 140.00 });
  ok(r2.ok, "sell limit accepted: " + r2.error);
  eq(Engine.getWorking().length, 1, "resting");
  var c = Engine.cancel(r2.order.id);
  eq(c.ok, true, "cancelled");
  eq(Engine.getWorking().length, 0, "gone");
  eq(Engine.cancel("nope").ok, false, "cancelling a ghost fails cleanly");
});

/* -- 9. misc contract ----------------------------------------------------- */

test("(9) market-closed rejection, and no lookahead in getState", function () {
  var day = makeDay();
  boot(day);
  var st = Engine.getState();
  eq(st.m, 570, "starts at the open");
  eq(st.idx, 2, "idx points at the first RTH bar (2 pre-market bars precede it)");
  eq(st.bar.m, 570, "current bar is the open bar");

  var guard = 0;
  while (!Engine.getState().finished && guard++ < 500) Engine.step();
  eq(Engine.getState().finished, true, "ran to completion");

  var late = Engine.submit({ side: "BUY", qty: 100, type: "MKT", thesis: THESIS });
  eq(late.ok, false, "no orders after the close");
  eq(late.error, "Market closed", "rejection reason");
});

test("(9b) input validation", function () {
  var day = makeDay();
  boot(day);
  eq(Engine.submit({ side: "HOLD", qty: 100, type: "MKT", thesis: THESIS }).error,
    "Side must be BUY or SELL", "bad side");
  eq(Engine.submit({ side: "BUY", qty: 0, type: "MKT", thesis: THESIS }).error,
    "Quantity must be a positive whole number", "zero qty");
  eq(Engine.submit({ side: "BUY", qty: 10.5, type: "MKT", thesis: THESIS }).error,
    "Quantity must be a positive whole number", "fractional qty");
  eq(Engine.submit({ side: "BUY", qty: 100, type: "LMT", thesis: THESIS }).error,
    "Limit price required", "limit with no price");
  eq(Engine.submit({ side: "BUY", qty: 100, type: "STP", thesis: THESIS }).error,
    "Stop price required", "stop with no price");
  eq(Engine.submit({ side: "BUY", qty: 100, type: "OCO", px: 100, thesis: THESIS }).error,
    "Order type must be MKT, LMT or STP", "bad type");
});

test("(9c) account persistence guards a missing localStorage", function () {
  var day = makeDay();
  boot(day);
  eq(Engine.loadAccount(), null, "no localStorage => null, not a throw");
  Engine.submit({ side: "BUY", qty: 100, type: "MKT", thesis: THESIS });
  Engine.step();
  var acct = Engine.saveAccount(Engine.getSummary());
  ok(acct && typeof acct.equity === "number", "saveAccount still returns an Account");
  eq(acct.sessions.length, 1, "one session recorded");
  eq(acct.sessions[0].sessionNo, 1, "sessionNo");
  eq(acct.equity, acct.sessions[0].endEquity, "account equity rolls forward");

  // and an inherited account carries into the next session
  boot(day, { equity: 23000, sessions: [] });
  eq(Engine.getState().equity, 23000, "session 2 starts from the carried equity");
  eq(Engine.getState().buyingPower, 92000, "buying power follows it");
});

test("(9d) exportReview produces a markdown tearsheet with the required sections", function () {
  var day = makeDay({
    573: { o: 101.50, h: 101.80, l: 101.20, c: 101.50, v: 120000 }
  });
  boot(day);
  Engine.submit({ side: "BUY", qty: 200, type: "MKT", thesis: THESIS });
  Engine.step();
  Engine.step();
  Engine.submit({ side: "SELL", qty: 200, type: "MKT" });
  Engine.step();
  var guard = 0;
  while (!Engine.getState().finished && guard++ < 500) Engine.step();

  var md = Engine.exportReview();
  ok(typeof md === "string" && md.length > 200, "it is a non-trivial string");
  ok(md.indexOf("# P&L review") === 0, "starts with the title");
  ok(md.indexOf("## Stat line") > -1, "has the stat line");
  ok(md.indexOf("## Trades") > -1, "has the trades section");
  ok(md.indexOf("## Equity curve") > -1, "has the equity curve");
  ok(md.indexOf("## Risk events") > -1, "has the risk events section");
  ok(md.indexOf(THESIS) > -1, "the thesis appears as typed");
  ok(md.indexOf("LONG") > -1, "the trade side appears");
  ok(md.indexOf("Max drawdown") > -1, "drawdown is reported");
  ok(md.indexOf("09:30") > -1, "curve samples are time-stamped");
  ok(md.indexOf("MANUAL") > -1 || md.indexOf("EOD_FLAT") > -1, "exit reasons appear");
});

/* ======================================================================== */

console.log("");
console.log("------------------------------------------------------------");
if (FAIL === 0) {
  console.log("PASS  " + PASS + "/" + (PASS + FAIL) + " tests passed.");
  console.log("------------------------------------------------------------");
  console.log("");
  process.exit(0);
} else {
  console.log("FAIL  " + FAIL + " of " + (PASS + FAIL) + " tests failed:");
  for (var i = 0; i < FAILURES.length; i++) console.log("   - " + FAILURES[i]);
  console.log("------------------------------------------------------------");
  console.log("");
  process.exit(1);
}
