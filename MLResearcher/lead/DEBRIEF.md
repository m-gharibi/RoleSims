# THE DEBRIEF — after the reveal

Run this once, after you have submitted the readout and seen the truth curves, in
one sitting. Twenty to thirty minutes. It is the part of the exercise that converts
a week of pattern-matching into something you can still use in six months.

Do it after a break, not in the ten minutes following the score. The reveal
produces a brief, strong urge to relitigate, and nothing said during that window is
worth writing down.

**Setup.** Open a fresh conversation and paste in: this file, the exported readout,
the score and per-intervention verdicts from the reveal screen, and all five
journal days. Then:

> Read `lead/DEBRIEF.md` and run it on me. You are Yuki. You now have the ground
> truth because I have pasted it in — you did not have it during the week, and the
> grades you gave on Friday are not allowed to move. Do the arithmetic yourself
> before you say anything, hold me to Part 5, and do not let me finish this more
> confident than the evidence supports.

Yuki runs Parts 1 through 5. Part 6 is not a role — it is you and Claude out of
character, and it matters more than the rest.

---

## PART 1 — ASSEMBLE THE NUMBERS

Build this before anyone offers an interpretation. Most of the findings fall out of
it on their own.

| | |
|---|---|
| Grade | |
| True effect of my set at 70B | |
| Best possible set / its value | |
| Regret | |
| Regret / best possible | |
| Shipped a regression? | |
| Good interventions missed | |
| Compute spent / 6,000 | |
| Compute lost to failed jobs (GPU-h, %) | |
| Share of compute at ≤300M / at ≥1.4B | |
| Interventions with any measurement at ≥1.4B | |
| Interventions with no measurement at all | |
| Combination arms run | |
| Replications run | |
| Launches with a prediction | |
| Calibration hit rate | |
| Mean CI half-width stated | |
| Mean absolute error | |
| Signed bias | |
| Monday plan score / compute released / compute actually spent before re-planning | |
| Friday inference grades (count of A / B / C / D) | |
| Rules written each day, and rules kept | |

**Three derived numbers to compute explicitly.**

**1. Regret decomposition.** Regret is one number hiding three different mistakes.
Split it:

```
omission   = Σ truth_i over good interventions in the best set that you left out
commission = Σ truth_i over interventions you shipped that the best set omits
             (this term is often negative, which is the point)
interaction= (interactions in the best set) − (interactions in your set)
```

They will not sum exactly to regret unless you account for the ≤4 constraint
forcing swaps, so do it as: value of your set, value of the best set, and then walk
one swap at a time from yours to theirs, pricing each swap. Four swaps or fewer.
**The swap that costs the most is the finding.** Everything else in the debrief is
commentary on it.

**2. Points per thousand GPU-hours.** For each intervention, the total compute
spent on it and the absolute change in your belief about it across the week. The
ordering of that ratio tells you where your money actually went, and it is almost
never where you thought.

**3. Decision distance.** For each of your four, and for each one you rejected: how
far was the call from flipping? Express it in units of the σ you had. A decision
that would have gone the other way on a 0.4-point change, made from a measurement
with σ = 0.8, was a coin flip wearing a rationale. Count how many of your five or
six real decisions were inside 1σ of flipping. If the answer is three, the grade is
mostly a draw from the PRNG and you should say so before you interpret it.

---

## PART 2 — HOW TO READ THE TRUTH-VS-MEASUREMENT PLOT

This plot is the payoff of the whole week: your measured points with their error
bars, and the true effect curves overlaid, on a log-x axis running from 70M to 70B
with your recommendation scale marked. Spend five minutes on it before you talk
about it. There are six things it can be telling you and they demand different
responses.

**A. Your points sit on the curve, but they are all on the left.**
Precision was fine. Relevance was not. You measured `c + a` accurately and
recommended on `c`. The response is not "more seeds" — it is that a fixed fraction
of the budget should have been reserved for the largest scale you could afford,
decided on Monday, before you knew which interventions would look interesting.
This is the single most common outcome and it is the one the sim is built around.

