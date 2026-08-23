# RESEARCH LOG — Day 1, Monday | Date ________

Compute: 6,000 / 6,000 GPU-hours. Wall-clock to the readout: 47 hours. Slots: 4.

Today is the only day on which you have no data at all. That makes it the only day
on which your priors can be recorded honestly, and it is the reason this file is
longer than the other four. **Everything in Parts 0, 1 and 2 must be written before
your first launch.** Once a result lands, your memory of what you believed this
morning is no longer evidence about what you believed this morning.

Budget 25 minutes for this before you touch anything. It is the highest-value 25
minutes of the week.

---

## PART 0 — THE ARITHMETIC, IN YOUR OWN HAND

Copy these out yourself rather than reading them off the README. The point is to
have the numbers in your fingers, not on a screen.

**What one experiment at each scale costs and what it can see** (10k steps):

| Scale | GPU-h/seed | wall-h | σ @1 seed | ±95% @1 seed | ±95% @3 seeds | cost @3 seeds |
|---|---|---|---|---|---|---|
| 70M | 12 | 1.5 | 1.80 | ± | ± | |
| 300M | 45 | 3.0 | 1.20 | ± | ± | |
| 1.4B | 190 | 7.0 | 0.80 | ± | ± | |
| 7B | 850 | 18.0 | 0.50 | ± | ± | |

**The smallest effect I can resolve at 95%, and what it costs**, using
`cost = K/d²` with K = 149 / 249 / 467 / 816 for 70M / 300M / 1.4B / 7B:

| To resolve | 70M | 300M | 1.4B | 7B |
|---|---|---|---|---|
| d = 2.0 | | | | |
| d = 1.0 | | | | |
| × 8 interventions at d = 1.0 | | | | |

Write the last row as a percentage of 6,000 and look at it for a moment.

**The three structural facts I am going to forget by Wednesday:**

1. Seeds cost compute and no wall-clock; steps cost both and raise the failure
   rate. Precision is bought with ______.
2. An interaction costs ____× a main effect of the same size, and interactions in
   this world are ______-independent, which means a measurement at 1.4B is
   ______ at 70B.
3. The last moment I can launch a 7B / 10k run is ____________, and the last moment
   I can launch one *and still have room for a retry after a failure* is
   ____________.

**The quantity I actually care about is `c`. The quantity a 70M run measures is
______.** For an intervention with a = 3 and gamma = 0.5, a 70M measurement is
biased by ______ points, and adding seeds reduces that bias by ______.

---

## PART 1 — PRIORS, BEFORE ANY EVIDENCE EXISTS

All eight. A number and an 80% interval for the effect **at 70B**, plus a
one-line mechanism, plus — the column people skip and the one that matters —
whether you expect the effect to grow, hold, or decay with scale, **and why**.

You will want to write "unknown" in several rows. Don't. An interval of [−3, +3]
is a perfectly respectable statement and it is enormously more useful on Friday
than a blank, because it is falsifiable and a blank is not.

| # | Intervention | Family | Effect at 70B: central | 80% interval | Mechanism, in one line | Scale behaviour: grow / hold / decay, and why |
|---|---|---|---|---|---|---|
| 1 | | | | [ , ] | | |
| 2 | | | | [ , ] | | |
| 3 | | | | [ , ] | | |
| 4 | | | | [ , ] | | |
| 5 | | | | [ , ] | | |
| 6 | | | | [ , ] | | |
| 7 | | | | [ , ] | | |
| 8 | | | | [ , ] | | |

**My prior spread τ** — the standard deviation I think the eight true effects are
drawn from: ______ points. (This sets how hard I should shrink a noisy observation.
At 70M with 1 seed the shrinkage factor is `τ²/(τ² + 1.80²)` = ______, so an
observed +3.0 should move me to about ______.)

**Which two do I most want to be true, and why?**

>

*(Write this down. It is the list of interventions you will scrutinise least, and
knowing that in advance is the only defence available.)*

**Which two do I expect to be net negative at 70B?** Shipping a regression is the
cardinal sin here — it caps the grade regardless of everything else — so name your
suspects now:

>

**Prior evidence from the brief.** Go through it claim by claim. For each: who
measured it, at what scale, and did anybody replicate it?

| Claim | Source | Scale it was measured at | Replicated? | How much weight I give it |
|---|---|---|---|---|
| | | | | |
| | | | | |
| | | | | |

