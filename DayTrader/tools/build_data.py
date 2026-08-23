#!/usr/bin/env python3
"""
Build data/days.js for the Day Trader sim.

Source bars are REAL 1-minute market data (cached in tools/*.json, originally
pulled from the Yahoo chart API). Each session is:

  - rebased multiplicatively so the previous close lands on a target price
    (this preserves every percentage move exactly while making the tape
    unidentifiable at a glance),
  - relabelled with a fictional ticker and company,
  - annotated with a desk-event script.

IMPORTANT on the news wire: every WIRE headline is placed *after* the price
move it refers to has already begun. Real headlines lag the tape. A sim that
prints the news before the move teaches the exact wrong reflex.

Nothing here may leak future information into the bar stream itself.
"""

import json, datetime, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT  = os.path.join(HERE, '..', 'data', 'days.js')

PRE_START_M = 480   # 08:00 ET — how much pre-market context to ship
RTH_OPEN_M  = 570   # 09:30
RTH_CLOSE_M = 960   # 16:00


def load_raw(ticker):
    with open(os.path.join(HERE, f'{ticker}.json')) as f:
        d = json.load(f)
    r  = d['chart']['result'][0]
    ts = r['timestamp']
    q  = r['indicators']['quote'][0]
    out = []
    for i, x in enumerate(ts):
        o, h, l, c = q['open'][i], q['high'][i], q['low'][i], q['close'][i]
        if None in (o, h, l, c):
            continue
        dt = datetime.datetime.fromtimestamp(x)
        out.append({
            'day': dt.strftime('%Y-%m-%d'),
            'm':   dt.hour * 60 + dt.minute,
            'o': o, 'h': h, 'l': l, 'c': c,
            'v': q['volume'][i] or 0,
        })
    return out


def prev_rth_close(bars, day):
    """Actual previous session's RTH closing print."""
    days = sorted({b['day'] for b in bars})
    idx  = days.index(day)
    if idx == 0:
        raise SystemExit(f'no previous session available for {day}')
    prev = days[idx - 1]
    rth  = [b for b in bars if b['day'] == prev and RTH_OPEN_M <= b['m'] < RTH_CLOSE_M]
    return rth[-1]['c']


def build_session(cfg, seq):
    raw   = load_raw(cfg['src_ticker'])
    day   = cfg['src_date']
    pc    = prev_rth_close(raw, day)
    scale = cfg['base'] / pc            # multiplicative: preserves % moves exactly

    def px(v):
        return round(v * scale, 2)

    session = [b for b in raw if b['day'] == day and PRE_START_M <= b['m'] < RTH_CLOSE_M]
    session.sort(key=lambda b: b['m'])

    bars = []
    for b in session:
        o, h, l, c = px(b['o']), px(b['h']), px(b['l']), px(b['c'])
        lo, hi = min(o, h, l, c), max(o, h, l, c)   # keep OHLC self-consistent after rounding
        bars.append({
            'm': b['m'],
            't': f"{b['m']//60:02d}:{b['m']%60:02d}",
            'o': o, 'h': hi if h >= hi else h, 'l': lo if l <= lo else l,
            'c': c, 'v': int(b['v']),
            'rth': b['m'] >= RTH_OPEN_M,
        })
        bars[-1]['h'] = max(o, h, c, l)
        bars[-1]['l'] = min(o, h, c, l)

    pre = [b for b in bars if not b['rth']]
    rth = [b for b in bars if b['rth']]
    if len(rth) < 380:
        raise SystemExit(f'{cfg["ticker"]}: only {len(rth)} RTH bars, expected ~390')

    prev_close = round(cfg['base'], 2)
    pre_last   = pre[-1]['c'] if pre else rth[0]['o']

    premkt = {
        'high':   max(b['h'] for b in pre) if pre else rth[0]['o'],
        'low':    min(b['l'] for b in pre) if pre else rth[0]['o'],
        'last':   pre_last,
        'volume': sum(b['v'] for b in pre),
        'gapPct': round((pre_last - prev_close) / prev_close * 100, 2),
    }

    levels = [
        {'label': 'Prev close',   'px': prev_close},
        {'label': 'Pre-mkt high', 'px': premkt['high']},
        {'label': 'Pre-mkt low',  'px': premkt['low']},
    ]

    brief = dict(cfg['brief'])
    brief['levels'] = levels

    return {
        'id':        f'day{seq}',
        'ticker':    cfg['ticker'],
        'company':   cfg['company'],
        'sector':    cfg['sector'],
        'sessionNo': seq,
        'prevClose': prev_close,
        'openM':     RTH_OPEN_M,
        'closeM':    RTH_CLOSE_M,
        'bars':      bars,
        'premkt':    premkt,
        'brief':     brief,
        'events':    cfg['events'],
    }


