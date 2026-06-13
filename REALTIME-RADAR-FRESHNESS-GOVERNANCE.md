# 即時雷達資料新鮮度治理

Data Freshness Governance

Verified Data Publish Gate / 資料發布閘門機制

## 我們在做什麼

你現在要的不是單純「更新資料」，而是建立一套即時雷達資料發布治理流程。

目標是確保 Fuman Terminal 的即時雷達只顯示通過即時驗證的最新資料，並且自動套用基本名單收斂規則。

## 唯一入口

```powershell
npm run freshness:gate
```

即時雷達資料更新、快取發布、線上驗證必須綁在一起。

## 成功標準

更新完不算成功。

只有最後通過：

```powershell
npm run verify:data-freshness:live
```

才算即時雷達可以給客人看。

## 即時雷達正式資料流

目前即時雷達不需要 Supabase 才能運作。

正式資料來源是：

```text
/api/market + /api/realtime
```

流程：

```text
/api/market 取得股票池與基本行情
-> /api/realtime 補即時報價
-> 套用當沖基本名單收斂
-> 判斷 long / short 訊號
-> 寫 realtime-radar-latest.json
-> 由 freshness gate 發布並驗證 live freshness
```

## 基本名單收斂

即時雷達偵測前必須先排除：

```text
ETF / ETN / DR / 指數 / 權證 / CB / 非普通股
00、28、58 開頭
固定排除碼：2330、2412、3045
黑名單
當沖不適合
停牌 / 暫停交易 / 試撮
水泥 / 軍工 / 國防 / 航太
股價 <= 0 或 >= 900
量能不足
```

量能不足定義：

```text
avg_volume_5 < 3000
cumulative_bid_ask_volume < 3000
cumulative_bid_volume + cumulative_ask_volume < 3000
沒有累計內外盤欄位時，tradeVolume / volume < 3000
```

## 偵測條件

Long 候選：

```text
標籤含：逼近、爆量、強勢、急拉、長紅
漲幅 >= 3%
漲幅 >= 1.5% 且成交值 >= 2 億
成交值 >= 10 億且漲幅為正
成交量 >= 5000 張且漲幅 >= 1.2%
```

Short 候選：

```text
標籤含：急殺、轉弱、長黑、貼近
跌幅 <= -3%
跌幅 <= -1.5% 且成交值 >= 2 億
成交值 >= 10 億且漲幅為負
成交量 >= 5000 張且跌幅 <= -1.2%
```

排序：

```text
score 高到低 -> 成交值高到低 -> 取前 80 檔
```

## 防繞過

下列方式都不能繞過 freshness gate：

```powershell
.\run-cache-sync.ps1 -Scope realtime
.\run-cache-sync.ps1 -Scope strategy2
手動改 data\realtime-radar-latest.json
手動 copy publish data
舊腳本直接發布
```

舊即時雷達腳本只能是 legacy shim，必須導向：

```text
legacy-entrypoint-guard.ps1
```

## 可觀測

即時雷達資料問題必須留下：

```text
log
health summary
raw source warning
failed batch details
stale quote details
external source issues
成功狀態 live-freshness-ok.json
```

外部來源 timeout / HTTP 403 / HTTP 404 / fetch failed / stale quote 不能安靜吞掉。

## Supabase 狀態

目前即時雷達正式路徑是：

```text
/api/market + /api/realtime
```

Supabase 不是即時雷達必要條件。

之後如果要升級成共同資料源，才接：

```text
stock_universe
source_status
fugle_daily_volume
quote ready view
```

接 Supabase 前必須維持原則：

```text
source_status != ok 時顯示來源異常
不要自行大量 fallback 打 Fugle API
不要用舊資料安靜替代即時資料
```

## 防別的 Codex 弄壞

不是靠口頭提醒，而是靠：

```text
AGENTS.md
FRESHNESS-GATE-MOBILE.md
REALTIME-RADAR-FRESHNESS-GOVERNANCE.md
scripts/verify-publish-gate.js
run-live-freshness-gate.ps1
run-cache-sync.ps1
legacy-entrypoint-guard.ps1
```

任何修改即時雷達資料流、排程、發布腳本、濾除規則或 freshness rule 的 Codex，都必須先跑：

```powershell
npm run verify:publish-gate
```

要宣稱線上資料可用，還必須通過：

```powershell
npm run verify:data-freshness:live
```

## 一句話

我們在做「即時雷達資料發布流程的治理與防呆」，確保終端只顯示通過即時驗證的最新資料。
