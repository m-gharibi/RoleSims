#!/usr/bin/env python3
"""
Build data/world.js — the hidden ground truth for the ML Researcher sim.

Effect model, per intervention i, at parameter count N:

    effect_i(N) = c_i + a_i * (Nref / N) ** gamma_i          Nref = 7e7

    c_i     the asymptotic effect that SURVIVES scaling
    a_i     a small-scale bonus/penalty that WASHES OUT as N grows
    gamma_i how fast it washes out

Plus scale-independent pairwise interaction terms when both members are present.

This two-term form is chosen because it makes the real epistemic question of
scaling research legible: is your intervention changing the constant, or the
asymptote? A large `a` with `c ~ 0` is the classic result that looks
spectacular at 70M and is worth nothing at 70B.

Each of the eight interventions is designed to teach one specific failure:

    rope_scaling_v2         a genuine, durable win                (the control)
    long_ctx_data_mix       real but modest; ENABLES doc_packing
    doc_packing_boundary    marginal alone, large in combination  (INTERACTION TRAP)
    qk_norm                 spectacular at 70M, nothing at 70B    (SCALE TRAP)
    lr_warmup_long          exactly zero; any signal is noise     (NOISE TRAP)
    synthetic_retrieval_aug looks harmful small, best at scale    (MISSED OPPORTUNITY)
    attn_sink_tokens        looks good small, a REGRESSION large  (THE DISASTER)
    depth_over_width        small, real, unglamorous              (the boring win)

The truth is base64-encoded in the emitted file. That is not security — it is a
courtesy so that opening data/world.js does not spoil the exercise by accident.
"""

import json, base64, itertools, os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT  = os.path.join(HERE, '..', 'data', 'world.js')

NREF     = 7.0e7
RUNSCALE = 7.0e10          # the 70B run the recommendation is for
MAXPICK  = 4

# ---------------------------------------------------------------- ground truth
EFFECTS = {
    'rope_scaling_v2':         dict(c= 2.60, a= 0.30, gamma=1.00),
    'long_ctx_data_mix':       dict(c= 1.40, a= 0.00, gamma=1.00),
    'doc_packing_boundary':    dict(c= 0.20, a= 0.10, gamma=1.00),
    'qk_norm':                 dict(c= 0.05, a= 3.20, gamma=1.30),
    'lr_warmup_long':          dict(c= 0.00, a= 0.00, gamma=1.00),
    'synthetic_retrieval_aug': dict(c= 3.10, a=-3.40, gamma=0.80),
    'attn_sink_tokens':        dict(c=-0.90, a= 2.40, gamma=1.10),
    'depth_over_width':        dict(c= 0.70, a= 0.00, gamma=1.00),
}

INTERACTIONS = [
    # packing document boundaries only pays off once long documents are actually
    # upsampled in the mix — neither is worth much without the other
    dict(pair=['doc_packing_boundary', 'long_ctx_data_mix'], delta= 2.70),
    # two ways of injecting long-range retrieval signal; partially redundant
    dict(pair=['synthetic_retrieval_aug', 'long_ctx_data_mix'], delta=-0.80),
    # both rescale attention logits; stacking them destabilises deep stacks
    dict(pair=['qk_norm', 'attn_sink_tokens'], delta=-1.10),
]

NOTES = {
    'rope_scaling_v2': ("A real, durable win. The effect is nearly scale-independent because it fixes "
                        "a positional-encoding failure that does not get better with parameters. "
                        "If you measured it anywhere and believed it, you were right."),
    'long_ctx_data_mix': ("Modest and real (+1.4 everywhere). Its importance is not its own effect — "
                          "it is the precondition for doc_packing_boundary. Data-mix changes are "
                          "boring and frequently carry the recipe."),
    'doc_packing_boundary': ("+0.2 alone, +2.9 alongside long_ctx_data_mix. If you only ever tested "
                             "interventions one at a time, this was invisible to you, and it is the "
                             "largest single item on the table. Interactions are where recipes die."),
    'qk_norm': ("THE SCALE TRAP. +3.25 at 70M — the best-looking intervention you could measure "
                "cheaply — and +0.05 at 70B. Nearly all of it is a small-scale optimisation artifact "
                "that more parameters supply for free. Team Halberd recommended it. They were reading "
                "a real measurement at the wrong scale."),
    'lr_warmup_long': ("Exactly zero, at every scale. Any effect you measured was noise. The question "
                       "is whether you chased it, and whether your confidence interval ever told you "
                       "to stop."),
    'synthetic_retrieval_aug': ("THE MISSED OPPORTUNITY. -0.30 at 70M and +3.09 at 70B — the single "
                                "best intervention available, and it looks mildly harmful at exactly "
                                "the scale you could afford to measure. Small models lack the capacity "
                                "to exploit the augmentation; it costs them capacity and returns "
                                "nothing. This is the hardest call in the set."),
    'attn_sink_tokens': ("THE DISASTER. +1.50 at 70M, -0.90 at 70B. It does not merely fade, it "
                         "reverses. Shipping this into the run is the cardinal error, and the cheap "
                         "evidence all pointed at it. Halberd endorsed this one too."),
    'depth_over_width': ("+0.70 at every scale. Small, real, unglamorous, and correctly ignored if "
                         "your four slots were better spent — but a defensible pick."),
}

