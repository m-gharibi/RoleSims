# JUNIOR SOFTWARE ENGINEER SIM (PRE-AI)

*Pre-AI: there is no coding assistant in the action set. You investigate this
codebase the way you would have in 2018 — by reading it, running it, blaming it,
searching old messages, and asking a human. That is deliberate, not an oversight;
an assistant changes the discoverability of every ticket on this board and
deserves to be modelled properly rather than bolted on.*

Your first sprint on a new team. Ten working days, six tickets, four hundred
thousand lines of nine-year-old code you did not write, and four people whose time
is not yours to spend.

This is not a game about writing code. You have been writing code for years. It is
an apparatus for reproducing a state you left behind so long ago that you can no
longer summon it deliberately: **being the least knowledgeable person in the room,
and not knowing whether the last three hours were diligence or stubbornness.**

That distinction is the whole thing. From the inside, the two feel identical. Both
involve reading carefully, holding a question you cannot yet answer, and declining
to bother someone. One of them is how good engineers build a mental model of an
unfamiliar system. The other is how a week disappears. Nobody has ever been able to
tell them apart in the moment, which is why the sim gives you an understanding
curve and then makes you watch it go flat.

There is a second reason to run it, and for most people reading this it is the
bigger one. You now lead people who are in exactly this position, this week, on
your team. The debrief closes on that: what a plateau looks like from the outside,
why the junior who never asks is usually frightened rather than arrogant, and why
"just ask me anything" is not a real invitation until you attach a budget to it.

---

## RUNNING IT

Double-click `index.html`. That is the whole install.

No server, no build, no network, no npm. It runs from `file://`. The world file
carries an encoded ground truth that nothing in the UI reads until you submit your
retro. Decoding it is a two-line job and it destroys the only thing here worth
having — in particular it tells you which tickets can be solved alone, which is the
single fact the entire exercise is built around not knowing.

The sprint runs on a clock you can pause and step. Ten days, six focused hours
each, roughly 09:00 to 15:00 on the sim clock, sixty working hours from Monday
morning to the Friday-week-two code freeze.

---

## THE SCENARIO

You are Software Engineer I on the Dispatch team at Thistle, which sells dispatch
and scheduling software to field-service companies. The codebase is 412,000 lines,
nine years old, Python and TypeScript and a little Go nobody admits to. Two
framework migrations, both abandoned halfway. The wiki has never had a page
deleted.

Six tickets are on the board, worth sixteen story points between them.

| Ticket | Type | Pri | Pts | Reporter |
|---|---|---|---|---|
| BUG-2201 | bug | P2 | 3 | Support — dispatch list sorts wrong after a DST change |
| BUG-2207 | bug | P1 | 3 | Support — webhook retries fire twice for some enterprise accounts |
| FEAT-2189 | feature | P3 | 2 | Hannah Brecht — CSV export on the driver activity report |
| BUG-2214 | bug | P3 | 2 | CI — intermittent failure in the scheduling test suite |
| FEAT-2195 | feature | P1 | 5 | Hannah Brecht — rate limiting on the public API |
| CHORE-2150 | chore | P3 | 1 | Nnamdi Eze — upgrade the lint config to the shared preset |

Four people, all starting at trust 55 out of 100:

- **Deepa Iyer**, staff engineer, your onboarding buddy. Nine years on this
  codebase; she wrote about a third of it and regrets some of that. Generous,
  direct, stretched extremely thin. **She has ten hours for you this sprint.**
- **Tobias Lindqvist**, tech lead. Runs standup, owns delivery. Cares far more
  about whether you are blocked than whether you are fast. The one thing he cannot
  forgive is a junior sitting silently stuck for two days.
- **Nnamdi Eze**, senior engineer, your reviewer. Picky, fair, fast. Will not merge
  code whose author cannot explain it.
- **Hannah Brecht**, PM. Writes tickets that are clear in her head and
  underspecified on the page. Delighted when someone asks her a clarifying
  question, which almost nobody does.

Tobias's first message on day one is the mission statement and you should read it
as one:

> "Six tickets on the board. I do not expect all six — I expect you to tell me
> early which ones are not going to happen."

