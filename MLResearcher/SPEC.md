# FOUNDATIONAL ML RESEARCHER SIM — INTERFACE SPEC (the contract)

You are a researcher on the pretraining team at an AI-first lab. The next large
training run locks its recipe on Friday. You have five days, a rationed compute
budget, and eight candidate interventions. Your job is to recommend **at most
four** of them for the run.

Every intervention has a **hidden true effect that varies with model scale.**
Your experiments return noisy samples of that truth; noise falls as you spend
compute. The entire exercise is inference under a budget.

Same technology constraints as the DayTrader sim in the sibling directory:
runs from `file://` by double-clicking `index.html`. **No build step, no npm, no
CDN, no fetch(), no ES modules.** Vanilla JS. Every file attaches to a global.

Load order in `index.html`:

```html
<script src="data/world.js"></script>    <!-- window.SIM_WORLD -->
<script src="sim/lab.js"></script>       <!-- window.Lab -->
<script src="sim/plots.js"></script>     <!-- window.Plots -->
<script src="sim/team.js"></script>      <!-- window.Team -->
<script src="sim/ui.js"></script>        <!-- boots everything -->
```

---

## 1. DATA — `data/world.js` (built by me, assume it exists)

```js
window.SIM_WORLD = {
  scenario: {
    org: "...", team: "...", question: "...", deadline: "...",
    brief: "...",              // the Monday-morning problem statement
    metric: { name: "LCR@128k", units: "points", desc: "..." },
    priorEvidence: [ {text:"...", source:"..."} ],   // what the team already believes
    runScale: 7.0e10,          // the scale the recommendation is FOR
    maxInterventions: 4        // recipe risk budget
  },
  interventions: [
    { id:"rope_scaling_v2", name:"RoPE scaling v2", family:"architecture",
      desc:"...", cost:"low", author:"..." },
    ...  // 8 total
  ],
  scales: [
    { id:"70m",  params:7.0e7,  label:"70M",  computeHours: 12,  wallHours: 1.5, sigma: 1.80 },
    { id:"300m", params:3.0e8,  label:"300M", computeHours: 45,  wallHours: 3.0, sigma: 1.20 },
    { id:"1p4b", params:1.4e9,  label:"1.4B", computeHours: 190, wallHours: 7.0, sigma: 0.80 },
    { id:"7b",   params:7.0e9,  label:"7B",   computeHours: 850, wallHours: 18.0, sigma: 0.50 }
  ],
  stepOptions: [ {id:"short", label:"5k steps",  mult:0.5},
                 {id:"std",   label:"10k steps", mult:1.0},
                 {id:"long",  label:"20k steps", mult:2.0} ],
  events: [ Event, ... ],       // scripted team messages, see §4
  _t: "<base64>"                // ENCODED GROUND TRUTH — see below
}
```

### The hidden truth

`SIM_WORLD._t` is a base64-encoded JSON blob. **It is deliberately encoded so a
casual glance at the file does not spoil the exercise.** It is not security; it
is a courtesy. Decode it with the helper the data file also exports:

```js
window.SIM_WORLD.reveal()   // -> the truth object. NEVER call this from ui.js
                            //    except on the post-readout debrief screen.
```

Truth object shape:

```js
{
  // effect_i(N) = c_i + a_i * (Nref / N)^gamma_i        Nref = 7.0e7
  effects: { rope_scaling_v2: {c: 2.60, a: 0.30, gamma: 1.00}, ... },
  // pairwise interaction terms, added when BOTH are present, scale-independent
  interactions: [ {pair:["doc_packing_boundary","long_ctx_data_mix"], delta: 2.70}, ... ],
  notes: { rope_scaling_v2: "one-line explanation revealed at debrief", ... }
}
```

**`sim/lab.js` is the ONLY module allowed to read the truth**, and only to
generate noisy observations and to score the final readout. `plots.js`, `team.js`
and `ui.js` must never call `reveal()` before the readout is submitted.

---

## 2. `sim/lab.js` — `window.Lab`

Pure logic, **no DOM**. Owns the clock, the compute budget, the job queue, the
experiment cost/noise model, infra failures, and scoring.

### `Lab.RULES`

