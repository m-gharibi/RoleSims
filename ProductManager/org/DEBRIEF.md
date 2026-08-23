# THE DEBRIEF — after the reveal

Run this once, immediately after the QBR, in one sitting. Twenty to thirty
minutes. It is the part of the exercise that converts ninety minutes of
decision-making into something you can still use in six months.

**Setup.** Open a fresh conversation and paste in: this file, the exported QBR,
`journal/week12.md` including the sealed predictions in Part A3, and the
week-1 prior table. Then:

> Read `org/DEBRIEF.md` and run it on me. You are Marguerite. Here is the QBR,
> the revealed truth, and the predictions I sealed before I saw any of it. Do
> the arithmetic yourself before you say anything, hold me to Part 6, and do not
> let me finish this more confident than the evidence supports.

Parts 1 through 5 are still in character. Part 6 onward is you and Claude out of
character, and it matters more than the rest.

The debrief screen has what you need: the score, the truth-versus-readings plot
grouped by instrument, the calibration table, the trust ledger, and a per-feature
verdict. Have it open.

---

## PART 1 — ASSEMBLE THE NUMBERS

Build this before anyone offers an interpretation. Most of the findings fall out
of the table.

| | |
|---|---|
| North star: baseline → actual | 31.4 → |
| Delta achieved | |
| Best possible delta (`bestValue`) | |
| **Regret** (best − yours) | |
| Regret ÷ best → grade | (A<0.10, B<0.25, C<0.45, D<0.70, else F) |
| Grade capped? | by trust <40 / by ≥2 vanity ships / no |
| Shipped set | |
| Best set (`bestSet`) | |
| Features in both | |
| Wasted capacity (eng-weeks that shipped nothing) | of 43 = ___% |
| Vanity ships (true impact < 0.5 pp) | |
| Missed wins | |
| Realised optimism multiplier | (actual cost ÷ estimate, across everything started) |
| What I planned at in week 1 | |
| Average final trust | (started at 60) |
| Lowest individual trust, and who | |
| Readings taken, by instrument | |
| Research slot-days used / idle | of 120 |
| Calibration: n, hit rate, mean abs error, signed bias | |

### The one derived number that matters most: decompose the regret

Regret is not one failure, it is two, and they call for opposite fixes. Split it:

```
Committed value  = Σ true impact of every feature you committed to,
                   as if all of them had shipped

SELECTION ERROR  = bestValue − committed value
                   (you chose the wrong things)

EXECUTION ERROR  = committed value − achieved delta
                   (you chose things you could not finish)

regret           = SELECTION ERROR + EXECUTION ERROR
```

Compute both and take the ratio. This is the single most useful number in the
debrief and the sim does not print it for you.

- **Selection-dominated** (say, 70/30): your research and prioritisation were the
  problem. You built what you could, you just picked wrong. Fix: instrument
  choice, triangulation, and the willingness to run a slow revealed-preference
  test on the bet that matters.
- **Execution-dominated**: you were right about what mattered and committed to
  more than 43 eng-weeks would carry. Fix is arithmetic, not judgment — a
  multiplier on estimates and a smaller firm tier. This is by far the more common
  outcome and by far the easier to fix, and it feels like the harder one from
  the inside because it feels like bad luck.
- **Both large**: the quarter was a plan, not a bet. Start with execution; a
  correct selection you cannot finish is worth zero, so the arithmetic is
  upstream.

---

## PART 2 — READING THE TRUTH-VERSUS-READINGS PLOT

The plot puts each feature's readings on a shared impact axis, coloured by
instrument, with the true impact overlaid, grouped by instrument so that
systematic bias is the headline rather than per-feature error.

**What you are looking at is not "how wrong was I."** It is the shape of each
instrument's lie. Read it in this order.

**1. Look down each instrument's column, not across each feature's row.** A
feature row with scattered dots tells you the instruments disagreed, which you
already knew. An instrument column whose dots sit consistently to one side of the
truth markers is the finding — that is a bias you could have corrected for and
did not.

**2. Separate the two ways a reading can be wrong.** For instrument `k` on
feature `f`:

```
reading − truth = bias[k][tag(f)] (systematic, repeatable, correctable)
                + noise           (symmetric, zero-mean, averages out)
```

An instrument scattered widely around the truth is **noisy** — the fix is to run
it more than once, or on more features, and average. An instrument tightly
clustered but offset from the truth is **biased** — running it again buys you
nothing at all, and this is the failure that feels like rigour from the inside
because the readings are so consistent.

