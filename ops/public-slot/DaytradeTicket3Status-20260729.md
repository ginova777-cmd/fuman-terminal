# 當沖 Daytrade Source 工單 3 驗收追蹤

更新時間：2026-07-29（Asia/Taipei）
範圍：只涵蓋 dedicated daytrade source、WebSocket、母池、1 分 K 與 formal gate。
不涵蓋：會員、終端 UI、/88、desktop/mobile。

## 狀態矩陣

| 項目 | 實作方式 | 目前狀態 | 下一個驗收 |
| --- | --- | --- | --- |
| 07:00 暖機 1 分 K | REST seed 只做低頻補洞，WebSocket candles 持續增量；不以補跑冒充自然證據 | 程式 contract PASS；production 今日自然 evidence 尚未閉環 | 下一個交易日讀 07:00 natural evidence |
| 全市場普通股母池 | active common stock 全量暖機，排除 ETF、權證、停牌、黑名單，再動態排序 | 程式 contract PASS；最後 live evidence active=1664，但 freshness 仍需自然 writer readback | 確認 full-market evidence 與 mother pool 同日 |
| Mother pool 300 | full market → dynamic mother pool，固定 300 檔，freshness-first | REST 實際 rows=300；mother freshness=0，hard gate FAIL | 下一次自然 writer 使 coverage >=0.80 |
| Priority TOP40 | 從 mother pool 排名取 40 檔，作為高頻優先，不是全市場唯一入口 | REST 實際 rows=40；priority freshness=1，但不能單獨提升總 gate | canonical/unattended 同步回讀 40/40 與 formal freshness |
| 盤中新股動態進池 | 漲幅、MA5/10/35、量能放大、量比 >=2、成交量 top100、價格 10~1000 等規則 | 程式與 static verifier PASS；不可由舊快照補成今日候選 | 交易時段確認候選與母池更新 evidence |
| WebSocket source | 最多 2 條連線、trades/aggregates/candles、REST disabled、單例 collector、狀態年齡 <=300 秒 | local transport contract PASS；production source 最後為 stopped，不能代替自然 streaming evidence | 水源主機自然執行並回讀 formal_ready=true |
| 09:01 專用 1 分 K | dedicated daytrade intraday_1m；必要時 quote-derived 但必須標 source；缺證據即 fail-closed | contract PASS；production 缺 `required/ready/trade_date/schema` 自然欄位 | 讀到 trade_date、candle_time、high、low、source payload |
| Formal gate | 必須同時通過 mother=300、mother freshness>=0.80、formal=40、formal freshness>=0.95、quote age<=120；不得用 shared/fallback 提升 A | canonical/unattended 為 D/not_ready，formal_entry_allowed=false，正確 fail-closed | canonical、unattended、source_status 三層欄位一致 |
| Futopt / TXF | dedicated daytrade futopt source；股票期貨與 TXF 分層，08:45 baseline 不可猜測 | runtime 有股票期貨 rows，但 production canonical 曾讀到 not_required/舊資料 | 下一次自然 08:45 驗證 ready 與 baseline |
| 三個正式 view | mother_pool=300、priority_top40=40、formal_priority_top40=40；REST HTTP 200 且 rows>0 | REST 實際 rows=`300 / 40 / 40`；freshness=`0 / 0`，formal max age=`193045s`，不可正式掃描 | 下一次自然 writer 回水後重讀 rows、trade_date、freshness |
| Fail-closed / previous good | source 未 A 不更新 latest、不寫空結果、不讓 degraded/NO 進 detected history | 已有 writer 與 watchdog guard，最後 evidence preserve_previous_good=true | 驗證 blocked receipt 與 latest pointer 未更新 |

## 已驗證

- Release commit：以 Release worktree 的 `HEAD` 為準，最終 SHA 以交接回報為準。
- `npm run verify:daytrade-source-writer`：PASS。
- `npm run verify:daytrade-ticket3-source`：PASS。
- writer、ticket verifier、WebSocket verifier：Node syntax PASS。
- WebSocket transport regression：已修正並由 static verifier 證明。
- Mother-pool SQL 已改為可重複 `CREATE OR REPLACE VIEW`，移除會破壞相依 view 的 `DROP VIEW`。
- Mother-pool verifier 已將 `mother >= 0.80`、`formal >= 0.95`、`quote age <= 120s` 設為 hard gate；coverage=0 現在確實 FAIL。
- Formal scope 已固定為 `mother_pool_300_rotating_deep_scan`，不再接受只掃 TOP40。

## Production 目前不得宣告完成的原因

- 最近 live source 為盤後 stopped/previous-good，不是新的自然暖機證據。
- canonical/unattended 曾回 `25/28` required checks。
- canonical/unattended 的 `websocket_formal_ready` 與 source payload 不一致。
- futopt canonical 曾回 `not_required`，但 dedicated runtime 已有股票期貨/TXF rows，需完成 view/readthrough 對齊。
- 尚未取得新的自然 07:00、08:45、09:01 evidence。

## Release Owner 下一步

1. 將本輪 Release HEAD 同步到真正的 daytrade writer/Supabase SQL；不要啟動第二個 writer。
2. 等下一次自然排程，不手動補造 07:00/08:45/09:01 evidence。
3. 在正式 repo 執行：
   - `npm run verify:daytrade-source-contract-alignment`
   - `npm run verify:daytrade-mother-pool-contract`
   - `npm run verify:daytrade-full-market-contract`
   - `npm run verify:daytrade-ticket3-source -- --live --require-live`
