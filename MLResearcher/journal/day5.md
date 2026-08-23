# RESEARCH LOG — Day 5, Friday | Date ________

Compute remaining: ______ / 6,000. Wall-clock to the readout: ______ hours.
The readout is at 16:00. The recipe freezes at 18:00 and you are not in that room.

Today has one job. Everything above the line marked **DO NOT CROSS** must be
written before you press submit, and nothing above that line may be edited
afterwards. The value of this file rests entirely on that.

---

## PART 0 — LAST LAUNCHES

Anything you start today must return before 16:00: 1.4B / 10k by 09:00, 300M / 10k
by 13:00, 70M / 10k by 14:30.

| # | Interventions | Config | Cost | σ | ±95% | Predicted | My 95% CI | What it could still flip |
|---|---|---|---|---|---|---|---|---|
| 1 | | | | | | | [ , ] | |
| 2 | | | | | | | [ , ] | |

**If I launched nothing today, why not?** ("Because nothing could change the
recipe" is the right answer if it is true. "Because I ran out of budget on Tuesday"
is a different answer.)

>

**Final results in:**

| Time | Interventions | Config | Predicted | Observed | ±95% | Inside CI? | Surprise (σ) |
|---|---|---|---|---|---|---|---|
| | | | | | | | |
| | | | | | | | |

---

## PART 1 — FINAL BELIEF STATE

Every intervention, effect at **70B**, one last time. Fill the whole table
including the ones you never measured.

| # | Intervention | Central at 70B | 80% interval | Largest scale measured | Seeds | ±95% at that scale | Evidence quality: measured / extrapolated / prior only / somebody's claim |
|---|---|---|---|---|---|---|---|
| 1 | | | [ , ] | | | ± | |
| 2 | | | [ , ] | | | ± | |
| 3 | | | [ , ] | | | ± | |
| 4 | | | [ , ] | | | ± | |
| 5 | | | [ , ] | | | ± | |
| 6 | | | [ , ] | | | ± | |
| 7 | | | [ , ] | | | ± | |
| 8 | | | [ , ] | | | ± | |

**Interactions I believe in, and the evidence:**

| Pair | Estimated delta | Measured or argued? | ±95% if measured |
|---|---|---|---|
| | | | |
| | | | |

**Any intervention I believe is net negative at 70B:** ______
*(Shipping a regression caps the grade at C regardless of everything else. If one
of your four has a central estimate below zero, you should be able to say in one
sentence why you are shipping it anyway. If you cannot, take it out.)*

---

## PART 2 — THE COMMITMENT

**Write this before you submit. Then submit. Then stop reading.**

### The recommendation

| Slot | Intervention | Central effect at 70B | 95% interval | The single sentence of justification |
|---|---|---|---|---|
| 1 | | | [ , ] | |
| 2 | | | [ , ] | |
| 3 | | | [ , ] | |
| 4 | | | [ , ] | |

**Expected total effect of this recipe at 70B, including interactions:** ______
**My 80% interval on that total:** [ ______ , ______ ]
**Confidence I am submitting:** ______%

**What "confidence ___%" means, in a sentence I would defend:**

>