def ev(m, frm, name, text, tone='neutral'):
    return {'m': m, 't': f'{m//60:02d}:{m%60:02d}', 'from': frm,
            'name': name, 'text': text, 'tone': tone}


PM, RISK, DESK, WIRE = 'PM', 'RISK', 'DESK', 'WIRE'
DANA, MARCUS, PRIYA, TAPE = 'Dana Whitfield', 'Marcus Reed', 'Priya', 'Newswire'


# ---------------------------------------------------------------------------
# SESSION 1 — ORVX. Real tape: gap up 3.2%, grinds higher all session, high of
# day at 15:55, closes on the high. Two sharp shakeouts at 10:34 and 11:07 that
# scare people out of a winner. The lesson is holding a trend through noise.
# ---------------------------------------------------------------------------
DAY1 = {
    'src_ticker': 'PLTR', 'src_date': '2026-08-07',
    'ticker': 'ORVX', 'company': 'Orvex Dynamics',
    'sector': 'Enterprise software / defense analytics',
    'base': 184.00,
    'brief': {
        'headline': ('Orvex reported Q2 after the close last night: revenue $1.04bn vs $0.97bn '
                     'consensus, and management raised full-year guidance for the second '
                     'consecutive quarter. Government segment grew 61% y/y. The stock is '
                     'indicated sharply higher and has traded heavy volume since 04:00.'),
        'bullCase': ('A genuine beat-and-raise with the growth coming from the highest-margin '
                     'segment. Gap-ups on raised guidance in a name with this much retail and '
                     'momentum following tend to see continuation buying, not fade. Every '
                     'sell-side note out this morning has raised its target.'),
        'bearCase': ('The stock is already up 40% over three months and trades at a rich '
                     'multiple. Gaps of this size routinely fill by lunch as fast money takes '
                     'profits into strength. You are buying at the highest price anyone has '
                     'paid in a year, into supply from holders who have waited to get out.'),
        'pmAsk': ('I want a real plan, not a direction. Tell me where you get long, where you '
                  'are wrong, and how much you are willing to lose to find out. If you trade '
                  'this from the short side you had better have a reason better than "it is up '
                  'a lot."'),
    },
    'events': [
        ev(571, WIRE, TAPE, 'ORVX OPENS AT 189.92, +3.2% — FIRST-MINUTE VOLUME 4.1M SHARES, 12x AVERAGE', 'neutral'),
        ev(574, PM,   DANA, "You've got the tape. I'm not going to hover, but I want to hear from you before you put risk on, not after.", 'pressure'),
        ev(578, DESK, PRIYA, "Morning. Heads up, the opening range on this is going to be huge — don't size like it's a normal day.", 'neutral'),
        ev(592, WIRE, TAPE, 'ORVX EXTENDS GAINS — TRADERS CITE SHORT COVERING AFTER GUIDANCE RAISE', 'neutral'),
        ev(600, DESK, PRIYA, "It's holding the opening range high. That's usually the tell on gap days — the ones that fail give it back in the first twenty minutes.", 'neutral'),
        ev(618, WIRE, TAPE, 'ORVX: MORGAN KEEGAN RAISES TARGET TO 215 FROM 176, REITERATES BUY', 'neutral'),
        ev(637, DESK, PRIYA, "First real pullback. Watch whether it holds VWAP — that's the line that matters on a day like this.", 'neutral'),
        ev(670, RISK, MARCUS, "Marcus. Just noting the flush — 1.3% off the highs in six minutes. If you're long and you're still long, that's a choice. Make sure it's a choice.", 'warn'),
        ev(682, WIRE, TAPE, 'ORVX FINDS SUPPORT AFTER 1.3% PULLBACK — DIP BUYERS STEP IN ABOVE VWAP', 'neutral'),
        ev(750, PM,   DANA, "Midday. This thing has held every pullback so far. If you're flat right now I want to understand why.", 'pressure'),
        ev(840, WIRE, TAPE, 'ORVX: THREE MORE FIRMS RAISE PRICE TARGETS; AVERAGE NOW 208', 'neutral'),
        ev(900, PM,   DANA, "We're a few cents off the high of the day with an hour left. What's your plan into the close? 'Hold and hope' is not a plan.", 'pressure'),
        ev(945, DESK, PRIYA, "Closing imbalance is showing buy-side. Could be a strong finish.", 'neutral'),
        ev(955, RISK, MARCUS, "Five minutes. Anything still open gets flattened at 15:58, and I promise you my fill will be worse than yours.", 'warn'),
    ],
}

