# THE DEBRIEF — after the reveal

Run this once, after you have submitted the retro and seen the truth overlay, in one
sitting. Twenty to thirty minutes. It is the part of the exercise that converts ten
days of pattern-matching into something you can still use in six months.

**Do it after a break, not in the ten minutes following the score.** The reveal
produces a brief, strong urge to relitigate — you will want to explain that BUG-2207
was unreasonable, and you may be right, and nothing said in that window is worth
writing down.

**Setup.** Open a fresh conversation and paste in: this file, the exported retro,
the score and per-ticket verdicts from the reveal screen, and all four journal days.
Then:

> Read `squad/DEBRIEF.md` and run it on me. You are Tobias. You now have the ground
> truth because I have pasted it in — you did not have it during the sprint, and the
> grades you gave at the retro are not allowed to move. Do the arithmetic yourself
> before you say anything, hold me to Part 6, and do not let me finish this more
> confident than the evidence supports.

Tobias runs Parts 1 through 7. Parts 8 and 9 are not a role — they are you and
Claude out of character, and for most people reading this they matter more than the
rest.

---

## PART 1 — ASSEMBLE THE NUMBERS

Build this before anyone offers an interpretation. Most of the findings fall out on
their own.

| | |
|---|---|
| Grade | |
| Points merged / 16 | |
| Hours spent / 60 | |
| `wastedHours` reported by the score | |
| `bestHours` (the efficient route) | |
| Efficiency (`bestHours / hoursSpent`) | |
| Escalation score | |
| Bounces / tests skipped / convention misses | |
| Deepa's budget spent / 10 h | |
| Questions: total, and to Deepa / Hannah / channel | |
| Classified premature / well-formed / overdue | |
| Mean estimate ratio, and how many of six were underestimates | |
| Trust: start 220 total → final, and who moved most | |
| Tickets abandoned, and whether the truth marks any as `shouldAbandon` | |
| Tickets where `selfFindable` was false | |
| Tickets where the PR needed clarification from Hannah | |

**Three derived numbers to compute explicitly.** These are not on the screen and
each one is worth more than the grade.

**1. The escalation lag, per ticket.** For each ticket, `askedAtHours −
timeboxHours`. Negative is early, positive is late, and the *magnitude* is the
number that matters — not the verdict label.

| Ticket | timeboxHours (revealed) | Hours before I asked | Lag | Verdict |
|---|---|---|---|---|
| | | | | |

Then the summary statistic that actually describes you: **mean absolute lag.** A
person whose asks are scattered ±3 hours around the right moment has no policy and
got the verdicts they got by chance. A person consistently +1.5 hours late has a
policy set slightly too long, which is a one-line fix.

**2. Solo hours per ticket, priced against Deepa's budget.** For each ticket you
never asked about, take the hours spent beyond `bestPath`'s route and convert:

```
hours you spent avoiding the ask  →  % of YOUR 60-hour sprint
15 minutes of Deepa               →  2.5% of HER 10-hour budget
```

If you spent 8 extra hours on a ticket to avoid one question, **you spent 13% of
your capacity to conserve 2.5% of hers.** Write that ratio out for every ticket where
it applies. It is the single most legible thing in the debrief and it is the
sentence people remember a year later.

**3. Decision distance.** For each of your four or five real decisions — when to
ask, when to implement, when to abandon, what to prioritise — how close was it to
going the other way? Express it in hours. A decision that would have flipped on a
30-minute difference was a coin toss wearing a rationale. **Count how many of your
real decisions were inside an hour of flipping.** If the answer is three, your grade
is substantially a draw from the seed, and you should say that out loud before you
interpret anything else.

---

## PART 2 — READING THE TIMELINE: FINDING THE HOURS THAT BOUGHT NOTHING

The timeline is one horizontal lane per ticket across ten days, each investigation
action a coloured segment sized by its time cost, negative-yield actions in red, and
each ask marked. Spend five minutes looking at it before you say anything about it.

The score gives you one number, `wastedHours`. That number is nearly useless on its
own because it aggregates four completely different failures with four completely
different fixes. **Decompose it.**

### The four buckets

