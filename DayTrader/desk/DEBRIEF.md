# THE DEBRIEF — after all three sessions

Run this once, after Day 3, in one sitting. Forty-five minutes. It is the part of
the exercise that converts three afternoons of pattern-matching into something
you can still use in six months.

**Setup.** Open a fresh conversation and paste in: this file, all three tearsheets,
and all three journals. Then:

> Read `desk/DEBRIEF.md` and run it on me. You are Dana. Here are the three
> tearsheets and the three journals. Do the arithmetic yourself before you say
> anything, hold me to Part 4, and do not let me end this more confident than the
> evidence supports.

Dana runs Parts 1 through 3. Part 4 is not a role — it is you and Claude out of
character, and it matters more than the rest.

---

## PART 1 — ASSEMBLE THE NUMBERS

Build this table first. Most of the findings fall out of it before anyone offers
an interpretation.

| | Day 1 | Day 2 | Day 3 |
|---|---|---|---|
| Pitch score (of 10) | | | |
| Size authorized / size actually traded | | | |
| Day P&L | | | |
| Ending equity | | | |
| Trades | | | |
| Win rate | | | |
| Avg win / avg loss | | | |
| Expectancy per trade | | | |
| Avg hold: winners / losers | | | |
| Peak day P&L / closing P&L | | | |
| Max intraday drawdown | | | |
| Trades between 11:00 and 14:00 | | | |
| Largest position as % of line | | | |
| Own stated daily stop / worst P&L reached | | | |
| Commissions | | | |
| Process grades (count of A / B / C / D) | | | |
| Risk events | | | |
| Rule written at the end | | | |
| Previous session's rule kept? | | | |

Two derived numbers to compute explicitly:

**Expectancy per trade**, per day: `E = p·avg_win − (1−p)·avg_loss`. Then compare
it to the actual P&L divided by trade count. If they disagree materially, one or
two trades are carrying the whole day, which is worth knowing.

**Cost drag.** Total commissions plus estimated slippage across all three days
against gross P&L. If costs are over 25% of gross, the number of trades is the
problem, not the quality of the reads.

---

## PART 2 — WHAT TO LOOK FOR ACROSS THE THREE

Single-session patterns were covered in the daily reviews. These are the ones
that only exist in the comparison, and they are the reason the sim carries the
account across three days rather than resetting it.

**1. Did process quality track P&L, or was it independent?**
Count the A/B/C/D grades per day and put them next to the daily P&L. The
instructive case is a day with mostly A and B grades that lost money, or mostly
C and D grades that made money. If those exist, you have direct personal evidence
that outcome is a corrupted signal about decision quality over short horizons —
which is the single most transferable thing in the entire exercise and applies
far outside trading.

**2. Did the Day 1 rule survive Day 2?**
Go to Day 1's "one rule for next session" and grep Day 2's tearsheet for
violations. Then Day 2's rule against Day 3. This is a measurement of your
personal rule-adherence half-life under stress. Most people's is about four
hours. If a rule survived, ask what made *that* rule stick when the others did
not — usually it was mechanical and checkable rather than aspirational, and that
is a reusable design principle for any commitment device you ever build.

**3. How long did it take to notice the regime changed?**
Day 2 does not behave like Day 1. Find the trade on Day 2 where you had enough
information to update your model and did not, and price the delay in dollars.
Then ask the harder version: on a real desk, nobody labels the regime change, and
the same delay costs you every time it happens. What would have made you notice
faster — a rule, a metric on the screen, a scheduled question you ask yourself
at 10:30?

**4. Sizing across the three days.**
Plot position size against day-of-session and against running P&L. Three
signatures to check for:
- Size escalates when down → the make-it-back reflex
- Size collapses when up → the protection reflex
- Size uncorrelated with stop distance → no sizing discipline at all
The third is the most common and the most fixable. The first is the most
expensive.

