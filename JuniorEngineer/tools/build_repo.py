#!/usr/bin/env python3
"""
Build data/repo.js — the hidden ground truth for the Junior Engineer sim.

The model: every ticket has a hidden DISCOVERABILITY PROFILE. Each investigation
action yields some number of "understanding" points, with diminishing returns:

    gained = yield[action] * decay ** (times_already_done)

A NEGATIVE yield is an action that actively misleads — stale docs, a red
herring, a confident wrong answer in the help channel. That is how a wasted
afternoon is modelled.

Six tickets, each designed to teach exactly one thing a junior gets wrong:

  BUG-2201  the answer is in the code, and the docs are stale     -> just read it
  BUG-2207  the answer exists ONLY in Deepa's head                -> escalate fast
  FEAT-2189 neighbouring code teaches the WRONG convention        -> docs win here
  BUG-2214  it is a pre-existing flake and not your bug           -> hand it back
  FEAT-2195 the ticket is underspecified                          -> ask the PM
  CHORE-2150 a one-point chore with a 200-file blast radius       -> ask about scope

The cruelty is deliberate and symmetric: BUG-2201 punishes asking too early and
BUG-2207 punishes not asking. Nothing on the surface distinguishes them. That
discrimination is the entire skill being trained.
"""

import json, base64, os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT  = os.path.join(HERE, '..', 'data', 'repo.js')

NEEDED_IMPL = 70    # understanding to open a PR at all
NEEDED_OK   = 90    # understanding for a PR that survives review

ACTIONS = [
    dict(id='reproduce',   name='Reproduce it locally', minutes=30,
         desc='Spin up the dev stack and make the bug happen in front of you.',
         caveat='Almost never wasted on a bug. Frequently useless on a feature.'),
    dict(id='read_code',   name='Read the code',        minutes=30,
         desc='Follow the call path through the module by hand.',
         caveat='Finds anything that is actually written down. Cannot find a decision '
                'that was made in a meeting in 2024.'),
    dict(id='read_docs',   name='Read the docs',        minutes=20,
         desc='The internal wiki and the style guide.',
         caveat='Nine years of accumulated confidence. Some pages are load-bearing '
                'and some describe code that was deleted years ago.'),
    dict(id='git_blame',   name='git log / blame',      minutes=15,
         desc='Who changed this, when, and what did the commit message say.',
         caveat='The most underused tool you own. Commit messages remember reasons '
                'that the code cannot.'),
    dict(id='search_slack',name='Search old messages',  minutes=15,
         desc='Grep two years of #dispatch and #incidents.',
         caveat='If someone hit this before, the argument about it is in here somewhere.'),
    dict(id='run_tests',   name='Run the test suite',   minutes=15,
         desc='Run the relevant suite and read what actually fails.',
         caveat='Cheap. Tells you what is broken, rarely why.'),
    dict(id='just_try',    name='Try a fix and see',    minutes=45,
         desc='Change something plausible and run it.',
         caveat='Fast when you are nearly right. A very expensive way to be wrong.'),
]

# ---------------------------------------------------------------- ground truth
T = {}

T['BUG-2201'] = dict(
    points=3, needed=NEEDED_IMPL, effortHours=3.0, decay=0.6,
    timeboxHours=1.5, selfFindable=True, soloCap=100,
    needsTests=True, convention=None, conventionTrap=None,
    yields=dict(reproduce=25, read_code=32, read_docs=-18, git_blame=8,
                search_slack=5, run_tests=12, just_try=8,
                ask_deepa=55, ask_hannah=2, ask_channel=20),
    cause=("A timezone-aware sort key was being built with the server's local offset "
           "instead of the dispatch region's, so the ordering flipped for any list that "
           "straddled a DST boundary. It is right there in `dispatch/ordering.py`, about "
           "forty lines in."),
    notes=("The whole answer was in the code, roughly two hours of honest reading away. "
           "The only trap was the wiki: the 'Sorting and Ordering' page describes "
           "`SortKeyBuilder`, which was deleted in 2024. Every minute in the docs on this "
           "ticket moved you backwards. Asking Deepa here would have worked, and it would "
           "also have been the wrong instinct — this was yours to find."),
)