```js
{
  computeBudget: 6000,     // GPU-hours for the week
  slots:         4,        // concurrent jobs (your allocation)
  days:          5,
  hoursPerDay:   10,       // 09:00 -> 19:00
  startHour:     9,
  maxInterventions: 4,     // enforced at readout
  failureBase:   0.10,     // base per-job infra failure probability
  failureScaleMult: { "70m":0.6, "300m":0.9, "1p4b":1.3, "7b":2.0 },
  killRefund:    0.5,      // fraction of UNSPENT compute returned on kill
  minHypothesisChars: 20
}
```

### Cost, wall-clock, and noise — implement EXACTLY

```
cost      = scale.computeHours * steps.mult * seeds        // GPU-hours, charged at LAUNCH
wallHours = scale.wallHours * steps.mult                   // seeds run data-parallel: no wall cost
sigma     = scale.sigma / sqrt(seeds) / sqrt(steps.mult)   // standard error of the observed effect
```

Seeds cost compute but not wall-clock. That is the central lever: **buying
certainty costs GPU-hours, not time.**

### Observation model

```
trueEffect(set, N) = Σ_i [ c_i + a_i * (Nref/N)^gamma_i ]
                   + Σ_{pairs in set} delta_pair
observed           = trueEffect(set, N) + gaussian(0, sigma)
```

Gaussian draws MUST come from a **seeded PRNG owned by Lab** so a session is
reproducible: `Lab.init({world, seed})`, default seed `20260816`. Use a standard
mulberry32/xorshift + Box-Muller. Never `Math.random()`.

Report on each result: `observedEffect`, `sigma`, and a 95% CI
(`observed ± 1.96*sigma`).

### Infra failures

At launch, roll failure probability
`p = failureBase * failureScaleMult[scale] * steps.mult`, capped at 0.45.
A failed job is decided at launch but **revealed only when it would have
finished**, at a uniformly-drawn fraction 0.2–0.9 of its wall time. Refund the
*unconsumed* fraction of compute. Fail reasons, drawn from the PRNG:
`"preempted"`, `"loss diverged (NaN at step ~X)"`, `"OOM on shard 3"`,
`"dataloader deadlock"`, `"checkpoint corrupt"`.

This teaches: a single huge run is a fragile bet.

### Lifecycle and API

```js
Lab.init({ world, seed })
Lab.getState()
Lab.design({ interventions, scale, steps, seeds })
   // -> { ok:true, cost, wallHours, sigma, etaDay, etaHour }  (a PRICING PREVIEW,
   //    no side effects; call it on every form change)
   // -> { ok:false, error }
Lab.launch({ interventions:[ids], scale, steps, seeds,
             hypothesis, predictedEffect, ciLow, ciHigh })
   // -> { ok:true, job } | { ok:false, error }
Lab.kill(jobId)
Lab.advance(hours)      // fast-forward; jobs complete in order
Lab.step()              // advance one 15-minute tick
Lab.start()/pause()/resume()/setSpeed(mult)/destroy()
Lab.submitReadout({ interventions:[ids], confidence, rationale })  // -> Score
Lab.exportReadout()     // -> markdown, for pasting into chat
Lab.on("tick"|"result"|"fail"|"deadline"|"budget", fn)
```

### State

```js
{
  day: 2, hour: 14.25, t: "Tue 14:15", tick: 21,
  computeUsed: 1840, computeRemaining: 4160, budgetPct: 30.7,
  slotsUsed: 3, slotsFree: 1,
  running: [ Job, ... ], results: [ Result, ... ],
  finished: false, readoutSubmitted: false
}
```

```js
Job    = { id, interventions:[ids], scale, steps, seeds, cost, wallHours,
           launchedAt:{day,hour}, etaAt:{day,hour}, progress:0..1,
           hypothesis, predictedEffect, ciLow, ciHigh }
Result = { ...Job, status:"ok"|"failed", failReason,
           observedEffect, sigma, ciLow95, ciHigh95, finishedAt:{day,hour} }
```

### Rejections (return `{ok:false,error}` with a human message)

- `"No free slots — you have 4 jobs running"`
- `"Not enough compute — that costs 890 GPU-hours, you have 410"`
- `"Hypothesis required"` (< `minHypothesisChars`)
- `"Predicted effect required"` (must be a finite number, and `ciLow < ciHigh`)
- `"Pick at least one intervention"`
- `"It won't finish before Friday's readout"` — ETA past the deadline
- `"The readout is already submitted"`

### Scoring — `Score`

