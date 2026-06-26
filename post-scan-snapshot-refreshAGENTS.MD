# 掃完立即顯示 Snapshot Refresh 契約

## 目標

每次 scanner 寫入新的 complete run 後，terminal 不能等舊快取自然過期，必須立即刷新 `desktop_route_snapshot`，讓 UI/API 讀到最新 run。

本契約驗證三件事：

1. `desktop_route_snapshot` 已成功刷新且不是 partial。
2. terminal compact API 實際命中 `supabase:desktop_route_snapshot`。
3. snapshot path 與 live path 的 `runId / count / date` 對齊。

只要任一條不成立，就視為「掃完立即顯示」失敗。

## 固定檔案

- 刷新腳本：`C:\fuman-terminal\refresh-desktop-route-snapshot.ps1`
- 契約驗證：`C:\fuman-terminal\scripts\verify-post-scan-snapshot-refresh-contract.js`
- 手動 runner：`C:\fuman-terminal\run-post-scan-snapshot-refresh-verify.ps1`
- 最新驗證結果：`C:\fuman-runtime\post-scan-snapshot-refresh-latest.json`
- 刷新 receipt：`C:\fuman-runtime\data\scan-receipts\desktop-route-snapshot.json`

## 自動行為

`refresh-desktop-route-snapshot.ps1` 成功刷新後，會自動執行：

```powershell
node scripts\verify-post-scan-snapshot-refresh-contract.js --max-age-ms=600000
```

因此所有已經呼叫 `refresh-desktop-route-snapshot.ps1` 的 scanner，掃完後都會自動驗證「立即顯示」契約。

特殊維護情境可用 `-SkipVerify` 略過驗證，但正式 scanner 不應略過。

## 覆蓋的 terminal endpoint

| strategy | endpoint | minimum |
| --- | --- | --- |
| Strategy1 | `/api/open-buy-latest?canvas=1&compact=1&shell=1&limit=60` | count >= 1 |
| Strategy3 | `/api/strategy3-latest?canvas=1&compact=1&shell=1&limit=60` | count >= 1 |
| Strategy4 | `/api/strategy4-latest?canvas=1&compact=1&shell=1&limit=70` | count >= 1 |
| Strategy5 | `/api/strategy5-latest?canvas=1&compact=1&shell=1&limit=70` | count >= 1 |
| Institution | `/api/institution-latest?canvas=1&compact=1&shell=1&limit=60` | count >= 1 |
| CB | `/api/cb-detect-latest?canvas=1&compact=1&shell=1&limit=60` | count >= 1 |
| Warrant | `/api/warrant-flow-latest?canvas=1&compact=1&shell=1&limit=60` | count >= 1 |

Strategy2 是 intraday/cache health，不走 desktop route snapshot 契約。

## Ready 條件

`post-scan-snapshot-refresh-latest.json` 必須同時為：

```json
{
  "ok": true,
  "status": "ready",
  "gates": {
    "dataExists": true,
    "healthViewCorrect": true,
    "terminalKeysVisible": true,
    "immediateDisplayReady": true
  }
}
```

每個 endpoint row 必須：

- `snapshotHit = true`
- `runIdAligned = true`
- `countAligned = true`
- `dateAligned = true`
- `rowCountOk = true`

## 失敗時 scanner 行為

- 不要覆蓋 terminal latest complete display。
- 保留上一個完整 run。
- 顯示 `reason`，例如：
  - `desktop_route_snapshot is stale`
  - `endpoint missing from desktop_route_snapshot bundle`
  - `snapshot API did not hit desktop route snapshot`
  - `runId mismatch`
  - `count mismatch`

## 手動驗證

只驗證目前 snapshot：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\fuman-terminal\run-post-scan-snapshot-refresh-verify.ps1"
```

先刷新再驗證：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\fuman-terminal\run-post-scan-snapshot-refresh-verify.ps1" -Refresh -Source manual-post-scan-check
```

正式 scanner 建議只呼叫：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\fuman-terminal\refresh-desktop-route-snapshot.ps1" -Source scanner-name
```

刷新腳本會自動驗證契約。