**5. Did the P&L baggage show up on Day 3, as predicted?**
You wrote a prediction in `journal/day3.md` before the briefing. Check it against
the tape. Whether you were right about yourself is more interesting than whether
you made money. If you predicted "I'll try to make it back" and then didn't, ask
whether the prediction *caused* the restraint — because if it did, you just
discovered that writing the failure mode down in advance is an effective control,
and that generalises to everything you do.

**6. The emotional log against the trade log.**
Line up the timestamps. Where does a strong emotional entry sit relative to the
worst decision of the day? The usual finding is a lag: the bad trade comes two to
eight minutes *after* the peak of the feeling, in the recovery, when you feel
calm enough to act and are not. Look specifically at what you did in the ten
minutes following each risk warning.

**7. Thesis quality drift.**
Read the thesis strings in chronological order across all three days, ignoring
everything else. They usually start as sentences and end as fragments. Where they
degrade is where you stopped deciding and started reacting. The average character
count of your typed theses per hour is a crude but surprisingly honest attention
metric.

**8. What you never did.**
Across three sessions: did you ever short? Did you ever add to a winner? Did you
ever stand aside for an entire morning on purpose? Did you ever take a trade
against the story in the briefing? The absences describe the shape of your
comfort zone more precisely than any of the trades do.

---

## PART 3 — HONEST ASSESSMENT

### The claims audit

Write down what you believe about your own trading after three days. Then run
each claim through this:

- **What would I need to see to believe the opposite?**
- **How many observations is this based on?**
- **Would a professional with twenty years of data accept this as evidence?**

### The sample size problem, with numbers

You ran roughly 20 to 40 round-trips across three sessions. That is not a small
sample. It is effectively no sample.

- The standard error on a win rate estimated from 40 trades is about **8
  percentage points**. A measured 55% is consistent with anything from 39% to
  71%. The entire difference between a good discretionary trader and one who
  should be doing something else lives inside that interval.
- Distinguishing a genuinely skilled trader (Sharpe ratio 1.0) from a coin-flipper
  at conventional statistical confidence takes about **four years** of daily
  returns. `t = SR × √years`, and you need t ≈ 2. Three days is 0.012 years.
- Your three-day P&L is almost certainly dominated by one or two trades. Remove
  the single largest winner and the single largest loser and recompute the total.
  If the number changes sign or halves, you learned nothing about your edge from
  the total — you learned about two trades.

None of this means the exercise failed. It means the exercise was never about the
P&L, and any confidence you feel that traces back to the P&L is unearned. Say the
number out loud once, then set it aside permanently.

### What you can legitimately claim

- You know what the decision feels like with a clock running and size on.
- You know your own characteristic move when the number goes red, because you
  observed it three times under mild but real pressure.
- You can read a blotter, an equity curve and a tearsheet and say something
  useful about them.
- You can use the vocabulary correctly: VWAP, the opening range, invalidation,
  give-back, expectancy, adverse excursion, being flattened, the difference
  between process and outcome.
- You understand, concretely rather than abstractly, why slippage dominates
  commission and why that makes overtrading fatal.
- You have felt the specific unpleasantness of being asked to justify a position
  you took for a reason you would rather not say out loud.

### What you cannot claim, and should proactively disclaim

- Any edge, in any market, of any size.
- That you know how you would behave with real money. The single largest variable
  in the entire system was held at zero.
- That you know how you would behave in month seven of a drawdown. Everything you
  learned about yourself was measured over ninety minutes total, well rested,
  with a pause button.
- That the desk you experienced resembles a specific real desk. It is a
  composite, written to be instructive.

---

## PART 4 — WHAT A REAL SEAT HAS THAT THIS DOES NOT

This section exists so you finish calibrated instead of confident. Read it slowly.
Each item is a first-order feature of the actual job that the simulator removes
entirely, and together they are most of what makes the work hard.

**The setup was handed to you.** You got a briefing at 08:45 with the story, the
bull case, the bear case and the levels already marked. On a real seat, *finding
the trade is the job*. That means being at a screen before six, going through
overnight moves, earnings, guidance, sector flows and four hundred names to
decide which two are worth your attention — and being wrong about that choice
before the market has even opened. You practised the last 20% of the process and
skipped the part that separates people.

