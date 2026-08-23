# JUNIOR SOFTWARE ENGINEER (PRE-AI) SIM — INTERFACE SPEC (the contract)

Your first sprint on a new team. Ten working days, six tickets, a 400k-line
nine-year-old codebase you understand almost none of, and four people whose time
is not yours to spend.

**The enemy in this sim is the asymmetry of knowledge, and the social cost of
closing it.** Ask too early and you look like you cannot work alone. Ask too
late and you burned two days on something a senior would have answered in
ninety seconds. Every ticket has a hidden *discoverability profile*: some
answers are sitting in the code, some exist only in Deepa's head, some are in
the docs and the docs are wrong. Learning to tell those apart, fast, is the
whole exercise.

The second mechanic is that **your reputation is built by how you ask, not
whether you ask.** A question asked after a stated timebox, showing what you
already tried, costs almost nothing and earns trust. The same question asked
cold costs real trust. Silence while stuck costs the most of all.

Same technology constraints as the three sibling sims in `RoleSims/`: runs from
`file://` by double-clicking `index.html`. **No build step, no npm, no CDN, no
fetch(), no ES modules.** Vanilla JS, globals only.

```html
<script src="data/repo.js"></script>     <!-- window.SIM_REPO -->
<script src="sim/dev.js"></script>       <!-- window.Dev -->
<script src="sim/board.js"></script>     <!-- window.Board -->
<script src="sim/squad.js"></script>     <!-- window.Squad -->
<script src="sim/ui.js"></script>
```

---

## 1. DATA — `data/repo.js` (built by me, assume it exists)

```js
window.SIM_REPO = {
  scenario: {
    company:"Thistle", product:"...", role:"Software Engineer I", team:"Dispatch",
    sprint:{ days:10, hoursPerDay:6, startDay:1 },
    brief:"...", codebase:{ loc:412000, ageYears:9, langs:[...], note:"..." },
    seniorBudgetHours: 10          // Deepa's total availability this sprint
  },
  tickets:[ { id:"BUG-2201", title, type:"bug"|"feature"|"chore",
              priority:"P1"|"P2"|"P3", reporter, points, description,
              acceptance:[...] } ],          // 6 tickets
  actions:[ { id:"read_code", name, minutes, desc, caveat } ],
  people:[ { id:"deepa", name, role, startTrust, desc } ],
  events:[ Event, ... ],
  _t:"<base64>"                              // ENCODED GROUND TRUTH
}
window.SIM_REPO.reveal()   // -> truth. ONLY sim/dev.js may call this.
```

Truth shape:

```js
{
  tickets:{
    "BUG-2201":{
      cause:"...",                 // revealed at debrief
      needed: 70,                  // understanding required to implement correctly
      effortHours: 3.5,            // real implementation time once understood
      yield:{ read_code: 30, git_blame: 5, read_docs: -15, ask_deepa: 60, ... },
      // yield is understanding points per performance of that action.
      // NEGATIVE means the action actively misleads (wrong docs, red herring).
      decay: 0.6,                  // each repeat of the same action yields yield*decay^n
      timeboxHours: 1.5,           // the point past which asking is CORRECT
      selfFindable: true,          // if false, no amount of solo work reaches `needed`
      convention:"ExportPipeline", // the right pattern, or null
      conventionTrap:"LegacyExporter",   // what copying neighbouring code teaches
      needsTests:true, scopeRisk:0.0,
      notes:"revealed at debrief"
    }, ...
  },
  askQuality:{ ... },              // tuning for the trust model
  bestPath:{ ticketId:[actionIds] }, // an efficient route, for the debrief
  bestHours: 41.5                  // hours an ideal sprint would have taken
}
```

**`sim/dev.js` is the ONLY module allowed to read the truth**, and only to
resolve actions and to score the retro. `board.js`, `squad.js` and `ui.js` must
never call `reveal()` before the retro is submitted.

### 1b. Extra truth fields the builder emits — implement all of them

```js
soloCap: 55          // when selfFindable is false, NO amount of solo work may push
                     // understanding above this. Clamp it. This is what makes a
                     // tribal-knowledge ticket genuinely unsolvable alone.

shouldAbandon: true  // the correct resolution is Dev.abandon(), not a fix. Merging a
                     // "fix" for this scores as a false fix. Abandoning it after a short
                     // timebox is the RIGHT answer and scores as such.

needsClarification: "hannah"   // the PR bounces on wrong requirements, at ANY understanding,
                               // unless the player asked this person about this ticket first.

scopeTrap: { guardedBy:["ask_deepa","read_docs"], naiveFiles: 214, budget: 12 }
                     // if none of guardedBy was performed before implement(), filesTouched
                     // becomes naiveFiles and the PR bounces on scope.

points: 3            // story points, for the burn-up and the score
```

---

