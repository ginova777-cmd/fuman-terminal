# Mother Pool A01–A19 / B01–B24 接線清冊

本清冊區分「程式接線／隔離驗證／正式部署／自然盤驗收」，不以單一綠燈推論全項完成。

| 編號 | 來源／核心欄位 | Writer／接收介面 | Verifier／receipt | 目前狀態 |
|---|---|---|---|---|
| A01 | market calendar、trade_date、canonical_run_id、lease | daytrade source writer identity | writer identity verifier／lease receipt | 隔離通過；正式／自然待驗 |
| A02 | stock master、market、type、price eligibility | source writer universe filter | universe verifier／source receipt | 隔離通過；正式待驗 |
| A03 | Strategy2/3V2/4/5、買賣超、/88、追蹤、期貨聯集 | priority source assembly | source-bundle verifier／warmup receipt | 部分接線；來源自然讀回待驗 |
| A04 | 最近10日量價事件、2.5x、2x、漲停、7% | preopen mother-pool evaluator | evaluator verifier／preopen receipt | 隔離通過；正式待驗 |
| A05 | 官方當沖量／總量／unit／date | FinMind/TWSE/TPEx adapter | daytrade-ratio verifier | 隔離通過；官方自然資料待驗 |
| A06 | trades/aggregates/candles、事件時間 | Fugle WebSocket collector | collector evidence verifier | 接線存在；自然盤待驗 |
| A07 | quote、OHLC、volume、source_event_at | source writer quote/history path | freshness/field verifier | 部分接線；自然覆蓋待驗 |
| A08 | 天然1m K、MA20輸入、synthetic | historical minute adapter／MA map | MA20 verifier／receipt | 隔離通過；自然覆蓋待驗 |
| A09 | ready_ma20/current_pool >=90% | warmup status writer | MA20 coverage verifier | 契約接線；正式自然待驗 |
| A10 | 08:30 Top3 A/B/C、industry evidence | opening bridge + preservation module | HANDOFF_ACK | 接線存在；自然晨報待驗 |
| A11 | bridge evidence persistence | source writer preservation | PERSISTENCE_ACK | 驗證腳本存在；兩次自然刷新待驗 |
| A12 | native trial、is_trial、trial_event_at | preopen producer | trial verifier／freeze receipt | 接線存在；自然時槽待驗 |
| A13 | preopen runner/readback/verifier | canonical preopen runner | receipt contract | 隔離可驗；正式待驗 |
| A14 | preopen closeout/off-session | source writer closeout | closeout verifier | 部分接線；自然待驗 |
| A15 | 盤前新增模組來源與欄位 | preopen writer path | A15 verifier | 未完整納入正式 writer |
| A16 | minute inside/outside、baseline | minute-side source/batch | side-volume verifier | 隔離通過；正式讀回待驗 |
| A17 | 盤前策略型態欄位 | preopen strategy evidence | strategy verifier | 接線範圍待規格確認 |
| A18 | 盤前事件／證據欄位 | preopen event path | A18 verifier | scope 尚未鎖定 |
| A19 | 盤前完整性／交付欄位 | preopen handoff path | A19 verifier | scope 尚未鎖定 |
| B01 | quote、今日1m K、bar time、synthetic、volume | collector→cache→writer | B01 readback verifier | 隔離測試通過；自然覆蓋待驗 |
| B02 | cumulative volume/value、unit、source event | trade-value evidence + ranking | B02 receipt verifier | 隔離測試通過；正式 anon 待驗 |
| B03 | turnover volume shares、issued shares、date | intraday-turnover module | B03 verifier | 隔離測試通過；正式 anon 待驗 |
| B04 | full-market volume expansion／price discovery | industry discovery path | B04 verifier | 部分接線；自然逐輪待驗 |
| B05 | official/self-declared industry mapping | industry catalog | mapping verifier | 43/60+ catalog scope unresolved |
| B06 | value×direction、net flow、breadth、concentration | industry flow calculator | flow verifier | 部分接線；自然逐輪待驗 |
| B07 | same canonical prior-round delta | flow delta state | comparability verifier | 部分接線；自然逐輪待驗 |
| B08 | Top3／sudden inflow >=NT$500m | industry discovery | B08 receipt verifier | 部分接線；自然逐輪待驗 |
| B09 | union candidates、source flags、eligibility | discovery merge | candidate verifier | 部分接線；自然逐輪待驗 |
| B10 | same-round injection、fair scan >=10%、deep <=60 | mother-pool priority update | injection verifier | 60-cap tests pass；自然輪掃待驗 |
| B11 | immutable snapshot、sequence、pagination | snapshot publication/readback | snapshot verifier | 隔離與唯讀 runtime snapshot pass；SQL部署待確認 |
| B12 | rolling volume spike、unit、event_at | price-volume evidence path | B12 verifier | evidence path；formal event publication待完成 |
| B13 | rolling price spike、20-day baseline | price-spike detector path | B13 verifier | 模組接線；formal event publication待完成 |
| B14 | minute outside/inside、dynamic baseline | minute side writer | B14 verifier | 隔離通過；自然讀回待驗 |
| B15 | five-minute state／priority boost | five-minute priority module | priority publication verifier | 隔離測試通過；正式接線待驗 |
| B16 | event handoff to consumer | event interface | delivery verifier | 接口責任已分離；正式待驗 |
| B17 | canonical/generation/fields/readback | mother-pool verifier | aggregate receipt | 尚未完成總驗收 |
| B18 | 13:30 closeout、no backfill | writer closeout | closeout receipt | 部分接線；自然待驗 |
| B19 | event source/field contract | event writer | B19 verifier | 尚未完整納入正式 writer |
| B20 | rolling side baseline | minute-side baseline writer | B20 verifier | 隔離模組；正式待驗 |
| B21 | event freshness／dedupe | event state | B21 verifier | scope／接線待確認 |
| B22 | event attribution／industry context | event writer | B22 verifier | scope／接線待確認 |
| B23 | event snapshot binding | snapshot-bound event writer | B23 verifier | 尚未完整納入正式 writer |
| B24 | consume B12–B23 aggregate | receiver event reader | B24 verifier／receipt | 尚未讀正式 runtime 事件 |

## 已直接驗證的隔離證據

- `npm run verify:contracts`：PASS。
- `npm run verify:daytrade-mother-pool-snapshot`：PASS（唯讀 runtime snapshot；不代表部署）。
- `npm run verify:daytrade-five-minute-priority`：PASS。
- B01 full-market／collector-volume／writer-identity 測試：PASS。
- B02/B03 ranking、unit、issued-share 測試：PASS。
- Strategy3 pinned snapshot 測試：PASS。

## 尚不能宣告 COMPLETE 的共同缺口

1. 此分支尚未 push／合併／部署至正式 release root。
2. Supabase snapshot View／RPC 尚未以接收端 anon 完成正式驗收。
3. B04–B10、B14、B19–B24 仍缺自然盤逐輪事件證據。
4. A15–A19 尚未全部接入正式 Writer。
5. 自然行情收盤前的覆蓋率、事件命中及跨兩次刷新 receipt 尚未取得。

