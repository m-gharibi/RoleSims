/* ============================================================================
 * sim/board.js  —  window.Board
 * Junior Software Engineer Sim: hand-rolled canvas-2D rendering (SPEC §3).
 *
 * NO modules, NO imports, NO libraries, NO fetch. Loads via <script src> from
 * file:// and attaches exactly one global.
 *
 *   var b = Board.create(canvasEl, { theme:"dark" });
 *   b.timeline({ tickets, day, totalDays, hoursPerDay });
 *   b.understanding({ ticket, history });
 *   b.burn({ points, merged, day, totalDays });
 *   b.trust({ people });
 *   b.truth({ perTicket, paths });          // DEBRIEF ONLY
 *   b.resize();
 *
 * This module NEVER calls SIM_REPO.reveal(). `truth()` renders only what the
 * caller hands it, after the retro is submitted.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS MODULE IS FOR
 *
 *   The sim is about the asymmetry of knowledge and the cost of closing it.
 *   Two of these five views carry that lesson:
 *
 *   timeline()  — makes WASTED TIME the loudest thing on the screen. A block
 *                 of hours that bought no understanding is drawn in red, with
 *                 diagonal hatching, a heavy border, and a solid red rail
 *                 underneath the lane that accumulates so the eye can total it
 *                 without reading a number. Six hours of read_code on a ticket
 *                 whose answer was never in the code is a lane that is mostly
 *                 red, and you see it from across the room.
 *
 *   understanding() — makes the PLATEAU unmistakable. A ticket whose answer is
 *                 not solo-findable flattens out below the implement bar. The
 *                 flat run is shaded and hatched, annotated "NO PROGRESS FOR
 *                 N.Nh", and once it has clearly stalled an inferred ceiling
 *                 line is drawn across the plot with an ASK call to action.
 *                 The ceiling is INFERRED FROM THE HISTORY HANDED IN — this
 *                 module has no access to soloCap and never asks for it.
 *
 * ---------------------------------------------------------------------------
 * COLOUR-BLIND SAFETY — the palette and why
 *
 *   Chrome colours are the sibling-sim palette from SPEC §3, exactly.
 *
 *   Action colours are the Okabe-Ito qualitative set (built for protan /
 *   deutan / tritan discriminability), luminance-lifted where needed to hold
 *   up on #0d1117:
 *       reproduce    #56B4E9 sky blue      code "R"
 *       read_code    #33BB88 bluish green  code "C"
 *       read_docs    #E69F00 orange        code "D"
 *       git_blame    #CC79A7 redd. purple  code "G"
 *       search_slack #F0E442 yellow        code "S"
 *       run_tests    #7EA6F0 blue          code "T"
 *       just_try     #B9C2CC light grey    code "Y"
 *       build/PR     #39C5CF accent        code "I"/"W"/"P"
 *
 *   COLOUR IS NEVER THE ONLY CHANNEL. Every segment also carries a monospace
 *   letter code (the legend keys code -> action name), so the chart reads in
 *   full monochrome. The three categories that matter most carry TEXTURE too:
 *
 *       misleading (negative yield) : dense diagonal hatch + heavy border + a
 *                                     solid rail below the lane
 *       no progress (~zero yield)   : dotted border, flat grey, "○" glyph
 *       ask                         : a flag on a stem, shape-coded by
 *                                     classification (filled diamond = well
 *                                     formed, hollow down-triangle = early,
 *                                     square = overdue)
 *
 *   A red/green confusion therefore cannot cost the player any information:
 *   hatch vs flat, and glyph vs glyph, carry the same message.
 *
 * ---------------------------------------------------------------------------
 * INPUT CONTRACT (deliberately permissive — four agents build against this)
 *
 *   Ticket:  { id, title, status, understanding, hoursSpent, estimateHours,
 *              points, history:[Event] }
 *   Event:   { kind:"investigate"|"ask"|"implement"|"tests"|"pr"|"review"|
 *                    "merge"|"abandon",
 *              actionId, minutes | hours,
 *              gained,                 // understanding delta; <0 == misleading
 *              understanding,          // absolute value AFTER the action
 *              at | atHours,           // absolute sprint hours, 0-based
 *              day, hour,              // or a calendar stamp (clock hour ok)
 *              to, classification, note }
 *
 *   Anything missing is inferred; anything non-finite is dropped. No input,
 *   however broken, may throw or put a NaN into a canvas call.
 * ==========================================================================*/

