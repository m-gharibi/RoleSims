# PRODUCT MANAGER SIM

One quarter as the PM for activation at Lumen. Twelve weeks, one engineering
team, ten candidate features, seven ways of finding out what is true, and five
people who want different things and none of whom report to you.

This is not a game about picking the right features. It is an apparatus for
producing a specific feeling: the feeling of being the single point of decision
for five people with legitimate, incompatible demands, holding a number you only
partly control, with no authority over anyone whose cooperation you need — and
having to say no, out loud, to someone senior, in a way that keeps them.

You have worked with PMs. You have not been one. The gap between those two
things is almost entirely about what it costs to say no, and about how it feels
to be the bottleneck rather than the thing being bottlenecked.

---

## RUNNING IT

Double-click `index.html`. That is the whole install.

No server, no build, no network. It runs from `file://`. The quarter is
deterministic: the same seed replays identically, which means you cannot blame
the dice and you can, if you want, run the same quarter twice with a different
plan and compare.

Screens go: brief → desk → gate modals at weeks 1, 6, 11 and 12 → QBR →
debrief. The desk runs the calendar a working day at a time; pause whenever you
want to think.

**Budget about 90 minutes.** Roughly 15 for the brief and the week-1 plan, 45
running the quarter with the three chat gates in it, 15 for the QBR, 15 for the
debrief. The chat gates are not optional garnish — see the protocol below.

---

## THE SEAT

**Company.** Lumen, collaborative analytics for data teams.
**Your title.** Product Manager, Growth & Core.
**Your number.** W4 team activation: the percentage of newly created teams with
three or more active members still active in week four. It sits at **31.4**.
**Your mandate.** Marguerite has told the board it will be **40.0** by the end
of the quarter. That is **+8.6 pp, a 27% relative increase, in twelve weeks.**

Nobody asked you whether 40 was achievable. Forming a private view on that in
week 1, writing it down, and being able to defend it at the QBR with evidence
rather than with hindsight is one of the things this sim is actually testing.

**The room.** Five stakeholders, all starting at trust 60 out of 100:

| | | Champions | Opposes |
|---|---|---|---|
| Marguerite Osei | CEO | realtime co-editing, mobile view | — |
| Dan Reilly | VP Sales | SSO/SCIM, admin audit log | dashboard themes |
| Rina Chowdhury | Eng lead | P95 latency | realtime co-editing, mobile view |
| Kofi Adeyemi | Design lead | dashboard themes, mobile view | — |
| Tomás Vidal | Support lead | P95 latency, CSV export v2 | — |

Three features on the board — the onboarding checklist, the template gallery
and smart alerts — are yours. Nobody champions them. Remember that; it turns
out to matter more than it looks.

---

## THE RULES

| Rule | Value |
|---|---|
| Quarter | 12 weeks, 5 working days each, 60 working days |
| Engineering capacity | 4 eng-weeks per calendar week, **48 for the quarter** |
| Features on the board | 10, estimates summing to **66 eng-weeks** |
| Research slots | 2 concurrent, always; research costs calendar, not eng-weeks |
| Instruments | 7, costing 1 to 15 days each |
| Starting trust | 60 each, floor 0, ceiling 100 |
| Saying no to a champion | −12 with that person |
| Shipping something they champion | +8 |
| Ignoring an escalation | −15 with the escalator |
| Eng trust below 40 | every future estimate you are shown inflates 30% |
| CEO trust below 35 | she inserts a feature at the head of your roadmap, locked 3 weeks |
| Any stakeholder above 75 | you get one favour: an unbiased reading, +4 eng-weeks, or an escalation absorbed |
| Slip warning | fires at 60% of the **estimate** consumed, if the real cost is higher |
| Every commit requires | a predicted impact in pp and a written rationale |
| **Unfinished work at week 12** | **worth exactly zero** |

Two hard modifiers on the final grade, both of which you should read now rather
than discover at the debrief:

- Shipping **two or more vanity features** — things whose true impact turns out
  to be under 0.5 pp — caps your grade at C no matter what the number did.