**B. Your points scatter widely around a flat curve.**
The truth had little scale dependence and you were reading noise as structure. Look
at what you did between two consecutive points on the same intervention: if you
changed your plan because a number moved 1.5 points when σ was 1.2, you were
reacting to the PRNG. The response is a minimum-precision rule: never condition a
plan on a measurement whose interval crosses the decision threshold.

**C. The curve decays steeply and all your points are at 70M or 300M.**
The `a` term fooled you, exactly as designed. Check the magnitude: how many points
of the effect you measured were the transient part? If it is more than half, note
that no amount of statistical care at that scale would have helped, and that the
only defences available were (i) measuring higher and (ii) having a mechanistic
prior about which interventions decay. Which of the two did you have?

**D. The curve is flat and you spent heavily proving it.**
You bought a slope measurement on something with no slope. Price it. This is the
mirror of C and it is worth naming because the lesson people take from C — "always
measure at two scales" — produces D, and neither is a rule. The rule is: measure
the slope where you have a mechanistic reason to expect one, and where your design
can actually detect it (`1.96·sqrt(σ₁²/k₁ + σ₂²/k₂)` against the effect size you
care about).

**E. The curve crosses zero between the scale you measured and 70B.**
The dangerous one. An intervention that helps at 300M and hurts at 70B is how
regressions get shipped, and it is why including a net-negative intervention caps
the grade at C regardless of everything else. If this happened to you, go back and
ask what in the evidence could have warned you. Usually: a downward trend across
two scales that was not statistically significant and that you therefore ignored.
Non-significant is not the same as absent, and a non-significant trend that agrees
with a mechanistic prior is real evidence — just not evidence you can publish.

**F. Your error bar does not contain the truth curve at the scale you measured.**
That is honest bad luck and it should happen about 5% of the time. Count the
misses against the number of measurements. If you have twelve measurements and
three misses, either you got unlucky or — more likely — you are misreading which
curve is which. If you have twelve and zero, you also learned something: your week
contained no surprises, which usually means it contained no informative
experiments.

Two summary questions to answer from the plot, in numbers:

> **Bias or noise?** For your most consequential intervention, compute
> `truth(70B) − truth(scale you measured)` — that is scale bias — and
> `your observation − truth(scale you measured)` — that is seed noise. Which was
> larger?

If bias dominated, your problem was allocation, and it was not purchasable with
seeds. If noise dominated, your problem was precision, and it was purchasable, and
you should be able to say what it would have cost (`K/d²`). Most people diagnose
this backwards, because noise is visible on the plot and bias is not.

---

## PART 3 — A GOOD DECISION IS NOT A GOOD OUTCOME

Now do the thing the whole week was built for. Fill in the 2×2 with actual
decisions, by name, from your journal:

| | Turned out well | Turned out badly |
|---|---|---|
| **Well-reasoned** | earned | **the important box** |
| **Badly reasoned** | **the dangerous box** | deserved |

**The important box — good process, bad outcome.** These are the decisions to
protect, and the grade is actively trying to talk you out of them. For each, state
what you knew, what you inferred, and why the inference was correct given the
evidence. Then say, explicitly: *I would make this call again.* If you cannot say
that, either the reasoning was worse than you thought — in which case say so — or
you are letting a result overwrite a process, which is the exact failure this
exercise exists to expose.

**The dangerous box — bad process, good outcome.** These install habits. A 12
GPU-hour, one-seed, 70M result that happened to be a real winner is a lottery
ticket that paid, and the lesson your nervous system will draw from it is "cheap
experiments are fine." Name each one and state the frequency argument: if this
decision were made a hundred times from that evidence, how often does it land? Use
the sign-error table — at 70M with one seed, a true +1.5 comes back negative 20% of
the time and a true 0 comes back above +3.5 about 2.5% of the time. Across eight
interventions, a screen like that produces at least one false positive a third of
the time.

**Cross-check against Friday.** Yuki graded each recommended intervention's
inference A–D *before* either of you knew anything. Put those grades next to the
outcomes:

| Intervention | Friday inference grade | Outcome | Do they agree? |
|---|---|---|---|
| | | | |

**Every row where they disagree is a row worth ten minutes.** If you now feel a
Friday A should be a C because the truth went against you, that feeling is the
hindsight bias operating in real time, and observing it directly is more valuable
than the grade. The grades do not move.

---

## PART 4 — CALIBRATION

