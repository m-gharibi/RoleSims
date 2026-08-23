# PRODUCT MANAGER SIM — INTERFACE SPEC (the contract)

You are the PM for Lumen, a B2B collaborative analytics product. You own one
quarter, one engineering team, ten candidate features, and five stakeholders who
all want different things and none of whom report to you.

**The enemy in this sim is bias, not noise.** Every instrument a PM has lies in
a known direction: sales anecdotes overweight the deal in front of them, support
tickets overweight the pain of people who already use the product and are blind
to the people who bounced, surveys capture stated rather than revealed
preference. The skill being trained is triangulating across instruments that lie
differently — and noticing when every instrument you own is blind to the same
thing.

Second mechanic: **trust is a resource you spend by saying no**, and it feeds
back. Lose engineering's trust and your estimates get padded. Lose the CEO's and
your roadmap gets overridden.

Same technology constraints as the sibling sims in `RoleSims/DayTrader/` and
`RoleSims/MLResearcher/`: runs from `file://` by double-clicking `index.html`.
**No build step, no npm, no CDN, no fetch(), no ES modules.** Vanilla JS,
globals only.

```html
<script src="data/company.js"></script>  <!-- window.SIM_CO -->
<script src="sim/product.js"></script>   <!-- window.Product -->
<script src="sim/viz.js"></script>       <!-- window.Viz -->
<script src="sim/org.js"></script>       <!-- window.Org -->
<script src="sim/ui.js"></script>
```

---

## 1. DATA — `data/company.js` (built by me, assume it exists)

```js
window.SIM_CO = {
  scenario: {
    company:"Lumen", product:"...", role:"...",
    northStar:{ name:"W4 team activation", units:"pp", baseline:31.4, desc:"..." },
    quarter:{ weeks:12, workDaysPerWeek:5 },
    capacity:{ engWeeksPerWeek:4, total:48 },
    brief:"...", ceoMandate:"..."
  },
  features:[ { id, name, tags:[...], desc, estCost, owner, pitchedBy } ],   // 10
  instruments:[ { id, name, days, cost, concurrent:true, desc, knownCaveat } ],
  stakeholders:[ { id, name, role, favors:[ids], opposes:[ids], startTrust:60, desc } ],
  events:[ Event, ... ],
  _t:"<base64>"        // ENCODED GROUND TRUTH
}
window.SIM_CO.reveal()   // -> truth. ONLY sim/product.js may call this.
```

Truth shape:

```js
{
  impact:{ onboarding_checklist: 4.2, ... },     // true north-star delta, pp, if SHIPPED
  trueCost:{ realtime_collab: 24, ... },         // real eng-weeks; estCost is optimistic
  optimism:{ realtime_collab: 2.4, ... },        // trueCost / estCost
  interactions:[ {pair:[a,b], delta:1.5} ],
  bias:{ sales_anecdote:{ enterprise:+2.5, onboarding:-0.5, _noise:1.5 }, ... },
  notes:{ featureId:"revealed at debrief", ... },
  bestSet:[ids], bestValue: 9.8
}
```

`estCost` shown to the player is `round(trueCost / optimism)` — **engineering
estimates are systematically optimistic, and by different amounts per feature.**

---

## 2. `sim/product.js` — `window.Product`

Pure logic, no DOM. Owns the calendar, engineering capacity, the research queue,
the roadmap, trust, and scoring.

### `Product.RULES`

```js
{
  weeks: 12, workDays: 60, engWeeksPerWeek: 4, totalCapacity: 48,
  researchSlots: 2,               // concurrent research activities
  startTrust: 60, minTrust: 0, maxTrust: 100,
  trustHitForNo: 12,              // saying no to a favoured feature
  trustGainForYes: 8,
  lowTrustEng: 40,                // below this, estimates inflate 30%
  lowTrustCeo: 35,                // below this, the CEO inserts a feature
  highTrustFavour: 75,            // above this, a stakeholder does you a favour
  slipWarnAt: 0.6,                // fraction of ESTIMATE at which a slip is revealed
  minRationaleChars: 20
}
```

