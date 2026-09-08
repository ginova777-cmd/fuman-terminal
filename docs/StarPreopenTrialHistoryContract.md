# STAR 盤前試撮自然歷史契約

版本：`star_preopen_trial_history_canonical_verifier_v1`

時區：`Asia/Taipei`

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
  -> star-preopen-trial-history-canonical-receipt-YYYYMMDD.json
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

目前 STAR 關鍵 readback 時槽是：

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

當日 anon 唯讀閉環與 receipt：

```powershell
npm run verify:star-preopen-trial-history:live -- --trade-date=YYYY-MM-DD --symbols=2337,2344
```

只有 live receipt 同時具備四個自然時槽、有效試撮 history、事件時間與 run 身分時，才允許 `complete=true`。

## Fail-closed

以下任一狀況都必須維持 `complete=false`：

- `trial_price` 或 `reference_price` 缺失。
- `trial_event_at` 缺失或不是當日盤前事件。
- `run_id`／`generation_id` 缺失。
- 必要自然時槽缺失。
- 只有 snapshot、沒有可用 history。
- anon readback 失敗。

Verifier 不修改 Supabase、不呼叫富果、不發送 Telegram，也不產生正式進場。
