# DECISION LOG — Week 1 | Before any research exists

Fill this **before** you post the roadmap to the room. All of it. There is no
research back yet and there is not going to be any before the gate — only the
one-day sales conversation could even have returned. That is the point of week 1:
**you have to have a plan before you have evidence, and the quality of a plan
built on priors is a real and separable skill.**

Nobody grades this on being right. It is graded — by you, at the debrief — on
being *stated*. A prior you wrote down and were wrong about is worth something.
A prior you kept vague so it could never be wrong is worth nothing, and you will
find out which kind yours were in twelve weeks.

Twenty minutes. Do not skip section 1.

---

## 0. THE STARTING POSITION

| | |
|---|---|
| North star | W4 team activation: new teams with 3+ active members still active in week 4 |
| Baseline | **31.4** |
| Mandate | **40.0** — that is +8.6 pp, a 27% relative increase, in 12 weeks |
| Capacity | 48 eng-weeks nominal; a 5-week incident is coming in week 7 → **43 real** |
| The board | 10 features, estimates summing to **66 eng-weeks** |
| Research | 2 slots, 120 slot-days for the quarter, **20 of them before day 10** |
| Trust | Marguerite 60, Dan 60, Rina 60, Kofi 60, Tomás 60 |

**Do I believe 40.0 is reachable?** Answer now, in one sentence, with a number
you are willing to be held to. "It depends" is not an answer at this point;
you can revise it at week 6 and the revision is the interesting part.

> My working target for the quarter is ______ pp, and I believe the mandate is
> [reachable / reachable only if ____ / not reachable] because:

**If it is not reachable, when will I say so, and to whom?**
*(Week 6 is cheap. Week 12 is worthless. Marguerite has said out loud she has
never once been annoyed by a PM who told her they were wrong early — decide now
whether you believe her.)*

>

---

## 1. PRIORS ON ALL TEN FEATURES

Every feature gets a number. No blanks, no "TBD", no "need more data" — the
entire purpose of this table is to capture what you thought before the evidence
arrived, so that in twelve weeks you can find out whether your instincts or your
instruments were the better guide. That comparison is not available to you if
you leave cells empty.

For **mechanism**, write the causal chain for a *newly created team in its first
fourteen days*. If you cannot write one, that is itself a finding, and the
feature is probably a revenue bet or a next-quarter bet rather than an activation
bet. Say so in the row.

| Feature | Tags | Est | Prior pp (point) | 80% range | Mechanism for a team in its first 14 days | Conf 1–5 | First instrument I'd use, and why that one |
|---|---|---|---|---|---|---|---|
| Onboarding checklist | onboarding | 5 | | – | | | |
| Template gallery | onboarding, workflow | 8 | | – | | | |
| Realtime co-editing | flashy, workflow | 10 | | – | | | |
| P95 latency work | infra, fix | 6 | | – | | | |
| Smart alerts | workflow | 6 | | – | | | |
| CSV export v2 | fix | 3 | | – | | | |
| Mobile view | flashy | 10 | | – | | | |
| SSO / SCIM | enterprise, fix | 8 | | – | | | |
| Admin audit log | enterprise | 5 | | – | | | |
| Dashboard themes | flashy | 5 | | – | | | |

**Sum of my priors:** ______ pp across all ten.

*(Sanity check against yourself: if the sum of ten priors is well over 8.6, you
are implying that almost any four features hit the mandate, which would make this
quarter easy. It is not easy. If the sum is under 8.6, you have already concluded
the mandate is unreachable — go back to section 0 and make sure you said so.)*

**My three highest-conviction bets, and the single word doing the most work in
each mechanism:**

1.
2.
3.

**The feature I most want to build for reasons that are not about the metric,
named honestly:**

>

---

## 2. MY PRIORITISATION PRINCIPLE

Write a rule, not a ranking. The test: **if an eleventh feature appeared on the
board tomorrow, does this rule tell me where it goes without further
deliberation?** If it does not, it is not a principle, it is a description of the
list you already made.

> **My rule:**

**Applied to the board, it produces this order:**

1.
2.
3.
4.
5.
6.
7.
8.
9.
10.

**One place where my own rule forces me to do something I do not want to do:**
*(If there is no such place, the rule was fitted to the answer you already had.)*

>

**What my rule deliberately ignores, and why I am comfortable with that:**

>

---

## 3. THE COMMIT SET, WITH THE ARITHMETIC SHOWN

