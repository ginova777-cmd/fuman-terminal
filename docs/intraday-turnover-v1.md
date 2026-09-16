# 盤前／盤中周轉率接線

- 盤前保留近3～5日周轉率及原暖機排名。
- 09:00～13:30改用當日累計成交股數 / 官方已發行普通股股數 ×100；不改既有門檻。
- 分母：stock_tickers.payload.official_issued_common_shares，來源MOPS_OPEN_DATA_TWSE_TPEX；要求當日同步成功、來源出表日不晚於交易日，同步時間不可為未來。出表日不偽寫今天。資本額不作股數回退。
- 分子：Fugle aggregates或intraday quote原始total.tradeVolume；上市/上櫃/創新板一般股票契約為lots，×1000換股。未知市場/單位隔離，不按數值大小猜單位。
- 使用total.time原始統計事件時間；不使用heartbeat、接收時間或單根K量替代。要求同日、非未來、120秒內。
- Collector保留turnoverVolumeEvidence；sparse trades不得覆蓋此累計證據。
- Writer獨立保留ticker主檔，避免stock_universe payload合併覆蓋官方股數。
- 全市場可交易普通股排名，再套用母池既有資格；不是只對目前母池排序。
- source_status.payload.intraday_turnover_ranking保留全表、rank、缺口及分子/分母/日期/來源。
- 逐檔priorityMetrics.intradayTurnover與turnoverRankBasis供追溯。盤中資料不足時不退回歷史周轉率。
- 非盤中為NOT_DUE；缺資料標DATA_GAP，不補零。

## 驗證

`node scripts/test-daytrade-intraday-turnover.js` 產生隔離測試收據。

`node scripts/verify-daytrade-intraday-turnover.js --input=<獨立DB讀回排名JSON> --out=<驗證收據JSON>` 獨立重算公式、名單、排序及時間契約。

此驗證的complete只代表輸入契約驗證通過；data_coverage與all_market_data_ready另列，不能把全部DATA_GAP解讀為資料就緒。尚須正式部署後自然批次及anon读回，不能拿fixture當正式驗收。Collector需載入新版模組才會新增累計證據。