*(If you cannot say what the number means operationally, it is decoration. A
defensible version: "70% is my probability that this set is within one point of the
best available set." An indefensible version: "70% means I feel fairly good about
it.")*

### The strongest case against my own recommendation

Written by me, at full strength, as a hostile reviewer would put it. Three
sentences minimum:

>

### What I am NOT shipping and why

| Intervention | Central | Why it is out | What would have changed that |
|---|---|---|---|
| | | | |
| | | | |
| | | | |
| | | | |

**The one I am least comfortable leaving out:**

>

### The decision I would make again regardless of the outcome

Name the single call this week where you had thin evidence, reasoned it through
honestly, and committed. This is the one you will be tempted to disown in twenty
minutes:

>

### Predictions about my own score

Before you see any of it. This is a second calibration test and it is free.

| | My prediction |
|---|---|
| Grade (A–F) | |
| Regret as a fraction of best possible | |
| Number of my four that are actually good | |
| Number of good ones I left out | |
| Have I shipped a regression? (y/n) | |
| My calibration hit rate across the week | |
| My signed bias (am I optimistic or pessimistic?) | |
| Fraction of compute that went to failed jobs | |

### The defence with Yuki

**The question I had the least good answer to:**

>

**Where she said the claim was bigger than the evidence:**

>

**The grade she gave my inference on each recommended intervention** (A–D, assigned
before either of us knew anything):

| Intervention | Grade | Why |
|---|---|---|
| | | |
| | | |
| | | |
| | | |

---

# ─────────── DO NOT CROSS UNTIL SUBMITTED ───────────

Everything above is sealed. Nothing below is allowed to change it.

---

## PART 3 — AFTER THE REVEAL

### The score

| | Actual | I predicted |
|---|---|---|
| Grade | | |
| True effect of my set at 70B | | |
| Best possible | | |
| Regret | | |
| Regret / best possible | | |
| Shipped a regression? | | |
| Missed good interventions | | |
| Compute spent | | |
| Calibration hit rate | | |
| Mean absolute error | | |
| Signed bias | | |

**Where my prediction of my own score was worst, and what that says:**

>

### Per-intervention: what was true, and what I inferred

| # | Intervention | My final central | Truth at 70B | Error | Largest scale I measured | Was my inference sound given what I had? (A–D) |
|---|---|---|---|---|---|---|
| 1 | | | | | | |
| 2 | | | | | | |
| 3 | | | | | | |
| 4 | | | | | | |
| 5 | | | | | | |
| 6 | | | | | | |
| 7 | | | | | | |
| 8 | | | | | | |

**Reminder: the last column is not allowed to be lower for an intervention just
because the truth came out against you, or higher because it came out your way.**
Compare it to the grades Yuki assigned in Part 2. Any row where the two disagree is
hindsight, and it is worth more attention than any row where they agree.

### Decision quality versus outcome quality

**Calls that were well-reasoned and turned out wrong:**

>

*(These are the ones to protect. Note them specifically, because the score will
otherwise talk you out of repeating exactly the behaviour you should repeat.)*

**Calls that were badly reasoned and turned out right:**

>

*(These are the dangerous ones. A lucky win installs a habit that will cost you the
next four decisions.)*

**Where the truth curve and my measured points diverged most** — read it off the
reveal plot. Which intervention, at what scale, and by how much:

>

**Was the divergence dominated by scale bias or by seed noise?** Compute both: the
scale bias is truth-at-70B minus truth-at-the-scale-I-measured; the noise is
my-observation minus truth-at-that-scale. Which one was bigger?

>

*(This single comparison is the most useful thing in the entire debrief. If bias
dominated, your problem was allocation and no number of seeds would have fixed it.
If noise dominated, your problem was precision and it was purchasable. They are
different jobs and most people diagnose the wrong one.)*

---

## PART 4 — CALIBRATION FOR THE WEEK

From the exported readout table.

| | |
|---|---|
| Launches with a prediction | |
| Hit rate (truth inside my stated CI) | |
| Mean CI width I stated | |
| Mean absolute error | |
| Signed bias | |
| Hit rate on experiments at ≤300M | |
| Hit rate on experiments at ≥1.4B | |

**If my hit rate is well below 95%, was it because my intervals were too narrow or
my centres were off?** They imply different corrections — widen, or recentre — and
the mean absolute error against the mean CI width tells you which:

>

**If my hit rate is at or above 95% with intervals wider than ±3**, I was not
calibrated, I was abstaining. Where did I hedge, and what was I protecting?

>

**Was my bias uniform, or concentrated on the interventions I wanted to be true?**
Split the signed error by whether the intervention was in my Monday top two:

>

---

## PART 5 — THE WEEK

**The largest allocation error, priced in GPU-hours:**

>

**The best decision of the week, independent of how it turned out:**

>

**What I would do with 6,000 hours and the same eight interventions, starting
again, knowing only what I knew on Monday morning:**

>

**The failure pattern that was mine** — pick one and provide the evidence:
over-reading a single seed / ignoring interval width / only measuring cheap /
never testing combinations / trusting an unreplicated claim / seeking confirmation
rather than falsification / buying precision after the decision was made / refusing
to commit under a real deadline.

>

**One sentence, about myself rather than about the interventions, that I want to
still have in a year.** Not about ML. About how I behave when the evidence is thin
and somebody is waiting:

>

---

Now open `lead/DEBRIEF.md`.