**3. Do the estimate explicitly.** For each instrument, for each tag you have
data on:

| Instrument | Tag | Readings on that tag | Mean(reading − truth) = **bias** | Spread of the residuals = **noise** | I predicted (from week12 A3) |
|---|---|---|---|---|---|
| Talk to sales | | | | | |
| Support tickets | | | | | |
| Interviews | | | | | |
| Usage analytics | | | | | |
| Survey | | | | | |
| Fake door | | | | | |
| A/B test | | | | | |

Remember that the four double-tagged features — template gallery
(`onboarding`+`workflow`), realtime co-editing (`flashy`+`workflow`), P95 latency
(`infra`+`fix`) and SSO/SCIM (`enterprise`+`fix`) — carry two stacked biases. Use
the six single-tag features to pin the per-tag numbers first, then check whether
the double-tagged readings are consistent with the sum. If they are, the model
you should have been carrying in your head all quarter is now confirmed in front
of you.

**4. Check the caveats against the truth.** Every instrument published its own
bias direction in plain English before you ran it: sales sees prospects not
churned users; tickets come from people who stayed; analytics is blind to demand
for what does not exist; surveys capture stated preference and over-read the
visible thing. Now compare each caveat with its measured bias. Almost always they
match. **The sim told you the answer in week 1 and you read past it**, because a
caveat is abstract until you have been burned by it. That is the intended lesson
and it is worth sitting with for a moment rather than moving on.

---

## PART 3 — WHICH INSTRUMENT MISLED YOU, AND IN WHICH DIRECTION

Bias only costs you where you acted on it. Work out where it actually cost money.

**Step 1 — rank your decisions by leverage.** For each committed feature: which
instrument's reading was load-bearing? If you drop that reading, does the
decision change? If not, that instrument did not mislead you regardless of how
biased it was.

**Step 2 — price each misleading reading.**

| Feature | Load-bearing instrument | Reading | Truth | Error | Eng-weeks committed on it | Decision it caused | Would I have decided differently at the true value? |
|---|---|---|---|---|---|---|---|
| | | | | | | | |
| | | | | | | | |
| | | | | | | | |

The last column is the one that matters. An instrument that was wrong by 3 pp on
a feature you would have built anyway cost you nothing. An instrument that was
wrong by 1 pp across the exact boundary between your fourth and fifth priority
cost you the whole difference.

**Step 3 — the shared blind spot.** For every feature where all your instruments
agreed and all were wrong in the same direction: what did they have in common?
On this board the usual answer is that tickets, usage analytics and sales
conversations all see people who are already users, while the north star is
about teams that mostly are not. Agreement between instruments that share a blind
spot produces the *feeling* of corroboration with none of the substance, and it
is more dangerous than disagreement because disagreement at least makes you
think.

**Step 4 — the instruments you never ran.** Look at the truth for the features
you decided without a revealed-preference test. Would a fake door have changed
the call? It cost 10 slot-days out of 120. Price that: what did the 110 slot-days
you did spend actually buy you, and what did the 10 you did not spend cost?

**Step 5 — direction, not magnitude, is the transferable lesson.** You will never
meet these numbers again. What generalises is: *sales over-reads the segment in
front of it; support over-reads the pain of survivors; analytics under-reads
anything that does not exist yet; surveys over-read the visible.* Check each of
those four against your measured biases and note which ones held. Those are the
priors to carry into a real product conversation.

---

## PART 4 — DECISION QUALITY VERSUS OUTCOME

Fill this in with real features from your quarter. All four cells; if a cell is
empty, look harder, because a quarter with nothing in the off-diagonal is a
quarter where you graded the decisions by their results.

| | **Good outcome** | **Bad outcome** |
|---|---|---|
| **Good decision (A/B)** | Earned. The least instructive cell. | **Protect these.** |
| **Bad decision (C/D)** | **The dangerous cell.** | Cheap tuition. |

**The bottom-left cell is the one that damages you**, because it teaches a lesson
that is wrong and it teaches it with the full force of a good result. Go through
every decision you graded C or D in `week12.md` that turned out well and write,
explicitly, the false lesson you would have drawn if the truth had never been
revealed. Then say out loud that you will not draw it. In a real seat there is no
reveal, so the false lesson is the default outcome — this cell is the closest
this exercise gets to showing you a thing you genuinely cannot see from inside
the job.

