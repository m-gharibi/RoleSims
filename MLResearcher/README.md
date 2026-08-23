# FOUNDATIONAL ML RESEARCHER SIM

One week on a pretraining team. Six thousand GPU-hours, eight candidate
interventions, and a recipe that locks on Friday whether you are ready or not.

This is not a game about knowing which pretraining tricks work. It is an
apparatus for producing a specific and fairly rare experience: having to say
*yes, put this in the 70B run* about an intervention you have only ever measured
at 1.4B, on three seeds, with a confidence interval that comfortably contains
zero — while a research lead who has read a thousand of these asks you, quietly,
at what scale you measured that and why you think it holds three orders of
magnitude up.

You know the machine learning. What you have probably not had is a compute
allocation small enough to force the arithmetic, a feedback loop long enough that
a bad experiment costs you a day you cannot get back, and someone who owns the
run reading your evidence with the specific intent of finding where you
over-claimed.

---

## RUNNING IT

Double-click `index.html`. That is the whole install.

No server, no build, no network. It runs from `file://`. The world file carries an
encoded ground truth that nothing in the UI reads until you have submitted your
readout, so resist the obvious temptation — decoding it is a two-line job and it
destroys the only thing here worth having.

The week runs on a clock you can pause and fast-forward. Five days, ten hours
each, 09:00 to 19:00, forty-seven working hours between Monday's first launch and
Friday's readout. Jobs advance on that clock. Seeds do not.

---

## THE SCENARIO

You are on the long-context pretraining team at Corvid Research. The next large
run — Meridian-3, 70B parameters — freezes its recipe on Friday evening, and the
question on the table is which interventions go into it to close the long-context
retrieval gap. Eight are proposed, by various people, with various amounts of
evidence behind them. The metric is `LCR@128k`: long-context retrieval accuracy at
128k tokens, averaged over needle, multi-needle and ordered-recall tasks, in points
against a fixed baseline recipe.

Your readout is at Friday 16:00. The freeze is at 18:00 and you are not in that
room, which is the ordinary condition of the job: you write the recommendation, and
somebody else signs it.

You may recommend **at most four**. That is not a budget, it is a risk limit: each
intervention you add is another thing that can interact badly at a scale nobody
has tested, another thing to debug at 03:00 in week three of the run, another
thing whose ablation nobody will ever be able to afford. Four is the number the
run owner will accept without a fight.

Every intervention has a hidden true effect that **varies with model scale**:

```
effect_i(N) = c_i + a_i · (N_ref / N)^gamma_i        N_ref = 70M
```

`c_i` is the asymptote — what the intervention is actually worth at 70B. `a_i` is
the part that only exists at small scale, and `gamma_i` is how fast it dies. There
are also pairwise interaction terms, added when both members of a pair are in the
recipe, and those do not vary with scale at all.

Read that functional form again, because everything below is a consequence of it.
**The quantity you care about is `c_i`, and the quantity your cheap experiments
measure is `c_i + a_i`.** No number of seeds at 70M will separate them. That is
the whole problem, and it is the real one.

---

## THE RULES

| Rule | Value | What it means |
|---|---|---|
| Compute budget | 6,000 GPU-hours | charged **at launch**, for the whole week |
| Concurrent slots | 4 | your allocation; ops can take one away |
| Days | 5 × 10 hours | 47 working hours from Monday 09:00 to the Friday 16:00 readout |
| Max interventions | 4 | enforced at readout |
| Infra failure | 10% base, scaled | worse at large scale and long runs; capped at 45% |
| Kill refund | 50% of unspent | you get back half of what you had not yet burned |
| Hypothesis | mandatory | every launch, ≥20 characters |
| Predicted effect + CI | mandatory | every launch, and this is the calibration record |

The cost, wall-clock and noise model, exactly:

```
cost      = computeHours(scale) × steps.mult × seeds     GPU-hours
wallHours = wallHours(scale)    × steps.mult             seeds are data-parallel
sigma     = sigma(scale) / sqrt(seeds) / sqrt(steps.mult)
```

