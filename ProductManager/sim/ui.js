/* ============================================================================
   PRODUCT MANAGER SIM — sim/ui.js
   Implements SPEC §5: brief → desk → gate modal → QBR → debrief.
   Vanilla JS. No frameworks, no build step, no fetch(), no ES modules.
   Depends only on the documented public APIs of:
     window.SIM_CO   (data/company.js)
     window.Product  (sim/product.js)
     window.Viz      (sim/viz.js)
     window.Org      (sim/org.js)
   This file NEVER calls SIM_CO.reveal(). Ground truth reaches the screen only
   through the Score object returned by Product.submitQBR(), and only after the
   QBR has been submitted.
   ============================================================================ */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* module state                                                        */
  /* ------------------------------------------------------------------ */
  var root = null;
  var S = {};                 // screens
  var $ = {};                 // cached elements

  var CO = null;              // window.SIM_CO
  var FEAT = [];              // features
  var INST = [];              // instruments
  var STK = [];               // stakeholders
  var byFeat = {}, byInst = {}, byStk = {};

  var lastState = null;
  var running = false;
  var speed = 4;
  var started = false;
  var quarterOver = false;
  var qbrDone = false;
  var score = null;

  var vizMain = null, vizGantt = null, vizTruth = null;
  var vizTab = 'evidence';

  var feedMsgs = [];
  var feedSeen = {};
  var feedDrawn = 0;
  var feedSig = null;
  var boardSig = null, roadSig = null, hdrSig = null;

  var predictions = {};       // featureId -> {predictedImpact, rationale, day}
  var answered = {};          // eventId -> choice
  var gateFired = {};
  var toastSeq = 0;
  var modalOpen = 0;
  var pausedByModal = false;

  var rsFeature = '';         // research: selected feature id
  var rsInstrument = '';      // research: selected instrument id
  var rsAck = false;          // research: caveat acknowledged for THIS instrument

  var DEFAULT_GATES = [
    { week: 1,  id: 'roadmap', title: 'Roadmap review',
      prompt: 'Post your quarter plan and priority order to the room in chat.' },
    { week: 6,  id: 'midqtr',  title: 'Mid-quarter review',
      prompt: 'Marguerite wants the number, what changed, and what you\'re cutting.' },
    { week: 11, id: 'shipcut', title: 'Ship-or-cut call',
      prompt: 'Say what ships, what slips, and who you\'re about to disappoint.' },
    { week: 12, id: 'qbr',     title: 'QBR',
      prompt: 'Paste your QBR into chat and defend the quarter.' }
  ];
  var GATES = DEFAULT_GATES;

  var GATE_CHECKLIST = {
    roadmap: ['What you are building, in order, and why that order',
              'What you are explicitly NOT doing this quarter',
              'The evidence behind your top item — and which instrument produced it',
              'The capacity arithmetic: eng-weeks committed vs eng-weeks you have'],
    midqtr:  ['The number now, against the 31.4 baseline and the 40 promise',
              'What your research changed your mind about — name the instrument',
              'What you are cutting, and who you have already told',
              'What you would need to actually hit 40, if anything'],
    shipcut: ['What ships. What slips. Half-built is worth zero.',
              'Who you are about to disappoint, and how you are telling them',
              'What you would cut first if you lost another four eng-weeks',
              'The one decision from this quarter you would take back'],
    qbr:     ['The QBR markdown, pasted in full (copy button on this screen)',
              'What each instrument told you, and where it lied',
              'Predicted vs actual for every feature you committed to',
              'The instrument you wish you had run in week one']
  };

  /* colour-blind-safe instrument colours (Okabe-Ito, lifted for a dark bg) */
  var INST_COLOR = {
    sales_anecdote:  '#e69f00',
    support_tickets: '#56b4e9',
    usage_analytics: '#34c98b',
    survey:          '#f0e442',
    interviews:      '#cc79a7',
    fake_door:       '#7aa2ff',
    ab_test:         '#e6edf3'
  };
  var FALLBACK_COLORS = ['#e69f00', '#56b4e9', '#34c98b', '#f0e442', '#cc79a7',
                         '#7aa2ff', '#e6edf3', '#d29922', '#a371f7', '#39c5cf'];

  var ROLE_LABEL = {
    CEO: 'CEO', SALES: 'SALES', ENG: 'ENGINEERING', DESIGN: 'DESIGN',
    SUPPORT: 'SUPPORT', CUSTOMER: 'CUSTOMER', SYS: 'SYSTEM'
  };

  /* ------------------------------------------------------------------ */
  /* tiny helpers                                                        */
  /* ------------------------------------------------------------------ */
  function id(x) { return document.getElementById(x); }
  function q(sel, ctx) { return (ctx || document).querySelector(sel); }
  function qa(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }
  function on(node, ev, fn) { if (node) node.addEventListener(ev, fn); }

  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function num(n) { return (typeof n === 'number' && isFinite(n)); }
  function f1(n) { return num(n) ? n.toFixed(1) : '—'; }
  function f2(n) { return num(n) ? n.toFixed(2) : '—'; }
  function i0(n) { return num(n) ? String(Math.round(n)) : '—'; }
  function sgn1(n) { return num(n) ? (n > 0 ? '+' : '') + n.toFixed(1) : '—'; }
  function sgn2(n) { return num(n) ? (n > 0 ? '+' : '') + n.toFixed(2) : '—'; }
  function cls(n) { return !num(n) || Math.abs(n) < 0.005 ? 'flat' : (n > 0 ? 'pos' : 'neg'); }
  function clamp(n, a, b) { return n < a ? a : (n > b ? b : n); }

  function h(html) {
    var d = document.createElement('div');
    d.innerHTML = String(html).trim();
    return d.firstElementChild;
  }
  function setText(node, txt) {
    if (!node) return;
    if (node._t === txt) return;
    node._t = txt; node.textContent = txt;
  }
  function setHTML(node, html) {
    if (!node) return;
    if (node._h === html) return;
    node._h = html; node.innerHTML = html;
  }

  /* every call into a foreign module goes through here */
  function call(fn, label) {
    try { return fn(); }
    catch (e) {
      showErrBar((label || 'module call') + ' threw: ' + (e && e.message ? e.message : e));
      return null;
    }
  }

  function P() { return window.Product; }

  function instColor(iid) {
    if (INST_COLOR[iid]) return INST_COLOR[iid];
    var i = 0;
    for (; i < INST.length; i++) if (INST[i].id === iid) break;
    return FALLBACK_COLORS[i % FALLBACK_COLORS.length];
  }
  function featName(fid) { return (byFeat[fid] && byFeat[fid].name) || fid || '—'; }
  function instName(iid) { return (byInst[iid] && byInst[iid].name) || iid || '—'; }
  function estCostOf(fid) { return byFeat[fid] && num(byFeat[fid].estCost) ? byFeat[fid].estCost : 0; }

  /* reading / activity shapes are only partly pinned down by SPEC — read them defensively */
  function rFeat(r) { return r && (r.featureId || r.feature || r.fid || r.id_feature) || ''; }
  function rInst(r) { return r && (r.instrumentId || r.instrument || r.iid || r.id_instrument) || ''; }
  function rVal(r) {
    if (!r) return NaN;
    if (num(r.value)) return r.value;
    if (num(r.reading)) return r.reading;
    if (num(r.impact)) return r.impact;
    if (num(r.estimate)) return r.estimate;
    return NaN;
  }
  function aProgress(a) {
    if (!a) return 0;
    if (num(a.progress)) return clamp(a.progress, 0, 1);
    var days = num(a.days) ? a.days : (byInst[rInst(a)] && byInst[rInst(a)].days) || 1;
    if (num(a.daysLeft)) return clamp(1 - a.daysLeft / days, 0, 1);
    if (num(a.daysDone)) return clamp(a.daysDone / days, 0, 1);
    if (num(a.startDay) && lastState && num(lastState.day)) {
      return clamp((lastState.day - a.startDay) / days, 0, 1);
    }
    return 0;
  }
  function aDaysLeft(a) {
    if (!a) return 0;
    if (num(a.daysLeft)) return a.daysLeft;
    var days = num(a.days) ? a.days : (byInst[rInst(a)] && byInst[rInst(a)].days) || 1;
    return Math.max(0, Math.ceil(days * (1 - aProgress(a))));
  }

  function RULES() {
    var r = (P() && P().RULES) || {};
    return {
      weeks: num(r.weeks) ? r.weeks : 12,
      workDays: num(r.workDays) ? r.workDays : 60,
      totalCapacity: num(r.totalCapacity) ? r.totalCapacity
        : (CO && CO.scenario && CO.scenario.capacity && num(CO.scenario.capacity.total)
            ? CO.scenario.capacity.total : 48),
      engWeeksPerWeek: num(r.engWeeksPerWeek) ? r.engWeeksPerWeek : 4,
      researchSlots: num(r.researchSlots) ? r.researchSlots : 2,
      minRationaleChars: num(r.minRationaleChars) ? r.minRationaleChars : 20,
      lowTrustEng: num(r.lowTrustEng) ? r.lowTrustEng : 40,
      trustHitForNo: num(r.trustHitForNo) ? r.trustHitForNo : 12
    };
  }

  /* ------------------------------------------------------------------ */
  /* boot + defensive diagnostics                                        */
  /* ------------------------------------------------------------------ */
  var REQUIRED = [
    { global: 'SIM_CO', file: 'data/company.js', kind: 'object',
      check: function (v) {
        return v && v.scenario && Array.isArray(v.features) && v.features.length &&
               Array.isArray(v.instruments) && v.instruments.length &&
               Array.isArray(v.stakeholders) && v.stakeholders.length;
      },
      detail: 'window.SIM_CO must expose scenario, features[], instruments[] and stakeholders[] (SPEC §1).' },
    { global: 'Product', file: 'sim/product.js', kind: 'object',
      methods: ['init', 'getState', 'research', 'commit', 'drop', 'setRoadmap', 'respond',
                'advance', 'step', 'start', 'pause', 'setSpeed', 'submitQBR', 'exportQBR', 'on'],
      detail: 'window.Product must expose the calendar/research/roadmap/scoring API from SPEC §2.' },
    { global: 'Viz', file: 'sim/viz.js', kind: 'object',
      methods: ['create'],
      detail: 'window.Viz.create(canvas, opts) must return an object with evidence/gantt/trust/impact/truth/resize (SPEC §3).' },
    { global: 'Org', file: 'sim/org.js', kind: 'object',
      methods: ['init', 'tick', 'getFeed'],
      detail: 'window.Org must expose init/tick/getFeed and (ideally) GATES (SPEC §4).' }
  ];

  function auditGlobals() {
    var rows = [];
    for (var i = 0; i < REQUIRED.length; i++) {
      var r = REQUIRED[i];
      var v = window[r.global];
      var missing = [];
      var ok = !!v;
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
      'Nothing below is a browser problem — check the files themselves.</div>' +
      '<table class="diag-tbl"><thead><tr>' +
      '<th>Global</th><th>File</th><th>Status</th><th>What is wrong</th>' +
      '</tr></thead><tbody>';
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i], status, why;
      if (r.ok) { status = '<span class="diag-ok">OK</span>'; why = '<span class="dim">—</span>'; }
      else if (!r.present) {
        status = '<span class="diag-bad">MISSING</span>';
        why = 'window.' + esc(r.spec.global) + ' is undefined — the file did not load or threw while ' +
              'parsing. Open the browser console (Cmd-Opt-J) for the parse error.';
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
      '&lt;script src="data/company.js"&gt;&lt;/script&gt;<br>' +
      '&lt;script src="sim/product.js"&gt;&lt;/script&gt;<br>' +
      '&lt;script src="sim/viz.js"&gt;&lt;/script&gt;<br>' +
      '&lt;script src="sim/org.js"&gt;&lt;/script&gt;<br>' +
      '&lt;script src="sim/ui.js"&gt;&lt;/script&gt;<br><br>' +
      'Everything must run from <code>file://</code> — no ES modules, no fetch(), no CDN.' +
      '</div></div>';
    document.body.innerHTML = '';
    var d = h('<div id="pms-root"></div>');
    d.innerHTML = html;
    document.body.appendChild(d);
  }

  function boot() {
    var rows = auditGlobals();
    var bad = rows.filter(function (r) { return !r.ok; });
    if (bad.length) { renderDiagnostics(rows); return; }

    CO = window.SIM_CO;
    FEAT = CO.features.slice();
    INST = CO.instruments.slice();
    STK = CO.stakeholders.slice();
    FEAT.forEach(function (f) { byFeat[f.id] = f; });
    INST.forEach(function (x) { byInst[x.id] = x; });
    STK.forEach(function (s) { byStk[s.id] = s; });

    if (window.Org && Array.isArray(window.Org.GATES) && window.Org.GATES.length) {
      GATES = window.Org.GATES;
    }

    rsFeature = FEAT[0] ? FEAT[0].id : '';

    buildDom();
    installGlobalErrorBar();
    renderBrief();
    showScreen('brief');
  }

  function installGlobalErrorBar() {
    window.addEventListener('error', function (ev) {
      showErrBar('JS error: ' + (ev.message || 'unknown') +
        (ev.filename ? '  (' + String(ev.filename).split('/').pop() + ':' + ev.lineno + ')' : ''));
    });
  }
  function showErrBar(msg) {
    var bar = id('pms-errbar');
    if (!bar) {
      bar = h('<div class="errbar" id="pms-errbar"><span id="pms-errmsg"></span>' +
              '<button class="btn ghost" id="pms-errx">dismiss</button></div>');
      document.body.appendChild(bar);
      on(id('pms-errx'), 'click', function () { bar.remove(); });
    }
    id('pms-errmsg').textContent = msg;
  }

  /* ------------------------------------------------------------------ */
  /* DOM construction                                                    */
  /* ------------------------------------------------------------------ */
  function buildDom() {
    document.body.innerHTML = '';
    root = h('<div id="pms-root"></div>');
    root.appendChild(h(BRIEF_HTML));
    root.appendChild(h(DESK_HTML));
    root.appendChild(h(QBR_HTML));
    root.appendChild(h(DEBRIEF_HTML));
    root.appendChild(h('<div id="modal-layer"><div class="modal-bg"></div></div>'));
    document.body.appendChild(root);

    S.brief   = id('scr-brief');
    S.desk    = id('scr-desk');
    S.qbr     = id('scr-qbr');
    S.debrief = id('scr-debrief');

    cacheEls();
    wireBrief();
    wireDesk();
    wireQBR();
    wireDebrief();

    window.addEventListener('resize', function () {
      call(function () { if (vizMain && vizMain.resize) vizMain.resize(); }, 'Viz.resize');
      call(function () { if (vizGantt && vizGantt.resize) vizGantt.resize(); }, 'Viz.resize');
      call(function () { if (vizTruth && vizTruth.resize) vizTruth.resize(); }, 'Viz.resize');
    });
  }

  function cacheEls() {
    ['h-clock', 'h-sub', 'h-cap', 'h-captext', 'h-capbar', 'h-capwarn', 'h-ns', 'h-nsdelta',
     'h-trust', 'h-qbr', 'h-pause', 'h-step', 'h-speed', 'h-status', 'h-toqbr',
     'b-board', 'b-count',
     'v-host', 'v-canvas', 'v-err', 'v-tabs', 'v-legend', 'v-title',
     'rs-feat', 'rs-inst', 'rs-slots', 'rs-acts', 'rs-cav', 'rs-run', 'rs-msg',
     'g-host', 'g-canvas', 'g-err', 'rm-list', 'rm-count',
     'fd-body', 'fd-stk', 'fd-count', 'toasts',
     'qb-narr', 'qb-claim', 'qb-facts', 'qb-msg', 'qb-submit', 'qb-count',
     'db-grade', 'db-gradesub', 'db-kv', 'db-caps', 'db-truth', 'db-truthcanvas', 'db-trutherr',
     'db-calib', 'db-calibsum', 'db-trust', 'db-verdict', 'db-inst', 'db-notes',
     'db-copy', 'db-copystatus', 'db-copyarea', 'db-md', 'db-title', 'db-sub'
    ].forEach(function (k) { $[k] = id(k); });
  }

  function showScreen(name) {
    ['brief', 'desk', 'qbr', 'debrief'].forEach(function (k) {
      if (S[k]) S[k].classList.toggle('active', k === name);
    });
  }

  /* ================================================================== */
  /* SCREEN 1 — BRIEF                                                   */
  /* ================================================================== */
  var BRIEF_HTML =
    '<div class="screen center-screen" id="scr-brief">' +
      '<div class="scrollwrap"><div class="brief-wrap">' +
        '<div class="brand"><h1>PRODUCT MANAGER</h1>' +
          '<span class="sub" id="br-sub">one quarter · one team · ten features · five people who want different things</span></div>' +
        '<div class="rule"></div>' +
        '<div class="acct-bar" id="br-acct"></div>' +
        '<div class="brief-grid">' +
          '<div>' +
            '<div class="blk headline"><h3>THE BRIEF</h3><p id="br-brief"></p></div>' +
            '<div class="blk ask"><h3>THE MANDATE</h3><p id="br-mandate"></p></div>' +
            '<div class="blk"><h3>The board — ten candidate features</h3>' +
              '<div style="max-height:290px;overflow:auto"><table class="tbl"><thead><tr>' +
                '<th>FEATURE</th><th>TAGS</th><th class="r">EST</th><th>CHAMPION</th>' +
              '</tr></thead><tbody id="br-feats"></tbody></table></div>' +
              '<div class="note" style="margin-top:7px">Estimates come from engineering. Engineering ' +
              'estimates are optimistic, and by different amounts per feature. Half-built is worth zero.</div>' +
            '</div>' +
          '</div>' +
          '<div>' +
            '<div class="blk warnblk"><h3>Your seven instruments — and where each one is blind</h3>' +
              '<div class="inst-brief" id="br-insts"></div>' +
              '<div class="note" style="margin-top:9px">Every instrument lies in a known direction. ' +
              'The skill is triangulating across instruments that lie <i>differently</i> — and noticing ' +
              'when every instrument you own is blind to the same thing.</div>' +
            '</div>' +
            '<div class="blk"><h3>The room</h3>' +
              '<table class="tbl"><thead><tr><th>WHO</th><th>ROLE</th><th>WANTS</th></tr></thead>' +
              '<tbody id="br-stk"></tbody></table>' +
              '<div class="note" style="margin-top:7px">None of them reports to you. Trust starts at 60 ' +
              'and you spend it every time you say no.</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="foot-row">' +
          '<div class="note">Seeded and deterministic — the same decisions replay identically.</div>' +
          '<button class="btn primary big" id="br-start">START THE QUARTER</button>' +
        '</div>' +
      '</div></div>' +
    '</div>';

  function wireBrief() {
    on(id('br-start'), 'click', startQuarter);
  }

  function renderBrief() {
    var sc = CO.scenario || {};
    var ns = sc.northStar || {};
    var cap = sc.capacity || {};
    var qt = sc.quarter || {};

    id('br-sub').textContent = (sc.company || 'Lumen') + ' · ' + (sc.role || 'Product Manager');
    id('br-acct').innerHTML =
      cell('NORTH STAR', esc(ns.name || '—')) +
      cell('BASELINE', f1(ns.baseline) + '<span class="dim" style="font-size:12px"> ' + esc(ns.units || 'pp') + '</span>') +
      cell('CAPACITY', i0(cap.total) + '<span class="dim" style="font-size:12px"> eng-weeks</span>') +
      cell('QUARTER', i0(qt.weeks) + '<span class="dim" style="font-size:12px"> weeks</span>');

    id('br-brief').textContent = sc.brief || '';
    id('br-mandate').textContent = sc.ceoMandate || '';

    id('br-feats').innerHTML = FEAT.map(function (f) {
      return '<tr><td><b>' + esc(f.name) + '</b></td>' +
        '<td>' + (f.tags || []).map(function (t) { return '<span class="tag">' + esc(t) + '</span>'; }).join(' ') + '</td>' +
        '<td class="r num">' + i0(f.estCost) + 'w</td>' +
        '<td class="dim">' + esc(f.pitchedBy || f.owner || '—') + '</td></tr>';
    }).join('');

    id('br-insts').innerHTML = INST.map(function (x) {
      return '<div class="inst-brief-row" style="border-left-color:' + instColor(x.id) + '">' +
        '<div class="ib-hd"><span class="ib-nm">' + esc(x.name) + '</span>' +
        '<span class="ib-cost">' + i0(x.days) + 'd · ' + i0(x.slots || 1) + ' slot' +
        (x.requiresShipped ? ' · shipped only' : '') + '</span></div>' +
        '<div class="ib-cav">' + esc(x.knownCaveat || '(no stated caveat)') + '</div>' +
      '</div>';
    }).join('');

    id('br-stk').innerHTML = STK.map(function (s) {
      var wants = (s.favors || []).map(featName).join(', ');
      var not = (s.opposes || []).map(featName).join(', ');
      return '<tr><td><b>' + esc(s.name) + '</b></td><td class="dim">' + esc(s.role) + '</td>' +
        '<td class="wrap"><span class="pos">' + esc(wants || '—') + '</span>' +
        (not ? '<br><span class="neg">against: ' + esc(not) + '</span>' : '') + '</td></tr>';
    }).join('');
  }

  function cell(label, valueHtml) {
    return '<div class="acct-cell"><span class="lbl">' + esc(label) + '</span>' +
           '<div class="v num">' + valueHtml + '</div></div>';
  }

  /* ------------------------------------------------------------------ */
  /* lifecycle                                                           */
  /* ------------------------------------------------------------------ */
  function startQuarter() {
    if (started) return;
    started = true;

    var ok = call(function () { P().init({ co: CO, seed: 20260816 }); return true; }, 'Product.init');
    if (!ok) { started = false; return; }

    call(function () {
      window.Org.init({ co: CO, product: P(), onMessage: onOrgMessage });
    }, 'Org.init');

    bindProduct();
    showScreen('desk');
    createViz();
    refresh(true);
    /* the clock starts running, then the week-1 gate immediately pauses it */
    engineStart();
    checkGates();
    /* seed the feed with anything Org emitted during init */
    pullOrgFeed();
    renderFeed();
  }

  function bindProduct() {
    var p = P();
    var bind = function (evt, fn) {
      call(function () { p.on(evt, fn); }, 'Product.on("' + evt + '")');
    };
    bind('tick', function (st) { onTick(st); });
    bind('reading', function (r) { onReading(r); });
    bind('ship', function (e) { onShip(e); });
    bind('slip', function (e) { onSlip(e); });
    bind('trust', function (e) { onTrustEvent(e); });
    bind('event', function (e) { onProductEvent(e); });
    bind('quarterEnd', function () { onQuarterEnd(); });
  }

  /* `running` is set BEFORE the engine call: Product.start() may emit a tick
     synchronously, and that tick can open a gate which pauses us straight back
     again. Set the flag first and the re-entrant pause wins, as it should. */
  function engineStart() {
    if (quarterOver) { running = false; updateTransport(); return; }
    call(function () { P().setSpeed(speed); }, 'Product.setSpeed');
    running = true;
    updateTransport();
    call(function () { P().start(); }, 'Product.start');
  }
  function enginePause() {
    running = false;
    updateTransport();
    call(function () { P().pause(); }, 'Product.pause');
  }

  function pullState() {
    var st = call(function () { return P().getState(); }, 'Product.getState');
    if (st && typeof st === 'object') lastState = st;
    return lastState;
  }

  function refresh(force) {
    var st = pullState();
    if (!st) return;
    if (force) { boardSig = roadSig = hdrSig = feedSig = null; }
    renderHeader(st);
    renderBoard(st);
    renderResearch(st);
    renderRoadmap(st);
    renderViz(st);
    renderFeed();
  }

  function onTick(st) {
    if (st && typeof st === 'object') lastState = st; else pullState();
    call(function () { window.Org.tick(lastState); }, 'Org.tick');
    pullOrgFeed();
    refresh(false);
    checkGates();
    if (lastState && lastState.finished && !quarterOver) onQuarterEnd();
  }

  /* ================================================================== */
  /* SCREEN 2 — DESK                                                    */
  /* ================================================================== */
  var DESK_HTML =
    '<div class="screen" id="scr-desk">' +

      '<div class="hdr">' +
        '<div class="hdr-l">' +
          '<div class="clock num" id="h-clock">W1 D1</div>' +
          '<div class="clock-sub"><span id="h-sub">DAY 1 / 60</span> · <b id="h-toqbr">QBR IN 12W</b></div>' +
        '</div>' +

        '<div class="cap" id="h-cap">' +
          '<div class="cap-top"><span class="lbl">ENG CAPACITY · COMMITTED VS REMAINING</span>' +
            '<span class="v num" id="h-captext">—</span></div>' +
          '<div class="cap-bar" id="h-capbar"></div>' +
          '<div class="cap-legend">' +
            '<span><i class="spent"></i>spent</span>' +
            '<span><i class="committed"></i>committed, not yet built</span>' +
            '<span><i class="free"></i>free</span>' +
            '<span id="h-capwarn"></span>' +
          '</div>' +
        '</div>' +

        '<div class="hdr-kv">' +
          '<div><span class="lbl">NORTH STAR (PROJ)</span>' +
            '<span class="big num" id="h-ns">—</span></div>' +
          '<div><span class="lbl">VS BASELINE</span><span class="num" id="h-nsdelta">—</span></div>' +
          '<div><span class="lbl">AVG TRUST</span><span class="num" id="h-trust">—</span></div>' +
        '</div>' +

        '<div class="hdr-ctl">' +
          '<div class="ctl-row">' +
            '<span class="lbl">SPEED</span>' +
            '<div class="seg" id="h-speed">' +
              '<button class="seg-b" data-speed="1">1&times;</button>' +
              '<button class="seg-b" data-speed="2">2&times;</button>' +
              '<button class="seg-b is-on" data-speed="4">4&times;</button>' +
              '<button class="seg-b" data-speed="8">8&times;</button>' +
            '</div>' +
            '<button class="btn" id="h-pause">PAUSE</button>' +
            '<button class="btn" id="h-step">STEP</button>' +
            '<button class="btn warn hidden" id="h-qbr">GO TO QBR</button>' +
          '</div>' +
          '<div id="h-status" class="dim">Week 1. Nothing committed, nothing learned.</div>' +
        '</div>' +
      '</div>' +

      '<div class="desk-grid">' +

        '<section class="panel p-board">' +
          '<div class="panel-hd"><span>FEATURE BOARD</span><span class="dim" id="b-count">—</span></div>' +
          '<div class="panel-bd board-bd" id="b-board"></div>' +
        '</section>' +

        '<section class="panel p-viz">' +
          '<div class="panel-hd">' +
            '<span id="v-title">EVIDENCE · ONE ROW PER FEATURE, ONE DOT PER READING</span>' +
            '<div class="seg" id="v-tabs">' +
              '<button class="seg-b is-on" data-tab="evidence">EVIDENCE</button>' +
              '<button class="seg-b" data-tab="impact">IMPACT</button>' +
              '<button class="seg-b" data-tab="trust">TRUST</button>' +
            '</div>' +
          '</div>' +
          '<div class="viz-host" id="v-host">' +
            '<canvas id="v-canvas"></canvas>' +
            '<div class="viz-err hidden" id="v-err"></div>' +
          '</div>' +
          '<div class="legend" id="v-legend"></div>' +
        '</section>' +

        '<section class="panel p-research">' +
          '<div class="panel-hd"><span>RESEARCH</span><span class="dim" id="rs-slots">—</span></div>' +
          '<div class="panel-bd tight">' +
            '<div class="rs-fld"><span class="lbl">STUDY WHICH FEATURE</span>' +
              '<select id="rs-feat"></select></div>' +
            '<div class="rs-fld"><span class="lbl">WITH WHICH INSTRUMENT</span>' +
              '<div class="inst-list" id="rs-inst"></div></div>' +
            '<div id="rs-acts"></div>' +
          '</div>' +
          '<div class="panel-ft">' +
            '<div id="rs-cav"></div>' +
            '<button class="btn primary wide" id="rs-run" disabled>PICK AN INSTRUMENT</button>' +
            '<div id="rs-msg"></div>' +
          '</div>' +
        '</section>' +

        '<div class="p-roadmap">' +
          '<section class="panel p-gantt">' +
            '<div class="panel-hd"><span>BUILD QUEUE · 12 WEEKS</span></div>' +
            '<div class="viz-host" id="g-host">' +
              '<canvas id="g-canvas"></canvas>' +
              '<div class="viz-err hidden" id="g-err"></div>' +
            '</div>' +
          '</section>' +
          '<section class="panel p-order">' +
            '<div class="panel-hd"><span>ROADMAP ORDER</span><span class="dim" id="rm-count">—</span></div>' +
            '<div class="panel-bd tight" id="rm-list"></div>' +
          '</section>' +
        '</div>' +

        '<section class="panel p-feed">' +
          '<div class="panel-hd"><span>THE ROOM</span><span class="dim" id="fd-count">—</span></div>' +
          '<div class="stk-strip" id="fd-stk"></div>' +
          '<div class="panel-bd feed-bd" id="fd-body"></div>' +
        '</section>' +

      '</div>' +
      '<div class="toasts" id="toasts"></div>' +
    '</div>';

  function wireDesk() {
    on($['h-pause'], 'click', function () { if (running) enginePause(); else engineStart(); });
    on($['h-step'], 'click', function () {
      if (running) enginePause();
      call(function () { P().step(); }, 'Product.step');
      refresh(false);
      checkGates();
    });
    on($['h-speed'], 'click', function (ev) {
      var b = ev.target.closest ? ev.target.closest('[data-speed]') : null;
      if (!b) return;
      speed = parseInt(b.getAttribute('data-speed'), 10) || 4;
      qa('[data-speed]', $['h-speed']).forEach(function (x) {
        x.classList.toggle('is-on', x === b);
      });
      call(function () { P().setSpeed(speed); }, 'Product.setSpeed');
    });
    on($['h-qbr'], 'click', function () { onQuarterEnd(); });

    /* board — event delegation so a full re-render never loses its wiring */
    on($['b-board'], 'click', function (ev) {
      var b = ev.target.closest ? ev.target.closest('[data-act]') : null;
      if (!b) return;
      var act = b.getAttribute('data-act'), fid = b.getAttribute('data-fid');
      if (act === 'commit') openCommitDialog(fid);
      else if (act === 'drop') openDropDialog(fid);
      else if (act === 'study') { rsFeature = fid; rsAck = false; renderResearch(lastState); }
    });

    on($['v-tabs'], 'click', function (ev) {
      var b = ev.target.closest ? ev.target.closest('[data-tab]') : null;
      if (!b) return;
      vizTab = b.getAttribute('data-tab');
      qa('[data-tab]', $['v-tabs']).forEach(function (x) { x.classList.toggle('is-on', x === b); });
      renderViz(lastState);
    });

    on($['rs-feat'], 'change', function () {
      rsFeature = $['rs-feat'].value;
      rsAck = false;
      renderResearch(lastState);
    });
    on($['rs-inst'], 'click', function (ev) {
      var b = ev.target.closest ? ev.target.closest('[data-inst]') : null;
      if (!b) return;
      var iid = b.getAttribute('data-inst');
      if (rsInstrument !== iid) { rsInstrument = iid; rsAck = false; }
      renderResearch(lastState);
    });
    on($['rs-cav'], 'change', function (ev) {
      if (ev.target && ev.target.id === 'rs-ack') {
        rsAck = !!ev.target.checked;
        syncRunButton();
      }
    });
    on($['rs-run'], 'click', runResearch);

    on($['rm-list'], 'click', function (ev) {
      var b = ev.target.closest ? ev.target.closest('[data-rm]') : null;
      if (!b) return;
      var act = b.getAttribute('data-rm'), fid = b.getAttribute('data-fid');
      if (act === 'up') moveRoadmap(fid, -1);
      else if (act === 'down') moveRoadmap(fid, 1);
      else if (act === 'drop') openDropDialog(fid);
    });

    on($['fd-body'], 'click', function (ev) {
      var b = ev.target.closest ? ev.target.closest('[data-reply]') : null;
      if (b) { respondTo(b.getAttribute('data-evid'), b.getAttribute('data-reply')); return; }
      var pin = ev.target.closest ? ev.target.closest('[data-scroll-to]') : null;
      if (pin) {
        var t = q('[data-msgid="' + pin.getAttribute('data-scroll-to') + '"]', $['fd-body']);
        if (t && t.scrollIntoView) t.scrollIntoView({ block: 'center' });
      }
    });
  }

  function updateTransport() {
    if ($['h-pause']) $['h-pause'].textContent = running ? 'PAUSE' : 'RESUME';
  }

  /* ---------- header ---------- */
  function capacityInfo(st) {
    var R = RULES();
    var total = R.totalCapacity;
    var used = num(st.capacityUsed) ? st.capacityUsed : 0;
    var left = num(st.capacityLeft) ? st.capacityLeft : Math.max(0, total - used);
    var committed = 0;
    (st.roadmap || []).forEach(function (r) {
      if (r.status === 'queued' || r.status === 'building') {
        var est = num(r.revisedEstimate) ? r.revisedEstimate : estCostOf(r.featureId);
        var spent = num(r.engWeeksSpent) ? r.engWeeksSpent : 0;
        committed += Math.max(0, est - spent);
      }
    });
    return { total: total, used: used, left: left, committed: committed,
             over: committed - left };
  }

  function renderHeader(st) {
    var R = RULES();
    var ns = (CO.scenario && CO.scenario.northStar) || {};
    var ci = capacityInfo(st);
    var weeks = R.weeks;
    var toQbr = Math.max(0, weeks - (num(st.week) ? st.week : 1) + 1);

    var sig = [st.t, st.day, ci.used, ci.left, ci.committed, st.northStarProjected,
               st.avgTrust, (st.openEvents || []).length, (st.shipped || []).length].join('|');
    if (sig === hdrSig) return;
    hdrSig = sig;

    setText($['h-clock'], st.t || ('W' + (st.week || 1) + ' D' + (((st.day || 1) - 1) % 5 + 1)));
    setText($['h-sub'], 'D' + i0(st.day) + '/' + i0(R.workDays));
    setText($['h-toqbr'], toQbr <= 1 ? 'QBR THIS WEEK' : ('QBR IN ' + toQbr + 'W'));

    /* capacity: committed vs remaining, alarming when committed exceeds remaining */
    var denom = (ci.used + Math.max(ci.committed, ci.left)) || 1;
    var wSpent = (ci.used / denom) * 100;
    var wComm = (Math.min(ci.committed, ci.left) / denom) * 100;
    var wOver = (Math.max(0, ci.committed - ci.left) / denom) * 100;
    setHTML($['h-capbar'],
      '<div class="cap-seg spent" style="width:' + wSpent.toFixed(2) + '%"></div>' +
      '<div class="cap-seg committed" style="width:' + wComm.toFixed(2) + '%"></div>' +
      '<div class="cap-seg over" style="width:' + wOver.toFixed(2) + '%"></div>');
    setHTML($['h-captext'],
      '<span class="dim">spent</span> ' + f1(ci.used) +
      ' <span class="dim">· committed</span> <span class="cyan">' + f1(ci.committed) + '</span>' +
      ' <span class="dim">· remaining</span> <span class="' + (ci.left <= 0 ? 'neg' : '') + '">' + f1(ci.left) + '</span>' +
      ' <span class="dim">/ ' + f1(ci.total) + ' ew</span>');
    var over = ci.over > 0.0001;
    $['h-cap'].classList.toggle('is-over', over);
    setHTML($['h-capwarn'], over
      ? '⚠ OVER BY ' + f1(ci.over) + ' EW — SOMETHING WILL NOT SHIP'
      : '');

    var proj = st.northStarProjected;
    setText($['h-ns'], num(proj) ? proj.toFixed(1) : '—');
    var d = num(proj) && num(ns.baseline) ? proj - ns.baseline : NaN;
    $['h-nsdelta'].className = 'num ' + cls(d);
    setText($['h-nsdelta'], sgn1(d) + ' pp');
    var at = num(st.avgTrust) ? st.avgTrust : NaN;
    $['h-trust'].className = 'num ' + (at < 40 ? 'neg' : at < 55 ? 'amber' : 'pos');
    setText($['h-trust'], i0(at));

    /* status line */
    var msg, kind = '';
    var nShipped = (st.shipped || []).length;
    var nRun = (st.research && st.research.running || []).length;
    var nDone = (st.research && st.research.done || []).length;
    if (over) { msg = 'Committed beyond what is left. The arithmetic does not care about your plan.'; kind = 'is-alarm'; }
    else if (num(at) && at < 40) { msg = 'Average trust is ' + i0(at) + '. You have an organisational problem now.'; kind = 'is-alarm'; }
    else if ((st.openEvents || []).filter(needsReply).length) { msg = 'Someone is waiting on an answer from you.'; kind = 'is-warn'; }
    else if (nDone === 0 && nRun === 0 && (st.day || 0) > 5) { msg = 'No research run, none in flight. You are flying blind.'; kind = 'is-warn'; }
    else if (nRun < RULES().researchSlots) { msg = (RULES().researchSlots - nRun) + ' research slot(s) idle. Research is cheap; opinions are expensive.'; }
    else { msg = nShipped + ' shipped · ' + nDone + ' readings · ' + nRun + ' studies running.'; }
    $['h-status'].className = 'dim ' + kind;
    setText($['h-status'], msg);

    $['h-qbr'].classList.toggle('hidden', !(st.finished || (num(st.week) && st.week >= weeks)));
  }

  function needsReply(e) { return !!(e && (e.needsReply || e.needs_reply)); }

  /* ---------- feature board ---------- */
  function roadmapEntry(st, fid) {
    var rm = st.roadmap || [];
    for (var i = 0; i < rm.length; i++) if (rm[i].featureId === fid) return rm[i];
    return null;
  }

  function readingsByFeature(st) {
    var map = {};
    (st.research && st.research.done || []).forEach(function (r) {
      var f = rFeat(r);
      if (!f) return;
      (map[f] = map[f] || []).push({
        instrument: rInst(r), value: rVal(r), color: instColor(rInst(r)), day: r.day
      });
    });
    return map;
  }
  function runningByFeature(st) {
    var map = {};
    (st.research && st.research.running || []).forEach(function (a) {
      var f = rFeat(a);
      if (!f) return;
      (map[f] = map[f] || []).push(a);
    });
    return map;
  }

  function championsOf(fid) {
    return STK.filter(function (s) { return (s.favors || []).indexOf(fid) >= 0; });
  }

  function renderBoard(st) {
    var rds = readingsByFeature(st);
    var runs = runningByFeature(st);
    var shipped = st.shipped || [];

    var sig = FEAT.map(function (f) {
      var e = roadmapEntry(st, f.id);
      return f.id + ':' + (e ? e.status + ':' + f1(e.progress) + ':' + (e.revisedEstimate || '') : '-') +
        ':' + ((rds[f.id] || []).length) + ':' + ((runs[f.id] || []).length) +
        ':' + (predictions[f.id] ? predictions[f.id].predictedImpact : '');
    }).join('|') + '|' + shipped.length + '|' + (lowTrustEng(st) ? 'L' : '');
    if (sig === boardSig) return;
    boardSig = sig;

    var infl = lowTrustEng(st);
    var html = FEAT.map(function (f) {
      var e = roadmapEntry(st, f.id);
      var status = e ? e.status : 'candidate';
      if (shipped.indexOf(f.id) >= 0) status = 'shipped';
      var slipped = !!(e && num(e.revisedEstimate) && e.revisedEstimate > estCostOf(f.id) + 0.001);
      var kls = 'fcard is-' + status + (slipped && status !== 'shipped' ? ' is-slipped' : '');

      var est = estCostOf(f.id);
      var shownEst = infl && !e ? est * 1.3 : est;
      var estHtml = '<span class="' + (infl && !e ? 'amber' : '') + '">' + f1(shownEst) + 'w</span>';
      if (e && num(e.revisedEstimate) && e.revisedEstimate > est + 0.001) {
        estHtml = '<s class="dim">' + f1(est) + 'w</s> <span class="neg">' + f1(e.revisedEstimate) + 'w</span>';
      }

      var champs = championsOf(f.id).map(function (s) { return s.name.split(' ')[0]; }).join(', ');

      var dots = (rds[f.id] || []).map(function (r) {
        return '<span class="rd" title="' + esc(instName(r.instrument)) + ': ' + f1(r.value) + ' pp">' +
          '<i style="background:' + r.color + '"></i>' + sgn1(r.value) + '</span>';
      }).join('');
      dots += (runs[f.id] || []).map(function (a) {
        return '<span class="rd pending" title="' + esc(instName(rInst(a))) + ' — running, ' +
          aDaysLeft(a) + 'd left"><i style="background:' + instColor(rInst(a)) + '"></i>…</span>';
      }).join('');
      if (!dots) dots = '<span class="fc-none">no readings — you would be building on a hunch</span>';

      var pred = predictions[f.id];
      var acts = '';
      if (status === 'shipped') {
        acts = '<span class="pos" style="font-size:10.5px">SHIPPED</span>';
      } else if (status === 'queued' || status === 'building') {
        acts = '<button class="btn danger tiny" data-act="drop" data-fid="' + esc(f.id) + '">DROP</button>';
      } else {
        acts = '<button class="btn primary tiny" data-act="commit" data-fid="' + esc(f.id) + '">COMMIT</button>';
      }
      acts += '<button class="btn ghost tiny" data-act="study" data-fid="' + esc(f.id) + '">STUDY</button>';

      var prog = '';
      if (e && (status === 'building' || status === 'shipped') && num(e.progress)) {
        prog = '<div class="fc-prog"><i style="width:' + (clamp(e.progress, 0, 1) * 100).toFixed(1) + '%"></i></div>';
      }

      return '<div class="' + kls + '">' +
        '<div class="fc-hd"><span class="fc-nm ell">' + esc(f.name) + '</span>' +
          '<span class="pill ' + esc(status) + '">' + esc(slipped && status !== 'shipped' ? 'slipped' : status) + '</span></div>' +
        '<div class="fc-meta">' +
          (f.tags || []).map(function (t) { return '<span class="tag">' + esc(t) + '</span>'; }).join('') +
          '<span class="fc-sep">·</span>' + estHtml +
          '<span class="fc-sep">·</span><span title="champion">' + esc(champs || 'no champion') + '</span>' +
          (f.pitchedBy ? '<span class="fc-sep">·</span><span class="dim">pitched by ' + esc(f.pitchedBy) + '</span>' : '') +
        '</div>' +
        '<div class="fc-dots">' + dots + '</div>' + prog +
        '<div class="fc-act">' + acts + '<span class="spacer"></span>' +
          (pred ? '<span class="fc-pred">you predicted ' + sgn1(pred.predictedImpact) + ' pp</span>' : '') +
        '</div>' +
      '</div>';
    }).join('');

    setHTML($['b-board'], html);
    var nCommitted = (st.roadmap || []).filter(function (r) {
      return r.status === 'queued' || r.status === 'building';
    }).length;
    setText($['b-count'], (shipped.length) + ' shipped · ' + nCommitted + ' committed · ' +
      (FEAT.length - shipped.length - nCommitted) + ' untouched');
  }

  function lowTrustEng(st) {
    var t = st && st.trust;
    return !!(t && num(t.rina) && t.rina < RULES().lowTrustEng);
  }

  /* ---------- research ---------- */
  function renderResearch(st) {
    st = st || lastState || {};
    var R = RULES();
    var runningActs = (st.research && st.research.running) || [];
    var doneList = (st.research && st.research.done) || [];

    /* feature select */
    var sel = $['rs-feat'];
    if (sel.options.length !== FEAT.length) {
      sel.innerHTML = FEAT.map(function (f) {
        return '<option value="' + esc(f.id) + '">' + esc(f.name) + '</option>';
      }).join('');
    }
    if (rsFeature && sel.value !== rsFeature) sel.value = rsFeature;
    if (!rsFeature) rsFeature = sel.value;

    /* instrument rows */
    var shipped = st.shipped || [];
    var html = INST.map(function (x) {
      var need = !!x.requiresShipped;
      var blocked = need && shipped.indexOf(rsFeature) < 0;
      var already = runningActs.some(function (a) {
        return rFeat(a) === rsFeature && rInst(a) === x.id;
      });
      var n = doneList.filter(function (r) { return rInst(r) === x.id; }).length;
      return '<button class="inst-row' + (rsInstrument === x.id ? ' is-on' : '') +
        (blocked || already ? ' is-off' : '') + '" data-inst="' + esc(x.id) + '" type="button">' +
        '<i style="background:' + instColor(x.id) + '"></i>' +
        '<span class="in-nm">' + esc(x.name) + (n ? ' <span class="dim">×' + n + '</span>' : '') + '</span>' +
        '<span class="in-cost">' + i0(x.days) + 'd' + (blocked ? ' · needs ship' : (already ? ' · running' : '')) + '</span>' +
        '</button>';
    }).join('');
    setHTML($['rs-inst'], html);

    setText($['rs-slots'], runningActs.length + ' / ' + R.researchSlots + ' slots busy');

    /* running activities */
    setHTML($['rs-acts'], runningActs.length
      ? '<div class="lbl" style="margin-top:6px">IN FLIGHT</div>' + runningActs.map(function (a) {
          var pr = aProgress(a);
          return '<div class="act-row"><div class="act-hd">' +
            '<span><i class="rd"><i style="background:' + instColor(rInst(a)) + ';display:inline-block;width:7px;height:7px;border-radius:50%"></i></i> ' +
            esc(instName(rInst(a))) + ' <span class="dim">on</span> ' + esc(featName(rFeat(a))) + '</span>' +
            '<span class="dim num">' + aDaysLeft(a) + 'd left</span></div>' +
            '<div class="act-bar"><i style="width:' + (pr * 100).toFixed(1) + '%"></i></div></div>';
        }).join('')
      : '');

    /* THE CAVEAT — always visible, always before the run. SPEC §6. */
    var inst = byInst[rsInstrument];
    if (!inst) {
      setHTML($['rs-cav'],
        '<div class="caveat empty"><div class="cav-kick"><span>KNOWN BLIND SPOT</span></div>' +
        '<div class="cav-tx">Pick an instrument. Every one of them lies in a direction you can read ' +
        'before you spend the days.</div></div>');
    } else {
      setHTML($['rs-cav'],
        '<div class="caveat"><div class="cav-kick">' +
          '<span>⚠ KNOWN BLIND SPOT · ' + esc(inst.name) + '</span>' +
          '<span>' + i0(inst.days) + ' DAYS</span></div>' +
        '<div class="cav-tx">' + esc(inst.knownCaveat || 'No stated caveat — assume it lies anyway.') + '</div>' +
        '<label class="cav-ack' + (rsAck ? ' is-done' : '') + '">' +
          '<input type="checkbox" id="rs-ack"' + (rsAck ? ' checked' : '') + '>' +
          '<span>' + (rsAck ? 'Acknowledged — running it anyway, with my eyes open.'
                            : 'I have read the blind spot and I am running it anyway.') + '</span>' +
        '</label></div>');
    }
    /* keep the DOM checkbox honest even when setHTML short-circuits an
       identical string (the player may have ticked it by hand since) */
    var cb = id('rs-ack');
    if (cb) cb.checked = rsAck;
    syncRunButton();
  }

  function syncRunButton() {
    var btn = $['rs-run'];
    if (!btn) return;
    var inst = byInst[rsInstrument];
    if (!inst) { btn.disabled = true; btn.textContent = 'PICK AN INSTRUMENT'; return; }
    if (!rsAck) {
      btn.disabled = true;
      btn.textContent = 'ACKNOWLEDGE THE BLIND SPOT FIRST';
      return;
    }
    btn.disabled = false;
    btn.textContent = 'RUN ' + inst.name.toUpperCase() + ' · ' + i0(inst.days) + 'D · ACCEPTING THE BLIND SPOT';
  }

  function rsMsg(html, kind) {
    setHTML($['rs-msg'], html ? '<div class="' + (kind || 'ok') + '-note">' + html + '</div>' : '');
  }

  function runResearch() {
    var inst = byInst[rsInstrument];
    if (!inst) { rsMsg('Pick an instrument first.', 'err'); return; }
    if (!rsAck) { rsMsg('Read the blind spot and acknowledge it before you spend the days.', 'warn'); return; }
    var res = call(function () {
      return P().research({ featureId: rsFeature, instrumentId: rsInstrument });
    }, 'Product.research');
    if (!res) { rsMsg('Product.research() threw — see the bar at the bottom.', 'err'); return; }
    if (res.ok === false) {
      rsMsg(esc(res.error || 'Rejected.'), 'err');
      toast(res.error || 'Research rejected', 'err');
      return;
    }
    rsMsg('Started <b>' + esc(inst.name) + '</b> on <b>' + esc(featName(rsFeature)) +
      '</b> · ' + i0(inst.days) + 'd · blind spot accepted.', 'ok');
    toast('Research started: ' + inst.name + ' on ' + featName(rsFeature), 'info');
    rsAck = false;
    refresh(true);
  }

  /* ---------- roadmap ---------- */
  function renderRoadmap(st) {
    var rm = (st.roadmap || []).filter(function (r) { return r.status !== 'dropped'; });
    var sig = rm.map(function (r) {
      return r.featureId + ':' + r.status + ':' + f2(r.progress) + ':' + (r.revisedEstimate || '');
    }).join('|');
    if (sig === roadSig) return;
    roadSig = sig;

    setText($['rm-count'], rm.length + ' item' + (rm.length === 1 ? '' : 's'));
    if (!rm.length) {
      setHTML($['rm-list'], '<div class="empty-note">Nothing committed. An empty roadmap ships nothing.</div>');
      return;
    }
    var locked = {};
    setHTML($['rm-list'], rm.map(function (r, i) {
      var est = num(r.revisedEstimate) ? r.revisedEstimate : estCostOf(r.featureId);
      var spent = num(r.engWeeksSpent) ? r.engWeeksSpent : 0;
      var slip = num(r.revisedEstimate) && r.revisedEstimate > estCostOf(r.featureId) + 0.001;
      var canMove = r.status === 'queued';
      var canDrop = r.status !== 'shipped' && !r.locked;
      if (r.locked) locked[r.featureId] = 1;
      return '<div class="rm-row is-' + esc(r.status) + '">' +
        '<div class="rm-n num">' + (i + 1) + '</div>' +
        '<div><div class="rm-nm">' + esc(featName(r.featureId)) + '</div>' +
          '<div class="rm-sub num">' + f1(spent) + ' / ' + f1(est) + ' ew' +
          (slip ? ' <span class="slip">SLIP +' + f1(est - estCostOf(r.featureId)) + '</span>' : '') +
          (r.status === 'shipped' ? ' <span class="pos">SHIPPED</span>' : '') +
          (r.locked ? ' <span class="amber">LOCKED</span>' : '') +
          '</div></div>' +
        '<div class="rm-btns">' +
          '<button class="btn tiny" data-rm="up" data-fid="' + esc(r.featureId) + '"' + (canMove && i > 0 ? '' : ' disabled') + '>▲</button>' +
          '<button class="btn tiny" data-rm="down" data-fid="' + esc(r.featureId) + '"' + (canMove && i < rm.length - 1 ? '' : ' disabled') + '>▼</button>' +
          '<button class="btn danger tiny" data-rm="drop" data-fid="' + esc(r.featureId) + '"' + (canDrop ? '' : ' disabled') + '>✕</button>' +
        '</div></div>';
    }).join(''));
  }

  function moveRoadmap(fid, dir) {
    var st = lastState || {};
    var order = (st.roadmap || [])
      .filter(function (r) { return r.status !== 'dropped'; })
      .map(function (r) { return r.featureId; });
    var i = order.indexOf(fid);
    var j = i + dir;
    if (i < 0 || j < 0 || j >= order.length) return;
    var tmp = order[i]; order[i] = order[j]; order[j] = tmp;
    var res = call(function () { return P().setRoadmap(order); }, 'Product.setRoadmap');
    if (res && res.ok === false) { toast(res.error || 'Reorder rejected', 'err'); }
    refresh(true);
  }

  /* ---------- viz ---------- */
  function createViz() {
    vizMain = call(function () {
      return window.Viz.create($['v-canvas'], { theme: 'dark' });
    }, 'Viz.create');
    if (!vizMain) vizErr($['v-err'], 'Viz.create() failed for the evidence canvas.');
    vizGantt = call(function () {
      return window.Viz.create($['g-canvas'], { theme: 'dark' });
    }, 'Viz.create');
    if (!vizGantt) vizErr($['g-err'], 'Viz.create() failed for the gantt canvas.');
    renderLegend();
  }

  function vizErr(node, msg) {
    if (!node) return;
    node.textContent = msg;
    node.classList.remove('hidden');
  }
  function vizOk(node) { if (node) node.classList.add('hidden'); }

  function renderLegend() {
    setHTML($['v-legend'], INST.map(function (x) {
      return '<span class="lg"><i style="background:' + instColor(x.id) + '"></i>' + esc(x.name) + '</span>';
    }).join(''));
  }

  function renderViz(st) {
    if (!st) return;
    var ns = (CO.scenario && CO.scenario.northStar) || {};
    var title, arg, method;

    if (vizTab === 'evidence') {
      method = 'evidence';
      title = 'EVIDENCE · ONE ROW PER FEATURE, ONE DOT PER READING';
      var rds = readingsByFeature(st);
      arg = { rows: FEAT.map(function (f) {
        var pred = predictions[f.id];
        var e = roadmapEntry(st, f.id);
        return {
          feature: f.name,
          featureId: f.id,
          readings: (rds[f.id] || []).map(function (r) {
            return { instrument: r.instrument, value: r.value, color: r.color };
          }),
          predicted: pred ? pred.predictedImpact
                   : (e && num(e.predictedImpact) ? e.predictedImpact : null)
        };
      }) };
    } else if (vizTab === 'impact') {
      method = 'impact';
      title = 'NORTH STAR · ONLY SHIPPED WORK COUNTS';
      arg = {
        baseline: num(ns.baseline) ? ns.baseline : 0,
        projected: num(st.northStarProjected) ? st.northStarProjected : null,
        units: ns.units || 'pp',
        northStar: ns.name || '',
        shipped: (st.shipped || []).map(function (fid) {
          var e = roadmapEntry(st, fid) || {};
          var d = num(e.observedImpact) ? e.observedImpact
                : num(e.impact) ? e.impact
                : (predictions[fid] ? predictions[fid].predictedImpact : null);
          return { id: fid, name: featName(fid), delta: d };
        })
      };
    } else {
      method = 'trust';
      title = 'TRUST · THE RESOURCE YOU SPEND BY SAYING NO';
      var Rraw = (P() && P().RULES) || {};
      arg = {
        lowTrustEng: num(Rraw.lowTrustEng) ? Rraw.lowTrustEng : 40,
        lowTrustCeo: num(Rraw.lowTrustCeo) ? Rraw.lowTrustCeo : 35,
        highTrustFavour: num(Rraw.highTrustFavour) ? Rraw.highTrustFavour : 75,
        stakeholders: STK.map(function (s) {
          var t = st.trust && num(st.trust[s.id]) ? st.trust[s.id] : null;
          var start = num(s.startTrust) ? s.startTrust : 60;
          return { id: s.id, name: s.name, role: s.role, trust: t, delta: num(t) ? t - start : 0 };
        })
      };
    }
    setText($['v-title'], title);
    $['v-legend'].classList.toggle('hidden', vizTab !== 'evidence');

    if (vizMain && typeof vizMain[method] === 'function') {
      var ok = call(function () { vizMain[method](arg); return true; }, 'Viz.' + method);
      if (ok) vizOk($['v-err']); else vizErr($['v-err'], 'Viz.' + method + '() threw.');
    } else {
      vizErr($['v-err'], 'Viz.' + method + '() is not available.');
    }

    if (vizGantt && typeof vizGantt.gantt === 'function') {
      var names = {};
      FEAT.forEach(function (f) { names[f.id] = f.name; });
      var Rg = RULES();
      var ok2 = call(function () {
        vizGantt.gantt({
          roadmap: (st.roadmap || []).map(function (r) {
            var o = {}; for (var k in r) if (Object.prototype.hasOwnProperty.call(r, k)) o[k] = r[k];
            o.name = featName(r.featureId);
            o.estCost = estCostOf(r.featureId);
            return o;
          }),
          names: names,
          week: num(st.week) ? st.week : 1,
          day: num(st.day) ? st.day : 1,
          totalWeeks: Rg.weeks,
          engWeeksPerWeek: Rg.engWeeksPerWeek,
          capacityTotal: Rg.totalCapacity,
          capacityLeft: num(st.capacityLeft) ? st.capacityLeft : 0
        });
        return true;
      }, 'Viz.gantt');
      if (ok2) vizOk($['g-err']); else vizErr($['g-err'], 'Viz.gantt() threw.');
    }
  }

  /* ---------- org feed ---------- */
  /* Org and Product can both surface the same scripted event. Two independent
     keys — the id AND the words — so a duplicate never reaches the feed. */
  function msgKeys(m) {
    if (!m) return [];
    var k = [];
    if (m.id) k.push('id:' + m.id);
    k.push('tx:' + String(m.from || '') + '|' + String(m.text || '').replace(/\s+/g, ' ').trim().slice(0, 90));
    return k;
  }

  function onOrgMessage(m) { pushMsg(m); renderFeed(); }
  function onProductEvent(e) { pushMsg(e); renderFeed(); }

  function pushMsg(m) {
    if (!m || typeof m !== 'object') return;
    if (!String(m.text || '').trim()) return;
    var keys = msgKeys(m);
    for (var i = 0; i < keys.length; i++) if (feedSeen[keys[i]]) return;
    keys.forEach(function (k) { feedSeen[k] = 1; });
    feedMsgs.push(m);
    if (m.tone === 'alarm') toast((m.name || m.from || 'the room') + ': ' + String(m.text || '').slice(0, 90), 'warn');
  }

  function pullOrgFeed() {
    var f = call(function () { return window.Org.getFeed(); }, 'Org.getFeed');
    if (!Array.isArray(f)) return;
    var n = feedMsgs.length;
    f.forEach(pushMsg);
    if (feedMsgs.length !== n) feedSig = null;
  }

  function openEventIds(st) {
    var map = {};
    ((st && st.openEvents) || []).forEach(function (e) {
      if (e && e.id && needsReply(e)) map[e.id] = e;
    });
    return map;
  }

  function replyChoices(ev) {
    var raw = ev && (ev.choices || ev.options);
    if (Array.isArray(raw) && raw.length) {
      return raw.map(function (c) {
        if (typeof c === 'string') return { id: c, label: c.toUpperCase() };
        return { id: c.id || c.value || c.key || String(c.label || ''), label: (c.label || c.text || c.id || '').toUpperCase() };
      });
    }
    return [
      { id: 'commit',  label: 'COMMIT TO IT' },
      { id: 'decline', label: 'SAY NO — WITH A REASON' },
      { id: 'defer',   label: 'DEFER — NOT THIS QUARTER' }
    ];
  }

  function renderFeed() {
    var st = lastState || {};
    var open = openEventIds(st);
    var openKeys = Object.keys(open).sort().join(',');
    var sig = feedMsgs.length + '|' + openKeys + '|' + Object.keys(answered).sort().join(',');
    if (sig === feedSig) return;
    var appendOnly = (feedSig !== null) && openKeys === (renderFeed._lastOpen || '') &&
                     feedDrawn < feedMsgs.length;
    feedSig = sig;
    renderFeed._lastOpen = openKeys;

    var body = $['fd-body'];
    var stick = body.scrollTop + body.clientHeight >= body.scrollHeight - 40;

    if (!appendOnly) { body.innerHTML = ''; feedDrawn = 0; }

    /* pinned escalation banner */
    var pins = Object.keys(open);
    var pinEl = q('.esc-pin', body);
    if (pinEl) pinEl.remove();
    if (pins.length) {
      var p = h('<div class="esc-pin" data-scroll-to="' + esc(pins[0]) + '">' +
        '<span>▲ ' + pins.length + ' escalation' + (pins.length === 1 ? '' : 's') + ' waiting on you</span>' +
        '<span class="dim">ignoring one costs trust</span></div>');
      body.insertBefore(p, body.firstChild);
    }

    for (var i = feedDrawn; i < feedMsgs.length; i++) {
      body.appendChild(msgEl(feedMsgs[i], open));
    }
    feedDrawn = feedMsgs.length;

    if (!feedMsgs.length) {
      body.appendChild(h('<div class="empty-note">The room is quiet. It will not stay quiet.</div>'));
    }
    setText($['fd-count'], feedMsgs.length + ' messages');
    renderTrustStrip(st);
    if (stick) body.scrollTop = body.scrollHeight;
  }

  function msgEl(m, open) {
    var from = String(m.from || 'SYS').toUpperCase();
    var isOpen = m.id && open[m.id];
    var wasAnswered = m.id && answered[m.id];
    var el = document.createElement('div');
    el.className = 'msg from-' + from.replace(/[^A-Z]/g, '') + ' tone-' + esc(m.tone || 'neutral') +
      (isOpen ? ' needs-reply' : '');
    if (m.id) el.setAttribute('data-msgid', m.id);
    var who = m.name || ROLE_LABEL[from] || from;
    var role = ROLE_LABEL[from] || from;
    var html =
      '<div class="msg-hd"><span class="msg-who">' + esc(who) + '</span>' +
      '<span class="msg-tm num">' + esc(m.t || ('W' + (m.week || '?') + ' D' + (m.day || '?'))) + '</span></div>' +
      (String(who).toUpperCase() === String(role).toUpperCase()
        ? '' : '<div class="msg-role">' + esc(role) + '</div>') +
      '<div class="msg-tx">' + esc(m.text || '') + '</div>';
    if (isOpen) {
      html += '<div class="reply-row"><span class="reply-lbl">THEY ARE WAITING ON YOU</span>' +
        replyChoices(open[m.id]).map(function (c) {
          return '<button class="btn warn tiny" data-reply="' + esc(c.id) + '" data-evid="' + esc(m.id) + '">' +
            esc(c.label) + '</button>';
        }).join('') + '</div>';
    } else if (wasAnswered) {
      html += '<div class="reply-row"><span class="reply-lbl">YOU ANSWERED</span>' +
        '<span class="dim" style="font-size:11px">' + esc(String(answered[m.id]).toUpperCase()) + '</span></div>';
    }
    el.innerHTML = html;
    return el;
  }

  /* An escalation is answered with a stance AND a reason. Saying no with a
     reason costs half what saying no with a process costs — SPEC §4. */
  function respondTo(eventId, choice) {
    if (!eventId) return;
    var st = lastState || {};
    var ev = null;
    ((st.openEvents) || []).forEach(function (e) { if (e && e.id === eventId) ev = e; });
    var R = RULES();
    var label = { commit: 'COMMIT TO IT', decline: 'SAY NO', defer: 'DEFER' }[choice] ||
                String(choice).toUpperCase();
    var isNo = (choice === 'decline' || choice === 'defer');

    var body =
      (ev ? '<div class="msg from-' + esc(String(ev.from || 'SYS').toUpperCase().replace(/[^A-Z]/g, '')) +
            ' tone-' + esc(ev.tone || 'neutral') + '" style="margin-bottom:12px">' +
            '<div class="msg-hd"><span class="msg-who">' + esc(ev.name || ev.from || '') + '</span>' +
            '<span class="msg-tm num">' + esc(ev.t || '') + '</span></div>' +
            '<div class="msg-tx">' + esc(ev.text || '') + '</div></div>' : '') +
      '<div class="cm-fld"><div class="lbl"><span>YOUR ANSWER</span>' +
        '<span class="cyan">' + esc(label) + '</span></div></div>' +
      '<div class="cm-fld"><div class="lbl"><span>THE REASON YOU GIVE THEM</span>' +
        '<span class="' + (isNo ? 'req' : 'dim') + '" id="rp-req">' +
        (isNo ? 'STRONGLY ADVISED · MIN ' + R.minRationaleChars + ' CHARS' : 'OPTIONAL') + '</span></div>' +
        '<textarea id="rp-rat" maxlength="600" placeholder="What you are doing instead, and why. Name the tradeoff, not the process."></textarea></div>' +
      (isNo
        ? '<div class="warn-note">A no with a reason costs about <b>' + Math.round(R.trustHitForNo / 2) +
          '</b> trust. A no with a process costs <b>' + R.trustHitForNo + '</b>. ' +
          'They are not annoyed that you said no. They are annoyed when they cannot tell why.</div>'
        : '<div class="note">Saying yes to this buys trust and spends capacity. Both are real.</div>');

    openModal({
      title: 'REPLY · ' + (ev && ev.name ? String(ev.name).toUpperCase() : 'ESCALATION'),
      bodyHtml: body,
      okText: 'SEND IT',
      okClass: isNo ? 'warn' : 'primary',
      cancelText: 'NOT YET',
      focusSel: '#rp-rat',
      onOk: function (api) {
        var rat = q('#rp-rat', api.el);
        var reason = (rat.value || '').trim();
        var res = call(function () {
          return P().respond({ eventId: eventId, choice: choice, rationale: reason });
        }, 'Product.respond');
        if (!res) { api.error('Product.respond() threw — see the bar at the bottom.'); return false; }
        if (res.ok === false) { api.error(res.error || 'That response was rejected.'); return false; }
        answered[eventId] = choice;
        var d = num(res.trustDelta) ? res.trustDelta : null;
        toast('Answered: ' + label + (d !== null ? ' · trust ' + sgn1(d) : ''),
          d !== null && d < 0 ? 'warn' : 'ok');
        feedSig = null;
        refresh(true);
        return true;
      }
    });
  }

  function renderTrustStrip(st) {
    var html = STK.map(function (s) {
      var t = st.trust && num(st.trust[s.id]) ? st.trust[s.id] : NaN;
      var start = num(s.startTrust) ? s.startTrust : 60;
      var d = num(t) ? t - start : 0;
      var k = !num(t) ? 'dim' : (t < 35 ? 'neg' : t < 50 ? 'amber' : t >= 75 ? 'pos' : '');
      var initials = s.name.split(' ').map(function (w) { return w.charAt(0); }).join('');
      return '<div class="stk" title="' + esc(s.name + ' — ' + s.role) + '">' +
        '<span class="n">' + esc(initials) + '</span>' +
        '<span class="v num ' + k + '">' + i0(t) + '</span>' +
        '<span class="d num ' + cls(d) + '">' + (Math.abs(d) < 0.5 ? '·' : sgn1(d)) + '</span></div>';
    }).join('');
    setHTML($['fd-stk'], html);
  }

  /* ---------- product events ---------- */
  function onReading(r) {
    if (!r) { refresh(true); return; }
    var v = rVal(r);
    toast(instName(rInst(r)) + ' → ' + featName(rFeat(r)) + ': ' + sgn1(v) + ' pp', 'info');
    boardSig = null;
    refresh(false);
  }
  function onShip(e) {
    var fid = e && (e.featureId || e.id) || '';
    toast('SHIPPED · ' + featName(fid), 'ok');
    boardSig = roadSig = null;
    refresh(false);
  }
  function onSlip(e) {
    var fid = e && (e.featureId || e.id) || '';
    var rev = e && (e.revisedEstimate || e.revised);
    toast('SLIP · ' + featName(fid) + ' now looks like ' + f1(rev) + ' eng-weeks. A slip is a decision point.', 'warn');
    boardSig = roadSig = hdrSig = null;
    refresh(false);
  }
  function onTrustEvent(e) {
    if (e && e.who && num(e.delta) && Math.abs(e.delta) >= 1) {
      var s = byStk[e.who];
      toast((s ? s.name : e.who) + ' trust ' + sgn1(e.delta) + (e.reason ? ' — ' + e.reason : ''),
        e.delta < 0 ? 'warn' : 'ok');
    }
    hdrSig = null;
    refresh(false);
  }

  /* ---------- toasts ---------- */
  function toast(text, kind) {
    if (!$['toasts']) return;
    var t = document.createElement('div');
    t.className = 'toast ' + (kind || 'info');
    t.textContent = text;
    $['toasts'].appendChild(t);
    while ($['toasts'].children.length > 2) $['toasts'].removeChild($['toasts'].firstChild);
    var mine = ++toastSeq;
    setTimeout(function () {
      t.style.transition = 'opacity .3s'; t.style.opacity = '0';
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 320);
    }, 3000 + (mine % 3) * 120);
  }

  /* ================================================================== */
  /* MODALS                                                             */
  /* ================================================================== */
  function openModal(opt) {
    var layer = id('modal-layer');
    var bg = q('.modal-bg', layer);
    var m = document.createElement('div');
    m.className = 'modal' + (opt.gate ? ' gate' : '') + (opt.danger ? ' danger' : '');
    m.innerHTML =
      '<div class="modal-hd"><h3>' + esc(opt.title || '') + '</h3>' +
        (opt.dismissable === false ? '<span class="gate-paused">● clock paused</span>'
                                   : '<button class="btn ghost" data-x>ESC</button>') +
      '</div>' +
      '<div class="modal-bd">' + (opt.bodyHtml || '') + '</div>' +
      '<div class="modal-ft">' +
        '<div style="flex:1 1 auto" data-err></div>' +
        (opt.cancelText ? '<button class="btn ghost" data-cancel>' + esc(opt.cancelText) + '</button>' : '') +
        '<button class="btn ' + (opt.okClass || 'primary') + ' big" data-ok>' + esc(opt.okText || 'OK') + '</button>' +
      '</div>';
    bg.innerHTML = '';
    bg.appendChild(m);
    layer.classList.add('active');
    modalOpen++;

    var closed = false;
    var close = function () {
      if (closed) return;
      closed = true;
      modalOpen = Math.max(0, modalOpen - 1);
      layer.classList.remove('active');
      bg.innerHTML = '';
      document.removeEventListener('keydown', keyh, true);
    };
    var api = {
      el: m,
      body: q('.modal-bd', m),
      close: close,
      error: function (msg) {
        var box = q('[data-err]', m);
        if (box) box.innerHTML = msg ? '<div class="err-note">' + esc(msg) + '</div>' : '';
      }
    };

    var okBtn = q('[data-ok]', m);
    on(okBtn, 'click', function () {
      if (opt.onOk && opt.onOk(api) === false) return;
      close();
    });
    var cancelBtn = q('[data-cancel]', m);
    if (cancelBtn) on(cancelBtn, 'click', function () { close(); if (opt.onCancel) opt.onCancel(); });
    var xBtn = q('[data-x]', m);
    if (xBtn) on(xBtn, 'click', function () { close(); if (opt.onCancel) opt.onCancel(); });

    function keyh(ev) {
      if (ev.key === 'Escape' && opt.dismissable !== false) {
        ev.preventDefault(); ev.stopPropagation(); close(); if (opt.onCancel) opt.onCancel();
      } else if (ev.key === 'Enter' && !ev.shiftKey) {
        var tag = ev.target && ev.target.tagName;
        if (tag === 'TEXTAREA') return;
        ev.preventDefault(); ev.stopPropagation();
        if (opt.onOk && opt.onOk(api) === false) return;
        close();
      }
    }
    document.addEventListener('keydown', keyh, true);
    setTimeout(function () {
      var focus = opt.focusSel ? q(opt.focusSel, m) : okBtn;
      try { (focus || okBtn).focus(); } catch (e) {}
    }, 30);
    if (opt.onOpen) opt.onOpen(api);
    return api;
  }

  /* ---------- gates ---------- */
  function checkGates() {
    var st = lastState;
    if (!st || quarterOver || modalOpen) return;
    var wk = num(st.week) ? st.week : 1;
    for (var i = 0; i < GATES.length; i++) {
      var g = GATES[i];
      if (gateFired[g.id] || g.id === 'qbr') continue;
      if (wk >= (num(g.week) ? g.week : 99)) {
        gateFired[g.id] = true;
        showGate(g);
        return;
      }
    }
  }

  function showGate(g, onContinue) {
    var wasRunning = running;
    enginePause();
    pausedByModal = true;

    var items = GATE_CHECKLIST[g.id] || [];
    var st = lastState || {};
    var ci = capacityInfo(st);
    var body =
      '<div class="gate-kicker">WEEK ' + esc(g.week) + ' · ' + esc(g.title || 'GATE') + '</div>' +
      '<p class="gate-prompt">' + esc(g.prompt || '') + '</p>' +
      (items.length ? '<div class="lbl" style="margin-bottom:5px">INCLUDE</div><ul class="gate-list">' +
        items.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '') +
      '<div class="blk" style="margin-top:14px;padding:9px 11px">' +
        '<div class="stat-grid">' +
          statBlk('WEEK', esc(st.t || '—')) +
          statBlk('SHIPPED', String((st.shipped || []).length)) +
          statBlk('COMMITTED EW', f1(ci.committed)) +
          statBlk('FREE EW', '<span class="' + (ci.over > 0 ? 'neg' : '') + '">' + f1(ci.left) + '</span>') +
          statBlk('READINGS', String(((st.research && st.research.done) || []).length)) +
          statBlk('AVG TRUST', i0(st.avgTrust)) +
        '</div></div>' +
      '<div style="margin-top:14px"><span class="gate-paused">● clock paused</span> ' +
      '<span class="gate-clock">The quarter waits. Go and post it, then come back.</span></div>';

    pushMsg({ id: 'gate:' + g.id, from: 'SYS', name: 'Gate', t: st.t || ('W' + g.week),
              day: st.day, week: g.week,
              text: (g.title || 'Gate') + ' — ' + (g.prompt || ''), tone: 'neutral' });
    feedSig = null;
    renderFeed();

    openModal({
      gate: true,
      title: (g.title || 'GATE').toUpperCase(),
      bodyHtml: body,
      okText: "I'VE POSTED IT — CONTINUE",
      okClass: 'primary',
      dismissable: false,
      onOk: function () {
        pausedByModal = false;
        if (onContinue) { onContinue(); return; }
        if (wasRunning && !quarterOver) engineStart(); else updateTransport();
      }
    });
  }

  function statBlk(label, v) {
    return '<div class="stat"><span class="lbl">' + esc(label) + '</span><div class="v num">' + v + '</div></div>';
  }

  /* ---------- commit dialog (the calibration record) ---------- */
  function openCommitDialog(fid) {
    var f = byFeat[fid];
    if (!f) return;
    var st = lastState || {};
    var ci = capacityInfo(st);
    var R = RULES();
    var est = estCostOf(fid);
    var after = ci.committed + est;
    var overAfter = after - ci.left;
    var rds = (readingsByFeature(st)[fid]) || [];
    var champs = championsOf(fid);
    var opposed = STK.filter(function (s) { return (s.opposes || []).indexOf(fid) >= 0; });

    var evHtml;
    if (rds.length) {
      var vals = rds.map(function (r) { return r.value; }).filter(num);
      var spread = vals.length > 1 ? Math.max.apply(null, vals) - Math.min.apply(null, vals) : 0;
      evHtml = '<div class="cm-ev"><span class="lbl">WHAT YOUR INSTRUMENTS SAID</span>' +
        '<div class="rdrow">' + rds.map(function (r) {
          return '<span class="rd" title="' + esc(instName(r.instrument)) + '"><i style="background:' + r.color + '"></i>' +
            esc(instName(r.instrument)) + ' ' + sgn1(r.value) + '</span>';
        }).join('') + '</div>' +
        (spread > 3
          ? '<div class="warn-note" style="margin-top:7px">Your instruments disagree by ' + f1(spread) +
            ' pp about this feature. At least one of them is lying to you in a direction you can name. ' +
            'A third instrument is cheaper than a wasted quarter.</div>'
          : '') +
        '</div>';
    } else {
      evHtml = '<div class="cm-ev"><span class="lbl">WHAT YOUR INSTRUMENTS SAID</span>' +
        '<div class="warn-note" style="margin-top:5px">Nothing. You have run no research on this feature. ' +
        'You are about to spend ' + f1(est) + ' eng-weeks on a hunch.</div></div>';
    }

    var body =
      '<div class="cm-hd"><span class="cm-nm">' + esc(f.name) + '</span>' +
        '<span>' + (f.tags || []).map(function (t) { return '<span class="tag">' + esc(t) + '</span>'; }).join(' ') + '</span></div>' +
      '<p class="cm-desc">' + esc(f.desc || '') + '</p>' +
      '<div class="cm-grid">' +
        statBlk('ESTIMATE', f1(est) + ' ew') +
        statBlk('COMMITTED NOW', f1(ci.committed) + ' ew') +
        statBlk('AFTER THIS', '<span class="' + (overAfter > 0 ? 'neg' : '') + '">' + f1(after) + ' ew</span>') +
        statBlk('CAPACITY LEFT', f1(ci.left) + ' ew') +
      '</div>' +
      (overAfter > 0
        ? '<div class="err-note" style="margin-bottom:12px">⚠ This puts you <b>' + f1(overAfter) +
          ' eng-weeks over</b> what is left in the quarter. Something on this roadmap will not ship, ' +
          'and half-built is worth exactly zero.</div>'
        : '') +
      evHtml +
      '<div class="cm-fld"><div class="lbl"><span>PREDICTED IMPACT ON ' +
        esc((CO.scenario.northStar && CO.scenario.northStar.name) || 'THE NORTH STAR') +
        ' (PP)</span><span class="req" id="cm-ireq">REQUIRED</span></div>' +
        '<input type="number" id="cm-impact" step="0.1" placeholder="0.0" autocomplete="off">' +
        '<div class="note" style="margin-top:4px">This is the calibration record. At the QBR you will be ' +
        'shown what it was actually worth, next to this number.</div></div>' +
      '<div class="cm-fld"><div class="lbl"><span>RATIONALE</span>' +
        '<span class="req" id="cm-rreq">REQUIRED · MIN ' + R.minRationaleChars + ' CHARS</span></div>' +
        '<textarea id="cm-rat" class="needed" maxlength="600" placeholder="Why this, why now, and what evidence you are leaning on. Name the instrument. Name what would make you wrong."></textarea></div>' +
      (champs.length || opposed.length
        ? '<div class="note">Champions: <b>' + esc(champs.map(function (s) { return s.name; }).join(', ') || 'none') + '</b>' +
          (opposed.length ? ' · Against it: <b>' + esc(opposed.map(function (s) { return s.name; }).join(', ')) + '</b>' : '') + '</div>'
        : '');

    openModal({
      title: 'COMMIT · ' + (f.name || '').toUpperCase(),
      bodyHtml: body,
      okText: 'COMMIT TO THE ROADMAP',
      okClass: 'primary',
      cancelText: 'CANCEL',
      focusSel: '#cm-impact',
      onOpen: function (api) {
        var rat = q('#cm-rat', api.el), imp = q('#cm-impact', api.el);
        var sync = function () {
          var n = (rat.value || '').trim().length;
          var okr = n >= R.minRationaleChars;
          rat.classList.toggle('needed', !okr);
          var rq = q('#cm-rreq', api.el);
          rq.className = okr ? 'okc' : 'req';
          rq.textContent = okr ? ('OK · ' + n + ' CHARS') : ('REQUIRED · ' + n + '/' + R.minRationaleChars);
          var iq = q('#cm-ireq', api.el);
          var oki = imp.value !== '' && isFinite(parseFloat(imp.value));
          iq.className = oki ? 'okc' : 'req';
          iq.textContent = oki ? 'OK' : 'REQUIRED';
        };
        on(rat, 'input', sync); on(imp, 'input', sync); sync();
      },
      onOk: function (api) {
        var imp = q('#cm-impact', api.el), rat = q('#cm-rat', api.el);
        var pi = parseFloat(imp.value);
        var rationale = (rat.value || '').trim();
        if (imp.value === '' || !isFinite(pi)) {
          api.error('Predicted impact required — a number, in percentage points.');
          try { imp.focus(); } catch (e) {}
          return false;
        }
        if (rationale.length < R.minRationaleChars) {
          api.error('Rationale required — at least ' + R.minRationaleChars + ' characters. ' +
                    'You currently have ' + rationale.length + '.');
          try { rat.focus(); } catch (e) {}
          return false;
        }
        var res = call(function () {
          return P().commit({ featureId: fid, predictedImpact: pi, rationale: rationale });
        }, 'Product.commit');
        if (!res) { api.error('Product.commit() threw — see the bar at the bottom.'); return false; }
        if (res.ok === false) { api.error(res.error || 'Commit rejected.'); return false; }
        predictions[fid] = { predictedImpact: pi, rationale: rationale, day: (lastState || {}).day };
        toast('Committed: ' + f.name + ' · you predicted ' + sgn1(pi) + ' pp', 'ok');
        refresh(true);
        return true;
      }
    });
  }

  /* ---------- drop dialog ---------- */
  function openDropDialog(fid) {
    var f = byFeat[fid];
    if (!f) return;
    var st = lastState || {};
    var e = roadmapEntry(st, fid);
    var champs = championsOf(fid);
    var spent = e && num(e.engWeeksSpent) ? e.engWeeksSpent : 0;
    var R = RULES();

    var body =
      '<p class="gate-prompt">Drop <b>' + esc(f.name) + '</b> from the roadmap?</p>' +
      (spent > 0.01
        ? '<div class="err-note" style="margin-bottom:12px">' + f1(spent) + ' eng-weeks have already gone into ' +
          'this. Dropping it now writes all of them off — unshipped work is worth exactly zero.</div>'
        : '') +
      (champs.length
        ? '<div class="warn-note" style="margin-bottom:12px">Championed by <b>' +
          esc(champs.map(function (s) { return s.name + ' (' + s.role + ')'; }).join(', ')) +
          '</b>. Saying no costs about ' + R.trustHitForNo + ' trust with each of them. ' +
          'Saying no with a reason is still saying no — but they remember which one you did.</div>'
        : '<div class="note" style="margin-bottom:12px">Nobody in the room is championing this one.</div>') +
      '<div class="note">You can commit to it again later if capacity allows.</div>';

    openModal({
      danger: true,
      title: 'DROP · ' + (f.name || '').toUpperCase(),
      bodyHtml: body,
      okText: 'DROP IT',
      okClass: 'danger',
      cancelText: 'KEEP IT',
      onOk: function (api) {
        var res = call(function () { return P().drop(fid); }, 'Product.drop');
        if (!res) { api.error('Product.drop() threw — see the bar at the bottom.'); return false; }
        if (res.ok === false) { api.error(res.error || 'Drop rejected.'); return false; }
        toast('Dropped: ' + f.name, 'warn');
        refresh(true);
        return true;
      }
    });
  }

  /* ================================================================== */
  /* SCREEN 3 — QBR                                                     */
  /* ================================================================== */
  var QBR_HTML =
    '<div class="screen center-screen" id="scr-qbr">' +
      '<div class="scrollwrap"><div class="qbr-wrap">' +
        '<div class="brief-hd"><h2>QUARTERLY BUSINESS REVIEW</h2>' +
          '<div class="dim" id="qb-count">the quarter is closed · nothing else ships</div></div>' +
        '<div class="rule"></div>' +
        '<div class="qbr-grid">' +
          '<div>' +
            '<div class="blk"><h3>The narrative — what you did and why</h3>' +
              '<textarea id="qb-narr" maxlength="4000" placeholder="What you chose, what the evidence said, what you cut and who you told. Where you were wrong, and when you found out. Marguerite has never once been annoyed by a PM who told her they were wrong early."></textarea>' +
              '<div class="note" style="margin-top:6px" id="qb-narrcount"></div>' +
            '</div>' +
            '<div class="blk"><h3>Claimed impact on the north star (pp)</h3>' +
              '<input type="number" id="qb-claim" step="0.1" placeholder="0.0" autocomplete="off">' +
              '<div class="qbr-hint" style="margin-top:6px">The delta you are claiming you moved ' +
              '<b id="qb-nsname">the number</b> by, against the baseline. Only shipped work counts. ' +
              'You will be scored on how honest this is, not on how big it is.</div>' +
            '</div>' +
            '<div id="qb-msg"></div>' +
            '<div class="foot-row">' +
              '<div class="note">Submitting reveals the ground truth. There is no going back.</div>' +
              '<button class="btn primary big" id="qb-submit">SUBMIT THE QBR</button>' +
            '</div>' +
          '</div>' +
          '<div><div class="blk"><h3>The facts, as your systems have them</h3>' +
            '<div id="qb-facts"></div></div></div>' +
        '</div>' +
      '</div></div>' +
    '</div>';

  function wireQBR() {
    on($['qb-submit'], 'click', submitQBR);
    on($['qb-narr'], 'input', function () {
      var n = ($['qb-narr'].value || '').trim().length;
      id('qb-narrcount').textContent = n + ' characters';
    });
  }

  function onQuarterEnd() {
    if (quarterOver) return;
    quarterOver = true;
    enginePause();
    pullState();
    renderQBR();
    showScreen('qbr');
  }

  function renderQBR() {
    var st = lastState || {};
    var ns = (CO.scenario && CO.scenario.northStar) || {};
    var ci = capacityInfo(st);
    id('qb-nsname').textContent = ns.name || 'the number';

    var shipped = st.shipped || [];
    var unfinished = (st.roadmap || []).filter(function (r) {
      return r.status === 'building' || (r.status === 'queued' && num(r.engWeeksSpent) && r.engWeeksSpent > 0);
    });
    var wasted = unfinished.reduce(function (a, r) { return a + (num(r.engWeeksSpent) ? r.engWeeksSpent : 0); }, 0);
    var done = (st.research && st.research.done) || [];
    var byI = {};
    done.forEach(function (r) { byI[rInst(r)] = (byI[rInst(r)] || 0) + 1; });

    var html =
      '<div class="stat-grid" style="margin-bottom:12px">' +
        statBlk('SHIPPED', String(shipped.length)) +
        statBlk('UNFINISHED', String(unfinished.length)) +
        statBlk('WASTED EW', '<span class="' + (wasted > 0 ? 'neg' : '') + '">' + f1(wasted) + '</span>') +
        statBlk('SPENT EW', f1(ci.used)) +
        statBlk('READINGS', String(done.length)) +
        statBlk('AVG TRUST', i0(st.avgTrust)) +
      '</div>' +
      '<div class="lbl" style="margin-bottom:4px">SHIPPED</div>' +
      (shipped.length
        ? '<table class="tbl"><tbody>' + shipped.map(function (fid) {
            var p = predictions[fid];
            return '<tr><td>' + esc(featName(fid)) + '</td><td class="r dim num">' +
              (p ? 'you predicted ' + sgn1(p.predictedImpact) + ' pp' : 'no prediction on record') + '</td></tr>';
          }).join('') + '</tbody></table>'
        : '<div class="empty-note">Nothing shipped. The north star did not move.</div>') +
      '<div class="lbl" style="margin:12px 0 4px">UNFINISHED — WORTH ZERO</div>' +
      (unfinished.length
        ? '<table class="tbl"><tbody>' + unfinished.map(function (r) {
            return '<tr><td>' + esc(featName(r.featureId)) + '</td><td class="r neg num">' +
              f1(r.engWeeksSpent) + ' ew burned</td></tr>';
          }).join('') + '</tbody></table>'
        : '<div class="empty-note">Nothing half-built. Good.</div>') +
      '<div class="lbl" style="margin:12px 0 4px">INSTRUMENTS USED</div>' +
      '<table class="tbl"><tbody>' + INST.map(function (x) {
        var n = byI[x.id] || 0;
        return '<tr><td><span class="rd"><i style="background:' + instColor(x.id) + '"></i></span> ' +
          esc(x.name) + '</td><td class="r num ' + (n ? '' : 'dim') + '">' + n + '</td></tr>';
      }).join('') + '</tbody></table>' +
      '<div class="lbl" style="margin:12px 0 4px">TRUST</div>' +
      STK.map(function (s) {
        var t = st.trust && num(st.trust[s.id]) ? st.trust[s.id] : NaN;
        return '<div class="trust-row"><span class="ell">' + esc(s.name) + '</span>' +
          '<span class="trust-bar"><i class="' + (t < 35 ? 'low' : t < 55 ? 'mid' : '') +
          '" style="width:' + clamp(num(t) ? t : 0, 0, 100) + '%"></i></span>' +
          '<span class="num">' + i0(t) + '</span></div>';
      }).join('');

    setHTML($['qb-facts'], html);
    setHTML($['qb-msg'], '');
  }

  function submitQBR() {
    if (qbrDone) return;
    var narrative = ($['qb-narr'].value || '').trim();
    var claimRaw = $['qb-claim'].value;
    var claimed = parseFloat(claimRaw);
    if (narrative.length < 40) {
      setHTML($['qb-msg'], '<div class="err-note">Write the narrative first — at least 40 characters. ' +
        'You have ' + narrative.length + '. The number without the reasoning is not a QBR.</div>');
      $['qb-narr'].focus();
      return;
    }
    if (claimRaw === '' || !isFinite(claimed)) {
      setHTML($['qb-msg'], '<div class="err-note">Claimed impact required — a number, in percentage points. ' +
        'Zero is an acceptable answer if nothing shipped.</div>');
      $['qb-claim'].focus();
      return;
    }
    var s = call(function () {
      return P().submitQBR({ narrative: narrative, claimedImpact: claimed });
    }, 'Product.submitQBR');
    if (!s) { setHTML($['qb-msg'], '<div class="err-note">Product.submitQBR() threw — see the bar at the bottom.</div>'); return; }
    if (s.ok === false) { setHTML($['qb-msg'], '<div class="err-note">' + esc(s.error || 'Rejected.') + '</div>'); return; }
    qbrDone = true;
    score = (s && s.score) ? s.score : s;
    pullState();
    /* the screen must be VISIBLE before the truth canvas is measured, or it
       lays itself out against a zero-sized box */
    showScreen('debrief');
    renderDebrief();
    /* the week-12 gate lands here, with the copy button behind it */
    var g = null;
    for (var i = 0; i < GATES.length; i++) if (GATES[i].id === 'qbr') g = GATES[i];
    if (g && !gateFired[g.id]) { gateFired[g.id] = true; setTimeout(function () { showGate(g); }, 260); }
  }

  /* ================================================================== */
  /* SCREEN 4 — DEBRIEF                                                 */
  /* ================================================================== */
  var DEBRIEF_HTML =
    '<div class="screen center-screen" id="scr-debrief">' +
      '<div class="scrollwrap"><div class="db-wrap">' +
        '<div class="brief-hd"><h2 id="db-title">DEBRIEF — THE QUARTER, AS IT ACTUALLY WAS</h2>' +
          '<div class="dim" id="db-sub"></div></div>' +
        '<div class="db-hero">' +
          '<div><div class="grade-big" id="db-grade">—</div><div class="grade-sub" id="db-gradesub">GRADE</div></div>' +
          '<div class="db-kv" id="db-kv"></div>' +
        '</div>' +
        '<div id="db-caps"></div>' +
        '<div class="blk"><h3>Where each instrument lied — true impact against every reading</h3>' +
          '<div class="truth-host" id="db-truth">' +
            '<canvas id="db-truthcanvas"></canvas>' +
            '<div class="viz-err hidden" id="db-trutherr"></div>' +
          '</div>' +
          '<div class="note" style="margin-top:8px">Grouped by instrument. The systematic offset in each ' +
          'group is the bias you were reading through all quarter — it was there before you started, ' +
          'and it was written on the tin.</div>' +
        '</div>' +
        '<div class="db-grid" style="margin-top:12px">' +
          '<div>' +
            '<div class="blk"><h3>Per-feature verdict</h3>' +
              '<div class="tbl-wrap" style="max-height:none"><table class="tbl"><thead><tr>' +
                '<th>FEATURE</th><th class="r">EVIDENCE SAID</th><th class="r">YOU PREDICTED</th>' +
                '<th class="r">TRUTH</th><th class="r">ERROR</th><th>SHIPPED</th><th>VERDICT</th>' +
              '</tr></thead><tbody id="db-verdict"></tbody></table></div>' +
              '<div class="note" style="margin-top:7px"><b>Evidence said</b> is the mean of every reading you ' +
              'took on that feature — the number your instruments handed you. <b>Truth</b> is what it was ' +
              'actually worth. The gap between those two columns is the whole exercise.</div>' +
            '</div>' +
            '<div class="blk"><h3>What was actually true</h3><div id="db-notes"></div></div>' +
          '</div>' +
          '<div>' +
            '<div class="blk"><h3>Calibration</h3>' +
              '<div id="db-calibsum"></div>' +
              '<div class="tbl-wrap" style="max-height:230px;margin-top:8px"><table class="tbl"><thead><tr>' +
                '<th>FEATURE</th><th class="r">PREDICTED</th><th class="r">TRUE</th><th class="r">ERR</th>' +
              '</tr></thead><tbody id="db-calib"></tbody></table></div>' +
            '</div>' +
            '<div class="blk"><h3>Trust ledger</h3><div id="db-trust"></div></div>' +
            '<div class="blk"><h3>Instruments you reached for</h3><div id="db-inst"></div></div>' +
            '<div class="blk"><h3>Take it to chat</h3>' +
              '<p class="note">Copy the QBR markdown and paste it into your chat. Defend the quarter, ' +
              'then go line by line through what you predicted and what was true.</p>' +
              '<button class="btn primary wide big" id="db-copy" style="margin-top:8px">COPY QBR MARKDOWN</button>' +
              '<div id="db-copystatus" class="note" style="margin-top:6px"></div>' +
              '<div id="db-copyarea" class="hidden">' +
                '<div class="lbl" style="margin-bottom:4px">SELECT ALL AND COPY MANUALLY</div>' +
                '<textarea id="db-md" spellcheck="false"></textarea>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div></div>' +
    '</div>';

  function wireDebrief() {
    on($['db-copy'], 'click', copyQBR);
  }

  function renderDebrief() {
    var sc = score || {};
    var st = lastState || {};
    var ns = (CO.scenario && CO.scenario.northStar) || {};

    var grade = String(sc.grade || '?').toUpperCase();
    $['db-grade'].className = 'grade-big grade-' + (grade.charAt(0) || '');
    setText($['db-grade'], grade);
    setText($['db-gradesub'], 'REGRET ' + f2(sc.regret) + ' OF ' + f1(sc.bestPossible) + ' PP AVAILABLE');
    setText($['db-sub'], (CO.scenario.company || '') + ' · ' + (ns.name || '') +
      ' · baseline ' + f1(ns.baseline));

    var trust = sc.trust || {};
    setHTML($['db-kv'],
      kv('NORTH STAR ACTUAL', f1(sc.northStarActual) + ' <span class="dim" style="font-size:11px">pp</span>') +
      kv('DELTA', '<span class="' + cls(sc.delta) + '">' + sgn1(sc.delta) + '</span>') +
      kv('BEST POSSIBLE', '+' + f1(sc.bestPossible)) +
      kv('REGRET', '<span class="' + (sc.regret > 0.5 ? 'neg' : 'pos') + '">' + f2(sc.regret) + '</span>') +
      kv('SHIPPED', String((sc.shippedSet || st.shipped || []).length)) +
      kv('WASTED CAPACITY', '<span class="' + (sc.wastedCapacity > 0 ? 'neg' : '') + '">' + f1(sc.wastedCapacity) + ' ew</span>') +
      kv('VANITY SHIPPED', '<span class="' + ((sc.vanityShipped || []).length >= 2 ? 'neg' : '') + '">' +
        (sc.vanityShipped || []).length + '</span>') +
      kv('MISSED WINS', String((sc.missedWins || []).length)) +
      kv('AVG TRUST', '<span class="' + (num(trust.avg) && trust.avg < 40 ? 'neg' : '') + '">' + i0(trust.avg) + '</span>') +
      kv('CALIBRATION', num(sc.calibration && sc.calibration.meanAbsError)
        ? f2(sc.calibration.meanAbsError) + ' <span class="dim" style="font-size:11px">mae</span>' : '—'));

    /* the two hard modifiers, named plainly */
    var caps = [];
    if ((sc.vanityShipped || []).length >= 2) {
      caps.push('You shipped ' + (sc.vanityShipped || []).length + ' features with true impact under 0.5 pp (' +
        (sc.vanityShipped || []).map(featName).join(', ') + '). That caps this quarter at C no matter what the metric says.');
    }
    if (num(trust.avg) && trust.avg < 40) {
      caps.push('You finished with average trust at ' + i0(trust.avg) + '. You can win the number and lose the ' +
        'organisation, and this caps the quarter at C.');
    }
    setHTML($['db-caps'], caps.length
      ? caps.map(function (c) { return '<div class="err-note" style="margin-bottom:10px">' + esc(c) + '</div>'; }).join('')
      : '');

    /* Viz.truth — DEBRIEF ONLY, and only after submitQBR() */
    if (!vizTruth) {
      vizTruth = call(function () {
        return window.Viz.create($['db-truthcanvas'], { theme: 'dark' });
      }, 'Viz.create');
    }
    if (vizTruth && typeof vizTruth.truth === 'function') {
      call(function () { if (vizTruth.resize) vizTruth.resize(); }, 'Viz.resize');
      var ok = call(function () {
        vizTruth.truth({
          perFeature: (sc.perFeature || []).map(function (p) {
            var o = {}; for (var k in p) if (Object.prototype.hasOwnProperty.call(p, k)) o[k] = p[k];
            o.name = featName(p.id);
            o.readings = ((readingsByFeature(st)[p.id]) || []).map(function (r) {
              return { instrument: r.instrument, value: r.value, color: r.color };
            });
            return o;
          }),
          instruments: INST.map(function (x) {
            return { id: x.id, name: x.name, color: instColor(x.id) };
          })
        });
        return true;
      }, 'Viz.truth');
      if (ok) vizOk($['db-trutherr']); else vizErr($['db-trutherr'], 'Viz.truth() threw.');
    } else {
      vizErr($['db-trutherr'], 'Viz.truth() is not available.');
    }

    /* per-feature verdict */
    var pf = sc.perFeature || [];
    setHTML($['db-verdict'], pf.length ? pf.map(function (p) {
      var pred = num(p.predicted) ? p.predicted
               : (predictions[p.id] ? predictions[p.id].predictedImpact : NaN);
      var err = num(p.believed) && num(p.truth) ? p.believed - p.truth : NaN;
      return '<tr><td>' + esc(p.name || featName(p.id)) + '</td>' +
        '<td class="r num">' + (num(p.believed) ? sgn1(p.believed) : '<span class="dim">—</span>') + '</td>' +
        '<td class="r num cyan">' + (num(pred) ? sgn1(pred) : '<span class="dim">—</span>') + '</td>' +
        '<td class="r num"><b>' + sgn1(p.truth) + '</b></td>' +
        '<td class="r num ' + (Math.abs(err) > 1.5 ? 'neg' : 'dim') + '">' + (num(err) ? sgn1(err) : '—') + '</td>' +
        '<td>' + (p.shipped ? '<span class="pos">yes</span>' : '<span class="dim">no</span>') + '</td>' +
        '<td class="wrap"><span class="verdict ' + verdictClass(p.verdict) + '">' + esc(p.verdict || '—') + '</span></td></tr>';
    }).join('') : '<tr><td colspan="7"><div class="empty-note">no per-feature detail returned</div></td></tr>');

    /* the reveal notes — the most valuable text in the sim, if the engine ships them */
    var noted = pf.filter(function (p) { return p.note; })
                  .sort(function (a, b) { return (b.truth || 0) - (a.truth || 0); });
    setHTML($['db-notes'], noted.length
      ? noted.map(function (p) {
          return '<div class="note-row' + (p.shipped ? ' is-shipped' : '') + '">' +
            '<div class="nr-hd"><span class="nr-nm">' + esc(p.name || featName(p.id)) + '</span>' +
            '<span class="nr-v num"><b>' + sgn1(p.truth) + ' pp</b>' +
            (p.shipped ? ' <span class="pos">shipped</span>' : ' <span class="dim">not shipped</span>') + '</span></div>' +
            '<div class="nr-tx">' + esc(p.note) + '</div></div>';
        }).join('')
      : '<div class="empty-note">the engine returned no per-feature notes</div>');

    /* calibration */
    var cal = sc.calibration || {};
    setHTML($['db-calibsum'],
      '<div class="stat-grid">' +
        statBlk('FORECASTS', i0(cal.n)) +
        statBlk('HIT RATE', num(cal.hitRate)
          ? (cal.hitRate <= 1 ? cal.hitRate * 100 : cal.hitRate).toFixed(0) + '%' +
            (num(cal.tolerance) ? ' <span class="dim" style="font-size:10px">±' + f1(cal.tolerance) + '</span>' : '')
          : '—') +
        statBlk('MEAN ABS ERR', f2(cal.meanAbsError)) +
        statBlk('BIAS', '<span class="' + cls(cal.bias) + '">' + sgn2(cal.bias) + '</span>') +
        statBlk('OVERCONFIDENT', cal.overconfident ? '<span class="neg">yes</span>' : '<span class="pos">no</span>') +
      '</div>' +
      '<div class="note" style="margin-top:7px">' +
      (num(cal.bias) && cal.bias > 0.4
        ? 'You predicted higher than the truth by ' + f2(cal.bias) + ' pp on average. That is the ' +
          'direction almost every PM errs in, and it is why roadmaps overrun.'
        : num(cal.bias) && cal.bias < -0.4
          ? 'You predicted lower than the truth by ' + f2(Math.abs(cal.bias)) + ' pp on average — you were ' +
            'underselling your own work.'
          : 'Your forecasts were roughly unbiased. That is rarer than it sounds.') +
      '</div>');

    /* one row per forecast the player actually made */
    var calRows = Array.isArray(cal.rows) && cal.rows.length
      ? cal.rows.map(function (r) {
          return { id: r.featureId || r.id, name: r.name, predicted: r.predicted,
                   truth: r.truth, error: num(r.error) ? r.error : (r.predicted - r.truth),
                   hit: r.hit };
        })
      : pf.filter(function (p) { return num(p.predicted) || predictions[p.id]; })
          .map(function (p) {
            var pr = num(p.predicted) ? p.predicted : predictions[p.id].predictedImpact;
            return { id: p.id, name: p.name, predicted: pr, truth: p.truth, error: pr - p.truth };
          });
    setHTML($['db-calib'], calRows.length ? calRows.map(function (r) {
      var err = r.error;
      return '<tr><td class="ell">' + esc(r.name || featName(r.id)) + '</td>' +
        '<td class="r num cyan">' + sgn1(r.predicted) + '</td>' +
        '<td class="r num">' + sgn1(r.truth) + '</td>' +
        '<td class="r num ' + (Math.abs(err) > 1.0 ? 'neg' : 'pos') + '">' + sgn1(err) + '</td></tr>';
    }).join('') : '<tr><td colspan="4"><div class="empty-note">you committed to nothing — there is nothing to calibrate</div></td></tr>');

    /* trust ledger */
    var fin = (trust.final) || (st.trust) || {};
    setHTML($['db-trust'], STK.map(function (s) {
      var t = num(fin[s.id]) ? fin[s.id] : NaN;
      var start = num(s.startTrust) ? s.startTrust : 60;
      var d = num(t) ? t - start : NaN;
      return '<div class="trust-row"><span class="ell" title="' + esc(s.role) + '">' + esc(s.name) + '</span>' +
        '<span class="trust-bar"><i class="' + (t < 35 ? 'low' : t < 55 ? 'mid' : '') +
        '" style="width:' + clamp(num(t) ? t : 0, 0, 100) + '%"></i></span>' +
        '<span class="num">' + i0(t) + ' <span class="' + cls(d) + '" style="font-size:10.5px">' + sgn1(d) + '</span></span>' +
      '</div>';
    }).join('') +
      ((trust.lost || []).length
        ? '<div class="note" style="margin-top:8px">Lost ground with: <b>' +
          esc((trust.lost || []).map(lostName).join(', ')) + '</b></div>'
        : '<div class="note" style="margin-top:8px">You did not lose ground with anyone. ' +
          'Either you chose well, or you never said no to anything.</div>'));

    /* instrument use */
    var use = sc.instrumentUse || {};
    setHTML($['db-inst'], INST.map(function (x) {
      var n = use[x.id] || 0;
      return '<div class="trust-row"><span class="ell"><span class="rd"><i style="background:' + instColor(x.id) +
        '"></i></span> ' + esc(x.name) + '</span>' +
        '<span class="trust-bar"><i style="width:' + clamp(n * 20, 0, 100) + '%;background:' + instColor(x.id) + '"></i></span>' +
        '<span class="num ' + (n ? '' : 'dim') + '">' + n + '</span></div>';
    }).join('') +
      (!use.fake_door && !use.ab_test
        ? '<div class="warn-note" style="margin-top:8px">You ran no fake-door and no A/B test all quarter. ' +
          'Every number you decided on was stated preference or backward-looking usage — not one piece of ' +
          'revealed-preference evidence.</div>'
        : ''));

    setText($['db-copystatus'], '');
    $['db-copyarea'].classList.add('hidden');

    /* one more pass on the next frame, once layout has actually settled */
    if (window.requestAnimationFrame) {
      window.requestAnimationFrame(function () {
        call(function () { if (vizTruth && vizTruth.resize) vizTruth.resize(); }, 'Viz.resize');
      });
    }
  }

  /* trust.lost may be ids or {id,name,role,from,to,delta} objects */
  function lostName(x) {
    if (!x) return '';
    if (typeof x === 'string') return (byStk[x] && byStk[x].name) || x;
    var nm = x.name || (byStk[x.id] && byStk[x.id].name) || x.id || '';
    return nm + (num(x.delta) ? ' (' + sgn1(x.delta) + ')' : '');
  }

  function kv(label, v) {
    return '<div><span class="lbl">' + esc(label) + '</span><div class="v num">' + v + '</div></div>';
  }
  function verdictClass(v) {
    var s = String(v || '').toLowerCase().trim();
    if (/^correct/.test(s)) return 'pos';
    if (/vanity|missed|dropped a winner|unfinished|zero credit|half-?built|waste|overrun|trap|wrong/.test(s)) return 'neg';
    if (/win|good|best|called/.test(s)) return 'pos';
    return 'dim';
  }

  /* ---------- clipboard (file:// often blocks the async API) ---------- */
  function qbrMarkdown() {
    var md = call(function () { return P().exportQBR(); }, 'Product.exportQBR');
    if (typeof md !== 'string' || !md.length) md = fallbackMarkdown();
    return md;
  }
  function fallbackMarkdown() {
    var st = lastState || {}, sc = score || {};
    var L = [];
    L.push('# QBR — ' + ((CO.scenario && CO.scenario.company) || 'Lumen') + ', quarter close');
    L.push('');
    L.push('_(generated by ui.js fallback — Product.exportQBR() returned nothing)_');
    L.push('');
    L.push('**Narrative**'); L.push(''); L.push(($['qb-narr'] && $['qb-narr'].value) || '(none)');
    L.push('');
    L.push('**Shipped:** ' + ((st.shipped || []).map(featName).join(', ') || 'nothing'));
    L.push('**Claimed impact:** ' + (($['qb-claim'] && $['qb-claim'].value) || '—') + ' pp');
    L.push('**Capacity:** ' + f1(st.capacityUsed) + ' spent / ' + f1(RULES().totalCapacity) + ' total');
    L.push('');
    L.push('| feature | predicted | rationale |');
    L.push('|---|---:|---|');
    Object.keys(predictions).forEach(function (fid) {
      L.push('| ' + featName(fid) + ' | ' + sgn1(predictions[fid].predictedImpact) + ' | ' +
        String(predictions[fid].rationale).replace(/\|/g, '/') + ' |');
    });
    L.push('');
    L.push('**Trust:** ' + STK.map(function (s) {
      return s.name + ' ' + i0(st.trust && st.trust[s.id]);
    }).join(' · '));
    if (sc.grade) L.push('**Grade:** ' + sc.grade);
    return L.join('\n');
  }

  function copyQBR() {
    var md = qbrMarkdown();
    var status = $['db-copystatus'];
    var done = function (ok, why) {
      if (ok) {
        status.innerHTML = '<span class="pos">✓ COPIED — ' + md.length.toLocaleString('en-US') +
          ' characters on the clipboard. Paste it into chat.</span>';
        $['db-copyarea'].classList.add('hidden');
      } else {
        status.innerHTML = '<span class="amber">Clipboard blocked' + (why ? ' (' + esc(why) + ')' : '') +
          ' — the markdown is below. Select all and copy it by hand (Cmd-A, Cmd-C).</span>';
        $['db-copyarea'].classList.remove('hidden');
        var ta = $['db-md'];
        ta.value = md;
        try { ta.focus(); ta.select(); } catch (e) {}
      }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        navigator.clipboard.writeText(md).then(function () { done(true); },
          function (err) { legacyCopy(md, done, err && err.name); });
      } catch (e) { legacyCopy(md, done, e && e.name); }
    } else {
      legacyCopy(md, done, 'no clipboard API');
    }
  }

  function legacyCopy(text, done, why) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    var ok = false;
    try {
      ta.select();
      ta.setSelectionRange(0, text.length);
      ok = document.execCommand('copy');
    } catch (e) { ok = false; }
    document.body.removeChild(ta);
    done(ok, ok ? null : why);
  }

  /* ------------------------------------------------------------------ */
  /* go                                                                  */
  /* ------------------------------------------------------------------ */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  /* a tiny surface for tools/ui_preview.html — never used by the product */
  window.__PMS_UI__ = {
    showScreen: showScreen,
    startQuarter: function () { startQuarter(); },
    state: function () { return lastState; },
    goQBR: function () { onQuarterEnd(); },
    setResearch: function (fid, iid, ack) {
      rsFeature = fid; rsInstrument = iid; rsAck = !!ack; renderResearch(lastState);
    },
    openCommit: function (fid) { openCommitDialog(fid); },
    openDrop: function (fid) { openDropDialog(fid); },
    gate: function (gid) {
      for (var i = 0; i < GATES.length; i++) if (GATES[i].id === gid) { gateFired[gid] = true; showGate(GATES[i]); return; }
    },
    refresh: function () { refresh(true); }
  };

})();