```js
{
  chosen: [ids], trueEffectAtRunScale: 8.41,
  bestPossible: 9.92, bestSet: [ids],
  regret: 1.51,                    // bestPossible - trueEffectAtRunScale
  grade: "A"|"B"|"C"|"D"|"F",      // by regret as a fraction of bestPossible
  shippedRegression: true|false,   // did they include a net-negative intervention
  missed: [ids],                   // good ones they left out
  computeSpent: 5140, computeEfficiency: ...,
  calibration: {
    n: 14, hitRate: 0.57,          // fraction where truth fell in their stated CI
    meanAbsError: 1.31, bias: +0.62,  // signed: are they optimistic?
    overconfident: true
  },
  perIntervention: [ { id, believed, truthAtRunScale, chosen, verdict } ]
}
```

Grade bands on `regret / bestPossible`: A < 0.10, B < 0.25, C < 0.45, D < 0.70,
else F. **Including any intervention whose true effect at run scale is negative
forces a maximum grade of C**, regardless of regret — shipping a regression into
a large run is the cardinal sin.

`exportReadout()` returns markdown containing: the recommendation and rationale,
every experiment run (interventions, scale, steps, seeds, cost, hypothesis,
predicted vs observed with CI), total compute spent and what fraction went to
failed jobs, and the calibration table. **It must NOT contain the ground truth**
— that is for the debrief screen only, after submission.

---

## 3. `sim/plots.js` — `window.Plots`

Canvas plotting. Pure drawing. This module matters more than it looks: reading
noisy evidence off a chart *is* the skill being trained.

```js
var p = Plots.create(canvasEl, { theme:"dark" });
p.scaling({ series:[ {id, label, color, points:[{params, effect, ciLow, ciHigh}]} ],
            runScale: 7e10, metric:"LCR@128k" });
p.forest({ rows:[ {label, effect, ciLow, ciHigh, n} ] });   // effect ± CI, sorted
p.budget({ used, total, byScale:{...} });
p.truth({ series:[...], truthCurves:[ {id,label,color,fn} ], runScale });  // DEBRIEF ONLY
p.resize();
```

Requirements:
- **`scaling`** is the centrepiece: x = params on a log axis (70M → 70B), y =
  effect in metric points, one line per intervention through its measured
  points, **error bars at every point**, a dashed vertical line at the run scale
  with the label "RUN SCALE — you have no data here", and a zero line. Points
  with wide CIs must *look* uncertain.
- **`forest`**: a classic forest plot — horizontal effect ± 95% CI per row, zero
  line, ordered by effect. Rows whose CI crosses zero must be visually muted.
- **`truth`**: debrief only — overlays the true effect curves (smooth, dashed)
  on top of the measured points, so the gap between what they measured and what
  was true is immediately legible. This is the payoff screen of the whole sim.
- Log-scale x axis with ticks at 70M/300M/1.4B/7B/70B.
- HiDPI-correct, dark theme, monospace, tabular numerals.
- Degenerate input: no series, one point, zero-width CI, all-equal values.

Palette: bg `#0d1117`, panel `#161b22`, border `#30363d`, text `#c9d1d9`, dim
`#8b949e`, good `#3fb950`, bad `#f85149`, warn `#d29922`, accent `#39c5cf`.
Series colours must be distinguishable and colour-blind-safe.

---

## 4. `sim/team.js` — `window.Team`

The people around you. Same role the trading desk played: this is what makes it
a job rather than a puzzle.

```js
Team.init({ world, lab, onMessage });
Team.tick(state);
Team.getFeed();
Team.GATES = [
  { day:1, hour:9,  id:"plan",    title:"Research plan",
    prompt:"Before you burn a GPU-hour: post your plan to Yuki in chat." },
  { day:3, hour:14, id:"midweek", title:"Midweek review",
    prompt:"Yuki wants your current belief, your evidence, and what you'd cut." },
  { day:5, hour:16, id:"readout", title:"Friday readout",
    prompt:"Paste your readout into chat and defend the recommendation." }
];
```

```js
Msg = { day, hour, t:"Wed 11:30", from:"LEAD"|"OPS"|"PEER"|"RIVAL",
        name:"...", text:"...", tone:"neutral"|"pressure"|"warn"|"praise"|"alarm" }
```

### The cast

- **Dr. Yuki Tanaka — research lead (`LEAD`).** Owns the run. Cares about
  *what would change your mind* and whether your evidence supports the size of
  your claim. Will ask you to justify compute. Kills unfocused work. Terse,
  numerate, never cruel. Her recurring question: "at what scale did you measure
  that, and why do you think it holds at 70B?"