| Scale | Params | GPU-h per seed at 10k steps | Wall-hours at 10k | σ at 1 seed |
|---|---|---|---|---|
| 70M | 7.0e7 | 12 | 1.5 | 1.80 |
| 300M | 3.0e8 | 45 | 3.0 | 1.20 |
| 1.4B | 1.4e9 | 190 | 7.0 | 0.80 |
| 7B | 7.0e9 | 850 | 18.0 | 0.50 |

Step options multiply both cost and wall-clock: 5k steps ×0.5, 10k ×1.0, 20k ×2.0.

The single most important structural fact in the entire simulation is in those
three lines: **seeds cost GPU-hours and cost no wall-clock; steps cost both.**
Certainty is a thing you buy with budget, not with time. Whether you notice that
on Monday or on Thursday is most of your score.

---

## THE ARITHMETIC, BEFORE YOU PLAY

Do not skip this section. Everything in it is derived from the model above and
none of it is visible from inside the UI until it is too late to act on. Twenty
minutes here is worth more than any single experiment you will run.

### 1. What σ you actually get

95% CI half-width is 1.96σ. At 10k steps:

| Scale | 1 seed | 2 seeds | 3 seeds | 4 seeds |
|---|---|---|---|---|
| **70M** — σ | 1.80 | 1.27 | 1.04 | 0.90 |
| CI half-width | ±3.53 | ±2.49 | ±2.04 | ±1.76 |
| cost | 12 | 24 | 36 | 48 |
| **300M** — σ | 1.20 | 0.85 | 0.69 | 0.60 |
| CI half-width | ±2.35 | ±1.66 | ±1.36 | ±1.18 |
| cost | 45 | 90 | 135 | 180 |
| **1.4B** — σ | 0.80 | 0.57 | 0.46 | 0.40 |
| CI half-width | ±1.57 | ±1.11 | ±0.91 | ±0.78 |
| cost | 190 | 380 | 570 | 760 |
| **7B** — σ | 0.50 | 0.35 | 0.29 | 0.25 |
| CI half-width | ±0.98 | ±0.69 | ±0.57 | ±0.49 |
| cost | 850 | 1,700 | 2,550 | 3,400 |

Read the first row and take it seriously. **A one-seed 70M run has σ = 1.80 and a
95% interval ±3.53 points.** An intervention worth a genuine +1.5 at that scale
comes back indistinguishable from zero — and worse, it comes back with a
*negative* observed effect 20% of the time. One seed at 70M is not a cheap
experiment. It is a coin you are paying twelve GPU-hours to flip.

Sign-error rates, P(observed < 0 | true effect = d), one seed, 10k steps:

| true effect | 70M | 300M | 1.4B | 7B |
|---|---|---|---|---|
| +0.5 | 39% | 34% | 27% | 16% |
| +1.0 | 29% | 20% | 11% | 2% |
| +1.5 | 20% | 11% | 3% | 0.1% |
| +2.0 | 13% | 5% | 0.6% | ~0 |
| +3.0 | 5% | 0.6% | ~0 | ~0 |

The lesson is not "don't run 70M." It is that a 70M singleton answers the question
*is this catastrophic* and no finer question than that.

### 2. The price of precision is fixed by the scale

Substitute the noise model into the cost model. To resolve an effect of size `d`
at 95% confidence you need `1.96σ ≤ d`, which means `seeds × steps.mult ≥
(1.96·σ_scale/d)²`, and since cost is `computeHours × steps.mult × seeds`:

```
cost(d, scale) = computeHours(scale) · (1.96 · sigma(scale) / d)²  =  K_scale / d²
```

The mult cancels. **Seeds and steps are perfectly interchangeable as ways to buy
precision** — but steps also cost wall-clock and raise the failure probability, so
unless you have a reason to believe longer training changes the *effect* rather
than just its estimate, buy precision with seeds.

`K` in GPU-hours, and the resulting price list:

