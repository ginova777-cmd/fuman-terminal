# Dedicated Daytrade Source Speed Profile

Purpose: create a separate high-speed daytrade water lane so daytrade decisions can be faster without affecting terminal display, AI, heatmap, realtime radar, seven-strategy readers, or slower shared-source consumers.

This is a source contract and read-only report profile. It is not production evidence until a dedicated writer/runtime/source status exists and passes live checks.

## Isolation Rule

| Area | Dedicated daytrade source |
| --- | --- |
| Source status name | `fugle_daytrade_source` |
| Shared source status | Must not reuse `fugle_shared_source` for daytrade YES |
| Missing dedicated source | Grade `D` |
| Missing `daytrade_gate_grade` | Grade `D` |
| Fallback | Not allowed to fake normal readiness |
| Runtime / writer | Separate writer process only |
| API quota | Separate key or quota budget strongly preferred |
| Tables | Dedicated daytrade tables or clearly isolated read model before formal entry |
| Consumers | Daytrade, Strategy1, Strategy3 only |
| Non-consumers | AI, heatmap, terminal display, realtime radar, Strategy2/4/5/6/7 shared readers |
| Scanner behavior | Read-only; no Fugle fallback, no writer startup |

## Speed Target

| Metric | Target |
| --- | --- |
| Fresh quote window | 120 seconds |
| Full-market fresh quotes | >= 1500 is scorecard evidence, not the opening A gate |
| Full-market fresh quote coverage | >= 90% is scorecard evidence, not the opening A gate |
| Priority pool fresh coverage | >= 95% to allow A, target 100% |
| Selected symbols quote age | <= 60 seconds to allow A |
| Required speed | 12.5 symbols / second |
| Equivalent request math | about 750 symbols / minute |
| Batch 40 max interval | about 3.2 seconds |
| Quote age | <= 90 seconds, preferred <= 60 seconds |
| 1m freshness after 09:00 | <= 120 seconds, preferred <= 60 seconds |
| Priority symbols | > 0 before 08:45 |
| Stock futures mapping | > 0 before 08:45 when futures gate is used |

## Suggested Dedicated Speed

This speed is for a separate daytrade source only. It must not be applied to the shared display source.

This profile is not a guarantee that Fugle will never return 429. It is a starting contract that makes the writer slow down intelligently and keeps daytrade load isolated from the shared source.

| Item | Suggested value |
| --- | --- |
| Warmup start | 06:00 |
| Mother pool | Terminal-visible + daytrade candidate pool first |
| Quote collector batch | 40 symbols |
| Quote collector concurrency | 1 |
| Quote collector interval | start at about 3.2 seconds per 40-symbol batch |
| 429 cooldown | exponential; start 90s, cap 900s |
| 429 behavior | priority-only; pause full-market rolling for 1-3 minutes |
| FinMind 403 behavior | cooldown 30 minutes; no retry loop |
| Direct 1m | priority/hot only; must not block quote writer |
| Futopt | stock-future mapping complete by 08:45 |
| Backfill | low priority only |

## Two-Layer Speed Model

Do not force the whole 1660-symbol market to satisfy a hard 120-second freshness target during the opening if it causes 429. The formal model is priority-first:

| Layer | Scope | Speed | Goal |
| --- | --- | --- | --- |
| Priority pool | 300-500 symbols | batch 40, every 2.5-3.0 seconds | A gate source; ready before 09:00 and protected after 429 |
| Full market rolling | about 1660 symbols | batch 40, every 3.0-4.0 seconds | Scorecard only during opening; complete one round in 120-180 seconds; do not block priority pool |

Math check: 40 symbols / 3.2 seconds is 12.5 symbols per second. For about 1662 symbols, one full round is about 133 seconds. This is close to usable, not very comfortable. Slow Fugle response, network jitter, or 429 will drop coverage, so the priority pool must remain the formal daytrade gate.

## Priority-First A Gate

Opening A does not require full-market `fresh_quotes_120s >= 1500`. Full-market coverage is still reported, but it is nonblocking when the priority pool is healthy.

Minimum A conditions:

| Condition | Requirement |
| --- | --- |
| `gate_mode` | `priority_first` |
| `priority_pool_symbols` | >= 300 |
| `priority_fresh_quote_coverage_120s` | >= 0.95, target 1.00 |
| `selected_symbols_fresh_ok` | true |
| `quote_age_seconds` | <= 90 seconds globally; selected symbols should be <= 60 seconds |
| `cooldown_until` | not in the future |
| `last_429_age_seconds` | > 90 seconds |
| `scanner_can_run_opening` | true after 08:45 |
| `daily_volume_status` | ready after 08:30 |
| MA/futopt/1m | required only in their trading phases |

