/* =============================================================================
 * sim/org.js  —  window.Org
 *
 * The people. Six voices, three sources of messages (scripted, gates, reactive).
 * No DOM, no imports, no libraries, no build step. Loaded with a plain
 * <script src> tag from file://, and importable under node with
 * `global.window = global`.
 *
 * Contract (SPEC §4):
 *   Org.init({ co, product, onMessage })
 *   Org.tick(state)     // called by ui.js on every Product tick (one working day)
 *   Org.getFeed()       // -> [Msg, ...]
 *   Org.GATES           // -> [ {week, id, title, prompt}, ... ]
 *
 * Msg = { day, week, t:"W6 D2",
 *         from:"CEO"|"SALES"|"ENG"|"DESIGN"|"SUPPORT"|"CUSTOMER",
 *         name, text, tone:"neutral"|"pressure"|"warn"|"praise"|"alarm",
 *         needsReply:false }
 *   plus additive, non-breaking fields ui.js may ignore:
 *   kind:"scripted"|"gate"|"reactive", trigger:"<id>" (reactive), gate:"<id>",
 *   title (gates), eventId (scripted escalations), queuedDay (reactive).
 *
 * -----------------------------------------------------------------------------
 * THE ONE RULE THAT MATTERS
 *
 * ORG.JS NEVER READS GROUND TRUTH. It never calls co.reveal(), never touches
 * co._t, never learns a true impact or a true cost. Every stakeholder in here
 * argues from their own published position — their `favors`, their `opposes`,
 * the caveat printed on their instrument — and from what the PLAYER has done and
 * measured, reconstructed from the state stream alone.
 *
 * This is not a purity exercise. A stakeholder who secretly knew the right
 * answer would quietly turn the sim into a guessing game about which character
 * to obey, and the whole point is that nobody in the building knows. They are
 * all competent, all sincere, all partly wrong, and none of them can tell you
 * which part.
 *
 * -----------------------------------------------------------------------------
 * THE VOICES — hold these consistently.
 *
 *   CEO      Marguerite Osei    Sharp, impatient, pattern-matches to competitors.
 *                               Respects a no WITH A REASON. Punishes a no
 *                               delivered as a process. Short sentences. Never
 *                               asks for a document.
 *   SALES    Dan Reilly         Charming, relentless, always one specific real
 *                               deal. He is never lying, which is what makes him
 *                               hard to refuse and dangerous to obey.
 *   ENG      Rina Chowdhury     Dry, protective of her team, allergic to scope
 *                               creep. Estimates optimistically and half knows
 *                               it. Says the arithmetic out loud.
 *   DESIGN   Kofi Adeyemi       Real taste, cares about coherence, drawn to
 *                               visible polish over invisible value — and honest
 *                               enough to name that about himself.
 *   SUPPORT  Tomás Vidal        Buried, empirical, speaks in ticket volumes.
 *                               Represents the users you kept, loudly, and the
 *                               ones you lost not at all. He knows this.
 *   CUSTOMER One real account. Sometimes the most useful signal in the sim,
 *            sometimes wildly unrepresentative, never labelled as either.
 *
 * -----------------------------------------------------------------------------
 * DETERMINISM. Every trigger carries 3-5 phrasings. The one used is chosen by
 * hash(company id + '|' + trigger id) + the number of messages emitted so far,
 * modulo the variant count. Pure function of the session: the same quarter
 * played the same way produces a byte-identical feed, a quarter played
 * differently draws different words. Nothing here is random. No Math.random().
 * ========================================================================== */