| | 70M | 300M | 1.4B | 7B |
|---|---|---|---|---|
| K | 149 | 249 | 467 | 816 |
| resolve d = 3.0 | 17 | 28 | 52 | 91 |
| resolve d = 2.0 | 37 | 62 | 117 | 204 |
| resolve d = 1.5 | 66 | 111 | 208 | 363 |
| resolve d = 1.0 | 149 | 249 | 467 | 816 |
| resolve d = 0.5 | 597 | 996 | 1,869 | 3,265 |

Two things jump out.

**Precision is quadratic.** Halving your resolvable effect quadruples the bill.
Going from "I can see 2 points" to "I can see 1 point" at 1.4B costs 117 → 467
GPU-hours per intervention. There is no way around this and no clever trick in the
sim that beats it.

**Precision at 7B is only 5.5× the price of precision at 70M**, not 70×. Because
σ falls with scale as well as cost rising, `K_7B / K_70M = 816 / 149 = 5.5`. The
intuition that small models are where you do cheap science is *much* weaker than
it feels — you are not buying 70× more experiments, you are buying 5.5× more
experiments *of a quantity you do not care about*. That single ratio should
reshape your Monday plan.

### 3. Eight interventions do not fit

Cost of screening all eight singletons to a given resolution, against a 6,000-hour
budget:

| resolution | 70M | 300M | 1.4B | 7B |
|---|---|---|---|---|
| d = 3.0 | 133 (2%) | 221 (4%) | 415 (7%) | 726 (12%) |
| d = 2.0 | 299 (5%) | 498 (8%) | 934 (16%) | 1,633 (27%) |
| d = 1.5 | 531 (9%) | 885 (15%) | 1,661 (28%) | 2,903 (48%) |
| d = 1.0 | 1,195 (20%) | 1,991 (33%) | 3,737 (62%) | 6,531 (109%) |

A full 7B sweep at 1-point resolution costs more than the entire week. A full 1.4B
sweep at 1-point resolution is 62% of everything you have and leaves you nothing
for combinations, nothing for a large-scale confirmation, and nothing for
failures. This is the allocation problem, stated exactly: **you cannot measure
everything well, so decide on Monday which questions deserve precision and which
deserve only a sign.**

The corollary most people miss: screening is cheap and confirmation is expensive,
so the screen should be *deliberately* underpowered and everyone should know it.
Eight singletons at 300M / 2 seeds is 720 GPU-hours — 12% of budget, six hours of
wall-clock across four slots, done before Monday lunch — and gives you ±1.66 on
each. That is enough to rank, not enough to decide. Say so when you post the plan.

### 4. Multiplicity: run eight tests and one of them lies

Eight independent tests at 95% confidence, all interventions truly null: expected
false positives 0.4, and

```
P(at least one false positive) = 1 − 0.95^8 = 34%
```

A third of the time, your screen hands you a winner that does not exist. Combine
that with the winner's curse — you select the top of a noisy ranking, so the top
is biased upward — and the practical rule is: **the best-looking result in your
screen is the one most likely to be noise, and it is the one you should replicate,
not the one you should promote.**

You can put a number on the shrinkage. If you think the eight true effects are
roughly `N(0, τ²)` with τ = 2 points, the posterior mean given an observation `x`
with standard error σ is `x · τ²/(τ² + σ²)`:

| measurement | σ | shrink factor | an observed +3.0 is really about |
|---|---|---|---|
| 70M, 1 seed | 1.80 | 0.55 | +1.66 |
| 70M, 3 seeds | 1.04 | 0.79 | +2.36 |
| 300M, 1 seed | 1.20 | 0.74 | +2.21 |
| 1.4B, 1 seed | 0.80 | 0.86 | +2.59 |
| 1.4B, 2 seeds | 0.57 | 0.93 | +2.78 |
| 7B, 2 seeds | 0.35 | 0.97 | +2.91 |