- **Rasheed — compute ops (`OPS`).** Cold and procedural. Announces preemptions,
  quota changes, cluster contention. Occasionally *takes a slot away* for a
  higher-priority job. Does not care about your feelings or your deadline.
- **Ana Beltrán — peer researcher (`PEER`).** Warm, curious, thinks out loud.
  Shares hunches, some of which are wrong. She is the human texture of the team.
- **Team Halberd (`RIVAL`).** A parallel team posting internal notes claiming
  results. **Some of their claims are false or measured only at small scale.**
  Whether the player independently replicates a rival claim before acting on it
  is one of the most valuable things this sim tests.

### Reactive triggers — implement all of these, each at most once

| Trigger | Voice | Lesson |
|---|---|---|
| ≥3 experiments all at the smallest scale | LEAD | small-scale-only evidence doesn't transfer |
| a 1-seed result acted on (relaunched/extended) within 2h | LEAD | one seed is a rumour, not a result |
| >40% of budget spent with no run above 300M | LEAD | you will have nothing to say about 70B |
| a job killed after >70% complete | OPS | you paid for it, you threw it away |
| two experiments testing the same thing at the same settings | PEER | that's a replication — say so, or it's a waste |
| >50% budget spent before Wednesday | OPS | pacing |
| an intervention never tested by Thursday | PEER | you're going to recommend on zero evidence |
| a result whose CI crosses zero treated as positive | LEAD | that is noise |
| slot idle > 3 hours | OPS | the cluster is not free; idle allocation gets reclaimed |
| predicted effect off by > 2 sigma | LEAD | your priors are miscalibrated, notice it |
| all jobs launched at once, none staggered | PEER | you can't condition later work on earlier results |
| combination never tested (only singletons) by Thursday | LEAD | interactions are where recipes die |

Plus scripted events from `world.events[]` (rival notes, cluster incidents, a
Wednesday priority shift). Fire at most one reactive message per tick, queued
`LEAD > OPS > RIVAL > PEER`. Phrasing: 3–5 deterministic variants each, selected
by a hash of the trigger id and message count — **no `Math.random()`**.

---

## 5. `index.html` + `sim/ui.js` + `sim/ui.css`

Screens:

1. **Brief** — the scenario, the metric, prior evidence, the eight interventions
   as cards, the budget, the deadline, the max-4 constraint.
2. **Lab console** — the main screen:
   - Header: day/time, compute used vs budget (a bar), slots used, deadline
     countdown in hours, speed + pause/step.
   - **Experiment designer**: multi-select interventions (combinations allowed),
     scale, steps, seeds, a live pricing preview from `Lab.design()` showing
     cost / wall-clock / **resulting sigma** and the ETA, then the mandatory
     **hypothesis** box and **predicted effect + CI** fields, then LAUNCH.
     Showing sigma *before* they commit is the core teaching moment: they can
     see they are buying an experiment too noisy to answer the question.
   - **Running jobs**: progress bars, ETA, kill buttons.
   - **Results**: sortable table + the forest plot + the scaling plot.
   - **Team feed**: right column, chat-like, colour-coded, prominent.
3. **Gate modal** — pauses the clock, states the prompt, requires an explicit
   "I've posted it — continue".
4. **Readout** — pick ≤4 interventions, a confidence value, a rationale box,
   submit. Warn if they submit with an untested intervention.
5. **Debrief** — the score, the grade, `Plots.truth()` revealing the true curves
   against their measured points, the calibration table, and a per-intervention
   verdict with the truth notes. Copy-to-clipboard for `exportReadout()`.

Design: dark, monospace, terminal-adjacent, matching the DayTrader sim's palette
so the RoleSims family looks like one product. Must work at 1440×900 with no
page scroll. `tabular-nums` on all numbers. No `alert()`/`confirm()`/`prompt()`
— build in-page modals. Defensive boot: if a global is missing, render a
diagnostic naming it rather than a blank page.

---

## 6. NON-NEGOTIABLES

- No module except `lab.js` may read the ground truth before readout submission.
- The hypothesis and the predicted effect are mandatory on every launch. They
  are the calibration record and the single most important learning device here.
- All randomness comes from Lab's seeded PRNG. The same seed must replay
  identically.
- `sigma` must be shown *before* launch, not after.
- Runs offline from `file://`.