**Six is not the target.** The target is a defensible allocation and an early,
accurate forecast. There is a `Dev.abandon()` in the API and it is there because
handing a ticket back on day three is sometimes the highest-scoring move available.

---

## THE RULES

| | |
|---|---|
| Sprint | 10 days × 6 focused hours = **60 hours**, in 15-minute ticks |
| Deepa's budget | **10 hours**, total, for the whole sprint |
| Starting trust | 55 with each of the four; grade capped at C if average trust ends below 40 |
| Understanding to open a PR | **70** (`implementReadyAt`) |
| Understanding to survive review | **90** (`correctAt`) |
| Rework scaling on implement | `effortHours × (1 + max(0, 90 − understanding) / 100)` |
| Investigation yield | `gained = yield × decay^(times already done)` |
| Negative yields | real — wrong docs and red herrings subtract understanding |
| Solo ceiling | on a ticket that is not self-findable, solo work is hard-clamped below 70 |
| Estimates | required before work starts on any ticket |
| Stuck flag | understanding flat for 3 hours |
| Ask, before your timebox | trust −6, and it costs double Deepa's budget |
| Ask, after your timebox | trust **+4**, half the budget cost |
| Ask, past 2.5× your timebox and still under 70 | trust −3, and the squad remarks on it |
| Asking Hannah or the channel | free — costs no senior budget |
| Review lag | 2–5 hours; a bounce costs a cycle and −2 trust with Nnamdi |
| Cardinal sin | merging at understanding < 90 by resubmitting without new investigation — caps the grade at C |

Everything is driven by a seeded PRNG. Same seed replays identically.

### The one rule that generates all the others

**Understanding gates implementation at 70 and correctness at 90.**

Read that twice. The button that lets you start writing code turns on twenty points
before the code can be right. The UI will happily let you implement, pay the rework
tax, open the PR, and get it bounced. Nothing stops you.

That is not a bug in the design. It is the most faithful thing in the whole
simulator. No real codebase has ever prevented anyone from opening a pull request
they did not understand.

---

## THE ARITHMETIC, BEFORE YOU PLAY

Twenty minutes here is worth more than any two hours of play. None of it is visible
from inside the UI until it is too late to act on.

**A note on the numbers.** Every per-ticket constant in this sim is encoded and I
have not looked at it, and neither should you. The worked figures below use the
example values printed openly in `SPEC.md` — `read_code` yield 30, `ask_deepa`
yield 60, `decay` 0.6, `timeboxHours` 1.5, `effortHours` 3.5, `bestHours` 41.5.
Those are the spec's illustration, not this scenario's ground truth. The *shapes*
they produce are exact and hold for any parameters, and the shapes are the point.

### 1. What repeating an action is actually worth

`gained = yield × decay^n`, where `n` is the number of times you have already
performed that action on that ticket. So the first performance is worth `yield`,
the second `yield × decay`, the fourth `yield × decay³`.

At `decay = 0.6`, the fourth performance is worth **21.6%** of the first. Here is
`read_code` at 30 minutes a pass and a first-pass yield of 30:

| Pass | Multiplier | Points gained | Cumulative | Cumulative hours | Points **per hour** |
|---|---|---|---|---|---|
| 1 | 1.000 | 30.0 | 30.0 | 0.50 | 60.0 |
| 2 | 0.600 | 18.0 | 48.0 | 1.00 | 36.0 |
| 3 | 0.360 | 10.8 | 58.8 | 1.50 | 21.6 |
| 4 | 0.216 | 6.5 | 65.3 | 2.00 | 13.0 |
| **5** | **0.130** | **3.9** | **69.2** | **2.50** | **7.8** |
| 6 | 0.078 | 2.3 | 71.5 | 3.00 | 4.7 |
| 7 | 0.047 | 1.4 | 72.9 | 3.50 | 2.8 |
| 8 | 0.028 | 0.8 | 73.7 | 4.00 | 1.7 |
| ∞ | — | — | **75.0** | ∞ | 0 |

Three things fall out of that table and each of them changes how you play.

**Every action has a hard ceiling of `yield / (1 − decay)`.** At decay 0.6 that is
2.5× the first pass, and no amount of persistence exceeds it. `read_code` on this
ticket is worth 75 understanding points in total, forever, across all the passes
you will ever make. It cannot get you to 90. Not slowly. Not at all.