You made ten to twenty predictions with intervals under conditions where the truth
was later revealed. That is a rarer dataset than it sounds; almost nobody generates
one about their own research judgement.

### Reading the numbers

**Hit rate** should be near 95% if your intervals meant what they said. Typical is
50–70%.

**But be careful with n.** The standard error on a hit rate from 14 observations is
about 13 percentage points, so a measured 57% is consistent with anything from 31%
to 83%. Do not treat the number as precise. **The direction is far more robust than
the magnitude.** Use a sign test: if 12 of your 14 predictions sat above the
observed value, the two-sided probability of that under no bias is 1.3%. That is a
real finding at this sample size, where the hit-rate point estimate is not.

**Mean CI width against mean absolute error.** These two numbers together tell you
which correction you need:

- Error much larger than the stated half-width → your intervals were too narrow.
- Error much smaller than the half-width, with a high hit rate → you were not
  calibrated, you were abstaining. A ±5 interval on a measurement with σ = 0.8 is
  a refusal to predict with a number attached, and it is a way of never being
  wrong that is also a way of never being useful.

**Split the hit rate by scale.** Your hit rate on ≤300M experiments versus ≥1.4B
experiments. If you were much worse at the cheap end, your intervals were not
tracking σ — you were stating the same uncertainty regardless of how noisy the
experiment was, which means the interval was an expression of confidence rather
than a prediction.

### What to do about systematic overconfidence

Not "be humbler." Two mechanical corrections, both computable from your own data:

**Recentre.** Your signed bias is the average of `predicted − observed`. Subtract it
from your next predictions. If it is +0.9 across fourteen launches, you run about a
point hot, and the correction is a point.

**Rescale.** Find the factor `k` such that 95% of your absolute errors would have
fallen inside `k ×` your stated half-widths. That is your personal inflation
factor. If your intervals need doubling to be honest, then say so and double them —
and notice what that does to your Friday claims, because an honest interval on your
recommendation may well have contained zero, and you would still have had to
recommend, which is the actual condition of the job.

**Then ask where the bias lived.** Split the signed error by whether the
intervention was in your Monday top two. If the optimism concentrates on the ones
you wanted to be true, it is motivated reasoning and the correction is procedural,
not numerical: write predictions before you know which intervention the experiment
is for, or have someone else write them. If the bias is uniform, it is a
mis-centred prior and it is much easier to fix.

---

## PART 5 — WHICH FAILURE DOES THE SCORE REFLECT?

Work through this in order. Stop at the first that fits and diagnose properly
rather than collecting all of them.

**Shipped a regression (grade capped at C).**
Find the intervention. Find every measurement you had on it. Answer: (a) did you
have evidence it was negative and discount it, (b) did you have evidence at a scale
where it was still positive, or (c) did you have no evidence at all? Each is a
different failure — inference, allocation, coverage — and only (b) is
sympathetic. Then ask the useful question: what would a rule like "no intervention
enters the recipe without at least one measurement at or above 1.4B" have cost you
this week, and would it have caught this?

**High regret, budget substantially unspent.**
Under-exploration. Compute what the unspent hours could have bought: at 1.4B,
`467/d²` per intervention. Usually the unspent budget would have covered exactly
the measurement whose absence produced the regret. Ask why you stopped — a stopping
rule that fired, or discomfort with committing large jobs?

**High regret, budget spent, >60% of it at ≤300M.**
Allocation. This is failure mode A from Part 2 and it is the designed-for outcome.
The response is a Monday rule, not a Thursday instinct: a fixed fraction of budget
committed to the largest affordable scale before you know which interventions look
good, precisely so that the allocation cannot be captured by the noisy screen.

**High regret, good coverage at large scale, missed interventions you tested.**
Inference. You had the evidence and read it wrong. Go to those interventions' CIs.
The usual finding is a rejection based on an interval that crossed zero — you
treated "not significant" as "not real" and dropped something with a positive
posterior mean. At a decision deadline, the posterior mean is the decision-relevant
quantity and significance is not. That is a genuinely important distinction and it
is the one most likely to transfer to your actual work.

