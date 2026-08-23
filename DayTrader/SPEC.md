# DAY TRADER SIM — INTERFACE SPEC (the contract)

A browser-based day-trading simulator. Three sequential sessions, one account
that carries P&L across all three, a live "desk" (PM, risk manager, colleague,
news wire) that reacts to the player.

Runs from `file://` by double-clicking `index.html`. **No build step, no npm, no
CDN, no fetch()** — everything loads via plain `<script src>` tags. Vanilla JS
only. ES5-compatible syntax is not required; modern browser JS is fine, but do
NOT use ES modules (`import`/`export`) — `file://` blocks them. Every file
attaches to a global namespace object.

Load order in `index.html`:

```html
<script src="data/days.js"></script>     <!-- window.SIM_DAYS -->
<script src="sim/engine.js"></script>    <!-- window.Engine -->
<script src="sim/chart.js"></script>     <!-- window.Chart -->
<script src="sim/desk.js"></script>      <!-- window.Desk -->
<script src="sim/ui.js"></script>        <!-- boots everything -->
```

---

## 1. DATA SCHEMA — `data/days.js` (built by me, assume it exists)

```js
window.SIM_DAYS = [ Day, Day, Day ];   // index 0,1,2 = session 1,2,3
```

```js
Day = {
  id:        "day1",
  ticker:    "ORVX",              // anonymized
  company:   "Orvex Dynamics",
  sector:    "Enterprise software / defense analytics",
  sessionNo: 1,
  prevClose: 178.40,              // float, 2dp
  openM:     570,                 // 09:30 in minutes-since-ET-midnight
  closeM:    960,                 // 16:00
  bars:      [ Bar, ... ],        // pre-market bars FIRST, then RTH bars
  premkt: {                       // pre-market context, shown on briefing screen
    high: 182.10, low: 176.90, last: 181.55, volume: 1840000,
    gapPct: +1.77
  },
  brief: {                        // shown on the 08:45 briefing screen
    headline:  "...",             // the overnight story
    bullCase:  "...",
    bearCase:  "...",
    levels:    [ {label:"Prev close", px:178.40}, {label:"Pre-mkt high", px:182.10}, ... ],
    pmAsk:     "..."              // what the PM wants from you today
  },
  events:    [ Event, ... ]       // desk feed, see §4
}
```

```js
Bar = {
  m: 571,        // minutes since ET midnight. 570 = 09:30, 959 = 15:59
  t: "09:31",    // display string
  o: 181.22, h: 181.90, l: 180.95, c: 181.60,
  v: 412300,     // share volume
  rth: true      // false for pre-market bars
}
```

Bars are 1-minute, contiguous within RTH (390 bars, m=570..959). Pre-market bars
may be sparse. **Prices are real market data, rebased; nobody may look ahead.**

---

## 2. `sim/engine.js` — `window.Engine`

Pure logic. **No DOM access whatsoever.** Owns the clock, the book, the money,
and the risk rules.

### Constants (export as `Engine.RULES`)

```js
{
  startEquity:    25000,     // session 1 only; later sessions inherit
  leverage:       4,         // intraday buying power = equity * 4
  maxDailyLoss:   -1500,     // hit it -> risk flattens you and locks the day
  warnDailyLoss:  -900,      // soft warning
  noNewAfterM:    955,       // 15:55 no new/increasing positions
  forceFlatM:     958,       // 15:58 risk flattens whatever is left
  commissionPerShare: 0.005, // each side, min $1.00 per fill
  minCommission:  1.00
}
```

### Lifecycle

```js
Engine.init({ day: Day, account: Account|null })   // account null => fresh $25k
Engine.start()          // begin replay from the open
Engine.pause() / Engine.resume()
Engine.setSpeed(mult)   // 30 | 60 | 120 | 240. bar interval ms = 60000/mult
Engine.step()           // advance exactly one bar (works while paused)
Engine.destroy()
```

### State — `Engine.getState()` returns a fresh object

```js
{
  m: 634, bar: Bar, idx: 64,          // idx = index into day.bars of current bar
  running: true, locked: false,       // locked = risk pulled your card
  position: { shares: 300, avgPx: 181.44 },   // shares <0 = short, 0 = flat
  realized: -215.50,                  // today, after commissions
  unrealized: +48.00,
  dayPnl: -167.50,                    // realized + unrealized
  commissions: 12.00,
  equity: 24832.50,                   // startEquity + carried + dayPnl
  buyingPower: 99330.00,
  exposure: 54432.00,                 // abs(shares) * price
  blotter: [ Fill, ... ],
  trades: [ Trade, ... ],             // closed round-trips
  stats: { nTrades: 6, wins: 2, losses: 4, biggestWin: 210, biggestLoss: -430,
           maxDrawdown: -520, peakDayPnl: 180 }
}
```

```js
Fill  = { id, m, t, side:"BUY"|"SELL", qty, px, notional, commission,
          thesis:"...", reason:"MANUAL"|"STOP"|"TARGET"|"RISK_FLAT"|"EOD_FLAT" }
Trade = { openM, closeM, side:"LONG"|"SHORT", qty, entryPx, exitPx,
          pnl, holdMins, thesis, exitReason }
```