| decay | Ceiling as a multiple of one pass | Passes to reach 90% of it |
|---|---|---|
| 0.5 | 2.00× | 4 |
| 0.6 | 2.50× | 5 |
| 0.7 | 3.33× | 7 |
| 0.8 | 5.00× | 11 |

**After four passes, the entire remaining lifetime value of the action is 32% of
one pass.** At yield 30 that is 9.7 points — total, from here to the end of the
sprint. The gap between "I can open a PR" and "the PR will merge" is 20 points.
**So if you are sitting at 70 having read the code four times, you cannot reach 90
by reading it again, and the arithmetic says so before the plateau does.** To close
a 20-point gap on residual value alone you would need a first-pass yield above 62,
and nothing solo in this world is that generous.

**The fifth pass is the one worth naming.** Thirteen percent of the first pass. 3.9
points for half an hour, or 7.8 points per hour. A well-formed question to Deepa
costs fifteen minutes of your clock and, in the spec's example, returns 60 points —
240 points per hour. **The fifth reading of the same file is roughly thirty times
less productive than one good question**, and the thing that makes it feel like
work is that the first reading really was worth 60 points per hour, and your body
remembers that.

Negative yields decay too. A wrong wiki page at −15 costs you 15, then 9, then 5.4,
then 3.2 — a cumulative −32.6 points for eighty minutes of reading. That is a third
of a ticket, spent going backwards, and the sim will fire a mentor message at you
if you stay in it past ninety minutes.

**Context switching is taxed by this model and nowhere else.** When you drop a
ticket and come back to it, the pass you spend reloading context is pass n+1, not
pass 1. Switching between two tickets four times does not cost you four passes of
`read_code` at full value; it costs you passes 3, 4, 5 and 6 — 21.6 points where
you might have expected 120. Interleaving to hide review latency is a real
strategy, and this is its real price. Price it before you adopt it.

### 2. The ask economy

Deepa has 600 minutes. You have 3,600. **Her budget is one sixth of yours, which
means every minute of her time costs six times what a minute of yours costs, as a
fraction of what each of you has to spend.** That ratio is the fact juniors do not
feel and seniors cannot stop feeling.

`askCostMinutes` is 15 of your time. A vague ask adds `vagueAskExtraMinutes` = 30,
because she has to dig. A well-formed ask costs half the senior budget of a
premature one. Depending on how the engine composes those:

| If a well-formed ask costs Deepa | Asks in the sprint | % of her budget each | % of *your* sprint each |
|---|---|---|---|
| 15 min | 40 | 2.5% | 0.42% |
| 22.5 min | 26 | 3.75% | 0.63% |
| 30 min | 20 | 5.0% | 0.83% |
| 45 min (vague) | 13 | 7.5% | 1.25% |

Spread evenly across six tickets, her ten hours is **100 minutes per ticket** —
between three and six good questions each. That is not scarcity. That is
abundance, and here is the number that matters:

**You will almost certainly finish this sprint with unspent budget.** The bar on
the header will still have hours on it at the code freeze. That is the most common
outcome and it is the finding, not the achievement. The ten-hour ceiling is not a
rationing scheme, it is a permission structure — a visible, countable statement
that asking is an *expected* use of a resource that was allocated to you. The sim
puts the bar on screen so that underspending becomes as visible as overspending,
because in real life only one of those two is ever noticed.

The scarce resource is not Deepa's hours. It is your willingness to spend them, and
the score measures both.

**What a question costs when you get it wrong.** A premature ask is −6 trust and
double the budget. Ask three questions cold in the first two days and you have
spent 90 minutes of her time to buy answers worth 45 minutes, and put Deepa at 37.
A vague ask — one that does not say what you already tried — costs 45 minutes
against 15, so **asking badly cuts your access to Deepa by two-thirds.** The
budget is not really ten hours. It is ten hours divided by how well you write.

**The window.** With a timebox of 1.5 hours, `well-formed` opens at 1.5 hours on
that ticket and `overdue` begins at 3.75. That is a 2.25-hour window — 3.8% of the
sprint — and you have to notice you are inside it while you are inside it. The
stuck flag fires at 3 hours of flat understanding, which is *before* the overdue
threshold. The engine is trying to warn you inside the window. Whether you are
looking at the plot when it does is the test.

