/* =============================================================================
 * sim/squad.js  —  window.Squad
 *
 * The four people whose time is not yours to spend, plus the help channel and
 * the build bot. Three sources of messages (scripted events, gates, reactive),
 * one voice per source, no DOM, no imports, no libraries, no build step.
 * Loaded with a plain <script src> tag from file://, and importable under node
 * with `global.window = global`.
 *
 * Contract (SPEC §4):
 *   Squad.init({ repo, dev, onMessage })
 *   Squad.tick(state)      // called by ui.js on every Dev tick (15 minutes)
 *   Squad.getFeed()        // -> [Msg, ...]
 *   Squad.GATES            // -> [ {day, id, title, prompt}, ... ]
 *
 * Msg = { day, hour, t:"D4 11:15",
 *         from:"MENTOR"|"LEAD"|"REVIEWER"|"PM"|"CHANNEL"|"BOT",
 *         name, text, tone:"neutral"|"pressure"|"warn"|"praise"|"alarm",
 *         needsReply:false }
 *   plus additive, non-breaking fields ui.js may ignore:
 *     kind:"scripted"|"gate"|"reactive", trigger:"<id>" (reactive),
 *     queuedAt:<tick when the condition was DETECTED>, tick:<tick emitted>,
 *     gate:"<gate id>", title:"..." (gates), eventId:"<repo event id>".
 *
 * -----------------------------------------------------------------------------
 * THE ONE RULE THAT MATTERS
 *
 * SQUAD.JS NEVER READS GROUND TRUTH. It never calls repo.reveal(), never touches
 * repo._t, never learns a yield, a timebox, a soloCap, a convention trap or
 * whether a ticket is findable alone. Every sentence in this file is derived
 * from exactly two things:
 *
 *   (a) what the PLAYER DID  — actions performed and how many times, asks and
 *       who they went to, estimates, conventions selected, PRs opened, bounces
 *       taken, tickets merged or handed back, hours burned, hours burned late;
 *   (b) what the STATE PUBLISHES — understanding, hoursSpent, status, trust,
 *       the senior budget remaining — i.e. exactly the numbers the player is
 *       looking at on their own screen.
 *
 * That constraint is not hygiene, it is the design. Deepa can see that you have
 * been flat for three hours; she CANNOT know that BUG-2207's answer was never
 * in the repository. Nobody in this building knows which of your six tickets is
 * unsolvable alone — that is precisely the thing you are being asked to work
 * out, and a teammate who quietly knew would turn the exercise into a game of
 * "which character do I obey".
 *
 * Where the spec's trigger table names something that IS truth — "a
 * negative-yield action", "the convention trap", "a ticket that needs tests" —
 * this file substitutes the OBSERVABLE shadow of that thing, and says so at the
 * trigger:
 *
 *   negative yield   -> ninety minutes into one action and understanding has
 *                       not moved, or has moved backwards. Published number.
 *   convention trap  -> a convention chosen without once opening the style
 *                       guide. Nnamdi asks where you got it, he does not know.
 *   needs tests      -> the ticket's own PUBLISHED acceptance criteria say the
 *                       word "test", and the diff has none.
 *   the timebox      -> Deepa's own stated rule of thumb, which she says out
 *                       loud on day one: timebox it, then come. Her heuristic,
 *                       not the engine's number.
 *
 * -----------------------------------------------------------------------------
 * THE VOICES — hold these consistently. Every one of them is a competent adult
 * who wants you to succeed. That is what makes the pressure real instead of
 * cartoonish: nobody here is your enemy and you are still the least
 * knowledgeable person in the room.
 *
 *   MENTOR    Deepa Iyer          Nine years on this codebase, wrote a third of
 *                                 it, regrets some. Generous, direct, stretched
 *                                 thin. Ten hours for you this sprint and a
 *                                 migration of her own. Answers a good question
 *                                 instantly and redirects a lazy one gently.
 *                                 Signature move: "what have you tried, and
 *                                 what did you expect to happen?"
 *   LEAD      Tobias Lindqvist    Runs standup, owns delivery. Cares far more
 *                                 that you are blocked than that you are slow.
 *                                 The one unforgivable thing is silent
 *                                 stuckness. Never sarcastic; often direct.
 *   REVIEWER  Nnamdi Eze          Picky, fair, fast. Review comments teach
 *                                 instead of scold. Will not merge code whose
 *                                 author cannot explain it — and says so as a
 *                                 fact about the code, never about the person.
 *   PM        Hannah Brecht       Friendly, busy, writes tickets that are clear
 *                                 in her head and underspecified on the page.
 *                                 Delighted when someone asks her to clarify.
 *   CHANNEL   #eng-help           Async. Occasionally useful. Occasionally a
 *                                 stranger from another team who is confidently
 *                                 wrong at you in a friendly tone.
 *   BOT       CI                  Terse. Uppercase gates. No opinions.
 *
 * -----------------------------------------------------------------------------
 * DETERMINISM. Every trigger carries 3-5 phrasings. The one used is chosen by
 * hash(sprint key + '|' + trigger id) + the number of messages emitted so far,
 * modulo the variant count. Pure function of the session: the same sprint
 * played the same way produces a byte-identical feed; a sprint played
 * differently draws different words. There is no Math.random() in this file and
 * there must never be one.
 *
 * -----------------------------------------------------------------------------
 * CLOCKS. Two of them, on purpose.
 *   absolute (day, hour)  — decides when a scripted event or a gate is due.
 *   working hours `W`     — (day-1)*hoursPerDay + (hour - startHour). Evenings
 *                           and nights collapse, so "flat for three hours" means
 *                           three hours of the sprint, not three hours that
 *                           happened to span a night.
 * ========================================================================== */

