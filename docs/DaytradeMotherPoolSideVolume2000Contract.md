# Mother Pool 內外盤 2,000 張正式契約

版本：`daytrade_side_volume_2000_canonical_verifier_v3`／`cross-computer-symbol-isolation-v3`

v3 新增不可變的逐檔結果入口 `v_fugle_daytrade_side_volume_symbol_readback`。摘要若因個別股票資料缺口而為 `partial`，同一 `verification_run_id` 內 `source_common_valid=true` 且 `quality_status=READY` 的個股仍可由 Viewer 使用；`DATA_GAP` 個股單獨隔離。只有共同來源身分、讀取或批次完整性失敗，才使用 `BLOCKED_COMMON` 阻擋整批。

正式 Writer wrapper 在 09:00–13:30 成功完成來源寫入後，會呼叫唯一 canonical verifier，以 300 秒為預設節流間隔，自動寫本機 receipt 並發布 Supabase 摘要及逐檔結果。verifier 為 `partial` 時保留真實阻擋原因，但不把來源 Writer 的成功執行偽裝成失敗；排程狀態另寫入 `C:\fuman-runtime\state\daytrade-side-volume-verifier-schedule.json`。
時區：`Asia/Taipei`

## 唯一正式鏈

```text
Fugle regular-board quote trades/aggregates
  -> scripts/run-daytrade-source-writer.js
  -> fugle_daytrade_priority_pool.payload.motherPoolMetrics
  -> public.v_fugle_daytrade_mother_pool.mother_pool_metrics
  -> scripts/verify-daytrade-side-volume-contract.js
  -> fugle_daytrade_side_volume_verification_receipts
  -> v_fugle_daytrade_side_volume_verification_readback (anon read-only)
```

本契約不改 Mother Pool 容量、不另外啟動 Writer，也不允許 Viewer 自行推算或回填欄位。`v_fugle_daytrade_mother_pool` 仍由既有 priority-pool payload 對外提供 JSON，因此不需要新增另一個 Supabase view。

## 數值定義

| 欄位 | 正式定義 |
| --- | --- |
| `insideVolume` | Fugle `total.tradeVolumeAtBid`，當日累計內盤已成交量。 |
| `outsideVolume` | Fugle `total.tradeVolumeAtAsk`，當日累計外盤已成交量。 |
| `sideVolumeTotal` | 僅可用 `insideVolume + outsideVolume` 計算。 |
| `sideVolumeUnit` | 固定為 `lots`；正式水源是台股整股盤，數值已是張數。 |
| `sideVolumeAvailable` | 兩側數值、單位、來源事件時間、交易日及 canonical run 全部有效且同日才為 `true`。 |
| `sideVolumeGe2000Lots` | `sideVolumeAvailable=true` 且 `sideVolumeTotal >= 2000`。 |
| `outsideVolumeGeInsideTimes2` | `sideVolumeAvailable=true` 且 `outsideVolume >= insideVolume * 2`。舊 `outsideVolumeGtInsideTimes2` 僅保留相容別名，採相同的 `>=` 結果。 |

禁止以 `totalVolume` 或 `total_volume` 代替缺少的內盤、外盤或兩者合計。剛好 `2,000` 張必須通過門檻。

## 成交範圍

- 這是已成交量，不是委買／委賣掛單量；也不是五檔 `bid_volume`、`ask_volume`。
- 正式訂閱是一般整股盤，`sideVolumeUnit=lots`，不含盤中零股資料。
- Fugle 內外盤統計不包含開盤集合競價的第一筆成交。
- 只有可歸類至 bid 或 ask 的成交進入兩個欄位；未歸類成交不在兩者中。
- 因此 `insideVolume + outsideVolume` 可以小於 `totalVolume`。差額只作診斷，不能補回 2,000 張門檻。

## Canonical readback 欄位

Writer 必須在 `mother_pool_metrics` 發布下列 camelCase 欄位；priority payload 同時保留 snake_case 相容欄位。若兩種命名同時存在但值不同，canonical verifier 必須回報 `CAMEL_SNAKE_VALUE_CONFLICT`：