Note the exact wording of `overdue`: past 2.5× the timebox **and still below 70**.
If you got yourself to 70 honestly in three hours, an ask at hour four is not
overdue — it is well-formed and it is exactly right, because 70 is not 90 and you
have just proved the code will not take you the rest of the way.

**And two of your four ask targets are free.** Hannah costs no senior budget and is
the correct move on any ticket whose requirements are ambiguous — which, reading
the board below, is not a small subset. `#eng-help` is free, slow (30–120 minutes
of simulated delay), and occasionally a stranger being confidently wrong at you.
Spending Deepa's budget on a question Hannah could have answered is a category
error that costs real money.

### 3. Sixty hours against six tickets

Sixty hours over six tickets is ten hours each and it sounds generous. Price it.

An efficient ticket, using the spec's example values, is roughly: 2.5 hours of
investigation to reach 90, 3.5 hours of implementation at no rework tax, 0.75 hours
of tests. Call it 6.75 hours. Six of those is 40.5 hours, which is why the spec's
example `bestHours` is 41.5. **The ideal sprint uses about 69% of your capacity.**

Now spend the other 31%.

| | Hours | Running |
|---|---|---|
| Nominal capacity | 60.0 | 60.0 |
| Day-4 production incident — room is loud, Deepa is on it | −2.0 | 58.0 |
| Four gates, Hannah's day-5 question, replies in the feed | −1.5 | 56.5 |
| Six tickets at the ideal 6.75 h | −40.5 | **16.0 slack** |

Sixteen hours of slack. Now the ways it dies, none of which is bad luck:

| | Hours | Slack left |
|---|---|---|
| Rework tax: implementing at 75 instead of 90, six times (`×1.15` on 3.5 h) | −3.2 | 12.8 |
| Three PR bounces, ~1.5 h of rework each | −4.5 | 8.3 |
| One ticket where you ran four hours past your own timebox before asking | −2.5 | 5.8 |
| Two wrong-documentation detours at an hour each, plus the reading to undo them | −3.0 | 2.8 |
| One estimate that was 2× wrong on a ticket you did not abandon | −3.5 | **−0.7** |

That list is not a disaster scenario. Every line is an ordinary first-sprint
behaviour, and together they are exactly one hour more than everything you had.
**A correction, and it matters.** The 40.5-hour figure above is built from the
spec's *illustrative* constants, not this board's. The efficient path through these
six tickets is materially shorter than 40.5 hours, so your real slack is much wider
than this table's `-0.7` suggests, and you are not going to run out of clock by
Thursday.

Read the table as a mechanism, not a forecast. Every line in it is a real way that
hours disappear and every one of them will happen to you. But the honest conclusion
is the opposite of panic: **time is not the binding constraint in this sprint —
judgement is.** You have room to investigate properly. What you do not have is room
to investigate the wrong thing for two days, and no amount of clock would fix that.
If you finish this README feeling rushed, you have taken exactly the wrong lesson,
and rushing is the single most reliable way to fail this scenario.

**The rework tax, exactly:**

| Understanding at implement | Multiplier | 3.5 h becomes | Tax | Will the PR merge? |
|---|---|---|---|---|
| 70 (button just enabled) | 1.20 | 4.20 h | +0.70 h | **No** |
| 75 | 1.15 | 4.02 h | +0.53 h | **No** |
| 80 | 1.10 | 3.85 h | +0.35 h | **No** |
| 85 | 1.05 | 3.68 h | +0.18 h | **No** |
| 90 | 1.00 | 3.50 h | 0 | Yes, if tests and convention and scope hold |

The tax is the small half of the cost. The real cost of implementing at 70 is the
whole loop: 0.7 hours of rework tax, a 2–5 hour review lag, a bounce at −2 trust,
then discovering that you cannot close a 20-point gap solo because you already
spent your decay, then an ask that is now likely to be classified overdue at −3,
then rework, then a second review lag. **Call it five hours and five trust points
for a decision that felt, at the time, like starting work.**

### 4. Review latency is a calendar problem, not a capacity problem

