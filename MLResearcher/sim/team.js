/* =============================================================================
 * sim/team.js  —  window.Team
 *
 * The people around you. Four voices, two sources of messages (scripted +
 * reactive), three gates. No DOM, no imports, no libraries, no build step.
 * Loaded with a plain <script src> tag from file://.
 *
 * Contract (SPEC §4):
 *   Team.init({ world, lab, onMessage })
 *   Team.tick(state)        // called by ui.js on every Lab tick
 *   Team.getFeed()          // -> [Msg, ...]
 *   Team.GATES              // -> [ {day, hour, id, title, prompt}, ... ]
 *
 * Msg = { day, hour, t:"Wed 11:30", from:"LEAD"|"OPS"|"PEER"|"RIVAL",
 *         name, text, tone:"neutral"|"pressure"|"warn"|"praise"|"alarm" }
 *   plus additive, non-breaking fields ui.js may ignore:
 *     kind: "scripted"|"gate"|"reactive"
 *     trigger:  "<trigger id>"   (reactive only)
 *     queuedAt: <tick when the condition was DETECTED>  (reactive only)
 *     gate:     "<gate id>", title: "..."               (gate only)
 *
 * -----------------------------------------------------------------------------
 * HARD CONSTRAINT — THIS MODULE NEVER READS THE GROUND TRUTH.
 *
 * `world.reveal()` is never called here, `world._t` is never touched, and
 * nothing in this file knows the true effect of anything. Every sentence Yuki,
 * Rasheed, Ana and Halberd say is derived from exactly two things:
 *
 *   (a) what the player has MEASURED  — Lab's own results: observed effect,
 *       sigma, the 95% interval, seeds, scale, steps, cost, and the player's
 *       own stated hypothesis / predicted effect;
 *   (b) what the player has DONE      — launches, kills, pacing, idle slots,
 *       coverage, staggering.
 *
 * The rival's claims come from `world.events[]` — authored, and deliberately
 * sometimes false. A teammate who knew the answer would destroy the exercise:
 * the whole point is that nobody in the room knows, including the lead.
 *
 * -----------------------------------------------------------------------------
 * THE VOICES — hold these consistently.
 *
 *   LEAD   Dr. Yuki Tanaka   Owns the run. Demanding, fair, relentlessly focused
 *                            on whether the evidence supports the SIZE of the
 *                            claim. Her signature move: at what scale did you
 *                            measure that, and why should it hold three orders
 *                            of magnitude away? Terse. Numerate. Never cruel,
 *                            never theatrical.
 *   OPS    Rasheed           Compute allocation. Cold, procedural, faintly
 *                            bureaucratic. States preemptions and quota changes
 *                            as facts. Does not care about your deadline.
 *   PEER   Ana Beltrán       Warm, thinks out loud, genuinely curious, sometimes
 *                            wrong in interesting ways. The human texture.
 *   RIVAL  Team Halberd      Terse internal notes claiming results.
 *                            Institutionally confident, sometimes wrong.
 *
 * -----------------------------------------------------------------------------
 * DETERMINISM. Every trigger carries 3-5 phrasings. The one used is chosen by
 * hash(session key + '|' + trigger id) + number of messages emitted so far,
 * modulo the variant count. Pure function of the session: a replay produces a
 * byte-identical feed, while a different scenario draws different words.
 * There is no Math.random() in this file and there must never be one.
 *
 * -----------------------------------------------------------------------------
 * CLOCKS. Two of them, on purpose.
 *   absolute (day, hour)  — used to decide when a gate or a scripted event is due.
 *   working hours `W`     — (day-1)*hoursPerDay + (hour - startHour). Nights are
 *                           collapsed, so "idle for 3 hours" and "within 2 hours"
 *                           mean three and two hours of the working week, not
 *                           three hours that happened to include a night.
 * ========================================================================== */

