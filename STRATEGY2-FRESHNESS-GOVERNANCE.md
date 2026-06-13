# 策略2資料新鮮度治理

Strategy2 Data Freshness Governance

Verified Data Publish Gate / 資料發布閘門機制

## 目的

策略2不是單純更新 `strategy2-intraday-*.json`。

策略2資料只有在「掃描、發布、live 驗證」全部通過後，才可以被視為可給客人看的 A 進場區資料。

## 唯一入口

正式資料發布只能走：

```powershell
cd C:\fuman-terminal-sync
npm run freshness:gate
```

例行快速更新只能走：

```powershell
cd C:\fuman-terminal-sync
npm run freshness:gate:fast
```

## 成功標準

策略2掃描成功不等於發布成功。

策略2 JSON 寫出成功不等於發布成功。

只有最後通過：

```powershell
npm run verify:data-freshness:live
```

才算策略2資料新鮮度通過。

## 策略2 gate 必備流程

`run-live-freshness-gate.ps1` 必須包含：

```text
strategy2 intraday raw refresh
cache sync all
verify:data-freshness
verify:data-freshness:live
live-freshness-ok.json
```

策略2 raw refresh 只負責產生候選資料；發布權限屬於 freshness gate。

## 策略2時間窗

策略2 gate 必須設定：

```text
STRATEGY2_SCAN_START_MINUTES = 525
STRATEGY2_ENTRY_START_MINUTES = 545
STRATEGY2_ENTRY_END_MINUTES = 720
STRATEGY2_SCAN_END_MINUTES = 720
```

說明：

```text
08:45 開始策略2盤前/暖機讀取
09:05 後才進入正式可交易進場時間
12:00 後不再開新進場
```

## 策略2 A進場區治理

A進場區必須來自策略2掃描結果，並保留：

```text
進場時間
股票代號
股票名稱
策略
strategyIds
strategyTags
strategyReasons
sourceCoverage
sourceCoverageHealthy
```

A進場區排序規則：

```text
latestAAt / firstAAt 最新的在最上方
```

七種策略任一成立，可以列入 A 進場區：

```text
STAR
盤前觀察
開盤沖
早攻續強
盤中續強
曾發動仍強
反彈轉強
```

但 STAR 不能用 `open-buy` 文字、分數或「開盤無腦入」推論；STAR 必須來自期貨 + 試撮驗證欄位。

## 防繞過

不得用以下方式發布策略2資料：

```powershell
.\run-cache-sync.ps1 -Scope strategy2
.\run-strategy2-intraday.ps1
node scripts\scan-intraday-signals.js
手動複製 data\strategy2-intraday-*.json
手動改 C:\fuman-terminal\data
```

舊入口必須導向 `legacy-entrypoint-guard.ps1`，再轉進 `npm run freshness:gate:fast`。

## 可觀測性

每次 gate 必須留下：

```text
C:\fuman-runtime\logs\live-freshness-gate-*.log
data\live-freshness-ok.json
rawRefresh.strategy2 intraday raw refresh
health summary / data freshness verifier 結果
外部 source warning
```

外部來源 timeout、HTTP 403/404、fetch failed、source unhealthy 是 warning，但最後仍以 `verify:data-freshness:live` 為準。

## 硬擋規則

`npm run verify:publish-gate` 必須檢查：

```text
STRATEGY2-FRESHNESS-GOVERNANCE.md 存在
AGENTS.md 指向本文件
FRESHNESS-GATE-MOBILE.md 指向本文件
run-live-freshness-gate.ps1 包含 strategy2 raw refresh
run-live-freshness-gate.ps1 包含策略2時間窗
run-strategy2-intraday.ps1 不能繞過 legacy-entrypoint-guard.ps1
run-cache-sync.ps1 不能允許 -Scope strategy2
```

## 一句話

策略2資料只有通過 Verified Data Publish Gate，才可以出現在客人看到的 A進場區。