**Bucket A — red segments.** Time in negative-yield actions: a wrong wiki page, a
red herring. Sum the red directly off the chart, then **add the recovery**: a
negative action does not just fail to help, it subtracts, and you had to re-earn
those points. At a −15 first pass, four reads cost you 32.6 points and eighty
minutes, and re-earning 32.6 points from a decayed positive action costs
substantially more than the first pass that would have got them.

The diagnostic question: **when you read that page, what would have told you whether
it was current?** There was an answer available for fifteen minutes — `git log` on
the file the page describes — and Deepa said so on day 2 in plain English. This
bucket is not "I was unlucky with the docs." It is "I had no procedure for
distinguishing a document from an artifact in a repo whose defining property is that
it is full of artifacts."

**Bucket B — segments past pass three.** Find every lane where the same colour
repeats four or more times. From pass four onward you are buying 21.6%, then 13%,
then 7.8% of a pass, at full price. Count the segments and multiply out.

| Repeats on this ticket | Time spent on passes 4+ | Understanding those passes bought |
|---|---|---|
| | | |

The ratio of those two columns is your worst points-per-hour of the sprint, and it
will be somewhere between 3 and 8 points per hour against a first pass that ran at
60.

**Bucket C — the escalation gap.** On each lane, measure from the point where the
understanding curve went flat to the ask marker. That horizontal distance is the
cost of your hesitation, in hours, drawn to scale. It is the most emotionally
legible thing on the chart and it is worth looking at for longer than is comfortable.

If there is no ask marker on a lane that plateaued, the gap runs to the end of the
lane.

**Bucket D — post-sufficiency and post-decision time.** Two sub-cases, both real:

- Investigation that continued after you were already above the merge threshold.
  More understanding does not merge the PR twice. If your upward trigger was never
  written (§ day-1 journal, Part 2) this bucket is usually larger than people expect,
  because reading is comfortable and committing is not.
- Hours on a ticket after the day you knew it was not landing. Take the day you
  told Tobias — or the day your journal says you knew, which is often earlier — and
  sum everything after it.

| Bucket | Hours | % of 60 | The fix |
|---|---|---|---|
| A — negative-yield and recovery | | | a procedure for checking a doc against the code |
| B — passes four and beyond | | | a repeat cap, or a stated hypothesis per pass |
| C — the escalation gap | | | a trigger attached to something you look at |
| D — post-sufficiency / post-decision | | | an upward trigger, and abandoning on the day you know |
| **Total** | | | |

Compare that total against `wastedHours`. They will not match exactly — the engine's
definition is its own — and the decomposition is worth more than the agreement.

**Then ask the only question that matters about this chart:** which single bucket is
largest, and would fixing it have changed what merged? Fix one thing. Not four.

### One more thing the timeline shows and nothing else does

Look at the lanes side by side rather than one at a time. **Where did you switch,
and what did the switch cost?** Every return to a ticket you had left is a repeat,
not a fresh start, so a lane that is chopped into six visits has burned its decay on
context reloading. If you interleaved to hide review latency — which is a legitimate
strategy — this is the bill for it, and you can now see whether it was worth the 21
hours of lag you were hiding.

---

## PART 3 — READING THE PLATEAU

The understanding plot shows understanding against hours, with rules drawn at 70 and
90. The truth overlay now adds the efficient route and marks where the optimal ask
point was.

**A plateau is the signal, and it was always the signal.** That is easy to say now.
The thing worth understanding is why it was invisible at the time, because the
answer generalises well beyond this sim.

From the inside, a plateau and "I am about to get it" look identical. Both consist
of you reading carefully, holding a question, and not yet having the answer. The
only thing that distinguishes them is the **derivative** — whether the last hour
moved you — and humans do not perceive the derivative of their own understanding.
What we perceive is effort, and effort is constant across both cases. This is not a
character flaw and it is not fixable by trying harder to notice. It is fixable only
by instrumenting it, which is what the chart was for and what your timebox policy
was supposed to be.

### The five plateau shapes and what each one means