## 2. `sim/dev.js` — `window.Dev`

Pure logic, **no DOM**. Owns the clock, understanding, the senior-attention
budget, trust, PR review, and scoring.

### `Dev.RULES`

```js
{
  days: 10, hoursPerDay: 6, totalHours: 60, tickMinutes: 15,
  seniorBudgetHours: 10,
  startTrust: 55, minTrust: 0, maxTrust: 100,
  implementReadyAt: 70,        // understanding needed to open a PR at all
  correctAt: 90,               // understanding for a PR that survives review
  reviewLagHours: { min: 2, max: 5 },
  askCostMinutes: 15,          // your time
  vagueAskExtraMinutes: 30,    // Deepa has to dig, and it costs her budget too
  stuckHours: 3,               // no understanding gained for this long = stuck
  minQuestionChars: 25,
  estimateRequired: true
}
```

### The loop

Time advances in 15-minute ticks across 10 days × 6 hours. On any ticket you may:

- **investigate** — perform one of the actions in `repo.actions`. Costs its
  `minutes`, yields `truth.tickets[t].yield[action]` understanding, multiplied
  by `decay^(timesAlreadyDone)`. A negative yield subtracts understanding and is
  how a wrong doc or a red herring is modelled.
- **ask** — see below.
- **implement** — allowed only at `understanding >= implementReadyAt`. Costs
  `effortHours`, scaled by `(1 + max(0, (correctAt - understanding)) / 100)`:
  understanding you skipped, you pay for in rework.
- **write_tests** — 45 min, sets `hasTests`.
- **open_pr** — sends it to review.

### Asking — the heart of the model

```js
Dev.ask({ ticketId, to:"deepa"|"hannah"|"channel", question })
```

`question` must be >= `minQuestionChars`. Classify the ask as:

- **`premature`** — hours spent on this ticket < `timeboxHours` AND
  `selfFindable` is true AND at least one positive-yield solo action remains
  unused. Trust −6 with the person asked. Still returns the answer.
- **`well-formed`** — spent >= `timeboxHours`, or the ticket is not
  `selfFindable`, or every solo avenue is exhausted. Trust **+4**. Costs half
  the senior budget of a premature ask.
- **`overdue`** — spent >= `2.5 × timeboxHours` and still below `implementReadyAt`.
  Answer given, trust −3, and the squad remarks on it.

`to:"hannah"` costs no senior budget and is the *correct* move on an
underspecified ticket — see `needsClarification` below.

`to:"channel"` costs no senior budget and less trust either way, but the reply
arrives after 30–120 minutes of *simulated* delay and only answers if
`truth.tickets[t].yield.ask_channel > 0`.

When the senior budget is exhausted, `ask({to:"deepa"})` is rejected with
`"Deepa has no time left this sprint"`. That ceiling is the point.

### PR review

On `open_pr`, a review lands after a lag drawn from `reviewLagHours`. The PR
**merges** only if all hold:

1. `understanding >= correctAt`
2. `hasTests` if `truth.needsTests`
3. convention: if `truth.convention` is set, the player must have selected it
   (`Dev.setConvention(ticketId, name)`); choosing `conventionTrap` fails
4. scope: `filesTouched <= scopeBudget`

Otherwise it **bounces** with specific comments naming what failed, costs a
review cycle, and −2 trust with the reviewer. Bounces are not fatal — a bounced
PR can be worked and resubmitted. Track `bounces` per ticket.

### State

```js
{
  day: 4, hour: 11.25, t: "D4 11:15", tick: 121,
  hoursLeft: 34.75, seniorLeft: 6.5,
  tickets:[ { id, status:"todo"|"investigating"|"implementing"|"in_review"|"merged"|"abandoned",
              understanding, hoursSpent, estimateHours, actionsUsed:{}, hasTests,
              convention, bounces, prOpenedAt, blockedSince } ],
  active: "BUG-2201",
  trust:{ deepa:61, tobias:55, nnamdi:52, hannah:55 }, avgTrust: 55,
  merged:[ids], stuckOn: "BUG-2207"|null,
  finished:false, retroSubmitted:false
}
```

### API

```js
Dev.init({ repo, seed })
Dev.getState()
Dev.select(ticketId)
Dev.estimate(ticketId, hours)                 // required before work starts
Dev.investigate({ ticketId, actionId })       // -> {ok, gained, note} | {ok:false,error}
Dev.ask({ ticketId, to, question })           // -> {ok, answer, classification, trustDelta}
Dev.setConvention(ticketId, name)
Dev.writeTests(ticketId)
Dev.implement(ticketId)
Dev.openPR(ticketId)
Dev.abandon(ticketId)                         // hand it back; costs trust, sometimes correct
Dev.advance(hours) / Dev.step()
Dev.start()/pause()/setSpeed(m)/destroy()
Dev.submitRetro({ narrative, whatIdDoDifferently })   // -> Score
Dev.exportRetro()                             // markdown for chat
Dev.on("tick"|"review"|"answer"|"trust"|"stuck"|"sprintEnd", fn)
```

