# 即時雷達 Supabase API-Only Governance

即時雷達正式判斷來源是 no-store API 與當日 quote/source health，不再由舊 daily freshness verifier 或 static JSON gate 判斷。

## 正式契約

- 唯一正式水源是 Supabase `fuman_realtime_radar_cache` 的 `id=latest` payload；API 可在 radar cache 不可用且 quote view 仍新鮮時降級到正式 quote view `fugle_realtime_quote_latest`，但必須標示 `quote-view-fallback`。
- 唯一 writer 是 `run-realtime-radar.ps1` -> `scripts/patrol-realtime-radar-cache.js` -> `scripts/scan-realtime-radar-cache.js`，輸出 runtime JSON 後上傳 Supabase `fuman_realtime_radar_cache`。
- 唯一排程是 Windows Task Scheduler `Fuman 即時雷達`，registry 時間 08:58，patrol 只在交易日 09:00-13:30 每 3 秒掃描。
- 前端唯一自動刷新來源是 `/api/realtime-radar-latest?full=1&limit=1200`，預設顯示 09:00-13:30 全部流水帳，`多方`/`空方`只是篩選。
- API 必須回 `ok`、`runId`、`usedDate`、`sourceDate`、`marketSession.marketDataDate`、`count`、`rows`。
- quote 日期必須和今天交易日一致。
- 股票母池必須排除 ETF、ETN、DR、指數、權證、CB、非普通股、停牌與黑名單。
- 可用性以 quote freshness、source health、API runId、rows count 為準。
- stale/degraded 必須由 API 回 `ok:false` / `freshness.decision` / `reason`，前端顯示 `.radar-health-banner`，不得把舊 snapshot 顯示成正常。

## 禁止恢復的舊路徑

- 不要呼叫 `verify:data-freshness` 或 `verify:data-freshness:live`。
- 不要依賴 `scripts/verify-data-freshness.js`。
- 不要用 `data/live-freshness-ok.json` 當即時雷達 freshness gate。
- 不要讓即時雷達靠舊 `/data/realtime-radar-latest.json` 覆蓋 API-only 結果。

## 可接受驗證

- `npm run verify:publish-gate`
- 即時雷達專用 API readback
- source health / quote health / no-store response 檢查
- `scripts/check-realtime-radar-health.js` 必須驗證 production API、Supabase readback、排程、frontend guard、09:00-13:30 全部流水帳 marker。
- `scripts/verify-publish-gate.js` 與 `scripts/verify-terminal-ui-e2e.js` 必須防止 UI 回滾到 09:00-13:00 或只顯示單邊多空。

即時雷達修畫面時改前端/API；修資料時改 scanner 或 Supabase snapshot，不要恢復 static freshness gate。