Review lag is 2–5 hours, mean 3.5. Six PRs with one clean cycle each is 21 hours of
latency against a 60-hour sprint. If you serialise — finish, submit, wait, start
the next one — you lose all of it. If you interleave, you lose none of it and pay
the context-switch decay from §1 instead. There is no third option and choosing
deliberately between those two is most of what "planning a sprint" means here.

On day 7, Nnamdi says his queue is deep and anything opened late in the day is
looked at the following morning. Combine that with a 15:00 day-end and a 5-hour
worst-case lag:

| What you want from a PR | Latest it can open |
|---|---|
| One clean shot, same-day review | **D10, 10:00** |
| Room to absorb one bounce (review + 1.5 h rework + review) | **D8** |
| Room to absorb two bounces | **D7 morning** |

**If you want the right to be wrong once about a ticket, its first PR opens on day
eight.** That constraint propagates backwards through the whole sprint and it is
invisible unless you compute it: it means the riskiest ticket has to be
*understood* by day six, which means it has to be *escalated* by day four, which
means you needed a timebox policy on day one. Tobias's day-9 code-freeze warning is
not information. By day 9 it is a receipt.

### 5. Read the board like an estimator, not like a developer

Everything below comes from the public ticket text. It is the highest-value fifteen
minutes in the sim and almost nobody spends it.

**The two P1s are worth exactly as much as the four cheap ones.** BUG-2207 (3) plus
FEAT-2195 (5) is 8 points. BUG-2201 (3) plus FEAT-2189 (2) plus BUG-2214 (2) plus
CHORE-2150 (1) is also 8 points. Half the board's value sits in two tickets and the
other half sits in four. That is a real fork in the plan and you can see it on day
one without doing any work at all.

**Two acceptance criteria contain an escape hatch, and someone wrote them on
purpose.**

> BUG-2207: "Duplicate deliveries stop, **or we document why they must not.**"
> BUG-2214: "CI is green reliably, **or we know exactly why it is not.**"

Nobody writes that clause about a problem they expect to be tractable. The clause
is the reporter telling you, in the ticket, that a well-evidenced explanation is an
acceptable deliverable. Both tickets can therefore be *completed* without being
*fixed* — which is a different thing from abandoning them, and worth more.

**Two acceptance criteria are not falsifiable as written.**

> FEAT-2189: "Follows the current export conventions." Which conventions? The
> ticket asserts they exist and does not name them. That is a convention decision
> handed to you unstated, on a codebase with two abandoned migrations in it, where
> the neighbouring code is exactly as likely to be the legacy pattern as the
> current one.
>
> FEAT-2195: "Add sensible limits and make sure abusive clients cannot affect other
> customers." *Sensible* is not a specification. This is 5 points, P1, tied to a
> partner launch, written by the PM who is delighted when someone asks a clarifying
> question and almost never gets asked one. Asking Hannah costs zero senior budget.

**BUG-2214 has an observability cost you can compute right now.** It fails "maybe
one run in six." `run_tests` costs 15 minutes. To observe the failure at least once
with a given confidence you need `n` runs where `1 − (5/6)^n` clears it:

| Confidence of seeing it at least once | Runs | Time |
|---|---|---|
| 50% | 4 | 1.00 h |
| 75% | 8 | 2.00 h |
| 90% | 13 | 3.25 h |
| 95% | 17 | 4.25 h |

And the symmetry is brutal: after you "fix" it, thirteen consecutive green runs is
also only 90% confidence that you fixed anything, because `(5/6)^13 = 9.4%`. **A
2-point P3 chore costs 6.5 hours to observe and verify by brute force, before any
thinking happens** — which is 11% of your sprint and more than the ideal cost of a
whole ticket. That is what the "or we know exactly why it is not" clause is for,
and the person who wrote it knew. Deciding *not* to brute-force this is a real
engineering decision, it is available on day one, and it is worth writing into your
plan with the number attached.

**CHORE-2150 is the only ticket that estimates itself.** "Should be quick." One
point. Written by your reviewer. Everything you know about nine-year-old repos with
two abandoned migrations applies to that sentence, and so does everything you know
about who writes it.

### 6. The trust floor takes three bad habits, not one

