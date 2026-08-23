/* ============================================================================
   DAY TRADER SIM — sim/ui.js
   Implements SPEC §5: session select, briefing, trading floor, gate modal,
   close-out. Vanilla JS. No frameworks, no build step, no fetch().
   Depends only on the documented public APIs of:
     window.SIM_DAYS  (data/days.js)
     window.Engine    (sim/engine.js)
     window.Chart     (sim/chart.js)
     window.Desk      (sim/desk.js)
   ============================================================================ */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* module state                                                        */
  /* ------------------------------------------------------------------ */
  var root = null;          // #dts-root
  var S = {};               // screens by id
  var $ = {};               // cached elements by id

  var day = null;           // current Day
  var dayIdx = 0;           // 0..2
  var account = null;       // Account | null
  var startEquity = 0;      // equity at the start of this session
  var chart = null;         // main floor chart instance
  var pmChart = null;       // briefing pre-market chart instance

  var lastState = null;
  var running = false;
  var speed = 60;
  var gateFired = {};
  var closeHandled = false;
  var riskLog = [];
  var feedMsgs = [];
  var blotterDrawn = 0;
  var workingSig = null;   /* null (not '') so the first empty render still paints */
  var tickWallClock = 0;    // performance.now() of last tick (for the seconds hand)
  var clockRaf = 0;
  var toastSeq = 0;
  var modalStack = [];
  var enginePausedByModal = false;

  var ticket = { side: 'BUY', type: 'MKT' };

  var DEFAULT_GATES = [
    { m: 570, id: 'open',   title: 'Pitch your plan',
      prompt: 'Before the bell: post your plan to your PM in chat.' },
    { m: 720, id: 'midday', title: 'Midday risk check',
      prompt: 'Marcus wants your book, your P&L, and what you\'re doing about it.' },
    { m: 961, id: 'close',  title: 'P&L review',
      prompt: 'Paste your tearsheet into chat. Dana will go trade by trade.' }
  ];
  var GATES = DEFAULT_GATES;

  var ROLE_NAME = { PM: 'PM', RISK: 'RISK', DESK: 'DESK', WIRE: 'NEWS WIRE', SYS: 'SYSTEM' };

  /* ------------------------------------------------------------------ */
  /* tiny helpers                                                        */
  /* ------------------------------------------------------------------ */
  function id(x) { return document.getElementById(x); }
  function q(sel, ctx) { return (ctx || document).querySelector(sel); }
  function qa(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }

  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function num(n) { return (typeof n === 'number' && isFinite(n)); }

  function money(n, opt) {
    if (!num(n)) return '—';
    opt = opt || {};
    var dp = opt.dp === undefined ? 2 : opt.dp;
    var a = Math.abs(n);
    var s = a.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
    var sign = n < -0.0000001 ? '-' : (opt.sign && n > 0.0000001 ? '+' : '');
    return sign + '$' + s;
  }
  function money0(n, opt) {
    opt = opt || {}; opt.dp = 0; return money(n, opt);
  }
  function px2(n) { return num(n) ? n.toFixed(2) : '—'; }
  function intf(n) { return num(n) ? Math.round(n).toLocaleString('en-US') : '—'; }
  function pctf(n, dp) { return num(n) ? n.toFixed(dp === undefined ? 1 : dp) + '%' : '—'; }
  function signPct(n, dp) {
    if (!num(n)) return '—';
    return (n > 0 ? '+' : '') + n.toFixed(dp === undefined ? 2 : dp) + '%';
  }
  function cls(n) { return !num(n) || Math.abs(n) < 0.005 ? 'flat' : (n > 0 ? 'pos' : 'neg'); }

  function mToHHMM(m) {
    if (!num(m)) return '--:--';
    var mm = ((Math.floor(m) % 1440) + 1440) % 1440;
    return pad2(Math.floor(mm / 60)) + ':' + pad2(mm % 60);
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function h(html) {
    var d = document.createElement('div');
    d.innerHTML = html.trim();
    return d.firstElementChild;
  }

  function on(node, ev, fn) { if (node) node.addEventListener(ev, fn); }

  function setText(node, txt) {
    if (!node) return;
    if (node._t === txt) return;
    node._t = txt;
    node.textContent = txt;
  }

  /* set a numeric readout: updates text, colour class, and flashes on change */
  function setNum(node, txt, val, colour) {
    if (!node) return;
    var changed = node._t !== txt;
    if (changed) { node._t = txt; node.textContent = txt; }
    if (colour) {
      var c = cls(val);
      if (node._c !== c) {
        node.classList.remove('pos', 'neg', 'flat');
        node.classList.add(c);
        node._c = c;
      }
    }
    if (changed && num(val) && num(node._v)) {
      flash(node, val > node._v ? 'up' : (val < node._v ? 'dn' : null));
    }
    if (num(val)) node._v = val;
  }

  function flash(node, dir) {
    if (!node || !dir) return;
    node.classList.remove('flash-up', 'flash-dn');
    /* force reflow so the animation restarts */
    void node.offsetWidth;
    node.classList.add(dir === 'up' ? 'flash-up' : 'flash-dn');
  }

  /* ------------------------------------------------------------------ */
  /* boot + defensive diagnostics                                        */
  /* ------------------------------------------------------------------ */
  var REQUIRED = [
    { global: 'SIM_DAYS', file: 'data/days.js', kind: 'array',
      check: function (v) { return v && v.length >= 1 && v[0] && v[0].bars && v[0].bars.length; },
      detail: 'window.SIM_DAYS must be an array of Day objects, each with a bars[] array.' },
    { global: 'Engine', file: 'sim/engine.js', kind: 'object',
      methods: ['init', 'start', 'pause', 'resume', 'setSpeed', 'step', 'getState',
                'submit', 'flatten', 'getWorking', 'on', 'exportReview'],
      detail: 'window.Engine must expose the lifecycle/order/event API from SPEC §2.' },
    { global: 'Chart', file: 'sim/chart.js', kind: 'object',
      methods: ['create'],
      detail: 'window.Chart.create(canvas, opts) must return an object with render()/resize().' },
    { global: 'Desk', file: 'sim/desk.js', kind: 'object',
      methods: ['init', 'tick', 'getFeed'],
      detail: 'window.Desk must expose init/tick/getFeed and (ideally) GATES.' }
  ];

  function auditGlobals() {
    var rows = [];
    for (var i = 0; i < REQUIRED.length; i++) {
      var r = REQUIRED[i];
      var v = window[r.global];
      var missingMethods = [];
      var ok = !!v;
      if (ok && r.methods) {
        for (var j = 0; j < r.methods.length; j++) {
          if (typeof v[r.methods[j]] !== 'function') missingMethods.push(r.methods[j]);
        }
        if (missingMethods.length) ok = false;
      }
      if (ok && r.check) { try { ok = !!r.check(v); } catch (e) { ok = false; } }
      rows.push({ spec: r, present: !!v, ok: ok, missingMethods: missingMethods });
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
      var r = rows[i];
      var status, why;
      if (r.ok) { status = '<span class="diag-ok">OK</span>'; why = '<span class="dim">—</span>'; }
      else if (!r.present) {
        status = '<span class="diag-bad">MISSING</span>';
        why = 'window.' + esc(r.spec.global) + ' is undefined — the file did not load or threw ' +
              'while parsing. Open the browser console (Cmd-Opt-J) for the parse error.';
      } else if (r.missingMethods.length) {
        status = '<span class="diag-bad">INCOMPLETE</span>';
        why = 'Loaded, but missing method(s): <b>' + esc(r.missingMethods.join(', ')) + '</b>';
      } else {
        status = '<span class="diag-bad">INVALID</span>';
        why = esc(r.spec.detail);
      }
      html += '<tr><td><b>window.' + esc(r.spec.global) + '</b></td><td class="dim">' +
        esc(r.spec.file) + '</td><td>' + status + '</td><td>' + why + '</td></tr>';
    }
    html += '</tbody></table>' +
      '<div class="diag-box"><b>Expected load order (index.html):</b><br>' +
      '&lt;script src="data/days.js"&gt;&lt;/script&gt;<br>' +
      '&lt;script src="sim/engine.js"&gt;&lt;/script&gt;<br>' +
      '&lt;script src="sim/chart.js"&gt;&lt;/script&gt;<br>' +
      '&lt;script src="sim/desk.js"&gt;&lt;/script&gt;<br>' +
      '&lt;script src="sim/ui.js"&gt;&lt;/script&gt;<br><br>' +
      'Everything must run from <code>file://</code> — no ES modules, no fetch(), no CDN.' +
      '</div></div>';
    document.body.innerHTML = '';
    var d = h('<div id="dts-root"></div>');
    d.innerHTML = html;
    document.body.appendChild(d);
  }

  function boot() {
    var rows = auditGlobals();
    var bad = rows.filter(function (r) { return !r.ok; });
    if (bad.length) { renderDiagnostics(rows); return; }

    if (window.Desk && Array.isArray(window.Desk.GATES) && window.Desk.GATES.length) {
      GATES = window.Desk.GATES;
    }

    buildDom();
    installGlobalErrorBar();
    account = safeLoadAccount();
    renderSelect();
    showScreen('select');
  }

  function installGlobalErrorBar() {
    window.addEventListener('error', function (ev) {
      showErrBar('JS error: ' + (ev.message || 'unknown') +
                 (ev.filename ? '  (' + String(ev.filename).split('/').pop() + ':' + ev.lineno + ')' : ''));
    });
  }
  function showErrBar(msg) {
    var bar = id('dts-errbar');
    if (!bar) {
      bar = h('<div class="errbar" id="dts-errbar"><span id="dts-errmsg"></span>' +
              '<button class="btn ghost" id="dts-errx">dismiss</button></div>');
      document.body.appendChild(bar);
      on(id('dts-errx'), 'click', function () { bar.remove(); });
    }
    id('dts-errmsg').textContent = msg;
  }

  function safeLoadAccount() {
    try {
      if (typeof window.Engine.loadAccount === 'function') {
        var a = window.Engine.loadAccount();
        if (a && typeof a === 'object') {
          if (!Array.isArray(a.sessions)) a.sessions = [];
          return a;
        }
      }
    } catch (e) { /* localStorage can be blocked on file:// in some browsers */ }
    return null;
  }

  function rules() {
    return (window.Engine && window.Engine.RULES) || {
      startEquity: 25000, leverage: 4, maxDailyLoss: -1500, warnDailyLoss: -900,
      noNewAfterM: 955, forceFlatM: 958, commissionPerShare: 0.005, minCommission: 1.00
    };
  }

  /* ------------------------------------------------------------------ */
  /* DOM construction                                                    */
  /* ------------------------------------------------------------------ */
  function buildDom() {
    document.body.innerHTML = '';
    root = h('<div id="dts-root"></div>');
    root.appendChild(h(SELECT_HTML));
    root.appendChild(h(BRIEF_HTML));
    root.appendChild(h(FLOOR_HTML));
    root.appendChild(h(CLOSE_HTML));
    root.appendChild(h('<div id="modal-layer"><div class="modal-bg"></div></div>'));
    document.body.appendChild(root);

    S.select = id('scr-select');
    S.brief  = id('scr-brief');
    S.floor  = id('scr-floor');
    S.close  = id('scr-close');

    cacheFloorEls();
    wireSelect();
    wireBrief();
    wireFloor();
    wireClose();
    wireKeyboard();

    window.addEventListener('resize', function () {
      try { if (chart && chart.resize) chart.resize(); } catch (e) {}
      try { if (pmChart && pmChart.resize) pmChart.resize(); } catch (e) {}
    });
  }

  function showScreen(name) {
    ['select', 'brief', 'floor', 'close'].forEach(function (k) {
      if (S[k]) S[k].classList.toggle('active', k === name);
    });
  }

  /* ================================================================== */
  /* SCREEN 1 — SESSION SELECT                                          */
  /* ================================================================== */
  var SELECT_HTML =
    '<div class="screen center-screen" id="scr-select">' +
      '<div class="scrollwrap"><div class="sheet">' +
        '<div class="brand"><h1>DAY TRADER</h1>' +
          '<span class="sub">desk simulator · three sessions · one account</span></div>' +
        '<div class="rule"></div>' +
        '<div class="acct-bar" id="sel-acct"></div>' +
        '<div class="sess-list" id="sel-list"></div>' +
        '<div class="foot-row">' +
          '<div class="note" id="sel-note"></div>' +
          '<button class="btn danger" id="sel-reset">RESET ACCOUNT</button>' +
        '</div>' +
      '</div></div>' +
    '</div>';

  function wireSelect() {
    on(id('sel-reset'), 'click', function () {
      openModal({
        danger: true,
        title: 'RESET ACCOUNT?',
        bodyHtml: '<p>This erases your equity, all completed sessions, every blotter and ' +
          'every trade note. You will start again at ' + esc(money0(rules().startEquity)) + '.</p>' +
          '<p class="dim">The whole point of the exercise is that day 2 is traded with day 1\'s ' +
          'damage in mind. Only reset if you want a clean slate.</p>',
        okText: 'YES, WIPE IT',
        okClass: 'danger',
        cancelText: 'KEEP MY ACCOUNT',
        onOk: function () {
          try { window.localStorage.removeItem('dts.account.v1'); } catch (e) {}
          try {
            if (typeof window.Engine.saveAccount === 'function' && window.Engine.resetAccount) {
              window.Engine.resetAccount();
            }
          } catch (e) {}
          account = null;
          renderSelect();
          toast('Account reset — starting fresh at ' + money0(rules().startEquity) + '.', 'info');
        }
      });
    });
  }

  function completedCount() {
    return account && account.sessions ? account.sessions.length : 0;
  }

  function renderSelect() {
    var R = rules();
    var days = window.SIM_DAYS;
    var sessions = (account && account.sessions) || [];
    var equity = (account && num(account.equity)) ? account.equity : R.startEquity;
    var totalPnl = equity - R.startEquity;
    var done = sessions.length;

    var wins = 0, losses = 0, trades = 0;
    sessions.forEach(function (s) {
      wins += s.wins || 0; losses += s.losses || 0; trades += s.nTrades || 0;
    });

    id('sel-acct').innerHTML =
      cell('ACCOUNT EQUITY', money(equity)) +
      cell('P&L TO DATE', '<span class="' + cls(totalPnl) + '">' + money(totalPnl, { sign: true }) + '</span>') +
      cell('SESSIONS COMPLETE', done + ' / ' + days.length) +
      cell('TRADES · W/L', trades + ' · ' + wins + '/' + losses);

    var html = '';
    for (var i = 0; i < days.length; i++) {
      var d = days[i];
      var s = sessions[i] || null;
      var state = s ? 'done' : (i === done ? 'next' : 'locked');
      html += sessionCard(d, i, s, state, R);
    }
    id('sel-list').innerHTML = html;

    qa('[data-start]', id('sel-list')).forEach(function (b) {
      on(b, 'click', function () { startSession(parseInt(b.getAttribute('data-start'), 10)); });
    });

    var note;
    if (done >= days.length) {
      note = 'All three sessions are complete. Your final equity is <b>' + esc(money(equity)) +
             '</b>. Reset the account to run the programme again.';
    } else if (done === 0) {
      note = 'Buying power is <b>' + esc(money0(equity * R.leverage)) + '</b> (' + R.leverage +
             '× intraday). Daily loss limit <b class="neg">' + esc(money0(R.maxDailyLoss)) +
             '</b> — hit it and risk flattens you and locks the day.';
    } else {
      note = 'Carrying <b>' + esc(money(equity)) + '</b> into session ' + (done + 1) +
             '. Day ' + (done + 1) + ' is traded with day ' + done + '\'s damage in mind.';
    }
    id('sel-note').innerHTML = note;
  }

  function cell(label, valueHtml) {
    return '<div class="acct-cell"><span class="lbl">' + esc(label) + '</span>' +
           '<div class="v num">' + valueHtml + '</div></div>';
  }

  function sessionCard(d, i, s, state, R) {
    var html = '<div class="sess-card ' + (state === 'next' ? 'is-next' : state === 'locked' ? 'is-locked' : '') + '">' +
      '<div class="sess-no">' + (i + 1) + '</div>' +
      '<div><div class="sess-ttl">' + esc(d.ticker || '—') +
      ' <span class="dim" style="font-weight:400">· ' + esc(d.company || '') + '</span></div>' +
      '<div class="sess-sub">' + esc(d.sector || '') + '</div>';

    if (s) {
      html += '<div class="sess-res">' +
        res('DAY P&L', '<span class="' + cls(s.dayPnl) + '">' + money(s.dayPnl, { sign: true }) + '</span>') +
        res('TRADES', intf(s.nTrades)) +
        res('W/L', (s.wins || 0) + '/' + (s.losses || 0)) +
        res('MAX DD', '<span class="neg">' + money(s.maxDrawdown) + '</span>') +
        res('END EQUITY', money(s.endEquity)) +
        '</div>';
    } else if (state === 'next') {
      html += '<div class="sess-res"><div class="dim">Pre-market brief unlocks when you start. ' +
        'Prev close ' + esc(px2(d.prevClose)) + '.</div></div>';
    }
    html += '</div><div class="sess-act">';

    if (s) {
      html += '<span class="badge done">COMPLETE</span>' +
        (s.locked ? ' <span class="badge risk">RISK LOCKED</span>' : '');
    } else if (state === 'next') {
      html += '<button class="btn primary big" data-start="' + i + '">START SESSION ' + (i + 1) + ' &rarr;</button>';
    } else {
      html += '<span class="badge locked">LOCKED</span>';
    }
    html += '</div></div>';
    return html;
  }

  function res(label, v) {
    return '<div><span class="lbl">' + esc(label) + '</span><span class="num">' + v + '</span></div>';
  }

  /* ================================================================== */
  /* SCREEN 2 — BRIEFING                                                */
  /* ================================================================== */
  var BRIEF_HTML =
    '<div class="screen center-screen" id="scr-brief">' +
      '<div class="scrollwrap"><div class="brief-wrap">' +
        '<div class="brief-hd">' +
          '<h2 id="b-title">SESSION 1 · ORVX</h2>' +
          '<div class="dim" id="b-when">08:45 ET · pre-open briefing</div>' +
        '</div>' +
        '<div class="rule"></div>' +
        '<div class="brief-grid">' +
          '<div>' +
            '<div class="blk headline"><h3>Overnight</h3><p id="b-headline"></p></div>' +
            '<div class="two-col" style="margin-top:12px">' +
              '<div class="blk bull"><h3>Bull case</h3><p id="b-bull"></p></div>' +
              '<div class="blk bear"><h3>Bear case</h3><p id="b-bear"></p></div>' +
            '</div>' +
            '<div class="blk ask"><h3>Dana (PM) wants</h3><p id="b-ask"></p></div>' +
            '<div class="blk"><h3>Your line today</h3>' +
              '<div class="stat-grid" id="b-line"></div></div>' +
          '</div>' +
          '<div>' +
            '<div class="blk"><h3>Pre-market</h3><div class="stat-grid" id="b-premkt"></div></div>' +
            '<div class="blk"><h3>Key levels</h3><table class="lvl-tbl"><tbody id="b-levels"></tbody></table></div>' +
            '<div class="blk"><h3>Pre-market tape</h3>' +
              '<div class="premkt-chart" id="b-chart-host"><canvas id="b-canvas"></canvas>' +
              '<div class="chart-err hidden" id="b-chart-err"></div></div>' +
              '<div class="dim" style="margin-top:6px;font-size:10.5px">' +
                'Nothing after this point exists yet. No lookahead — you see what the tape shows, when it shows it.' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="foot-row">' +
          '<button class="btn ghost" id="b-back">&larr; BACK TO SESSIONS</button>' +
          '<button class="btn primary big" id="b-bell">RING THE BELL &rarr;</button>' +
        '</div>' +
      '</div></div>' +
    '</div>';

  function wireBrief() {
    on(id('b-back'), 'click', function () {
      teardownSession();
      renderSelect();
      showScreen('select');
    });
    on(id('b-bell'), 'click', ringTheBell);
  }

  function startSession(i) {
    dayIdx = i;
    day = window.SIM_DAYS[i];
    if (!day) { toast('No day data at index ' + i, 'err'); return; }
    renderBrief();
    showScreen('brief');
    /* the pre-market chart needs layout before it can size itself */
    setTimeout(renderPremktChart, 0);
  }

  function renderBrief() {
    var R = rules();
    var b = day.brief || {};
    var p = day.premkt || {};
    var equity = (account && num(account.equity)) ? account.equity : R.startEquity;

    setText(id('b-title'), 'SESSION ' + (day.sessionNo || (dayIdx + 1)) + ' · ' + (day.ticker || '') +
      ' · ' + (day.company || ''));
    setText(id('b-when'), mToHHMM((day.openM || 570) - 45) + ' ET · pre-open briefing · ' + (day.sector || ''));

    id('b-headline').textContent = b.headline || '(no headline in data)';
    id('b-bull').textContent = b.bullCase || '(none)';
    id('b-bear').textContent = b.bearCase || '(none)';
    id('b-ask').textContent = b.pmAsk || '(none)';

    id('b-premkt').innerHTML =
      stat('LAST', px2(p.last)) +
      stat('GAP', '<span class="' + cls(p.gapPct) + '">' + signPct(p.gapPct) + '</span>') +
      stat('PREV CLOSE', px2(day.prevClose)) +
      stat('PM HIGH', px2(p.high)) +
      stat('PM LOW', px2(p.low)) +
      stat('PM VOLUME', intf(p.volume));

    id('b-line').innerHTML =
      stat('EQUITY', money0(equity)) +
      stat('BUYING POWER', money0(equity * R.leverage)) +
      stat('LOSS LIMIT', '<span class="neg">' + money0(R.maxDailyLoss) + '</span>') +
      stat('SOFT WARN', '<span class="amber">' + money0(R.warnDailyLoss) + '</span>') +
      stat('NO NEW AFTER', mToHHMM(R.noNewAfterM)) +
      stat('FORCED FLAT', mToHHMM(R.forceFlatM));

    var lv = (b.levels || []).slice();
    if (num(day.prevClose) && !lv.some(function (x) { return Math.abs(x.px - day.prevClose) < 0.005; })) {
      lv.unshift({ label: 'Prev close', px: day.prevClose });
    }
    id('b-levels').innerHTML = lv.length
      ? lv.map(function (l) {
          return '<tr><td class="dim">' + esc(l.label) + '</td><td class="num">' + esc(px2(l.px)) + '</td></tr>';
        }).join('')
      : '<tr><td class="dim">(no levels in data)</td><td></td></tr>';
  }

  function stat(label, v) {
    return '<div class="stat"><span class="lbl">' + esc(label) + '</span><div class="v num">' + v + '</div></div>';
  }

  function lastPremktIdx() {
    var bars = day.bars || [], last = -1;
    for (var i = 0; i < bars.length; i++) {
      if (bars[i].rth === false || bars[i].m < (day.openM || 570)) last = i; else break;
    }
    return last;
  }

  function renderPremktChart() {
    var host = id('b-chart-host'), errEl = id('b-chart-err');
    var upto = lastPremktIdx();
    if (upto < 0) {
      errEl.classList.remove('hidden');
      errEl.style.color = '#8b949e';
      errEl.textContent = 'No pre-market bars in this day\'s data.';
      return;
    }
    errEl.classList.add('hidden');
    try {
      if (!pmChart) pmChart = window.Chart.create(id('b-canvas'), { theme: 'dark' });
      if (pmChart.resize) pmChart.resize();
      pmChart.render({
        bars: day.bars,
        upto: upto,
        window: Math.max(20, upto + 1),
        overlays: [],
        levels: chartLevels(),
        markers: [],
        position: { shares: 0, avgPx: 0 }
      });
    } catch (e) {
      errEl.classList.remove('hidden');
      errEl.textContent = 'Chart failed to render: ' + (e && e.message ? e.message : e);
    }
  }

  function chartLevels() {
    var out = [];
    if (num(day.prevClose)) out.push({ px: day.prevClose, label: 'PC', color: '#8b949e' });
    ((day.brief && day.brief.levels) || []).slice(0, 6).forEach(function (l) {
      if (!num(l.px)) return;
      if (Math.abs(l.px - day.prevClose) < 0.005) return;
      out.push({ px: l.px, label: shortLabel(l.label), color: '#4d5866' });
    });
    return out;
  }
  function shortLabel(s) {
    if (!s) return '';
    var words = String(s).split(/[\s\-\/]+/).filter(Boolean);
    if (words.length === 1) return words[0].slice(0, 6).toUpperCase();
    return words.map(function (w) { return w[0]; }).join('').toUpperCase().slice(0, 4);
  }

  /* ------------------------------------------------------------------ */
  /* session lifecycle                                                   */
  /* ------------------------------------------------------------------ */
  function ringTheBell() {
    var R = rules();
    startEquity = (account && num(account.equity)) ? account.equity : R.startEquity;

    /* reset per-session UI state */
    lastState = null; running = false; gateFired = {}; closeHandled = false;
    riskLog = []; feedMsgs = []; blotterDrawn = 0; workingSig = null;
    id('f-blotter-body').innerHTML = '';
    id('f-feed-body').innerHTML = '';
    id('f-working-body').innerHTML = '';
    ticket.side = 'BUY'; ticket.type = 'MKT';
    id('t-thesis').value = '';
    id('t-qty').value = '100';
    id('t-px').value = '';
    clearTicketMsg();
    syncTicketButtons();

    try {
      window.Engine.init({ day: day, account: account });
    } catch (e) {
      toast('Engine.init failed: ' + e.message, 'err');
      showErrBar('Engine.init threw: ' + e.message);
      return;
    }

    /* wire engine events (Engine.init may or may not clear old handlers; we
       guard with a session token so stale handlers become no-ops) */
    sessionToken++;
    bindEngine(sessionToken);

    try {
      window.Desk.init({ day: day, engine: window.Engine, onMessage: onDeskMessage });
    } catch (e) {
      showErrBar('Desk.init threw: ' + e.message);
    }

    showScreen('floor');
    setSpeed(speed);

    /* chart needs the floor laid out first */
    setTimeout(function () {
      try {
        if (!chart) chart = window.Chart.create(id('c-canvas'), { theme: 'dark' });
        if (chart.resize) chart.resize();
      } catch (e) {
        chartError(e);
      }
      /* seed the display with the pre-open state */
      pullState();

      /* pre-open gate (m <= openM) fires before the clock runs */
      var g = firstGateAtOrBefore(day.openM || 570);
      if (g) {
        gateFired[g.id] = true;
        showGate(g, function () { engineStart(); });
      } else {
        engineStart();
      }
    }, 0);
  }

  var sessionToken = 0;

  function bindEngine(token) {
    var live = function () { return token === sessionToken; };
    window.Engine.on('tick', function (st) { if (live()) safe(onTick)(st); });
    window.Engine.on('fill', function (f, st) { if (live()) safe(onFill)(f, st); });
    window.Engine.on('risk', function (e) { if (live()) safe(onRisk)(e); });
    window.Engine.on('close', function (sum) { if (live()) safe(onEngineClose)(sum); });
    window.Engine.on('reject', function (r) { if (live()) safe(onReject)(r); });
  }

  function safe(fn) {
    return function () {
      try { return fn.apply(null, arguments); }
      catch (e) { showErrBar('UI handler error: ' + (e && e.message ? e.message : e)); }
    };
  }

  function engineStart() {
    try { window.Engine.start(); running = true; }
    catch (e) { toast('Engine.start failed: ' + e.message, 'err'); }
    updateTransport();
    startClockLoop();
  }

  function teardownSession() {
    sessionToken++;
    stopClockLoop();
    try { if (window.Engine && window.Engine.destroy) window.Engine.destroy(); } catch (e) {}
    running = false;
    lastState = null;
  }

  /* ================================================================== */
  /* SCREEN 3 — TRADING FLOOR                                           */
  /* ================================================================== */
  var FLOOR_HTML =
    '<div class="screen" id="scr-floor">' +
      '<div class="hdr">' +
        '<div class="hdr-l">' +
          '<div>' +
            '<div class="clock num" id="f-clock">09:30:00</div>' +
            '<div class="clock-sub"><span id="f-session">SESSION 1</span> · <b id="f-ticker">—</b>' +
            ' · <span id="f-company"></span></div>' +
          '</div>' +
        '</div>' +
        '<div class="hdr-c">' +
          '<div class="ctl-row">' +
            '<span class="lbl">SPEED</span>' +
            '<div class="seg" id="f-speed">' +
              '<button class="seg-b" data-speed="30">30&times;</button>' +
              '<button class="seg-b is-on" data-speed="60">60&times;</button>' +
              '<button class="seg-b" data-speed="120">120&times;</button>' +
              '<button class="seg-b" data-speed="240">240&times;</button>' +
            '</div>' +
            '<button class="btn" id="f-pause">PAUSE</button>' +
            '<button class="btn" id="f-step">STEP</button>' +
            '<button class="btn danger" id="f-flat">FLATTEN</button>' +
            '<button class="btn warn hidden" id="f-end">END DAY</button>' +
          '</div>' +
          '<div id="f-status" class="dim">Pre-open.</div>' +
        '</div>' +
        '<div class="hdr-r">' +
          '<div class="pnl-wrap">' +
            '<div class="lbl">DAY P&amp;L</div>' +
            '<div class="pnl-big num" id="f-daypnl">$0.00</div>' +
          '</div>' +
          '<div class="hdr-kv">' +
            '<div><span class="lbl">EQUITY</span><span class="num" id="f-equity">—</span></div>' +
            '<div><span class="lbl">BUYING PWR</span><span class="num" id="f-bp">—</span></div>' +
            '<div><span class="lbl">EXPOSURE</span><span class="num" id="f-expo">—</span></div>' +
            '<div><span class="lbl">% OF LINE</span><span class="num" id="f-line">—</span></div>' +
          '</div>' +
        '</div>' +
      '</div>' +

      '<div class="floor-grid">' +

        '<section class="panel p-chart">' +
          '<div class="panel-hd">' +
            '<span>CHART · <b id="c-ticker">—</b> · 1&nbsp;MIN</span>' +
            '<span class="chart-quote"><span class="num" id="c-last">—</span>' +
            '<span class="num" id="c-chg">—</span>' +
            '<span class="dim num" id="c-vol">—</span></span>' +
          '</div>' +
          '<div class="panel-bd nopad chart-host" id="c-host">' +
            '<canvas id="c-canvas"></canvas>' +
            '<div class="chart-err hidden" id="c-err"></div>' +
          '</div>' +
        '</section>' +

        '<div class="p-mid">' +
          '<section class="panel p-ticket">' +
            '<div class="panel-hd"><span>ORDER TICKET</span><span class="dim" id="t-bp">—</span></div>' +
            '<div class="panel-bd">' +
              '<div class="side-row">' +
                '<button class="side-b buy is-on" id="t-buy" data-side="BUY">BUY</button>' +
                '<button class="side-b sell" id="t-sell" data-side="SELL">SELL</button>' +
              '</div>' +
              '<div class="fld">' +
                '<span class="lbl">QUANTITY</span>' +
                '<input type="text" id="t-qty" value="100" inputmode="numeric" autocomplete="off">' +
                '<div class="qty-btns">' +
                  '<button class="btn" data-qty="100">+100</button>' +
                  '<button class="btn" data-qty="500">+500</button>' +
                  '<button class="btn" id="t-max">MAX</button>' +
                  '<button class="btn ghost" id="t-clear">C</button>' +
                '</div>' +
              '</div>' +
              '<div class="fld">' +
                '<span class="lbl">TYPE / LIMIT PRICE</span>' +
                '<div class="type-row">' +
                  '<div class="seg" id="t-type">' +
                    '<button class="seg-b is-on" data-type="MKT">MKT</button>' +
                    '<button class="seg-b" data-type="LMT">LMT</button>' +
                    '<button class="seg-b" data-type="STP">STP</button>' +
                  '</div>' +
                  '<input type="text" id="t-px" placeholder="—" disabled autocomplete="off">' +
                '</div>' +
              '</div>' +
              '<div class="fld">' +
                '<div class="thesis-lbl"><span class="lbl">THESIS</span>' +
                  '<span class="lbl" id="t-thesis-state"></span></div>' +
                '<textarea id="t-thesis" maxlength="400" placeholder="Why this trade, right now? Level, catalyst, invalidation."></textarea>' +
              '</div>' +
              '<button class="btn primary wide" id="t-submit">SUBMIT · BUY 100 MKT</button>' +
              '<div id="t-msg"></div>' +
              '<div class="kbd-hint"><kbd>B</kbd>/<kbd>S</kbd> side · <kbd>Enter</kbd> submit · ' +
              '<kbd>F</kbd> flatten · <kbd>Space</kbd> pause</div>' +
            '</div>' +
          '</section>' +

          '<section class="panel p-pos">' +
            '<div class="panel-hd"><span>POSITION &amp; P&amp;L</span><span id="p-state" class="dim">FLAT</span></div>' +
            '<div class="panel-bd">' +
              '<div class="kv"><span class="k">Shares</span><span class="v num" id="p-shares">0</span></div>' +
              '<div class="kv"><span class="k">Avg px</span><span class="v num" id="p-avg">—</span></div>' +
              '<div class="kv"><span class="k">Last</span><span class="v num" id="p-last">—</span></div>' +
              '<div class="kv"><span class="k">Unrealized</span><span class="v num" id="p-unreal">—</span></div>' +
              '<div class="kv"><span class="k">Realized</span><span class="v num" id="p-real">—</span></div>' +
              '<div class="kv big"><span class="k">Day P&amp;L</span><span class="v num" id="p-day">—</span></div>' +
              '<div class="kv"><span class="k">Exposure</span><span class="v num" id="p-expo">—</span></div>' +
              '<div class="kv"><span class="k">% of line</span><span class="v num" id="p-line">—</span></div>' +
              '<div class="line-bar"><div class="line-fill" id="p-linebar"></div></div>' +
              '<div class="kv"><span class="k">Commissions</span><span class="v num" id="p-comm">—</span></div>' +
              '<div class="mini-stats">' +
                '<div><span class="lbl">TRADES</span><span class="v num" id="p-ntr">0</span></div>' +
                '<div><span class="lbl">W / L</span><span class="v num" id="p-wl">0/0</span></div>' +
                '<div><span class="lbl">MAX DD</span><span class="v num neg" id="p-dd">—</span></div>' +
              '</div>' +
            '</div>' +
          '</section>' +
        '</div>' +

        '<section class="panel p-feed">' +
          '<div class="panel-hd"><span>DESK FEED</span>' +
            '<span class="dim">DANA · MARCUS · PRIYA · WIRE</span></div>' +
          '<div class="panel-bd feed-bd" id="f-feed-body"></div>' +
        '</section>' +

        '<div class="p-bottom">' +
          '<section class="panel p-working">' +
            '<div class="panel-hd"><span>WORKING ORDERS</span><span class="dim" id="w-count">0</span></div>' +
            '<div class="panel-bd nopad" style="overflow:auto">' +
              '<table class="tbl"><thead><tr>' +
                '<th>SIDE</th><th class="r">QTY</th><th>TYPE</th><th class="r">PX</th><th></th>' +
              '</tr></thead><tbody id="f-working-body"></tbody></table>' +
            '</div>' +
          '</section>' +
          '<section class="panel p-blotter">' +
            '<div class="panel-hd"><span>BLOTTER</span><span class="dim" id="bl-count">0 fills</span></div>' +
            '<div class="panel-bd nopad" style="overflow:auto">' +
              '<table class="tbl"><thead><tr>' +
                '<th>TIME</th><th>SIDE</th><th class="r">QTY</th><th class="r">PX</th>' +
                '<th class="r">NOTIONAL</th><th class="r">COMM</th><th>WHY</th><th>THESIS</th>' +
              '</tr></thead><tbody id="f-blotter-body"></tbody></table>' +
            '</div>' +
          '</section>' +
        '</div>' +

      '</div>' +
      '<div class="toasts" id="f-toasts"></div>' +
    '</div>';

  function cacheFloorEls() {
    ['f-clock', 'f-session', 'f-ticker', 'f-company', 'f-status', 'f-daypnl', 'f-equity',
     'f-bp', 'f-expo', 'f-line', 'f-pause', 'f-step', 'f-flat', 'f-end',
     'c-ticker', 'c-last', 'c-chg', 'c-vol', 'c-err', 'c-canvas',
     't-qty', 't-px', 't-thesis', 't-submit', 't-msg', 't-bp', 't-thesis-state',
     'p-state', 'p-shares', 'p-avg', 'p-last', 'p-unreal', 'p-real', 'p-day', 'p-expo',
     'p-line', 'p-linebar', 'p-comm', 'p-ntr', 'p-wl', 'p-dd',
     'f-feed-body', 'f-working-body', 'f-blotter-body', 'w-count', 'bl-count', 'f-toasts'
    ].forEach(function (k) { $[k] = id(k); });
  }

  function wireFloor() {
    qa('#f-speed .seg-b').forEach(function (b) {
      on(b, 'click', function () { setSpeed(parseInt(b.getAttribute('data-speed'), 10)); });
    });
    on($['f-pause'], 'click', togglePause);
    on($['f-step'], 'click', function () {
      try { window.Engine.step(); } catch (e) { toast('step failed: ' + e.message, 'err'); }
      pullState();
    });
    on($['f-flat'], 'click', function () { doFlatten(); });
    on($['f-end'], 'click', function () {
      if (!lastState) return;
      onEngineClose({ manual: true });
    });

    /* ticket */
    qa('#scr-floor .side-b').forEach(function (b) {
      on(b, 'click', function () { setSide(b.getAttribute('data-side')); });
    });
    qa('#t-type .seg-b').forEach(function (b) {
      on(b, 'click', function () { setType(b.getAttribute('data-type')); });
    });
    qa('.qty-btns [data-qty]').forEach(function (b) {
      on(b, 'click', function () {
        var cur = parseInt($['t-qty'].value, 10) || 0;
        $['t-qty'].value = String(cur + parseInt(b.getAttribute('data-qty'), 10));
        syncTicketButtons();
      });
    });
    on(id('t-max'), 'click', function () {
      var mx = maxQty();
      $['t-qty'].value = String(mx);
      if (mx <= 0) showTicketMsg('No room on the line at this price — reduce first.', 'err');
      else clearTicketMsg();
      syncTicketButtons();
    });
    on(id('t-clear'), 'click', function () { $['t-qty'].value = '0'; syncTicketButtons(); });
    on($['t-qty'], 'input', syncTicketButtons);
    on($['t-px'], 'input', syncTicketButtons);
    on($['t-thesis'], 'input', syncTicketButtons);
    on($['t-submit'], 'click', submitTicket);

    /* Enter submits from any ticket field; Shift+Enter newlines in the thesis */
    ['t-qty', 't-px', 't-thesis'].forEach(function (k) {
      on($[k], 'keydown', function (ev) {
        if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); submitTicket(); }
      });
    });
  }

  /* ---------- transport ---------- */
  function setSpeed(mult) {
    speed = mult;
    qa('#f-speed .seg-b').forEach(function (b) {
      b.classList.toggle('is-on', parseInt(b.getAttribute('data-speed'), 10) === mult);
    });
    try { window.Engine.setSpeed(mult); } catch (e) {}
  }

  function togglePause() {
    if (!lastState) return;
    if (running) {
      try { window.Engine.pause(); } catch (e) {}
      running = false;
    } else {
      try { window.Engine.resume(); } catch (e) {}
      running = true;
    }
    updateTransport();
  }

  function updateTransport() {
    setText($['f-pause'], running ? 'PAUSE' : 'RESUME');
    $['f-pause'].classList.toggle('warn', !running);
    $['f-step'].disabled = running;
  }

  function doFlatten() {
    if (!lastState) return;
    if (!lastState.position || !lastState.position.shares) {
      showTicketMsg('You are already flat.', 'err');
      return;
    }
    try { window.Engine.flatten('MANUAL'); toast('Flatten sent — fills on the next bar.', 'info'); }
    catch (e) { toast('flatten failed: ' + e.message, 'err'); }
    pullState();
  }

  /* ---------- ticket ---------- */
  function setSide(s) {
    ticket.side = s;
    syncTicketButtons();
  }
  function setType(t) {
    ticket.type = t;
    var needsPx = (t === 'LMT' || t === 'STP');
    $['t-px'].disabled = !needsPx;
    if (needsPx && !$['t-px'].value && lastState && lastState.bar) {
      $['t-px'].value = px2(lastState.bar.c);
    }
    if (!needsPx) $['t-px'].value = '';
    qa('#t-type .seg-b').forEach(function (b) {
      b.classList.toggle('is-on', b.getAttribute('data-type') === t);
    });
    syncTicketButtons();
  }

  function currentPx() {
    if (lastState && lastState.bar && num(lastState.bar.c)) return lastState.bar.c;
    if (day && num(day.prevClose)) return day.prevClose;
    return 0;
  }

  function maxQty() {
    if (!lastState) return 0;
    var p = currentPx();
    if (!p) return 0;
    var bp = num(lastState.buyingPower) ? lastState.buyingPower : 0;
    var pos = (lastState.position && lastState.position.shares) || 0;
    var dir = ticket.side === 'BUY' ? 1 : -1;
    /* |pos + dir*qty| * px <= bp   ->   qty <= bp/px - dir*pos  */
    var qmax = Math.floor((bp * 0.995) / p - dir * pos);
    return Math.max(0, qmax);
  }

  /* does this ticket, as typed, increase the position (and therefore need a thesis)? */
  function increasesPosition() {
    if (!lastState) return true;
    var pos = (lastState.position && lastState.position.shares) || 0;
    var dir = ticket.side === 'BUY' ? 1 : -1;
    if (pos === 0) return true;
    return (dir > 0) === (pos > 0);
  }

  function syncTicketButtons() {
    qa('#scr-floor .side-b').forEach(function (b) {
      b.classList.toggle('is-on', b.getAttribute('data-side') === ticket.side);
    });
    var qty = parseInt($['t-qty'].value, 10) || 0;
    var label = 'SUBMIT · ' + ticket.side + ' ' + intf(qty) + ' ' + ticket.type;
    if (ticket.type !== 'MKT' && $['t-px'].value) label += ' @ ' + $['t-px'].value;
    setText($['t-submit'], label);
    $['t-submit'].classList.toggle('danger', ticket.side === 'SELL');
    $['t-submit'].classList.toggle('primary', ticket.side === 'BUY');

    var need = increasesPosition();
    var th = ($['t-thesis'].value || '').trim();
    $['t-thesis'].classList.toggle('needed', need && th.length < 10);
    var st = $['t-thesis-state'];
    if (!need) { st.textContent = 'reducing — optional'; st.className = 'lbl dim'; }
    else if (th.length >= 10) { st.textContent = 'ok · ' + th.length + ' chars'; st.className = 'lbl ok'; }
    else { st.textContent = 'required · ' + th.length + '/10'; st.className = 'lbl req'; }
  }

  function showTicketMsg(text, kind) {
    $['t-msg'].innerHTML = '<div class="' + (kind === 'ok' ? 'ticket-ok' : 'ticket-err') + '">' +
      esc(text) + '</div>';
  }
  function clearTicketMsg() { $['t-msg'].innerHTML = ''; }

  function submitTicket() {
    if (!lastState) { showTicketMsg('The session has not started yet.', 'err'); return; }
    var qty = parseInt($['t-qty'].value, 10);
    if (!qty || qty <= 0) { showTicketMsg('Enter a quantity greater than zero.', 'err'); return; }

    var order = { side: ticket.side, qty: qty, type: ticket.type,
                  thesis: ($['t-thesis'].value || '').trim() };

    if (ticket.type !== 'MKT') {
      var p = parseFloat($['t-px'].value);
      if (!num(p) || p <= 0) {
        showTicketMsg(ticket.type + ' orders need a price.', 'err');
        $['t-px'].focus();
        return;
      }
      order.px = p;
    }

    if (increasesPosition() && order.thesis.length < 10) {
      showTicketMsg('Thesis required — at least 10 characters. Say why, at this level, right now.', 'err');
      $['t-thesis'].focus();
      return;
    }

    var r;
    try { r = window.Engine.submit(order); }
    catch (e) { showTicketMsg('Engine.submit threw: ' + e.message, 'err'); return; }

    if (!r || r.ok !== true) {
      showTicketMsg('REJECTED — ' + ((r && r.error) || 'unknown reason'), 'err');
      flash($['t-msg'], 'dn');
      return;
    }

    var verb = ticket.type === 'MKT' ? 'working — fills on the next bar'
             : ticket.type === 'LMT' ? 'resting at ' + px2(order.px)
             : 'stop armed at ' + px2(order.px);
    showTicketMsg(ticket.side + ' ' + intf(qty) + ' ' + ticket.type + ' ' + verb + '.', 'ok');
    if (increasesPosition()) $['t-thesis'].value = '';
    syncTicketButtons();
    pullState();
  }

  /* ---------- keyboard ---------- */
  function inField(t) {
    if (!t) return false;
    var n = (t.tagName || '').toUpperCase();
    return n === 'INPUT' || n === 'TEXTAREA' || n === 'SELECT' || t.isContentEditable;
  }

  function wireKeyboard() {
    document.addEventListener('keydown', function (ev) {
      /* modal open: only Escape / Enter matter, handled by the modal itself */
      if (modalStack.length) return;
      if (!S.floor || !S.floor.classList.contains('active')) return;
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;

      var k = ev.key;
      if (inField(ev.target)) {
        if (k === 'Escape') { ev.target.blur(); }
        return;
      }
      if (k === 'b' || k === 'B') { ev.preventDefault(); setSide('BUY'); $['t-qty'].focus(); $['t-qty'].select(); }
      else if (k === 's' || k === 'S') { ev.preventDefault(); setSide('SELL'); $['t-qty'].focus(); $['t-qty'].select(); }
      else if (k === 'f' || k === 'F') { ev.preventDefault(); doFlatten(); }
      else if (k === 'Enter') { ev.preventDefault(); submitTicket(); }
      else if (k === ' ' || k === 'Spacebar') { ev.preventDefault(); togglePause(); }
      else if (k === 't' || k === 'T') { ev.preventDefault(); $['t-thesis'].focus(); }
    });
  }

  /* ---------- engine event handlers ---------- */
  function pullState() {
    var st = null;
    try { st = window.Engine.getState(); } catch (e) { return; }
    if (st) onTick(st);
  }

  function onTick(st) {
    var isNewBar = !lastState || lastState.m !== st.m;
    lastState = st;
    if (typeof st.running === 'boolean') { running = st.running; }
    if (isNewBar) tickWallClock = now();

    renderFloor(st);
    renderChart(st);

    try { window.Desk.tick(st); } catch (e) { showErrBar('Desk.tick threw: ' + e.message); }

    checkGates(st);
    updateTransport();

    if (!closeHandled && num(st.m) && num(day.closeM) && st.m > day.closeM) {
      onEngineClose({ auto: true });
    }
  }

  function now() {
    return (window.performance && performance.now) ? performance.now() : Date.now();
  }

  function renderFloor(st) {
    var R = rules();
    var pos = st.position || { shares: 0, avgPx: 0 };
    var bar = st.bar || {};
    var last = num(bar.c) ? bar.c : day.prevClose;

    setText($['f-session'], 'SESSION ' + (day.sessionNo || (dayIdx + 1)));
    setText($['f-ticker'], day.ticker || '—');
    setText($['f-company'], day.company || '');
    setText($['c-ticker'], day.ticker || '—');

    /* header numbers */
    setNum($['f-daypnl'], money(st.dayPnl, { sign: true }), st.dayPnl, true);
    setNum($['f-equity'], money(st.equity), st.equity, false);
    setNum($['f-bp'], money0(st.buyingPower), st.buyingPower, false);
    setNum($['f-expo'], money0(st.exposure), st.exposure, false);

    var linePct = st.buyingPower ? (st.exposure / st.buyingPower) * 100 : 0;
    setNum($['f-line'], pctf(linePct), linePct, false);

    /* quote */
    var chg = num(last) && num(day.prevClose) ? last - day.prevClose : null;
    var chgPct = num(chg) && day.prevClose ? (chg / day.prevClose) * 100 : null;
    setNum($['c-last'], px2(last), last, false);
    if ($['c-last']) {
      $['c-last'].classList.remove('pos', 'neg', 'flat');
      $['c-last'].classList.add(cls(chg));
    }
    setNum($['c-chg'], num(chg) ? (chg > 0 ? '+' : '') + chg.toFixed(2) + '  ' + signPct(chgPct) : '—', chg, true);
    setText($['c-vol'], num(bar.v) ? 'vol ' + intf(bar.v) : '');

    /* status line */
    var status, scls = '';
    if (st.locked) { status = 'TRADING LOCKED — daily loss limit hit. Risk pulled your card.'; scls = 'is-alarm'; }
    else if (num(st.m) && st.m >= R.forceFlatM) { status = 'Risk is flattening whatever is left. ' + mToHHMM(R.forceFlatM) + '.'; scls = 'is-alarm'; }
    else if (num(st.m) && st.m >= R.noNewAfterM) { status = 'No new or increasing positions after ' + mToHHMM(R.noNewAfterM) + '.'; scls = 'is-warn'; }
    else if (num(st.dayPnl) && st.dayPnl <= R.warnDailyLoss) { status = 'Soft warning — ' + money(st.dayPnl) + ' against a ' + money0(R.maxDailyLoss) + ' limit.'; scls = 'is-warn'; }
    else if (!running) { status = 'PAUSED — clock stopped.'; scls = 'is-warn'; }
    else { status = 'Market open · new positions allowed until ' + mToHHMM(R.noNewAfterM) + '.'; }
    setText($['f-status'], status);
    $['f-status'].className = 'dim ' + scls;

    $['f-end'].classList.toggle('hidden', !st.locked || closeHandled);
    $['t-submit'].disabled = !!st.locked;

    /* position panel */
    var sh = pos.shares || 0;
    setText($['p-state'], sh > 0 ? 'LONG' : sh < 0 ? 'SHORT' : 'FLAT');
    $['p-state'].className = sh > 0 ? 'pos' : sh < 0 ? 'neg' : 'dim';
    setNum($['p-shares'], intf(sh), sh, false);
    setNum($['p-avg'], sh ? px2(pos.avgPx) : '—', pos.avgPx, false);
    setNum($['p-last'], px2(last), last, false);
    setNum($['p-unreal'], money(st.unrealized, { sign: true }), st.unrealized, true);
    setNum($['p-real'], money(st.realized, { sign: true }), st.realized, true);
    setNum($['p-day'], money(st.dayPnl, { sign: true }), st.dayPnl, true);
    setNum($['p-expo'], money0(st.exposure), st.exposure, false);
    setNum($['p-line'], pctf(linePct), linePct, false);
    setNum($['p-comm'], money(st.commissions), st.commissions, false);

    var fill = $['p-linebar'];
    fill.style.width = Math.max(0, Math.min(100, linePct)) + '%';
    fill.classList.toggle('hot', linePct >= 80 && linePct < 100);
    fill.classList.toggle('max', linePct >= 100);

    var stt = st.stats || {};
    setText($['p-ntr'], intf(stt.nTrades || 0));
    setText($['p-wl'], (stt.wins || 0) + '/' + (stt.losses || 0));
    setNum($['p-dd'], money(stt.maxDrawdown || 0), stt.maxDrawdown || 0, false);

    setText($['t-bp'], 'max ' + intf(maxQty()) + ' sh');

    renderWorking();
    renderBlotter(st);
    syncTicketButtons();
  }

  function renderChart(st) {
    if (!chart) return;
    try {
      chart.render({
        bars: day.bars,
        upto: num(st.idx) ? st.idx : 0,
        window: 120,
        overlays: ['vwap', 'ema9', 'ema20'],
        levels: chartLevels(),
        markers: (st.blotter || []).map(function (f) {
          return { m: f.m, px: f.px, side: f.side, qty: f.qty };
        }),
        position: st.position || { shares: 0, avgPx: 0 }
      });
      $['c-err'].classList.add('hidden');
    } catch (e) {
      chartError(e);
    }
  }

  function chartError(e) {
    $['c-err'].classList.remove('hidden');
    $['c-err'].textContent = 'Chart render failed: ' + (e && e.message ? e.message : e) +
      '  —  trading still works; the tape is in the blotter.';
  }

  function renderWorking() {
    var w = [];
    try { w = window.Engine.getWorking() || []; } catch (e) { w = []; }
    var sig = w.map(function (o) {
      return [o.id, o.side, o.qty, o.type, o.px].join(':');
    }).join('|');
    if (sig === workingSig) return;
    workingSig = sig;

    setText($['w-count'], String(w.length));
    if (!w.length) {
      $['f-working-body'].innerHTML =
        '<tr><td colspan="5"><div class="empty-note">no resting orders</div></td></tr>';
      return;
    }
    $['f-working-body'].innerHTML = w.map(function (o) {
      return '<tr>' +
        '<td><span class="side-tag ' + esc(o.side) + '">' + esc(o.side) + '</span></td>' +
        '<td class="r num">' + esc(intf(o.qty)) + '</td>' +
        '<td class="dim">' + esc(o.type) + '</td>' +
        '<td class="r num">' + esc(px2(o.px)) + '</td>' +
        '<td class="r"><button class="btn-x" data-cancel="' + esc(o.id) + '">×</button></td>' +
        '</tr>';
    }).join('');
    qa('[data-cancel]', $['f-working-body']).forEach(function (b) {
      on(b, 'click', function () {
        try { window.Engine.cancel(b.getAttribute('data-cancel')); }
        catch (e) { toast('cancel failed: ' + e.message, 'err'); }
        workingSig = '__';
        pullState();
      });
    });
  }

  function renderBlotter(st) {
    var bl = st.blotter || [];
    if (bl.length === blotterDrawn) return;
    /* rebuild only the new fills, newest first */
    var frag = document.createDocumentFragment();
    for (var i = blotterDrawn; i < bl.length; i++) {
      frag.insertBefore(blotterRow(bl[i]), frag.firstChild);
    }
    $['f-blotter-body'].insertBefore(frag, $['f-blotter-body'].firstChild);
    blotterDrawn = bl.length;
    setText($['bl-count'], bl.length + (bl.length === 1 ? ' fill' : ' fills'));
  }

  function blotterRow(f) {
    var tr = document.createElement('tr');
    tr.innerHTML =
      '<td class="dim num">' + esc(f.t || mToHHMM(f.m)) + '</td>' +
      '<td><span class="side-tag ' + esc(f.side) + '">' + esc(f.side) + '</span></td>' +
      '<td class="r num">' + esc(intf(f.qty)) + '</td>' +
      '<td class="r num">' + esc(px2(f.px)) + '</td>' +
      '<td class="r num">' + esc(money0(f.notional)) + '</td>' +
      '<td class="r num dim">' + esc(money(f.commission)) + '</td>' +
      '<td><span class="reason-tag">' + esc(f.reason || 'MANUAL') + '</span></td>' +
      '<td class="thesis-cell" title="' + esc(f.thesis || '') + '">' + esc(f.thesis || '—') + '</td>';
    tr.classList.add(f.side === 'BUY' ? 'flash-up' : 'flash-dn');
    return tr;
  }

  function onFill(f, st) {
    if (st) lastState = st;
    var side = f.side === 'BUY' ? 'BOUGHT' : 'SOLD';
    toast(side + ' ' + intf(f.qty) + ' @ ' + px2(f.px) +
          (f.reason && f.reason !== 'MANUAL' ? '  [' + f.reason + ']' : ''),
          f.side === 'BUY' ? 'ok' : 'warn');
    pullState();
  }

  function onRisk(e) {
    e = e || {};
    var lvl = e.level || (e.hard ? 'hard' : 'warn');
    riskLog.push({ m: lastState ? lastState.m : null, level: lvl, message: e.message || '' });
    toast('RISK — ' + (e.message || (lvl === 'hard' ? 'daily loss limit hit' : 'loss warning')),
          lvl === 'hard' ? 'err' : 'warn');
    if (lvl === 'hard') {
      pushFeed({ from: 'SYS', name: 'System', m: lastState ? lastState.m : null,
                 text: 'Trading locked for the day. Risk flattened the book.', tone: 'alarm' });
    }
    pullState();
  }

  function onReject(r) {
    /* manual submits already surface their error inline; this covers engine-side
       rejections of resting orders */
    if (r && r.error) toast('Order rejected — ' + r.error, 'err');
  }

  /* ---------- desk feed ---------- */
  function onDeskMessage(msg) {
    if (!msg) return;
    pushFeed(msg);
  }

  function pushFeed(msg) {
    feedMsgs.push(msg);
    var body = $['f-feed-body'];
    var stick = body.scrollTop + body.clientHeight >= body.scrollHeight - 40;
    var from = (msg.from || 'DESK').toUpperCase();
    var el = document.createElement('div');
    el.className = 'msg from-' + esc(from) + ' tone-' + esc(msg.tone || 'neutral');
    el.innerHTML =
      '<div class="msg-hd">' +
        '<span class="msg-who">' + esc(msg.name || ROLE_NAME[from] || from) +
        ' <span class="msg-role">· ' + esc(ROLE_NAME[from] || from) + '</span></span>' +
        '<span class="msg-tm num">' + esc(msg.t || mToHHMM(msg.m)) + '</span>' +
      '</div>' +
      '<div class="msg-tx">' + esc(msg.text || '') + '</div>';
    body.appendChild(el);
    if (stick) body.scrollTop = body.scrollHeight;
  }

  /* ---------- toasts ---------- */
  function toast(text, kind) {
    var t = document.createElement('div');
    t.className = 'toast ' + (kind || 'info');
    t.textContent = text;
    $['f-toasts'].appendChild(t);
    /* never let the stack blanket the blotter — keep the three most recent */
    while ($['f-toasts'].children.length > 3) {
      $['f-toasts'].removeChild($['f-toasts'].firstChild);
    }
    var mine = ++toastSeq;
    setTimeout(function () {
      t.style.transition = 'opacity .3s'; t.style.opacity = '0';
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 320);
    }, 3200 + (mine % 3) * 120);
  }

  /* ---------- live clock (seconds hand between bars) ---------- */
  function startClockLoop() {
    stopClockLoop();
    var loop = function () {
      clockRaf = window.requestAnimationFrame(loop);
      paintClock();
    };
    clockRaf = window.requestAnimationFrame(loop);
  }
  function stopClockLoop() {
    if (clockRaf) window.cancelAnimationFrame(clockRaf);
    clockRaf = 0;
  }
  function paintClock() {
    if (!lastState || !num(lastState.m)) return;
    var barMs = 60000 / (speed || 60);
    var sec = 0;
    if (running && tickWallClock) {
      sec = Math.floor(((now() - tickWallClock) / barMs) * 60);
      if (sec < 0) sec = 0; if (sec > 59) sec = 59;
    }
    setText($['f-clock'], mToHHMM(lastState.m) + ':' + pad2(sec));
  }

  /* ================================================================== */
  /* SCREEN 4 — MODALS (gate + confirm)                                 */
  /* ================================================================== */
  function firstGateAtOrBefore(m) {
    for (var i = 0; i < GATES.length; i++) {
      var g = GATES[i];
      if (gateFired[g.id]) continue;
      if (isCloseGate(g)) continue;
      if (g.m <= m) return g;
    }
    return null;
  }
  function isCloseGate(g) {
    return g.id === 'close' || (num(day && day.closeM) && g.m > day.closeM);
  }
  function checkGates(st) {
    if (!num(st.m)) return;
    for (var i = 0; i < GATES.length; i++) {
      var g = GATES[i];
      if (gateFired[g.id] || isCloseGate(g)) continue;
      if (st.m >= g.m) { gateFired[g.id] = true; showGate(g); return; }
    }
  }

  var GATE_CHECKLIST = {
    open: ['The ticker, the setup, and the level you care about',
           'Your first trade: side, size, entry, stop, target',
           'What would make you wrong — and what you do then',
           'The most you are willing to lose today'],
    midday: ['Current position, average price and unrealized',
             'Realized P&L and how you got there',
             'Which of this morning\'s theses survived contact',
             'Your plan for the afternoon — including doing nothing'],
    close: ['The full tearsheet (copy button on the next screen)',
            'Trade by trade: what you thought, what happened',
            'The worst decision of the day, named plainly',
            'One rule you will carry into the next session']
  };

  function showGate(g, onContinue) {
    var wasRunning = running;
    try { window.Engine.pause(); } catch (e) {}
    running = false;
    updateTransport();

    var items = GATE_CHECKLIST[g.id] || [];
    var body =
      '<div class="gate-kicker">' + esc(mToHHMM(g.m)) + ' ET · desk gate</div>' +
      '<p class="gate-prompt">' + esc(g.prompt || '') + '</p>' +
      (items.length ? '<div class="lbl" style="margin-bottom:5px">INCLUDE</div><ul class="gate-list">' +
        items.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '') +
      '<div style="margin-top:14px"><span class="gate-paused">● clock paused</span> ' +
      '<span class="gate-clock">The tape waits. Go and write it, then come back.</span></div>';

    /* Desk normally fires its own message for the gate (SPEC §4). Only add our
       own transcript line if it did not, so the feed does not say it twice. */
    var promptSeen = feedMsgs.slice(-6).some(function (msg) {
      return g.prompt && String(msg.text || '').indexOf(g.prompt) >= 0;
    });
    if (!promptSeen) {
      pushFeed({ from: 'SYS', name: 'Desk gate', m: g.m, t: mToHHMM(g.m),
                 text: g.title + ' — ' + (g.prompt || ''), tone: 'neutral' });
    }

    openModal({
      gate: true,
      title: (g.title || 'DESK GATE').toUpperCase(),
      bodyHtml: body,
      okText: "I'VE POSTED IT — CONTINUE",
      okClass: 'primary',
      cancelText: null,
      dismissable: false,
      onOk: function () {
        if (onContinue) { onContinue(); return; }
        if (wasRunning) {
          try { window.Engine.resume(); running = true; } catch (e) {}
        }
        updateTransport();
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
    on(okBtn, 'click', function () { close(); if (opt.onOk) opt.onOk(); });
    var cancelBtn = q('[data-cancel]', m);
    if (cancelBtn) on(cancelBtn, 'click', function () { close(); if (opt.onCancel) opt.onCancel(); });
    var xBtn = q('[data-x]', m);
    if (xBtn) on(xBtn, 'click', function () { close(); if (opt.onCancel) opt.onCancel(); });

    function keyh(ev) {
      if (ev.key === 'Escape' && opt.dismissable !== false) {
        ev.preventDefault(); ev.stopPropagation(); close(); if (opt.onCancel) opt.onCancel();
      } else if (ev.key === 'Enter') {
        ev.preventDefault(); ev.stopPropagation(); close(); if (opt.onOk) opt.onOk();
      }
    }
    document.addEventListener('keydown', keyh, true);
    setTimeout(function () { try { okBtn.focus(); } catch (e) {} }, 30);
  }

  /* ================================================================== */
  /* SCREEN 5 — CLOSE-OUT                                               */
  /* ================================================================== */
  var CLOSE_HTML =
    '<div class="screen center-screen" id="scr-close">' +
      '<div class="scrollwrap"><div class="close-wrap">' +
        '<div class="brief-hd">' +
          '<h2 id="co-title">SESSION CLOSED</h2>' +
          '<div class="dim" id="co-when">16:00 ET · the bell</div>' +
        '</div>' +
        '<div class="close-hero">' +
          '<div><div class="lbl">DAY P&amp;L</div><div class="close-pnl num" id="co-pnl">$0.00</div>' +
            '<div class="dim num" id="co-pnl-sub"></div></div>' +
          '<div class="close-kv" id="co-kv"></div>' +
        '</div>' +
        '<div class="tear-grid">' +
          '<div>' +
            '<div class="blk"><h3>Trades</h3>' +
              '<div class="tbl-wrap"><table class="tbl"><thead><tr>' +
                '<th>IN</th><th>OUT</th><th>SIDE</th><th class="r">QTY</th><th class="r">ENTRY</th>' +
                '<th class="r">EXIT</th><th class="r">P&amp;L</th><th class="r">HOLD</th>' +
                '<th>EXIT</th><th>THESIS AS TYPED</th>' +
              '</tr></thead><tbody id="co-trades"></tbody></table></div>' +
            '</div>' +
            '<div class="blk"><h3>Fills</h3>' +
              '<div class="tbl-wrap" style="max-height:200px"><table class="tbl"><thead><tr>' +
                '<th>TIME</th><th>SIDE</th><th class="r">QTY</th><th class="r">PX</th>' +
                '<th class="r">COMM</th><th>WHY</th>' +
              '</tr></thead><tbody id="co-fills"></tbody></table></div>' +
            '</div>' +
          '</div>' +
          '<div>' +
            '<div class="blk"><h3>Risk events</h3><div id="co-risk"></div></div>' +
            '<div class="blk"><h3>Take it to chat</h3>' +
              '<p class="dim" style="font-size:11.5px;line-height:1.6">Copy the markdown tearsheet and ' +
              'paste it into your chat with Dana. Go trade by trade — she will ask what you were ' +
              'thinking, not what the chart did.</p>' +
              '<button class="btn primary wide big" id="co-copy" style="margin-top:8px">COPY TEARSHEET MARKDOWN</button>' +
              '<div id="co-copystatus" class="dim" style="margin-top:6px;font-size:11px"></div>' +
              '<div id="co-copyarea" class="hidden">' +
                '<div class="lbl" style="margin-bottom:4px">SELECT ALL AND COPY MANUALLY</div>' +
                '<textarea id="co-md" spellcheck="false"></textarea>' +
              '</div>' +
            '</div>' +
            '<div class="blk"><h3>Desk feed transcript</h3>' +
              '<div id="co-feed" style="max-height:220px;overflow:auto"></div></div>' +
          '</div>' +
        '</div>' +
        '<div class="foot-row">' +
          '<div class="note" id="co-note"></div>' +
          '<button class="btn primary big" id="co-save">SAVE &amp; RETURN TO SESSION SELECT</button>' +
        '</div>' +
      '</div></div>' +
    '</div>';

  var closeSaved = false;

  function wireClose() {
    on(id('co-copy'), 'click', copyTearsheet);
    on(id('co-save'), 'click', function () {
      saveDayResult();
      teardownSession();
      renderSelect();
      showScreen('select');
    });
  }

  function onEngineClose(summary) {
    if (closeHandled) return;
    closeHandled = true;
    try { window.Engine.pause(); } catch (e) {}
    running = false;
    stopClockLoop();
    pullStateQuiet();

    var g = null;
    for (var i = 0; i < GATES.length; i++) { if (isCloseGate(GATES[i])) { g = GATES[i]; break; } }
    if (!g) g = DEFAULT_GATES[2];

    var go = function () { buildCloseout(summary); showScreen('close'); };
    if (!gateFired[g.id]) {
      gateFired[g.id] = true;
      showGate(g, go);
    } else {
      go();
    }
  }

  function pullStateQuiet() {
    try { lastState = window.Engine.getState() || lastState; } catch (e) {}
  }

  function buildCloseout(summary) {
    closeSaved = false;
    var st = lastState || {};
    var stt = st.stats || {};
    var trades = st.trades || [];
    var fills = st.blotter || [];

    setText(id('co-title'), 'SESSION ' + (day.sessionNo || (dayIdx + 1)) + ' CLOSED · ' + (day.ticker || ''));
    setText(id('co-when'), mToHHMM(day.closeM || 960) + ' ET · ' + (day.company || ''));

    var pnlEl = id('co-pnl');
    pnlEl.textContent = money(st.dayPnl, { sign: true });
    pnlEl.className = 'close-pnl num ' + cls(st.dayPnl);
    var pctOfEq = startEquity ? (st.dayPnl / startEquity) * 100 : 0;
    setText(id('co-pnl-sub'), signPct(pctOfEq) + ' of starting equity · ' +
      money(st.commissions) + ' in commissions');

    var winPct = (stt.wins + stt.losses) ? (stt.wins / (stt.wins + stt.losses)) * 100 : 0;
    id('co-kv').innerHTML =
      stat('TRADES', intf(stt.nTrades || 0)) +
      stat('WINS / LOSSES', (stt.wins || 0) + ' / ' + (stt.losses || 0)) +
      stat('HIT RATE', pctf(winPct, 0)) +
      stat('BIGGEST WIN', '<span class="pos">' + money(stt.biggestWin || 0) + '</span>') +
      stat('BIGGEST LOSS', '<span class="neg">' + money(stt.biggestLoss || 0) + '</span>') +
      stat('MAX DRAWDOWN', '<span class="neg">' + money(stt.maxDrawdown || 0) + '</span>') +
      stat('PEAK DAY P&L', '<span class="' + cls(stt.peakDayPnl) + '">' + money(stt.peakDayPnl || 0, { sign: true }) + '</span>') +
      stat('EQUITY IN', money(startEquity)) +
      stat('EQUITY OUT', money(st.equity)) +
      stat('STATUS', st.locked ? '<span class="neg">RISK LOCKED</span>' : '<span class="dim">clean</span>');

    id('co-trades').innerHTML = trades.length ? trades.map(function (t) {
      return '<tr>' +
        '<td class="dim num">' + esc(mToHHMM(t.openM)) + '</td>' +
        '<td class="dim num">' + esc(mToHHMM(t.closeM)) + '</td>' +
        '<td><span class="side-tag ' + (t.side === 'LONG' ? 'BUY' : 'SELL') + '">' + esc(t.side) + '</span></td>' +
        '<td class="r num">' + esc(intf(t.qty)) + '</td>' +
        '<td class="r num">' + esc(px2(t.entryPx)) + '</td>' +
        '<td class="r num">' + esc(px2(t.exitPx)) + '</td>' +
        '<td class="r num ' + cls(t.pnl) + '">' + esc(money(t.pnl, { sign: true })) + '</td>' +
        '<td class="r num dim">' + esc(intf(t.holdMins)) + 'm</td>' +
        '<td><span class="reason-tag">' + esc(t.exitReason || '') + '</span></td>' +
        '<td class="thesis-cell" title="' + esc(t.thesis || '') + '">' + esc(t.thesis || '—') + '</td>' +
        '</tr>';
    }).join('') : '<tr><td colspan="10"><div class="empty-note">no closed trades — you watched the whole day</div></td></tr>';

    id('co-fills').innerHTML = fills.length ? fills.map(function (f) {
      return '<tr>' +
        '<td class="dim num">' + esc(f.t || mToHHMM(f.m)) + '</td>' +
        '<td><span class="side-tag ' + esc(f.side) + '">' + esc(f.side) + '</span></td>' +
        '<td class="r num">' + esc(intf(f.qty)) + '</td>' +
        '<td class="r num">' + esc(px2(f.px)) + '</td>' +
        '<td class="r num dim">' + esc(money(f.commission)) + '</td>' +
        '<td><span class="reason-tag">' + esc(f.reason || '') + '</span></td>' +
        '</tr>';
    }).join('') : '<tr><td colspan="6"><div class="empty-note">no fills</div></td></tr>';

    id('co-risk').innerHTML = riskLog.length ? riskLog.map(function (r) {
      return '<div class="kv"><span class="k">' + esc(mToHHMM(r.m)) + ' · ' + esc(r.level) +
        '</span><span class="v ' + (r.level === 'hard' ? 'neg' : 'amber') + '" style="font-weight:400;font-size:11.5px">' +
        esc(r.message) + '</span></div>';
    }).join('') : '<div class="empty-note">no risk events — you stayed inside the lines</div>';

    id('co-feed').innerHTML = feedMsgs.length ? feedMsgs.map(function (m) {
      var from = (m.from || 'DESK').toUpperCase();
      return '<div class="msg from-' + esc(from) + ' tone-' + esc(m.tone || 'neutral') + '">' +
        '<div class="msg-hd"><span class="msg-who">' + esc(m.name || from) + '</span>' +
        '<span class="msg-tm num">' + esc(m.t || mToHHMM(m.m)) + '</span></div>' +
        '<div class="msg-tx">' + esc(m.text || '') + '</div></div>';
    }).join('') : '<div class="empty-note">quiet day on the desk</div>';

    var nextIdx = dayIdx + 1;
    id('co-note').innerHTML = nextIdx < window.SIM_DAYS.length
      ? 'Saving carries <b>' + esc(money(st.equity)) + '</b> into session ' + (nextIdx + 1) + '.'
      : 'This was the last session. Saving locks in <b>' + esc(money(st.equity)) + '</b>.';

    id('co-copystatus').textContent = '';
    id('co-copyarea').classList.add('hidden');
  }

  function tearsheetMarkdown() {
    var md = '';
    try { md = window.Engine.exportReview(); } catch (e) { md = ''; }
    if (typeof md !== 'string' || !md.length) {
      md = fallbackMarkdown();
    }
    return md;
  }

  function fallbackMarkdown() {
    /* only used if Engine.exportReview() is unavailable or returns nothing */
    var st = lastState || {}, stt = st.stats || {};
    var L = [];
    L.push('# ' + (day.ticker || '') + ' — session ' + (day.sessionNo || (dayIdx + 1)) + ' tearsheet');
    L.push('');
    L.push('Day P&L **' + money(st.dayPnl, { sign: true }) + '** · realized ' + money(st.realized) +
           ' · commissions ' + money(st.commissions) + ' · equity ' + money(st.equity));
    L.push('Trades ' + (stt.nTrades || 0) + ' · W/L ' + (stt.wins || 0) + '/' + (stt.losses || 0) +
           ' · max DD ' + money(stt.maxDrawdown || 0) + (st.locked ? ' · RISK LOCKED' : ''));
    L.push('');
    L.push('| in | out | side | qty | entry | exit | P&L | hold | exit reason | thesis |');
    L.push('|---|---|---|---|---:|---:|---:|---:|---|---|');
    (st.trades || []).forEach(function (t) {
      L.push('| ' + mToHHMM(t.openM) + ' | ' + mToHHMM(t.closeM) + ' | ' + t.side + ' | ' + t.qty +
        ' | ' + px2(t.entryPx) + ' | ' + px2(t.exitPx) + ' | ' + money(t.pnl, { sign: true }) +
        ' | ' + t.holdMins + 'm | ' + (t.exitReason || '') + ' | ' +
        String(t.thesis || '').replace(/\|/g, '/') + ' |');
    });
    if (riskLog.length) {
      L.push(''); L.push('**Risk events**');
      riskLog.forEach(function (r) { L.push('- ' + mToHHMM(r.m) + ' [' + r.level + '] ' + r.message); });
    }
    L.push('');
    L.push('_(generated by ui.js fallback — Engine.exportReview() returned nothing)_');
    return L.join('\n');
  }

  function copyTearsheet() {
    var md = tearsheetMarkdown();
    var status = id('co-copystatus');
    var done = function (ok, why) {
      if (ok) {
        status.innerHTML = '<span class="pos">✓ COPIED — ' + md.length.toLocaleString('en-US') +
          ' characters on the clipboard. Paste it into chat.</span>';
        id('co-copyarea').classList.add('hidden');
      } else {
        status.innerHTML = '<span class="amber">Clipboard blocked' + (why ? ' (' + esc(why) + ')' : '') +
          ' — the markdown is below, select all and copy it by hand (Cmd-A, Cmd-C).</span>';
        var area = id('co-copyarea');
        area.classList.remove('hidden');
        var ta = id('co-md');
        ta.value = md;
        ta.focus(); ta.select();
      }
    };

    /* try the modern API first; file:// often rejects it */
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(md).then(function () { done(true); },
        function (err) { legacyCopy(md, done, err && err.name); });
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

  function saveDayResult() {
    if (closeSaved) return;
    closeSaved = true;
    var st = lastState || {}, stt = st.stats || {};
    var result = {
      sessionNo: day.sessionNo || (dayIdx + 1),
      ticker: day.ticker || '',
      dayPnl: st.dayPnl || 0,
      nTrades: stt.nTrades || 0,
      wins: stt.wins || 0,
      losses: stt.losses || 0,
      maxDrawdown: stt.maxDrawdown || 0,
      endEquity: num(st.equity) ? st.equity : startEquity,
      locked: !!st.locked,
      blotter: st.blotter || [],
      trades: st.trades || [],
      notes: ''
    };
    try {
      if (typeof window.Engine.saveAccount === 'function') window.Engine.saveAccount(result);
    } catch (e) {
      showErrBar('Engine.saveAccount threw: ' + e.message);
    }
    var reloaded = safeLoadAccount();
    if (reloaded) {
      account = reloaded;
    } else {
      /* engine could not persist (localStorage blocked on file://) — keep it in memory
         so the three sessions still carry across within this browser session */
      account = account || { equity: startEquity, sessions: [] };
      account.sessions = (account.sessions || []).slice();
      account.sessions[dayIdx] = result;
      account.equity = result.endEquity;
    }
  }

  /* ------------------------------------------------------------------ */
  /* go                                                                  */
  /* ------------------------------------------------------------------ */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  /* small surface for debugging from the console; not part of the contract */
  window.UI = {
    _screen: showScreen,
    _state: function () { return lastState; },
    _feed: function () { return feedMsgs; },
    _gate: showGate
  };
})();