### Core loop

The quarter advances a day at a time. Two things run concurrently:

- **Research activities** occupy one of 2 slots for `instrument.days` days, then
  return a *biased, noisy* reading for the feature studied.
- **The build queue**: features on the roadmap are built in order, consuming
  `engWeeksPerWeek / 5` eng-weeks per working day. A feature **ships** when its
  `trueCost` is fully consumed and only then counts toward the north star. A
  half-built feature at end of quarter is worth **zero**.

At `slipWarnAt` of the *estimated* cost, if `trueCost > estCost`, emit a `slip`
event revealing a revised estimate. This is where optimism bias becomes visceral.

### Observation model — implement exactly

```
reading(feature, instrument) = trueImpact(feature)
                             + Σ_{tag ∈ feature.tags} bias[instrument][tag]
                             + gaussian(0, bias[instrument]._noise)
```

All randomness from a seeded PRNG owned by Product (`Product.init({co, seed})`,
default `20260816`, mulberry32 + Box-Muller). **Never `Math.random()`.**

The A/B test instrument (`ab_test`) has near-zero bias and small noise but may
only be run on a feature that has **already shipped** — reject otherwise with
`"You can only A/B test something that has shipped"`. That asymmetry is the
point: the cleanest instrument arrives after the decision is made.

### API

```js
Product.init({ co, seed })
Product.getState()
Product.research({ featureId, instrumentId })   // -> {ok, activity} | {ok:false, error}
Product.setRoadmap([featureIds])                // ordered; only affects unstarted work
Product.commit({ featureId, predictedImpact, rationale })  // add to roadmap w/ a forecast
Product.drop(featureId)                         // remove; costs trust with its champions
Product.respond({ eventId, choice })            // answer an escalation
Product.advance(days) / Product.step()          // one working day
Product.start()/pause()/setSpeed(m)/destroy()
Product.submitQBR({ narrative, claimedImpact })  // -> Score
Product.exportQBR()                              // markdown for chat
Product.on("tick"|"reading"|"ship"|"slip"|"trust"|"event"|"quarterEnd", fn)
```

### State

```js
{
  day: 27, week: 6, t: "W6 D2", 
  capacityUsed: 31, capacityLeft: 41,
  roadmap:[ {featureId, status:"queued"|"building"|"shipped"|"dropped",
             progress:0..1, engWeeksSpent, revisedEstimate} ],
  shipped:[ids], research:{ running:[Activity], done:[Reading] },
  trust:{ dan:52, rina:71, ... }, avgTrust: 61,
  northStarProjected: 34.8,      // baseline + shipped impacts (revealed as things ship)
  openEvents:[Event], finished:false, qbrSubmitted:false
}
```

`northStarProjected` may only include **shipped** features, and is itself
measured with noise until the quarter ends — a PM does not get a clean readout
of their own impact mid-flight.

### Rejections

`"No free research slots"`, `"That research is already running"`,
`"Not enough capacity left this quarter"`, `"Rationale required"`,
`"Predicted impact required"`, `"You can only A/B test something that has shipped"`,
`"The quarter is over"`, `"That feature already shipped — you can't drop it"`.

### Trust mechanics

- Dropping / declining a feature a stakeholder `favors`: −`trustHitForNo`.
- Shipping one they favour: +`trustGainForYes`.
- Ignoring an escalation event: −15 with the escalator.
- `trust[rina] < lowTrustEng` → all *future* `estCost` shown inflate by 30%.
- `trust[ceo] < lowTrustCeo` → at the next week boundary the CEO **inserts** a
  feature at the head of the roadmap; you cannot drop it for 3 weeks.
- Any stakeholder above `highTrustFavour` grants one favour: an unbiased reading,
  or +4 eng-weeks of capacity, or absorbing an escalation.

### Scoring — `Score`

