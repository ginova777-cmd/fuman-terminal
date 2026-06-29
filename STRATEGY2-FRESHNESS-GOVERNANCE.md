# 策略2 Supabase API-Only Governance

策略2正式資料來源是 Supabase complete run / 分層 shared source health / no-store API。不要再使用舊靜態 freshness verifier 或 `live-freshness-ok.json` 判斷策略2是否可用。

## 分層 Health Gate

策略2不能再被單一 `source_status.status` 硬殺。分成兩層：

- `canPublishUniverse`：由 quotes health / coverage / active symbols / anon readback 決定。這層 OK 就可以發布策略2母池觀察。
- `canUpgradeTechnicalEntry`：由 `canPublishUniverse` + `intraday_1m_ok` / ready cache / latest 1m freshness 決定。這層 OK 才能升級 A 區技術確認。

口徑：

- quotes 壞：策略2母池不可發布，可保留上一筆 good A report 或回 quote source unhealthy。
- quotes 好、1 分 K 壞或 stale：母池照常發布，標 `degraded_intraday_1m`，候選只能 WATCH / 待確認，不升級 A 區。
- `source_status=error/stale/stopped` 不能單獨讓策略2空白；若 quote readback 正常，應走分層 degraded，而不是 `supabase_shared_source_unhealthy`。

## 正式契約

- `source_status.payload.intraday_1m_ok`、`ready_ge_35_symbols`、`ready_ge_80_symbols` 是 1 分 K 供給健康依據。
- `v_strategy2_detection_health` 是策略2專用健康檢查入口。
- `v_strategy2_entry_events_today` 是 08:45-12:00 live 偵測歷史逐筆資料入口。
- `strategy2_latest` 必須跟上最新 shared source；若 source 已恢復但 latest 落後，應刷新策略2 run。
- 盤後 shared source `stopped` 不可被誤判成盤中 1 分 K 壞掉；盤後狀態應是 `afterhours_stopped_ok`。
- ready cache 必須刷新全股票池：`refresh_strategy2_intraday_ready_cache` 需一路跑到 `next_offset=0`，不能用固定 12 頁或部分 processed 數量當成功；若 `processed < total_expected` 或 `next_offset != 0`，只能警告/阻擋 ready，不可發布成 100% coverage。

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
- `STRATEGY2_ENTRY_START_MINUTES = 525`
- `STRATEGY2_ENTRY_END_MINUTES = 720`
- `STRATEGY2_SCAN_END_MINUTES = 720`

策略2是 08:45-12:00 live 偵測策略；終端歷史紀錄必須保留整段 live ledger，不能只保留 09:15 或只保留最新 complete run 摘要。策略2是否可交易，要看 Supabase shared source 與策略2 latest 是否一致，不看舊 static JSON freshness gate。