**High regret concentrated in the interaction term.**
You picked four individually-good interventions that collide. Check whether you ran
any combination arms. If not, note the thing you had access to and did not use:
interactions in this world do not decay with scale, so a 1.4B combination arm
measures the 70B interaction exactly, at 380 marginal GPU-hours. That was the
cheapest reliable evidence in the entire week.

**Low regret, poor calibration.**
A good outcome from a process you cannot repeat. Go to Part 3's dangerous box and
be strict. The grade is not the finding here; the calibration table is.

**Low regret, good calibration.**
The honest good week. Then apply the only remaining check: Part 1's decision
distance. If three of your five real decisions were within 1σ of flipping, the
process was sound *and* you got a favourable draw, and both halves of that sentence
are true. Say both.

**Refused to commit — fewer than four recommended, or a very low confidence.**
Compute what the omitted slots cost in regret. Then note that the decision was made
anyway, by default, and you did not sign it. On a real team that is worse than a
wrong call, because a wrong call is auditable and a non-call is not.

---

## PART 6 — WHAT YOU CAN AND CANNOT CLAIM

### The sample-size problem, with numbers

You made roughly ten to twenty launch decisions and one recommendation, on one
scenario, with one PRNG seed.

- **The grade is close to a single observation.** Regret depends on four decisions,
  several of which were probably inside 1σ of flipping. Re-running the same week
  with the same reasoning and a different seed would move the grade by a band or
  more, in either direction.
- **The calibration table has ten to twenty observations**, which is enough to
  detect the *direction* of a bias by sign test and nowhere near enough to estimate
  its size. Trust the sign, not the magnitude.
- **The ground truth was generated from a two-term power law you now know the form
  of.** Any intuition you developed about "how effects behave with scale" is an
  intuition about that generator, not about transformers.

### What you can legitimately claim

- You know, concretely rather than abstractly, why small-scale ablations are the
  most over-trusted artifact in the field — because you watched yourself trust one
  and then saw the curve.
- You can do the compute-allocation arithmetic quickly: what σ a configuration
  buys, what precision costs (`K/d²`), why interactions cost 9× main effects, and
  why a large single job is a worse bet than the same compute split across seeds.
- You know what it feels like to defend a recommendation whose interval contains
  zero to someone who is going to own the consequences, and you know which of your
  reflexes shows up in that conversation.
- You can separate the quality of an inference from the quality of its outcome
  under conditions where they came apart, on decisions that were yours.
- You have a calibration record about yourself, generated under mild but real
  pressure, which is a thing most researchers never produce.

### What you cannot claim, and should proactively disclaim

- Any knowledge about long-context pretraining, RoPE variants, data mixtures, or
  any actual ML. The numbers were invented.
- That you know how you allocate under a real budget. The largest variables — the
  months, the career stake, the fact that a wrong recommendation is remembered —
  were held at zero.
- That a good grade indicates research judgement. See the decision-distance count.
- That the lab you experienced resembles a specific real lab. It is a composite,
  written to be instructive.

---

## PART 7 — WHAT A REAL RESEARCH SEAT HAS THAT THIS DOES NOT

Read this slowly. Each item is a first-order feature of the actual job that the
simulator removes entirely, and together they are most of what makes the work hard.

**You were handed the problem.** Eight candidate interventions arrived on a card on
Monday morning, pre-named, pre-scoped, all plausible, all measurable with the same
apparatus against the same metric. On a real seat, **generating the candidate list
is the job**, and it is the part that separates people. That means reading widely
enough to notice which failure of the current recipe is actually load-bearing,
having a mechanistic story about why, and proposing something that has not been
tried — while knowing that most of what you propose will be uninteresting, and that
proposing nothing is also a way to fail. You practised the last 20% of the process
and skipped the part that requires taste.

**And there is no tidy list.** The real intervention space is not eight items; it
is a continuum with no natural units. Is "change the data mixture" one intervention
or forty? Does the RoPE base frequency count as the same intervention at 10,000 and
at 500,000? You were spared the fact that the hardest allocation decision in real
research is deciding what counts as a thing to test, and that this decision is made
before any of the statistics apply.