```js
{
  shippedSet:[ids], northStarActual: 38.9, delta: +7.5,
  bestPossible: 9.8, bestSet:[ids], regret: 2.3,
  grade:"A".."F",                       // regret / bestPossible, bands as in the sibling sims
  wastedCapacity: 14,                   // eng-weeks sunk into things that never shipped
  vanityShipped:[ids],                  // shipped features with true impact < 0.5
  missedWins:[ids],
  trust:{ final:{...}, avg: 58, lost:[...], },
  calibration:{ n, hitRate, meanAbsError, bias, overconfident },
  instrumentUse:{ sales_anecdote:3, ab_test:0, ... },
  perFeature:[ {id, believed, truth, shipped, verdict} ]
}
```

Grade bands on `regret/bestPossible`: A<0.10, B<0.25, C<0.45, D<0.70 else F.
**Two hard modifiers**: shipping ≥2 vanity features caps the grade at C;
finishing with `avgTrust < 40` caps it at C regardless of the metric. You can
win the number and lose the organisation, and the score must say so.

`exportQBR()` returns markdown: the narrative, what shipped, what slipped and by
how much, every research reading with the instrument used, predicted vs actual
per feature, capacity accounting, and the trust ledger. **No ground truth.**

---

## 3. `sim/viz.js` — `window.Viz`

```js
var v = Viz.create(canvasEl, {theme:"dark"});
v.evidence({ rows:[ {feature, readings:[{instrument, value, color}], predicted} ] });
v.gantt({ roadmap, week, totalWeeks, capacityLeft });
v.trust({ stakeholders:[{name, trust, delta}] });
v.impact({ baseline, shipped:[{name, delta}], projected });
v.truth({ perFeature, instruments });   // DEBRIEF ONLY
v.resize();
```

- **`evidence`** is the centrepiece: one row per feature, a dot per instrument
  reading positioned on a shared impact axis, coloured by instrument. When four
  instruments disagree wildly about the same feature, the row must *look*
  contradictory. A legend maps colour → instrument. This is the screen where a
  PM learns that their instruments disagree systematically.
- **`gantt`**: the build queue against the 12-week calendar, with shipped /
  building / queued / slipped states, and a clear end-of-quarter cliff so
  unfinished work reads as worthless.
- **`truth`** (debrief): overlays each feature's true impact on its readings, so
  the *direction* each instrument lied in becomes visible at a glance. Group by
  instrument so the systematic bias is legible, not just the per-feature error.

Dark theme, palette matching the sibling sims (bg `#0d1117`, panel `#161b22`,
border `#30363d`, text `#c9d1d9`, dim `#8b949e`, good `#3fb950`, bad `#f85149`,
warn `#d29922`, accent `#39c5cf`). HiDPI. Monospace. Tabular numerals.
Colour-blind-safe instrument colours. Degenerate input must not throw.

---

## 4. `sim/org.js` — `window.Org`

The people. Same role the trading desk and the research team played.

```js
Org.init({ co, product, onMessage });
Org.tick(state);
Org.getFeed();
Org.GATES = [
  { week:1,  id:"roadmap",  title:"Roadmap review",
    prompt:"Post your quarter plan and priority order to the room in chat." },
  { week:6,  id:"midqtr",   title:"Mid-quarter review",
    prompt:"Marguerite wants the number, what changed, and what you're cutting." },
  { week:11, id:"shipcut",  title:"Ship-or-cut call",
    prompt:"Say what ships, what slips, and who you're about to disappoint." },
  { week:12, id:"qbr",      title:"QBR",
    prompt:"Paste your QBR into chat and defend the quarter." }
];
```

```js
Msg = { day, week, t:"W6 D2", from:"CEO"|"SALES"|"ENG"|"DESIGN"|"SUPPORT"|"CUSTOMER",
        name, text, tone:"neutral"|"pressure"|"warn"|"praise"|"alarm", needsReply:false }
```

### The cast

- **Marguerite Osei — CEO.** Sharp, impatient, pattern-matches to competitors.
  Changes her mind and expects you to keep up. Respects a PM who says no *with a
  reason*, punishes one who says no with a process.
- **Dan Reilly — VP Sales.** Charming, relentless, always has one specific deal
  that will close "if we just had X". His anecdotes are real but unrepresentative.
  He is not lying and that is what makes him dangerous.