```
Nominal capacity                                 48 eng-weeks
Less week-7 incident (scripted, guaranteed)      -5
Less reserve I am holding for slips              -____
= Real budget                                    ____ eng-weeks

My assumed optimism multiplier m =               ____
  Why that number:

Firm tier estimates                              ____ est-weeks
  × m                                            ____ eng-weeks
Optional tail (only if capacity appears)         ____ est-weeks
Firm tier as a share of real budget              ____ %
```

**Reference points, so the number above is a choice rather than an accident:**
at m = 1.2 the commit budget is 35.8 est-weeks; at 1.4 it is 30.7; at 1.6 it is
26.9; at 2.0 it is 21.5. The whole board is 66.

| Firm tier | Est | Est × m | Predicted pp | 80% range | Why it is in the firm tier |
|---|---|---|---|---|---|
| | | | | – | |
| | | | | – | |
| | | | | – | |
| | | | | – | |

**Build order, and the rule that produced it:**
*(Value density? Cheapest first? Least-trusted estimate first, so a slip surfaces
while you still have options? Name it — the order is a decision and it will be
the one you most regret if you make it by default.)*

>

**Sum of predicted impact:** ______ pp → projected north star ______ versus 40.0.

---

## 4. WHAT I AM EXPLICITLY NOT DOING, AND WHO THAT DISAPPOINTS

Everything not in section 3. Write the actual sentence, not a summary of it. You
will need these sentences and you will need them under pressure.

| Not doing | Who wanted it | The sentence I will say | The path (condition / date / alternative) |
|---|---|---|---|
| | | | |
| | | | |
| | | | |
| | | | |
| | | | |
| | | | |

**The trust arithmetic on this set:**

```
Champion-links I am cutting        ____ × −12 =  ____
Champion-links I am shipping       ____ × +8  =  +____
Starting pool                                    300
Projected pool                                   ____   → average ____
```

*(Below an average of 40 caps the grade at C. Cutting every championed feature —
nine links — lands the pool at 192, an average of 38.4. If your number is close
to that, you have chosen the capped strategy and you should have chosen it
deliberately.)*

**Anyone I am taking to 36 or below** (two cuts does it), and what I will do if
they also escalate — because one ignored escalation on top of two cuts puts them
at 21:

>

---

## 5. THE TWO CONVERSATIONS I KNOW ARE COMING

These are not hypotheticals. Dan escalates about a deal. Marguerite asks about a
feature she has already promised the board. Write the words now, while you are
calm, because the alternative is improvising them while someone senior waits.

**Dan, when the deal is on the line — what I say:**

>

**Marguerite, when she asks why her feature is not in the quarter — what I say:**

>

**What I will NOT say** (the reflex answers: "I'll add it to the backlog", "let
me take that to the process", "the data doesn't support it", "next quarter"):

>

---

## 6. MY RESEARCH PLAN FOR WEEKS 1–3

Two slots. 20 slot-days before day 10, 60 before the mid-quarter review. Costs:
sales 1, tickets 2, interviews 4, usage 5, survey 5, fake door 10, A/B 15
(shipped features only).

| Slot | Days 1–5 | Days 6–10 | Days 11–15 |
|---|---|---|---|
| A | | | |
| B | | | |

**The one revealed-preference test I am running, on which feature, and why that
feature:**
*(A near-unbiased anchor on a single-tag feature calibrates every other
instrument on that tag. Single-tag features on this board: onboarding checklist,
smart alerts, CSV export v2, mobile view, dashboard themes, admin audit log.)*

>

**What I am deliberately not researching, and what that costs me:**

>

---

## 7. STOPPING RULES

Written now, so that in week 8 you are enforcing a rule rather than making a
decision while attached to something.

**Slip rule** — if a revised estimate exceeds ____× the original, I will:

>

**Evidence rule** — I will not commit anything with fewer than ____ readings
from instruments whose biases point in different directions, except:

>

**Scope rule** — if I add anything after week ____, something comes off the same
day. The something is decided by:

>

**Reserve rule** — my reserve of ____ eng-weeks is released only when:

>

---

## 8. WHAT WOULD CHANGE MY MIND

| Belief | The observation that would kill it | Instrument | By when |
|---|---|---|---|
| | | | |
| | | | |
| | | | |
| | | | |

---

## 9. THE PREDICTION ABOUT MYSELF

Specific and unflattering. You will check this at the debrief.

**The failure mode I am most likely to exhibit this quarter** (over-committing,
saying yes under pressure, over-researching before starting anything, building
what I personally find interesting, avoiding the conversation with Dan):

>

**The single thing most likely to blow up this plan:**

>

**Roadmap score from the room: ___ / 10.** What they said was missing:

>

**What I committed to in that gate, in their words:**

>
