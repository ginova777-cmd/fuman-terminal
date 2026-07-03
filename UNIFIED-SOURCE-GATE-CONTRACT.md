# Fuman Unified Source Gate Contract

目標是唯一水源總閘，不是新增一張好看的 health view。

所有策略發布前只能採信同一份 source contract：

- `public.fuman_source_contract_current` if installed
- `public.v_fuman_shared_source_readonly_scorecard`
- `public.source_status`
- `public.fugle_source_coverage`

策略可以有不同需求，但不能自己說「我覺得可以跑」。策略只能讀總閘輸出的 capability flags。

## Required Source Fields

總閘至少必須同時驗：

- `fresh_quote_coverage_120s`
- `priority_symbols`
- `scanner_can_run_quote_only`
- `scanner_can_run_opening`
- `scanner_can_run_ma20`
- `scanner_can_run_ma35`
- `scanner_can_run_full_intraday`
- `intraday_1m_stale_seconds`
- `ready_ma20_continuous`
- `ready_ma35_continuous`
- `daily_volume_status`
- `preopen_status`
- `futopt_status`
- `permission_status`
- `scanner_block_reason`

`status=ok` 不夠。若 `gate=A` 但 coverage/stale/readiness 是 `C`，總閘必須回 not ready。

## Strategy Publish Rule

只要策略需要的水源 not ready：

- 不准寫 latest
- 不准寫空結果
- 不准更新 latest pointer
- 必須 preserve previous good
- 必須寫 blocked receipt
- 必須顯示 `scanner_block_reason`

這條規則比「API 有資料」重要。水源壞時，最怕不是沒資料，而是壞資料覆蓋好資料。

## Run-Time Evidence Rule

每個策略 run 必須固定保存當下 source snapshot：

- `source_snapshot_captured_at`
- `source_status_at_run`
- `quote_coverage_at_run`
- `intraday_1m_readiness_at_run`
- `ma_readiness_at_run`
- `preopen_futopt_daily_readiness_at_run`
- `run_quality_at_publish`

缺這些證據時：

- `unattendedStatus=NO`
- `evidenceStatus=insufficient`

不准用現在 live view 回推過去 run 當下狀態。

## Fallback Rule

所有 fallback 必須揭露：

- `fallbackUsed`
- `fallbackScope`
- `fallbackAllowed`
- `fallbackDetails`

hidden fallback 一律視為 blocker。

## View/RPC Availability Rule

view/RPC 500 是底座 blocker，不准 fallback 混過。

至少要能讀：

- `v_fugle_quotes_commonstock_active`
- `fugle_quotes_live`
- `fugle_intraday_1m`
- `v_fugle_intraday_1m_status`
- `get_fugle_intraday_1m_latest_n`
- `get_fugle_intraday_1m_latest_n_page`
- `fugle_daily_volume`
- `fugle_daily_volume_avg`
- `stock_tickers`
- `market_calendar`
- `source_status`

## Deployment Rule

`npm run deploy` 必須先跑：

- `npm run verify:unified-source-gate`
- `npm run verify:publish-gate`

任何 Codex 若繞過 `npm run deploy` 或直接 `vercel --prod`，該部署不可採信。
