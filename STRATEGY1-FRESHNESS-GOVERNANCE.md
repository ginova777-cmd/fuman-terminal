# Strategy1 Freshness Governance

## 策略1交接

策略1現在已完成 atomic publish。正式 latest 不再被 partial/running 掃描污染。

## 目前資料讀取路徑

1. `/api/terminal-home`
   -> `get_latest_strategy_payload('strategy1')`
   -> `strategy1_open_buy_latest.payload`

2. 如果 RPC/latest payload 失敗
   -> `v_strategy1_open_buy_latest_complete_run`
   -> `strategy1_open_buy_results`

3. 最後才是
   -> `data/open-buy-latest.json` / backup

## 新增 API

`/api/latest-strategy?key=strategy1`

## 目前 live 驗證

- `count = 15`
- `runId = strategy1-20260616-20260616145550`
- `gate = latest-payload`
- `fallback = false`
- `scanStatus = complete`

## Atomic Publish 規則

規則已落在：

- `scripts/scan-open-buy-cache.js`

現在分成兩條路。

### `publishRunningStatus()`

只寫：

- `strategy_cache_status`

不碰：

- `data/open-buy-latest.json`
- `strategy1_open_buy_latest.payload`
- `open-buy-backup.json`

### `publishCompleteOutput()`

只有在：

- `output.complete === true`
- `output.scanStatus === "complete"`

才會寫：

- `data/open-buy-latest.json`
- `data/open-buy-backup.json`
- `strategy1_open_buy_latest.payload`
- `strategy1_open_buy_runs`
- `strategy1_open_buy_results`
- `strategy_cache_status`

如果有人試圖把 non-complete output 發到正式 latest，現在會直接擋掉：

```text
Refusing to publish non-complete open-buy output
```

## `strategy_cache_status` 的用途

`running` / `incomplete` / `failed` / `complete` 都可以寫。

但它只是狀態表，不是正式策略資料來源。前端可以看它知道掃描進度，但不要把 running payload 當成正式結果。

## RLS 原則

- `anon` / `authenticated`: select only
- `service_role`: insert / update / delete

## 特別提醒

- 不要再讓 partial scan 覆蓋 `open-buy-latest.json`
- 不要讓 incomplete scan 更新 `strategy1_open_buy_latest.payload`
- full scan 如果被中斷，只能更新 `strategy_cache_status`
- 正式首頁資料只吃 complete latest payload 或 run_id complete gate

## 後續建議

- 策略1 full scan 可以加更長 timeout 或背景任務，避免人工工具中斷。
- `strategy_cache_status` 可以顯示掃描進度，例如 `completed_chunks` / `total_chunks`，目前 log 會寫 running chunks。
- 前端之後若要拆 API，可以直接用：`/api/latest-strategy?key=strategy1`
- 之後 strategy2/3/4/5 也可以逐步改成同一個 `/api/latest-strategy?key=...` 入口。

## 一句話交接

策略1現在是 complete-only publish；running 只能報狀態，不能碰正式 latest。