**The top-right cell is the one you will be tempted to disown.** Go through each
well-reasoned decision that failed and answer: *knowing the truth, do I still
endorse the reasoning?* If yes, say so and keep the process. If no, be precise
about what was actually wrong with it — usually it turns out there was a single
instrument doing all the work and you called it triangulation.

**The test for whether you have internalised the distinction** is whether you
can say, without flinching, "that was my best decision of the quarter and it
lost me 4 pp." If that sentence feels wrong, the outcome is still driving your
evaluation of the reasoning, and you would do the same thing again next quarter
in a world where luck fell differently.

---

## PART 5 — WHAT THE CALIBRATION NUMBERS MEAN

The sim reports `n`, `hitRate`, `meanAbsError`, `bias` and `overconfident` on
your committed predictions. They are not a report card; each says something
different and specific.

**`hitRate` has a defined bar:** a forecast hits if it is within **1.0 pp** of
the truth. That is tight relative to the spread of true impacts on this board, so
a hit rate of 50% on five commits is genuinely good and a hit rate of 0% is not
automatically damning — check the absolute errors before drawing anything from
it.

**`n` is small.** You committed to perhaps four to six features. Every number
below is computed on that. Four observations is not a measurement of your
calibration, it is a hint. Treat everything here as directional and do not tell
anyone you are a well-calibrated forecaster on the strength of it.

**`meanAbsError` needs a reference point, and this is the part everyone skips.**
An MAE of 1.5 pp is meaningless in isolation. Compare it to two things:

- *The noise of the instruments you used.* If your MAE is at or below the typical
  noise on your readings, you did not out-predict your instruments — you got a
  favourable draw. Nobody can be more accurate than their measurement apparatus.
- *The MAE of your week-1 priors,* computed against the same truth. This is the
  best question in the whole debrief: **did the research actually make you more
  accurate than your gut was in week 1?** Sometimes it did not, and that is not
  an argument against research — it is an argument about which instruments you
  chose, and it is a much more interesting finding than a good score.

| | Mean abs error | Mean signed error |
|---|---|---|
| My week-1 priors (all 10 features) | | |
| My commit-time predictions | | |
| Improvement | | |

**`bias` — the signed error — is more diagnostic than the absolute error.**
Noise is symmetric; a systematic sign is not. Positive mean signed error means
you predicted higher impact than the truth, consistently. That is not a
measurement failure, it is advocacy: at the moment of commitment you were
building a case, most likely for yourself, in the rationale box. Check whether
your signed error is larger on features that a stakeholder championed than on
features you chose alone. If it is, you now know something specific and durable
about the conditions under which your own estimates inflate.

**`overconfident`** measures whether your stated ranges covered the truth as
often as they claimed. If you wrote point estimates without ranges in the
journal, you cannot be scored here, and the lesson is the one about ranges: a
number with no interval around it is not a belief, it is a position.

**And the number the sim does not report: your cost calibration.** Realised
multiplier versus what you planned at in week 1. Everyone arrives at a PM job
knowing to be humble about impact. Almost nobody carries an explicit personal
multiplier on engineering estimates. Yours is now measured, on real data, and it
is the single most portable number this exercise produced.

---

## PART 6 — THE TWO-DIMENSIONAL SCORE

There are two columns and the sim refuses to collapse them, which is the most
opinionated thing about its design.

**Metric:** delta achieved against a mandate of +8.6 pp.
**Organisation:** average trust against a starting 60, and the individual floors.

Four outcomes, and each is a different quarter:

**Won both.** Rare, and the honest question is whether you got a favourable draw
on the biases. Check the top-left cell of Part 4 — how much of the metric came
from decisions you graded A or B? If most of it came from C-grade decisions that
landed, you had a good quarter and learned very little, and next quarter will
correct it.

**Won the metric, lost the room.** The specific trap this sim is built around.
The grade is capped at C below an average trust of 40, and the cap is a
description rather than a punishment: an organisation that will not work with you
produces exactly one good quarter. Run it forward concretely — next quarter you
need research access from Dan, a designer from Kofi, and an unpadded estimate
from Rina. Go person by person on their final number and say whether you get it.
Then notice that everything you achieved this quarter was *purchased with
relationship capital you started with and did not replenish*, and that you began
at 60 with everyone because someone before you had built that.