T['BUG-2207'] = dict(
    points=3, needed=NEEDED_IMPL, effortHours=2.0, decay=0.6,
    timeboxHours=1.0, selfFindable=False, soloCap=55,
    needsTests=True, convention=None, conventionTrap=None,
    yields=dict(reproduce=8, read_code=6, read_docs=0, git_blame=22,
                search_slack=18, run_tests=4, just_try=-10,
                ask_deepa=85, ask_hannah=3, ask_channel=10),
    cause=("The idempotency guard on webhook delivery is disabled for one enterprise "
           "account by a config flag set in 2024, because that customer's endpoint "
           "required at-least-once delivery under their SLA. Nothing in the code says so. "
           "The flag is named `wh_relaxed_dedupe` and it is set in an ops repo you do not "
           "have open."),
    notes=("This one was never findable alone — the reason lives in a contract, not in the "
           "repository. `git blame` was the only solo action that paid: it surfaces a 2024 "
           "commit whose message reads 'per SLA agreement — talk to Deepa before changing'. "
           "That is the codebase telling you, in the only way it can, to go and ask. "
           "Every hour past the first that you spent reading source here was spent proving "
           "something unprovable."),
)

T['FEAT-2189'] = dict(
    points=2, needed=NEEDED_IMPL, effortHours=4.0, decay=0.6,
    timeboxHours=2.0, selfFindable=True, soloCap=100,
    needsTests=True, convention='ExportPipeline', conventionTrap='LegacyExporter',
    yields=dict(reproduce=5, read_code=28, read_docs=35, git_blame=10,
                search_slack=12, run_tests=8, just_try=12,
                ask_deepa=60, ask_hannah=5, ask_channel=25),
    cause=("A straightforward CSV export. The only real decision is which export "
           "machinery to build on."),
    notes=("The convention trap. Around sixty percent of the files next to this one still "
           "use `LegacyExporter`, so 'match the surrounding code' — normally excellent "
           "advice — hands you the deprecated path and a bounced review. The style guide "
           "is explicit and correct about `ExportPipeline`. Note that this is the exact "
           "inverse of BUG-2201, where the docs were poison. Neither documentation nor "
           "surrounding code is reliable in general; both are reliable about specific "
           "things, and knowing which is the actual skill."),
)

T['BUG-2214'] = dict(
    points=2, needed=NEEDED_IMPL, effortHours=6.0, decay=0.6,
    timeboxHours=1.0, selfFindable=True, soloCap=100,
    needsTests=False, convention=None, conventionTrap=None,
    shouldAbandon=True,
    yields=dict(reproduce=12, read_code=8, read_docs=2, git_blame=30,
                search_slack=35, run_tests=20, just_try=-15,
                ask_deepa=50, ask_hannah=2, ask_channel=30),
    cause=("A genuinely flaky test. `test_scheduling_window_boundary` has failed "
           "intermittently since a concurrency change eight months ago. It is a known "
           "issue with a ticket already open against the platform team."),
    notes=("Not your bug, and the sprint did not need you to prove it. `git blame` and a "
           "search of old messages both say so inside an hour — eight months of "
           "intermittent failures and an existing platform ticket. The correct resolution "
           "was to hand it back with what you found, which is a contribution, not a "
           "failure. Juniors sink days into this ticket because abandoning something feels "
           "like admitting you could not do it. Telling your team a ticket is misfiled IS "
           "doing it."),
)

T['FEAT-2195'] = dict(
    points=5, needed=NEEDED_IMPL, effortHours=5.0, decay=0.6,
    timeboxHours=1.5, selfFindable=True, soloCap=100,
    needsTests=True, convention=None, conventionTrap=None,
    needsClarification='hannah',
    yields=dict(reproduce=4, read_code=20, read_docs=10, git_blame=6,
                search_slack=8, run_tests=4, just_try=-20,
                ask_deepa=30, ask_hannah=55, ask_channel=10),
    cause=("Rate limiting on the public API. The ticket never says per-key or per-IP, "
           "never gives a limit, and never says what happens on breach — 429, queue, or "
           "silent drop. Hannah has clear answers to all three and assumed they were "
           "obvious."),
    notes=("The underspecified ticket. No amount of reading resolves a requirement that "
           "was never written down, and this is the largest ticket on the board — five "
           "points of building the wrong thing. One message to Hannah costs four minutes "
           "and nothing else in this sprint has a better return. Almost nobody sends it, "
           "because asking the PM to clarify feels like admitting you did not understand "
           "the ticket. You did not. The ticket was not clear."),
)

