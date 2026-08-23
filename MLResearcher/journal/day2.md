# RESEARCH LOG — Day 2, Tuesday | Date ________

Compute remaining: ______ / 6,000. Wall-clock to readout: ______ / 47 hours.
Slots free: ___ / 4.

Tuesday is the day the first real evidence arrives, which makes it the day you are
most likely to over-update. It is also the last day on which certain experiments
are still possible, and that fact is easy to miss because nothing on the screen
says so.

**Write Part 1 before your first launch. Do not edit it afterwards.**

---

## PART 0 — THE DEADLINE CHECK, DONE FIRST

Do this before anything else today. It takes two minutes and it is the thing people
discover on Thursday.

| Experiment I might still want | Wall-hours | Latest launch | Still possible? |
|---|---|---|---|
| 7B / 20k steps | 36.0 | Tue 10:00 | |
| 7B / 10k steps | 18.0 | Wed 18:00 | |
| 7B / 10k **with room for one retry after a failure** | ~28 expected | **Tue 18:00** | |
| 1.4B / 20k | 14.0 | Thu 12:00 | |
| 7B / 5k | 9.0 | Thu 17:00 | |
| 1.4B / 10k | 7.0 | Fri 09:00 | |
| 300M / 10k | 3.0 | Fri 13:00 | |

**Am I launching anything at 7B today?** If not, write the reason, and write what
would have to be true for me to still be comfortable on Friday recommending for
70B with nothing above 1.4B:

>

**A 7B / 10k job has a 20% failure probability, discovered on average 9.9 hours
in.** If I launch one today and it dies, what is my plan? If the answer is "there
is no plan," I am making a 20% bet on the week with no hedge, and I should say so
out loud rather than discover it Thursday:

>

---

## PART 1 — BEFORE THE FIRST LAUNCH

**Today's decision:**

>

**What Monday's results changed about the plan I defended to Yuki**, and whether
the change was driven by evidence larger than the noise:

>

### Belief state at 09:00

| # | Intervention | Central | 80% interval | Best evidence I have (scale/seeds/±) | Ship today? |
|---|---|---|---|---|---|
| 1 | | | [ , ] | | |
| 2 | | | [ , ] | | |
| 3 | | | [ , ] | | |
| 4 | | | [ , ] | | |
| 5 | | | [ , ] | | |
| 6 | | | [ , ] | | |
| 7 | | | [ , ] | | |
| 8 | | | [ , ] | | |

**How many of the eight have I now measured at all?** ______
**How many at 1.4B or above?** ______

**Current best recipe (≤4) and its expected total at 70B:**

>

### Launches

| # | Interventions | Scale | Steps | Seeds | Cost | σ | ±95% | Predicted | My 95% CI | Decision this resolves |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | | | | | | | | | [ , ] | |
| 2 | | | | | | | | | [ , ] | |
| 3 | | | | | | | | | [ , ] | |
| 4 | | | | | | | | | [ , ] | |

**Committed today:** ______ GPU-h. **Cumulative:** ______ = ____% of budget.

**Is any of today's spend buying precision on a decision I have already made?**
For each launch, state the threshold it has to clear and whether my current
interval already clears it:

>

**Is any of today's spend a falsification test — an experiment whose result could
remove my current favourite from the recipe?** If none of them is, say what I am
doing with the budget instead:

>

---

## PART 2 — IN-SESSION LOG

| Time | Interventions | Config | Predicted | Observed | ±95% | Inside CI? | Surprise (σ) |
|---|---|---|---|---|---|---|---|
| | | | | | | | |
| | | | | | | | |
| | | | | | | | |
| | | | | | | | |

**The result that most surprised me.** Surprise in σ = ______. Was my prior wrong,
or was the experiment too noisy to tell? These need opposite fixes — pick one and
commit:

>

**Did I relaunch or extend anything on the strength of a single seed today?**
Which, how many hours did it cost, and what was σ on the result I acted on?

>

**Did I treat any interval that crosses zero as a positive result?** Go back
through the day's table and check the sign of every lower bound before answering:

>

**A rival claim I am carrying.** Am I reporting it or have I replicated it? What
would replication cost?

>

**Any failure / preemption / slot loss.** Cost in GPU-hours and wall-hours, and
what I changed:

>

**One sentence at 19:00:**

>

---

## PART 3 — HOW MY BELIEF CHANGED

| # | Intervention | 09:00 | 19:00 | Δ | Width before → after | What moved it (σ of the evidence) |
|---|---|---|---|---|---|---|
| 1 | | | | | → | |
| 2 | | | | | → | |
| 3 | | | | | → | |
| 4 | | | | | → | |
| 5 | | | | | → | |
| 6 | | | | | → | |
| 7 | | | | | → | |
| 8 | | | | | → | |

**Largest update:** ______ points on evidence with σ = ______. Justified update
under my τ: ______. Actual: ______.

**Cumulative drift from my Monday priors.** Sum the absolute changes since Day 1
start: ______ points across eight interventions. Is that more or less movement than
my evidence supports?

>

**Anything I explained away today** — a result I decided not to believe, and the
reason. Was the reason available before I saw the number?

>

---

## PART 4 — THE COUNTERFACTUAL

**Same budget, knowing only what I knew at 09:00 — what would I run differently?**

>

**GPU-hours spent today with no decision value:** ______

**On track?** Largest scale at which I have evidence on my current top pick:
______, interval ______. Two days left.

>

---

## WHAT WOULD CHANGE MY MIND

| Belief I hold | The observation that would break it | Cost (GPU-h) | Running it? |
|---|---|---|---|
| | | | |
| | | | |
| | | | |
| | | | |

**Carried from Day 1 and still not run:**

>

---

## ONE RULE FOR TOMORROW

>

**Did I keep yesterday's rule? ___** Evidence:

>