(function () {
  'use strict';

  /* ---------------------------------------------------------------- voices */

  // Fallbacks. Real names are lifted off co.stakeholders in init().
  var DEFAULT_NAMES = {
    CEO:      'Marguerite Osei',
    SALES:    'Dan Reilly',
    ENG:      'Rina Chowdhury',
    DESIGN:   'Kofi Adeyemi',
    SUPPORT:  'Tomás Vidal',
    CUSTOMER: 'Priya Raman — Head of Data, Vantiv'
  };

  // Drain order when several reactive messages are queued. The CEO does not
  // wait behind design.
  var PRIORITY = { CEO: 1, ENG: 2, SALES: 3, SUPPORT: 4, DESIGN: 5, CUSTOMER: 6 };

  /* Instrument families. This is a claim about each instrument's PUBLISHED
   * caveat — what kind of thing it looks at — not about which direction it lies
   * in, which is ground truth and lives only in product.js. Two instruments in
   * the same family fail the same way, so running both is one measurement
   * wearing two hats. Unknown instruments become their own family, which is the
   * conservative reading. */
  var INSTRUMENT_FAMILY = {
    sales_anecdote:  'advocacy',    // prospects, mid-deal, loudest voice in the room
    survey:          'stated',      // what people say they want
    support_tickets: 'incumbent',   // people who stayed long enough to complain
    usage_analytics: 'incumbent',   // what exists, used by who is still here
    interviews:      'qualitative', // small n, direct, low bias, high variance
    fake_door:       'revealed',    // what people actually clicked
    ab_test:         'revealed'     // the clean one, and it arrives too late
  };

  var REVEALED_PREFERENCE = { fake_door: 1, ab_test: 1 };

  // A reading at or below this is not support for shipping something. It is a
  // measurement that said "probably not much". Player-visible number, no truth.
  var SUPPORT_THRESHOLD = 1.0;

  // Working days an escalation may sit before the feed treats the silence as
  // the answer. Matches product.js's own ignore window; nothing depends on the
  // two agreeing exactly, they just both have to be about a working week.
  var IGNORE_WINDOW = 5;

  /* ------------------------------------------------------------ formatting */

  function num(n, d) {
    n = (typeof n === 'number' && isFinite(n)) ? n : 0;
    return n.toFixed(d === undefined ? 1 : d);
  }

  function signed(n) {
    n = (typeof n === 'number' && isFinite(n)) ? n : 0;
    return (n >= 0 ? '+' : '') + n.toFixed(1);
  }

  function ew(n) {
    n = (typeof n === 'number' && isFinite(n)) ? n : 0;
    var s = (Math.round(n * 10) / 10);
    var txt = (s === Math.round(s) ? String(Math.round(s)) : s.toFixed(1));
    return txt + ' eng-week' + (s === 1 ? '' : 's');
  }

  function listWords(a) {
    a = a || [];
    if (!a.length) return '';
    if (a.length === 1) return a[0];
    if (a.length === 2) return a[0] + ' and ' + a[1];
    return a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
  }

  // {placeholder} substitution. An unfilled placeholder survives verbatim so it
  // shows up screamingly in tests rather than silently as an empty gap.
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

  function has(o, k) { return o && Object.prototype.hasOwnProperty.call(o, k); }

  /* ------------------------------------------- tolerant state stream readers
   * product.js is being built in parallel against the same spec. These readers
   * accept the shapes the spec names and the obvious near-misses, so a field
   * called `feature` instead of `featureId` degrades into a missing trigger
   * rather than a thrown exception in someone else's file. */

  function idOf(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'string') return v;
    if (typeof v === 'object' && typeof v.id === 'string') return v.id;
    return null;
  }

  function fidOf(o) {
    if (!o) return null;
    return idOf(o.featureId) || idOf(o.feature) || idOf(o.fid) || null;
  }

  function iidOf(o) {
    if (!o) return null;
    return idOf(o.instrumentId) || idOf(o.instrument) || idOf(o.iid) || null;
  }

  function valOf(o) {
    if (!o) return null;
    var keys = ['value', 'reading', 'impact', 'estimate'], i, v;
    for (i = 0; i < keys.length; i++) {
      v = o[keys[i]];
      if (typeof v === 'number' && isFinite(v)) return v;
    }
    return null;
  }

  function arr(v) { return Array.isArray(v) ? v : []; }

  /* ---------------------------------------------------------------- state */

  var S = null;   // session state; rebuilt by Org.init

  function freshState() {
    return {
      co: null, product: null, onMessage: null,
      coId: 'co',
      names: {},
      features: {},          // id -> feature (public fields only)
      stakeholders: [],      // public stakeholder records
      voiceOf: {},           // stakeholder id -> voice
      totalWeeks: 12,
      engWeeksPerWeek: 4,
      researchSlots: 2,

      feed: [],
      queue: [],
      fired: {},             // trigger id -> true (once per quarter)
      seq: 0,
      emitCount: 0,

      events: [],            // co.events sorted by absolute day
      eventFired: [],
      escalations: {},       // eventId -> { id, from, day, seenOpen, answered, resolved }
      gateFired: {},

      lastDay: null,
      lastDrainDay: null,

      /* ---- the book, reconstructed from the state stream alone ---- */
      seenRoadmap: {},       // featureId -> last seen status
      roadmapSig: '',        // order + membership, for "the plan did not move"
      lastRoadmapChangeDay: 0,
      committedOrder: [],    // featureIds in commit order
      committedAt: {},       // featureId -> day committed
      droppedAt: {},         // featureId -> day dropped
      shippedSeen: {},       // featureId -> day shipped
      shippedOrder: [],

      readings: {},          // featureId -> [ {iid, value, day} ]
      readingCount: 0,
      instrumentUse: {},     // instrumentId -> count of runs started
      startedKeys: {},       // featureId|instrumentId -> day started
      seenDone: 0,
      lastResearchDay: 0,    // day something was running or landed
      idleRun: 0,            // consecutive days with a free research slot
      disagreements: {},     // featureId -> { day, a, av, b, bv }

      slips: {},             // featureId -> { day, from, to }
      lastSlipDay: 0,
      lastSlipFeature: null,
      revised: {},           // featureId -> last seen revisedEstimate

      trustPrev: {},
      customerSignals: []    // scripted CUSTOMER events, for the follow-up trigger
    };
  }

  /* --------------------------------------------------------------- emitting */

  function stamp(state) {
    var day = (state && typeof state.day === 'number') ? state.day : 0;
    var week = (state && typeof state.week === 'number')
      ? state.week
      : Math.floor((Math.max(1, day) - 1) / 5) + 1;
    var t = (state && typeof state.t === 'string' && state.t)
      ? state.t
      : ('W' + week + ' D' + (((Math.max(1, day) - 1) % 5) + 1));
    return { day: day, week: week, t: t };
  }

  function emit(from, text, tone, state, extra) {
    var st = stamp(state);
    var msg = {
      day: st.day, week: st.week, t: st.t,
      from: from,
      name: S.names[from] || DEFAULT_NAMES[from] || from,
      text: text,
      tone: tone || 'neutral',
      needsReply: false
    };
    if (extra) { for (var k in extra) if (has(extra, k)) msg[k] = extra[k]; }
    S.feed.push(msg);
    S.emitCount++;
    if (typeof S.onMessage === 'function') {
      try { S.onMessage(msg); } catch (e) { /* a broken listener must not kill the org */ }
    }
    return msg;
  }

  // Deterministic phrasing: stable per (company, trigger), shifted by how much
  // has already been said this quarter. Reproducible; never random.
  function pick(id, variants) {
    var i = (hashStr(S.coId + '|' + id) + S.emitCount) % variants.length;
    return variants[i];
  }

  /**
   * Queue a reactive message. Returns true if this trigger fired now.
   * Text renders at DETECTION time — the numbers are the numbers of the moment
   * it happened — but the message is stamped with the day it actually goes out.
   * Time-critical items carry expiresDay and are dropped rather than surfaced
   * stale: nobody sends "you have shipped nothing by week six" in week nine.
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
      prio: (opts && opts.urgent) ? 0 : (PRIORITY[from] || 9),
      seq: S.seq++,
      queuedDay: (opts && opts.day) || 0,
      expiresDay: (opts && opts.expiresDay != null) ? opts.expiresDay : null
    });
    return true;
  }

  // At most ONE reactive message per tick. CEO > ENG > SALES > SUPPORT >
  // DESIGN > CUSTOMER, ties broken by the order they were detected.
  function drain(state) {
    if (!S.queue.length) return null;
    var live = [], i, c;
    for (i = 0; i < S.queue.length; i++) {
      c = S.queue[i];
      if (c.expiresDay != null && state.day > c.expiresDay) continue;   // stale, drop it
      live.push(c);
    }
    S.queue = live;
    if (!S.queue.length) return null;
    S.queue.sort(function (a, b) { return (a.prio - b.prio) || (a.seq - b.seq); });
    c = S.queue.shift();
    return emit(c.from, c.text, c.tone, state, {
      kind: 'reactive', trigger: c.id, queuedDay: c.queuedDay,
      name: c.name || S.names[c.from] || DEFAULT_NAMES[c.from] || c.from
    });
  }

  /* ------------------------------------------------------------- lookups */

  function featureName(id) {
    var f = S.features[id];
    return (f && f.name) ? f.name : String(id || 'that feature');
  }

  function featureTags(id) {
    var f = S.features[id];
    return (f && Array.isArray(f.tags)) ? f.tags : [];
  }

  function hasTag(id, tag) {
    var t = featureTags(id), i;
    for (i = 0; i < t.length; i++) if (t[i] === tag) return true;
    return false;
  }

  function instrumentName(id) {
    var list = arr(S.co && S.co.instruments), i;
    for (i = 0; i < list.length; i++) if (list[i] && list[i].id === id) return list[i].name || id;
    return String(id || 'that instrument');
  }

  function family(iid) { return INSTRUMENT_FAMILY[iid] || ('own:' + iid); }

  function estimateFor(id) {
    if (typeof S.revised[id] === 'number') return S.revised[id];
    var f = S.features[id];
    return (f && typeof f.estCost === 'number') ? f.estCost : 0;
  }

  function readingsFor(id) { return S.readings[id] || []; }

  // Who publicly champions this feature, by their own declared `favors` list,
  // falling back to the `pitchedBy` string printed on the card. Public data.
  function championsOf(fid) {
    var out = [], i, sh;
    for (i = 0; i < S.stakeholders.length; i++) {
      sh = S.stakeholders[i];
      if (arr(sh.favors).indexOf(fid) >= 0) out.push(sh);
    }
    if (!out.length) {
      var f = S.features[fid];
      var pitched = (f && typeof f.pitchedBy === 'string') ? f.pitchedBy.toLowerCase() : '';
      if (pitched && pitched !== 'you') {
        for (i = 0; i < S.stakeholders.length; i++) {
          sh = S.stakeholders[i];
          var first = String(sh.name || '').split(/\s+/)[0].toLowerCase();
          if (first && pitched.indexOf(first) >= 0) { out.push(sh); break; }
        }
      }
    }
    return out;
  }

  function voiceForStakeholder(sh) {
    var role = String((sh && sh.role) || '').toLowerCase();
    var id = String((sh && sh.id) || '').toLowerCase();
    var s = role + ' ' + id;
    if (/\bceo\b|chief exec|founder/.test(s)) return 'CEO';
    if (/sales|revenue|commercial|account exec/.test(s)) return 'SALES';
    if (/eng|cto|technical|platform/.test(s)) return 'ENG';
    if (/design|ux|brand/.test(s)) return 'DESIGN';
    if (/support|success|service/.test(s)) return 'SUPPORT';
    return 'SUPPORT';
  }

  /* ------------------------------------------------------------ bookkeeping
   * Everything the triggers need is derived here, from the state stream alone.
   * Product is never asked for anything it does not already publish, and is
   * never asked to change shape to accommodate the feed.
   * -------------------------------------------------------------------- */

  function updateBook(state) {
    var ev = {
      commits: [],      // featureIds newly on the roadmap
      drops: [],        // featureIds newly dropped or removed
      ships: [],        // featureIds newly shipped
      newReadings: [],  // {fid, iid, value}
      newStudies: [],   // {fid, iid} research just started
      newSlips: []      // {fid, from, to}
    };

    var day = state.day || 0;
    var roadmap = arr(state.roadmap);
    var i, e, fid, st;

    /* ---- roadmap: commits, drops, ships, revised estimates --------------- */
    var seenNow = {};
    var sigParts = [];
    for (i = 0; i < roadmap.length; i++) {
      e = roadmap[i];
      fid = fidOf(e);
      if (!fid) continue;
      st = String(e.status || 'queued');
      seenNow[fid] = st;
      sigParts.push(fid + ':' + (st === 'dropped' ? 'dropped' : 'live'));

      if (!has(S.seenRoadmap, fid)) {
        // First time this feature appears on the roadmap at all: that is a commit.
        if (st !== 'dropped') {
          ev.commits.push(fid);
          S.committedOrder.push(fid);
          S.committedAt[fid] = day;
        }
      }
      if (st === 'dropped' && S.seenRoadmap[fid] !== 'dropped' && !has(S.droppedAt, fid)) {
        ev.drops.push(fid);
        S.droppedAt[fid] = day;
      }
      if (typeof e.revisedEstimate === 'number' && isFinite(e.revisedEstimate)) {
        var prevRev = S.revised[fid];
        var base = (S.features[fid] && typeof S.features[fid].estCost === 'number')
          ? S.features[fid].estCost : 0;
        var from = (typeof prevRev === 'number') ? prevRev : base;
        if (e.revisedEstimate > from + 0.001) {
          ev.newSlips.push({ fid: fid, from: from, to: e.revisedEstimate });
          S.slips[fid] = { day: day, from: from, to: e.revisedEstimate };
          S.lastSlipDay = day;
          S.lastSlipFeature = fid;
        }
        S.revised[fid] = e.revisedEstimate;
      }
      S.seenRoadmap[fid] = st;
    }
    // A feature that vanished from the roadmap entirely was also dropped.
    for (fid in S.seenRoadmap) {
      if (!has(S.seenRoadmap, fid)) continue;
      if (!has(seenNow, fid) && !has(S.droppedAt, fid) && !has(S.shippedSeen, fid)) {
        ev.drops.push(fid);
        S.droppedAt[fid] = day;
        S.seenRoadmap[fid] = 'dropped';
      }
    }

    var sig = sigParts.join(',');
    if (sig !== S.roadmapSig) { S.roadmapSig = sig; S.lastRoadmapChangeDay = day; }

    /* ---- shipped ------------------------------------------------------- */
    var shipped = arr(state.shipped);
    for (i = 0; i < shipped.length; i++) {
      fid = idOf(shipped[i]) || fidOf(shipped[i]);
      if (!fid || has(S.shippedSeen, fid)) continue;
      S.shippedSeen[fid] = day;
      S.shippedOrder.push(fid);
      ev.ships.push(fid);
    }

    /* ---- research: starts, readings, idle slots ------------------------- */
    var research = state.research || {};
    var running = arr(research.running);
    var done = arr(research.done);

    function registerStart(f, iid) {
      var key = f + '|' + iid;
      if (has(S.startedKeys, key)) return false;
      S.startedKeys[key] = day;
      S.instrumentUse[iid] = (S.instrumentUse[iid] || 0) + 1;
      ev.newStudies.push({ fid: f, iid: iid });
      return true;
    }

    for (i = 0; i < running.length; i++) {
      var a = running[i], af = fidOf(a), ai = iidOf(a);
      if (af && ai) registerStart(af, ai);
    }

    // done[] is append-only in the spec's state shape; index-walk it.
    while (S.seenDone < done.length) {
      var r = done[S.seenDone++];
      var rf = fidOf(r), ri = iidOf(r), rv = valOf(r);
      if (!rf || !ri) continue;
      registerStart(rf, ri);                 // a study nobody saw running still ran
      if (rv === null) continue;
      if (!S.readings[rf]) S.readings[rf] = [];
      S.readings[rf].push({ iid: ri, value: rv, day: day });
      S.readingCount++;
      ev.newReadings.push({ fid: rf, iid: ri, value: rv });
    }

    if (running.length > 0 || ev.newReadings.length) S.lastResearchDay = day;
    if (running.length < S.researchSlots) S.idleRun++; else S.idleRun = 0;

    /* ---- escalations: did the player answer, or go quiet? ---------------
     * An escalation leaving state.openEvents is ambiguous on its own: product
     * closes an item both when it is answered AND when it has sat unanswered
     * long enough to count as ignored. Reading the disappearance as a reply
     * would have the feed thank the player for silence, which is the exact
     * opposite of the lesson. So: believe an explicit flag if there is one,
     * otherwise decide on the clock — closed early means answered, closed at
     * or past the ignore window means nobody ever replied. */
    var open = {}, oi, oev, oid;
    var openEvents = arr(state.openEvents);
    for (oi = 0; oi < openEvents.length; oi++) {
      oev = openEvents[oi];
      oid = idOf(oev) || (oev && oev.eventId);
      if (!oid) continue;
      open[oid] = true;
      if (S.escalations[oid]) S.escalations[oid].lastFlags = oev;
    }
    // Some builds publish the answered set directly; believe it when present.
    var answered = {};
    var ansList = arr(state.answeredEvents).concat(arr(state.respondedEvents));
    for (oi = 0; oi < ansList.length; oi++) {
      var aid = idOf(ansList[oi]) || (ansList[oi] && ansList[oi].eventId);
      if (aid) answered[aid] = true;
    }
    for (var eid in S.escalations) {
      if (!has(S.escalations, eid)) continue;
      var esc = S.escalations[eid];
      if (esc.resolved) continue;
      if (open[eid]) { esc.seenOpen = true; continue; }
      // Never appeared in openEvents at all: product does not publish them, so
      // there is nothing to infer. The chase below still works off our clock.
      if (!esc.seenOpen && !answered[eid] && !esc.noted) continue;
      var flags = esc.lastFlags || {};
      var reallyAnswered =
        !!answered[eid] || !!esc.noted || flags.answered === true ||
        (flags.ignored !== true && (day - esc.day) < IGNORE_WINDOW);
      esc.resolved = true;
      esc.answered = reallyAnswered;
      if (reallyAnswered) esc.answeredDay = day;
    }

    S.trustPrev = state.trust || S.trustPrev;
    return ev;
  }

  /* ============================================================== TRIGGERS
   * Each block names what it detects and the lesson it exists to teach. All of
   * them reason about the player's own actions and the player's own readings.
   * None of them knows anything the player could not know.
   * ====================================================================== */

  function evaluate(state, ev) {
    var day = state.day || 0;
    var week = state.week || (Math.floor(Math.max(0, day - 1) / 5) + 1);
    var i, j, fid;

    /* ---- 1. COMMITTED WITH ZERO RESEARCH ------------------------------ ENG
     * Lesson: you are building on a hunch. Sometimes the hunch is right, and
     * nobody — including you — can tell which times in advance. */
    for (i = 0; i < ev.commits.length; i++) {
      fid = ev.commits[i];
      if (readingsFor(fid).length === 0 && !has(S.startedKeys, fid + '|')) {
        var anyStudy = false;
        for (var k in S.startedKeys) {
          if (has(S.startedKeys, k) && k.indexOf(fid + '|') === 0) { anyStudy = true; break; }
        }
        if (!anyStudy) {
          trig('commit_no_research', 'ENG', 'warn', [
            'You put {feature} on my board and there is not one measurement against it. I will build it. I would like it on the record that the only evidence for it is that you believe it.',
            '{feature}, {est}, zero research. That is fine, people do it every quarter. Just do not come back in week nine and ask me why it did not move the number.',
            'No readings on {feature} and it is committed. My team does not mind building on a hunch. We mind rebuilding on one.',
            'Committed {feature} cold. Sometimes the hunch is right — I have never been able to tell which times in advance, and I have never met anyone who could.'
          ], { feature: featureName(fid), est: ew(estimateFor(fid)) }, { day: day });
          break;
        }
      }
    }

    /* ---- 2. TWO COMMITS SOURCED ONLY FROM SALES -------------------- SUPPORT
     * Lesson: one channel, one bias. Every story Dan tells is true. The set of
     * stories he tells is not the set of users you have. */
    var salesOnly = 0, salesOnlyNames = [];
    for (i = 0; i < S.committedOrder.length; i++) {
      fid = S.committedOrder[i];
      var rs = readingsFor(fid);
      if (!rs.length) continue;
      var allSales = true;
      for (j = 0; j < rs.length; j++) if (rs[j].iid !== 'sales_anecdote') { allSales = false; break; }
      if (allSales) { salesOnly++; salesOnlyNames.push(featureName(fid)); }
    }
    if (salesOnly >= 2) {
      trig('sales_only', 'SUPPORT', 'warn', [
        '{n} commitments now where the only number came from a conversation with Dan. Dan talks to people still deciding whether to buy. I talk to people who already did. Neither of us has ever met anyone who left.',
        'Noticing that {list} rest entirely on sales anecdotes. I am not saying he is wrong. I am saying he has one sample and it is the loudest one in the building.',
        'You are running this quarter off one channel. Every deal Dan describes is real. The set of deals he describes is not the set of users we have.',
        'Second commit sourced only from sales. Ask me for tickets if you want a second opinion — and then remember mine is wrong in its own direction. Nobody who bounced in week one ever filed one.'
      ], { n: salesOnly, list: listWords(salesOnlyNames) }, { day: day });
    }

    /* ---- 3. NO REVEALED-PREFERENCE EVIDENCE BY WEEK 8 ----------------- CEO
     * Lesson: everything else on the board is what people SAID. A fake door or
     * an A/B is the only place in this sim where somebody did something. */
    if (week >= 8) {
      var revealedUsed = false;
      for (var iid in S.instrumentUse) {
        if (has(S.instrumentUse, iid) && REVEALED_PREFERENCE[iid]) { revealedUsed = true; break; }
      }
      if (!revealedUsed) {
        trig('no_revealed_pref', 'CEO', 'pressure', [
          'Week {week}. You have surveys, you have interviews, you have Dan. Not one thing on that list is a person doing something. Show me behaviour.',
          'Eight weeks in, no fake door, no A/B, nothing where somebody clicked instead of said. I have been sold a lot of survey data in my career and I have never once been able to spend it.',
          'Everything on your board is what people told you. What did anybody actually do? If the answer is that we never looked, say it now and not at the QBR.',
          'No revealed-preference evidence at all this quarter. People will tell you they want the beautiful thing and then use the boring one twice a day. Ask me how I know.'
        ], { week: week }, { day: day, expiresDay: 9 * 5 });
      }
    }

    /* ---- 4. THREE QUEUED, NOTHING SHIPPED, WEEK 6 --------------------- ENG
     * Lesson: half-built is worth exactly what never-started is worth, and you
     * are about to have three of them. */
    if (week >= 6) {
      var openCount = 0;
      for (fid in S.seenRoadmap) {
        if (!has(S.seenRoadmap, fid)) continue;
        var st = S.seenRoadmap[fid];
        if (st !== 'dropped' && st !== 'shipped') openCount++;
      }
      if (openCount >= 3 && S.shippedOrder.length === 0) {
        trig('nothing_shipped_w6', 'ENG', 'alarm', [
          '{n} things open, half the quarter gone, nothing out the door. To be precise about what that means: this team has currently produced zero. Not a little. Zero.',
          'Week {week}, {n} features in flight, none shipped. Half-built is worth the same as never started, and right now we have {n} of them.',
          'Six weeks in and I cannot point at one thing and say we finished it. Pick one and I will get it out. Keep all {n} and I will hand you three-quarters of {n} things in December.',
          'Nothing has shipped. {n} open. I would rather cut two today and be sure of one than keep everything and be sure of nothing.'
        ], { n: openCount, week: week }, { day: day, expiresDay: 7 * 5 });
      }
    }

    /* ---- 5. A SLIP, AND THE PLAN DID NOT MOVE ------------------------- ENG
     * Lesson: a slip is not news, it is a decision point. Absorbing it silently
     * is a decision too — it is the decision that the calendar picks the loser. */
    if (S.lastSlipDay > 0 && (day - S.lastSlipDay) >= 5 &&
        S.lastRoadmapChangeDay <= S.lastSlipDay) {
      var sf = S.lastSlipFeature;
      var sl = S.slips[sf] || { from: 0, to: 0 };
      trig('slip_ignored', 'ENG', 'warn', [
        '{feature} went from {from} to {to} five days ago and the plan has not moved a millimetre. A slip is a decision point. What is the decision?',
        'I told you {feature} was {to}, not {from}. That was five days back. Everything else is still on the board, so I assume you are absorbing {extra} out of thin air.',
        'Five days since the revised estimate on {feature} and nothing changed. Either something comes off or something does not finish. I am fine with either. I am not fine with neither.',
        '{feature} is {extra} heavier than we planned and the roadmap is identical to the one you wrote before you knew that. One of those two facts has to give.'
      ], {
        feature: featureName(sf), from: ew(sl.from), to: ew(sl.to),
        extra: ew(Math.max(0, sl.to - sl.from))
      }, { day: day });
    }

    /* ---- 6. COMMITTED MORE THAN REMAINS ------------------------------- ENG
     * Lesson: the arithmetic does not care about your plan. Runway is the
     * smaller of the budget left and the weeks left times the team — a quarter
     * cannot be spent faster than it elapses. */
    var committedRemaining = 0;
    for (fid in S.seenRoadmap) {
      if (!has(S.seenRoadmap, fid)) continue;
      var s2 = S.seenRoadmap[fid];
      if (s2 === 'dropped' || s2 === 'shipped') continue;
      var spent = 0, rm = arr(state.roadmap);
      for (i = 0; i < rm.length; i++) {
        if (fidOf(rm[i]) === fid && typeof rm[i].engWeeksSpent === 'number') spent = rm[i].engWeeksSpent;
      }
      committedRemaining += Math.max(0, estimateFor(fid) - spent);
    }
    var weeksLeft = Math.max(0, S.totalWeeks - week + 1);
    var capLeft = (typeof state.capacityLeft === 'number') ? state.capacityLeft : weeksLeft * S.engWeeksPerWeek;
    var runway = Math.min(capLeft, weeksLeft * S.engWeeksPerWeek);
    if (committedRemaining > runway + 0.5 && committedRemaining > 0) {
      trig('over_capacity', 'ENG', 'warn', [
        'Committed work is {committed}. What is left of the quarter is {runway}. The arithmetic does not care how much you want all of it — {over} of that is not going to exist.',
        'You have {committed} on the board against {runway} of capacity. I can build in whatever order you like. I cannot build past the end of the quarter.',
        '{over} over. I want to say that plainly once, now, rather than as an apology in week eleven.',
        'The plan is {committed}. The team is {runway}. Something on this list ends as a half-finished branch nobody merges, and right now you are letting the calendar pick which one.'
      ], {
        committed: ew(committedRemaining), runway: ew(runway),
        over: ew(committedRemaining - runway)
      }, { day: day });
    }

    /* ---- 7. DROPPED SOMETHING SOMEBODY CHAMPIONED ---------- that stakeholder
     * Lesson: saying no has a price, it is paid to a specific person, and the
     * only version of this job where it does not is the one where you never
     * decide anything. */
    for (i = 0; i < ev.drops.length; i++) {
      fid = ev.drops[i];
      var champs = championsOf(fid);
      if (!champs.length) continue;
      var champ = champs[0];
      var voice = S.voiceOf[champ.id] || voiceForStakeholder(champ);
      trig('dropped_champion', voice, 'pressure',
        DROPPED_LINES[voice] || DROPPED_LINES.DEFAULT,
        { feature: featureName(fid) }, { day: day, name: champ.name });
      break;
    }

    /* ---- 8. RESEARCH ON A DECISION ALREADY MADE ------------------- DESIGN
     * Lesson: if the reading cannot change the decision, it is not research, it
     * is a rationale. A/B is exempt — it is only legal after shipping, which is
     * the whole cruel joke about the cleanest instrument you own. */
    for (i = 0; i < ev.newStudies.length; i++) {
      var stu = ev.newStudies[i];
      if (stu.iid === 'ab_test') continue;
      var decided = (has(S.committedAt, stu.fid) && S.committedAt[stu.fid] < day) ||
                    has(S.shippedSeen, stu.fid) || has(S.droppedAt, stu.fid);
      if (!decided) continue;
      trig('research_after_decision', 'DESIGN', 'neutral', [
        'You are running {instrument} on {feature} and {feature} is already decided. What would that reading have to say for you to take it back off?',
        'Research on something already committed is a lovely thing to do and it is not research, it is a rationale. If the answer cannot change the decision, we are building a slide.',
        '{feature} is settled and now we are measuring it. I have done this. It feels like diligence right up until the number disagrees and you find a reason it is wrong.',
        'Genuine question, no edge to it: is {instrument} on {feature} going to change anything, or is it for the deck?'
      ], { feature: featureName(stu.fid), instrument: instrumentName(stu.iid) }, { day: day });
      break;
    }

    /* ---- 9. SOMEBODY'S TRUST HIT THE FLOOR ---------------------------- CEO
     * Lesson: when a person stops arguing with you and starts arguing about
     * you, you have an organisational problem, and no roadmap fixes it. */
    var trust = state.trust || {};
    for (var tid in trust) {
      if (!has(trust, tid)) continue;
      if (typeof trust[tid] !== 'number' || trust[tid] >= 35) continue;
      var who = tid, shx;
      for (i = 0; i < S.stakeholders.length; i++) {
        shx = S.stakeholders[i];
        if (shx.id === tid) { who = shx.name || tid; break; }
      }
      trig('trust_floor', 'CEO', 'alarm', [
        '{who} came to me. I am not going to relay the conversation. I will say that when somebody stops arguing with you and starts arguing about you, you have an organisational problem and not a roadmap problem.',
        'Your standing with {who} is on the floor. I do not need everyone to like you. I do need them to keep bringing you things, and this is the point where they stop.',
        'Two people have mentioned {who} to me this week. Go and fix it directly, today, in person. Not with a document.',
        '{who} is at {level} with you and it is week {week}. You have eight weeks of needing that person left. Spend an hour on it now or a month on it later.'
      ], { who: who, level: Math.round(trust[tid]), week: week }, { day: day });
      break;
    }

    /* ---- 10. SHIPPED SOMETHING NO INSTRUMENT SUPPORTED ---------------- CEO
     * Lesson: on what basis? Judgement is a perfectly good answer. A number
     * invented after the fact is not. */
    for (i = 0; i < ev.ships.length; i++) {
      fid = ev.ships[i];
      var rr = readingsFor(fid), supported = false;
      for (j = 0; j < rr.length; j++) if (rr[j].value > SUPPORT_THRESHOLD) { supported = true; break; }
      if (supported) continue;
      // Two different failures wearing the same face: shipping with nothing
      // measured at all, and shipping over the top of readings that all came
      // back small. They deserve different sentences.
      trig('shipped_unsupported', 'CEO', 'pressure', rr.length ? [
        '{feature} went out. All {n} readings we have on it came back small, and we shipped it anyway. Walk me through the part I am missing, because from here it looks like we measured, disliked the answer, and proceeded.',
        'We shipped {feature}. The evidence we collected on it said not much, {n} times. Either the instruments are wrong, in which case say so, or the decision was made somewhere the evidence could not reach it.',
        '{feature} is live and every number we have on it was underwhelming. I am not against overruling the data. I am against overruling it silently.'
      ] : [
        'We shipped {feature}. I went looking for the evidence behind it and there is not any. Tell me the reasoning, because the honest version of the story right now is that we built it because we could.',
        '{feature} is live. On what basis? I am asking sincerely — if the basis is judgement, say judgement and I will take it. What I will not take is a number invented afterwards.',
        'Shipped {feature} with nothing measured behind it. When it works I will not know why, and when it does not I will not know why either. That is the expensive part.',
        '{feature} shipped and not one instrument was ever pointed at it. That may still turn out well. It will not have been a decision, though, and I cannot repeat it.'
      ], { feature: featureName(fid), n: rr.length }, { day: day });
      break;
    }

    /* ---- 11. TWO INSTRUMENTS DISAGREE AND NOBODY WENT BACK ------- SUPPORT
     * Lesson: triangulate. A gap that size is the most interesting fact on the
     * board and it will not resolve itself by being ignored. */
    for (fid in S.readings) {
      if (!has(S.readings, fid)) continue;
      var list = S.readings[fid];
      if (list.length !== 2) { delete S.disagreements[fid]; continue; }
      var gap = Math.abs(list[0].value - list[1].value);
      if (gap <= 3) { delete S.disagreements[fid]; continue; }
      if (!S.disagreements[fid]) { S.disagreements[fid] = { day: day }; continue; }
      if (day - S.disagreements[fid].day < 3) continue;
      // three days standing, still only two readings, nothing running on it
      var runningOnIt = false, rl = arr((state.research || {}).running);
      for (i = 0; i < rl.length; i++) if (fidOf(rl[i]) === fid) { runningOnIt = true; break; }
      if (runningOnIt) continue;
      var hi = list[0].value >= list[1].value ? list[0] : list[1];
      var lo = list[0].value >= list[1].value ? list[1] : list[0];
      trig('disagreement_unresolved', 'SUPPORT', 'warn', [
        '{a} reads {feature} at {av}. {b} reads it at {bv}. That is {gap} points of daylight and nobody has gone and asked a third way. One of those is wrong and it will not volunteer which.',
        'Two readings on {feature}, {gap} points apart, and there they sit. When my numbers disagree with Dan’s it is usually because we are looking at two different sets of people. Worth finding out which set matters here.',
        'You have {a} at {av} and {b} at {bv} on {feature}. That gap is the most interesting thing on your board and it has been sitting there untouched.',
        '{feature}: {av} from one instrument, {bv} from another. Averaging those two numbers would be the worst thing you could do with them. Go get a third.'
      ], {
        feature: featureName(fid),
        a: instrumentName(hi.iid), av: signed(hi.value),
        b: instrumentName(lo.iid), bv: signed(lo.value),
        gap: num(gap)
      }, { day: day });
      break;
    }

    /* ---- 12. TEN DAYS WITH NOTHING MEASURED --------------------------- CEO
     * Lesson: you are flying blind and calling it conviction. */
    if (day - S.lastResearchDay >= 10) {
      trig('research_drought', 'CEO', 'pressure', [
        '{days} working days without a single piece of research running. I do not mind you moving fast. I mind you moving fast with your eyes shut and calling it conviction.',
        'Nothing has been measured in {days} days. What changed — did we start knowing things?',
        'No research running, none landed, {days} days. You are flying on instruments you switched off.',
        '{days} days of pure opinion. Mine included, and mine is not better than the data just because it is louder.'
      ], { days: day - S.lastResearchDay }, { day: day });
    }

    /* ---- 13. A RESEARCH SLOT SITTING EMPTY ------------------------- DESIGN
     * Lesson: research is cheap and opinions are expensive, and this building
     * is not short of opinions. */
    if (S.idleRun > 5) {
      trig('slot_idle', 'DESIGN', 'neutral', [
        'One of your two research slots has been empty {days} days. Research is cheap and opinions are expensive, and we are not short of opinions.',
        'Second slot idle {days} days now. It costs nothing to have a question running in the background while everyone argues about the roadmap.',
        'You have two slots and you are using one. That is a free question you are choosing not to ask.',
        'Not a criticism, just a thing I noticed: {days} days of a slot doing nothing. Even a bad question running is better than a confident silence.'
      ], { days: S.idleRun }, { day: day });
    }

    /* ---- 14. NEVER RAN TWO INSTRUMENTS THAT FAIL DIFFERENTLY ----- SUPPORT
     * EXTRA. Lesson: two instruments that lie in the same direction are one
     * instrument. Triangulation is not "more data", it is data that disagrees
     * by construction, which is the only kind that can catch you. */
    if (week >= 7 && S.readingCount >= 3) {
      var crossed = false;
      for (fid in S.readings) {
        if (!has(S.readings, fid)) continue;
        var fams = {}, rl2 = S.readings[fid];
        for (i = 0; i < rl2.length; i++) fams[family(rl2[i].iid)] = 1;
        var n = 0; for (var fk in fams) if (has(fams, fk)) n++;
        if (n >= 2) { crossed = true; break; }
      }
      if (!crossed) {
        trig('no_opposing_instruments', 'SUPPORT', 'warn', [
          'Week {week} and nothing on this board has been looked at two different ways. Everything you have measured, you measured with instruments that fail in the same direction. Two of those is still one.',
          'Every reading you have taken comes from the same kind of source. Mine included. Tickets come from people who stayed — ask only me and the analytics and you get a very confident, very consistent picture of the users you did not lose.',
          'Nobody has run the same question through two instruments that disagree by construction. That is the only way you find out which one is lying to you this quarter.',
          '{n} readings and not one of them contradicts another, because you never gave them the chance. Agreement between two instruments that share a blind spot is not confirmation. It is the blind spot.'
        ], { week: week, n: S.readingCount }, { day: day, expiresDay: 10 * 5 });
      }
    }

    /* ---- 15. FOUND OUT YOU WERE LATE, ADDED SCOPE --------------------- ENG
     * EXTRA. Lesson: the answer to a late plan is never more plan. This is the
     * single most reliable way to end a quarter holding nothing. */
    if (S.lastSlipDay > 0 && ev.commits.length) {
      var gapDays = day - S.lastSlipDay;
      if (gapDays >= 0 && gapDays <= 7) {
        trig('slip_add_scope', 'ENG', 'warn', [
          '{slipped} slipped and your response was to commit {added}. I want to be respectful about this: that is the single most reliable way to end a quarter with nothing.',
          'We are late on {slipped}, so you added {added}. Adding work to a late plan is the moment the plan stops being a plan.',
          'New commitment, {added}, {days} days after {slipped} came in over. I will build what you tell me to build. I would just like somebody to say out loud that the arithmetic went the wrong way.',
          '{slipped} got heavier and the board got longer. Those two things happened in the same week and one of them was a choice.'
        ], {
          slipped: featureName(S.lastSlipFeature),
          added: featureName(ev.commits[0]),
          days: gapDays
        }, { day: day });
      }
    }

    /* ---- 16. A CUSTOMER SAID SOMETHING AND NOTHING MOVED --------- CUSTOMER
     * EXTRA. Lesson: the clearest signal in this sim arrives unlabelled, from
     * one person, in a sentence nobody asked for. It may be the most useful
     * thing you hear all quarter or a sample of one. Silence answers neither. */
    for (i = 0; i < S.customerSignals.length; i++) {
      var cs = S.customerSignals[i];
      if (cs.followed) continue;
      if (day - cs.day < 10) continue;
      cs.followed = true;
      var movedSince = (S.lastRoadmapChangeDay > cs.day);
      var studiedSince = false;
      for (var sk in S.startedKeys) {
        if (has(S.startedKeys, sk) && S.startedKeys[sk] > cs.day) { studiedSince = true; break; }
      }
      if (movedSince || studiedSince) continue;
      trig('customer_signal_ignored', 'CUSTOMER', 'neutral', [
        'Following up on what I said a couple of weeks ago. Is that something you are looking at, or was it just a nice chat? Genuinely fine either way, I would rather know.',
        'Checking in. Nothing has changed on our side and I have not heard anything from yours. Four of my six analysts still never made it past the empty state.',
        'I gave you the honest version {days} days ago and nothing has moved since. I do not need it fixed. I would like to know whether it was heard.',
        'No pressure at all — I know I am one customer and you have a hundred. I just noticed that the thing I told you was our biggest problem has not come up again.'
      ], { days: day - cs.day }, { day: day, name: cs.name, expiresDay: day + 10 });
      break;
    }

    /* ---- 17. NO ENTERPRISE WORK, AND THE DEAL DIED -------------------- SALES
     * EXTRA. Lesson: a correct no still has a price, and the price is real, and
     * somebody specific pays it. Dan does not become wrong because you were
     * right. This message should sting even when the decision was good. */
    if (week >= 7) {
      var danish = null, anyCommitted = false;
      for (i = 0; i < S.stakeholders.length; i++) {
        if ((S.voiceOf[S.stakeholders[i].id] || voiceForStakeholder(S.stakeholders[i])) === 'SALES') {
          danish = S.stakeholders[i]; break;
        }
      }
      if (danish) {
        var fav = arr(danish.favors);
        for (i = 0; i < fav.length; i++) {
          if (has(S.committedAt, fav[i]) && !has(S.droppedAt, fav[i])) { anyCommitted = true; break; }
        }
        if (fav.length && !anyCommitted) {
          trig('deal_lost', 'SALES', 'warn', [
            'It closed with somebody else this morning. I am not writing this to guilt you. I am writing it because I told you it was real and it was real, and I would rather you hear it from me than from Marguerite at the QBR.',
            'We lost it. Enterprise has been off your board all quarter and I stopped asking, which is on me as much as you. Next time tell me no in week one and I will plan around it.',
            'Nothing I asked for is committed and the pipeline knows. I am not going to fight you again this quarter. I would like ten minutes in January before you write the next one.',
            'You made a call and the call had a price, and today was the price. For what it is worth I still think you might have been right. That is not the same as it not costing anything.'
          ], {}, { day: day, name: danish.name, expiresDay: 9 * 5 });
        }
      }
    }

    /* ---- 18. EVERYTHING COMMITTED IS SOMETHING YOU CAN SCREENSHOT -- DESIGN
     * EXTRA. Lesson: your loudest advocate is not your best evidence — and the
     * good ones will tell you that about themselves. Kofi is arguing against
     * his own interest here, which is exactly what makes him worth listening to. */
    var flashy = 0, plumbing = 0;
    for (i = 0; i < S.committedOrder.length; i++) {
      fid = S.committedOrder[i];
      if (has(S.droppedAt, fid)) continue;
      if (hasTag(fid, 'flashy')) flashy++;
      if (hasTag(fid, 'onboarding') || hasTag(fid, 'fix') || hasTag(fid, 'infra')) plumbing++;
    }
    if (flashy >= 2 && plumbing === 0) {
      trig('polish_over_plumbing', 'DESIGN', 'neutral', [
        'You have said yes to {n} of the visible things and no to everything invisible. I pitched some of those, so this is awkward for me to say: I am the least reliable person in this company on whether they matter.',
        'Everything committed is something you can screenshot. I like screenshots. I have also watched a beautifully themed product lose to an ugly one that let you finish the job.',
        '{n} committed features and all of them are surface. Ask Rina what she would build. She will be boring and she will probably be right.',
        'I notice you have agreed with me {n} times and with engineering never. That is flattering and I do not entirely trust it.'
      ], { n: flashy }, { day: day });
    }

    /* ---- 19. PLENTY MEASURED, NOTHING DELIVERED ----------------------- CEO
     * EXTRA. Lesson: knowing is not the job. Knowing early enough to act is the
     * job, and research that outlives its decision window was a hobby. */
    if (week >= 8 && S.readingCount >= 5 && S.shippedOrder.length === 0) {
      trig('research_no_ship', 'CEO', 'pressure', [
        '{n} readings and nothing shipped, in week {week}. At some point the research becomes the work, and that point was about a fortnight ago.',
        'You have measured a great deal and delivered nothing. I will take one shipped thing you were sixty percent sure about over four things you are still studying.',
        'Week {week}, {n} pieces of research, zero shipped. Knowing is not the job. Knowing early enough to act on it is the job.',
        '{n} readings. Zero features. I did not hire a research function, I hired someone to decide. Decide.'
      ], { n: S.readingCount, week: week }, { day: day, expiresDay: 10 * 5 });
    }

    /* ---- ESCALATIONS: silence, and the answer ------------- the escalator's
     * Lesson: not answering IS an answer, it is simply the one that costs the
     * most and buys the least. And a fast no with a reason buys back more than
     * a slow yes. */
    for (var eid2 in S.escalations) {
      if (!has(S.escalations, eid2)) continue;
      var e2 = S.escalations[eid2];
      if (e2.answered && !e2.acked) {
        e2.acked = true;
        trig('reply_ack:' + eid2, e2.from, 'praise',
          ACK_LINES[e2.from] || ACK_LINES.DEFAULT,
          { days: Math.max(0, (e2.answeredDay || day) - e2.day) },
          { day: day, name: e2.name, expiresDay: day + 4 });
      } else if (!e2.answered && !e2.chased && (day - e2.day) >= IGNORE_WINDOW) {
        e2.chased = true;
        trig('escalation_ignored:' + eid2, e2.from, 'alarm',
          SILENCE_LINES[e2.from] || SILENCE_LINES.DEFAULT,
          { days: day - e2.day },
          { day: day, name: e2.name, expiresDay: day + 6 });
      }
    }
  }

  /* ------------------------------------------- per-voice variant tables ----
   * Trigger 7 and the escalation pair are spoken by whoever is affected, so
   * their phrasings live in per-voice tables rather than one generic set. A
   * dropped feature sounds completely different depending on who you took it
   * from, and flattening that would flatten the whole point of the sim. */

  var DROPPED_LINES = {
    CEO: [
      'You cut {feature}. I asked for that one. I am not going to overrule you today — I would like to watch you be right. You have spent something with me and you should know it.',
      '{feature} is off the board. Fine. Tell me what you are doing instead and why it is bigger, in one sentence, and do not send me a framework.',
      'So {feature} is dead. I have been talked out of things before by people who turned out to be right. Be one of those.'
    ],
    SALES: [
      '{feature} dropped. Alright. I will go and tell the account it is not coming this quarter and I will do it without making it your problem. I would just like you to know it was a real conversation with a real person.',
      'Understood on {feature}. I am not going to argue it again. I will remember it in January when the renewal comes round, and so will they.',
      'You cut {feature}. There is a name and a number attached to that decision. That is all I will say about it.'
    ],
    ENG: [
      '{feature} off the list. Thank you. That was the one thing on the board whose benefit my team could actually measure, but I understand you have other people to keep alive.',
      'Dropping {feature}. Noted. It comes back next quarter twice as expensive, the way this kind of work always does. Not a complaint. A forecast.',
      'Fine, {feature} is cut. I will go and tell the two people who spent last quarter writing the design doc.'
    ],
    DESIGN: [
      '{feature} is gone. I will not pretend I am not disappointed. I will also not pretend I had a number to defend it with, which is the part I keep losing on.',
      'Cutting {feature}. Understood. I do think we are accumulating a product that works and does not feel like anything, and I have never found a way to put that in eng-weeks for you.',
      'You dropped {feature}. Probably the right call. Say it to me directly next time rather than letting me find it on the board.'
    ],
    SUPPORT: [
      '{feature} dropped. Okay. I will keep closing those by hand, which is what I was doing before, so nothing is worse. It is just not better.',
      'Off the board then. I understand. My queue is not a roadmap and I do know that. It is only the thing I can see from here.',
      'You cut {feature}. Noted. I would rather hear it from you than notice it, and I did notice it.'
    ],
    DEFAULT: [
      '{feature} is off the roadmap. Understood. I would rather have been told than have found out.',
      'So we are not doing {feature}. Noted. I will stop bringing it up.',
      'You dropped {feature}. That is your call to make. I would like to know what it lost to.'
    ]
  };

  var SILENCE_LINES = {
    CEO: [
      'I asked you a direct question {days} days ago and got nothing back. I will assume the answer is no, and I will assume you did not want to say it to me.',
      '{days} days. No reply. I would have taken a no. I do not take silence, because silence means I have to guess what you think, and I am worse at that than you are at saying it.',
      'Nothing from you on that. Understand what you have done: you have not avoided the decision, you have handed it to me and I will make it worse.'
    ],
    SALES: [
      'No answer for {days} days. I have to tell the account something today, so I am telling them what I know, which is nothing.',
      '{days} days of nothing. Look — a no is workable. I can sell around a no. I cannot sell around a shrug.',
      'Still waiting. I will stop waiting now and improvise, and you will not like the version I improvise.'
    ],
    ENG: [
      'Asked you {days} days ago, heard nothing. I will make the call myself. You may not like the one I make and you have forfeited the right to mind.',
      'No response in {days} days, so the team has picked a direction. That is how it goes when the question sits.',
      'Silence for {days} days. Fine. Silence is an answer. It is just the most expensive one available.'
    ],
    DEFAULT: [
      'I asked, {days} days ago. Nothing came back. I will take that as the answer and move on.',
      '{days} days without a reply. Not angry. Just going to stop asking.',
      'No answer in {days} days, so I have assumed the worst version and planned around it.'
    ]
  };

  var ACK_LINES = {
    CEO: [
      'Good. I did not agree with all of it and I do not need to. You answered inside a day and you gave me a reason. That is the job.',
      'Thank you. Direct, fast, with an actual argument in it. Do it like that every time and you can say no to me as often as you like.',
      'Right. I still think I am correct, and I am going to let you run it your way. Come back and tell me if it turns.'
    ],
    SALES: [
      'Right. I do not love it but I can work with it — I can go back to them with a reason, which is more than I usually get. Thank you for being quick.',
      'Appreciate the straight answer. Fastest no I have had all year. I will handle the account.',
      'Got it. That is a real answer and I will pass on a real answer. That is all I ever actually needed.'
    ],
    DEFAULT: [
      'Thanks for coming back so quickly. Noted, and I will plan around it.',
      'Got it, appreciate the fast reply.',
      'Clear. Thank you for actually answering.'
    ]
  };

  /* ------------------------------------------------------ scripted + gates */

  function absDay(e) {
    var w = (typeof e.week === 'number') ? e.week : 1;
    var d = (typeof e.day === 'number') ? e.day : 1;
    return (w - 1) * 5 + d;
  }

  function fireScripted(state, out) {
    var i, e, msg;
    for (i = 0; i < S.events.length; i++) {
      if (S.eventFired[i]) continue;
      e = S.events[i];
      if ((state.day || 0) < e.__day) continue;
      S.eventFired[i] = true;
      var from = e.from || 'CEO';
      msg = emit(from, e.text || '', e.tone || 'neutral', state, {
        kind: 'scripted',
        name: e.name || S.names[from] || DEFAULT_NAMES[from] || from,
        eventId: e.id || ('ev' + i)
      });
      if (e.needsReply) {
        msg.needsReply = true;
        S.escalations[msg.eventId] = {
          id: msg.eventId, from: from, name: msg.name,
          day: state.day || 0, seenOpen: false, answered: false, resolved: false
        };
      }
      if (from === 'CUSTOMER') {
        S.customerSignals.push({ day: state.day || 0, name: msg.name, followed: false });
      }
      out.push(msg);
    }
  }

  // Who hands you each gate. The plan and the number belong to the CEO; the
  // ship-or-cut call belongs to the person who has to do the shipping.
  var GATE_VOICE = { roadmap: 'CEO', midqtr: 'CEO', shipcut: 'ENG', qbr: 'CEO' };

  function fireGates(state, out) {
    var i, g, msg;
    for (i = 0; i < Org.GATES.length; i++) {
      g = Org.GATES[i];
      if (S.gateFired[g.id]) continue;
      if ((state.week || 0) < g.week) continue;
      S.gateFired[g.id] = true;
      msg = emit(GATE_VOICE[g.id] || 'CEO', g.prompt, 'pressure', state, {
        kind: 'gate', gate: g.id, title: g.title
      });
      out.push(msg);
    }
  }

  /* ------------------------------------------------------------------- API */

  var Org = {

    // Verbatim from SPEC §4. ui.js renders the modal; Org only owns these.
    GATES: [
      { week: 1,  id: 'roadmap', title: 'Roadmap review',
        prompt: 'Post your quarter plan and priority order to the room in chat.' },
      { week: 6,  id: 'midqtr',  title: 'Mid-quarter review',
        prompt: "Marguerite wants the number, what changed, and what you're cutting." },
      { week: 11, id: 'shipcut', title: 'Ship-or-cut call',
        prompt: "Say what ships, what slips, and who you're about to disappoint." },
      { week: 12, id: 'qbr',     title: 'QBR',
        prompt: 'Paste your QBR into chat and defend the quarter.' }
    ],

    PRIORITY: PRIORITY,

    init: function (opts) {
      opts = opts || {};
      S = freshState();
      var co = opts.co || (typeof window !== 'undefined' ? window.SIM_CO : null) || {};
      S.co = co;
      S.product = opts.product || null;
      S.onMessage = opts.onMessage || null;

      var sc = co.scenario || {};
      S.coId = String(sc.company || co.id || 'co');
      S.totalWeeks = (sc.quarter && sc.quarter.weeks) || 12;
      S.engWeeksPerWeek = (sc.capacity && sc.capacity.engWeeksPerWeek) || 4;

      var R = (S.product && S.product.RULES) || null;
      if (R) {
        if (typeof R.weeks === 'number') S.totalWeeks = R.weeks;
        if (typeof R.engWeeksPerWeek === 'number') S.engWeeksPerWeek = R.engWeeksPerWeek;
        if (typeof R.researchSlots === 'number') S.researchSlots = R.researchSlots;
      }

      var i, f, sh;
      var feats = arr(co.features);
      for (i = 0; i < feats.length; i++) {
        f = feats[i];
        if (f && f.id) S.features[f.id] = f;      // PUBLIC fields only. No reveal(), ever.
      }

      S.stakeholders = arr(co.stakeholders).slice();
      S.names = {};
      for (i = 0; i < S.stakeholders.length; i++) {
        sh = S.stakeholders[i];
        if (!sh || !sh.id) continue;
        var v = voiceForStakeholder(sh);
        S.voiceOf[sh.id] = v;
        if (!S.names[v] && sh.name) S.names[v] = sh.name;
      }
      for (var vk in DEFAULT_NAMES) {
        if (has(DEFAULT_NAMES, vk) && !S.names[vk]) S.names[vk] = DEFAULT_NAMES[vk];
      }
      // A scripted CUSTOMER message carries its own byline; this is the fallback.
      var custEvents = arr(co.events);
      for (i = 0; i < custEvents.length; i++) {
        if (custEvents[i] && custEvents[i].from === 'CUSTOMER' && custEvents[i].name) {
          S.names.CUSTOMER = custEvents[i].name;
          break;
        }
      }

      var evs = arr(co.events).slice();
      for (i = 0; i < evs.length; i++) evs[i].__day = absDay(evs[i]);
      evs.sort(function (a, b) { return a.__day - b.__day; });
      S.events = evs;
      S.eventFired = [];
      for (i = 0; i < evs.length; i++) S.eventFired.push(false);

      return Org;
    },

    /**
     * Called on every Product tick — one working day. Emits, in this order:
     *   every scripted co.events[] item now due, every gate now due, and at
     *   most ONE reactive message. Returns the messages emitted on this call;
     *   ui.js may ignore the return and use the onMessage callback instead.
     */
    tick: function (state) {
      var out = [];
      if (!S || !state) return out;

      fireScripted(state, out);
      fireGates(state, out);

      var ev = updateBook(state);
      if (!state.finished) evaluate(state, ev);

      if (S.lastDrainDay !== state.day) {
        var msg = drain(state);
        if (msg) { S.lastDrainDay = state.day; out.push(msg); }
      }

      S.lastDay = state.day;
      return out;
    },

    getFeed: function () { return S ? S.feed.slice() : []; },

    /* ---- additive helpers. Nothing in the contract depends on these. ---- */

    // How many reactive messages are waiting for a free day.
    pending: function () { return S ? S.queue.length : 0; },

    // ui.js may call this when the player answers an escalation, for builds
    // whose state does not publish openEvents. Product is never required to.
    noteReply: function (eventId) {
      if (!S) return false;
      var e = S.escalations[eventId];
      if (!e || e.resolved) return false;
      e.noted = true;
      return true;
    },

    gateFor: function (week) {
      for (var i = 0; i < Org.GATES.length; i++) if (Org.GATES[i].week === week) return Org.GATES[i];
      return null;
    }
  };

  window.Org = Org;

})();