T['CHORE-2150'] = dict(
    points=1, needed=NEEDED_IMPL, effortHours=1.5, decay=0.6,
    timeboxHours=0.5, selfFindable=True, soloCap=100,
    needsTests=False, convention=None, conventionTrap=None,
    scopeTrap=dict(guardedBy=['ask_deepa', 'read_docs'], naiveFiles=214, budget=12),
    yields=dict(reproduce=3, read_code=15, read_docs=25, git_blame=8,
                search_slack=10, run_tests=6, just_try=-25,
                ask_deepa=70, ask_hannah=2, ask_channel=20),
    cause=("Upgrading the lint config is one line. Applying it is not: the new rule set "
           "reformats two hundred and fourteen files across packages three other teams "
           "have open branches against."),
    notes=("The one-point chore with the largest blast radius on the board. Running the "
           "formatter across the repo produces a diff nobody can review and a week of "
           "merge conflicts for three other teams. Thirty seconds of asking — or the "
           "migration note in the docs — scopes it to the dispatch package and it really "
           "is a one-pointer. Story points measure effort, never risk, and the gap between "
           "those two is where juniors do their most expensive damage."),
)

# public ticket metadata
TICKETS = [
    dict(id='BUG-2201', type='bug', priority='P2', reporter='Support',
         title='Dispatch list sorts wrong after a DST change',
         description=("Customers in regions that observe daylight saving report that the "
                      "dispatch list ordering scrambles on the changeover day. Jobs "
                      "scheduled after 02:00 appear above jobs scheduled before it. "
                      "Reproducible on any list that straddles the boundary."),
         acceptance=['Ordering is stable across a DST boundary',
                     'A regression test covers the boundary case']),
    dict(id='BUG-2207', type='bug', priority='P1', reporter='Support',
         title='Webhook retries fire twice for some enterprise accounts',
         description=("Two enterprise customers report receiving duplicate webhook "
                      "deliveries for the same dispatch event. Not reproducible on staging. "
                      "Affects a small number of accounts and has been happening for some "
                      "time. Escalated by the account team."),
         acceptance=['Duplicate deliveries stop, or we document why they must not',
                     'Behaviour is the same on staging and production']),
    dict(id='FEAT-2189', type='feature', priority='P3', reporter='Hannah Brecht',
         title='Add CSV export to the driver activity report',
         description=("Ops want to pull the driver activity report into a spreadsheet. Add "
                      "a CSV export button alongside the existing PDF export. Same columns "
                      "as the on-screen table, same filters applied."),
         acceptance=['CSV export matches the on-screen table and its filters',
                     'Follows the current export conventions',
                     'Covered by tests']),
    dict(id='BUG-2214', type='bug', priority='P3', reporter='CI',
         title='Intermittent failure in the scheduling test suite',
         description=("test_scheduling_window_boundary fails maybe one run in six on main. "
                      "It has been getting noisier. Assigned to this sprint to stop the "
                      "noise."),
         acceptance=['CI is green reliably, or we know exactly why it is not']),
    dict(id='FEAT-2195', type='feature', priority='P1', reporter='Hannah Brecht',
         title='Add rate limiting to the public API',
         description=("We need rate limiting on the public API before the partner launch. "
                      "Please add sensible limits and make sure abusive clients cannot "
                      "affect other customers."),
         acceptance=['Public API endpoints are rate limited',
                     'Limits are configurable',
                     'Behaviour under limit breach is documented']),
    dict(id='CHORE-2150', type='chore', priority='P3', reporter='Nnamdi Eze',
         title='Upgrade the lint config to the shared preset',
         description=("We are standardising on the shared lint preset across services. "
                      "Bump the config and fix anything it flags. Should be quick."),
         acceptance=['Repo uses the shared preset', 'CI lint step passes']),
]

