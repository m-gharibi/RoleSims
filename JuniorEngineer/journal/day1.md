# SPRINT LOG — Day 1, Monday | Date ________

60 / 60 hours. 10 / 10 hours of Deepa. 0 / 16 points. Everyone at trust 55.

Today is the only day on which you know nothing, which makes it the only day on
which your beliefs can be recorded honestly. That is why this file is longer than
the other four.

**Parts 0, 1 and 2 must be complete before your first action on any ticket.** Not
before your first PR — before your first `read_code`. Once anything returns, your
memory of what you believed this morning stops being evidence about what you
believed this morning and becomes a story about how reasonable you were.

Budget 15 minutes. It is the highest-value quarter hour in the sprint.

---

## PART 0 — THE ARITHMETIC, IN YOUR OWN HAND

Copy these out rather than reading them off the README. The point is to have the
numbers in your fingers, not on a screen.

**The two thresholds:**

I can open a PR at understanding ______. A PR merges at understanding ______.
The gap between them is ______ points, and nothing in the UI stops me from
implementing inside that gap.

**What repeating an action is worth.** `gained = yield × decay^n`. At decay 0.6:

| Pass | Multiplier | If the first pass gave me 30 points, this pass gives |
|---|---|---|
| 1 | 1.000 | 30.0 |
| 2 | 0.600 | |
| 3 | 0.360 | |
| 4 | | |
| 5 | | |
| **Total, all passes, forever** | **2.500** | |

**So the total lifetime value of any single action is ______ times its first
pass.** After four passes I have already collected 87% of everything it will ever
give me, and the remaining lifetime value is 32% of one pass — which is ______
points, against a threshold gap of ______ points.

Write the consequence out as a sentence, in your own words, because you will need
to recognise the situation from the inside on Thursday:

>

**The budgets.** My clock: ______ minutes. Deepa's budget: ______ minutes. Hers is
one ______ of mine, which means a minute of her time costs ______ times what a
minute of mine costs as a fraction of what each of us has.

Spread evenly across six tickets, her budget is ______ minutes per ticket, which is
______ well-formed questions each.

**A well-formed ask costs 15 minutes of her budget. A vague one costs 45.** So my
real budget is not ten hours, it is ten hours divided by ______.

**The review-lag deadline.** Review takes 2–5 hours. Six hours to a day. From day 7
Nnamdi's queue is deep.

- Last PR that can merge on a single clean shot: day ______.
- Last PR that can absorb **one** bounce: day ______.
- Which means the ticket I am least sure about needs to be understood by day
  ______, and escalated by day ______ if it is going to need escalating.

**Sixty hours minus the overheads.** Nominal 60, minus ~2 for the day-4 incident,
minus ~1.5 for gates and messages, leaves ______. Against six tickets that is
______ hours each, and an efficiently-run ticket is roughly 6.75 hours, so the
whole board is about ______ hours of work and ______ hours of margin.

**Name the four ordinary mistakes that would consume all of that margin:**

1.
2.
3.
4.

---

## PART 1 — ESTIMATES, BEFORE ANY EVIDENCE EXISTS

All six. Hours, not points. You have read six ticket descriptions and no code, and
you are going to estimate anyway, because that is the job and because on day 10 this
table is the only calibration record you will have.

You will want to write "depends" in several rows. Don't. A range with a stated
confidence is a perfectly respectable estimate and it is enormously more useful on
day 10 than a blank, because it is falsifiable and a blank is not.

| Ticket | Pts | Pri | My estimate (h) | Range | Confidence H/M/L | The one sentence I think this ticket **is** | What would make it 3× this |
|---|---|---|---|---|---|---|---|
| CHORE-2150 | 1 | P3 | | – | | | |
| BUG-2214 | 2 | P3 | | – | | | |
| FEAT-2189 | 2 | P3 | | – | | | |
| BUG-2201 | 3 | P2 | | – | | | |
| BUG-2207 | 3 | P1 | | – | | | |
| FEAT-2195 | 5 | P1 | | – | | | |

**Sum of my estimates: ______ hours. Against a usable ______ hours.**

Look at that ratio for a moment before you continue. If it is comfortable, ask what
you have assumed. If it is not, you have already learned the most important thing
about today.

**The confidence column is the one that matters and it is the one you will be
tempted to fill in uniformly.** Do not. You genuinely know more about some of these
than others, and the whole point of a first sprint is that you cannot tell which
until later. Mark at least two as Low and be able to say why.

### Reading the board as an estimator

**Which acceptance criteria could I not write a test against?** Go line by line.
There are at least two.

>

**Which acceptance criteria contain an escape hatch** — a clause that permits a
written explanation instead of a fix? Who wrote it, and what does that tell you
about what they already suspect?

>

**BUG-2214 fails "maybe one run in six." `run_tests` costs 15 minutes.** How many
runs to observe the failure once at 90% confidence? ______ = ______ hours. And to
be 90% confident a fix worked? ______ more runs = ______ hours. Total brute-force
cost of a 2-point P3: ______ hours.

**Given that number, what is my plan for 2214?** (There is a defensible answer that
involves not doing most of that, and it is written into the ticket.)