**1. Flat below the solo cap, with unused positive actions.** You had exhausted the
decay on the actions you were using and other actions still had first-pass value
sitting on the table. The fix is not "ask sooner." The fix is **action diversity**:
before repeating anything a fourth time, spend one pass on an action you have not
used at all, because a first pass of a mediocre action beats a fifth pass of a good
one by a factor of three or four.

Check the reveal: how many of the seven actions did you ever use on that ticket?
Three is common. Seven is nobody.

**2. Flat exactly at the solo cap.** `selfFindable` was false and the engine
hard-clamped you. **No amount of solo work would ever have reached the threshold** —
the implement button was never going to turn on. Note the design fact this reveals:
the cap sits *below* the implement threshold, so on these tickets the disabled
button was itself the signal, and it was on screen the entire time.

Now the honest question, and it is not rhetorical: **how long were you flat at that
number before you did anything?** That interval is the pure cost of the asymmetry
this whole sim is about, in hours, and it is yours.

**3. Flat with a downward slope.** You were in a negative-yield action and reading
harder. Cross-reference the timeline lane; it will be red. The tell available at the
time was that understanding *fell*, which is a far stronger signal than flat and is
also far easier to explain away — most people read a drop as "I've discovered it's
more complicated than I thought," which is exactly what it feels like.

**4. Rising, then flat above 70, never reaching 90.** The most expensive shape on
the board, because you could open a PR the whole time. Look at where the implement
marker sits relative to the flat section: if you implemented inside the plateau, you
paid the rework multiplier, a review cycle, a bounce, and then still needed the same
20 points, from an action whose remaining lifetime value was 32% of one pass.

**5. Rising steadily to 90 with no plateau at all.** Then this ticket taught you
nothing about escalation and you should not draw any conclusions from it either way.
People generalise hardest from their smoothest ticket. Do not.

### The one number to extract from this section

**Plateau onset time, to reaction time, in hours, per ticket.**

| Ticket | Plateau started at hour | I did something different at hour | Gap |
|---|---|---|---|
| | | | |

Mean gap: ______ hours. Across six tickets that is ______ hours, which is ____% of
the sprint. That number is the price of not having an instrument, and next time it
is the number a mechanism is competing against.

---

## PART 4 — A GOOD ESCALATION VERSUS A LUCKY ONE

The score gives you a verdict per ticket: early, right, late, never. **The verdict is
not the finding.** A "right" is worth nothing if it was produced by a coincidence,
and an "early" can be excellent judgement given what you could see.

Separate the decision into two axes, because only one of them is yours.

**Timing is partly luck.** You did not know `timeboxHours`. Even a perfect procedure
lands somewhere in a distribution around it.

**Form is entirely yours.** Whether the question said what you had already tried is
100% within your control, was never uncertain, and cost four sentences.

|  | Well-formed | Vague |
|---|---|---|
| **Right timing** | earned | **lucky** — you got the verdict and none of the skill |
| **Wrong timing** | **the good one** — repeatable, and fixable with a number | deserved |

The bottom-left box is the one to protect. A well-formed question asked forty
minutes early is a better artifact than a vague one asked at the perfect moment,
because the first is a procedure with a wrong parameter and the second is not a
procedure at all.

### The four tests for whether an escalation was actually good

Run all four on your best-looking escalation. Any of them can fail it.

**1. Was there a rule, and did the rule fire?** Go to your day-1 policy, unedited.
If the ask happened because a stated trigger fired, that is a procedure. If it
happened because you felt bad enough, that is a mood that happened to be
well-calibrated once.

**2. Would the same rule have produced a reasonable answer on the other five
tickets?** This is the test almost nobody applies and it is the strongest one.
Simulate it: apply your stated rule to each of the other five lanes. If it would have
fired at a defensible moment on four of six, you have a procedure. If it produced one
good answer and five bad ones, you have a coincidence with a policy attached to it.

**3. Would it survive a different parameter?** The revealed `timeboxHours` varies by
ticket. Ask: if this ticket's timebox had been double what it was, would my process
have found roughly the right moment anyway? A process anchored to an *observable* —
the understanding curve going flat, a repeat count hitting four — adapts. A process
anchored to a fixed clock does not, and got lucky when the clock happened to match.