τ = 2 is an assumption, not a fact — pick your own after you read the brief, and
write it in the journal. But the shape holds regardless: at 70M with one seed you
should mentally halve everything you see, and at 7B you should take it nearly at
face value. This table is the closest thing to a cheat code in the whole
simulation, and it is just Bayes.

### 5. The extrapolation problem, which is the actual point

The fraction of the scale-dependent term `a_i` still present at each scale:

| gamma | 70M | 300M | 1.4B | 7B | 70B |
|---|---|---|---|---|---|
| 0.50 | 1.00 | 0.483 | 0.224 | 0.100 | 0.032 |
| 0.75 | 1.00 | 0.336 | 0.106 | 0.032 | 0.006 |
| 1.00 | 1.00 | 0.233 | 0.050 | 0.010 | 0.001 |
| 1.50 | 1.00 | 0.113 | 0.011 | 0.001 | ~0 |

The bias in using a measurement at scale `s` as your estimate of the run-scale
effect is `a·(carry_s − carry_70B)`. Take an intervention with `a = 3.0` and a slow
decay, `gamma = 0.5`:

| measured at | bias in points | statistical σ at 2 seeds | which dominates |
|---|---|---|---|
| 70M | +2.90 | 1.27 | **bias, by 2.3×** |
| 300M | +1.35 | 0.85 | bias |
| 1.4B | +0.58 | 0.57 | comparable |
| 7B | +0.20 | 0.35 | noise |

**At 70M the systematic scale error is larger than the statistical error, and
seeds do not touch it.** You can spend 144 GPU-hours getting σ down to 0.52 at 70M
and have a beautifully precise estimate of a number that is off by 2.9 points.
Seeds buy precision; scale buys relevance; they are not substitutes and no amount
of one converts into the other. If you take one sentence out of this file, take
that one.

### 6. Can you even measure the slope? Usually not

The obvious response is: measure at two scales and fit the curve. Price it.

Testing whether the effect differs between two scales means testing a difference,
with `σ_diff = sqrt(σ₁²/k₁ + σ₂²/k₂)`:

| design | σ_diff | detectable difference (95%) | cost |
|---|---|---|---|
| 70M ×1 and 1.4B ×1 | 1.97 | 3.86 | 202 |
| 70M ×3 and 1.4B ×3 | 1.14 | 2.23 | 606 |
| 70M ×4 and 1.4B ×2 | 1.06 | 2.08 | 428 |
| 70M ×6 and 7B ×2 | 0.82 | 1.60 | 1,772 |

With gamma = 1 the 70M-to-1.4B difference is `0.95·a`, so the cheap two-point
design only detects scale-dependence when `a > 4.1` points. Most interventions
will not clear that bar, which means: **for most of the eight, you will not be
able to measure whether the effect decays with scale. You will have to reason
about it from mechanism.** An architectural change to positional encoding and a
data-mixture change have different reasons to persist or vanish at 70B, and that
argument — not your regression — is what you will actually be defending on Friday.

Also worth knowing before you get clever with curve-fitting: the two-point fit for
`c` is unbiased but noisier than just using your largest measurement directly. With
70M×1 (σ 1.8) and 1.4B×1 (σ 0.8) and gamma known to be 1, the fitted `c` has
σ = 0.85, *worse* than the 1.4B point's own 0.80, whose bias is only `a/20`. The
plug-in estimator beats the fit unless `a > 5.6`. Multi-scale data earns its keep
by telling you about *shape and sign*, not by sharpening the asymptote.

### 7. Interactions cost 9× and there are 28 of them

An interaction is estimated as `delta = E(A+B) − E(A) − E(B)`, three measurements,
so `σ_delta = σ·sqrt(3/k)` and — running the same algebra as §2 — resolving an
interaction of size `delta` costs **nine times** what resolving a main effect of the
same size costs.