### Orders

```js
Engine.submit({
  side: "BUY"|"SELL",
  qty: 100,
  type: "MKT"|"LMT"|"STP",
  px: 181.50,          // required for LMT/STP
  thesis: "..."        // REQUIRED when the order opens or increases a position
}) -> { ok:true, order } | { ok:false, error:"..." }

Engine.cancel(orderId)
Engine.getWorking()    // -> [Order, ...] resting LMT/STP orders
Engine.flatten(reason) // market-close the whole position
```

Rejection reasons that MUST be enforced (return `ok:false` with a human message):
- `"Thesis required"` — opening/increasing without a thesis string of >= 10 chars
- `"Exceeds buying power"` — resulting exposure > equity * leverage
- `"Trading locked — you hit the daily loss limit"`
- `"No new positions after 15:55"` — increasing exposure when `m >= 955`
- `"Market closed"`

### Fill model (this is what makes it feel real — do not simplify)

A market order submitted during bar `i` fills on bar `i+1`:

```
half_spread = max(0.01, px * 0.00015)
size_impact = px * 0.00012 * min(4, qty / max(1, bar.v * 0.015))
fill = nextBar.o + dir*(half_spread + size_impact)     // dir = +1 buy, -1 sell
```
Clamp the fill into `[nextBar.l, nextBar.h]`.

- **LMT**: fills on the next bar only if `nextBar.l <= px` (buy) / `nextBar.h >= px`
  (sell); fill price = `px`. Rests until filled or cancelled.
- **STP**: triggers when `nextBar.h >= px` (buy stop) / `nextBar.l <= px` (sell
  stop), then fills as a market order **with double the slippage** (stops get
  worse fills — that lesson matters).
- Commission both sides: `max(1.00, 0.005 * qty)`.

### Risk enforcement, checked every tick

1. `dayPnl <= warnDailyLoss` → emit `risk` event, once.
2. `dayPnl <= maxDailyLoss` → `Engine.flatten("RISK_FLAT")`, set `locked=true`,
   emit `risk` event with `hard:true`. No further orders accepted.
3. `m >= forceFlatM` and position != 0 → `flatten("EOD_FLAT")`.
4. At `m > closeM` → emit `close` event with the day's summary.

### Events

```js
Engine.on("tick",  fn(state))
Engine.on("fill",  fn(fill, state))
Engine.on("risk",  fn({ level:"warn"|"hard", message, state }))
Engine.on("close", fn(summary))
Engine.on("reject",fn({error, order}))
```

### Account persistence

```js
Engine.loadAccount()    // localStorage key "dts.account.v1"
Engine.saveAccount(dayResult)
```
```js
Account = {
  equity: 24310.00,
  sessions: [ { sessionNo, ticker, dayPnl, nTrades, wins, losses,
                maxDrawdown, endEquity, locked, blotter:[Fill,...],
                trades:[Trade,...], notes:"" } ]
}
```

`Engine.exportReview()` returns a **markdown string** — the end-of-day tearsheet
the player pastes into chat for the P&L review. It must include: every trade
(entry/exit time, side, size, price, P&L, hold time, the thesis as typed, exit
reason), the day's stat line, the equity curve as a list of (time, dayPnl)
samples every 15 minutes, and any risk events.

---

## 3. `sim/chart.js` — `window.Chart`

Canvas candlestick renderer. Pure drawing, no state of its own beyond the
instance.

```js
var chart = Chart.create(canvasEl, { theme: "dark" });
chart.render({
  bars: day.bars,        // full array
  upto: idx,             // draw bars[0..idx]; NOTHING beyond idx (no lookahead!)
  window: 120,           // how many bars visible (trailing)
  overlays: ["vwap", "ema9", "ema20"],
  levels: [ {px:178.40, label:"PC", color:"#666"}, ... ],
  markers: [ {m:612, px:181.20, side:"BUY", qty:200}, ... ],   // fills
  position: { shares: 300, avgPx: 181.44 }   // draws the avg-price line
});
chart.resize();
```

Requirements:
- Candles: green/red bodies, wicks, sensible width for the bar count.
- Pre-market bars drawn dimmed, separated by a vertical line at the open.
- Volume histogram in a bottom pane (~22% of height).
- VWAP (from RTH open, volume-weighted), EMA9, EMA20 as lines with a legend.
- Price axis right side, time axis bottom (label every 30 min).
- Buy markers = green up triangle below the bar, sell = red down triangle above.
- Avg-price line: dashed, cyan, labelled with unrealized P&L.
- Crosshair on mousemove with a price/time readout.
- **Absolutely must not draw any bar with index > `upto`.** This is the whole
  integrity of the exercise.
- Must look good on a dark terminal-ish theme. Monospace fonts throughout.
- Handle HiDPI (devicePixelRatio) so it isn't blurry.

---

## 4. `sim/desk.js` — `window.Desk`

The desk feed: scheduled + reactive messages from four voices. This is what
makes it feel like a job rather than a chart game.