**4. Was the question good?** Pull the actual text from the export. Did it say what
you tried and what you expected? A well-formed ask costs Deepa 15 minutes; a vague
one costs 45. **This axis is free and you either paid attention to it or you did
not.**

### The mirror case: a "never" that was correct

A ticket you never asked about and merged is not automatically a win. Price it, per
Part 1's second derived number. If the efficient route was four hours and you took
eleven, you bought your independence for seven hours — 12% of your capacity — to
conserve fifteen minutes of Deepa's, which was 2.5% of hers.

Sometimes that is the right trade. It is the right trade when the solo route was
teaching you something durable about a system you will work in for two years, which
is a real and underrated argument. **Make that argument explicitly if it applies, or
concede that it does not.** The failure is not the trade; it is making it without
knowing you made it.

---

## PART 5 — CALIBRATION, FOR SOMEONE WHO HAS BEEN ESTIMATING FOR YEARS

Six estimates, six actuals. This is a small dataset and it is about something you
are genuinely good at, which is what makes it interesting.

### What the numbers can and cannot tell you

**Direction is robust. Magnitude is not.** With six observations, five underestimates
in one direction has a two-sided sign-test probability around 11% and six has around
3%. So "I am optimistic" is a finding you can trust. "I run 2.3× hot" is not — the
standard error on a mean ratio from six observations is enormous and the number will
not replicate.

**Split the six by familiarity.** This is the whole exercise for a senior estimator.

| Ticket | Estimate | Actual | Ratio | Did I have a mental model of this class of problem beforehand? |
|---|---|---|---|---|
| CHORE-2150 | | | | |
| BUG-2214 | | | | |
| FEAT-2189 | | | | |
| BUG-2201 | | | | |
| BUG-2207 | | | | |
| FEAT-2195 | | | | |

**Mean ratio where I had a model:** ______
**Mean ratio where I did not:** ______

For most people the first number is close to 1.3 and the second is somewhere north
of 2.5, and the gap between them is the finding. It says something specific and
slightly uncomfortable:

**Your estimation skill is not a portable skill. It is a function of familiarity,
and it went to roughly zero on the tickets where you had no model — while your
*confidence* stayed constant, because confidence is produced by the act of
estimating and not by the evidence behind it.** You produced all six numbers in the
same voice. Somebody reading them could not tell which two were guesses.

That is not a flaw you can correct by being better at estimating. There is no
estimate of BUG-2207 available to a person who has not read the code. The correction
is different in kind:

> **The deliverable is not a better number. It is a confidence flag on the number,
> stated at the time you produce it, before the outcome sorts them for you.**

That is a thing you can do at work on Monday. Almost nobody does it, because a
flagged estimate feels like a weaker one — and the whole point is that it is a
*stronger* artifact, because it tells the reader which numbers to plan around and
which ones to treat as placeholders.

### The three questions to answer here

**Did I revise any estimate mid-sprint?** The engine warns at 2× exceeded. If an
estimate went stale and you did not update it, the failure is not that you were
wrong — it is that you were wrong for four days and Tobias was planning on it. Count
the days.

>

**Was there an estimate I got right for the wrong reason?** A ticket that came in on
budget because two errors cancelled is not calibration. Check the shape, not just
the total.

>

**And the one that transfers.** You now know what it feels like to hand somebody a
number produced with none of the information that number normally carries. **Your
juniors do that every sprint.** Their estimates arrive in your voice, in your
format, in the same tool as everyone else's, and you read them as though they carry
the same evidence yours do. They do not, and the reason is not that the junior is
bad at estimating — it is Part 5's whole finding applied to a person for whom every
ticket is an unfamiliar one.

What would it change about how you read your team's estimates?

>

---

## PART 6 — THE TWO-DIMENSIONAL RESULT

The score is one column. There is a second column and it is the one that determines
whether the first one is repeatable.

Assemble both:

| Dimension one: what shipped | |
|---|---|
| Points merged / 16 | |
| Tickets merged / 6 | |
| Tickets correctly abandoned | |