Starting trust is 55 × 4 = 220. Average below 40 means a sum below 160, so you have
sixty points of room. Premature asks are −6, bounces −2, overdue asks −3. Nine
premature asks would floor Deepa at zero and still leave your average at 41.

You cannot get capped by being annoying to one person. You get capped by
*compounding*: premature asks to Deepa, repeated bounces with Nnamdi, silent
stuckness that Tobias has to raise himself, and never once talking to Hannah. Which
is exactly how bad first sprints actually happen — not one visible failure but four
quiet ones that each looked defensible on the day.

The other cap is sharper and it is worth reading slowly: **merging a PR at
understanding below 90 by resubmitting without new investigation caps the grade at
C, regardless of everything else.** Shipping code you do not understand is the
cardinal sin of the role. In this sim it is mechanically detectable. In your job it
is not, and that asymmetry is worth sitting with.

---

## THE PROTOCOL

The simulator is the smaller half. The chat gates are where the learning happens,
because they force you to state a position before the sprint resolves it and then
confront the record afterwards.

Open a Claude conversation next to the browser before you start, and paste this in:

> You are running the Dispatch team at Thistle. Read `squad/MENTOR_PLAYBOOK.md` and
> follow it exactly. I am the new engineer, first sprint. I will bring you a day-1
> plan, a day-3 standup, a day-6 1:1 and a day-10 retro. You do not know the ground
> truth — in particular you do not know which tickets can be solved without asking
> — and you must never pretend to. Stay in character.

Then:

**1. Read the brief and the board (10 min).** Six tickets, seven actions, four
people. Read §5 above with the tickets open and mark the two acceptance criteria
you could not write a test against.

**2. Fill `journal/day1.md` BEFORE you touch anything (15 min).** It forces two
things out of you: an hours estimate for all six tickets, and a written timebox
policy. Both before any work. This is the single highest-value quarter hour in the
file, because on day ten it is the only record of what you actually believed as
opposed to what you will remember believing.

**3. Post the plan to the team in chat (10 min).** Not a to-do list. Estimates,
order and the reason for the order, which tickets you think will *not* land, and
how you intend to use Deepa deliberately rather than reactively. Tobias scores it
out of ten against a published rubric and tells you the score. A plan that is
really a list scores 2 and he will say so.

**4. Run days 1 and 2.** Estimate before work — the engine enforces it. Watch the
understanding plot, not the clock.

**5. Day-3 standup in chat (5 min).** Yesterday, today, blockers. Tobias is hunting
for one specific thing and the playbook tells him how: the blocker you have not
said out loud yet. If you have one, he will find it, and how that feels is a large
part of what you came for.

**6. Run days 4 and 5.** There is an incident on day 4 that you are not on the rota
for. Hannah asks about rate limiting on day 5 and it needs a reply.

**7. Day-6 1:1 with Tobias in chat (5–8 min).** How is it going, and what would you
want more of. The second half of that question is the real one and most people
waste it.

**8. Run days 7 to 10.** Nnamdi's queue is deep from day 7. Code freeze at the end
of day 10. Re-read §4 on day 7, not day 9.

**9. Day-10 retro (10–12 min).** Fill `journal/day10.md` first — **the narrative
before the score**, and the template is ordered that way deliberately. Then submit
the retro in the sim, copy the exported markdown, and paste the whole thing into
chat. The team walks it with you. They are judging your *judgement*, not your
outcome — they do not know your outcome any better than you do — and they will take
apart a ticket that merged as readily as one that did not.

**10. Debrief (20 min).** The reveal shows the true route against the one you took,
and marks where the optimal ask point was on each ticket. Then run
`squad/DEBRIEF.md` in a fresh conversation. Do not run it in the ten minutes after
the score; the reveal produces a brief strong urge to relitigate and nothing said
in that window is worth writing down.

**Budget: about 90 minutes end to end.**

| | |
|---|---|
| Read the arithmetic above | 20 min |
| Brief and board | 10 min |
| `journal/day1.md` before any work | 15 min |
| Four chat gates | 30 min |
| Running the ten days | 25 min |
| Debrief | 20 min |

That sums to 120 if you do all of it properly. Ninety is what it takes if you
already know how to read a ticket board, which you do. The 20 minutes of arithmetic
is the part to protect if you are short — it is the part that changes what you do
inside the sim, and everything else only changes what you notice afterwards.