| design | σ_delta | detectable delta (95%) | cost |
|---|---|---|---|
| 300M, 1 seed/arm | 2.08 | 4.07 | 135 |
| 300M, 3 seeds/arm | 1.20 | 2.35 | 405 |
| 1.4B, 1 seed/arm | 1.39 | 2.72 | 570 |
| 1.4B, 2 seeds/arm | 0.98 | 1.92 | 1,140 |
| 1.4B, 3 seeds/arm | 0.80 | 1.57 | 1,710 |
| 7B, 1 seed/arm | 0.87 | 1.70 | 2,550 |

Eight interventions have 28 pairs. At 1.4B with 2 seeds per arm — and reusing the
singleton arms you already paid for — each additional pair is 380 GPU-hours, so
the full pair map is 10,640. You are not going to map the interaction surface.
**You get to test two or three combinations, chosen by argument.** Pick pairs where
you can say *why* they would interact: two interventions touching the same
mechanism, two competing for the same capacity, one that changes the data
distribution the other one's inductive bias assumes.

And note the asymmetry that makes this urgent: the interactions in this world are
scale-independent. Whatever `delta` you measure at 1.4B is the `delta` at 70B, in
full. Interactions are the one thing you can measure cheaply and trust
completely — the exact opposite of main effects. Almost nobody exploits that.

### 8. Failures, and the wall clock you forgot about

Failure probability is `0.10 × scaleMult × steps.mult`, capped at 0.45, decided at
launch and revealed at a uniform 20–90% of the way through — so a failure costs
you about 55% of the compute *and* 55% of the wall-clock, on average.

| config | p(fail) | expected GPU-h to get one good result |
|---|---|---|
| 70M, 10k, 1 seed | 6% | 12 |
| 300M, 10k, 2 seeds | 9% | 95 |
| 1.4B, 10k, 2 seeds | 13% | 411 |
| 1.4B, 20k, 2 seeds | 26% | 907 |
| 7B, 10k, 1 seed | 20% | 967 |
| 7B, 10k, 3 seeds | 20% | 2,901 |
| 7B, 20k, 2 seeds | 40% | 4,647 |

The 20k-step 7B row is the trap: 3,400 GPU-hours committed, 57% of the budget, on
a job with a **40% chance of dying**, taking 36 wall-hours you cannot get back.

The mitigation is free and almost nobody finds it. Failure probability depends on
scale and steps but **not on seeds**. So a 3-seed 7B job and three separate 1-seed
7B jobs cost the same 2,550 GPU-hours and yield the same combined σ = 0.29 — but
the single job has a 20% chance of returning nothing, and the three jobs have a
0.8% chance of all failing. Same expected waste, radically different tail. The cost
is slots: three instead of one, for 18 hours.

Deadlines. The readout is at cumulative hour 47. The **latest moment you can
launch** each configuration and still see the result:

| config | wall-hours | launch by |
|---|---|---|
| 7B, 20k | 36.0 | **Tue 10:00** |
| 7B, 10k | 18.0 | **Wed 18:00** |
| 1.4B, 20k | 14.0 | Thu 12:00 |
| 7B, 5k | 9.0 | Thu 17:00 |
| 1.4B, 10k | 7.0 | Fri 09:00 |
| 300M, 20k | 6.0 | Fri 10:00 |
| 1.4B, 5k | 3.5 | Fri 12:30 |
| 300M, 10k | 3.0 | Fri 13:00 |
| 70M, 10k | 1.5 | Fri 14:30 |

And if you want the *option* to retry a 7B 10k run after a failure — 20% likely,
discovered on average 9.9 hours in — you must launch the first attempt by hour
19.1, which is **Tuesday 18:00**. Your large-scale confirmation has to start on
Tuesday, which means your screening has to be finished on Monday, which means your
Monday plan has to be right. That constraint propagates backwards through the
entire week and it is invisible unless you compute it.

### 9. One worked allocation

Not the answer — an existence proof that a coherent week fits inside the budget.