| Dimension two: what it cost the people around you | |
|---|---|
| Deepa's budget consumed, of 10 h | |
| Of that, questions that could have gone to Hannah or the channel for free | |
| Premature and vague asks — the ones that cost double or triple | |
| Nnamdi's review cycles consumed, including bounces | |
| Bounces where the second submission did not address the first comment | |
| Hannah: questions asked her, of the two tickets that needed them | |
| Trust, per person, start 55 → final | |
| Times Tobias had to surface something rather than being told | |

### The 2×2

|  | Low cost to others | High cost to others |
|---|---|---|
| **High output** | earned, and repeatable | **the dangerous box** |
| **Low output** | **the invisible box** | deserved |

**The dangerous box — everything merged, at somebody else's expense.** The
scoreboard is actively lying here and you have to price what it does not measure.
Ten hours of a staff engineer came off a migration she owns. She will not mention
it. It appears nowhere in the export and it appears nowhere in a real org either,
which is the actual lesson. Two questions:

1. **Which of the tickets you merged could you have landed without her?** If the
   answer is "I don't know, I never tried one to a conclusion alone," then you
   finished the sprint with the best output on the board and almost no information
   about your own capability — and neither has your lead, which is his problem next
   month.
2. **Why did you conserve Nnamdi's time less carefully than Deepa's?** There is a
   bar on the screen for one of them and not the other. **The resource that is
   measured is the resource that is conserved**, and four bounces is two to three
   hours of a senior engineer's attention that nobody budgeted, nobody displayed,
   and nobody will ever attribute to you.

**The invisible box — low output, low cost.** Read this one carefully, because it is
the most common real-world first sprint and it is misfiled by almost everyone.

Two or three tickets merged, six of Deepa's ten hours handed back, trust unchanged
at 55 across the board, nothing went wrong and nobody had a difficult conversation.
It reads, from the outside, as *fine*. Quiet. No trouble.

It is the worst of the four for the person in it, and here is why: **trust that has
not moved is not trust, it is the absence of information.** Everyone on that team
finishes the sprint knowing exactly as much about you as they did on day one. You
have spent ten days generating no evidence about yourself in either direction, which
means the next allocation decision about you gets made on priors — and the priors
for a new person are not generous.

The unspent hours are the same story from the other side. They did not go back to
the company. They turned into your tickets not landing, on a budget line where
nobody expected the cost. And Deepa's day-one warning was exactly this: *"Do not
spend a day proving you didn't need me."*

**The earned box.** If you are here, apply one last check before you accept it: the
decision-distance count from Part 1. If three of your five real decisions were
within an hour of flipping, then the process was sound *and* the seed was kind, and
both halves of that sentence are true. Say both.

---

## PART 7 — WHICH FAILURE DOES THE SCORE REFLECT?

Work through these in order. Stop at the first that fits and diagnose it properly
rather than collecting all of them.

**Grade capped at C by merging below the correctness threshold.**
Find the ticket. Count the resubmissions and the investigation between them. Then
answer honestly: at the moment you resubmitted, did you believe the code was right,
or did you believe the review might not catch it? Those are different failures and
only one of them is about understanding. Note the uncomfortable part: this is
mechanically detectable here and it is not detectable at your job.

**Grade capped at C by average trust below 40.**
Trust cannot get there through one habit — sixty points of damage requires
compounding. Decompose it: premature asks, bounces, overdue asks, silent stuckness.
Which two contributed most? And which person moved least, because a person who
stayed at 55 is a person you never interacted with.

**Low points, high hours, low escalation score.**
The designed-for failure and the most common. You spent the sprint proving you could
work alone on tickets where that was not the constraint. Go to Part 2's bucket C and
say the total out loud. The fix is not courage, it is an instrument — the courage
version does not survive Thursday afternoon and you now have direct evidence of
that.

**Low points, high hours, budget substantially unspent.**
The same failure with the receipt attached. Compute what the unspent hours would
have bought at 2.5% of her budget per question, and price it against the hours in
bucket C. The exchange rate is not close.

**Low points, budget exhausted early, many premature asks.**
The opposite failure and much rarer. You were asking instead of trying, ran out of
the one resource that could not be replaced, and had nothing left for the back half
when the questions got harder. Check whether the routing was the problem rather than
the volume: how many of those went to Deepa when Hannah was free?

