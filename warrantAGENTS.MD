# Warrant / 權證 AGENTS.MD

Last updated: 2026-06-26 Asia/Taipei

這份文件只描述「權證走向 / warrant flow」的 Supabase / API / terminal 戰鬥契約。後續 Codex 接手權證時，必須以本文件為準，不要退回舊 snapshot、static JSON 或人工結果。

## 核心目標

權證是 latest-complete 策略。

目標不是只確認權證頁有資料，而是要達到：

```text
資料存在
health view 算得對
terminal scanner key 看得到
schemaVersion 正確
API full dataContract 正確
complete run readback count 對齊
```

terminal scanner gate 必須能自動判斷：

```text
ready      => 可以 publish / 顯示 latest complete run
stale      => preserve latest complete run，顯示 warning
not_ready  => preserve latest complete run，顯示 reason
failed     => preserve latest complete run，顯示 failed reason
```

## 絕對禁止

- 不要在 `v_warrant_latest_complete_run_health.source_status != ready` 時發布新權證資料。
- 不要在 schemaVersion 不足時發布。
- 不要只驗 compact API；必須驗 full API dataContract。
- 不要用空的 match / volume 結果覆蓋 latest complete run。
- 不要把 latest-complete 的前一交易日資料誤判 stale。
- 不要讓 `result_count` 與 `warrant_flow_scan_results` readback 不一致。

## 權威來源

正式來源只認：

```text
warrant_flow_scan_runs
warrant_flow_scan_results
v_warrant_flow_latest_complete_run
v_warrant_latest_complete_run_health
v_scanner_resource_health
/api/warrant-flow-latest
```

權證 API 必須使用 Supabase complete-run：

```text
cacheSource = supabase-api
transport.gate = run_id 或 contract_valid_run
```

## 必要欄位

`warrant_flow_scan_runs` 至少要有：

```text
run_id
strategy
scan_date
finished_at
status
expected_total
scanned_count
result_count
complete
quality_status
schema_version
data_contract_source
updated_at
payload
```

`warrant_flow_scan_results` 至少要有：

```text
run_id
scan_date
strategy
result_type
code
name
underlying_code
underlying_name
score
rank
reason
payload
complete
quality_status
schema_version
data_contract_source
generated_at
updated_at
```

terminal key 必須看得到：

```text
result_type
code 或 underlying_code 或 payload.underlyingCode 或 payload.warrantCode
name 或 underlying_name 或 payload.underlyingName 或 payload.warrantName
score 或 payload.score 或 payload.finalScore 或 payload.warrantHeatScore
reason 或 payload.reason 或 payload.tags
run_id
updated_at
```

## Ready 條件

ready 必須同時符合：

```text
v_scanner_resource_health.strategy = Warrant
v_scanner_resource_health.status = ready
v_warrant_latest_complete_run_health.source_status = ready
run.status = complete
run.complete = true
run.expected_total > 0
run.expected_total = run.scanned_count
run.result_count > 0
warrant_flow_scan_results readback count = run.result_count
schema_version >= warrant-flow-run-id-complete-v1
/api/warrant-flow-latest full API dataContract.ok = true
match rows > 0
volume rows > 0
terminal key resultType/code/name/score 全部可讀
```

2026-06-26 已驗證狀態：

```text
API runId = warrant-flow-20260625-20260626075845
schemaVersion = warrant-flow-run-id-complete-v1
readback = 359 / 359
match = 120
volume = 236
single = 3
terminal keys = 359 / 359 visible
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
match rows empty
volume rows empty
schemaVersion missing
terminal key missing
```

failed：

```text
API dataContract failed
Supabase readback failed
result_count 與 readback count 不一致
schemaVersion below required
```

## Scanner 行為

```text
ready      => allow warrant publish
stale      => preserve latest complete run; show warning
not_ready  => preserve latest complete run; show reason
failed     => preserve latest complete run; show failed reason
```

## 驗證指令

```powershell
Set-Location -LiteralPath C:\fuman-terminal
.\run-warrant-battle-verify.ps1
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

權證驗證應在 warrant-flow scanner 完成後 5 分鐘跑。

目前正式排程：

```text
20:55 Warrant flow battle verify
```

runner 已接 `schedule-guard.ps1`，週末與 TWSE 休假日會跳過，不誤判壞資料。