```js
Desk.init({ day: Day, engine: Engine, onMessage: fn(msg) });
Desk.tick(state);      // called by ui.js on every engine tick
Desk.getFeed();        // -> [msg,...] everything so far
```

```js
Msg = {
  m: 634, t: "10:34",
  from: "PM"|"RISK"|"DESK"|"WIRE",   // WIRE = news headline
  name: "Dana Whitfield",            // PM's name; RISK = "Marcus Reed";
                                     // DESK = "Priya (equities desk)"
  text: "...",
  tone: "neutral"|"pressure"|"warn"|"praise"|"alarm"
}
```

### Two sources of messages

**a) Scheduled** — `day.events[]` from the data file, fired when `state.m` reaches
`event.m`. These are pre-authored (news wire headlines, PM check-ins).

**b) Reactive** — generated by `Desk` from engine state. Implement all of these,
each firing at most once unless noted:

| Trigger | Voice | Gist |
|---|---|---|
| exposure > 80% of buying power | RISK | "You're at X% of your line. Tell me the plan." |
| dayPnl <= -900 | RISK | warning shot, names the number |
| dayPnl <= -1500 | RISK | "You're done. I'm flattening you." (alarm) |
| 4+ round trips before 10:30 | DESK | colleague needles you about overtrading |
| position held > 45 min underwater | PM | "What's the thesis now? It's changed." |
| a winner given back >60% from peak | PM | "You were up $X on that. What happened?" |
| flat for 60+ consecutive minutes mid-session | PM | "You're not paid to watch." |
| first profitable close-out of the day | DESK | brief praise |
| 3 consecutive losers | PM | "Stop. Walk to the window. Then tell me the plan." |
| size increased right after a loss (revenge) | RISK | calls it out by name |
| any single trade P&L > +$400 | DESK | "Nice. What was the read?" |
| 15:45, still holding | RISK | "Twelve minutes. Don't make me do it." |

Fire reactive messages at most one per bar; queue the rest.

### Gates — the clock pauses and the player must go to chat

```js
Desk.GATES = [
  { m: 570, id:"open",    title:"Pitch your plan",
    prompt:"Before the bell: post your plan to your PM in chat." },
  { m: 720, id:"midday",  title:"Midday risk check",
    prompt:"Marcus wants your book, your P&L, and what you're doing about it." },
  { m: 961, id:"close",   title:"P&L review",
    prompt:"Paste your tearsheet into chat. Dana will go trade by trade." }
];
```
`ui.js` renders a modal for these; `Desk` just owns the definitions and fires
`onMessage` with the gate prompt.

Tone guidance: these people are professionals, not cartoons. Terse, specific,
numerate. The PM (Dana) is demanding but fair and asks about *reasoning*. Risk
(Marcus) is unsentimental and cares only about size and loss. The colleague
(Priya) is warm and human and occasionally distracting — she is the thing that
makes it feel like a floor.

---

## 5. `index.html` + `sim/ui.js` + `sim/ui.css`

Screens, in order:

1. **Session select** — shows account equity, which sessions are done and their
   P&L, and a "Start Session N" button. Warn before resetting the account.
2. **Briefing** (pre-open) — `day.brief`, the pre-market stats, key levels, the
   pre-market chart, and the PM's ask. A "Ring the bell" button.
3. **Trading floor** — the main screen:
   - Header: clock (big, `09:41:00` ET), session no., ticker, speed control,
     pause/step, day P&L (big, green/red), equity, buying power.
   - Chart (dominant, left ~65%).
   - Order ticket: side buttons, qty (with +100/+500 quick buttons and a
     "max" that respects buying power), order type, price, **thesis box**,
     submit. Keyboard: `B`/`S` focus buy/sell, `Enter` submits, `F` flatten.
   - Position panel: shares, avg, unrealized, day P&L, exposure, % of line.
   - Working orders list with cancel buttons.
   - Blotter (scrolling, newest first).
   - **Desk feed** — right column, chat-like, colour-coded per voice, auto-scroll.
     This should be visually prominent. It is half the point of the product.
4. **Gate modal** — pauses the clock, shows the prompt, "I've posted it, continue".
5. **Close-out** — the tearsheet, the stat line, a copy-to-clipboard button for
   the markdown review, and "Save & return to session select".

Design: dark, monospace, terminal-adjacent — think a Bloomberg terminal that a
tasteful person redesigned. Dense but not cramped. Numbers right-aligned and
tabular (`font-variant-numeric: tabular-nums`). Green `#3fb950`, red `#f85149`,
amber `#d29922`, bg `#0d1117`, panel `#161b22`, border `#30363d`, text `#c9d1d9`,
dim `#8b949e`, accent cyan `#39c5cf`.

Must work at 1440×900 without scrolling the main floor screen.

---

## 6. NON-NEGOTIABLES

- No lookahead anywhere in the UI. Never render or leak a future bar.
- The thesis box is mandatory on entries. It is the single most important
  learning device in the whole thing.
- The account carries across the three sessions. Day 2 must be traded with
  Day 1's damage in mind.
- Everything runs offline from `file://`.