All randomness from a seeded PRNG owned by Dev (`mulberry32` + Box-Muller),
default seed `20260823`. **Never `Math.random()`.** Same seed replays identically.

### Rejections

`"Estimate this ticket first"`, `"You need to understand this better before you
can implement it"`, `"Deepa has no time left this sprint"`, `"That question is
too short to answer"`, `"The sprint is over"`, `"That PR is already in review"`,
`"You already merged that"`, `"Pick a ticket first"`.

### Scoring — `Score`

```js
{
  merged:[ids], mergedPoints: 8, totalPoints: 13,
  hoursSpent: 58.5, wastedHours: 11.25,      // time in negative-yield or past-optimal actions
  bestHours: 41.5, efficiency: 0.71,
  escalation:[ { ticketId, askedAtHours, timeboxHours, verdict:"early"|"right"|"late"|"never" } ],
  escalationScore: 0.6,
  bounces: 4, testsSkipped: 1, conventionMisses: 1,
  calibration:{ n, meanRatio: 2.4, worst:{ticketId, est, actual}, optimistic:true },
  trust:{ final:{...}, avg: 58, biggest:{who, delta} },
  grade:"A".."F",
  perTicket:[ { id, merged, understanding, hoursSpent, estimate, verdict, note } ]
}
```

Grade from a weighted blend of merged points, escalation score and trust.
**Two hard modifiers**: finishing with `avgTrust < 40` caps the grade at C, and
so does merging a PR at `understanding < correctAt` via repeated resubmission
without new investigation — shipping code you do not understand is the cardinal
sin of the role.

`exportRetro()` returns markdown: what merged, what did not and why, the time
ledger per ticket, every ask with its classification, estimate vs actual, the
bounce log, and the trust ledger. **No ground truth.**

---

## 3. `sim/board.js` — `window.Board`

Canvas. Dark, monospace, tabular numerals, HiDPI, the sibling palette
(bg `#0d1117`, panel `#161b22`, border `#30363d`, text `#c9d1d9`, dim `#8b949e`,
good `#3fb950`, bad `#f85149`, warn `#d29922`, accent `#39c5cf`).

```js
var b = Board.create(canvasEl, {theme:"dark"});
b.timeline({ tickets, day, totalDays, hoursPerDay });  // where the hours actually went
b.understanding({ ticket, history });                   // understanding vs hours, with the
                                                        // implement/correct thresholds drawn
b.burn({ points, merged, day, totalDays });
b.trust({ people });
b.truth({ perTicket, paths });                          // DEBRIEF ONLY
b.resize();
```

- **`timeline`** is the centrepiece: one horizontal lane per ticket across the
  ten days, each investigation action a coloured segment sized by its time cost.
  Negative-yield actions must render in red as visibly wasted time, and the
  moment of each ask must be marked. The finished picture should let the player
  see, instantly, that (say) six hours went into reading code on a ticket whose
  answer was never in the code.
- **`understanding`** plots understanding against hours for the selected ticket,
  with horizontal rules at `implementReadyAt` and `correctAt`, so a plateau —
  the signature of an unfindable answer — is obvious while it is happening.
  A plateau is the in-game tell that it is time to ask.
- **`truth`** (debrief) overlays, per ticket, the route actually taken against
  the efficient route, and marks where the optimal ask point was.

Degenerate input must not throw: no tickets, zero hours, empty history, NaN.

---

## 4. `sim/squad.js` — `window.Squad`

```js
Squad.init({ repo, dev, onMessage });
Squad.tick(state);
Squad.getFeed();
Squad.GATES = [
  { day:1,  id:"kickoff",  title:"Sprint kickoff",
    prompt:"Post your plan for the sprint and your estimates to the team in chat." },
  { day:3,  id:"standup",  title:"Standup",
    prompt:"Yesterday, today, and blockers. Be honest about the blockers." },
  { day:6,  id:"oneonone", title:"1:1 with Tobias",
    prompt:"Tobias wants to know how it's going, and what you'd want more of." },
  { day:10, id:"retro",    title:"Sprint retro",
    prompt:"Paste your retro into chat and walk the team through the sprint." }
];
```

```js
Msg = { day, hour, t:"D4 11:15", from:"MENTOR"|"LEAD"|"REVIEWER"|"PM"|"CHANNEL"|"BOT",
        name, text, tone:"neutral"|"pressure"|"warn"|"praise"|"alarm", needsReply:false }
```

### The cast

