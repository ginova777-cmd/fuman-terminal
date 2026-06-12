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

## 成功標準

更新完不算成功。

只有最後通過：

```powershell
npm run verify:data-freshness:live
```

才算成功。

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
```

## 核心規則

1. 更新 + 驗證必須綁在一起。
2. 舊腳本不能繞過 gate。
3. scoped publish 不能繞過 gate。
4. 手動 cache sync 不能繞過 gate。
5. log、health summary、raw source warning、成功狀態都要留下。
6. 防別的 Codex 弄壞，不靠口頭提醒，而靠腳本、verifier、AGENTS.md、硬擋規則。

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
