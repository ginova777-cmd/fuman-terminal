# Public Slot Shared Source Speed Profile

Purpose: use one conservative shared source for terminal display, AI, heatmap, realtime radar, and other shared consumers. Faster day-trading water must use a separate dedicated source and must not borrow speed, quota, tables, or readiness claims from this shared display source.

## Baseline Speed

| Item | Value | Owner / Reason |
| --- | --- | --- |
| Shared source task start | 06:00 | Start stable warmup before preopen. Task name may remain legacy `0800` until schedule naming is migrated. |
| Loop seconds | 10 | Display/AI source heartbeat, not strategy scanning cadence. |
| REST quote batch | 10 symbols | Conservative shared-source fill. |
| REST quote every | 20 seconds | Avoid full-market REST pressure. |
| REST quote delay | 2000 ms | No 75 ms burst. |
| REST quote budget | 10 seconds | Quote writer must not be blocked by a long REST pass. |
| Fugle collector batch | 20 symbols | Stable baseline after observed 429 risk. |
| Fugle collector concurrency | 1 | Single writer pressure path. |
| Fugle collector delay | 4000 ms | Conservative no-burst default. |
| Fugle collector adaptive rpm | 20 / 10 / 40 | Initial / min / max. |
| Fugle 429 budget | 1 per 15 minutes | Any repeated 429 enters protective slowdown. |
| Fugle 429 cooldown | 180 seconds, max 900 seconds | Exponential cooldown is already in collector logic. |
| Priority-only after 429 | 600 seconds | After 429, focus priority pool instead of full market. |
| Direct 1m batch / cadence | 2 symbols / 60 seconds | Low-priority; never blocks quote writer. |
| Direct 1m prewarm | 06:00, 300 symbols, batch 4, 200 bars, 8s budget | Warm historical continuity before strategies read. |
| Futopt quote | batch 20, every 60s, 500ms delay, 10s budget, full detect enabled | Enough for mapping evidence without quote-source burst. |
| Supabase upsert | <= 300 rows per batch, timeout 45s | Avoid write congestion. |

## Priority Policy

1. Terminal-visible symbols and strategy-used symbols first.
2. Stock-future mapped underlyings before general market fill.
3. Realtime radar, heatmap / AI hot pool, warrant underlyings, CB underlyings, institution/chip candidates.
4. Full mother pool only by rolling refresh.

## Acceptance Conditions

This profile is only a code/readiness proposal until runtime and production evidence exist.

YES can only be discussed after:

- `last429At` does not update for 15-30 minutes.
- `cooldown=false`.
- `priority_symbols > 0` before 08:45.
- `futopt_stock_mapped > 0` and stock-future quote loop has rows by 08:45.
- `/api/heatmap` returns `ok=true`, `fallbackUsed=false`.
- `/api/market-ai-live` has `heatmapUsable=true` and `sourceIssues=[]`.
- Watchdog does not restart writer repeatedly.
- Seven-strategy readers stay read-only and do not start writers or bulk fallback.
## Non-Goals

- This is not a full-market 1500-symbol / 120-second freshness guarantee.
- This does not make degraded shared source look healthy.
- This does not authorize scanner, snapshot writer, receipt writer, or production deploy by itself.
- Day-trading speed is handled by a separate dedicated source profile and report, not by accelerating this shared source.
