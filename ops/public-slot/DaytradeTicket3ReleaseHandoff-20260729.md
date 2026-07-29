# 當沖 Daytrade Source 工單 3 Release / Supabase 交接

日期：2026-07-29（Asia/Taipei）
範圍：只處理 dedicated daytrade source、WebSocket、全市場母池、Mother 300、TOP40、09:01 1 分 K 與 formal gate。
不處理：會員、UI、/88、desktop/mobile、scorecard closure。

## Release 版本

- Release worktree HEAD：`a283cf40`
- 本輪 hardening：非 `ok/ready` source 不得帶 `websocket_formal_ready=true`；否則 verifier 明確回 `websocket_formal_ready_true_for_nonready_source`。
- 只同步工單 3 相關 commit 鏈；不要混入其他 UI 或會員變更。

## SQL 部署順序

請在正式 Supabase / Release 流程執行，依序套用：

1. `ops/public-slot/DaytradeMotherPoolContractViews_20260709.sql`
2. `ops/public-slot/DaytradeSourceCanonicalGatePriorityFirstPatch_20260708.sql`

第一份先建立 Mother pool contract views，第二份再引用 Mother health 並更新 canonical / unattended gate。兩份 SQL 都必須保留既有 view 欄位順序；不得用 `DROP VIEW ... CASCADE`，不得直接改名或刪除既有 view 欄位。

## Writer / WebSocket

- 正式水源主機只允許一個 daytrade writer instance。
- writer 必須使用 Fugle WebSocket trades、aggregates、candles；REST 只能 seed、補洞與校正。
- 必須回寫全市場普通股、dynamic Mother 300、formal priority 40、source status、canonical gate 與 09:01 evidence。
- 不手動偽造 07:00、08:45、09:01 evidence；等待自然排程產生。
- 不用 shared source、舊 snapshot 或 previous-good 提升今日 formal gate。

## 自然 writer 後唯讀驗證

在有 `package.json` 的正式 repo 執行：

```powershell
npm run verify:daytrade-source-contract-alignment
npm run verify:daytrade-mother-pool-contract
npm run verify:daytrade-full-market-contract
npm run verify:daytrade-ticket3-source -- --live --require-live
```

## 可宣告正式 A 的最低條件

- rows：Mother `300`、priority `40`、formal `40`
- mother freshness `>= 0.80`
- formal freshness `>= 0.95`
- formal max quote age `<= 120s`
- WebSocket connected/authenticated/streaming，channels 含 `trades,aggregates,candles`
- `websocket_formal_ready=true` 且 source status 為 `ok/ready`
- 09:01 required/ready/trade_date/schema evidence 全部存在
- source、canonical、unattended 三層欄位與 gate 完全一致

## 失敗處理

任一條件不滿足時，保持 `FAIL-CLOSED`：不得更新 latest、不得寫空結果、不得宣告 A 或 unattended YES；只能保留 previous-good，並留下 reason code 與 readback 證據。

目前已知 production blocker：source 曾為 `stopped`，Mother/formal freshness 為 `0/0`，且 canonical view 尚未包含新增欄位。完成 SQL、writer 與自然排程後，才可重新驗收。