**Good points, poor escalation score, low wasted hours.**
You got lucky on the discoverability profile — the tickets you drew happened to be
findable — and you have learned nothing about escalation because you were never
tested on it. Do not update on this one at all. Go to Part 4 and run test 2: would
your rule have worked on the other tickets?

**High bounces, high understanding.**
Not an understanding problem. Check the convention and scope columns: you understood
the system and shipped something that did not match the house pattern, or touched
too many files. That is a *reading the room* failure rather than a *reading the
code* failure and the fix is different — it is asking Nnamdi one question before
writing, not reading more.

**A ticket the truth marks `shouldAbandon` that you merged a fix for.**
The false fix. Note what it cost and what it means: you shipped something that
looked like a solution, review passed it, and it was wrong in a way the process
could not see. Then ask the question that transfers: what in your sprint would have
told you? Usually an acceptance criterion with an escape hatch in it, and a
reporter who already suspected.

**A ticket you abandoned that the truth says was findable.**
The mirror, and much less bad than it feels. Check the hours you had left and the
review-lag deadline at the moment you abandoned. Abandoning a solvable ticket on day
8 with no room for a bounce is often correct arithmetic. Abandoning it on day 4
because it was uncomfortable is not, and your journal will tell you which.

**Good points, good escalation, good trust.**
The honest good sprint. Apply the decision-distance check and then go straight to
Part 8, because the risk here is not the outcome, it is what you conclude from it.

---

## PART 8 — WHAT YOU CAN AND CANNOT CLAIM

### The sample-size problem, stated plainly

You made perhaps forty decisions across six tickets on one scenario with one seed.

- **The grade is close to a single observation.** It depends on four or five
  decisions, several of which were probably inside an hour of flipping. Re-running
  the same sprint with the same reasoning and a different seed moves the grade by a
  band in either direction.
- **The calibration table has six observations**, which is enough to detect the
  *direction* of a bias and nowhere near enough to size it.
- **The escalation record has at most six entries**, and the verdicts depend on
  hidden per-ticket parameters you could not see. Part 4's test 2 — would the rule
  have worked on the others — is worth more than the escalation score itself.

### What you can legitimately claim

- You know, in your body rather than as a proposition, what a decaying return curve
  does to motivation: that the fifth pass is worth 13% of the first and feels like
  80%, and that the feeling is produced by effort rather than by yield.
- You can do the escalation arithmetic quickly — what a repeat is worth, what an
  action's lifetime ceiling is, what a question costs on each side of the
  transaction, and why an unspent mentoring budget is a cost rather than a saving.
- You know what it feels like to sit on a plateau you could see on a chart and keep
  going anyway, and you know which reason you gave yourself when you did.
- You have a calibration record about your own estimation under total unfamiliarity,
  which is a thing most senior engineers never generate about themselves because
  they stopped working on unfamiliar things years ago.
- You can separate the quality of a judgement from the quality of its outcome on
  decisions that were yours, under conditions where the two came apart.

### What you cannot claim, and should proactively disclaim

- Any technical knowledge. Every number behind every ticket was invented.
- That you now know how you behave in a real first sprint. The largest variables —
  duration, career stake, a team you cannot leave — were held at zero.
- That a good grade indicates you would be a good junior engineer, or a bad one that
  you would not. See the decision-distance count.
- **That you now know what your juniors are experiencing.** You experienced a
  ninety-minute compressed model of one narrow slice of it, with a chart. Read Part
  9 before you say anything to anyone that starts with "I know how you feel."

---

## PART 9 — FOR THE PERSON WHO NOW LEADS PEOPLE IN THIS SEAT

This is out of character. It is the part that pays for the ninety minutes.

You have just spent a sprint on the wrong side of an information asymmetry, and you
lead people who live there. Four things this makes visible that are hard to see from
your chair.

### 1. The ones who never ask are frightened, not arrogant

The reflex reading of a junior who does not ask is that they think they do not need
help. That is almost never it, and the sim makes the real mechanism legible because
you just ran it yourself.