Full-market `fresh_quotes_120s`, `fresh_quote_coverage_120s`, and `full_market_round_seconds` remain in the scorecard so release owner can see whether the whole lane is catching up. They must not make the opening scanner pretend production-ready, and they must not steal quota from the priority pool.

## Required `source_status` Row

The dedicated writer must upsert exactly this source row:

| Field | Requirement |
| --- | --- |
| `source_name` | `fugle_daytrade_source` |
| `status` | `ok`, `degraded`, `stale`, `error`, or `stopped` |
| `updated_at` | Current writer heartbeat timestamp |
| `message` | Human-readable current state |
| `payload` | Object containing the required fields below |

Only `status = ok` can ever reach formal entry. Any missing row is `D`.

## Required `source_status.payload`

The dedicated writer must write these fields under `source_status.payload` for `source_name = fugle_daytrade_source`:

| Field | Purpose |
| --- | --- |
| `daytrade_gate_grade` | Writer-declared A/B/C/D gate. Missing or invalid is `D`. |
| `daytrade_source_speed_ok` | Writer-declared speed gate. `false` is `D`. |
| `fresh_quote_window_seconds` | Fresh quote window, expected 120. |
| `fresh_quotes_120s` | Fresh quotes inside the 120-second window. |
| `fresh_quote_coverage_120s` | Fresh coverage ratio. |
| `active_symbols` | Active mother-pool symbols. |
| `quote_age_seconds` | Latest quote age. |
| `required_quote_speed_per_sec` | Required speed, normally 12.5. |
| `actual_quote_speed_per_sec` | Measured speed. |
| `batch_size` | Current quote batch size. |
| `batch_interval_seconds` | Current batch interval. |
| `priority_symbols` | Priority symbols available to scanner. |
| `gate_mode` | Expected `priority_first`. Missing or different is `D`. |
| `priority_gate_grade` | Writer-declared priority pool A/B/C/D. |
| `full_market_gate_grade` | Writer-declared full-market A/B/C/D, scorecard only during opening. |
| `selected_symbols_fresh_ok` | Required true for A. |
| `eligible_quote_rows` | Eligible quote rows in current gate. |
| `scanner_can_run_opening` | Opening scanner gate. |
| `scanner_can_run_quote_only` | Quote-only scanner gate. |
| `daily_volume_status` | Daily volume readiness. |
| `avg_volume5_eligible` | Avg-volume eligible symbols. |
| `ready_ma20_continuous` | Continuous MA20 readiness. |
| `ready_ma35_continuous` | Continuous MA35 readiness. |
| `intraday_1m_stale_seconds` | 1m freshness after 09:00. |
| `today_1m_symbols` | Symbols with today's 1m rows. |
| `today_1m_rows` | Today's 1m row count. |
| `futopt_stock_mapped` | Stock-future mapping count. |
| `rate_limit_status` | Current rate-limit state. |
| `last_429_at` | Last 429 timestamp, nullable. |
| `last_429_age_seconds` | Last 429 age. <= 90 seconds blocks A. |
| `cooldown_until` | Active cooldown timestamp, nullable. |
| `quota_competing_stages` | Active competing quota users, such as direct1m, futopt, or preopen. |
| `self_heal_count` | Self-heal count. |
| `last_self_heal_at` | Last self-heal timestamp, nullable. |
| `last_self_heal_reason` | Last self-heal reason, nullable. |

The report also accepts two-layer operational fields for stricter opening evidence: `priority_pool_symbols`, `priority_fresh_quotes_120s`, `priority_fresh_quote_coverage_120s`, `full_market_round_seconds`, `full_market_batch_interval_seconds`, `full_market_paused_until`, `finmind_cooldown_until`, `last_429_age_seconds`, and `quota_competing_stages`.

## Scorecard Table Contract

Dedicated speed evidence should be written to:

```text
public.fugle_daytrade_source_speed_scorecard
```

Dedicated water tables:

```text
public.fugle_daytrade_priority_symbols
public.fugle_daytrade_quotes_live
public.fugle_daytrade_intraday_1m
public.fugle_daytrade_daily_volume_avg
public.fugle_daytrade_futopt_quotes_live
public.v_fugle_daytrade_priority_readiness
public.v_fugle_daytrade_source_latest_scorecard
public.v_fugle_daytrade_source_contract_health
```

SQL draft:

```text
ops/public-slot/DaytradeSourceDedicatedTables.sql
```

Minimum scorecard fields:

```text
checked_at
trade_date
source_name
gate_grade
status
fresh_quotes_120s
fresh_quote_coverage_120s
active_symbols
quote_age_seconds
required_quote_speed_per_sec
actual_quote_speed_per_sec
gate_mode
priority_gate_grade
full_market_gate_grade
priority_symbols
selected_symbols_fresh_ok
scanner_can_run_opening
daily_volume_status
ready_ma20_continuous
ready_ma35_continuous
intraday_1m_stale_seconds
futopt_stock_mapped
rate_limit_status
last_429_age_seconds
cooldown_until
quota_competing_stages
self_heal_count
message
```

Source-ready SQL draft:

```text
ops/public-slot/DaytradeSourceSpeedScorecard.sql
```

Release-owner bootstrap SQL:

```text
ops/public-slot/DaytradeSourceBootstrap.sql
```

Do not apply this SQL or write scorecard rows without release-owner approval.

## PS1 Scanner Contract

The scanner is a reader of this dedicated source. It must not become the water source.

| Item | Value |
| --- | --- |
| LoopSeconds | 5 |
| PrefilterCount | 180 |
| FastTrackCount | 40 |
| DeepScanCount | 60 |
| BarsPerSymbol | 80 |
| Formal entry | only when `gateGrade = A` |
| Source degraded | observation/display only |
| Fugle fallback | not allowed |
| Bulk fallback | not allowed |
| Writer startup | not allowed |

PS1 gate wiring:

1. Read `source_status where source_name = fugle_daytrade_source`.
2. If the source does not exist, return `D`.
3. If `status != ok`, return `D` or `C`; never formal entry.
4. If `payload.daytrade_gate_grade` is missing or invalid, return `D`.
5. If `gate_grade = A`, formal entry may be considered.
6. If `gate_grade = B`, observation only.
7. If `gate_grade = C` or `D`, display/hold only and no new formal signal.
8. Never use `fugle_shared_source` to decide daytrade production readiness.

## Phased Water Checks

| Phase | Dedicated daytrade source must prove |
| --- | --- |
| 06:00-08:29 | stock tickers, daily volume / avg5, historical 1m latest 200 bars, preopen history; scanners stay out. |
| 08:30-08:44 | preopen snapshot, priority symbols, daily volume ready, MA20/MA35 warmup ready. |
| 08:45-08:59 | opening boost active, priority pool first, fresh quote coverage >= 90%, scanner_can_run_opening=true. |
| 09:00-09:34 | quote-derived 1m each minute, direct 1m priority/hot only, backfill low priority, 1m stale <= 120s. |
| 09:35-13:30 | quote coverage >= 90%, 1m stale <= 120s, ready_ma35_continuous >= 1500, daily volume ready. |

## No-Interference Rule

1. Quote writer is the highest-priority stage.
2. Daily volume is premarket work; it must not block live quotes during trading.
3. 1m backfill is low priority and must not block live quotes.
4. Watchdog must have cooldown and must not restart repeatedly.
5. Only one dedicated daytrade writer is allowed.
6. PS1 readers only read Supabase and never repair by calling Fugle.

## Gate Grades

| Grade | Meaning |
| --- | --- |
| A | Formal daytrade entry may be considered. Priority pool is fresh enough, selected symbols are fresh, no active cooldown/recent 429, daily volume ready, MA20/MA35 ready, futopt mapped when needed, 1m fresh after 09:00. Full-market coverage is scorecard only during opening. |
| B | Observation only. Quote and MA are usable but one required source is slightly late. No formal entry. |
| C | Display only. Coverage insufficient. No formal entry. |
| D | Stop new signals. Source missing/stale/error, daily not ready, or quote coverage too low. |

## Read-Only Report

Run:

```text
npm run verify:daytrade-source-speed
```

Default checked source:

```text
source_status.source_name = fugle_daytrade_source
```

If the dedicated source does not exist, the report must return `D`, not silently fallback to the shared display source.

The report final grade is the worst of:

```text
writer daytrade_gate_grade
computed evidence grade
source_status gate
daytrade_source_speed_ok gate
priority_gate_grade
payload required fields gate
```

## Config Draft

The proposed dedicated speed config is:

```text
ops/public-slot/daytrade-source-speed.config.example.json
```

It is intentionally disabled by default until release owner creates and proves the dedicated writer/runtime path.

Writer draft:

```text
scripts/run-daytrade-source-writer.js
ops/public-slot/Run-DaytradeSourceWriter.ps1
```

Default writer mode is dry-run/no-fetch/once. Release owner must explicitly run apply mode before it can write Supabase or call Fugle.
