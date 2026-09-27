# Telegram automatic detection integration — work in progress

The five-part goal remains open: broker data, scenario classification, natural
08:59 direction handoff, complete event delivery chain, production/natural-day
tri-surface acceptance. Tests below do not establish formal completion.

## Implemented in this branch

- Select the first positive NET-buy broker; display its BUY volume, sell volume,
  net volume and buy VWAP. Compare BUY shares to each institution's NET shares;
  units are explicit (1000 shares per lot). Nonpositive/missing denominators do
  not produce a percentage. No ownership or overnight-trader identity inference.
- Independent B break-low, A divergence and A upper-shadow rebound assessments
  expose matched / not_matched / insufficient_data. The rebound screen is only
  a structural candidate; long-wick, large-buy and near-cost thresholds remain
  undefined and cannot grant eligibility. Bollinger position does not score.
- Source audit uses actual source OHLC, not user example OHLC. Original 3055
  example remains separately preserved; provider-backed audit matches the new
  structural candidate with a 70.7317% numerical comparison to foreign NET buys.
- Shared desktop/mobile/88 validation component renders broker comparison and
  all assessments. Local rendered component verification checks visible fields
  and identical run ID/hash; it does not verify production page integration.
- Live runner now requires a same-day frozen premarket plan. The gate checks
  direction before level evaluation and independently recomputes the same plan
  in its proof. Missing plans block even when no raw events occur.
- Cooldown is per date, stock, detector, direction and target. Only acknowledged
  messages persist a 180-second cooldown. Tiers 3/5/8 permit upgrades; same/lower
  tiers suppress. Per-event acknowledgements retain idempotency. Suppression
  carries prior acknowledgement evidence and is not counted as a new message.
- Delivery pipeline defaults notifications to paused. Tests explicitly enable
  injected mock delivery. Production runner does not override this pause.

## Evidence

`node scripts/verify-telegram-three-detectors.js --contract`: 21 suites.
All delivery tests inject mock HTTP; no Telegram/LINE sends.
Source audit and four-stock local UI evidence are in the task workspace under
`outputs/autodetect-goal/`. This source branch has not been deployed.

## Still required

- Natural plan producer, authoritative source coverage, 08:59 freeze/readback
  and schedule integration; no hand-authored plan or user trial substitution.
- Decide deferred rules only when user provides confirmation; preserve explicit
  blockers meanwhile. Do not turn a candidate into an approved direction.
- Complete real-data detector-baseline replay, including fixed direction and
  trigger -> touch -> cross timing; existing 3055 research only proves level/cross.
- Durable remote publication, full rendered production surfaces and natural
  trading-day receipt. Production-root dirty entry currently blocks release.
- Notification delivery remains paused at the user's request; delivery acceptance
  and tri-surface acceptance must be reported separately.

The earlier frozen PR296 branch was not modified. This branch starts from the
subsequent local 4979 case commit. An unrelated dirty prewarm PowerShell file is
excluded from this work.
