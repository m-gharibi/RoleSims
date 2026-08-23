#!/usr/bin/env python3
"""
Build data/company.js — the hidden ground truth for the Product Manager sim.

The design thesis: a PM's problem is not noise, it is BIAS. Every instrument
lies in a knowable direction. So the truth model is

    reading(feature, instrument) = trueImpact(feature)
                                 + sum(bias[instrument][tag] for tag in feature.tags)
                                 + gaussian(0, noise[instrument])

and the whole exercise is designed so that the CHEAP, LOUD instruments
(sales anecdotes, support tickets) actively INVERT the true ranking, while the
slower revealed-preference instruments (interviews, fake-door) recover it.

Feature set, each chosen to teach one thing:

    onboarding_checklist   the biggest win, and invisible to every loud channel
                           because people who bounce never file a ticket
    template_gallery       second win; compounds with the checklist
    perf_p95_latency       boring, real, support-visible
    realtime_collab        real value, but 2.4x underestimated — eats the quarter
    dashboard_themes       THE VANITY TRAP — surveys adore it, it does nothing
    sso_scim               THE REVENUE/METRIC TENSION — sales is right that it
                           closes deals and wrong that it moves activation
    mobile_view            expensive, flashy, near worthless
    admin_audit_log        cheap-looking enterprise ask, near worthless
    smart_alerts           modest, real
    csv_export_v2          small, real, cheap

Engineering estimates are systematically optimistic and by DIFFERENT amounts,
so the ranking by estCost is also wrong.
"""

import json, base64, itertools, os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT  = os.path.join(HERE, '..', 'data', 'company.js')

CAPACITY = 48          # eng-weeks in the quarter (4/week x 12 weeks)

#            id                      tags                          impact  trueCost optimism
FEATURES = [
    ('onboarding_checklist',   ['onboarding'],                        4.2,   6,  1.20),
    ('template_gallery',       ['onboarding', 'workflow'],            3.1,  12,  1.50),
    ('realtime_collab',        ['flashy', 'workflow'],                2.8,  24,  2.40),
    ('perf_p95_latency',       ['infra', 'fix'],                      2.4,  11,  1.80),
    ('smart_alerts',           ['workflow'],                          1.6,   9,  1.50),
    ('csv_export_v2',          ['fix'],                               0.6,   4,  1.30),
    ('mobile_view',            ['flashy'],                            0.4,  20,  2.00),
    ('sso_scim',               ['enterprise', 'fix'],                 0.3,  13,  1.60),
    ('admin_audit_log',        ['enterprise'],                        0.2,   7,  1.40),
    ('dashboard_themes',       ['flashy'],                            0.1,   8,  1.50),
]

IMPACT   = {f[0]: f[2] for f in FEATURES}
TRUECOST = {f[0]: f[3] for f in FEATURES}
OPTIMISM = {f[0]: f[4] for f in FEATURES}
TAGS     = {f[0]: f[1] for f in FEATURES}
ESTCOST  = {k: max(1, round(TRUECOST[k] / OPTIMISM[k])) for k in TRUECOST}

INTERACTIONS = [
    # a checklist that points at an empty gallery, and a gallery nobody is
    # walked to, each underperform; together they carry activation
    dict(pair=['onboarding_checklist', 'template_gallery'], delta=1.5),
]

# ------------------------------------------------------------- instrument bias
# Every number here is a lie the instrument tells, in metric points, per tag.
BIAS = {
    'sales_anecdote': {
        'enterprise': +2.6, 'flashy': +0.6, 'workflow': +0.2, 'fix': 0.0,
        'infra': -0.4, 'onboarding': -2.2, '_noise': 1.5,
    },
    'support_tickets': {
        'fix': +2.2, 'infra': +1.2, 'enterprise': +0.3, 'flashy': -0.2,
        'workflow': 0.0, 'onboarding': -2.6, '_noise': 1.0,
    },
    'usage_analytics': {
        'workflow': +0.3, 'onboarding': -0.9, 'flashy': 0.0, 'fix': 0.0,
        'infra': +0.2, 'enterprise': 0.0, '_noise': 0.7,
    },
    'survey': {
        'flashy': +2.0, 'enterprise': +0.5, 'fix': +0.4, 'workflow': +0.3,
        'infra': -0.8, 'onboarding': -1.5, '_noise': 1.2,
    },
    'interviews': {
        'onboarding': +0.4, 'workflow': +0.3, 'flashy': -0.1, 'fix': 0.0,
        'infra': 0.0, 'enterprise': 0.0, '_noise': 1.6,
    },
    'fake_door': {
        'onboarding': +0.1, 'flashy': +0.2, 'workflow': 0.0, 'fix': 0.0,
        'infra': 0.0, 'enterprise': 0.0, '_noise': 0.9,
    },
    'ab_test': {
        'onboarding': 0.0, 'flashy': 0.0, 'workflow': 0.0, 'fix': 0.0,
        'infra': 0.0, 'enterprise': 0.0, '_noise': 0.35,
    },
}