- Finishing with **average trust below 40** caps your grade at C no matter what
  the number did.

You can win the metric and lose the organisation. The score is two-dimensional
and it will say so.

---

## THE PROTOCOL

Do not skip the chat gates. The simulator is the smaller half of this. The gates
are where the actual training happens, because they force you to state a
position out loud, to a person who will push back, *before* the quarter resolves
it — and then make you sit in front of the transcript afterwards.

Open a Claude conversation next to the browser before you press anything and
paste this in:

> You are running the room at Lumen. Read `org/STAKEHOLDER_PLAYBOOK.md` and
> follow it exactly. I am the PM. I will bring you a week-1 roadmap pitch, a
> week-6 mid-quarter review, a week-11 ship-or-cut call, and a week-12 QBR.
> You do not know the ground truth of this sim and must never pretend to. Stay
> in character as the room.

Then:

**1. Read the brief (5 min).** Ten features with estimates, seven instruments
with their stated caveats, the mandate. Read every instrument's caveat before
you read anything else. The caveats are the honest part of the sim: each one
tells you, in plain language, the direction that instrument lies in.

**2. Write `journal/week1.md` — before you pitch, not after.** It forces a prior
impact estimate on all ten features with zero research available, and an
explicit prioritisation principle. Writing it after the pitch lets you launder
it. This is the most uncomfortable fifteen minutes in the exercise and it is the
one that pays.

**3. Post the roadmap to the room in chat (10 min).** Your plan, your priority
order, your capacity arithmetic, what you are not doing and who that
disappoints. The room scores it on five things and tells you the score. Expect
to be interrupted by Dan.

**4. Run weeks 1 to 6.** Research runs in two slots; the build queue runs
underneath it. The org feed on the right is not decoration — those people react
to what you actually do, including to what you fail to do. Escalations need
answers; ignoring one costs 15 points of trust with the person who sent it.

**5. Week 6 — mid-quarter review in chat (10 min).** Marguerite wants the
number, what changed, and what you are cutting. Fill `journal/week6.md` first.
By now at least one estimate has slipped and at least one instrument has
contradicted another. The gate is about whether you updated or defended.

**6. Run weeks 7 to 11.** A production incident takes five eng-weeks off you in
week 7 and it is not negotiable. That is 10% of your quarter, arriving after
you have committed.

**7. Week 11 — ship-or-cut call in chat (10 min).** Fill `journal/week11.md`
first. Say what ships, what slips, and who you are about to disappoint. Anything
not code-complete by the end of week 11 is not shipping, and half-shipped scores
the same as never started.

**8. Week 12 — QBR (15 min).** Write the narrative in `journal/week12.md`
**before you submit and before any score is revealed.** Then paste the exported
QBR into chat and defend the quarter. The room interrogates decision quality
separately from outcome. A well-reasoned bet that missed beats a lucky bet that
landed, and the room will say so in both directions.

**9. Debrief (15 min).** Only now does the sim reveal the truth: real impact and
real cost per feature, and the exact direction each instrument lied in. Run
`org/DEBRIEF.md`. This is where the exercise converts into something you can
still use in six months.

---

## QUANTITATIVE GROUNDING

Everything below is derived from the sim's own published model — the rules, the
estimates, the instrument costs and the stated caveats. None of it requires
knowing any answer. Read it before week 1. Most of the ways this quarter goes
wrong are arithmetic, not judgment, and they are visible from here.

### 1. The capacity arithmetic, which is the whole game

You have 48 eng-weeks. The ten features carry estimates summing to **66**. So
the board is 138% of your capacity by estimate alone: even in a world where
engineering estimates were perfect, you could build about seven of ten things.

That world does not exist. The sim states plainly that `estCost` shown to you is
`round(trueCost / optimism)` with optimism above 1 — **estimates are
systematically optimistic, by different amounts per feature.** Nobody is lying.
Rina's first message says exactly what her estimates are: what it looks like
from here.

