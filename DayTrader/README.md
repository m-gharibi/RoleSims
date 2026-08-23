# DAY TRADER SIM

Three trading sessions on one account, with a desk that talks back.

This is not a game about predicting prices. It is an apparatus for producing a
specific feeling: the feeling of having committed real size to a thesis you
wrote down sixty seconds ago, watching it go against you, and having to decide —
with a clock running and someone reading your book over your shoulder — whether
you were wrong or merely early.

---

## RUNNING IT

Double-click `index.html`. That is the whole install.

No server, no build, no network. It runs from `file://` and stores your account
in browser localStorage under `dts.account.v1`. Use the same browser and the same
profile for all three sessions or you will lose the carried P&L, which is the
point of the exercise.

Screens go: session select → briefing → floor → close-out. Keyboard on the
floor: `B` buy, `S` sell, `Enter` submit, `F` flatten, space to pause.

**Speed.** The tape runs at 30x/60x/120x/240x. At 60x one minute of market time
is one second, so a full 09:30–16:00 session is 6.5 minutes of wall clock. Run
Day 1 at 60x. You will want 30x in the first fifteen minutes and 120x through the
midday dead zone. Pause whenever you want to think — but notice how often you
reach for pause, and write that down. Real traders do not have that button.

---

## THE ACCOUNT AND THE RULES

You start Session 1 with **$25,000** and 4x intraday leverage, so **$100,000 of
buying power**. Equity carries forward. Session 2 opens with whatever Session 1
left you, and Session 3 opens with the wreckage or the profits of both.

| Rule | Value | What it means |
|---|---|---|
| Start equity | $25,000 | Session 1 only; later sessions inherit |
| Buying power | equity × 4 | ~$100k of exposure at the start |
| Soft warning | −$900 | Marcus sends a shot across the bow |
| Hard daily loss limit | −$1,500 | Risk flattens you, locks the day, no appeal |
| No new positions | 15:55 | Cannot increase exposure after this |
| Forced flat | 15:58 | Whatever is left gets closed at market |
| Commission | $0.005/share/side | Minimum $1.00 per fill |

−$1,500 is **6% of your starting equity in one day**. That is the desk's limit on
how much of a disaster it will tolerate, not a target and not a budget. Set your
own number before you start and put it in the journal — something like $600 to
$750 — and honour it. Traders who use the house limit as their working limit
discover the house limit exactly once.

**Sizing.** The professional way to size is to fix the loss, not the share count.
Pick your risk per trade in dollars, decide where the trade is wrong, and divide:

```
shares = risk_dollars / (entry_price − stop_price)
```

$250 of risk with a $0.60 stop is 416 shares, call it 400. On a $180 stock that
is $72,000 of exposure — **72% of your entire line for a 1% risk**. You will
discover in about ten minutes that on a high-priced name the buying-power
constraint binds long before the risk constraint does, and that Marcus starts
asking questions at 80% of the line. That tension is real and it is not a bug.

**Costs are not the commission.** Fills are modelled with a spread and a size
impact that scales with how large you are relative to the bar's volume. On a
400-share order in a $180 name during a liquid bar you pay roughly 4 cents of
slippage per side — about $33 on the round trip, against $4 of commission.
Slippage is eight times the commission. In the thin midday bars the same order
can cost 10 cents a side, $80 round-trip. And a stop order fills with **double**
the slippage, because that is what stops do. Overtrading does not kill you
through commissions. It kills you through the spread, twenty times a day.

---

## THE PROTOCOL FOR ONE SESSION

Do not skip the chat steps. The simulator is the smaller half of this. The chat
gates are where the learning actually happens, because they force you to state a
position before the tape resolves it and then confront the transcript afterwards.

Open a Claude conversation next to the browser before you press anything, and
paste this into it:

> You are running a trading desk. Read `desk/PM_PLAYBOOK.md` and follow it
> exactly. I am about to start Session N. I will bring you a pre-open pitch, a
> midday risk check, and an end-of-day tearsheet. Stay in character as the desk.

Then:

**1. Briefing (5 min).** Read the overnight story, the bull and bear case, the
pre-market stats and the levels. Write your plan **in the journal first**, before
you pitch it — thesis, levels, invalidation, max size, max loss. Writing it after
the pitch lets you launder it.

**2. Pitch to the PM in chat (3–5 min).** Post your plan to Dana. She scores it
on five things: thesis specificity, levels, invalidation, size rationale, and
what you do when you are wrong. Her score sets the size she authorizes for the
day. A vague pitch gets you 100 shares and an invitation to try again. This is
the single highest-leverage five minutes in the whole exercise, because a plan
you have defended out loud is a plan you notice yourself abandoning.

**3. Trade the morning.** The bell rings. The desk feed on the right is not
decoration — Dana, Marcus, Priya and the wire will react to what you actually do.
Every entry requires a typed thesis. Type the real reason, including the
embarrassing ones. "Bored" is a valid thesis and you will want it in the record.

**4. Midday risk check in chat (3 min).** Around noon the clock stops and Marcus
wants four numbers and one sentence: your position, your exposure as a percentage
of your line, your day P&L, your worst drawdown so far, and what you will do at
what price. He does not want your thesis. He wants to know whether you know how
big you are.