- **Rina Chowdhury — Engineering lead.** Dry, protective of her team, allergic to
  scope creep. Her estimates are optimistic and she knows it. Will tell you the
  truth if you have her trust and will hedge everything if you don't.
- **Kofi Adeyemi — Design.** Cares about craft and coherence, pushes visible
  polish over invisible value, genuinely good taste, occasionally precious.
- **Tomás Vidal — Support lead.** Buried, empirical, speaks in ticket volumes.
  Represents existing users loudly and non-users not at all.
- **CUSTOMER** — occasional direct voice from a real account. Sometimes the most
  useful signal in the sim, sometimes wildly unrepresentative.

### Reactive triggers — implement all, each at most once

| Trigger | Voice | Lesson |
|---|---|---|
| committed to a feature with zero research | ENG | you're building on a hunch |
| relied only on `sales_anecdote` for ≥2 commits | SUPPORT | one channel, one bias |
| never used `fake_door` or `ab_test` by week 8 | CEO | no revealed-preference evidence at all |
| ≥3 features queued, none shipped by week 6 | ENG | you're going to ship nothing |
| a slip revealed and roadmap unchanged for 5 days | ENG | a slip is a decision point |
| capacity committed > capacity remaining | ENG | the arithmetic does not care about your plan |
| dropped a feature a stakeholder championed | that stakeholder | saying no has a price |
| research run on an already-decided feature | DESIGN | that's confirmation, not research |
| any stakeholder trust < 35 | CEO | you have an organisational problem now |
| shipped a feature no instrument supported | CEO | on what basis? |
| ≥2 instruments disagree by >3pp and no third run | SUPPORT | triangulate |
| no research at all in a 10-day window | CEO | you are flying blind |
| a research slot idle >5 days | DESIGN | research is cheap, opinions are expensive |

Plus scripted `co.events[]`: the at-risk deal (week 4), a competitor launch
(week 5), an incident eating 5 eng-weeks (week 7), a CEO pet feature (week 8),
an enterprise escalation (week 9). Escalation events set `needsReply:true` and
expect `Product.respond()`; ignoring one costs trust.

One reactive message per tick max; queue priority CEO > ENG > SALES > SUPPORT >
DESIGN > CUSTOMER. 3–5 deterministic phrasings per trigger chosen by a hash of
trigger id + message count. **No `Math.random()`.** `org.js` must NEVER read the
ground truth.

---

## 5. `index.html` + `sim/ui.js` + `sim/ui.css`

Screens: **brief** → **desk** (main) → **gate modal** → **QBR** → **debrief**.

The desk screen:
- Header: week/day, capacity used vs total with a bar, north-star projected,
  avg trust, speed/pause/step, weeks-to-QBR countdown.
- **Feature board**: ten cards — tags, estimated cost, who champions it, its
  research readings as coloured dots, its status. Commit / drop from the card.
- **Research panel**: pick feature + instrument, see days and slot cost, and
  **the instrument's stated caveat** ("tickets come from people who stayed"),
  then run. Running activities with progress.
- **Roadmap / gantt** with drag-free reordering (up/down buttons are fine).
- **Org feed**: right column, colour-coded per person, prominent, with inline
  reply buttons for escalations.
- Commit dialog requires **predicted impact + rationale** — the calibration record.

Debrief: score, grade, `Viz.truth()` reveal grouped by instrument so the
systematic bias is the headline, calibration table, trust ledger, per-feature
verdict, copy-to-clipboard of `exportQBR()`.

Dark, monospace, 1440×900 with no page scroll, `tabular-nums`, no
`alert`/`confirm`/`prompt`, defensive boot diagnostic. Match the sibling sims'
visual language — these are one product family.

---

## 6. NON-NEGOTIABLES

- Only `sim/product.js` may read ground truth, and only for readings and scoring.
- Every commit requires a predicted impact and a rationale.
- Unshipped work is worth exactly zero.
- All randomness from the seeded PRNG; same seed replays identically.
- Instrument caveats are shown *before* the research is run, not after.
- Runs offline from `file://`.