(function () {
  'use strict';

  /* ---------------------------------------------------------------- voices */

  var NAMES = {
    LEAD:  'Dr. Yuki Tanaka',
    OPS:   'Rasheed',
    PEER:  'Ana Beltrán',
    RIVAL: 'Team Halberd'
  };

  // Drain order when several reactive messages are waiting: LEAD > OPS > RIVAL > PEER.
  var PRIORITY = { LEAD: 1, OPS: 2, RIVAL: 3, PEER: 4 };

  var DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  var DEFAULT_RULES = {
    computeBudget: 6000,
    slots: 4,
    days: 5,
    hoursPerDay: 10,
    startHour: 9,
    maxInterventions: 4,
    killRefund: 0.5
  };

  /* ------------------------------------------------------------ formatting */

  function pad2(n) { n = Math.floor(n); return (n < 10 ? '0' : '') + n; }

  function num(v, dflt) {
    v = typeof v === 'string' ? parseFloat(v) : v;
    return (typeof v === 'number' && isFinite(v)) ? v : dflt;
  }

  function hhmm(hour) {
    hour = num(hour, 0);
    var h = Math.floor(hour);
    var m = Math.round((hour - h) * 60);
    if (m >= 60) { h += 1; m -= 60; }
    return pad2(h) + ':' + pad2(m);
  }

  function tstamp(day, hour) {
    var d = DAY_NAMES[(Math.max(1, Math.floor(num(day, 1))) - 1) % 7];
    return d + ' ' + hhmm(hour);
  }

  function group(s) {
    var p = String(s).split('.');
    p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return p.join('.');
  }

  // GPU-hours: whole numbers, grouped.
  function gh(n) { return group(String(Math.round(num(n, 0)))); }

  // An effect in metric points always carries its sign. +2.60 / -0.40.
  function eff(n) {
    n = num(n, 0);
    return (n >= 0 ? '+' : '') + n.toFixed(2);
  }

  function n2(n) { return num(n, 0).toFixed(2); }

  function pct(x) { return (isFinite(x) ? Math.round(x * 100) : 0) + '%'; }

  function hrs(x) {
    x = num(x, 0);
    return (Math.abs(x - Math.round(x)) < 0.05) ? String(Math.round(x)) : x.toFixed(1);
  }

  function clip(s, n) {
    s = String(s || '');
    return s.length <= n ? s : s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…';
  }

  function listOf(arr, max) {
    arr = arr || [];
    max = max || 3;
    if (!arr.length) return '';
    if (arr.length <= max) {
      if (arr.length === 1) return String(arr[0]);
      return arr.slice(0, arr.length - 1).join(', ') + ' and ' + arr[arr.length - 1];
    }
    return arr.slice(0, max).join(', ') + ' and ' + (arr.length - max) + ' more';
  }

  // {placeholder} substitution.
  function fill(tpl, data) {
    return String(tpl).replace(/\{(\w+)\}/g, function (whole, k) {
      return (data && data[k] !== undefined && data[k] !== null) ? String(data[k]) : whole;
    });
  }

  // djb2 — small, stable, dependency-free. Used only for deterministic variant choice.
  function hashStr(s) {
    var h = 5381, i;
    s = String(s);
    for (i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return h;
  }

  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  /* ---------------------------------------------------------------- state */

  var S = null;   // session state; rebuilt by Team.init

  function freshState() {
    return {
      world: null, lab: null, onMessage: null, rules: null, key: 'run',

      feed: [],           // every Msg emitted, in order
      queue: [],          // reactive candidates waiting for a free tick
      fired: {},          // trigger id -> true (each trigger fires at most once)
      seq: 0,             // queue tiebreaker
      emitCount: 0,       // drives deterministic phrasing choice

      events: [],         // normalised world.events, sorted
      eventFired: [],
      gateFired: {},

      tickNo: 0,
      lastDrainKey: null, // at most one reactive message per tick
      W: 0,               // working hours elapsed
      day: 1, hour: 9,

      /* ---- scenario shape, read once ---- */
      scales: [],         // [{id,label,params,wallHours,computeHours,sigma}]
      scaleIdx: {},       // scale id -> index
      stepMult: {},       // step id -> multiplier
      stepLabel: {},
      ivIds: [],          // every intervention id
      ivName: {},         // id -> display name
      budget: 6000,
      slots: 4,
      runScale: 7.0e10,

      /* ---- everything below is RECONSTRUCTED from the state stream ---- */
      jobs: {},           // job id -> launch record
      launches: [],       // launch records, in launch order
      resultIds: {},      // job id -> true, once a Result for it has been seen
      resultCount: 0,     // how many entries of state.results have been consumed
      okResults: [],      // ok result records, in arrival order
      prevRunning: {},    // job id -> last observed progress
      pendingVanish: [],  // jobs that left `running` without a Result yet

      iv: {},             // per-intervention coverage, see ivRec()
      cellSeeds: {},      // "ivs@scale/steps/seeds" -> count   (exact duplicates)
      cellPlain: {},      // "ivs@scale/steps"       -> count   (replication, any seeds)
      anyCombo: false,    // has any launch carried >= 2 interventions
      maxScaleIdxLaunched: -1,
      maxScaleIdxDone: -1,

      oneSeed: {},        // iv id -> {W, sigma, obs, jobId}  most recent n=1 reading
      failCarry: {},      // iv id -> {W, jobId, reason, progress}
      idleSinceW: null,
      anyLaunch: false,
      firstResultW: null,
      predN: 0, predOver: 0, predBiasSum: 0,

      rivalClaims: [],    // authored claims lifted from world.events (NEVER truth)
      rivalLive: []       // claims whose note has already been posted
    };
  }

  function ivRec() {
    return {
      launched: 0,        // jobs launched containing this intervention
      scalesLaunched: {},
      results: [],        // ok result records containing it
      soloResults: [],    // ok results where it was the ONLY intervention
      scalesDone: {},
      maxScaleIdxDone: -1
    };
  }

  function iv(id) {
    if (!S.iv[id]) S.iv[id] = ivRec();
    return S.iv[id];
  }

  /* --------------------------------------------------------------- clocks */

  function W(day, hour) {
    var R = S.rules;
    return (num(day, 1) - 1) * R.hoursPerDay + (num(hour, R.startHour) - R.startHour);
  }

  function due(day, hour, gDay, gHour) {
    return (day > gDay) || (day === gDay && hour >= gHour - 1e-9);
  }

  /* --------------------------------------------------------------- emitting */

  function emit(from, text, tone, state, extra) {
    var day = num(state && state.day, S.day);
    var hour = num(state && state.hour, S.hour);
    var msg = {
      day: day,
      hour: hour,
      t: (state && typeof state.t === 'string' && state.t) ? state.t : tstamp(day, hour),
      from: from,
      name: NAMES[from] || from,
      text: text,
      tone: tone || 'neutral'
    };
    if (extra) for (var k in extra) if (has(extra, k)) msg[k] = extra[k];
    S.feed.push(msg);
    S.emitCount++;
    if (typeof S.onMessage === 'function') {
      try { S.onMessage(msg); } catch (e) { /* a broken listener must not kill the team */ }
    }
    return msg;
  }

  // Deterministic phrasing: stable per (session, trigger), shifted by how much
  // has already been said. Reproducible; never random.
  function pick(id, variants) {
    var i = (hashStr(S.key + '|' + id) + S.emitCount) % variants.length;
    return variants[i];
  }

  /**
   * Queue a reactive message. Fires at most once per session.
   * The text is rendered at DETECTION time, so the numbers in it are the numbers
   * of the moment the thing happened — but it is stamped with the time it
   * actually reaches the feed. Time-critical messages carry `expiresW`: if they
   * have not gone out by then they are dropped rather than surfaced stale.
   */
  function trig(id, from, tone, variants, data, opts) {
    if (S.fired[id]) return false;
    S.fired[id] = true;
    S.queue.push({
      id: id,
      from: from,
      tone: tone,
      text: fill(pick(id, variants), data || {}),
      prio: PRIORITY[from] || 9,
      seq: S.seq++,
      queuedAt: S.tickNo,
      expiresW: (opts && opts.expiresW != null) ? opts.expiresW : null
    });
    return true;
  }

  // At most ONE reactive message per tick. LEAD first, then OPS, then RIVAL, then PEER.
  function drain(state) {
    if (!S.queue.length) return null;
    var live = [], i, c;
    for (i = 0; i < S.queue.length; i++) {
      c = S.queue[i];
      if (c.expiresW != null && S.W > c.expiresW) continue;   // stale — drop it, don't say it
      live.push(c);
    }
    S.queue = live;
    if (!S.queue.length) return null;
    S.queue.sort(function (a, b) { return (a.prio - b.prio) || (a.seq - b.seq); });
    c = S.queue.shift();
    return emit(c.from, c.text, c.tone, state, {
      kind: 'reactive', trigger: c.id, queuedAt: c.queuedAt
    });
  }

  /* ------------------------------------------------------------ scenario read */

  function readScenario(world) {
    var i, s, o, sc;

    S.scales = (world && world.scales) ? world.scales.slice() : [];
    for (i = 0; i < S.scales.length; i++) S.scaleIdx[S.scales[i].id] = i;

    var steps = (world && world.stepOptions) ? world.stepOptions : [];
    for (i = 0; i < steps.length; i++) {
      o = steps[i];
      S.stepMult[o.id] = num(o.mult, 1);
      S.stepLabel[o.id] = o.label || o.id;
    }

    var ivs = (world && world.interventions) ? world.interventions : [];
    for (i = 0; i < ivs.length; i++) {
      S.ivIds.push(ivs[i].id);
      S.ivName[ivs[i].id] = ivs[i].name || ivs[i].id;
    }

    sc = (world && world.scenario) || {};
    S.runScale = num(sc.runScale, 7.0e10);
    S.key = String(sc.org || '') + '|' + String(sc.team || '') + '|' +
            String(sc.question || '') + '|' + S.ivIds.join(',');
  }

  function scaleAt(idx) { return S.scales[idx] || { id: '?', label: '?', wallHours: 0, params: 0 }; }
  function scaleLabel(id) {
    var i = S.scaleIdx[id];
    return (i === undefined) ? String(id) : (S.scales[i].label || S.scales[i].id);
  }
  function idxOfScale(id) { var i = S.scaleIdx[id]; return (i === undefined) ? -1 : i; }
  function ivLabel(id) { return S.ivName[id] || String(id); }
  function ivListLabel(ids, max) {
    var out = [], i;
    ids = ids || [];
    for (i = 0; i < ids.length; i++) out.push(ivLabel(ids[i]));
    return listOf(out, max || 3);
  }
  function ivKey(ids) { return (ids || []).slice().sort().join('+'); }

  /* ---------------------------------------------------- scripted events */

  /**
   * world.events[] is authored content. It is normalised liberally because the
   * data file is written by another hand: {day,hour} or {at:{day,hour}}, from /
   * voice, text / message / headline.
   *
   * Rival CLAIMS are lifted from these events and nowhere else. A claim is
   * whatever the author attached to the note — structured (`claims`,
   * `about`, `interventions`) or, failing that, an intervention id or display
   * name mentioned in the prose. The claimed effect is used only when the
   * author supplied a number. Nothing here consults the truth.
   */
  function normEvents(world) {
    var raw = (world && world.events) ? world.events.slice() : [];
    var out = [], i;
    for (i = 0; i < raw.length; i++) {
      var e = raw[i] || {};
      var at = e.at || e;
      var d = num(at.day, num(e.day, 1));
      var h = num(at.hour, num(e.hour, S.rules.startHour));
      out.push({
        day: d, hour: h,
        from: e.from || e.voice || 'PEER',
        name: e.name || null,
        tone: e.tone || 'neutral',
        text: String(e.text || e.message || e.headline || ''),
        raw: e
      });
    }
    out.sort(function (a, b) { return (a.day - b.day) || (a.hour - b.hour); });
    return out;
  }

  function claimIvs(e) {
    var found = {}, list = [], effects = {}, i, c, id;
    var raw = e.raw || {};

    var structured = raw.claims || (raw.claim ? [raw.claim] : null);
    if (structured && structured.length) {
      for (i = 0; i < structured.length; i++) {
        c = structured[i] || {};
        id = c.intervention || c.id;
        if (!id) continue;
        if (!found[id]) { found[id] = 1; list.push(id); }
        if (num(c.effect, null) !== null) effects[id] = num(c.effect, null);
      }
    }
    var about = raw.about || raw.interventions;
    if (about && about.length) {
      for (i = 0; i < about.length; i++) {
        id = about[i];
        if (id && !found[id]) { found[id] = 1; list.push(id); }
      }
    }
    if (!list.length) {
      // Fall back to prose: the note names the thing it is claiming.
      var low = e.text.toLowerCase();
      for (i = 0; i < S.ivIds.length; i++) {
        id = S.ivIds[i];
        var nm = String(S.ivName[id] || '').toLowerCase();
        if (low.indexOf(String(id).toLowerCase()) >= 0 || (nm && low.indexOf(nm) >= 0)) {
          if (!found[id]) { found[id] = 1; list.push(id); }
        }
      }
    }
    return { ivs: list, effects: effects };
  }

  function fireScripted(state, out) {
    var i, e, msg;
    for (i = 0; i < S.events.length; i++) {
      if (S.eventFired[i]) continue;
      e = S.events[i];
      if (!due(S.day, S.hour, e.day, e.hour)) continue;
      S.eventFired[i] = true;
      msg = emit(e.from, e.text, e.tone, state, {
        kind: 'scripted',
        name: e.name || NAMES[e.from] || e.from
      });
      out.push(msg);

      if (e.from === 'RIVAL') {
        var cl = claimIvs(e);
        if (cl.ivs.length) {
          S.rivalLive.push({ W: S.W, day: S.day, hour: S.hour, ivs: cl.ivs, effects: cl.effects });
        }
      }
    }
  }

  function fireGates(state, out) {
    // All three gates are Yuki's. She owns the run; she is the one you answer to.
    var i, g, msg;
    for (i = 0; i < Team.GATES.length; i++) {
      g = Team.GATES[i];
      if (S.gateFired[g.id]) continue;
      if (!due(S.day, S.hour, g.day, g.hour)) continue;
      S.gateFired[g.id] = true;
      msg = emit('LEAD', g.prompt, 'pressure', state, {
        kind: 'gate', gate: g.id, title: g.title
      });
      out.push(msg);
    }
  }

  /* ============================================================ BOOKKEEPING
   * Everything the triggers need, rebuilt from the state stream alone. Lab is
   * never asked for anything it does not already publish, and is never asked
   * for anything it knows and the player does not.
   * ====================================================================== */

  function cellKeys(rec) {
    var base = rec.key + '@' + rec.scale + '/' + rec.steps;
    return { plain: base, exact: base + '/' + rec.seeds };
  }

  function registerLaunch(j, state) {
    if (!j || j.id === undefined || j.id === null || S.jobs[j.id]) return null;

    var ivs = (j.interventions || []).slice();
    var la = j.launchedAt || {};
    var rec = {
      id: j.id,
      ivs: ivs,
      key: ivKey(ivs),
      scale: j.scale,
      scaleIdx: idxOfScale(j.scale),
      steps: j.steps,
      seeds: Math.max(1, Math.round(num(j.seeds, 1))),
      cost: num(j.cost, 0),
      wallHours: num(j.wallHours, 0),
      hypothesis: String(j.hypothesis || ''),
      predicted: num(j.predictedEffect, null),
      ciLow: num(j.ciLow, null),
      ciHigh: num(j.ciHigh, null),
      launchW: (la.day !== undefined) ? W(la.day, la.hour) : S.W,
      launchDay: num(la.day, S.day),
      launchHour: num(la.hour, S.hour),
      progress: num(j.progress, 0)
    };
    var ck = cellKeys(rec);
    rec.cellPlain = ck.plain;
    rec.cellExact = ck.exact;

    S.jobs[rec.id] = rec;
    S.launches.push(rec);
    S.anyLaunch = true;
    if (ivs.length >= 2) S.anyCombo = true;
    if (rec.scaleIdx > S.maxScaleIdxLaunched) S.maxScaleIdxLaunched = rec.scaleIdx;

    var i, r;
    for (i = 0; i < ivs.length; i++) {
      r = iv(ivs[i]);
      r.launched++;
      r.scalesLaunched[rec.scale] = (r.scalesLaunched[rec.scale] || 0) + 1;
    }

    onLaunch(rec, state);

    // Counted AFTER onLaunch so the duplicate check sees the state before this job.
    S.cellSeeds[ck.exact] = (S.cellSeeds[ck.exact] || 0) + 1;
    S.cellPlain[ck.plain] = (S.cellPlain[ck.plain] || 0) + 1;
    if (!S.cellFirst) S.cellFirst = {};
    if (!S.cellFirst[ck.exact]) S.cellFirst[ck.exact] = rec;

    return rec;
  }

  function registerResult(r, state) {
    if (!r || r.id === undefined || r.id === null) return;
    if (S.resultIds[r.id]) return;
    S.resultIds[r.id] = true;

    var rec = S.jobs[r.id] || registerLaunch(r, state);
    if (!rec) return;

    var fa = r.finishedAt || {};
    var res = {
      job: rec,
      id: r.id,
      status: r.status || 'ok',
      failReason: r.failReason || '',
      obs: num(r.observedEffect, null),
      sigma: num(r.sigma, null),
      lo: num(r.ciLow95, null),
      hi: num(r.ciHigh95, null),
      W: (fa.day !== undefined) ? W(fa.day, fa.hour) : S.W,
      day: num(fa.day, S.day),
      hour: num(fa.hour, S.hour)
    };
    rec.result = res;

    if (res.status === 'ok') {
      S.okResults.push(res);
      if (S.firstResultW === null) S.firstResultW = S.W;
      if (rec.scaleIdx > S.maxScaleIdxDone) S.maxScaleIdxDone = rec.scaleIdx;
      var i, ir;
      for (i = 0; i < rec.ivs.length; i++) {
        ir = iv(rec.ivs[i]);
        ir.results.push(res);
        if (rec.ivs.length === 1) ir.soloResults.push(res);
        ir.scalesDone[rec.scale] = (ir.scalesDone[rec.scale] || 0) + 1;
        if (rec.scaleIdx > ir.maxScaleIdxDone) ir.maxScaleIdxDone = rec.scaleIdx;
      }
      // A single-seed reading is a rumour with a timestamp. Remember it.
      if (rec.seeds === 1) {
        for (i = 0; i < rec.ivs.length; i++) {
          S.oneSeed[rec.ivs[i]] = { W: res.W, sigma: res.sigma, obs: res.obs, jobId: rec.id };
        }
      }
      // Calibration ledger — their prediction against their own measurement.
      if (rec.predicted !== null && res.obs !== null) {
        S.predN++;
        S.predBiasSum += (rec.predicted - res.obs);
        if (rec.predicted > res.obs) S.predOver++;
      }
    } else if (res.status === 'failed') {
      var k;
      for (k = 0; k < rec.ivs.length; k++) {
        S.failCarry[rec.ivs[k]] = {
          W: res.W, jobId: rec.id, reason: res.failReason,
          progress: num(r.progress, rec.progress)
        };
      }
    }

    onResult(res, state);
  }

  function updateBook(state) {
    var running = state.running || [];
    var results = state.results || [];
    var curIds = {}, i, j, id;

    // 1. new launches, and live progress on jobs we already know
    for (i = 0; i < running.length; i++) {
      j = running[i];
      if (!j || j.id === undefined || j.id === null) continue;
      curIds[j.id] = true;
      registerLaunch(j, state);
      if (S.jobs[j.id]) S.jobs[j.id].progress = num(j.progress, S.jobs[j.id].progress);
    }

    // 2. new results (this must happen before kill resolution, so a job that
    //    finished on this very tick is not mistaken for a kill)
    for (i = S.resultCount; i < results.length; i++) registerResult(results[i], state);
    S.resultCount = results.length;

    // 3. resolve jobs that vanished from `running` on an EARLIER tick. One tick
    //    of grace, because a completing job may land in results a tick later.
    var stillPending = [];
    for (i = 0; i < S.pendingVanish.length; i++) {
      var v = S.pendingVanish[i];
      if (v.tick === S.tickNo) { stillPending.push(v); continue; }
      if (S.resultIds[v.id]) continue;                 // it completed after all
      onKill(v, state);
    }
    S.pendingVanish = stillPending;

    // 4. detect new vanishes
    for (id in S.prevRunning) {
      if (!has(S.prevRunning, id)) continue;
      if (curIds[id] || S.resultIds[id]) continue;
      S.pendingVanish.push({
        id: id, progress: S.prevRunning[id], tick: S.tickNo, W: S.W
      });
    }
    S.prevRunning = {};
    for (i = 0; i < running.length; i++) {
      j = running[i];
      if (!j || j.id === undefined || j.id === null) continue;
      S.prevRunning[j.id] = num(j.progress, 0);
    }

    // 5. idle allocation. Counted in WORKING hours, and only once the player has
    //    started — an empty cluster at 09:00 Monday is not yet a waste.
    var slotsFree = num(state.slotsFree, S.slots - running.length);
    if (S.anyLaunch && slotsFree > 0) {
      if (S.idleSinceW === null) S.idleSinceW = S.W;
    } else {
      S.idleSinceW = null;
    }
  }

  /* ================================================================ TRIGGERS
   * Each block names the lesson it exists to teach. Spec §4's table first, then
   * the additions. Evaluation order does not decide who speaks first — the
   * priority queue does — so these are grouped by when they can be detected.
   * ====================================================================== */

  /* ---- launch-time triggers ------------------------------------------- */

  function onLaunch(rec, state) {
    var i, id, r, prev;

    /* [SPEC] ≥3 experiments all at the smallest scale ------------------ LEAD
     * Lesson: small-scale-only evidence does not transfer. Cheap experiments are
     * the right place to start and the wrong place to stop; the recipe locks at
     * a size you have never once observed. */
    if (S.launches.length >= 3 && S.maxScaleIdxLaunched === 0) {
      var small = scaleAt(0);
      trig('all_small_scale', 'LEAD', 'pressure', [
        'That is {n} experiments and every one of them at {small}. {small} is {ratio}x smaller than the run. Which of these do you intend to check further up, and with what?',
        'All {n} runs at {small}. Cheap is the right place to start. It is not a place to finish. What is your argument that an effect measured there survives to {run}?',
        '{n} experiments, one scale. You are measuring very precisely at the size nobody is asking about. When does the first expensive number arrive?',
        'Everything so far is {small}. I will ask this now and again on Friday: at what scale did you measure it, and why do you believe it holds three orders of magnitude out?'
      ], {
        n: S.launches.length,
        small: small.label,
        run: fmtParams(S.runScale),
        ratio: gh(S.runScale / Math.max(1, num(small.params, 7e7)))
      });
    }

    /* [SPEC] a 1-seed result acted on within 2h ------------------------ LEAD
     * Lesson: one seed is a rumour, not a result.
     * A follow-up that BUYS SEEDS is the correct response to a single-seed
     * reading, so a re-run with seeds>=2 at the same or a larger scale is
     * explicitly not flagged. What is flagged is building on n=1. */
    for (i = 0; i < rec.ivs.length; i++) {
      id = rec.ivs[i];
      var os = S.oneSeed[id];
      if (!os) continue;
      if (S.W - os.W > 2.0) continue;
      var boughtPrecision = (rec.seeds >= 2 && rec.scaleIdx >= (S.jobs[os.jobId] ? S.jobs[os.jobId].scaleIdx : 0));
      if (boughtPrecision) continue;
      trig('one_seed_acted', 'LEAD', 'pressure', [
        'You just built on {iv} off a single seed. Sigma on that run was {sigma}; the number you read was {obs}. One seed is a rumour. What reading would have stopped you?',
        'n=1 on {iv}, and {mins} minutes later you spent {cost} GPU-hours on the assumption it was real. Seeds are cheaper than being wrong at {run}.',
        'That reading had one seed. If it had come back {alt} instead of {obs} — comfortably inside its own error bar — would you have launched this job? If not, you did not have a result.',
        'Single-seed evidence, acted on within {mins} minutes. I am not saying it is wrong. I am saying you do not know yet, and you have now spent {cost} GPU-hours as though you did.'
      ], {
        iv: ivLabel(id),
        sigma: n2(os.sigma),
        obs: eff(os.obs),
        alt: eff(num(os.obs, 0) - 2 * num(os.sigma, 0)),
        cost: gh(rec.cost),
        run: fmtParams(S.runScale),
        mins: Math.round((S.W - os.W) * 60)
      });
      break;
    }

    /* [SPEC] two experiments testing the same thing at the same settings - PEER
     * Lesson: that is a replication — say so, or it is a waste. Note the
     * distinction: same cell with MORE seeds is a precision buy and is fine, so
     * the duplicate key includes the seed count. */
    prev = S.cellFirst && S.cellFirst[rec.cellExact];
    if (prev && prev.id !== rec.id) {
      var saidSo = /replicat|reproduc|re-?run|confirm|repeat|second seed|sanity/i;
      if (!saidSo.test(rec.hypothesis) && !saidSo.test(prev.hypothesis)) {
        trig('dup_no_replication_note', 'PEER', 'warn', [
          'Hey — {b} is the same cell as {a}. Same interventions, same scale, same steps, same seed count. If that is a deliberate replication it is the most useful thing anyone has run this week, but say so in the hypothesis, because right now it reads as a duplicate that cost {cost} GPU-hours.',
          'Did you mean to run {label} twice at identical settings? Genuinely asking — I do this by accident about once a month. If it is on purpose, write "replication" in the hypothesis so the writeup can average them instead of arguing about which one to believe.',
          'Two runs of {label} at {scale}, {steps}, {seeds} seed(s) each. Either that is a replication, in which case lovely, tell people; or it is {cost} GPU-hours buying a number you already had on the board.',
          'Careful — {b} duplicates {a} exactly. A replication is the one experiment nobody ever budgets for and everybody wishes they had. Just label it as one.'
        ], {
          a: String(prev.id), b: String(rec.id),
          label: ivListLabel(rec.ivs),
          scale: scaleLabel(rec.scale),
          steps: S.stepLabel[rec.steps] || rec.steps,
          seeds: rec.seeds,
          cost: gh(rec.cost)
        });
      }
    }

    /* [SPEC] a result whose CI crosses zero treated as positive --------- LEAD
     * Lesson: that is noise.
     * Path A, detected here: they build on it — the intervention goes into a
     * larger combination while every reading they have of it is consistent with
     * no effect at all. (Path B, never re-measured by Friday, is below.) */
    if (rec.ivs.length >= 2) {
      for (i = 0; i < rec.ivs.length; i++) {
        id = rec.ivs[i];
        r = S.iv[id];
        if (!r || !r.results.length) continue;
        var np = noisyPositive(id);
        if (!np) continue;
        trig('ci_zero_treated_real', 'LEAD', 'pressure', [
          '{iv} came back {obs} with a 95% interval of [{lo}, {hi}]. That interval contains zero. You have just put it into a combination as though it were an effect. It is a measurement consistent with nothing happening.',
          'Stop on {iv}. Your own interval is [{lo}, {hi}]. The point estimate is {obs} and the honest summary is "we cannot tell". You are now building on it. Either measure it properly or take it out.',
          'The interval on {iv} straddles zero — [{lo}, {hi}] at sigma {sigma}. A positive point estimate inside an interval like that is a coin that landed heads. What would you need to see to believe it, and what would that cost?',
          '{iv}: [{lo}, {hi}]. You are treating the sign of the mean as the result. The sign of the mean is the least reliable thing in that experiment.'
        ], {
          iv: ivLabel(id),
          obs: eff(np.obs), lo: eff(np.lo), hi: eff(np.hi), sigma: n2(np.sigma)
        });
        break;
      }
    }

    /* [EXTRA] spending heavily to re-measure something already tight ---- LEAD
     * Lesson: precision you already own is not information. The value of an
     * experiment is what it could change, and re-measuring a tight number at the
     * same scale cannot change anything. */
    var tight = tightestFor(rec.key, rec.scaleIdx);
    if (tight && rec.cost >= 0.12 * S.budget) {
      trig('remeasure_tight', 'LEAD', 'pressure', [
        'You have just spent {cost} GPU-hours re-measuring {label}. You already had it at sigma {sigma}, interval [{lo}, {hi}]. What did you want to know that this answers?',
        '{cost} GPU-hours on {label} at {scale}. Your existing reading has sigma {sigma}. Halving an error bar that is already smaller than the effect buys you nothing you can put in a recommendation.',
        'That is {pctb} of the week on a cell you have already measured to sigma {sigma}. Precision you own is not information. Spend on the question you cannot currently answer, which is what happens above {maxs}.',
        'You are buying certainty you already have. {label} was {obs} +/- {half} at {scale}. Name the decision that changes if that error bar gets smaller.'
      ], {
        cost: gh(rec.cost),
        pctb: pct(rec.cost / Math.max(1, S.budget)),
        label: ivListLabel(rec.ivs),
        scale: scaleLabel(rec.scale),
        sigma: n2(tight.sigma),
        obs: eff(tight.obs),
        half: n2(1.96 * num(tight.sigma, 0)),
        lo: eff(tight.lo), hi: eff(tight.hi),
        maxs: scaleLabel(scaleAt(Math.max(0, S.maxScaleIdxDone)).id)
      });
    }

    /* [EXTRA] acting on a rival's number you never measured yourself ---- LEAD
     * Lesson: Halberd's number is not your number. A claim from another team is
     * a hypothesis with a stranger's error bars on it; independently replicating
     * it before you stake the run on it is the whole job.
     * The claim is read from world.events — authored, and possibly false. */
    if (S.rivalLive.length) {
      var borrowed = borrowedClaim(rec);
      if (borrowed) {
        trig('rival_borrowed', 'LEAD', 'pressure', [
          'You have written Halberd into the hypothesis for {iv}, you have never run it yourself, and you have put it in a bundle where nothing in the result can be attributed to it. Their number is not your number. If it is wrong, it is your name on the recipe.',
          'Your predicted effect is {pred}. Halberd claimed {claim} for {iv}. You have no run of your own on it and you have gone straight to a combination. Borrowed conviction is the cheapest thing in this building and it costs the most.',
          '{iv}: another team\'s result, carried into a {cost}-GPU-hour bundled job, without one measurement of your own. Ask what their sigma was. Then ask whether they told you.',
          'Halberd says {claim} for {iv}. Fine. What do you say, at what scale did you measure it, and how would this job tell the two of you apart? "They said so" is not an answer I can take into Friday.'
        ], {
          iv: ivLabel(borrowed.id),
          pred: rec.predicted === null ? 'unstated' : eff(rec.predicted),
          claim: borrowed.effect === null ? 'a win' : eff(borrowed.effect),
          cost: gh(rec.cost)
        });
      }
    }

    /* [EXTRA] carrying a dead job's interventions forward as evidence --- LEAD
     * Lesson: a job that did not finish has no number in it. A partial loss
     * curve feels like a signal and is not one; the failure is the result. */
    for (i = 0; i < rec.ivs.length; i++) {
      id = rec.ivs[i];
      var fc = S.failCarry[id];
      if (!fc) continue;
      if (S.W - fc.W > 3.0) continue;
      if (S.iv[id] && S.iv[id].results.length) continue;   // they do have a real reading
      if (rec.cellPlain === (S.jobs[fc.jobId] ? S.jobs[fc.jobId].cellPlain : null)) continue; // re-running it: correct
      trig('failed_job_carried', 'LEAD', 'pressure', [
        'Job {fid} died at {fpct} of its wall clock — {reason}. There is no number in a job that did not finish. You have launched {nid} carrying {iv} forward as though there were.',
        '{iv} has never produced a completed run. {fid} failed ({reason}) and you moved on to {nid} anyway. What is your measured effect for it? There isn\'t one.',
        'A partial loss curve is not a result. {fid} crashed at {fpct}; whatever you saw in the first {fpct} of it was a warm-up transient. {iv} is still unmeasured and it is now inside a job you are paying for.',
        'You are treating a failed run as weak evidence. It is not weak evidence, it is no evidence. Re-run {iv} or drop it, but do not build on {fid}.'
      ], {
        fid: String(fc.jobId), nid: String(rec.id),
        fpct: pct(num(fc.progress, 0)),
        reason: clip(fc.reason || 'infra failure', 48),
        iv: ivLabel(id)
      });
      break;
    }
  }

  /* ---- result-time triggers ------------------------------------------- */

  function onResult(res, state) {
    var rec = res.job;

    /* [EXTRA] the first number on the board ---------------------------- PEER
     * Lesson: notice what you have just learned, out loud, before the next job
     * distracts you from it. Ana is the one who does this on a real team. */
    if (res.status === 'ok') {
      trig('first_result', 'PEER', 'praise', [
        'First number on the board. {label} at {scale}: {obs}, interval [{lo}, {hi}]. Whatever it says, we know something now that we did not know when we walked in.',
        'Ooh, {label} landed. {obs} at {scale}, sigma {sigma}. I am going to be annoying and ask: is that bigger or smaller than you expected? You wrote {pred}.',
        'We have a result. {label}, {scale}: {obs} [{lo}, {hi}]. Worth thirty seconds looking at that interval before you launch the next thing — it is telling you how much this experiment could ever have said.',
        '{label} came back {obs} at {scale}. That is our first real datapoint of the week. Everything after this is either confirming it or arguing with it.'
      ], {
        label: ivListLabel(rec.ivs),
        scale: scaleLabel(rec.scale),
        obs: eff(res.obs), lo: eff(res.lo), hi: eff(res.hi),
        sigma: n2(res.sigma),
        pred: rec.predicted === null ? 'nothing' : eff(rec.predicted)
      });
    }

    /* [SPEC] all jobs launched at once, none staggered ----------------- PEER
     * Lesson: you cannot condition later work on earlier results if everything
     * is already in flight. Sequencing IS the experiment design. */
    if (res.status === 'ok' && S.launches.length >= 3) {
      var first = S.launches[0].launchW, last = first, i;
      for (i = 0; i < S.launches.length; i++) {
        if (S.launches[i].launchW < first) first = S.launches[i].launchW;
        if (S.launches[i].launchW > last) last = S.launches[i].launchW;
      }
      if (last - first <= 1.0) {
        trig('no_stagger', 'PEER', 'neutral', [
          'You fired {n} jobs inside {mins} minutes and then we all sat and waited. I do this too. The thing is, none of those jobs could use anything the others were about to teach us. Next batch, hold a slot back?',
          '{n} launches in {mins} minutes — the whole queue committed before a single result existed. It feels efficient. It is actually the one shape of schedule that guarantees you learn nothing between decisions.',
          'Everything went out at once. So now the answer to "what should we run next" is fixed until {n} jobs finish. Staggering costs you a little wall clock and buys you the right to change your mind.',
          'All {n} in one go. Honest question, not a dig: what would you have run differently if you had seen this result first? If the answer is anything, that is the argument for staggering.'
        ], { n: S.launches.length, mins: Math.round((last - first) * 60) });
      }
    }

    /* [SPEC] predicted effect off by > 2 sigma -------------------------- LEAD
     * Lesson: your priors are miscalibrated — notice it, in the moment, rather
     * than quietly revising what you claim you expected. */
    if (res.status === 'ok' && rec.predicted !== null && res.obs !== null &&
        num(res.sigma, 0) > 0) {
      var k = Math.abs(rec.predicted - res.obs) / res.sigma;
      if (k > 2.0) {
        trig('predict_miss_2sigma', 'LEAD', 'pressure', [
          'You predicted {pred} for {label}. It came back {obs}, sigma {sigma}. That is {k} sigma out. Do not quietly revise the prediction — write down why you believed {pred}, because that belief is still sitting in the rest of your plan.',
          '{label}: predicted {pred}, observed {obs}, {k} sigma. A miss that size is not bad luck, it is a model of the world that is wrong somewhere. Which part?',
          'Your interval was [{plo}, {phi}]. The measurement is {obs}. You were not slightly off, you were outside your own stated uncertainty. The useful question is whether the same reasoning produced your other predictions.',
          '{k} sigma miss on {label}. Good. That is the most informative thing that has happened this week — an experiment that only confirms you teaches you nothing. Say out loud what you now think is going on.'
        ], {
          label: ivListLabel(rec.ivs),
          pred: eff(rec.predicted), obs: eff(res.obs),
          sigma: n2(res.sigma), k: k.toFixed(1),
          plo: eff(rec.ciLow), phi: eff(rec.ciHigh)
        });
      }
    }

    /* [EXTRA] a clean, expensive, deliberate measurement --------------- PEER
     * Lesson: this is what a defensible number looks like — enough seeds, a
     * scale that matters, an interval clear of zero. Praise the process. */
    if (res.status === 'ok' && rec.scaleIdx >= 2 && rec.seeds >= 3 &&
        res.lo !== null && res.hi !== null && (res.lo > 0 || res.hi < 0)) {
      trig('precision_praise', 'PEER', 'praise', [
        '{label} at {scale}, {seeds} seeds, interval [{lo}, {hi}] — clean, and clear of zero. That is what a number we can defend on Friday actually looks like. Cost {cost} GPU-hours and I think it was worth every one.',
        'Okay, that one is lovely. {scale}, {seeds} seeds, sigma {sigma}, interval [{lo}, {hi}]. You bought the certainty on purpose instead of hoping for it.',
        'Look at that error bar. {label}: [{lo}, {hi}] at {scale}. Nobody is going to argue with that in the review, which is a strange and wonderful feeling.'
      ], {
        label: ivListLabel(rec.ivs),
        scale: scaleLabel(rec.scale),
        seeds: rec.seeds, sigma: n2(res.sigma),
        lo: eff(res.lo), hi: eff(res.hi), cost: gh(rec.cost)
      });
    }

    /* [EXTRA] systematically optimistic priors -------------------------- LEAD
     * Lesson: a miss with a SIGN is not noise, it is a belief. One 2-sigma miss
     * is bad luck; four predictions high in a row is a worldview. */
    if (S.predN >= 4) {
      var bias = S.predBiasSum / S.predN;
      if (S.predOver >= S.predN - 1 && bias > 0.4) {
        trig('optimism_bias', 'LEAD', 'pressure', [
          'Across {n} experiments your predictions are high by {bias} on average — {over} of {n} over. That is not noise, that is a prior. Name it: you believe these interventions help more than they do.',
          '{over} of your {n} predictions came in above the measurement, mean error {bias}. Systematic, not random. Before the next launch, shade every prediction down by {bias} and see whether you still want to run it.',
          'You are optimistic by construction. Mean signed error {bias} over {n} experiments. The reason that matters is that the same optimism is in the recommendation you are about to make about {run}, where nobody gets to check it for six weeks.'
        ], {
          n: S.predN, over: S.predOver, bias: eff(bias), run: fmtParams(S.runScale)
        });
      }
    }
  }

  /* ---- kill-time trigger ---------------------------------------------- */

  function onKill(v, state) {
    var rec = S.jobs[v.id];
    var p = num(v.progress, 0);
    if (!rec) return;

    /* [SPEC] a job killed after >70% complete --------------------------- OPS
     * Lesson: you paid for it and you threw it away. Kill early or let it land;
     * the middle is the one choice that gets you neither the compute nor the
     * number. */
    if (p > 0.70) {
      var spent = rec.cost * p;
      var refund = num(S.rules.killRefund, 0.5) * rec.cost * (1 - p);
      trig('kill_late', 'OPS', 'warn', [
        'Job {id} killed at {pct} of wall clock. Consumed {spent} GPU-hours. Refund {refund}, per policy: half of the unspent fraction only. Logged against your allocation.',
        'Termination acknowledged: {id}, {pct} complete. You are billed {spent} of {cost}. For the record, a job cancelled past the halfway mark is a completed job with no output.',
        '{id} cancelled at {pct}. Returned to your quota: {refund} GPU-hours. Cancel in the first quarter or let it land. Anything in between is the worst of both.',
        'Allocation note: {id} terminated at {pct}, {spent} GPU-hours consumed, {refund} returned. No result recorded. This is the third most common way teams end the week short.'
      ], {
        id: String(rec.id), pct: pct(p),
        spent: gh(spent), cost: gh(rec.cost), refund: gh(refund)
      }, { expiresW: S.W + 1.0 });   // a kill notice an hour later is just noise
    }
  }

  /* ---- clock / state triggers, evaluated every tick -------------------- */

  function evaluate(state) {
    var R = S.rules;
    var used = num(state.computeUsed, 0);
    var remaining = num(state.computeRemaining, Math.max(0, S.budget - used));
    var frac = S.budget > 0 ? used / S.budget : 0;
    var i, id, list;

    /* [SPEC] >50% of budget spent before Wednesday ---------------------- OPS
     * Lesson: pacing. Quota does not refresh, and the experiments you cannot
     * yet imagine are the ones you will want the compute for.
     * Time-critical: after Tuesday this is history, not a warning. */
    if (frac > 0.50 && S.day <= 2) {
      trig('pace_early_burn', 'OPS', 'warn', [
        'Allocation report, {tday}: {pct} of your weekly compute consumed, {left} GPU-hours remaining, {days} days of the week outstanding. Quota does not refresh. Noted for the record.',
        'Usage advisory. You are at {pct} of budget and it is {tday}. Burn rate at this point in the week is normally under 30%. I am not blocking anything, I am telling you the number.',
        '{pct} of allocation spent, {tday}. For planning purposes: {left} hours buys you {big7} runs at the largest scale, or {big3} at {midscale}. That is your remaining option set.',
        'Compute ops: budget at {pct}, two days in. Emergency top-ups are approved at the directorate level and have not been approved this quarter. Plan accordingly.'
      ], {
        tday: DAY_NAMES[Math.max(0, S.day - 1)],
        pct: pct(frac), left: gh(remaining),
        days: Math.max(0, num(R.days, 5) - S.day),
        big7: Math.floor(remaining / Math.max(1, num(scaleAt(S.scales.length - 1).computeHours, 850))),
        big3: Math.floor(remaining / Math.max(1, num(scaleAt(Math.max(0, S.scales.length - 2)).computeHours, 190))),
        midscale: scaleAt(Math.max(0, S.scales.length - 2)).label
      }, { expiresW: W(2, S.rules.startHour + S.rules.hoursPerDay) });
    }

    /* [SPEC] >40% of budget spent with no run above 300M ---------------- LEAD
     * Lesson: you will have nothing to say about 70B. The budget is not the
     * constraint that bites — the absence of a large-scale number is. */
    if (frac > 0.40 && S.maxScaleIdxLaunched >= 0 && S.maxScaleIdxLaunched <= 1) {
      trig('budget40_no_scale', 'LEAD', 'warn', [
        '{pct} of the budget is gone and nothing has run above {maxs}. On Friday the first question is what happens at {run}. Right now the honest answer is that you do not know.',
        'You have spent {spent} of {total} GPU-hours and your largest run is {maxs}. The recipe locks at {run}. Buy one expensive number while you can still afford it.',
        '{pct} spent, all of it below {nextup}. I would rather have three noisy points that include a big one than nine tight points that stop at {maxs}. The extrapolation is the whole deliverable.',
        'Budget check: {pct} used, largest scale {maxs}. Every hour from here is more expensive than the last, because the run you still need takes wall clock you are running out of.'
      ], {
        pct: pct(frac), spent: gh(used), total: gh(S.budget),
        maxs: scaleAt(S.maxScaleIdxLaunched).label,
        nextup: scaleAt(Math.min(S.scales.length - 1, S.maxScaleIdxLaunched + 1)).label,
        run: fmtParams(S.runScale)
      });
    }

    /* [SPEC] slot idle > 3 hours ---------------------------------------- OPS
     * Lesson: the cluster is not free, and idle allocation gets reclaimed.
     * Rasheed does not phrase this as encouragement. */
    if (S.idleSinceW !== null && (S.W - S.idleSinceW) > 3.0 && remaining > cheapestRun()) {
      var slotsFree = num(state.slotsFree, S.slots - (state.running || []).length);
      trig('slot_idle', 'OPS', 'warn', [
        'Allocation notice: {n} of your {slots} slots idle for {hours} hours, since {since}. Idle allocation is visible to the scheduler and to me. Use it or I reassign it.',
        'Utilisation on your queue is {util} over the last {hours} hours. Reservations are held on the assumption they are running jobs. Yours are not.',
        'You are holding {n} idle slots with {left} GPU-hours unspent. This is a reservation, not a savings account. If the pattern continues I will hand the capacity to the RL team, who have asked twice.',
        'Compute ops: {n}/{slots} slots unused since {since}. No action required from you. Recording it against the allocation review either way.'
      ], {
        n: Math.max(1, Math.round(slotsFree)), slots: S.slots,
        hours: hrs(S.W - S.idleSinceW),
        since: tstamp(dayOfW(S.idleSinceW), hourOfW(S.idleSinceW)),
        util: pct(Math.max(0, (S.slots - slotsFree) / S.slots)),
        left: gh(remaining)
      }, { expiresW: S.W + 2.0 });   // a live-utilisation complaint goes stale fast
    }

    /* [SPEC] an intervention never tested by Thursday ------------------- PEER
     * Lesson: you are going to recommend, or reject, on zero evidence. */
    if (S.day >= 4) {
      list = [];
      for (i = 0; i < S.ivIds.length; i++) {
        id = S.ivIds[i];
        if (!S.iv[id] || !S.iv[id].launched) list.push(id);
      }
      if (list.length) {
        trig('untested_thursday', 'PEER', 'warn', [
          'It is Thursday and we have not run a single job on {list}. I keep assuming somebody measured {one}. I do not think anybody did, and on Friday "we did not look" is a sentence you have to say out loud.',
          '{n} of the eight are still completely untested: {list}. Leaving them out of the recipe is a decision, same as putting them in. Right now it is a decision made by the schedule rather than by us.',
          'Thursday. {list} have zero evidence either way. Even a 70M singleton is better than nothing here — it at least tells us whether the sign is what we assumed.',
          'Small thing that has been bugging me: {one} has never been run. Not once. Whatever we say about it on Friday will be a story, not a measurement.'
        ], {
          list: ivListLabel(list, 3), n: list.length, one: ivLabel(list[0])
        });
      }
    }

    /* [SPEC] combination never tested (only singletons) by Thursday ----- LEAD
     * Lesson: interactions are where recipes die. You ship four of these
     * together; nothing you have measured says what they do together. */
    if (S.day >= 4 && S.launches.length >= 2 && !S.anyCombo) {
      trig('no_combo_thursday', 'LEAD', 'pressure', [
        'Thursday, and every experiment you have run is a singleton. We ship {max} of these together. Interactions are where recipes die — a pair that is fine alone and catastrophic together will not appear anywhere in your data.',
        '{n} experiments, not one combination. You are measuring {max} things you will never deploy separately. What is your evidence that the effects add?',
        'You have singleton effects and you are about to sum them. That assumption — additivity — is the single biggest thing standing between your recommendation and the run, and you have not tested it once.',
        'No combined runs. If two of your four interact badly, the recipe loses more than your best intervention gains, and we find out six weeks into a {run} run. Test at least one pair.'
      ], {
        n: S.launches.length,
        max: num(R.maxInterventions, 4),
        run: fmtParams(S.runScale)
      });
    }

    /* [EXTRA] a rival claim nobody ever checked ------------------------- PEER
     * Lesson: another team's claim is either an opportunity you are leaving on
     * the table or a mistake about to be copied into your recipe. Either way
     * it is worth one cheap run. (The claim itself is authored in world.events;
     * nobody in this file knows whether Halberd is right.) */
    if (S.rivalLive.length) {
      var ignored = null;
      for (i = 0; i < S.rivalLive.length && !ignored; i++) {
        var cl = S.rivalLive[i];
        if (S.W - cl.W < 8.0) continue;
        for (var j = 0; j < cl.ivs.length; j++) {
          id = cl.ivs[j];
          if (!S.iv[id] || !S.iv[id].launched) { ignored = { claim: cl, id: id }; break; }
        }
      }
      if (ignored) {
        trig('rival_ignored', 'PEER', 'neutral', [
          'Halberd\'s note on {iv} has been sitting there since {when} and we have not run a single job on it. Either they are right and we are leaving it on the table, or they are wrong and someone should find out. Both are worth one {small} run.',
          'Has anyone actually looked at what Halberd claimed about {iv}? {when}, and we have not touched it. I am not saying believe them. I am saying an unchecked claim from another team ends up in the recipe by osmosis.',
          'I keep coming back to Halberd\'s {iv} note from {when}. We have zero evidence of our own. If they are wrong and we copy them, that is the worst outcome available to us this week and it is completely avoidable.',
          'Devil\'s advocate: what if Halberd is right about {iv}? We have not run it. Cheapest possible check is {small}, and then we either take it seriously or stop thinking about it.'
        ], {
          iv: ivLabel(ignored.id),
          when: tstamp(ignored.claim.day, ignored.claim.hour),
          small: scaleAt(0).label
        });
      }
    }

    /* [EXTRA] the rival closes their book ----------------------------- RIVAL
     * Lesson: your competition is not waiting for your evidence. Halberd states
     * status only — every factual claim they make is authored in world.events,
     * never generated here, because a generated claim would leak the truth. */
    if ((frac > 0.70) || (S.day >= 4 && S.hour >= 15)) {
      trig('rival_pressure', 'RIVAL', 'pressure', [
        '[halberd-internal] Recipe frozen for the {run} run. No further ablations accepted this cycle. Writeup circulates Friday 09:00.',
        '[halberd-internal] Ablation sweep closed. Four changes going forward, two held back for next cycle. We are not re-opening the list.',
        '[halberd-internal] Status: our recommendation is locked and signed off. Compute released back to the pool at 18:00.',
        '[halberd-internal] Final note this cycle. Recipe is fixed. Anything arriving after today is a next-run problem.'
      ], { run: fmtParams(S.runScale) });
    }

    /* [EXTRA] the wall clock has closed the door on scale --------------- OPS
     * Lesson: the last hours of the week cannot buy the evidence the first
     * hours could. Wall-clock, not budget, is what kills large-scale runs.
     * Time-critical: useless after the readout gate. */
    var readoutW = W(readoutGate().day, readoutGate().hour);
    var big = scaleAt(S.scales.length - 1);
    var need = num(big.wallHours, 0);
    if (need > 0 && S.anyLaunch && S.maxScaleIdxLaunched <= 1 &&
        (readoutW - S.W) < need && S.W < readoutW) {
      trig('no_time_for_scale', 'OPS', 'neutral', [
        'Scheduling fact: {left} working hours remain before the readout. A {big} run at standard steps needs {need} hours of wall clock. As of now it does not fit. Your largest scale to date is {maxs}.',
        'For your planning: the {big} queue is no longer reachable before Friday {rh}. Wall clock, not budget — you have {left} hours and the job needs {need}. {midr} remains available until {midcut}.',
        'Capacity notice. {left} hours to the readout. Minimum wall clock for {big} is {need}. That option closed at approximately {closed}. Nothing to action; recording it so it is not a surprise on Friday.'
      ], {
        left: hrs(readoutW - S.W), big: big.label, need: hrs(need),
        maxs: scaleAt(Math.max(0, S.maxScaleIdxLaunched)).label,
        rh: hhmm(readoutGate().hour),
        midr: scaleAt(Math.max(0, S.scales.length - 2)).label,
        midcut: tstamp(dayOfW(readoutW - num(scaleAt(Math.max(0, S.scales.length - 2)).wallHours, 7)),
                       hourOfW(readoutW - num(scaleAt(Math.max(0, S.scales.length - 2)).wallHours, 7))),
        closed: tstamp(dayOfW(readoutW - need), hourOfW(readoutW - need))
      }, { expiresW: readoutW });
    }

    /* [EXTRA] Friday: evidence that lives only at the smallest scale ---- LEAD
     * Lesson: her signature question, asked while there is still time to answer
     * it. Time-critical — after the readout it is a post-mortem, not help. */
    if (S.day >= num(R.days, 5) && S.okResults.length >= 2) {
      list = [];
      for (i = 0; i < S.ivIds.length; i++) {
        id = S.ivIds[i];
        var r = S.iv[id];
        if (r && r.results.length && r.maxScaleIdxDone === 0) list.push(id);
      }
      if (list.length) {
        trig('small_scale_only_friday', 'LEAD', 'pressure', [
          'Friday. {list} exist in your evidence only at {small}. If you recommend {one}, the question in the room is at what scale you measured it and why it holds at {run}. Have that sentence ready, or drop it.',
          'Before the readout: {n} of the things you have evidence for, you have evidence for at {small} and nowhere else. {ratio}x extrapolation. I will not stop you recommending them. I will ask you to say the extrapolation out loud.',
          'Your strongest numbers are your smallest ones. {list} were measured at {small} only. Decide now whether your claim is "this helps" or "this helped at {small}", because those are different recommendations and only one of them is supported.',
          '{one} at {small} and nothing above it. Curves bend. Some of these effects are pure small-model regularisation and vanish by {run}. Which of yours do you believe survives, and why that one?'
        ], {
          list: ivListLabel(list, 3), n: list.length, one: ivLabel(list[0]),
          small: scaleAt(0).label, run: fmtParams(S.runScale),
          ratio: gh(S.runScale / Math.max(1, num(scaleAt(0).params, 7e7)))
        });
      }
    }

    /* [SPEC, path B] a zero-crossing result never re-measured ---------- LEAD
     * Lesson: that is noise — and by Friday, noise you never went back to check
     * is about to be presented as a finding. */
    if (S.day >= num(R.days, 5)) {
      for (i = 0; i < S.ivIds.length; i++) {
        id = S.ivIds[i];
        var np2 = noisyPositive(id);
        if (np2 && S.iv[id].results.length === 1) {
          trig('ci_zero_treated_real', 'LEAD', 'pressure', [
            '{iv} came back {obs} with a 95% interval of [{lo}, {hi}]. That interval contains zero, it was measured once, and it is still on your list. It is a measurement consistent with nothing happening.',
            'Your only reading of {iv} is [{lo}, {hi}]. The point estimate is {obs} and the honest summary is "we cannot tell". You have had four days and have not gone back to it.',
            'The interval on {iv} straddles zero — [{lo}, {hi}] at sigma {sigma}, n=1 in the sense that matters. A positive point estimate inside an interval like that is a coin that landed heads.',
            '{iv}: [{lo}, {hi}], never re-measured. You are treating the sign of the mean as the result. The sign of the mean is the least reliable thing in that experiment.'
          ], {
            iv: ivLabel(id), obs: eff(np2.obs), lo: eff(np2.lo),
            hi: eff(np2.hi), sigma: n2(np2.sigma)
          }, { expiresW: readoutW });
          break;
        }
      }
    }

    /* [EXTRA] nothing was ever run twice -------------------------------- PEER
     * Lesson: every number you have, you have once. A replication is the only
     * experiment that tells you whether your other experiments mean anything.
     * Time-critical — it is advice before the readout, and nothing after it. */
    if (S.day >= num(R.days, 5) && S.okResults.length >= 3 && !anyReplication()) {
      trig('never_replicated', 'PEER', 'warn', [
        'Something has been nagging me all week: every number in our table, we have exactly once. Not one cell run twice. If any single one of them was a bad draw, we have no way of knowing which.',
        'We have {n} results and {n} distinct configurations. Zero replications. I know it feels like a waste of compute — but the point of a replication is that it is the only experiment that tells you how much to trust the other ones.',
        'Genuine question before the readout: which of our numbers would come back the same if we ran it again right now? We do not have a single case where we know the answer.',
        'No repeated cells. All week. My old lead used to say an unreplicated result is a hypothesis wearing a decimal point, and I have never been able to shake it.'
      ], { n: S.okResults.length }, { expiresW: readoutW });
    }
  }

  /* --------------------------------------------------------- small helpers */

  function fmtParams(p) {
    p = num(p, 0);
    if (p >= 1e9) return (p / 1e9 >= 10 ? Math.round(p / 1e9) : (p / 1e9).toFixed(1).replace(/\.0$/, '')) + 'B';
    if (p >= 1e6) return Math.round(p / 1e6) + 'M';
    return String(Math.round(p));
  }

  function dayOfW(w) { return Math.floor(w / S.rules.hoursPerDay) + 1; }
  function hourOfW(w) {
    var into = w - (dayOfW(w) - 1) * S.rules.hoursPerDay;
    return S.rules.startHour + into;
  }

  function cheapestRun() {
    var s = scaleAt(0);
    var minMult = 1, k;
    for (k in S.stepMult) if (has(S.stepMult, k) && S.stepMult[k] < minMult) minMult = S.stepMult[k];
    return num(s.computeHours, 12) * minMult;
  }

  function readoutGate() {
    for (var i = Team.GATES.length - 1; i >= 0; i--) {
      if (Team.GATES[i].id === 'readout') return Team.GATES[i];
    }
    return { day: 5, hour: 16 };
  }

  /**
   * An intervention whose every completed reading is consistent with zero, with
   * at least one positive point estimate. Returns the most recent such reading.
   * Derived entirely from the player's own measurements.
   */
  function noisyPositive(id) {
    var r = S.iv[id];
    if (!r || !r.results.length) return null;
    var best = null, i, x;
    for (i = 0; i < r.results.length; i++) {
      x = r.results[i];
      if (x.lo === null || x.hi === null) return null;
      if (x.lo > 0 || x.hi < 0) return null;         // a clean reading exists — not noise
      if (num(x.obs, 0) > 0) best = x;
    }
    return best;
  }

  // The tightest completed reading of exactly this cell at this scale or larger.
  function tightestFor(key, scaleIdx) {
    var best = null, i, res;
    for (i = 0; i < S.okResults.length; i++) {
      res = S.okResults[i];
      if (res.job.key !== key) continue;
      if (res.job.scaleIdx < scaleIdx) continue;
      if (res.sigma === null) continue;
      if (res.sigma > 0.40) continue;
      if (!best || res.sigma < best.sigma) best = res;
    }
    return best;
  }

  function anyReplication() {
    var k;
    for (k in S.cellPlain) if (has(S.cellPlain, k) && S.cellPlain[k] >= 2) return true;
    return false;
  }

  /**
   * Is this launch USING Halberd's claim rather than testing it?
   *
   * Running the claimed intervention on its own is exactly the right response to
   * a rival note, and is never flagged. What is flagged is putting it into a
   * BUNDLE — using it as a building block — while owning no completed run of it,
   * so that nothing in the resulting number can be attributed back to it.
   *
   * Two citation signals, both from the player's own words or numbers:
   *   - the hypothesis names the rival, or
   *   - the predicted effect sits on top of the rival's authored number.
   * The claim itself comes from world.events. Nothing here knows if it is true.
   */
  function borrowedClaim(rec) {
    if (rec.ivs.length < 2) return null;
    var mentions = /halberd|rival team|their note|per halberd/i.test(rec.hypothesis);
    var i, j, cl, id, e;
    for (i = 0; i < S.rivalLive.length; i++) {
      cl = S.rivalLive[i];
      for (j = 0; j < cl.ivs.length; j++) {
        id = cl.ivs[j];
        if (rec.ivs.indexOf(id) < 0) continue;
        if (S.iv[id] && S.iv[id].results.length) continue;   // they measured it themselves
        e = has(cl.effects, id) ? cl.effects[id] : null;
        if (mentions) return { id: id, effect: e };
        if (e !== null && rec.predicted !== null && Math.abs(rec.predicted - e) <= 0.25) {
          return { id: id, effect: e };
        }
      }
    }
    return null;
  }

  /* ------------------------------------------------------------------- API */

  var Team = {

    // Verbatim from SPEC §4. ui.js renders the modal; Team only owns these.
    GATES: [
      { day: 1, hour: 9,  id: 'plan',    title: 'Research plan',
        prompt: 'Before you burn a GPU-hour: post your plan to Yuki in chat.' },
      { day: 3, hour: 14, id: 'midweek', title: 'Midweek review',
        prompt: 'Yuki wants your current belief, your evidence, and what you\'d cut.' },
      { day: 5, hour: 16, id: 'readout', title: 'Friday readout',
        prompt: 'Paste your readout into chat and defend the recommendation.' }
    ],

    NAMES: NAMES,

    init: function (opts) {
      opts = opts || {};
      S = freshState();
      S.world = opts.world || null;
      S.lab = opts.lab || null;
      S.onMessage = opts.onMessage || null;

      var LR = (S.lab && S.lab.RULES) || null;
      S.rules = {};
      var k;
      for (k in DEFAULT_RULES) if (has(DEFAULT_RULES, k)) {
        S.rules[k] = (LR && LR[k] !== undefined) ? LR[k] : DEFAULT_RULES[k];
      }
      S.budget = num(S.rules.computeBudget, 6000);
      S.slots = num(S.rules.slots, 4);
      S.day = 1;
      S.hour = num(S.rules.startHour, 9);

      readScenario(S.world);

      S.events = normEvents(S.world);
      S.eventFired = [];
      for (var i = 0; i < S.events.length; i++) S.eventFired.push(false);
      S.cellFirst = {};

      return Team;
    },

    /**
     * Called on every Lab tick. Emits, in this order:
     *   - every scripted world.events[] item now due,
     *   - every gate now due,
     *   - at most ONE reactive message.
     * Returns the messages emitted on this call; the onMessage callback is the
     * primary channel and ui.js may ignore the return value.
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

      // Once the readout is in, the team stops coaching. Nothing after the
      // decision can change the decision.
      if (state.readoutSubmitted) return out;

      updateBook(state);
      evaluate(state);

      if (S.lastDrainKey !== S.tickNo) {
        var msg = drain(state);
        if (msg) { S.lastDrainKey = S.tickNo; out.push(msg); }
      }
      return out;
    },

    getFeed: function () { return S ? S.feed.slice() : []; },

    /* Additive helpers. Nothing in the contract depends on them; ui.js and the
     * tests may use them. */
    pending: function () { return S ? S.queue.length : 0; },
    gateAt: function (day, hour) {
      for (var i = 0; i < Team.GATES.length; i++) {
        var g = Team.GATES[i];
        if (g.day === day && Math.abs(g.hour - hour) < 1e-9) return g;
      }
      return null;
    }
  };

  window.Team = Team;

})();