Then subtract the incident: **week 7 removes five eng-weeks.** It is scripted,
it is guaranteed, and it arrives after you have committed. Your real budget is
**43 eng-weeks**, not 48, and you know that on day one if you read this file.

Now do the substitution. If `m` is the average optimism multiplier across the
things you commit to, a plan whose estimates sum to `E` really costs `m × E`,
and it must fit in 43:

| Estimates you commit | m = 1.0 | 1.2 | 1.4 | 1.6 | 1.8 | 2.0 |
|---|---|---|---|---|---|---|
| 20 est-weeks | 20 | 24 | 28 | 32 | 36 | 40 |
| 25 | 25 | 30 | 35 | 40 | **45** | **50** |
| 30 | 30 | 36 | 42 | **48** | **54** | **60** |
| 35 | 35 | 42 | **49** | **56** | **63** | **70** |
| 40 | 40 | **48** | **56** | **64** | **72** | **80** |
| 48 | **48** | **58** | **67** | **77** | **86** | **96** |

Bold cells do not fit in 43. Inverting it, your true commit budget in
estimate-weeks is `43 / m`:

| If estimates run this optimistic | your commit budget is |
|---|---|
| m = 1.2 (20% over) | 35.8 est-weeks |
| m = 1.4 | 30.7 |
| m = 1.6 | 26.9 |
| m = 1.8 | 23.9 |
| m = 2.0 (double) | 21.5 |

**The trap is not that the estimates sum to less than your capacity — they sum
to 66, half again more. The trap is that 48 feels like a budget and it isn't
one.** A PM who fills 48 estimate-weeks because 48 is the capacity number has
committed to somewhere between 58 and 96 eng-weeks of real work against 43
available, and will finish the quarter with two or three features at 70%
complete. Those are worth nothing. Not "partial credit" — the score has a field
called `wastedCapacity` measured in eng-weeks sunk into things that never
shipped, and it is reported to the room.

If you believe estimates run 40% optimistic, your commit budget is about **31
estimate-weeks out of a 66-week board: under half of it.** That is the sentence
the whole quarter turns on, and it means the interesting question was never
"which features are good" but "which four or five."

### 2. Unfinished work is worth exactly zero, and that changes the ordering

The value of a feature is not `impact`. It is `P(ships) × impact`. Because the
build queue is serial and the cliff at week 12 is hard, `P(ships)` for the last
item in your queue is not 90% — it is a step function that depends on the
accumulated overrun of everything ahead of it.

Three consequences, in order of how much money they are worth:

**Order by cost uncertainty, not only by value.** A slip is revealed at 60% of
the *estimate* consumed, which is `0.15 × estCost` calendar weeks after that
feature starts. A 10-week estimate announces its slip about 1.5 calendar weeks
in; a 3-week estimate announces in about half a week. So: a slip discovered in
week 2 leaves you ten weeks of options. The identical slip discovered in week 10
leaves you none. **Put the item whose cost you trust least early**, where the
information is still actionable, even if its expected impact is lower than
something you could start instead.

**A slip is a decision point, not a status update.** When the revised estimate
lands, the eng-weeks already spent are gone whichever way you decide, so they do
not belong in the comparison. The only live question is: does the *remaining*
cost, at the *revised* number, still beat the best alternative use of that same
remaining capacity? Usually the honest answer is no, and the honest answer is
almost never the one taken, because cutting crystallises a visible loss and
continuing hides it until week 12. The sim watches for exactly this: a slip
revealed and the roadmap unchanged for five days triggers a message from Rina.

**Keep a real buffer, and put it in the plan out loud.** Something like 8 to 10
eng-weeks unallocated at week 1 — one incident plus one bad slip. A PM who
presents a plan consuming 100% of nominal capacity has told the room they have
never shipped anything.

### 3. The instruments: what each costs, and what each cannot see

Research costs calendar days and slot occupancy. It costs **zero eng-weeks**,
which means the only reason not to run something is time and slot contention.
Two slots run concurrently for all 60 days: **120 slot-days for the quarter.**
But the number that matters is not 120. It is how many slot-days exist *before
the decision the research is supposed to inform*:

- Before your week-1 roadmap post: essentially none. Only `sales_anecdote` (1
  day) could even return. **Week 1 is decided on priors.** That is deliberate.
- Before day 10 (end of week 2): **20 slot-days.**
- Before day 30 (mid-quarter review): **60 slot-days.**
- After about week 9, research can no longer change what you build. It can only
  change what you claim, and what you would do next quarter.

| Instrument | Days | % of the 20 slot-days before day 10 | What it can see | What it is structurally blind to |
|---|---|---|---|---|
| Talk to sales | 1 | 5% | What blocked deals that were in the pipeline; what a buyer says they need to sign | Anyone who never got to a sales conversation; the churned; the representativeness of any of it |
| Support tickets | 2 | 10% | Pain intense enough to make someone file, from people who stayed | **Everyone who bounced.** By construction it cannot see activation failure — nobody who quit in week one filed a ticket |
| Customer interviews | 4 | 20% | Jobs-to-be-done, mechanism, why; low systematic bias | Eight people is eight people. Noise-dominated, not bias-dominated |
| Usage analytics | 5 | 25% | What people actually do with what exists, at full-population scale | Demand for anything that does not exist yet. It will under-read every new thing on the board |
| Customer survey | 5 | 25% | Stated preference at n=400 | The gap between what people say and do. Reliably over-reads the visible thing, under-reads the boring one |
| Fake-door test | 10 | **50%** | Revealed preference. Near-unbiased | Slow, and it costs goodwill with the people who click |
| A/B test | 15 | n/a | The cleanest number available | It only runs on something already shipped. It arrives after the decision |

Two things fall straight out of that table.

**Your metric is about people who are not yet users, and most of your
instruments only see users.** W4 team activation measures new teams getting to
three active members and staying. Support tickets come from survivors. Usage
analytics measures the install base. Sales sees prospects in a buying process.
The instruments structurally aligned with your actual number are interviews and
the fake door — the two you have to spend real time on. If you build your
quarter out of tickets and sales calls, every instrument you own is blind to the
same thing, and you will not notice, because they will agree with each other.
Instruments agreeing is not corroboration when they share a blind spot.

**The cheapest instruments lie the most, and that is not a coincidence — it is
the actual economics of the job.** One day of Dan's time versus ten days of a
fake door is a 10:1 price ratio for the difference between an anecdote and a
measurement. You will feel the pull of the cheap ones constantly, because they
return before lunch and they let you look decisive.

### 4. The observation model, and how to actually beat it

The sim publishes its own measurement equation:

```
reading(feature, instrument) = trueImpact(feature)
                             + Σ over the feature's tags: bias[instrument][tag]
                             + gaussian(0, noise[instrument])
```

Read that carefully, because four exploitable facts are sitting in it.

**(a) Bias is per-instrument-per-tag, not per-feature.** The six tags on the
board are `onboarding`, `workflow`, `flashy`, `infra`, `fix`, `enterprise`.
Whatever the survey does to one flashy feature, it does to every flashy feature.
So a bias you measure once is a correction you can apply many times.

**(b) Repeating an instrument kills noise, never bias.** Running the same
instrument `n` times shrinks the noise term by `1/√n` and leaves the bias term
exactly where it was. Running *different* instruments only helps to the extent
their biases point in different directions on that tag — averaging four
instruments that all over-read `flashy` gives you a beautifully precise wrong
answer. This is why the sim's own framing is "triangulate across instruments
that lie differently" rather than "get more data."

The practical version: interviews are described as low-bias and small-sample —
noise-dominated. Noise is the failure mode you can buy your way out of. Two
interview runs cost 8 slot-days and give you a low-bias estimate with noise
divided by 1.41. One fake door costs 10 slot-days. That is a real comparison you
can make on day one, with numbers, before you know anything.

**(c) With only biased instruments you can learn relative bias but never truth.**
Two readings on the same feature differ by `bias_j − bias_k + noise`. The true
impact cancels. You can build a complete map of how your instruments disagree
and still have no idea where zero is. **One near-unbiased anchor converts that
entire relative map into an absolute one.** That is what the fake door is for,
and it is why spending 50% of your pre-day-10 research budget on a single
fake-door is defensible in a way that it does not look at first.