**Months, not days.** Feedback loops in real pretraining research run one to six
weeks. You will launch a run, wait nine days, discover a bug in the eval harness on
day seven, and lose the whole thing. The specific difficulty is not any single
decision — you have now seen that a single decision is survivable — it is holding a
coherent research direction across three months during which almost nothing
resolves, with no evidence available to you about whether the direction is wrong or
merely slow. That sustained ambiguity is the actual load-bearing difficulty of the
profession and no simulator will deliver it.

**The eval is not a given, and it is frequently the bug.** Your metric here was
fixed, clean, unbiased, with known Gaussian noise, and it measured what it claimed
to. Real evals are contaminated, saturated, misaligned with the capability you care
about, sensitive to prompt formatting, and correlated across runs in ways that
destroy your error bars. A meaningful fraction of real research time goes into
discovering that the effect you have been chasing for a month is an artifact of the
harness. You were handed a truthful instrument, which removed the most common
source of wrong conclusions in the field.

**Code that must actually work.** No implementation here. In reality the
intervention has to be written, it has to be numerically stable at bf16 across
thousands of devices, it has to not break the checkpoint format, and the difference
between "the idea does not work" and "my implementation of the idea has a bug" is
often several weeks and is sometimes never resolved. A large share of published
negative results are undiagnosed bugs, and you cannot tell from the outside which
ones.

**The literature.** You reasoned from priors you invented on Monday morning. A real
researcher arrives with a mental index of a few hundred relevant results, most of
which conflict, many of which were measured at scales that make them irrelevant,
and some of which are wrong in ways only visible if you have tried to reproduce
them. Knowing which of those to believe is itself a skill measured in years, and
the compute budget is not the binding constraint on it.

**Collaborators who disagree, and who are sometimes right.** Ana had hunches and
Halberd posted notes, but nobody here had standing to overrule you, nobody had a
competing research programme that your success would defund, and nobody had spent
four years on an approach your result would embarrass. On a real team the
disagreements are held by people with their own evidence and their own careers, the
argument is genuinely two-sided, and being persuaded by the right person for the
wrong reason is a live failure mode.

**Compute is political, not just scarce.** Your 6,000 hours were yours. In reality
the allocation is contested every quarter by teams with better narratives, the
biggest runs go to whoever has the most credibility rather than the best-designed
experiment, and a large part of a senior researcher's job is the sustained argument
that their direction should be funded. That argument is not a distraction from the
science; for senior people it substantially *is* the job.

**The consequences are asymmetric and public.** A recommendation that goes into a
run has a cost measured in millions of dollars and months of a large team's time.
When it is wrong, it is wrong in front of everyone whose respect you want, and it
is remembered. And the reward structure is not symmetric: correctly recommending
*against* an intervention saves the same money and gets you nothing, which is why
real labs over-ship and why "I killed this and here is the evidence" is a rarer and
more valuable artifact than any positive result.

**And you could pause the clock.** Note how often you did.

---

## PART 8 — WHAT THIS WAS FOR

You did not do this to become a pretraining researcher. You did it so that the next
time you are in a room with people who do this work — building for them, hiring
them, arguing with them about what an experiment shows — you have a body memory
instead of a book summary.

**Three things you can do now that you could not before:**

1. **Hear what a researcher is actually saying.** When someone says "it didn't
   transfer," or "we only have it at small scale," or "the ablation was
   underpowered," you now know the specific shape of each of those situations and
   can ask the next question instead of nodding.

2. **Ask better questions.** Not "does it work" — nobody can answer that. Try:
   *At what scale did you measure it, and what's your model of why it holds?*
   *What's your σ, and how many seeds is that?* *What would have made you drop it?*
   *Did you test it in combination with anything?* *Who replicated it?* Those
   identify you as someone who has had to make the call, and they get real answers.

3. **Read a paper's experiment section for the allocation, not the results.** Every
   results table is the visible end of an invisible budget decision. You now know
   what the invisible half looks like — which scales were affordable, which
   comparisons were skipped, which error bars are one seed with a confident caption
   — and that reading is worth more than the numbers in the table.

**One last thing.** Write, in two sentences, the single most surprising thing you
learned about your own judgement this week. Not about scaling laws. About what you
do when the evidence is thin and someone is waiting for an answer. Put it somewhere
you will find it again in a year. That sentence is the entire yield of this project,
and it is worth more than the grade, which was mostly a draw from a seeded PRNG.
