# RESEARCH LOG — Day 4, Thursday | Date ________

Compute remaining: ______ / 6,000 (____% spent). Wall-clock to readout: ______ / 47.
Slots free: ___ / 4.

Thursday is the last day on which anything you launch changes the recommendation.
The correct question today is not "what would I like to know more precisely" but
"what could still flip a decision" — and if the honest answer is nothing, the
correct move is to stop spending, which is harder than it sounds because unspent
compute feels like waste and is in fact the only kind of spending that is
guaranteed to be waste-free.

**Write Part 1 before your first launch.**

---

## PART 0 — WHAT IS STILL POSSIBLE

| Experiment | Wall-hours | Latest launch | Possible today? |
|---|---|---|---|
| 1.4B / 20k | 14.0 | **Thu 12:00** | |
| 7B / 5k | 9.0 | **Thu 17:00** | |
| 1.4B / 10k | 7.0 | Fri 09:00 | |
| 300M / 20k | 6.0 | Fri 10:00 | |
| 1.4B / 5k | 3.5 | Fri 12:30 | |
| 300M / 10k | 3.0 | Fri 13:00 | |
| 70M / 10k | 1.5 | Fri 14:30 | |

**Interventions with no measurement at all:** ______
If any of these are candidates, today is the last day to fix that, and a 300M /
2-seed run is 90 GPU-hours. If I am going to recommend one of them with no data, I
should write the sentence now and see whether I believe it:

>

**Interventions I am recommending with no measurement above 300M:** ______
The bias in a 300M measurement is `a × 0.23` at gamma = 1 and `a × 0.48` at
gamma = 0.5. For each of these, what is my estimate of `a` and where did it come
from?

>

---

## PART 1 — BEFORE THE FIRST LAUNCH

**Today's decision:**

>

### Belief state at 09:00

| # | Intervention | Central | 80% interval | Best evidence (scale/seeds/±) | In the recipe? |
|---|---|---|---|---|---|
| 1 | | | [ , ] | | |
| 2 | | | [ , ] | | |
| 3 | | | [ , ] | | |
| 4 | | | [ , ] | | |
| 5 | | | [ , ] | | |
| 6 | | | [ , ] | | |
| 7 | | | [ , ] | | |
| 8 | | | [ , ] | | |

**Provisional recipe (≤4) and its expected total at 70B, including interactions:**

>

**The decision-flip test.** For every experiment I am considering today, answer
this before launching it: *what result would change the recipe?* If no result
changes the recipe, the experiment is reassurance and I should not buy it.

| Candidate experiment | Cost | Result that would change the recipe | Probability I put on that result | Launching? |
|---|---|---|---|---|
| | | | | |
| | | | | |
| | | | | |
| | | | | |

**The strongest argument against my own recipe**, written by me, today:

>

**If I have compute left and nothing that passes the decision-flip test**, what am
I doing with the remaining ______ GPU-hours? "Nothing" is an acceptable and
under-used answer. Say which it is:

>

### Launches

| # | Interventions | Scale | Steps | Seeds | Cost | σ | ±95% | Predicted | My 95% CI | What it could flip |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | | | | | | | | | [ , ] | |
| 2 | | | | | | | | | [ , ] | |
| 3 | | | | | | | | | [ , ] | |
| 4 | | | | | | | | | [ , ] | |

**Committed today:** ______. **Cumulative:** ______ = ____%.

---

## PART 2 — IN-SESSION LOG

| Time | Interventions | Config | Predicted | Observed | ±95% | Inside CI? | Surprise (σ) |
|---|---|---|---|---|---|---|---|
| | | | | | | | |
| | | | | | | | |
| | | | | | | | |
| | | | | | | | |

**Did anything today actually flip a decision?** If nothing did, was that because
the evidence confirmed me or because I only bought experiments that could not
disagree with me?

>

**Any failure / preemption / slot loss**, and — with one day left — what it cost me
that I cannot now recover:

>

**A moment today when I wanted to spend just to feel more certain.** Time, trigger,
and whether I did:

>

**One sentence at 19:00:**

>

---

## PART 3 — HOW MY BELIEF CHANGED

| # | Intervention | 09:00 | 19:00 | Δ | Width before → after | What moved it (σ) |
|---|---|---|---|---|---|---|
| 1 | | | | | → | |
| 2 | | | | | → | |
| 3 | | | | | → | |
| 4 | | | | | → | |
| 5 | | | | | → | |
| 6 | | | | | → | |
| 7 | | | | | → | |
| 8 | | | | | → | |

**Total movement from Monday's priors**, per intervention, absolute:

>

**The intervention whose belief moved most across the whole week**, and the total
compute that moved it. Points per thousand GPU-hours: ______

>

**The intervention I still cannot call**, and what I am going to do about that
tomorrow — measure it, ship it on the prior, or drop it on the prior. All three are
legitimate. Refusing to choose is not:

>

---

## PART 4 — THE COUNTERFACTUAL, WITH THE WEEK ALMOST DONE

**Same 6,000 hours, same week, knowing only what I knew on Monday morning — what
is the allocation I would defend now?** Write it as a table, because this is the
answer you will want on Friday when Yuki asks:

| Stage | What | Config | Cost | Why |
|---|---|---|---|---|
| | | | | |
| | | | | |
| | | | | |
| | | | | |

**Total GPU-hours across the week that bought no decision-relevant information:**
______ = ____% of the budget.

**The single largest allocation error of the week**, named and priced:

>

---

## WHAT WOULD CHANGE MY MIND

| Belief I hold | The observation that would break it | Cost (GPU-h) | Affordable tomorrow? |
|---|---|---|---|
| | | | |
| | | | |
| | | | |
| | | | |

**Entries that were never run all week.** For each, the honest reason — too
expensive, or too likely to be inconvenient:

>

---

## ONE RULE FOR TOMORROW

>

**Did I keep yesterday's rule? ___** Evidence:

>