| when | what | cost | cumulative |
|---|---|---|---|
| Mon | all 8 singletons, 300M, 10k, 2 seeds (±1.66) | 720 | 720 |
| Tue | top 4 candidates, 1.4B, 10k, 2 seeds (±1.11) | 1,520 | 2,240 |
| Tue am | first 7B confirmation of the leading candidate, 10k, 1 seed | 850 | 3,090 |
| Wed | 2 combination arms, 1.4B, 10k, 2 seeds | 760 | 3,850 |
| Thu | the proposed 4-way recipe at 7B, 5k, 2 seeds (σ 0.50) | 850 | 4,700 |
| — | reserve for failures and one surprise | 1,300 | 6,000 |

Wall-clock: Monday's eight 3-hour jobs are two waves across four slots, six hours,
done by 15:00. The 7B/10k launched Tuesday 09:00 lands Wednesday 17:00 — the last
possible launch for it is Wednesday 18:00, so going a day early is what buys the
retry. The Thursday run is 7B at 5k steps precisely because 10k no longer fits: 9
wall-hours, launched by 17:00, back before the readout, and two seeds recover the
same σ = 0.50. That is what "planning
backwards from the deadline" produces, and it is a very different-looking week
from the one you get by launching whatever seems interesting on Monday morning.

Note what it does *not* buy: any single number to better than ±1.1, any map of the
interaction surface, and any direct measurement at 70B. Those are not oversights.
They are what 6,000 hours does not cover, and being able to say that out loud on
Friday is worth more than pretending otherwise.

---

## THE PROTOCOL FOR THE WEEK

The simulator is the smaller half of this. The chat gates are where the learning
happens, because they force you to state a position before the evidence resolves
it and then confront the record afterwards.

Open a Claude conversation next to the browser before you launch anything, and
paste this in:

> You are running a pretraining research team. Read
> `lead/RESEARCH_LEAD_PLAYBOOK.md` and follow it exactly. I am the researcher. I
> will bring you a Monday research plan, a Wednesday midweek review, and a Friday
> readout. You do not know the ground truth and must never pretend to. Stay in
> character.

Then:

**1. Read the brief (10 min).** The scenario, the metric, the prior evidence the
team already believes, and the eight interventions. Read the prior-evidence
section twice — some of it is load-bearing and some of it is a rival team's
unreplicated claim, and the brief will not tell you which.

**2. Write your priors in `journal/day1.md` BEFORE you plan.** All eight, with a
number and a reason, before any evidence exists. This takes fifteen minutes and it
is the single highest-value thing in the file, because on Friday it is the only
record of what you actually thought as opposed to what you will remember thinking.

**3. Post the research plan to Yuki in chat (10 min).** Not a list of experiments —
a plan. What decision are you making, what would change your mind about each
intervention, how is the compute allocated and why, what is your stopping rule,
and what is your answer to the extrapolation problem. She scores it on five
criteria and tells you the score. A plan that is really a to-do list scores 3 and
she will say so.

**4. Run Monday and Tuesday.** Launch, watch, re-plan. Every launch requires a
hypothesis and a predicted effect with an interval. Type the real prediction, not
a hedge — a ±5 interval on every experiment makes you perfectly calibrated and
completely useless, and Yuki checks for exactly that.

**5. Midweek review, Wednesday 14:00 (10 min).** The clock stops. Yuki wants three
things: your current belief about each intervention with a number, the evidence
behind it, and what you are cutting. Half the budget is gone. This gate exists to
make you kill something.

**6. Run Thursday and Friday morning.** Your last large-scale launch has already
happened or it is not happening. Spend Thursday on the things that change the
recommendation, not the things that make it more precise.

**7. Friday readout, 16:00 (15–20 min).** Pick your ≤4, state a confidence, write
the rationale, submit. Copy the exported markdown and paste the whole thing into
chat. Yuki goes intervention by intervention. She is judging the **quality of the
inference**, not whether you were right — she does not know whether you were
right — and she will take apart a lucky correct call as readily as a
well-reasoned wrong one.