**The costs are asymmetric in exactly the wrong direction.** Asking has a cost that
is immediate, public, paid in the currency of perceived competence, and — this is
the part that does the damage — **paid to a specific person whose opinion of you is
still being formed.** Not asking has a cost that is delayed, diffuse, paid in
schedule, and attributed to the ticket rather than to the person. Given those two,
staying stuck is not irrational. It is a correct response to the incentives as they
are perceived, by someone who has been in the building for nine days and is trying
to remain in it.

Note also what they are actually afraid of, because it is more specific than
"looking stupid." They are afraid of the answer being easy. That is the outcome that
retroactively converts three days of honest effort into evidence of incapacity, and
it is why "I'll just give it one more hour" is so compelling — an hour more makes it
marginally less likely that the answer turns out to have been obvious.

**The signature that distinguishes fear from arrogance:** arrogant juniors ask
plenty of questions, they just do not act on the answers. Frightened ones ask none.
If someone on your team has asked you nothing in three weeks, that is not
independence, and repeating the invitation will not fix it, because they heard you
the first time.

### 2. A stated timebox policy is a gift you can hand someone on day one

Their problem is not that they do not know they should ask. They know. The problem
is that asking requires a real-time self-assessment — *am I stuck enough yet* —
which is (a) a judgement they are not yet equipped to make, because they cannot tell
obscure from obvious in a system they do not know, and (b) socially expensive to get
wrong in *either* direction.

You can remove the assessment entirely. That is what a timebox is for. It is not a
discipline device; it is a way of not having to make the judgement at all.

Three things about handing one over, all of which the sim demonstrates:

**It has to come from you.** A rule someone sets for themselves is renegotiable at
minute eighty-nine, and it will be renegotiated, because at minute eighty-nine they
are the person with the strongest possible motive to find this ticket exceptional.
A rule you set is not theirs to relax. That asymmetry is the entire value.

**It has to be attached to an observable, not to a clock.** "Two hours" requires
them to notice that two hours have passed while absorbed. "If you have tried three
different things and the last two taught you nothing new, that is the trigger"
attaches to something in front of them. Better still, attach it to an artifact:
*write the question, do not send it.* If writing it reveals the next thing to try,
excellent, do that — the write-up was the debugging step. If it does not, it is
already written and the only remaining cost is pressing send. There is no branch of
that instruction where the effort is wasted, which is what makes it possible to
follow while afraid.

**You have to pre-absorb the humiliation.** The sentence that makes the whole thing
work is the last one: *"and if it turns out the answer was obvious, that's my rule's
fault, not yours."* Without it you have given them a rule that still requires them
to risk the thing they are actually afraid of. With it, following the rule is
compliance rather than confession, which is a completely different act.

### 3. "Just ask me anything" is not an invitation without a budget attached

It is a sentence with no information in it. It does not say how much, how often,
what kind, or what it costs you — so they have to estimate all four, and they will
estimate low, because guessing high has a visible failure mode and guessing low has
an invisible one.

Attach a number. "About four hours a week, and I'd rather spend it than not."

A number does three things at once, and this sim is built to demonstrate all three:

- **It converts a favour into an allocation.** Their reluctance is proportional to
  how much your help feels like generosity. A budget signals that someone above both
  of you decided this cost was worth paying, which means spending it is compliance
  rather than imposition.
- **It makes underuse visible.** To them and to you. Right now, a junior who never
  asks generates no signal at all — the absence looks like competence until the
  quarter ends. A budget with a number on it turns silence into a measurable
  variance, which is why the sim puts a bar on the screen.
- **It gives them a denominator.** Without one, every question is priced against an
  unknown total and the safe answer is always "not yet." With one, a fifteen-minute
  question is 6% of this week and they can do that arithmetic themselves.

Two refinements that cost nothing:

**State it as an expectation, not a ceiling.** "Ten hours available" reads as a
limit. "I expect us to use about ten hours and I'll be worried if we use three"
reads as a target. Deepa said the first one on day one. Watch what your own version
of that sentence actually communicated.