Note the mechanism the sim makes explicit and reality only implies: Rina below 40
inflates every estimate you are shown by 30%. Losing an engineer's trust does not
make features cost more — it degrades your information, permanently, and you
cannot tell from the inside. A PM planning off padded estimates commits less,
ships less, and concludes that the team is slow.

**Won the room, lost the metric.** Equally real and usually treated as the softer
failure. It is not softer; it is just slower. You said yes to Dan in week 4, yes
to Marguerite in week 8, yes to Kofi in week 9, and every one of those was
pleasant. Go back to your week-1 prioritisation principle and count how many of
your commits violate it. A PM whose roadmap is the union of what everyone asked
for has not prioritised, and the room can tell — the trust score in the sim
cannot represent the specific quality of respect that is withheld from someone
who never says no.

**Lost both.** Almost always execution error: over-committed in week 1, discovered
it at week 9, disappointed everyone late. Check the regret decomposition in Part
1. If execution dominates, this quarter had one root cause and it was arithmetic,
and it is genuinely the most fixable failure available.

**The question to close Part 6 with:** *which column did you choose, and when?*
If you cannot name the week you chose, you did not choose — you defaulted, and
the default is set by whoever was loudest that week.

---

## PART 7 — WHAT A REAL PM SEAT HAS THAT THIS DOES NOT

Out of character now. Read this slowly. Each item is a first-order feature of the
job that the simulator removes entirely, and together they are most of what makes
the work hard.

**You were handed the problem and the metric, and that is the job.** Somebody
decided that W4 team activation was the number that mattered — over retention,
over expansion revenue, over time-to-first-insight, over any of a dozen defensible
alternatives. Somebody decided the target was 40 and not 36. Somebody assembled
ten candidate features rather than the two hundred things that could be built.
All of that happened before the sim started, and **that work is the part that
separates good PMs from adequate ones.** Choosing the wrong metric and pursuing
it brilliantly is the most common way a competent product team wastes a year,
and it is invisible from inside the quarter because everything looks like
progress. What you practised here is the last third of the process: allocation
against a given objective. It is the legible third, which is why it is the
simulable one.

The associated skill you did not practise: pushing back on the metric itself.
A real PM's most valuable single sentence is sometimes "activation is the wrong
number and here is what we should be looking at instead," said to a CEO who has
already told the board.

**Relationships accrue over years and a quarter cannot model them.** Trust here
is an integer that starts at 60 for everyone and moves in increments of 8, 12 and
15 when you drop or ship features. Real trust is multi-dimensional and it barely
moves on roadmap decisions at all. It moves when you take the blame for something
that was partly someone else's; when you tell an engineer something inconvenient
that you did not have to tell them; when you remember what someone said they
cared about six months ago. It is also *specific*: Rina might trust your judgment
and not your commitments, or trust you completely on technical honesty and not at
all on protecting her team. The sim gives you one scalar per person. Reality
gives you a matrix, and the entries you most need are the ones you cannot observe.

And it carries. Your Dan-equivalent has watched you for two years. Your
credibility in the week-1 meeting is mostly determined by things that happened
before the quarter started, which means the highest-leverage relationship work is
always invisible in the quarter where it pays off. That is the exact opposite of
this sim's incentive structure, where all trust is generated and spent inside
twelve weeks.

**Real features have no true impact number.** Not hidden — nonexistent. There is
no fact of the matter about what the onboarding checklist "is worth", because
its value depends on what else shipped, on the sequence, on that quarter's
segment mix, on the macro environment, and above all on execution quality, which
varies by a factor of three between two competent teams building the same spec.
The single largest simplification in this sim is that quality is not modelled:
features ship as specified, at their true impact, or not at all. In life the same
feature built well and built badly have opposite signs, and a large share of a
real PM's contribution is in that gap — in the details of the spec, the edge
cases, the copy, the thing you noticed in review — none of which this exercise
touches.

Which means: **you never learn the counterfactual.** No reveal, ever. You do not
find out what the road not taken was worth. Attribution is contested for years,
the metric moves for reasons unrelated to you, and the person who gets credit is
often whoever narrated it best. A whole real quarter produces perhaps one clean
causal read, if you ran an experiment, on one thing. The legibility of this
debrief is a teaching device and it is the biggest lie in the building.

