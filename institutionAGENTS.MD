# Institution / 買賣超 AGENTS.MD

Last updated: 2026-06-26 Asia/Taipei

這份文件只描述「買賣超 / institution」的 Supabase / API / terminal 戰鬥契約。後續 Codex 接手 institution 時，必須以本文件為準，不要退回 static JSON、Google Sheet、人工暫存檔或舊 FinMind-only 判斷。

## 核心目標

買賣超是 latest-complete / chip source 策略。

目標不是只確認 API 有資料，而是要達到：

```text
資料存在
health view 算得對
terminal scanner key 看得到
source coverage 足夠
complete run readback count 對齊
不因 source stale 發布新 run
```

terminal scanner gate 必須能自動判斷：

```text
ready      => 可以 publish 新 institution complete run
stale      => preserve latest complete run，顯示 health warning
not_ready  => preserve latest complete run，顯示 reason
failed     => preserve latest complete run，顯示 failed reason
```

## 絕對禁止

- 不要在 `v_institution_source_health.coverage_status != ready` 時發布新 institution run。
- 不要把 FinMind 停更誤判成 terminal 導管壞掉。
- 不要用空結果覆蓋 latest complete run。
- 不要只看 API count，不驗 Supabase complete-run readback。
- 不要把 source coverage 最少 1500 筆誤套到正式結果數。結果數只要求大於 0，source coverage 才要求 1500。
- 不要在休假日硬要求今天盤後籌碼。

## 權威來源

正式來源只認：

```text
v_institution_source_health
v_chip_flows_health
v_chip_flows_latest
v_institution_latest_complete_run
institution_scan_runs
institution_scan_results
v_scanner_resource_health
/api/institution-latest
```

source ingestion 可以來自：

```text
finmind_institutional_flows
finmind_margin_short
TWSE official fallback
TPEx official fallback
```

`v_chip_flows_latest` 與 `v_institution_source_health` 必須吃得到 official fallback rows，不可只認 `finmind:%`。

## 必要欄位

`v_institution_source_health` 至少要有：

```text
checked_trade_date
latest_trade_date
institutional_latest_trade_date
margin_latest_trade_date
unified_latest_trade_date
institutional_rows
margin_rows
unified_rows
valid_after_exclusion_rows
min_required_rows
stale_days
coverage_status
reason
suggested_scanner_behavior
```

`institution_scan_results` 至少要有：

```text
run_id
scan_date
strategy
code
name
rank
foreign_net
trust_net
dealer_net
total_net
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
code
name
foreign
trust
dealer
total
run_id
updated_at
```

## Ready 條件

ready 必須同時符合：

```text
v_scanner_resource_health.strategy = Strategy5 / institution
v_scanner_resource_health.status = ready
v_institution_source_health.coverage_status = ready
institutional_rows >= 1500
margin_rows >= 1500
valid_after_exclusion_rows >= min_required_rows
latest_trade_date 是最新有效交易日，允許 6/26 早盤使用 6/25 盤後籌碼
v_institution_latest_complete_run 有 complete=true 的最新 run
institution_scan_results readback count = run.result_count
/api/institution-latest ok=true 且 runId 可讀
terminal key code/name/foreign/trust/dealer/total 全部可讀
```

2026-06-26 已驗證狀態：

```text
API runId = institution-20260626-20260626075831
API count = 303
source latest_trade_date = 2026-06-25
institutionalRows = 1890
marginRows = 1847
unifiedRows = 1944
validAfterExclusionRows = 1944
complete run readback = 303 / 303
terminal keys = 303 / 303 visible
```

## Not Ready / Stale 條件

stale：

```text
coverage_status = stale
latest_trade_date 超過允許有效交易日
institutional_latest_trade_date / margin_latest_trade_date 停在舊日期
```

not_ready：

```text
source rows 不足
valid_after_exclusion_rows < min_required_rows
latest complete run missing
API runId missing
result rows empty
terminal key missing
```

failed：

```text
health view 讀不到
Supabase readback 失敗
API 500 / 503
run.result_count 與 readback count 不一致
```

## Scanner 行為

```text
ready      => allow institution publish
stale      => do not publish new run; keep latest complete run; show health warning
not_ready  => do not publish; preserve latest complete run; show reason
failed     => do not publish; preserve latest complete run; show failed reason
```

## 驗證指令

```powershell
Set-Location -LiteralPath C:\fuman-terminal
.\run-institution-battle-verify.ps1
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

買賣超驗證應在每日籌碼同步完成後跑。

目前建議：

```text
21:10 Institution chip-flow battle verify
```

runner 已接 `schedule-guard.ps1`，週末與 TWSE 休假日會跳過，不誤判壞資料。
