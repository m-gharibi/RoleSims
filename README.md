# Role Sims

**Flight simulators for judgment.**

You can read about a job for a year and still have no judgment. Books gave us
vocabulary; LLMs now give us fluency, which is worse, because fluency feels like
understanding. Only consequence produces the real thing.

Nobody sims the cruise. Pilots don't practise takeoff on a clear morning — they
practise engine failure at V1. Each of these four is an emergency wearing
ordinary clothes.

---

## The demo, in ten seconds

Two tickets sit on your board. Same reporter, same priority, both bugs.

One is forty lines into a file you haven't opened. The other is **unsolvable
alone** — the reason lives in a customer contract, not in the repository — and
every hour you spend proving otherwise is gone.

Nothing on either ticket tells you which is which. Telling them apart is most of
the job, and almost nobody is ever taught how.

---

## The four

| | Role | The enemy | Span |
|---|---|---|---|
| 01 | **Day Trader** | noise — a run of luck looks identical to an edge | 3 sessions, $25k |
| 02 | **ML Researcher** | scale extrapolation — the best cheap result is worth nothing at size | 5 days, 6,000 GPU-h |
| 03 | **Product Manager** | bias — every instrument lies in a knowable direction | 12 weeks, 48 eng-weeks |
| 04 | **Junior Engineer** *(pre-AI)* | not knowing what you don't know, and what asking costs | 10 days, a mentor's 10 hours |

Each has a hidden ground truth you are scored against, a scarce resource, a
clock, and people who push back.

## Running them

No install, no build step, no server, no network. Open `index.html` in the repo
root and pick one, or open any sim's `index.html` directly.

## The part that isn't a browser tab

Each sim **pauses at gates** — a pitch, a standup, a midweek review, a final
readout — and sends you to an LLM chat window, where the rest of the cast lives.
Every sim ships a playbook (`*/PM_PLAYBOOK.md`, `*/RESEARCH_LEAD_PLAYBOOK.md`,
`*/STAKEHOLDER_PLAYBOOK.md`, `*/MENTOR_PLAYBOOK.md`) written to work cold: paste
it into a fresh session and the review runs without any other context.

In three of the four, the reviewer does **not** know the ground truth during the
gates and is instructed never to pretend to. It reasons only from the evidence
you present.

## The screen it all exists for

The debrief. It shows the route you actually took against the route that was
there, prices every hour that bought nothing, and marks where the decision you
didn't make would have gone. Everything before it exists to earn it.

## Honest scope

These were built fast and are not validated by practitioners. The models are
deliberate simplifications — real markets, real research and real codebases give
murkier signals than any of this. They train judgment under uncertainty, not the
underlying craft, and nobody should finish one believing they can do the job.

Corrections from people who actually hold these roles are the most useful thing
anyone could contribute.