# ---------------------------------------------------------------------------
# SESSION 2 — HLDN. Real tape: rips +2.6% into 10:08, then collapses -4.5% to
# the 11:28 low, then grinds all the way back to close EXACTLY at the open.
# This is the day that punishes whatever you learned on day one.
# ---------------------------------------------------------------------------
DAY2 = {
    'src_ticker': 'TSLA', 'src_date': '2026-08-14',
    'ticker': 'HLDN', 'company': 'Halden Motors',
    'sector': 'Electric vehicles / advanced manufacturing',
    'base': 212.00,
    'brief': {
        'headline': ('No company news overnight. A widely-followed industry blog posted late '
                     'yesterday claiming Halden is tracking "meaningfully ahead" on Q3 '
                     'deliveries; the company has not commented. Two sell-side desks have '
                     'flagged the report as unverified. Pre-market volume is unremarkable.'),
        'bullCase': ('If the delivery number is real, consensus is far too low and this gets '
                     're-rated. The stock has based for three weeks and any confirmation '
                     'squeezes a large short base.'),
        'bearCase': ('It is an unsourced blog post. The stock is up on a rumour into a tape '
                     'with no confirmation, which is how you get a violent reversal the moment '
                     'anyone credible pushes back. There is no earnings, no filing, no '
                     'catalyst you can actually underwrite.'),
        'pmAsk': ('Careful today. Rumour-driven tape with no confirmation is where people give '
                  'back a week of work in an hour. I would rather you traded small and stayed '
                  'sane than caught the move. Tell me your invalidation level before you put '
                  'anything on.'),
    },
    'events': [
        ev(571, WIRE, TAPE, 'HLDN OPENS 213.41, +0.7% — DELIVERY REPORT STILL UNCONFIRMED', 'neutral'),
        ev(575, PM,   DANA, "Same ask as always: level, invalidation, size. Before the trade.", 'pressure'),
        ev(586, WIRE, TAPE, 'HLDN EXTENDS — SECOND OUTLET SAYS IT HAS "CORROBORATED" DELIVERY FIGURES', 'neutral'),
        ev(597, DESK, PRIYA, "This is moving well. Just remember nobody has actually seen a number yet.", 'neutral'),
        ev(612, WIRE, TAPE, 'HLDN: ARDEN CAPITAL DOWNGRADES TO NEUTRAL, CALLS DELIVERY REPORT "UNSUPPORTED"', 'alarm'),
        ev(616, DESK, PRIYA, "There it is. That downgrade hit right on the high.", 'warn'),
        ev(642, RISK, MARCUS, "Marcus. This is now a 2% round trip in half an hour. If you're long from the highs, tell me your stop. Out loud.", 'warn'),
        ev(662, WIRE, TAPE, 'HLDN ACCELERATES LOWER — DOWN 3.1% FROM SESSION HIGH ON HEAVY VOLUME', 'alarm'),
        ev(682, DESK, PRIYA, "Feels like capitulation down here. Feels. I've been wrong about that plenty.", 'neutral'),
        ev(692, WIRE, TAPE, 'HLDN: COMPANY SPOKESPERSON DECLINES TO COMMENT ON DELIVERY SPECULATION', 'neutral'),
        ev(732, WIRE, TAPE, 'HLDN RECOVERS OFF SESSION LOW AS SELLING PRESSURE ABATES', 'neutral'),
        ev(750, PM,   DANA, "Midday. This has been a two-way wood chipper. Show me your P&L and your trade count — I'm more worried about the second number.", 'pressure'),
        ev(810, PM,   DANA, "We're back to roughly unchanged on the day. This is a nothing tape. The discipline now is not manufacturing a trade out of boredom.", 'pressure'),
        ev(870, DESK, PRIYA, "Dead. Absolutely dead. I'm getting coffee, want anything?", 'neutral'),
        ev(930, WIRE, TAPE, 'HLDN TRADES BACK TO UNCHANGED — SESSION RANGE 4.6%, VOLUME 1.4x AVERAGE', 'neutral'),
        ev(945, RISK, MARCUS, "Fifteen minutes. Let's not be heroes into the bell.", 'warn'),
    ],
}