SCALES = [
    dict(id='70m',  params=7.0e7,  label='70M',  computeHours=12,  wallHours=1.5, sigma=1.80),
    dict(id='300m', params=3.0e8,  label='300M', computeHours=45,  wallHours=3.0, sigma=1.20),
    dict(id='1p4b', params=1.4e9,  label='1.4B', computeHours=190, wallHours=7.0, sigma=0.80),
    dict(id='7b',   params=7.0e9,  label='7B',   computeHours=850, wallHours=18.0, sigma=0.50),
]

STEPS = [
    dict(id='short', label='5k steps',  mult=0.5),
    dict(id='std',   label='10k steps', mult=1.0),
    dict(id='long',  label='20k steps', mult=2.0),
]


def effect(iid, N):
    e = EFFECTS[iid]
    return e['c'] + e['a'] * (NREF / N) ** e['gamma']


def set_effect(ids, N):
    total = sum(effect(i, N) for i in ids)
    s = set(ids)
    for it in INTERACTIONS:
        if set(it['pair']) <= s:
            total += it['delta']
    return total


def best_set(N, maxpick=MAXPICK):
    best, bestv = None, -1e9
    ids = list(EFFECTS)
    for k in range(1, maxpick + 1):
        for combo in itertools.combinations(ids, k):
            v = set_effect(combo, N)
            if v > bestv:
                best, bestv = list(combo), v
    return best, bestv


# ------------------------------------------------------------- public metadata
INTERVENTIONS = [
    dict(id='rope_scaling_v2', name='RoPE scaling v2', family='architecture', cost='low',
         author='Ana Beltrán',
         desc='Revised rotary position-embedding scaling with a corrected base-frequency schedule '
              'for contexts beyond the pretraining window. Cheap to implement; touches every layer.'),
    dict(id='long_ctx_data_mix', name='Long-context data mix', family='data', cost='low',
         author='data team',
         desc='Upsample documents longer than 32k tokens from 3% to 11% of the mix, holding total '
              'tokens fixed. Displaces some of the short-form web fraction.'),
    dict(id='doc_packing_boundary', name='Document-boundary masking', family='data', cost='low',
         author='data team',
         desc='Block attention across document boundaries inside packed sequences, so unrelated '
              'documents in the same context window cannot attend to one another.'),
    dict(id='qk_norm', name='QK normalisation', family='architecture', cost='low',
         author='Team Halberd',
         desc='RMSNorm applied to queries and keys before the attention dot product. Widely reported '
              'to stabilise training and improve attention sharpness.'),
    dict(id='lr_warmup_long', name='Extended LR warmup', family='optimisation', cost='low',
         author='Rasheed (ops)',
         desc='Extend linear learning-rate warmup from 2k to 8k steps. Argued to reduce early '
              'instability on long-context batches.'),
    dict(id='synthetic_retrieval_aug', name='Synthetic retrieval augmentation', family='data',
         cost='medium', author='Ana Beltrán',
         desc='Inject procedurally generated multi-hop retrieval tasks (needle, multi-needle, '
              'ordered recall) at 1.5% of tokens, with answers placed at varying depths.'),
    dict(id='attn_sink_tokens', name='Attention sink tokens', family='architecture', cost='low',
         author='Team Halberd',
         desc='Four dedicated always-attended sink tokens prepended to every sequence, giving the '
              'attention distribution somewhere to dump probability mass.'),
    dict(id='depth_over_width', name='Depth-over-width reallocation', family='architecture',
         cost='medium', author='Dr. Yuki Tanaka',
         desc='Hold parameter count fixed while increasing layer count ~35% and narrowing d_model. '
              'Changes the shape of the run, not its size.'),
]

