# 資料新鮮度治理

Data Freshness Governance

Verified Data Publish Gate / 資料發布閘門機制

## 我們在做什麼

現在要做的不是單純「更新資料」。

我們是在建立一套資料發布治理流程，確保 Fuman Terminal 只顯示通過即時驗證的最新資料。

## 唯一正式入口

```powershell
cd C:\fuman-terminal-sync
npm run freshness:gate
```

## 正式主線發布入口

```powershell
cd C:\fuman-terminal-sync
npm run release:main
```

固定順序：

```text
sync origin/main -> bump version -> deploy -> verify live version -> push GitHub
```

## 成功標準

更新完不算成功。

只有最後通過：

```powershell
npm run verify:data-freshness:live
```

才算成功。

## 終端可讀憑證

正式站必須有：

```text
data/live-freshness-ok.json
```

這個檔案是 Fuman Terminal Freshness Gate 的通行證。它必須跟目前正式站版本、`data-manifest.json`、`cb-detect-latest.json` 對齊，至少包含：

```text
gateId
version
checkedAt
verifier = npm run verify:data-freshness:live
manifestCount
cbCount
manifestCbCount
strategy5Count
strategy5ChipKCount
strategy5ForeignTrustCount
strategy5MultiCount
```

如果 `live-freshness-ok.json` 不存在、`gateId` 不是這次發布產生的唯一證明、版本不一致、CB rows 和 manifest count 不一致，終端資料不能宣稱是最新。

## 每個 Codex 接手先做

```powershell
cd C:\fuman-terminal-sync
git pull --ff-only origin main
npm run verify:publish-gate
```

先讀：

```text
AGENTS.md
FRESHNESS-GATE-MOBILE.md
STRATEGY2-FRESHNESS-GOVERNANCE.md
REALTIME-RADAR-FRESHNESS-GOVERNANCE.md
STRATEGY5-FRESHNESS-GOVERNANCE.md
```

## 核心規則

1. 更新 + 驗證必須綁在一起。
2. 舊腳本不能繞過 gate。
3. scoped publish 不能繞過 gate。
4. 手動 cache sync 不能繞過 gate。
5. log、health summary、raw source warning、成功狀態都要留下。
6. 防別的 Codex 弄壞，不靠口頭提醒，而靠腳本、verifier、AGENTS.md、硬擋規則。

## 策略2專屬規則

策略2資料治理細則在：

```text
STRATEGY2-FRESHNESS-GOVERNANCE.md
```

策略2 A進場區、LINE 通知、`strategy2-intraday-*.json` 都不能用舊腳本或手動 cache sync 繞過 gate。

策略2資料只有通過：

```powershell
npm run verify:data-freshness:live
```

才算可以給客人看。

## 即時雷達專屬規則

即時雷達資料治理細則在：

```text
REALTIME-RADAR-FRESHNESS-GOVERNANCE.md
```

即時雷達目前正式資料流是：

```text
/api/market + /api/realtime
```

不需要 Supabase 才能運作。

`realtime-radar-latest.json`、即時雷達 scanner output、failed batch details、stale quote details、外部來源 warning、名單收斂規則，都不能用舊腳本或手動 cache sync 繞過 gate。

即時雷達資料只有通過：

```powershell
npm run verify:data-freshness:live
```

才算可以給客人看。

## 策略5專屬規則

策略5資料治理細則在：

```text
STRATEGY5-FRESHNESS-GOVERNANCE.md
```

策略5正式資料流必須同時保護：

```text
strategy5-latest.json
strategy5-backup.json
strategy-match-index.json
terminal-home-bundle.json
```

籌碼老K、外資投信連買準突破、多策略共振、量價周轉、布林KDJ 不能只更新單一 JSON。策略5掃描後必須重新生成 slim/index，否則前端可能讀到舊條件或點擊卡片沒有對應資料。

策略5舊快取指紋 `chip_k_confluence=0` 且 `foreign_trust_breakout=42` 必須被 gate 擋下。

策略5資料只有通過：

```powershell
npm run verify:data-freshness:live
```

才算可以給客人看。

## 防舊 repo

`freshness:gate` 會先做 repo sync preflight。

如果本機 `C:\fuman-terminal-sync` 落後 `origin/main`，或有不該存在的 dirty/conflict 檔案，gate 必須先失敗，不能發布。

## 外部來源卡住

TWSE、Supabase、行情 API 或其他外部來源 timeout / 403 / 404 / fetch failed 時，要記進 log 和 health summary。

外部來源 warning 不能直接製造半套發布；最後仍以 `verify:data-freshness:live` 是否通過為準。

## 手機快取

手機資料請求必須 network-first / no-store。資料已發布但手機短暫顯示舊畫面時，先重新整理；成功標準仍以 live freshness verifier 為準。

`live-freshness-ok.json` 也必須走 network-first / no-store，不能吃舊快取。

## 執行時間與重疊

full gate 可以比較久。執行期間手機端顯示上一版已驗證資料，不能做半套發布。

如果排程重疊，後跑的任務會被 lock 擋住，不得繞過 gate。

## 人工改資料與網路

不要手動改 publish data 或 terminal data。漂移時要重新跑 gate / verifier。

GitHub 或網路不可用時，repo sync preflight 會失敗；這代表延後更新，不代表可以跳過 gate。

## 暫停事項

目前先不要修改 Supabase 相關程式、table、upload、readback、timeout 或 retry 行為。

除非使用者明確要求處理 Supabase，否則只做 freshness gate、資料發布治理、文件與 verifier。

## 改完必跑

每次改資料流程、排程、發布腳本、治理文件或 Codex 規則後，都必須跑：

```powershell
npm run verify:publish-gate
```

要宣稱終端資料是最新，還必須通過：

```powershell
npm run verify:data-freshness:live
```

## 專案名稱

Fuman Terminal Freshness Gate

富滿終端資料新鮮度閘門

## 一句話

我們在做「資料發布流程的治理與防呆」，確保終端只顯示通過即時驗證的最新資料。