**(d) Anchor on a single-tag feature, or you cannot decompose anything.** Six
features carry one tag: the onboarding checklist (`onboarding`), smart alerts
(`workflow`), CSV export v2 (`fix`), mobile view and dashboard themes
(`flashy`), and the admin audit log (`enterprise`). Four carry two, so their
readings contain two stacked biases you cannot separate. Note in particular that
`infra` appears on exactly one feature, P95 latency, always paired with `fix` —
so you can only ever estimate the `infra` bias after you have pinned `fix` down
somewhere else.

So the highest-information research plan is not "study my top three features."
It is closer to: run cheap instruments broadly to get the relative map; anchor
one single-tag feature with revealed preference; then subtract. That plan costs
about 20 slot-days and gives you readings you can defend on features you never
directly studied. If you finish the quarter without ever having run a fake door
or an A/B test, you never once measured what anyone *did*, only what they said —
and the CEO's week-8 message will point that out.

**One more, for the endgame.** An A/B test costs 15 days and only runs on
something already shipped, which sounds like a booby prize. It is not: an
unbiased measurement of a shipped feature, compared against the biased readings
you took on that same feature months earlier, tells you the bias of every one of
those instruments on that feature's tags — which is a correction you can apply
to the features you have *not* shipped yet, and to your QBR claims. If you ship
something in week 5, an A/B test started immediately lands in week 8, in time to
change the week-11 ship-or-cut call. That is the only path in the sim from "the
cleanest instrument arrives too late" to "the cleanest instrument arrives in
time." It requires shipping early, which is itself the lesson.

### 5. The trust arithmetic, which is more exact than it looks

Everyone starts at 60. Saying no to something they champion costs 12. So you can
say no to exactly two of any one person's asks before they are at **36** — one
point above the CEO's insertion threshold of 35, and one point above the level
at which the room starts treating you as having an organisational problem.

Look at the design: Marguerite champions exactly 2 features. Dan, 2. Kofi, 2.
Tomás, 2. Rina, 1. **If you cut everything a given person wants, they land at
exactly 36.** You are permitted to fully disappoint someone, or to ignore one of
their escalations (−15), but not both. That is not an accident; it is the
sim telling you where the cliff is.

Across the whole board there are seven championed features and nine
champion-links. Cut all seven and the trust pool goes from 300 to 192, an
average of **38.4 — below the 40 threshold, which caps your grade at C before
the metric is even computed.** The "I will ignore the politics and just optimise
the number" strategy is not merely risky; it is arithmetically capped.

The cheapest way out is also computable. Shipping something a person champions
is +8, so converting one cut into a ship is a 20-point swing. One championed
ship takes the all-cut pool from 192 to 212, an average of 42.4, clear of the
cap. The cheapest championed feature on the board carries a 3-week estimate.
Whether it is worth shipping a low-conviction feature purely to buy out of a
trust cap is exactly the sort of question this sim exists to make you answer out
loud — and note that if it turns out to have true impact under 0.5 pp it counts
toward the *other* cap. There is no free move here, which is correct.

Three more numbers worth carrying:

**A "no with a path" is cheap. A flat no is not.** Shipping one of Dan's two and
cutting the other leaves him at 60 − 12 + 8 = **56**, versus **36** for cutting
both. Twenty trust points for three to five eng-weeks — call it 10% of your
quarter. Whether that trade is good depends entirely on whether the thing has
impact, which is why the instrument you used to decide is the load-bearing part
of the answer, not the answer.

**Letting the CEO fall below 35 is the single most expensive mistake
available.** She inserts a feature at the head of your roadmap and you cannot
drop it for three weeks. Three weeks is 12 eng-weeks. If that fires at week 8,
you have roughly 20 eng-weeks left and 60% of them have just been allocated by
someone else. You did not lose control of the roadmap when she inserted it; you
lost it two conversations earlier.

