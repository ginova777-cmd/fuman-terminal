# STAR 盤前試撮自然歷史契約

版本：`star_preopen_trial_history_canonical_verifier_v2`

時區：`Asia/Taipei`

唯一正式 STAR SQL：`ops/public-slot/DaytradeStarPreopenReadbackContract_20260908.sql`。2026-09-02 舊版已刪除，不得由排程、手動部署或文件重新引用。

## 正式鏈

```text
Fugle stock WebSocket trades + aggregates
  -> fugle-daytrade-ws-quotes-v2.json
  -> run-daytrade-source-writer.js
  -> fugle_preopen_snapshot / fugle_preopen_snapshot_history
  -> run-daytrade-near-one-source.js
  -> fugle_daytrade_preopen_futopt_snapshots
  -> v_fugle_daytrade_star_preopen_readback
  -> verify-star-preopen-trial-history-contract.js
  -> fugle_daytrade_star_verification_receipts
  -> v_fugle_daytrade_star_verification_readback (anon read-only)
```

## 試撮事件

- `aggregates.lastTrial.price` 是保存的試撮價。
- 只有頂層 `isTrial=true` 才代表目前事件處於試撮；開盤後仍存在的 `lastTrial` 不得讓資料繼續被判成試撮。
- Fugle v1.1 `trades` 的 `isTrial=true` 訊息須轉成 `trialPrice` 與 `trialEventAt`。
- sparse trade 訊息不得清掉 aggregates 保存的 `referencePrice`、五檔價格或五檔數量。
- history 的 `observed_at` 優先使用真實 `trialEventAt`。沒有新事件時，不得製造新的試撮事件時間。

## 必要身分欄位

每筆正式盤前 history payload 必須發布：

- `writer_contract=preopen_snapshot_history_v2`
- `trade_date`
- `observed_at`
- `trial_event_at`
- `run_id`
- `generation_id`
- `formal_candidate=false`
- `order_allowed=false`
- `formal_entry_allowed=false`
- `safety_scope=PREOPEN_OBSERVATION_ONLY`

每個 STAR 期貨 snapshot payload 必須發布：

- `natural_schedule_evidence=true`
- `natural_schedule_phase`
- `websocket_quote_seen_at`
- `trial_event_at`
- `run_id`
- `generation_id`

## 正式時槽

STAR 掃描母體來自 `v_fugle_daytrade_star_universe_readback`，是全部有效個股近月期貨，不得以 Mother Pool、TOP20、TOP40、固定 symbol 或 API 第一頁裁切。TXF 只作比較基準，不計入個股 STAR。每個 underlying 只能選一個最早到期且未過期的合約；其他合約仍保留 `exclusion_reason`。

STAR 關鍵 readback 時槽是：

- `08:45`
- `08:50`
- `08:55`
- `08:59`

若未來要求完整逐分鐘 replay，必須由同一正式 runner 擴充自然 capture；不得啟用第二支競爭 Writer，也不得以 09:00 後行情、forward-fill 或合成 K 棒補值。

## 驗收

靜態契約：

```powershell
npm run verify:star-preopen-trial-history
```

當日全清冊 anon 唯讀閉環與本機 JSON/CSV：

```powershell
npm run verify:star-preopen-trial-history:live -- --trade-date=YYYY-MM-DD
```

由 Writer／Release Owner 明確發布 receipt（唯一允許使用 service role 的步驟）：

```powershell
npm run verify:star-preopen-trial-history:publish -- --trade-date=YYYY-MM-DD
```

Viewer 不得使用 service role。跨電腦只讀：

```text
GET /rest/v1/v_fugle_daytrade_star_verification_readback
  ?select=*
  &trade_date=eq.YYYY-MM-DD
  &canonical_run_id=eq.star_preopen:YYYYMMDD:canonical
  &order=verified_at.desc
  &limit=1
```

再以相同 `trade_date` 讀取 `v_fugle_daytrade_star_universe_readback`、`v_fugle_daytrade_star_preopen_readback`、`v_fugle_daytrade_preopen_snapshot_contract` 與 `v_fugle_preopen_snapshot_history`。Reader 最多重試三次；不得拿另一交易日或另一 canonical batch 補齊。

兩份正式 receipt 的跨電腦聯合檢查：

```powershell
npm run verify:star-side-volume:cross-computer -- --trade-date=YYYY-MM-DD
```

`canonical_run_id` 是整個交易日的驗收批次身分；`run_id`／`generation_id` 是單一 Writer 執行與事件身分。四個時槽可以來自不同 Writer run，不能要求四槽共用同一 `run_id`，也不能把不同 `canonical_run_id` 的資料混批。

正式統計必含 `universe_count`、`evaluated_count`、`pass_count`、`no_match_count`、`data_gap_count`、`missing_symbols`、`duplicate_underlying_count`、`page_count`、`read_rows`。必須符合：

```text
evaluated_count = universe_count
pass_count + no_match_count + data_gap_count = evaluated_count
```

`DATA_GAP` 永遠保留在分母。前 20 名只影響顯示，不影響掃描、history 或 receipt。

目前 Type1 只保留有效 `trial_price/reference_price`、`best_bid >= trial`、期漲至少 2%、RelTXF 至少 1%、期量至少 50 與期貨開盤回測守住。舊「試撮漲幅」「漲停買盤」「買賣盤比」都不是硬 Gate。

只有全清冊 live receipt 同時具備四個自然時槽、有效試撮 history、事件時間與身分，且 `data_gap_count=0` 時，才允許 `complete=true`。

## Fail-closed

以下任一狀況都必須維持 `complete=false`：

- `trial_price` 或 `reference_price` 缺失。
- `trial_event_at` 缺失或不是當日盤前事件。
- `run_id`／`generation_id` 缺失。
- 必要自然時槽缺失。
- 只有 snapshot、沒有可用 history。
- anon readback 失敗。

Verifier 不修改 Supabase、不呼叫富果、不發送 Telegram，也不產生正式進場。