**Most of the job is writing and talking, not deciding.** You made maybe a dozen
decisions in ninety minutes. A real PM makes a comparable number of consequential
decisions in a *quarter*, and spends the other 95% of the time on: the doc that
gets a decision made in a room you are not in; the same argument delivered five
different ways to five different audiences; the meeting where nothing is decided
but everyone leaves aligned; the spec detail an engineer asks about at 4pm on a
Thursday; the escalation you defuse in a hallway; the fourth rewrite of a
one-pager because the first three did not land. The decision is the visible
artefact. The writing and the talking are the mechanism by which a person with no
authority causes anything to happen at all, and they are most of what the job
consists of, hour by hour.

This sim gave you a chat window and four gates. It cannot give you the volume:
the six one-on-ones a week, the Slack thread that goes sideways at 11pm, the
thing you have now explained forty times. The specific fatigue of being the
person who has to keep the whole picture in their head while everyone else gets
to hold one piece — that is the load-bearing difficulty of the role and no
simulator delivers it.

**Also switched off:** hiring and losing people; reorgs; the quarter that
disappears into a compliance review; another team whose roadmap collides with
yours and whose PM outranks you; a customer who churns for reasons nobody logs;
legal; pricing; the fact that a real quarter starts in the middle of the previous
one's commitments and half your capacity is already spoken for on day one.

---

## PART 8 — WHAT YOU CAN AND CANNOT CLAIM

**What you can legitimately claim:**

- You know what it feels like to be the single point of decision for five people
  with legitimate, incompatible asks and no authority over any of them.
- You have said no to a CEO with a reason and felt the difference between that
  and saying no with a process.
- You can do the capacity arithmetic that most of these quarters actually turn
  on, and you have a personal number — your own optimism multiplier — measured
  rather than assumed.
- You can name what each research instrument sees and, more importantly, the
  population it is structurally blind to, and you have felt the specific trap of
  three instruments agreeing because they share a blind spot.
- You can use the vocabulary correctly and precisely: north star, activation,
  stated versus revealed preference, fake door, capacity commitment, value
  density, decision quality versus outcome, vanity metric, prioritisation
  principle.
- You have direct personal evidence that outcome is a corrupted signal about
  decision quality over short horizons. That is the most transferable thing in
  the exercise and it applies far outside product management.

**What you cannot claim, and should proactively disclaim:**

- That you would be good at this. The largest determinant of real PM performance
  — whether people want to keep working with you over years — was held at zero
  and replaced with an integer.
- That your feature judgment is any good. `n` is four to six, on a synthetic
  board, with a legible reveal.
- That you know how you would behave when the stakes are your job, your team's
  headcount, and a public commitment to a board.
- That the room you experienced resembles a specific real company. It is a
  composite, written to be instructive, and every character in it was more
  articulate and more available than their real equivalents.

**The correct end state is a lower estimate of your own readiness and a much
sharper sense of what the job demands.** If you finish this thinking product
management is basically prioritisation under uncertainty and you would be fine at
it, re-read Part 7. Prioritisation is the part that was legible enough to
simulate. It is not the part that is hard.

---

## PART 9 — WHAT THIS WAS FOR

You did not do this to become a PM. You did it so that the next time you are in a
room with one — arguing about a roadmap, being told your project is not the
priority, being asked for an estimate you both know is optimistic — you have a
body memory instead of a book summary.

**Three things you can now do that you could not before:**

1. **Hear what a PM is actually saying.** "We're not going to get to that this
   quarter" now decomposes for you into a capacity arithmetic, a prioritisation
   principle, and a relationship cost they have already priced. You know which of
   those three to ask about.

2. **Ask better questions.** Not "why isn't my thing on the roadmap." Try: *What
   are you actually measuring, and who chose it?* *What did you cut to make room
   for this, and who was upset?* *What evidence would change your mind about
   this bet, and when will you have it?* *What's your multiplier on our
   estimates?* Those identify you as someone who has sat in the chair, and they
   get real answers.

3. **Be a better counterpart from the engineering side.** You have now been on
   the receiving end of an optimistic estimate and watched it destroy a plan. You
   have felt what a slip discovered in week 10 costs versus the same slip in
   week 2. The most valuable thing an engineering lead gives a PM is an early,
   honest revision — and you now know, from the other chair, exactly how much
   that is worth.

**One last thing.** Write, in two sentences, the single most surprising thing you
learned about yourself. Not about product management — about you, under the
specific pressure of being the bottleneck for people who all had a reasonable
case. Put it in `journal/week12.md` section B5 and somewhere you will find it
again in a year. That sentence is the entire yield of this project. The score was
never real.
