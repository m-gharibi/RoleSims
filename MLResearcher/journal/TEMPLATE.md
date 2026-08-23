# RESEARCH LOG — Day __ | ______day | Date ________

Compute at the start of the day: ______ / 6,000 GPU-hours remaining
Wall-clock remaining until the Friday readout: ______ hours (of 47)
Slots free: ___ / 4

Fill Part 1 **before you launch anything today**. Fill Part 2 in the moment, in
fragments, as results land — do not tidy it up afterwards. Fill Parts 3 and 4 at
the end of the day, before you look at tomorrow's plan. Ten to fifteen minutes
total.

The rule that makes this file worth anything: **nothing written in Part 1 may be
edited after the first launch of the day.** If you want to change a prior, change
it in Part 3, where the change is visible and dated. A belief you can silently
revise is not a belief, it is a summary of the evidence you have already seen.

---

## PART 1 — BEFORE THE FIRST LAUNCH

**The decision I am trying to make today.** Not "run experiments." The specific
thing that will be truer at 19:00 than it was at 09:00:

>

**Why this decision and not another one.** What makes it the binding constraint on
Friday's recommendation right now:

>

### Belief state at the start of the day

Effect at **70B**, in metric points. Give a central estimate and an 80% interval
for every intervention, including the ones you have no data on — especially those.
"Source" is where the number comes from: prior/mechanism, my own measurement (state
scale and seeds), or somebody's claim.

| # | Intervention | Central | 80% interval | Source of this number | Would I ship it today? |
|---|---|---|---|---|---|
| 1 | | | [ , ] | | |
| 2 | | | [ , ] | | |
| 3 | | | [ , ] | | |
| 4 | | | [ , ] | | |
| 5 | | | [ , ] | | |
| 6 | | | [ , ] | | |
| 7 | | | [ , ] | | |
| 8 | | | [ , ] | | |

**Current best recipe if the run locked in the next hour** (≤4, in order of
confidence):

>

**Expected total effect of that recipe at 70B, including any interaction I believe
in:** ______ points.

### Experiments I am launching today

Fill this in **before** you touch the launch button. The predicted effect here must
be the same number you type into the designer — if they differ, the one in the
designer is the honest one and this file is where you find out that you flinched.

| # | Interventions | Scale | Steps | Seeds | Cost | σ | ±95% | Predicted | My 95% CI | What decision this resolves |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | | | | | | | | | [ , ] | |
| 2 | | | | | | | | | [ , ] | |
| 3 | | | | | | | | | [ , ] | |
| 4 | | | | | | | | | [ , ] | |

**Total committed today:** ______ GPU-hours = ____% of the remaining budget.

**For each experiment above: what result would make me drop the intervention?**
A number, not a direction.

>

**What result would make me stop measuring it because the answer is already good
enough to act on?**

>

**The experiment I considered and did not run, and why:**

>

---

## PART 2 — IN-SESSION LOG

*Write as it happens. Two lines is enough. The reaction in the first ten seconds
after a number lands is the useful data and it is gone by the time you have
rationalised it.*

**Results that came back today**

| Time | Interventions | Scale/steps/seeds | Predicted | Observed | ±95% | Inside my CI? | Surprise (in σ) |
|---|---|---|---|---|---|---|---|
| | | | | | | | |
| | | | | | | | |
| | | | | | | | |
| | | | | | | | |

Surprise in σ is `(observed − predicted) / σ`. Anything past 2 means either your
prior was wrong or your experiment was too noisy to be informative — decide which,
now, in writing, because the fixes are opposite.

**The first result of the day.** What did I feel before I read the number, and what
did I do in the sixty seconds after?

>

**The result I liked.** Did I check it as hard as I checked the ones I disliked?
Be honest — asymmetric scrutiny is the whole disease and it is invisible from the
inside.

>

**The result I disliked.** Did I look for a reason it was wrong? Did I find one, or
manufacture one?

>

**A failed job, a preemption, or a slot taken.** What it cost in GPU-hours and in
wall-clock, and what I changed as a result:

>

**A team message that landed.** Which one, and was my first reaction defensive or
did it name something true?

>

**A moment I wanted to launch something without pricing it.** Time, trigger, and
whether I did:

>

**One sentence, written at the end of the day, before any analysis:**

>

---

## PART 3 — HOW MY BELIEF CHANGED

Numbers, not adjectives. If you cannot state the change as a number you did not
have a belief, you had an attitude.

| # | Intervention | Central at 09:00 | Central at 19:00 | Δ | Interval width before → after | What moved it |
|---|---|---|---|---|---|---|
| 1 | | | | | → | |
| 2 | | | | | → | |
| 3 | | | | | → | |
| 4 | | | | | → | |
| 5 | | | | | → | |
| 6 | | | | | → | |
| 7 | | | | | → | |
| 8 | | | | | → | |

**The largest Δ today was on ______, by ______ points, driven by a measurement
with σ = ______.** Is the size of that update justified by that σ? Compute the
shrinkage: with a prior spread τ, an observation moves your mean by
`(observation − prior) × τ²/(τ² + σ²)`. My τ is ______, so the justified update
was ______ and the update I actually made was ______.

**Anything I did not update on that I should have** (a result I explained away, a
CI I read as more favourable than it was):

>

**Did the intervention I liked best on Monday get more scrutiny or less than the
others today?** Evidence:

>

---

## PART 4 — THE COUNTERFACTUAL

**Same day, same budget, knowing only what I knew at 09:00 — what would I run
differently?**
Concrete: different scale, different seeds, different combination, fewer
experiments, or nothing at all.

>

**Same day, knowing what I know now — what would I run differently?**
This is a different question and the difference between the two answers is
hindsight, which is worth measuring:

>

**GPU-hours I spent today that bought no decision-relevant information:** ______
That is ____% of today's spend. What would that have bought instead?

>

**Am I on track to have something to say about 70B on Friday?**
State it as a number: the largest scale at which I have any measurement of my
current top recommendation is ______, with an interval of ______.

>

---

## WHAT WOULD CHANGE MY MIND

Carry this list forward and extend it every day. Each entry is a specific,
purchasable observation — a scale, a seed count, and a number — not a wish.

| Belief I hold | The observation that would break it | Can I afford it? (GPU-h) | Am I going to run it? |
|---|---|---|---|
| | | | |
| | | | |
| | | | |
| | | | |

**Entries I wrote on a previous day and have not run, with a reason:**

>

*(An entry that stays on this list for three days without being run or struck out
is not a falsification criterion. It is a decoration. Strike it and say why.)*

---

## ONE RULE FOR TOMORROW

Written as something a person reading the experiment log could check — testable,
not aspirational. Not "be more rigorous." Something like "no launch at 70M with
fewer than 3 seeds," or "before any launch over 500 GPU-hours, write the decision
threshold it has to clear."

>

**Did I keep yesterday's rule? ___** Evidence from the experiment log:

>
