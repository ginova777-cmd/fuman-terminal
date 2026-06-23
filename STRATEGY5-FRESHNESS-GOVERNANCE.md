# 策略5 Supabase API-Only Governance

策略5正式來源是 Supabase complete run 與 `/api/strategy5-latest`。舊 static JSON 只可作為 legacy artifact，不可作為 freshness authority。

## API 契約

- `/api/strategy5-latest` 必須回 `ok`、`runId`、`usedDate`、`sourceDate`、`marketSession.marketDataDate`、`count`、`resultCount`、`matches`、`rows`。
- `rows` 必須是 `matches` 的 alias；`rows.length === matches.length`，輕量查詢時 `rows.length === count`。
- `?top=1&compact=1&limit=50` 必須真的限制回傳筆數並精簡 payload。
- `resultCount > count` 表示完整 run 筆數大於本次輕量回傳筆數，不代表資料缺少。

## Scanner 契約

- `scripts/scan-strategy5-cache.js` 寫入 complete run 後必須 readback。
- readback log 至少包含 `runId`、`resultRows`、`readbackCount`、`status`、`complete`。
- 若 `readbackCount !== resultRows.length`，不可宣稱發布成功。

## 禁止恢復的舊路徑

- 不要呼叫 `verify:data-freshness` 或 `verify:data-freshness:live`。
- 不要依賴 `scripts/verify-data-freshness.js`。
- 不要用 `data/live-freshness-ok.json` 記錄策略5指紋。
- 不要把策略5正式來源退回 `/data/strategy5-latest.json`、`strategy5-page-1.json` 或其他 static JSON。

策略5發布健康由 Supabase readback、API shape、publish gate、targeted verifier 決定。