>

**The points fork.** BUG-2207 + FEAT-2195 = ______ points. BUG-2201 + FEAT-2189 +
BUG-2214 + CHORE-2150 = ______ points. Which side am I taking, and why?

>

---

## PART 2 — THE TIMEBOX POLICY

**This is the single most important thing you will write all sprint.** It is a rule
written by a calm person on Monday morning, for the use of a stressed person on
Thursday afternoon who will have excellent reasons why this particular ticket is
different. It never is.

A number is not a policy. "I'll timebox to two hours" says nothing about what
happens at two hours. Write a rule another person could apply to your sprint log
without asking you anything.

**Clock starts when:**

>

**The threshold** (state it in hours, or in actions, or in understanding — any of
the three is fine, and more than one is better):

>

**What I look at when it fires** (an observable, not a feeling):

>

**What I do, specifically** — the actual next physical action:

>

**Who I ask, and how I choose between them.** Deepa costs her budget; Hannah and
`#eng-help` are free. What kind of question goes to each?

| | Questions that go here | Why |
|---|---|---|
| Deepa | | |
| Hannah | | |
| #eng-help | | |

**The question template I will use, so that writing it is mechanical and not an
act of courage:**

>

*(If you cannot think of one: what I was trying to do, what I tried, what I
expected, what happened instead, what I currently think is going on. Four sentences
and it turns a well-formed 15-minute ask into a vague 45-minute one if you skip it.)*

**The upward trigger — when I stop investigating a ticket I already understand well
enough.** Almost nobody writes this one and it is where a quarter of the sprint
usually dies:

>

**The renegotiation clause.** Write the sentence you will say to yourself on
Thursday at minute eighty-nine, and then write your answer to it:

> What I will tell myself:
>
> My answer, written now:

**One more.** What is the earliest moment in this sprint at which I would be
prepared to hand a ticket back? State it as a condition, not a date:

>

---

## PART 3 — THE PLAN I AM POSTING TO THE TEAM

Draft it here first. Tobias scores it 0–2 on five things and tells you the score,
and the score determines how much supervision you attract for the next five days.

**1. Estimates.** Six numbers, a total, and the total reconciled against what is
actually usable:

>

**2. My timebox-before-asking policy** (from Part 2, in one paragraph):

>

**3. My order, and the rule that produced it.** The test: if a seventh ticket
landed tomorrow, does this rule tell me where it goes without further thought?

>

**4. Which tickets I forecast will NOT land, with a reason and a date by which I
will know:**

>

*(A wrong forecast still scores full marks. You are being graded on whether you
forecast at all. Tobias asked for exactly this in his first message and roughly
nobody gives it to him.)*

**5. How I intend to use Deepa deliberately rather than reactively.** Which tickets,
what kind of question, and whether any of it is scheduled rather than on-demand:

>

**How much of Deepa's ten hours do I expect to have left at the code freeze?**
______ hours.

*(Write the number. Circle it. It is going to be the first thing anyone asks you on
day 10, and if you are proud of it, that is the finding.)*

---

**Tobias's score: ___ / 10.**

What he said was missing:

>

The one live problem he left me with:

>

Anything Deepa said at the kickoff, verbatim if you can:

>

---

## PART 4 — DAY 1 IN THE MOMENT

**Actions taken today**

| Time | Ticket | Action | Nth | Min | Understanding → | Δ | Matched expectation? |
|---|---|---|---|---|---|---|---|
| | | | | | → | | |
| | | | | | → | | |
| | | | | | → | | |
| | | | | | → | | |
| | | | | | → | | |

**The first action of my career on this codebase.** What did I choose, and why that
one rather than another?

>

**The first time an action returned less than I expected.** What did I do in the
next fifteen minutes — try a different action, or repeat the same one?

>

**Did I talk to anybody today?** Who, about what, and what did the engine classify
it as:

>

**Did I ask Hannah anything?** Two of the six tickets have acceptance criteria you
cannot write a test against, and she is free. If the answer is no, what stopped me?

>

**One sentence at 15:00, before any analysis:**

>

---

## PART 5 — END OF DAY 1

| Ticket | Understanding | Hours in | Estimate | Still believe the estimate? |
|---|---|---|---|---|
| BUG-2201 | | | | |
| BUG-2207 | | | | |
| FEAT-2189 | | | | |
| BUG-2214 | | | | |
| FEAT-2195 | | | | |
| CHORE-2150 | | | | |

**Deepa's budget: ______ / 10 hours remaining.**

**Did anything today change my forecast of which tickets will not land?**

>

**The thing I am most worried about going into day 2, stated as a specific ticket
and a specific fear:**

>

---

## THE QUESTION, FOR THE FIRST TIME

> **Am I being diligent or stubborn right now — and how would I tell?**

On day 1 the honest answer is usually "too early to say," and that is fine. Answer
it anyway, and note *what evidence you would need* in order to answer it properly.
That list is the instrument you will use for the rest of the sprint.

>

---

## ONE RULE FOR TOMORROW

Testable from the sprint log by someone who was not here.

>