INSTRUMENTS = [
    dict(id='sales_anecdote', name='Talk to sales', days=1, slots=1,
         desc='Dan walks you through the deals he is working and what blocked them.',
         knownCaveat='Every story is true and none of them is representative. '
                     'Sales sees prospects, not the people who churned in week two.'),
    dict(id='support_tickets', name='Support ticket analysis', days=2, slots=1,
         desc='Tomás pulls ticket volume and themes for the last 90 days.',
         knownCaveat='Tickets come from people who stayed long enough to be '
                     'frustrated. Nobody who bounced on day one ever filed one.'),
    dict(id='usage_analytics', name='Usage analytics', days=5, slots=1,
         desc='Funnel and feature-usage analysis across the install base.',
         knownCaveat='Measures what people do with what exists. Blind, by '
                     'construction, to demand for what does not exist yet.'),
    dict(id='survey', name='Customer survey', days=5, slots=1,
         desc='Structured survey to 400 admins, asking what they want next.',
         knownCaveat='Stated preference. People reliably say they want the '
                     'visible thing and reliably use the boring one.'),
    dict(id='interviews', name='Customer interviews', days=4, slots=1,
         desc='Eight scheduled calls, mixed segments, jobs-to-be-done framing.',
         knownCaveat='Low bias, small sample. Eight people is eight people, and '
                     'the last one you spoke to will feel more important than it is.'),
    dict(id='fake_door', name='Fake-door test', days=10, slots=1,
         desc='Ship the entry point, measure clicks, show a coming-soon panel.',
         knownCaveat='Revealed preference and close to unbiased. Slow, and it '
                     'costs a little goodwill with the people who click.'),
    dict(id='ab_test', name='A/B test', days=15, slots=1, requiresShipped=True,
         desc='Randomised holdout on a feature that is already live.',
         knownCaveat='The cleanest number you can get, and it arrives after you '
                     'already made the decision. Only works on shipped features.'),
]

STAKEHOLDERS = [
    dict(id='marguerite', name='Marguerite Osei', role='CEO', startTrust=60,
         favors=['realtime_collab', 'mobile_view'], opposes=[],
         desc='Sharp, impatient, pattern-matches to competitors. Respects a no '
              'with a reason; punishes a no with a process.'),
    dict(id='dan', name='Dan Reilly', role='VP Sales', startTrust=60,
         favors=['sso_scim', 'admin_audit_log'], opposes=['dashboard_themes'],
         desc='Charming and relentless. Always has one specific deal that closes '
              'if you just build X. He is not lying, which is what makes it hard.'),
    dict(id='rina', name='Rina Chowdhury', role='Engineering lead', startTrust=60,
         favors=['perf_p95_latency'], opposes=['realtime_collab', 'mobile_view'],
         desc='Dry, protective of her team, allergic to scope creep. Her estimates '
              'are optimistic and she half knows it.'),
    dict(id='kofi', name='Kofi Adeyemi', role='Design lead', startTrust=60,
         favors=['dashboard_themes', 'mobile_view'], opposes=[],
         desc='Real taste, cares about coherence, drawn to visible polish over '
              'invisible value.'),
    dict(id='tomas', name='Tomás Vidal', role='Support lead', startTrust=60,
         favors=['perf_p95_latency', 'csv_export_v2'], opposes=[],
         desc='Buried and empirical. Speaks in ticket volumes. Represents the '
              'users you kept, loudly, and the ones you lost not at all.'),
]

