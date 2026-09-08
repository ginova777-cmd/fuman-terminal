# Mother Pool 內外盤 2,000 張正式契約

版本：`daytrade_side_volume_2000_canonical_verifier_v1`
時區：`Asia/Taipei`

## 唯一正式鏈

```text
Fugle regular-board quote trades/aggregates
  -> scripts/run-daytrade-source-writer.js
  -> fugle_daytrade_priority_pool.payload.motherPoolMetrics
  -> public.v_fugle_daytrade_mother_pool.mother_pool_metrics
  -> scripts/verify-daytrade-side-volume-contract.js
  -> daytrade-side-volume-2000-canonical-receipt-YYYYMMDD.json
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

Writer 必須在 `mother_pool_metrics` 發布下列 camelCase 欄位；priority payload 同時保留 snake_case 相容欄位：

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

Receipt 路徑：

```text
C:\fuman-runtime\data\scan-receipts\daytrade-side-volume-2000-canonical-receipt-YYYYMMDD.json
C:\fuman-runtime\data\scan-receipts\daytrade-side-volume-2000-canonical-receipt-latest.json
```

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