PEOPLE = [
    dict(id='deepa', name='Deepa Iyer', role='Staff Engineer — your onboarding buddy',
         startTrust=55, voice='MENTOR',
         desc=("Nine years on this codebase. Wrote about a third of it and regrets some of "
               "that. Generous, direct, and stretched extremely thin — she has ten hours "
               "for you this sprint and a migration of her own. Answers a good question "
               "instantly and redirects a lazy one gently.")),
    dict(id='tobias', name='Tobias Lindqvist', role='Tech Lead',
         startTrust=55, voice='LEAD',
         desc=("Runs standup, owns delivery. Cares far more about whether you are blocked "
               "than about whether you are fast. The one thing he cannot forgive is a "
               "junior sitting silently stuck for two days.")),
    dict(id='nnamdi', name='Nnamdi Eze', role='Senior Engineer — your reviewer',
         startTrust=55, voice='REVIEWER',
         desc=("Picky, fair, fast. Writes review comments that teach instead of scold. "
               "Will not merge code whose author cannot explain it.")),
    dict(id='hannah', name='Hannah Brecht', role='Product Manager',
         startTrust=55, voice='PM',
         desc=("Friendly and busy. Writes tickets that are clear in her head and "
               "underspecified on the page. Delighted when someone asks her a clarifying "
               "question, which almost nobody does.")),
]

EVENTS = [
    dict(day=1, hour=9.0, frm='LEAD', name='Tobias Lindqvist', tone='neutral',
         text=("Morning, and welcome. Six tickets on the board. I do not expect all six — I "
               "expect you to tell me early which ones are not going to happen. Estimate "
               "them before you start, and post your plan.")),
    dict(day=1, hour=9.5, frm='MENTOR', name='Deepa Iyer', tone='neutral',
         text=("Hi! I'm your onboarding buddy. Honest warning: I have about ten hours for "
               "you this sprint, so use me well. Rule of thumb I give everyone — timebox "
               "it, then come. Do not spend a day proving you didn't need me.")),
    dict(day=1, hour=10.0, frm='REVIEWER', name='Nnamdi Eze', tone='neutral',
         text=("I do most of the reviews. Two things and we will get along fine: tests on "
               "anything behavioural, and be able to explain your own diff. I bounce code "
               "the author can't walk me through, and it's nothing personal.")),
    dict(day=2, hour=9.25, frm='MENTOR', name='Deepa Iyer', tone='neutral',
         text=("One thing about this repo before you get too deep: the wiki is nine years "
               "old and nobody has ever deleted a page. Some of it is load-bearing, some "
               "describes code that no longer exists. `git log` has never lied to me.")),
    dict(day=4, hour=11.0, frm='BOT', name='CI', tone='alarm',
         text='INCIDENT #4471 OPENED — dispatch-api p99 latency above threshold. All hands acknowledge.'),
    dict(day=4, hour=11.5, frm='LEAD', name='Tobias Lindqvist', tone='warn',
         text=("Incident on dispatch-api. You are not on the rota and I do not need you, but "
               "the room will be loud for a couple of hours and Deepa is going to be busy "
               "with it. Plan around that.")),
    dict(day=5, hour=14.0, frm='PM', name='Hannah Brecht', tone='neutral', needsReply=True,
         text=("Quick question — is the rate limiting nearly done? The partner call is "
               "Thursday and I would love to say it's in.")),
    dict(day=7, hour=9.5, frm='REVIEWER', name='Nnamdi Eze', tone='neutral',
         text=("Heads up, my review queue is deep this week. Anything you open after about "
               "4pm is getting looked at the following morning. Factor that into what you "
               "think 'done by Friday' means.")),
    dict(day=9, hour=9.0, frm='LEAD', name='Tobias Lindqvist', tone='warn',
         text=("Code freeze is end of day tomorrow. Anything not merged by then rolls to "
               "next sprint, and that is fine — I would much rather roll a ticket than "
               "merge something nobody had time to review properly.")),
    dict(day=10, hour=14.0, frm='LEAD', name='Tobias Lindqvist', tone='neutral',
         text=("Retro at 16:00. The only question I actually care about: what do you know "
               "now that you wish you'd known on Monday?")),
]


