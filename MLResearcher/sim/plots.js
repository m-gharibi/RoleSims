/* ============================================================================
 * sim/plots.js  —  window.Plots
 * Foundational ML Researcher Sim: hand-rolled canvas-2D plotting (SPEC §3).
 *
 * NO modules, NO imports, NO libraries, NO fetch. Loads via <script src>
 * from file:// and attaches a single global.
 *
 *   var p = Plots.create(canvasEl, { theme:"dark" });
 *   p.scaling({ series:[{id,label,color,points:[{params,effect,ciLow,ciHigh}]}],
 *               runScale:7e10, metric:"LCR@128k" });
 *   p.forest({ rows:[{label, effect, ciLow, ciHigh, n}] });
 *   p.budget({ used, total, byScale:{ "70m":420, ... } });
 *   p.truth({ series:[...], truthCurves:[{id,label,color,fn}], runScale });
 *   p.resize();
 *
 * ---------------------------------------------------------------------------
 * THE HONESTY RULE
 *   This module's job is not to make results look good. It is to make
 *   uncertainty impossible to ignore.
 *     - Error bars are drawn at EVERY point. There is no option to omit them.
 *       A 1-seed measurement has ~2x the sigma of a 4-seed one and therefore
 *       renders with a visibly taller whisker, a wider ribbon and a smaller
 *       (inverse-variance-weighted) marker than its 4-seed neighbour.
 *     - In forest(), any row whose 95% CI crosses zero is drawn in the neutral
 *       grey, at reduced alpha, with a hollow marker and an "ns" tag. You can
 *       see "this is noise" without doing arithmetic.
 *     - In scaling(), the x axis always runs out to the run scale (70B) even
 *       though nothing was ever measured there. The empty right-hand band and
 *       the dashed "RUN SCALE — you have no data here" rule are the single
 *       most important marks in the product: the extrapolation gap is drawn
 *       as literal empty space.
 *     - Search this file for "// HONEST" to find each of those.
 *
 * ---------------------------------------------------------------------------
 * SERIES PALETTE — why it is colour-blind-safe
 *   Base is the Okabe-Ito qualitative set (designed for protan/deutan/tritan
 *   discriminability), with three entries luminance-lifted so they hold up on
 *   the #0d1117 background. Colour is NEVER the only channel: every series
 *   also carries a distinct MARKER GLYPH and a distinct LINE DASH pattern, so
 *   the chart is still readable in full monochrome. With 8 categories no hue
 *   set alone is safe; the redundant encoding is what makes it safe.
 * ==========================================================================*/