**Rina's trust changes your map, not the territory.** Below 40, every estimate
you are shown inflates 30%. The features do not get more expensive; your
information gets worse, and a PM planning off inflated numbers under-commits and
leaves capacity idle. The failure is invisible from inside — the plan looks
prudent. Note the direction of the incentive: the person whose trust you most
need is the person with least positional power over you.

### 6. Calibration: the part that outlives the quarter

Every commit demands a predicted impact in pp and a rationale. Those get scored
at the debrief for hit rate, mean absolute error, and directional bias. A
forecast counts as a hit if it lands within **1.0 pp** of the truth, so "hit
rate" is a real bar and not a participation award.

Two related constants worth carrying. The mid-flight north star you see on the
desk carries about **0.6 pp of measurement noise** and only includes shipped
features — so a projected number that moved half a point last week moved for no
reason, and reacting to it is reacting to noise. And "vanity" is defined
precisely: **true impact below 0.5 pp**. Ship two of those and the grade caps at
C, which means a feature you committed to purely as relationship spend is a bet
that it clears 0.5, not a free move.

Two things to do with that. First, write the prediction as a point value but
record an interval next to it in the journal — if you cannot state a range, you
do not have a belief, you have a preference. Second, watch the sign of your
error. Noise is symmetric; if your errors are systematically positive you were
not measuring, you were selling — most likely to yourself, in the rationale box,
at the moment of commitment.

Also compute one number the sim does not: how far off you were on the true
*costs*, and in which direction. Everyone knows to be humble about impact.
Almost nobody carries an explicit personal multiplier on engineering estimates,
and yours is now measurable.

---

## THE OPENINGS THAT FAIL, WITH THE ARITHMETIC

Four plans you will be tempted by in week 1. Each fails for a reason you can
compute before you commit, which is the point of putting them here.

**"Fill the capacity."** Commit 44 to 48 estimate-weeks because that is what 48
of capacity means. Real cost 53 to 96 against 43 available. You ship the first
three or four and carry 10 to 20 eng-weeks of sunk work over the cliff. Every
stakeholder is disappointed by an item that was genuinely on the plan, which is
worse politically than never having promised it.

**"Keep everyone happy."** Ship the seven championed features. That is 47
estimate-weeks by itself before you build anything you believe in. You end the
quarter with high trust, a modest number, and no answer at the QBR to "which of
these did you choose, and why?" — because you did not choose anything.

**"Ignore the politics, optimise the metric."** Build only your three
uncontested features: 19 estimate-weeks, comfortably fits, capacity to spare.
But cutting all seven championed features caps your grade at C on trust alone,
and you have spent a quarter proving you cannot be given anything that requires
other people. Your own three features are also the ones with the least external
evidence attached, since nobody in the room is arguing for them.

**"Wait for the data."** Research is free in eng-weeks, so run everything. But
the build queue is idle while you do it, and 43 eng-weeks of capacity expire at
four per week whether you use them or not. Spending weeks 1 to 4 in discovery
burns 16 eng-weeks — 37% of your real budget — and buys information you can now
only act on with 27 left. Research has a decision deadline; past it, it is
journalism.

The plans that survive tend to share a shape: commit roughly 25 to 30
estimate-weeks in a firm tier, order it so the least-trusted estimate is early,
hold 8 to 10 eng-weeks unallocated, keep one championed feature in the plan for
each of the two people you most need in week 10, start something in week 1
rather than researching until week 3, and reserve a research slot for one
revealed-preference test on a single-tag feature. That is not the answer. It is
a plan that does not lose on arithmetic before judgment is even involved.

---

## WHAT THIS IS AND WHAT IT ISN'T

**The bias model is a deliberate simplification, and a strong one.** Real
instruments do not have a fixed additive bias per tag that you could in
principle estimate and subtract. Real bias is state-dependent, correlated with
the thing being measured, and changes when people know you are measuring. The
sim makes bias *learnable* so that the skill of triangulating is trainable at
all. Do not walk away believing you can debias a research program with linear
algebra; walk away believing that every channel has a direction and that
knowing the direction is most of the work.

