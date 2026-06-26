# CB AGENTS.MD

Last updated: 2026-06-26 Asia/Taipei

這份文件只描述「CB / 可轉債偵測」的 Supabase / API / terminal 戰鬥契約。後續 Codex 接手 CB 時，必須以本文件為準，不要退回舊 snapshot、static JSON 或人工結果。

## 核心目標

CB 是 latest-complete 策略。

目標不是只確認 CB API 有資料，而是要達到：

```text
資料存在
health view 算得對
terminal scanner key 看得到
API 使用 complete-run readback
不使用 snapshot fallback 當正式 ready
```

terminal scanner gate 必須能自動判斷：

```text
ready      => 可以 publish / 顯示 latest complete run
stale      => preserve latest complete run，顯示 warning
not_ready  => preserve latest complete run，顯示 reason
failed     => preserve latest complete run，顯示 failed reason
```

## 絕對禁止

- 不要在 `v_cb_latest_complete_run_health.source_status != ready` 時發布新 CB 資料。
- 不要把 snapshot fallback 當正式 ready。
- 不要用空結果覆蓋 latest complete run。
- 不要讓 `cb_detect_scan_runs.result_count` 與 `cb_detect_scan_results` readback 不一致。
- 不要讓 terminal 看不到 `symbol/cbCode/name/score/entry`。

## 權威來源

正式來源只認：

```text
cb_detect_scan_runs
cb_detect_scan_results
v_cb_latest_complete_run_health
v_scanner_resource_health
/api/cb-detect-latest
```

API 正式 ready 必須走：

```text
cacheSource = supabase-api
transport.gate = run_id
transport.runTable = cb_detect_scan_runs
transport.resultTable = cb_detect_scan_results
```

snapshot `cb_detect_latest` 只能作為等待或 fallback，不可作為正式 ready。

## 必要欄位

`cb_detect_scan_runs` 至少要有：

```text
run_id
strategy
scan_date
started_at
finished_at
status
expected_total
scanned_count
result_count
complete
quality_status
source
schema_version
data_contract_source
generated_at
updated_at
payload
```

`cb_detect_scan_results` 至少要有：

```text
run_id
scan_date
symbol
name
payload
generated_at
updated_at
```

terminal key 必須看得到：

```text
symbol
cbCode
name
score
entry
run_id
updated_at
```

其中 `entry` 可以來自：

```text
payload.entryLabel
payload.selectedEntryModel
payload.tags
payload.sourceLayer
```

## Ready 條件

ready 必須同時符合：

```text
v_scanner_resource_health.strategy = CB
v_scanner_resource_health.status = ready
v_cb_latest_complete_run_health.source_status = ready
run.status = complete
run.complete = true
run.result_count > 0
cb_detect_scan_results readback count = run.result_count
schema_version >= cb-detect-complete-run-v1
/api/cb-detect-latest ok=true
/api/cb-detect-latest complete=true
/api/cb-detect-latest cacheSource=supabase-api
terminal key symbol/cbCode/name/score/entry 全部可讀
```

2026-06-26 已驗證狀態：

```text
API runId = cb-detect-20260626-155948
API count = 10
readback = 10 / 10
schemaVersion = cb-detect-complete-run-v1
cacheSource = supabase-api
terminal keys = 10 / 10 visible
```

## Not Ready / Stale 條件

stale：

```text
health latest_date 明顯落後最新有效 complete run
source_status = stale
```

not_ready：

```text
latest complete run missing
row_count = 0
API complete=false
API 使用 snapshot fallback
terminal key missing
```

failed：

```text
Supabase readback failed
result_count 與 readback count 不一致
schemaVersion below required
API 500 / 503
```

## Scanner 行為

```text
ready      => allow CB publish
stale      => preserve latest complete run; show warning
not_ready  => preserve latest complete run; show reason
failed     => preserve latest complete run; show failed reason
```

## 驗證指令

```powershell
Set-Location -LiteralPath C:\fuman-terminal
.\run-cb-battle-verify.ps1
```

成功條件：

```text
ok=true
issues=[]
warnings=[]
gate.dataExists=true
gate.healthViewCorrect=true
gate.terminalKeysVisible=true
```

## 排程建議

CB 驗證應在 CB detect scanner 完成後 5 分鐘跑。

runner 已接 `schedule-guard.ps1`，週末與 TWSE 休假日會跳過，不誤判壞資料。
