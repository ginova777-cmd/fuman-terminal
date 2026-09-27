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

`node scripts/verify-telegram-three-detectors.js --contract`: 25 suites.
All delivery tests inject mock HTTP; no Telegram/LINE sends.
Source audit and four-stock local UI evidence are in the task workspace under
`outputs/autodetect-goal/`. This source branch has not been deployed.

## Still required

- Natural plan producer, authoritative source coverage, 08:59 freeze/readback
  and schedule integration; no hand-authored plan or user trial substitution.
- Decide deferred rules only when user provides confirmation; preserve explicit
  blockers meanwhile. Do not turn a candidate into an approved direction.
- Natural fixed-direction handoff still needs acceptance. The 3055 research
  replay now uses actual detector baselines: 09:08 and 09:09 volume triggers,
  same-bar P4 touch, 09:10 KD cross, and 09:11 confirmation. Mock acknowledgement
  cooldown suppresses the second event. This does not prove live arrival or send.
- Durable remote publication, full rendered production surfaces and natural
  trading-day receipt. The user-authorized production entry backup/restore is
  finished; release-root authority and the publish gate passed on 2026-09-27.
- Notification delivery remains paused at the user's request; delivery acceptance
  and tri-surface acceptance must be reported separately.

The canonical runner also dispatches `--premarket-plan` to the new producer.
With `--collect-runtime --output=<attempt-dir>`, it reads the existing static
snapshot and quote cache itself, combines the required cached calendar years,
and reads the separately verified `data/telegram-detectors/<date>/universe.json`.
The source capture and hashes are retained with the attempt. Missing calendar,
universe or trial evidence remains blocking; an empty/missing source is not a
healthy zero-result scan. Scheduler installation remains pending release.
Explicit `--as-of` always means replay. An actual clock outside 08:59 does not
invent a freeze timestamp. The producer writes uniquely named attempt artifacts,
checks their readback hashes, and exits 2 for blocked plans. No accepted runtime
plan is replaced until source, universe and deferred rules can be verified.
Current saved source has 386 symbols with no authoritative exchange universe;
it cannot establish the required full-market coverage. A 386-row replay emitted
the consumer plan schema with none of the blocked directions promoted to live.

The earlier frozen PR296 branch was not modified. This branch starts from the
subsequent local 4979 case commit. An unrelated dirty prewarm PowerShell file is
excluded from this work.

## Trial-price publication and calendar scope

The existing natural preopen source writer now invokes the trial-price publisher.
Only same-day 08:45-08:59 validation payloads can publish; pinned readback must
match before latest is written, and empty trial results preserve the prior latest.
No notification or order is sent. Formal direction plans remain blocked and are
not silently replaced by a validation view.

Current-session calendar proof is separate from historical continuity. The
collector reads the current year, plus the previous year only at a year boundary
when needed to prove T-1. Compensatory holidays and existing terminal market
overrides are honored. Older uncovered history is a visible warning; proven gaps
inside calendar coverage still block direction candidates.

PR #297 carries this integration. Local three-route component rendering passed
after the calendar fix, with identical run ID and row hash; unrelated page scripts
were disabled, so production rendering and DB readback remain unverified.
