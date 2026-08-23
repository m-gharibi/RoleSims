/* ============================================================================
   JUNIOR SOFTWARE ENGINEER (PRE-AI) SIM — sim/ui.js
   Implements SPEC §5: brief → desk → gate modal → retro → debrief.
   Vanilla JS. No frameworks, no build step, no fetch(), no ES modules.
   Depends only on the documented public APIs of:
     window.SIM_REPO (data/repo.js)
     window.Dev      (sim/dev.js)
     window.Board    (sim/board.js)
     window.Squad    (sim/squad.js)
   This file NEVER calls SIM_REPO.reveal(). Ground truth reaches the screen only
   through the Score object returned by Dev.submitRetro(), and only after the
   retro has been submitted.
   ============================================================================ */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* module state                                                        */
  /* ------------------------------------------------------------------ */
  var root = null;
  var S = {};                 // screens
  var $ = {};                 // cached elements

  var REPO = null;            // window.SIM_REPO
  var TICKETS = [], ACTIONS = [], PEOPLE = [], TARGETS = [];
  var byTicket = {}, byAction = {}, byPerson = {};

  var lastState = null;
  var running = false;
  var speed = 4;
  var started = false;
  var sprintOver = false;
  var retroDone = false;
  var score = null;

  var boardPlot = null, boardTruth = null;
  var plotTab = 'understanding';

  var feedMsgs = [];
  var feedSeen = {};
  var feedDrawn = 0;
  var feedSig = null;
  var hdrSig = null, boardSig = null, workSig = null, askSig = null;

  var gateFired = {};
  var toastSeq = 0;
  var modalOpen = 0;

  /* UI-owned records. None of this is ground truth — it is only what the
     player did, observed through the public API, kept so the ask panel can
     show the evidence and the debrief can show the route actually taken. */
  var history = {};           // ticketId -> [{e, h, u, t, day}]
  var actionLog = {};         // ticketId -> [{kind, actionId, name, minutes, gained, atHours, t, day}]
  var askLog = [];            // [{ticketId, to, question, atHours, t, day, classification, trustDelta}]
  var lastGain = {};          // ticketId -> {actionId: gained}
  var answersSeen = {};       // normalised answer text -> 1 (an engine may both
                              // return an answer AND emit it as an "answer" event)
  var askInFlight = false;    // true while Dev.ask() is on the stack
  var seenNames = {};         // CamelCase identifiers the player has been told about

  var askTo = 'deepa';
  var askDraft = {};          // ticketId -> question text (survives re-render)
  var estDraft = {};          // ticketId -> estimate box text
  var convDraft = {};         // ticketId -> convention box text

  var DEFAULT_GATES = [
    { day: 1,  id: 'kickoff',  title: 'Sprint kickoff',
      prompt: 'Post your plan for the sprint and your estimates to the team in chat.' },
    { day: 3,  id: 'standup',  title: 'Standup',
      prompt: 'Yesterday, today, and blockers. Be honest about the blockers.' },
    { day: 6,  id: 'oneonone', title: '1:1 with Tobias',
      prompt: 'Tobias wants to know how it\'s going, and what you\'d want more of.' },
    { day: 10, id: 'retro',    title: 'Sprint retro',
      prompt: 'Paste your retro into chat and walk the team through the sprint.' }
  ];
  var GATES = DEFAULT_GATES;

  var GATE_CHECKLIST = {
    kickoff: ['Your estimate for every ticket you intend to touch, in hours',
              'Which tickets you do NOT expect to finish — say it on day one, not day nine',
              'How you plan to use Deepa\'s ten hours',
              'The order you are going to work in, and why that order'],
    standup: ['Yesterday, today, blockers — in that order, and short',
              'Any ticket where your understanding has not moved in hours',
              'Anything you have already spent longer on than you estimated',
              'What you need from someone else to get unblocked'],
    oneonone: ['How the sprint actually feels, not how you think it should sound',
               'The ticket you are least confident about, and why',
               'What you would want more of: review, pairing, context, time',
               'One thing about this codebase nobody told you and should have'],
    retro:   ['The retro text, pasted in full (copy button on the debrief screen)',
              'What merged, what did not, and the honest reason for each',
              'Estimate versus actual for every ticket, without rounding it kindly',
              'The question you wish you had asked on Monday morning']
  };

  /* colour-blind-safe action colours (Okabe-Ito, lifted for a dark bg) */
  var ACTION_COLOR = {
    reproduce:     '#56b4e9',
    read_code:     '#34c98b',
    read_docs:     '#e69f00',
    git_blame:     '#cc79a7',
    search_slack:  '#f0e442',
    run_tests:     '#7aa2ff',
    just_try:      '#e6edf3'
  };
  var FALLBACK_COLORS = ['#56b4e9', '#34c98b', '#e69f00', '#cc79a7', '#f0e442',
                         '#7aa2ff', '#e6edf3', '#d29922', '#a371f7', '#39c5cf'];

  var VOICE_LABEL = {
    MENTOR: 'MENTOR', LEAD: 'TECH LEAD', REVIEWER: 'REVIEWER',
    PM: 'PRODUCT', CHANNEL: '#ENG-HELP', BOT: 'CI', SYS: 'SYSTEM', ME: 'YOU'
  };

  var STATUS_LABEL = {
    todo: 'todo', investigating: 'investigating', implementing: 'implementing',
    in_review: 'in review', merged: 'merged', abandoned: 'abandoned'
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
  function sgn0(n) { return num(n) ? (n > 0 ? '+' : '') + Math.round(n) : '—'; }
  function sgn1(n) { return num(n) ? (n > 0 ? '+' : '') + n.toFixed(1) : '—'; }
  function cls(n) { return !num(n) || Math.abs(n) < 0.005 ? 'flat' : (n > 0 ? 'pos' : 'neg'); }
  function clamp(n, a, b) { return n < a ? a : (n > b ? b : n); }
  function pct(n) { return clamp(num(n) ? n : 0, 0, 100).toFixed(2) + '%'; }

  /* hours -> "3h 15m" */
  function hm(h) {
    if (!num(h)) return '—';
    var neg = h < 0; h = Math.abs(h);
    var total = Math.round(h * 60);
    var hh = Math.floor(total / 60), mm = total % 60;
    var s = hh ? (hh + 'h' + (mm ? ' ' + mm + 'm' : '')) : (mm + 'm');
    return (neg ? '-' : '') + s;
  }
  function mins(m) { return num(m) ? (m >= 60 ? hm(m / 60) : Math.round(m) + 'm') : '—'; }

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

  function D() { return window.Dev; }

  function actionColor(aid) {
    if (ACTION_COLOR[aid]) return ACTION_COLOR[aid];
    var i = 0;
    for (; i < ACTIONS.length; i++) if (ACTIONS[i].id === aid) break;
    return FALLBACK_COLORS[i % FALLBACK_COLORS.length];
  }
  function ticketTitle(tid) { return (byTicket[tid] && byTicket[tid].title) || tid || '—'; }
  function actionName(aid) { return (byAction[aid] && byAction[aid].name) || aid || '—'; }
  function personName(pid) { return (byPerson[pid] && byPerson[pid].name) || pid || '—'; }
  function ticketPoints(tid) { return byTicket[tid] && num(byTicket[tid].points) ? byTicket[tid].points : 0; }

  function RULES() {
    var r = (D() && D().RULES) || {};
    var sc = (REPO && REPO.scenario) || {};
    var sp = sc.sprint || {};
    return {
      days: num(r.days) ? r.days : (num(sp.days) ? sp.days : 10),
      hoursPerDay: num(r.hoursPerDay) ? r.hoursPerDay : (num(sp.hoursPerDay) ? sp.hoursPerDay : 6),
      totalHours: num(r.totalHours) ? r.totalHours
        : (num(r.days) && num(r.hoursPerDay) ? r.days * r.hoursPerDay : 60),
      tickMinutes: num(r.tickMinutes) ? r.tickMinutes : 15,
      seniorBudgetHours: num(r.seniorBudgetHours) ? r.seniorBudgetHours
        : (num(sc.seniorBudgetHours) ? sc.seniorBudgetHours : 10),
      startTrust: num(r.startTrust) ? r.startTrust : 55,
      implementReadyAt: num(r.implementReadyAt) ? r.implementReadyAt : 70,
      correctAt: num(r.correctAt) ? r.correctAt : 90,
      askCostMinutes: num(r.askCostMinutes) ? r.askCostMinutes : 15,
      vagueAskExtraMinutes: num(r.vagueAskExtraMinutes) ? r.vagueAskExtraMinutes : 30,
      stuckHours: num(r.stuckHours) ? r.stuckHours : 3,
      minQuestionChars: num(r.minQuestionChars) ? r.minQuestionChars : 25,
      estimateRequired: r.estimateRequired !== false
    };
  }

  function stTicket(st, tid) {
    var list = (st && st.tickets) || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === tid) return list[i];
    return null;
  }
  function activeId(st) {
    if (st && st.active && byTicket[st.active]) return st.active;
    return TICKETS.length ? TICKETS[0].id : '';
  }
  function activeTicket(st) {
    return stTicket(st, activeId(st)) || { id: activeId(st), status: 'todo', understanding: 0,
      hoursSpent: 0, actionsUsed: {}, bounces: 0 };
  }

  /* ------------------------------------------------------------------ */
  /* boot + defensive diagnostics                                        */
  /* ------------------------------------------------------------------ */
  var REQUIRED = [
    { global: 'SIM_REPO', file: 'data/repo.js', kind: 'object',
      check: function (v) {
        return v && v.scenario && Array.isArray(v.tickets) && v.tickets.length &&
               Array.isArray(v.actions) && v.actions.length &&
               Array.isArray(v.people) && v.people.length;
      },
      detail: 'window.SIM_REPO must expose scenario, tickets[], actions[] and people[] (SPEC §1).' },
    { global: 'Dev', file: 'sim/dev.js', kind: 'object',
      methods: ['init', 'getState', 'select', 'estimate', 'investigate', 'ask', 'writeTests',
                'implement', 'openPR', 'abandon', 'advance', 'step', 'start', 'pause',
                'setSpeed', 'submitRetro', 'exportRetro', 'on'],
      detail: 'window.Dev must expose the clock/understanding/ask/review/scoring API from SPEC §2.' },
    { global: 'Board', file: 'sim/board.js', kind: 'object',
      methods: ['create'],
      detail: 'window.Board.create(canvas, opts) must return an object with timeline/understanding/burn/trust/truth/resize (SPEC §3).' },
    { global: 'Squad', file: 'sim/squad.js', kind: 'object',
      methods: ['init', 'tick', 'getFeed'],
      detail: 'window.Squad must expose init/tick/getFeed and (ideally) GATES (SPEC §4).' }
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
      '&lt;script src="data/repo.js"&gt;&lt;/script&gt;<br>' +
      '&lt;script src="sim/dev.js"&gt;&lt;/script&gt;<br>' +
      '&lt;script src="sim/board.js"&gt;&lt;/script&gt;<br>' +
      '&lt;script src="sim/squad.js"&gt;&lt;/script&gt;<br>' +
      '&lt;script src="sim/ui.js"&gt;&lt;/script&gt;<br><br>' +
      'Everything must run from <code>file://</code> — no ES modules, no fetch(), no CDN.' +
      '</div></div>';
    document.body.innerHTML = '';
    var d = h('<div id="jes-root"></div>');
    d.innerHTML = html;
    document.body.appendChild(d);
  }

  function boot() {
    var rows = auditGlobals();
    var bad = rows.filter(function (r) { return !r.ok; });
    if (bad.length) { renderDiagnostics(rows); return; }

    REPO = window.SIM_REPO;
    TICKETS = REPO.tickets.slice();
    ACTIONS = REPO.actions.slice();
    PEOPLE = REPO.people.slice();
    TICKETS.forEach(function (t) { byTicket[t.id] = t; });
    ACTIONS.forEach(function (a) { byAction[a.id] = a; });
    PEOPLE.forEach(function (p) { byPerson[p.id] = p; });

    TARGETS = Array.isArray(REPO.askTargets) && REPO.askTargets.length
      ? REPO.askTargets.slice()
      : [{ id: 'deepa', name: 'Deepa Iyer', costsSeniorBudget: true, minutes: 15,
           caveat: 'Costs her sprint budget. She is the only route to some answers.' },
         { id: 'hannah', name: 'Hannah Brecht', costsSeniorBudget: false, minutes: 10,
           caveat: 'Free, and the right call on anything where the requirement is unclear.' },
         { id: 'channel', name: '#eng-help', costsSeniorBudget: false, minutes: 10,
           caveat: 'Async. Sometimes a stranger is confidently wrong at you.' }];

    if (window.Squad && Array.isArray(window.Squad.GATES) && window.Squad.GATES.length) {
      GATES = window.Squad.GATES;
    }

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
    var bar = id('jes-errbar');
    if (!bar) {
      bar = h('<div class="errbar" id="jes-errbar"><span id="jes-errmsg"></span>' +
              '<button class="btn ghost" id="jes-errx">dismiss</button></div>');
      document.body.appendChild(bar);
      on(id('jes-errx'), 'click', function () { bar.remove(); });
    }
    id('jes-errmsg').textContent = msg;
  }

  /* ------------------------------------------------------------------ */
  /* DOM construction                                                    */
  /* ------------------------------------------------------------------ */
  function buildDom() {
    document.body.innerHTML = '';
    root = h('<div id="jes-root"></div>');
    root.appendChild(h(BRIEF_HTML));
    root.appendChild(h(DESK_HTML));
    root.appendChild(h(RETRO_HTML));
    root.appendChild(h(DEBRIEF_HTML));
    root.appendChild(h('<div id="modal-layer"><div class="modal-bg"></div></div>'));
    document.body.appendChild(root);

    S.brief   = id('scr-brief');
    S.desk    = id('scr-desk');
    S.retro   = id('scr-retro');
    S.debrief = id('scr-debrief');

    cacheEls();
    wireBrief();
    wireDesk();
    wireRetro();
    wireDebrief();

    window.addEventListener('resize', function () {
      call(function () { if (boardPlot && boardPlot.resize) boardPlot.resize(); }, 'Board.resize');
      call(function () { if (boardTruth && boardTruth.resize) boardTruth.resize(); }, 'Board.resize');
    });
  }

  function cacheEls() {
    ['h-clock', 'h-sub', 'h-bud', 'h-budtext', 'h-budbar', 'h-budwarn',
     'h-pts', 'h-ptssub', 'h-trust', 'h-pause', 'h-step', 'h-speed', 'h-status', 'h-retro',
     'b-board', 'b-count',
     'wk-title', 'wk-sub', 'wk-gate', 'wk-est', 'wk-estin', 'wk-estbtn', 'wk-esthint',
     'wk-acts', 'wk-conv', 'wk-convin', 'wk-convbtn', 'wk-uline', 'wk-impl', 'wk-tests',
     'wk-pr', 'wk-abandon', 'wk-msg',
     'p-title', 'p-tabs', 'p-host', 'p-canvas', 'p-err', 'p-legend',
     'ask-title', 'ask-budget', 'ask-ev', 'ask-tried', 'ask-tgts', 'ask-tgtcav',
     'ask-q', 'ask-count', 'ask-send', 'ask-msg',
     'fd-body', 'fd-count',
     'rt-narr', 'rt-diff', 'rt-narrcount', 'rt-diffcount', 'rt-facts', 'rt-msg', 'rt-submit', 'rt-sub',
     'db-grade', 'db-gradesub', 'db-kv', 'db-caps', 'db-truth', 'db-truthcanvas', 'db-trutherr',
     'db-esc', 'db-escsum', 'db-calib', 'db-calibsum', 'db-trust', 'db-verdict', 'db-notes',
     'db-copy', 'db-copystatus', 'db-copyarea', 'db-md', 'db-sub',
     'toasts'
    ].forEach(function (k) { $[k] = id(k); });
  }

  function showScreen(name) {
    ['brief', 'desk', 'retro', 'debrief'].forEach(function (k) {
      if (S[k]) S[k].classList.toggle('active', k === name);
    });
  }

  /* ================================================================== */
  /* SCREEN 1 — BRIEF                                                   */
  /* ================================================================== */
  var BRIEF_HTML =
    '<div class="screen center-screen" id="scr-brief">' +
      '<div class="scrollwrap"><div class="brief-wrap">' +
        '<div class="brand"><h1>JUNIOR SOFTWARE ENGINEER (PRE-AI)</h1>' +
          '<span class="sub" id="br-sub">first sprint</span></div>' +
        '<div class="rule"></div>' +
        '<div class="acct-bar" id="br-acct"></div>' +
        '<div class="brief-grid">' +
          '<div>' +
            '<div class="blk headline"><h3>THE BRIEF</h3><p id="br-brief"></p></div>' +
            '<div class="blk ask"><h3>THE ONE THING THIS SPRINT IS ABOUT</h3>' +
              '<p>Ask too early and you look like you cannot work alone. Ask too late and you burned ' +
              'two days on something a senior would have answered in ninety seconds. Some answers are ' +
              'in the code, some exist only in Deepa\'s head, and some are in the docs — where the docs ' +
              'are wrong. Telling those apart, fast, is the whole exercise.</p></div>' +
            '<div class="blk"><h3>The board — six tickets</h3>' +
              '<div style="max-height:250px;overflow:auto"><table class="tbl"><thead><tr>' +
                '<th>TICKET</th><th>TITLE</th><th>PRI</th><th class="r">PTS</th><th>REPORTER</th>' +
              '</tr></thead><tbody id="br-tickets"></tbody></table></div>' +
              '<div class="note" style="margin-top:7px">Nobody expects all six. What they expect is that ' +
              'you know which ones are not going to happen, early enough to say so.</div>' +
            '</div>' +
          '</div>' +
          '<div>' +
            '<div class="blk warnblk"><h3>What you can do, what it costs, and where it lies</h3>' +
              '<div class="act-brief" id="br-actions"></div>' +
              '<div class="note" style="margin-top:9px">Every action costs time you will not get back, and ' +
              'every repeat of the same action returns less than the one before. Some of them can return ' +
              '<b>negative</b> understanding — a wrong wiki page is worse than no wiki page.</div>' +
            '</div>' +
            '<div class="blk"><h3>The team</h3>' +
              '<div id="br-people"></div>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="foot-row">' +
          '<div class="note">Seeded and deterministic — the same decisions replay identically.</div>' +
          '<button class="btn primary big" id="br-start">START THE SPRINT</button>' +
        '</div>' +
      '</div></div>' +
    '</div>';

  function wireBrief() { on(id('br-start'), 'click', startSprint); }

  function renderBrief() {
    var sc = REPO.scenario || {};
    var sp = sc.sprint || {};
    var cb = sc.codebase || {};

    id('br-sub').textContent = (sc.company || 'Thistle') + ' · ' + (sc.role || 'Software Engineer I') +
      ' · team ' + (sc.team || '—');
    id('br-acct').innerHTML =
      cell('SPRINT', i0(sp.days || 10) + '<span class="dim" style="font-size:12px"> days</span>') +
      cell('FOCUS TIME', i0((sp.days || 10) * (sp.hoursPerDay || 6)) +
        '<span class="dim" style="font-size:12px"> h</span>') +
      cell('DEEPA\'S TIME', f1(sc.seniorBudgetHours || 10) +
        '<span class="dim" style="font-size:12px"> h · all sprint</span>') +
      cell('CODEBASE', (num(cb.loc) ? Math.round(cb.loc / 1000) + 'k' : '—') +
        '<span class="dim" style="font-size:12px"> loc</span>') +
      cell('AGE', i0(cb.ageYears) + '<span class="dim" style="font-size:12px"> years</span>');

    id('br-brief').textContent = sc.brief || '';

    id('br-tickets').innerHTML = TICKETS.map(function (t) {
      var p = String(t.priority || '').toLowerCase();
      return '<tr><td><b>' + esc(t.id) + '</b></td>' +
        '<td class="wrap">' + esc(t.title) + '</td>' +
        '<td><span class="tag ' + esc(p) + '">' + esc(t.priority || '—') + '</span></td>' +
        '<td class="r num">' + i0(t.points) + '</td>' +
        '<td class="dim">' + esc(t.reporter || '—') + '</td></tr>';
    }).join('');

    id('br-actions').innerHTML = ACTIONS.map(function (a) {
      return '<div class="act-brief-row" style="border-left-color:' + actionColor(a.id) + '">' +
        '<div class="ab-hd"><span class="ab-nm">' + esc(a.name) + '</span>' +
        '<span class="ab-cost">' + mins(a.minutes) + '</span></div>' +
        (a.desc ? '<div class="ab-desc">' + esc(a.desc) + '</div>' : '') +
        '<div class="ab-cav">' + esc(a.caveat || '(no stated caveat)') + '</div>' +
      '</div>';
    }).join('');

    id('br-people').innerHTML = PEOPLE.map(function (p) {
      return '<div class="note-row"><div class="nr-hd">' +
        '<span class="nr-nm">' + esc(p.name) + '</span>' +
        '<span class="nr-v">trust ' + i0(num(p.startTrust) ? p.startTrust : 55) + '</span></div>' +
        '<div class="msg-role" style="margin-top:1px">' + esc(p.role || '') + '</div>' +
        '<div class="nr-tx">' + esc(p.desc || '') + '</div></div>';
    }).join('');
  }

  function cell(label, valueHtml) {
    return '<div class="acct-cell"><span class="lbl">' + esc(label) + '</span>' +
           '<div class="v num">' + valueHtml + '</div></div>';
  }

  /* ------------------------------------------------------------------ */
  /* lifecycle                                                           */
  /* ------------------------------------------------------------------ */
  function startSprint() {
    if (started) return;
    started = true;

    var ok = call(function () { D().init({ repo: REPO, seed: 20260823 }); return true; }, 'Dev.init');
    if (!ok) { started = false; return; }

    call(function () {
      window.Squad.init({ repo: REPO, dev: D(), onMessage: onSquadMessage });
    }, 'Squad.init');

    bindDev();
    showScreen('desk');
    createBoards();
    pullState();
    if (lastState && lastState.active) { /* engine picked one */ }
    else if (TICKETS.length) call(function () { D().select(TICKETS[0].id); }, 'Dev.select');
    refresh(true);
    engineStart();
    checkGates();
    pullSquadFeed();
    renderFeed();
  }

  function bindDev() {
    var d = D();
    var bind = function (evt, fn) { call(function () { d.on(evt, fn); }, 'Dev.on("' + evt + '")'); };
    bind('tick', function (st) { onTick(st); });
    bind('review', function (e) { onReview(e); });
    bind('answer', function (e) { onAnswer(e); });
    bind('trust', function (e) { onTrustEvent(e); });
    bind('stuck', function (e) { onStuck(e); });
    bind('sprintEnd', function () { onSprintEnd(); });
  }

  /* `running` is set BEFORE the engine call: Dev.start() may emit a tick
     synchronously, and that tick can open a gate which pauses us straight back
     again. Set the flag first and the re-entrant pause wins, as it should. */
  function engineStart() {
    if (sprintOver) { running = false; updateTransport(); return; }
    call(function () { D().setSpeed(speed); }, 'Dev.setSpeed');
    running = true;
    updateTransport();
    call(function () { D().start(); }, 'Dev.start');
  }
  function enginePause() {
    running = false;
    updateTransport();
    call(function () { D().pause(); }, 'Dev.pause');
  }
  function updateTransport() {
    if ($['h-pause']) $['h-pause'].textContent = running ? 'PAUSE' : 'RESUME';
  }

  function pullState() {
    var st = call(function () { return D().getState(); }, 'Dev.getState');
    if (st && typeof st === 'object') { lastState = st; sample(st); }
    return lastState;
  }

  /* record the understanding trace. UI-owned, derived only from public state. */
  function sample(st) {
    var R = RULES();
    var elapsed = num(st.hoursLeft) ? (R.totalHours - st.hoursLeft) : NaN;
    (st.tickets || []).forEach(function (t) {
      var arr = history[t.id] || (history[t.id] = []);
      var u = num(t.understanding) ? t.understanding : 0;
      var hh = num(t.hoursSpent) ? t.hoursSpent : 0;
      var last = arr[arr.length - 1];
      if (last && last.u === u && Math.abs(last.h - hh) < 0.001) return;
      arr.push({ e: num(elapsed) ? elapsed : (arr.length ? arr[arr.length - 1].e : 0),
                 h: hh, u: u, t: st.t || '', day: st.day });
    });
  }

  /* Player actions advance the clock without the engine emitting a tick, so the
     squad has to be given the chance to react to them too. Squad is documented
     to fire each trigger at most once, so this is safe to call often. */
  function squadSync() {
    if (!lastState || !window.Squad) return;
    call(function () { window.Squad.tick(lastState); }, 'Squad.tick');
    pullSquadFeed();
  }

  function refresh(force) {
    var st = pullState();
    if (!st) return;
    if (force) { hdrSig = boardSig = workSig = askSig = feedSig = null; squadSync(); }
    renderHeader(st);
    renderBoard(st);
    renderWork(st);
    renderAsk(st);
    renderPlot(st);
    renderFeed();
  }

  function onTick(st) {
    if (st && typeof st === 'object') { lastState = st; sample(st); } else pullState();
    squadSync();
    refresh(false);
    checkGates();
    if (lastState && lastState.finished && !sprintOver) onSprintEnd();
  }

  /* ================================================================== */
  /* SCREEN 2 — DESK                                                    */
  /* ================================================================== */
  var DESK_HTML =
    '<div class="screen" id="scr-desk">' +

      '<div class="hdr">' +
        '<div class="hdr-l">' +
          '<div class="clock num" id="h-clock">D1 09:00</div>' +
          '<div class="clock-sub"><span id="h-sub">DAY 1/10</span> · <b id="h-left">60.0h LEFT</b></div>' +
        '</div>' +

        '<div class="bud" id="h-bud">' +
          '<div class="bud-top"><span class="lbl">DEEPA\'S TIME LEFT</span>' +
            '<span class="v num" id="h-budtext">—</span></div>' +
          '<div class="bud-bar" id="h-budbar"></div>' +
          '<div class="bud-legend">' +
            '<span><i class="left"></i>left</span>' +
            '<span><i class="spent"></i>spent</span>' +
            '<span id="h-budwarn"></span>' +
          '</div>' +
        '</div>' +

        '<div class="hdr-kv">' +
          '<span class="lbl">POINTS MERGED</span>' +
          '<span class="big num" id="h-pts">—</span>' +
          '<span class="sm num" id="h-ptssub">of — committed</span>' +
        '</div>' +

        '<div class="tstrip" id="h-trust"></div>' +

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
            '<button class="btn warn hidden" id="h-retro">GO TO RETRO</button>' +
          '</div>' +
          '<div id="h-status" class="dim">Day 1. Nothing estimated, nothing understood.</div>' +
        '</div>' +
      '</div>' +

      '<div class="desk-grid">' +

        '<section class="panel p-board">' +
          '<div class="panel-hd"><span>TICKET BOARD</span><span class="dim" id="b-count">—</span></div>' +
          '<div class="panel-bd board-bd" id="b-board"></div>' +
        '</section>' +

        '<section class="panel p-work">' +
          '<div class="panel-hd"><span id="wk-title">WORK</span><span class="dim" id="wk-sub">—</span></div>' +
          '<div class="panel-bd tight">' +
            '<div id="wk-gate"></div>' +
            '<div class="wk-est" id="wk-est">' +
              '<div><span class="lbl">YOUR ESTIMATE · HOURS</span></div>' +
              '<div><input type="number" id="wk-estin" step="0.5" min="0" placeholder="0.0" autocomplete="off"></div>' +
              '<div><button class="btn" id="wk-estbtn">SET</button></div>' +
              '<div id="wk-esthint"></div>' +
            '</div>' +
            '<span class="lbl sec-lbl">INVESTIGATION · COST, CAVEAT, AND WHAT IT STILL HAS LEFT TO GIVE</span>' +
            '<div class="act-list" id="wk-acts"></div>' +
          '</div>' +
          '<div class="panel-ft">' +
            '<div class="wk-conv" id="wk-conv">' +
              '<div><span class="lbl">PATTERN YOU ARE FOLLOWING</span>' +
                '<input type="text" id="wk-convin" list="jes-convnames" placeholder="e.g. a class name you have seen" autocomplete="off">' +
                '<datalist id="jes-convnames"></datalist></div>' +
              '<div><button class="btn" id="wk-convbtn">SET</button></div>' +
            '</div>' +
            '<div id="wk-uline" class="note" style="margin-bottom:5px"></div>' +
            '<div class="wk-ft-row" style="margin-bottom:5px">' +
              '<button class="btn primary" id="wk-impl">IMPLEMENT</button>' +
              '<button class="btn" id="wk-tests">WRITE TESTS · 45m</button>' +
            '</div>' +
            '<div class="wk-ft-row">' +
              '<button class="btn" id="wk-pr">OPEN PR</button>' +
              '<button class="btn danger" id="wk-abandon">HAND IT BACK</button>' +
            '</div>' +
            '<div id="wk-msg"></div>' +
          '</div>' +
        '</section>' +

        '<section class="panel p-plot">' +
          '<div class="panel-hd">' +
            '<span id="p-title">UNDERSTANDING VS HOURS</span>' +
            '<div class="seg" id="p-tabs">' +
              '<button class="seg-b is-on" data-tab="understanding">UNDERSTAND</button>' +
              '<button class="seg-b" data-tab="timeline">TIMELINE</button>' +
              '<button class="seg-b" data-tab="burn">BURN</button>' +
              '<button class="seg-b" data-tab="trust">TRUST</button>' +
            '</div>' +
          '</div>' +
          '<div class="plot-host" id="p-host">' +
            '<canvas id="p-canvas"></canvas>' +
            '<div class="plot-err hidden" id="p-err"></div>' +
          '</div>' +
          '<div class="legend hidden" id="p-legend"></div>' +
        '</section>' +

        '<section class="panel p-ask">' +
          '<div class="panel-hd"><span id="ask-title">ASK SOMEONE</span>' +
            '<span class="dim" id="ask-budget">—</span></div>' +
          '<div class="panel-bd ask-bd">' +
            '<div id="ask-ev"></div>' +
            '<span class="lbl sec-lbl">WHAT YOU HAVE ALREADY TRIED ON THIS TICKET</span>' +
            '<div class="tried-list" id="ask-tried"></div>' +
            '<span class="lbl sec-lbl">WHO YOU ARE ASKING</span>' +
            '<div class="ask-tgt" id="ask-tgts"></div>' +
            '<div id="ask-tgtcav"></div>' +
            '<div class="ask-qhd sec-lbl" style="display:flex">' +
              '<span class="lbl">YOUR QUESTION</span>' +
              '<span class="lbl" id="ask-count">0 / 25</span>' +
            '</div>' +
            '<textarea id="ask-q" maxlength="600" placeholder="What you tried, what you expected to happen, and what happened instead. A question with those three things in it costs almost nothing to answer."></textarea>' +
          '</div>' +
          '<div class="panel-ft">' +
            '<button class="btn primary wide" id="ask-send">SEND IT</button>' +
            '<div class="ask-judge">Everything above is the evidence. Nothing here will tell you whether ' +
            'this is the right moment to send it — that call is the job.</div>' +
            '<div id="ask-msg"></div>' +
          '</div>' +
        '</section>' +

        '<section class="panel p-feed">' +
          '<div class="panel-hd"><span>THE TEAM</span><span class="dim" id="fd-count">—</span></div>' +
          '<div class="panel-bd feed-bd" id="fd-body"></div>' +
        '</section>' +

      '</div>' +
      '<div class="toasts" id="toasts"></div>' +
    '</div>';

  function wireDesk() {
    on($['h-pause'], 'click', function () { if (running) enginePause(); else engineStart(); });
    on($['h-step'], 'click', function () {
      if (running) enginePause();
      call(function () { D().step(); }, 'Dev.step');
      refresh(false);
      checkGates();
    });
    on($['h-speed'], 'click', function (ev) {
      var b = ev.target.closest ? ev.target.closest('[data-speed]') : null;
      if (!b) return;
      speed = parseInt(b.getAttribute('data-speed'), 10) || 4;
      qa('[data-speed]', $['h-speed']).forEach(function (x) { x.classList.toggle('is-on', x === b); });
      call(function () { D().setSpeed(speed); }, 'Dev.setSpeed');
    });
    on($['h-retro'], 'click', function () { onSprintEnd(); });

    on($['b-board'], 'click', function (ev) {
      var c = ev.target.closest ? ev.target.closest('[data-tid]') : null;
      if (!c) return;
      selectTicket(c.getAttribute('data-tid'));
    });

    on($['p-tabs'], 'click', function (ev) {
      var b = ev.target.closest ? ev.target.closest('[data-tab]') : null;
      if (!b) return;
      plotTab = b.getAttribute('data-tab');
      qa('[data-tab]', $['p-tabs']).forEach(function (x) { x.classList.toggle('is-on', x === b); });
      renderPlot(lastState);
    });

    on($['wk-estbtn'], 'click', submitEstimate);
    on($['wk-estin'], 'input', function () {
      estDraft[activeId(lastState)] = $['wk-estin'].value;
      validateEstimate();
    });
    on($['wk-estin'], 'keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); submitEstimate(); }
    });

    on($['wk-acts'], 'click', function (ev) {
      var b = ev.target.closest ? ev.target.closest('[data-run]') : null;
      if (!b) return;
      runAction(b.getAttribute('data-run'));
    });

    on($['wk-convin'], 'input', function () { convDraft[activeId(lastState)] = $['wk-convin'].value; });
    on($['wk-convbtn'], 'click', setConvention);
    on($['wk-impl'], 'click', doImplement);
    on($['wk-tests'], 'click', doWriteTests);
    on($['wk-pr'], 'click', doOpenPR);
    on($['wk-abandon'], 'click', openAbandonDialog);

    on($['ask-tgts'], 'click', function (ev) {
      var b = ev.target.closest ? ev.target.closest('[data-tgt]') : null;
      if (!b) return;
      askTo = b.getAttribute('data-tgt');
      renderAsk(lastState, true);
    });
    on($['ask-q'], 'input', function () {
      askDraft[activeId(lastState)] = $['ask-q'].value;
      syncAskCount();
    });
    on($['ask-send'], 'click', sendAsk);
  }

  function selectTicket(tid) {
    if (!tid || !byTicket[tid]) return;
    var res = call(function () { return D().select(tid); }, 'Dev.select');
    if (res && res.ok === false) { toast(res.error || 'Cannot select that ticket', 'err'); return; }
    setHTML($['wk-msg'], '');
    setHTML($['ask-msg'], '');
    refresh(true);
  }

  /* ---------- header ---------- */
  function renderHeader(st) {
    var R = RULES();
    var seniorTotal = R.seniorBudgetHours;
    var seniorLeft = num(st.seniorLeft) ? st.seniorLeft : seniorTotal;
    var mergedIds = st.merged || [];
    var mergedPts = mergedIds.reduce(function (a, x) { return a + ticketPoints(x); }, 0);
    var committedPts = TICKETS.reduce(function (a, t) { return a + (num(t.points) ? t.points : 0); }, 0);

    var sig = [st.t, st.day, seniorLeft, mergedIds.length, mergedPts, st.hoursLeft,
               st.avgTrust, JSON.stringify(st.trust || {}), st.stuckOn, st.finished].join('|');
    if (sig === hdrSig) return;
    hdrSig = sig;

    setText($['h-clock'], st.t || ('D' + (st.day || 1)));
    setText($['h-sub'], 'DAY ' + i0(st.day) + '/' + i0(R.days));
    setText(id('h-left'), f1(st.hoursLeft) + 'h LEFT');

    var fracLeft = seniorTotal > 0 ? clamp(seniorLeft / seniorTotal, 0, 1) : 0;
    setHTML($['h-budbar'],
      '<div class="bud-seg left" style="width:' + (fracLeft * 100).toFixed(2) + '%"></div>' +
      '<div class="bud-seg spent" style="width:' + ((1 - fracLeft) * 100).toFixed(2) + '%"></div>');
    setHTML($['h-budtext'], f1(seniorLeft) + '<span class="dim" style="font-size:11px"> of ' +
      f1(seniorTotal) + 'h</span>');
    var low = fracLeft <= 0.2 && seniorLeft > 0.001;
    var out = seniorLeft <= 0.001;
    $['h-bud'].classList.toggle('is-low', low);
    $['h-bud'].classList.toggle('is-out', out);
    setHTML($['h-budwarn'], out ? '⚠ NO TIME LEFT WITH DEEPA'
      : low ? '⚠ UNDER 20% — SPEND IT ON WHAT ONLY SHE KNOWS' : '');

    setText($['h-pts'], String(mergedPts));
    setText($['h-ptssub'], 'of ' + committedPts + ' on the board · ' + mergedIds.length + ' merged');

    setHTML($['h-trust'], PEOPLE.map(function (p) {
      var t = st.trust && num(st.trust[p.id]) ? st.trust[p.id] : NaN;
      var start = num(p.startTrust) ? p.startTrust : R.startTrust;
      var d = num(t) ? t - start : 0;
      var k = !num(t) ? 'dim' : (t < 35 ? 'neg' : t < 48 ? 'amber' : t >= 70 ? 'pos' : '');
      var first = String(p.name || p.id).split(' ')[0];
      return '<div class="tchip' + (num(t) && t < 40 ? ' is-low' : '') +
        '" title="' + esc(p.name + ' — ' + (p.role || '')) + '">' +
        '<span class="n">' + esc(first.toUpperCase()) + '</span>' +
        '<span class="v num ' + k + '">' + i0(t) + '</span>' +
        '<span class="d num ' + cls(d) + '">' + (Math.abs(d) < 0.5 ? '·' : sgn0(d)) + '</span></div>';
    }).join(''));

    /* status line — factual, never a verdict on the ask */
    var msg, kind = '';
    var active = activeTicket(st);
    var noEst = (st.tickets || []).filter(function (t) {
      return !num(t.estimateHours) && t.status !== 'merged' && t.status !== 'abandoned';
    }).length;
    if (st.stuckOn) {
      msg = 'No understanding gained on ' + st.stuckOn + ' for ' + f1(R.stuckHours) + 'h. That is the definition of stuck.';
      kind = 'is-alarm';
    } else if (out) {
      msg = 'Deepa\'s budget is gone. Whatever is left, you finish without her.';
      kind = 'is-alarm';
    } else if (num(st.avgTrust) && st.avgTrust < 40) {
      msg = 'Average trust is ' + i0(st.avgTrust) + '. That is a people problem now, not a code problem.';
      kind = 'is-alarm';
    } else if (low) {
      msg = 'Under two hours of Deepa left. Spend them on what only she knows.';
      kind = 'is-warn';
    } else if (noEst) {
      msg = noEst + ' ticket(s) unestimated. Work is blocked on those until you commit to a number.';
      kind = 'is-warn';
    } else if (num(active.understanding) && active.understanding >= R.implementReadyAt &&
               active.understanding < R.correctAt && active.status !== 'merged') {
      msg = active.id + ' is at ' + i0(active.understanding) + ' — you can open a PR. Review wants ' +
        R.correctAt + '.';
      kind = 'is-warn';
    } else {
      msg = (st.merged || []).length + ' merged · ' + f1(st.hoursLeft) + 'h of your time left · ' +
        f1(seniorLeft) + 'h of Deepa\'s.';
    }
    $['h-status'].className = 'dim ' + kind;
    setText($['h-status'], msg);

    $['h-retro'].classList.toggle('hidden', !(st.finished || (num(st.day) && st.day > R.days)));
  }

  /* ---------- ticket board ---------- */
  function renderBoard(st) {
    var R = RULES();
    var act = activeId(st);
    var sig = (st.tickets || []).map(function (t) {
      return t.id + ':' + t.status + ':' + i0(t.understanding) + ':' + f2(t.hoursSpent) + ':' +
        (t.estimateHours || '') + ':' + (t.bounces || 0) + ':' + (t.hasTests ? 'T' : '');
    }).join('|') + '|' + act;
    if (sig === boardSig) return;
    boardSig = sig;

    var html = TICKETS.map(function (base) {
      var t = stTicket(st, base.id) || { id: base.id, status: 'todo', understanding: 0, hoursSpent: 0 };
      var status = t.status || 'todo';
      var u = num(t.understanding) ? t.understanding : 0;
      var kls = 'tcard is-' + status + (base.id === act ? ' is-active' : '');
      var ubarKls = 'ubar' + (u >= R.correctAt ? ' k-ok' : u >= R.implementReadyAt ? ' k-ready' : '');
      var est = num(t.estimateHours) ? t.estimateHours : NaN;
      var spent = num(t.hoursSpent) ? t.hoursSpent : 0;
      var over = num(est) && est > 0 && spent > est * 1.0001;
      var pri = String(base.priority || '').toLowerCase();

      var flags = '';
      if (!num(est) && status !== 'merged' && status !== 'abandoned') flags += '<span class="flag noest">no estimate</span>';
      if (t.hasTests) flags += '<span class="flag tests">tests</span>';
      if (t.convention) flags += '<span class="flag conv">' + esc(String(t.convention).slice(0, 14)) + '</span>';
      if (num(t.bounces) && t.bounces > 0) flags += '<span class="flag bounce">' + t.bounces + ' bounce' + (t.bounces === 1 ? '' : 's') + '</span>';

      return '<div class="' + kls + '" data-tid="' + esc(base.id) + '">' +
        '<div class="tc-hd"><span class="tc-id">' + esc(base.id) + '</span>' +
          '<span class="pill ' + esc(status) + '">' + esc(STATUS_LABEL[status] || status) + '</span></div>' +
        '<div class="tc-title ell" title="' + esc(base.title) + '">' + esc(base.title) + '</div>' +
        '<div class="tc-meta">' +
          '<span class="tag ' + esc(pri) + '">' + esc(base.priority || '—') + '</span>' +
          '<span class="tag">' + esc(base.type || '') + '</span>' +
          '<span class="tc-sep">·</span><span>' + i0(base.points) + ' pt' + (base.points === 1 ? '' : 's') + '</span>' +
          '<span class="tc-sep">·</span><span class="' + (over ? 'neg' : '') + '">' +
            hm(spent) + (num(est) ? ' / ' + hm(est) + ' est' : ' / no est') + '</span>' +
        '</div>' +
        '<div class="' + ubarKls + '" title="understanding ' + i0(u) + ' of 100 · implement at ' +
          R.implementReadyAt + ' · survives review at ' + R.correctAt + '">' +
          '<i class="ufill" style="width:' + pct(u) + '"></i>' +
          '<span class="umark m70" style="left:' + pct(R.implementReadyAt) + '"></span>' +
          '<span class="umark m90" style="left:' + pct(R.correctAt) + '"></span>' +
        '</div>' +
        '<div class="uscale">' +
          '<span class="uval">understanding ' + i0(u) + '</span>' +
          '<span class="m70" style="left:' + pct(R.implementReadyAt) + '">' + R.implementReadyAt + ' build</span>' +
          '<span class="m90" style="left:' + pct(R.correctAt) + '">' + R.correctAt + ' ship</span>' +
        '</div>' +
        '<div class="tc-ft"><span class="tc-flags">' + (flags || '<span class="dim">&nbsp;</span>') + '</span>' +
          '<span class="dim">' + (base.id === act ? 'selected' : 'click to select') + '</span></div>' +
      '</div>';
    }).join('');

    setHTML($['b-board'], html);
    var merged = (st.merged || []).length;
    var open = (st.tickets || []).filter(function (t) {
      return t.status !== 'merged' && t.status !== 'abandoned';
    }).length;
    setText($['b-count'], merged + ' merged · ' + open + ' open');
  }

  /* ---------- work panel ---------- */
  function renderWork(st) {
    var R = RULES();
    var t = activeTicket(st);
    var base = byTicket[t.id] || {};
    var used = t.actionsUsed || {};
    var locked = R.estimateRequired && !num(t.estimateHours);
    var closed = t.status === 'merged' || t.status === 'abandoned' || !!st.finished;

    var sig = [t.id, t.status, i0(t.understanding), f2(t.hoursSpent), t.estimateHours,
               JSON.stringify(used), t.hasTests, t.convention, t.bounces, st.finished,
               f2(st.seniorLeft)].join('|');
    if (sig === workSig) return;
    workSig = sig;

    setText($['wk-title'], 'WORK · ' + t.id);
    setText($['wk-sub'], (STATUS_LABEL[t.status] || t.status || 'todo') + ' · ' +
      hm(t.hoursSpent) + ' spent');

    /* the estimate gate */
    if (locked) {
      setHTML($['wk-gate'], '<div class="warn-note">Estimate this ticket first. ' +
        'Dev will reject investigation, implementation and review until you put a number on it — ' +
        'and the number is the calibration record, so guess honestly rather than safely.</div>');
    } else if (num(t.estimateHours) && num(t.hoursSpent) && t.hoursSpent > t.estimateHours * 2 && !closed) {
      setHTML($['wk-gate'], '<div class="err-note">You are at ' + hm(t.hoursSpent) + ' against a ' +
        hm(t.estimateHours) + ' estimate — over 2×. A stale estimate is a broken promise; ' +
        're-estimate it and say so at standup.</div>');
    } else {
      setHTML($['wk-gate'], '');
    }

    var estIn = $['wk-estin'];
    if (document.activeElement !== estIn) {
      var draft = estDraft[t.id];
      estIn.value = draft !== undefined ? draft : (num(t.estimateHours) ? String(t.estimateHours) : '');
    }
    estIn.disabled = !!closed;
    $['wk-estbtn'].disabled = !!closed;
    $['wk-estbtn'].textContent = num(t.estimateHours) ? 'RE-ESTIMATE' : 'SET';
    validateEstimate();

    /* the action list — cost, caveat, run count, diminishing returns */
    setHTML($['wk-acts'], ACTIONS.map(function (a) {
      var n = num(used[a.id]) ? used[a.id] : 0;
      var wear = clamp(n, 0, 4);
      var pips = '';
      for (var i = 0; i < 4; i++) {
        var live = i < (4 - wear);
        pips += '<i class="' + (live ? 'on' + (wear >= 3 ? ' w3' : wear >= 2 ? ' w2' : '') : '') + '"></i>';
      }
      var lbl = n === 0 ? 'fresh' : n === 1 ? 'thinner' : n === 2 ? 'worn' : n === 3 ? 'nearly spent' : 'spent';
      var lblK = n === 0 ? 'w1' : n <= 2 ? 'w2' : 'w3';
      var lg = lastGain[t.id] && lastGain[t.id][a.id];
      var kls = 'act-item' + (n >= 3 ? ' is-worn' : n > 0 ? ' is-used' : '');
      return '<div class="' + kls + '" style="border-left-color:' + (n ? actionColor(a.id) : '#39414c') + '">' +
        '<div class="ai-hd"><span class="ai-nm">' + esc(a.name) + '</span>' +
          '<span class="ai-cost">' + mins(a.minutes) + '</span></div>' +
        (a.desc ? '<div class="ai-desc">' + esc(a.desc) + '</div>' : '') +
        (a.caveat ? '<div class="ai-cav">' + esc(a.caveat) + '</div>' : '') +
        '<div class="ai-ft">' +
          '<span class="pips" title="each repeat of the same action returns less than the one before">' + pips + '</span>' +
          '<span class="dr-lbl ' + lblK + '">' + lbl + '</span>' +
          '<span class="ai-runs">' + (n ? 'run <b>×' + n + '</b>' : 'not run') +
            (num(lg) ? ' · last ' + sgn0(lg) : '') + '</span>' +
          '<span class="spacer"></span>' +
          '<button class="btn tiny" data-run="' + esc(a.id) + '"' +
            (locked || closed ? ' disabled' : '') + '>RUN · ' + mins(a.minutes) + '</button>' +
        '</div></div>';
    }).join(''));

    /* convention */
    var convIn = $['wk-convin'];
    if (document.activeElement !== convIn) {
      var cd = convDraft[t.id];
      convIn.value = cd !== undefined ? cd : (t.convention || '');
    }
    convIn.disabled = !!closed;
    $['wk-convbtn'].disabled = !!closed;
    $['wk-convbtn'].textContent = t.convention ? 'CHANGE' : 'SET';
    setHTML(id('jes-convnames'), Object.keys(seenNames).sort().map(function (nm) {
      return '<option value="' + esc(nm) + '"></option>';
    }).join(''));

    /* the implement / test / PR row */
    var u = num(t.understanding) ? t.understanding : 0;
    var readyGap = R.implementReadyAt - u;
    setHTML($['wk-uline'],
      'Understanding <b>' + i0(u) + '</b> · ' +
      (u < R.implementReadyAt
        ? '<span class="amber">' + i0(readyGap) + ' short of the ' + R.implementReadyAt + ' you need to build at all.</span>'
        : u < R.correctAt
          ? '<span class="amber">Above ' + R.implementReadyAt + ', below ' + R.correctAt +
            ' — you can open a PR, and review is very likely to send it back.</span>'
          : '<span class="pos">At or above ' + R.correctAt + '. Review should hold.</span>') +
      (t.hasTests ? ' <span class="pos">· tests written</span>' : ' <span class="dim">· no tests yet</span>'));

    var impl = $['wk-impl'];
    impl.disabled = locked || closed || u < R.implementReadyAt || t.status === 'in_review';
    impl.className = 'btn ' + (u >= R.correctAt ? 'primary' : u >= R.implementReadyAt ? 'warn' : '');
    impl.textContent = u < R.implementReadyAt
      ? 'IMPLEMENT · NEED ' + R.implementReadyAt + ', YOU HAVE ' + i0(u)
      : (u < R.correctAt ? 'IMPLEMENT ANYWAY · ' + i0(u) : 'IMPLEMENT · ' + i0(u));

    $['wk-tests'].disabled = locked || closed || !!t.hasTests;
    $['wk-tests'].textContent = t.hasTests ? 'TESTS WRITTEN' : 'WRITE TESTS · 45m';
    $['wk-pr'].disabled = locked || closed || t.status === 'in_review';
    $['wk-pr'].textContent = t.status === 'in_review' ? 'IN REVIEW…'
      : (num(t.bounces) && t.bounces > 0 ? 'RE-SUBMIT PR' : 'OPEN PR');
    $['wk-abandon'].disabled = closed;
  }

  function validateEstimate() {
    var st = lastState || {};
    var t = activeTicket(st);
    var R = RULES();
    var input = $['wk-estin'];
    if (!input) return false;
    var raw = String(input.value || '').trim();
    var hint = $['wk-esthint'];
    if (raw === '') {
      input.classList.remove('bad', 'good');
      setHTML(hint, num(t.estimateHours)
        ? '<span class="dim">Currently estimated at <b>' + hm(t.estimateHours) + '</b>. ' +
          'Type a new number to revise it.</span>'
        : '<span class="amber">Required. A number in hours — how long you think this will take you, ' +
          'not how long it should take someone who knows the codebase.</span>');
      return false;
    }
    var v = parseFloat(raw);
    if (!isFinite(v)) {
      input.classList.add('bad'); input.classList.remove('good');
      setHTML(hint, '<span class="neg">That is not a number. Hours, as a decimal — 2.5 means two and a half hours.</span>');
      return false;
    }
    if (v <= 0) {
      input.classList.add('bad'); input.classList.remove('good');
      setHTML(hint, '<span class="neg">An estimate of zero is not an estimate. Anything above 0.</span>');
      return false;
    }
    if (v > R.totalHours) {
      input.classList.add('bad'); input.classList.remove('good');
      setHTML(hint, '<span class="neg">' + f1(v) + 'h is more than the whole sprint (' + f1(R.totalHours) +
        'h). If you believe that, the right move is to say so, not to estimate it.</span>');
      return false;
    }
    input.classList.remove('bad'); input.classList.add('good');
    var pctOfSprint = (v / R.totalHours) * 100;
    setHTML(hint, '<span class="dim">' + hm(v) + ' — <b>' + pctOfSprint.toFixed(0) + '%</b> of your sprint' +
      (num(t.estimateHours) ? ' · was ' + hm(t.estimateHours) : '') + '.</span>');
    return true;
  }

  function submitEstimate() {
    if (!validateEstimate()) { $['wk-estin'].focus(); return; }
    var st = lastState || {};
    var t = activeTicket(st);
    var v = parseFloat($['wk-estin'].value);
    var res = call(function () { return D().estimate(t.id, v); }, 'Dev.estimate');
    if (!res) { wkMsg('Dev.estimate() threw — see the bar at the bottom.', 'err'); return; }
    if (res.ok === false) { wkMsg(esc(res.error || 'Estimate rejected.'), 'err'); return; }
    delete estDraft[t.id];
    wkMsg('Estimated <b>' + esc(t.id) + '</b> at <b>' + hm(v) + '</b>.', 'ok');
    toast('Estimate set: ' + t.id + ' → ' + hm(v), 'info');
    refresh(true);
  }

  function setConvention() {
    var st = lastState || {};
    var t = activeTicket(st);
    var v = String($['wk-convin'].value || '').trim();
    if (!v) { wkMsg('Type the name of the pattern you are following first.', 'warn'); $['wk-convin'].focus(); return; }
    var res = call(function () { return D().setConvention(t.id, v); }, 'Dev.setConvention');
    if (res && res.ok === false) { wkMsg(esc(res.error || 'Rejected.'), 'err'); return; }
    delete convDraft[t.id];
    seenNames[v] = 1;
    wkMsg('Following <b>' + esc(v) + '</b> on ' + esc(t.id) + '. If the neighbouring code disagrees ' +
      'with the style guide, one of them is out of date.', 'ok');
    refresh(true);
  }

  function wkMsg(html, kind) {
    setHTML($['wk-msg'], html ? '<div class="' + (kind || 'ok') + '-note" style="margin-top:6px">' + html + '</div>' : '');
  }

  function harvestNames(text) {
    if (!text) return;
    var m = String(text).match(/`([^`]{2,40})`|\b([A-Z][a-z0-9]+(?:[A-Z][a-z0-9]+)+)\b/g);
    if (!m) return;
    m.forEach(function (x) {
      var v = x.replace(/`/g, '').trim();
      if (v.length >= 3 && v.length <= 40 && /[A-Za-z]/.test(v)) seenNames[v] = 1;
    });
  }

  function runAction(actionId) {
    var st = lastState || {};
    var t = activeTicket(st);
    var a = byAction[actionId] || {};
    var res = call(function () {
      return D().investigate({ ticketId: t.id, actionId: actionId });
    }, 'Dev.investigate');
    if (!res) { wkMsg('Dev.investigate() threw — see the bar at the bottom.', 'err'); return; }
    if (res.ok === false) { wkMsg(esc(res.error || 'Rejected.'), 'err'); toast(res.error || 'Rejected', 'err'); return; }

    var gained = num(res.gained) ? res.gained : 0;
    (lastGain[t.id] || (lastGain[t.id] = {}))[actionId] = gained;
    (actionLog[t.id] || (actionLog[t.id] = [])).push({
      kind: 'action', actionId: actionId, name: a.name || actionId,
      minutes: num(a.minutes) ? a.minutes : 0, gained: gained,
      atHours: num(t.hoursSpent) ? t.hoursSpent : 0,
      t: st.t || '', day: st.day, color: actionColor(actionId)
    });
    harvestNames(res.note);

    var kind = gained > 0 ? 'ok' : gained < 0 ? 'err' : 'warn';
    wkMsg('<b>' + esc(a.name || actionId) + '</b> · ' + mins(a.minutes) + ' · understanding <b>' +
      sgn0(gained) + '</b>' + (res.note ? '<br>' + esc(res.note) : ''), kind);
    toast(esc(a.name || actionId) + ': ' + sgn0(gained) + ' understanding',
      gained > 0 ? 'info' : gained < 0 ? 'warn' : 'warn');
    refresh(true);
  }

  function doImplement() {
    var st = lastState || {};
    var t = activeTicket(st);
    var res = call(function () { return D().implement(t.id); }, 'Dev.implement');
    if (!res) { wkMsg('Dev.implement() threw — see the bar at the bottom.', 'err'); return; }
    if (res.ok === false) { wkMsg(esc(res.error || 'Rejected.'), 'err'); toast(res.error || 'Rejected', 'err'); return; }
    var hrs = num(res.hours) ? res.hours : (num(res.hoursSpent) ? res.hoursSpent : NaN);
    wkMsg('Implemented <b>' + esc(t.id) + '</b>' + (num(hrs) ? ' — ' + hm(hrs) + ' of work' : '') +
      (res.note ? '<br>' + esc(res.note) : ''), 'ok');
    toast('Implemented ' + t.id + (num(hrs) ? ' · ' + hm(hrs) : ''), 'ok');
    refresh(true);
  }

  function doWriteTests() {
    var st = lastState || {};
    var t = activeTicket(st);
    var res = call(function () { return D().writeTests(t.id); }, 'Dev.writeTests');
    if (!res) { wkMsg('Dev.writeTests() threw — see the bar at the bottom.', 'err'); return; }
    if (res.ok === false) { wkMsg(esc(res.error || 'Rejected.'), 'err'); toast(res.error || 'Rejected', 'err'); return; }
    wkMsg('Tests written for <b>' + esc(t.id) + '</b> · 45m.', 'ok');
    toast('Tests written for ' + t.id, 'ok');
    refresh(true);
  }

  function doOpenPR() {
    var st = lastState || {};
    var t = activeTicket(st);
    var R = RULES();
    var u = num(t.understanding) ? t.understanding : 0;
    var res = call(function () { return D().openPR(t.id); }, 'Dev.openPR');
    if (!res) { wkMsg('Dev.openPR() threw — see the bar at the bottom.', 'err'); return; }
    if (res.ok === false) { wkMsg(esc(res.error || 'Rejected.'), 'err'); toast(res.error || 'Rejected', 'err'); return; }
    wkMsg('PR open on <b>' + esc(t.id) + '</b> at understanding ' + i0(u) + '. ' +
      (u < R.correctAt ? 'Nnamdi reviews against ' + R.correctAt + '.' : 'Waiting on review.'), 'ok');
    toast('PR opened on ' + t.id + ' — waiting on Nnamdi', 'info');
    pushMsg({ from: 'ME', name: 'You', t: st.t, day: st.day,
              text: 'Opened a PR on ' + t.id + '.', tone: 'neutral',
              id: 'pr:' + t.id + ':' + (st.tick || st.t) });
    refresh(true);
  }

  function openAbandonDialog() {
    var st = lastState || {};
    var t = activeTicket(st);
    var base = byTicket[t.id] || {};
    openModal({
      danger: true,
      title: 'HAND BACK · ' + t.id,
      bodyHtml:
        '<p class="gate-prompt">Hand <b>' + esc(t.id) + '</b> back to the team?</p>' +
        '<p class="note" style="font-size:12px;margin-bottom:12px">' + esc(base.title || '') + '</p>' +
        '<div class="stat-grid" style="margin-bottom:12px">' +
          statBlk('SPENT', hm(t.hoursSpent)) +
          statBlk('ESTIMATED', num(t.estimateHours) ? hm(t.estimateHours) : '—') +
          statBlk('UNDERSTANDING', i0(t.understanding)) +
        '</div>' +
        '<div class="warn-note" style="margin-bottom:12px">Handing a ticket back costs trust, and it is ' +
        'sometimes exactly the right call — a ticket that was misfiled, or belongs to another team, or ' +
        'is a known issue with a ticket already open against it. Telling your team a ticket is not yours ' +
        'IS doing the ticket.</div>' +
        '<div class="note">What is not the right call is handing back something hard because it is hard. ' +
        'Nobody in this room can tell the difference from the outside. You can.</div>',
      okText: 'HAND IT BACK',
      okClass: 'danger',
      cancelText: 'KEEP IT',
      onOk: function (api) {
        var res = call(function () { return D().abandon(t.id); }, 'Dev.abandon');
        if (!res) { api.error('Dev.abandon() threw — see the bar at the bottom.'); return false; }
        if (res.ok === false) { api.error(res.error || 'Rejected.'); return false; }
        toast('Handed back: ' + t.id, 'warn');
        refresh(true);
        return true;
      }
    });
  }

  /* ================================================================== */
  /* THE ASK PANEL                                                      */
  /* The whole sim is the judgement "is it time to ask yet". This panel  */
  /* puts the evidence for that judgement in front of the player and     */
  /* then refuses to make it for them. It NEVER pre-classifies the ask.  */
  /* ================================================================== */
  function askEvidence(st) {
    var R = RULES();
    var t = activeTicket(st);
    var hist = history[t.id] || [];
    var u = num(t.understanding) ? t.understanding : 0;
    var spent = num(t.hoursSpent) ? t.hoursSpent : 0;

    /* movement in the last hour of work ON THIS TICKET */
    var movedLastHour = null, enoughHistory = spent >= 1;
    if (enoughHistory) {
      var ref = null;
      for (var i = hist.length - 1; i >= 0; i--) {
        if (hist[i].h <= spent - 1 + 1e-9) { ref = hist[i]; break; }
      }
      if (ref) movedLastHour = u - ref.u;
      else if (hist.length) movedLastHour = u - hist[0].u;
    }

    /* how long since understanding last went UP */
    var flatFor = null;
    for (var j = hist.length - 1; j >= 1; j--) {
      if (hist[j].u > hist[j - 1].u + 1e-9) { flatFor = spent - hist[j].h; break; }
    }
    if (flatFor === null) flatFor = spent;
    if (flatFor < 0) flatFor = 0;

    return { ticket: t, u: u, spent: spent, movedLastHour: movedLastHour,
             enoughHistory: enoughHistory, flatFor: flatFor, R: R };
  }

  function renderAsk(st, force) {
    var R = RULES();
    var t = activeTicket(st);
    var used = t.actionsUsed || {};
    var seniorTotal = R.seniorBudgetHours;
    var seniorLeft = num(st.seniorLeft) ? st.seniorLeft : seniorTotal;

    var sig = [t.id, i0(t.understanding), f2(t.hoursSpent), JSON.stringify(used), askTo,
               f2(seniorLeft), t.status, st.finished, askLog.length].join('|');
    if (!force && sig === askSig) return;
    askSig = sig;

    var ev = askEvidence(st);
    setText($['ask-title'], 'ASK SOMEONE · ' + t.id);
    setHTML($['ask-budget'], f1(seniorLeft) + 'h of Deepa left');

    /* --- the evidence block --- */
    var est = num(t.estimateHours) ? t.estimateHours : NaN;
    var barPct = num(est) && est > 0 ? clamp((ev.spent / est) * 100, 0, 100) : 0;
    var overEst = num(est) && est > 0 && ev.spent > est;

    var moveHtml;
    if (!ev.enoughHistory) {
      moveHtml = '<span class="dim">less than an hour on this ticket so far</span>';
    } else if (ev.movedLastHour === null) {
      moveHtml = '<span class="dim">no trace yet</span>';
    } else if (ev.movedLastHour > 0.5) {
      moveHtml = '<span class="ev-moving">+' + i0(ev.movedLastHour) + ' in the last hour</span>';
    } else if (ev.movedLastHour < -0.5) {
      moveHtml = '<span class="neg">' + i0(ev.movedLastHour) + ' in the last hour — something you read moved you backwards</span>';
    } else {
      moveHtml = '<span class="ev-flat">flat for the last hour</span>';
    }

    setHTML($['ask-ev'],
      '<div class="ev-box">' +
        '<div class="ev-kick"><span>BEFORE YOU SEND · THE EVIDENCE</span><span>' + esc(t.id) + '</span></div>' +
        '<div class="ev-row"><span class="k">Time on this ticket</span>' +
          '<span class="v">' + hm(ev.spent) + '</span></div>' +
        '<div class="ev-tbar"><i class="' + (overEst ? 'over' : '') + '" style="width:' + barPct.toFixed(1) + '%"></i></div>' +
        '<div class="ev-sub">' + (num(est)
          ? 'You estimated <b>' + hm(est) + '</b> — you are at <b class="' + (overEst ? 'neg' : '') + '">' +
            (est > 0 ? (ev.spent / est).toFixed(2) : '—') + '×</b> of it.'
          : '<span class="amber">No estimate on this ticket, so there is nothing to be past.</span>') + '</div>' +
        '<div class="ev-row" style="margin-top:5px"><span class="k">Understanding</span>' +
          '<span class="v">' + i0(ev.u) + ' <span class="dim" style="font-size:10.5px">/ ' +
          R.implementReadyAt + ' to build</span></span></div>' +
        '<div class="ev-sub">' + moveHtml +
          (ev.flatFor !== null && ev.flatFor >= 0.5
            ? ' · <span class="ev-flat">nothing new for ' + hm(ev.flatFor) + '</span>' : '') +
          '</div>' +
        '<div class="ev-row" style="margin-top:5px"><span class="k">Deepa\'s budget left</span>' +
          '<span class="v ' + (seniorLeft <= 0.001 ? 'neg' : seniorLeft / seniorTotal <= 0.2 ? 'amber' : '') + '">' +
          f1(seniorLeft) + 'h <span class="dim" style="font-size:10.5px">of ' + f1(seniorTotal) + 'h</span></span></div>' +
        '<div class="ev-tbar"><i style="width:' +
          (seniorTotal > 0 ? clamp((seniorLeft / seniorTotal) * 100, 0, 100).toFixed(1) : '0') + '%"></i></div>' +
      '</div>');

    /* --- what you have already tried --- */
    var triedHtml = ACTIONS.map(function (a) {
      var n = num(used[a.id]) ? used[a.id] : 0;
      return '<div class="tried ' + (n ? 'done' : 'none') + '">' +
        '<span class="c">' + (n ? '×' + n : '—') + '</span>' +
        '<span class="n" title="' + esc(a.name) + '">' + esc(a.name) + '</span>' +
        '<span class="m">' + (n ? hm((n * (a.minutes || 0)) / 60) : 'not run · ' + mins(a.minutes)) + '</span>' +
      '</div>';
    }).join('');
    var askedHere = askLog.filter(function (x) { return x.ticketId === t.id; });
    if (askedHere.length) {
      triedHtml += askedHere.map(function (x) {
        return '<div class="tried done"><span class="c">✎</span>' +
          '<span class="n">asked ' + esc(targetName(x.to)) + '</span>' +
          '<span class="m">' + esc(x.t || '') + '</span></div>';
      }).join('');
    }
    setHTML($['ask-tried'], triedHtml);

    /* --- who --- */
    setHTML($['ask-tgts'], TARGETS.map(function (tg) {
      var out = tg.costsSeniorBudget && seniorLeft <= 0.001;
      return '<button type="button" class="tgt-row' + (askTo === tg.id ? ' is-on' : '') +
        '" data-tgt="' + esc(tg.id) + '"><i></i>' +
        '<span class="tg-nm">' + esc(tg.name) + '</span>' +
        '<span class="tg-cost">' + (tg.costsSeniorBudget
          ? (out ? 'budget gone' : 'costs her budget · ' + mins(tg.minutes))
          : 'free · ' + mins(tg.minutes)) + '</span></button>';
    }).join(''));

    var cur = targetById(askTo);
    var outOfBudget = cur && cur.costsSeniorBudget && seniorLeft <= 0.001;
    setHTML($['ask-tgtcav'], outOfBudget
      ? '<div class="err-note" style="margin-top:4px">Deepa has no time left this sprint. ' +
        'That ceiling is not a bug — it is the resource this sprint was actually about.</div>'
      : (cur && cur.caveat ? esc(cur.caveat) : ''));

    var qEl = $['ask-q'];
    if (document.activeElement !== qEl) qEl.value = askDraft[t.id] || '';
    var closed = t.status === 'merged' || t.status === 'abandoned' || !!st.finished;
    qEl.disabled = closed;
    $['ask-send'].disabled = closed;
    syncAskCount();
  }

  function targetById(tid) {
    for (var i = 0; i < TARGETS.length; i++) if (TARGETS[i].id === tid) return TARGETS[i];
    return TARGETS[0] || null;
  }
  function targetName(tid) {
    var t = targetById(tid);
    return t ? t.name : tid;
  }

  function syncAskCount() {
    var R = RULES();
    var n = String(($['ask-q'] && $['ask-q'].value) || '').trim().length;
    var el = $['ask-count'];
    if (!el) return;
    el.className = 'lbl ' + (n >= R.minQuestionChars ? 'okc' : 'short');
    el.textContent = n + ' / ' + R.minQuestionChars + (n >= R.minQuestionChars ? ' OK' : ' MIN');
    var btn = $['ask-send'];
    if (btn && !btn.disabled) {
      btn.textContent = 'SEND IT TO ' + String(targetName(askTo)).toUpperCase();
    }
  }

  function sendAsk() {
    var R = RULES();
    var st = lastState || {};
    var t = activeTicket(st);
    var qEl = $['ask-q'];
    var question = String(qEl.value || '').trim();
    if (question.length < R.minQuestionChars) {
      askMsg('That question is too short to answer — ' + question.length + ' of ' + R.minQuestionChars +
        ' characters. Say what you tried and what you expected.', 'err');
      qEl.focus();
      return;
    }
    /* an engine may answer synchronously by emitting "answer" from inside ask().
       Suppress the event for the duration of the call and render the returned
       answer instead, so the feed reads "you asked" and then "they replied". */
    askInFlight = true;
    var res = call(function () {
      return D().ask({ ticketId: t.id, to: askTo, question: question });
    }, 'Dev.ask');
    askInFlight = false;
    if (!res) { askMsg('Dev.ask() threw — see the bar at the bottom.', 'err'); return; }
    if (res.ok === false) { askMsg(esc(res.error || 'Rejected.'), 'err'); toast(res.error || 'Ask rejected', 'err'); return; }

    var cls2 = String(res.classification || '').toLowerCase();
    var td = num(res.trustDelta) ? res.trustDelta : null;
    askLog.push({ ticketId: t.id, to: askTo, question: question,
                  atHours: num(t.hoursSpent) ? t.hoursSpent : 0,
                  t: st.t || '', day: st.day, classification: res.classification, trustDelta: td });
    (actionLog[t.id] || (actionLog[t.id] = [])).push({
      kind: 'ask', actionId: 'ask_' + askTo, name: 'asked ' + targetName(askTo),
      minutes: (targetById(askTo) || {}).minutes || R.askCostMinutes, gained: NaN,
      atHours: num(t.hoursSpent) ? t.hoursSpent : 0, t: st.t || '', day: st.day,
      color: '#a371f7', classification: res.classification
    });
    harvestNames(res.answer);

    delete askDraft[t.id];
    qEl.value = '';

    pushMsg({ id: 'ask:' + askLog.length, from: 'ME', name: 'You', t: st.t, day: st.day,
              text: '→ ' + targetName(askTo) + ' re ' + t.id + ': ' + question, tone: 'neutral' });
    if (res.answer && !answersSeen[answerKey(res.answer)]) {
      answersSeen[answerKey(res.answer)] = 1;
      pushMsg({ id: 'ans:' + askLog.length, from: askVoice(askTo),
                name: askPersonName(askTo), t: st.t, day: st.day,
                text: res.answer, tone: cls2 === 'premature' ? 'warn' : 'neutral' });
    }

    var kind = cls2 === 'premature' ? 'warn' : cls2 === 'overdue' ? 'warn' : 'ok';
    askMsg('<b>' + esc(String(res.classification || 'sent').toUpperCase()) + '</b>' +
      (td !== null ? ' · trust ' + sgn0(td) + ' with ' + esc(targetName(askTo)) : '') +
      (res.answer ? '<br>' + esc(res.answer) : ''), kind);
    toast(targetName(askTo) + ' answered' + (td !== null ? ' · trust ' + sgn0(td) : ''),
      td !== null && td < 0 ? 'warn' : 'ok');
    refresh(true);
  }

  function askVoice(tid) {
    if (tid === 'deepa') return 'MENTOR';
    if (tid === 'hannah') return 'PM';
    if (tid === 'channel') return 'CHANNEL';
    var p = byPerson[tid];
    return (p && p.voice) || 'SYS';
  }
  function askPersonName(tid) {
    if (byPerson[tid]) return byPerson[tid].name;
    return targetName(tid);
  }
  function askMsg(html, kind) {
    setHTML($['ask-msg'], html ? '<div class="' + (kind || 'ok') + '-note">' + html + '</div>' : '');
  }

  /* ---------- the understanding plot and the other boards ---------- */
  function createBoards() {
    boardPlot = call(function () {
      return window.Board.create($['p-canvas'], { theme: 'dark' });
    }, 'Board.create');
    if (!boardPlot) plotErr($['p-err'], 'Board.create() failed for the plot canvas.');
  }
  function plotErr(node, msg) { if (node) { node.textContent = msg; node.classList.remove('hidden'); } }
  function plotOk(node) { if (node) node.classList.add('hidden'); }

  function enrichedTickets(st) {
    return TICKETS.map(function (base) {
      var t = stTicket(st, base.id) || {};
      var o = {};
      for (var k in t) if (Object.prototype.hasOwnProperty.call(t, k)) o[k] = t[k];
      o.id = base.id;
      o.title = base.title;
      o.type = base.type;
      o.priority = base.priority;
      o.points = base.points;
      o.segments = (actionLog[base.id] || []).slice();
      o.actions = o.segments;
      o.asks = askLog.filter(function (x) { return x.ticketId === base.id; });
      o.history = (history[base.id] || []).slice();
      return o;
    });
  }

  function renderPlot(st) {
    if (!st) return;
    var R = RULES();
    var title, method, arg;

    if (plotTab === 'understanding') {
      method = 'understanding';
      var t = activeTicket(st);
      var base = byTicket[t.id] || {};
      title = 'UNDERSTANDING · ' + t.id;
      var tk = {};
      for (var k in t) if (Object.prototype.hasOwnProperty.call(t, k)) tk[k] = t[k];
      tk.id = t.id; tk.title = base.title || t.id;
      tk.implementReadyAt = R.implementReadyAt;
      tk.correctAt = R.correctAt;
      arg = {
        ticket: tk,
        history: (history[t.id] || []).slice(),
        implementReadyAt: R.implementReadyAt,
        correctAt: R.correctAt,
        asks: askLog.filter(function (x) { return x.ticketId === t.id; })
      };
    } else if (plotTab === 'timeline') {
      method = 'timeline';
      title = 'WHERE THE HOURS WENT';
      arg = {
        tickets: enrichedTickets(st),
        day: num(st.day) ? st.day : 1,
        totalDays: R.days,
        hoursPerDay: R.hoursPerDay,
        hour: st.hour
      };
    } else if (plotTab === 'burn') {
      method = 'burn';
      var mergedIds = st.merged || [];
      title = 'POINTS MERGED VS DAY';
      arg = {
        points: TICKETS.reduce(function (a, x) { return a + (num(x.points) ? x.points : 0); }, 0),
        totalPoints: TICKETS.reduce(function (a, x) { return a + (num(x.points) ? x.points : 0); }, 0),
        merged: mergedIds.map(function (mid) {
          return { id: mid, points: ticketPoints(mid) };
        }),
        mergedIds: mergedIds,
        mergedPoints: mergedIds.reduce(function (a, x) { return a + ticketPoints(x); }, 0),
        tickets: enrichedTickets(st),
        day: num(st.day) ? st.day : 1,
        totalDays: R.days
      };
    } else {
      method = 'trust';
      title = 'TRUST';
      arg = {
        people: PEOPLE.map(function (p) {
          var v = st.trust && num(st.trust[p.id]) ? st.trust[p.id] : null;
          var start = num(p.startTrust) ? p.startTrust : R.startTrust;
          return { id: p.id, name: p.name, role: p.role, trust: v, start: start,
                   startTrust: start, delta: num(v) ? v - start : 0 };
        }),
        avgTrust: st.avgTrust
      };
    }

    setText($['p-title'], title);
    $['p-legend'].classList.toggle('hidden', plotTab !== 'timeline' && plotTab !== 'understanding');
    if (plotTab === 'timeline') {
      setHTML($['p-legend'], ACTIONS.map(function (a) {
        return '<span class="lg"><i style="background:' + actionColor(a.id) + '"></i>' + esc(a.name) + '</span>';
      }).join('') + '<span class="lg"><i style="background:#a371f7"></i>an ask</span>' +
        '<span class="lg"><i style="background:#f85149"></i>negative yield — wasted</span>');
    } else if (plotTab === 'understanding') {
      setHTML($['p-legend'], '<span class="lg">A plateau is the tell: the line stops climbing when the ' +
        'answer is not where you are looking.</span>');
    }

    if (boardPlot && typeof boardPlot[method] === 'function') {
      var ok = call(function () { boardPlot[method](arg); return true; }, 'Board.' + method);
      if (ok) plotOk($['p-err']); else plotErr($['p-err'], 'Board.' + method + '() threw.');
    } else {
      plotErr($['p-err'], 'Board.' + method + '() is not available.');
    }
  }

  /* ---------- the squad feed ---------- */
  function msgKeys(m) {
    if (!m) return [];
    var k = [];
    if (m.id) k.push('id:' + m.id);
    k.push('tx:' + String(m.from || '') + '|' + String(m.text || '').replace(/\s+/g, ' ').trim().slice(0, 90));
    return k;
  }

  function onSquadMessage(m) { pushMsg(m); renderFeed(); }

  function pushMsg(m) {
    if (!m || typeof m !== 'object') return;
    if (!m._review && !String(m.text || '').trim()) return;
    var keys = msgKeys(m);
    for (var i = 0; i < keys.length; i++) if (feedSeen[keys[i]]) return;
    keys.forEach(function (k) { feedSeen[k] = 1; });
    feedMsgs.push(m);
    feedSig = null;
    harvestNames(m.text);
    if (m.tone === 'alarm') {
      toast((m.name || m.from || 'the team') + ': ' + String(m.text || '').slice(0, 90), 'warn');
    }
  }

  function pullSquadFeed() {
    var f = call(function () { return window.Squad.getFeed(); }, 'Squad.getFeed');
    if (!Array.isArray(f)) return;
    f.forEach(pushMsg);
  }

  function renderFeed() {
    var sig = String(feedMsgs.length);
    if (sig === feedSig) return;

    var body = $['fd-body'];
    if (!body) return;
    var stick = body.scrollTop + body.clientHeight >= body.scrollHeight - 40;
    /* append-only, so the scroll position and the entry animation survive */
    var appendOnly = feedDrawn > 0 && feedDrawn <= feedMsgs.length;
    if (!appendOnly) { body.innerHTML = ''; feedDrawn = 0; }

    for (var i = feedDrawn; i < feedMsgs.length; i++) body.appendChild(msgEl(feedMsgs[i]));
    feedDrawn = feedMsgs.length;

    if (!feedMsgs.length) {
      body.appendChild(h('<div class="empty-note">Quiet so far. It will not stay quiet.</div>'));
    }
    setText($['fd-count'], feedMsgs.length + ' messages');
    if (stick) body.scrollTop = body.scrollHeight;
    feedSig = sig;
  }

  function msgEl(m) {
    var from = String(m.from || 'SYS').toUpperCase().replace(/[^A-Z]/g, '');
    var el = document.createElement('div');
    var who = m.name || VOICE_LABEL[from] || from;
    var role = VOICE_LABEL[from] || from;

    if (m._review) {
      var rv = m._review;
      el.className = 'msg review from-' + from + ' ' + (rv.merged ? 'merged' : 'bounced');
      el.innerHTML =
        '<div class="msg-hd"><span class="msg-who">' + esc(who) + '</span>' +
          '<span class="msg-tm num">' + esc(m.t || '') + '</span></div>' +
        '<div class="rv-target">reviewed <b>' + esc(rv.ticketId || '') + '</b>' +
          (num(rv.bounces) && rv.bounces > 0 ? ' · pass ' + (rv.bounces + 1) : '') + '</div>' +
        '<div class="rv-verdict">' + (rv.merged ? '✓ APPROVED — MERGED' : '↺ CHANGES REQUESTED') + '</div>' +
        (rv.intro ? '<div class="msg-tx">' + esc(rv.intro) + '</div>' : '') +
        (rv.comments && rv.comments.length
          ? '<ul class="rv-list">' + rv.comments.map(function (c) {
              return '<li>' + esc(c) + '</li>';
            }).join('') + '</ul>'
          : '') +
        '<div class="rv-ft">' + esc(rv.footer || (rv.merged
          ? 'Nothing else from me. Nice one.'
          : 'Address the comments and push again — a bounce costs a review cycle, not the ticket.')) +
        (num(rv.trustDelta) && Math.abs(rv.trustDelta) >= 0.5
          ? ' <span class="' + cls(rv.trustDelta) + '">trust ' + sgn0(rv.trustDelta) + '</span>' : '') +
        '</div>';
      return el;
    }

    el.className = 'msg from-' + from + ' tone-' + esc(m.tone || 'neutral');
    if (m.id) el.setAttribute('data-msgid', m.id);
    el.innerHTML =
      '<div class="msg-hd"><span class="msg-who">' + esc(who) + '</span>' +
      '<span class="msg-tm num">' + esc(m.t || ('D' + (m.day || '?'))) + '</span></div>' +
      (String(who).toUpperCase() === String(role).toUpperCase()
        ? '' : '<div class="msg-role">' + esc(role) + '</div>') +
      '<div class="msg-tx">' + esc(m.text || '') + '</div>';
    return el;
  }

  /* ---------- engine events ---------- */
  function normComments(raw) {
    if (!raw) return [];
    if (!Array.isArray(raw)) raw = [raw];
    return raw.map(function (c) {
      if (typeof c === 'string') return c;
      if (!c || typeof c !== 'object') return String(c);
      return c.text || c.comment || c.message || c.body || c.reason || JSON.stringify(c);
    }).filter(function (x) { return String(x || '').trim().length; });
  }

  /* A code review is not an error toast. It arrives as a review. */
  function onReview(e) {
    e = e || {};
    var tid = e.ticketId || e.ticket || e.id || '';
    var merged = (e.merged === true) || (e.ok === true) ||
                 e.result === 'merged' || e.status === 'merged' || e.verdict === 'merged';
    var comments = normComments(e.comments || e.notes || e.reasons || e.failures || e.comment);
    var st = lastState || {};
    var reviewer = e.reviewer || e.from || 'nnamdi';
    var rname = byPerson[reviewer] ? byPerson[reviewer].name : (e.name || 'Nnamdi Eze');

    if (!merged && !comments.length) {
      comments = ['Sending this back. I could not follow the reasoning from the diff alone — ' +
                  'walk me through it and we will get it in.'];
    }

    pushMsg({
      id: 'review:' + tid + ':' + (e.at || e.t || st.t || '') + ':' + (e.bounces || 0) + ':' + (merged ? 'm' : 'b'),
      from: 'REVIEWER', name: rname, t: e.t || st.t || '', day: e.day || st.day,
      tone: merged ? 'praise' : 'neutral',
      text: (merged ? 'Approved and merged ' : 'Changes requested on ') + tid,
      _review: {
        ticketId: tid, merged: merged, comments: comments,
        bounces: num(e.bounces) ? e.bounces : undefined,
        intro: e.intro || e.summary || (merged
          ? 'Read it end to end. This one holds up.'
          : 'Read it end to end. A few things before this goes in:'),
        footer: e.footer,
        trustDelta: num(e.trustDelta) ? e.trustDelta : undefined
      }
    });
    toast((merged ? '✓ ' + tid + ' merged' : '↺ ' + tid + ' — ' + rname.split(' ')[0] +
      ' requested changes (' + comments.length + ')'), merged ? 'ok' : 'warn');
    renderFeed();
    refresh(true);
  }

  function answerKey(s) {
    return String(s || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  }

  function onAnswer(e) {
    e = e || {};
    if (askInFlight) return;   // sendAsk() will render the answer it was handed
    var st = lastState || {};
    var who = e.from || e.to || 'channel';
    var text = e.answer || e.text || '';
    if (!String(text).trim()) { refresh(false); return; }
    /* an engine may both RETURN the answer from ask() and emit it as an event —
       show it once */
    var k = answerKey(text);
    if (answersSeen[k]) { refresh(false); return; }
    answersSeen[k] = 1;
    harvestNames(text);
    pushMsg({
      id: 'lateans:' + (e.id || (e.ticketId || '') + ':' + (e.t || st.t || '')),
      from: askVoice(who), name: e.name || askPersonName(who),
      t: e.t || st.t || '', day: e.day || st.day, tone: e.tone || 'neutral',
      text: (e.ticketId ? 're ' + e.ticketId + ' — ' : '') + text
    });
    toast(askPersonName(who) + ' replied' + (e.ticketId ? ' about ' + e.ticketId : ''), 'info');
    renderFeed();
    refresh(false);
  }

  function onTrustEvent(e) {
    if (e && e.who && num(e.delta) && Math.abs(e.delta) >= 1) {
      toast(personName(e.who) + ' trust ' + sgn0(e.delta) + (e.reason ? ' — ' + e.reason : ''),
        e.delta < 0 ? 'warn' : 'ok');
    }
    hdrSig = null;
    refresh(false);
  }

  function onStuck(e) {
    var tid = (e && (e.ticketId || e.id)) || (lastState && lastState.stuckOn) || '';
    toast('Stuck on ' + tid + ' — no understanding gained in hours. Silence is the expensive option.', 'warn');
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
    while ($['toasts'].children.length > 3) $['toasts'].removeChild($['toasts'].firstChild);
    var mine = ++toastSeq;
    setTimeout(function () {
      t.style.transition = 'opacity .3s'; t.style.opacity = '0';
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 320);
    }, 3200 + (mine % 3) * 120);
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

  function statBlk(label, v) {
    return '<div class="stat"><span class="lbl">' + esc(label) + '</span><div class="v num">' + v + '</div></div>';
  }
  function kv(label, v) {
    return '<div><span class="lbl">' + esc(label) + '</span><div class="v num">' + v + '</div></div>';
  }

  /* ---------- gates ---------- */
  function checkGates() {
    var st = lastState;
    if (!st || sprintOver || modalOpen) return;
    var day = num(st.day) ? st.day : 1;
    for (var i = 0; i < GATES.length; i++) {
      var g = GATES[i];
      if (gateFired[g.id] || g.id === 'retro') continue;
      if (day >= (num(g.day) ? g.day : 99)) {
        gateFired[g.id] = true;
        showGate(g);
        return;
      }
    }
  }

  function showGate(g, onContinue) {
    var wasRunning = running;
    enginePause();

    var R = RULES();
    var st = lastState || {};
    var items = GATE_CHECKLIST[g.id] || [];
    var seniorLeft = num(st.seniorLeft) ? st.seniorLeft : R.seniorBudgetHours;
    var mergedIds = st.merged || [];
    var mergedPts = mergedIds.reduce(function (a, x) { return a + ticketPoints(x); }, 0);
    var estimated = (st.tickets || []).filter(function (t) { return num(t.estimateHours); }).length;

    var body =
      '<div class="gate-kicker">DAY ' + esc(g.day) + ' · ' + esc(g.title || 'GATE') + '</div>' +
      '<p class="gate-prompt">' + esc(g.prompt || '') + '</p>' +
      (items.length ? '<div class="lbl" style="margin-bottom:5px">SAY OUT LOUD</div><ul class="gate-list">' +
        items.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '') +
      '<div class="blk" style="margin-top:14px;padding:9px 11px">' +
        '<div class="stat-grid">' +
          statBlk('NOW', esc(st.t || '—')) +
          statBlk('HOURS LEFT', f1(st.hoursLeft)) +
          statBlk('DEEPA LEFT', '<span class="' + (seniorLeft <= 2 ? 'amber' : '') + '">' + f1(seniorLeft) + 'h</span>') +
          statBlk('POINTS MERGED', String(mergedPts)) +
          statBlk('ESTIMATED', estimated + ' / ' + (st.tickets || []).length) +
          statBlk('AVG TRUST', i0(st.avgTrust)) +
        '</div></div>' +
      '<div style="margin-top:14px"><span class="gate-paused">● clock paused</span> ' +
      '<span class="gate-clock">The sprint waits. Go and post it, then come back.</span></div>';

    pushMsg({ id: 'gate:' + g.id, from: 'SYS', name: 'Calendar', t: st.t || ('D' + g.day),
              day: st.day, text: (g.title || 'Gate') + ' — ' + (g.prompt || ''), tone: 'neutral' });
    renderFeed();

    openModal({
      gate: true,
      title: (g.title || 'GATE').toUpperCase(),
      bodyHtml: body,
      okText: "I'VE POSTED IT — CONTINUE",
      okClass: 'primary',
      dismissable: false,
      onOk: function () {
        if (onContinue) { onContinue(); return; }
        if (wasRunning && !sprintOver) engineStart(); else updateTransport();
      }
    });
  }

  /* ================================================================== */
  /* SCREEN 3 — RETRO                                                   */
  /* ================================================================== */
  var RETRO_HTML =
    '<div class="screen center-screen" id="scr-retro">' +
      '<div class="scrollwrap"><div class="retro-wrap">' +
        '<div class="brief-hd"><h2>SPRINT RETRO</h2>' +
          '<div class="dim" id="rt-sub">the sprint is closed · nothing else merges</div></div>' +
        '<div class="rule"></div>' +
        '<div class="retro-grid">' +
          '<div>' +
            '<div class="blk"><h3>The narrative — what happened, in your own words</h3>' +
              '<textarea id="rt-narr" maxlength="4000" placeholder="What you picked up, what you understood and when, where the time actually went, and which questions you asked or did not ask. Tobias has never once been annoyed by an engineer who said they were stuck. He is annoyed by the ones who did not say it."></textarea>' +
              '<div class="note" style="margin-top:6px" id="rt-narrcount">0 characters</div>' +
            '</div>' +
            '<div class="blk"><h3>What you would do differently</h3>' +
              '<textarea id="rt-diff" maxlength="2000" placeholder="Concretely. Which ticket, which hour, which question. &quot;Communicate better&quot; is not an answer; &quot;ask Hannah what a rate limit means before building one&quot; is."></textarea>' +
              '<div class="note" style="margin-top:6px" id="rt-diffcount">0 characters</div>' +
            '</div>' +
            '<div id="rt-msg"></div>' +
            '<div class="foot-row">' +
              '<div class="note">Submitting reveals the ground truth. There is no going back.</div>' +
              '<button class="btn primary big" id="rt-submit">SUBMIT THE RETRO</button>' +
            '</div>' +
          '</div>' +
          '<div><div class="blk"><h3>The facts, as your own tools have them</h3>' +
            '<div id="rt-facts"></div></div></div>' +
        '</div>' +
      '</div></div>' +
    '</div>';

  function wireRetro() {
    on($['rt-submit'], 'click', submitRetro);
    on($['rt-narr'], 'input', function () {
      setText($['rt-narrcount'], String($['rt-narr'].value || '').trim().length + ' characters');
    });
    on($['rt-diff'], 'input', function () {
      setText($['rt-diffcount'], String($['rt-diff'].value || '').trim().length + ' characters');
    });
  }

  function onSprintEnd() {
    if (sprintOver) return;
    sprintOver = true;
    enginePause();
    pullState();
    renderRetro();
    showScreen('retro');
  }

  function renderRetro() {
    var R = RULES();
    var st = lastState || {};
    var mergedIds = st.merged || [];
    var mergedPts = mergedIds.reduce(function (a, x) { return a + ticketPoints(x); }, 0);
    var totalPts = TICKETS.reduce(function (a, x) { return a + (num(x.points) ? x.points : 0); }, 0);
    var seniorLeft = num(st.seniorLeft) ? st.seniorLeft : 0;
    var bounces = (st.tickets || []).reduce(function (a, t) { return a + (num(t.bounces) ? t.bounces : 0); }, 0);

    var html =
      '<div class="stat-grid" style="margin-bottom:12px">' +
        statBlk('POINTS MERGED', mergedPts + ' / ' + totalPts) +
        statBlk('TICKETS MERGED', String(mergedIds.length)) +
        statBlk('BOUNCES', '<span class="' + (bounces ? 'neg' : '') + '">' + bounces + '</span>') +
        statBlk('HOURS SPENT', f1(R.totalHours - (num(st.hoursLeft) ? st.hoursLeft : 0))) +
        statBlk('DEEPA UNUSED', f1(seniorLeft) + 'h') +
        statBlk('AVG TRUST', i0(st.avgTrust)) +
      '</div>' +
      '<div class="lbl" style="margin-bottom:4px">PER TICKET</div>' +
      '<div class="tbl-wrap" style="max-height:250px"><table class="tbl"><thead><tr>' +
        '<th>TICKET</th><th>STATUS</th><th class="r">U</th><th class="r">SPENT</th><th class="r">EST</th>' +
      '</tr></thead><tbody>' +
      TICKETS.map(function (base) {
        var t = stTicket(st, base.id) || {};
        var est = num(t.estimateHours) ? t.estimateHours : NaN;
        var sp = num(t.hoursSpent) ? t.hoursSpent : 0;
        var over = num(est) && est > 0 && sp > est;
        return '<tr><td><b>' + esc(base.id) + '</b></td>' +
          '<td><span class="pill ' + esc(t.status || 'todo') + '">' +
            esc(STATUS_LABEL[t.status] || t.status || 'todo') + '</span></td>' +
          '<td class="r num">' + i0(t.understanding) + '</td>' +
          '<td class="r num ' + (over ? 'neg' : '') + '">' + hm(sp) + '</td>' +
          '<td class="r num dim">' + (num(est) ? hm(est) : '—') + '</td></tr>';
      }).join('') +
      '</tbody></table></div>' +
      '<div class="lbl" style="margin:12px 0 4px">EVERY QUESTION YOU ASKED</div>' +
      (askLog.length
        ? '<div class="tbl-wrap" style="max-height:180px"><table class="tbl"><tbody>' +
          askLog.map(function (x) {
            return '<tr><td class="dim num">' + esc(x.t || '') + '</td>' +
              '<td>' + esc(targetName(x.to)) + '</td>' +
              '<td class="dim">' + esc(x.ticketId) + '</td>' +
              '<td class="r dim num">at ' + hm(x.atHours) + '</td></tr>';
          }).join('') + '</tbody></table></div>'
        : '<div class="err-note">You asked nobody anything, all sprint. That is a result too, and ' +
          'it is the one Tobias will want to talk about.</div>') +
      '<div class="lbl" style="margin:12px 0 4px">TRUST NOW</div>' +
      PEOPLE.map(function (p) {
        var t = st.trust && num(st.trust[p.id]) ? st.trust[p.id] : NaN;
        return '<div class="trust-row"><span class="ell">' + esc(p.name) + '</span>' +
          '<span class="trust-bar"><i class="' + (t < 35 ? 'low' : t < 55 ? 'mid' : '') +
          '" style="width:' + clamp(num(t) ? t : 0, 0, 100) + '%"></i></span>' +
          '<span class="num">' + i0(t) + '</span></div>';
      }).join('');

    setHTML($['rt-facts'], html);
    setHTML($['rt-msg'], '');
  }

  function submitRetro() {
    if (retroDone) return;
    var narrative = String($['rt-narr'].value || '').trim();
    var diff = String($['rt-diff'].value || '').trim();
    if (narrative.length < 40) {
      setHTML($['rt-msg'], '<div class="err-note">Write the narrative first — at least 40 characters. ' +
        'You have ' + narrative.length + '. A retro without the story is a status update.</div>');
      $['rt-narr'].focus();
      return;
    }
    if (diff.length < 20) {
      setHTML($['rt-msg'], '<div class="err-note">"What you would do differently" is the half of the retro ' +
        'that is worth anything — at least 20 characters. You have ' + diff.length + '.</div>');
      $['rt-diff'].focus();
      return;
    }
    var s = call(function () {
      return D().submitRetro({ narrative: narrative, whatIdDoDifferently: diff });
    }, 'Dev.submitRetro');
    if (!s) { setHTML($['rt-msg'], '<div class="err-note">Dev.submitRetro() threw — see the bar at the bottom.</div>'); return; }
    if (s.ok === false) { setHTML($['rt-msg'], '<div class="err-note">' + esc(s.error || 'Rejected.') + '</div>'); return; }
    retroDone = true;
    score = (s && s.score) ? s.score : s;
    pullState();
    /* the screen must be VISIBLE before the truth canvas is measured, or it
       lays itself out against a zero-sized box */
    showScreen('debrief');
    renderDebrief();
    var g = null;
    for (var i = 0; i < GATES.length; i++) if (GATES[i].id === 'retro') g = GATES[i];
    if (g && !gateFired[g.id]) { gateFired[g.id] = true; setTimeout(function () { showGate(g); }, 260); }
  }

  /* ================================================================== */
  /* SCREEN 4 — DEBRIEF                                                 */
  /* ================================================================== */
  var DEBRIEF_HTML =
    '<div class="screen center-screen" id="scr-debrief">' +
      '<div class="scrollwrap"><div class="db-wrap">' +
        '<div class="brief-hd"><h2>DEBRIEF — THE SPRINT, AS IT ACTUALLY WAS</h2>' +
          '<div class="dim" id="db-sub"></div></div>' +
        '<div class="db-hero">' +
          '<div><div class="grade-big" id="db-grade">—</div><div class="grade-sub" id="db-gradesub">GRADE</div></div>' +
          '<div class="db-kv" id="db-kv"></div>' +
        '</div>' +
        '<div id="db-caps"></div>' +
        '<div class="blk"><h3>The route you took against the route that was there — and where the ask should have gone</h3>' +
          '<div class="truth-host" id="db-truth">' +
            '<canvas id="db-truthcanvas"></canvas>' +
            '<div class="plot-err hidden" id="db-trutherr"></div>' +
          '</div>' +
          '<div class="note" style="margin-top:8px">Red is time spent in an action whose yield on that ticket ' +
          'was negative — hours that moved you backwards. The marked point is where asking was the correct move.</div>' +
        '</div>' +
        '<div class="db-grid" style="margin-top:12px">' +
          '<div>' +
            '<div class="blk"><h3>Per-ticket verdict</h3>' +
              '<div class="tbl-wrap" style="max-height:none"><table class="tbl"><thead><tr>' +
                '<th>TICKET</th><th class="r">UNDERSTOOD</th><th class="r">SPENT</th><th class="r">EST</th>' +
                '<th>MERGED</th><th>VERDICT</th>' +
              '</tr></thead><tbody id="db-verdict"></tbody></table></div>' +
            '</div>' +
            '<div class="blk"><h3>What was actually true</h3><div id="db-notes"></div></div>' +
          '</div>' +
          '<div>' +
            '<div class="blk"><h3>Escalation — when you asked, versus when you should have</h3>' +
              '<div id="db-escsum"></div>' +
              '<div class="tbl-wrap" style="max-height:240px;margin-top:8px"><table class="tbl"><thead><tr>' +
                '<th>TICKET</th><th class="r">YOU ASKED AT</th><th class="r">TIMEBOX</th><th>VERDICT</th>' +
              '</tr></thead><tbody id="db-esc"></tbody></table></div>' +
            '</div>' +
            '<div class="blk"><h3>Calibration — your estimates against the clock</h3>' +
              '<div id="db-calibsum"></div>' +
              '<div class="tbl-wrap" style="max-height:220px;margin-top:8px"><table class="tbl"><thead><tr>' +
                '<th>TICKET</th><th class="r">EST</th><th class="r">ACTUAL</th><th class="r">RATIO</th>' +
              '</tr></thead><tbody id="db-calib"></tbody></table></div>' +
            '</div>' +
            '<div class="blk"><h3>Trust ledger</h3><div id="db-trust"></div></div>' +
            '<div class="blk"><h3>Take it to chat</h3>' +
              '<p class="note">Copy the retro markdown and paste it into your chat. Walk the team through ' +
              'the sprint, then go ticket by ticket through what you did and what was true.</p>' +
              '<button class="btn primary wide big" id="db-copy" style="margin-top:8px">COPY RETRO MARKDOWN</button>' +
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

  function wireDebrief() { on($['db-copy'], 'click', copyRetro); }

  function renderDebrief() {
    var R = RULES();
    var sc = score || {};
    var st = lastState || {};

    var grade = String(sc.grade || '?').toUpperCase();
    $['db-grade'].className = 'grade-big grade-' + (grade.charAt(0) || '');
    setText($['db-grade'], grade);
    setText($['db-gradesub'], num(sc.efficiency)
      ? 'EFFICIENCY ' + (sc.efficiency * 100).toFixed(0) + '% OF AN IDEAL SPRINT'
      : 'GRADE');
    setText($['db-sub'], (REPO.scenario.company || '') + ' · ' + (REPO.scenario.team || '') +
      ' · ' + (REPO.scenario.role || ''));

    var trust = sc.trust || {};
    var cal = sc.calibration || {};
    setHTML($['db-kv'],
      kv('POINTS MERGED', i0(sc.mergedPoints) + ' <span class="dim" style="font-size:11px">/ ' +
        i0(sc.totalPoints) + '</span>') +
      kv('TICKETS MERGED', String((sc.merged || st.merged || []).length)) +
      kv('HOURS SPENT', f1(sc.hoursSpent)) +
      kv('WASTED HOURS', '<span class="' + (num(sc.wastedHours) && sc.wastedHours > 0 ? 'neg' : '') + '">' +
        f1(sc.wastedHours) + '</span>') +
      kv('AN IDEAL SPRINT', f1(sc.bestHours) + ' <span class="dim" style="font-size:11px">h</span>') +
      kv('EFFICIENCY', num(sc.efficiency) ? (sc.efficiency * 100).toFixed(0) + '%' : '—') +
      kv('ESCALATION SCORE', num(sc.escalationScore)
        ? '<span class="' + (sc.escalationScore < 0.4 ? 'neg' : sc.escalationScore < 0.7 ? 'amber' : 'pos') + '">' +
          f2(sc.escalationScore) + '</span>' : '—') +
      kv('BOUNCES', '<span class="' + (num(sc.bounces) && sc.bounces > 0 ? 'neg' : '') + '">' + i0(sc.bounces) + '</span>') +
      kv('TESTS SKIPPED', '<span class="' + (num(sc.testsSkipped) && sc.testsSkipped > 0 ? 'neg' : '') + '">' +
        i0(sc.testsSkipped) + '</span>') +
      kv('AVG TRUST', '<span class="' + (num(trust.avg) && trust.avg < 40 ? 'neg' : '') + '">' +
        i0(trust.avg) + '</span>'));

    /* the two hard modifiers, named plainly */
    var caps = [];
    if (num(trust.avg) && trust.avg < 40) {
      caps.push('You finished with average trust at ' + i0(trust.avg) + '. Whatever the board says, this ' +
        'caps the sprint at C — you can ship the tickets and lose the team.');
    }
    var shippedBlind = (sc.perTicket || []).filter(function (p) {
      return p.merged && num(p.understanding) && p.understanding < R.correctAt;
    });
    var blindNames = (Array.isArray(sc.shippedBelowCorrect) && sc.shippedBelowCorrect.length)
      ? sc.shippedBelowCorrect.slice()
      : shippedBlind.map(function (p) { return p.id; });
    if (blindNames.length) {
      caps.push('You merged code you did not understand (' + blindNames.join(', ') + '), by resubmitting ' +
        'rather than by learning more. That is the cardinal sin of this role and it caps the sprint at C.');
    }
    if (num(sc.conventionMisses) && sc.conventionMisses > 0) {
      caps.push('You matched the surrounding code instead of the convention on ' + sc.conventionMisses +
        ' ticket(s). "Do what the neighbours do" is usually right, which is exactly what makes it dangerous.');
    }
    setHTML($['db-caps'], caps.length
      ? caps.map(function (c) { return '<div class="err-note" style="margin-bottom:10px">' + esc(c) + '</div>'; }).join('')
      : '');

    /* Board.truth — DEBRIEF ONLY, and only after submitRetro() */
    if (!boardTruth) {
      boardTruth = call(function () {
        return window.Board.create($['db-truthcanvas'], { theme: 'dark' });
      }, 'Board.create');
    }
    if (boardTruth && typeof boardTruth.truth === 'function') {
      call(function () { if (boardTruth.resize) boardTruth.resize(); }, 'Board.resize');
      var ok = call(function () {
        boardTruth.truth({
          perTicket: (sc.perTicket || []).map(function (p) {
            var o = {};
            for (var k in p) if (Object.prototype.hasOwnProperty.call(p, k)) o[k] = p[k];
            o.title = ticketTitle(p.id);
            o.taken = (actionLog[p.id] || []).map(function (x) { return x.actionId; });
            o.route = (actionLog[p.id] || []).slice();
            o.history = (history[p.id] || []).slice();
            o.asks = askLog.filter(function (x) { return x.ticketId === p.id; });
            return o;
          }),
          paths: sc.paths || sc.bestPath || sc.bestPaths || {},
          escalation: sc.escalation || [],
          hoursPerDay: R.hoursPerDay,
          totalDays: R.days
        });
        return true;
      }, 'Board.truth');
      if (ok) plotOk($['db-trutherr']); else plotErr($['db-trutherr'], 'Board.truth() threw.');
    } else {
      plotErr($['db-trutherr'], 'Board.truth() is not available.');
    }

    /* per-ticket verdict */
    var pt = sc.perTicket || [];
    setHTML($['db-verdict'], pt.length ? pt.map(function (p) {
      var over = num(p.estimate) && p.estimate > 0 && num(p.hoursSpent) && p.hoursSpent > p.estimate;
      return '<tr><td><b>' + esc(p.id) + '</b></td>' +
        '<td class="r num ' + (num(p.understanding) && p.understanding >= R.correctAt ? 'pos'
          : num(p.understanding) && p.understanding >= R.implementReadyAt ? 'amber' : 'dim') + '">' +
          i0(p.understanding) + '</td>' +
        '<td class="r num ' + (over ? 'neg' : '') + '">' + hm(p.hoursSpent) + '</td>' +
        '<td class="r num dim">' + (num(p.estimate) ? hm(p.estimate) : '—') + '</td>' +
        '<td>' + (p.merged ? '<span class="pos">yes</span>' : '<span class="dim">no</span>') + '</td>' +
        '<td class="wrap"><span class="verdict ' +
          (p.merged && String(p.verdict || '').toLowerCase() === 'never' ? 'pos' : verdictClass(p.verdict)) + '">' +
          esc(String(p.verdict || '').toLowerCase() === 'never'
                ? (p.merged ? 'never asked \u00b7 correct' : 'never asked')
                : (p.verdict || '\u2014')) + '</span></td></tr>';
    }).join('') : '<tr><td colspan="6"><div class="empty-note">no per-ticket detail returned</div></td></tr>');

    /* the reveal notes — the most valuable text in the sim */
    setHTML($['db-notes'], pt.filter(function (p) { return p.note || p.cause; }).length
      ? pt.filter(function (p) { return p.note || p.cause; }).map(function (p) {
          return '<div class="note-row' + (p.merged ? ' is-merged' : '') + '">' +
            '<div class="nr-hd"><span class="nr-nm">' + esc(p.id) + ' — ' + esc(ticketTitle(p.id)) + '</span>' +
            '<span class="nr-v">' + (p.merged ? '<span class="pos">merged</span>' : '<span class="dim">not merged</span>') +
            ' · ' + hm(p.hoursSpent) + '</span></div>' +
            (p.note ? '<div class="nr-tx">' + esc(p.note) + '</div>' : '') +
            (p.cause ? '<div class="nr-cause">' + esc(p.cause) + '</div>' : '') +
          '</div>';
        }).join('')
      : '<div class="empty-note">the engine returned no per-ticket notes</div>');

    /* escalation */
    var esc2 = sc.escalation || [];
    var counts = { early: 0, right: 0, late: 0, never: 0, neverCostly: 0 };
    esc2.forEach(function (e) {
      var v = String(e.verdict || '').toLowerCase();
      if (counts[v] !== undefined) counts[v]++;
      /* a "never" only counts against you when the engine withheld credit for it */
      if (v === 'never' && num(e.credit) && e.credit < 0.9) counts.neverCostly++;
    });
    setHTML($['db-escsum'],
      '<div class="stat-grid">' +
        statBlk('SCORE', num(sc.escalationScore) ? f2(sc.escalationScore) : '—') +
        statBlk('ON TIME', '<span class="pos">' + counts.right + '</span>') +
        statBlk('TOO EARLY', '<span class="amber">' + counts.early + '</span>') +
        statBlk('TOO LATE', '<span class="neg">' + counts.late + '</span>') +
        statBlk('NEVER ASKED', '<span class="' + (counts.neverCostly ? 'neg' : 'dim') + '">' + counts.never +
          (counts.never && !counts.neverCostly ? '<span class="dim"> (all correct)</span>' : '') + '</span>') +
        statBlk('DEEPA UNUSED', f1(st.seniorLeft) + 'h') +
      '</div>' +
      '<div class="note" style="margin-top:7px">' +
      (counts.neverCostly >= 3
        ? 'You worked most of this board alone. Independence is not the metric — the metric is how much the ' +
          'team knows about where you are.'
        : counts.early > counts.right
          ? 'More of your questions landed before the timebox than after it. The fix is not to ask less; ' +
            'it is to spend twenty minutes first and then say what you tried.'
          : counts.late > 0
            ? 'At least one question arrived hours after it would have been free. Those hours were the price ' +
              'of not wanting to look like you needed help.'
            : 'Your questions mostly landed after a real timebox. That is the pattern worth keeping.') +
      '</div>');
    setHTML($['db-esc'], esc2.length ? esc2.map(function (e) {
      var ev = escVerdict(e.verdict, e.credit);
      return '<tr><td><b>' + esc(e.ticketId) + '</b></td>' +
        '<td class="r num">' + (num(e.askedAtHours) ? hm(e.askedAtHours) : '<span class="dim">never</span>') + '</td>' +
        '<td class="r num dim">' + (num(e.timeboxHours) ? hm(e.timeboxHours) : '—') + '</td>' +
        '<td><span class="verdict ' + ev.cls + '">' + esc(ev.label) + '</span></td></tr>';
    }).join('') : '<tr><td colspan="4"><div class="empty-note">no escalation record returned</div></td></tr>');

    /* calibration */
    setHTML($['db-calibsum'],
      '<div class="stat-grid">' +
        statBlk('ESTIMATES', i0(cal.n)) +
        statBlk('MEAN RATIO', num(cal.meanRatio)
          ? '<span class="' + (cal.meanRatio > 1.5 ? 'neg' : cal.meanRatio > 1.15 ? 'amber' : 'pos') + '">' +
            f2(cal.meanRatio) + '×</span>' : '—') +
        statBlk('DIRECTION', cal.optimistic === undefined ? '—'
          : (cal.optimistic ? '<span class="neg">optimistic</span>' : '<span class="cyan">pessimistic</span>')) +
      '</div>' +
      '<div class="note" style="margin-top:7px">' +
      (num(cal.meanRatio) && cal.meanRatio > 1.5
        ? 'Everything took about ' + f1(cal.meanRatio) + '× as long as you said it would. That is the ' +
          'direction almost every engineer errs in, and the fix is arithmetic, not effort: multiply your ' +
          'gut number and say the bigger one out loud.'
        : num(cal.meanRatio) && cal.meanRatio < 0.85
          ? 'You padded. Padding is safer for you and worse for everyone planning around you.'
          : 'Your estimates were roughly honest. That is rarer than it sounds in a first sprint.') +
      (cal.worst && cal.worst.ticketId
        ? ' Worst: <b>' + esc(cal.worst.ticketId) + '</b> — said ' + hm(cal.worst.est) +
          ', took ' + hm(cal.worst.actual) + '.'
        : '') +
      '</div>');

    var calRows = Array.isArray(cal.rows) && cal.rows.length ? cal.rows
      : (sc.perTicket || []).filter(function (p) { return num(p.estimate); })
          .map(function (p) { return { ticketId: p.id, est: p.estimate, actual: p.hoursSpent }; });
    setHTML($['db-calib'], calRows.length ? calRows.map(function (r) {
      var e = num(r.est) ? r.est : r.estimate;
      var a = num(r.actual) ? r.actual : r.hoursSpent;
      var ratio = num(e) && e > 0 && num(a) ? a / e : NaN;
      return '<tr><td><b>' + esc(r.ticketId || r.id) + '</b></td>' +
        '<td class="r num cyan">' + hm(e) + '</td>' +
        '<td class="r num">' + hm(a) + '</td>' +
        '<td class="r num ' + (num(ratio) && ratio > 1.5 ? 'neg' : num(ratio) && ratio > 1.15 ? 'amber' : 'pos') + '">' +
          (num(ratio) ? f2(ratio) + '×' : '—') + '</td></tr>';
    }).join('') : '<tr><td colspan="4"><div class="empty-note">you estimated nothing — there is nothing to calibrate</div></td></tr>');

    /* trust ledger */
    var fin = (trust.final) || (st.trust) || {};
    setHTML($['db-trust'], PEOPLE.map(function (p) {
      var t = num(fin[p.id]) ? fin[p.id] : NaN;
      var start = num(p.startTrust) ? p.startTrust : R.startTrust;
      var d = num(t) ? t - start : NaN;
      return '<div class="trust-row"><span class="ell" title="' + esc(p.role || '') + '">' + esc(p.name) + '</span>' +
        '<span class="trust-bar"><i class="' + (t < 35 ? 'low' : t < 55 ? 'mid' : '') +
        '" style="width:' + clamp(num(t) ? t : 0, 0, 100) + '%"></i></span>' +
        '<span class="num">' + i0(t) + ' <span class="' + cls(d) + '" style="font-size:10.5px">' + sgn0(d) + '</span></span>' +
      '</div>';
    }).join('') +
      (trust.biggest && trust.biggest.who
        ? '<div class="note" style="margin-top:8px">Biggest single move: <b>' +
          esc(personName(trust.biggest.who)) + '</b> ' + sgn1(trust.biggest.delta) + '.</div>'
        : '<div class="note" style="margin-top:8px">Nobody moved far in either direction. In a first sprint ' +
          'that usually means you were quiet.</div>'));

    setText($['db-copystatus'], '');
    $['db-copyarea'].classList.add('hidden');

    if (window.requestAnimationFrame) {
      window.requestAnimationFrame(function () {
        call(function () { if (boardTruth && boardTruth.resize) boardTruth.resize(); }, 'Board.resize');
      });
    }
  }

  /* An escalation verdict is meaningless without its credit. "never" on a ticket
     that was always yours to solve is the right answer, and rendering it red tells
     the reader they failed at the one thing they got right. Trust `credit`. */
  function escVerdict(v, credit) {
    var s = String(v || '').toLowerCase().trim();
    var good = num(credit) ? credit >= 0.9 : null;
    if (s === 'never') {
      if (good === true)  return { cls: 'pos',  label: 'never asked \u00b7 correct' };
      if (good === false) return { cls: 'neg',  label: 'never asked' };
      return { cls: 'dim', label: 'never asked' };
    }
    if (s === 'right') return { cls: 'pos', label: 'asked at the right time' };
    if (s === 'early') return { cls: 'amber', label: 'asked too early' };
    if (s === 'late')  return { cls: 'neg', label: 'asked too late' };
    return { cls: good === true ? 'pos' : good === false ? 'neg' : 'dim', label: s || '\u2014' };
  }

  function verdictClass(v) {
    var s = String(v || '').toLowerCase().trim();
    if (/right|correct|good|clean|well|earned|kept/.test(s)) return 'pos';
    if (/false fix|never|waste|sunk|blind|guess|late|too long|misread|unfinished|abandon.*wrong|shipped blind|trap/.test(s)) return 'neg';
    if (/early|partial|slow|rework|bounce/.test(s)) return 'amber';
    return 'dim';
  }

  /* ---------- clipboard (file:// often blocks the async API) ---------- */
  function retroMarkdown() {
    var md = call(function () { return D().exportRetro(); }, 'Dev.exportRetro');
    if (typeof md !== 'string' || !md.length) md = fallbackMarkdown();
    return md;
  }
  function fallbackMarkdown() {
    var R = RULES();
    var st = lastState || {}, sc = score || {};
    var L = [];
    L.push('# Sprint retro — ' + ((REPO.scenario && REPO.scenario.company) || 'Thistle') +
      ', ' + ((REPO.scenario && REPO.scenario.team) || '') + ' team');
    L.push('');
    L.push('_(generated by ui.js fallback — Dev.exportRetro() returned nothing)_');
    L.push('');
    L.push('**Narrative**'); L.push(''); L.push(($['rt-narr'] && $['rt-narr'].value) || '(none)');
    L.push('');
    L.push('**What I would do differently**'); L.push(''); L.push(($['rt-diff'] && $['rt-diff'].value) || '(none)');
    L.push('');
    L.push('**Merged:** ' + ((st.merged || []).join(', ') || 'nothing'));
    L.push('**Deepa\'s budget left unused:** ' + f1(st.seniorLeft) + 'h of ' + f1(R.seniorBudgetHours) + 'h');
    L.push('');
    L.push('| ticket | status | understanding | estimate | actual | bounces |');
    L.push('|---|---|---:|---:|---:|---:|');
    TICKETS.forEach(function (base) {
      var t = stTicket(st, base.id) || {};
      L.push('| ' + base.id + ' | ' + (t.status || 'todo') + ' | ' + i0(t.understanding) + ' | ' +
        (num(t.estimateHours) ? f1(t.estimateHours) + 'h' : '—') + ' | ' + f1(t.hoursSpent) + 'h | ' +
        (t.bounces || 0) + ' |');
    });
    L.push('');
    L.push('**Questions asked**');
    if (!askLog.length) L.push('- none, all sprint');
    askLog.forEach(function (x) {
      L.push('- ' + (x.t || '') + ' → ' + targetName(x.to) + ' re ' + x.ticketId +
        ' (at ' + f1(x.atHours) + 'h on the ticket)' +
        (x.classification ? ' — ' + x.classification : ''));
    });
    L.push('');
    L.push('**Trust:** ' + PEOPLE.map(function (p) {
      return p.name + ' ' + i0(st.trust && st.trust[p.id]);
    }).join(' · '));
    if (sc.grade) L.push('**Grade:** ' + sc.grade);
    return L.join('\n');
  }

  function copyRetro() {
    var md = retroMarkdown();
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
  window.__JES_UI__ = {
    showScreen: showScreen,
    startSprint: function () { startSprint(); },
    state: function () { return lastState; },
    goRetro: function () { onSprintEnd(); },
    select: function (tid) { selectTicket(tid); },
    setAskTo: function (tid) { askTo = tid; renderAsk(lastState, true); },
    setQuestion: function (s) { $['ask-q'].value = s; askDraft[activeId(lastState)] = s; syncAskCount(); },
    setPlotTab: function (tab) {
      plotTab = tab;
      qa('[data-tab]', $['p-tabs']).forEach(function (x) {
        x.classList.toggle('is-on', x.getAttribute('data-tab') === tab);
      });
      renderPlot(lastState);
    },
    gate: function (gid) {
      for (var i = 0; i < GATES.length; i++) {
        if (GATES[i].id === gid) { gateFired[gid] = true; showGate(GATES[i]); return; }
      }
    },
    abandon: function () { openAbandonDialog(); },
    pushReview: function (e) { onReview(e); },
    refresh: function () { refresh(true); },
    pause: function () { enginePause(); }
  };

})();