(function () {
  'use strict';

  /* ---------------------------------------------------------------- voices */

  // Fallbacks only. The real names are lifted off repo.people in init(), keyed
  // by each person's published `voice`.
  var DEFAULT_NAMES = {
    MENTOR:   'Deepa Iyer',
    LEAD:     'Tobias Lindqvist',
    REVIEWER: 'Nnamdi Eze',
    PM:       'Hannah Brecht',
    CHANNEL:  '#eng-help',
    BOT:      'CI'
  };

  // The byline on a channel reply from somebody who has never seen your code.
  var STRANGER = '#eng-help — Marcus Wei (Billing)';

  // Drain order when several reactive messages are waiting. Your lead does not
  // queue behind the build bot.
  var PRIORITY = { LEAD: 1, REVIEWER: 2, MENTOR: 3, PM: 4, CHANNEL: 5, BOT: 6 };

  var DEFAULT_RULES = {
    days: 10, hoursPerDay: 6, startHour: 9, tickMinutes: 15,
    seniorBudgetHours: 10,
    implementReadyAt: 70, correctAt: 90,
    stuckHours: 3
  };

  /* The gates carry a day in SPEC §4 and no hour, so the hour lives here. These
   * are chosen to sit where the meeting would actually sit: kickoff after the
   * three introductions have landed, standup at the top of the day, the 1:1
   * after lunch, the retro at the end of the last afternoon. */
  var GATE_HOURS = { kickoff: 10.25, standup: 9.0, oneonone: 13.0, retro: 14.5 };

  /* ------------------------------------------------------------ heuristics
   * Every number below is a HUMAN rule of thumb held by a character in this
   * file. None of them is read from the engine's truth. Deepa says the first one
   * out loud on day one — "timebox it, then come" — which is what makes it fair
   * for her to judge you against it later. */

  var PREMATURE_HOURS   = 1.0;  // asking Deepa before this, having tried almost nothing
  var PREMATURE_ACTIONS = 2;    // ...where "almost nothing" means fewer than two avenues
  var TIMEBOX_HOURS     = 1.5;  // Deepa's stated timebox
  var TIMEBOX_ACTIONS   = 3;    // a "real" timebox has several different things in it
  var OVERDUE_HOURS     = 4.0;  // past here, the question has stopped being cheap
  var MISLEAD_MINUTES   = 90;   // minutes in one action before flat/falling is a pattern
  var REPEAT_TIMES      = 3;    // repeats of one action before "you are re-reading"
  var LATE_DAYS         = 2;    // evenings worked before heroics stop being a one-off
  var BUDGET_LOW_FRAC   = 0.20; // Deepa's remaining time, as a fraction of her total
  var CUTOFF_HOURS      = 1.0;  // a PR opened this close to the end of the day
  var HANNAH_PATIENCE   = 5.0;  // working hours a PM waits before chasing
  var HANNAH_PROMPT     = 4.0;  // ...and inside which a reply counts as prompt

  /* Words that, in a nine-year-old repository, mean "the size of the change and
   * the size of the diff are unrelated". Matched against the ticket's own
   * PUBLISHED title and description — the same text the player is reading. */
  var BLAST_RADIUS = new RegExp(
    '\\b(shared|standardis\\w*|standardiz\\w*|preset|lint config|config|' +
    'public api|rate limit\\w*|across (?:services|the repo|packages)|' +
    'repo-wide|every (?:service|package)|migrat\\w*)\\b', 'i');

  /* ------------------------------------------------------------ formatting */

  function has(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }

  function num(v, dflt) {
    if (typeof v === 'string') v = parseFloat(v);
    return (typeof v === 'number' && isFinite(v)) ? v : dflt;
  }

  function arr(v) { return Array.isArray(v) ? v : []; }

  function pad2(n) { n = Math.floor(n); return (n < 10 ? '0' : '') + n; }

  function hhmm(hour) {
    hour = num(hour, 0);
    var h = Math.floor(hour + 1e-9);
    var m = Math.round((hour - h) * 60);
    if (m >= 60) { h += 1; m -= 60; }
    return pad2(h) + ':' + pad2(m);
  }

  function tstamp(day, hour) { return 'D' + Math.max(1, Math.round(num(day, 1))) + ' ' + hhmm(hour); }

  // Hours, written the way a person says them: "2", "3.5", "45 minutes".
  function hrs(x) {
    x = num(x, 0);
    if (Math.abs(x - Math.round(x)) < 0.05) return String(Math.round(x));
    return x.toFixed(1);
  }

  function mins(x) { return String(Math.round(num(x, 0))); }

  // An understanding delta always carries its sign, because the sign is the point.
  function sgn(x) {
    x = num(x, 0);
    var v = Math.round(x);
    return (v > 0 ? '+' : (v < 0 ? '' : '±')) + String(v);
  }

  function pct(x) { return (isFinite(x) ? Math.round(x * 100) : 0) + '%'; }

  function plural(n, one, many) { return (Math.abs(n) === 1) ? one : (many || (one + 's')); }

  // "Read the docs" -> "read the docs", so it can sit mid-sentence. Identifiers
  // (git log / blame) keep their shape.
  function lc(s) {
    s = String(s || '');
    if (!s || /[_/`]/.test(s.charAt(0))) return s;
    if (/^[A-Z]{2,}/.test(s)) return s;                 // CI, PR, CSV
    return s.charAt(0).toLowerCase() + s.slice(1);
  }

  function listOf(a, max) {
    a = a || []; max = max || 3;
    if (!a.length) return '';
    if (a.length === 1) return String(a[0]);
    if (a.length <= max) return a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
    return a.slice(0, max).join(', ') + ' and ' + (a.length - max) + ' more';
  }

  // {placeholder} substitution. An unfilled placeholder survives verbatim so it
  // shows up screamingly in the test output rather than as a silent gap.
  function fill(tpl, data) {
    return String(tpl).replace(/\{(\w+)\}/g, function (whole, k) {
      return (data && data[k] !== undefined && data[k] !== null) ? String(data[k]) : whole;
    });
  }

  // djb2. Small, stable, dependency-free. Used only for variant selection.
  function hashStr(s) {
    var h = 5381, i;
    s = String(s);
    for (i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return h;
  }

  /* ---------------------------------------------------------------- state */

  var S = null;   // session state; rebuilt by Squad.init

  function freshState() {
    return {
      repo: null, dev: null, onMessage: null, rules: null, key: 'sprint',

      names: {},
      tickets: {},          // id -> PUBLIC ticket record from repo.tickets
      ticketOrder: [],
      actionMinutes: {},    // actionId -> minutes  (published cost)
      actionName: {},
      soloIds: [],          // every non-ask action id

      feed: [],
      queue: [],
      fired: {},            // trigger id -> true (each trigger speaks at most once)
      emitted: {},          // trigger id -> W at which it actually reached the feed
      seq: 0,
      emitCount: 0,

      events: [], eventFired: [], gateFired: {},
      openReply: {},        // eventId -> { id, W, day, hour, from, name, answered }

      tickNo: 0, lastDrainTick: null,
      day: 1, hour: 9, W: 0,

      /* ---- everything below is RECONSTRUCTED from the state stream ---- */
      tk: {},               // ticket id -> book (see freshTicket)
      askTotal: 0,
      askTo: { deepa: 0, hannah: 0, channel: 0 },
      seniorTotal: 10,
      seniorLeft: 10,
      lateDays: {},
      lateDayCount: 0,
      mergedSeen: {},
      mergedCount: 0,
      blameTotal: 0,
      firstChannelAsk: null,   // { ticket, W } — the stranger replies later
      noTestTicket: null,      // the PR CI complained about, for Nnamdi's follow-up
      askSnap: {},             // memoised ask totals, for "since this event opened"
      started: false
    };
  }

  function freshTicket(id) {
    return {
      id: id,
      status: 'todo', u: 0, hours: 0,
      est: null, firstEst: null, estChanges: 0,
      actions: {},          // actionId -> count observed
      runs: {},             // actionId -> [understanding delta attributed to each run]
      openRun: null,        // actionId currently accumulating understanding
      lastGainHours: 0,     // hoursSpent at which understanding last moved up
      asks: { deepa: 0, hannah: 0, channel: 0 },
      askTotal: 0,
      bounces: 0, hasTests: false, convention: null,
      prOpens: 0, built: false,
      merged: false, abandoned: false,
      touched: false
    };
  }

  function bk(id) {
    if (!S.tk[id]) S.tk[id] = freshTicket(id);
    return S.tk[id];
  }

  /* --------------------------------------------------------------- clocks */

  function W(day, hour) {
    var R = S.rules;
    return (num(day, 1) - 1) * R.hoursPerDay + (num(hour, R.startHour) - R.startHour);
  }

  function endHour() { return S.rules.startHour + S.rules.hoursPerDay; }

  function due(day, hour, gDay, gHour) {
    return (day > gDay) || (day === gDay && hour >= gHour - 1e-9);
  }

  function endOfDayW(day) { return W(day, endHour()); }

  /* -------------------------------------------------------------- emitting */

  function emit(from, text, tone, state, extra) {
    var day = num(state && state.day, S.day);
    var hour = num(state && state.hour, S.hour);
    var msg = {
      day: day,
      hour: hour,
      t: (state && typeof state.t === 'string' && state.t) ? state.t : tstamp(day, hour),
      from: from,
      name: S.names[from] || DEFAULT_NAMES[from] || from,
      text: text,
      tone: tone || 'neutral',
      needsReply: false,
      tick: S.tickNo
    };
    if (extra) { for (var k in extra) if (has(extra, k)) msg[k] = extra[k]; }
    S.feed.push(msg);
    S.emitCount++;
    if (typeof S.onMessage === 'function') {
      try { S.onMessage(msg); } catch (e) { /* a broken listener must not kill the squad */ }
    }
    return msg;
  }

  // Deterministic phrasing: stable per (sprint, trigger), shifted by how much has
  // already been said. Reproducible; never random.
  function pick(id, variants) {
    var i = (hashStr(S.key + '|' + id) + S.emitCount) % variants.length;
    return variants[i];
  }

  /**
   * Queue a reactive message. Fires at most once per sprint.
   *
   * The text renders at DETECTION time, so the numbers in it are the numbers of
   * the moment the thing happened — but the message is stamped with the time it
   * actually reaches the feed. Time-critical items carry `expiresW` and are
   * dropped rather than surfaced stale: nobody says "that PR is landing right on
   * my cutoff" two days later.
   */
  function trig(id, from, tone, variants, data, opts) {
    if (S.fired[id]) return false;
    S.fired[id] = true;
    S.queue.push({
      id: id,
      from: from,
      tone: tone,
      text: fill(pick(id, variants), data || {}),
      name: (opts && opts.name) || null,
      needsReply: !!(opts && opts.needsReply),
      prio: PRIORITY[from] || 9,
      seq: S.seq++,
      queuedAt: S.tickNo,
      expiresW: (opts && opts.expiresW != null) ? opts.expiresW : null
    });
    return true;
  }

  // At most ONE reactive message per tick.
  // LEAD > REVIEWER > MENTOR > PM > CHANNEL > BOT, ties broken by detection order.
  function drain(state) {
    if (!S.queue.length) return null;
    var live = [], i, c;
    for (i = 0; i < S.queue.length; i++) {
      c = S.queue[i];
      if (c.expiresW != null && S.W > c.expiresW + 1e-9) continue;   // stale — drop it
      live.push(c);
    }
    S.queue = live;
    if (!S.queue.length) return null;
    S.queue.sort(function (a, b) { return (a.prio - b.prio) || (a.seq - b.seq); });
    c = S.queue.shift();
    S.emitted[c.id] = S.W;
    return emit(c.from, c.text, c.tone, state, {
      kind: 'reactive', trigger: c.id, queuedAt: c.queuedAt,
      needsReply: c.needsReply,
      name: c.name || S.names[c.from] || DEFAULT_NAMES[c.from] || c.from
    });
  }

  /* ------------------------------------------------------------ repo read
   * PUBLIC fields only. repo.reveal() is never called and repo._t is never
   * touched — not here, not anywhere below. */

  function readRepo(repo) {
    var i, p, a, t, sc;

    var people = arr(repo && repo.people);
    for (i = 0; i < people.length; i++) {
      p = people[i] || {};
      var voice = p.voice || voiceForRole(p);
      if (voice && p.name) S.names[voice] = p.name;
    }
    if (!S.names.CHANNEL) S.names.CHANNEL = DEFAULT_NAMES.CHANNEL;
    if (!S.names.BOT) S.names.BOT = DEFAULT_NAMES.BOT;

    var actions = arr(repo && repo.actions);
    for (i = 0; i < actions.length; i++) {
      a = actions[i] || {};
      if (!a.id) continue;
      S.actionMinutes[a.id] = num(a.minutes, 15);
      S.actionName[a.id] = a.name || a.id;
      if (!/^ask[_-]/.test(a.id)) S.soloIds.push(a.id);
    }

    var tickets = arr(repo && repo.tickets);
    for (i = 0; i < tickets.length; i++) {
      t = tickets[i] || {};
      if (!t.id) continue;
      S.tickets[t.id] = t;
      S.ticketOrder.push(t.id);
    }

    sc = (repo && repo.scenario) || {};
    S.seniorTotal = num(sc.seniorBudgetHours, num(S.rules.seniorBudgetHours, 10));
    S.seniorLeft = S.seniorTotal;
    S.key = String(sc.company || '') + '|' + String(sc.team || '') + '|' +
            String(sc.role || '') + '|' + S.ticketOrder.join(',');
  }

  function voiceForRole(p) {
    var s = String((p && p.role) || '') + ' ' + String((p && p.id) || '');
    s = s.toLowerCase();
    if (/lead|manager(?!.*product)/.test(s) && !/product/.test(s)) return 'LEAD';
    if (/review/.test(s)) return 'REVIEWER';
    if (/product/.test(s)) return 'PM';
    if (/staff|mentor|buddy|principal/.test(s)) return 'MENTOR';
    return null;
  }

  /* ------------------------------------------------------------- lookups */

  function pubTicket(id) { return S.tickets[id] || null; }

  function ticketTitle(id) {
    var t = pubTicket(id);
    return (t && t.title) ? t.title : String(id || 'that ticket');
  }

  function actionLabel(id) { return S.actionName[id] || String(id); }

  // The ticket's own PUBLISHED acceptance line that asks for a test, if any.
  function testCriterion(id) {
    var t = pubTicket(id), list = arr(t && t.acceptance), i;
    for (i = 0; i < list.length; i++) {
      if (/\btests?\b|\bcovered by\b|\bcoverage\b/i.test(String(list[i]))) {
        return '"' + String(list[i]) + '"';
      }
    }
    return null;
  }

  // Blast-radius vocabulary in the ticket's own published words.
  function blastWord(id) {
    var t = pubTicket(id);
    if (!t) return null;
    var m = BLAST_RADIUS.exec(String(t.title || '') + ' ' + String(t.description || ''));
    return m ? String(m[1]).toLowerCase() : null;
  }

  function distinctSolo(r) {
    var n = 0, i, id;
    for (i = 0; i < S.soloIds.length; i++) {
      id = S.soloIds[i];
      if (num(r.actions[id], 0) > 0) n++;
    }
    return n;
  }

  function triedList(r, max) {
    var out = [], i, id;
    for (i = 0; i < S.soloIds.length; i++) {
      id = S.soloIds[i];
      if (num(r.actions[id], 0) > 0) out.push('`' + lc(actionLabel(id)) + '`');
    }
    return out.length ? listOf(out, max || 3) : 'nothing yet';
  }

  function minutesOn(r, actionId) {
    return num(r.actions[actionId], 0) * num(S.actionMinutes[actionId], 15);
  }

  function totalCount(actionId) {
    var n = 0, id;
    for (id in S.tk) if (has(S.tk, id)) n += num(S.tk[id].actions[actionId], 0);
    return n;
  }

  function openTicketIds() {
    var out = [], id, r;
    for (id in S.tk) {
      if (!has(S.tk, id)) continue;
      r = S.tk[id];
      if (r.merged || r.abandoned) continue;
      out.push(id);
    }
    return out;
  }

  /* ---------------------------------------------------- scripted + gates */

  function normEvents(repo) {
    var raw = arr(repo && repo.events), out = [], i, e;
    for (i = 0; i < raw.length; i++) {
      e = raw[i] || {};
      out.push({
        id: e.id || ('ev' + i),
        day: num(e.day, 1),
        hour: num(e.hour, S.rules.startHour),
        from: e.from || e.voice || 'CHANNEL',
        name: e.name || null,
        tone: e.tone || 'neutral',
        needsReply: !!e.needsReply,
        text: String(e.text || e.message || ''),
        ticketId: e.ticketId || null
      });
    }
    out.sort(function (a, b) { return (a.day - b.day) || (a.hour - b.hour) || 0; });
    return out;
  }

  function fireScripted(state, out) {
    var i, e, msg;
    for (i = 0; i < S.events.length; i++) {
      if (S.eventFired[i]) continue;
      e = S.events[i];
      // The sprint ending is a hard backstop, the same one the gates use: an
      // authored event scheduled a few minutes past the last tick of the last
      // day must still be said, not silently lost to the clock.
      if (!due(S.day, S.hour, e.day, e.hour) &&
          !(state && state.finished && S.day >= e.day)) continue;
      S.eventFired[i] = true;
      msg = emit(e.from, e.text, e.tone, state, {
        kind: 'scripted', eventId: e.id,
        needsReply: e.needsReply,
        name: e.name || S.names[e.from] || DEFAULT_NAMES[e.from] || e.from
      });
      out.push(msg);

      /* An event that asks for an answer starts a clock. Whether the player
       * answers is tracked in updateBook(); the reaction to silence, and the
       * reaction to a prompt reply, are triggers like any other. */
      if (e.needsReply) {
        S.openReply[e.id] = {
          id: e.id, W: S.W, day: S.day, hour: S.hour,
          from: e.from, name: msg.name, ticketId: e.ticketId, answered: false
        };
      }
    }
  }

  function fireGates(state, out) {
    var i, g, hour, msg;
    for (i = 0; i < Squad.GATES.length; i++) {
      g = Squad.GATES[i];
      if (S.gateFired[g.id]) continue;
      hour = num(GATE_HOURS[g.id], S.rules.startHour);
      // The sprint ending is a hard backstop: a gate never silently goes missing
      // because the clock stopped a quarter of an hour short of it.
      if (!due(S.day, S.hour, g.day, hour) && !(state && state.finished && S.day >= g.day)) continue;
      S.gateFired[g.id] = true;
      msg = emit('LEAD', g.prompt, 'pressure', state, {
        kind: 'gate', gate: g.id, title: g.title
      });
      out.push(msg);
    }
  }

  /* ============================================================ BOOKKEEPING
   * Everything the triggers need, rebuilt from the state stream alone. Dev is
   * never asked for anything it does not already publish, and never asked to
   * change shape to accommodate the feed.
   * ====================================================================== */

  var ASK_KEY = { ask_deepa: 'deepa', ask_hannah: 'hannah', ask_channel: 'channel',
                  ask_mentor: 'deepa', ask_pm: 'hannah', ask_help: 'channel' };

  function updateBook(state) {
    var ev = {
      asks: [], prOpens: [], bounces: [], merges: [], abandons: [],
      builds: [], conventions: [], newRuns: []
    };
    var list = arr(state.tickets), i, k;

    /* ---- Deepa's budget. Published; also the only reliable corroboration that
     * an ask went to HER when a build reports asks some other way. -------- */
    var seniorLeftNow = num(state.seniorLeft, S.seniorLeft);
    var seniorDrop = Math.max(0, S.seniorLeft - seniorLeftNow);
    S.seniorLeft = seniorLeftNow;

    var deepaAsksSeen = 0;

    for (i = 0; i < list.length; i++) {
      var pub = list[i] || {};
      var id = pub.id;
      if (!id) continue;
      var r = bk(id);

      var prevU = r.u, prevHours = r.hours, prevStatus = r.status;
      var u = num(pub.understanding, prevU);
      var hoursSpent = num(pub.hoursSpent, prevHours);
      var status = String(pub.status || prevStatus || 'todo');

      /* ---- estimates: the first number, and whether it was ever revised --- */
      var est = num(pub.estimateHours, num(pub.estimate, null));
      if (est !== null && est > 0) {
        if (r.est === null) { r.est = est; r.firstEst = est; }
        else if (Math.abs(est - r.est) > 1e-9) { r.est = est; r.estChanges++; }
      }

      /* ---- which actions ran since the last tick -------------------------- */
      var au = pub.actionsUsed || pub.actions || {};
      var soloRan = null, askRan = [];
      for (k in au) {
        if (!has(au, k)) continue;
        var n = num(au[k], 0), was = num(r.actions[k], 0);
        if (n <= was) { r.actions[k] = Math.max(was, n); continue; }
        var times = n - was;
        r.actions[k] = n;
        if (has(ASK_KEY, k)) {
          while (times-- > 0) askRan.push(ASK_KEY[k]);
        } else {
          soloRan = k;
          if (!r.runs[k]) r.runs[k] = [];
          while (times-- > 0) r.runs[k].push(0);
          r.openRun = k;
        }
      }

      /* ---- attribute the understanding delta to whatever is running -------
       * An action that costs thirty minutes spans two ticks, so the delta may
       * arrive a tick after the count moves. Deltas land on the run that is
       * currently open, which is the honest reading of "this is what that piece
       * of work bought you". Asks close the open run: a jump straight after a
       * question is Deepa's answer, not the file you were reading. */
      var delta = u - prevU;
      if (askRan.length) r.openRun = null;
      if (delta !== 0 && r.openRun && r.runs[r.openRun] && r.runs[r.openRun].length) {
        var runs = r.runs[r.openRun];
        runs[runs.length - 1] += delta;
      }
      if (soloRan) ev.newRuns.push({ ticket: id, action: soloRan });

      if (delta > 0.5) r.lastGainHours = hoursSpent;
      if (hoursSpent > 0 && !r.touched) { r.touched = true; S.started = true; }

      /* ---- asks --------------------------------------------------------- */
      for (k = 0; k < askRan.length; k++) {
        var to = askRan[k];
        // hoursSpent BEFORE this tick is the honest "how long had you been on it
        // when you asked" — the ask itself has already been billed by now.
        registerAsk(ev, r, to, prevHours, u);
        if (to === 'deepa') deepaAsksSeen++;
      }

      /* ---- conventions, tests, bounces, PRs, terminal states ------------- */
      var conv = (pub.convention === undefined) ? null : pub.convention;
      if (conv && conv !== r.convention) {
        r.convention = conv;
        ev.conventions.push({ ticket: id, name: String(conv) });
      }
      r.hasTests = !!pub.hasTests;

      var b = num(pub.bounces, r.bounces);
      if (b > r.bounces) { r.bounces = b; ev.bounces.push({ ticket: id, n: b }); }

      if (status !== prevStatus) {
        if ((status === 'implementing' || status === 'in_review') && !r.built) {
          r.built = true;
          ev.builds.push({ ticket: id, u: u });
        }
        if (status === 'in_review' && prevStatus !== 'in_review') {
          r.prOpens++;
          ev.prOpens.push({ ticket: id, u: u, hasTests: r.hasTests, n: r.prOpens });
        }
        if (status === 'merged' && !r.merged) {
          r.merged = true;
          ev.merges.push({ ticket: id, u: u, hours: hoursSpent });
        }
        if (status === 'abandoned' && !r.abandoned) {
          r.abandoned = true;
          ev.abandons.push({ ticket: id, hours: hoursSpent, u: u });
        }
      }

      r.u = u; r.hours = hoursSpent; r.status = status;
    }

    /* ---- an ask to Deepa that never appeared in actionsUsed ---------------
     * Some builds record asks only by spending her budget. If the budget moved
     * and no ask_deepa turned up, credit one against the active ticket. Better a
     * slightly fuzzy count than a mentor who does not notice she was asked. */
    if (seniorDrop > 0.01 && deepaAsksSeen === 0) {
      var activeId = state.active || (openTicketIds()[0] || S.ticketOrder[0]);
      if (activeId) {
        var ar = bk(activeId);
        registerAsk(ev, ar, 'deepa', ar.hours, ar.u);
      }
    }

    /* ---- merges, at the sprint level ------------------------------------ */
    var merged = arr(state.merged), mi;
    for (mi = 0; mi < merged.length; mi++) {
      var mid = (typeof merged[mi] === 'string') ? merged[mi] : (merged[mi] && merged[mi].id);
      if (!mid || S.mergedSeen[mid]) continue;
      S.mergedSeen[mid] = true;
      S.mergedCount++;
      var mr = bk(mid);
      if (!mr.merged) { mr.merged = true; ev.merges.push({ ticket: mid, u: mr.u, hours: mr.hours }); }
    }
    for (mi = 0; mi < ev.merges.length; mi++) {
      if (!S.mergedSeen[ev.merges[mi].ticket]) {
        S.mergedSeen[ev.merges[mi].ticket] = true;
        S.mergedCount++;
      }
    }

    /* ---- evenings ------------------------------------------------------- */
    var over = S.hour > endHour() + 1e-9;
    if (!over) {
      // Some builds keep the clock inside the day and let the hours overrun
      // instead. Both shapes mean the same thing: more hours burned than the day
      // has in it.
      var totalHours = num(S.rules.days, 10) * num(S.rules.hoursPerDay, 6);
      var used = totalHours - num(state.hoursLeft, totalHours);
      over = used > S.day * S.rules.hoursPerDay + 0.5;
    }
    if (over && !S.lateDays[S.day]) { S.lateDays[S.day] = true; S.lateDayCount++; }

    /* ---- git history, across the whole board ---------------------------- */
    S.blameTotal = totalCount('git_blame') + totalCount('git_log') + totalCount('blame');

    /* ---- did the player answer the person who asked them something? ------
     * Believe an explicit signal if the build publishes one. Failing that, a
     * question to that same person about that same ticket IS an answer: Hannah
     * asked about the rate limiting and you went and talked to Hannah about the
     * rate limiting. */
    markReplies(state);

    return ev;
  }

  function registerAsk(ev, r, to, hoursBefore, u) {
    r.asks[to] = num(r.asks[to], 0) + 1;
    r.askTotal++;
    S.askTo[to] = num(S.askTo[to], 0) + 1;
    S.askTotal++;
    ev.asks.push({
      ticket: r.id, to: to,
      hours: hoursBefore,
      tried: distinctSolo(r),
      triedText: triedList(r, 4),
      u: u,
      n: r.asks[to]
    });
  }

  function markReplies(state) {
    var explicit = {}, i, v, id;
    var lists = [arr(state.answeredEvents), arr(state.repliedEvents), arr(state.replies)];
    for (i = 0; i < lists.length; i++) {
      for (v = 0; v < lists[i].length; v++) {
        var it = lists[i][v];
        id = (typeof it === 'string') ? it : (it && (it.id || it.eventId));
        if (id) explicit[id] = true;
      }
    }
    // openEvents shrinking is the other published shape.
    var stillOpen = null;
    if (Array.isArray(state.openEvents)) {
      stillOpen = {};
      for (i = 0; i < state.openEvents.length; i++) {
        var oe = state.openEvents[i];
        id = (typeof oe === 'string') ? oe : (oe && (oe.id || oe.eventId));
        if (id) stillOpen[id] = true;
      }
    }
    for (id in S.openReply) {
      if (!has(S.openReply, id)) continue;
      var o = S.openReply[id];
      if (o.answered) continue;
      if (explicit[id]) { o.answered = true; o.answeredW = S.W; continue; }
      if (stillOpen && !stillOpen[id] && S.W > o.W) { o.answered = true; o.answeredW = S.W; continue; }
      // ...or the player simply went and talked to them.
      var whoKey = (o.from === 'PM') ? 'hannah' : (o.from === 'MENTOR' ? 'deepa' : null);
      if (whoKey && asksSince(whoKey, o.W) > 0) { o.answered = true; o.answeredW = S.W; }
    }
  }

  // How many asks have gone to this person since a given point in the sprint.
  // Counted from the running totals, which is all the state publishes.
  function asksSince(who, sinceW) {
    if (!S.askSnap) S.askSnap = {};
    var keyW = who + '@' + sinceW.toFixed(3);
    if (S.askSnap[keyW] === undefined) S.askSnap[keyW] = num(S.askTo[who], 0);
    return num(S.askTo[who], 0) - S.askSnap[keyW];
  }

  /* ------------------------------------------------------------------- API
   * (the trigger bodies are appended below, then the object is published) */

  var Squad = {

    // Verbatim from SPEC §4. ui.js renders the modal; Squad owns only these.
    GATES: [
      { day: 1,  id: 'kickoff',  title: 'Sprint kickoff',
        prompt: 'Post your plan for the sprint and your estimates to the team in chat.' },
      { day: 3,  id: 'standup',  title: 'Standup',
        prompt: 'Yesterday, today, and blockers. Be honest about the blockers.' },
      { day: 6,  id: 'oneonone', title: '1:1 with Tobias',
        prompt: 'Tobias wants to know how it\'s going, and what you\'d want more of.' },
      { day: 10, id: 'retro',    title: 'Sprint retro',
        prompt: 'Paste your retro into chat and walk the team through the sprint.' }
    ],

    PRIORITY: PRIORITY,
    NAMES: DEFAULT_NAMES,

    init: function (opts) {
      opts = opts || {};
      S = freshState();
      S.repo = opts.repo || null;
      S.dev = opts.dev || null;
      S.onMessage = opts.onMessage || null;

      var DR = (S.dev && S.dev.RULES) || null, k;
      S.rules = {};
      for (k in DEFAULT_RULES) if (has(DEFAULT_RULES, k)) {
        S.rules[k] = (DR && DR[k] !== undefined && DR[k] !== null) ? DR[k] : DEFAULT_RULES[k];
      }
      S.day = 1;
      S.hour = num(S.rules.startHour, 9);

      readRepo(S.repo);

      S.events = normEvents(S.repo);
      S.eventFired = [];
      for (var i = 0; i < S.events.length; i++) S.eventFired.push(false);

      return Squad;
    },

    /**
     * Called on every Dev tick. Emits, in this order:
     *   - every scripted repo.events[] item now due,
     *   - every gate now due,
     *   - at most ONE reactive message.
     * Returns the messages emitted on this call; onMessage is the primary
     * channel and ui.js may ignore the return value.
     */
    tick: function (state) {
      var out = [];
      if (!S || !state) return out;

      S.tickNo = num(state.tick, S.tickNo + 1);
      S.day = num(state.day, S.day);
      S.hour = num(state.hour, S.hour);
      S.W = W(S.day, S.hour);

      fireScripted(state, out);
      fireGates(state, out);

      // Once the retro is in, the squad stops coaching. Nothing said after the
      // decision can change the decision.
      if (state.retroSubmitted) return out;

      var ev = updateBook(state);
      react(state, ev);
      evaluate(state);

      if (S.lastDrainTick !== S.tickNo) {
        var msg = drain(state);
        if (msg) { S.lastDrainTick = S.tickNo; out.push(msg); }
      }
      return out;
    },

    getFeed: function () { return S ? S.feed.slice() : []; },

    /* Additive helpers. Nothing in the contract depends on them; ui.js and the
     * tests may use them. */
    pending: function () { return S ? S.queue.length : 0; },
    fired: function (id) { return !!(S && S.fired[id]); },

    /** ui.js may call this when the player answers an inline reply prompt.
     *  Entirely optional — silence is also detected from the state stream. */
    reply: function (eventId) {
      if (!S || !eventId || !S.openReply[eventId]) return false;
      if (S.openReply[eventId].answered) return false;
      S.openReply[eventId].answered = true;
      S.openReply[eventId].answeredW = S.W;
      return true;
    }
  };

  /* ================================================================ TRIGGERS
   * Two families:
   *   react()    — things that happen AT a moment: an ask, a PR, a bounce, a
   *                merge, a ticket handed back.
   *   evaluate() — standing conditions checked every tick: stuckness, budget,
   *                estimates, the silence of an unanswered PM.
   * Evaluation order does not decide who speaks first; the priority queue does.
   * Every block names the lesson it exists to teach.
   * ====================================================================== */

  function react(state, ev) {
    var i;

    for (i = 0; i < ev.asks.length; i++) onAsk(ev.asks[i], state);
    for (i = 0; i < ev.builds.length; i++) onBuild(ev.builds[i], state);
    for (i = 0; i < ev.prOpens.length; i++) onPR(ev.prOpens[i], state);
    for (i = 0; i < ev.bounces.length; i++) onBounce(ev.bounces[i], state);
    for (i = 0; i < ev.conventions.length; i++) onConvention(ev.conventions[i], state);
    for (i = 0; i < ev.merges.length; i++) onMerge(ev.merges[i], state);
    for (i = 0; i < ev.abandons.length; i++) onAbandon(ev.abandons[i], state);
    for (i = 0; i < ev.newRuns.length; i++) onRun(ev.newRuns[i], state);
  }

  /* ---- the asks -------------------------------------------------------- */

  /**
   * Classification here is DEEPA'S, not the engine's. She cannot see a timebox
   * field; she can see how long you had the ticket and how many different things
   * you tried before you came to her, and she told you her rule on day one. If
   * dev.js publishes its own classification, this file deliberately ignores it —
   * that number is computed from the true timebox, and reading it would be
   * reading the truth through a side door.
   *
   * Only asks to Deepa are judged. Hannah is delighted to be asked and the
   * channel is free; neither of them keeps score.
   */
  function onAsk(a, state) {
    if (a.to === 'channel') {
      // Remember the first one. The stranger replies in evaluate(), later,
      // because an instant answer from #eng-help would be a different sim.
      if (!S.firstChannelAsk) S.firstChannelAsk = { ticket: a.ticket, W: S.W };
      return;
    }
    if (a.to !== 'deepa') return;

    /* [SPEC] asked well after a real timebox, but LATE ------------------ MENTOR
     * Lesson: the question was never the expensive part. Checked before the
     * praise, because an ask at hour five is not the pattern we want to
     * reinforce even though it has the timebox in it. */
    if (a.hours >= OVERDUE_HOURS && a.u < num(S.rules.implementReadyAt, 70)) {
      trig('ask_overdue', 'MENTOR', 'warn', [
        'Right — answer\'s below. But {hours} hours, and you are still under the line where you could start building. That question cost me four minutes today and it would have cost me four minutes on Tuesday. The four minutes was never the expensive part.',
        'Got it, and here it is. I do want to say the quiet bit out loud: you sat on {tid} for {hours} hours before this message. I would much rather be asked ten things too early than one thing too late. Early costs you a little face. Late costs the sprint a ticket.',
        'Answering now. Also — {hours} hours on {tid} first. Whatever made you wait, and I know exactly what it was because I did it for my entire first year, it is not true. Nobody here is keeping a tally of your questions. We are all quietly keeping a tally of surprises.',
        'Here you go. Next time, come at ninety minutes. Not because ninety minutes is magic, but because by then you will know whether the answer is the kind of thing that gets written down. If it is not, no amount of extra reading was ever going to produce it.'
      ], { hours: hrs(a.hours), tid: a.ticket }, { expiresW: S.W + 3 });
      return;
    }

    /* [SPEC] asked before the timebox with solo avenues unused ---------- MENTOR
     * Lesson: what did you try first. Her signature move, deployed gently — she
     * still answers, every time. */
    if (a.hours < PREMATURE_HOURS && a.tried < PREMATURE_ACTIONS) {
      trig('ask_premature', 'MENTOR', 'warn', [
        'Happy to help on {tid} — but first: what have you tried, and what did you expect to happen? You are {mins} minutes in and the board says you have tried {tried}. I am not being precious about my time. I am going to ask you those two questions every single time, and the answers are usually the fix.',
        'Before I answer that one — you have had {tid} for {mins} minutes. Give it a real go first. Reproduce it, follow the call path, then come back with the specific line that confuses you. If that takes forty minutes and you still need me, you will get a much better answer, because you will be able to tell me what you already ruled out.',
        'I will answer it, and I would rather you had asked me in an hour. {mins} minutes and {n} {thing} on {tid}. The rule I gave you on Monday runs both ways — timebox it, THEN come. The timebox is the part that makes the asking cheap.',
        'Quick one back at you before I answer: what did you expect to happen on {tid}, and what happened instead? If you cannot answer the second half yet, you have not looked yet. Go look. Then I am yours, genuinely.'
      ], {
        tid: a.ticket, mins: mins(a.hours * 60),
        tried: a.triedText, n: a.tried,
        thing: plural(a.tried, 'thing tried', 'things tried')
      }, { expiresW: S.W + 3 });
      return;
    }

    /* [SPEC] asked well after a real timebox --------------------------- MENTOR
     * Lesson: praise it EXPLICITLY, and name the mechanism, so the pattern
     * sticks. This is the behaviour the whole sim is trying to build. */
    if (a.hours >= TIMEBOX_HOURS && a.tried >= TIMEBOX_ACTIONS) {
      trig('ask_well_formed', 'MENTOR', 'praise', [
        'That is exactly the right question at exactly the right time. {hours} hours in, {n} different things tried, and you came with what you had ruled out. It took me ninety seconds to answer because you did the expensive part. Ask me like that every time and you can have as much of my week as you want.',
        'Good ask. You had already run {tried} before you got to me, which is why I could give you a straight answer instead of twenty questions back. Say that out loud at standup — "I timeboxed it, then asked" — because juniors here tend to learn the opposite lesson and it costs them months.',
        'Noted, and answered. For the record: {hours} hours of honest work followed by a question with evidence in it is worth more to me than a day of silence and a beautiful PR. You have just spent about four minutes of my ten hours. That is a good trade for both of us.',
        'This is what I meant on Monday. You ran {tried}, you know what you expected and what you got, and the question is specific. That is not asking for help, that is handing me a half-debugged problem. Answer is on its way.'
      ], {
        hours: hrs(a.hours), n: a.tried, tried: a.triedText, tid: a.ticket
      }, { expiresW: S.W + 3 });
    }
  }

  /* ---- action-by-action -------------------------------------------------- */

  function onRun(run, state) {
    var r = bk(run.ticket);
    var a = run.action;
    var runs = r.runs[a] || [];
    var n = runs.length;
    var spent = minutesOn(r, a);

    /* [SPEC] followed a negative-yield action for >90 min --------------- MENTOR
     * TRUTH-FREE FORM: the yield sign is truth and this file cannot see it. What
     * it can see is the shadow the player is also looking at — ninety minutes
     * inside one action and the understanding bar has not moved, or has moved
     * backwards. That is the observable signature of a wiki page describing code
     * that was deleted, and telling the two apart is the actual skill.
     * Lesson: the docs lie, and here is how you tell. */
    if (spent >= MISLEAD_MINUTES && n >= 2) {
      var net = 0, q;
      for (q = 0; q < runs.length; q++) net += runs[q];
      if (net <= 0.5) {
        trig('misleading_action', 'MENTOR', 'warn', [
          'Careful — {mins} minutes of `{action}` on {tid} and your understanding is {delta} for it. That is the signature of reading something that describes code we deleted. Nobody has ever removed a page from that wiki. Cross-check anything it tells you against the actual file before you believe it.',
          'I want to name the thing that is happening on {tid}: {mins} minutes into `{action}` and you know less than when you started. That is not you being slow. Some of what is in there is load-bearing and some of it is a fever dream from a framework migration we abandoned, and there is no label on either.',
          '`{action}` has cost you {mins} minutes on {tid} and moved you {delta}. The rule I use: our documentation is reliable about INTENT and unreliable about MECHANISM. If a page tells you what a class is called, check that the class still exists before you spend another hour on it.',
          'Stop and check one thing for me. {mins} minutes of `{action}` on {tid} for {delta} understanding. Open the very first claim it makes and see whether it is still true today. If it is not — close the tab, and do not feel bad. That page has eaten better engineers than either of us.'
        ], {
          mins: mins(spent), action: lc(actionLabel(a)),
          tid: run.ticket, delta: sgn(net)
        });
        return;
      }
    }

    /* [SPEC] 3+ repeats of the same action with decaying yield ---------- MENTOR
     * Diminishing returns are visible to the player on their own plot, which is
     * the only place this file looks. Distinct from the trigger above: this is
     * the action that WORKED and then stopped working.
     * Lesson: rereading the same file is not progress. */
    if (n >= REPEAT_TIMES) {
      var first = runs[0], last = runs[n - 1];
      if (first > 2 && last <= Math.max(2, 0.6 * first)) {
        trig('repeat_action', 'MENTOR', 'neutral', [
          '`{action}` on {tid}, {n} times now. The first pass bought you {first} points of understanding. The last one bought you {last}. That is not a reading problem, it is a source problem — what you need is not in there. Try the commit history, or try me.',
          'Gentle observation: `{action}` on {tid}, {n} times, and the curve has gone flat. Rereading the same file is the thing all of us do when we do not want to admit we are stuck. Change the KIND of evidence, not the amount of it.',
          '{n} passes of `{action}` on {tid}, and you are down to {last} points a pass from {first}. I do this too. It feels like work and it is very calming. It is not progress. What is the next DIFFERENT thing you could look at?',
          'If the third read of something tells you exactly what the second read told you, the information is not in there. {tid} has had {n} rounds of `{action}`. Commit history, old messages in the channel, or me. Pick one of the three.'
        ], {
          action: lc(actionLabel(a)), tid: run.ticket, n: n,
          first: sgn(first), last: sgn(last)
        });
      }
    }
  }

  /* ---- building, reviewing, merging ------------------------------------- */

  function onBuild(b, state) {
    var correct = num(S.rules.correctAt, 90);

    /* [SPEC] implemented below correctAt ----------------------------- REVIEWER
     * Both numbers are published rules — the UI draws them on the bar. No truth.
     * Lesson: you are guessing, and guessing shows up in a diff. */
    if (b.u < correct) {
      trig('implement_underinformed', 'REVIEWER', 'pressure', [
        'I can see the branch on {tid}. You are at {u} and I bounce below {correct} — not out of pedantry, but because at {u} you will be able to tell me what you changed and not why it works. Get the why first. The diff gets smaller too, every time.',
        'Before you go much further on {tid}: understanding {u}, and the bar for a review that survives me is {correct}. That gap is not a formality. Every point of it turns into rework, and rework on a branch is much slower than reading was.',
        'Heads up on {tid}. You started building at {u}. I am going to ask you, in the review, to walk me through why the fix belongs at that layer and not one above it. If the honest answer turns out to be "it made the test pass", we will both lose an afternoon.',
        'You are building at {u} against a bar of {correct}. That is not a criticism, it is a forecast: this one comes back. Guessing shows up in a diff as extra defensive code, and it is the easiest thing in the world to spot from the outside.'
      ], { tid: b.ticket, u: Math.round(b.u), correct: Math.round(correct) },
         { expiresW: S.W + 4 });
    }
  }

  function onPR(p, state) {
    var crit = testCriterion(p.ticket);

    /* [SPEC] no tests on a ticket that needs them --------------- BOT then REVIEWER
     * "Needs them" is read from the ticket's own PUBLISHED acceptance criteria,
     * not from truth.needsTests. CI speaks first and Nnamdi follows once CI has
     * actually spoken — see evaluate().
     * Lesson: the coverage gate, and why it exists. */
    if (!p.hasTests && crit) {
      S.noTestTicket = p.ticket;
      trig('no_tests_ci', 'BOT', 'warn', [
        'CI {tid} — build OK. lint OK. coverage gate: NO TEST FILES IN DIFF. review blocked pending author acknowledgement.',
        'CI {tid} — PASS (0 tests added, 0 modified). policy check `require-tests-on-behaviour-change`: FAIL. not auto-mergeable.',
        'CI {tid} — 1 warning. behavioural change detected, coverage delta unknown, no test paths touched. flagging per repo policy.',
        'CI {tid} — green. gate `tests-required`: FAIL. this branch will not merge in its current state.'
      ], { tid: p.ticket });
    }

    /* [EXTRA] a PR opened right on the reviewer's cutoff -------------- REVIEWER
     * Lesson: "opened" and "merged" are separated by another person's queue, and
     * that queue is the thing juniors leave out of their arithmetic. Sharply
     * time-critical — this is only worth saying today. */
    var leftToday = endHour() - S.hour;
    if (leftToday <= CUTOFF_HOURS + 1e-9) {
      trig('pr_at_cutoff', 'REVIEWER', 'neutral', [
        'Got {tid}. It is {time} — so this is tomorrow morning\'s review, not today\'s. Not a problem, just do not sit waiting on it. Worth knowing for planning: "opened" and "merged" are separated by my queue, and my queue is a real thing with other people\'s names in it.',
        '{tid} landed at {time}. I will get to it first thing. Small piece of advice that took me years to learn: work backwards from the merge, not forwards from the code. If it has to be in by Friday, it has to be in front of me by Thursday lunchtime.',
        'Seen {tid}, {time}. That is tomorrow. And if it bounces — which it might, that is normal — that is another cycle after that. Two bounces late on a Thursday is a next-sprint ticket, and the arithmetic surprises people every single time.',
        'That is opened right at the end of my day, {tid}. I am not going to rush it, because a rushed review from me is worse than no review. Queue it earlier next time and you get a better one.'
      ], { tid: p.ticket, time: hhmm(S.hour) }, { expiresW: S.W + 1.5 });
    }
  }

  function onBounce(b, state) {

    /* [SPEC] PR bounced twice on the same ticket --------------------- REVIEWER
     * Lesson: address the comment, do not resubmit hope. Written the way Nnamdi
     * writes: the problem is the disagreement, not the person. */
    if (b.n >= 2) {
      trig('bounced_twice', 'REVIEWER', 'warn', [
        'Second bounce on {tid}. Let us break the loop: reply to the comment before you push again. If you disagree with it, say so — I am wrong maybe one time in five and I would much rather argue with you than watch you resubmit hope.',
        '{tid} is back again and the same thing is still true of it. That usually means my comment was not clear, so: tell me what you think I am asking for, in your own words, and I will tell you whether you have got it. Re-pushing without that step is a coin flip we both pay for.',
        'Two bounces, {tid}. Pause. A review comment is a question about the code, not a chore to clear. Answer the question in the thread first — half the time you will find the answer changes the diff, and the other half you will find I misread it.',
        'I have bounced {tid} twice now and I want to be careful how that lands: it is not a judgement about you. It IS a signal that you and I do not yet agree on what this change is. Fifteen minutes on a call beats a third round of this.'
      ], { tid: b.ticket, n: b.n }, { expiresW: S.W + 6 });
    }
  }

  function onConvention(c, state) {
    var r = bk(c.ticket);
    var readDocs = num(r.actions.read_docs, 0) + num(r.actions.read_style, 0);

    /* [SPEC] picked the convention trap ------------------------------ REVIEWER
     * TRUTH-FREE FORM: which pattern is the trap is ground truth and Nnamdi does
     * not get to know it. What he sees is that a pattern was chosen without the
     * style guide ever being opened, on a codebase where the majority pattern
     * and the current pattern are different things. So he asks where it came
     * from — which is what a good reviewer does anyway.
     * Lesson: matching your neighbours teaches you what we USED to do. */
    if (readDocs === 0 && r.askTotal === 0) {
      trig('convention_unchecked', 'REVIEWER', 'neutral', [
        'You have set {conv} as the pattern on {tid}. Genuine question, and the answer matters: where did that come from? If it came from the files sitting next to it, be careful — a good chunk of this repo is on a path we stopped recommending years ago and nobody ever went back to fix the neighbours.',
        'On {tid} you have picked {conv}. "Match the surrounding code" is excellent advice in a two-year-old codebase and a trap in a nine-year-old one. The style guide has an opinion about exactly this. Two minutes in there beats a bounce from me.',
        '{conv} on {tid}. I am going to ask this in the review so I will ask it now: which is the current pattern, and how do you know? Reading the neighbours tells you what we used to do. This is the one area where the documentation is more reliable than the code.',
        'Small thing with a long tail: you chose {conv} for {tid} without opening the style guide once. In this repo the majority pattern and the correct pattern are different things in about a third of the modules, and copying is exactly how that stays true.'
      ], { conv: c.name, tid: c.ticket }, { expiresW: S.W + 8 });
    }
  }

  function onMerge(m, state) {

    /* [EXTRA] the first merged PR ------------------------------------ REVIEWER
     * Lesson: none, deliberately. This sim is ten days of being the least
     * knowledgeable person in the room and it needs one moment that is simply
     * good. Nnamdi is picky, so praise from him is worth something — which is
     * exactly why he is the one who gets to say it. */
    if (S.mergedCount <= 1) {
      trig('first_merge', 'REVIEWER', 'praise', [
        'Merged {tid}. Nice one — and I mean that specifically rather than politely: the diff was the size of the problem, the test fails without it, and you could tell me why it works. That is the whole bar. The first one is the hardest and you have it on day {day}.',
        '{tid} is in. Welcome to the codebase — you own a piece of it now, which is a slightly ominous thing to say but it is genuinely how it works around here. For what it is worth, I read that one twice looking for something to complain about and did not find it.',
        'Merged. That is your first, so I will say the thing I do not usually say out loud: the reason it went through cleanly is that you did the reading before the writing. Most people learn that the other way round, over about six bounced PRs. Well done.',
        '{tid} merged, no comments from me. Deepa asked this morning how you were getting on and I told her you were fine, which from me is effusive. Keep going.'
      ], { tid: m.ticket, day: S.day }, { expiresW: S.W + 6 });
    }
  }

  function onAbandon(ab, state) {

    /* [EXTRA] handed back after sinking a day into it -------------------- LEAD
     * Lesson: the two-sided one, which is the hardest to teach. Abandoning was
     * the right call and telling the team a ticket is misfiled IS doing the
     * ticket. The cost was not the decision, it was how long it took to allow
     * yourself to make it. Tobias, because he is the one who would rather roll a
     * ticket than watch someone bleed on it. */
    if (ab.hours >= 4) {
      trig('abandon_after_investment', 'LEAD', 'praise', [
        'You handed {tid} back after {hours} hours, and I want to be careful how I say this because it is two things at once. Calling it is right — I would far rather roll a ticket than have someone quietly bleed on one. And {hours} hours is what the decision cost, because you made it at the end instead of near the beginning. Both of those belong in the retro.',
        '{tid} dropped. Good. Genuinely — telling the team a ticket is misfiled is doing the ticket, and most people cannot make themselves do it because it feels like admitting they could not. The expensive part was never the decision. It was the {hours} hours it took to let yourself make it.',
        'Right call on {tid}. One note, and it is the only one: what did you know at hour {hours} that you did not know at hour one? If the honest answer is "not much", that is the signal to watch for. A day where you learn nothing is the ticket telling you something about itself.',
        'Handed back after {hours} hours. That is a contribution and I will say so at the retro. It is also {hours} hours — so let us make the lesson stick: put a stated timebox on anything that smells like it might be someone else\'s problem, and when you hit it, say so out loud.'
      ], { tid: ab.ticket, hours: hrs(ab.hours) }, { expiresW: S.W + 8 });
    }
  }

  /* ---- standing conditions, checked every tick -------------------------- */

  function evaluate(state) {
    var R = S.rules, id, r, i;
    var stuckHours = num(R.stuckHours, 3);
    var open = openTicketIds();

    /* [SPEC] understanding flat for stuckHours and no ask ---------------- LEAD
     * Lesson: silent stuckness is the one unforgivable thing. Note what this
     * does NOT know: whether the ticket is findable at all. Tobias can see the
     * flat line and the silence. He cannot see that the answer lives in a
     * contract nobody has open. That is the whole design.
     * Time-critical — a stuckness warning a day late is a post-mortem. */
    for (i = 0; i < open.length; i++) {
      r = S.tk[open[i]];
      var flat = r.hours - r.lastGainHours;
      if (r.hours < stuckHours || flat < stuckHours) continue;
      if (r.askTotal > 0) continue;
      trig('silent_stuck', 'LEAD', 'pressure', [
        'You have been on {tid} for {hours} hours and the understanding bar has not moved for the last {flat} of them. I am not asking why it is slow. I am asking why I am finding out from the board instead of from you. Being stuck is completely fine. Being quietly stuck is the one thing I cannot work with.',
        '{tid}: {flat} hours flat, no question to anyone. I want to be clear this is not about pace — Deepa lost the best part of a week to that module once and I still rate her above everyone. It is that right now nobody but you knows you are in trouble, and I can only move things around problems I can see.',
        'Checking in, and please read this as help rather than pressure: {hours} hours into {tid}, flat since {since}. Say the sentence — "I am stuck on X, I have tried Y, I could use twenty minutes". It has never once cost anybody here anything, and I have watched three people learn that far too late.',
        'Flag it. {tid} has been flat for {flat} hours. If you tell me now it is a scheduling problem and I will move something. If you tell me on Thursday it is a delivery problem and it is mine. Same information, completely different conversation.'
      ], {
        tid: r.id, hours: hrs(r.hours), flat: hrs(flat),
        since: tstamp(S.day, S.hour)
      }, { expiresW: S.W + R.hoursPerDay });
      break;
    }

    /* [SPEC] never asked anyone by day 4 --------------------------------- LEAD
     * Lesson: independence is not the metric. Tobias, because it is a delivery
     * observation and because it needs to come from the person who decides what
     * "doing well here" means. */
    if (S.day >= 4 && S.askTotal === 0 && S.started) {
      trig('never_asked_day4', 'LEAD', 'pressure', [
        'It is day {day} and you have not asked anybody a single question. I want to say this plainly, because it is the thing people get wrong for years: independence is not the metric. Throughput is, and so is the team\'s confidence that you will say when something is wrong. Deepa has {left} hours sitting unused with your name on them.',
        'Day {day}, zero questions. Either these tickets are much easier than we thought, or you are doing the thing where you prove you did not need us. I have done that. It cost me a promotion cycle. Deepa\'s budget is {left} hours and it does not roll over to next sprint.',
        'Four days in and nobody has heard a question out of you. That is not a compliment I am about to pay you. The people I trust most on this team are the ones who tell me things early — asking is a signal that you know where the edge of your knowledge is, and that is the actual skill.',
        'Observation, not a telling-off: {day} days, no questions. Nobody gets hired at this level already knowing a four-hundred-thousand-line codebase. They get hired to close that gap fast, and the fastest route runs through Deepa, Hannah and me, in that order.'
      ], { day: S.day, left: hrs(S.seniorLeft) },
         { expiresW: endOfDayW(6) });
    }

    /* [SPEC] senior budget under 20% remaining ------------------------- MENTOR
     * Lesson: her time is a real, shared resource, and learning to spend it well
     * is a skill that outlives being junior. Published number; no truth. */
    if (S.seniorTotal > 0 && S.seniorLeft <= BUDGET_LOW_FRAC * S.seniorTotal && S.askTo.deepa > 0) {
      trig('senior_budget_low', 'MENTOR', 'warn', [
        'Heads up — I have about {left} hours left for you this sprint, out of {total}. Not a complaint, just so you can plan: what is left on your board that only I can answer? Ask me that one first, and use the wiki and the commit log for everything else.',
        'Budget check: {left} hours of me remaining, {days} days to go. Spend them on the things that live in somebody\'s head rather than in the repo — old decisions, contracts, why something is the way it is. Anything that is written down anywhere, you can get to faster than I can tell you.',
        'We are down to {left} hours. I would much rather you used them than saved them, but I would like the last ones to be good ones. If your question starts with "why does", that is mine. If it starts with "where is", that is grep.',
        '{left} hours left out of {total}. For what it is worth, that number is real — I have a migration of my own and a lead who counts. This is the part nobody tells juniors: senior time is a shared resource, and learning to spend it well is a skill you will still need long after you stop needing me.'
      ], {
        left: hrs(S.seniorLeft), total: hrs(S.seniorTotal),
        days: Math.max(0, num(R.days, 10) - S.day)
      });
    }

    /* [SPEC] estimate exceeded by 2x with no update ---------------------- LEAD
     * Lesson: a stale estimate is a broken promise made on your behalf. Tobias
     * does not care that the estimate was wrong. Everyone's are. */
    for (i = 0; i < open.length; i++) {
      r = S.tk[open[i]];
      if (!r.est || r.est <= 0 || r.estChanges > 0) continue;
      if (r.hours < 2 * r.est) continue;
      trig('estimate_2x', 'LEAD', 'warn', [
        '{tid}: estimated {est} hours, {spent} on the clock. I do not care that the estimate was wrong — everybody\'s are. I care that it still says {est} on the board. An estimate you have not updated is a promise somebody else is making on your behalf, and you already know it is false.',
        'You are at {spent} hours on a {est}-hour ticket. Update the number. Not as an admission of anything — Hannah is planning a partner call off that board, and a stale estimate is how a PM finds out on Thursday what you knew on Tuesday.',
        '{tid} has blown past double its estimate and the board has not moved. The revision IS the deliverable here. "It is bigger than I thought, here is why, here is the new number" is a completely ordinary sentence that I hear from staff engineers every week.',
        '{tid}: estimate {est}h, actual {spent}h and counting, board unchanged. The skill was never estimating well. It is noticing quickly that you have blown one. You are {x}x over and I would like to hear it from you rather than read it off a burndown.'
      ], {
        tid: r.id, est: hrs(r.est), spent: hrs(r.hours),
        x: (r.hours / r.est).toFixed(1)
      }, { expiresW: S.W + 2 * R.hoursPerDay });
      break;
    }

    /* [SPEC] worked past hoursPerDay repeatedly -------------------------- LEAD
     * Lesson: heroics are a smell, not a virtue — they hide the thing the lead
     * actually needs to see, which is that the plan was wrong. */
    if (S.lateDayCount >= LATE_DAYS) {
      trig('heroics', 'LEAD', 'warn', [
        'You have worked past {end} on {n} days now. Stop. And this is not me being nice: hours seven and eight of a day are where you write the bug you will spend Thursday finding, and they hide the only thing I actually need to see, which is that the plan was wrong.',
        'Second evening. I want to be very clear that nobody asked for it and it buys you nothing with me. If the work does not fit into {hpd} hours a day, then the work does not fit — that is a planning fact, and it is mine to fix rather than yours to absorb.',
        'I can see the timestamps. {n} evenings now. Heroics are a smell, not a virtue: they mean an estimate was wrong and we found out by watching somebody burn instead of by hearing about it on day two. Tell me what to cut.',
        'Late again. Here is the version of this I wish somebody had told me at your stage: the team cannot see a problem you are quietly absorbing. Every hour past {end} is an hour of information the rest of us do not get.'
      ], { n: S.lateDayCount, end: hhmm(endHour()), hpd: hrs(R.hoursPerDay) },
         { expiresW: S.W + 2 * R.hoursPerDay });
    }

    /* [SPEC] touched the feared legacy module --------------------------- MENTOR
     * TRUTH-FREE FORM: which module is dangerous is not in the truth blob and
     * would not be readable if it were. What Deepa reacts to is the ticket's OWN
     * PUBLISHED WORDS — "shared", "standardising", "public API", "config" — read
     * against nine years of experience. She offers the map, not the answer: the
     * player still has to go and find out who is mid-flight in it.
     * Lesson: here be dragons, and here is how you scope one. */
    for (i = 0; i < open.length; i++) {
      r = S.tk[open[i]];
      if (r.hours < 0.75) continue;
      var word = blastWord(r.id);
      if (!word) continue;
      trig('legacy_dragons', 'MENTOR', 'warn', [
        'I saw you pick up {tid}. Word of warning from somebody who has been burned in there: anything in this repo with "{word}" in the description is a blast-radius question, not an effort question. The size of the change and the size of the diff are unrelated. Find out who else has branches open before you run anything wide.',
        '{tid} — careful with that one. It is one point of typing and an unknown number of points of consequence. Nine years, two abandoned migrations, and four teams with long-lived branches. Before you touch anything shared: who owns it, who is mid-flight in it, and is there a narrower version that still satisfies the ticket?',
        'Here be dragons on {tid}, and here is the map: the migration notes in the wiki first, then me. Story points measure effort. They have never once measured risk, and the gap between those two is where this repo does its most expensive damage to people at your stage.',
        'That one looks small. In this codebase the small ones are the ones to be suspicious of — I have watched a one-line change to something shared produce a diff nobody could review and a fortnight of merge conflicts for three other teams. Scope it explicitly before you start, even if scoping takes longer than the change.'
      ], { tid: r.id, word: word });
      break;
    }

    /* [SPEC] no tests, part two -------------------------------------- REVIEWER
     * Nnamdi follows CI rather than racing it, so this waits until the bot has
     * actually spoken. Two voices, one lesson, in the order the spec asks for. */
    if (S.emitted.no_tests_ci !== undefined && S.noTestTicket) {
      var nt = bk(S.noTestTicket);
      if (!nt.hasTests) {
        trig('no_tests_review', 'REVIEWER', 'warn', [
          'Following CI on {tid}: the acceptance criteria on that ticket literally say {crit}. I am not going to merge it without one. And selfishly — the test is how I know your fix still works when somebody changes that file in eighteen months, which they will.',
          '{tid} has no test. The ticket asked for one in writing, which makes this easy for both of us. Write the failing case first if you can: a test that is red before your change and green after is the only evidence either of us has that you fixed the thing you think you fixed.',
          'No tests on {tid}. I will review the logic anyway so you are not blocked, but it is not merging like this. If you are not sure where the test goes, say so and I will point at the nearest one. That is a thirty-second question and nobody has ever thought less of anyone for asking it.',
          'On {tid}: the acceptance criteria say {crit}, and the diff does not. I bounce this every time, for everybody, including Deepa. It is the cheapest thing on the board and it is the thing that stops this bug being reopened next year.'
        ], { tid: S.noTestTicket, crit: testCriterion(S.noTestTicket) || 'a test' },
           { expiresW: S.W + 2 * R.hoursPerDay });
      }
    }

    /* [EXTRA] the stranger in #eng-help ------------------------------- CHANNEL
     * Lesson: an answer from somebody who cannot see your repository is a
     * hypothesis in a confident voice. Deliberately generic advice — this file
     * does not know what is wrong with your ticket, and neither does Marcus.
     * Delayed, because #eng-help is async and instant help would be a different
     * simulation. */
    if (S.firstChannelAsk && S.W - S.firstChannelAsk.W >= 0.75) {
      trig('channel_stranger', 'CHANNEL', 'neutral', [
        'oh yeah we hit something like this on Billing last year. 99% it is a caching layer — just clear the cache on deploy and it goes away. honestly would not overthink it 🙂',
        'sounds like a race condition to me. we added a small sleep before the assert and it stabilised, has been fine ever since. nobody has complained anyway',
        'not my area but generally in that part of the codebase you want to wrap it and log it and move on. half of that module is legacy, I would not spend your sprint on it',
        'we had something that looked identical — turned out to be a version bump upstream. try pinning the dependency and see if it goes away, that is usually it. good luck!'
      ], {}, { name: STRANGER, expiresW: S.W + 4 });
    }

    /* [EXTRA] asking the channel what only Deepa could answer ---------- MENTOR
     * Lesson: the free channel is only free because it cannot see your code.
     * TRUTH-FREE: Deepa does not know whether the answer is in the repo. She
     * knows you have gone to strangers twice about one ticket while the budget
     * with your name on it sits untouched, and she knows which KINDS of question
     * do not survive the trip. */
    for (i = 0; i < S.ticketOrder.length; i++) {
      r = S.tk[S.ticketOrder[i]];
      if (!r || r.asks.channel < 2 || S.askTo.deepa > 0) continue;
      if (S.seniorLeft < 0.6 * S.seniorTotal) continue;
      trig('channel_over_mentor', 'MENTOR', 'neutral', [
        'I noticed you have been asking #eng-help about {tid}. Nothing wrong with that at all, but — the people in there cannot see your branch, do not know this module, and are answering out of a different repo\'s habits. I have {left} hours with your name on them and I am cheaper than a confidently wrong stranger.',
        '{n} questions in #eng-help about {tid} and none to me. I get why: the channel feels free and my budget feels like it is coming out of something. The channel is only free because it cannot see your code. Use it for "how does Python do X". Use me for "why does OUR thing do X".',
        'Genuine offer: bring {tid} to me. #eng-help is great for general questions and quietly dangerous for specific ones — you will get an answer that is true in general and wrong here, and it will sound exactly as certain as a right one.',
        'You have gone to the channel twice on {tid}. Worth knowing where the line is: anything about this repo\'s history, our contracts, or why a decision was made is not going to be in there. That material lives in about four people\'s heads and I am one of them, for {left} more hours.'
      ], { tid: r.id, n: r.asks.channel, left: hrs(S.seniorLeft) },
         { expiresW: S.W + 2 * R.hoursPerDay });
      break;
    }

    /* [EXTRA] every ticket estimated identically ------------------------- LEAD
     * Lesson: an estimate that does not vary carries no information. The points
     * on the cards are PUBLIC, which is what makes the jab land: the five-point
     * ticket and the one-point ticket cannot both be four hours. */
    if (!S.fired.flat_estimates && S.started) {
      var ests = [], big = null, small = null, bp = -1, sp = 1e9;
      for (i = 0; i < S.ticketOrder.length; i++) {
        r = S.tk[S.ticketOrder[i]];
        if (!r || r.firstEst === null) continue;
        ests.push(r.firstEst);
        var pts = num((pubTicket(r.id) || {}).points, 0);
        if (pts > bp) { bp = pts; big = r.id; }
        if (pts < sp) { sp = pts; small = r.id; }
      }
      var allSame = ests.length >= 4;
      for (i = 1; i < ests.length && allSame; i++) if (Math.abs(ests[i] - ests[0]) > 1e-9) allSame = false;
      if (allSame) {
        trig('flat_estimates', 'LEAD', 'neutral', [
          'You have put {est} hours on {n} of them. All of them. That is not an estimate, it is a placeholder with a number on it — and I read the board as though it means something. {big} is {bp} points and {small} is {sp}. Which of these do you actually think is the big one? That is the only part I need.',
          '{n} identical estimates. I would genuinely rather have four wildly wrong different numbers than {n} confident identical ones, because the DIFFERENCES are the information. Where is the risk? Which one would you be least surprised to still be looking at next sprint?',
          'Every ticket at {est} hours. I know what that means — you do not know yet, and putting the same number everywhere felt more honest than guessing. It is not more honest. It hides the guess. Spread them out and mark the ones you are least sure of. Nobody is going to hold you to them.',
          'Same number on {n} tickets, including a {bp}-pointer and a {sp}-pointer. The estimate is not a commitment and it is not a test. It is the only tool I have for spotting the ticket that is going to eat your week, before it eats your week.'
        ], {
          est: hrs(ests[0]), n: ests.length,
          big: big, small: small, bp: bp, sp: (sp === 1e9 ? 1 : sp)
        }, { expiresW: endOfDayW(3) });
      }
    }

    /* [EXTRA] never once looked at the history --------------------- MENTOR
     * Lesson: the code tells you WHAT, the commit message tells you WHY, and why
     * is the thing that is actually missing. She said it on day two as a scripted
     * event; by day eight it is worth saying once more, while it can still be
     * acted on. Time-critical — pointless after the freeze. */
    if (S.day >= 8 && S.blameTotal === 0 && S.started) {
      trig('never_blamed', 'MENTOR', 'neutral', [
        'It is day {day} and there is not a single `git log` in your ledger. I said this on Tuesday and it is the only thing I will repeat: the code tells you WHAT, the commit message tells you WHY, and "why" is what is actually missing on most of that board. Fifteen minutes, and it is the cheapest action you own.',
        'One thing before the week runs out — you have never once looked at the history. Nine years of this repo has a paper trail: arguments, reversions, commit messages that say "do not change this without talking to somebody first". People leave notes for exactly the situation you are in, and almost nobody reads them.',
        'Day {day}, no log, no blame. That is the single most underused tool on this team and it costs nothing. When something looks wrong and you cannot work out why any sane person would have written it that way — that is the moment. Somebody had a reason and they usually wrote it down.',
        'Small nudge: run the history on the file you are stuck in. Not once this sprint. Half the questions people bring me are answered by a commit message from two years ago, and I feel faintly ridiculous every time I have to be the one to read it out loud.'
      ], { day: S.day }, { expiresW: endOfDayW(9) });
    }

    /* [EXTRA] the PM asked you something and you went quiet ---------------- PM
     * Lesson: a PM asking for a date is asking for a DECISION, and silence gets
     * answered by somebody else. Hannah is never unkind about it, which is what
     * makes it uncomfortable. */
    for (id in S.openReply) {
      if (!has(S.openReply, id)) continue;
      var o = S.openReply[id];
      if (o.from !== 'PM') continue;
      if (!o.answered && S.W - o.W >= HANNAH_PATIENCE) {
        trig('hannah_silence:' + id, 'PM', 'warn', [
          'Following up on my question from yesterday — and I promise I am not chasing to be annoying. The partner call is Thursday and I have to say something. "It is not going to be in" is a completely fine answer and I can plan around it. Silence is the only one I cannot.',
          'Hi again! Still hoping for a read before Thursday. Honestly, a rough one is fine — "probably not, here is what is missing" lets me move the conversation somewhere useful. If I do not hear anything I will have to guess, and I will guess optimistically, and then we will both have a bad Thursday.',
          'Sorry to nudge. Nobody is in trouble — I just cannot tell from the board whether that ticket is nearly done or has not started, and those two need very different phone calls from me today. Two lines is plenty.',
          'Me again. I have had to tell the partner something, so I have said we will confirm by Wednesday. That is me buying you a day rather than putting pressure on you. But I do now need the day back — what is the honest status?'
        ], {}, { needsReply: true, expiresW: o.W + 3 * R.hoursPerDay });
      }

      /* [EXTRA] ...and the other half of it ------------------------------- PM
       * Lesson: answering a PM the same day is nearly free and buys you the one
       * person on the team who is delighted to be asked things. She uses the
       * opening to say the thing nobody ever hears: ask me to clarify. */
      if (o.answered && (num(o.answeredW, S.W) - o.W) <= HANNAH_PROMPT) {
        trig('hannah_answered:' + id, 'PM', 'praise', [
          'Thank you — that is exactly what I needed and it took you two minutes. Also, while I have you: if anything in a ticket I write is unclear, ask me. I write them in a hurry and they are always clearer in my head than on the page. Almost nobody ever asks and I genuinely wish they would.',
          'Perfect, thank you. I can work with that. Honestly, the best thing about working with somebody who answers is that I stop having to guess in meetings — half of what looks like product indecision is just me not knowing what is true.',
          'Got it, appreciated. You are now one of about three people who reply to me the same day, which is a low bar and a real one. If you ever want a requirement pinned down, come and get me. I would far rather spend ten minutes now than watch somebody build the wrong thing for a week.',
          'Thanks! That is helpful and it changes what I say on Thursday, which is the entire point. And seriously — ask me things. A clarifying question from an engineer is the highlight of my week and I am not being sarcastic.'
        ], {}, { expiresW: S.W + R.hoursPerDay });
      }
    }
  }

  window.Squad = Squad;

})();