---

## WHAT THIS IS AND WHAT IT ISN'T

**The discoverability model is a deliberate simplification, and it is the biggest
one in the file.** Each ticket carries a clean vector of per-action yields and a
boolean saying whether solo work can ever reach the bar. Real codebases do not
publish that boolean, and they do not publish it in a much more specific way than
"you have to find out": the signals are murkier, they are correlated, and they
change as you learn. In reality you do not discover "the answer is not in the code."
You discover that the answer is *probably* not in the code, from a decaying
sequence of increasingly expensive partial reads, and you are never sure, and the
uncertainty about whether you have looked hard enough is a large part of what makes
the real version exhausting.

The sim replaces that with a plateau you can see on a chart. That is a real
simplification and it makes the exercise possible, but do not mistake the clarity
of the plateau for a skill you now have. What you can legitimately take away is the
*shape*: that stalled understanding is information, that it arrives well before you
feel entitled to act on it, and that the arithmetic of decay makes "one more pass"
a mathematically bad bet long before it feels like one.

**The yields are invented.** Every number behind every ticket was written by the
person who built the world file. You will not learn anything about DST handling,
webhook idempotency, rate limiting or flaky tests. There is no code here that would
run.

**Asking is modelled as a transaction and it is not one.** In this sim a
well-formed question costs 15 minutes and returns a number. In reality asking is a
relationship, the answer is partial, the answer is sometimes wrong, and the same
question asked on a Tuesday afternoon and a Friday at 17:30 gets different answers
from the same person. The cost is also not symmetric across people in the way the
budget implies — some seniors are energised by a good question and some are
depleted by any interruption, and you cannot tell which from an org chart.

**The gates are compressed to the point of distortion.** A real 1:1 is thirty
minutes and half of it is not about work. A real standup has five other people in
it and your blocker competes for airtime with a deploy problem. The sim gives you
an audience whose entire attention is on you, which is both a gift and a lie.

**Nobody here has a bad day.** Deepa is stretched but never short with you. Nnamdi
is picky but never punitive. Tobias never has to choose between protecting you and
protecting the release. Hannah never pushes back. On a real team at least one of
those four is having a difficult quarter for reasons that have nothing to do with
you, and learning to read that is most of what "fitting in" turns out to mean.

**One sprint is not a sample of you.** You will make perhaps forty decisions and
open perhaps four PRs. If you get an A the honest reading is that you allocated
defensibly and the discoverability profile was kind. If you get a D, one of those
went wrong and the debrief will tell you which. **Update on the calibration table,
which has six observations in it, not on the grade, which has one.**

**What this can actually give you.** The specific, physical experience of not
knowing whether to ask. A felt sense of what a decaying return curve does to
motivation — that the fifth pass is worth 13% of the first and feels like 80%.
Practice writing a question that costs a senior nothing to answer. Practice
forecasting under total ignorance and then reading your own calibration. And, if
you lead people: a first-person memory of the room where asking felt expensive, to
put against every "just ask me anything" you have ever said and thought was
sufficient.

**What it cannot give you.** Any technical skill whatsoever. Any sense of how you
would behave over months rather than days. Any experience of the thing that
actually makes a first sprint hard, which is not the tickets — it is the sustained
ambient state of being visibly, continuously worse at the job than everyone around
you, in front of people whose respect you want and cannot leave.

**If you finish this feeling like you understand what your juniors are going
through, the exercise has half worked.** The correct end state is narrower and more
useful: a short list of specific things you could change about how you onboard
people, each of which is cheap, and at least one of which you will actually do this
month.

---

## FILES

```
index.html                    double-click this
data/repo.js                  the scenario, six tickets, the encoded truth — do not decode it
sim/                          dev engine, board, squad feed, UI
squad/MENTOR_PLAYBOOK.md      how Claude runs the team across the four gates
squad/DEBRIEF.md              the post-reveal protocol, run after the retro
journal/TEMPLATE.md           the daily log
journal/day1.md               estimates and a timebox policy, before any work
journal/day3.md               the standup day — the buried-blocker audit
journal/day6.md               the midpoint — the honest forecast
journal/day10.md              the retro narrative, written before the score
SPEC.md                       the build contract
```