**8. Debrief (20 min).** The reveal screen shows the true curves against your
measured points. Then run `lead/DEBRIEF.md` in chat. This is where the exercise
actually pays out: the gap between the dashed line and your error bars is a
picture of your own epistemics, and it is worth sitting with.

**9. Journal.** Fill in `journal/day5.md` before you look at the score. The
template makes you commit first for a reason.

**Budget: about 90 minutes end to end.** Roughly 20 minutes of arithmetic and
priors, 30 minutes of running the week, 25 minutes across the three gates, and 15
minutes of debrief. Do not run the debrief immediately after the readout if you can
help it — the reveal is more useful once you have stopped defending yourself.

---

## WHAT THIS IS AND WHAT IT ISN'T

**The scaling model is deliberately, aggressively simple.** Two terms and a power
law: an asymptote plus something that decays. Real interventions do not behave
like this. Real effects are non-monotonic in scale; they interact with the
learning-rate schedule, the data mixture, the sequence length and the batch size;
they change sign when you switch tokenizers; they show up on one eval and vanish on
another; and the eval itself has its own noise floor that is not Gaussian and is
not independent across runs. Pairwise interactions here are constant and additive,
which is close to the least realistic thing in the file — real recipes fail
through three-way interactions that nobody could have priced. The model was chosen
so that the *decision structure* is honest even though the *physics* is a cartoon.

**The noise is Gaussian, independent, and correctly specified.** You know σ before
you launch. In a real lab you do not: seed variance is estimated from a handful of
runs, it is heteroscedastic across scales and interventions, and the number people
quote is usually from a different configuration than the one they are quoting it
about. Being handed a correct σ removes the single largest source of real research
error. Treat the calibration numbers this sim gives you as a ceiling on how
well-calibrated you would be with real infrastructure.

**Nobody here is trying to deceive you except Team Halberd, and only mildly.**
Real internal claims are wrong far more often, and more subtly, and the person who
made them is a colleague you have to work with next quarter.

**What this can actually give you.** The experience of allocating a scarce
resource against a decision with a real deadline. The specific discomfort of
committing to a recommendation with an interval that includes zero, because
Friday came. A concrete, felt understanding of why small-scale ablations are the
most over-trusted artifact in the field — not as a slogan, but because you watched
yourself do it and then saw the curve. Practice separating decision quality from
outcome quality when someone is pressing you on both at once. And a working
vocabulary for the compute-allocation conversation that you cannot get from
papers, because papers report the experiments that survived, never the allocation
that produced them.

**What it cannot give you and will not give you.** Any ML skill whatsoever. You
will not learn whether any of the eight interventions works, because every number
behind them was invented by the person who wrote the world file. You
will not learn anything about long-context training. There is no code here that
would run, no infrastructure that could break in the ways real infrastructure
breaks, no eval harness with a bug in it, no dataset with a contamination problem,
and no five-week debugging detour that turns out to be the whole quarter.

**One week is also not a sample of you.** You will make roughly ten to twenty
launch decisions and one recommendation. If you get an A, the honest reading is
that you made a defensible allocation and the ground truth was kind; if you get a
D, the honest reading is that one of those things went wrong and the debrief will
tell you which. Do not update hard on the grade. Update on the calibration table,
which has ten to twenty observations in it instead of one, and on the specific
question of whether your Friday reasoning would have held up if the truth had come
out the other way.

**If you finish this feeling like you could run a pretraining research programme,
the exercise has failed.** The correct end state is a much sharper sense of how
much of that job is defensible allocation under irreducible uncertainty, and a
correspondingly higher estimate of what the people who do it well are actually
doing.

---

## FILES

```
index.html                        double-click this
data/world.js                     the scenario, the eight interventions, the encoded truth
sim/                              lab engine, plots, team feed, UI
lead/RESEARCH_LEAD_PLAYBOOK.md    how Claude runs Yuki and the team — the good one
lead/DEBRIEF.md                   the post-reveal debrief, run after the readout
journal/TEMPLATE.md               the daily research log
journal/day1..5.md                your five days
SPEC.md                           the build contract
```
