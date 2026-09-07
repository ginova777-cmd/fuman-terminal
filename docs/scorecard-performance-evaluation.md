# /88 策略績效與回測評估

契約：`scorecard-performance-evaluation-v1`

`/88` 同時呈現成績單實盤向前追蹤與正式回測可用性，但兩者不得混為同一種績效。

## 資料流程

```text
正式策略結果
  → scorecard trade_records
  → /api/scorecard 當月正式紀錄
  → scorecard-performance-evaluation
  → /88 策略績效與回測狀況
```

績效模組只讀既有成績單紀錄，不執行策略掃描、不改候選、不產生 runId、不覆蓋成績單，也不觸發下單或通知。

## 目前指標

有 `entry_price` 與 `high_price` 的紀錄可計算 MFE：

```text
MFE% = (high_price - entry_price) / entry_price × 100
```

MFE 是進場後觀察到的最高有利幅度，不是可保證成交的出場價，也不是已實現損益。

正式淨績效必須同時具備：

- `exit_price`
- `net_return_pct`，或可核對的 `total_cost_pct`
- 明確且未使用未來資料的出場規則

缺少上述資料時，該策略必須顯示 `NOT_EVALUABLE`，`averageNetReturnPct` 必須為 `null`，不得以 MFE 或 `high_price - entry_price` 冒充淨獲利。

## 狀態

```text
COMPLETE      = 每筆樣本都有出場價與淨成本證據
NOT_EVALUABLE = 缺少正式出場或成本證據；僅顯示 MFE 追蹤
PARTIAL       = 當月策略中至少一項尚不可正式回測
```

現行正式範圍依 active registry 與成績單來源為 Strategy2、Strategy3、Strategy4、Strategy5 與買賣超。退役策略不會因本模組重新啟用。

## 驗證

```powershell
npm run verify:scorecard-performance
node scripts\verify-scorecard-no-rollback.js --no-live --no-output --skip-schedule
node scripts\verify-scorecard-strategy-rules.js --no-live --no-output
```