# ---------------------------------------------------------------------------
# SESSION 3 — CYNT. Real tape: high in the first two minutes, then a relentless
# grind lower all session with no meaningful bounce, low of day at 15:55.
# Every dip-buy loses. Traded with two sessions of P&L baggage already on you.
# ---------------------------------------------------------------------------
DAY3 = {
    'src_ticker': 'PLTR', 'src_date': '2026-08-14',
    'ticker': 'CYNT', 'company': 'Cynthara Labs',
    'sector': 'AI infrastructure / data platform',
    'base': 166.00,
    'brief': {
        'headline': ('Cynthara announced a multi-year infrastructure partnership with a large '
                     'cloud provider at 06:40 this morning. No financial terms were disclosed. '
                     'The stock ticked up modestly on the release and has been quiet since. '
                     'Separately, a boutique research firm has a note scheduled for publication '
                     'today on revenue recognition across the AI-infrastructure group.'),
        'bullCase': ('A named partnership with a top-three cloud provider is real validation and '
                     'the kind of headline that attracts institutional sponsorship. The '
                     'no-terms-disclosed framing means the number could be large.'),
        'bearCase': ('"No financial terms disclosed" often means the terms are not impressive. '
                     'The stock barely responded to what should be good news, which tells you '
                     'something about who is on the other side. A tape that will not go up on '
                     'good news usually goes down.'),
        'pmAsk': ("You're two sessions in and I've seen how you trade. Today I care about one "
                  "thing: do you follow your own plan when your P&L is already coloured by the "
                  "last two days? Tell me your max loss for the session before the bell, and "
                  "then honour it."),
    },
    'events': [
        ev(571, WIRE, TAPE, 'CYNT OPENS 166.48, +0.3% ON CLOUD PARTNERSHIP HEADLINE', 'neutral'),
        ev(576, DESK, PRIYA, "Odd. Partnership headline and it's barely green. Good news it won't go up on — that's not a great sign.", 'neutral'),
        ev(590, WIRE, TAPE, 'CYNT GIVES BACK OPENING GAINS — PARTNERSHIP TERMS NOT DISCLOSED', 'neutral'),
        ev(602, WIRE, TAPE, 'MERIDIAN RESEARCH: "AI INFRASTRUCTURE REVENUE QUALITY IS DETERIORATING" — CYNT NAMED', 'alarm'),
        ev(610, DESK, PRIYA, "That Meridian note is getting passed around fast. Everyone's reading it.", 'warn'),
        ev(634, DESK, PRIYA, "No bid in this. Every bounce is getting sold within two minutes.", 'warn'),
        ev(663, PM,   DANA, "Observation, not instruction: this has not had a single bounce that held all morning. If you're buying dips, you are fighting the only trend on the screen.", 'pressure'),
        ev(700, WIRE, TAPE, 'CYNT UNDERPERFORMS SECTOR — DOWN 0.9% AS PEERS TRADE FLAT', 'neutral'),
        ev(750, PM,   DANA, "Midday check. Two things: your number, and whether you've taken a single trade today that you planned before the bell.", 'pressure'),
        ev(796, PM,   DANA, "Still no bounce. Six hours of one-way tape. At some point the absence of a bounce IS the information.", 'pressure'),
        ev(870, RISK, MARCUS, "Marcus. You're three sessions in. Whatever your P&L is across the week, it does not get to influence your size in the last hour. That's the rule that saves careers.", 'warn'),
        ev(930, WIRE, TAPE, 'CYNT PRESSES TO SESSION LOWS INTO THE FINAL HOUR', 'alarm'),
        ev(952, WIRE, TAPE, 'CYNT CLOSING ON THE LOW OF THE SESSION — DOWN 2.6%', 'alarm'),
        ev(955, RISK, MARCUS, "Five minutes. Flatten up.", 'warn'),
    ],
}


def main():
    days = [build_session(c, i + 1) for i, c in enumerate([DAY1, DAY2, DAY3])]

    for d in days:
        rth = [b for b in d['bars'] if b['rth']]
        hi  = max(b['h'] for b in rth); lo = min(b['l'] for b in rth)
        o, c = rth[0]['o'], rth[-1]['c']
        print(f"{d['ticker']}  pc {d['prevClose']:.2f}  open {o:.2f}  "
              f"H {hi:.2f}  L {lo:.2f}  close {c:.2f}  "
              f"net {(c-o)/o*100:+.2f}%  range {(hi-lo)/o*100:.2f}%  "
              f"bars {len(d['bars'])} ({len(rth)} rth)  events {len(d['events'])}")

    # sanity: no event may reference a minute outside the session
    for d in days:
        for e in d['events']:
            assert PRE_START_M <= e['m'] <= RTH_CLOSE_M + 1, (d['ticker'], e)

    banner = ('/* GENERATED by tools/build_data.py — do not hand-edit.\n'
              '   Bars are real 1-minute market data, rebased and anonymized.\n'
              '   No lookahead: nothing in this file tells you what happens next. */\n')
    with open(OUT, 'w') as f:
        f.write(banner)
        f.write('window.SIM_DAYS = ')
        json.dump(days, f, separators=(',', ':'))
        f.write(';\n')

    print(f'\nwrote {OUT} ({os.path.getsize(OUT)/1024:.0f} KB)')


if __name__ == '__main__':
    main()
