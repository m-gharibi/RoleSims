/* ============================================================================
 * sim/chart.js  —  window.Chart
 * Day Trader Sim: hand-rolled canvas-2D candlestick renderer.
 *
 * NO modules, NO imports, NO libraries. Loads via <script src> from file://.
 *
 *   var chart = Chart.create(canvasEl, { theme: "dark" });
 *   chart.render({
 *     bars, upto, window, overlays, levels, markers, position
 *   });
 *   chart.resize();
 *   chart.destroy();          // extra, optional
 *
 * THE INTEGRITY RULE (SPEC §3, §6):
 *   Nothing with an array index > cfg.upto may be drawn, may influence the
 *   y-axis scale, the volume scale, the x mapping, the crosshair, the
 *   indicators, or any label. Every loop in this file that walks `bars`
 *   terminates at `upto` inclusive. Search this file for "// LOOKAHEAD" to
 *   find every one of those clamps.
 * ==========================================================================*/

;(function (global) {
  'use strict';

  var VERSION = '1.0.0';

  /* --------------------------------------------------------------------- *
   * Theme (SPEC §5 palette)
   * --------------------------------------------------------------------- */
  var THEME = {
    bg:      '#0d1117',
    panel:   '#161b22',
    border:  '#30363d',
    grid:    '#1b2027',
    gridStrong: '#242b34',
    text:    '#c9d1d9',
    dim:     '#8b949e',
    faint:   '#6e7681',
    up:      '#3fb950',
    down:    '#f85149',
    amber:   '#d29922',
    cyan:    '#39c5cf',
    vwap:    '#d29922',
    ema9:    '#58a6ff',
    ema20:   '#bc8cff',
    premktBg:'#12161d'
  };

  /* Monospace stack => digits are inherently tabular (canvas has no
   * font-variant-numeric; a monospace face gives us the same guarantee). */
  var MONO = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';
  function font(px, weight) { return (weight ? weight + ' ' : '') + px + 'px ' + MONO; }

  /* --------------------------------------------------------------------- *
   * Small numeric helpers — every one of these is NaN-hardened.
   * --------------------------------------------------------------------- */
  function isFin(x) { return typeof x === 'number' && isFinite(x); }
  function num(x, d) { return (typeof x === 'number' && isFinite(x)) ? x : d; }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function fmtPx(v, dp) {
    if (!isFin(v)) return '--';
    return v.toFixed(dp == null ? 2 : dp);
  }

  function fmtSigned(v, dp) {
    if (!isFin(v)) return '--';
    var s = v.toFixed(dp == null ? 2 : dp);
    return v > 0 ? '+' + s : s;
  }

  function fmtVol(v) {
    if (!isFin(v) || v <= 0) return '0';
    if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
    if (v >= 1e3) return (v / 1e3).toFixed(0) + 'K';
    return String(Math.round(v));
  }

  function fmtClock(m) {
    if (!isFin(m)) return '--:--';
    var mm = ((Math.round(m) % 1440) + 1440) % 1440;
    var h = Math.floor(mm / 60), r = mm % 60;
    return (h < 10 ? '0' : '') + h + ':' + (r < 10 ? '0' : '') + r;
  }

  function barTime(b) {
    if (!b) return '--:--';
    if (typeof b.t === 'string' && b.t) return b.t;
    return fmtClock(b.m);
  }

  /* "nice" axis step */
  function niceStep(range, target) {
    if (!isFin(range) || range <= 0) return 1;
    var raw = range / Math.max(1, target);
    if (!isFin(raw) || raw <= 0) return 1;
    var mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
    if (!isFin(mag) || mag <= 0) return 1;
    var n = raw / mag, step;
    if (n <= 1) step = 1;
    else if (n <= 2) step = 2;
    else if (n <= 2.5) step = 2.5;
    else if (n <= 5) step = 5;
    else step = 10;
    var s = step * mag;
    return isFin(s) && s > 0 ? s : 1;
  }

  function stepDp(step) {
    if (!isFin(step) || step <= 0) return 2;
    if (step >= 0.05) return 2;
    if (step >= 0.005) return 3;
    return 4;
  }

  function roundPx(v) { return Math.round(v) + 0.5; }   /* crisp 1px lines */

  /* --------------------------------------------------------------------- *
   * Chart instance
   * --------------------------------------------------------------------- */
  function create(canvasEl, opts) {
    opts = opts || {};
    if (!canvasEl || !canvasEl.getContext) {
      throw new Error('Chart.create: first argument must be a <canvas> element');
    }

    var ctx = canvasEl.getContext('2d');
    var T = THEME;                       /* only a dark theme exists today */
    var defaultWindow = num(opts.window, 120);
    var volFrac = clamp(num(opts.volumeFraction, 0.22), 0.08, 0.4);

    var cssW = 0, cssH = 0, dpr = 0;     /* current backing-store geometry  */
    var cfg = null;                      /* last render config              */
    var geom = null;                     /* last computed layout            */
    var mouse = null;                    /* {x,y} in CSS px, or null        */
    var rafId = 0;
    var destroyed = false;

    /* ---- indicator cache: incremental, and TRUNCATED on step-back ------ */
    var ind = null;
    function resetInd(bars, openM) {
      ind = {
        bars: bars, len: bars ? bars.length : 0, openM: openM,
        filled: -1,                     /* highest index computed (<= upto) */
        vwap: [], ema9: [], ema20: [],
        cumPV: 0, cumV: 0, cumTP: 0, nTP: 0,
        e9: NaN, e20: NaN, nClose: 0
      };
    }
    resetInd(null, 570);

    function isRth(b, openM) {
      if (!b) return false;
      if (typeof b.rth === 'boolean') return b.rth;
      return num(b.m, -1) >= openM;
    }

    /* Compute VWAP/EMA over bars[0..upto] ONLY.  // LOOKAHEAD clamp */
    function ensureIndicators(bars, upto, openM) {
      if (!ind || ind.bars !== bars || ind.len !== (bars ? bars.length : 0) || ind.openM !== openM) {
        resetInd(bars, openM);
      }
      if (upto < ind.filled) {
        /* Stepped backwards: nuke and recompute so no value derived from a
         * now-future bar can survive in the cache. Cheap (<= 390 bars). */
        resetInd(bars, openM);
      }
      if (!bars || upto < 0) return ind;

      var K9 = 2 / (9 + 1), K20 = 2 / (20 + 1);
      for (var i = ind.filled + 1; i <= upto; i++) {   // LOOKAHEAD: i <= upto
        var b = bars[i];
        var c = num(b && b.c, NaN);
        var h = num(b && b.h, c);
        var l = num(b && b.l, c);
        var tp = (isFin(h) && isFin(l) && isFin(c)) ? (h + l + c) / 3 : c;
        var v = num(b && b.v, 0);
        if (!(v > 0)) v = 0;                      /* missing / 0 / negative */

        /* --- VWAP: RTH only, anchored at the RTH open ------------------- */
        if (isRth(b, openM) && isFin(tp)) {
          ind.cumPV += tp * v;
          ind.cumV += v;
          ind.cumTP += tp;
          ind.nTP += 1;
          ind.vwap[i] = ind.cumV > 0
            ? ind.cumPV / ind.cumV
            : (ind.nTP > 0 ? ind.cumTP / ind.nTP : NaN);   /* volumeless day */
        } else {
          ind.vwap[i] = NaN;
        }

        /* --- EMAs over the whole series, with a warm-up hold ------------- */
        if (isFin(c)) {
          ind.nClose += 1;
          ind.e9 = isFin(ind.e9) ? (c * K9 + ind.e9 * (1 - K9)) : c;
          ind.e20 = isFin(ind.e20) ? (c * K20 + ind.e20 * (1 - K20)) : c;
        }
        ind.ema9[i] = ind.nClose >= 9 ? ind.e9 : NaN;
        ind.ema20[i] = ind.nClose >= 20 ? ind.e20 : NaN;
      }
      ind.filled = upto;
      /* Belt and braces: nothing past `upto` may linger in the arrays. */
      if (ind.vwap.length > upto + 1) ind.vwap.length = upto + 1;
      if (ind.ema9.length > upto + 1) ind.ema9.length = upto + 1;
      if (ind.ema20.length > upto + 1) ind.ema20.length = upto + 1;
      return ind;
    }

    /* ------------------------------------------------------------------- *
     * Sizing / HiDPI
     * ------------------------------------------------------------------- */
    function measure() {
      var w = canvasEl.clientWidth | 0;
      var h = canvasEl.clientHeight | 0;
      if (!w || !h) {
        /* Not laid out (detached, display:none, or no CSS size). Fall back
         * to the attribute size, then to a sane default, and pin it so the
         * backing store doesn't feed back into layout. */
        var aw = canvasEl.width || 0, ah = canvasEl.height || 0;
        w = w || aw || 800;
        h = h || ah || 420;
        canvasEl.style.width = w + 'px';
        canvasEl.style.height = h + 'px';
      }
      return { w: w, h: h };
    }

    function syncBackingStore() {
      var d = global.devicePixelRatio || 1;
      if (!isFin(d) || d <= 0) d = 1;
      d = clamp(d, 1, 3);                      /* 3x is plenty; keeps it fast */
      var s = measure();
      if (s.w === cssW && s.h === cssH && d === dpr) return false;
      cssW = s.w; cssH = s.h; dpr = d;
      canvasEl.width = Math.max(1, Math.round(cssW * dpr));
      canvasEl.height = Math.max(1, Math.round(cssH * dpr));
      return true;
    }

    /* ------------------------------------------------------------------- *
     * Layout + scales — computed ONLY from bars[start..upto]
     * ------------------------------------------------------------------- */
    function computeGeom(c) {
      var bars = (c && c.bars) || [];
      var openM = num(c && c.openM, 570);
      var nBars = bars.length;

      /* --- the visible window -------------------------------------------
       * upto is inclusive. Clamp hard into [-1, nBars-1]; -1 == nothing. */
      var upto = (c && c.upto != null) ? Math.floor(num(c.upto, nBars - 1)) : nBars - 1;
      if (!isFin(upto)) upto = nBars - 1;
      if (upto > nBars - 1) upto = nBars - 1;                 // LOOKAHEAD clamp
      if (upto < -1) upto = -1;

      var win = Math.floor(num(c && c.window, defaultWindow));
      if (!isFin(win) || win < 1) win = defaultWindow;
      if (win < 1) win = 1;

      /* start..upto inclusive => count = upto - start + 1 <= win */
      var start = upto - win + 1;
      if (start < 0) start = 0;
      var n = upto - start + 1;
      if (n < 0) n = 0;

      /* --- pane rectangles ---------------------------------------------- */
      var padT = 8, padL = 8, axisW = 64, timeH = 22, padB = 4;
      var plotL = padL;
      var plotR = Math.max(plotL + 10, cssW - axisW);
      var plotW = plotR - plotL;
      var bodyT = padT;
      var bodyB = Math.max(bodyT + 20, cssH - timeH - padB);
      var bodyH = bodyB - bodyT;
      var gap = 10;
      var volH = Math.max(18, Math.floor((bodyH - gap) * volFrac));
      var volB = bodyB;
      var volT = volB - volH;
      var priceT = bodyT;
      var priceB = volT - gap;
      var priceH = Math.max(10, priceB - priceT);

      /* --- x mapping ----------------------------------------------------
       * Slot width is derived from the visible count, floored at a minimum
       * so a 3-bar chart doesn't render three billboards. Never derived
       * from bars.length. */
      var minSlots = Math.min(win, 40);
      var slots = Math.max(1, Math.max(n, minSlots));
      var slotW = plotW / slots;

      /* --- y scale: bars[start..upto] only ------------------------------ */
      var lo = Infinity, hi = -Infinity, i, b, v;
      for (i = start; i <= upto; i++) {                        // LOOKAHEAD: <= upto
        b = bars[i];
        if (!b) continue;
        v = num(b.h, NaN); if (isFin(v)) { if (v > hi) hi = v; if (v < lo) lo = v; }
        v = num(b.l, NaN); if (isFin(v)) { if (v > hi) hi = v; if (v < lo) lo = v; }
        v = num(b.o, NaN); if (isFin(v)) { if (v > hi) hi = v; if (v < lo) lo = v; }
        v = num(b.c, NaN); if (isFin(v)) { if (v > hi) hi = v; if (v < lo) lo = v; }
      }

      /* overlays inside the window may extend the range slightly */
      var ov = normOverlays(c && c.overlays);
      var series = ensureIndicators(bars, upto, openM);
      var ovArrays = [];
      if (ov.vwap) ovArrays.push(series.vwap);
      if (ov.ema9) ovArrays.push(series.ema9);
      if (ov.ema20) ovArrays.push(series.ema20);
      for (var a = 0; a < ovArrays.length; a++) {
        var arr = ovArrays[a];
        for (i = start; i <= upto; i++) {                      // LOOKAHEAD: <= upto
          v = arr[i];
          if (isFin(v)) { if (v > hi) hi = v; if (v < lo) lo = v; }
        }
      }

      var haveData = isFin(lo) && isFin(hi);
      if (!haveData) { lo = 0; hi = 1; }

      /* --- flat range guard (all OHLC equal, or a single bar) ----------- */
      var raw = hi - lo;
      if (!isFin(raw) || raw <= 0) {
        var pad0 = Math.max(0.05, Math.abs(hi) * 0.0015);
        lo -= pad0; hi += pad0;
        raw = hi - lo;
        if (!isFin(raw) || raw <= 0) { lo = 0; hi = 1; raw = 1; }
      }

      /* --- levels + avg price may extend the scale, but only if they are
       * plausibly near the action (they are player-known values, so they
       * cannot leak the future — but a wild one shouldn't crush the chart) */
      var slack = raw * 0.6;
      var loGate = lo - slack, hiGate = hi + slack;
      var levels = normLevels(c && c.levels);
      for (i = 0; i < levels.length; i++) {
        v = levels[i].px;
        if (isFin(v) && v >= loGate && v <= hiGate) {
          if (v > hi) hi = v; if (v < lo) lo = v;
        }
      }
      var pos = c && c.position;
      var posShares = num(pos && pos.shares, 0);
      var posAvg = num(pos && pos.avgPx, NaN);
      if (posShares !== 0 && isFin(posAvg) && posAvg >= loGate && posAvg <= hiGate) {
        if (posAvg > hi) hi = posAvg; if (posAvg < lo) lo = posAvg;
      }

      /* --- breathing room ------------------------------------------------ */
      var rng = hi - lo;
      if (!isFin(rng) || rng <= 0) { rng = 1; hi = lo + 1; }
      var padY = rng * 0.07;
      lo -= padY; hi += padY;
      rng = hi - lo;
      if (!isFin(rng) || rng <= 0) { lo = 0; hi = 1; rng = 1; }

      /* --- volume scale: visible window only ---------------------------- */
      var vmax = 0;
      for (i = start; i <= upto; i++) {                        // LOOKAHEAD: <= upto
        b = bars[i];
        v = num(b && b.v, 0);
        if (v > vmax) vmax = v;
      }
      if (!isFin(vmax) || vmax <= 0) vmax = 0;                 /* => no bars */

      return {
        bars: bars, upto: upto, start: start, n: n, win: win, openM: openM,
        haveData: haveData && n > 0,
        plotL: plotL, plotR: plotR, plotW: plotW,
        priceT: priceT, priceB: priceB, priceH: priceH,
        volT: volT, volB: volB, volH: volH,
        bodyT: bodyT, bodyB: bodyB,
        axisL: plotR, axisW: axisW,
        timeT: bodyB, timeH: timeH,
        slotW: slotW, slots: slots,
        lo: lo, hi: hi, rng: rng, vmax: vmax,
        overlays: ov, levels: levels, series: series,
        posShares: posShares, posAvg: posAvg,
        x: function (i2) { return plotL + (i2 - start + 0.5) * slotW; },
        y: function (px) { return priceT + (hi - px) / rng * priceH; },
        yInv: function (py) { return hi - (py - priceT) / priceH * rng; },
        vy: function (vv) {
          if (vmax <= 0) return volB;
          var hpx = (vv / vmax) * volH;
          if (!isFin(hpx)) hpx = 0;
          return volB - clamp(hpx, 0, volH);
        }
      };
    }

    function normOverlays(list) {
      if (list == null) return { vwap: true, ema9: true, ema20: true };
      var o = { vwap: false, ema9: false, ema20: false };
      if (!list.length) return o;
      for (var i = 0; i < list.length; i++) {
        var k = String(list[i] || '').toLowerCase();
        if (k === 'vwap') o.vwap = true;
        else if (k === 'ema9') o.ema9 = true;
        else if (k === 'ema20') o.ema20 = true;
      }
      return o;
    }

    function normLevels(list) {
      var out = [];
      if (!list || !list.length) return out;
      for (var i = 0; i < list.length; i++) {
        var L = list[i];
        if (!L) continue;
        var px = num(L.px, NaN);
        if (!isFin(px)) continue;
        out.push({ px: px, label: L.label == null ? '' : String(L.label), color: L.color || T.faint });
      }
      return out;
    }

    /* ------------------------------------------------------------------- *
     * Drawing
     * ------------------------------------------------------------------- */
    function draw() {
      if (destroyed) return;
      syncBackingStore();
      if (!cssW || !cssH) return;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);
      ctx.fillStyle = T.bg;
      ctx.fillRect(0, 0, cssW, cssH);
      ctx.lineCap = 'butt';
      ctx.lineJoin = 'miter';
      ctx.textBaseline = 'alphabetic';

      var g = geom = computeGeom(cfg);

      drawPanes(g);
      if (!g.haveData) {
        drawEmpty(g);
        drawFrame(g);
        return;
      }
      drawPremktShade(g);
      drawGrid(g);
      drawVolume(g);
      drawCandles(g);
      drawOverlays(g);
      drawLevels(g);          /* on top of the candles: they are reference marks */
      drawOpenDivider(g);
      drawAvgLine(g);
      drawMarkers(g);
      drawPriceAxis(g);
      drawTimeAxis(g);
      drawLastTag(g);
      drawLegend(g);
      drawFrame(g);
      drawCrosshair(g);
    }

    function drawPanes(g) {
      ctx.fillStyle = T.panel;
      ctx.fillRect(g.plotL, g.priceT, g.plotW, g.priceH);
      ctx.fillRect(g.plotL, g.volT, g.plotW, g.volH);
    }

    function drawFrame(g) {
      ctx.strokeStyle = T.border;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.rect(roundPx(g.plotL), roundPx(g.priceT), Math.round(g.plotW), Math.round(g.priceH));
      ctx.rect(roundPx(g.plotL), roundPx(g.volT), Math.round(g.plotW), Math.round(g.volH));
      ctx.stroke();
    }

    function drawEmpty(g) {
      ctx.fillStyle = T.faint;
      ctx.font = font(12);
      ctx.textAlign = 'center';
      ctx.fillText('NO DATA', g.plotL + g.plotW / 2, g.priceT + g.priceH / 2);
      ctx.textAlign = 'left';
    }

    /* Dim background behind the pre-market region --------------------- */
    function drawPremktShade(g) {
      var bars = g.bars, i, firstRth = -1;
      for (i = g.start; i <= g.upto; i++) {                    // LOOKAHEAD: <= upto
        if (isRth(bars[i], g.openM)) { firstRth = i; break; }
      }
      var xEnd;
      if (firstRth === g.start) return;                        /* none visible */
      if (firstRth < 0) xEnd = g.plotR;                        /* all pre-mkt  */
      else xEnd = g.x(firstRth) - g.slotW / 2;
      xEnd = clamp(xEnd, g.plotL, g.plotR);
      if (xEnd <= g.plotL + 0.5) return;
      ctx.fillStyle = T.premktBg;
      ctx.fillRect(g.plotL, g.priceT, xEnd - g.plotL, g.priceH);
      ctx.fillRect(g.plotL, g.volT, xEnd - g.plotL, g.volH);
    }

    function drawOpenDivider(g) {
      var bars = g.bars, i, boundary = -1;
      for (i = g.start; i <= g.upto; i++) {                    // LOOKAHEAD: <= upto
        if (isRth(bars[i], g.openM)) {
          if (i === 0 || !isRth(bars[i - 1], g.openM)) boundary = i;
          break;
        }
      }
      if (boundary < 0) return;
      var x = g.x(boundary) - g.slotW / 2;
      if (x < g.plotL + 0.5 || x > g.plotR - 0.5) return;
      ctx.save();
      ctx.strokeStyle = T.amber;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(roundPx(x), g.priceT);
      ctx.lineTo(roundPx(x), g.volB);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      /* label at the BOTTOM of the price pane — the top-left belongs to the
       * legend and the crosshair readout. */
      ctx.font = font(9);
      ctx.fillStyle = T.amber;
      ctx.textAlign = 'left';
      ctx.fillText('OPEN', clamp(x + 3, g.plotL, g.plotR - 30), g.priceB - 4);
      ctx.restore();
    }

    /* All gridlines live here so they sit BEHIND the candles. The axis
     * passes below only paint labels. */
    function drawGrid(g) {
      var step = niceStep(g.rng, 6);
      var dp = stepDp(step);
      var first = Math.ceil(g.lo / step) * step;
      ctx.strokeStyle = T.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      var p, y;
      for (p = first; p <= g.hi + 1e-9; p += step) {
        y = g.y(p);
        if (y < g.priceT - 0.5 || y > g.priceB + 0.5) continue;
        ctx.moveTo(g.plotL, roundPx(y));
        ctx.lineTo(g.plotR, roundPx(y));
      }
      ctx.stroke();
      g._pStep = step; g._pDp = dp; g._pFirst = first;

      /* vertical time gridlines — same tick set the time axis labels use */
      var stepM = timeStep(g);
      g._tStep = stepM;
      ctx.strokeStyle = T.gridStrong;
      ctx.beginPath();
      for (var i = g.start; i <= g.upto; i++) {               // LOOKAHEAD: <= upto
        var b = g.bars[i];
        if (!b) continue;
        var m = num(b.m, NaN);
        if (!isFin(m) || (Math.round(m) % stepM) !== 0) continue;
        var x = g.x(i);
        if (x < g.plotL + 1 || x > g.plotR - 1) continue;
        ctx.moveTo(roundPx(x), g.priceT);
        ctx.lineTo(roundPx(x), g.volB);
      }
      ctx.stroke();
    }

    /* label step that leaves >= 46px between time labels */
    function timeStep(g) {
      var cands = [30, 60, 120, 240];
      for (var s = 0; s < cands.length; s++) {
        if (g.slotW * cands[s] >= 46) return cands[s];
      }
      return cands[cands.length - 1];
    }

    function drawPriceAxis(g) {
      var step = g._pStep || niceStep(g.rng, 6);
      var dp = g._pDp == null ? stepDp(step) : g._pDp;
      var first = g._pFirst == null ? Math.ceil(g.lo / step) * step : g._pFirst;
      ctx.font = font(10);
      ctx.fillStyle = T.dim;
      ctx.textAlign = 'left';
      var tx = g.axisL + 6;
      for (var p = first; p <= g.hi + 1e-9; p += step) {
        var y = g.y(p);
        if (y < g.priceT + 6 || y > g.priceB - 2) continue;
        ctx.fillText(fmtPx(p, dp), tx, y + 3);
      }
      /* volume pane scale hint */
      if (g.vmax > 0) {
        ctx.fillStyle = T.faint;
        ctx.font = font(9);
        ctx.fillText(fmtVol(g.vmax), tx, g.volT + 9);
      }
    }

    function drawTimeAxis(g) {
      var bars = g.bars;
      var stepM = g._tStep || timeStep(g);
      ctx.font = font(10);
      ctx.textAlign = 'center';
      ctx.fillStyle = T.dim;
      var ty = g.timeT + 14;
      for (var i = g.start; i <= g.upto; i++) {                // LOOKAHEAD: <= upto
        var b = bars[i];
        if (!b) continue;
        var m = num(b.m, NaN);
        if (!isFin(m) || (Math.round(m) % stepM) !== 0) continue;
        var x = g.x(i);
        if (x < g.plotL + 12 || x > g.plotR - 12) continue;
        ctx.fillText(barTime(b), x, ty);
      }
      ctx.textAlign = 'left';
    }

    function drawVolume(g) {
      if (g.vmax <= 0) return;
      var bars = g.bars;
      var w = Math.max(1, Math.min(g.slotW * 0.7, 20));
      var groups = [
        { up: true, rth: true, a: 0.55, col: T.up },
        { up: false, rth: true, a: 0.55, col: T.down },
        { up: true, rth: false, a: 0.22, col: T.up },
        { up: false, rth: false, a: 0.22, col: T.down }
      ];
      for (var gi = 0; gi < groups.length; gi++) {
        var G = groups[gi];
        ctx.beginPath();
        var any = false;
        for (var i = g.start; i <= g.upto; i++) {              // LOOKAHEAD: <= upto
          var b = bars[i];
          if (!b) continue;
          var v = num(b.v, 0);
          if (!(v > 0)) continue;
          var c = num(b.c, NaN), o = num(b.o, c);
          var isUp = !(isFin(c) && isFin(o)) ? true : c >= o;
          if (isUp !== G.up) continue;
          if (isRth(b, g.openM) !== G.rth) continue;
          var top = g.vy(v);
          var h = g.volB - top;
          if (!(h > 0)) h = 1;
          ctx.rect(g.x(i) - w / 2, top, w, h);
          any = true;
        }
        if (!any) continue;
        ctx.globalAlpha = G.a;
        ctx.fillStyle = G.col;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    function drawCandles(g) {
      var bars = g.bars;
      var bw = g.slotW * 0.72;
      var thin = bw < 2.2;
      var bodyW = thin ? 1 : Math.max(1, Math.min(bw, 22));
      var wickW = bw >= 5 ? 1.4 : 1;

      var groups = [
        { up: true, rth: true, a: 1.0 },
        { up: false, rth: true, a: 1.0 },
        { up: true, rth: false, a: 0.42 },
        { up: false, rth: false, a: 0.42 }
      ];

      for (var gi = 0; gi < groups.length; gi++) {
        var G = groups[gi];
        var col = G.up ? T.up : T.down;
        var wicks = [], bodies = [], any = false;

        for (var i = g.start; i <= g.upto; i++) {              // LOOKAHEAD: <= upto
          var b = bars[i];
          if (!b) continue;
          var c = num(b.c, NaN);
          var o = num(b.o, c);
          if (!isFin(c) && !isFin(o)) continue;
          if (!isFin(c)) c = o;
          if (!isFin(o)) o = c;
          var h = num(b.h, Math.max(o, c));
          var l = num(b.l, Math.min(o, c));
          if (!isFin(h)) h = Math.max(o, c);
          if (!isFin(l)) l = Math.min(o, c);
          if (h < l) { var tmp = h; h = l; l = tmp; }
          var isUp = c >= o;
          if (isUp !== G.up) continue;
          if (isRth(b, g.openM) !== G.rth) continue;

          var x = g.x(i);
          var yH = g.y(h), yL = g.y(l);
          var yO = g.y(o), yC = g.y(c);
          var top = Math.min(yO, yC);
          var hh = Math.abs(yC - yO);
          if (hh < 1) { hh = 1; top = Math.min(yO, yC) - 0.5; }
          wicks.push(x, yH, yL);
          bodies.push(x - bodyW / 2, top, bodyW, hh);
          any = true;
        }
        if (!any) continue;

        ctx.globalAlpha = G.a;
        /* wicks */
        ctx.strokeStyle = col;
        ctx.lineWidth = wickW;
        ctx.beginPath();
        for (var w2 = 0; w2 < wicks.length; w2 += 3) {
          var wx = wickW === 1 ? roundPx(wicks[w2]) : wicks[w2];
          ctx.moveTo(wx, wicks[w2 + 1]);
          ctx.lineTo(wx, wicks[w2 + 2]);
        }
        ctx.stroke();
        /* bodies */
        ctx.fillStyle = col;
        ctx.beginPath();
        for (var b2 = 0; b2 < bodies.length; b2 += 4) {
          ctx.rect(bodies[b2], bodies[b2 + 1], bodies[b2 + 2], bodies[b2 + 3]);
        }
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.lineWidth = 1;
    }

    function drawLine(g, arr, color) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      var pen = false;
      for (var i = g.start; i <= g.upto; i++) {                // LOOKAHEAD: <= upto
        var v = arr[i];
        if (!isFin(v)) { pen = false; continue; }
        var x = g.x(i), y = g.y(v);
        if (y < g.priceT - 2000 || y > g.priceB + 2000) { pen = false; continue; }
        if (!pen) { ctx.moveTo(x, y); pen = true; }
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.lineWidth = 1;
    }

    function drawOverlays(g) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(g.plotL, g.priceT, g.plotW, g.priceH);
      ctx.clip();
      if (g.overlays.vwap) drawLine(g, g.series.vwap, T.vwap);
      if (g.overlays.ema9) drawLine(g, g.series.ema9, T.ema9);
      if (g.overlays.ema20) drawLine(g, g.series.ema20, T.ema20);
      ctx.restore();
    }

    function drawLegend(g) {
      var items = [];
      var last = g.bars[g.upto];                               // LOOKAHEAD: last visible bar
      if (g.overlays.vwap) items.push(['VWAP', T.vwap, g.series.vwap[g.upto]]);
      if (g.overlays.ema9) items.push(['EMA9', T.ema9, g.series.ema9[g.upto]]);
      if (g.overlays.ema20) items.push(['EMA20', T.ema20, g.series.ema20[g.upto]]);
      if (!items.length && !last) return;

      ctx.font = font(10);
      ctx.textAlign = 'left';
      var x = g.plotL + 8, y = g.priceT + 13;

      if (last) {
        ctx.fillStyle = T.text;
        var t = barTime(last);
        ctx.fillText(t, x, y);
        x += ctx.measureText(t).width + 10;
        ctx.fillStyle = T.dim;
        var ohlc = 'O ' + fmtPx(last.o) + ' H ' + fmtPx(last.h) +
                   ' L ' + fmtPx(last.l) + ' C ' + fmtPx(last.c);
        ctx.fillText(ohlc, x, y);
        x = g.plotL + 8; y += 13;
      }
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        ctx.fillStyle = it[1];
        ctx.fillRect(x, y - 6, 7, 2);
        x += 11;
        var label = it[0] + ' ' + (isFin(it[2]) ? fmtPx(it[2]) : '--');
        ctx.fillText(label, x, y);
        x += ctx.measureText(label).width + 12;
        if (x > g.plotR - 60) { x = g.plotL + 8; y += 12; }
      }
    }

    function drawLevels(g) {
      if (!g.levels.length) return;
      ctx.save();
      ctx.font = font(9);
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 1;
      for (var i = 0; i < g.levels.length; i++) {
        var L = g.levels[i];
        var y = g.y(L.px);
        if (y < g.priceT + 1 || y > g.priceB - 1) continue;    /* off-screen */
        ctx.strokeStyle = L.color;
        ctx.globalAlpha = 0.75;
        ctx.beginPath();
        ctx.moveTo(g.plotL, roundPx(y));
        ctx.lineTo(g.plotR, roundPx(y));
        ctx.stroke();
        ctx.globalAlpha = 1;
        if (L.label) {
          var txt = L.label + ' ' + fmtPx(L.px);
          var w = ctx.measureText(txt).width + 6;
          var bx = g.plotR - w - 3;
          ctx.fillStyle = T.bg;
          ctx.globalAlpha = 0.85;
          ctx.fillRect(bx, y - 10, w, 11);
          ctx.globalAlpha = 1;
          ctx.fillStyle = L.color;
          ctx.textAlign = 'left';
          ctx.fillText(txt, bx + 3, y - 2);
        }
      }
      ctx.setLineDash([]);
      ctx.restore();
    }

    function drawAvgLine(g) {
      if (!g.posShares || !isFin(g.posAvg)) return;
      var y = g.y(g.posAvg);
      if (y < g.priceT + 1 || y > g.priceB - 1) return;
      var last = g.bars[g.upto];                               // LOOKAHEAD: last visible bar
      var lastPx = num(last && last.c, NaN);
      var unreal = isFin(lastPx) ? (lastPx - g.posAvg) * g.posShares : NaN;

      ctx.save();
      ctx.strokeStyle = T.cyan;
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(g.plotL, roundPx(y));
      ctx.lineTo(g.plotR, roundPx(y));
      ctx.stroke();
      ctx.setLineDash([]);

      var side = g.posShares > 0 ? 'LONG' : 'SHORT';
      var txt = side + ' ' + Math.abs(Math.round(g.posShares)) + ' @ ' + fmtPx(g.posAvg) +
                '  ' + (isFin(unreal) ? fmtSigned(unreal) : '--');
      ctx.font = font(10);
      var w = ctx.measureText(txt).width + 8;
      var bx = clamp(g.plotL + 4, g.plotL, Math.max(g.plotL, g.plotR - w));
      var by = clamp(y + 2, g.priceT, g.priceB - 13);
      ctx.fillStyle = T.bg;
      ctx.globalAlpha = 0.9;
      ctx.fillRect(bx, by, w, 13);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = T.cyan;
      ctx.strokeRect(roundPx(bx), roundPx(by), Math.round(w), 13);
      ctx.fillStyle = isFin(unreal) ? (unreal >= 0 ? T.up : T.down) : T.cyan;
      ctx.textAlign = 'left';
      ctx.fillText(txt, bx + 4, by + 10);
      ctx.restore();
    }

    function drawMarkers(g) {
      var markers = (cfg && cfg.markers) || [];
      if (!markers.length) return;

      /* m -> index, built ONLY from visible bars. A marker whose minute has
       * not printed yet simply has nowhere to land, so it cannot be drawn.
       * That is the anti-lookahead guarantee for markers.               */
      var byM = {};
      var lastM = -Infinity;
      for (var i = g.start; i <= g.upto; i++) {                // LOOKAHEAD: <= upto
        var b = g.bars[i];
        if (!b) continue;
        var m = num(b.m, NaN);
        if (isFin(m)) {
          byM[Math.round(m)] = i;
          if (m > lastM) lastM = m;                            /* newest printed minute */
        }
      }

      var s = clamp(g.slotW * 0.42, 3.5, 7);
      var showQty = g.slotW >= 7;
      var stack = {};                    /* fan out multiple fills in one minute */
      ctx.font = font(9);
      ctx.textAlign = 'center';

      for (var k = 0; k < markers.length; k++) {
        var mk = markers[k];
        if (!mk) continue;
        var mm = num(mk.m, NaN);
        if (!isFin(mm)) continue;
        if (mm > lastM) continue;                              // LOOKAHEAD guard
        var idx = byM[Math.round(mm)];
        if (idx == null) continue;                             /* not visible  */
        var bar = g.bars[idx];
        var buy = String(mk.side || '').toUpperCase() !== 'SELL';
        var col = buy ? T.up : T.down;
        var px = num(mk.px, num(bar && bar.c, NaN));
        if (!isFin(px)) continue;
        var x = g.x(idx);
        var key = idx + '|' + (buy ? 'B' : 'S');
        var tier = stack[key] || 0;
        stack[key] = tier + 1;
        var off = tier * (s * 2 + 2);
        var yAnchor;
        if (buy) {
          var lo = num(bar && bar.l, px);
          yAnchor = clamp(g.y(isFin(lo) ? Math.min(lo, px) : px) + s + 3 + off, g.priceT + s, g.priceB - 2);
        } else {
          var hi = num(bar && bar.h, px);
          yAnchor = clamp(g.y(isFin(hi) ? Math.max(hi, px) : px) - s - 3 - off, g.priceT + 2, g.priceB - s);
        }
        ctx.fillStyle = col;
        ctx.beginPath();
        if (buy) {
          ctx.moveTo(x, yAnchor - s);
          ctx.lineTo(x + s, yAnchor + s * 0.8);
          ctx.lineTo(x - s, yAnchor + s * 0.8);
        } else {
          ctx.moveTo(x, yAnchor + s);
          ctx.lineTo(x + s, yAnchor - s * 0.8);
          ctx.lineTo(x - s, yAnchor - s * 0.8);
        }
        ctx.closePath();
        ctx.fill();
        if (showQty && isFin(num(mk.qty, NaN))) {
          ctx.fillStyle = col;
          ctx.globalAlpha = 0.85;
          ctx.fillText(String(Math.abs(Math.round(mk.qty))), x,
            buy ? clamp(yAnchor + s * 0.8 + 10, 0, g.priceB - 1) : clamp(yAnchor - s * 0.8 - 4, g.priceT + 8, g.priceB));
          ctx.globalAlpha = 1;
        }
      }
      ctx.textAlign = 'left';
    }

    function drawLastTag(g) {
      var last = g.bars[g.upto];                               // LOOKAHEAD: last visible bar
      var px = num(last && last.c, NaN);
      if (!isFin(px)) return;
      var prev = g.upto > 0 ? num(g.bars[g.upto - 1] && g.bars[g.upto - 1].c, NaN) : NaN;
      var col = !isFin(prev) ? T.dim : (px >= prev ? T.up : T.down);
      var y = clamp(g.y(px), g.priceT + 1, g.priceB - 1);

      ctx.save();
      ctx.strokeStyle = col;
      ctx.globalAlpha = 0.5;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(g.plotL, roundPx(y));
      ctx.lineTo(g.plotR, roundPx(y));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;

      ctx.font = font(10, 'bold');
      var txt = fmtPx(px);
      var w = Math.max(46, ctx.measureText(txt).width + 10);
      ctx.fillStyle = col;
      ctx.fillRect(g.axisL + 1, y - 7, Math.min(w, g.axisW - 3), 14);
      ctx.fillStyle = T.bg;
      ctx.textAlign = 'left';
      ctx.fillText(txt, g.axisL + 6, y + 3.5);
      ctx.restore();
    }

    /* ------------------------------------------------------------------- *
     * Crosshair
     * ------------------------------------------------------------------- */
    function drawCrosshair(g) {
      if (!mouse || !g.haveData) return;
      var mx = mouse.x, my = mouse.y;
      if (mx < g.plotL || mx > g.plotR || my < g.priceT || my > g.volB) return;

      /* snap to a bar, hard-clamped to [start, upto] */
      var idx = Math.round((mx - g.plotL) / g.slotW - 0.5) + g.start;
      idx = clamp(idx, g.start, g.upto);                       // LOOKAHEAD clamp
      var b = g.bars[idx];
      if (!b) return;
      var cx = g.x(idx);

      ctx.save();
      ctx.strokeStyle = T.faint;
      ctx.globalAlpha = 0.8;
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(roundPx(cx), g.priceT);
      ctx.lineTo(roundPx(cx), g.volB);
      if (my <= g.priceB) {
        ctx.moveTo(g.plotL, roundPx(my));
        ctx.lineTo(g.plotR, roundPx(my));
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;

      /* price tag on the right axis */
      if (my >= g.priceT && my <= g.priceB) {
        var pxAt = g.yInv(my);
        ctx.font = font(10);
        var ptxt = fmtPx(pxAt, stepDp(g._pStep || 0.05));
        ctx.fillStyle = T.border;
        ctx.fillRect(g.axisL + 1, my - 7, g.axisW - 3, 14);
        ctx.fillStyle = T.text;
        ctx.textAlign = 'left';
        ctx.fillText(ptxt, g.axisL + 6, my + 3.5);
      }

      /* time tag on the bottom axis */
      ctx.font = font(10);
      var ttxt = barTime(b);
      var tw = ctx.measureText(ttxt).width + 10;
      var tbx = clamp(cx - tw / 2, g.plotL, g.plotR - tw);
      ctx.fillStyle = T.border;
      ctx.fillRect(tbx, g.timeT + 2, tw, 14);
      ctx.fillStyle = T.text;
      ctx.textAlign = 'center';
      ctx.fillText(ttxt, tbx + tw / 2, g.timeT + 12.5);
      ctx.textAlign = 'left';

      /* readout panel */
      var c = num(b.c, NaN), o = num(b.o, NaN);
      var upBar = (isFin(c) && isFin(o)) ? c >= o : true;
      var chg = (isFin(c) && isFin(o)) ? c - o : NaN;
      var segs = [
        [barTime(b), T.text],
        ['O', T.faint], [fmtPx(b.o), T.text],
        ['H', T.faint], [fmtPx(b.h), T.text],
        ['L', T.faint], [fmtPx(b.l), T.text],
        ['C', T.faint], [fmtPx(b.c), upBar ? T.up : T.down],
        [isFin(chg) ? fmtSigned(chg) : '--', upBar ? T.up : T.down],
        ['V', T.faint], [fmtVol(num(b.v, 0)), T.text]
      ];
      if (g.overlays.vwap && isFin(g.series.vwap[idx])) {
        segs.push(['VWAP', T.faint], [fmtPx(g.series.vwap[idx]), T.vwap]);
      }
      if (!isRth(b, g.openM)) segs.push(['PRE', T.amber]);

      ctx.font = font(10);
      var pad = 7, wsum = pad * 2;
      var i2;
      for (i2 = 0; i2 < segs.length; i2++) wsum += ctx.measureText(segs[i2][0]).width + 6;
      var bh = 17;
      var bx = g.plotL + 6, by = g.priceT + 6;
      /* if the cursor is up in the top-left, move the panel to the right */
      if (mx < bx + wsum + 20 && my < by + bh + 40) {
        bx = Math.max(g.plotL + 6, g.plotR - wsum - 6);
      }
      if (bx + wsum > g.plotR) bx = Math.max(g.plotL + 2, g.plotR - wsum - 2);

      ctx.fillStyle = T.bg;
      ctx.globalAlpha = 0.92;
      ctx.fillRect(bx, by, wsum, bh);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = T.border;
      ctx.strokeRect(roundPx(bx), roundPx(by), Math.round(wsum), bh);

      var tx2 = bx + pad;
      for (i2 = 0; i2 < segs.length; i2++) {
        ctx.fillStyle = segs[i2][1];
        ctx.fillText(segs[i2][0], tx2, by + 12);
        tx2 += ctx.measureText(segs[i2][0]).width + 6;
      }
      ctx.restore();
    }

    /* ------------------------------------------------------------------- *
     * Scheduling
     * ------------------------------------------------------------------- */
    function schedule() {
      if (destroyed || rafId) return;
      if (typeof global.requestAnimationFrame !== 'function') { draw(); return; }
      rafId = global.requestAnimationFrame(function () {
        rafId = 0;
        draw();
      });
    }

    /* ------------------------------------------------------------------- *
     * Mouse
     * ------------------------------------------------------------------- */
    function localPoint(ev) {
      var r = canvasEl.getBoundingClientRect();
      var sx = r.width ? (cssW / r.width) : 1;
      var sy = r.height ? (cssH / r.height) : 1;
      return { x: (ev.clientX - r.left) * sx, y: (ev.clientY - r.top) * sy };
    }

    function onMove(ev) {
      mouse = localPoint(ev);
      schedule();
    }
    function onLeave() {
      if (!mouse) return;
      mouse = null;
      schedule();
    }

    canvasEl.addEventListener('mousemove', onMove);
    canvasEl.addEventListener('mouseleave', onLeave);
    canvasEl.addEventListener('mouseout', onLeave);

    /* ------------------------------------------------------------------- *
     * Public API
     * ------------------------------------------------------------------- */
    var api = {
      render: function (nextCfg) {
        if (destroyed) return api;
        if (nextCfg) cfg = nextCfg;
        if (!cfg) cfg = { bars: [], upto: -1 };
        draw();                          /* synchronous: caller drives the clock */
        return api;
      },
      resize: function () {
        if (destroyed) return api;
        syncBackingStore();              /* re-reads clientWidth/clientHeight */
        draw();
        return api;
      },
      /* introspection helpers (handy for tests / the preview harness) */
      getGeom: function () { return geom; },
      destroy: function () {
        if (destroyed) return;
        destroyed = true;
        if (rafId && typeof global.cancelAnimationFrame === 'function') {
          global.cancelAnimationFrame(rafId);
        }
        rafId = 0;
        canvasEl.removeEventListener('mousemove', onMove);
        canvasEl.removeEventListener('mouseleave', onLeave);
        canvasEl.removeEventListener('mouseout', onLeave);
        cfg = null; geom = null; ind = null; mouse = null;
      }
    };

    syncBackingStore();
    return api;
  }

  global.Chart = {
    create: create,
    THEME: THEME,
    VERSION: VERSION
  };

})(typeof window !== 'undefined' ? window : this);
