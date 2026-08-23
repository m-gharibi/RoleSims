/* ============================================================================
 * sim/viz.js  —  window.Viz
 * Product Manager Sim: hand-rolled canvas-2D renderer for the five plots.
 *
 * NO modules, NO imports, NO libraries. Loads via <script src> from file://.
 *
 *   var v = Viz.create(canvasEl, { theme: "dark" });
 *   v.evidence({ rows:[ {feature, readings:[{instrument,value,color}], predicted} ] });
 *   v.gantt({ roadmap, week, totalWeeks, capacityLeft });
 *   v.trust({ stakeholders:[{name, trust, delta}] });
 *   v.impact({ baseline, shipped:[{name, delta}], projected });
 *   v.truth({ perFeature, instruments });     // DEBRIEF ONLY
 *   v.resize();
 *
 * DESIGN RULE (SPEC §3): `evidence` is the centrepiece. A feature whose
 * instruments disagree must LOOK contradictory before any number is read —
 * the spread range-bar behind the dots is the dominant mark, it is tinted and
 * hatched by severity, and the disagreement is restated in the right gutter.
 *
 * NaN RULE: every pixel that reaches the 2D context passes through one of the
 * guarded primitives near the top of `create()` (pRect / pLine / pText / ...).
 * They drop any call with a non-finite argument. Degenerate input therefore
 * cannot produce a NaN draw call, only a missing mark.
 * ==========================================================================*/

