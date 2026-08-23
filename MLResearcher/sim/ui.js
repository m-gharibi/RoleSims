/* ============================================================================
   FOUNDATIONAL ML RESEARCHER SIM — sim/ui.js
   Implements SPEC §5: brief, lab console, gate modal, readout, debrief.
   Vanilla JS. No frameworks, no build step, no fetch(), no ES modules.

   Depends ONLY on the documented public APIs of:
     window.SIM_WORLD  (data/world.js)
     window.Lab        (sim/lab.js)
     window.Plots      (sim/plots.js)
     window.Team       (sim/team.js)

   NON-NEGOTIABLE observed here: SIM_WORLD.reveal() is never called before
   Lab.submitReadout() has returned a score. See revealTruth().
   ============================================================================ */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* module state                                                        */
  /* ------------------------------------------------------------------ */
  var root = null;
  var S = {};                 // screens by key
  var $ = {};                 // cached elements by id

  var world = null;
  var state = null;           // last Lab state
  var running = false;
  var speed = 4;
  var started = false;

  var feedMsgs = [];
  var gateFired = {};
  var pollTimer = 0;
  var modalStack = [];
  var toastHost = null;

  var plotScaling = null, plotForest = null, plotTruth = null;
  var lastPlotSig = '';
  var lastTableSig = '';

  var score = null;           // set only after submitReadout
  var truth = null;           // set only after submitReadout
  var readoutDone = false;
  var deadlineHandled = false;

  /* designer form state */
  var D = { sel: {}, scale: null, steps: null, seeds: 1 };
  var lastPreview = null;

  /* results table sort */
  var sortKey = 'fin', sortDir = -1;

  /* readout form state */
  var RO = { sel: {}, conf: 60 };

  var DAYNAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  var ROLE_NAME = {
    LEAD: 'RESEARCH LEAD', OPS: 'COMPUTE OPS', PEER: 'PEER',
    RIVAL: 'TEAM HALBERD', SYS: 'SYSTEM'
  };
  /* Okabe–Ito, colour-blind safe */
  var PALETTE = ['#56B4E9', '#009E73', '#E69F00', '#CC79A7',
                 '#0072B2', '#D55E00', '#F0E442', '#9aa4af'];

  var DEFAULT_GATES = [
    { day: 1, hour: 9,  id: 'plan',    title: 'Research plan',
      prompt: 'Before you burn a GPU-hour: post your plan to Yuki in chat.' },
    { day: 3, hour: 14, id: 'midweek', title: 'Midweek review',
      prompt: "Yuki wants your current belief, your evidence, and what you'd cut." },
    { day: 5, hour: 16, id: 'readout', title: 'Friday readout',
      prompt: 'Paste your readout into chat and defend the recommendation.' }
  ];
  var GATES = DEFAULT_GATES;

  var GATE_CHECKLIST = {
    plan: ['The question, in one sentence, and the metric you will move',
           'Which interventions you will measure first, and at what scale',
           'How much of the 6000 GPU-hours each phase gets',
           'What result would make you drop an intervention'],
    midweek: ['Your current belief about each intervention, with a number',
              'The evidence behind it: scale, seeds, CI — not vibes',
              'What you would cut right now, and why',
              'What you still cannot answer and how you plan to fix it'],
    readout: ['The at-most-four you are recommending for the 70B run',
              'The effect you expect at 70B, and the uncertainty on it',
              'Which claims are extrapolations and which are measured',
              'What would change your mind']
  };

  var NREF = 7.0e7;   /* overridden from scenario.nref at boot if the data supplies one */

  /* ------------------------------------------------------------------ */
  /* tiny helpers                                                        */
  /* ------------------------------------------------------------------ */
  function id(x) { return document.getElementById(x); }
  function q(sel, ctx) { return (ctx || document).querySelector(sel); }
  function qa(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }
  function on(node, ev, fn) { if (node) node.addEventListener(ev, fn); }

  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function num(n) { return typeof n === 'number' && isFinite(n); }
  function h(html) {
    var d = document.createElement('div');
    d.innerHTML = String(html).trim();
    return d.firstElementChild;
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function setText(node, txt) {
    if (!node) return;
    if (node._t === txt) return;
    node._t = txt; node.textContent = txt;
  }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function hhmm(hr) {
    if (!num(hr)) return '--:--';
    var t = Math.round(hr * 60);
    var hh = Math.floor(t / 60), mm = t % 60;
    return pad2(hh) + ':' + pad2(mm);
  }
  function dayName(d) { return DAYNAMES[(d | 0) - 1] || ('D' + d); }
  function stamp(d, hr) { return dayName(d) + ' ' + hhmm(hr); }

  function f1(n) { return num(n) ? n.toFixed(1) : '—'; }
  function f2(n) { return num(n) ? n.toFixed(2) : '—'; }
  function sf2(n) { return num(n) ? (n > 0 ? '+' : '') + n.toFixed(2) : '—'; }
  function intf(n) { return num(n) ? Math.round(n).toLocaleString('en-US') : '—'; }
  function pct(n, dp) { return num(n) ? n.toFixed(dp === undefined ? 1 : dp) + '%' : '—'; }
  function cls(n) { return !num(n) || Math.abs(n) < 0.005 ? 'flat' : (n > 0 ? 'pos' : 'neg'); }
  function paramsLabel(p) {
    var sc = (world && world.scenario) || {};
    if (num(p) && num(sc.runScale) && p === sc.runScale && sc.runScaleLabel) return sc.runScaleLabel;
    if (!num(p)) return '—';
    if (p >= 1e9) return (p / 1e9 >= 10 ? Math.round(p / 1e9) : (p / 1e9).toFixed(1).replace(/\.0$/, '')) + 'B';
    return Math.round(p / 1e6) + 'M';
  }

  function rules() {
    var R = (window.Lab && window.Lab.RULES) || {};
    return {
      computeBudget: num(R.computeBudget) ? R.computeBudget : 6000,
      slots: num(R.slots) ? R.slots : 4,
      days: num(R.days) ? R.days : 5,
      hoursPerDay: num(R.hoursPerDay) ? R.hoursPerDay : 10,
      startHour: num(R.startHour) ? R.startHour : 9,
      maxInterventions: num(R.maxInterventions) ? R.maxInterventions : 4,
      killRefund: num(R.killRefund) ? R.killRefund : 0.5,
      minHypothesisChars: num(R.minHypothesisChars) ? R.minHypothesisChars : 20
    };
  }
  function maxIv() {
    var sc = (world && world.scenario) || {};
    return num(sc.maxInterventions) ? sc.maxInterventions : rules().maxInterventions;
  }
  function metricName() {
    var m = (world && world.scenario && world.scenario.metric) || {};
    return m.name || 'metric';
  }
  function metricUnits() {
    var m = (world && world.scenario && world.scenario.metric) || {};
    return m.units || 'points';
  }
  function scaleById(sid) {
    var ss = (world && world.scales) || [];
    for (var i = 0; i < ss.length; i++) if (ss[i].id === sid) return ss[i];
    return null;
  }
  function stepsById(sid) {
    var ss = (world && world.stepOptions) || [];
    for (var i = 0; i < ss.length; i++) if (ss[i].id === sid) return ss[i];
    return null;
  }
  function ivById(iid) {
    var ivs = (world && world.interventions) || [];
    for (var i = 0; i < ivs.length; i++) if (ivs[i].id === iid) return ivs[i];
    return null;
  }
  function ivName(iid) { var v = ivById(iid); return v ? (v.name || v.id) : iid; }
  function ivIndex(iid) {
    var ivs = (world && world.interventions) || [];
    for (var i = 0; i < ivs.length; i++) if (ivs[i].id === iid) return i;
    return -1;
  }
  function setSig(ids) { return (ids || []).slice().sort().join('+'); }
  function setLabel(ids) { return (ids || []).map(ivName).join(' + '); }
  function setLabelShort(ids, max) {
    var s = setLabel(ids);
    max = max || 24;
    return s.length > max ? s.slice(0, max - 1) + '…' : s;
  }
  var FAM_ABBR = { architecture: 'ARCH', data: 'DATA', optimization: 'OPT', optimisation: 'OPT',
                   optimizer: 'OPT', objective: 'OBJ', systems: 'SYS', infra: 'SYS' };
  function famAbbr(f) {
    var k = String(f || '').toLowerCase();
    return FAM_ABBR[k] || k.slice(0, 4).toUpperCase();
  }
  function unitAbbr(u) {
    var k = String(u || '').toLowerCase();
    return k === 'points' ? 'pts' : k.slice(0, 4);
  }
  function colorFor(ids) {
    if (!ids || !ids.length) return PALETTE[7];
    if (ids.length === 1) {
      var i = ivIndex(ids[0]);
      return PALETTE[(i < 0 ? 0 : i) % PALETTE.length];
    }
    var hsh = 0, s = setSig(ids);
    for (var k = 0; k < s.length; k++) hsh = (hsh * 31 + s.charCodeAt(k)) >>> 0;
    return PALETTE[hsh % PALETTE.length];
  }
  function results() { return (state && state.results) || []; }
  function okResults() {
    return results().filter(function (r) { return r && r.status !== 'failed'; });
  }

  /* ================================================================== */
  /* DEFENSIVE BOOT                                                     */
  /* ================================================================== */
  var REQUIRED = [
    { global: 'SIM_WORLD', file: 'data/world.js',
      check: function (v) {
        return v && v.scenario && Array.isArray(v.interventions) && v.interventions.length &&
               Array.isArray(v.scales) && v.scales.length &&
               Array.isArray(v.stepOptions) && v.stepOptions.length &&
               typeof v.reveal === 'function';
      },
      detail: 'window.SIM_WORLD needs scenario, interventions[], scales[], stepOptions[] and a reveal() helper (SPEC §1).' },
    { global: 'Lab', file: 'sim/lab.js',
      methods: ['init', 'getState', 'design', 'launch', 'kill', 'step', 'start', 'pause',
                'resume', 'setSpeed', 'submitReadout', 'exportReadout', 'on'],
      detail: 'window.Lab must expose the lifecycle / design / launch / scoring API from SPEC §2.' },
    { global: 'Plots', file: 'sim/plots.js',
      methods: ['create'],
      detail: 'window.Plots.create(canvas, opts) must return an object with scaling()/forest()/truth()/resize().' },
    { global: 'Team', file: 'sim/team.js',
      methods: ['init', 'tick', 'getFeed'],
      detail: 'window.Team must expose init/tick/getFeed and (ideally) GATES (SPEC §4).' }
  ];

  function auditGlobals() {
    var rows = [];
    for (var i = 0; i < REQUIRED.length; i++) {
      var r = REQUIRED[i], v = window[r.global], missing = [], ok = !!v;
      if (ok && r.methods) {
        for (var j = 0; j < r.methods.length; j++) {
          if (typeof v[r.methods[j]] !== 'function') missing.push(r.methods[j]);
        }
        if (missing.length) ok = false;
      }
      if (ok && r.check) { try { ok = !!r.check(v); } catch (e) { ok = false; } }
      rows.push({ spec: r, present: !!v, ok: ok, missing: missing });
    }
    return rows;
  }

  function renderDiagnostics(rows) {
    var html = '<div class="diag-wrap">' +
      '<h1>BOOT FAILED — a module did not load</h1>' +
      '<div class="note">The simulator could not start because one or more of its script files is ' +
      'missing, failed to parse, or does not expose the API described in <b>SPEC.md</b>. ' +
      'This is not a browser problem — check the files themselves.</div>' +
      '<table class="diag-tbl"><thead><tr>' +
      '<th>Global</th><th>File</th><th>Status</th><th>What is wrong</th></tr></thead><tbody>';
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i], status, why;
      if (r.ok) { status = '<span class="diag-ok">OK</span>'; why = '<span class="dim">—</span>'; }
      else if (!r.present) {
        status = '<span class="diag-bad">MISSING</span>';
        why = 'window.' + esc(r.spec.global) + ' is undefined — <b>' + esc(r.spec.file) +
              '</b> did not load, or threw while parsing. Open the console (Cmd-Opt-J) for the parse error.';
      } else if (r.missing.length) {
        status = '<span class="diag-bad">INCOMPLETE</span>';
        why = 'Loaded, but missing method(s): <b>' + esc(r.missing.join(', ')) + '</b>';
      } else {
        status = '<span class="diag-bad">INVALID</span>';
        why = esc(r.spec.detail);
      }
      html += '<tr><td><b>window.' + esc(r.spec.global) + '</b></td><td class="dim">' +
        esc(r.spec.file) + '</td><td>' + status + '</td><td>' + why + '</td></tr>';
    }
    html += '</tbody></table>' +
      '<div class="diag-box"><b>Expected load order (index.html):</b><br>' +
      '&lt;script src="data/world.js"&gt;&lt;/script&gt;<br>' +
      '&lt;script src="sim/lab.js"&gt;&lt;/script&gt;<br>' +
      '&lt;script src="sim/plots.js"&gt;&lt;/script&gt;<br>' +
      '&lt;script src="sim/team.js"&gt;&lt;/script&gt;<br>' +
      '&lt;script src="sim/ui.js"&gt;&lt;/script&gt;<br><br>' +
      'Everything must run from <code>file://</code> — no ES modules, no fetch(), no CDN.</div></div>';
    document.body.innerHTML = '';
    var d = h('<div id="mls-root"></div>');
    d.innerHTML = html;
    document.body.appendChild(d);
  }

  function installGlobalErrorBar() {
    window.addEventListener('error', function (ev) {
      showErrBar('JS error: ' + (ev.message || 'unknown') +
        (ev.filename ? '  (' + String(ev.filename).split('/').pop() + ':' + ev.lineno + ')' : ''));
    });
  }
  function showErrBar(msg) {
    var bar = id('mls-errbar');
    if (!bar) {
      bar = h('<div class="errbar" id="mls-errbar"><span id="mls-errmsg"></span>' +
              '<button class="btn ghost" id="mls-errx">dismiss</button></div>');
      document.body.appendChild(bar);
      on(id('mls-errx'), 'click', function () { bar.remove(); });
    }
    id('mls-errmsg').textContent = msg;
  }
  function safe(fn) {
    return function () {
      try { return fn.apply(null, arguments); }
      catch (e) { showErrBar('UI handler error: ' + (e && e.message ? e.message : e)); }
    };
  }

  function boot() {
    var rows = auditGlobals();
    if (rows.filter(function (r) { return !r.ok; }).length) { renderDiagnostics(rows); return; }

    world = window.SIM_WORLD;
    if (Array.isArray(window.Team.GATES) && window.Team.GATES.length) GATES = window.Team.GATES;

    if (num(world.scenario && world.scenario.nref)) NREF = world.scenario.nref;
    D.scale = (world.scales[Math.min(1, world.scales.length - 1)] || world.scales[0]).id;
    var std = null;
    for (var i = 0; i < world.stepOptions.length; i++) {
      if (world.stepOptions[i].id === 'std') std = world.stepOptions[i];
    }
    D.steps = (std || world.stepOptions[Math.min(1, world.stepOptions.length - 1)] || world.stepOptions[0]).id;
    D.seeds = 2;

    buildDom();
    installGlobalErrorBar();
    renderBrief();
    showScreen('brief');
  }

  /* ------------------------------------------------------------------ */
  /* DOM                                                                 */
  /* ------------------------------------------------------------------ */
  function buildDom() {
    document.body.innerHTML = '';
    root = h('<div id="mls-root"></div>');
    root.appendChild(h(BRIEF_HTML));
    root.appendChild(h(LAB_HTML));
    root.appendChild(h(READOUT_HTML));
    root.appendChild(h(DEBRIEF_HTML));
    root.appendChild(h('<div id="modal-layer"><div class="modal-bg"></div></div>'));
    document.body.appendChild(root);

    S.brief = id('scr-brief');
    S.lab = id('scr-lab');
    S.readout = id('scr-readout');
    S.debrief = id('scr-debrief');
    toastHost = id('l-toasts');

    cacheEls();
    wireBrief();
    wireLab();
    wireReadout();
    wireDebrief();
    wireKeyboard();

    window.addEventListener('resize', function () {
      [plotScaling, plotForest, plotTruth].forEach(function (p) {
        try { if (p && p.resize) p.resize(); } catch (e) {}
      });
      redrawPlots(true);
      if (readoutDone && S.debrief && S.debrief.classList.contains('active')) {
        try { renderTruthPlot((world.scenario || {}).runScale || 7e10); } catch (e) {}
      }
    });
  }

  function cacheEls() {
    ['l-clock', 'l-day', 'l-status', 'l-pause', 'l-step', 'l-toasts',
     'l-budget-v', 'l-budget-bar', 'l-slots', 'l-deadline', 'l-nres',
     'd-ivs', 'd-scale', 'd-steps', 'd-seeds', 'd-seedbtns', 'd-prev',
     'd-hyp', 'd-hyp-state', 'd-pred', 'd-cilo', 'd-cihi', 'd-launch', 'd-why', 'd-msg',
     'j-body', 'j-count', 'r-body', 'r-count', 'feed-body',
     'pl-scaling', 'pl-forest', 'pl-scaling-empty', 'pl-forest-empty',
     'pl-scaling-err', 'pl-forest-err'
    ].forEach(function (k) { $[k] = id(k); });
  }

  function showScreen(name) {
    ['brief', 'lab', 'readout', 'debrief'].forEach(function (k) {
      if (S[k]) S[k].classList.toggle('active', k === name);
    });
  }

  /* ================================================================== */
  /* SCREEN 1 — BRIEF                                                   */
  /* ================================================================== */
  var BRIEF_HTML =
    '<div class="screen center-screen" id="scr-brief">' +
      '<div class="scrollwrap"><div class="sheet">' +
        '<div class="brand"><h1 id="b-org">FOUNDATIONAL ML RESEARCHER</h1>' +
          '<span class="sub" id="b-team">pretraining · one week · one recommendation</span></div>' +
        '<div class="rule"></div>' +
        '<div class="brief-grid">' +
          '<div>' +
            '<div class="blk headline"><h3>The question</h3><p id="b-question"></p></div>' +
            '<div class="blk"><h3>Monday morning</h3><p id="b-brief"></p></div>' +
            '<div class="blk ask"><h3>What you owe the run</h3><p id="b-ask"></p></div>' +
          '</div>' +
          '<div>' +
            '<div class="blk"><h3>The exercise</h3><div class="stat-grid" id="b-stats"></div></div>' +
            '<div class="blk"><h3>Metric</h3><p id="b-metric"></p></div>' +
            '<div class="blk"><h3>What the team already believes</h3>' +
              '<ul class="ev-list" id="b-evidence"></ul></div>' +
          '</div>' +
        '</div>' +
        '<div class="blk" style="margin-top:14px"><h3>The eight candidate interventions</h3>' +
          '<div class="iv-cards" id="b-ivs"></div></div>' +
        '<div class="blk" style="margin-top:12px"><h3>The scales you can buy</h3>' +
          '<div class="tbl-wrap" style="max-height:none"><table class="tbl"><thead><tr>' +
          '<th>SCALE</th><th class="r">PARAMS</th><th class="r">GPU-HOURS</th><th class="r">WALL CLOCK</th>' +
          '<th class="r notrans">&sigma; (1 seed, 10k steps)</th><th>WHAT THAT MEANS</th>' +
          '</tr></thead><tbody id="b-scales"></tbody></table></div>' +
          '<div class="note" style="margin-top:8px">Seeds cost GPU-hours but not wall-clock: ' +
          '&sigma; falls as 1/&radic;seeds. <b>Buying certainty costs compute, not time.</b> ' +
          'The designer prices that trade for you before every launch.</div>' +
        '</div>' +
        '<div class="foot-row">' +
          '<div class="note" id="b-note"></div>' +
          '<button class="btn primary big" id="b-go">START THE WEEK &rarr;</button>' +
        '</div>' +
      '</div></div>' +
    '</div>';

  function wireBrief() { on(id('b-go'), 'click', startWeek); }

  function renderBrief() {
    var sc = world.scenario || {}, R = rules();
    var m = sc.metric || {};

    setText(id('b-org'), (sc.org || 'AI LAB').toUpperCase());
    setText(id('b-team'), (sc.team || 'pretraining') + ' · ' + (sc.deadline || 'Friday') +
      ' · recommend at most ' + maxIv());
    id('b-question').textContent = sc.question || '(no question in data/world.js)';
    id('b-brief').textContent = sc.brief || '(no brief in data/world.js)';
    id('b-ask').textContent =
      'Recommend at most ' + maxIv() + ' of the ' + (world.interventions.length) +
      ' interventions for the ' + paramsLabel(sc.runScale) + ' run. You have ' +
      intf(R.computeBudget) + ' GPU-hours, ' + R.slots + ' concurrent slots and ' +
      R.days + ' days. Every experiment you buy is a noisy sample of a truth that ' +
      'changes with scale — and you have no data at the run scale itself.';

    id('b-stats').innerHTML =
      stat('COMPUTE BUDGET', intf(R.computeBudget) + ' <small class="dim">GPU-h</small>') +
      stat('SLOTS', R.slots + ' <small class="dim">concurrent</small>') +
      stat('TIME', R.days + ' days &times; ' + R.hoursPerDay + 'h') +
      stat('RUN SCALE', paramsLabel(sc.runScale)) +
      stat('MAX PICKS', String(maxIv())) +
      stat('CANDIDATES', String(world.interventions.length));

    id('b-metric').innerHTML = '<b>' + esc(m.name || 'metric') + '</b> — ' +
      esc(m.desc || '') + ' <span class="dim">(measured in ' + esc(m.units || 'points') + ')</span>';

    var ev = sc.priorEvidence || world.priorEvidence || [];
    id('b-evidence').innerHTML = ev.length ? ev.map(function (e) {
      return '<li>' + esc(e.text || '') + '<span class="src">— ' + esc(e.source || '') + '</span></li>';
    }).join('') : '<li class="dim">(no prior evidence in data/world.js)</li>';

    id('b-ivs').innerHTML = world.interventions.map(function (iv) {
      return '<div class="iv-card">' +
        '<div class="n">' + esc(iv.name || iv.id) + '</div>' +
        '<div class="d">' + esc(iv.desc || '') + '</div>' +
        '<div class="f"><span class="tag fam-' + esc(String(iv.family || 'other').toLowerCase()) + '">' +
          esc(iv.family || 'other') + '</span>' +
        '<span class="tag cost-' + esc(String(iv.cost || '').toLowerCase()) + '">' +
          esc(iv.cost || '?') + ' cost</span></div>' +
        (iv.author ? '<div class="dim" style="font-size:10px">proposed by ' + esc(iv.author) + '</div>' : '') +
        '</div>';
    }).join('');

    id('b-scales').innerHTML = (world.scales || []).map(function (s) {
      var mde = num(s.sigma) ? 2.8 * s.sigma : null;
      return '<tr><td><b>' + esc(s.label || s.id) + '</b></td>' +
        '<td class="r num">' + esc(paramsLabel(s.params)) + '</td>' +
        '<td class="r num">' + esc(intf(s.computeHours)) + '</td>' +
        '<td class="r num">' + esc(f1(s.wallHours)) + ' h</td>' +
        '<td class="r num cyan">' + esc(f2(s.sigma)) + '</td>' +
        '<td class="dim">one seed here can only resolve effects bigger than <b>~' +
        esc(f1(mde)) + '</b> ' + esc(metricUnits()) + '</td></tr>';
    }).join('');

    id('b-note').innerHTML = 'The clock starts at ' + hhmm(R.startHour) + ' on Monday. ' +
      'Yuki wants your plan before you spend anything.';
  }

  function stat(label, v) {
    return '<div class="stat"><span class="lbl">' + esc(label) + '</span><div class="v num">' + v + '</div></div>';
  }

  /* ================================================================== */
  /* SCREEN 2 — LAB CONSOLE                                             */
  /* ================================================================== */
  var LAB_HTML =
    '<div class="screen" id="scr-lab">' +
      '<div class="lab-hdr">' +
        '<div class="hdr-l">' +
          '<div class="clock num" id="l-clock">Mon 09:00</div>' +
          '<div class="clock-sub" id="l-day">DAY 1 OF 5 · <b>the recipe locks Friday</b></div>' +
        '</div>' +
        '<div class="hdr-c">' +
          '<div class="ctl-row">' +
            '<span class="lbl">SPEED</span>' +
            '<div class="seg" id="l-speed">' +
              '<button class="seg-b" data-speed="1">1&times;</button>' +
              '<button class="seg-b" data-speed="2">2&times;</button>' +
              '<button class="seg-b is-on" data-speed="4">4&times;</button>' +
              '<button class="seg-b" data-speed="8">8&times;</button>' +
            '</div>' +
            '<button class="btn" id="l-pause">PAUSE</button>' +
            '<button class="btn" id="l-step">+15m</button>' +
            '<button class="btn" id="l-adv1">+1h</button>' +
            '<button class="btn" id="l-adv4">+4h</button>' +
            '<button class="btn cyan" id="l-next">&rarr; NEXT RESULT</button>' +
          '</div>' +
          '<div id="l-status" class="dim">&nbsp;</div>' +
        '</div>' +
        '<div class="hdr-r">' +
          '<div class="budget-wrap">' +
            '<div class="budget-top"><span class="lbl">COMPUTE</span>' +
              '<span class="v num" id="l-budget-v">0 / 0</span></div>' +
            '<div class="bar"><div class="bar-fill" id="l-budget-bar"></div></div>' +
          '</div>' +
          '<div class="hdr-kv">' +
            '<div><span class="lbl">SLOTS</span><span class="v num" id="l-slots">0/4</span></div>' +
            '<div><span class="lbl">DEADLINE</span><span class="v num" id="l-deadline">—</span></div>' +
            '<div><span class="lbl">RESULTS</span><span class="v num" id="l-nres">0</span></div>' +
          '</div>' +
          '<button class="btn warn big" id="l-readout">READOUT &rarr;</button>' +
        '</div>' +
      '</div>' +

      '<div class="lab-grid">' +

        '<section class="panel a-design">' +
          '<div class="panel-hd"><span>EXPERIMENT DESIGNER</span>' +
            '<span class="dim" id="d-selcount">0 selected</span></div>' +
          '<div class="panel-bd d-col">' +

            '<div class="d-hd d-fix"><span class="lbl">INTERVENTIONS &mdash; combinations allowed</span>' +
              '<button class="btn tiny ghost" id="d-clear">clear</button></div>' +
            '<div class="iv-list" id="d-ivs"></div>' +

            '<div class="d-sec d-fix" style="margin-top:6px">' +
              '<div class="d-hd"><span class="lbl">MODEL SCALE</span></div>' +
              '<div class="seg wide" id="d-scale"></div>' +
            '</div>' +

            '<div class="d-sec d-fix">' +
              '<div class="seeds-row">' +
                '<span class="lbl">LENGTH</span>' +
                '<div class="seg wide" id="d-steps" style="grid-column:2/4"></div>' +
              '</div>' +
            '</div>' +

            '<div class="d-sec d-fix">' +
              '<div class="seeds-row">' +
                '<span class="lbl">SEEDS</span>' +
                '<input type="number" id="d-seeds" min="1" max="64" step="1" value="2">' +
                '<div class="seed-btns" id="d-seedbtns"></div>' +
              '</div>' +
            '</div>' +

            '<div class="d-sec d-fix" id="d-prev"></div>' +

            '<div class="d-sec d-fix">' +
              '<div class="d-hd"><span class="lbl">HYPOTHESIS &mdash; required</span>' +
                '<span class="lbl" id="d-hyp-state"></span></div>' +
              '<textarea id="d-hyp" maxlength="400" placeholder="What do you expect, and why? What would falsify it?"></textarea>' +
            '</div>' +

            '<div class="d-sec d-fix">' +
              '<div class="d-hd"><span class="lbl">PREDICTED EFFECT + YOUR 95% CI</span>' +
                '<span class="dim" style="font-size:10px" id="d-units">points</span></div>' +
              '<div class="ci-row">' +
                '<input type="number" id="d-pred" step="0.1" placeholder="effect">' +
                '<input type="number" id="d-cilo" step="0.1" placeholder="CI low">' +
                '<input type="number" id="d-cihi" step="0.1" placeholder="CI high">' +
              '</div>' +
            '</div>' +

            '<div class="d-fix">' +
              '<button class="btn primary wide big" id="d-launch">LAUNCH EXPERIMENT</button>' +
              '<div class="note" id="d-why" style="margin-top:4px"></div>' +
              '<div class="d-msg" id="d-msg"></div>' +
            '</div>' +
          '</div>' +
        '</section>' +

        '<div class="a-plots">' +
          '<section class="panel">' +
            '<div class="panel-hd"><span>SCALING &mdash; effect vs model size</span>' +
              '<span class="dim">log x · 95% CI bars</span></div>' +
            '<div class="panel-bd nopad plot-host">' +
              '<canvas id="pl-scaling"></canvas>' +
              '<div class="plot-empty" id="pl-scaling-empty">no measurements yet<br>' +
                'launch something and the curve starts here</div>' +
              '<div class="plot-err hidden" id="pl-scaling-err"></div>' +
            '</div>' +
          '</section>' +
          '<div class="plots-side">' +
            '<section class="panel">' +
              '<div class="panel-hd"><span>FOREST</span><span class="dim">effect &plusmn; 95% CI</span></div>' +
              '<div class="panel-bd nopad plot-host">' +
                '<canvas id="pl-forest"></canvas>' +
                '<div class="plot-empty" id="pl-forest-empty">rows appear as runs finish</div>' +
                '<div class="plot-err hidden" id="pl-forest-err"></div>' +
              '</div>' +
            '</section>' +
            '<section class="panel">' +
              '<div class="panel-hd"><span>RUNNING JOBS</span><span class="dim" id="j-count">0</span></div>' +
              '<div class="panel-bd" id="j-body"></div>' +
            '</section>' +
          '</div>' +
        '</div>' +

        '<div class="a-bottom">' +
          '<section class="panel">' +
            '<div class="panel-hd"><span>RESULTS</span><span class="dim" id="r-count">0</span></div>' +
            '<div class="panel-bd nopad" style="overflow:auto">' +
              '<table class="tbl" id="r-table"><thead><tr>' +
                '<th class="sortable" data-sk="fin">FIN</th>' +
                '<th class="sortable" data-sk="iv">INTERVENTIONS</th>' +
                '<th class="sortable" data-sk="scale">SCALE</th>' +
                '<th class="sortable" data-sk="steps">STEPS</th>' +
                '<th class="r sortable" data-sk="seeds">SEEDS</th>' +
                '<th class="r sortable" data-sk="cost">GPU-H</th>' +
                '<th class="r sortable" data-sk="pred">PRED</th>' +
                '<th class="r sortable" data-sk="obs">OBSERVED</th>' +
                '<th class="r">95% CI</th>' +
                '<th class="r sortable notrans" data-sk="sigma">&sigma;</th>' +
                '<th>STATUS</th>' +
              '</tr></thead><tbody id="r-body"></tbody></table>' +
            '</div>' +
          '</section>' +
        '</div>' +

        '<section class="panel a-feed">' +
          '<div class="panel-hd"><span>TEAM</span>' +
            '<span class="dim">YUKI · RASHEED · ANA · HALBERD</span></div>' +
          '<div class="panel-bd feed-bd" id="feed-body"></div>' +
        '</section>' +

      '</div>' +
      '<div class="toasts" id="l-toasts"></div>' +
    '</div>';

  /* ---------- lab wiring ---------- */
  function wireLab() {
    qa('#l-speed .seg-b').forEach(function (b) {
      on(b, 'click', function () { setSpeed(parseInt(b.getAttribute('data-speed'), 10)); });
    });
    on($['l-pause'], 'click', togglePause);
    on($['l-step'], 'click', function () { doStep(); });
    on(id('l-adv1'), 'click', function () { advanceHours(1); });
    on(id('l-adv4'), 'click', function () { advanceHours(4); });
    on(id('l-next'), 'click', function () { advanceToNextResult(); });
    on(id('l-readout'), 'click', function () { goReadout(false); });

    on(id('d-clear'), 'click', function () { D.sel = {}; renderIvList(); refreshDesign(); });
    on($['d-seeds'], 'input', function () {
      var v = parseInt($['d-seeds'].value, 10);
      D.seeds = num(v) && v > 0 ? Math.min(64, v) : 1;
      syncSeedBtns(); refreshDesign();
    });
    ['d-hyp', 'd-pred', 'd-cilo', 'd-cihi'].forEach(function (k) {
      on($[k], 'input', function () { refreshDesign(); });
    });
    on($['d-launch'], 'click', doLaunch);

    qa('#r-table th.sortable').forEach(function (th) {
      on(th, 'click', function () {
        var k = th.getAttribute('data-sk');
        if (sortKey === k) sortDir = -sortDir; else { sortKey = k; sortDir = -1; }
        lastTableSig = '';
        renderResults();
      });
    });
  }

  function buildDesignerControls() {
    /* scale segmented control */
    $['d-scale'].innerHTML = (world.scales || []).map(function (s) {
      return '<button class="seg-b' + (s.id === D.scale ? ' is-on' : '') + '" data-scale="' + esc(s.id) + '">' +
        esc(s.label || s.id) + '<span class="sub">' + esc(intf(s.computeHours)) + ' GPU-h</span></button>';
    }).join('');
    qa('#d-scale .seg-b').forEach(function (b) {
      on(b, 'click', function () {
        D.scale = b.getAttribute('data-scale');
        qa('#d-scale .seg-b').forEach(function (x) {
          x.classList.toggle('is-on', x.getAttribute('data-scale') === D.scale);
        });
        refreshDesign();
      });
    });

    $['d-steps'].innerHTML = (world.stepOptions || []).map(function (s) {
      return '<button class="seg-b' + (s.id === D.steps ? ' is-on' : '') + '" data-steps="' + esc(s.id) +
        '" title="compute and wall-clock multiplier ×' + esc(String(s.mult)) + '">' +
        esc(s.label || s.id) + '</button>';
    }).join('');
    qa('#d-steps .seg-b').forEach(function (b) {
      on(b, 'click', function () {
        D.steps = b.getAttribute('data-steps');
        qa('#d-steps .seg-b').forEach(function (x) {
          x.classList.toggle('is-on', x.getAttribute('data-steps') === D.steps);
        });
        refreshDesign();
      });
    });

    $['d-seedbtns'].innerHTML = [1, 2, 3, 5, 8].map(function (n) {
      return '<button class="btn tiny" data-seed="' + n + '">' + n + '</button>';
    }).join('');
    qa('#d-seedbtns [data-seed]').forEach(function (b) {
      on(b, 'click', function () {
        D.seeds = parseInt(b.getAttribute('data-seed'), 10);
        $['d-seeds'].value = String(D.seeds);
        syncSeedBtns(); refreshDesign();
      });
    });
    setText(id('d-units'), metricUnits());
    syncSeedBtns();
    renderIvList();
  }

  function syncSeedBtns() {
    qa('#d-seedbtns [data-seed]').forEach(function (b) {
      b.classList.toggle('is-on', parseInt(b.getAttribute('data-seed'), 10) === D.seeds);
    });
  }

  function renderIvList() {
    var counts = {};
    results().forEach(function (r) {
      (r.interventions || []).forEach(function (iid) {
        counts[iid] = counts[iid] || { n: 0, ok: 0 };
        counts[iid].n++;
        if (r.status !== 'failed') counts[iid].ok++;
      });
    });
    $['d-ivs'].innerHTML = world.interventions.map(function (iv) {
      var c = counts[iv.id];
      var evTxt = c ? (c.ok + ' run' + (c.ok === 1 ? '' : 's')) : 'untested';
      return '<div class="iv-row' + (D.sel[iv.id] ? ' is-on' : '') + '" data-iv="' + esc(iv.id) + '" ' +
        'title="' + esc(iv.desc || '') + '">' +
        '<span class="iv-box">&#10003;</span>' +
        '<span class="nm">' + esc(iv.name || iv.id) + '</span>' +
        '<span class="tag fam-' + esc(String(iv.family || 'other').toLowerCase()) + '">' +
          esc(famAbbr(iv.family)) + '</span>' +
        '<span class="ev' + (c && c.ok ? ' has' : '') + '">' + esc(evTxt) + '</span>' +
        '</div>';
    }).join('');
    qa('#d-ivs .iv-row').forEach(function (row) {
      on(row, 'click', function () {
        var iid = row.getAttribute('data-iv');
        if (D.sel[iid]) delete D.sel[iid]; else D.sel[iid] = true;
        row.classList.toggle('is-on', !!D.sel[iid]);
        refreshDesign();
      });
    });
    updateSelCount();
  }
  function updateSelCount() {
    var n = selectedIds().length;
    setText(id('d-selcount'), n + ' selected');
  }
  function selectedIds() {
    return (world.interventions || []).filter(function (iv) { return D.sel[iv.id]; })
      .map(function (iv) { return iv.id; });
  }

  /* ---------- THE pricing preview: sigma before you commit ---------- */
  function callDesign(seeds) {
    var ids = selectedIds();
    if (!ids.length) return { ok: false, error: 'Pick at least one intervention' };
    var out;
    try {
      out = window.Lab.design({
        interventions: ids, scale: D.scale, steps: D.steps,
        seeds: num(seeds) ? seeds : D.seeds
      });
    } catch (e) { return { ok: false, error: 'Lab.design threw: ' + (e && e.message ? e.message : e) }; }
    if (!out || typeof out !== 'object') return { ok: false, error: 'Lab.design returned nothing' };
    return out;
  }

  function refreshDesign() {
    updateSelCount();
    var pv = callDesign(D.seeds);
    lastPreview = pv;
    renderPreview(pv);
    validateForm(pv);
  }

  function renderPreview(pv) {
    var host = $['d-prev'];
    var units = metricUnits();

    if (!pv || pv.ok === false) {
      host.innerHTML = '<div class="prev is-bad">' +
        '<div class="lbl">PRICING PREVIEW</div>' +
        '<div style="margin-top:5px;font-size:12px;color:#ffc4bf">' +
          esc((pv && pv.error) || 'Select interventions to price an experiment.') + '</div>' +
        '</div>';
      return;
    }

    var sigma = num(pv.sigma) ? pv.sigma : null;
    var half = num(pv.ci95) ? pv.ci95 : (num(sigma) ? 1.96 * sigma : null);
    var mde = num(sigma) ? 2.8 * sigma : null;   /* 80% power, alpha .05, two-sided */
    var pred = parseFloat($['d-pred'].value);
    var hasPred = num(pred);
    var st = state || {};
    var remaining = num(st.computeRemaining) ? st.computeRemaining : rules().computeBudget;
    var overBudget = num(pv.cost) && pv.cost > remaining;
    var etaTxt = pv.etaT || ((num(pv.etaDay) && num(pv.etaHour)) ? stamp(pv.etaDay, pv.etaHour) : '—');
    var pastDeadline = (pv.beforeDeadline === false) || (num(pv.etaDay) && pv.etaDay > rules().days);
    var fp = num(pv.failureProb) ? pv.failureProb : null;
    var etaSub = pastDeadline ? 'past deadline'
      : (num(fp) ? Math.round(fp * 100) + '% fail risk' : 'if it survives');

    var html = '<div class="prev' + (overBudget || pastDeadline ? ' is-bad' : '') + '">' +
      '<div class="prev-grid">' +
        '<div><span class="lbl">COST</span><div class="v num' + (overBudget ? ' neg' : '') + '">' +
          esc(intf(pv.cost)) + '<small>' + esc(intf(remaining)) + ' left</small></div></div>' +
        '<div><span class="lbl">WALL CLOCK</span><div class="v num">' + esc(f1(pv.wallHours)) +
          ' h<small>seeds cost no time</small></div></div>' +
        '<div><span class="lbl">RESULT AT</span><div class="v num' + (pastDeadline ? ' neg' : '') + '">' +
          esc(etaTxt) + '<small' + (num(fp) && fp >= 0.2 ? ' class="amber"' : '') + '>' +
          esc(etaSub) + '</small></div></div>' +
      '</div>' +

      '<div class="sigma-hero">' +
        '<div class="sigma-line"><span class="sigma-val num">&sigma;&nbsp;' + esc(f2(sigma)) +
          '<span class="u"> ' + esc(unitAbbr(units)) + '</span></span>' +
          '<span class="sigma-cap">standard error<br>of the measurement</span></div>' +
        '<div class="mde">Resolves only effects bigger than <b>~' + esc(f1(mde)) + ' ' +
          esc(units) + '</b> <span class="dim">— results come back as observed &plusmn; ' +
          esc(f2(half)) + '.</span></div>' +
      '</div>';

    /* resolution bar: the noise floor vs the effect you say you expect */
    var axis = Math.max(num(mde) ? mde : 1, hasPred ? Math.abs(pred) : 0) * 1.18;
    if (!(axis > 0)) axis = 1;
    var noisePct = clamp(((num(mde) ? mde : 0) / axis) * 100, 0, 100);
    var predPct = hasPred ? clamp((Math.abs(pred) / axis) * 100, 0, 99.4) : null;
    html += '<div class="resbar">' +
      '<div class="noise" style="width:' + noisePct.toFixed(1) + '%"></div>' +
      (predPct !== null ? '<div class="pred" style="left:' + predPct.toFixed(1) + '%"></div>' : '') +
      '</div>' +
      '<div class="resbar-cap"><span class="neg">▨ noise floor ~' + esc(f1(mde)) + '</span>' +
      (hasPred ? ' · <span class="cyan">│ your prediction ' + esc(f1(Math.abs(pred))) + '</span>' : '') +
      ' · axis 0&ndash;' + esc(f1(axis)) + ' ' + esc(units) + '</div>';

    /* the verdict — the moment the researcher realises what they are buying */
    if (!hasPred) {
      html += '<div class="verdict"><b>state a prediction</b>' +
        'Type the effect you expect below; this box then tells you whether the experiment ' +
        'can resolve it at all.</div>';
    } else if (Math.abs(pred) >= mde) {
      html += '<div class="verdict good"><b>resolvable</b>' +
        'A real ' + esc(f1(Math.abs(pred))) + '-' + esc(unitAbbr(units)) +
        ' effect should come back with a CI clear of zero. Money well spent.</div>';
    } else if (Math.abs(pred) >= half) {
      html += '<div class="verdict mid"><b>marginal</b>' +
        'A ' + esc(f1(Math.abs(pred))) + '-' + esc(unitAbbr(units)) + ' effect sits inside the ' +
        'noise band — expect a CI that straddles zero and settles nothing.</div>';
    } else {
      var needSeeds = Math.ceil(D.seeds * Math.pow(mde / Math.max(Math.abs(pred), 1e-6), 2));
      var perSeed = num(pv.cost) && D.seeds ? pv.cost / D.seeds : null;
      html += '<div class="verdict bad"><b>too noisy to answer your question</b>' +
        '&sigma; ' + esc(f2(sigma)) + ' swamps your ' + esc(f1(Math.abs(pred))) + '-' +
        esc(unitAbbr(units)) + ' effect: ' + esc(intf(pv.cost)) + ' GPU-h to learn nothing.' +
        (num(perSeed) && needSeeds < 1e5
          ? ' Needs <b>~' + esc(intf(needSeeds)) + ' seeds</b> (&asymp;' +
            esc(intf(needSeeds * perSeed)) + ' GPU-h) here.'
          : '') +
        '</div>';
    }

    /* seed ladder — sigma is bought with compute, and it costs quadratically */
    var lad = [1, 2, 4, 8].map(function (n) {
      var p = callDesign(n);
      var okp = p && p.ok !== false;
      return '<button class="lad-b' + (n === D.seeds ? ' is-on' : '') + '" data-lseed="' + n + '">' +
        '<span class="k">' + n + ' SEED' + (n === 1 ? '' : 'S') + '</span>' +
        '<span class="s">&sigma; ' + esc(okp ? f2(p.sigma) : '—') + '</span>' +
        '<span class="c">' + esc(okp ? intf(p.cost) + ' h' : '—') + '</span></button>';
    }).join('');
    html += '<div class="ladder">' + lad + '</div>';

    if (overBudget) {
      html += '<div class="verdict bad" style="margin-top:6px"><b>over budget</b>' +
        'That costs ' + esc(intf(pv.cost)) + ' GPU-h and you have ' + esc(intf(remaining)) + '.</div>';
    }
    /* whatever else Lab wants to say about this design, verbatim */
    if (pv.warning) {
      html += '<div class="verdict mid" style="margin-top:6px"><b>heads up</b>' + esc(pv.warning) + '</div>';
    }
    if (pv.wouldReject) {
      html += '<div class="verdict bad" style="margin-top:6px"><b>this launch will be rejected</b>' +
        esc(pv.rejectReason || pv.error || 'Lab will not accept this design as it stands.') + '</div>';
    }
    html += '</div>';

    host.innerHTML = html;
    qa('#d-prev [data-lseed]').forEach(function (b) {
      on(b, 'click', function () {
        D.seeds = parseInt(b.getAttribute('data-lseed'), 10);
        $['d-seeds'].value = String(D.seeds);
        syncSeedBtns(); refreshDesign();
      });
    });
  }

  /* ---------- inline validation ---------- */
  function formValues() {
    return {
      ids: selectedIds(),
      hypothesis: ($['d-hyp'].value || '').trim(),
      pred: parseFloat($['d-pred'].value),
      lo: parseFloat($['d-cilo'].value),
      hi: parseFloat($['d-cihi'].value)
    };
  }

  function validateForm(pv) {
    var R = rules(), v = formValues(), why = [], warn = null;

    var need = R.minHypothesisChars;
    var hs = $['d-hyp-state'];
    if (v.hypothesis.length >= need) {
      hs.textContent = 'ok · ' + v.hypothesis.length + ' chars'; hs.className = 'lbl ok';
      $['d-hyp'].classList.remove('bad');
    } else {
      hs.textContent = 'required · ' + v.hypothesis.length + '/' + need; hs.className = 'lbl req';
      $['d-hyp'].classList.toggle('bad', v.hypothesis.length > 0);
      why.push('a hypothesis of at least ' + need + ' characters');
    }

    $['d-pred'].classList.toggle('bad', $['d-pred'].value !== '' && !num(v.pred));
    if (!num(v.pred)) why.push('a predicted effect');

    var ciBad = !num(v.lo) || !num(v.hi) || v.lo >= v.hi;
    $['d-cilo'].classList.toggle('bad', ciBad);
    $['d-cihi'].classList.toggle('bad', ciBad);
    if (ciBad) why.push('a 95% CI with low &lt; high');

    if (!v.ids.length) why.push('at least one intervention');

    if (!why.length && num(v.pred) && num(v.lo) && num(v.hi) && (v.pred < v.lo || v.pred > v.hi)) {
      warn = 'Your predicted effect sits outside your own CI. One of the two is wrong.';
    }

    var labErr = (pv && pv.ok === false) ? pv.error : null;
    var ok = !why.length && !labErr;
    $['d-launch'].disabled = !ok;

    var whyEl = $['d-why'];
    if (labErr) { whyEl.innerHTML = '<span class="neg">' + esc(labErr) + '</span>'; }
    else if (why.length) { whyEl.innerHTML = 'Still needed: ' + why.join(', ') + '.'; }
    else if (warn) { whyEl.innerHTML = '<span class="amber">' + esc(warn) + '</span>'; }
    else {
      whyEl.innerHTML = 'Charged at launch · prediction scored at the debrief.';
    }
  }

  function showDesignMsg(text, kind) {
    $['d-msg'].innerHTML = '<div class="msg-' + (kind || 'err') + '">' + esc(text) + '</div>';
  }
  function clearDesignMsg() { $['d-msg'].innerHTML = ''; }

  function doLaunch() {
    var v = formValues();
    if (!v.ids.length) { showDesignMsg('Pick at least one intervention.', 'err'); return; }
    var r;
    try {
      r = window.Lab.launch({
        interventions: v.ids, scale: D.scale, steps: D.steps, seeds: D.seeds,
        hypothesis: v.hypothesis, predictedEffect: v.pred, ciLow: v.lo, ciHigh: v.hi
      });
    } catch (e) {
      showDesignMsg('Lab.launch threw: ' + (e && e.message ? e.message : e), 'err');
      return;
    }
    if (!r || r.ok !== true) {
      showDesignMsg('REJECTED — ' + ((r && r.error) || 'unknown reason'), 'err');
      return;
    }
    var sc = scaleById(D.scale);
    showDesignMsg('Launched: ' + setLabel(v.ids) + ' @ ' + (sc ? sc.label : D.scale) +
      ' · ' + D.seeds + ' seed' + (D.seeds === 1 ? '' : 's') + '.', 'ok');
    toast('Job launched — ' + setLabel(v.ids) + ' @ ' + (sc ? sc.label : D.scale), 'ok');
    /* the hypothesis and prediction belong to that experiment; clear them */
    $['d-hyp'].value = ''; $['d-pred'].value = ''; $['d-cilo'].value = ''; $['d-cihi'].value = '';
    pullState();
    refreshDesign();
  }

  /* ---------- transport ---------- */
  function setSpeed(mult) {
    speed = mult;
    qa('#l-speed .seg-b').forEach(function (b) {
      b.classList.toggle('is-on', parseInt(b.getAttribute('data-speed'), 10) === mult);
    });
    try { window.Lab.setSpeed(mult); } catch (e) {}
  }
  function togglePause() {
    if (!state) return;
    if (running) { try { window.Lab.pause(); } catch (e) {} running = false; }
    else { try { window.Lab.resume(); } catch (e) {} running = true; }
    updateTransport();
    pullState();
  }
  function updateTransport() {
    setText($['l-pause'], running ? 'PAUSE' : 'RESUME');
    $['l-pause'].classList.toggle('warn', !running);
  }
  function doStep() {
    try { window.Lab.step(); } catch (e) { toast('step failed: ' + e.message, 'err'); }
    pullState();
  }
  function canAdvance() {
    return state && !state.finished && !state.readoutSubmitted && !modalStack.length;
  }
  function advanceOnce(hrs) {
    try {
      if (typeof window.Lab.advance === 'function') window.Lab.advance(hrs);
      else { var n = Math.max(1, Math.round(hrs * 4)); for (var i = 0; i < n; i++) window.Lab.step(); }
    } catch (e) { showErrBar('Lab.advance threw: ' + (e && e.message ? e.message : e)); return false; }
    return true;
  }
  /* advance in 15-minute slices so gates, results and the deadline still land */
  function advanceHours(hrs) {
    if (!canAdvance()) return;
    var slices = Math.max(1, Math.round(hrs * 4));
    for (var i = 0; i < slices; i++) {
      if (!canAdvance()) break;
      if (!advanceOnce(0.25)) break;
      pullState();
    }
  }
  function advanceToNextResult() {
    if (!canAdvance()) return;
    if (!((state.running || []).length)) {
      toast('Nothing is running — the clock will not skip you past an empty cluster.', 'info');
      return;
    }
    var n0 = results().length;
    var guard = 0;
    while (canAdvance() && guard++ < 1200) {
      if (!advanceOnce(0.25)) break;
      pullState();
      if (results().length !== n0) break;
    }
  }

  /* ---------- lab lifecycle ---------- */
  function startWeek() {
    if (started) { showScreen('lab'); return; }
    started = true;

    try { window.Lab.init({ world: world, seed: 20260816 }); }
    catch (e) { showErrBar('Lab.init threw: ' + (e && e.message ? e.message : e)); return; }

    bindLab();

    try { window.Team.init({ world: world, lab: window.Lab, onMessage: safe(onTeamMessage) }); }
    catch (e) { showErrBar('Team.init threw: ' + (e && e.message ? e.message : e)); }

    showScreen('lab');
    buildDesignerControls();
    refreshDesign();
    setSpeed(speed);

    setTimeout(function () {
      makePlots();
      pullState();
      syncFeed();
      var g = gateDueAt(1, rules().startHour);
      if (g) {
        gateFired[g.id] = true;
        showGate(g, function () { labStart(); });
      } else {
        labStart();
      }
      startPoll();
    }, 0);
  }

  function labStart() {
    try { window.Lab.start(); running = true; } catch (e) { showErrBar('Lab.start threw: ' + e.message); }
    updateTransport();
    pullState();
  }

  function bindLab() {
    var evs = ['tick', 'result', 'fail', 'deadline', 'budget'];
    evs.forEach(function (name) {
      try {
        window.Lab.on(name, safe(function (a) { onLabEvent(name, a); }));
      } catch (e) {}
    });
  }

  function onLabEvent(name, payload) {
    if (name === 'result' && payload) {
      var lbl = setLabel(payload.interventions || []);
      if (payload.status === 'failed') {
        toast('JOB FAILED — ' + lbl + ' · ' + (payload.failReason || 'infra'), 'err');
      } else {
        toast('RESULT — ' + lbl + ': ' + sf2(payload.observedEffect) + ' ± ' +
          f2(num(payload.sigma) ? 1.96 * payload.sigma : NaN), 'ok');
      }
    } else if (name === 'fail' && payload) {
      toast('JOB FAILED — ' + setLabel(payload.interventions || []) + ' · ' +
        (payload.failReason || 'infra'), 'err');
    } else if (name === 'deadline') {
      onDeadline();
    } else if (name === 'budget') {
      toast('Compute budget exhausted.', 'warn');
    }
    pullState();
  }

  function startPoll() {
    stopPoll();
    pollTimer = window.setInterval(safe(function () {
      if (!S.lab || !S.lab.classList.contains('active')) return;
      pullState();
    }), 300);
  }
  function stopPoll() { if (pollTimer) window.clearInterval(pollTimer); pollTimer = 0; }

  function pullState() {
    var st = null;
    try { st = window.Lab.getState(); } catch (e) { showErrBar('Lab.getState threw: ' + e.message); return; }
    if (!st) return;
    state = st;
    if (typeof st.running === 'boolean') running = st.running;
    renderLab(st);
    try { window.Team.tick(st); } catch (e) { showErrBar('Team.tick threw: ' + e.message); }
    syncFeed();
    checkGates(st);
    if (st.finished && !st.readoutSubmitted) onDeadline();
  }

  function onDeadline() {
    if (deadlineHandled || readoutDone) return;
    deadlineHandled = true;
    try { window.Lab.pause(); } catch (e) {}
    running = false;
    var g = gateById('readout');
    var go = function () { goReadout(true); };
    if (g && !gateFired[g.id]) { gateFired[g.id] = true; showGate(g, go); }
    else go();
  }

  /* ---------- lab rendering ---------- */
  function renderLab(st) {
    var R = rules();
    setText($['l-clock'], st.t || stamp(st.day, st.hour));
    setText($['l-day'], 'DAY ' + (st.day || 1) + ' OF ' + R.days + ' · tick ' + (st.tick || 0));

    var used = num(st.computeUsed) ? st.computeUsed : 0;
    var total = R.computeBudget;
    var p = total ? (used / total) * 100 : 0;
    setText($['l-budget-v'], intf(used) + ' / ' + intf(total));
    var bf = $['l-budget-bar'];
    bf.style.width = clamp(p, 0, 100).toFixed(1) + '%';
    bf.classList.toggle('hot', p >= 70 && p < 92);
    bf.classList.toggle('max', p >= 92);

    var slotsUsed = num(st.slotsUsed) ? st.slotsUsed : ((st.running || []).length);
    setText($['l-slots'], slotsUsed + '/' + R.slots);

    var hl = hoursLeft(st);
    setText($['l-deadline'], num(hl) ? f1(hl) + ' h' : '—');
    setText($['l-nres'], String(results().length));

    var status, scls = '';
    if (st.readoutSubmitted) { status = 'Readout submitted.'; }
    else if (st.finished) { status = 'FRIDAY EVENING — the week is over. Submit the readout.'; scls = 'is-alarm'; }
    else if (num(hl) && hl <= 6) { status = 'Under ' + f1(hl) + ' hours to the readout. Nothing new will finish.'; scls = 'is-alarm'; }
    else if (num(st.computeRemaining) && st.computeRemaining < total * 0.1) {
      status = 'Compute nearly gone — ' + intf(st.computeRemaining) + ' GPU-h left.'; scls = 'is-warn';
    } else if (!running) { status = 'PAUSED — the cluster keeps running; you are the one standing still.'; scls = 'is-warn'; }
    else {
      status = slotsUsed ? slotsUsed + ' job' + (slotsUsed === 1 ? '' : 's') + ' on the cluster · ' +
        (R.slots - slotsUsed) + ' slot' + (R.slots - slotsUsed === 1 ? '' : 's') + ' idle'
        : 'All ' + R.slots + ' slots idle — the allocation is not free.';
      if (!slotsUsed) scls = 'is-warn';
    }
    setText($['l-status'], status);
    $['l-status'].className = 'dim ' + scls;

    updateTransport();
    renderJobs(st);
    renderResults();
    redrawPlots(false);
    renderIvEvidenceCounts();
    refreshDesignIfStale(st);
  }

  /* the preview quotes an ETA, a rejection and a remaining budget — all of which
     move with the clock, so re-price whenever any of them changes */
  var lastDesignSig = '';
  function refreshDesignIfStale(st) {
    var sig = [st.t, st.slotsUsed, Math.round(st.computeUsed || 0),
               (st.running || []).length, !!st.readoutSubmitted].join('|');
    if (sig === lastDesignSig) return;
    lastDesignSig = sig;
    refreshDesign();
  }

  var lastIvSig = '';
  function renderIvEvidenceCounts() {
    var sig = results().length + ':' + selectedIds().join(',');
    if (sig === lastIvSig) return;
    lastIvSig = sig;
    renderIvList();
  }

  function hoursLeft(st) {
    var R = rules();
    if (!st || !num(st.day) || !num(st.hour)) return null;
    var endHour = R.startHour + R.hoursPerDay;
    return (R.days - st.day) * R.hoursPerDay + (endHour - st.hour);
  }

  function renderJobs(st) {
    var jobs = st.running || [];
    setText($['j-count'], jobs.length + '/' + rules().slots);
    if (!jobs.length) {
      $['j-body'].innerHTML = '<div class="empty-note">no jobs running<br>' +
        '<span class="dim">idle slots get reclaimed — Rasheed will notice</span></div>';
      return;
    }
    $['j-body'].innerHTML = jobs.map(function (j) {
      var prog = clamp(num(j.progress) ? j.progress * 100 : 0, 0, 100);
      var sc = scaleById(j.scale), stp = stepsById(j.steps);
      var eta = (j.etaAt && num(j.etaAt.day)) ? stamp(j.etaAt.day, j.etaAt.hour) : '—';
      return '<div class="job" data-job="' + esc(j.id) + '">' +
        '<div class="job-hd"><span class="job-ttl ell">' + esc(setLabel(j.interventions || [])) + '</span>' +
        '<span class="job-meta">' + esc(sc ? sc.label : j.scale) + ' · ' +
          esc(stp ? stp.label : j.steps) + ' · ' + esc(String(j.seeds)) + 'sd</span></div>' +
        '<div class="prog"><div class="prog-fill' + (prog > 70 ? ' late' : '') +
          '" style="width:' + prog.toFixed(1) + '%"></div></div>' +
        '<div class="job-ft">' +
          '<span class="job-eta">' + prog.toFixed(0) + '% · ETA <b>' + esc(eta) + '</b> · ' +
            esc(intf(j.cost)) + ' GPU-h</span>' +
          '<button class="btn-x" data-kill="' + esc(j.id) + '">KILL</button>' +
        '</div></div>';
    }).join('');
    qa('#j-body [data-kill]').forEach(function (b) {
      on(b, 'click', function (ev) {
        ev.stopPropagation();
        confirmKill(b.getAttribute('data-kill'));
      });
    });
  }

  function confirmKill(jobId) {
    var jobs = (state && state.running) || [], j = null;
    for (var i = 0; i < jobs.length; i++) if (jobs[i].id === jobId) j = jobs[i];
    if (!j) return;
    var R = rules();
    var prog = clamp(num(j.progress) ? j.progress : 0, 0, 1);
    var unspent = num(j.cost) ? j.cost * (1 - prog) : 0;
    var refund = unspent * R.killRefund;
    var lost = (num(j.cost) ? j.cost : 0) - refund;

    openModal({
      danger: true,
      title: 'KILL THIS JOB?',
      bodyHtml:
        '<p><b>' + esc(setLabel(j.interventions || [])) + '</b> at ' +
          esc((scaleById(j.scale) || {}).label || j.scale) + ', ' + esc(String(j.seeds)) +
          ' seed(s) — <b class="num">' + esc((prog * 100).toFixed(0)) + '%</b> complete.</p>' +
        '<p>You paid <b class="num">' + esc(intf(j.cost)) + ' GPU-h</b> at launch. Killing it returns ' +
          esc(Math.round(R.killRefund * 100)) + '% of the <i>unspent</i> compute — about <b class="num">' +
          esc(intf(refund)) + ' GPU-h</b>. <span class="neg">You write off ' + esc(intf(lost)) +
          ' GPU-h and get no measurement.</span></p>' +
        (prog > 0.7 ? '<p class="amber">It is more than 70% done. Rasheed will have something to say about that.</p>' : '') +
        '<p class="dim">A killed job is not a free option. Kill it because the question changed, ' +
        'not because you are impatient.</p>',
      okText: 'KILL IT',
      okClass: 'danger',
      cancelText: 'LET IT RUN',
      onOk: function () {
        var r;
        try { r = window.Lab.kill(jobId); } catch (e) { toast('kill failed: ' + e.message, 'err'); return; }
        if (r && r.ok === false) { toast('kill rejected — ' + r.error, 'err'); return; }
        toast('Job killed — ' + intf(refund) + ' GPU-h refunded.', 'warn');
        pullState(); refreshDesign();
      }
    });
  }

  /* ---------- results table ---------- */
  function sortVal(r, k) {
    switch (k) {
      case 'fin': return (r.finishedAt ? r.finishedAt.day * 100 + r.finishedAt.hour : 0);
      case 'iv': return setLabel(r.interventions || []);
      case 'scale': { var s = scaleById(r.scale); return s ? s.params : 0; }
      case 'steps': { var t = stepsById(r.steps); return t ? t.mult : 0; }
      case 'seeds': return num(r.seeds) ? r.seeds : 0;
      case 'cost': return num(r.cost) ? r.cost : 0;
      case 'pred': return num(r.predictedEffect) ? r.predictedEffect : -1e9;
      case 'obs': return num(r.observedEffect) ? r.observedEffect : -1e9;
      case 'sigma': return num(r.sigma) ? r.sigma : 1e9;
      default: return 0;
    }
  }

  function renderResults() {
    var rs = results().slice();
    var sig = rs.length + '|' + sortKey + '|' + sortDir;
    if (sig === lastTableSig) return;
    lastTableSig = sig;

    setText($['r-count'], rs.length + ' · ' +
      rs.filter(function (r) { return r.status === 'failed'; }).length + ' failed');

    qa('#r-table th.sortable').forEach(function (th) {
      th.classList.toggle('is-sort', th.getAttribute('data-sk') === sortKey);
    });

    rs.sort(function (a, b) {
      var va = sortVal(a, sortKey), vb = sortVal(b, sortKey);
      if (typeof va === 'string') return sortDir * va.localeCompare(vb);
      return sortDir * (va - vb);
    });

    if (!rs.length) {
      $['r-body'].innerHTML = '<tr><td colspan="11"><div class="empty-note">' +
        'no results yet — every row here is a noisy sample of a truth you cannot see</div></td></tr>';
      return;
    }

    $['r-body'].innerHTML = rs.map(function (r) {
      var sc = scaleById(r.scale), stp = stepsById(r.steps);
      var fin = r.finishedAt && num(r.finishedAt.day) ? stamp(r.finishedAt.day, r.finishedAt.hour) : '—';
      if (r.status === 'failed') {
        return '<tr class="is-failed">' +
          '<td class="num dim">' + esc(fin) + '</td>' +
          '<td class="wrapcell" title="' + esc(setLabel(r.interventions || [])) + '">' +
            esc(setLabel(r.interventions || [])) + '</td>' +
          '<td>' + esc(sc ? sc.label : r.scale) + '</td>' +
          '<td class="dim">' + esc(stp ? stp.label : r.steps) + '</td>' +
          '<td class="r num">' + esc(String(r.seeds)) + '</td>' +
          '<td class="r num">' + esc(intf(r.cost)) + '</td>' +
          '<td class="r num dim">' + esc(sf2(r.predictedEffect)) + '</td>' +
          '<td class="r reason" colspan="3">' + esc(r.failReason || 'failed') + '</td>' +
          '<td><span class="pill fail">FAILED</span></td></tr>';
      }
      var lo = num(r.ciLow95) ? r.ciLow95 : null, hi = num(r.ciHigh95) ? r.ciHigh95 : null;
      var crossesZero = num(lo) && num(hi) && lo <= 0 && hi >= 0;
      var miss = (num(r.predictedEffect) && num(r.observedEffect) && num(r.sigma) && r.sigma > 0)
        ? Math.abs(r.observedEffect - r.predictedEffect) / r.sigma : null;
      return '<tr>' +
        '<td class="num dim">' + esc(fin) + '</td>' +
        '<td class="wrapcell" title="' + esc(setLabel(r.interventions || [])) + '">' +
          esc(setLabel(r.interventions || [])) + '</td>' +
        '<td><b>' + esc(sc ? sc.label : r.scale) + '</b></td>' +
        '<td class="dim">' + esc(stp ? stp.label : r.steps) + '</td>' +
        '<td class="r num">' + esc(String(r.seeds)) + '</td>' +
        '<td class="r num dim">' + esc(intf(r.cost)) + '</td>' +
        '<td class="r num dim" title="' + (num(miss) ? esc(f1(miss)) + 'σ from observed' : '') + '">' +
          esc(sf2(r.predictedEffect)) + (num(miss) && miss > 2 ? ' <span class="amber">!</span>' : '') + '</td>' +
        '<td class="r num ' + cls(r.observedEffect) + '"><b>' + esc(sf2(r.observedEffect)) + '</b></td>' +
        '<td class="r num dim">[' + esc(f2(lo)) + ', ' + esc(f2(hi)) + ']</td>' +
        '<td class="r num dim">' + esc(f2(r.sigma)) + '</td>' +
        '<td>' + (crossesZero
          ? '<span class="pill zero" title="the CI includes zero — this is not evidence of an effect">CI ∋ 0</span>'
          : '<span class="pill ok">CLEAR</span>') + '</td></tr>';
    }).join('');
  }

  /* ---------- plots ---------- */
  function makePlots() {
    try { plotScaling = window.Plots.create($['pl-scaling'], { theme: 'dark' }); }
    catch (e) { plotErr('pl-scaling-err', e); }
    try { plotForest = window.Plots.create($['pl-forest'], { theme: 'dark' }); }
    catch (e) { plotErr('pl-forest-err', e); }
  }
  function plotErr(elId, e) {
    var el = id(elId);
    if (!el) return;
    el.classList.remove('hidden');
    el.textContent = 'Plot failed: ' + (e && e.message ? e.message : e);
  }

  function buildSeries(onlySingletons) {
    var map = {};
    okResults().forEach(function (r) {
      var ids = r.interventions || [];
      if (!ids.length) return;
      if (onlySingletons && ids.length !== 1) return;
      var sc = scaleById(r.scale);
      if (!sc || !num(sc.params)) return;
      var key = setSig(ids);
      if (!map[key]) map[key] = { id: key, ids: ids.slice(), label: setLabel(ids), pts: {} };
      var pk = String(sc.params);
      var p = map[key].pts[pk] || (map[key].pts[pk] = { params: sc.params, wsum: 0, w: 0, n: 0 });
      var sg = (num(r.sigma) && r.sigma > 0) ? r.sigma : 1;
      var wt = 1 / (sg * sg);
      p.wsum += (num(r.observedEffect) ? r.observedEffect : 0) * wt;
      p.w += wt; p.n++;
    });
    return Object.keys(map).map(function (k) {
      var s = map[k];
      var points = Object.keys(s.pts).map(function (pk) { return s.pts[pk]; })
        .sort(function (a, b) { return a.params - b.params; })
        .map(function (p) {
          var eff = p.wsum / p.w, se = Math.sqrt(1 / p.w);
          return { params: p.params, effect: eff, ciLow: eff - 1.96 * se, ciHigh: eff + 1.96 * se, n: p.n };
        });
      return { id: s.id, ids: s.ids, label: s.label, color: colorFor(s.ids), points: points };
    });
  }

  function buildForestRows() {
    return okResults().map(function (r) {
      var sc = scaleById(r.scale);
      return {
        label: setLabelShort(r.interventions || [], 20) + ' @' + (sc ? sc.label : r.scale) +
               ' ×' + (r.seeds || 1),
        effect: num(r.observedEffect) ? r.observedEffect : 0,
        ciLow: num(r.ciLow95) ? r.ciLow95 : 0,
        ciHigh: num(r.ciHigh95) ? r.ciHigh95 : 0,
        n: r.seeds || 1
      };
    }).sort(function (a, b) { return b.effect - a.effect; });
  }

  function redrawPlots(force) {
    var rs = okResults();
    var sig = rs.length + ':' + results().length;
    if (!force && sig === lastPlotSig) return;
    lastPlotSig = sig;

    var series = buildSeries(false);
    var rows = buildForestRows();
    var runScale = (world.scenario && world.scenario.runScale) || 7e10;

    var e1 = id('pl-scaling-empty'), e2 = id('pl-forest-empty');
    if (e1) e1.classList.toggle('hidden', series.length > 0);
    if (e2) e2.classList.toggle('hidden', rows.length > 0);

    if (plotScaling) {
      try {
        if (plotScaling.resize) plotScaling.resize();
        plotScaling.scaling({ series: series, runScale: runScale, metric: metricName() });
        id('pl-scaling-err').classList.add('hidden');
      } catch (e) { plotErr('pl-scaling-err', e); }
    }
    if (plotForest) {
      try {
        if (plotForest.resize) plotForest.resize();
        plotForest.forest({ rows: rows });
        id('pl-forest-err').classList.add('hidden');
      } catch (e) { plotErr('pl-forest-err', e); }
    }
  }

  /* ---------- team feed ---------- */
  function onTeamMessage(msg) {
    if (!syncFeed() && msg) pushFeed(msg);
  }
  function syncFeed() {
    var f;
    try { f = window.Team.getFeed(); } catch (e) { return false; }
    if (!Array.isArray(f)) return false;
    if (f.length < feedMsgs.length) return false;
    for (var i = feedMsgs.length; i < f.length; i++) pushFeed(f[i]);
    return true;
  }
  function pushFeed(msg) {
    if (!msg) return;
    feedMsgs.push(msg);
    var body = $['feed-body'];
    if (!body) return;
    var stick = body.scrollTop + body.clientHeight >= body.scrollHeight - 50;
    var from = String(msg.from || 'SYS').toUpperCase();
    var el = document.createElement('div');
    el.className = 'msg from-' + esc(from) + ' tone-' + esc(msg.tone || 'neutral');
    el.innerHTML =
      '<div class="msg-hd"><span class="msg-who ell">' + esc(msg.name || ROLE_NAME[from] || from) +
        ' <span class="msg-role">· ' + esc(ROLE_NAME[from] || from) + '</span></span>' +
        '<span class="msg-tm num">' + esc(msg.t || stamp(msg.day, msg.hour)) + '</span></div>' +
      '<div class="msg-tx">' + esc(msg.text || '') + '</div>';
    body.appendChild(el);
    if (stick) body.scrollTop = body.scrollHeight;
  }

  /* ---------- toasts ---------- */
  var lastToast = '';
  function toast(text, kind) {
    if (!toastHost) return;
    if (text === lastToast && toastHost.lastChild) return;
    lastToast = text;
    var t = document.createElement('div');
    t.className = 'toast ' + (kind || 'info');
    t.textContent = text;
    toastHost.appendChild(t);
    while (toastHost.children.length > 3) toastHost.removeChild(toastHost.firstChild);
    setTimeout(function () {
      t.style.transition = 'opacity .3s'; t.style.opacity = '0';
      setTimeout(function () {
        if (t.parentNode) t.parentNode.removeChild(t);
        if (lastToast === text) lastToast = '';
      }, 320);
    }, 3600);
  }

  /* ================================================================== */
  /* SCREEN 3 — GATE + CONFIRM MODALS                                   */
  /* ================================================================== */
  function gateById(gid) {
    for (var i = 0; i < GATES.length; i++) if (GATES[i].id === gid) return GATES[i];
    return null;
  }
  function gateDueAt(day, hour) {
    for (var i = 0; i < GATES.length; i++) {
      var g = GATES[i];
      if (gateFired[g.id]) continue;
      if (g.id === 'readout') continue;   /* the readout gate is fired by onDeadline/goReadout */
      if (day > g.day || (day === g.day && hour >= g.hour)) return g;
    }
    return null;
  }
  function checkGates(st) {
    if (!num(st.day) || !num(st.hour)) return;
    if (st.readoutSubmitted || st.finished) return;
    var g = gateDueAt(st.day, st.hour);
    if (!g) return;
    gateFired[g.id] = true;
    showGate(g);
  }

  function showGate(g, onContinue) {
    var wasRunning = running;
    try { window.Lab.pause(); } catch (e) {}
    running = false;
    updateTransport();

    var items = GATE_CHECKLIST[g.id] || [];
    var st = state || {};
    var body =
      '<div class="gate-kicker">' + esc(stamp(g.day, g.hour)) + ' · team gate</div>' +
      '<p class="gate-prompt">' + esc(g.prompt || '') + '</p>' +
      (items.length
        ? '<div class="lbl" style="margin-bottom:5px">INCLUDE</div><ul class="gate-list">' +
          items.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>'
        : '') +
      '<div class="dim" style="margin-top:12px;font-size:11.5px">Where you stand: ' +
        '<b class="num">' + esc(intf(st.computeUsed || 0)) + '</b> GPU-h spent · ' +
        '<b class="num">' + esc(String(results().length)) + '</b> results · ' +
        '<b class="num">' + esc(String((st.running || []).length)) + '</b> running.</div>' +
      '<div style="margin-top:14px"><span class="gate-paused">● clock paused</span> ' +
      '<span class="gate-clock">Go and write it in chat. The cluster waits.</span></div>';

    pushFeed({ from: 'SYS', name: 'Gate', t: stamp(g.day, g.hour),
               text: (g.title || 'Gate') + ' — ' + (g.prompt || ''), tone: 'neutral' });

    openModal({
      gate: true,
      title: (g.title || 'TEAM GATE').toUpperCase(),
      bodyHtml: body,
      okText: "I'VE POSTED IT — CONTINUE",
      okClass: 'primary',
      cancelText: null,
      dismissable: false,
      onOk: function () {
        if (onContinue) { onContinue(); return; }
        if (wasRunning) { try { window.Lab.resume(); running = true; } catch (e) {} }
        updateTransport();
        pullState();
      }
    });
  }

  function openModal(opt) {
    var layer = id('modal-layer');
    var bg = q('.modal-bg', layer);
    var m = document.createElement('div');
    m.className = 'modal' + (opt.gate ? ' gate' : '') + (opt.danger ? ' danger' : '');
    m.innerHTML =
      '<div class="modal-hd"><h3>' + esc(opt.title || '') + '</h3>' +
        (opt.dismissable === false ? '' : '<button class="btn ghost" data-x>ESC</button>') +
      '</div>' +
      '<div class="modal-bd">' + (opt.bodyHtml || '') + '</div>' +
      '<div class="modal-ft">' +
        (opt.cancelText ? '<button class="btn ghost" data-cancel>' + esc(opt.cancelText) + '</button>' : '') +
        '<button class="btn ' + (opt.okClass || 'primary') + ' big" data-ok>' + esc(opt.okText || 'OK') + '</button>' +
      '</div>';
    bg.innerHTML = '';
    bg.appendChild(m);
    layer.classList.add('active');
    modalStack.push(opt);

    var close = function () {
      modalStack.pop();
      layer.classList.remove('active');
      bg.innerHTML = '';
      document.removeEventListener('keydown', keyh, true);
    };
    var okBtn = q('[data-ok]', m);
    on(okBtn, 'click', function () { close(); if (opt.onOk) safe(opt.onOk)(); });
    var cancelBtn = q('[data-cancel]', m);
    if (cancelBtn) on(cancelBtn, 'click', function () { close(); if (opt.onCancel) safe(opt.onCancel)(); });
    var xBtn = q('[data-x]', m);
    if (xBtn) on(xBtn, 'click', function () { close(); if (opt.onCancel) safe(opt.onCancel)(); });

    function keyh(ev) {
      if (ev.key === 'Escape' && opt.dismissable !== false) {
        ev.preventDefault(); ev.stopPropagation(); close(); if (opt.onCancel) safe(opt.onCancel)();
      } else if (ev.key === 'Enter' && !(ev.target && /TEXTAREA/i.test(ev.target.tagName))) {
        ev.preventDefault(); ev.stopPropagation(); close(); if (opt.onOk) safe(opt.onOk)();
      }
    }
    document.addEventListener('keydown', keyh, true);
    setTimeout(function () { try { okBtn.focus(); } catch (e) {} }, 30);
  }

  /* ================================================================== */
  /* SCREEN 4 — READOUT                                                 */
  /* ================================================================== */
  var READOUT_HTML =
    '<div class="screen center-screen" id="scr-readout">' +
      '<div class="scrollwrap"><div class="sheet">' +
        '<div class="brand"><h1>FRIDAY READOUT</h1>' +
          '<span class="sub" id="ro-sub">the recipe locks after this</span></div>' +
        '<div class="rule"></div>' +
        '<div class="ro-grid">' +
          '<div>' +
            '<div class="blk"><div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:9px">' +
              '<h3 style="margin:0">Recommend for the run</h3>' +
              '<div class="cap" id="ro-cap"><span class="n num" id="ro-n">0</span>' +
                '<span class="lbl">of <span id="ro-max">4</span> allowed</span></div>' +
            '</div>' +
            '<div class="note" style="margin-bottom:9px" id="ro-caphint"></div>' +
            '<div class="ro-cards" id="ro-cards"></div>' +
            '</div>' +
          '</div>' +
          '<div>' +
            '<div class="blk"><h3>Confidence</h3>' +
              '<div class="conf-row">' +
                '<input type="range" id="ro-conf" min="0" max="100" step="5" value="60">' +
                '<div class="conf-val num" id="ro-confv">60%</div>' +
              '</div>' +
              '<div class="note" id="ro-confnote" style="margin-top:6px"></div>' +
            '</div>' +
            '<div class="blk"><h3>Rationale</h3>' +
              '<textarea id="ro-rat" maxlength="2000" placeholder="What did you measure, at what scale, with what uncertainty? Why do you believe it holds at the run scale? What are you deliberately leaving out, and why?"></textarea>' +
              '<div class="note" id="ro-ratstate" style="margin-top:5px"></div>' +
            '</div>' +
            '<div class="blk"><h3>Before you submit</h3>' +
              '<div id="ro-warn"></div></div>' +
            '<button class="btn primary wide big" id="ro-submit" style="margin-top:12px">SUBMIT THE READOUT</button>' +
            '<div class="note" style="margin-top:6px">Once submitted the week is over and the truth is revealed. There is no going back.</div>' +
          '</div>' +
        '</div>' +
        '<div class="foot-row">' +
          '<button class="btn ghost" id="ro-back">&larr; BACK TO THE LAB</button>' +
          '<div class="note" id="ro-note"></div>' +
        '</div>' +
      '</div></div>' +
    '</div>';

  function wireReadout() {
    on(id('ro-conf'), 'input', function () {
      RO.conf = parseInt(id('ro-conf').value, 10) || 0;
      renderReadoutSide();
    });
    on(id('ro-rat'), 'input', renderReadoutSide);
    on(id('ro-submit'), 'click', trySubmitReadout);
    on(id('ro-back'), 'click', function () {
      if (state && state.finished) {
        toast('The week is over — the lab is closed.', 'warn');
        return;
      }
      showScreen('lab');
      redrawPlots(true);
    });
  }

  function goReadout(forced) {
    if (readoutDone) { showScreen('debrief'); return; }
    try { window.Lab.pause(); } catch (e) {}
    running = false;
    renderReadout();
    showScreen('readout');
    if (forced) toast('Friday 16:00 — the readout is due.', 'warn');
  }

  /* pooled singleton estimate at the largest scale where singleton runs exist */
  function estimateFor(iid) {
    var solo = okResults().filter(function (r) {
      return (r.interventions || []).length === 1 && r.interventions[0] === iid;
    });
    var any = results().filter(function (r) { return (r.interventions || []).indexOf(iid) >= 0; });
    var ok = any.filter(function (r) { return r.status !== 'failed'; });
    var out = { tested: any.length > 0, nRuns: any.length, nOk: ok.length,
                soloN: solo.length, est: null, se: null, scaleLabel: null, scales: [] };
    var seen = {};
    ok.forEach(function (r) {
      var sc = scaleById(r.scale);
      if (sc && !seen[sc.id]) { seen[sc.id] = true; out.scales.push(sc); }
    });
    out.scales.sort(function (a, b) { return a.params - b.params; });
    if (!solo.length) return out;
    var best = null;
    solo.forEach(function (r) {
      var sc = scaleById(r.scale);
      if (!sc) return;
      if (!best || sc.params > best.params) best = sc;
    });
    if (!best) return out;
    var w = 0, ws = 0;
    solo.forEach(function (r) {
      if (r.scale !== best.id) return;
      var sg = (num(r.sigma) && r.sigma > 0) ? r.sigma : 1;
      var wt = 1 / (sg * sg);
      ws += (num(r.observedEffect) ? r.observedEffect : 0) * wt; w += wt;
    });
    if (w > 0) { out.est = ws / w; out.se = Math.sqrt(1 / w); out.scaleLabel = best.label; }
    return out;
  }

  function renderReadout() {
    var sc = world.scenario || {};
    setText(id('ro-sub'), (sc.org || '') + ' · ' + paramsLabel(sc.runScale) + ' run · ' +
      (sc.deadline || 'Friday'));
    setText(id('ro-max'), String(maxIv()));
    id('ro-caphint').innerHTML =
      'Recipe risk budget: <b>' + maxIv() + '</b> changes go into the ' + paramsLabel(sc.runScale) +
      ' run. Anything you pick that turns out negative at run scale is a regression shipped into a ' +
      'run that costs more than everything you have spent this week.';
    renderReadoutCards();
    renderReadoutSide();
  }

  function renderReadoutCards() {
    var cap = maxIv();
    var nSel = Object.keys(RO.sel).filter(function (k) { return RO.sel[k]; }).length;
    id('ro-cards').innerHTML = world.interventions.map(function (iv) {
      var e = estimateFor(iv.id);
      var on = !!RO.sel[iv.id];
      var blocked = !on && nSel >= cap;
      var body;
      if (!e.tested) {
        body = '<b>NEVER TESTED</b> — you would be recommending this on zero evidence.';
      } else if (!e.nOk) {
        body = '<b>NO MEASUREMENT</b> — ' + e.nRuns + ' run' + (e.nRuns === 1 ? '' : 's') +
               ', all of them failed. You paid and learned nothing.';
      } else if (e.est === null) {
        body = e.nOk + ' run' + (e.nOk === 1 ? '' : 's') +
               ' but only in combination — no clean estimate for this one alone.';
      } else {
        body = '<span class="rc-est ' + cls(e.est) + '">' + sf2(e.est) + ' ± ' + f2(1.96 * e.se) + '</span> ' +
          '<span class="dim">@ ' + esc(e.scaleLabel) + '</span><br>' +
          e.nOk + ' run' + (e.nOk === 1 ? '' : 's') + ' · scales ' +
          e.scales.map(function (s) { return s.label; }).join(', ') +
          (e.nRuns > e.nOk ? ' · <span class="neg">' + (e.nRuns - e.nOk) + ' failed</span>' : '');
      }
      return '<div class="ro-card' + (on ? ' is-on' : '') + (blocked ? ' is-blocked' : '') +
        (!e.tested || !e.nOk ? ' untested' : '') + '" data-ro="' + esc(iv.id) + '">' +
        '<div class="rc-hd"><span class="rc-n ell">' +
          (on ? '<span class="pick-mark">&#10003;</span> ' : '') + esc(iv.name || iv.id) + '</span>' +
          (on ? '<span class="tag picked">RECOMMENDED</span>'
              : '<span class="tag fam-' + esc(String(iv.family || 'other').toLowerCase()) + '">' +
                esc(iv.family || '') + '</span>') + '</div>' +
        '<div class="rc-ev">' + body + '</div></div>';
    }).join('');

    qa('#ro-cards .ro-card').forEach(function (card) {
      on(card, 'click', function () {
        var iid = card.getAttribute('data-ro');
        var isOn = !!RO.sel[iid];
        var n = Object.keys(RO.sel).filter(function (k) { return RO.sel[k]; }).length;
        if (!isOn && n >= maxIv()) {
          card.classList.remove('shake');
          void card.offsetWidth;
          card.classList.add('shake');
          toast('Cap reached — ' + maxIv() + ' is the recipe risk budget. Deselect one first.', 'warn');
          return;
        }
        if (isOn) delete RO.sel[iid]; else RO.sel[iid] = true;
        renderReadoutCards();
        renderReadoutSide();
      });
    });
  }

  function roSelected() {
    return world.interventions.filter(function (iv) { return RO.sel[iv.id]; })
      .map(function (iv) { return iv.id; });
  }

  function renderReadoutSide() {
    var cap = maxIv(), sel = roSelected();
    setText(id('ro-n'), String(sel.length));
    id('ro-cap').classList.toggle('is-full', sel.length >= cap);
    setText(id('ro-confv'), RO.conf + '%');

    var cn = id('ro-confnote');
    if (RO.conf >= 85) cn.innerHTML = '<span class="amber">Very high. Yuki will ask what evidence justifies that, at what scale.</span>';
    else if (RO.conf <= 25) cn.innerHTML = '<span class="dim">Low confidence is honest — but you still have to pick.</span>';
    else cn.innerHTML = '<span class="dim">How sure are you that this set is the best available choice for the run?</span>';

    var rat = (id('ro-rat').value || '').trim();
    id('ro-ratstate').innerHTML = rat.length >= 40
      ? '<span class="pos">' + rat.length + ' characters.</span>'
      : '<span class="req">' + rat.length + '/40 characters — say what you measured and why it transfers.</span>';

    var warn = [];
    var untested = sel.filter(function (iid) { var e = estimateFor(iid); return !e.tested || !e.nOk; });
    if (untested.length) {
      warn.push('<div class="msg-err"><b>' + untested.length + ' of your picks was never tested:</b> ' +
        esc(untested.map(ivName).join(', ')) + '. You are recommending it into the run on zero evidence.</div>');
    }
    var noisy = sel.filter(function (iid) {
      var e = estimateFor(iid);
      return e.est !== null && Math.abs(e.est) < 1.96 * e.se;
    });
    if (noisy.length) {
      warn.push('<div class="msg-warn"><b>CI includes zero:</b> ' + esc(noisy.map(ivName).join(', ')) +
        '. Your own measurement cannot distinguish those from doing nothing.</div>');
    }
    var neverTestedAny = world.interventions.filter(function (iv) { return !estimateFor(iv.id).tested; });
    if (neverTestedAny.length && !untested.length) {
      warn.push('<div class="msg-warn">' + neverTestedAny.length +
        ' intervention(s) were never tested at all — you are ruling them out blind: ' +
        esc(neverTestedAny.map(function (iv) { return iv.name; }).join(', ')) + '.</div>');
    }
    if (!sel.length) warn.push('<div class="msg-err">Pick at least one intervention.</div>');
    if (!warn.length) warn.push('<div class="msg-ok">Every pick has evidence behind it with a CI clear of zero.</div>');
    id('ro-warn').innerHTML = warn.join('');

    var st = state || {};
    id('ro-note').innerHTML = 'Spent <b class="num">' + intf(st.computeUsed || 0) + '</b> of ' +
      intf(rules().computeBudget) + ' GPU-h across <b class="num">' + results().length + '</b> experiments.';

    id('ro-submit').disabled = !sel.length || rat.length < 40;
  }

  function trySubmitReadout() {
    var sel = roSelected();
    var rat = (id('ro-rat').value || '').trim();
    if (!sel.length) { toast('Pick at least one intervention.', 'err'); return; }
    if (rat.length < 40) { toast('Write the rationale — at least 40 characters.', 'err'); return; }

    var untested = sel.filter(function (iid) { var e = estimateFor(iid); return !e.tested || !e.nOk; });
    if (untested.length) {
      openModal({
        danger: true,
        title: 'SUBMIT WITH UNTESTED PICKS?',
        bodyHtml: '<p>You are recommending <b>' + esc(untested.map(ivName).join(', ')) +
          '</b> for the ' + esc(paramsLabel((world.scenario || {}).runScale)) +
          ' run without ever having measured ' + (untested.length === 1 ? 'it' : 'them') + '.</p>' +
          '<p class="dim">That is a coin flip dressed as a recommendation. If it is a regression, ' +
          'it goes into a run nobody can afford to repeat.</p>',
        okText: 'SUBMIT ANYWAY',
        okClass: 'danger',
        cancelText: 'GO BACK',
        onOk: function () { doSubmitReadout(sel, rat); }
      });
      return;
    }
    doSubmitReadout(sel, rat);
  }

  function doSubmitReadout(sel, rat) {
    var r;
    try {
      r = window.Lab.submitReadout({ interventions: sel, confidence: RO.conf / 100, rationale: rat });
    } catch (e) {
      toast('Lab.submitReadout threw: ' + (e && e.message ? e.message : e), 'err');
      showErrBar('Lab.submitReadout threw: ' + (e && e.message ? e.message : e));
      return;
    }
    if (!r || r.ok === false) {
      toast('Readout rejected — ' + ((r && r.error) || 'unknown'), 'err');
      return;
    }
    score = r;
    readoutDone = true;
    stopPoll();
    try { window.Lab.pause(); } catch (e) {}
    running = false;
    try { state = window.Lab.getState() || state; } catch (e) {}

    /* ---- ONLY NOW is the ground truth allowed to be read ---- */
    truth = revealTruth();

    /* show first: the canvas cannot size itself while the screen is display:none */
    showScreen('debrief');
    renderDebrief();
    setTimeout(function () {
      try { renderTruthPlot((world.scenario || {}).runScale || 7e10); } catch (e) {}
    }, 0);
  }

  /* The single place in this file that touches the truth. Guarded so it can
     never fire before the readout has been submitted. */
  function revealTruth() {
    if (!readoutDone) return null;
    try { return window.SIM_WORLD.reveal(); }
    catch (e) { showErrBar('SIM_WORLD.reveal() threw: ' + (e && e.message ? e.message : e)); return null; }
  }

  /* ================================================================== */
  /* SCREEN 5 — DEBRIEF                                                 */
  /* ================================================================== */
  var DEBRIEF_HTML =
    '<div class="screen center-screen" id="scr-debrief">' +
      '<div class="scrollwrap"><div class="sheet">' +
        '<div class="brand"><h1>DEBRIEF</h1><span class="sub" id="db-sub"></span></div>' +
        '<div class="rule"></div>' +
        '<div id="db-banner"></div>' +
        '<div class="db-hero">' +
          '<div class="grade-wrap"><div class="grade num" id="db-grade">—</div>' +
            '<div class="lbl" id="db-gradesub">grade</div></div>' +
          '<div class="db-kv" id="db-kv"></div>' +
        '</div>' +
        '<div class="db-grid">' +
          '<div>' +
            '<div class="blk"><h3>What was true — your points against the real curves</h3>' +
              '<div class="truth-host" id="db-truth-host"><canvas id="db-truth"></canvas>' +
                '<div class="plot-err hidden" id="db-truth-err"></div></div>' +
              '<div class="note" style="margin-top:7px">Dashed lines are the truth you were sampling. ' +
              'Your points are what you actually bought. The gap between them at the run scale is ' +
              'the whole job.</div>' +
            '</div>' +
            '<div class="blk"><h3>Per-intervention verdict</h3>' +
              '<div class="tbl-wrap" style="max-height:none"><table class="tbl"><thead><tr>' +
                '<th>INTERVENTION</th><th class="r">YOU BELIEVED</th><th class="r">TRUTH @ RUN SCALE</th>' +
                '<th>PICKED</th><th>VERDICT</th><th>WHAT WAS GOING ON</th>' +
              '</tr></thead><tbody id="db-verdict"></tbody></table></div></div>' +
            '<div class="blk" id="db-combo-blk"><h3>Combination experiments</h3>' +
              '<div class="tbl-wrap" style="max-height:none"><table class="tbl"><thead><tr>' +
                '<th>COMBINATION</th><th>SCALE</th><th class="r">OBSERVED</th><th class="r">TRUE</th>' +
                '<th class="r">SUM OF PARTS</th><th class="r">INTERACTION</th>' +
              '</tr></thead><tbody id="db-combo"></tbody></table></div></div>' +
          '</div>' +
          '<div>' +
            '<div class="blk"><h3>Calibration</h3>' +
              '<div class="calib-grid" id="db-calib"></div>' +
              '<div class="note" id="db-calibnote"></div>' +
              '<div class="tbl-wrap" style="margin-top:9px"><table class="tbl"><thead><tr>' +
                '<th>EXPERIMENT</th><th class="r">PREDICTED</th><th class="r">YOUR CI</th>' +
                '<th class="r">OBSERVED</th><th class="r">TRUTH</th><th>HIT</th>' +
              '</tr></thead><tbody id="db-calibrows"></tbody></table></div>' +
            '</div>' +
            '<div class="blk"><h3>Take it to chat</h3>' +
              '<p class="note">Copy the markdown readout and paste it to Yuki. It contains your ' +
              'recommendation, every experiment you ran, and your calibration record — and no ground truth.</p>' +
              '<button class="btn primary wide big" id="db-copy" style="margin-top:8px">COPY READOUT MARKDOWN</button>' +
              '<div id="db-copystatus" class="note" style="margin-top:6px"></div>' +
              '<div id="db-copyarea" class="hidden">' +
                '<div class="lbl" style="margin-top:8px">SELECT ALL AND COPY MANUALLY (Cmd-A, Cmd-C)</div>' +
                '<textarea id="db-md" spellcheck="false"></textarea></div>' +
            '</div>' +
            '<div class="blk"><h3>The week, as it happened</h3>' +
              '<div id="db-feed" style="max-height:280px;overflow:auto"></div></div>' +
          '</div>' +
        '</div>' +
        '<div class="foot-row">' +
          '<div class="note">Same seed, same week. Change what you buy, not what is true.</div>' +
          '<button class="btn ghost big" id="db-again">RUN THE WEEK AGAIN</button>' +
        '</div>' +
      '</div></div>' +
    '</div>';

  function wireDebrief() {
    on(id('db-copy'), 'click', copyReadout);
    on(id('db-again'), 'click', function () { window.location.reload(); });
  }

  function truthEffectFor(ids, N) {
    if (!truth || !truth.effects) return null;
    var tot = 0, any = false;
    (ids || []).forEach(function (iid) {
      var e = truth.effects[iid];
      if (!e) return;
      any = true;
      var c = num(e.c) ? e.c : 0, a = num(e.a) ? e.a : 0, g = num(e.gamma) ? e.gamma : 1;
      tot += c + a * Math.pow(NREF / N, g);
    });
    if (!any) return null;
    (truth.interactions || []).forEach(function (it) {
      var pr = it.pair || [];
      if (pr.length === 2 && ids.indexOf(pr[0]) >= 0 && ids.indexOf(pr[1]) >= 0) {
        tot += num(it.delta) ? it.delta : 0;
      }
    });
    return tot;
  }

  function renderDebrief() {
    var sc = world.scenario || {}, st = state || {};
    var runScale = num(sc.runScale) ? sc.runScale : 7e10;
    var s = score || {};

    setText(id('db-sub'), (sc.org || '') + ' · ' + paramsLabel(runScale) + ' run · seed 20260816');

    var grade = s.grade || '?';
    var gEl = id('db-grade');
    gEl.textContent = grade;
    gEl.className = 'grade num g-' + esc(String(grade).charAt(0));
    setText(id('db-gradesub'), num(s.regret) && num(s.bestPossible) && s.bestPossible
      ? 'regret ' + pct((s.regret / s.bestPossible) * 100, 0) + ' of best'
      : 'grade');

    id('db-kv').innerHTML =
      stat('YOUR SET AT RUN SCALE', '<span class="' + cls(s.trueEffectAtRunScale) + '">' +
        sf2(s.trueEffectAtRunScale) + '</span>') +
      stat('BEST POSSIBLE', sf2(s.bestPossible)) +
      stat('REGRET', '<span class="neg">' + f2(s.regret) + '</span>') +
      stat('COMPUTE SPENT', intf(num(s.computeSpent) ? s.computeSpent : st.computeUsed)) +
      stat('EXPERIMENTS', String(results().length)) +
      stat('YOU PICKED', (s.chosen || roSelected()).map(ivName).join(', ') || '—') +
      stat('BEST SET WAS', (s.bestSet || []).map(ivName).join(', ') || '—') +
      stat('MISSED', (s.missed || []).map(ivName).join(', ') || 'nothing') +
      stat('FAILED JOBS', String(results().filter(function (r) { return r.status === 'failed'; }).length)) +
      stat('CONFIDENCE', RO.conf + '%');

    var ban = [];
    if (s.shippedRegression) {
      ban.push('<div class="banner"><b>YOU SHIPPED A REGRESSION.</b> One of your picks has a ' +
        'negative true effect at ' + esc(paramsLabel(runScale)) + '. That caps the grade at C no matter ' +
        'how good the rest of the set is — a regression in a run this size is the one mistake that ' +
        'cannot be undone after the fact.</div>');
    }
    if (s.calibration && s.calibration.overconfident) {
      ban.push('<div class="banner"><b>OVERCONFIDENT.</b> The truth fell inside your stated 95% CI ' +
        'only ' + esc(pct((s.calibration.hitRate || 0) * 100, 0)) + ' of the time. Your intervals ' +
        'were too narrow for what you actually knew.</div>');
    }
    if (!ban.length) {
      ban.push('<div class="banner good"><b>No regressions shipped.</b> ' +
        'Every intervention you recommended has a non-negative true effect at the run scale.</div>');
    }
    id('db-banner').innerHTML = ban.join('');

    renderTruthPlot(runScale);
    renderVerdictTable(runScale);
    renderComboTable();
    renderCalibration();

    id('db-feed').innerHTML = feedMsgs.length ? feedMsgs.map(function (m) {
      var from = String(m.from || 'SYS').toUpperCase();
      return '<div class="msg from-' + esc(from) + ' tone-' + esc(m.tone || 'neutral') + '">' +
        '<div class="msg-hd"><span class="msg-who">' + esc(m.name || from) + '</span>' +
        '<span class="msg-tm num">' + esc(m.t || stamp(m.day, m.hour)) + '</span></div>' +
        '<div class="msg-tx">' + esc(m.text || '') + '</div></div>';
    }).join('') : '<div class="empty-note">quiet week</div>';

    id('db-copystatus').textContent = '';
    id('db-copyarea').classList.add('hidden');
  }

  function renderTruthPlot(runScale) {
    var host = id('db-truth-err');
    var series = buildSeries(true);   /* singleton series only — comparable to the curves */
    var ids = {};
    series.forEach(function (s) { ids[s.ids[0]] = true; });
    (score && score.chosen ? score.chosen : roSelected()).forEach(function (i) { ids[i] = true; });

    var curves = Object.keys(ids).map(function (iid) {
      return {
        id: iid, label: ivName(iid), color: colorFor([iid]),
        fn: function (N) {
          var v = truthEffectFor([iid], N);
          return num(v) ? v : 0;
        }
      };
    });

    try {
      if (!plotTruth) plotTruth = window.Plots.create(id('db-truth'), { theme: 'dark' });
      if (plotTruth.resize) plotTruth.resize();
      plotTruth.truth({ series: series, truthCurves: curves, runScale: runScale, metric: metricName() });
      host.classList.add('hidden');
    } catch (e) {
      host.classList.remove('hidden');
      host.textContent = 'Plots.truth() failed: ' + (e && e.message ? e.message : e);
    }
  }

  function renderVerdictTable(runScale) {
    var rows = (score && score.perIntervention) || null;
    if (!rows) {
      rows = world.interventions.map(function (iv) {
        var e = estimateFor(iv.id);
        return {
          id: iv.id, believed: e.est, truthAtRunScale: truthEffectFor([iv.id], runScale),
          chosen: !!RO.sel[iv.id], verdict: ''
        };
      });
    }
    var notes = (truth && truth.notes) || {};
    id('db-verdict').innerHTML = rows.map(function (r) {
      var tv = num(r.truthAtRunScale) ? r.truthAtRunScale : truthEffectFor([r.id], runScale);
      var v = r.verdict || autoVerdict(r, tv);
      var vc = /correct|good|right|kept|hit/i.test(v) ? 'pos'
             : /miss|regress|wrong|noise|bad/i.test(v) ? 'neg' : 'dim';
      return '<tr>' +
        '<td><b>' + esc(ivName(r.id)) + '</b></td>' +
        '<td class="r num ' + cls(r.believed) + '">' + esc(sf2(r.believed)) + '</td>' +
        '<td class="r num ' + cls(tv) + '"><b>' + esc(sf2(tv)) + '</b></td>' +
        '<td>' + (r.chosen ? '<span class="pill ok">PICKED</span>' : '<span class="pill">—</span>') + '</td>' +
        '<td><span class="verdict-tag ' + vc + '">' + esc(v) + '</span></td>' +
        '<td class="dim" style="white-space:normal">' + esc(notes[r.id] || '') + '</td>' +
        '</tr>';
    }).join('');
  }

  function autoVerdict(r, tv) {
    var chosen = !!r.chosen;
    if (!num(tv)) return chosen ? 'picked' : '—';
    if (chosen && tv < 0) return 'REGRESSION SHIPPED';
    if (chosen && tv > 0) return 'correct pick';
    if (!chosen && tv > 0) return 'missed';
    return 'correctly avoided';
  }

  function renderComboTable() {
    var combos = okResults().filter(function (r) { return (r.interventions || []).length > 1; });
    if (!combos.length || !truth) {
      id('db-combo-blk').classList.add('hidden');
      return;
    }
    id('db-combo-blk').classList.remove('hidden');
    id('db-combo').innerHTML = combos.map(function (r) {
      var sc = scaleById(r.scale);
      var N = sc ? sc.params : NREF;
      var tv = truthEffectFor(r.interventions, N);
      var parts = 0;
      r.interventions.forEach(function (iid) {
        var p = truthEffectFor([iid], N);
        if (num(p)) parts += p;
      });
      var inter = num(tv) ? tv - parts : null;
      return '<tr>' +
        '<td>' + esc(setLabel(r.interventions)) + '</td>' +
        '<td>' + esc(sc ? sc.label : r.scale) + '</td>' +
        '<td class="r num">' + esc(sf2(r.observedEffect)) + '</td>' +
        '<td class="r num"><b>' + esc(sf2(tv)) + '</b></td>' +
        '<td class="r num dim">' + esc(sf2(parts)) + '</td>' +
        '<td class="r num ' + cls(inter) + '"><b>' + esc(sf2(inter)) + '</b></td>' +
        '</tr>';
    }).join('');
  }

  function renderCalibration() {
    var c = (score && score.calibration) || {};
    id('db-calib').innerHTML =
      stat('PREDICTIONS', String(num(c.n) ? c.n : results().length)) +
      stat('CI HIT RATE', '<span class="' + (num(c.hitRate) && c.hitRate >= 0.8 ? 'pos' : 'neg') + '">' +
        (num(c.hitRate) ? pct(c.hitRate * 100, 0) : '—') + '</span>') +
      stat('MEAN |ERROR|', f2(c.meanAbsError)) +
      stat('BIAS', '<span class="' + cls(c.bias) + '">' + sf2(c.bias) + '</span>') +
      stat('VERDICT', c.overconfident ? '<span class="neg">OVERCONFIDENT</span>' : '<span class="pos">CALIBRATED</span>');

    id('db-calibnote').innerHTML = num(c.bias)
      ? (c.bias > 0.2
          ? 'A positive bias means you systematically expected more than was there — the standard failure mode of someone who wants their idea to work.'
          : c.bias < -0.2
            ? 'A negative bias means you consistently under-predicted your own interventions.'
            : 'Your predictions were roughly unbiased on average — the remaining error is spread, not tilt.')
      : '95% intervals should contain the truth about 19 times in 20. Fewer than that means the intervals were too narrow.';

    var rows = results().filter(function (r) { return num(r.predictedEffect); });
    id('db-calibrows').innerHTML = rows.length ? rows.map(function (r) {
      var sc = scaleById(r.scale);
      var tv = truthEffectFor(r.interventions || [], sc ? sc.params : NREF);
      var hit = num(tv) && num(r.ciLow) && num(r.ciHigh) ? (tv >= r.ciLow && tv <= r.ciHigh) : null;
      return '<tr' + (r.status === 'failed' ? ' class="is-failed"' : '') + '>' +
        '<td class="wrapcell" title="' + esc(setLabel(r.interventions || [])) + '">' +
          esc(setLabel(r.interventions || [])) + ' <span class="dim">@' +
          esc(sc ? sc.label : r.scale) + '</span></td>' +
        '<td class="r num">' + esc(sf2(r.predictedEffect)) + '</td>' +
        '<td class="r num dim">[' + esc(f1(r.ciLow)) + ', ' + esc(f1(r.ciHigh)) + ']</td>' +
        '<td class="r num">' + esc(r.status === 'failed' ? '—' : sf2(r.observedEffect)) + '</td>' +
        '<td class="r num"><b>' + esc(sf2(tv)) + '</b></td>' +
        '<td>' + (hit === null ? '<span class="dim">—</span>'
          : hit ? '<span class="pill ok">HIT</span>' : '<span class="pill fail">MISS</span>') + '</td>' +
        '</tr>';
    }).join('') : '<tr><td colspan="6"><div class="empty-note">no predictions on record</div></td></tr>';
  }

  /* ---------- clipboard (file:// often blocks the modern API) ---------- */
  function readoutMarkdown() {
    var md = '';
    try { md = window.Lab.exportReadout(); } catch (e) { md = ''; }
    if (typeof md !== 'string' || !md.length) md = fallbackMarkdown();
    return md;
  }
  function fallbackMarkdown() {
    var L = [], st = state || {};
    L.push('# Readout — ' + ((world.scenario || {}).org || '') + ' ' +
      paramsLabel((world.scenario || {}).runScale) + ' run');
    L.push('');
    L.push('**Recommendation:** ' + (score && score.chosen ? score.chosen : roSelected()).map(ivName).join(', '));
    L.push('**Confidence:** ' + RO.conf + '%');
    L.push('');
    L.push((id('ro-rat').value || '').trim());
    L.push('');
    L.push('| interventions | scale | steps | seeds | GPU-h | predicted | CI | observed | sigma | status |');
    L.push('|---|---|---|---:|---:|---:|---|---:|---:|---|');
    results().forEach(function (r) {
      var sc = scaleById(r.scale);
      L.push('| ' + setLabel(r.interventions || []) + ' | ' + (sc ? sc.label : r.scale) + ' | ' +
        r.steps + ' | ' + r.seeds + ' | ' + intf(r.cost) + ' | ' + sf2(r.predictedEffect) + ' | [' +
        f1(r.ciLow) + ', ' + f1(r.ciHigh) + '] | ' +
        (r.status === 'failed' ? '—' : sf2(r.observedEffect)) + ' | ' + f2(r.sigma) + ' | ' +
        (r.status === 'failed' ? ('FAILED: ' + (r.failReason || '')) : 'ok') + ' |');
    });
    L.push('');
    L.push('Compute spent: ' + intf(st.computeUsed) + ' / ' + intf(rules().computeBudget) + ' GPU-h.');
    L.push('');
    L.push('_(generated by ui.js fallback — Lab.exportReadout() returned nothing)_');
    return L.join('\n');
  }

  function copyReadout() {
    var md = readoutMarkdown();
    var status = id('db-copystatus');
    var done = function (ok, why) {
      if (ok) {
        status.innerHTML = '<span class="pos">✓ COPIED — ' + md.length.toLocaleString('en-US') +
          ' characters on the clipboard. Paste it into chat.</span>';
        id('db-copyarea').classList.add('hidden');
      } else {
        status.innerHTML = '<span class="amber">Clipboard blocked' + (why ? ' (' + esc(why) + ')' : '') +
          ' — the markdown is below, select all and copy it by hand.</span>';
        var area = id('db-copyarea');
        area.classList.remove('hidden');
        var ta = id('db-md');
        ta.value = md;
        ta.focus(); ta.select();
      }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        navigator.clipboard.writeText(md).then(function () { done(true); },
          function (err) { legacyCopy(md, done, err && err.name); });
      } catch (e) { legacyCopy(md, done, 'clipboard threw'); }
    } else {
      legacyCopy(md, done, 'no clipboard API');
    }
  }
  function legacyCopy(text, done, why) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed'; ta.style.top = '-1000px'; ta.style.opacity = '0';
    document.body.appendChild(ta);
    var ok = false;
    try {
      ta.select(); ta.setSelectionRange(0, text.length);
      ok = document.execCommand('copy');
    } catch (e) { ok = false; }
    document.body.removeChild(ta);
    done(ok, ok ? null : why);
  }

  /* ------------------------------------------------------------------ */
  /* keyboard                                                            */
  /* ------------------------------------------------------------------ */
  function inField(t) {
    if (!t) return false;
    var n = (t.tagName || '').toUpperCase();
    return n === 'INPUT' || n === 'TEXTAREA' || n === 'SELECT' || t.isContentEditable;
  }
  function wireKeyboard() {
    document.addEventListener('keydown', function (ev) {
      if (modalStack.length) return;
      if (!S.lab || !S.lab.classList.contains('active')) return;
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
      if (inField(ev.target)) { if (ev.key === 'Escape') ev.target.blur(); return; }
      if (ev.key === ' ' || ev.key === 'Spacebar') { ev.preventDefault(); togglePause(); }
      else if (ev.key === 'n' || ev.key === 'N') { ev.preventDefault(); advanceToNextResult(); }
      else if (ev.key === 'h' || ev.key === 'H') { ev.preventDefault(); $['d-hyp'].focus(); }
    });
  }

  /* ------------------------------------------------------------------ */
  /* go                                                                  */
  /* ------------------------------------------------------------------ */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  /* small console surface for debugging; not part of the contract */
  window.UI = {
    _screen: showScreen,
    _state: function () { return state; },
    _feed: function () { return feedMsgs; },
    _design: function () { return D; },
    _preview: function () { return lastPreview; },
    _score: function () { return score; }
  };
})();
