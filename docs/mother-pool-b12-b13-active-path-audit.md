# B12 / B13 active Writer path audit

Candidate source inspection, 2026-09-17. Not a deployment or natural receipt.

`scripts/run-daytrade-source-writer.js::writeIntradayBurstTelegramOutbox`
still constructs events using `rolling_1m_prior_high_close`,
`rolling_1m_baseline_volume` and `rolling_1m_baseline_sample_count`.
It rejects `rolling_1m_samples_below_60` and emits
`price_breakout_1pct` / `volume_burst_rolling60_x2`.
This is not the latest dual-baseline detector contract.

Additional source-integrity hazards in that path:

- `latest1mTime` falls back to `checkedAt` when all source candle timestamps are absent.
- `latest1mClose` falls back to quote price rather than requiring a completed candle close.
- quote freshness accepts positive cached flags and only an upper age comparison.
- baseline fields are selected from multiple envelopes rather than one immutable calculation input.

Existing newer calculation files are under `lib/telegram-detectors/`.
`natural-source-runner.cjs` calls volume/price/outside modules but is a separate
Telegram-oriented producer, not proof of Mother Pool Writer wiring. It consumes
retained candle history at `data/telegram-detectors/history/<symbol>.json` and
provider minute-side journals. Do not invoke its delivery pipeline as a shortcut
or claim that its files prove Mother Pool DB publication.

Required integration boundary: a Mother Pool source adapter must bind validated
completed candles, approved historical sessions, current canonical identity and
membership snapshot to the new calculations; publish the resulting evidence with
explicit contract/version; independently read back and recompute it. Then replace
the obsolete Mother Pool event producer through a reviewed change, keeping
notification delivery responsibility separate. No old event is relabeled as a new
formula result. Missing historical input remains a recorded gap.

Status: B12/B13 latest-contract Writer integration NOT COMPLETE. No production,
outbox, Telegram configuration or historical receipt was modified by this audit.