;(function (global) {
  'use strict';

  var VERSION = '1.0.0';

  /* ---- SPEC §3 palette, exactly, plus derived neutrals ---------------- */
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
    /* derived */
    grid:      '#1b2027',
    gridStrong:'#242b34',
    faint:     '#6e7681',
    rowA:      '#121820',
    rowB:      '#151c25',
    white:     '#e6edf3',
    wasteInk:  '#ffd7d5'
  };

  var MONO = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';
  function font(px, weight) { return (weight ? weight + ' ' : '') + px + 'px ' + MONO; }

  /* Okabe-Ito, dark-tuned. colour + letter code = two channels minimum. */
  var ACTION_STYLE = {
    reproduce:    { code: 'R', color: '#56B4E9', label: 'reproduce' },
    read_code:    { code: 'C', color: '#33BB88', label: 'read code' },
    read_docs:    { code: 'D', color: '#E69F00', label: 'read docs' },
    git_blame:    { code: 'G', color: '#CC79A7', label: 'git blame' },
    search_slack: { code: 'S', color: '#F0E442', label: 'search slack' },
    run_tests:    { code: 'T', color: '#7EA6F0', label: 'run tests' },
    just_try:     { code: 'Y', color: '#B9C2CC', label: 'try a fix' },
    implement:    { code: 'I', color: '#39C5CF', label: 'implement' },
    write_tests:  { code: 'W', color: '#2FA3AB', label: 'write tests' },
    open_pr:      { code: 'P', color: '#5FD3DA', label: 'open PR' },
    review:       { code: 'V', color: '#4B8FB5', label: 'review' },
    ask:          { code: '?', color: '#D8DEE6', label: 'ask' }
  };
  /* extras for action ids the data invents */
  var SPARE = [
    { color: '#9C7BD6' }, { color: '#68B0A6' }, { color: '#D98F6B' },
    { color: '#8FB4E3' }, { color: '#C6C36B' }, { color: '#A8A8A8' }
  ];

  /* ------------------------------------------------------------------ *
   * Numeric hardening. Nothing non-finite may reach a canvas call.
   * ------------------------------------------------------------------ */
  function isFin(x) { return typeof x === 'number' && isFinite(x); }
  function num(x, d) { return (typeof x === 'number' && isFinite(x)) ? x : d; }
  function pos(x, d) { var v = num(x, NaN); return (isFin(v) && v > 0) ? v : d; }
  function clamp(v, a, b) {
    if (!isFin(v)) return isFin(a) ? a : 0;
    if (!isFin(a) || !isFin(b)) return v;
    if (b < a) { var t = a; a = b; b = t; }
    return v < a ? a : (v > b ? b : v);
  }
  function roundPx(v) { return Math.round(isFin(v) ? v : 0) + 0.5; }

  function fmt(v, dp) {
    if (!isFin(v)) return '--';
    var d = dp == null ? 1 : dp;
    var s = v.toFixed(d);
    if (parseFloat(s) === 0) s = (0).toFixed(d);          /* no "-0.0" */
    return s;
  }
  function fmtH(v, dp) { return isFin(v) ? fmt(v, dp == null ? 1 : dp) + 'h' : '--'; }
  function fmtSigned(v, dp) {
    if (!isFin(v)) return '--';
    var d = dp == null ? 1 : dp;
    var a = Math.abs(v).toFixed(d);
    if (parseFloat(a) === 0) return (0).toFixed(d);
    return (v > 0 ? '+' : '-') + a;
  }
  function fmtPct(v) { return isFin(v) ? String(Math.round(v)) + '%' : '--'; }

  function niceStep(range, target) {
    if (!isFin(range) || range <= 0) return 1;
    var raw = range / Math.max(1, target);
    if (!isFin(raw) || raw <= 0) return 1;
    var mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
    if (!isFin(mag) || mag <= 0) return 1;
    var n = raw / mag, step;
    if (n <= 1) step = 1; else if (n <= 2) step = 2;
    else if (n <= 2.5) step = 2.5; else if (n <= 5) step = 5; else step = 10;
    var s = step * mag;
    return (isFin(s) && s > 0) ? s : 1;
  }

  /* '#rrggbb' + alpha -> 'rgba(...)'. Anything odd falls back to the colour. */
  function hexA(hex, a) {
    var h = String(hex == null ? '' : hex);
    if (h.charAt(0) !== '#' || (h.length !== 7 && h.length !== 4)) return h || '#888888';
    var r, g, b;
    if (h.length === 4) {
      r = parseInt(h.charAt(1) + h.charAt(1), 16);
      g = parseInt(h.charAt(2) + h.charAt(2), 16);
      b = parseInt(h.charAt(3) + h.charAt(3), 16);
    } else {
      r = parseInt(h.slice(1, 3), 16);
      g = parseInt(h.slice(3, 5), 16);
      b = parseInt(h.slice(5, 7), 16);
    }
    if (!isFin(r) || !isFin(g) || !isFin(b)) return '#888888';
    var al = clamp(num(a, 1), 0, 1);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + Math.round(al * 1000) / 1000 + ')';
  }

  function hashStr(s) {
    var h = 2166136261, i;
    s = String(s == null ? '' : s);
    for (i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 16777619) >>> 0; }
    return h >>> 0;
  }

  function styleFor(actionId) {
    var id = String(actionId == null ? '' : actionId);
    if (ACTION_STYLE[id]) return ACTION_STYLE[id];
    if (/^ask/.test(id)) return ACTION_STYLE.ask;
    var sp = SPARE[hashStr(id) % SPARE.length];
    var code = id ? id.replace(/[^a-z0-9]/gi, '').charAt(0).toUpperCase() || '·' : '·';
    return { code: code, color: sp.color, label: id.replace(/[_\-]+/g, ' ') || 'action' };
  }

  function prettyId(id) {
    var s = String(id == null ? '' : id);
    return s.replace(/[_\-]+/g, ' ');
  }

  /* "No meaningful progress." Understanding runs 0..100 and the implement bar
   * is at 70, so anything under ~4 points an hour is a rate that would take
   * twenty hours to reach the bar: it is not progress, it is passing time.
   * This is how a decayed fifth re-read of the same file (yield 30*0.6^4=3.9)
   * gets drawn as flat rather than as work. */
  function isDry(gained, hrs) {
    if (!isFin(gained)) return false;
    var h = isFin(hrs) && hrs > 0 ? hrs : 0.25;
    return gained <= Math.max(1, 4 * h);
  }

  /* ====================================================================== *
   * Instance
   * ====================================================================== */
  function create(canvasEl, opts) {
    opts = opts || {};
    if (!canvasEl || typeof canvasEl.getContext !== 'function') {
      throw new Error('Board.create: first argument must be a <canvas> element');
    }
    var ctx = canvasEl.getContext('2d');
    var T = THEME;                        /* only a dark theme exists today  */

    var DEF = {
      days:            Math.round(clamp(num(opts.days, 10), 1, 60)),
      hoursPerDay:     pos(opts.hoursPerDay, 6),
      implementReadyAt: clamp(num(opts.implementReadyAt, 70), 0, 100),
      correctAt:        clamp(num(opts.correctAt, 90), 0, 100),
      stuckHours:       pos(opts.stuckHours, 3),
      dayStartHour:     num(opts.dayStartHour, NaN)
    };
    /* repo.actions, if the caller hands them over, give real minutes for the
     * efficient route in truth(). Optional everywhere. */
    var ACTION_MIN = {};
    function absorbActions(list) {
      if (!list || typeof list.length !== 'number') return;
      for (var i = 0; i < list.length; i++) {
        var a = list[i];
        if (!a || a.id == null) continue;
        var m = num(a.minutes, NaN);
        if (isFin(m) && m > 0) ACTION_MIN[String(a.id)] = m;
      }
    }
    absorbActions(opts.actions);

    var cssW = 0, cssH = 0, dpr = 1;
    var mode = null, cfg = null, destroyed = false;
    var PAD = 10;

    /* ---- sizing / HiDPI ---------------------------------------------- */
    function measure() {
      var w = canvasEl.clientWidth | 0;
      var h = canvasEl.clientHeight | 0;
      if (!w || !h) {
        w = w || (canvasEl.width | 0) || 720;
        h = h || (canvasEl.height | 0) || 380;
        if (canvasEl.style) { canvasEl.style.width = w + 'px'; canvasEl.style.height = h + 'px'; }
      }
      return { w: w, h: h };
    }
    function syncBackingStore() {
      var d = num(global.devicePixelRatio, 1);
      if (!isFin(d) || d <= 0) d = 1;
      d = clamp(d, 1, 3);
      var s = measure();
      if (s.w === cssW && s.h === cssH && d === dpr) return false;
      cssW = s.w; cssH = s.h; dpr = d;
      canvasEl.width = Math.max(1, Math.round(cssW * dpr));
      canvasEl.height = Math.max(1, Math.round(cssH * dpr));
      return true;
    }
    function beginFrame() {
      syncBackingStore();
      if (!cssW || !cssH) return false;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);
      ctx.fillStyle = T.bg;
      ctx.fillRect(0, 0, cssW, cssH);
      ctx.lineCap = 'butt';
      ctx.lineJoin = 'miter';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1;
      return cssW >= 90 && cssH >= 60;
    }
    function tooSmall() {
      if (cssW < 20 || cssH < 10) return;
      ctx.fillStyle = T.faint;
      ctx.font = font(Math.max(8, Math.min(11, Math.floor(cssH / 3))));
      ctx.textAlign = 'center';
      ctx.fillText('·', cssW / 2, cssH / 2);
      ctx.textAlign = 'left';
    }

    /* ---- primitives (every one NaN-guarded) --------------------------- */
    var curFont = '';
    function setFont(f) { if (f !== curFont) { curFont = f; ctx.font = f; } }
    function textW(s, f) { setFont(f || font(10)); return ctx.measureText(String(s == null ? '' : s)).width; }
    function fitText(s, maxW, f) {
      s = String(s == null ? '' : s);
      if (!isFin(maxW) || maxW <= 2) return '';
      if (textW(s, f) <= maxW) return s;
      var lo = 0, hi = s.length, best = '';
      while (lo <= hi) {
        var mid = (lo + hi) >> 1;
        var cand = s.slice(0, mid) + '…';
        if (textW(cand, f) <= maxW) { best = cand; lo = mid + 1; } else hi = mid - 1;
      }
      return best;
    }
    function pRect(x, y, w, h, fill) {
      if (!isFin(x) || !isFin(y) || !isFin(w) || !isFin(h)) return;
      if (w <= 0 || h <= 0) return;
      ctx.fillStyle = fill; ctx.fillRect(x, y, w, h);
    }
    function pStrokeRect(x, y, w, h, stroke, lw, dash) {
      if (!isFin(x) || !isFin(y) || !isFin(w) || !isFin(h)) return;
      if (w <= 0 || h <= 0) return;
      ctx.save();
      ctx.strokeStyle = stroke; ctx.lineWidth = pos(lw, 1);
      if (dash && dash.length) ctx.setLineDash(dash);
      ctx.beginPath();
      ctx.rect(roundPx(x), roundPx(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
      ctx.stroke();
      ctx.restore();
    }
    function pLine(x0, y0, x1, y1, stroke, lw, dash) {
      if (!isFin(x0) || !isFin(y0) || !isFin(x1) || !isFin(y1)) return;
      ctx.save();
      ctx.strokeStyle = stroke; ctx.lineWidth = pos(lw, 1);
      if (dash && dash.length) ctx.setLineDash(dash);
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      ctx.restore();
    }
    function pVLine(x, y0, y1, stroke, lw, dash) {
      if (!isFin(x)) return; pLine(roundPx(x), y0, roundPx(x), y1, stroke, lw, dash);
    }
    function pHLine(y, x0, x1, stroke, lw, dash) {
      if (!isFin(y)) return; pLine(x0, roundPx(y), x1, roundPx(y), stroke, lw, dash);
    }
    function pText(s, x, y, f, fill, align, baseline) {
      if (!isFin(x) || !isFin(y)) return;
      s = String(s == null ? '' : s);
      if (!s) return;
      setFont(f || font(10));
      ctx.fillStyle = fill || T.text;
      ctx.textAlign = align || 'left';
      ctx.textBaseline = baseline || 'middle';
      ctx.fillText(s, x, y);
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    }
    /* text on an opaque plate — the only reliable way to keep a label off a
     * gridline or a hatch without moving it somewhere less meaningful */
    function pChip(s, x, y, f, fill, align, bgc, padx, borderCol) {
      s = String(s == null ? '' : s);
      if (!s || !isFin(x) || !isFin(y)) return { x: x, w: 0 };
      var w = textW(s, f) + pos(padx, 4) * 2;
      var ax = align === 'center' ? x - w / 2 : (align === 'right' ? x - w : x);
      pRect(ax, y - 7.5, w, 15, bgc || hexA(T.bg, 0.92));
      if (borderCol) pStrokeRect(ax, y - 7.5, w, 15, borderCol, 1);
      pText(s, ax + pos(padx, 4), y, f, fill, 'left', 'middle');
      return { x: ax, w: w };
    }
    function pHatch(x, y, w, h, stroke, lw, gap) {
      if (!isFin(x) || !isFin(y) || !isFin(w) || !isFin(h)) return;
      if (w <= 0.6 || h <= 0.6) return;
      var g = Math.max(3, pos(gap, 6));
      ctx.save();
      ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
      ctx.strokeStyle = stroke; ctx.lineWidth = pos(lw, 1);
      ctx.beginPath();
      var span = w + h, n = Math.ceil(span / g), i;
      if (!isFin(n) || n < 0) n = 0;
      if (n > 400) { g = span / 400; n = 400; }
      for (i = 0; i <= n; i++) {
        var xs = x - h + i * g;
        if (!isFin(xs)) continue;
        ctx.moveTo(xs, y + h); ctx.lineTo(xs + h, y);
      }
      ctx.stroke();
      ctx.restore();
    }
    function pShape(kind, x, y, r, fill, stroke, lw) {
      if (!isFin(x) || !isFin(y) || !isFin(r) || r <= 0) return;
      var i, a, px, py;
      ctx.beginPath();
      switch (kind) {
        case 'square':
          ctx.rect(x - r * 0.85, y - r * 0.85, r * 1.7, r * 1.7); break;
        case 'triUp':
          ctx.moveTo(x, y - r * 1.15); ctx.lineTo(x + r * 1.05, y + r * 0.75);
          ctx.lineTo(x - r * 1.05, y + r * 0.75); ctx.closePath(); break;
        case 'triDown':
          ctx.moveTo(x, y + r * 1.15); ctx.lineTo(x + r * 1.05, y - r * 0.75);
          ctx.lineTo(x - r * 1.05, y - r * 0.75); ctx.closePath(); break;
        case 'diamond':
          ctx.moveTo(x, y - r * 1.25); ctx.lineTo(x + r * 1.05, y);
          ctx.lineTo(x, y + r * 1.25); ctx.lineTo(x - r * 1.05, y); ctx.closePath(); break;
        case 'star':
          for (i = 0; i < 10; i++) {
            a = -Math.PI / 2 + i * Math.PI / 5;
            var rr = (i % 2 === 0) ? r * 1.4 : r * 0.6;
            px = x + Math.cos(a) * rr; py = y + Math.sin(a) * rr;
            if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
          }
          ctx.closePath(); break;
        default:
          ctx.arc(x, y, r, 0, Math.PI * 2);
      }
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = pos(lw, 1); ctx.stroke(); }
    }

    function drawTitle(title, sub) {
      var y = 14;
      if (title) pText(title, PAD, y, font(12, 'bold'), T.text, 'left', 'middle');
      if (sub) {
        var maxSub = Math.max(20, cssW - PAD * 2 - textW(title || '', font(12, 'bold')) - 16);
        pText(fitText(sub, maxSub, font(10)), cssW - PAD, y, font(10), T.dim, 'right', 'middle');
      }
      return (title || sub) ? 24 : 6;
    }
    function drawEmpty(x0, y0, x1, y1, msg, hint) {
      var cx = clamp((x0 + x1) / 2, 0, cssW), cy = clamp((y0 + y1) / 2, 10, cssH - 6);
      pText(msg, cx, cy - (hint ? 8 : 0), font(11, 'bold'), T.faint, 'center', 'middle');
      if (hint) pText(fitText(hint, Math.max(40, x1 - x0 - 12), font(9)), cx, cy + 9, font(9), T.faint, 'center', 'middle');
    }

    /* ---- legend (wrapping, height-measured so nothing overlaps) ------- */
    var LEG_ROW = 15, LEG_GAP = 14, LEG_GLYPH = 22;
    function legLayout(items, availW) {
      var rows = [], cur = [], curW = 0, i;
      for (i = 0; i < items.length; i++) {
        var w = LEG_GLYPH + textW(items[i].label, font(9)) + LEG_GAP;
        if (cur.length && curW + w > availW) { rows.push(cur); cur = []; curW = 0; }
        cur.push(items[i]); curW += w;
      }
      if (cur.length) rows.push(cur);
      return rows;
    }
    function legendHeight(items, availW) {
      if (!items || !items.length) return 0;
      return legLayout(items, availW).length * LEG_ROW + 4;
    }
    function drawLegend(items, x, y, availW) {
      if (!items || !items.length) return 0;
      var rows = legLayout(items, availW), r, i;
      for (r = 0; r < rows.length; r++) {
        var cx = x, cy = y + r * LEG_ROW + 8;
        for (i = 0; i < rows[r].length; i++) {
          var it = rows[r][i], col = it.color || T.dim;
          var sw = 16, sh = 9, sy = cy - sh / 2;
          if (it.kind === 'shape') {
            pShape(it.shape || 'circle', cx + 6, cy, 4, it.hollow ? T.bg : col, col, 1.4);
          } else if (it.kind === 'waste') {
            pRect(cx, sy, sw, sh, hexA(T.bad, 0.22));
            pHatch(cx, sy, sw, sh, hexA(T.bad, 0.95), 1.1, 4);
            pStrokeRect(cx, sy, sw, sh, T.bad, 1.4);
          } else if (it.kind === 'dry') {
            pRect(cx, sy, sw, sh, hexA(T.dim, 0.16));
            pStrokeRect(cx, sy, sw, sh, hexA(T.dim, 0.85), 1, [2, 2]);
          } else if (it.kind === 'line') {
            pHLine(cy, cx, cx + sw, col, it.lw || 1.6, it.dash || null);
          } else {
            pRect(cx, sy, sw, sh, hexA(col, 0.85));
            if (it.code) pText(it.code, cx + sw / 2, cy + 0.5, font(8, 'bold'), T.bg, 'center', 'middle');
          }
          pText(it.label, cx + LEG_GLYPH, cy, font(9), it.muted ? T.faint : T.dim, 'left', 'middle');
          cx += LEG_GLYPH + textW(it.label, font(9)) + LEG_GAP;
        }
      }
      return rows.length * LEG_ROW + 4;
    }

    function makeScale(lo, hi, px0, px1) {
      var a = num(lo, 0), b = num(hi, 1);
      if (!(b > a)) b = a + 1;
      /* the pixel range may legitimately be inverted — that is how a y axis is
       * built (0 at the bottom). Only a zero-length range needs fixing. */
      var p0 = num(px0, 0), p1 = num(px1, p0 + 1);
      if (p1 === p0) p1 = p0 + 1;
      return function (v) {
        if (!isFin(v)) return NaN;
        var x = p0 + (v - a) / (b - a) * (p1 - p0);
        return isFin(x) ? x : NaN;
      };
    }

    /* ================================================================== *
     * NORMALISATION — turn whatever the engine hands over into lanes
     * ================================================================== */

    var ASK_RE = /^ask/i;

    function eventKind(e) {
      var k = e.kind || e.type;
      /* A generic kind ("action") plus a specific action id: the id wins, so
       * that writing the code is never mistaken for investigating it. */
      var aid0 = String(e.actionId || e.action || '');
      if (aid0 === 'implement') return 'implement';
      if (aid0 === 'write_tests') return 'tests';
      if (aid0 === 'open_pr') return 'pr';
      if (typeof k === 'string' && k) {
        k = k.toLowerCase();
        if (k === 'investigate' || k === 'action' || k === 'investigation') return 'investigate';
        if (k === 'ask' || k === 'question') return 'ask';
        if (k === 'implement' || k === 'implementation') return 'implement';
        if (k === 'tests' || k === 'write_tests' || k === 'test') return 'tests';
        if (k === 'pr' || k === 'open_pr') return 'pr';
        if (k === 'review' || k === 'bounce') return 'review';
        if (k === 'merge' || k === 'merged') return 'merge';
        if (k === 'abandon' || k === 'abandoned') return 'abandon';
      }
      if (e.to != null || e.question != null || e.classification != null) return 'ask';
      var a = String(e.actionId || e.action || e.id || '');
      if (ASK_RE.test(a)) return 'ask';
      if (a === 'implement') return 'implement';
      if (a === 'write_tests') return 'tests';
      if (a === 'open_pr') return 'pr';
      return 'investigate';
    }

    function eventHours(e, kind) {
      var h = num(e.hours, NaN);
      if (isFin(h) && h >= 0) return h;
      var m = num(e.minutes, NaN);
      if (isFin(m) && m >= 0) return m / 60;
      var aid = String(e.actionId || e.action || e.id || '');
      if (ACTION_MIN[aid]) return ACTION_MIN[aid] / 60;
      if (kind === 'ask') return 0.25;
      if (kind === 'pr' || kind === 'merge' || kind === 'abandon' || kind === 'review') return 0;
      if (kind === 'tests') return 0.75;
      if (kind === 'implement') return 1;
      return 0.5;
    }

    /* "D4 11:15" -> { day:4, hour:11.25 }. This stamp is in the SPEC's own
     * State shape, so it is the most reliable clock any caller will carry. */
    var TSTAMP = /^\s*[Dd](\d+)[^0-9]+(\d{1,2})[:.](\d{2})/;
    function parseStamp(v) {
      if (typeof v !== 'string') return null;
      var m = TSTAMP.exec(v);
      if (!m) return null;
      var d = parseInt(m[1], 10), hh = parseInt(m[2], 10), mm = parseInt(m[3], 10);
      if (!isFin(d) || !isFin(hh) || !isFin(mm)) return null;
      return { day: d, hour: hh + mm / 60 };
    }

    /* Absolute sprint hour of an event, or NaN when the data does not say.
     * Calendar stamps win over per-ticket cursors: `atHours` means "hours on
     * this ticket" to some callers and "hours into the sprint" to others, so it
     * is only consulted when nothing unambiguous is available. */
    function eventStart(e, hpd, dayStart) {
      var a = num(e.at, num(e.tAbs, num(e.absHours, num(e.elapsedHours, NaN))));
      if (isFin(a)) return a;
      var d = num(e.day, NaN), h = num(e.hour, NaN);
      var st = parseStamp(e.t);
      if (st) { if (!isFin(d)) d = st.day; if (!isFin(h)) h = st.hour; }
      if (isFin(d)) {
        var within = isFin(h) ? (h >= hpd ? h - dayStart : h) : 0;
        var v = (d - 1) * hpd + clamp(within, 0, hpd);
        if (isFin(v)) return v;
      }
      var b = num(e.e, num(e.atHours, num(e.startHours, NaN)));
      return isFin(b) ? b : NaN;
    }

    function collectHourStamps(list, out) {
      for (var i = 0; i < list.length; i++) {
        if (!list[i] || typeof list[i] !== 'object') continue;
        var h = num(list[i].hour, NaN);
        if (isFin(h)) { out.push(h); continue; }
        var st = parseStamp(list[i].t);
        if (st) out.push(st.hour);
      }
    }

    /* A ticket may carry several logs: a list of ACTIONS (what was done) and a
     * list of SAMPLES (understanding over time). The lanes need the actions, so
     * pick whichever candidate list actually looks like actions. */
    function looksLikeActions(list) {
      if (!list || typeof list.length !== 'number' || !list.length) return -1;
      var hit = 0, n = 0, i;
      for (i = 0; i < list.length; i++) {
        var e = list[i];
        if (!e || typeof e !== 'object') continue;
        n++;
        if (e.actionId != null || e.action != null || e.kind != null ||
            e.minutes != null || e.hours != null || e.to != null) hit++;
      }
      if (!n) return -1;
      return hit / n;
    }
    function rawEventsOf(t) {
      if (!t) return [];
      var cands = [t.segments, t.actions, t.actionLog, t.actionsLog, t.events,
                   t.log, t.timeline, t.history];
      var best = null, bestScore = -1, i;
      for (i = 0; i < cands.length; i++) {
        var sc2 = looksLikeActions(cands[i]);
        if (sc2 > bestScore) { bestScore = sc2; best = cands[i]; }
      }
      return (best && typeof best.length === 'number') ? best : [];
    }

    /* Build lanes with absolute start/end times for every segment. */
    function normLanes(cfg2, hpd) {
      var tickets = (cfg2.tickets && typeof cfg2.tickets.length === 'number') ? cfg2.tickets : [];
      var extra = (cfg2.events && typeof cfg2.events.length === 'number') ? cfg2.events
                : ((cfg2.history && typeof cfg2.history.length === 'number') ? cfg2.history : []);

      var lanes = [], byId = {}, i, j;
      for (i = 0; i < tickets.length; i++) {
        var t = tickets[i];
        if (!t || typeof t !== 'object') continue;
        var id = t.id != null ? String(t.id) : ('T' + (i + 1));
        var lane = {
          id: id,
          title: t.title != null ? String(t.title) : '',
          status: String(t.status || 'todo').toLowerCase(),
          understanding: num(t.understanding, NaN),
          estimate: num(t.estimateHours, num(t.estimate, NaN)),
          points: num(t.points, NaN),
          hoursSpent: num(t.hoursSpent, NaN),
          raw: rawEventsOf(t),
          segs: [], asks: [], marks: [], byAction: {}, lastEnd: 0,
          total: 0, waste: 0, dry: 0, gainHours: 0
        };
        lanes.push(lane);
        byId[id] = lane;
      }
      /* flat event array addressed by ticketId */
      for (i = 0; i < extra.length; i++) {
        var e = extra[i];
        if (!e || typeof e !== 'object') continue;
        var tid = e.ticketId != null ? String(e.ticketId) : (e.ticket != null ? String(e.ticket) : null);
        if (tid == null) continue;
        if (!byId[tid]) {
          var nl = { id: tid, title: '', status: 'todo', understanding: NaN, estimate: NaN,
                     points: NaN, hoursSpent: NaN, raw: [], segs: [], asks: [], marks: [],
                     byAction: {}, lastEnd: 0,
                     total: 0, waste: 0, dry: 0, gainHours: 0 };
          lanes.push(nl); byId[tid] = nl;
        }
        byId[tid].raw = byId[tid].raw.concat([e]);
      }

      /* day-start inference: a clock hour of 11.25 on a 6h day means 09:00 start */
      var stamps = [];
      for (i = 0; i < lanes.length; i++) collectHourStamps(lanes[i].raw, stamps);
      if (isFin(num(cfg2.hour, NaN))) stamps.push(num(cfg2.hour, 0));
      var dayStart = num(DEF.dayStartHour, NaN);
      if (!isFin(dayStart)) {
        var mx = -Infinity, mn = Infinity;
        for (i = 0; i < stamps.length; i++) { if (stamps[i] > mx) mx = stamps[i]; if (stamps[i] < mn) mn = stamps[i]; }
        dayStart = (isFin(mx) && mx > hpd + 1e-6 && isFin(mn)) ? Math.max(0, Math.floor(mn)) : 0;
      }

      /* flatten, keeping (lane, order) so the fallback layout stays stable */
      var flat = [], anyTimed = false;
      for (i = 0; i < lanes.length; i++) {
        for (j = 0; j < lanes[i].raw.length; j++) {
          var ev = lanes[i].raw[j];
          if (!ev || typeof ev !== 'object') continue;
          var kind = eventKind(ev);
          var hrs = eventHours(ev, kind);
          if (!isFin(hrs) || hrs < 0) hrs = 0;
          hrs = Math.min(hrs, 60);                       /* absurd data capped */
          var st = eventStart(ev, hpd, dayStart);
          if (isFin(st)) anyTimed = true;
          flat.push({
            lane: i, idx: j, kind: kind, e: ev, hrs: hrs, st: st,
            seq: num(ev.tick, num(ev.seq, NaN))
          });
        }
      }
      flat.sort(function (a, b) {
        var at = isFin(a.st), bt = isFin(b.st);
        if (at && bt && a.st !== b.st) return a.st - b.st;
        if (at !== bt) return at ? -1 : 1;
        if (isFin(a.seq) && isFin(b.seq) && a.seq !== b.seq) return a.seq - b.seq;
        if (a.lane !== b.lane) return a.lane - b.lane;
        return a.idx - b.idx;
      });

      /* one person, one clock: lay untimed work end-to-end on a global cursor */
      var cursor = 0, maxEnd = 0;
      for (i = 0; i < flat.length; i++) {
        var f = flat[i];
        var start = isFin(f.st) ? f.st : cursor;
        if (start < 0) start = 0;
        var end = start + f.hrs;
        cursor = Math.max(cursor, end);
        maxEnd = Math.max(maxEnd, end);

        var L = lanes[f.lane];
        var ee = f.e;
        var gained = num(ee.gained, num(ee.delta, num(ee.understandingGained, NaN)));
        var aid = String(ee.actionId || ee.action || (f.kind === 'investigate' ? (ee.id || '') : f.kind));
        /* Only LEARNING actions can be wasted. Writing the code, writing the
         * tests and opening the PR gain no understanding by design; counting
         * them as "no progress" would slander the one part of the sprint that
         * was actually productive. */
        var learning = (f.kind === 'investigate' || f.kind === 'ask');
        var cls;
        if (!learning) cls = 'build';
        else if (isFin(gained)) cls = gained < -0.01 ? 'neg' : (isDry(gained, f.hrs) ? 'dry' : 'gain');
        else cls = 'unknown';

        var seg = {
          kind: f.kind, actionId: aid, s: start, e: end, hrs: f.hrs,
          gained: gained, cls: cls,
          to: ee.to != null ? String(ee.to) : null,
          classification: ee.classification != null ? String(ee.classification) : null,
          note: ee.note != null ? String(ee.note) : null
        };
        if (f.kind === 'ask') {
          L.asks.push(seg);
          if (f.hrs > 0.01) L.segs.push(seg);
        } else if (f.kind === 'merge' || f.kind === 'abandon' || f.kind === 'review' || f.kind === 'pr') {
          L.marks.push(seg);
          if (f.hrs > 0.01) L.segs.push(seg);
        } else {
          L.segs.push(seg);
        }
        L.total += f.hrs;
        if (end > L.lastEnd) L.lastEnd = end;
        if (cls === 'neg' || cls === 'dry') {
          if (cls === 'neg') L.waste += f.hrs; else L.dry += f.hrs;
          var slot = L.byAction[aid] || (L.byAction[aid] = { h: 0, neg: false });
          slot.h += f.hrs;
          if (cls === 'neg') slot.neg = true;
        } else L.gainHours += f.hrs;
      }

      /* Not every caller logs implement/tests/PR. When the engine says more
       * hours went into a ticket than the log accounts for, believe the engine
       * for the total and the log for the breakdown. */
      for (i = 0; i < lanes.length; i++) {
        var Lt = lanes[i];
        if (Lt.segs.length && isFin(Lt.hoursSpent) && Lt.hoursSpent > Lt.total + 0.01) {
          Lt.unlogged = Lt.hoursSpent - Lt.total;
          Lt.total = Lt.hoursSpent;
        } else Lt.unlogged = 0;
      }

      /* a ticket with hours but no log still deserves a truthful bar */
      for (i = 0; i < lanes.length; i++) {
        var Ln = lanes[i];
        if (Ln.segs.length || !(num(Ln.hoursSpent, 0) > 0)) continue;
        var h = clamp(Ln.hoursSpent, 0, 60);
        Ln.segs.push({ kind: 'unlogged', actionId: '', s: cursor, e: cursor + h, hrs: h,
                       gained: NaN, cls: 'unknown', to: null, classification: null, note: null });
        Ln.total += h; Ln.gainHours += h;
        cursor += h; maxEnd = Math.max(maxEnd, cursor);
        if (cursor > Ln.lastEnd) Ln.lastEnd = cursor;
      }

      return { lanes: lanes, maxEnd: maxEnd, dayStart: dayStart };
    }

    function nowAbsOf(cfg2, hpd, totalDays, fallback) {
      var v = num(cfg2.elapsedHours, num(cfg2.hoursElapsed, NaN));
      if (isFin(v)) return clamp(v, 0, totalDays * hpd);
      var left = num(cfg2.hoursLeft, NaN);
      var tot = num(cfg2.totalHours, totalDays * hpd);
      if (isFin(left) && isFin(tot)) return clamp(tot - left, 0, tot);
      var d = num(cfg2.day, NaN);
      if (isFin(d)) {
        var h = num(cfg2.hour, NaN);
        var within = isFin(h) ? (h >= hpd ? h - num(cfg2.dayStart, 9) : h) : 0;
        var a = (d - 1) * hpd + clamp(within, 0, hpd);
        if (isFin(a)) return clamp(a, 0, totalDays * hpd);
      }
      return isFin(fallback) ? fallback : NaN;
    }

    /* ================================================================== *
     * VIEW 1 — timeline(). THE CENTREPIECE.
     * ================================================================== */
    function drawTimeline(c) {
      c = c || {};
      absorbActions(c.actions);
      var hpd = pos(c.hoursPerDay, DEF.hoursPerDay);
      var totalDays = Math.round(clamp(num(c.totalDays, DEF.days), 1, 60));
      var N = normLanes(c, hpd);
      var lanes = N.lanes;
      var i, j;

      var sumTotal = 0, sumWaste = 0, sumDry = 0;
      for (i = 0; i < lanes.length; i++) {
        sumTotal += lanes[i].total; sumWaste += lanes[i].waste; sumDry += lanes[i].dry;
      }
      var badHours = sumWaste + sumDry;
      var sprintHours = totalDays * hpd;
      var nowAbs = nowAbsOf(c, hpd, totalDays, N.maxEnd);

      var sub = (isFin(nowAbs) ? 'D' + clamp(Math.floor(nowAbs / hpd) + 1, 1, totalDays) + ' · ' : '') +
                fmtH(sumTotal) + ' logged of ' + fmtH(sprintHours, 0);
      var top = drawTitle('TIME LEDGER — where the hours actually went', sub);

      /* legend: only the actions this sprint actually used */
      var used = {}, order = [];
      for (i = 0; i < lanes.length; i++) {
        for (j = 0; j < lanes[i].segs.length; j++) {
          var sg = lanes[i].segs[j];
          if (sg.kind === 'ask' || sg.kind === 'unlogged') continue;
          var k = sg.actionId || sg.kind;
          if (!used[k]) { used[k] = true; order.push(k); }
        }
      }
      var legItems = [];
      for (i = 0; i < order.length && i < 9; i++) {
        var st = styleFor(order[i]);
        legItems.push({ label: st.label || prettyId(order[i]), color: st.color, code: st.code });
      }
      legItems.push({ kind: 'waste', label: 'WASTED — actively misleading', color: T.bad });
      legItems.push({ kind: 'dry', label: 'no understanding gained', color: T.dim });
      legItems.push({ kind: 'shape', shape: 'diamond', color: T.good, label: 'ask · well-formed' });
      legItems.push({ kind: 'shape', shape: 'triDown', color: T.warn, hollow: true, label: 'ask · early' });
      legItems.push({ kind: 'shape', shape: 'square', color: T.bad, label: 'ask · overdue' });

      var availW = Math.max(60, cssW - PAD * 2);
      var legH = legendHeight(legItems, availW);
      drawLegend(legItems, PAD, top, availW);

      /* geometry */
      var labelF = font(10, 'bold');
      var labelW = 84;
      for (i = 0; i < lanes.length; i++) labelW = Math.max(labelW, textW(lanes[i].id, labelF) + 12);
      labelW = Math.min(labelW, Math.max(70, cssW * 0.20));
      var gutterW = cssW > 460 ? 86 : (cssW > 340 ? 60 : 0);

      var x0 = PAD + labelW + 8;
      var x1 = cssW - PAD - gutterW;
      var headH = 15;
      var footH = cssW > 320 ? 32 : 0;
      var yTop = top + legH + headH;
      var yBot = cssH - PAD - footH;

      if (x1 - x0 < 70 || yBot - yTop < 24) {
        drawEmpty(PAD, top + legH, cssW - PAD, cssH - PAD, 'TOO SMALL');
        return;
      }
      if (!lanes.length) {
        pRect(x0, yTop, x1 - x0, yBot - yTop, T.panel);
        pStrokeRect(x0, yTop, x1 - x0, yBot - yTop, T.border, 1);
        drawEmpty(x0, yTop, x1, yBot, 'NO TICKETS', 'Nothing on the board yet.');
        return;
      }

      var xmax = Math.max(sprintHours, N.maxEnd);
      var X = makeScale(0, xmax, x0, x1);

      /* rows */
      var availH = yBot - yTop;
      var rowH = availH / lanes.length;
      var shown = lanes.length;
      if (rowH < 20) { shown = Math.max(1, Math.floor(availH / 20)); rowH = availH / shown; }
      rowH = Math.min(rowH, 54);
      yBot = yTop + rowH * shown;

      pRect(x0, yTop, x1 - x0, yBot - yTop, T.panel);
      for (i = 0; i < shown; i++) pRect(x0, yTop + i * rowH, x1 - x0, rowH, i % 2 ? T.rowB : T.rowA);

      /* the part of the sprint that has not happened yet */
      if (isFin(nowAbs) && nowAbs < xmax - 1e-6) {
        var fx = clamp(X(nowAbs), x0, x1);
        pRect(fx, yTop, x1 - fx, yBot - yTop, hexA(T.bg, 0.55));
      }

      /* The NOW plate is laid out FIRST so a day number can yield to it
       * instead of printing underneath. */
      var nowX = isFin(nowAbs) ? X(nowAbs) : NaN;
      var showNow = isFin(nowX) && nowX >= x0 - 0.5 && nowX <= x1 + 0.5;
      var nlw = textW('NOW', font(9, 'bold')) + 6;
      var nlx = showNow ? clamp(clamp(nowX, x0, x1) - nlw / 2, x0, Math.max(x0, x1 - nlw)) : NaN;

      /* day grid + header */
      var dayW = (x1 - x0) / Math.max(1, xmax / hpd);
      var everyN = 1;
      while (dayW * everyN < 26 && everyN < 6) everyN++;
      for (i = 0; i <= Math.ceil(xmax / hpd); i++) {
        var gx = X(i * hpd);
        if (!isFin(gx) || gx > x1 + 0.5 || gx < x0 - 0.5) continue;
        pVLine(gx, yTop, yBot, i % everyN === 0 ? T.gridStrong : hexA(T.grid, 0.8), 1);
        if (i % everyN === 0 && i < Math.ceil(xmax / hpd)) {
          var lbl = 'D' + (i + 1);
          var lw2 = textW(lbl, font(9));
          var collides = showNow && (gx + 3 + lw2 > nlx - 3) && (gx + 3 < nlx + nlw + 3);
          if (dayW > lw2 + 6 && !collides) {
            pText(lbl, gx + 3, yTop - 8, font(9), i + 1 > totalDays ? T.bad : T.faint, 'left', 'middle');
          }
        }
      }
      /* the end of the sprint, when the chart runs past it */
      if (xmax > sprintHours + 1e-6) {
        var cx = clamp(X(sprintHours), x0, x1);
        pRect(cx, yTop, x1 - cx, yBot - yTop, hexA(T.bad, 0.10));
        pHatch(cx, yTop, x1 - cx, yBot - yTop, hexA(T.bad, 0.16), 1, 7);
        pVLine(cx, yTop - 3, yBot, T.bad, 2);
      }

      /* ---- lanes ---- */
      var barH = Math.min(rowH * 0.46, 20);
      var railH = Math.max(2.5, Math.min(4.5, rowH * 0.10));

      for (i = 0; i < shown; i++) {
        var L = lanes[i];
        var ry = yTop + i * rowH;
        var cy = ry + rowH * 0.44;
        var by = cy - barH / 2;
        var railY = by + barH + 1.5;

        /* baseline so an empty lane still reads as a lane */
        pHLine(by + barH + 0.5, x0 + 1, x1 - 1, hexA(T.border, 0.5), 1);

        for (j = 0; j < L.segs.length; j++) {
          var s = L.segs[j];
          var sx = X(s.s), ex = X(s.e);
          if (!isFin(sx) || !isFin(ex)) continue;
          sx = clamp(sx, x0, x1); ex = clamp(ex, x0, x1);
          var w = ex - sx;
          if (w < 1.6) w = 1.6;
          if (sx + w > x1) sx = Math.max(x0, x1 - w);

          var stl = styleFor(s.actionId || s.kind);
          if (s.cls === 'neg') {
            /* ---- WASTED TIME: the loudest mark on the board -------------- */
            pRect(sx, by, w, barH, hexA(T.bad, 0.26));
            pHatch(sx, by, w, barH, hexA(T.bad, 0.95), 1.15, 4);
            pStrokeRect(sx, by, w, barH, T.bad, 1.6);
            /* the rail: solid red under the lane, so wasted hours accumulate
             * into a length the eye can compare without reading a number */
            pRect(sx, railY, w, railH, T.bad);
            if (w >= 13 && barH >= 11) {
              pText(stl.code, sx + w / 2, cy, font(9, 'bold'), T.wasteInk, 'center', 'middle');
            }
          } else if (s.cls === 'dry') {
            pRect(sx, by, w, barH, hexA(T.dim, 0.14));
            pStrokeRect(sx, by, w, barH, hexA(T.dim, 0.9), 1, [2, 2]);
            pRect(sx, railY, w, railH, hexA(T.dim, 0.55));
            if (w >= 13 && barH >= 11) {
              pText(stl.code, sx + w / 2, cy, font(9), hexA(T.text, 0.75), 'center', 'middle');
            }
          } else if (s.kind === 'unlogged') {
            pRect(sx, by, w, barH, hexA(T.dim, 0.10));
            pHatch(sx, by, w, barH, hexA(T.dim, 0.35), 1, 6);
            pStrokeRect(sx, by, w, barH, hexA(T.border, 0.9), 1);
            if (w >= 34) pText('unlogged', sx + w / 2, cy, font(8), T.faint, 'center', 'middle');
          } else {
            var col = stl.color;
            var isBuild = (s.kind === 'implement' || s.kind === 'tests' || s.kind === 'pr' || s.kind === 'review');
            pRect(sx, by, w, barH, hexA(col, isBuild ? 0.55 : 0.85));
            if (isBuild) pStrokeRect(sx, by, w, barH, hexA(col, 0.95), 1.2);
            if (w >= 13 && barH >= 11) {
              pText(stl.code, sx + w / 2, cy, font(9, 'bold'), isBuild ? T.white : T.bg, 'center', 'middle');
            }
          }
        }

        /* asks — flag on a stem, shape-coded, never colour alone */
        for (j = 0; j < L.asks.length; j++) {
          var ak = L.asks[j];
          var axp = X(ak.s);
          if (!isFin(axp)) continue;
          axp = clamp(axp, x0 + 2, x1 - 2);
          var cl = (ak.classification || '').toLowerCase();
          var shape = 'circle', acol = T.accent, hollow = false;
          if (/well|good|right|ok/.test(cl)) { shape = 'diamond'; acol = T.good; }
          else if (/prem|early/.test(cl)) { shape = 'triDown'; acol = T.warn; hollow = true; }
          else if (/over|late/.test(cl)) { shape = 'square'; acol = T.bad; }
          var flagY = by - 5.5;
          pVLine(axp, flagY, by + barH, hexA(acol, 0.8), 1, [2, 2]);
          pShape(shape, axp, flagY, 4.2, hollow ? T.bg : acol, acol, 1.4);
        }

        /* merge / abandon flags at the right end of the work */
        for (j = 0; j < L.marks.length; j++) {
          var mk = L.marks[j];
          if (mk.kind !== 'merge' && mk.kind !== 'abandon') continue;
          var mx2 = X(mk.e);
          if (!isFin(mx2)) continue;
          mx2 = clamp(mx2, x0 + 3, x1 - 3);
          pText(mk.kind === 'merge' ? '✓' : '✕', mx2 + 4, cy,
                font(11, 'bold'), mk.kind === 'merge' ? T.good : T.warn, 'left', 'middle');
        }

        /* lane label */
        var statusCol = L.status === 'merged' ? T.good
                      : (L.status === 'abandoned' ? T.warn
                      : (L.status === 'in_review' ? T.accent : T.text));
        pText(fitText(L.id, labelW - 6, labelF), x0 - 8, cy - (rowH > 25 ? 6 : 0), labelF, statusCol, 'right', 'middle');
        if (rowH > 25) {
          var subL = L.status === 'todo' ? (L.title || 'todo') : L.status.replace(/_/g, ' ');
          pText(fitText(subL, labelW - 6, font(8)), x0 - 8, cy + 7, font(8), T.faint, 'right', 'middle');
        }

        /* THE SENTENCE THE CHART SHOULD SAY OUT LOUD: when one action ate the
         * lane's dead time, name it in the lane's own empty space. */
        if (L.waste + L.dry >= 1.5) {
          var domId = null, domH = 0, domNeg = false, kk;
          for (kk in L.byAction) if (Object.prototype.hasOwnProperty.call(L.byAction, kk)) {
            if (L.byAction[kk].h > domH) { domH = L.byAction[kk].h; domId = kk; domNeg = L.byAction[kk].neg; }
          }
          if (domId && domH >= 1.5) {
            var dstl = styleFor(domId);
            var dtxt = fmtH(domH) + ' ' + (dstl.label || prettyId(domId)) + ' → nothing';
            var dcol = domNeg ? T.bad : T.dim;
            var dw2 = textW(dtxt, font(9, 'bold'));
            var freeFrom = clamp(X(L.lastEnd), x0, x1);
            if (x1 - 8 - dw2 > freeFrom + 12) {
              pText(dtxt, freeFrom + 12, cy, font(9, 'bold'), dcol, 'left', 'middle');
            }
          }
        }

        /* right gutter: the per-lane total, and what it bought */
        if (gutterW) {
          var gx0 = x1 + 6;
          pText(fmtH(L.total), gx0, cy - (rowH > 24 ? 6 : 0), font(11, 'bold'),
                L.total > 0 ? T.text : T.faint, 'left', 'middle');
          if (rowH > 24 && gutterW > 62) {
            var px2 = gx0;
            if (L.waste > 0.01) {
              var wt = '−' + fmtH(L.waste);
              pText(wt, px2, cy + 7, font(9, 'bold'), T.bad, 'left', 'middle');
              px2 += textW(wt, font(9, 'bold')) + 5;
            }
            if (L.dry > 0.01 && px2 + 34 < cssW - 2) {
              pText('○' + fmtH(L.dry), px2, cy + 7, font(9, 'bold'), T.dim, 'left', 'middle');
            }
          }
        }
      }
      if (shown < lanes.length) {
        pText('+' + (lanes.length - shown) + ' more', x0 + 6, yBot - 7, font(9), T.faint, 'left', 'middle');
      }

      /* NOW */
      if (showNow) {
        pVLine(clamp(nowX, x0, x1), yTop - 3, yBot + 2, hexA(T.accent, 0.9), 1.5, [4, 3]);
        pRect(nlx, yTop - headH + 1, nlw, 13, T.bg);
        pText('NOW', nlx + nlw / 2, yTop - 8, font(9, 'bold'), T.accent, 'center', 'middle');
      }

      pStrokeRect(x0, yTop, x1 - x0, yBot - yTop, T.border, 1);

      /* ---- footer: the sprint-wide wasted-hours figure ---------------- */
      if (footH) {
        var fy = yBot + 14;
        var bx = x0, bw = Math.max(40, (x1 - x0) * 0.52), bh = 10;
        var scale = sumTotal > 0 ? bw / sumTotal : 0;
        pRect(bx, fy - bh / 2, bw, bh, hexA(T.dim, 0.12));
        var cur = bx;
        var gw = clamp((sumTotal - badHours) * scale, 0, bw);
        pRect(cur, fy - bh / 2, gw, bh, hexA(T.accent, 0.55)); cur += gw;
        var dw = clamp(sumDry * scale, 0, Math.max(0, bx + bw - cur));
        if (dw > 0) {
          pRect(cur, fy - bh / 2, dw, bh, hexA(T.dim, 0.30));
          pStrokeRect(cur, fy - bh / 2, dw, bh, hexA(T.dim, 0.8), 1, [2, 2]);
          cur += dw;
        }
        var ww = clamp(sumWaste * scale, 0, Math.max(0, bx + bw - cur));
        if (ww > 0) {
          pRect(cur, fy - bh / 2, ww, bh, hexA(T.bad, 0.3));
          pHatch(cur, fy - bh / 2, ww, bh, hexA(T.bad, 0.95), 1.1, 4);
          pStrokeRect(cur, fy - bh / 2, ww, bh, T.bad, 1.4);
        }
        pStrokeRect(bx, fy - bh / 2, bw, bh, hexA(T.border, 0.9), 1);
        pText('WASTED', PAD, fy, font(9, 'bold'), badHours > 0 ? T.bad : T.faint, 'left', 'middle');

        var pct = sumTotal > 0 ? (badHours / sumTotal) * 100 : 0;
        var msg = fmtH(badHours) + ' of ' + fmtH(sumTotal) + ' (' + fmtPct(pct) + ')  ·  ' +
                  fmtH(sumWaste) + ' misleading, ' + fmtH(sumDry) + ' no progress';
        pText(fitText(msg, Math.max(20, cssW - PAD - (bx + bw + 10)), font(9)),
              bx + bw + 10, fy, font(9), badHours > 0 ? T.text : T.faint, 'left', 'middle');
      }
    }

    /* ================================================================== *
     * VIEW 2 — understanding(). THE PLATEAU IS THE POINT.
     * ================================================================== */

    /* history -> stepped curve, all of it inferred, none of it ground truth */
    function normCurve(hist, ticket) {
      var pts = [];      /* {h0,h1,u,gained,kind,actionId,classification} */
      var cum = 0, cu = 0, i;
      var list = (hist && typeof hist.length === 'number') ? hist : rawEventsOf(ticket);
      var first = true;
      var u0 = 0;
      for (i = 0; i < list.length; i++) {
        var e = list[i];
        if (!e || typeof e !== 'object') continue;
        var kind = eventKind(e);
        var hrs = eventHours(e, kind);
        if (!isFin(hrs) || hrs < 0) hrs = 0;
        hrs = Math.min(hrs, 60);
        /* an explicit cumulative-hours stamp wins over accumulation */
        var hStamp = num(e.hoursOnTicket, num(e.hoursSpent, num(e.h, NaN)));
        var h0 = cum, h1;
        if (isFin(hStamp) && hStamp >= 0) { h1 = hStamp; h0 = Math.max(0, Math.min(cum, h1)); }
        else h1 = cum + hrs;
        if (!isFin(h1) || h1 < h0) h1 = h0;
        cum = h1;

        var gained = num(e.gained, num(e.delta, num(e.understandingGained, NaN)));
        var uAbs = num(e.understanding, num(e.u, NaN));
        var u;
        if (isFin(uAbs)) u = uAbs;
        else if (isFin(gained)) u = cu + gained;
        else u = cu;
        if (!isFin(u)) u = cu;
        u = clamp(u, 0, 100);
        if (!isFin(gained)) gained = u - cu;
        if (first) { u0 = clamp(cu, 0, 100); first = false; }
        cu = u;
        pts.push({
          h0: h0, h1: h1, u: u, gained: gained, kind: kind,
          actionId: String(e.actionId || e.action || (kind === 'investigate' ? (e.id || '') : kind)),
          classification: e.classification != null ? String(e.classification) : null,
          to: e.to != null ? String(e.to) : null
        });
      }
      /* if the caller gave us only a ticket, honour its published totals */
      if (!pts.length && ticket) {
        var th = num(ticket.hoursSpent, NaN), tu = num(ticket.understanding, NaN);
        if (isFin(th) && th > 0 && isFin(tu)) {
          pts.push({ h0: 0, h1: th, u: clamp(tu, 0, 100), gained: tu, kind: 'investigate',
                     actionId: '', classification: null, to: null });
        }
      }
      return { pts: pts, u0: u0 };
    }

    /* Longest terminal run over which understanding did not move. Inferred
     * purely from the handed-in history — soloCap is never read. */
    function findPlateau(xs, us, eps) {
      var n = xs.length;
      if (n < 2) return null;
      var last = n - 1;
      var mx = us[last], mn = us[last], i = last;
      while (i - 1 >= 0) {
        var v = us[i - 1];
        var nmx = Math.max(mx, v), nmn = Math.min(mn, v);
        if (nmx - nmn > eps) break;
        mx = nmx; mn = nmn; i--;
      }
      if (i >= last) return null;
      var h0 = xs[i], h1 = xs[last];
      if (!isFin(h0) || !isFin(h1) || h1 - h0 <= 0) return null;
      return { i0: i, h0: h0, h1: h1, hours: h1 - h0, level: (mx + mn) / 2, n: last - i };
    }

    function drawUnderstanding(c) {
      c = c || {};
      var ticket = (c.ticket && typeof c.ticket === 'object') ? c.ticket : null;
      if (!ticket && c.ticketId != null && c.tickets && c.tickets.length) {
        for (var q = 0; q < c.tickets.length; q++) {
          if (c.tickets[q] && String(c.tickets[q].id) === String(c.ticketId)) { ticket = c.tickets[q]; break; }
        }
      }
      var ready = clamp(num(c.implementReadyAt, DEF.implementReadyAt), 0, 100);
      var correct = clamp(num(c.correctAt, DEF.correctAt), 0, 100);
      var stuckH = pos(c.stuckHours, DEF.stuckHours);

      var C = normCurve(c.history, ticket);
      var pts = C.pts;

      var tid = ticket && ticket.id != null ? String(ticket.id) : (c.ticketId != null ? String(c.ticketId) : '—');
      var uNow = pts.length ? pts[pts.length - 1].u : clamp(num(ticket && ticket.understanding, 0), 0, 100);
      var hNow = pts.length ? pts[pts.length - 1].h1 : clamp(num(ticket && ticket.hoursSpent, 0), 0, 60);

      var top = drawTitle('UNDERSTANDING — ' + tid,
                          fmt(uNow, 0) + ' / 100 after ' + fmtH(hNow));

      var legItems = [
        { kind: 'line', color: T.accent, lw: 2, label: 'understanding' },
        { kind: 'line', color: T.bad, lw: 2, label: 'went backwards' },
        { kind: 'shape', shape: 'diamond', color: T.good, label: 'you asked' },
        { kind: 'dry', label: 'plateau — no progress' }
      ];
      var availW = Math.max(60, cssW - PAD * 2);
      var legH = legendHeight(legItems, availW);
      drawLegend(legItems, PAD, top, availW);

      var padL = 34, padR = cssW > 420 ? 74 : 12, padB = 26;
      var x0 = PAD + padL, x1 = cssW - PAD - padR;
      var yTop = top + legH + 8, yBot = cssH - PAD - padB;
      if (x1 - x0 < 60 || yBot - yTop < 50) { drawEmpty(PAD, top, cssW - PAD, cssH - PAD, 'TOO SMALL'); return; }

      var hMax = Math.max(1, hNow);
      for (var k = 0; k < pts.length; k++) if (pts[k].h1 > hMax) hMax = pts[k].h1;
      hMax = hMax * 1.06;
      if (!isFin(hMax) || hMax <= 0) hMax = 1;

      var X = makeScale(0, hMax, x0, x1);
      var Y = makeScale(0, 100, yBot, yTop);

      pRect(x0, yTop, x1 - x0, yBot - yTop, T.panel);

      /* y grid */
      var v, gy;
      for (v = 0; v <= 100; v += 20) {
        gy = Y(v);
        pHLine(gy, x0, x1, hexA(T.grid, 0.95), 1);
        pText(String(v), x0 - 6, gy, font(9), T.faint, 'right', 'middle');
      }
      /* x grid */
      var step = niceStep(hMax, Math.max(2, Math.floor((x1 - x0) / 60)));
      var lastLx = -1e9;
      for (v = 0; v <= hMax + 1e-9; v += step) {
        var gx = X(v);
        if (!isFin(gx) || gx > x1 + 0.5) break;
        pVLine(gx, yTop, yBot, hexA(T.grid, 0.8), 1);
        if (gx - lastLx > 34) {
          lastLx = gx;
          pText(fmt(v, step < 1 ? 1 : 0) + 'h', clamp(gx, x0 + 8, x1 - 8), yBot + 10, font(9), T.faint, 'center', 'middle');
        }
      }
      pText('hours on this ticket', (x0 + x1) / 2, yBot + 21, font(9), T.faint, 'center', 'middle');

      /* build the stepped series */
      var xs = [0], us = [clamp(C.u0, 0, 100)];
      for (k = 0; k < pts.length; k++) { xs.push(pts[k].h1); us.push(pts[k].u); }

      /* ---- PLATEAU: detected from history alone ----------------------- */
      var plateau = findPlateau(xs, us, 5.0);
      /* Understanding not moving while you WRITE the code is not a plateau, it
       * is Tuesday. A plateau is investigation that bought nothing, so the flat
       * run has to contain at least two learning actions to count. */
      var learnInRun = 0;
      if (plateau) {
        for (k = Math.max(0, plateau.i0); k < pts.length; k++) {
          var pk = pts[k];
          if (pk && (pk.kind === 'investigate' || pk.kind === 'ask')) learnInRun++;
        }
      }
      var plateauShow = !!(plateau && plateau.hours >= 1.25 && plateau.n >= 2 && learnInRun >= 2);
      var hardStall = !!(plateauShow && plateau.hours >= Math.min(stuckH, 2.5) && us[us.length - 1] < ready);

      if (plateauShow) {
        var px0 = clamp(X(plateau.h0), x0, x1), px1 = clamp(X(plateau.h1), x0, x1);
        var pw = Math.max(2, px1 - px0);
        var col = hardStall ? T.bad : T.warn;
        pRect(px0, yTop, pw, yBot - yTop, hexA(col, hardStall ? 0.12 : 0.07));
        pHatch(px0, yTop, pw, yBot - yTop, hexA(col, hardStall ? 0.20 : 0.12), 1, 8);
        pVLine(px0, yTop, yBot, hexA(col, 0.8), 1.4, [4, 3]);
        pVLine(px1, yTop, yBot, hexA(col, 0.5), 1, [4, 3]);

        /* the annotation, in the top band where the stalled curve is not */
        var note = 'NO PROGRESS FOR ' + fmtH(plateau.hours);
        var ny = yTop + 11;
        var nx = clamp((px0 + px1) / 2, x0 + textW(note, font(9, 'bold')) / 2 + 6,
                        x1 - textW(note, font(9, 'bold')) / 2 - 6);
        pChip(note, nx, ny, font(9, 'bold'), col, 'center', hexA(T.bg, 0.9), 5, hexA(col, 0.8));
        /* bracket from the label down to the flat region */
        pHLine(ny + 9, px0 + 1, px1 - 1, hexA(col, 0.55), 1);
      }

      /* ---- threshold rules, drawn and labelled ON the plot ------------- */
      /* labels live at the LEFT edge: the curve starts low and climbs to the
       * right, so the top-left is the one corner it never occupies */
      function rule(val, label, col) {
        var ry = Y(val);
        if (!isFin(ry)) return;
        pHLine(ry, x0, x1, hexA(col, 0.85), 1.5, [6, 4]);
        var f = font(9, 'bold');
        var w = textW(label, f) + 8;
        var lx = clamp(x0 + 3, x0 + 2, Math.max(x0 + 2, x1 - w - 2));
        pRect(lx, ry - 7, w, 14, hexA(T.bg, 0.9));
        pStrokeRect(lx, ry - 7, w, 14, hexA(col, 0.7), 1);
        pText(label, lx + 4, ry, f, col, 'left', 'middle');
      }
      rule(ready, 'IMPLEMENT ' + fmt(ready, 0), T.warn);
      rule(correct, 'REVIEW-SAFE ' + fmt(correct, 0), T.good);

      if (!pts.length) {
        pStrokeRect(x0, yTop, x1 - x0, yBot - yTop, T.border, 1);
        drawEmpty(x0, yTop + (yBot - yTop) * 0.34, x1, yBot, 'NOTHING LOGGED YET',
                  'Every action you take lands on this plot.');
        return;
      }

      /* ---- the curve: area, then stepped line, dips in red ------------- */
      ctx.save();
      ctx.beginPath(); ctx.rect(x0, yTop, x1 - x0, yBot - yTop); ctx.clip();

      var yBase = Y(0);
      if (isFin(yBase)) {
        ctx.beginPath();
        var started = false, sx, sy;
        for (k = 0; k < xs.length; k++) {
          sx = X(xs[k]); sy = Y(us[k]);
          if (!isFin(sx) || !isFin(sy)) continue;
          if (!started) { ctx.moveTo(sx, yBase); ctx.lineTo(sx, sy); started = true; }
          else { ctx.lineTo(sx, Y(us[k - 1])); ctx.lineTo(sx, sy); }
        }
        if (started) {
          var lx2 = X(xs[xs.length - 1]);
          if (isFin(lx2)) { ctx.lineTo(lx2, yBase); ctx.closePath();
            ctx.fillStyle = hexA(T.accent, 0.13); ctx.fill(); }
        }
      }

      for (k = 1; k < xs.length; k++) {
        var ax = X(xs[k - 1]), ay = Y(us[k - 1]);
        var bx2 = X(xs[k]), by2 = Y(us[k]);
        if (!isFin(ax) || !isFin(ay) || !isFin(bx2) || !isFin(by2)) continue;
        var down = us[k] < us[k - 1] - 0.01;
        var flat = isDry(us[k] - us[k - 1], xs[k] - xs[k - 1]);
        var lcol = down ? T.bad : (flat ? hexA(T.dim, 0.85) : T.accent);
        pLine(ax, ay, bx2, ay, lcol, down ? 2.4 : 2);         /* time passes  */
        pLine(bx2, ay, bx2, by2, lcol, down ? 2.4 : 2);       /* the result   */
        if (down) {
          /* an explicit downward tick: the docs lied and it cost you */
          pShape('triDown', bx2, by2 + 5, 3.4, T.bad, T.bad, 1);
        }
      }
      for (k = 1; k < xs.length; k++) {
        var mx3 = X(xs[k]), my3 = Y(us[k]);
        if (!isFin(mx3) || !isFin(my3)) continue;
        var p = pts[k - 1];
        var isAsk = p && p.kind === 'ask';
        pShape(isAsk ? 'diamond' : 'circle', mx3, my3, isAsk ? 4.4 : 2.6,
               isAsk ? T.good : T.bg, isAsk ? T.good : T.accent, 1.6);
      }

      /* asks: a vertical marker, because the jump after one is the lesson */
      for (k = 0; k < pts.length; k++) {
        if (pts[k].kind !== 'ask') continue;
        var axx = X(pts[k].h1);
        if (!isFin(axx)) continue;
        pVLine(axx, yTop, yBot, hexA(T.good, 0.45), 1, [3, 3]);
        pText('ASK', clamp(axx + 3, x0 + 2, x1 - 22), yBot - 8, font(8, 'bold'), hexA(T.good, 0.95), 'left', 'middle');
      }
      ctx.restore();

      /* ---- the inferred ceiling + the call to action ------------------- */
      if (hardStall && plateau) {
        var cy2 = Y(plateau.level);
        if (isFin(cy2)) {
          pHLine(cy2, x0, x1, T.bad, 2, [2, 3]);
          var clab = 'CEILING ≈ ' + fmt(plateau.level, 0) + ' (inferred)';
          var cw = textW(clab, font(9, 'bold')) + 8;
          /* under the line at the right end: inside the stalled region, where
           * the flat curve leaves the space below it empty */
          var clx = clamp(x1 - 4 - cw, x0 + 2, Math.max(x0 + 2, x1 - cw - 2));
          pRect(clx, cy2 + 3, cw, 14, hexA(T.bg, 0.92));
          pStrokeRect(clx, cy2 + 3, cw, 14, hexA(T.bad, 0.8), 1);
          pText(clab, clx + 4, cy2 + 10, font(9, 'bold'), T.bad, 'left', 'middle');
        }
        /* the CTA sits in the dead space between the stalled curve and the
         * implement bar — the one region that is, by construction, empty */
        var cta1 = 'THIS ANSWER IS NOT IN THE CODE';
        var cta2 = 'ASK SOMEONE';
        var yRule = Y(ready), yCeil = Y(plateau.level);
        var mid = (isFin(yRule) && isFin(yCeil)) ? (yRule + yCeil) / 2 : (yTop + yBot) / 2;
        var room = (isFin(yRule) && isFin(yCeil)) ? Math.abs(yCeil - yRule) : 60;
        var cxm = clamp((clamp(X(plateau.h0), x0, x1) + clamp(X(plateau.h1), x0, x1)) / 2,
                        x0 + 90, Math.max(x0 + 90, x1 - 90));
        if (room >= 34 && x1 - x0 > 190) {
          pChip(cta1, cxm, mid - 8, font(9, 'bold'), T.bad, 'center', hexA(T.bg, 0.94), 6, hexA(T.bad, 0.85));
          pChip(cta2, cxm, mid + 9, font(11, 'bold'), T.bad, 'center', hexA(T.bad, 0.18), 8, T.bad);
        } else if (x1 - x0 > 120) {
          pChip(cta2, cxm, clamp(mid, yTop + 20, yBot - 12), font(10, 'bold'), T.bad, 'center', hexA(T.bad, 0.18), 8, T.bad);
        }
      }

      pStrokeRect(x0, yTop, x1 - x0, yBot - yTop, T.border, 1);

      /* ---- right-hand readout ----------------------------------------- */
      if (padR > 40) {
        var rx = x1 + 8;
        var uy = Y(uNow);
        var col2 = uNow >= correct ? T.good : (uNow >= ready ? T.warn : (hardStall ? T.bad : T.accent));
        pText(fmt(uNow, 0), rx, clamp(isFin(uy) ? uy : yTop + 20, yTop + 10, yBot - 26), font(17, 'bold'), col2, 'left', 'middle');
        pText('/100', rx + textW(fmt(uNow, 0), font(17, 'bold')) + 2,
              clamp(isFin(uy) ? uy + 5 : yTop + 25, yTop + 15, yBot - 21), font(8), T.faint, 'left', 'middle');
        var gap1 = ready - uNow, gap2 = correct - uNow;
        var gy2 = clamp((isFin(uy) ? uy : yTop + 20) + 16, yTop + 26, yBot - 12);
        pText(gap1 > 0 ? fmt(gap1, 0) + ' to build' : 'can build', rx, gy2, font(9), gap1 > 0 ? T.warn : T.good, 'left', 'middle');
        pText(gap2 > 0 ? fmt(gap2, 0) + ' to ship' : 'can ship', rx, gy2 + 12, font(9), gap2 > 0 ? T.dim : T.good, 'left', 'middle');
      }
    }

    /* ================================================================== *
     * VIEW 3 — burn()
     * ================================================================== */
    function normPoints(c) {
      var committed = num(c.points, NaN);
      var perTicket = [];
      var i, it;
      if (c.points && typeof c.points.length === 'number') {
        committed = 0;
        for (i = 0; i < c.points.length; i++) {
          it = c.points[i];
          if (it == null) continue;
          if (typeof it === 'number') { if (isFin(it)) { committed += it; perTicket.push({ id: 'T' + i, points: it }); } continue; }
          var p = num(it.points, NaN);
          if (!isFin(p)) continue;
          committed += p;
          perTicket.push({ id: it.id != null ? String(it.id) : ('T' + i), points: p,
                           day: num(it.mergedDay, num(it.day, NaN)),
                           merged: !!it.merged });
        }
      } else if (c.tickets && typeof c.tickets.length === 'number') {
        committed = 0;
        for (i = 0; i < c.tickets.length; i++) {
          it = c.tickets[i];
          if (!it) continue;
          var pp = num(it.points, NaN);
          if (!isFin(pp)) continue;
          committed += pp;
          perTicket.push({ id: it.id != null ? String(it.id) : ('T' + i), points: pp,
                           day: num(it.mergedDay, num(it.mergedAtDay, NaN)),
                           merged: String(it.status || '').toLowerCase() === 'merged' });
        }
      }
      return { committed: committed, perTicket: perTicket };
    }

    function drawBurn(c) {
      c = c || {};
      var totalDays = Math.round(clamp(num(c.totalDays, DEF.days), 1, 60));
      var day = clamp(num(c.day, totalDays), 0, totalDays + 2);
      var P = normPoints(c);
      var committed = P.committed;
      var i;

      /* merged: ids, count, points, or a per-day series */
      var series = null, mergedPoints = NaN, mergedIds = {};
      if (c.merged && typeof c.merged.length === 'number') {
        var allObj = true, sum = 0;
        for (i = 0; i < c.merged.length; i++) {
          var m = c.merged[i];
          if (m && typeof m === 'object') {
            var mp = num(m.points, NaN), md = num(m.day, num(m.mergedDay, NaN));
            if (isFin(mp)) sum += mp;
            if (isFin(md) || isFin(mp)) {
              if (!series) series = [];
              series.push({ day: isFin(md) ? md : day, points: isFin(mp) ? mp : 0 });
            }
            if (m.id != null) mergedIds[String(m.id)] = true;
          } else if (typeof m === 'number') { allObj = false; sum += isFin(m) ? m : 0; }
          else { allObj = false; if (m != null) mergedIds[String(m)] = true; }
        }
        if (allObj && series) mergedPoints = sum;
      } else if (isFin(num(c.merged, NaN))) {
        mergedPoints = num(c.merged, 0);
      }
      if (!series) {
        series = [];
        for (i = 0; i < P.perTicket.length; i++) {
          var t = P.perTicket[i];
          var isM = t.merged || mergedIds[t.id];
          if (!isM) continue;
          series.push({ day: isFin(t.day) ? t.day : day, points: t.points });
        }
        if (!series.length && isFin(mergedPoints) && mergedPoints > 0) {
          series.push({ day: day, points: mergedPoints });
        }
      }
      series.sort(function (a, b) { return a.day - b.day; });
      var mergedTotal = 0;
      for (i = 0; i < series.length; i++) mergedTotal += num(series[i].points, 0);
      var noCommitment = false;
      if (!isFin(committed) || committed <= 0) {
        var alt = num(c.totalPoints, NaN);
        if (!isFin(alt) || alt <= 0) alt = 0;
        noCommitment = (mergedTotal <= 0 && alt <= 0);
        committed = Math.max(mergedTotal, alt, 1);
      }

      var top = drawTitle('BURN-UP — points merged vs committed',
                          fmt(mergedTotal, 0) + ' / ' + fmt(committed, 0) + ' pts  ·  D' + fmt(day, 0) + ' of ' + totalDays);

      var legItems = [
        { kind: 'line', color: T.good, lw: 2.4, label: 'merged (only merged counts)' },
        { kind: 'line', color: T.dim, lw: 1.4, dash: [5, 4], label: 'even pace' },
        { kind: 'line', color: T.text, lw: 1.6, label: 'committed' },
        { kind: 'waste', label: 'past the cliff = 0 points' }
      ];
      var availW = Math.max(60, cssW - PAD * 2);
      var legH = legendHeight(legItems, availW);
      drawLegend(legItems, PAD, top, availW);

      var x0 = PAD + 30, x1 = cssW - PAD - 8, yTop = top + legH + 10, yBot = cssH - PAD - 26;
      if (x1 - x0 < 70 || yBot - yTop < 46) { drawEmpty(PAD, top, cssW - PAD, cssH - PAD, 'TOO SMALL'); return; }

      var xmaxD = totalDays * 1.12;
      var ymax = Math.max(committed, mergedTotal) * 1.1;
      if (!isFin(ymax) || ymax <= 0) ymax = 1;
      var X = makeScale(0, xmaxD, x0, x1);
      var Y = makeScale(0, ymax, yBot, yTop);

      pRect(x0, yTop, x1 - x0, yBot - yTop, T.panel);
      if (noCommitment) {
        pStrokeRect(x0, yTop, x1 - x0, yBot - yTop, T.border, 1);
        drawEmpty(x0, yTop, x1, yBot, 'NOTHING COMMITTED YET',
                  'Estimate the board and the burn-up starts here.');
        return;
      }

      /* the cliff and the dead zone past it */
      var xc = clamp(X(totalDays), x0, x1);
      pRect(xc, yTop, x1 - xc, yBot - yTop, hexA(T.bad, 0.10));
      pHatch(xc, yTop, x1 - xc, yBot - yTop, hexA(T.bad, 0.30), 1, 6);

      var step = niceStep(ymax, 5), v, gy;
      for (v = 0; v <= ymax + 1e-9; v += step) {
        gy = Y(v);
        pHLine(gy, x0, x1, hexA(T.grid, 0.95), 1);
        pText(fmt(v, step < 1 ? 1 : 0), x0 - 6, gy, font(9), T.faint, 'right', 'middle');
      }
      var dEvery = 1;
      while ((x1 - x0) / xmaxD * dEvery < 22 && dEvery < 5) dEvery++;
      for (i = 0; i <= totalDays; i++) {
        var gx = X(i);
        pVLine(gx, yTop, yBot, hexA(T.grid, 0.8), 1);
        if (i > 0 && i % dEvery === 0 && i <= totalDays) {
          pText('D' + i, clamp(gx, x0 + 6, x1 - 6), yBot + 10, font(9), T.faint, 'center', 'middle');
        }
      }

      /* committed ceiling */
      var yc = Y(committed);
      pHLine(yc, x0, x1, hexA(T.text, 0.75), 1.6);
      pChip('COMMITTED ' + fmt(committed, 0), x0 + 6, clamp(yc - 10, yTop + 8, yBot - 8),
            font(9, 'bold'), T.text, 'left', hexA(T.bg, 0.9), 4, hexA(T.border, 0.9));

      /* even pace */
      pLine(X(0), Y(0), X(totalDays), Y(committed), hexA(T.dim, 0.7), 1.4, [5, 4]);

      /* merged step */
      var cum = 0, ptsX = [X(0)], ptsY = [Y(0)];
      for (i = 0; i < series.length; i++) {
        var d = clamp(num(series[i].day, day), 0, totalDays);
        cum += num(series[i].points, 0);
        ptsX.push(X(d)); ptsY.push(Y(cum - num(series[i].points, 0)));
        ptsX.push(X(d)); ptsY.push(Y(cum));
      }
      var xNow = clamp(X(clamp(day, 0, totalDays)), x0, x1);
      ptsX.push(xNow); ptsY.push(Y(cum));

      ctx.save();
      ctx.beginPath(); ctx.rect(x0, yTop, x1 - x0, yBot - yTop); ctx.clip();
      /* area */
      ctx.beginPath();
      var ok = false;
      for (i = 0; i < ptsX.length; i++) {
        if (!isFin(ptsX[i]) || !isFin(ptsY[i])) continue;
        if (!ok) { ctx.moveTo(ptsX[i], ptsY[i]); ok = true; } else ctx.lineTo(ptsX[i], ptsY[i]);
      }
      if (ok) {
        var lastX = ptsX[ptsX.length - 1], y0b = Y(0);
        if (isFin(lastX) && isFin(y0b)) {
          ctx.lineTo(lastX, y0b); ctx.lineTo(ptsX[0], y0b); ctx.closePath();
          ctx.fillStyle = hexA(T.good, 0.16); ctx.fill();
        }
      }
      /* line */
      ctx.beginPath(); ok = false;
      for (i = 0; i < ptsX.length; i++) {
        if (!isFin(ptsX[i]) || !isFin(ptsY[i])) continue;
        if (!ok) { ctx.moveTo(ptsX[i], ptsY[i]); ok = true; } else ctx.lineTo(ptsX[i], ptsY[i]);
      }
      if (ok) { ctx.strokeStyle = T.good; ctx.lineWidth = 2.4; ctx.stroke(); }

      /* projection at the current pace — dotted, clearly a guess */
      if (day > 0.3 && cum > 0 && day < totalDays) {
        var vel = cum / day;
        var proj = Math.min(committed, cum + vel * (totalDays - day));
        pLine(xNow, Y(cum), X(totalDays), Y(proj), hexA(T.accent, 0.85), 1.4, [2, 3]);
        pShape('circle', X(totalDays), Y(proj), 3, T.bg, T.accent, 1.4);
      }
      ctx.restore();

      /* the shortfall bracket at the cliff */
      var short = committed - cum;
      if (short > 1e-6) {
        var yA = Y(cum), yB = Y(committed);
        var bx = clamp(xc - 12, x0 + 4, x1 - 4);
        pVLine(bx, yB, yA, T.bad, 2);
        pLine(bx - 4, roundPx(yB), bx + 4, roundPx(yB), T.bad, 2);
        pLine(bx - 4, roundPx(yA), bx + 4, roundPx(yA), T.bad, 2);
        var stxt = fmt(short, 0) + ' pts short';
        if (Math.abs(yA - yB) > 22 && bx - x0 > textW(stxt, font(9, 'bold')) + 16) {
          pChip(stxt, bx - 6, (yA + yB) / 2, font(9, 'bold'), T.bad, 'right', hexA(T.bg, 0.92), 4, hexA(T.bad, 0.8));
        }
      }

      /* cliff rule + banner */
      pVLine(xc, yTop - 4, yBot + 2, T.bad, 2.4);
      var clab = 'SPRINT END';
      var cw = textW(clab, font(9, 'bold')) + 8;
      var clx = (x1 - xc > cw + 6) ? xc + 4 : Math.max(x0, xc - cw - 4);
      pRect(clx, yTop + 2, cw, 14, T.bg);
      pText(clab, clx + 4, yTop + 9, font(9, 'bold'), T.bad, 'left', 'middle');
      if (x1 - xc > 46 && yBot - yTop > 60) {
        pText('UNMERGED', (xc + x1) / 2, (yTop + yBot) / 2 - 7, font(9, 'bold'), hexA(T.bad, 0.8), 'center', 'middle');
        pText('= 0 pts', (xc + x1) / 2, (yTop + yBot) / 2 + 6, font(9, 'bold'), hexA(T.bad, 0.8), 'center', 'middle');
      }

      /* NOW */
      pVLine(xNow, yTop, yBot, hexA(T.accent, 0.85), 1.4, [4, 3]);
      pShape('circle', xNow, Y(cum), 3.6, T.good, T.bg, 1.4);

      pStrokeRect(x0, yTop, x1 - x0, yBot - yTop, T.border, 1);
      pText('sprint day', (x0 + x1) / 2, yBot + 21, font(9), T.faint, 'center', 'middle');
    }

    /* ================================================================== *
     * VIEW 4 — trust()
     * ================================================================== */
    function drawTrust(c) {
      c = c || {};
      var raw = c.people;
      if (!raw || typeof raw.length !== 'number') {
        /* also accept the state's { trust:{deepa:61,...} } shape */
        var tm = c.trust && typeof c.trust === 'object' ? c.trust : null;
        raw = [];
        if (tm) for (var kk in tm) if (Object.prototype.hasOwnProperty.call(tm, kk)) {
          raw.push({ id: kk, name: kk, trust: tm[kk] });
        }
      }
      var people = [], i, sum = 0, n = 0;
      for (i = 0; i < raw.length; i++) {
        var p = raw[i];
        if (!p || typeof p !== 'object') continue;
        var val = num(p.trust, num(p.value, num(p.current, NaN)));
        if (isFin(val)) { val = clamp(val, 0, 100); sum += val; n++; }
        var d = num(p.delta, NaN);
        var st = num(p.start, num(p.startTrust, NaN));
        if (!isFin(d) && isFin(st) && isFin(val)) d = val - st;
        people.push({
          name: String(p.name != null ? p.name : (p.id != null ? p.id : '?')),
          role: p.role != null ? String(p.role) : '',
          trust: val, delta: d, start: st
        });
      }
      var avg = n ? sum / n : NaN;

      var top = drawTitle('TRUST — earned by how you ask, not whether',
                          isFin(avg) ? 'avg ' + fmt(avg, 0) : '');

      var nameF = font(11);
      var labelW = 92;
      for (i = 0; i < people.length; i++) labelW = Math.max(labelW, textW(people[i].name, nameF) + 10);
      labelW = Math.min(labelW, Math.max(70, cssW * 0.34));
      var gutterW = cssW > 340 ? 84 : 0;

      var x0 = PAD + labelW + 8, x1 = cssW - PAD - gutterW;
      var yTop = top + 20, yBot = cssH - PAD - 24;
      if (x1 - x0 < 60 || yBot - yTop < 24) { drawEmpty(PAD, top, cssW - PAD, cssH - PAD, 'TOO SMALL'); return; }
      if (!people.length) {
        pRect(PAD, yTop, cssW - PAD * 2, yBot - yTop, T.panel);
        pStrokeRect(PAD, yTop, cssW - PAD * 2, yBot - yTop, T.border, 1);
        drawEmpty(PAD, yTop, cssW - PAD, yBot, 'NO PEOPLE');
        return;
      }

      var X = makeScale(0, 100, x0, x1);
      pRect(x0, yTop, x1 - x0, yBot - yTop, T.panel);
      var rowH = (yBot - yTop) / people.length;
      var barH = Math.min(rowH * 0.46, 18);
      for (i = 0; i < people.length; i++) pRect(x0, yTop + i * rowH, x1 - x0, rowH, i % 2 ? T.rowB : T.rowA);

      for (i = 0; i <= 100; i += 25) {
        pVLine(X(i), yTop, yBot, hexA(T.grid, 0.9), 1);
        pText(String(i), X(i), yBot + 9, font(8), T.faint, 'center', 'middle');
      }
      /* the grade cap: below 40 average and the sprint is capped at C */
      var capX = X(40);
      pVLine(capX, yTop, yBot, hexA(T.bad, 0.45), 1, [3, 3]);
      pText('GRADE CAP 40', clamp(capX, x0 + 34, x1 - 34), top + 10, font(8, 'bold'), hexA(T.bad, 0.9), 'center', 'middle');

      for (i = 0; i < people.length; i++) {
        var pp = people[i];
        var cy = yTop + i * rowH + rowH / 2;
        var by = cy - barH / 2;
        var col = !isFin(pp.trust) ? T.faint
                : (pp.trust < 40 ? T.bad : (pp.trust < 55 ? T.warn : (pp.trust >= 75 ? T.good : T.accent)));

        pRect(x0, by, x1 - x0, barH, hexA(T.dim, 0.10));
        if (isFin(pp.trust)) {
          var w = X(pp.trust) - x0;
          pRect(x0, by, Math.max(1, w), barH, hexA(col, 0.75));
          if (isFin(pp.delta) && Math.abs(pp.delta) > 0.01) {
            var prev = clamp(pp.trust - pp.delta, 0, 100);
            var xa = X(Math.min(prev, pp.trust)), xb = X(Math.max(prev, pp.trust));
            if (xb - xa > 0.7) {
              if (pp.delta > 0) {
                pRect(xa, by, xb - xa, barH, hexA(T.good, 0.55));
              } else {
                /* a loss is a hollow hatched ghost BEYOND the bar's end, so it
                 * can never be misread as trust the player still has */
                pRect(xa, by + 2, xb - xa, barH - 4, hexA(T.bad, 0.12));
                pHatch(xa, by + 2, xb - xa, barH - 4, hexA(T.bad, 0.75), 1, 4);
                pStrokeRect(xa, by + 2, xb - xa, barH - 4, hexA(T.bad, 0.8), 1);
              }
              pVLine(X(prev), by - 2, by + barH + 2, hexA(T.white, 0.5), 1, [2, 2]);
            }
          }
          pVLine(X(pp.trust), by - 3, by + barH + 3, col, 1.6);
        }

        pText(fitText(pp.name, labelW - 4, nameF), x0 - 8, cy - (rowH > 30 && pp.role ? 6 : 0), nameF, T.text, 'right', 'middle');
        if (rowH > 30 && pp.role) {
          pText(fitText(pp.role.toUpperCase(), labelW - 4, font(8)), x0 - 8, cy + 7, font(8), T.faint, 'right', 'middle');
        }
        if (gutterW) {
          pText(isFin(pp.trust) ? fmt(pp.trust, 0) : '--', x1 + 30, cy, font(13, 'bold'), col, 'right', 'middle');
          if (isFin(pp.delta) && Math.abs(pp.delta) > 0.01) {
            var ad = Math.abs(pp.delta);
            pText((pp.delta > 0 ? '▲' : '▼') + (ad >= 100 ? '99+' : fmt(ad, 0)), x1 + 36, cy,
                  font(9, 'bold'), pp.delta > 0 ? T.good : T.bad, 'left', 'middle');
          } else if (isFin(pp.trust)) {
            pText('—', x1 + 36, cy, font(9), T.faint, 'left', 'middle');
          }
        }
      }

      if (isFin(avg)) {
        var ax2 = X(avg);
        pVLine(ax2, yTop - 3, yBot + 3, hexA(T.white, 0.6), 1.5, [5, 3]);
        var atxt = 'AVG ' + fmt(avg, 0);
        pText(atxt, clamp(ax2, x0 + textW(atxt, font(8, 'bold')) / 2, x1 - textW(atxt, font(8, 'bold')) / 2),
              yBot + 19, font(8, 'bold'), hexA(T.white, 0.9), 'center', 'middle');
      }
      pStrokeRect(x0, yTop, x1 - x0, yBot - yTop, T.border, 1);
    }

    /* ================================================================== *
     * VIEW 5 — truth(). DEBRIEF ONLY.
     * ================================================================== */
    function routeOf(x) {
      /* accept [actionId], [{actionId,hours}], or a history array */
      var out = [];
      if (!x || typeof x.length !== 'number') return out;
      for (var i = 0; i < x.length; i++) {
        var e = x[i];
        if (e == null) continue;
        if (typeof e === 'string') {
          var kd = ASK_RE.test(e) ? 'ask' : (e === 'implement' ? 'implement' : (e === 'write_tests' ? 'tests' : (e === 'open_pr' ? 'pr' : 'investigate')));
          out.push({ actionId: e, kind: kd, hrs: eventHours({}, kd) * (ACTION_MIN[e] ? 0 : 1) + (ACTION_MIN[e] ? ACTION_MIN[e] / 60 : 0),
                     gained: NaN, cls: 'unknown' });
        } else if (typeof e === 'object') {
          var k2 = eventKind(e);
          var g = num(e.gained, num(e.delta, NaN));
          var learn2 = (k2 === 'investigate' || k2 === 'ask');
          out.push({
            actionId: String(e.actionId || e.action || e.id || k2),
            kind: k2, hrs: Math.min(60, Math.max(0, eventHours(e, k2))),
            gained: g,
            cls: !learn2 ? 'build'
               : (isFin(g) ? (g < -0.01 ? 'neg' : (isDry(g, eventHours(e, k2)) ? 'dry' : 'gain')) : 'unknown'),
            classification: e.classification != null ? String(e.classification) : null
          });
        }
      }
      return out;
    }

    function drawTruth(c) {
      c = c || {};
      absorbActions(c.actions);
      var rows = [], i, j;
      var raw = (c.perTicket && typeof c.perTicket.length === 'number') ? c.perTicket : [];
      var paths = (c.paths && typeof c.paths === 'object') ? c.paths : {};

      for (i = 0; i < raw.length; i++) {
        var t = raw[i];
        if (!t || typeof t !== 'object') continue;
        var id = t.id != null ? String(t.id) : ('T' + (i + 1));
        var mine = routeOf(t.route || t.actual || t.history || t.actions);
        var best = routeOf(t.best || t.bestPath || paths[id]);
        var mineH = 0, bestH = 0, wasteH = 0;
        for (j = 0; j < mine.length; j++) { mineH += mine[j].hrs; if (mine[j].cls === 'neg') wasteH += mine[j].hrs; }
        for (j = 0; j < best.length; j++) bestH += best[j].hrs;
        var hs = num(t.hoursSpent, NaN);
        if (isFin(hs) && hs > mineH) mineH = hs;
        var bh = num(t.bestHours, NaN);
        if (isFin(bh) && bh > 0) bestH = bh;

        /* where the player actually asked, in hours-on-ticket */
        var askAt = num(t.askedAtHours, NaN);
        if (!isFin(askAt)) {
          var cum = 0;
          for (j = 0; j < mine.length; j++) {
            if (mine[j].kind === 'ask') { askAt = cum; break; }
            cum += mine[j].hrs;
          }
        }
        /* where asking WAS right: the ask in the efficient route, else the timebox */
        var optAt = NaN, cum2 = 0;
        for (j = 0; j < best.length; j++) {
          if (best[j].kind === 'ask') { optAt = cum2; break; }
          cum2 += best[j].hrs;
        }
        if (!isFin(optAt)) optAt = num(t.timeboxHours, NaN);

        rows.push({
          id: id, title: t.title != null ? String(t.title) : '',
          merged: t.merged === true || String(t.status || '').toLowerCase() === 'merged',
          mine: mine, best: best, mineH: mineH, bestH: bestH, waste: wasteH,
          askAt: askAt, optAt: optAt,
          verdict: String(t.verdict || '').toLowerCase(),
          note: t.note != null ? String(t.note) : ''
        });
      }

      var totMine = 0, totBest = 0;
      for (i = 0; i < rows.length; i++) { totMine += rows[i].mineH; totBest += rows[i].bestH; }
      if (isFin(num(c.hoursSpent, NaN))) totMine = num(c.hoursSpent, totMine);
      if (isFin(num(c.bestHours, NaN))) totBest = num(c.bestHours, totBest);

      var sub = fmtH(totMine) + ' spent  ·  ' + fmtH(totBest) + ' was enough';
      var top = drawTitle('THE ROUTE YOU TOOK vs THE ROUTE THAT WORKED', sub);

      var legItems = [
        { kind: 'line', color: T.dim, lw: 7, label: 'upper lane = yours' },
        { kind: 'line', color: T.good, lw: 7, label: 'lower lane = the efficient route' },
        { kind: 'waste', label: 'time that bought nothing' },
        { kind: 'shape', shape: 'star', color: T.warn, label: 'the right moment to ask' },
        { kind: 'shape', shape: 'diamond', color: T.accent, label: 'when you actually asked' }
      ];
      var availW = Math.max(60, cssW - PAD * 2);
      var legH = legendHeight(legItems, availW);
      drawLegend(legItems, PAD, top, availW);

      var labelF = font(10, 'bold');
      var labelW = 84;
      for (i = 0; i < rows.length; i++) labelW = Math.max(labelW, textW(rows[i].id, labelF) + 12);
      labelW = Math.min(labelW, Math.max(70, cssW * 0.20));
      var gutterW = cssW > 440 ? 84 : 0;

      var x0 = PAD + labelW + 8, x1 = cssW - PAD - gutterW;
      var yTop = top + legH + 6, yBot = cssH - PAD - 16;
      if (x1 - x0 < 70 || yBot - yTop < 30) { drawEmpty(PAD, top, cssW - PAD, cssH - PAD, 'TOO SMALL'); return; }
      if (!rows.length) {
        pRect(x0, yTop, x1 - x0, yBot - yTop, T.panel);
        pStrokeRect(x0, yTop, x1 - x0, yBot - yTop, T.border, 1);
        drawEmpty(x0, yTop, x1, yBot, 'NOTHING TO COMPARE');
        return;
      }

      var hmax = 1;
      for (i = 0; i < rows.length; i++) {
        if (rows[i].mineH > hmax) hmax = rows[i].mineH;
        if (rows[i].bestH > hmax) hmax = rows[i].bestH;
      }
      hmax *= 1.04;
      var X = makeScale(0, hmax, x0, x1);

      var availH = yBot - yTop;
      var grpH = availH / rows.length;
      var shown = rows.length;
      if (grpH < 26) { shown = Math.max(1, Math.floor(availH / 26)); grpH = availH / shown; }
      grpH = Math.min(grpH, 62);
      yBot = yTop + grpH * shown;

      pRect(x0, yTop, x1 - x0, yBot - yTop, T.panel);
      for (i = 0; i < shown; i++) pRect(x0, yTop + i * grpH, x1 - x0, grpH, i % 2 ? T.rowB : T.rowA);

      /* hour grid */
      var step = niceStep(hmax, Math.max(2, Math.floor((x1 - x0) / 70))), v;
      for (v = 0; v <= hmax + 1e-9; v += step) {
        var gx = X(v);
        pVLine(gx, yTop, yBot, hexA(T.grid, 0.85), 1);
        if (v > 0) pText(fmt(v, step < 1 ? 1 : 0) + 'h', clamp(gx, x0 + 8, x1 - 8), yTop - 6, font(8), T.faint, 'center', 'middle');
      }

      var barH = Math.min(Math.max(6, grpH * 0.24), 13);
      var wide = grpH >= 34;
      for (i = 0; i < shown; i++) {
        var R = rows[i];
        var gy0 = yTop + i * grpH;
        var yMine = gy0 + grpH * (wide ? 0.46 : 0.33);
        var yBest = gy0 + grpH * (wide ? 0.78 : 0.72);

        drawRoute(R.mine, R.mineH, X, x0, x1, yMine - barH / 2, barH, false);
        drawRoute(R.best, R.bestH, X, x0, x1, yBest - barH * 0.4, barH * 0.8, true);

        /* the two ask marks — this is the lesson of the whole sim */
        var bestAsks = false;
        for (j = 0; j < R.best.length; j++) if (R.best[j].kind === 'ask') { bestAsks = true; break; }
        if (isFin(R.optAt) && R.optAt >= 0) {
          var ox = clamp(X(R.optAt), x0 + 5, x1 - 5);
          pVLine(ox, gy0 + 2, gy0 + grpH - 3, hexA(T.warn, 0.6), 1, [3, 3]);
          pShape('star', ox, clamp(yBest, gy0 + 5, gy0 + grpH - 5), 5, T.warn, T.bg, 1.2);
        }
        if (isFin(R.askAt) && R.askAt >= 0) {
          var kx = clamp(X(R.askAt), x0 + 2, x1 - 2);
          pShape('diamond', kx, clamp(yMine - barH / 2 - 5, gy0 + 4, gy0 + grpH - 4), 4.2, T.accent, T.bg, 1);
        } else {
          var nx2 = clamp(X(R.mineH) + 6, x0, x1 - 4);
          var ntxt = bestAsks ? 'NEVER ASKED' : 'no ask needed';
          if (x1 - nx2 > textW(ntxt, font(8, 'bold')) + 6) {
            pText(ntxt, nx2, yMine, font(8, 'bold'), bestAsks ? T.bad : T.faint, 'left', 'middle');
          }
        }

        var col = R.merged ? T.good : T.dim;
        if (wide) {
          pText(fitText(R.id + (R.merged ? ' ✓' : ''), labelW - 6, labelF), x0 - 8, gy0 + grpH * 0.17,
                labelF, col, 'right', 'middle');
          pText('yours', x0 - 8, yMine, font(8), hexA(T.dim, 0.95), 'right', 'middle');
          pText('best', x0 - 8, yBest, font(8), hexA(T.good, 0.9), 'right', 'middle');
        } else {
          pText(fitText(R.id, labelW - 6, labelF), x0 - 8, gy0 + grpH * 0.5, labelF, col, 'right', 'middle');
        }

        if (gutterW) {
          var d = R.mineH - R.bestH;
          var dy = clamp(gy0 + grpH * 0.36, gy0 + 8, gy0 + grpH - 8);
          pText(fmtSigned(d) + 'h', x1 + 6, dy, font(11, 'bold'),
                d > 0.05 ? T.bad : T.good, 'left', 'middle');
          if (grpH >= 30 && R.verdict) {
            var vc = /right/.test(R.verdict) ? T.good : (/never|late/.test(R.verdict) ? T.bad : (/early/.test(R.verdict) ? T.warn : T.faint));
            pText(fitText('ask ' + R.verdict, gutterW - 8, font(8, 'bold')), x1 + 6,
                  clamp(dy + 12, gy0 + 8, gy0 + grpH - 4), font(8, 'bold'), vc, 'left', 'middle');
          }
        }
        if (i < shown - 1) pHLine(gy0 + grpH, x0, x1, hexA(T.border, 0.45), 1);
      }
      if (shown < rows.length) {
        pText('+' + (rows.length - shown) + ' more', x0 + 6, yBot - 6, font(9), T.faint, 'left', 'middle');
      }
      pStrokeRect(x0, yTop, x1 - x0, yBot - yTop, T.border, 1);
    }

    function drawRoute(route, totalH, X, x0, x1, y, h, isBest) {
      var cur = 0, i;
      if (!route || !route.length) {
        if (totalH > 0) {
          var ex0 = clamp(X(0), x0, x1), ex1 = clamp(X(totalH), x0, x1);
          pRect(ex0, y, Math.max(2, ex1 - ex0), h, hexA(T.dim, 0.18));
          pStrokeRect(ex0, y, Math.max(2, ex1 - ex0), h, hexA(T.border, 0.9), 1);
        }
        return;
      }
      for (i = 0; i < route.length; i++) {
        var s = route[i];
        var sx = clamp(X(cur), x0, x1), ex = clamp(X(cur + s.hrs), x0, x1);
        cur += s.hrs;
        var w = Math.max(1.6, ex - sx);
        if (sx + w > x1) sx = Math.max(x0, x1 - w);
        var stl = styleFor(s.actionId || s.kind);
        if (s.cls === 'neg') {
          pRect(sx, y, w, h, hexA(T.bad, 0.26));
          pHatch(sx, y, w, h, hexA(T.bad, 0.95), 1.1, 4);
          pStrokeRect(sx, y, w, h, T.bad, 1.4);
        } else if (s.cls === 'dry') {
          pRect(sx, y, w, h, hexA(T.dim, 0.14));
          pStrokeRect(sx, y, w, h, hexA(T.dim, 0.85), 1, [2, 2]);
        } else {
          pRect(sx, y, w, h, hexA(isBest ? T.good : stl.color, isBest ? 0.55 : 0.8));
          if (isBest) pStrokeRect(sx, y, w, h, hexA(T.good, 0.9), 1);
        }
        if (w >= 12 && h >= 9) {
          pText(stl.code, sx + w / 2, y + h / 2, font(8, 'bold'), isBest ? T.white : (s.cls === 'neg' ? T.wasteInk : T.bg), 'center', 'middle');
        }
      }
    }

    /* ================================================================== *
     * Dispatch
     * ================================================================== */
    function draw() {
      if (destroyed) return;
      var ok = beginFrame();
      if (!ok) { tooSmall(); return; }
      curFont = '';
      try {
        if (mode === 'timeline') drawTimeline(cfg);
        else if (mode === 'understanding') drawUnderstanding(cfg);
        else if (mode === 'burn') drawBurn(cfg);
        else if (mode === 'trust') drawTrust(cfg);
        else if (mode === 'truth') drawTruth(cfg);
      } catch (e) {
        /* a chart must never take the app down with it */
        try {
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.fillStyle = T.bad;
          ctx.font = font(10);
          ctx.textAlign = 'left';
          ctx.textBaseline = 'alphabetic';
          ctx.fillText('board error: ' + (e && e.message ? e.message : e), 10, 20);
        } catch (e2) { /* nothing left to do */ }
        if (global.console && global.console.error) global.console.error(e);
      }
    }

    function renderer(kind) {
      return function (c) { mode = kind; cfg = c || {}; draw(); return api; };
    }

    var api = {
      timeline:      renderer('timeline'),
      understanding: renderer('understanding'),
      burn:          renderer('burn'),
      trust:         renderer('trust'),
      truth:         renderer('truth'),
      resize: function () { syncBackingStore(); draw(); return api; },
      clear:  function () { mode = null; cfg = null; beginFrame(); return api; },
      destroy: function () { destroyed = true; mode = null; cfg = null; },
      size:   function () { return { w: cssW, h: cssH, dpr: dpr }; }
    };

    syncBackingStore();
    return api;
  }

  global.Board = {
    create: create,
    THEME: THEME,
    ACTION_STYLE: ACTION_STYLE,
    VERSION: VERSION
  };

})(typeof window !== 'undefined' ? window : this);