4. 只有三層 gate 欄位一致、三個 view rows 正確、09:01 evidence 存在且所有 freshness 達標，才可進下一層 formal scan。

目前結論：程式 contract 已完成；production 自然水源與 formal gate 尚未閉環；維持 fail-closed，不宣告 A 或 unattended YES。
## 最新只讀 readback

checked_at：2026-07-29 16:16（Asia/Taipei；UTC 08:16）

| 欄位 | 實際值 | 判定 |
| --- | --- | --- |
| source_status | `stopped`；最後更新 13:33:26 | fail-closed，盤後不可當自然暖機 PASS |
| source gate | `B / not_ready`；formal entry `false` | 不允許正式進場 |
| canonical / unattended gate | `D / not_ready`；`25/28` required checks | 欄位與 gate 尚未對齊 |
| priority | 40/40；fresh coverage `1.0`；quote age `43s` | priority 數字達標，但不能單獨提升總 gate |
| full market | active `1664`；fresh quote `317`；coverage 欄位缺失 | 全市場 evidence 不完整 |
| mother pool | base rows `300`；base eligible `0`；fresh coverage `0` | production view freshness 不可用 |
| formal priority | rows `40`；fresh coverage `0`；max quote age `190649s` | 不可正式掃描 |
| WebSocket runtime | connected/authenticated/streaming；trades, aggregates, candles；age `2s` | transport local PASS |
| 1 分 K | today symbols `881`；stale `0` | 數據有讀到，但 09:01 natural 欄位仍缺 |
| 09:01 evidence | required/ready/trade_date/schema 欄位缺失 | 自然 evidence 未閉環 |
| futopt/TXF | runtime 有股票期貨/TXF rows；canonical 仍為 `not_required` | source/view readthrough 未對齊 |

本輪 verifier 結果：`verify:daytrade-ticket3-source -- --live --require-live` FAIL（缺 WebSocket/09:01 live fields）；`verify:daytrade-source-contract-alignment` FAIL_CLOSED_ALIGNED；`verify:daytrade-mother-pool-contract` FAIL；`verify:fugle-websocket-sources` local transport PASS。

因此目前仍是「程式 contract 完成、production natural evidence 未閉環」，不能宣告 A 或 unattended YES。

## 工單 3 新要求 hardening（2026-07-29 16:50）

本輪已補齊「全市場 → mother 300 → priority/formal TOP40」的正式 contract：

| 項目 | 實作方式 | 目前狀態 | 下一個驗收 |
| --- | --- | --- | --- |
| Mother pool cardinality | verifier 直接讀母池最多 301 筆並要求實際 rows=300 | 程式 PASS；live rows=300 | 下一次自然 writer 仍須 freshness >=0.80 |
| Mother pool hard gate | canonical A 要求 mother=300 且 freshness >=0.80 | SQL patch 已完成；production 尚未部署 | 先套 mother-pool views，再套 canonical gate SQL |
| Formal pool hard gate | formal=40、freshness >=0.95、max quote age <=120s | SQL patch 已完成；production 尚未部署 | live canonical/unattended/source 三層一致 |
| Formal scope | `mother_pool_300_rotating_deep_scan`；TOP40 只作速度優先 | writer、SQL、verifier 已一致 | 自然 writer 回寫同一 scope |
| Fail-closed reason | mother/formal 不足各自回固定 reason code | verifier 已支援 | readback 不得只回泛用 `not_ready` |

本輪實際驗證：

- `verify:daytrade-ticket3-source`：PASS，static checks 全部通過。
- `verify:daytrade-source-writer`：PASS，mother min/max=300、formal limit=40、batch=40、concurrency=1。
- `verify:daytrade-mother-pool-contract`：FAIL-CLOSED（實際 mother rows=300、priority=40、formal=40；mother fresh=0、formal fresh=0、formal max age=192664s）。
- `verify:daytrade-ticket3-source -- --live --require-live`：FAIL（source 最後更新 13:33:26，缺 WebSocket/09:01 live evidence 欄位）。
- `verify:daytrade-source-contract-alignment`：目前 production canonical view 尚未包含新增欄位，REST 回 HTTP 400 `column v_fugle_daytrade_canonical_gate.mother_pool_symbols does not exist`；這是 SQL 尚未部署的明確 blocker。

結論：本輪已完成程式與 SQL contract hardening；production 水源 freshness、canonical view SQL deploy、自然 09:01 evidence 尚未完成，因此仍不得宣告正式 A 或 unattended YES。

## 最新只讀覆核（2026-07-29 16:56 Asia/Taipei）

| 項目 | 實際結果 | 判定 |
| --- | --- | --- |
| 母池三層 rows | `300 / 40 / 40` | rows contract PASS |
| Mother freshness | `0 / 300 = 0` | FAIL，要求 >=0.80 |
| Formal freshness | `0 / 40 = 0` | FAIL，要求 >=0.95 |
| Formal max quote age | `193045s` | FAIL，要求 <=120s |
| Source live | `stopped`，最後更新 `13:33:26` | 無新的自然 writer evidence |
| WebSocket / 09:01 | 缺 `websocket_last_message_at`、symbol/freshness 與 09:01 欄位 | natural evidence 未閉環 |
| Production canonical | 新增 mother contract 欄位仍未部署 | alignment 不能完成 |

本次只讀驗證仍為：mother-pool contract `FAIL`、ticket3 live `FAIL`。因此狀態表維持「程式 contract PASS、production 水源未刷新、不可宣告 A」。