*(If a claim does not state a scale, that is not a gap in your notes. That is the
claim's most important property.)*

**Interactions I believe in before any data.** Which pairs could plausibly collide,
and through what shared mechanism? You will only be able to afford two or three
combination arms all week, so the shortlist is decided by argument, here, today.

| Pair | Why they would interact | Sign I expect | Rough size |
|---|---|---|---|
| | | | |
| | | | |
| | | | |

**Best recipe on priors alone, before spending a single GPU-hour** (≤4):

>

**Expected total effect of that recipe at 70B:** ______ points.

*(Keep this. On Friday, compare it to what you actually recommend. If they are the
same, ask whether the week changed anything — it should have. If they are wildly
different, ask which of your eight priors did the moving and whether the evidence
justified it.)*

---

## PART 2 — THE PLAN I AM POSTING TO YUKI

Draft it here first. She scores it 0–2 on five things, and the score sets how much
of the 6,000 she releases before you have to come back.

**1. The decision.** What is being decided, decomposed into sub-questions, each
with the kind of evidence it needs (a sign / a magnitude / an interaction / a
slope):

>

**2. Priors.** (Reference Part 1 — but state in the plan which two you are least
sure of, because that is where the compute should go.)

>

**3. Compute allocation, and the reason each number is that number.**

| Stage | What | Scale/steps/seeds | Cost | Resolution it buys | Why that resolution is the right one |
|---|---|---|---|---|---|
| Screen | | | | ± | |
| Confirm | | | | ± | |
| Combination | | | | ± | |
| Large-scale | | | | ± | |
| Reserve for failures | | | | — | |
| **Total** | | | **/ 6,000** | | |

**4. Stopping rules.** Both directions — when I stop on a loser, and when I stop on
a winner:

>

**5. The scale-extrapolation plan.** Which interventions get measured at two scales
and whether that comparison can actually detect anything (compute
`1.96·sqrt(σ₁²/k₁ + σ₂²/k₂)` and say the number); and for the ones where it cannot,
the mechanistic argument I will be defending on Friday instead:

>

**Yuki's score: ___ / 10. Compute released: ______ GPU-hours.**

What she said was missing:

>

The one live problem she left me with:

>

---

## PART 3 — WHAT I LAUNCHED TODAY

| # | Interventions | Scale | Steps | Seeds | Cost | σ | ±95% | Predicted | My 95% CI | Decision this resolves | Time launched | ETA |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | | | | | | | | | [ , ] | | | |
| 2 | | | | | | | | | [ , ] | | | |
| 3 | | | | | | | | | [ , ] | | | |
| 4 | | | | | | | | | [ , ] | | | |

**Committed today:** ______ GPU-h = ____% of budget.

**Did I stagger anything, or did I fill all four slots at 09:15?** If all four went
out at once, what later experiment did I just make impossible to condition on
earlier results?

>

---

## PART 4 — IN-SESSION LOG

**Results that came back today**

| Time | Interventions | Config | Predicted | Observed | ±95% | Inside my CI? | Surprise (σ) |
|---|---|---|---|---|---|---|---|
| | | | | | | | |
| | | | | | | | |
| | | | | | | | |
| | | | | | | | |

**The first number of the week.** What did I feel in the ten seconds after it
appeared, and did I immediately want to launch something because of it?

>

**Did any single result make me want to change the plan I had just defended?**
Which, and was the evidence bigger than the noise? (Compute the surprise in σ
before you answer.)

>

**Any failure, preemption, or slot taken.** Cost in GPU-hours and wall-hours, and
what I changed:

>

**One sentence at 19:00, before any analysis:**

>

---

## PART 5 — HOW MY BELIEF CHANGED ON DAY ONE

| # | Intervention | 09:00 central | 19:00 central | Δ | Interval width before → after | What moved it, and at what σ |
|---|---|---|---|---|---|---|
| 1 | | | | | → | |
| 2 | | | | | → | |
| 3 | | | | | → | |
| 4 | | | | | → | |
| 5 | | | | | → | |
| 6 | | | | | → | |
| 7 | | | | | → | |
| 8 | | | | | → | |

**Largest update:** ______ moved ______ points on evidence with σ = ______.
Justified update under my stated τ: ______. Actual: ______. Gap: ______.

**Did anything move that received no evidence today?** If so, that is drift, not
inference. Name it:

>

---

## PART 6 — THE COUNTERFACTUAL

**Same 6,000 hours, same Monday, knowing only what I knew at 09:00 — what would I
allocate differently?**

>

**GPU-hours spent today that bought no decision-relevant information:** ______

**What I now know I will not be able to answer by Friday:**

>

---

## WHAT WOULD CHANGE MY MIND

| Belief I hold | The observation that would break it | Cost (GPU-h) | Running it? |
|---|---|---|---|
| | | | |
| | | | |
| | | | |
| | | | |
| | | | |

---

## ONE RULE FOR TOMORROW

Testable from the experiment log by someone who was not here.

>