```text
insideVolume
outsideVolume
sideVolumeTotal
sideVolumeUnit
sideVolumeUnitKnown
sideVolumePresent
sideVolumeAvailable
sideVolumeThresholdLots
sideVolumeThresholdMet
sideVolumeGe2000Lots
sideVolumeSource
sideVolumeSourceEventAt
sideVolumeSourceEventAgeSeconds
sideVolumeTradeDate
sideVolumeCanonicalRunId
sideVolumeSameTradeDate
sideVolumeSameCanonicalRun
sideVolumeDefinition
sideVolumeIncludesOddLot
sideVolumeIncludesOpeningAuctionFirstTrade
sideVolumeIncludesUnclassifiedTrades
sideVolumeDifferenceFromTotal
sideVolumeDifferenceExplanation
outsideInsideRatio
outsideVolumeGeInsideTimes2
outsideVolumeGtInsideTimes2
```

身份必須閉合：

```text
sideVolumeTradeDate == Mother Pool trade_date
sideVolumeCanonicalRunId == fugle_daytrade_source:YYYYMMDD:canonical
sideVolumeSourceEventAt 對應原始 Fugle total.time / aggregate event time
```

不得用 Mother Pool `updated_at` 或 `mother_updated_at` 取代 `sideVolumeSourceEventAt`。舊的內外盤即使被新一輪母池包裝，`sideVolumeAvailable` 仍必須是 `false`。

## Viewer 判定順序

Viewer 只能用 anon／authenticated 唯讀，並依原有正式順序先驗 source status 與 canonical gates，再讀 Mother Pool。單檔量能判定順序如下：

1. `sideVolumeUnit == lots`，否則 `SIDE_VOLUME_UNIT_MISSING_OR_UNKNOWN`。
2. `sideVolumeAvailable == true`，並核對事件時間、交易日與 run_id，否則 `SIDE_VOLUME_DATA_GAP_OR_STALE`。
3. 計算／核對 `sideVolumeTotal == insideVolume + outsideVolume`，禁止讀 `total_volume` 代替。
4. `sideVolumeTotal >= 2000` 才通過；不足顯示 `SIDE_VOLUME_BELOW_2000_LOTS`。

本門檻只是 Viewer 的進場條件，不是 Mother Pool 入池條件；不得因 2,000 張門檻移除或增加母池股票。

## runner + verifier + receipt

Runner：

```powershell
node --use-system-ca scripts\run-daytrade-source-writer.js --apply
```

Canonical verifier（唯讀，不寫 Supabase）：

```powershell
npm run verify:daytrade-side-volume-contract
```

Canonical receipt：

```powershell
npm run verify:daytrade-side-volume-contract:receipt
```

發布可跨電腦 receipt：

```powershell
npm run verify:daytrade-side-volume-contract:publish
```

Receipt 路徑：

```text
C:\fuman-runtime\data\scan-receipts\daytrade-side-volume-2000-canonical-receipt-YYYYMMDD.json
C:\fuman-runtime\data\scan-receipts\daytrade-side-volume-2000-canonical-receipt-latest.json
```

本機 JSON 只供隔離診斷。Viewer 的正式入口是：

```text
GET /rest/v1/v_fugle_daytrade_side_volume_verification_readback
  ?select=*
  &trade_date=eq.YYYY-MM-DD
  &canonical_run_id=eq.fugle_daytrade_source:YYYYMMDD:canonical
  &order=verified_at.desc
  &limit=1
```

逐檔正式入口（不能從摘要 `source_view` 猜名稱）：

```text
GET /rest/v1/v_fugle_daytrade_side_volume_symbol_readback
  ?select=*
  &verification_run_id=eq.<receipt.verification_run_id>
  &order=symbol.asc
```

兩個 view 均已 `GRANT SELECT TO anon, authenticated, service_role`；raw table 不提供 anon 寫入或 schema 列舉權限。REST 根目錄回 401 不影響指定 view 的 SELECT 契約。

## Receipt 與逐檔 schema

Receipt 的分母固定為 `symbol_result_rows`：

```text
symbol_result_rows = mother_pool_rows + diagnostic_extra_rows
ready_rows + data_gap_rows + blocked_common_rows = symbol_result_rows
below_threshold_rows <= ready_rows
```

`mother_pool_rows` 是該輪實際母池成員；`diagnostic_extra_rows` 是明確標示 `in_mother_pool=false` 的診斷股票。若 157 檔母池另讀 3030，receipt 必須顯示 `mother_pool_rows=157`、`diagnostic_extra_rows=1`、`symbol_result_rows=158`；3030 不因診斷列取得母池資格。