**The capital is not yours, and the asymmetry is brutal.** You are paid a
fraction of the upside and you carry all of the career downside. Losing $40,000
of a firm's money has a texture that losing $400 of pretend money cannot
approximate: it is not the money, it is that specific people whose respect you
want will read the number tomorrow morning, and their read of you updates.

**Career risk is the real position.** Your P&L is a public, continuously updated
evaluation of you as a person by an institution that has finite seats. A bad
quarter is a conversation about your future. A bad year ends things. You cannot
step away for two weeks to get your head straight, because the seat is the
opportunity and there is a queue. Everything you did in these three sessions, you
did knowing the worst case was closing a browser tab.

**Duration, which is the one nobody can simulate.** Two hundred and fifty
sessions a year. Not three. The difficulty is not any single day — you have now
seen that a single day is survivable — it is the two hundredth consecutive
morning of getting up at 5:30 to do it again, thirty-five sessions into a
drawdown, with no evidence available to you about whether the drawdown is bad
luck or the end of your edge. That specific uncertainty, sustained for months, is
the actual load-bearing difficulty of the profession, and no simulator will ever
deliver it.

**The physical toll.** Elevated heart rate through the open, every day. Not
eating properly. Not standing up. The particular 16:15 crash after the adrenaline
clears. Sleep that degrades in exactly the weeks you need it most. Being
physically present at dinner while running the afternoon back. Carrying a red
number home on the PATH and having it still be there at 2am. Traders age in a way
that shows, and it is not the hours, it is the sustained autonomic load.

**The social reality of a floor.** You sat alone with a chat window. A real desk
is a room where information moves verbally and fast, where your reputation is
formed by things you said out loud in the first ninety seconds of a move, and
where being visibly wrong happens in front of the same twelve people every day
for years. There is a culture around showing pain — mostly, you do not — which
means you process the worst part of the job in silence and in company at the same
time. Who you sit next to shapes your P&L. The politics of allocation, of which
book gets the risk, of whose call gets credited, is not a distraction from the
job; for senior people it substantially *is* the job.

**The market mechanics that were switched off.** You had no overnight gap risk,
no borrow costs or locate failures, no halts, no partial fills, no queue
position, no market impact from your own size, no broker outage at the worst
possible moment, no position limits imposed by people who have watched you do
this before, no compliance surveillance, no month-end and quarter-end flows
distorting everything, and no other participants adapting to you. The tape you
traded was fixed and indifferent. A real one is a population of adversaries, some
of them faster and better capitalised than you will ever be, and the good setups
stop working precisely because other people find them.

**And you could pause.** Note how many times you did.

---

## PART 5 — WHAT THIS WAS FOR

You did not do this to trade. You did it so that the next time you are in a room
with traders — building for them, selling to them, arguing with them about what a
model should optimise — you have a body memory instead of a book summary.

**Three things you can now do that you could not before:**

1. **Hear what a trader is actually saying.** When someone says "I got chopped
   up" or "I was early" or "I sized it wrong," you now know the specific feeling
   underneath each of those and can ask the next question instead of nodding.

2. **Ask better questions.** Not "what's your edge" — nobody answers that. Try:
   *How do you decide what to look at before the open?* *What's your rule for
   adding to a position, and when did you last break it?* *What does a good
   losing day look like to you?* *How long does it take you to notice the regime
   changed, and how much does that cost?* Those questions identify you as someone
   who has sat in the chair, and they get real answers.

3. **Build with the right constraints in mind.** Anything you ship to a trading
   desk gets used by someone whose attention is fully consumed at 09:31, whose
   trust in a tool goes to zero the first time it is wrong under pressure, and
   who is being evaluated on the outcome while your software is merely an input.
   You have now felt that attention budget from the inside.

**One last thing.** Write, in two sentences, the single most surprising thing you
learned about yourself across the three days. Not about markets. Put it somewhere
you will find it again in a year. That sentence is the entire yield of this
project, and it is worth more than the P&L, which was never real.