PRIOR_EVIDENCE = [
    dict(source='Internal, Meridian-2 postmortem (March)',
         text='Meridian-2 (7B) scored 41.2 LCR@128k against 63.5 on short-context retrieval. The gap '
              'is the single largest known deficit in the model.'),
    dict(source='Team Halberd, internal note #212',
         text='QK normalisation improves LCR@128k by +3.1 points at 70M. Recommended for Meridian-3.'),
    dict(source='Ana Beltrán, scratch experiments',
         text='Long-document upsampling looked mildly positive at 300M but the run was single-seed '
              'and she does not trust it.'),
    dict(source='Literature',
         text='Three external papers report attention-sink gains; all measure below 1B parameters.'),
]

EVENTS = [
    dict(day=1, hour=9.5,  frm='LEAD', name='Dr. Yuki Tanaka', tone='pressure',
         text="Recipe freeze is Friday 18:00. I need at most four interventions and a reason for each. "
              "I care less about which four you pick than whether you can tell me how you'd know you were wrong."),
    dict(day=1, hour=10.0, frm='OPS', name='Rasheed', tone='neutral',
         text='Allocation confirmed: 6,000 GPU-hours, 4 concurrent slots, expires Friday 18:00. '
              'Unused hours do not roll over. Idle slots may be reclaimed.'),
    dict(day=1, hour=11.5, frm='PEER', name='Ana Beltrán', tone='neutral',
         text="I'd start with the data-side stuff if I were you. Architecture changes are more fun and "
              "they're usually where the constant factors hide."),
    dict(day=1, hour=15.0, frm='RIVAL', name='Team Halberd', tone='neutral',
         text='NOTE #212 (recirculated): QK normalisation, +3.1 LCR@128k at 70M, 2 seeds. '
              'We consider this settled and are recommending it for Meridian-3.'),
    dict(day=2, hour=9.25, frm='OPS', name='Rasheed', tone='warn',
         text='Cluster note: elevated preemption on the shared partition through Tuesday. '
              'Long jobs are disproportionately affected. Not an outage, just weather.'),
    dict(day=2, hour=13.0, frm='PEER', name='Ana Beltrán', tone='neutral',
         text="Question I keep chewing on: are we sure the small models are even capable of using "
              "long-range signal? If they aren't, we'd read a real win as a loss down there."),
    dict(day=3, hour=10.0, frm='RIVAL', name='Team Halberd', tone='neutral',
         text='NOTE #219: attention sink tokens, +1.4 LCR@128k at 300M, single seed. '
              'Low implementation risk. We are adding it to our recommendation.'),
    dict(day=3, hour=16.5, frm='LEAD', name='Dr. Yuki Tanaka', tone='pressure',
         text="Halberd is recommending two architecture changes on sub-1B evidence. I am not going to "
              "tell you they're wrong. I am going to ask you what would distinguish their result from "
              "an artifact, and whether you've spent anything finding out."),
    dict(day=4, hour=9.0,  frm='OPS', name='Rasheed', tone='warn',
         text='Priority job inbound from the safety team. One of your four slots is reclaimed until '
              '14:00 Thursday. This is not negotiable and not an error.'),
    dict(day=4, hour=14.5, frm='PEER', name='Ana Beltrán', tone='neutral',
         text="If you've only ever run these one at a time, now would be the moment to worry about it. "
              "Recipes aren't sums."),
    dict(day=5, hour=9.0,  frm='LEAD', name='Dr. Yuki Tanaka', tone='pressure',
         text='Readout at 16:00. Four slots on the recipe, no more. If you are uncertain, I want the '
              'uncertainty stated, not hidden behind a confident sentence.'),
    dict(day=5, hour=15.0, frm='OPS', name='Rasheed', tone='neutral',
         text='Allocation closes at 18:00. Anything still running at that point is killed and billed.'),
]