Receipt 主要型別：識別字／狀態／view 為 `text`，日期為 `date`，`verified_at` 為 `timestamptz`，所有 count 為 `integer`，`complete/source_common_valid` 為 `boolean`，`failed_checks` 為 `text[]`，來源與診斷摘要為 `jsonb`。

逐檔主要型別：量為 `numeric`，時間為 `timestamptz`，識別字／品質／門檻狀態為 `text`，資格與品質旗標為 `boolean`，`failed_checks` 為 `text[]`。`threshold_status` 合法值只有：

```text
READY_GE_2000_LOTS
READY_BELOW_2000_LOTS
DATA_GAP
BLOCKED_COMMON
```

- `READY_GE_2000_LOTS`：單檔品質完整且達 2,000 張，可交由 Viewer 繼續判斷其他條件。
- `READY_BELOW_2000_LOTS`：資料完整但未達門檻，等同單檔 `NO_MATCH`，不是資料缺口。
- `DATA_GAP`：該檔缺欄位、錯日期／run、或驗證當下事件超過 120 秒；只隔離該檔。
- `BLOCKED_COMMON`：共同來源、批次身分、讀取或 universe 完整性錯誤；整批阻擋。

摘要為 `partial` 不能推定任何單檔 PASS；Viewer 必須綁定 receipt 的 `verification_run_id` 再讀逐檔 `quality_status`。

## 五分鐘 verifier 與 120 秒新鮮度

五分鐘 verifier 只證明 `verified_at` 當下的一個不可變批次。它不能保證兩次 verifier 之間持續新鮮，也不能把 120 秒放寬到 300 秒。

- 可沿用：`trade_date`、`canonical_run_id`、單位、來源定義、2,000 張門檻、不可變批次身分。
- 必須在 Viewer 決策當下重新核對：最新同批 `side_volume_source_event_at`、內盤、外盤、合計與事件年齡 `<=120` 秒。
- `source_event_age_seconds_at_verification` 與 `source_fresh_120s_at_verification` 是 verifier 當下證據，不是未來五分鐘的通行證。
- 事件超過 120 秒只能 `DATA_GAP`／等待下一輪，不得以 Mother Pool `updated_at` 刷新或延長年齡。

## 不可變發布

Producer 的來源 evidence 可以用同槽 key 更新；canonical verifier 每次必須產生新的 `verification_run_id`。發布流程只允許 receipt 從 `pending` 一次轉為 `complete/partial/failed`，逐檔列一經插入禁止 update/delete，final receipt 禁止再次更新。後到完整資料必須建立新 verification run，不得改寫 Viewer 已綁定的舊 run。

Viewer 使用 anon key，禁止 service role。Reader 對更新中批次最多重試三次；仍不完整時保留 `DATA_GAP`。不可讀另一日期或另一 `canonical_run_id` 湊成功，也不可只保留成功 receipt 而刪除失敗紀錄。

Receipt 會分別統計 `read_rows`、`contract_complete_rows`、`missing_field_rows`、`wrong_trade_date_rows`、`wrong_run_rows`、`stale_rows`、`threshold_met_rows`。新鮮度只看 `sideVolumeSourceEventAt`；Mother Pool `updated_at` 不得更新它。

只有以下條件同時成立才可 `complete=true`：

- 正式碼與靜態邊界測試通過；
- anon 可讀當日 Mother Pool；
- 當日 Mother Pool 欄位契約完整；
- anon 可讀 3030 的同日內外盤樣本；
- anon 可讀另一檔 `sideVolumeTotal >= 2000` 的同日樣本；
- 兩份樣本的 `sideVolumeTradeDate` 與 `sideVolumeCanonicalRunId` 相同；
- `failed_checks=[]`、`first_blocker=null`、`exitCode=0`。

若 3030 當日不足 2,000 張，它仍可作同日欄位樣本，並應顯示 `SIDE_VOLUME_BELOW_2000_LOTS`；第二檔樣本才負責證明 `>= 2000` 邊界確實可通過。

## 防漂移

`scripts/verify-daytrade-mother-pool-closed-loop.js --static-only` 已引用本 canonical verifier 的靜態模式。任何人移除單位、事件時間、交易日、run_id、2,000 張邊界或把 `>=` 改回 `>`，Mother Pool 靜態閉環都會失敗。

舊 Mother Pool verifier 檔案維持退役，不得恢復引用。正式 Mother Pool 閉環仍只有 `verify-daytrade-mother-pool-closed-loop.js`，本 verifier 僅負責其內外盤子契約。