**The feedback here is absurdly legible, and that is the biggest lie in the
building.** At the debrief you get the true impact of every feature, including
the ones you did not build. In the real seat you never learn the counterfactual.
You never find out what the road not taken was worth. Attribution is contested
for years, the metric moves for reasons unrelated to you, and the person who
gets credit is often whoever narrated it best. A quarter in a real product org
produces perhaps one clean causal read, if you ran an experiment, on one thing.
This sim gives you ten. It is training the reasoning, not simulating the
epistemics.

**Real features do not have a true impact number.** In here, every feature has
one exact pp value sitting behind a curtain, waiting to be revealed. Out there,
no such number exists, even in principle: impact depends on what else shipped, on the sequence,
on the segment mix that quarter, on execution quality that varies by a factor of
three between two teams building the same spec. The single largest simplification
in this sim is that quality of execution is not modelled at all. Features here
ship as specified. In life the same feature built well and built badly have
opposite signs, and a real PM spends much of their time on that gap rather than
on which item to select.

**The relationship texture is almost entirely missing.** You get a trust integer
and a chat feed. You do not get: the eight months of history that makes Dan
trust you or not before you open your mouth; the one-on-one where Rina tells you
something she would never put in a channel; the fact that Kofi is having a bad
quarter for reasons that have nothing to do with you; the reorg rumour that
makes everyone's revealed preferences change in week 9; the skip-level meeting
where your VP's boss forms a view of you from ninety seconds of hallway
conversation. Trust in the sim is a scalar that moves when you drop features.
Trust in life is a slow, multi-dimensional, memory-carrying thing that mostly
moves in the moments you were not aware were the moments.

**Also missing:** hiring and losing people, on-call, the six weeks of a quarter
that vanish into a compliance review, other teams whose roadmaps collide with
yours, customers who churn for reasons nobody logs, and the fact that a real
quarter starts in the middle of the previous one's commitments.

**What this can actually give you.** The experience of being the bottleneck for
five people who each want something reasonable. The specific discomfort of
telling a CEO no and needing a better answer than "the data doesn't support it."
Calibrated instinct for how far engineering estimates travel and what that does
to a plan. A working, correct vocabulary — north star, revealed versus stated
preference, fake door, activation, capacity commitment, decision quality versus
outcome — that you can use with PMs without sounding like you read a book. And a
personal number: your own optimism multiplier, measured.

**What it cannot give you.** Whether you would be a good PM. Twelve simulated
weeks and roughly a dozen decisions is not a sample; the single largest factor in
real PM performance — whether people want to work with you over years — is held
at zero here, replaced by an integer that resets next session. It also cannot
give you the hardest part of the job, which is not in this file at all: choosing
the problem. You were handed the metric, the mandate and the candidate list.
Someone did that work before the sim started, and that someone is doing the part
that actually separates people.

**If you finish this feeling like PM work is basically prioritisation under
uncertainty, re-read the debrief.** Prioritisation is the part that is legible
enough to simulate. It is not the part that is hard.

---

## FILES

```
index.html                     double-click this
data/company.js                the quarter (ground truth is base64 — do not decode it)
sim/                           engine, viz, org feed, UI
org/STAKEHOLDER_PLAYBOOK.md    how Claude runs the room — read this, it is the good one
org/DEBRIEF.md                 the post-reveal protocol, run after the QBR
journal/TEMPLATE.md            the decision log format
journal/week1.md               priors and prioritisation principle, before any research
journal/week6.md               what changed, what you updated, what you defended
journal/week11.md              ship or cut, and who you disappoint
journal/week12.md              the narrative, written before the score is revealed
SPEC.md                        the build contract
```

One instruction that matters more than any other in this file: **do not decode
`_t` in `data/company.js` before your QBR.** It is the true impact and true cost
of every feature and the exact direction each instrument lies in. Reading it
does not make you smarter about this quarter; it removes the only thing the
exercise was ever going to teach you, which is how it feels to commit without it.
