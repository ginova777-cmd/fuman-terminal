# 當沖正式 Quote 交易日契約

正式表：`fugle_daytrade_quotes_live`  
正式欄位：`trade_date date not null`  
版本化唯讀入口：`v_fugle_daytrade_quotes_live_v2`  
契約版本：`daytrade-quotes-live-trade-date-v1`

`trade_date` 必須由該列本身的報價事件時間判定，順序為 `last_trade_time`、`quote_seen_at`、`updated_at`。既有資料部署回填也只使用這三個欄位，不用部署日期覆蓋舊報價。

Writer 的 REST、WebSocket Mother Pool readthrough 與最終 deep-scan readthrough 都必須在 upsert 時帶入 `trade_date`。無法取得有效日期的列不得寫入正式 quote table。

跨電腦 Reader 必須直接查詢：

```text
fugle_daytrade_quotes_live
  ?select=symbol,trade_date,quote_seen_at,last_trade_time,updated_at,...
  &trade_date=eq.YYYY-MM-DD
```

或使用版本化入口：

```text
v_fugle_daytrade_quotes_live_v2
  ?trade_date=eq.YYYY-MM-DD
```

版本化入口另提供：

```text
contract_version
quote_event_at
canonical_run_id
quote_trade_date_match
```

Viewer 必須要求 `quote_trade_date_match=true`，且 `canonical_run_id` 與來源 Gate 的同日 canonical run 相同。禁止用本機現在時間、receipt 時間或 payload 較新秒數取代正式 `trade_date`。

Canonical verifier：

```powershell
npm run verify:daytrade-quote-trade-date-contract -- --write-receipt
```

Receipt：

```text
C:\fuman-runtime\data\scan-receipts\daytrade-quote-trade-date-canonical-receipt-latest.json
```