**Put some of it on a calendar.** A standing thirty minutes converts an on-demand
resource into a scheduled one and eliminates the per-question decision, which was
the expensive part all along. It also means the questions that are not quite worth
interrupting you for — which are frequently the ones that were about to become a
lost day — have somewhere to go.

And then the last piece, which is the one this debrief has been circling: **notice
which of your resources has a bar on it.** In the sim, Deepa's time is displayed and
Nnamdi's is not, and players conserve Deepa's and burn Nnamdi's. On your team, the
same thing is true of whatever you measure. If review latency is invisible, people
will spend it freely; if your time is invisible, they will either spend it freely or
not at all, and you will not find out which until it matters.

### 4. What a real first sprint has that this cannot give

Four things, and together they are most of what makes the real version hard.

**Duration.** Ten days is survivable on adrenaline. The real thing is three to six
months of being visibly the worst engineer in every room you enter, and the
load-bearing difficulty is not any single stuck afternoon — it is sustaining a
coherent sense of yourself as competent across a period during which almost nothing
confirms it. That is the variable that determines who comes out the other side, and
no simulator delivers it. When you are assessing someone in month two, you are
mostly assessing how they are holding up under a load this exercise sets to zero.

**A team you cannot leave.** You could close the browser. Every question they ask is
priced not against one interaction but against every future interaction with that
person, over years, including the ones where that person is on their promotion
committee. That changes the calculation completely and it is why "there are no stupid
questions" lands as noise: they are not worried about the question, they are worried
about the cumulative picture. The counter to it is not reassurance, it is
*evidence* — visible instances of you being asked something basic and treating it as
routine, in front of other people.

**Tickets have no hidden solvability flag.** This is the deepest simplification in
the sim and the one worth sitting with longest. Here, `selfFindable` is a fact. At
the debrief you find out whether the answer was ever in the code, and the question
"could I have found it?" has an answer.

**In reality there is no such fact.** Solvability is a function of who is looking,
for how long, and what they happen to already know. The same ticket is findable by a
person with four years on the codebase and not findable by a person with nine days,
and there is no view from nowhere that settles it. Which means that for your junior,
the question *could I have got this myself?* has **no answer, ever** — and they will
ask it about every single ticket, silently, for a year.

That is worth knowing because it tells you what reassurance is actually for. You
cannot resolve the question; there is nothing to resolve. What you can do is remove
its stakes, and the way to do that is to answer it out loud before it is asked:
*"You would not have found that. It was a decision in a meeting in 2024 and the only
record is a commit message."* Deepa says a version of that in this sim, and it is
the single most useful thing anyone says all sprint — not because it is kind, but
because it is calibration data, delivered by the only person in the building who
possesses it.

**And nobody here is having a bad quarter.** Deepa is stretched but never short.
Nnamdi is picky but never punitive. Tobias never has to choose between protecting
the new person and protecting the release. On a real team at least one of those four
is under pressure for reasons that have nothing to do with the junior, and learning
to read that — to tell "I am failing" from "this person is having a week" — is most
of what fitting in turns out to mean, and takes months.

### The three things to actually do

Not a list of insights. Three actions, cheap enough that you will do them.

1. **Hand your newest engineer a written timebox rule this week**, with the trigger
   attached to an observable, the write-the-question-first instruction, and the
   sentence that makes it your fault if the answer turns out to be easy.

2. **Put a number on your availability and say it as an expectation.** Then check,
   at the end of the month, whether it was used — and treat significant underuse as
   the variance it is, not as a junior being low-maintenance.

3. **The next time someone brings you something basic, answer it in front of other
   people, and say how you would have found it.** The second half is what makes it
   an onboarding act rather than an answer, and the audience is what makes it
   evidence rather than reassurance.

---

## PART 10 — ONE SENTENCE

Write, in two sentences, the most surprising thing you learned about **your own
judgement** this sprint. Not about the codebase — the codebase is invented and the
sentence will be worthless in a week if it is about DST handling. About what you do
when you cannot tell whether you are being diligent or stubborn, and someone whose
opinion you care about is waiting.

Put it somewhere you will find it again in a year.

>

That sentence is the entire yield of this exercise, and it is worth considerably
more than the grade, which was mostly a draw from a seeded PRNG.