NOTES = {
    'onboarding_checklist': (
        "The largest single win on the board (+4.2), and every loud channel understated it. "
        "Sales reads it 2.2 points low and support 2.6 low for the same structural reason: "
        "the people it would have helped were gone before they could complain. Interviews and "
        "the fake-door test were the only instruments that saw it clearly."),
    'template_gallery': (
        "+3.1 alone, +4.6 alongside the checklist. Activation compounds: a checklist pointing at "
        "an empty gallery and a gallery nobody is walked to each underdeliver."),
    'realtime_collab': (
        "Genuinely valuable (+2.8) and genuinely a trap. Estimated at 10 eng-weeks, actually 24 — "
        "the worst optimism ratio on the board. Committing to it costs you half the quarter and "
        "both onboarding wins. Right feature, wrong quarter."),
    'perf_p95_latency': (
        "+2.4, real, boring, and the one thing support was measuring correctly. Under-estimated "
        "1.8x, so it still hurt more than you planned."),
    'smart_alerts': "+1.6. Modest and real. A perfectly defensible use of the last slot.",
    'csv_export_v2': "+0.6 for 4 eng-weeks. Small, cheap, fine.",
    'mobile_view': (
        "+0.4 for 20 eng-weeks — the single worst trade available. Design and the CEO both wanted "
        "it and both were reading aesthetics as demand."),
    'sso_scim': (
        "THE REVENUE/METRIC TENSION. +0.3 on activation. Dan was right that it unblocks deals and "
        "wrong that it moves this metric. The correct answer was never 'no' — it was 'yes, and it "
        "belongs on the revenue roadmap, not against my activation target.' If you simply refused "
        "him without naming that distinction, you were right on the number and wrong on the job."),
    'admin_audit_log': "+0.2. A cheap-sounding enterprise ask that buys almost nothing.",
    'dashboard_themes': (
        "THE VANITY TRAP. +0.1 true impact, and the survey read it at roughly +2.1 because stated "
        "preference rewards the visible. If you shipped this on survey evidence, that is the lesson."),
}

EVENTS = [
    dict(week=1, day=1, frm='CEO', name='Marguerite Osei', tone='pressure',
         text="Activation is 31.4 and the board sees 40 next quarter. I don't need you to agree "
              "with the number. I need to know what you're doing about it and what you're not doing."),
    dict(week=1, day=2, frm='ENG', name='Rina Chowdhury', tone='neutral',
         text="Estimates are on the board. Usual caveat: they're what it looks like from here, not "
              "what it'll be. Ask me again once we're inside something."),
    dict(week=2, day=3, frm='SALES', name='Dan Reilly', tone='pressure',
         text="Northwind is 180k ARR and they will not sign without SCIM provisioning. I'm not "
              "asking you to reprioritise the whole quarter. I'm asking for one thing."),
    dict(week=4, day=2, frm='SALES', name='Dan Reilly', tone='alarm', needsReply=True,
         text="Northwind moved to a competitor evaluation. If SSO isn't committed this week I'm "
              "telling Marguerite we lost it on product. What do you want me to say?"),
    dict(week=5, day=1, frm='CEO', name='Marguerite Osei', tone='alarm',
         text="Kestrel just launched realtime co-editing and it's all over our channel. "
              "Tell me why we're not doing that."),
    dict(week=6, day=4, frm='CUSTOMER', name='Priya Raman — Head of Data, Vantiv', tone='neutral',
         text="Honestly? The product's fine once you're in it. Getting my team in was the problem. "
              "Four of my six analysts never made it past the empty state."),
    dict(week=7, day=2, frm='ENG', name='Rina Chowdhury', tone='alarm',
         text="We had a production incident overnight. I'm pulling two engineers for the rest of "
              "the week. That's about five eng-weeks off your quarter. Not negotiable."),
    dict(week=8, day=1, frm='CEO', name='Marguerite Osei', tone='pressure', needsReply=True,
         text="I want mobile in this quarter. I've said it to the board. Talk me out of it if "
              "you think I'm wrong, but talk me out of it with something."),
    dict(week=9, day=3, frm='SUPPORT', name='Tomás Vidal', tone='warn',
         text="P95 latency complaints are up 40% month over month. It's now our top ticket driver. "
              "I'm not a PM but this feels like it should be on the list."),
    dict(week=10, day=2, frm='DESIGN', name='Kofi Adeyemi', tone='neutral',
         text="Whatever ships, it needs to feel like one product. Three half-finished things is "
              "worse than one finished one. I'd rather we cut than smear."),
    dict(week=11, day=1, frm='ENG', name='Rina Chowdhury', tone='warn',
         text="Reality check on what's still open. Anything not code-complete by Friday of week 11 "
              "is not shipping this quarter, and half-shipped is the same as not shipped."),
    dict(week=12, day=3, frm='CEO', name='Marguerite Osei', tone='pressure',
         text="QBR Thursday. I want the number, the reasoning, and what you'd do differently. "
              "I've never once been annoyed by a PM who told me they were wrong early."),
]