- **Deepa Iyer — staff engineer, your onboarding buddy (`MENTOR`).** Nine years
  on this codebase; she wrote a third of it and regrets some. Generous, direct,
  genuinely wants you to succeed, and stretched thin. She answers well-formed
  questions instantly and gently redirects lazy ones. Her recurring line is a
  version of "what have you tried, and what did you expect to happen?"
- **Tobias Lindqvist — tech lead (`LEAD`).** Runs standup, owns delivery. Cares
  far more about whether you are blocked than whether you are fast. His one
  unforgivable thing is a junior sitting silently stuck for two days.
- **Nnamdi Eze — senior engineer, your reviewer (`REVIEWER`).** Picky, fair,
  fast, writes review comments that teach rather than scold. Will not merge code
  the author cannot explain.
- **Hannah Brecht — PM (`PM`).** Friendly, busy, drops "quick questions" that
  are not quick, and writes underspecified tickets. Asking her a clarifying
  question is almost always correct and almost nobody does it.
- **`CHANNEL`** — `#eng-help`, async, occasionally useful, occasionally a
  stranger confidently giving you a wrong answer.
- **`BOT`** — CI. Terse. Reports build and test results.

### Reactive triggers — implement all, each at most once

| Trigger | Voice | Lesson |
|---|---|---|
| understanding flat for `stuckHours` and no ask | LEAD | silent stuckness is the one unforgivable thing |
| asked before the timebox with solo avenues unused | MENTOR | what did you try first |
| asked well after a real timebox | MENTOR | praise, explicitly, so the pattern sticks |
| 3+ repeats of the same action with decaying yield | MENTOR | rereading the same file is not progress |
| followed a negative-yield action for >90 min | MENTOR | the docs lie, here is how you tell |
| implemented below `correctAt` | REVIEWER | you are guessing and it will show in review |
| PR bounced twice on the same ticket | REVIEWER | address the comment, do not re-submit hope |
| no tests on a ticket that needs them | BOT then REVIEWER | coverage gate |
| picked the convention trap | REVIEWER | matching neighbours taught you the wrong thing |
| never asked anyone by day 4 | LEAD | independence is not the metric |
| senior budget under 20% remaining | MENTOR | her time is a real, shared resource |
| estimate exceeded by 2x with no update | LEAD | a stale estimate is a broken promise |
| worked past `hoursPerDay` repeatedly | LEAD | heroics are a smell, not a virtue |
| touched the feared legacy module | MENTOR | here be dragons, and here is the map |

Plus scripted `repo.events[]`: a day-2 onboarding nudge, a day-4 production
incident that eats time, Hannah's day-5 "quick question", a day-7 reviewer
backlog, a day-9 code-freeze warning.

One reactive message per tick max; priority LEAD > REVIEWER > MENTOR > PM >
CHANNEL > BOT. 3–5 deterministic phrasings per trigger chosen by a hash of
trigger id + message count. **No `Math.random()`.** `squad.js` must NEVER read
ground truth — it reasons only from the player's actions and the published
state.

---

## 5. `index.html` + `sim/ui.js` + `sim/ui.css`

Screens: **brief** → **desk** (main) → **gate modal** → **retro** → **debrief**.

The desk:
- Header: day/hour, hours left, **Deepa's remaining budget as a visible bar**,
  points merged vs committed, trust strip, speed/pause/step.
- **Ticket board**: six cards with status, understanding bar (with the
  implement/correct thresholds marked *on the bar*), hours spent vs estimate.
- **Work panel** for the selected ticket: the action list, each showing its time
  cost and its caveat, plus how many times you have already run it and a visible
  "diminishing returns" indicator. Then implement / write tests / open PR.
- **Ask panel**: choose Deepa or the channel, type the question, and *before you
  send*, the UI must show how long you have already spent on this ticket and
  what you have already tried. It must not tell you the classification in
  advance — but by putting the timebox evidence in front of the player at the
  moment of asking, it makes the judgement conscious.
- **Understanding plot** for the active ticket, live. The plateau is the tell.
- **Squad feed**: right column, prominent, colour-coded, with inline replies.

Retro: narrative + what you'd do differently. Debrief: score, grade,
`Board.truth()` reveal, escalation table, calibration, trust ledger, per-ticket
verdict with `truth.notes`, copy-to-clipboard of `exportRetro()`.

Dark, monospace, 1440×900 with no page scroll, `tabular-nums`, no
`alert`/`confirm`/`prompt`, defensive boot diagnostic. Match the sibling sims.

---

## 6. NON-NEGOTIABLES

- Only `dev.js` may read ground truth, and only for resolving actions and scoring.
- Estimates are required before work; they are the calibration record.
- Understanding, not time, gates implementation — and shipping below `correctAt`
  is the cardinal sin.
- All randomness from the seeded PRNG; same seed replays identically.
- Action caveats are shown *before* the action is taken.
- Runs offline from `file://`.