;(function (global) {
  'use strict';

  var VERSION = '1.0.0';

  /* ---- SPEC §3 palette, exactly ------------------------------------- */
  var THEME = {
    bg:     '#0d1117',
    panel:  '#161b22',
    border: '#30363d',
    text:   '#c9d1d9',
    dim:    '#8b949e',
    good:   '#3fb950',
    bad:    '#f85149',
    warn:   '#d29922',
    accent: '#39c5cf',
    /* derived, for gridlines only */
    grid:      '#1b2027',
    gridStrong:'#242b34',
    faint:     '#6e7681'
  };

  /* Okabe-Ito, dark-background tuned. colour + glyph + dash = 3 channels. */
  var SERIES = [
    { color: '#56B4E9', marker: 'circle',  dash: [] },            /* sky blue      */
    { color: '#E69F00', marker: 'square',  dash: [8, 3] },        /* orange        */
    { color: '#33BB88', marker: 'triangle',dash: [3, 3] },        /* bluish green  */
    { color: '#CC79A7', marker: 'diamond', dash: [12, 4] },       /* redd. purple  */
    { color: '#F0E442', marker: 'plus',    dash: [5, 3] },        /* yellow        */
    { color: '#7EA6F0', marker: 'triDown', dash: [14, 4, 3, 4] }, /* blue (lifted) */
    { color: '#F0714A', marker: 'cross',   dash: [7, 2, 2, 2] },  /* vermillion    */
    { color: '#B9C2CC', marker: 'hex',     dash: [2, 2] }         /* light grey    */
  ];

  /* Canvas has no font-variant-numeric; a monospace face gives the same
   * tabular-figure guarantee, which is what SPEC §3 is actually asking for. */
  var MONO = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';
  function font(px, weight) { return (weight ? weight + ' ' : '') + px + 'px ' + MONO; }

  /* --------------------------------------------------------------------- *
   * Numeric helpers. Every one is NaN-hardened: nothing non-finite may ever
   * reach a canvas call.
   * --------------------------------------------------------------------- */
  function isFin(x) { return typeof x === 'number' && isFinite(x); }
  function num(x, d) { return (typeof x === 'number' && isFinite(x)) ? x : d; }
  function clamp(v, a, b) {
    if (!isFin(v)) return a;
    if (!isFin(a) || !isFin(b) || b < a) return isFin(v) ? v : 0;
    return v < a ? a : (v > b ? b : v);
  }
  function roundPx(v) { return Math.round(isFin(v) ? v : 0) + 0.5; }
  function log10(v) { return Math.log(v) / Math.LN10; }

  function fmtSigned(v, dp) {
    if (!isFin(v)) return '--';
    var s = Math.abs(v).toFixed(dp == null ? 2 : dp);
    if (parseFloat(s) === 0) return ' ' + s;          /* avoid "-0.00" */
    return (v > 0 ? '+' : '-') + s;
  }
  function fmtHours(v) {
    if (!isFin(v)) return '--';
    if (Math.abs(v) >= 10000) return String(Math.round(v));
    if (Math.abs(v) >= 100) return String(Math.round(v));
    return String(Math.round(v * 10) / 10);
  }
  function fmtPct(v) {
    if (!isFin(v)) return '--';
    return (Math.round(v * 10) / 10).toFixed(1) + '%';
  }

  /* 7e7 -> "70M", 1.4e9 -> "1.4B", 7e10 -> "70B" */
  function fmtParams(p) {
    if (!isFin(p) || p <= 0) return '--';
    var v = p, suf = '';
    if (p >= 1e12) { v = p / 1e12; suf = 'T'; }
    else if (p >= 1e9) { v = p / 1e9; suf = 'B'; }
    else if (p >= 1e6) { v = p / 1e6; suf = 'M'; }
    else if (p >= 1e3) { v = p / 1e3; suf = 'K'; }
    var r = Math.round(v * 100) / 100;
    return String(r) + suf;
  }

  /* nice axis step for a linear range */
  function niceStep(range, target) {
    if (!isFin(range) || range <= 0) return 1;
    var raw = range / Math.max(1, target);
    if (!isFin(raw) || raw <= 0) return 1;
    var mag = Math.pow(10, Math.floor(log10(raw)));
    if (!isFin(mag) || mag <= 0) return 1;
    var n = raw / mag, step;
    if (n <= 1) step = 1;
    else if (n <= 2) step = 2;
    else if (n <= 2.5) step = 2.5;
    else if (n <= 5) step = 5;
    else step = 10;
    var s = step * mag;
    return (isFin(s) && s > 0) ? s : 1;
  }
  function stepDp(step) {
    if (!isFin(step) || step <= 0) return 2;
    if (step >= 1) return step % 1 === 0 ? 0 : 1;
    if (step >= 0.1) return 1;
    if (step >= 0.01) return 2;
    return 3;
  }

  /* id -> pretty label: "1p4b" -> "1.4B", "70m" -> "70M" */
  function prettyScaleId(id) {
    var s = String(id == null ? '' : id);
    if (!s) return '--';
    if (/^[0-9]+p[0-9]+[a-z]$/i.test(s)) s = s.replace(/p/i, '.');
    return s.toUpperCase();
  }

  function truncate(ctx, txt, maxW) {
    txt = String(txt == null ? '' : txt);
    if (!isFin(maxW) || maxW <= 0) return '';
    if (ctx.measureText(txt).width <= maxW) return txt;
    var lo = 0, hi = txt.length;
    while (lo < hi) {
      var mid = (lo + hi + 1) >> 1;
      if (ctx.measureText(txt.slice(0, mid) + '…').width <= maxW) lo = mid; else hi = mid - 1;
    }
    return lo > 0 ? txt.slice(0, lo) + '…' : '';
  }

  /* --------------------------------------------------------------------- *
   * Instance
   * --------------------------------------------------------------------- */
  function create(canvasEl, opts) {
    opts = opts || {};
    if (!canvasEl || !canvasEl.getContext) {
      throw new Error('Plots.create: first argument must be a <canvas> element');
    }
    var ctx = canvasEl.getContext('2d');
    var T = THEME;                        /* only a dark theme exists today */

    var cssW = 0, cssH = 0, dpr = 0;
    var mode = null;                      /* 'scaling'|'forest'|'budget'|'truth' */
    var cfg = null;
    var destroyed = false;

    /* ---- sizing / HiDPI ---------------------------------------------- */
    function measure() {
      var w = canvasEl.clientWidth | 0;
      var h = canvasEl.clientHeight | 0;
      if (!w || !h) {
        var aw = canvasEl.width || 0, ah = canvasEl.height || 0;
        w = w || aw || 720;
        h = h || ah || 400;
        if (canvasEl.style) { canvasEl.style.width = w + 'px'; canvasEl.style.height = h + 'px'; }
      }
      return { w: w, h: h };
    }

    function syncBackingStore() {
      var d = global.devicePixelRatio || 1;
      if (!isFin(d) || d <= 0) d = 1;
      d = clamp(d, 1, 3);
      var s = measure();
      if (s.w === cssW && s.h === cssH && d === dpr) return false;
      cssW = s.w; cssH = s.h; dpr = d;
      canvasEl.width = Math.max(1, Math.round(cssW * dpr));
      canvasEl.height = Math.max(1, Math.round(cssH * dpr));
      return true;
    }

    /* Clear + set up the transform. Returns false when the canvas is too
     * small to say anything true, in which case we draw nothing but bg. */
    function begin() {
      syncBackingStore();
      if (!cssW || !cssH) return false;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);
      ctx.fillStyle = T.bg;
      ctx.fillRect(0, 0, cssW, cssH);
      ctx.lineCap = 'butt';
      ctx.lineJoin = 'miter';
      ctx.textBaseline = 'alphabetic';
      ctx.textAlign = 'left';
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1;
      return cssW >= 80 && cssH >= 60;    /* degenerate: near-zero canvas */
    }

    function tooSmall() {
      if (cssW < 24 || cssH < 12) return;
      ctx.fillStyle = T.faint;
      ctx.font = font(Math.max(8, Math.min(11, Math.floor(cssH / 4))));
      ctx.textAlign = 'center';
      ctx.fillText('·', cssW / 2, cssH / 2);
      ctx.textAlign = 'left';
    }

    function emptyMsg(r, msg) {
      ctx.font = font(11);
      var w = ctx.measureText(msg).width + 16;
      var cx = clamp(r.l + r.w / 2, 0, cssW), cy = clamp(r.t + r.h / 2, 10, cssH);
      ctx.fillStyle = T.bg;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(clamp(cx - w / 2, 0, cssW), cy - 12, w, 18);
      ctx.globalAlpha = 1;
      ctx.fillStyle = T.faint;
      ctx.textAlign = 'center';
      ctx.fillText(msg, cx, cy);
      ctx.textAlign = 'left';
    }

    /* ---- shared chrome ------------------------------------------------ */
    function drawTitle(title, sub) {
      var y = 15;
      if (title) {
        ctx.font = font(12, 'bold');
        ctx.fillStyle = T.text;
        ctx.textAlign = 'left';
        ctx.fillText(truncate(ctx, title, Math.max(10, cssW - 16)), 10, y);
      }
      if (sub) {
        ctx.font = font(10);
        ctx.fillStyle = T.dim;
        ctx.textAlign = 'right';
        ctx.fillText(truncate(ctx, sub, Math.max(10, cssW * 0.5)), cssW - 10, y);
        ctx.textAlign = 'left';
      }
      return title || sub ? 22 : 6;
    }

    /* Legend laid out as wrapped rows in a reserved band; returns its
     * height so the plot rect can never overlap it. */
    var LEG_GLYPH = 26, LEG_GAP = 16, LEG_ROW = 15;
    function legendLayout(items, availW) {
      var rows = [], cur = [], curW = 0;
      ctx.font = font(10);
      for (var i = 0; i < items.length; i++) {
        var w = LEG_GLYPH + ctx.measureText(String(items[i].label || '')).width + LEG_GAP;
        if (cur.length && curW + w > availW) { rows.push(cur); cur = []; curW = 0; }
        cur.push(items[i]); curW += w;
      }
      if (cur.length) rows.push(cur);
      return rows;
    }
    function legendHeight(items, availW) {
      if (!items || !items.length) return 0;
      return legendLayout(items, availW).length * LEG_ROW + 4;
    }
    function drawLegend(items, x, y, availW) {
      if (!items || !items.length) return 0;
      var rows = legendLayout(items, availW);
      ctx.font = font(10);
      ctx.textAlign = 'left';
      for (var r = 0; r < rows.length; r++) {
        var cx = x, cy = y + r * LEG_ROW + 8;
        for (var i = 0; i < rows[r].length; i++) {
          var it = rows[r][i];
          var col = it.color || T.dim;
          ctx.save();
          ctx.globalAlpha = it.muted ? 0.5 : 1;
          ctx.strokeStyle = col;
          ctx.lineWidth = it.thick ? 2 : 1.5;
          if (it.dash && it.dash.length) ctx.setLineDash(it.dash);
          ctx.beginPath();
          ctx.moveTo(cx, roundPx(cy - 3.5));
          ctx.lineTo(cx + 18, roundPx(cy - 3.5));
          ctx.stroke();
          ctx.setLineDash([]);
          if (it.marker) drawMarker(it.marker, cx + 9, cy - 3.5, 3.4, col, true);
          if (it.swatch) { ctx.fillStyle = col; ctx.fillRect(cx, cy - 8, 18, 8); }
          ctx.restore();
          ctx.fillStyle = it.muted ? T.faint : T.text;
          var label = String(it.label == null ? '' : it.label);
          ctx.fillText(label, cx + LEG_GLYPH, cy);
          cx += LEG_GLYPH + ctx.measureText(label).width + LEG_GAP;
        }
      }
      return rows.length * LEG_ROW + 4;
    }

    /* ---- markers ------------------------------------------------------ */
    function drawMarker(shape, x, y, r, color, filled) {
      if (!isFin(x) || !isFin(y)) return;
      r = clamp(num(r, 3.5), 1.2, 12);
      ctx.beginPath();
      switch (shape) {
        case 'square':
          ctx.rect(x - r, y - r, r * 2, r * 2); break;
        case 'triangle':
          ctx.moveTo(x, y - r * 1.2); ctx.lineTo(x + r * 1.1, y + r * 0.85);
          ctx.lineTo(x - r * 1.1, y + r * 0.85); ctx.closePath(); break;
        case 'triDown':
          ctx.moveTo(x, y + r * 1.2); ctx.lineTo(x + r * 1.1, y - r * 0.85);
          ctx.lineTo(x - r * 1.1, y - r * 0.85); ctx.closePath(); break;
        case 'diamond':
          ctx.moveTo(x, y - r * 1.25); ctx.lineTo(x + r * 1.1, y);
          ctx.lineTo(x, y + r * 1.25); ctx.lineTo(x - r * 1.1, y); ctx.closePath(); break;
        case 'plus':
          ctx.rect(x - r * 1.25, y - r * 0.42, r * 2.5, r * 0.84);
          ctx.rect(x - r * 0.42, y - r * 1.25, r * 0.84, r * 2.5); break;
        case 'cross': {
          var a = r * 0.95;
          ctx.moveTo(x - a, y - a); ctx.lineTo(x + a, y + a);
          ctx.moveTo(x + a, y - a); ctx.lineTo(x - a, y + a);
          ctx.strokeStyle = color; ctx.lineWidth = Math.max(1.4, r * 0.5);
          ctx.stroke(); ctx.lineWidth = 1; return;
        }
        case 'hex': {
          for (var k = 0; k < 6; k++) {
            var ang = Math.PI / 6 + k * Math.PI / 3;
            var px = x + r * 1.15 * Math.cos(ang), py = y + r * 1.15 * Math.sin(ang);
            if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
          }
          ctx.closePath(); break;
        }
        default:
          ctx.arc(x, y, r, 0, Math.PI * 2); break;
      }
      if (filled) { ctx.fillStyle = color; ctx.fill(); }
      else {
        ctx.fillStyle = T.bg; ctx.fill();
        ctx.strokeStyle = color; ctx.lineWidth = 1.6; ctx.stroke(); ctx.lineWidth = 1;
      }
    }

    /* --------------------------------------------------------------------- *
     * Series normalisation, shared by scaling() and truth().
     * --------------------------------------------------------------------- */
    function normSeries(list) {
      var out = [];
      if (!list || !list.length) return out;
      for (var i = 0; i < list.length; i++) {
        var s = list[i];
        if (!s) continue;
        var style = SERIES[out.length % SERIES.length];
        var pts = [];
        var raw = s.points || [];
        for (var j = 0; j < raw.length; j++) {
          var p = raw[j];
          if (!p) continue;
          var params = num(p.params, NaN);
          var eff = num(p.effect, NaN);
          if (!isFin(params) || params <= 0 || !isFin(eff)) continue;   /* junk dropped */
          var lo = num(p.ciLow, eff);
          var hi = num(p.ciHigh, eff);
          if (hi < lo) { var t = lo; lo = hi; hi = t; }
          pts.push({
            params: params, effect: eff, lo: lo, hi: hi,
            n: num(p.n, num(p.seeds, NaN))
          });
        }
        pts.sort(function (a, b) { return a.params - b.params; });
        out.push({
          id: s.id == null ? ('s' + i) : String(s.id),
          label: String(s.label == null ? (s.id == null ? ('series ' + (i + 1)) : s.id) : s.label),
          color: s.color || style.color,
          marker: s.marker || style.marker,
          dash: s.dash || style.dash,
          points: pts
        });
      }
      return out;
    }

    /* Inverse-variance marker sizing: a tight CI gets a big dot, a wide CI a
     * small one — the meta-analysis idiom. // HONEST */
    function widthScaler(series) {
      var lo = Infinity, hi = -Infinity;
      for (var i = 0; i < series.length; i++) {
        for (var j = 0; j < series[i].points.length; j++) {
          var w = series[i].points[j].hi - series[i].points[j].lo;
          if (!isFin(w)) continue;
          if (w < lo) lo = w;
          if (w > hi) hi = w;
        }
      }
      if (!isFin(lo) || !isFin(hi) || hi - lo < 1e-9) return function () { return 4.2; };
      return function (w) {
        if (!isFin(w)) return 4.2;
        var f = clamp((w - lo) / (hi - lo), 0, 1);
        return 5.4 - 2.6 * f;
      };
    }

    /* --------------------------------------------------------------------- *
     * Log-x axis shared by scaling() and truth()
     * --------------------------------------------------------------------- */
    var SPEC_TICKS = [7.0e7, 3.0e8, 1.4e9, 7.0e9, 7.0e10];

    function xDomain(series, runScale, extra) {
      var lo = 7.0e7, hi = 7.0e10;        /* SPEC §3: always out to 70B    */
      if (isFin(runScale) && runScale > 0 && runScale > hi) hi = runScale;
      if (isFin(runScale) && runScale > 0 && runScale < lo) lo = runScale;
      var i, j;
      for (i = 0; i < series.length; i++) {
        for (j = 0; j < series[i].points.length; j++) {
          var p = series[i].points[j].params;
          if (p < lo) lo = p;
          if (p > hi) hi = p;
        }
      }
      if (extra) for (i = 0; i < extra.length; i++) {
        if (isFin(extra[i]) && extra[i] > 0) {
          if (extra[i] < lo) lo = extra[i];
          if (extra[i] > hi) hi = extra[i];
        }
      }
      var l0 = log10(lo) - 0.16, l1 = log10(hi) + 0.16;
      if (!isFin(l0) || !isFin(l1) || l1 - l0 < 0.2) { l0 = 7.5; l1 = 11.2; }
      return { l0: l0, l1: l1 };
    }

    function makeX(dom, l, w) {
      var span = dom.l1 - dom.l0;
      if (!isFin(span) || span <= 0) span = 1;
      return function (params) {
        if (!isFin(params) || params <= 0) return NaN;
        var v = l + (log10(params) - dom.l0) / span * w;
        return isFin(v) ? v : NaN;
      };
    }

    function drawLogXAxis(dom, r, x, runScale) {
      var d, m, v, px;
      /* minor gridlines at 2..9 within each decade */
      ctx.strokeStyle = T.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (d = Math.floor(dom.l0); d <= Math.ceil(dom.l1); d++) {
        for (m = 2; m <= 9; m++) {
          v = m * Math.pow(10, d);
          px = x(v);
          if (!isFin(px) || px < r.l + 1 || px > r.l + r.w - 1) continue;
          ctx.moveTo(roundPx(px), r.t);
          ctx.lineTo(roundPx(px), r.t + r.h);
        }
      }
      ctx.stroke();

      /* decade lines, slightly stronger */
      ctx.strokeStyle = T.gridStrong;
      ctx.beginPath();
      for (d = Math.ceil(dom.l0); d <= Math.floor(dom.l1); d++) {
        px = x(Math.pow(10, d));
        if (!isFin(px) || px < r.l + 1 || px > r.l + r.w - 1) continue;
        ctx.moveTo(roundPx(px), r.t);
        ctx.lineTo(roundPx(px), r.t + r.h);
      }
      ctx.stroke();

      /* SPEC ticks: 70M / 300M / 1.4B / 7B / 70B */
      var ticks = SPEC_TICKS.slice();
      if (isFin(runScale) && runScale > 0) {
        var have = false;
        for (var i = 0; i < ticks.length; i++) {
          if (Math.abs(log10(ticks[i]) - log10(runScale)) < 0.02) have = true;
        }
        if (!have) ticks.push(runScale);
      }
      ticks.sort(function (a, b) { return a - b; });

      ctx.font = font(10);
      ctx.textAlign = 'center';
      var lastX = -1e9;
      for (var k = 0; k < ticks.length; k++) {
        px = x(ticks[k]);
        if (!isFin(px) || px < r.l - 0.5 || px > r.l + r.w + 0.5) continue;
        ctx.strokeStyle = T.border;
        ctx.beginPath();
        ctx.moveTo(roundPx(px), r.t + r.h);
        ctx.lineTo(roundPx(px), r.t + r.h + 4);
        ctx.stroke();
        if (px - lastX < 34) continue;           /* no overlapping labels */
        lastX = px;
        var isRun = isFin(runScale) && Math.abs(log10(ticks[k]) - log10(runScale)) < 0.02;
        ctx.fillStyle = isRun ? T.warn : T.dim;
        ctx.fillText(fmtParams(ticks[k]), clamp(px, r.l + 12, r.l + r.w - 12), r.t + r.h + 15);
      }
      ctx.textAlign = 'left';

      ctx.font = font(9);
      ctx.fillStyle = T.faint;
      ctx.textAlign = 'center';
      ctx.fillText('model parameters (log scale)', r.l + r.w / 2, r.t + r.h + 28);
      ctx.textAlign = 'left';
    }

    /* --------------------------------------------------------------------- *
     * Linear y axis
     * --------------------------------------------------------------------- */
    function yDomain(lo, hi, includeZero) {
      if (!isFin(lo) || !isFin(hi)) { lo = -1; hi = 1; }
      if (includeZero) { if (lo > 0) lo = 0; if (hi < 0) hi = 0; }
      if (hi < lo) { var t = lo; lo = hi; hi = t; }
      var rng = hi - lo;
      if (!isFin(rng) || rng <= 1e-9) {                /* all-equal values */
        var pad0 = Math.max(0.5, Math.abs(hi) * 0.15);
        lo -= pad0; hi += pad0; rng = hi - lo;
        if (!isFin(rng) || rng <= 0) { lo = -1; hi = 1; rng = 2; }
      }
      var pad = rng * 0.10;
      lo -= pad; hi += pad;
      rng = hi - lo;
      if (!isFin(rng) || rng <= 0) { lo = -1; hi = 1; }
      return { lo: lo, hi: hi };
    }

    function makeY(dom, t, h) {
      var rng = dom.hi - dom.lo;
      if (!isFin(rng) || rng <= 0) rng = 1;
      return function (v) {
        if (!isFin(v)) return NaN;
        var y = t + (dom.hi - v) / rng * h;
        return isFin(y) ? y : NaN;
      };
    }

    function drawYAxis(dom, r, y, unitLabel) {
      var step = niceStep(dom.hi - dom.lo, 6);
      var dp = stepDp(step);
      var first = Math.ceil(dom.lo / step) * step;
      ctx.strokeStyle = T.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      var v, py;
      for (v = first; v <= dom.hi + 1e-9; v += step) {
        py = y(v);
        if (!isFin(py) || py < r.t - 0.5 || py > r.t + r.h + 0.5) continue;
        ctx.moveTo(r.l, roundPx(py));
        ctx.lineTo(r.l + r.w, roundPx(py));
      }
      ctx.stroke();

      ctx.font = font(10);
      ctx.fillStyle = T.dim;
      ctx.textAlign = 'right';
      for (v = first; v <= dom.hi + 1e-9; v += step) {
        py = y(v);
        if (!isFin(py) || py < r.t + 4 || py > r.t + r.h - 1) continue;
        ctx.fillText(fmtSigned(v, dp), r.l - 6, py + 3.5);
      }
      ctx.textAlign = 'left';

      if (unitLabel && r.h > 90) {
        ctx.save();
        ctx.translate(11, r.t + r.h / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.font = font(9);
        ctx.fillStyle = T.faint;
        ctx.textAlign = 'center';
        ctx.fillText(truncate(ctx, unitLabel, r.h - 10), 0, 0);
        ctx.restore();
        ctx.textAlign = 'left';
      }
    }

    function drawZeroLine(r, y, horizontal) {
      var z = y(0);
      if (!isFin(z)) return;
      if (horizontal) {
        if (z < r.t - 0.5 || z > r.t + r.h + 0.5) return;
        ctx.strokeStyle = T.border;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(r.l, roundPx(z));
        ctx.lineTo(r.l + r.w, roundPx(z));
        ctx.stroke();
        ctx.lineWidth = 1;
      } else {
        if (z < r.l - 0.5 || z > r.l + r.w + 0.5) return;
        ctx.strokeStyle = T.border;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(roundPx(z), r.t);
        ctx.lineTo(roundPx(z), r.t + r.h);
        ctx.stroke();
        ctx.lineWidth = 1;
      }
    }

    function drawFrame(r) {
      ctx.strokeStyle = T.border;
      ctx.lineWidth = 1;
      ctx.strokeRect(roundPx(r.l), roundPx(r.t), Math.max(1, Math.round(r.w)), Math.max(1, Math.round(r.h)));
    }

    /* --------------------------------------------------------------------- *
     * THE RUN-SCALE RULE — the most important mark in the product. // HONEST
     *
     * Everything to the right of the last measurement is painted as an empty
     * warning band, and the run scale itself gets a dashed rule labelled
     * "RUN SCALE — you have no data here". The extrapolation gap is drawn as
     * literal empty space between the rightmost real point and this line.
     * --------------------------------------------------------------------- */
    var RUN_LABEL = 'RUN SCALE — you have no data here';

    function drawExtrapolationBand(r, x, maxMeasured) {
      var x0 = isFin(maxMeasured) && maxMeasured > 0 ? x(maxMeasured) : r.l;
      if (!isFin(x0)) x0 = r.l;
      x0 = clamp(x0, r.l, r.l + r.w);
      var w = r.l + r.w - x0;
      if (!(w > 2)) return;
      ctx.save();
      ctx.fillStyle = T.warn;
      ctx.globalAlpha = 0.055;
      ctx.fillRect(x0, r.t, w, r.h);
      /* diagonal hatch, so the band reads as "nothing here", not "data here" */
      ctx.globalAlpha = 0.05;
      ctx.strokeStyle = T.warn;
      ctx.lineWidth = 1;
      ctx.beginPath();
      var step = 11;
      for (var d = 0; d <= w + r.h; d += step) {
        var ax = x0 + d, ay = r.t;
        var bx = x0 + d - r.h, by = r.t + r.h;
        if (ax > x0 + w) { ay = r.t + (ax - (x0 + w)); ax = x0 + w; }
        if (bx < x0) { by = r.t + r.h - (x0 - bx); bx = x0; }
        if (!isFin(ax) || !isFin(ay) || !isFin(bx) || !isFin(by)) continue;
        if (ay > r.t + r.h || by < r.t) continue;
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
      }
      ctx.stroke();
      ctx.restore();

      if (w > 116) {
        /* bottom-LEFT of the band: the right-hand end belongs to the run-scale
         * rule and (on the debrief) its value chips */
        ctx.save();
        ctx.font = font(9);
        ctx.fillStyle = T.warn;
        ctx.globalAlpha = 0.75;
        ctx.textAlign = 'left';
        ctx.fillText('NO MEASUREMENTS', x0 + 8, r.t + r.h - 7);
        ctx.restore();
        ctx.textAlign = 'left';
      }
    }

    function drawRunScale(r, x, runScale) {
      if (!isFin(runScale) || runScale <= 0) return;
      var rx = x(runScale);
      if (!isFin(rx) || rx < r.l - 1 || rx > r.l + r.w + 1) return;
      rx = clamp(rx, r.l, r.l + r.w);

      ctx.save();
      ctx.strokeStyle = T.warn;
      ctx.lineWidth = 1.8;
      ctx.setLineDash([7, 5]);
      ctx.beginPath();
      ctx.moveTo(roundPx(rx), r.t);
      ctx.lineTo(roundPx(rx), r.t + r.h);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      /* label chip, right-aligned into the space left of the rule */
      ctx.font = font(10, 'bold');
      var avail = rx - r.l - 12;
      var lines;
      if (ctx.measureText(RUN_LABEL).width <= avail) lines = [RUN_LABEL];
      else {
        lines = ['RUN SCALE —', 'you have no data here'];
        if (ctx.measureText(lines[1]).width > avail) lines = ['RUN', 'SCALE', 'NO DATA'];
      }
      var wmax = 0, i;
      for (i = 0; i < lines.length; i++) wmax = Math.max(wmax, ctx.measureText(lines[i]).width);
      var padx = 5, lh = 13;
      var bh = lines.length * lh + 5;
      var bw = wmax + padx * 2;
      var bx = rx - 6 - bw;
      if (bx < r.l + 2) bx = Math.min(rx + 6, r.l + r.w - bw - 2);
      bx = clamp(bx, r.l + 1, Math.max(r.l + 1, r.l + r.w - bw - 1));
      var by = r.t + 5;

      ctx.fillStyle = T.bg;
      ctx.globalAlpha = 0.88;
      ctx.fillRect(bx, by, bw, bh);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = T.warn;
      ctx.lineWidth = 1;
      ctx.strokeRect(roundPx(bx), roundPx(by), Math.round(bw), Math.round(bh));
      ctx.fillStyle = T.warn;
      ctx.textAlign = 'left';
      for (i = 0; i < lines.length; i++) {
        ctx.font = font(10, i === 0 ? 'bold' : '');
        ctx.fillText(lines[i], bx + padx, by + 12 + i * lh);
      }
      ctx.font = font(10);

      /* a small pointer at the foot of the rule */
      ctx.fillStyle = T.warn;
      ctx.beginPath();
      ctx.moveTo(rx, r.t + r.h);
      ctx.lineTo(rx + 4, r.t + r.h + 6);
      ctx.lineTo(rx - 4, r.t + r.h + 6);
      ctx.closePath();
      ctx.fill();
      return { bx: bx, by: by, bw: bw, bh: bh };
    }

    /* --------------------------------------------------------------------- *
     * Error bars — never optional. // HONEST
     * --------------------------------------------------------------------- */
    function drawErrorBarV(px, yTop, yBot, color, alpha, cap) {
      if (!isFin(px) || !isFin(yTop) || !isFin(yBot)) return;
      ctx.save();
      ctx.globalAlpha = alpha == null ? 0.95 : alpha;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(roundPx(px), yTop);
      ctx.lineTo(roundPx(px), yBot);
      var c = cap == null ? 4 : cap;
      ctx.moveTo(px - c, roundPx(yTop)); ctx.lineTo(px + c, roundPx(yTop));
      ctx.moveTo(px - c, roundPx(yBot)); ctx.lineTo(px + c, roundPx(yBot));
      ctx.stroke();
      ctx.restore();
    }

    /* --------------------------------------------------------------------- *
     * scaling() — the centrepiece
     * --------------------------------------------------------------------- */
    function drawScaling(c, withTruth) {
      c = c || {};
      var series = normSeries(c.series);
      var runScale = num(c.runScale, 7.0e10);
      var metric = c.metric ? String(c.metric) : 'effect';
      var curves = withTruth ? normCurves(c.truthCurves, series) : [];

      /* x domain + curve sampling do not depend on the plot rect, so do them
       * first: the legend must only advertise curves that actually render. */
      var dom = xDomain(series, runScale, null);
      var samples = curves.length ? sampleCurves(curves, dom, 140) : [];
      var drawnCurve = {};
      for (var q = 0; q < samples.length; q++) {
        var anyFin = false;
        for (var q2 = 0; q2 < samples[q].vals.length; q2++) {
          if (isFin(samples[q].vals[q2].v)) { anyFin = true; break; }
        }
        if (anyFin) drawnCurve[samples[q].curve.id] = true;
      }

      var headTop = drawTitle(
        withTruth ? 'TRUTH vs MEASUREMENT' : 'EFFECT vs MODEL SCALE',
        withTruth ? 'dashed = true effect · markers = what you measured'
                  : metric + ' · 95% CI'
      );

      var padL = 56, padR = 16, padB = 36;
      var legItems = [], i, seen = {};
      for (i = 0; i < series.length; i++) {
        seen[series[i].id] = true;
        legItems.push({ label: series[i].label, color: series[i].color,
                        marker: series[i].marker, dash: series[i].dash });
      }
      /* a truth curve for something never measured still needs a key entry —
       * otherwise the debrief shows an unexplained line. */
      for (i = 0; i < curves.length; i++) {
        if (seen[curves[i].id] || !drawnCurve[curves[i].id]) continue;
        seen[curves[i].id] = true;
        legItems.push({ label: curves[i].label + ' (never measured)',
                        color: curves[i].color, dash: [6, 4], muted: true });
      }
      if (withTruth && curves.length) legItems.push({ label: 'dashed = TRUE effect', color: T.text, dash: [6, 4], thick: true });
      var availW = Math.max(40, cssW - 20);
      var legH = legendHeight(legItems, availW);
      var plotT = headTop + legH + 4;
      var r = {
        l: padL, t: plotT,
        w: Math.max(30, cssW - padL - padR),
        h: Math.max(30, cssH - plotT - padB)
      };
      drawLegend(legItems, 10, headTop, availW);

      ctx.fillStyle = T.panel;
      ctx.fillRect(r.l, r.t, r.w, r.h);

      /* ---- domains ---- */
      var x = makeX(dom, r.l, r.w);

      var lo = Infinity, hi = -Infinity, j, s, p;
      var maxMeasured = NaN, anyPoint = false;
      for (i = 0; i < series.length; i++) {
        s = series[i];
        for (j = 0; j < s.points.length; j++) {
          p = s.points[j];
          anyPoint = true;
          if (p.lo < lo) lo = p.lo;
          if (p.hi > hi) hi = p.hi;
          if (p.effect < lo) lo = p.effect;
          if (p.effect > hi) hi = p.effect;
          if (!isFin(maxMeasured) || p.params > maxMeasured) maxMeasured = p.params;
        }
      }
      /* truth curves may extend the y range, but only within a sane gate so a
       * wild fn() cannot crush the measured data into a line */
      if (samples.length) {
        var base = isFin(lo) && isFin(hi) ? Math.max(1e-6, hi - lo) : 1;
        var gLo = isFin(lo) ? lo - base * 1.6 : -1e6;
        var gHi = isFin(hi) ? hi + base * 1.6 : 1e6;
        for (i = 0; i < samples.length; i++) {
          var ss = samples[i].vals;
          for (j = 0; j < ss.length; j++) {
            var v = ss[j].v;
            if (!isFin(v)) continue;
            if (!anyPoint) { if (v < lo) lo = v; if (v > hi) hi = v; continue; }
            if (v < lo && v >= gLo) lo = v;
            if (v > hi && v <= gHi) hi = v;
          }
        }
      }
      var ydom = yDomain(lo, hi, true);
      var y = makeY(ydom, r.t, r.h);

      drawYAxis(ydom, r, y, metric + ' (points)');
      drawLogXAxis(dom, r, x, runScale);
      drawExtrapolationBand(r, x, maxMeasured);
      drawZeroLine(r, y, true);

      /* ---- data ---- */
      ctx.save();
      ctx.beginPath();
      ctx.rect(r.l, r.t, r.w, r.h);
      ctx.clip();

      var sizeOf = widthScaler(series);

      /* Every series measures at the SAME four scales, so without a dodge the
       * error bars stack on one pixel column and the uncertainty becomes
       * unreadable. Offset each series a couple of px around its tick. */
      var tickGap = r.w / Math.max(3, (dom.l1 - dom.l0) / 0.35);
      var dstep = clamp(tickGap / Math.max(2, series.length * 2.4), 1.6, 6);
      var dodge = function (k) {
        if (series.length < 2) return 0;
        var v = (k - (series.length - 1) / 2) * dstep;
        return isFin(v) ? v : 0;
      };

      /* uncertainty ribbons first, behind everything (scaling only — in the
       * debrief they just muddy the measured-vs-true comparison) */
      for (i = 0; i < series.length && !withTruth; i++) {
        s = series[i];
        if (s.points.length < 2) continue;
        ctx.save();
        /* many overlapping ribbons compound into mud — thin them out */
        ctx.globalAlpha = clamp(0.45 / Math.max(1, series.length), 0.035, 0.15);
        ctx.fillStyle = s.color;
        ctx.beginPath();
        var started = false;
        for (j = 0; j < s.points.length; j++) {
          p = s.points[j];
          var px = x(p.params) + dodge(i), py = y(p.hi);
          if (!isFin(px) || !isFin(py)) continue;
          if (!started) { ctx.moveTo(px, py); started = true; } else ctx.lineTo(px, py);
        }
        for (j = s.points.length - 1; j >= 0; j--) {
          p = s.points[j];
          var px2 = x(p.params) + dodge(i), py2 = y(p.lo);
          if (!isFin(px2) || !isFin(py2)) continue;
          ctx.lineTo(px2, py2);
        }
        if (started) { ctx.closePath(); ctx.fill(); }
        ctx.restore();
      }

      /* truth curves (dashed, smooth) sit under the markers */
      if (samples.length) drawTruthCurves(samples, r, x, y);

      /* connectors from each measured point to the truth curve at that x */
      if (samples.length) drawTruthGaps(series, samples, r, x, y, dodge);

      /* lines through measured points */
      for (i = 0; i < series.length; i++) {
        s = series[i];
        if (s.points.length < 2) continue;
        ctx.save();
        ctx.strokeStyle = s.color;
        ctx.lineWidth = withTruth ? 1.1 : 1.8;
        ctx.globalAlpha = withTruth ? 0.45 : 1;
        if (s.dash && s.dash.length) ctx.setLineDash(s.dash);
        ctx.beginPath();
        var pen = false;
        for (j = 0; j < s.points.length; j++) {
          p = s.points[j];
          var lx = x(p.params) + dodge(i), ly = y(p.effect);
          if (!isFin(lx) || !isFin(ly)) { pen = false; continue; }
          if (!pen) { ctx.moveTo(lx, ly); pen = true; } else ctx.lineTo(lx, ly);
        }
        ctx.stroke();
        ctx.restore();
      }

      /* error bars + markers */
      for (i = 0; i < series.length; i++) {
        s = series[i];
        for (j = 0; j < s.points.length; j++) {
          p = s.points[j];
          var mx = x(p.params) + dodge(i);
          var myTop = y(p.hi), myBot = y(p.lo), my = y(p.effect);
          if (!isFin(mx) || !isFin(my)) continue;
          if (isFin(myTop) && isFin(myBot)) {
            /* zero-width CI still gets caps: the mark says "we measured
             * exactly this", which is itself information. // HONEST */
            if (Math.abs(myTop - myBot) < 1.2) { myTop = my - 0.6; myBot = my + 0.6; }
            drawErrorBarV(mx, myTop, myBot, s.color, 0.9, 4.5);
          }
          drawMarker(s.marker, mx, my, sizeOf(p.hi - p.lo), s.color, true);
        }
      }
      /* the zero rule's label goes on TOP of the data, or the ribbons eat it */
      var zy = y(0);
      if (isFin(zy) && zy > r.t + 10 && zy < r.t + r.h - 2) {
        ctx.font = font(9);
        var zw = ctx.measureText('0 · no effect').width + 6;
        ctx.fillStyle = T.bg;
        ctx.globalAlpha = 0.75;
        ctx.fillRect(r.l + 2, zy - 13, zw, 12);
        ctx.globalAlpha = 1;
        ctx.fillStyle = T.dim;
        ctx.fillText('0 · no effect', r.l + 5, zy - 4);
      }
      ctx.restore();

      drawFrame(r);
      var chip = drawRunScale(r, x, runScale);
      /* DEBRIEF PAYOFF: what each true effect actually is at the run scale,
       * printed into the empty band where the player has no data. // HONEST */
      if (withTruth && samples.length) drawRunScaleTruth(samples, r, x, y, runScale, maxMeasured, chip);

      if (!anyPoint && !samples.length) {
        emptyMsg(r, 'NO EXPERIMENTS YET — run something');
      } else if (!anyPoint) {
        emptyMsg(r, 'YOU MEASURED NOTHING — this is all truth, none of it yours');
      }
    }

    /* The number the whole week was about: the true effect AT the run scale.
     * It is printed inside the empty extrapolation band — the one place on
     * the chart where there is, by construction, nothing else to collide
     * with — with leader lines when labels have to be pushed apart. */
    function drawRunScaleTruth(samples, r, x, y, runScale, maxMeasured, chip) {
      if (!isFin(runScale) || runScale <= 0) return;
      var rx = x(runScale);
      if (!isFin(rx)) return;
      rx = clamp(rx, r.l, r.l + r.w);
      var x0 = (isFin(maxMeasured) && maxMeasured > 0) ? x(maxMeasured) : r.l;
      if (!isFin(x0)) x0 = r.l;
      var space = rx - Math.max(r.l, x0);

      ctx.font = font(10, 'bold');
      var items = [], i;
      for (i = 0; i < samples.length; i++) {
        var v = curveAt(samples[i], runScale);
        if (!isFin(v)) continue;
        var py = y(v);
        if (!isFin(py)) continue;
        items.push({ v: v, py: clamp(py, r.t + 1, r.t + r.h - 1), color: samples[i].curve.color });
      }
      if (!items.length) return;
      items.sort(function (a, b) { return a.py - b.py; });

      var chipW = ctx.measureText('+00.00').width + 10;
      if (space < chipW + 14) return;            /* no room: draw dots only */

      /* stay clear of the RUN SCALE chip — they share the same x band */
      var lo = r.t + 4;
      if (chip && isFin(chip.by) && isFin(chip.bh)) lo = Math.max(lo, chip.by + chip.bh + 15);
      var hi2 = r.t + r.h - 4, gap = 15;
      if (hi2 - lo < items.length * 11) lo = r.t + 4;    /* not enough room */
      if (hi2 - lo < items.length * gap) gap = Math.max(9, (hi2 - lo) / Math.max(1, items.length));
      var prev = -1e9, ly = [];
      for (i = 0; i < items.length; i++) {
        var yy = clamp(Math.max(items[i].py, prev + gap), lo, hi2);
        ly.push(yy); prev = yy;
      }
      for (i = items.length - 1; i >= 0; i--) {   /* bottom-up fix-up */
        if (i < items.length - 1 && ly[i] > ly[i + 1] - gap) ly[i] = ly[i + 1] - gap;
        if (ly[i] < lo) ly[i] = lo + i * gap;
      }

      for (i = 0; i < items.length; i++) {
        var it = items[i], cy = clamp(ly[i], r.t + 1, r.t + r.h - 1);
        var txt = fmtSigned(it.v);
        var w = ctx.measureText(txt).width + 8;
        var bx = rx - 7 - w;
        if (bx < r.l + 2) break;
        ctx.save();
        if (Math.abs(cy - it.py) > 1.5) {         /* leader line */
          ctx.strokeStyle = it.color;
          ctx.globalAlpha = 0.5;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(rx - 4, it.py);
          ctx.lineTo(bx + w + 2, cy - 3.5);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
        ctx.fillStyle = T.bg;
        ctx.globalAlpha = 0.9;
        ctx.fillRect(bx, cy - 11, w, 13);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = it.color;
        ctx.lineWidth = 1;
        ctx.strokeRect(roundPx(bx), roundPx(cy - 11), Math.round(w), 13);
        ctx.fillStyle = it.color;
        ctx.textAlign = 'left';
        ctx.fillText(txt, bx + 4, cy - 1.5);
        /* the true value's actual position on the rule */
        ctx.beginPath();
        ctx.arc(rx, it.py, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      ctx.textAlign = 'left';
      ctx.font = font(10);
    }

    /* ---- truth curve helpers ------------------------------------------ */
    function normCurves(list, series) {
      var out = [];
      if (!list || !list.length) return out;
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if (!c || typeof c.fn !== 'function') continue;
        var color = c.color, label = c.label, marker = null;
        if (series) {
          for (var j = 0; j < series.length; j++) {
            if (series[j].id === String(c.id)) {
              if (!color) color = series[j].color;
              if (!label) label = series[j].label;
              marker = series[j].marker;
              break;
            }
          }
        }
        if (!color) color = SERIES[out.length % SERIES.length].color;
        out.push({
          id: c.id == null ? ('c' + i) : String(c.id),
          label: String(label == null ? (c.id == null ? 'truth' : c.id) : label),
          color: color, marker: marker, fn: c.fn
        });
      }
      return out;
    }

    function sampleCurves(curves, dom, n) {
      var out = [];
      for (var i = 0; i < curves.length; i++) {
        var c = curves[i], vals = [];
        try {
          for (var k = 0; k <= n; k++) {
            var lp = dom.l0 + (dom.l1 - dom.l0) * (k / n);
            var params = Math.pow(10, lp);
            if (!isFin(params) || params <= 0) continue;
            var v = c.fn(params);
            vals.push({ p: params, v: (typeof v === 'number' && isFinite(v)) ? v : NaN });
          }
        } catch (e) { vals = []; }
        if (vals.length) out.push({ curve: c, vals: vals });
      }
      return out;
    }

    function drawTruthCurves(samples, r, x, y) {
      for (var i = 0; i < samples.length; i++) {
        var s = samples[i];
        ctx.save();
        ctx.strokeStyle = s.curve.color;
        ctx.lineWidth = 2.2;
        ctx.globalAlpha = 0.95;
        ctx.setLineDash([7, 5]);
        ctx.beginPath();
        var pen = false;
        for (var k = 0; k < s.vals.length; k++) {
          var px = x(s.vals[k].p), py = y(s.vals[k].v);
          if (!isFin(px) || !isFin(py) || py < r.t - 4000 || py > r.t + r.h + 4000) { pen = false; continue; }
          if (!pen) { ctx.moveTo(px, py); pen = true; } else ctx.lineTo(px, py);
        }
        ctx.stroke();
        ctx.restore();
      }
    }

    function curveAt(sample, params) {
      var vals = sample.vals;
      if (!vals.length) return NaN;
      /* the samples are on a uniform log grid, so index directly */
      var l0 = log10(vals[0].p), l1 = log10(vals[vals.length - 1].p);
      if (!isFin(l0) || !isFin(l1) || l1 <= l0) return NaN;
      var f = (log10(params) - l0) / (l1 - l0);
      if (!isFin(f) || f < 0 || f > 1) return NaN;
      var idx = clamp(Math.round(f * (vals.length - 1)), 0, vals.length - 1);
      var v = vals[idx].v;
      return isFin(v) ? v : NaN;
    }

    /* Where a measured point sits far from its own true curve, draw the gap
     * explicitly — red when the truth falls OUTSIDE the measured 95% CI.
     * That is the "you were fooled by noise" moment. // HONEST */
    function drawTruthGaps(series, samples, r, x, y, dodge) {
      var byId = {};
      for (var i = 0; i < samples.length; i++) byId[samples[i].curve.id] = samples[i];
      for (i = 0; i < series.length; i++) {
        var s = series[i];
        var sm = byId[s.id];
        if (!sm) continue;
        for (var j = 0; j < s.points.length; j++) {
          var p = s.points[j];
          var tv = curveAt(sm, p.params);
          if (!isFin(tv)) continue;
          var px = x(p.params) + (dodge ? dodge(i) : 0), y0 = y(p.effect), y1 = y(tv);
          if (!isFin(px) || !isFin(y0) || !isFin(y1)) continue;
          if (Math.abs(y0 - y1) < 2) continue;
          var outside = tv < p.lo || tv > p.hi;
          ctx.save();
          ctx.strokeStyle = outside ? T.bad : T.faint;
          ctx.globalAlpha = outside ? 0.95 : 0.5;
          ctx.lineWidth = outside ? 2 : 1;
          ctx.setLineDash(outside ? [] : [2, 2]);
          ctx.beginPath();
          ctx.moveTo(roundPx(px), y0);
          ctx.lineTo(roundPx(px), y1);
          ctx.stroke();
          ctx.setLineDash([]);
          if (outside) {
            ctx.fillStyle = T.bad;
            ctx.beginPath();
            ctx.arc(px, y1, 2.6, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();
        }
      }
    }

    /* --------------------------------------------------------------------- *
     * forest()
     * --------------------------------------------------------------------- */
    function drawForest(c) {
      c = c || {};
      var raw = c.rows || [];
      var rows = [];
      for (var i = 0; i < raw.length; i++) {
        var R = raw[i];
        if (!R) continue;
        var eff = num(R.effect, NaN);
        if (!isFin(eff)) continue;                  /* junk dropped */
        var lo = num(R.ciLow, eff), hi = num(R.ciHigh, eff);
        if (hi < lo) { var t = lo; lo = hi; hi = t; }
        rows.push({
          label: String(R.label == null ? (R.id == null ? '?' : R.id) : R.label),
          effect: eff, lo: lo, hi: hi,
          n: num(R.n, NaN),
          crosses: lo <= 0 && hi >= 0
        });
      }
      rows.sort(function (a, b) { return b.effect - a.effect; });

      var headTop = drawTitle('FOREST — measured effect ± 95% CI',
                              c.metric ? String(c.metric) : 'sorted by effect');
      var legItems = [
        { label: 'positive', color: T.good, swatch: true },
        { label: 'negative', color: T.bad, swatch: true },
        { label: 'CI crosses 0 — indistinguishable from noise', color: T.faint, swatch: true, muted: true }
      ];
      var availW = Math.max(40, cssW - 20);
      var legH = legendHeight(legItems, availW);
      drawLegend(legItems, 10, headTop, availW);

      var padB = 30;
      var top = headTop + legH + 6;
      var bottom = Math.max(top + 24, cssH - padB);

      if (!rows.length) {
        var rr = { l: 10, t: top, w: Math.max(20, cssW - 20), h: Math.max(20, bottom - top) };
        ctx.fillStyle = T.panel;
        ctx.fillRect(rr.l, rr.t, rr.w, rr.h);
        drawFrame(rr);
        emptyMsg(rr, 'NO RESULTS YET');
        return;
      }

      /* column widths */
      var rowH = clamp((bottom - top) / rows.length, 13, 38);
      var fs = clamp(Math.floor(rowH * 0.45), 8, 12);
      ctx.font = font(fs);

      var statTexts = [], maxStat = 0;
      for (i = 0; i < rows.length; i++) {
        var st = fmtSigned(rows[i].effect) + ' [' + fmtSigned(rows[i].lo) + ', ' + fmtSigned(rows[i].hi) + ']' +
                 (isFin(rows[i].n) ? '  n=' + Math.round(rows[i].n) : '');
        statTexts.push(st);
        maxStat = Math.max(maxStat, ctx.measureText(st).width);
      }
      var statW = Math.min(maxStat + 26, Math.max(60, cssW * 0.38));
      var labelW = clamp(cssW * 0.26, 60, 200);
      var r = {
        l: 10 + labelW + 8,
        t: top,
        w: Math.max(40, cssW - (10 + labelW + 8) - statW - 10),
        h: Math.max(24, rows.length * rowH)
      };
      if (r.t + r.h > bottom) r.h = Math.max(24, bottom - r.t);
      /* centre the block vertically so a 3-row plot isn't stranded at the top */
      r.t = top + Math.max(0, (bottom - top - r.h) / 2);
      rowH = r.h / rows.length;

      /* x domain over all CI ends, always including 0 */
      var lo2 = Infinity, hi2 = -Infinity;
      for (i = 0; i < rows.length; i++) {
        if (rows[i].lo < lo2) lo2 = rows[i].lo;
        if (rows[i].hi > hi2) hi2 = rows[i].hi;
        if (rows[i].effect < lo2) lo2 = rows[i].effect;
        if (rows[i].effect > hi2) hi2 = rows[i].effect;
      }
      var xdom = yDomain(lo2, hi2, true);
      var span = xdom.hi - xdom.lo;
      var X = function (v) {
        if (!isFin(v)) return NaN;
        var px = r.l + (v - xdom.lo) / span * r.w;
        return isFin(px) ? px : NaN;
      };

      ctx.fillStyle = T.panel;
      ctx.fillRect(r.l, r.t, r.w, r.h);

      /* vertical gridlines + labels */
      var step = niceStep(span, Math.max(3, Math.floor(r.w / 70)));
      var dp = stepDp(step);
      var first = Math.ceil(xdom.lo / step) * step;
      ctx.strokeStyle = T.grid;
      ctx.beginPath();
      var v2, gx;
      for (v2 = first; v2 <= xdom.hi + 1e-9; v2 += step) {
        gx = X(v2);
        if (!isFin(gx) || gx < r.l + 1 || gx > r.l + r.w - 1) continue;
        ctx.moveTo(roundPx(gx), r.t);
        ctx.lineTo(roundPx(gx), r.t + r.h);
      }
      ctx.stroke();
      ctx.font = font(10);
      ctx.fillStyle = T.dim;
      ctx.textAlign = 'center';
      var lastLx = -1e9;
      for (v2 = first; v2 <= xdom.hi + 1e-9; v2 += step) {
        gx = X(v2);
        if (!isFin(gx) || gx < r.l || gx > r.l + r.w) continue;
        if (gx - lastLx < 42) continue;
        lastLx = gx;
        ctx.fillText(fmtSigned(v2, dp), clamp(gx, r.l + 14, r.l + r.w - 14), r.t + r.h + 15);
      }
      ctx.textAlign = 'left';

      /* zero rule */
      var zx = X(0);
      if (isFin(zx) && zx >= r.l && zx <= r.l + r.w) {
        ctx.save();
        ctx.strokeStyle = T.border;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(roundPx(zx), r.t);
        ctx.lineTo(roundPx(zx), r.t + r.h);
        ctx.stroke();
        ctx.restore();
      }

      /* rows */
      var sizeOf = (function () {
        var wlo = Infinity, whi = -Infinity;
        for (var k = 0; k < rows.length; k++) {
          var w = rows[k].hi - rows[k].lo;
          if (!isFin(w)) continue;
          if (w < wlo) wlo = w;
          if (w > whi) whi = w;
        }
        if (!isFin(wlo) || !isFin(whi) || whi - wlo < 1e-9) return function () { return clamp(rowH * 0.22, 2.5, 5); };
        return function (w) {
          var f = clamp((w - wlo) / (whi - wlo), 0, 1);
          return clamp(rowH * (0.30 - 0.13 * f), 2.2, 6);
        };
      })();

      for (i = 0; i < rows.length; i++) {
        var row = rows[i];
        var cy = r.t + (i + 0.5) * rowH;
        if (!isFin(cy)) continue;

        /* zebra */
        if (i % 2 === 1) {
          ctx.save();
          ctx.globalAlpha = 0.35;
          ctx.fillStyle = T.bg;
          ctx.fillRect(r.l, r.t + i * rowH, r.w, rowH);
          ctx.restore();
        }

        /* HONEST: a CI that crosses zero is drawn grey, dimmed, hollow and
         * tagged "ns" — no arithmetic needed to see it is noise. */
        var muted = row.crosses;
        var col = muted ? T.faint : (row.effect >= 0 ? T.good : T.bad);
        var alpha = muted ? 0.5 : 1;

        var xl = X(row.lo), xh = X(row.hi), xe = X(row.effect);
        var capH = clamp(rowH * 0.26, 2, 6);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = col;
        ctx.lineWidth = muted ? 1.2 : 1.6;
        if (isFin(xl) && isFin(xh)) {
          var a = clamp(xl, r.l, r.l + r.w), b = clamp(xh, r.l, r.l + r.w);
          if (Math.abs(b - a) < 1.2) { a -= 0.6; b += 0.6; }      /* zero-width CI */
          ctx.beginPath();
          ctx.moveTo(a, roundPx(cy));
          ctx.lineTo(b, roundPx(cy));
          ctx.moveTo(roundPx(a), cy - capH); ctx.lineTo(roundPx(a), cy + capH);
          ctx.moveTo(roundPx(b), cy - capH); ctx.lineTo(roundPx(b), cy + capH);
          ctx.stroke();
        }
        if (isFin(xe)) {
          drawMarker(muted ? 'circle' : 'square', clamp(xe, r.l, r.l + r.w), cy,
                     sizeOf(row.hi - row.lo), col, !muted);
        }
        ctx.restore();

        /* label */
        ctx.font = font(fs);
        ctx.fillStyle = muted ? T.faint : T.text;
        ctx.textAlign = 'right';
        ctx.fillText(truncate(ctx, row.label, labelW - 4), 10 + labelW, cy + fs * 0.36);

        /* stats */
        ctx.textAlign = 'left';
        ctx.fillStyle = muted ? T.faint : T.dim;
        var sx = r.l + r.w + 8;
        ctx.fillText(truncate(ctx, statTexts[i], statW - 26), sx, cy + fs * 0.36);
        if (muted) {
          ctx.fillStyle = T.faint;
          ctx.font = font(Math.max(8, fs - 1), 'bold');
          ctx.fillText('ns', clamp(cssW - 20, sx, cssW - 4), cy + fs * 0.36);
        }
      }
      ctx.textAlign = 'left';

      drawFrame(r);

      ctx.font = font(9);
      ctx.fillStyle = T.faint;
      ctx.textAlign = 'center';
      ctx.fillText('effect (metric points)', r.l + r.w / 2, r.t + r.h + 26);
      ctx.textAlign = 'left';
    }

    /* --------------------------------------------------------------------- *
     * budget()
     * --------------------------------------------------------------------- */
    function drawBudget(c) {
      c = c || {};
      var total = num(c.total, NaN);
      var used = num(c.used, NaN);
      var by = c.byScale || {};
      var keys = [], k;
      for (k in by) if (Object.prototype.hasOwnProperty.call(by, k)) {
        if (isFin(num(by[k], NaN)) && num(by[k], 0) > 0) keys.push(k);
      }
      keys.sort(function (a, b) { return num(by[b], 0) - num(by[a], 0); });

      var segSum = 0;
      for (var i = 0; i < keys.length; i++) segSum += num(by[keys[i]], 0);
      if (!isFin(used)) used = segSum;
      if (used < 0) used = 0;
      if (!isFin(total) || total <= 0) total = Math.max(used, segSum, 1);

      var pct = total > 0 ? (used / total) * 100 : 0;
      var over = used > total;

      var headTop = drawTitle('COMPUTE BUDGET',
        fmtHours(used) + ' / ' + fmtHours(total) + ' GPU-h  ·  ' + fmtPct(pct));

      var barL = 12, barW = Math.max(20, cssW - 24);
      var barT = headTop + 8;
      var barH = clamp(cssH * 0.16, 18, 40);

      /* track */
      ctx.fillStyle = T.panel;
      ctx.fillRect(barL, barT, barW, barH);

      var scale = total > 0 ? barW / total : 0;
      var cursor = barL;
      var segs = [];
      for (i = 0; i < keys.length; i++) {
        var hrs = num(by[keys[i]], 0);
        var w = clamp(hrs * scale, 0, barW);
        if (!isFin(w)) w = 0;
        var style = SERIES[i % SERIES.length];
        segs.push({ key: keys[i], hrs: hrs, x: cursor, w: w, color: style.color });
        cursor += w;
        if (cursor > barL + barW) { cursor = barL + barW; }
      }
      /* unattributed remainder of `used` (jobs whose scale we weren't told) */
      var attributed = 0;
      for (i = 0; i < segs.length; i++) attributed += segs[i].hrs;
      var other = used - attributed;
      if (other > 1e-9) {
        var ow = clamp(other * scale, 0, Math.max(0, barL + barW - cursor));
        segs.push({ key: 'other', hrs: other, x: cursor, w: ow, color: T.dim });
        cursor += ow;
      }

      for (i = 0; i < segs.length; i++) {
        if (!(segs[i].w > 0)) continue;
        ctx.fillStyle = segs[i].color;
        ctx.globalAlpha = 0.9;
        ctx.fillRect(segs[i].x, barT, segs[i].w, barH);
        ctx.globalAlpha = 1;
      }
      /* over-budget marker */
      if (over) {
        ctx.save();
        ctx.strokeStyle = T.bad;
        ctx.lineWidth = 2;
        ctx.strokeRect(roundPx(barL), roundPx(barT), Math.round(barW), Math.round(barH));
        ctx.restore();
      } else {
        ctx.strokeStyle = T.border;
        ctx.lineWidth = 1;
        ctx.strokeRect(roundPx(barL), roundPx(barT), Math.round(barW), Math.round(barH));
      }

      /* the spent/remaining boundary, so the % label reads as a position */
      if (cursor > barL + 0.5 && cursor < barL + barW - 0.5) {
        ctx.strokeStyle = T.text;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(roundPx(cursor), barT - 3);
        ctx.lineTo(roundPx(cursor), barT + barH + 3);
        ctx.stroke();
      }

      /* percentage first (it owns the spent/remaining boundary), then the
       * "N left" caption after it, so the two can never overprint */
      ctx.font = font(11, 'bold');
      var pctTxt = fmtPct(pct) + (over ? ' OVER' : '');
      var ptw = ctx.measureText(pctTxt).width;
      var inside = (cursor - barL) > ptw + 14;
      var textEnd;
      if (inside) {
        ctx.fillStyle = T.bg;
        ctx.fillText(pctTxt, cursor - ptw - 7, barT + barH / 2 + 4);
        textEnd = cursor;
      } else {
        var px2 = clamp(cursor + 6, barL, Math.max(barL, barL + barW - ptw - 2));
        ctx.fillStyle = over ? T.bad : T.text;
        ctx.fillText(pctTxt, px2, barT + barH / 2 + 4);
        textEnd = px2 + ptw;
      }

      ctx.font = font(10);
      var remTxt = fmtHours(Math.max(0, total - used)) + ' GPU-h left';
      var remX = textEnd + 10;
      if (!over && barL + barW - remX > ctx.measureText(remTxt).width + 8) {
        ctx.fillStyle = T.dim;
        ctx.fillText(remTxt, remX, barT + barH / 2 + 3.5);
      }

      /* breakdown table */
      var ty = barT + barH + 20;
      ctx.font = font(10);
      ctx.fillStyle = T.faint;
      ctx.fillText('BY SCALE', barL, ty);
      ty += 6;

      var rowH2 = clamp((cssH - ty - 12) / Math.max(1, segs.length), 12, 22);
      if (!segs.length) {
        ctx.fillStyle = T.faint;
        ctx.font = font(10);
        ctx.fillText('nothing spent yet', barL, ty + 14);
        return;
      }
      for (i = 0; i < segs.length; i++) {
        var yy = ty + (i + 0.5) * rowH2;
        if (yy > cssH - 3) break;
        ctx.fillStyle = segs[i].color;
        ctx.fillRect(barL, yy - 5, 10, 9);
        ctx.fillStyle = T.text;
        ctx.font = font(10);
        ctx.fillText(prettyScaleId(segs[i].key), barL + 18, yy + 3);
        ctx.fillStyle = T.dim;
        ctx.textAlign = 'right';
        ctx.fillText(fmtHours(segs[i].hrs) + ' GPU-h', barL + barW * 0.55, yy + 3);
        var sp = total > 0 ? (segs[i].hrs / total) * 100 : 0;
        ctx.fillText(fmtPct(sp), barL + barW * 0.75, yy + 3);
        ctx.textAlign = 'left';
        /* mini bar */
        var mw = clamp((segs[i].hrs / total) * (barW * 0.22), 0, barW * 0.22);
        ctx.fillStyle = segs[i].color;
        ctx.globalAlpha = 0.55;
        ctx.fillRect(barL + barW * 0.78, yy - 4, mw, 7);
        ctx.globalAlpha = 1;
      }
    }

    /* --------------------------------------------------------------------- *
     * Dispatch
     * --------------------------------------------------------------------- */
    function draw() {
      if (destroyed) return;
      var ok = begin();
      if (!ok) { tooSmall(); return; }
      try {
        if (mode === 'scaling') drawScaling(cfg, false);
        else if (mode === 'truth') drawScaling(cfg, true);
        else if (mode === 'forest') drawForest(cfg);
        else if (mode === 'budget') drawBudget(cfg);
      } catch (e) {
        /* A plot must never take the console down with it. */
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = T.bad;
        ctx.font = font(10);
        ctx.textAlign = 'left';
        ctx.fillText('plot error: ' + (e && e.message ? e.message : e), 10, 20);
        if (global.console && global.console.error) global.console.error(e);
      }
    }

    var api = {
      scaling: function (c) { mode = 'scaling'; cfg = c || {}; draw(); return api; },
      forest:  function (c) { mode = 'forest';  cfg = c || {}; draw(); return api; },
      budget:  function (c) { mode = 'budget';  cfg = c || {}; draw(); return api; },
      truth:   function (c) { mode = 'truth';   cfg = c || {}; draw(); return api; },
      resize:  function () { syncBackingStore(); draw(); return api; },
      clear:   function () { mode = null; cfg = null; begin(); return api; },
      destroy: function () { destroyed = true; cfg = null; mode = null; }
    };

    syncBackingStore();
    return api;
  }

  global.Plots = {
    create: create,
    THEME: THEME,
    SERIES: SERIES,
    VERSION: VERSION
  };

})(typeof window !== 'undefined' ? window : this);