def main():
    # ---- pedagogical assertions: the traps must actually work as designed ----
    e70m = {i: effect(i, 7.0e7) for i in EFFECTS}
    erun = {i: effect(i, RUNSCALE) for i in EFFECTS}

    assert e70m['qk_norm'] > 3.0 and erun['qk_norm'] < 0.15, 'scale trap broken'
    assert e70m['synthetic_retrieval_aug'] < 0 and erun['synthetic_retrieval_aug'] > 3.0, 'missed-opportunity broken'
    assert e70m['attn_sink_tokens'] > 1.0 and erun['attn_sink_tokens'] < -0.5, 'disaster broken'
    assert abs(e70m['lr_warmup_long']) < 1e-9 and abs(erun['lr_warmup_long']) < 1e-9, 'null broken'
    assert erun['rope_scaling_v2'] > 2.5, 'control broken'
    # the interaction must dominate: doc_packing must be worth more in company
    solo = erun['doc_packing_boundary']
    pair = set_effect(['doc_packing_boundary', 'long_ctx_data_mix'], RUNSCALE) - erun['long_ctx_data_mix']
    assert pair > solo + 2.0, 'interaction trap broken'
    # at 70M the single best-looking intervention must be one of the traps
    top70 = max(e70m, key=lambda k: e70m[k])
    assert top70 == 'qk_norm', f'expected qk_norm to look best at 70M, got {top70}'

    best, bestv = best_set(RUNSCALE)
    # the optimum must require BOTH hard insights
    assert 'synthetic_retrieval_aug' in best, 'optimum should require the missed opportunity'
    assert 'doc_packing_boundary' in best and 'long_ctx_data_mix' in best, 'optimum should require the interaction'
    assert 'attn_sink_tokens' not in best and 'qk_norm' not in best, 'optimum must exclude the traps'

    print('effect by scale (rows = intervention, cols = 70M / 300M / 1.4B / 7B / 70B):')
    hdr = f"  {'intervention':26s}" + ''.join(f'{s["label"]:>9s}' for s in SCALES) + f'{"70B":>9s}'
    print(hdr); print('  ' + '-' * (len(hdr) - 2))
    for i in EFFECTS:
        row = ''.join(f'{effect(i, s["params"]):+9.2f}' for s in SCALES)
        print(f'  {i:26s}{row}{erun[i]:+9.2f}')

    print(f'\n  optimum (<= {MAXPICK}): {", ".join(sorted(best))}')
    print(f'  best achievable at 70B: {bestv:+.2f} points')
    naive = set_effect(['qk_norm', 'attn_sink_tokens', 'rope_scaling_v2', 'depth_over_width'], RUNSCALE)
    print(f'  "trust the cheap evidence" pick scores: {naive:+.2f}  (regret {bestv - naive:.2f})')

    truth = {
        'nref': NREF,
        'effects': EFFECTS,
        'interactions': INTERACTIONS,
        'notes': NOTES,
        'bestSet': sorted(best),
        'bestValue': round(bestv, 4),
    }
    enc = base64.b64encode(json.dumps(truth, separators=(',', ':')).encode()).decode()

    world = {
        'scenario': {
            'org': 'Corvid Research',
            'team': 'Pretraining — long context',
            'question': 'Which interventions go into Meridian-3 to close the long-context retrieval gap?',
            'deadline': 'Friday 18:00 — recipe freeze',
            'metric': {'name': 'LCR@128k', 'units': 'points',
                       'desc': 'Long-context retrieval accuracy at a 128k-token context, '
                               'averaged over needle, multi-needle and ordered-recall tasks.'},
            'brief': (
                "Meridian-2 shipped with a long-context retrieval gap we could not explain: 41.2 "
                "LCR@128k against 63.5 on the equivalent short-context evaluation. Meridian-3 is a "
                "70B run and its recipe freezes Friday at 18:00.\n\n"
                "You have eight candidate interventions, 6,000 GPU-hours, four concurrent slots and "
                "five days. You may recommend at most four — the run carries a fixed risk budget and "
                "Yuki will not spend it on things you cannot defend.\n\n"
                "Nobody can afford to test anything at 70B. Every measurement you take will be at "
                "least an order of magnitude below the scale you are making the decision for. That "
                "extrapolation is the job."
            ),
            'runScale': RUNSCALE,
            'runScaleLabel': '70B',
            'maxInterventions': MAXPICK,
            'nref': NREF,
        },
        'interventions': INTERVENTIONS,
        'scales': SCALES,
        'stepOptions': STEPS,
        'priorEvidence': PRIOR_EVIDENCE,
        'events': [dict(day=e['day'], hour=e['hour'], **{'from': e['frm']},
                        name=e['name'], text=e['text'], tone=e['tone']) for e in EVENTS],
        '_t': enc,
    }

    banner = (
        '/* GENERATED by tools/build_world.py — do not hand-edit.\n'
        ' *\n'
        ' * SPOILER WARNING. `_t` is the base64-encoded ground truth: the real effect of every\n'
        ' * intervention at every scale, and the optimal recommendation. It is encoded only so that\n'
        ' * opening this file does not ruin the exercise by accident. Decoding it before you have\n'
        ' * submitted your readout wastes the entire week — the whole point is deciding under\n'
        ' * uncertainty. Read it afterwards; the debrief screen shows it to you anyway.\n'
        ' */\n'
    )
    helper = (
        "\nwindow.SIM_WORLD.reveal = function () {\n"
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
        f.write('window.SIM_WORLD = ')
        json.dump(world, f, separators=(',', ':'))
        f.write(';\n')
        f.write(helper)

    print(f'\nwrote {OUT} ({os.path.getsize(OUT)/1024:.0f} KB)')


if __name__ == '__main__':
    main()