;(function (global) {
  'use strict';

  var VERSION = '1.0.0';

  /* --------------------------------------------------------------------- *
   * Theme — SPEC §3 palette, shared with the sibling sims.
   * --------------------------------------------------------------------- */
  var THEME = {
    bg:         '#0d1117',
    panel:      '#161b22',
    border:     '#30363d',
    text:       '#c9d1d9',
    dim:        '#8b949e',
    good:       '#3fb950',
    bad:        '#f85149',
    warn:       '#d29922',
    accent:     '#39c5cf',
    /* derived, all within the family */
    faint:      '#6e7681',
    grid:       '#1b2027',
    gridStrong: '#242b34',
    rowA:       '#12171e',
    rowB:       '#171d25',
    white:      '#f0f6fc'        /* reserved: the player and the truth only */
  };

  /* Canvas has no font-variant-numeric; a monospace face is what gives us
   * tabular figures, so every label in this file is monospace by construction. */
  var MONO = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';
  function font(px, weight) { return (weight ? weight + ' ' : '') + px + 'px ' + MONO; }

  /* --------------------------------------------------------------------- *
   * INSTRUMENT PALETTE — colour-blind safe.
   *
   * Base set is Okabe & Ito's 8-colour qualitative palette, the standard
   * set verified distinguishable under protanopia, deuteranopia and
   * tritanopia. Two members are too dark to read as 5px dots on #0d1117, so
   * they are lightened along their own hue (blue #0072B2 -> #1e8fd5, bluish
   * green #009E73 -> #12b389) and vermillion is pushed slightly redder
   * (#D55E00 -> #e8613c) to widen its separation from orange under
   * deuteranopia. Hue order and mutual separation are preserved.
   *
   * Colour is never the only channel: every instrument also owns a distinct
   * MARKER SHAPE, so the plots stay readable in greyscale and for
   * monochromacy. White (#f0f6fc) is never an instrument colour — it is
   * reserved for the player's own prediction and for ground truth.
   * --------------------------------------------------------------------- */
  var INSTRUMENTS = [
    { id: 'sales_anecdote',  label: 'SALES',      color: '#e69f00', shape: 'circle'   },
    { id: 'support_tickets', label: 'SUPPORT',    color: '#56b4e9', shape: 'square'   },
    { id: 'usage_analytics', label: 'ANALYTICS',  color: '#12b389', shape: 'triUp'    },
    { id: 'survey',          label: 'SURVEY',     color: '#f0e442', shape: 'diamond'  },
    { id: 'interviews',      label: 'INTERVIEWS', color: '#1e8fd5', shape: 'triDown'  },
    { id: 'fake_door',       label: 'FAKE-DOOR',  color: '#e8613c', shape: 'pentagon' },
    { id: 'ab_test',         label: 'A/B TEST',   color: '#cc79a7', shape: 'star'     }
  ];
  var FALLBACK_SHAPES = ['circle', 'square', 'triUp', 'diamond', 'triDown', 'pentagon', 'star'];

  var INST_BY_ID = {};
  (function () {
    for (var i = 0; i < INSTRUMENTS.length; i++) INST_BY_ID[INSTRUMENTS[i].id] = INSTRUMENTS[i];
  })();

  function hashStr(s) {
    var h = 2166136261, i;
    s = String(s == null ? '' : s);
    for (i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 16777619) >>> 0; }
    return h >>> 0;
  }

  /* Unknown instrument ids still get a stable colour + shape. */
  function instMeta(id) {
    var k = String(id == null ? '' : id);
    var m = INST_BY_ID[k];
    if (m) return m;
    var h = hashStr(k);
    var base = INSTRUMENTS[h % INSTRUMENTS.length];
    return {
      id: k,
      label: k ? k.replace(/[_\-]+/g, ' ').toUpperCase().slice(0, 12) : '?',
      color: base.color,
      shape: FALLBACK_SHAPES[(h >>> 3) % FALLBACK_SHAPES.length]
    };
  }
  function instColor(id) { return instMeta(id).color; }
  function instLabel(id) { return instMeta(id).label; }

  /* --------------------------------------------------------------------- *
   * Numeric + string helpers. Every one is NaN-hardened.
   * --------------------------------------------------------------------- */
  function isFin(x) { return typeof x === 'number' && isFinite(x); }
  function num(x, d) { return (typeof x === 'number' && isFinite(x)) ? x : d; }
  function clamp(v, a, b) {
    if (!isFin(v)) return a;
    return v < a ? a : (v > b ? b : v);
  }
  function roundPx(v) { return Math.round(v) + 0.5; }

  function fmt(v, dp) {
    if (!isFin(v)) return '--';
    return v.toFixed(dp == null ? 1 : dp);
  }
  function fmtSigned(v, dp) {
    if (!isFin(v)) return '--';
    var s = Math.abs(v).toFixed(dp == null ? 1 : dp);
    if (v > 0) return '+' + s;
    if (v < 0) return '−' + s;      /* real minus sign, same width in mono */
    return ' ' + s;
  }

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
    return (isFin(s) && s > 0) ? s : 1;
  }
  function stepDp(step) {
    if (!isFin(step) || step <= 0) return 1;
    if (step >= 1) return 0;
    if (step >= 0.1) return 1;
    return 2;
  }

  /* hex -> rgba(). Guards junk input back to a visible neutral. */
  function hexA(hex, a) {
    var h = String(hex == null ? '' : hex).trim();
    if (h.charAt(0) === '#') h = h.slice(1);
    if (h.length === 3) h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
    if (!/^[0-9a-fA-F]{6}$/.test(h)) h = '8b949e';
    var r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    var al = num(a, 1);
    if (al < 0) al = 0; if (al > 1) al = 1;
    return 'rgba(' + r + ',' + g + ',' + b + ',' + al + ')';
  }
  function okColor(c, fb) {
    var s = (typeof c === 'string') ? c.trim() : '';
    if (/^#[0-9a-fA-F]{3}$/.test(s) || /^#[0-9a-fA-F]{6}$/.test(s) || /^rgba?\(/.test(s)) return s;
    return fb;
  }

  /* A "domain" is always finite and always has positive width. */
  function domainOf(values, opts) {
    opts = opts || {};
    var lo = Infinity, hi = -Infinity, i, v, n = 0;
    for (i = 0; i < values.length; i++) {
      v = values[i];
      if (!isFin(v)) continue;
      n++;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    if (!n) { lo = opts.emptyLo != null ? opts.emptyLo : -1; hi = opts.emptyHi != null ? opts.emptyHi : 1; }
    if (opts.includeZero) { if (lo > 0) lo = 0; if (hi < 0) hi = 0; }
    if (opts.symmetric) { var m = Math.max(Math.abs(lo), Math.abs(hi)); if (!(m > 0)) m = 1; lo = -m; hi = m; }
    var span = hi - lo;
    if (!isFin(span) || span <= 0) {
      var pad0 = Math.max(1, Math.abs(hi) * 0.1);
      lo -= pad0; hi += pad0;
      span = hi - lo;
      if (!isFin(span) || span <= 0) { lo = -1; hi = 1; }
    } else {
      var p = span * num(opts.pad, 0.08);
      lo -= p; hi += p;
    }
    if (!isFin(lo) || !isFin(hi) || hi <= lo) { lo = -1; hi = 1; }
    return { lo: lo, hi: hi };
  }

  function prettyId(id) {
    var s = String(id == null ? '' : id);
    if (!s) return '(unnamed)';
    return s.replace(/[_\-]+/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }
  function nameOf(o, idKey) {
    if (!o || typeof o !== 'object') return '(unnamed)';
    if (typeof o.name === 'string' && o.name) return o.name;
    if (typeof o.feature === 'string' && o.feature) return o.feature;
    if (o.feature && typeof o.feature === 'object') {
      if (typeof o.feature.name === 'string' && o.feature.name) return o.feature.name;
      if (typeof o.feature.id === 'string' && o.feature.id) return prettyId(o.feature.id);
    }
    var k = idKey || 'id';
    if (typeof o[k] === 'string' && o[k]) return prettyId(o[k]);
    if (typeof o.featureId === 'string' && o.featureId) return prettyId(o.featureId);
    if (typeof o.id === 'string' && o.id) return prettyId(o.id);
    return '(unnamed)';
  }

  /* Spread severity — 3pp is the sim's own "instruments disagree" threshold. */
  function severity(spread) {
    if (!isFin(spread)) return 0;
    if (spread >= 3) return 2;
    if (spread >= 1.5) return 1;
    return 0;
  }
  function sevColor(s) {
    return s >= 2 ? THEME.bad : (s >= 1 ? THEME.warn : THEME.accent);
  }

  /* ===================================================================== *
   * Instance
   * ===================================================================== */
  function create(canvasEl, opts) {
    opts = opts || {};
    if (!canvasEl || typeof canvasEl.getContext !== 'function') {
      throw new Error('Viz.create: first argument must be a <canvas> element');
    }
    var ctx = canvasEl.getContext('2d');
    if (!ctx) throw new Error('Viz.create: could not get a 2d context');

    var T = THEME;                       /* only a dark theme exists today */
    var cssW = 0, cssH = 0, dpr = 0;
    var last = null;                     /* {kind, cfg} — replayed by resize() */
    var destroyed = false;
    var twCache = {}, twFont = '';

    /* ------------------------------------------------------------------- *
     * Sizing / HiDPI
     * ------------------------------------------------------------------- */
    function measure() {
      var w = canvasEl.clientWidth | 0;
      var h = canvasEl.clientHeight | 0;
      if (!w || !h) {
        var aw = canvasEl.width || 0, ah = canvasEl.height || 0;
        w = w || aw || 800;
        h = h || ah || 400;
      }
      return { w: Math.max(0, w), h: Math.max(0, h) };
    }
    function syncBackingStore() {
      var d = num(global.devicePixelRatio, 1);
      if (!(d > 0)) d = 1;
      d = clamp(d, 1, 3);
      var s = measure();
      if (s.w === cssW && s.h === cssH && d === dpr) return false;
      cssW = s.w; cssH = s.h; dpr = d;
      canvasEl.width = Math.max(1, Math.round(cssW * dpr));
      canvasEl.height = Math.max(1, Math.round(cssH * dpr));
      return true;
    }

    /* ------------------------------------------------------------------- *
     * Guarded drawing primitives.
     * Nothing else in this file touches ctx geometry directly.
     * ------------------------------------------------------------------- */
    function setFont(f) {
      if (f !== twFont) { twFont = f; ctx.font = f; }
      else { ctx.font = f; }
    }
    function textW(s, f) {
      s = String(s == null ? '' : s);
      var key = f + '\u0000' + s;
      var c = twCache[key];
      if (c != null) return c;
      setFont(f);
      var w = 0;
      try { w = ctx.measureText(s).width; } catch (e) { w = s.length * 6; }
      if (!isFin(w)) w = s.length * 6;
      twCache[key] = w;
      return w;
    }
    function fitText(s, maxW, f) {
      s = String(s == null ? '' : s);
      if (!isFin(maxW) || maxW <= 4) return '';
      if (textW(s, f) <= maxW) return s;
      var lo = 0, hi = s.length, mid, best = '';
      while (lo <= hi) {
        mid = (lo + hi) >> 1;
        var cand = s.slice(0, mid) + '…';
        if (textW(cand, f) <= maxW) { best = cand; lo = mid + 1; }
        else hi = mid - 1;
      }
      return best;
    }

    function pRect(x, y, w, h, fill) {
      if (!isFin(x) || !isFin(y) || !isFin(w) || !isFin(h)) return;
      if (w <= 0 || h <= 0) return;
      ctx.fillStyle = fill;
      ctx.fillRect(x, y, w, h);
    }
    function pStrokeRect(x, y, w, h, stroke, lw) {
      if (!isFin(x) || !isFin(y) || !isFin(w) || !isFin(h)) return;
      if (w <= 0 || h <= 0) return;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = num(lw, 1);
      ctx.beginPath();
      ctx.rect(roundPx(x), roundPx(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
      ctx.stroke();
    }
    function pLine(x0, y0, x1, y1, stroke, lw, dash) {
      if (!isFin(x0) || !isFin(y0) || !isFin(x1) || !isFin(y1)) return;
      ctx.save();
      ctx.strokeStyle = stroke;
      ctx.lineWidth = num(lw, 1);
      if (dash && dash.length) ctx.setLineDash(dash);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      ctx.restore();
    }
    function pVLine(x, y0, y1, stroke, lw, dash) {
      if (!isFin(x)) return;
      pLine(roundPx(x), y0, roundPx(x), y1, stroke, lw, dash);
    }
    function pHLine(y, x0, x1, stroke, lw, dash) {
      if (!isFin(y)) return;
      pLine(x0, roundPx(y), x1, roundPx(y), stroke, lw, dash);
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
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    }
    function pRound(x, y, w, h, r, fill, stroke, lw) {
      if (!isFin(x) || !isFin(y) || !isFin(w) || !isFin(h)) return;
      if (w <= 0 || h <= 0) return;
      var rr = clamp(num(r, 2), 0, Math.min(w, h) / 2);
      ctx.beginPath();
      ctx.moveTo(x + rr, y);
      ctx.lineTo(x + w - rr, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
      ctx.lineTo(x + w, y + h - rr);
      ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
      ctx.lineTo(x + rr, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
      ctx.lineTo(x, y + rr);
      ctx.quadraticCurveTo(x, y, x + rr, y);
      ctx.closePath();
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = num(lw, 1); ctx.stroke(); }
    }
    /* Diagonal hatch inside a rect — the "this is not real work" texture. */
    function pHatch(x, y, w, h, stroke, lw, gap) {
      if (!isFin(x) || !isFin(y) || !isFin(w) || !isFin(h)) return;
      if (w <= 0 || h <= 0) return;
      var g = Math.max(3, num(gap, 6));
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip();
      ctx.strokeStyle = stroke;
      ctx.lineWidth = num(lw, 1);
      ctx.beginPath();
      var span = w + h, i, n = Math.ceil(span / g);
      if (n > 400) { g = span / 400; n = 400; }       /* never unbounded */
      for (i = 0; i <= n; i++) {
        var xs = x - h + i * g;
        ctx.moveTo(xs, y + h);
        ctx.lineTo(xs + h, y);
      }
      ctx.stroke();
      ctx.restore();
    }

    /* Marker shapes — the redundant, colour-independent instrument channel. */
    function pShape(kind, x, y, r, fill, stroke, lw) {
      if (!isFin(x) || !isFin(y) || !isFin(r) || r <= 0) return;
      var i, a, px, py, n;
      ctx.beginPath();
      switch (kind) {
        case 'square':
          ctx.rect(x - r * 0.88, y - r * 0.88, r * 1.76, r * 1.76);
          break;
        case 'triUp':
          ctx.moveTo(x, y - r * 1.15); ctx.lineTo(x + r * 1.05, y + r * 0.75);
          ctx.lineTo(x - r * 1.05, y + r * 0.75); ctx.closePath();
          break;
        case 'triDown':
          ctx.moveTo(x, y + r * 1.15); ctx.lineTo(x + r * 1.05, y - r * 0.75);
          ctx.lineTo(x - r * 1.05, y - r * 0.75); ctx.closePath();
          break;
        case 'diamond':
          ctx.moveTo(x, y - r * 1.25); ctx.lineTo(x + r * 1.05, y);
          ctx.lineTo(x, y + r * 1.25); ctx.lineTo(x - r * 1.05, y); ctx.closePath();
          break;
        case 'pentagon':
          n = 5;
          for (i = 0; i < n; i++) {
            a = -Math.PI / 2 + i * 2 * Math.PI / n;
            px = x + Math.cos(a) * r * 1.12; py = y + Math.sin(a) * r * 1.12;
            if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
          }
          ctx.closePath();
          break;
        case 'star':
          n = 10;
          for (i = 0; i < n; i++) {
            a = -Math.PI / 2 + i * Math.PI / 5;
            var rr = (i % 2 === 0) ? r * 1.35 : r * 0.58;
            px = x + Math.cos(a) * rr; py = y + Math.sin(a) * rr;
            if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
          }
          ctx.closePath();
          break;
        default:
          ctx.arc(x, y, r, 0, Math.PI * 2);
      }
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = num(lw, 1); ctx.stroke(); }
    }

    /* The player's own number and ground truth share one visual family:
     * a hollow white diamond (belief) and a solid white bar (truth). */
    function pPredicted(x, cy, h, label) {
      if (!isFin(x) || !isFin(cy) || !isFin(h)) return;
      var half = Math.max(4, h / 2);
      pVLine(x, cy - half, cy + half, hexA(T.white, 0.5), 1, [2, 2]);
      pShape('diamond', x, cy, Math.min(5.5, Math.max(3.5, half * 0.5)), T.bg, T.white, 1.6);
      if (label) pText(label, x, cy - half - 6, font(8), hexA(T.white, 0.8), 'center', 'middle');
    }
    function pTruthMark(x, cy, h) {
      if (!isFin(x) || !isFin(cy) || !isFin(h)) return;
      var half = Math.max(5, h / 2);
      pVLine(x, cy - half, cy + half, T.white, 2.4);
      ctx.beginPath();
      ctx.moveTo(x - 3.5, cy - half); ctx.lineTo(x + 3.5, cy - half); ctx.lineTo(x, cy - half + 4.5);
      ctx.closePath();
      ctx.fillStyle = T.white; ctx.fill();
    }

    /* ------------------------------------------------------------------- *
     * Frame / chrome
     * ------------------------------------------------------------------- */
    var PAD = 12;

    function beginFrame() {
      syncBackingStore();
      if (!cssW || !cssH) return false;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);
      ctx.lineCap = 'butt';
      ctx.lineJoin = 'miter';
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      pRect(0, 0, cssW, cssH, T.bg);
      return true;
    }

    /* Below this size no chart is honest; say so instead of drawing noise. */
    function tooSmall() {
      if (cssW >= 150 && cssH >= 90) return false;
      pRect(0, 0, cssW, cssH, T.bg);
      pStrokeRect(0.5, 0.5, cssW - 1, cssH - 1, T.border, 1);
      if (cssW >= 42 && cssH >= 16) {
        pText('—', cssW / 2, cssH / 2, font(10), T.faint, 'center', 'middle');
      }
      return true;
    }

    function drawTitle(title, subtitle) {
      var y = PAD + 5;
      pText(String(title || '').toUpperCase(), PAD, y, font(12, '600'), T.text, 'left', 'middle');
      if (subtitle) {
        var tw = textW(String(title || '').toUpperCase(), font(12, '600'));
        var avail = cssW - PAD * 2 - tw - 14;
        pText(fitText(subtitle, avail, font(10)), cssW - PAD, y, font(10), T.dim, 'right', 'middle');
      }
      return PAD + 16;                       /* content top */
    }

    function drawEmpty(x0, y0, x1, y1, msg, hint) {
      var cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      pText(msg, cx, hint ? cy - 8 : cy, font(12), T.faint, 'center', 'middle');
      if (hint) pText(fitText(hint, x1 - x0 - 8, font(10)), cx, cy + 10, font(10), T.faint, 'center', 'middle');
    }

    /* Wrapping legend of instrument swatches. Returns the height it used.
     * `cmap` lets the caller's own instrument colours win, so the legend can
     * never disagree with the dots it is explaining. */
    function drawInstrumentLegend(ids, x0, y0, x1, extra, cmap) {
      var items = [], seen = {}, i;
      for (i = 0; i < ids.length; i++) {
        var id = ids[i];
        if (id == null || seen[id]) continue;
        seen[id] = 1;
        var m = instMeta(id);
        items.push({ label: m.label, color: (cmap && cmap[id]) || m.color, shape: m.shape, kind: 'inst' });
      }
      if (extra) for (i = 0; i < extra.length; i++) items.push(extra[i]);
      if (!items.length) return 0;

      var f = font(9);
      var lineH = 13, gapX = 12;
      var x = x0, y = y0 + 6, rows = 1;
      var maxW = Math.max(40, x1 - x0);
      for (i = 0; i < items.length; i++) {
        var it = items[i];
        var w = 12 + textW(it.label, f) + gapX;
        if (x + w > x0 + maxW && x > x0) { x = x0; y += lineH; rows++; }
        var mx = x + 4.5;
        if (it.kind === 'pred') pShape('diamond', mx, y, 4, T.bg, T.white, 1.5);
        else if (it.kind === 'truth') { pVLine(mx, y - 4.5, y + 4.5, T.white, 2.4); }
        else if (it.kind === 'swatch') pRect(mx - 4, y - 4, 8, 8, it.color);
        else pShape(it.shape, mx, y, 4, it.color, hexA(T.bg, 0.9), 1);
        pText(it.label, x + 12, y, f, it.kind === 'inst' ? T.dim : T.text, 'left', 'middle');
        x += w;
      }
      return rows * lineH + 8;
    }

    /* Horizontal value axis: gridlines through the plot + labels underneath. */
    function drawXAxis(sc, x0, x1, yTop, yBot, caption, dpOverride) {
      var step = niceStep(sc.hi - sc.lo, Math.max(2, Math.floor((x1 - x0) / 74)));
      var dp = dpOverride == null ? stepDp(step) : dpOverride;
      var first = Math.ceil(sc.lo / step) * step;
      var v, x, guard = 0;
      for (v = first; v <= sc.hi + 1e-9 && guard < 200; v += step, guard++) {
        x = sc.x(v);
        if (!isFin(x) || x < x0 - 0.5 || x > x1 + 0.5) continue;
        var isZero = Math.abs(v) < step * 1e-6;
        pVLine(x, yTop, yBot, isZero ? T.gridStrong : T.grid, isZero ? 1.5 : 1);
        pText(fmt(v, dp), x, yBot + 11, font(9), isZero ? T.dim : T.faint, 'center', 'middle');
      }
      if (sc.lo < 0 && sc.hi > 0) {
        var xz = sc.x(0);
        pVLine(xz, yTop, yBot, hexA(T.dim, 0.45), 1);
      }
      if (caption) {
        pText(caption, (x0 + x1) / 2, yBot + 24, font(9), T.faint, 'center', 'middle');
      }
      return 30;
    }

    function makeScale(lo, hi, px0, px1) {
      var a = num(lo, -1), b = num(hi, 1);
      if (!(b > a)) { b = a + 1; }
      var p0 = num(px0, 0), p1 = num(px1, p0 + 1);
      if (!(p1 > p0)) p1 = p0 + 1;
      return {
        lo: a, hi: b, p0: p0, p1: p1,
        x: function (v) {
          if (!isFin(v)) return NaN;
          return p0 + (clamp(v, a, b) - a) / (b - a) * (p1 - p0);
        },
        raw: function (v) {
          if (!isFin(v)) return NaN;
          return p0 + (v - a) / (b - a) * (p1 - p0);
        },
        y: function (v) {                       /* for vertical use */
          if (!isFin(v)) return NaN;
          return p1 - (clamp(v, a, b) - a) / (b - a) * (p1 - p0);
        }
      };
    }

    /* Symmetric vertical dodge so co-located dots stay countable. */
    function dodgeY(xs, minGap, maxOff) {
      var n = xs.length, out = new Array(n), i;
      for (i = 0; i < n; i++) out[i] = 0;
      if (n < 2) return out;
      var idx = [];
      for (i = 0; i < n; i++) if (isFin(xs[i])) idx.push(i);
      idx.sort(function (a, b) { return xs[a] - xs[b]; });
      var cluster = [], clusters = [];
      for (i = 0; i < idx.length; i++) {
        if (!cluster.length) { cluster.push(idx[i]); continue; }
        if (xs[idx[i]] - xs[cluster[cluster.length - 1]] < minGap) cluster.push(idx[i]);
        else { clusters.push(cluster); cluster = [idx[i]]; }
      }
      if (cluster.length) clusters.push(cluster);
      for (var c = 0; c < clusters.length; c++) {
        var g = clusters[c], k = g.length;
        if (k < 2) continue;
        var stepPx = Math.min(minGap * 0.9, (2 * maxOff) / (k - 1));
        for (i = 0; i < k; i++) out[g[i]] = (i - (k - 1) / 2) * stepPx;
      }
      return out;
    }

    /* ===================================================================== *
     * PLOT 1 — evidence  (the centrepiece)
     * ===================================================================== */
    function normEvidenceRows(cfg) {
      var raw = (cfg && cfg.rows) || [];
      if (!raw || typeof raw.length !== 'number') raw = [];
      var rows = [], i, j;
      for (i = 0; i < raw.length; i++) {
        var r = raw[i];
        if (!r || typeof r !== 'object') continue;
        var rd = [], src = r.readings;
        if (src && typeof src.length === 'number') {
          for (j = 0; j < src.length; j++) {
            var s = src[j];
            if (!s || typeof s !== 'object') continue;
            var v = num(s.value, NaN);
            if (!isFin(v)) continue;                 /* a non-number is not a reading */
            var id = s.instrument != null ? s.instrument : s.instrumentId;
            rd.push({
              id: id, value: v,
              color: okColor(s.color, instColor(id)),
              shape: instMeta(id).shape,
              label: instLabel(id),
              day: num(s.day, NaN)
            });
          }
        }
        var lo = Infinity, hi = -Infinity;
        for (j = 0; j < rd.length; j++) { if (rd[j].value < lo) lo = rd[j].value; if (rd[j].value > hi) hi = rd[j].value; }
        var spread = rd.length >= 2 ? (hi - lo) : 0;
        rows.push({
          name: nameOf(r, 'featureId'),
          readings: rd,
          lo: rd.length ? lo : NaN,
          hi: rd.length ? hi : NaN,
          spread: rd.length >= 2 ? spread : NaN,
          predicted: num(r.predicted, NaN),
          status: typeof r.status === 'string' ? r.status : ''
        });
      }
      return rows;
    }

    function drawEvidence(cfg) {
      var rows = normEvidenceRows(cfg);
      var i, j;

      var nContra = 0, totalReadings = 0;
      for (i = 0; i < rows.length; i++) {
        totalReadings += rows[i].readings.length;
        if (severity(rows[i].spread) >= 2) nContra++;
      }

      var sub = rows.length
        ? (totalReadings + ' reading' + (totalReadings === 1 ? '' : 's') +
           ' · ' + nContra + ' contradictory row' + (nContra === 1 ? '' : 's'))
        : '';
      var top = drawTitle('Evidence — what each instrument says', sub);

      /* legend ---------------------------------------------------------- */
      var ids = [], cmap = {};
      for (i = 0; i < rows.length; i++) for (j = 0; j < rows[i].readings.length; j++) {
        var rr0 = rows[i].readings[j];
        ids.push(rr0.id);
        if (cmap[rr0.id] == null) cmap[rr0.id] = rr0.color;
      }
      if (!ids.length) for (i = 0; i < INSTRUMENTS.length; i++) ids.push(INSTRUMENTS[i].id);
      var anyPred = false;
      for (i = 0; i < rows.length; i++) if (isFin(rows[i].predicted)) { anyPred = true; break; }
      var extra = anyPred ? [{ label: 'YOUR FORECAST', kind: 'pred' }] : null;
      var legH = drawInstrumentLegend(ids, PAD, top, cssW - PAD, extra, cmap);
      var plotTop = top + legH;

      /* geometry -------------------------------------------------------- */
      var nameF = font(11);
      var flagW = 10;                       /* the "!" column, kept clear of names */
      var labelW = 84;
      for (i = 0; i < rows.length; i++) labelW = Math.max(labelW, textW(rows[i].name, nameF) + 10);
      labelW = Math.min(labelW, Math.max(70, cssW * 0.30));
      var gutterW = cssW > 470 ? 78 : 0;

      var x0 = PAD + flagW + labelW + 8;
      var x1 = cssW - PAD - gutterW;
      var axisH = nContra > 0 ? 46 : 34;
      var yTop = plotTop + 10;
      var yBot = cssH - PAD - axisH;

      if (x1 - x0 < 60 || yBot - yTop < 24) {
        drawEmpty(PAD, plotTop, cssW - PAD, cssH - PAD, 'TOO SMALL');
        return;
      }
      if (!rows.length) {
        pRect(PAD, plotTop, cssW - PAD * 2, cssH - PAD - plotTop, T.panel);
        pStrokeRect(PAD, plotTop, cssW - PAD * 2, cssH - PAD - plotTop, T.border, 1);
        drawEmpty(PAD, plotTop, cssW - PAD, cssH - PAD,
          'NO FEATURES', 'Nothing on the board yet.');
        return;
      }

      /* domain: readings + forecasts, always showing 0 */
      var vals = [];
      for (i = 0; i < rows.length; i++) {
        for (j = 0; j < rows[i].readings.length; j++) vals.push(rows[i].readings[j].value);
        if (isFin(rows[i].predicted)) vals.push(rows[i].predicted);
      }
      var dom = domainOf(vals, { includeZero: true, pad: 0.1, emptyLo: 0, emptyHi: 6 });
      var sc = makeScale(dom.lo, dom.hi, x0, x1);

      /* rows: fit what we can, and say what we dropped */
      var availH = yBot - yTop;
      var rowH = availH / rows.length;
      var maxRows = rows.length;
      var MINROW = 15;
      if (rowH < MINROW) {
        maxRows = Math.max(1, Math.floor(availH / MINROW));
        rowH = availH / maxRows;
      }
      rowH = Math.min(rowH, 46);
      /* never leave a lake of empty panel under the last row */
      yBot = yTop + rowH * Math.min(maxRows, rows.length);

      /* plot panel, then zebra, THEN the grid — so gridlines stay visible
       * through the row bands instead of being painted over. */
      pRect(x0, yTop, x1 - x0, yBot - yTop, T.panel);
      var shown = Math.min(maxRows, rows.length);
      for (i = 0; i < shown; i++) {
        pRect(x0, yTop + i * rowH, x1 - x0, rowH, i % 2 ? T.rowB : T.rowA);
      }
      drawXAxis(sc, x0, x1, yTop, yBot, 'projected impact on ' + (cfg && cfg.northStar ? cfg.northStar : 'the north star') + '  (pp)');
      for (i = 1; i < shown; i++) pHLine(yTop + i * rowH, x0, x1, hexA(T.border, 0.55), 1);

      /* gutter header */
      if (gutterW) {
        pText('n', x1 + 16, yTop - 8, font(8), T.faint, 'center', 'middle');
        pText('SPREAD', x1 + 52, yTop - 8, font(8), T.faint, 'center', 'middle');
      }

      for (i = 0; i < shown; i++) {
        var r = rows[i];
        var ry = yTop + i * rowH;
        var cy = ry + rowH / 2;
        var sev = severity(r.spread);

        /* --- the spread bar: the dominant mark of this plot ------------- */
        if (r.readings.length >= 2 && isFin(r.lo) && isFin(r.hi)) {
          var bx0 = sc.x(r.lo), bx1 = sc.x(r.hi);
          var bw = Math.max(2, bx1 - bx0);
          var bh = Math.min(rowH * 0.62, 22);
          var by = cy - bh / 2;
          var col = sevColor(sev);
          pRound(bx0, by, bw, bh, 3, hexA(col, sev >= 2 ? 0.20 : (sev >= 1 ? 0.14 : 0.09)),
                 hexA(col, sev >= 2 ? 0.85 : 0.45), 1);
          if (sev >= 2) pHatch(bx0 + 1, by + 1, bw - 2, bh - 2, hexA(col, 0.30), 1, 6);
          /* end caps make the extent readable even when the fill is subtle */
          pVLine(bx0, by - 2, by + bh + 2, hexA(col, 0.9), sev >= 2 ? 2 : 1.4);
          pVLine(bx1, by - 2, by + bh + 2, hexA(col, 0.9), sev >= 2 ? 2 : 1.4);
        }

        /* --- the dots --------------------------------------------------- */
        var xs = [], k;
        for (k = 0; k < r.readings.length; k++) xs.push(sc.x(r.readings[k].value));
        var rDot = clamp(rowH * 0.17, 3.2, 5.4);
        var offs = dodgeY(xs, rDot * 2.1, Math.max(1, rowH * 0.24));
        for (k = 0; k < r.readings.length; k++) {
          var rd = r.readings[k];
          pShape(rd.shape, xs[k], cy + offs[k], rDot, rd.color, hexA(T.bg, 0.95), 1.1);
        }
        if (!r.readings.length) {
          pText('no research run', x0 + 8, cy, font(9), hexA(T.faint, 0.9), 'left', 'middle');
        }

        /* --- the player's own forecast ---------------------------------- */
        if (isFin(r.predicted)) pPredicted(sc.x(r.predicted), cy, rowH * 0.72, null);

        /* --- feature name ----------------------------------------------- */
        var nm = fitText(r.name, labelW - 4, nameF);
        pText(nm, x0 - 8, cy, nameF, sev >= 2 ? T.text : T.dim, 'right', 'middle');
        if (sev >= 2) {
          pText('!', PAD + 1, cy, font(11, '700'), T.bad, 'left', 'middle');
        }

        /* --- right gutter: n + spread ----------------------------------- */
        if (gutterW) {
          pText(String(r.readings.length), x1 + 16, cy, font(10), T.dim, 'center', 'middle');
          if (isFin(r.spread)) {
            var sTxt = 'Δ' + fmt(r.spread, 1);
            pText(sTxt, x1 + 52, cy, font(10, sev >= 2 ? '700' : ''), sevColor(sev), 'center', 'middle');
          } else {
            pText('–', x1 + 52, cy, font(10), T.faint, 'center', 'middle');
          }
        }
      }

      if (shown < rows.length) {
        pText('+' + (rows.length - shown) + ' more', x0 + 6, yBot - 7, font(9), T.faint, 'left', 'middle');
      }

      pStrokeRect(x0, yTop, x1 - x0, yBot - yTop, T.border, 1);

      /* the lesson, stated once, on its own line under the axis caption */
      if (nContra > 0) {
        var msg = '! ' + nContra + ' feature' + (nContra === 1 ? '' : 's') +
                  ' where instruments disagree by >3pp — triangulate before you commit';
        pText(fitText(msg, cssW - PAD * 2, font(9)), (x0 + x1) / 2, yBot + 38,
              font(9), hexA(T.bad, 0.95), 'center', 'middle');
      }
    }

    /* ===================================================================== *
     * PLOT 2 — gantt
     * ===================================================================== */
    var GANTT_STATUS = {
      shipped:  { label: 'SHIPPED',  color: THEME.good },
      building: { label: 'BUILDING', color: THEME.accent },
      queued:   { label: 'QUEUED',   color: THEME.dim },
      slipped:  { label: 'SLIPPED',  color: THEME.warn },
      dropped:  { label: 'DROPPED',  color: THEME.faint }
    };

    function drawGantt(cfg) {
      cfg = cfg || {};
      var totalWeeks = Math.round(clamp(num(cfg.totalWeeks, 12), 1, 60));
      var epw = num(cfg.engWeeksPerWeek, 4);
      if (!(epw > 0)) epw = 4;
      var week = clamp(num(cfg.week, 1), 0, totalWeeks + 1);
      var elapsed = isFin(cfg.day) ? clamp(num(cfg.day, 0) / 5, 0, totalWeeks) : clamp(week - 1, 0, totalWeeks);

      var raw = cfg.roadmap;
      if (!raw || typeof raw.length !== 'number') raw = [];
      var names = cfg.names && typeof cfg.names === 'object' ? cfg.names : null;

      /* Serial schedule in eng-week space, in roadmap order. Geometry comes
       * from supplied fields when the engine provides them. */
      var items = [], cursor = 0, i;
      for (i = 0; i < raw.length; i++) {
        var it = raw[i];
        if (!it || typeof it !== 'object') continue;
        var st = String(it.status || 'queued').toLowerCase();
        if (!GANTT_STATUS[st]) st = 'queued';
        var id = it.featureId != null ? it.featureId : it.id;
        var nm = (names && typeof names[id] === 'string' && names[id]) ? names[id] : nameOf(it, 'featureId');

        var est = num(it.estCost, NaN);
        var rev = num(it.revisedEstimate, NaN);
        var spent = Math.max(0, num(it.engWeeksSpent, 0));
        var prog = clamp(num(it.progress, st === 'shipped' ? 1 : 0), 0, 1);
        var total = isFin(rev) ? rev : (isFin(est) ? est : (prog > 0.02 ? spent / prog : Math.max(spent, 1)));
        if (!isFin(total) || total <= 0) total = Math.max(1, spent);
        var done = st === 'shipped' ? total : Math.min(total, isFin(it.engWeeksSpent) ? spent : total * prog);
        if (!isFin(done) || done < 0) done = 0;

        var s = isFin(num(it.startWeek, NaN)) ? num(it.startWeek, 0) : cursor / epw;
        var e = isFin(num(it.endWeek, NaN)) ? num(it.endWeek, s) : (cursor + total) / epw;
        if (!(e > s)) e = s + 0.12;
        if (st !== 'dropped') cursor += total;

        items.push({
          name: nm, status: st, s: s, e: e,
          doneE: s + (e - s) * (total > 0 ? clamp(done / total, 0, 1) : 0),
          est: isFin(est) ? est : NaN, rev: isFin(rev) ? rev : NaN,
          total: total, done: done,
          overrun: isFin(rev) && isFin(est) && rev > est + 1e-9
        });
      }

      var maxE = totalWeeks;
      for (i = 0; i < items.length; i++) if (items[i].e > maxE) maxE = items[i].e;
      var xmaxWeeks = Math.min(Math.max(totalWeeks * 1.02, maxE + 0.4), totalWeeks * 1.75);

      var capLeft = num(cfg.capacityLeft, NaN);
      var capTotal = num(cfg.capacityTotal, totalWeeks * epw);
      var sub = 'W' + Math.max(1, Math.round(week)) + ' of ' + totalWeeks +
                (isFin(capLeft) ? '  ·  ' + fmt(capLeft, 0) + ' eng-weeks left' : '');
      var top = drawTitle('Build queue — ' + totalWeeks + '-week quarter', sub);

      var legH = drawInstrumentLegend([], PAD, top, cssW - PAD, [
        { label: 'SHIPPED', kind: 'swatch', color: T.good },
        { label: 'BUILDING', kind: 'swatch', color: T.accent },
        { label: 'QUEUED', kind: 'swatch', color: hexA(T.dim, 0.5) },
        { label: 'SLIPPED / OVERRUN', kind: 'swatch', color: T.warn },
        { label: 'PAST THE CLIFF = 0 pp', kind: 'swatch', color: T.bad }
      ]);
      var plotTop = top + legH;

      var nameF = font(11);
      var labelW = 88;
      for (i = 0; i < items.length; i++) labelW = Math.max(labelW, textW(items[i].name, nameF) + 10);
      labelW = Math.min(labelW, Math.max(70, cssW * 0.28));
      var gutterW = cssW > 500 ? 92 : 0;

      var x0 = PAD + labelW + 8;
      var x1 = cssW - PAD - gutterW;
      var headH = 16;
      var footH = isFin(capLeft) || isFin(capTotal) ? 30 : 8;
      var yTop = plotTop + headH;
      var yBot = cssH - PAD - footH;

      if (x1 - x0 < 60 || yBot - yTop < 22) { drawEmpty(PAD, plotTop, cssW - PAD, cssH - PAD, 'TOO SMALL'); return; }

      var sc = makeScale(0, xmaxWeeks, x0, x1);
      var xCliff = sc.raw(totalWeeks);

      /* rows are sized first so the panel can shrink to its content */
      var availH = yBot - yTop;
      var rowH = availH / Math.max(1, items.length);
      var shown = items.length;
      if (items.length) {
        if (rowH < 15) { shown = Math.max(1, Math.floor(availH / 15)); rowH = availH / shown; }
        rowH = Math.min(rowH, 40);
        yBot = yTop + rowH * shown;
      }

      pRect(x0, yTop, x1 - x0, yBot - yTop, T.panel);
      /* zebra first, then the washes and the grid, so nothing is buried */
      for (i = 0; i < shown; i++) pRect(x0, yTop + i * rowH, x1 - x0, rowH, i % 2 ? T.rowB : T.rowA);

      /* dead zone past the cliff */
      if (isFin(xCliff) && xCliff < x1 - 1) {
        pRect(xCliff, yTop, x1 - xCliff, yBot - yTop, hexA(T.bad, 0.10));
        pHatch(xCliff, yTop, x1 - xCliff, yBot - yTop, hexA(T.bad, 0.10), 1, 8);
      }

      /* week grid + header (no week numbers past the cliff — that space
       * belongs to the END OF QUARTER banner and to nothing else) */
      var everyN = 1;
      var wpx = (x1 - x0) / Math.max(1, xmaxWeeks);
      while (wpx * everyN < 26 && everyN < 8) everyN++;

      /* The two banners in the header strip are laid out FIRST so the week
       * numbers can yield to them instead of printing underneath. */
      var xNow = sc.raw(elapsed);
      var nowLbl = 'NOW W' + Math.max(1, Math.round(week));
      var nlw = textW(nowLbl, font(9, '600')) + 8;
      var nlx = clamp(xNow - nlw / 2, x0, Math.max(x0, x1 - nlw));
      var showNow = isFin(xNow) && xNow >= x0 - 0.5 && xNow <= x1 + 0.5;

      var cliffLbl = 'END OF QUARTER';
      var clw = textW(cliffLbl, font(9, '700')) + 8;
      var showCliff = isFin(xCliff) && xCliff <= x1 + 0.5;
      var clx = clamp(xCliff + 4, x0, Math.max(x0, x1 - clw));
      if (showCliff && x1 - xCliff < clw + 6) clx = clamp(xCliff - clw - 4, x0, Math.max(x0, x1 - clw));

      function headerFree(a, b) {
        if (showNow && b > nlx - 3 && a < nlx + nlw + 3) return false;
        if (showCliff && b > clx - 3 && a < clx + clw + 3) return false;
        return true;
      }

      for (i = 0; i <= Math.ceil(xmaxWeeks); i++) {
        var gx = sc.raw(i);
        if (!isFin(gx) || gx > x1 + 0.5) continue;
        pVLine(gx, yTop, yBot, i % everyN === 0 ? T.grid : hexA(T.grid, 0.5), 1);
        if (i % everyN === 0 && i + 1 <= totalWeeks && i < xmaxWeeks - 0.05) {
          var wl = 'W' + (i + 1);
          var wlx0 = gx + 3;
          if (!headerFree(wlx0, wlx0 + textW(wl, font(9)))) continue;
          pText(wl, wlx0, plotTop + 8, font(9), T.faint, 'left', 'middle');
        }
      }

      /* rows */
      if (!items.length) {
        drawEmpty(x0, yTop, x1, yBot, 'ROADMAP EMPTY', 'Nothing committed — nothing ships.');
      } else {
        for (i = 1; i < shown; i++) pHLine(yTop + i * rowH, x0, x1, hexA(T.border, 0.5), 1);

        for (i = 0; i < shown; i++) {
          var b = items[i];
          var ry = yTop + i * rowH;
          var cy = ry + rowH / 2;
          var meta = GANTT_STATUS[b.status];
          var bh = Math.min(rowH * 0.56, 20);
          var by = cy - bh / 2;

          var bx0 = sc.raw(b.s), bx1 = sc.raw(b.e);
          if (!isFin(bx0) || !isFin(bx1)) continue;
          bx0 = clamp(bx0, x0, x1); bx1 = clamp(bx1, x0, x1);
          var bw = Math.max(2, bx1 - bx0);

          if (b.status === 'dropped') {
            /* dropped work occupies no calendar: a struck-through ghost across
             * the whole row, never a bar sitting in the dead zone */
            pHLine(cy, x0 + 4, x1 - 4, hexA(T.faint, 0.55), 1, [5, 4]);
            pText('dropped — no capacity consumed', x0 + 8, cy, font(9), hexA(T.faint, 0.95), 'left', 'middle');
          } else {
            /* the planned envelope */
            pRound(bx0, by, bw, bh, 3, hexA(meta.color, b.status === 'queued' ? 0.08 : 0.14),
                   hexA(meta.color, 0.65), 1);
            /* progress fill */
            var px1 = clamp(sc.raw(b.doneE), x0, x1);
            var pw = px1 - bx0;
            if (pw > 0.8) pRound(bx0, by, pw, bh, 3, hexA(meta.color, b.status === 'shipped' ? 0.85 : 0.6), null, 0);
            /* the slip: the part of the bar that only exists because the
             * estimate was wrong */
            if (b.overrun && isFin(b.est)) {
              var xEst = clamp(sc.raw(b.s + (b.est / epw)), x0, x1);
              if (bx1 - xEst > 1) {
                pHatch(xEst, by, bx1 - xEst, bh, hexA(T.warn, 0.55), 1, 5);
                pVLine(xEst, by - 2, by + bh + 2, T.warn, 1.5, [3, 2]);
              }
            }
            /* the part that will never ship */
            if (isFin(xCliff) && bx1 > xCliff + 0.5 && b.status !== 'shipped') {
              var cw = bx1 - Math.max(bx0, xCliff);
              pHatch(Math.max(bx0, xCliff), by, cw, bh, hexA(T.bad, 0.75), 1.2, 5);
              pStrokeRect(Math.max(bx0, xCliff), by, cw, bh, hexA(T.bad, 0.9), 1);
            }
            if (b.status === 'shipped' && bh >= 11 && bw >= 16) {
              pText('✓', bx0 + 5, cy, font(10, '700'), T.bg, 'left', 'middle');
            }
          }

          pText(fitText(b.name, labelW - 4, nameF), x0 - 8, cy, nameF,
                b.status === 'dropped' ? T.faint : T.dim, 'right', 'middle');

          if (gutterW) {
            var tag, tcol;
            if (isFin(xCliff) && b.e > totalWeeks + 1e-9 && b.status !== 'shipped' && b.status !== 'dropped') {
              tag = 'WON’T SHIP'; tcol = T.bad;
            } else { tag = meta.label; tcol = meta.color; }
            pText(tag, x1 + 6, cy - (rowH > 26 ? 6 : 0), font(9, '600'), tcol, 'left', 'middle');
            if (rowH > 26) {
              pText(fmt(b.done, 0) + '/' + fmt(b.total, 0) + ' ew', x1 + 6, cy + 7, font(9), T.faint, 'left', 'middle');
            }
          }
        }
        if (shown < items.length) {
          pText('+' + (items.length - shown) + ' more', x0 + 6, yBot - 7, font(9), T.faint, 'left', 'middle');
        }
      }

      /* NOW marker */
      if (showNow) {
        pVLine(xNow, yTop, yBot, hexA(T.accent, 0.9), 1.5, [4, 3]);
        pRect(nlx, plotTop + 1, nlw, 14, T.bg);
        pText(nowLbl, nlx + nlw / 2, plotTop + 8, font(9, '600'), T.accent, 'center', 'middle');
      }

      /* THE CLIFF */
      if (showCliff) {
        pVLine(xCliff, yTop - 4, yBot + 2, T.bad, 2.5);
        pRect(clx, plotTop + 1, clw, 14, T.bg);
        pText(cliffLbl, clx + clw / 2, plotTop + 8, font(9, '700'), T.bad, 'center', 'middle');
        if (x1 - xCliff > 54 && yBot - yTop > 40) {
          pText('UNSHIPPED', (xCliff + x1) / 2, (yTop + yBot) / 2 - 7, font(10, '700'), hexA(T.bad, 0.75), 'center', 'middle');
          pText('= 0 pp', (xCliff + x1) / 2, (yTop + yBot) / 2 + 7, font(10, '700'), hexA(T.bad, 0.75), 'center', 'middle');
        }
      }

      pStrokeRect(x0, yTop, x1 - x0, yBot - yTop, T.border, 1);

      /* capacity footer */
      if (footH > 8) {
        var fy = yBot + 12;
        var used = isFin(capLeft) && isFin(capTotal) ? capTotal - capLeft : NaN;
        var barX = x0, barW = Math.max(20, (x1 - x0) * 0.55), barH = 9;
        pRect(barX, fy - barH / 2, barW, barH, hexA(T.dim, 0.16));
        if (isFin(used) && isFin(capTotal) && capTotal > 0) {
          var f = clamp(used / capTotal, 0, 1);
          pRect(barX, fy - barH / 2, barW * f, barH, hexA(f > 0.9 ? T.bad : T.accent, 0.75));
        }
        pStrokeRect(barX, fy - barH / 2, barW, barH, hexA(T.border, 0.9), 1);
        pText('CAPACITY', PAD, fy, font(9), T.faint, 'left', 'middle');
        var capTxt = (isFin(used) ? fmt(used, 0) : '--') + ' / ' + (isFin(capTotal) ? fmt(capTotal, 0) : '--') + ' eng-weeks used';
        pText(capTxt, barX + barW + 10, fy, font(9), T.dim, 'left', 'middle');
      }
    }

    /* ===================================================================== *
     * PLOT 3 — trust
     * ===================================================================== */
    function drawTrust(cfg) {
      cfg = cfg || {};
      var raw = cfg.stakeholders;
      if (!raw || typeof raw.length !== 'number') raw = [];
      var people = [], i, sum = 0, nT = 0;
      for (i = 0; i < raw.length; i++) {
        var s = raw[i];
        if (!s || typeof s !== 'object') continue;
        var t = num(s.trust, NaN);
        if (isFin(t)) { t = clamp(t, 0, 100); sum += t; nT++; }
        people.push({
          name: nameOf(s, 'id'),
          role: typeof s.role === 'string' ? s.role : '',
          trust: t,
          delta: num(s.delta, NaN)
        });
      }
      var avg = nT ? sum / nT : NaN;

      var top = drawTitle('Trust — the currency you spend saying no',
        isFin(avg) ? 'avg ' + fmt(avg, 0) : '');

      var thresholds = [
        { v: num(cfg.lowTrustCeo, 35), label: 'CEO OVERRIDE', color: T.bad },
        { v: num(cfg.lowTrustEng, 40), label: 'EST. PADDING', color: T.warn },
        { v: num(cfg.highTrustFavour, 75), label: 'FAVOUR', color: T.good }
      ];

      var nameF = font(11);
      var labelW = 90;
      for (i = 0; i < people.length; i++) labelW = Math.max(labelW, textW(people[i].name, nameF) + 10);
      labelW = Math.min(labelW, Math.max(70, cssW * 0.34));
      var gutterW = cssW > 340 ? 74 : 0;

      var x0 = PAD + labelW + 8;
      var x1 = cssW - PAD - gutterW;
      var yTop = top + 26;                  /* room for two rows of threshold tags */
      var yBot = cssH - PAD - 24;           /* ticks on one line, AVG on the next  */

      if (x1 - x0 < 50 || yBot - yTop < 20) { drawEmpty(PAD, top, cssW - PAD, cssH - PAD, 'TOO SMALL'); return; }
      if (!people.length) {
        pRect(PAD, top + 4, cssW - PAD * 2, cssH - PAD - top - 4, T.panel);
        pStrokeRect(PAD, top + 4, cssW - PAD * 2, cssH - PAD - top - 4, T.border, 1);
        drawEmpty(PAD, top, cssW - PAD, cssH - PAD, 'NO STAKEHOLDERS');
        return;
      }

      var sc = makeScale(0, 100, x0, x1);
      pRect(x0, yTop, x1 - x0, yBot - yTop, T.panel);

      var rowH = (yBot - yTop) / people.length;
      var barH = Math.min(rowH * 0.5, 18);
      for (i = 0; i < people.length; i++) {
        pRect(x0, yTop + i * rowH, x1 - x0, rowH, i % 2 ? T.rowB : T.rowA);
      }

      /* threshold lines + labels, staggered onto two rows so 35 and 40 do
       * not print on top of each other */
      for (i = 0; i < thresholds.length; i++) {
        var th = thresholds[i];
        if (!isFin(th.v)) continue;
        var tx = sc.raw(clamp(th.v, 0, 100));
        pVLine(tx, yTop, yBot, hexA(th.color, 0.35), 1, [3, 3]);
        var ly = top + (i % 2 ? 17 : 6);
        var lw = textW(th.label, font(8)) + 4;
        var lx = clamp(tx - lw / 2, PAD, Math.max(PAD, cssW - PAD - lw));
        pText(th.label, lx + lw / 2, ly, font(8), hexA(th.color, 0.9), 'center', 'middle');
        pVLine(tx, ly + 5, yTop, hexA(th.color, 0.3), 1);
      }
      for (i = 0; i <= 100; i += 25) {
        pVLine(sc.raw(i), yTop, yBot, hexA(T.grid, 0.9), 1);
        pText(String(i), sc.raw(i), yBot + 9, font(8), T.faint, 'center', 'middle');
      }

      for (i = 0; i < people.length; i++) {
        var p = people[i];
        var cy = yTop + i * rowH + rowH / 2;
        var by = cy - barH / 2;
        var col = !isFin(p.trust) ? T.faint
                : (p.trust < 35 ? T.bad : (p.trust < 50 ? T.warn : (p.trust >= 75 ? T.good : T.accent)));

        pRect(x0, by, x1 - x0, barH, hexA(T.dim, 0.10));

        if (isFin(p.trust)) {
          var w = sc.raw(p.trust) - x0;
          pRound(x0, by, Math.max(1, w), barH, 2, hexA(col, 0.75), null, 0);
          /* the recent move. A gain brightens the top of the bar; a LOSS is
           * a hollow ghost beyond the bar's end, so it can never be misread
           * as trust the player still has. */
          if (isFin(p.delta) && Math.abs(p.delta) > 0.01) {
            var prev = clamp(p.trust - p.delta, 0, 100);
            var xa = sc.raw(Math.min(prev, p.trust)), xb = sc.raw(Math.max(prev, p.trust));
            if (xb - xa > 0.7) {
              if (p.delta > 0) {
                pRect(xa, by, xb - xa, barH, hexA(T.good, 0.55));
              } else {
                pHatch(xa, by + 2, xb - xa, barH - 4, hexA(T.bad, 0.55), 1, 4);
                pStrokeRect(xa, by + 2, xb - xa, barH - 4, hexA(T.bad, 0.7), 1);
              }
              pVLine(sc.raw(prev), by - 2, by + barH + 2, hexA(T.white, 0.5), 1, [2, 2]);
            }
          }
          pVLine(sc.raw(p.trust), by - 3, by + barH + 3, col, 1.5);
        }

        var nm = fitText(p.name, labelW - 4, nameF);
        pText(nm, x0 - 8, cy - (rowH > 30 && p.role ? 6 : 0), nameF, T.text, 'right', 'middle');
        if (rowH > 30 && p.role) {
          pText(fitText(p.role.toUpperCase(), labelW - 4, font(8)), x0 - 8, cy + 7, font(8), T.faint, 'right', 'middle');
        }

        if (gutterW) {
          pText(isFin(p.trust) ? fmt(p.trust, 0) : '--', x1 + 26, cy, font(12, '600'), col, 'right', 'middle');
          if (isFin(p.delta) && Math.abs(p.delta) > 0.01) {
            var dTxt = (p.delta > 0 ? '▲' : '▼') + fmt(Math.abs(p.delta), 0);
            pText(dTxt, x1 + 32, cy, font(9), p.delta > 0 ? T.good : T.bad, 'left', 'middle');
          }
        }
      }

      if (isFin(avg)) {
        var ax = sc.raw(avg);
        pVLine(ax, yTop - 3, yBot + 3, hexA(T.white, 0.6), 1.5, [5, 3]);
        var avgTxt = 'AVG ' + fmt(avg, 0);
        var aw = textW(avgTxt, font(8, '600'));
        var axl = clamp(ax, x0 + aw / 2, x1 - aw / 2);
        pText(avgTxt, axl, yBot + 19, font(8, '600'), hexA(T.white, 0.85), 'center', 'middle');
      }
      pStrokeRect(x0, yTop, x1 - x0, yBot - yTop, T.border, 1);
    }

    /* ===================================================================== *
     * PLOT 4 — impact
     * ===================================================================== */
    function drawImpact(cfg) {
      cfg = cfg || {};
      var baseline = num(cfg.baseline, NaN);
      var raw = cfg.shipped;
      if (!raw || typeof raw.length !== 'number') raw = [];
      var ship = [], i, sum = 0;
      for (i = 0; i < raw.length; i++) {
        var s = raw[i];
        if (!s || typeof s !== 'object') continue;
        var d = num(s.delta, NaN);
        if (!isFin(d)) continue;
        sum += d;
        ship.push({ name: nameOf(s, 'id'), delta: d });
      }
      var projected = num(cfg.projected, isFin(baseline) ? baseline + sum : NaN);
      var unitTxt = typeof cfg.units === 'string' && cfg.units ? cfg.units : 'pp';
      var nsName = typeof cfg.northStar === 'string' && cfg.northStar ? cfg.northStar : 'north star';

      var gain = (isFin(projected) && isFin(baseline)) ? projected - baseline : NaN;
      var top = drawTitle('Projected impact — ' + nsName,
        isFin(gain) ? fmtSigned(gain, 1) + ' ' + unitTxt + ' vs baseline' : '');

      var axisW = 42, capH = 34;
      var x0 = PAD + axisW, x1 = cssW - PAD;
      var yTop = top + 10, yBot = cssH - PAD - capH;
      if (x1 - x0 < 60 || yBot - yTop < 40) { drawEmpty(PAD, top, cssW - PAD, cssH - PAD, 'TOO SMALL'); return; }

      /* columns: baseline, each shipped delta, [noise], projected */
      var cols = [], run = isFin(baseline) ? baseline : 0;
      cols.push({ kind: 'base', name: 'BASELINE', from: run, to: run, value: run });
      for (i = 0; i < ship.length; i++) {
        var from = run; run += ship[i].delta;
        cols.push({ kind: 'delta', name: ship[i].name, from: from, to: run, value: ship[i].delta });
      }
      var resid = (isFin(projected) && isFin(baseline)) ? projected - run : NaN;
      if (isFin(resid) && Math.abs(resid) > 0.05) {
        cols.push({ kind: 'noise', name: 'MEASUREMENT\nNOISE', from: run, to: run + resid, value: resid });
        run += resid;
      }
      cols.push({ kind: 'proj', name: 'PROJECTED', from: run, to: run, value: isFin(projected) ? projected : run });

      var vals = [];
      for (i = 0; i < cols.length; i++) { vals.push(cols[i].from); vals.push(cols[i].to); }
      if (isFin(baseline)) vals.push(baseline);
      if (isFin(projected)) vals.push(projected);
      var lo = Infinity, hi = -Infinity;
      for (i = 0; i < vals.length; i++) if (isFin(vals[i])) { if (vals[i] < lo) lo = vals[i]; if (vals[i] > hi) hi = vals[i]; }
      if (!isFin(lo) || !isFin(hi)) { lo = 0; hi = 1; }
      var span = hi - lo;
      if (!(span > 0)) { span = Math.max(1, Math.abs(hi) * 0.1); lo -= span; hi += span; }
      /* headroom above, a floor below that is NOT zero — a waterfall on a
       * north-star level is about the gain, not the absolute */
      var padLo = span * 0.35, padHi = span * 0.22;
      var sc = makeScale(lo - padLo, hi + padHi, yTop, yBot);   /* uses .y() */

      pRect(x0, yTop, x1 - x0, yBot - yTop, T.panel);

      /* y grid */
      var step = niceStep(sc.hi - sc.lo, Math.max(2, Math.floor((yBot - yTop) / 40)));
      var dp = stepDp(step);
      var first = Math.ceil(sc.lo / step) * step, v, guard = 0;
      for (v = first; v <= sc.hi + 1e-9 && guard < 200; v += step, guard++) {
        var gy = sc.y(v);
        if (!isFin(gy)) continue;
        pHLine(gy, x0, x1, T.grid, 1);
        pText(fmt(v, dp), x0 - 6, gy, font(9), T.faint, 'right', 'middle');
      }

      /* baseline reference */
      if (isFin(baseline)) {
        var by0 = sc.y(baseline);
        pHLine(by0, x0, x1, hexA(T.dim, 0.7), 1, [5, 3]);
        /* just the word: the leftmost column already carries the number, and
         * repeating it here collides when projected lands on the baseline */
        pText('baseline', x1 - 4, by0 - 10, font(9), T.dim, 'right', 'middle');
      }

      var n = cols.length;
      var slot = (x1 - x0) / n;
      var bw = Math.min(slot * 0.62, 58);
      var labelF = font(9);

      for (i = 0; i < n; i++) {
        var c = cols[i];
        var cx = x0 + slot * (i + 0.5);
        var top_, bot_, col;
        if (c.kind === 'base' || c.kind === 'proj') {
          top_ = sc.y(c.value); bot_ = yBot;
          col = c.kind === 'base' ? T.dim : T.accent;
        } else {
          top_ = sc.y(Math.max(c.from, c.to));
          bot_ = sc.y(Math.min(c.from, c.to));
          col = c.kind === 'noise' ? T.warn : (c.value >= 0 ? T.good : T.bad);
        }
        if (!isFin(top_) || !isFin(bot_)) continue;
        var h = Math.max(2, bot_ - top_);

        if (c.kind === 'noise') {
          pStrokeRect(cx - bw / 2, top_, bw, h, hexA(col, 0.8), 1);
          pHatch(cx - bw / 2, top_, bw, h, hexA(col, 0.5), 1, 5);
        } else {
          pRound(cx - bw / 2, top_, bw, h, 2, hexA(col, c.kind === 'delta' ? 0.7 : 0.5), hexA(col, 0.95), 1);
        }

        /* connector to the next column */
        if (i < n - 1 && c.kind !== 'proj') {
          var yc = sc.y(c.kind === 'base' ? c.value : c.to);
          if (isFin(yc)) pHLine(yc, cx + bw / 2, x0 + slot * (i + 1.5) - bw / 2, hexA(T.dim, 0.45), 1, [3, 3]);
        }

        /* value label above */
        var vTxt = (c.kind === 'delta' || c.kind === 'noise') ? fmtSigned(c.value, 1) : fmt(c.value, 1);
        pText(vTxt, cx, top_ - 9, font(10, '600'),
              c.kind === 'delta' ? (c.value >= 0 ? T.good : T.bad) : (c.kind === 'noise' ? T.warn : T.text),
              'center', 'middle');

        /* name below, wrapped to two lines */
        var nm = c.name || '';
        var parts = String(nm).split('\n');
        var l1 = parts[0], l2 = parts.length > 1 ? parts[1] : '';
        if (!l2 && textW(l1, labelF) > slot - 4) {
          var cut = l1.lastIndexOf(' ', Math.max(1, Math.floor(l1.length * 0.6)));
          if (cut > 2) { l2 = l1.slice(cut + 1); l1 = l1.slice(0, cut); }
        }
        pText(fitText(l1, slot - 4, labelF), cx, yBot + 11, labelF, T.dim, 'center', 'middle');
        if (l2) pText(fitText(l2, slot - 4, labelF), cx, yBot + 22, labelF, T.dim, 'center', 'middle');
      }

      if (!ship.length) {
        pText('NOTHING SHIPPED YET — unshipped work moves this number by zero',
              (x0 + x1) / 2, yTop + 16, font(10), hexA(T.faint, 0.95), 'center', 'middle');
      }
      pStrokeRect(x0, yTop, x1 - x0, yBot - yTop, T.border, 1);
      pText(unitTxt, PAD, yTop - 2, font(8), T.faint, 'left', 'middle');
    }

    /* ===================================================================== *
     * PLOT 5 — truth (debrief)
     * ===================================================================== */
    function normTruth(cfg) {
      cfg = cfg || {};
      var raw = cfg.perFeature;
      if (!raw || typeof raw.length !== 'number') raw = [];
      var rows = [], i, j, cmap = {};
      for (i = 0; i < raw.length; i++) {
        var r = raw[i];
        if (!r || typeof r !== 'object') continue;
        var truth = num(r.truth, NaN);
        var rd = [], src = r.readings;
        if (src && typeof src.length === 'number') {
          for (j = 0; j < src.length; j++) {
            var s = src[j];
            if (!s || typeof s !== 'object') continue;
            var v = num(s.value, NaN);
            if (!isFin(v)) continue;
            var id = String((s.instrument != null ? s.instrument : s.instrumentId) || '');
            if (cmap[id] == null && typeof s.color === 'string') cmap[id] = okColor(s.color, null);
            rd.push({ id: id, value: v, err: isFin(truth) ? v - truth : NaN });
          }
        }
        rows.push({
          name: nameOf(r, 'id'),
          truth: truth,
          believed: num(r.believed, NaN),
          shipped: !!r.shipped,
          verdict: typeof r.verdict === 'string' ? r.verdict : '',
          readings: rd
        });
      }

      /* group errors by instrument — the headline */
      var order = [], seen = {};
      var instCfg = cfg.instruments;
      if (instCfg && typeof instCfg.length === 'number') {
        for (i = 0; i < instCfg.length; i++) {
          var it = instCfg[i];
          var iid = (it && typeof it === 'object') ? String(it.id == null ? '' : it.id) : String(it == null ? '' : it);
          if (!iid || seen[iid]) continue;
          if (it && typeof it === 'object' && typeof it.color === 'string') {
            var oc = okColor(it.color, null);
            if (oc) cmap[iid] = oc;
          }
          seen[iid] = 1; order.push(iid);
        }
      }
      for (i = 0; i < rows.length; i++) for (j = 0; j < rows[i].readings.length; j++) {
        var k = rows[i].readings[j].id;
        if (!k || seen[k]) continue;
        seen[k] = 1; order.push(k);
      }

      var byInst = {}, gi;
      for (gi = 0; gi < order.length; gi++) byInst[order[gi]] = { id: order[gi], errs: [], mean: NaN, n: 0 };
      for (i = 0; i < rows.length; i++) for (j = 0; j < rows[i].readings.length; j++) {
        var rr = rows[i].readings[j];
        if (!isFin(rr.err)) continue;
        var g = byInst[rr.id];
        if (!g) { g = byInst[rr.id] = { id: rr.id, errs: [], mean: NaN, n: 0 }; order.push(rr.id); }
        g.errs.push(rr.err);
      }
      var groups = [];
      for (gi = 0; gi < order.length; gi++) {
        var gg = byInst[order[gi]];
        if (!gg) continue;
        var sum = 0;
        for (j = 0; j < gg.errs.length; j++) sum += gg.errs[j];
        gg.n = gg.errs.length;
        gg.mean = gg.n ? sum / gg.n : NaN;
        groups.push(gg);
      }
      groups.sort(function (a, b) {
        var am = isFin(a.mean) ? a.mean : -Infinity, bm = isFin(b.mean) ? b.mean : -Infinity;
        return bm - am;
      });
      return { rows: rows, groups: groups, order: order, cmap: cmap };
    }

    function drawTruth(cfg) {
      var d = normTruth(cfg);
      var rows = d.rows, groups = d.groups, cmap = d.cmap;
      var i, j;
      function icol(id) { return (cmap && cmap[id]) || instMeta(id).color; }

      var worst = null;
      for (i = 0; i < groups.length; i++) {
        if (!isFin(groups[i].mean) || !groups[i].n) continue;
        if (!worst || Math.abs(groups[i].mean) > Math.abs(worst.mean)) worst = groups[i];
      }
      var sub = worst
        ? instLabel(worst.id) + ' read ' + (worst.mean >= 0 ? 'HIGH' : 'LOW') + ' by ' + fmt(Math.abs(worst.mean), 1) + 'pp on average'
        : '';
      var top = drawTitle('The reveal — truth vs what each instrument told you', sub);

      var ids = [];
      for (i = 0; i < groups.length; i++) ids.push(groups[i].id);
      var legH = drawInstrumentLegend(ids, PAD, top, cssW - PAD, [
        { label: 'TRUTH', kind: 'truth' },
        { label: 'YOUR FORECAST', kind: 'pred' }
      ], cmap);
      var bodyTop = top + legH;
      var bodyBot = cssH - PAD;

      if (cssW - PAD * 2 < 120 || bodyBot - bodyTop < 60) {
        drawEmpty(PAD, bodyTop, cssW - PAD, bodyBot, 'TOO SMALL');
        return;
      }
      if (!rows.length) {
        pRect(PAD, bodyTop, cssW - PAD * 2, bodyBot - bodyTop, T.panel);
        pStrokeRect(PAD, bodyTop, cssW - PAD * 2, bodyBot - bodyTop, T.border, 1);
        drawEmpty(PAD, bodyTop, cssW - PAD, bodyBot, 'NO FEATURES TO REVEAL');
        return;
      }

      /* Two panels: per-feature reveal, and the bias headline. Stack them
       * when there is not enough width to sit side by side. */
      var side = cssW >= 780;
      var aL, aR, aT, aB, bL, bR, bT, bB;
      if (side) {
        var split = Math.round((cssW - PAD * 2) * 0.60);
        aL = PAD; aR = PAD + split - 10; aT = bodyTop; aB = bodyBot;
        bL = PAD + split + 10; bR = cssW - PAD; bT = bodyTop; bB = bodyBot;
      } else {
        var h1 = Math.round((bodyBot - bodyTop) * 0.56);
        aL = PAD; aR = cssW - PAD; aT = bodyTop; aB = bodyTop + h1 - 12;
        bL = PAD; bR = cssW - PAD; bT = bodyTop + h1 + 4; bB = bodyBot;
      }

      drawTruthFeatures(rows, aL, aT, aR, aB, icol);
      drawTruthBias(groups, bL, bT, bR, bB, icol);
    }

    /* Panel A: per feature — readings, error whiskers, truth, forecast */
    function drawTruthFeatures(rows, X0, Y0, X1, Y1, icol) {
      var i, j;
      pText('PER FEATURE · readings vs truth', X0, Y0 + 6, font(9, '600'), T.dim, 'left', 'middle');

      var nameF = font(10);
      var labelW = 76;
      for (i = 0; i < rows.length; i++) labelW = Math.max(labelW, textW(rows[i].name, nameF) + 8);
      labelW = Math.min(labelW, Math.max(60, (X1 - X0) * 0.32));
      var gutterW = (X1 - X0) > 320 ? 74 : 0;

      var x0 = X0 + labelW + 6, x1 = X1 - gutterW;
      var yTop = Y0 + 18, yBot = Y1 - 26;
      if (x1 - x0 < 50 || yBot - yTop < 20) { drawEmpty(X0, Y0, X1, Y1, 'TOO SMALL'); return; }

      var vals = [];
      for (i = 0; i < rows.length; i++) {
        if (isFin(rows[i].truth)) vals.push(rows[i].truth);
        if (isFin(rows[i].believed)) vals.push(rows[i].believed);
        for (j = 0; j < rows[i].readings.length; j++) vals.push(rows[i].readings[j].value);
      }
      var dom = domainOf(vals, { includeZero: true, pad: 0.1, emptyLo: 0, emptyHi: 6 });
      var sc = makeScale(dom.lo, dom.hi, x0, x1);

      var availH = yBot - yTop;
      var rowH = availH / rows.length, shown = rows.length;
      if (rowH < 14) { shown = Math.max(1, Math.floor(availH / 14)); rowH = availH / shown; }
      rowH = Math.min(rowH, 40);
      yBot = yTop + rowH * shown;

      pRect(x0, yTop, x1 - x0, yBot - yTop, T.panel);
      for (i = 0; i < shown; i++) pRect(x0, yTop + i * rowH, x1 - x0, rowH, i % 2 ? T.rowB : T.rowA);
      drawXAxis(sc, x0, x1, yTop, yBot, 'impact (pp)  ·  bar = truth, dots = readings');
      for (i = 1; i < shown; i++) pHLine(yTop + i * rowH, x0, x1, hexA(T.border, 0.5), 1);

      for (i = 0; i < shown; i++) {
        var r = rows[i];
        var ry = yTop + i * rowH, cy = ry + rowH / 2;

        var xs = [], k;
        for (k = 0; k < r.readings.length; k++) xs.push(sc.x(r.readings[k].value));
        var rDot = clamp(rowH * 0.15, 2.8, 4.6);
        var offs = dodgeY(xs, rDot * 2.1, Math.max(1, rowH * 0.22));
        var xt = isFin(r.truth) ? sc.x(r.truth) : NaN;

        /* error whiskers: truth -> reading, in the instrument's colour */
        if (isFin(xt)) {
          for (k = 0; k < r.readings.length; k++) {
            pLine(xt, cy + offs[k], xs[k], cy + offs[k], hexA(icol(r.readings[k].id), 0.5), 1);
          }
        }
        for (k = 0; k < r.readings.length; k++) {
          var mm = instMeta(r.readings[k].id);
          pShape(mm.shape, xs[k], cy + offs[k], rDot, icol(r.readings[k].id), hexA(T.bg, 0.9), 1);
        }
        if (isFin(r.believed)) pPredicted(sc.x(r.believed), cy, rowH * 0.6, null);
        if (isFin(xt)) pTruthMark(xt, cy, rowH * 0.72);

        pText(fitText(r.name, labelW - 4, nameF), x0 - 6, cy, nameF,
              r.shipped ? T.text : T.dim, 'right', 'middle');

        if (gutterW) {
          var vtxt = r.verdict ? r.verdict.toUpperCase() : (r.shipped ? 'SHIPPED' : '—');
          var vcol = T.faint;
          if (/vanity|miss|regret|wrong/i.test(vtxt)) vcol = T.bad;
          else if (/win|good|right|hit/i.test(vtxt)) vcol = T.good;
          else if (r.shipped) vcol = T.accent;
          pText(fitText(vtxt, gutterW - 6, font(8, '600')), x1 + 5, cy, font(8, '600'), vcol, 'left', 'middle');
        }
      }
      if (shown < rows.length) {
        pText('+' + (rows.length - shown) + ' more', x0 + 6, yBot - 7, font(9), T.faint, 'left', 'middle');
      }
      pStrokeRect(x0, yTop, x1 - x0, yBot - yTop, T.border, 1);
    }

    /* Panel B: the headline — mean signed error per instrument */
    function drawTruthBias(groups, X0, Y0, X1, Y1, icol) {
      var i, j;
      pText('SYSTEMATIC BIAS · mean signed error', X0, Y0 + 6, font(9, '600'), T.dim, 'left', 'middle');

      var live = [];
      for (i = 0; i < groups.length; i++) if (groups[i].n > 0) live.push(groups[i]);

      var labF = font(9, '600');
      var labelW = 60;
      for (i = 0; i < live.length; i++) labelW = Math.max(labelW, textW(instLabel(live[i].id), labF) + 8);
      labelW = Math.min(labelW, Math.max(52, (X1 - X0) * 0.34));
      var gutterW = (X1 - X0) > 260 ? 66 : 0;

      var x0 = X0 + labelW + 6, x1 = X1 - gutterW;
      var yTop = Y0 + 28, yBot = Y1 - 26;   /* title, then the direction tags */
      if (x1 - x0 < 40 || yBot - yTop < 20) { drawEmpty(X0, Y0, X1, Y1, 'TOO SMALL'); return; }

      if (!live.length) {
        pRect(X0, yTop, X1 - X0, yBot - yTop, T.panel);
        pStrokeRect(X0, yTop, X1 - X0, yBot - yTop, T.border, 1);
        drawEmpty(X0, yTop, X1, yBot, 'NO READINGS', 'You ran no research this quarter.');
        return;
      }

      var vals = [];
      for (i = 0; i < live.length; i++) {
        if (isFin(live[i].mean)) vals.push(live[i].mean);
        for (j = 0; j < live[i].errs.length; j++) vals.push(live[i].errs[j]);
      }
      var dom = domainOf(vals, { symmetric: true, pad: 0.12 });
      var sc = makeScale(dom.lo, dom.hi, x0, x1);
      var xz = sc.raw(0);

      var availH = yBot - yTop;
      var rowH = availH / live.length, shown = live.length;
      if (rowH < 14) { shown = Math.max(1, Math.floor(availH / 14)); rowH = availH / shown; }
      rowH = Math.min(rowH, 40);
      yBot = yTop + rowH * shown;

      pRect(x0, yTop, x1 - x0, yBot - yTop, T.panel);
      for (i = 0; i < shown; i++) pRect(x0, yTop + i * rowH, x1 - x0, rowH, i % 2 ? T.rowB : T.rowA);

      /* tint the two halves: right = read high, left = read low */
      if (isFin(xz)) {
        pRect(xz, yTop, Math.max(0, x1 - xz), yBot - yTop, hexA(T.bad, 0.06));
        pRect(x0, yTop, Math.max(0, xz - x0), yBot - yTop, hexA(T.accent, 0.06));
      }
      drawXAxis(sc, x0, x1, yTop, yBot, 'reading − truth (pp)');
      for (i = 1; i < shown; i++) pHLine(yTop + i * rowH, x0, x1, hexA(T.border, 0.5), 1);

      pText('READ LOW ◀', x0 + 4, yTop - 8, font(8), hexA(T.accent, 0.9), 'left', 'middle');
      pText('▶ READ HIGH', x1 - 4, yTop - 8, font(8), hexA(T.bad, 0.9), 'right', 'middle');

      for (i = 0; i < shown; i++) {
        var g = live[i];
        var m = instMeta(g.id);
        var mcol = icol(g.id);
        var ry = yTop + i * rowH, cy = ry + rowH / 2;

        /* the mean bar, from zero */
        if (isFin(g.mean) && isFin(xz)) {
          var xm = sc.x(g.mean);
          var bh = Math.min(rowH * 0.46, 16);
          var bx = Math.min(xz, xm), bwid = Math.max(1.5, Math.abs(xm - xz));
          pRound(bx, cy - bh / 2, bwid, bh, 2, hexA(mcol, 0.55), hexA(mcol, 0.95), 1);
        }
        /* the individual errors on top, so n and consistency are visible */
        var xs = [], k;
        for (k = 0; k < g.errs.length; k++) xs.push(sc.x(g.errs[k]));
        var rDot = clamp(rowH * 0.12, 2.2, 3.6);
        var offs = dodgeY(xs, rDot * 2.0, Math.max(1, rowH * 0.18));
        for (k = 0; k < xs.length; k++) {
          pShape(m.shape, xs[k], cy + offs[k], rDot, hexA(mcol, 0.95), hexA(T.bg, 0.85), 0.9);
        }

        pText(fitText(m.label, labelW - 4, labF), x0 - 6, cy, labF, mcol, 'right', 'middle');

        if (gutterW) {
          var verdict, vcol;
          if (!isFin(g.mean)) { verdict = '--'; vcol = T.faint; }
          else if (Math.abs(g.mean) < 0.5) { verdict = 'clean'; vcol = T.good; }
          else if (g.mean > 0) { verdict = 'HIGH ' + fmtSigned(g.mean, 1); vcol = T.bad; }
          else { verdict = 'LOW ' + fmtSigned(g.mean, 1); vcol = T.accent; }
          pText(fitText(verdict, gutterW - 6, font(9, '600')), x1 + 5, cy - (rowH > 26 ? 6 : 0),
                font(9, '600'), vcol, 'left', 'middle');
          if (rowH > 26) pText('n=' + g.n, x1 + 5, cy + 7, font(8), T.faint, 'left', 'middle');
        }
      }
      if (shown < live.length) {
        pText('+' + (live.length - shown) + ' more', x0 + 6, yBot - 7, font(9), T.faint, 'left', 'middle');
      }
      if (isFin(xz)) pVLine(xz, yTop, yBot, hexA(T.white, 0.7), 1.5);
      pStrokeRect(x0, yTop, x1 - x0, yBot - yTop, T.border, 1);
    }

    /* ------------------------------------------------------------------- *
     * Dispatch
     * ------------------------------------------------------------------- */
    var RENDERERS = {
      evidence: drawEvidence,
      gantt: drawGantt,
      trust: drawTrust,
      impact: drawImpact,
      truth: drawTruth
    };

    function draw() {
      if (destroyed || !last) return;
      if (!beginFrame()) return;
      if (tooSmall()) return;
      var fn = RENDERERS[last.kind];
      if (!fn) return;
      try {
        fn(last.cfg || {});
      } catch (e) {
        /* A chart must never take the sim down with it. */
        pRect(0, 0, cssW, cssH, T.bg);
        pText('VIZ ERROR: ' + (e && e.message ? e.message : e), PAD, PAD + 6, font(10), T.bad, 'left', 'middle');
        if (global.console && global.console.error) global.console.error('Viz.' + last.kind + ':', e);
      }
    }

    function renderer(kind) {
      return function (cfg) {
        if (destroyed) return api;
        last = { kind: kind, cfg: cfg || {} };
        draw();
        return api;
      };
    }

    var api = {
      evidence: renderer('evidence'),
      gantt: renderer('gantt'),
      trust: renderer('trust'),
      impact: renderer('impact'),
      truth: renderer('truth'),
      resize: function () {
        if (destroyed) return api;
        syncBackingStore();
        draw();
        return api;
      },
      clear: function () {
        if (destroyed) return api;
        last = null;
        if (beginFrame()) { /* bg only */ }
        return api;
      },
      destroy: function () {
        if (destroyed) return;
        destroyed = true;
        last = null; twCache = {};
      },
      /* introspection for the preview harness / tests */
      size: function () { return { w: cssW, h: cssH, dpr: dpr }; }
    };

    syncBackingStore();
    return api;
  }

  global.Viz = {
    create: create,
    THEME: THEME,
    INSTRUMENTS: INSTRUMENTS,
    colorFor: instColor,
    labelFor: instLabel,
    shapeFor: function (id) { return instMeta(id).shape; },
    VERSION: VERSION
  };

})(typeof window !== 'undefined' ? window : this);