def set_value(ids):
    total = sum(IMPACT[i] for i in ids)
    s = set(ids)
    for it in INTERACTIONS:
        if set(it['pair']) <= s:
            total += it['delta']
    return total


def best_set(capacity=CAPACITY):
    ids = list(IMPACT)
    best, bestv = None, -1e9
    for k in range(1, len(ids) + 1):
        for combo in itertools.combinations(ids, k):
            if sum(TRUECOST[i] for i in combo) > capacity:
                continue
            v = set_value(combo)
            if v > bestv:
                best, bestv = list(combo), v
    return best, bestv


def reading_mean(fid, inst):
    """Expected reading, ignoring noise — what the instrument tells you on average."""
    return IMPACT[fid] + sum(BIAS[inst].get(t, 0.0) for t in TAGS[fid])


def main():
    # ------- pedagogical assertions -------
    # 1. the loud, cheap channels must INVERT the ranking of the top feature
    for loud in ('sales_anecdote', 'support_tickets'):
        best_by_loud = max(IMPACT, key=lambda f: reading_mean(f, loud))
        assert best_by_loud != 'onboarding_checklist', f'{loud} should not find the real winner'
        assert reading_mean('sso_scim', loud) > reading_mean('onboarding_checklist', loud), \
            f'{loud} should rank sso_scim above the real winner'
    # 2. the survey must love the vanity feature
    assert reading_mean('dashboard_themes', 'survey') > 1.8, 'survey should overrate themes'
    assert reading_mean('dashboard_themes', 'survey') > reading_mean('perf_p95_latency', 'survey'), \
        'survey should rank vanity above the real infra win'
    # 3. the low-bias instruments must recover the truth
    for good in ('interviews', 'fake_door', 'ab_test'):
        top = max(IMPACT, key=lambda f: reading_mean(f, good))
        assert top == 'onboarding_checklist', f'{good} should find the real winner, got {top}'
    # 4. optimism must make the tempting big feature unaffordable
    assert ESTCOST['realtime_collab'] == 10 and TRUECOST['realtime_collab'] == 24
    # 5. the optimum must exclude every stakeholder-favourite big swing
    best, bestv = best_set()
    assert 'onboarding_checklist' in best and 'template_gallery' in best, 'optimum needs both wins'
    assert 'realtime_collab' not in best and 'mobile_view' not in best, 'optimum must refuse the big swings'
    assert 'sso_scim' not in best, 'optimum must refuse the sales ask (on THIS metric)'
    for vanity in ('dashboard_themes', 'mobile_view', 'admin_audit_log', 'sso_scim'):
        assert vanity not in best, f'optimum must not contain vanity feature {vanity}'

    print(f'capacity {CAPACITY} eng-weeks   (sum of estimates {sum(ESTCOST.values())}, '
          f'sum of TRUE costs {sum(TRUECOST.values())}, overall optimism '
          f'{sum(TRUECOST.values())/sum(ESTCOST.values()):.2f}x)\n')
    print(f"  {'feature':24s}{'true':>6s}{'est':>5s}{'cost':>6s}{'opt':>6s}   what each instrument says")
    print('  ' + '-' * 108)
    order = ['sales_anecdote', 'support_tickets', 'survey', 'usage_analytics', 'interviews', 'fake_door']
    print(f"  {'':47s}" + ''.join(f'{i[:9]:>10s}' for i in order))
    for fid in sorted(IMPACT, key=lambda k: -IMPACT[k]):
        r = ''.join(f'{reading_mean(fid, i):+10.1f}' for i in order)
        print(f'  {fid:24s}{IMPACT[fid]:+6.1f}{ESTCOST[fid]:5d}{TRUECOST[fid]:6d}{OPTIMISM[fid]:6.2f}   {r}')

    print(f'\n  optimum: {", ".join(sorted(best))}')
    print(f'  best achievable: +{bestv:.1f} pp   (cost {sum(TRUECOST[i] for i in best)} of {CAPACITY})')
    loud = ['sso_scim', 'admin_audit_log', 'perf_p95_latency', 'csv_export_v2']
    print(f'  "listen to sales+support" pick: +{set_value(loud):.1f} pp   '
          f'(regret {bestv - set_value(loud):.1f})')
    ceo = ['realtime_collab', 'mobile_view']
    print(f'  "please the CEO" pick: costs {sum(TRUECOST[i] for i in ceo)} of {CAPACITY} eng-weeks '
          f'for +{set_value(ceo):.1f} pp   (regret {bestv - set_value(ceo):.1f})')

    truth = dict(impact=IMPACT, trueCost=TRUECOST, optimism=OPTIMISM, tags=TAGS,
                 interactions=INTERACTIONS, bias=BIAS, notes=NOTES,
                 bestSet=sorted(best), bestValue=round(bestv, 3), capacity=CAPACITY)
    enc = base64.b64encode(json.dumps(truth, separators=(',', ':')).encode()).decode()

    co = {
        'scenario': {
            'company': 'Lumen', 'product': 'Collaborative analytics for data teams',
            'role': 'Product Manager, Growth & Core',
            'northStar': {'name': 'W4 team activation', 'units': 'pp', 'baseline': 31.4,
                          'desc': 'Percentage of newly created teams with 3+ active members '
                                  'still active in week four. The number you are held to.'},
            'quarter': {'weeks': 12, 'workDaysPerWeek': 5},
            'capacity': {'engWeeksPerWeek': 4, 'total': CAPACITY},
            'brief': (
                "You own activation at Lumen. The number is 31.4 and Marguerite has told the board "
                "it will be 40 by the end of the quarter.\n\n"
                "You have one engineering team — four eng-weeks of capacity per week, forty-eight "
                "for the quarter — ten candidate features, and seven ways of finding out what is "
                "actually true. Every one of those seven lies to you in a different direction, and "
                "the cheapest ones lie the most.\n\n"
                "None of the five people who want things from you reports to you. You will have to "
                "say no to most of them, and you will have to keep them anyway."
            ),
            'ceoMandate': 'Activation from 31.4 to 40.0 by the end of the quarter.',
        },
        'features': [
            dict(id=f[0], name=n, tags=f[1], estCost=ESTCOST[f[0]], desc=d, pitchedBy=p)
            for f, n, d, p in zip(
                FEATURES,
                ['Onboarding checklist', 'Template gallery', 'Realtime co-editing',
                 'P95 latency work', 'Smart alerts', 'CSV export v2', 'Mobile view',
                 'SSO / SCIM provisioning', 'Admin audit log', 'Dashboard themes'],
                ['A guided first-run checklist that walks a new team through creating a workspace, '
                 'inviting members and building a first chart.',
                 'A gallery of prebuilt analysis templates so a new team starts from something '
                 'rather than an empty canvas.',
                 'Multiple cursors and live co-editing in the analysis canvas. Kestrel shipped '
                 'theirs last month.',
                 'Reduce P95 query latency on large workspaces from 4.1s to under 1.5s.',
                 'Threshold and anomaly alerts on any saved metric, delivered to Slack or email.',
                 'Scheduled exports, custom column mapping, and the delimiter options everyone asks for.',
                 'A responsive read-only mobile view of dashboards and alerts.',
                 'SAML SSO with SCIM user provisioning and deprovisioning.',
                 'Immutable admin activity log with export, for compliance reviews.',
                 'Light/dark plus six accent themes and per-workspace branding.'],
                ['you', 'you', 'Marguerite (CEO)', 'Rina (Eng)', 'you', 'Tomás (Support)',
                 'Kofi (Design)', 'Dan (Sales)', 'Dan (Sales)', 'Kofi (Design)'])
        ],
        'instruments': INSTRUMENTS,
        'stakeholders': STAKEHOLDERS,
        'events': [dict(week=e['week'], day=e['day'], **{'from': e['frm']}, name=e['name'],
                        text=e['text'], tone=e['tone'], needsReply=e.get('needsReply', False),
                        id=f"ev{n}") for n, e in enumerate(EVENTS)],
        '_t': enc,
    }

    banner = (
        '/* GENERATED by tools/build_company.py — do not hand-edit.\n'
        ' *\n'
        ' * SPOILER WARNING. `_t` is the base64-encoded ground truth: the real impact and real cost\n'
        ' * of every feature, and the exact direction each research instrument lies in. It is encoded\n'
        ' * only so that opening this file does not ruin the exercise by accident. Decoding it before\n'
        ' * your QBR throws away the entire point, which is deciding under bias you cannot see.\n'
        ' */\n'
    )
    helper = (
        "\nwindow.SIM_CO.reveal = function () {\n"
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
        f.write('window.SIM_CO = ')
        json.dump(co, f, separators=(',', ':'))
        f.write(';\n')
        f.write(helper)
    print(f'\nwrote {OUT} ({os.path.getsize(OUT)/1024:.0f} KB)')


if __name__ == '__main__':
    main()
