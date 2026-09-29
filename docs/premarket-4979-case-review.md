# 4979 case review — 2026-09-27

Scope: user case and existing cached FinMind source comparison, not live acceptance or a profitability backtest. No sends, deployment, runtime or database writes.

User case: 2026-09-23 OHLC 612/613/583/590, reported cost 597, 2026-09-24 trial 581. The shared B price candidate matches: trial below prior low and 2.6801% below reported cost. Case-specific 4% projection is 557.76; reported observation levels 558/569 remain user references, not verified historical support or automatic long entries.

Existing source: `opening-limit-order-0850-static-sources-20260924.json`, SHA256 `ee445adae4f2cf281844e883a6cbb25bd31b80d921b2d7c5b1a92acf8e97d3c8`.

Under the confirmed first-positive-net-buy broker BUY VWAP formula, broker 1440 (美林證券) has net buy 184000, buy volume 331000 and buy amount 195438000. Cost is **590.4471299093656**, not 597. Trial 581 is only about **1.600%** below this cost, failing the 2% break-low exception. OHLC matches the reported values. The trial remains user-provided, not verified 08:59 evidence.

Daily score is **4/12**: RSI declining, MACD histogram declining, foreign net selling and trust net selling. KD K declines 69.216327→62.528399, but D rises 58.390208→59.769605, so the confirmed both-decline rule does not score KD down. All calculations use the existing daily adapter, not altered thresholds.

The original reported-cost case matches B; the cached-source case does not match the B price exception. Both remain NO_TRADE in case-review mode. Unconfirmed vetoes, trial provenance and formal acceptance remain blocking. This comparison does not conclude that the stock cannot decline; it shows the agreed rule is not satisfied by this source.
