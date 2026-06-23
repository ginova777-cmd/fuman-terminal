# 策略2 Supabase API-Only Governance

策略2正式資料來源是 Supabase complete run / shared source health / no-store API。不要再使用舊靜態 freshness verifier 或 `live-freshness-ok.json` 判斷策略2是否可用。

## 正式契約

- `source_status.payload.intraday_1m_ok`、`ready_ge_35_symbols`、`ready_ge_80_symbols` 是 1 分 K 供給健康依據。
- `v_strategy2_detection_health` 是策略2專用健康檢查入口。
- `v_strategy2_entry_events_today` 是 A 進場區歷史逐筆資料入口。
- `strategy2_latest` 必須跟上最新 shared source；若 source 已恢復但 latest 落後，應刷新策略2 run。
- 盤後 shared source `stopped` 不可被誤判成盤中 1 分 K 壞掉；盤後狀態應是 `afterhours_stopped_ok`。

## 禁止恢復的舊路徑

- 不要呼叫 `verify:data-freshness` 或 `verify:data-freshness:live`。
- 不要依賴 `scripts/verify-data-freshness.js`。
- 不要用 `data/live-freshness-ok.json` 當策略2發布 gate。
- 不要讓 `run-cache-sync.ps1`、`run-local-freshness-repair.ps1`、`run-flow.ps1`、`run-live-freshness-gate.ps1` 重新接回舊 verifier。

## 可接受驗證

- `npm run verify:publish-gate`
- 策略2專用 SQL/RPC 驗證
- live API readback：確認 `strategy2_ready_cache_ok=true`、`entry_count`、`run_id`、`updated_at`、`quality_status`

## 交易時間窗

策略2仍保留固定交易時間窗：

- `STRATEGY2_SCAN_START_MINUTES = 525`
- `STRATEGY2_ENTRY_START_MINUTES = 545`
- `STRATEGY2_ENTRY_END_MINUTES = 720`
- `STRATEGY2_SCAN_END_MINUTES = 720`

策略2是否可交易，要看 Supabase shared source 與策略2 latest 是否一致，不看舊 static JSON freshness gate。
