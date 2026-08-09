# 當沖工單 1 交接：近一合約／正逆價差／逆收斂

日期：2026-07-29（Asia/Taipei）
範圍：Supabase dedicated daytrade source contract；不改 Strategy2 scanner/publisher，不改 terminal/UI/Auth，不硬改 gate A。

## 目前判定

- 原有 `v_stock_future_live_contract` 仍可能讀到歷史／多合約混合列，不能作為唯一近一合約來源。
- `strategy1_futopt_preopen_live_snapshot` 目前不是今日 08:45 baseline，舊資料不得拿來算逆收斂。
- 本地 writer 已加入自然 08:45 一次性 baseline capture；只在 `08:45 <= Taipei time < 09:00` 寫入，錯過視窗不補造自然證據。
- 新契約尚未部署；唯讀 verifier 目前對新 view 回 HTTP 404，這是預期 blocker，不是 PASS。

## 本輪檔案

- `ops/public-slot/DaytradeFutoptNearOneBaselineContract_20260729.sql`
- `scripts/run-daytrade-source-writer.js`
- `scripts/verify-daytrade-futopt-near-one-baseline.js`

## 新 read-only contract

- `v_fugle_daytrade_stock_future_near_one_contract`
  - 只讀今日 `fugle_daytrade_futopt_quotes_live`。
  - 以 `futopt_tickers` 的 `end_date`／payload `CDate` 排除已過期合約。
  - 每一個 `underlying_symbol` 只保留一筆。
  - 對 expiry 不明的列標成 `current_live_expiry_unknown`，不可當作已驗證近一合約。
- `fugle_daytrade_futopt_preopen_baseline`
  - key：`trade_date + underlying_symbol`。
  - 只接受自然 08:45 視窗內的今日 live quote。
- `v_fugle_daytrade_futopt_preopen_baseline`
  - 回傳 `baseline_status`、`natural_0845_baseline_ready`、`baseline_observed_at`。
- `v_fugle_daytrade_futopt_basis_current`
  - 回傳即時 basis 與 08:45 convergence。
  - 沒有 baseline 時固定回 `convergence_status=baseline_missing`，不得猜測。

## Supabase／Release 端待做

1. 在正式 Supabase SQL Editor 執行 `DaytradeFutoptNearOneBaselineContract_20260729.sql`。
2. 確認 schema reload 成功，沒有 drop view／改既有 view 欄位型別或欄位順序。
3. 讓唯一的既有 daytrade writer 自然跑 08:45；不要手動補跑、不要啟動第二個 writer。
4. 由策略端改讀 `v_fugle_daytrade_stock_future_near_one_contract`；逆收斂改讀 baseline view。

## 唯讀驗證

```powershell
cd C:\fuman-terminal
node --use-system-ca scripts\verify-daytrade-futopt-near-one-baseline.js
```

完成條件：

- `nearOne.currentDateRows > 0`
- `duplicateUnderlyings = 0`
- `expiredRows = 0`
- `baseline.natural0845ReadyRows > 0`
- `convergence.baselineMissingRows = 0`（只對有今日 baseline 的標的）

在上述條件未達成前，正價差／逆價差可以顯示為觀察資料；逆收斂必須維持 blocked / baseline_missing。不得宣告正式 A 或 unattended YES。