**5. Trade the afternoon.** Same rules. 15:55 the door closes on new risk. 15:58
you are flat whether you like it or not.

**6. Paste the tearsheet for the P&L review (5–10 min).** The close-out screen
has a copy button that puts a markdown tearsheet on your clipboard — every trade,
the thesis exactly as you typed it, entry and exit and hold time and P&L, the
stat line, the equity curve, and any risk events. Paste the whole thing into
chat. Dana goes trade by trade. She will compare what you typed to what you did.
She will praise process that lost money and take apart process that made money.
Expect this to be uncomfortable. If it is comfortable, the desk is being run
wrong — check the playbook.

**7. Journal (5 min).** Fill in `journal/dayN.md` while the feeling is still
available. The emotional log is not therapy; it is data. You are trying to learn
what your own body does under P&L pressure, and that information decays within
about fifteen minutes of the close.

**Budget: 25–30 minutes per session, 60–90 minutes for all three.** Do not run
two sessions back to back on the same day if you can avoid it. Sleeping on a loss
is part of what is being simulated.

---

## THE THREE SESSIONS

Three different market regimes, in an order chosen to be unfair to you.

Read the next section only if you want the design rationale now. Nothing in it is
needed to run the sim, and knowing the shape of a tape in advance removes most of
what the exercise is for. The honest way to do this is to run all three sessions
cold and read it during the final debrief.

<details>
<summary><b>Design spoiler — the sequencing, and why it is built to burn you</b></summary>

**Session 1 — a trending day.** The name goes, holds its trend, pulls back to
support and goes again. Patience is rewarded. Adding into the pullback is
rewarded. The trader who takes the first $200 and runs finishes the day annoyed,
watching the thing he sold run another two dollars. The lesson the tape teaches
is *let winners run, stop scalping, size up and hold*.

**Session 2 — a wide chop day.** Big range, no direction. Every breakout fails
and reverses through the level. Every pullback keeps going. This day is
specifically designed to punish the lesson Day 1 taught you. If you show up
having internalised "hold the trend," you will hold five failed breakouts and
give back everything you learned to be proud of. The real lesson is one level up:
**the correct behaviour is regime-dependent, and one day is not a regime.** The
thing you are being trained out of is the human habit of generalising from a
single reinforced experience — which is exactly what a profitable first day
installs and what a real seat punishes for years.

**Session 3 — a failed open that trends down all day.** It opens strong, fails
within the first half hour, and grinds lower into the close with weak, unrewarded
bounces. It is built to punish dip-buying and the "it's due" reflex. And you
trade it carrying two days of P&L baggage: if you are down on the account you
will feel the pull to make it back today, and if you are up you will feel the
pull to protect and under-trade. Both of those are the actual job. Watch which
one is yours — that is arguably the single most useful piece of self-knowledge
this whole thing can hand you.

</details>

---

## WHAT THIS IS AND WHAT IT ISN'T

**The price data is real.** The bars are actual market data from real trading
sessions, rebased to a different price level and given anonymous tickers so you
cannot recognise the name and cannot look up what happened next. The
microstructure — the way a level gets probed, the shape of a failed breakout, the
way volume dies at 11:40 — is real, not generated. That is why the tape feels
like something rather than noise.

**Everything else is simulated.** The fills are a model. There is no order book,
no queue position, no hidden liquidity, no other participants reacting to you.
Dana, Marcus and Priya are Claude playing roles from a script you can read. The
$25,000 is not money.

**What this can actually give you.** Decision-making under time pressure with
incomplete information and a visible P&L. The specific, physical experience of
being wrong in public with size on. The discovery of what you personally do when
you are down $700 by 10:15 — whether you freeze, get bigger, or get busy. A
working vocabulary you can use with real traders without sounding like you read a
book. Calibrated respect for how hard the job is on the inside, as opposed to how
simple it looks from the outside.

**What it cannot give you and will not give you.** An edge. Three sessions is not
a sample; twenty round-trips tells you approximately nothing about your own skill
— the standard error on a win rate estimated from twenty trades is about eleven
percentage points, which is wider than the entire gap between a good trader and a
bad one. You are trading a fixed historical tape with no market impact, no
overnight gap risk, no borrow cost, no funding, no position limits imposed by a
firm that has seen you do this before, and no consequence.

**If you finish these three sessions feeling like you could trade for a living,
the exercise has failed and you should re-read the debrief.** The correct end
state is the opposite: a much sharper sense of what the job demands, and a
correspondingly lower estimate of your own readiness to do it. Do not put money
in a brokerage account on the strength of this. That is not a disclaimer, it is
the actual finding.

---

## FILES

```
index.html            double-click this
data/days.js          the three tapes (real bars, rebased, anonymized)
sim/                  engine, chart, desk feed, UI
desk/PM_PLAYBOOK.md   how Claude runs the desk — read this, it is the good one
desk/DEBRIEF.md       the cross-session debrief, run after Day 3
journal/TEMPLATE.md   the session journal
journal/day1..3.md    your three journals
SPEC.md               the build contract
```
