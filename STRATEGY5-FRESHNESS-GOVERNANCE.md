# 策略5資料新鮮度治理

策略5屬於 Fuman Terminal Freshness Gate 的受管資料。資料發布流程必須走 Verified Data Publish Gate，不能手動修改或只提交單一 JSON。

## 發布入口

- 只允許用 `npm run freshness:gate` 或主發布鏈 `main -> bump -> deploy -> live verify -> push GitHub` 發布。
- 策略5原始掃描必須由 `strategy5 raw refresh` 或 `node scripts/scan-strategy5-cache.js` 產生。
- 策略5掃描後必須執行 `node scripts/generate-slim-cache.js`，同步 `strategy-match-index.json`、`data-manifest.json`、`terminal-home-bundle.json`。
- GitHub `strategy5-background-scan.yml` 必須同時 commit `strategy5-latest.json`、`strategy5-backup.json`、`strategy-match-index.json`、`data-status-index.json`、`data-manifest.json`、`mobile-home-summary.json`、`terminal-home-bundle.json`。

## 策略5硬檢查

`npm run verify:data-freshness` 與 `npm run verify:data-freshness:live` 必須驗證：

- `strategy5-latest.json` `ok=true` 且 `count` 等於實際 `matches.length`。
- 籌碼老K `chip_k_confluence` 不可為 0。
- 外資投信連買準突破 `foreign_trust_breakout` 必須走新條件，數量需在治理範圍內。
- 舊快取指紋 `chip_k_confluence=0` 且 `foreign_trust_breakout=42` 必須擋下。
- 多策略共振不可為 0。
- `strategy-match-index.json` 必須包含策略5標的與對應 details，例如 `籌碼老K`、`準突破`、`量價周轉`、`布林KDJ`。
- `terminal-home-bundle.json` 的策略5 count 必須與 `strategy5-latest.json` 一致。

## Fuman Terminal Freshness Gate

`data/live-freshness-ok.json` 必須記錄策略5指紋：

- `strategy5Count`
- `strategy5ChipKCount`
- `strategy5ForeignTrustCount`
- `strategy5MultiCount`
- `strategy5UpdatedAt`
- `strategy5SourceDate`

Live gate 驗證時，以上欄位必須與正式站當下的 `strategy5-latest.json` 完全一致。

## 失敗處理

如果正式站出現籌碼老K歸零、外資投信回到舊數量、或點擊策略5卡片顯示舊資料：

1. `git pull --ff-only origin main`
2. 重新跑 `node scripts/scan-strategy5-cache.js`
3. 重新跑 `node scripts/generate-slim-cache.js`
4. `npm run verify:data-freshness`
5. `npm run sync:source`
6. `vercel --prod`
7. `npm run verify:data-freshness:live`
8. commit 並 `git push origin main`

不要只複製 `strategy5-latest.json`，也不要跳過 `strategy-match-index.json`。
