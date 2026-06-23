# 即時雷達 Supabase API-Only Governance

即時雷達正式判斷來源是 no-store API 與當日 quote/source health，不再由舊 daily freshness verifier 或 static JSON gate 判斷。

## 正式契約

- API 必須回 `ok`、`runId`、`usedDate`、`sourceDate`、`marketSession.marketDataDate`、`count`、`rows`。
- quote 日期必須和今天交易日一致。
- 股票母池必須排除 ETF、ETN、DR、指數、權證、CB、非普通股、停牌與黑名單。
- 可用性以 quote freshness、source health、API runId、rows count 為準。

## 禁止恢復的舊路徑

- 不要呼叫 `verify:data-freshness` 或 `verify:data-freshness:live`。
- 不要依賴 `scripts/verify-data-freshness.js`。
- 不要用 `data/live-freshness-ok.json` 當即時雷達 freshness gate。
- 不要讓即時雷達靠舊 `/data/realtime-radar-latest.json` 覆蓋 API-only 結果。

## 可接受驗證

- `npm run verify:publish-gate`
- 即時雷達專用 API readback
- source health / quote health / no-store response 檢查

即時雷達修畫面時改前端/API；修資料時改 scanner 或 Supabase snapshot，不要恢復 static freshness gate。