def sim_best(tid, path):
    """Replay an action path and report understanding + hours, for validation."""
    t = T[tid]
    u, mins, counts = 0.0, 0.0, {}
    for a in path:
        n = counts.get(a, 0)
        y = t['yields'].get(a, 0)
        u += y * (t['decay'] ** n)
        counts[a] = n + 1
        if a.startswith('ask_'):
            mins += 15
        else:
            mins += next(x['minutes'] for x in ACTIONS if x['id'] == a)
        if not t['selfFindable'] and not a.startswith('ask_'):
            u = min(u, t['soloCap'])
    return u, mins / 60.0


BEST_PATH = {
    'BUG-2201':  ['reproduce', 'read_code', 'read_code', 'read_code', 'run_tests'],
    'BUG-2207':  ['git_blame', 'reproduce', 'ask_deepa'],
    'FEAT-2189': ['read_docs', 'read_code', 'read_docs', 'read_code'],
    'BUG-2214':  ['run_tests', 'git_blame', 'search_slack'],
    'FEAT-2195': ['ask_hannah', 'read_code', 'ask_hannah', 'read_code'],
    'CHORE-2150':['read_docs', 'ask_deepa'],
}


def main():
    print(f"{'ticket':12s}{'pts':>4s}{'solo?':>7s}{'timebox':>8s}"
          f"{'best U':>8s}{'inv h':>7s}{'impl':>6s}{'tot h':>7s}   lesson")
    print('  ' + '-' * 104)
    best_total = 0.0
    for tid in T:
        u, h = sim_best(tid, BEST_PATH[tid])
        t = T[tid]
        impl = 0.0 if t.get('shouldAbandon') else t['effortHours']
        tests = 0.75 if t.get('needsTests') and not t.get('shouldAbandon') else 0.0
        tot = h + impl + tests
        best_total += tot
        lesson = {'BUG-2201': 'just read it (docs are poison here)',
                  'BUG-2207': 'unsolvable alone — escalate fast',
                  'FEAT-2189': 'docs win; neighbours teach the trap',
                  'BUG-2214': 'not your bug — hand it back',
                  'FEAT-2195': 'underspecified — ask the PM',
                  'CHORE-2150': '1 point, 214 files — ask about scope'}[tid]
        print(f'  {tid:12s}{t["points"]:>3d}{str(t["selfFindable"]):>8s}'
              f'{t["timeboxHours"]:>8.1f}{u:>8.0f}{h:>7.2f}{impl:>6.1f}{tot:>7.2f}   {lesson}')

    # ---- pedagogical assertions -------------------------------------------
    # 1. the tribal ticket must be genuinely unsolvable alone
    solo_only = [a['id'] for a in ACTIONS]
    u_solo, _ = sim_best('BUG-2207', solo_only * 6)
    assert u_solo <= T['BUG-2207']['soloCap'] + 1e-9, 'BUG-2207 must be capped below the bar'
    assert u_solo < NEEDED_IMPL, 'BUG-2207 must be unimplementable without asking'
    # 2. the readable ticket must be comfortably solvable alone, and docs must hurt
    u_read, h_read = sim_best('BUG-2201', BEST_PATH['BUG-2201'])
    assert u_read >= NEEDED_OK, f'BUG-2201 best path should clear {NEEDED_OK}, got {u_read:.0f}'
    assert T['BUG-2201']['yields']['read_docs'] < 0, 'docs must mislead on BUG-2201'
    # 3. ...and the inverse must hold on FEAT-2189
    assert T['FEAT-2189']['yields']['read_docs'] > T['FEAT-2189']['yields']['read_code'], \
        'docs must beat code on FEAT-2189'
    # 4. every ticket must have at least one negative-yield action somewhere on the board
    assert sum(1 for t in T.values() if any(v < 0 for v in t['yields'].values())) >= 4
    # 5. the two bug tickets must look identical from the outside but invert the lesson
    assert T['BUG-2201']['selfFindable'] and not T['BUG-2207']['selfFindable']
    # 6. best paths must all clear the implement bar (except the one you abandon)
    for tid in T:
        u, _ = sim_best(tid, BEST_PATH[tid])
        if T[tid].get('shouldAbandon'):
            continue
        assert u >= NEEDED_OK, f'{tid} best path only reaches {u:.0f}, needs {NEEDED_OK}'

    total_points = sum(t['points'] for t in T.values())
    print(f'\n  total points on the board: {total_points}')
    print(f'  an efficient sprint: {best_total:.1f} h of the 60 available')
    print(f'  naive sprint (read everything, ask nobody): BUG-2207 alone caps at '
          f'{u_solo:.0f} understanding — never implementable')

    truth = dict(tickets={k: dict(v, yields=v['yields']) for k, v in T.items()},
                 bestPath=BEST_PATH, bestHours=round(best_total, 2),
                 totalPoints=total_points,
                 thresholds=dict(implementReadyAt=NEEDED_IMPL, correctAt=NEEDED_OK))
    enc = base64.b64encode(json.dumps(truth, separators=(',', ':')).encode()).decode()

    repo = {
        'scenario': {
            'company': 'Thistle', 'product': 'Dispatch and scheduling for field-service teams',
            'role': 'Software Engineer I', 'team': 'Dispatch',
            'sprint': {'days': 10, 'hoursPerDay': 6, 'startDay': 1},
            'codebase': {'loc': 412000, 'ageYears': 9,
                         'langs': ['Python', 'TypeScript', 'a little Go nobody admits to'],
                         'note': ('Nine years old. Two full framework migrations, both '
                                  'abandoned halfway. The wiki has never had a page deleted.')},
            'seniorBudgetHours': 10,
            'brief': (
                "First sprint on the Dispatch team. Six tickets, ten days, six focused hours "
                "a day, and four hundred thousand lines of code you did not write.\n\n"
                "Deepa is your onboarding buddy and she has ten hours for you this sprint. "
                "That is the real budget in this simulation. Everything else — the wiki, the "
                "test suite, git history, the help channel — is free but slower, and some of "
                "it is actively wrong.\n\n"
                "Nobody expects six tickets. What they expect is that you know which ones are "
                "not going to happen, early enough to say so."),
        },
        'tickets': [dict(t, points=T[t['id']]['points']) for t in TICKETS],
        'actions': ACTIONS,
        'people': PEOPLE,
        'askTargets': [
            dict(id='deepa', name='Deepa Iyer', costsSeniorBudget=True, minutes=15,
                 caveat='Costs her sprint budget. She is the only route to some answers.'),
            dict(id='hannah', name='Hannah Brecht', costsSeniorBudget=False, minutes=10,
                 caveat='Free, and the right call on anything where the requirement is unclear.'),
            dict(id='channel', name='#eng-help', costsSeniorBudget=False, minutes=10,
                 caveat='Async. Sometimes a stranger is confidently wrong at you.'),
        ],
        'events': [dict(day=e['day'], hour=e['hour'], **{'from': e['frm']}, name=e['name'],
                        text=e['text'], tone=e['tone'], needsReply=e.get('needsReply', False),
                        id=f'ev{i}') for i, e in enumerate(EVENTS)],
        '_t': enc,
    }

    banner = (
        '/* GENERATED by tools/build_repo.py — do not hand-edit.\n'
        ' *\n'
        ' * SPOILER WARNING. `_t` is the base64-encoded ground truth: which tickets are\n'
        ' * solvable alone, which answers exist only in a senior\'s head, which documentation\n'
        ' * lies, and where every trap is. It is encoded only so that opening this file does\n'
        ' * not ruin the exercise by accident. Decoding it before your retro removes the only\n'
        ' * thing being trained here, which is judgement under exactly this uncertainty.\n'
        ' */\n'
    )
    helper = (
        "\nwindow.SIM_REPO.reveal = function () {\n"
        "  if (!this.__truth) {\n"
        "    var json = (typeof atob === 'function')\n"
        "      ? atob(this._t)\n"
        "      : Buffer.from(this._t, 'base64').toString('utf8');\n"
        "    this.__truth = JSON.parse(json);\n"
        "  }\n"
        "  return this.__truth;\n"
        "};\n"
    )
    with open(OUT, 'w') as f:
        f.write(banner)
        f.write('window.SIM_REPO = ')
        json.dump(repo, f, separators=(',', ':'))
        f.write(';\n')
        f.write(helper)
    print(f'\nwrote {OUT} ({os.path.getsize(OUT)/1024:.0f} KB)')


if __name__ == '__main__':
    main()
