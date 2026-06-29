# AGENTS.md

Last updated: 2026-06-29 Asia/Taipei

給後續接手本工作區的 Codex：這份只保留目前有效狀態。不要沿用舊 Google Sheet、舊 static JSON、舊同步路徑、舊版本 bump、舊黃框 UI、舊部署流程。

手機端專用契約同步固化在 `MOBILE_AGENTS.md`。修改 `/mobile`、`mobile.html`、`/api/mobile-*`、手機自選股或手機 E2E 時，必須先讀 `MOBILE_AGENTS.md`，再讀本檔自選股與發布規則。

## 主線

正式站：

```text
https://fuman-terminal.vercel.app
```

固定版本：

```text
public-terminal-fast-20260623-09
```

資料主線：

```text
Supabase only polling / snapshot
```

## Supabase Shared Source 四層契約

開盤資料源不能再靠人工觀察補洞；正式 shared source 必須同時滿足四層：

```text
資源契約 -> 寫入心跳 -> 覆蓋率快照 -> publish gate
```

固定 contract version：

```text
fugle-source-contract-20260629-01
```

正式契約檔：

```text
ops/public-slot/FugleSourceResourceContract.sql
```

writer：

```text
ops/public-slot/Run-PublicSlotSharedSource.ps1
ops/public-slot/SupabasePublicSlotSource.ps1
```

每輪 shared source 必須寫：

```text
source_status.payload.source_contract_version
source_status.payload.writer_version
source_status.payload.build_id
source_status.payload.writer_pid
source_status.payload.quote_status
source_status.payload.preopen_status
source_status.payload.intraday_1m_status
source_status.payload.daily_volume_status
source_status.payload.quote_age_seconds
source_status.payload.last_quote_at
source_status.payload.latest_candle_time
source_status.payload.latest_candle_time_taipei
source_status.payload.intraday_1m_stale_seconds
source_status.payload.today_candle_count
source_status.payload.warmup_candle_count
source_status.payload.continuous_candle_count
source_status.payload.ready_ma20_continuous_symbols
source_status.payload.ready_ma35_continuous_symbols
source_status.payload.ready_macd_continuous_symbols
source_status.payload.direct_1m_prewarm_enabled
source_status.payload.direct_1m_prewarm_bars_per_symbol
source_status.payload.direct_1m_prewarm_target_symbols
source_status.payload.direct_1m_prewarm_completed_symbols
source_status.payload.direct_1m_prewarm_rows
source_status.payload.direct_1m_prewarm_complete
source_status.payload.quote_derived_1m_candidate_symbols
source_status.payload.quote_derived_1m_rows
source_status.payload.quote_derived_1m_current_minute
source_status.payload.quote_derived_1m_max_quote_age_seconds
source_status.payload.ready_ge_35_symbols
source_status.payload.ready_ge_80_symbols
source_status.payload.ready_ge_200_symbols
source_status.payload.scanner_can_run_quote_only
source_status.payload.scanner_can_run_opening
source_status.payload.scanner_can_run_ma20
source_status.payload.scanner_can_run_ma35
source_status.payload.scanner_can_run_full_intraday
source_status.payload.scanner_block_reason
```

`today_candle_count` 只能用來判斷今日訊號與今日成交量，不可用來判斷 MA20/MA35 readiness。09:01 的 MA20/MA35 必須像券商畫面一樣使用跨日連續 1 分 K 暖機：前一交易日最後 N-1 根 + 今日最新 1 根。正式欄位是：

```text
warmup_candle_count
continuous_candle_count
ready_ma20_continuous
ready_ma35_continuous
ready_macd_continuous
```

因此 `fugle_intraday_1m` 必須保留最近 80~200 根、至少 2~5 個交易日的 1 分 K。策略端技術指標 MA20 / MA35 / MACD / RSI / KD 使用跨日 continuous K；今日進場時間、今日成交量、今日訊號只看今天資料。

08:00 shared source 啟動後必須先為當沖候選池做 direct 1m prewarm：優先抓 Fugle historical 1m，至少每檔最近 200 根，不能等 09:00 後才從今天第一根開始累積。prewarm 進度必須寫入 `source_status.payload.direct_1m_prewarm_*`，且 `Guard-PublicSlotSourceAntiRollback.ps1` 與 publish gate 必須防止這些欄位被拿掉。

09:00 後熱門股 / 當沖候選股必須從 09:00 或 09:01 開始寫入今天 quote-derived 1m。writer 不可以用 quote 的 `updated_at` 當 candle minute 來等待第一筆成交；應以目前分鐘寫入 flat candle。若該分鐘沒有成交量，`fugle_intraday_1m.payload.synthetic=true` 且 `payload.volume_strategy_usable=false`，技術指標可用、量能條件不可用。`source_status.payload.quote_derived_1m_*` 必須顯示本輪候選池與寫入 rows，避免熱門股到 09:09 才有第一根今天 K。

每輪也必須寫 `fugle_source_coverage`，用來回查 08:00、09:00、09:05、09:35 的覆蓋率。若 Supabase schema 還沒套 `FugleSourceResourceContract.sql`，writer 可以安全跳過 coverage 寫入，但 `npm run verify:fugle-source-contract -- --live` 必須失敗，不能進正式發布。

最重要的資源不可盤中 500：

```text
source_status
fugle_source_coverage
v_fugle_quotes_commonstock_active
fugle_quotes_live
stock_tickers
fugle_daily_volume_avg / fugle_daily_volume
fugle_intraday_1m
v_fugle_intraday_1m_status
get_fugle_intraday_1m_latest_n
v_stock_future_live_contract
v_strategy12_stock_future_contract_health
fugle_preopen_snapshot
fugle_preopen_snapshot_history
market_calendar
```

修改 Supabase source / public-slot writer / 盤中策略資料源後至少跑：

```powershell
node --check scripts\verify-fugle-source-contract.js
npm run verify:fugle-source-contract -- --static-only
npm run verify:publish-gate
```

若要確認遠端 Supabase 已套用且心跳正在寫入，跑：

```powershell
npm run verify:fugle-source-contract -- --live
```

`--live` 失敗代表 source 尚未真正接上，不可用 deploy、cache bump、version bump 掩蓋。

## 成績單 `/88`

成績單公開網址固定：

```text
https://fuman-terminal.vercel.app/88
```

正式導管必須是：

```text
各策略 latest complete/live source
-> scripts/generate-terminal-scorecard-source.js
-> C:\fuman-runtime\data\scorecard-terminal-current.json
-> scripts/scorecard-source-supabase-ops.js
-> Supabase trade_records / strategy_daily_summary
-> scripts/export-scorecard-supabase-source.js
-> data/scorecard-latest.json fallback/bootstrap
-> Supabase snapshot scorecard_latest
-> /api/scorecard
-> /88
```

規則：

- `data/scorecard-latest.json` 只可當 fallback / bootstrap，不可當正式權威。
- 舊 DuckDB `scorecard.duckdb` 不可作為正式來源；`run-scorecard-snapshot.ps1` 只可當兼容 wrapper 轉呼叫 `run-scorecard-daily-automation.ps1`。
- Google Sheet / Streamlit / 本機 workbook 都不可當正式公開來源。
- 每日排程只允許 `Fuman Scorecard Daily Automation 1400`，必須跑 `run-scorecard-daily-automation.ps1`。
- 舊排程 `Fuman Scorecard Snapshot 1538` 與 `Fuman Auto Main Release 1615` 不可啟用；若存在必須停用或刪除。
- `scorecard:sync` 必須指向 `run-scorecard-daily-automation.ps1`，不可回到 `run-scorecard-snapshot.ps1` 舊流程。
- `npm run verify:scorecard-chain` 必須通過；若失敗在 `scorecard-upstream-supabase-source` 或 `scorecard-source-freshness`，代表來源導管沒接好，不可用 redeploy 或 version bump 掩蓋。
- `npm run verify:scorecard-no-rollback` 必須通過；它要擋 `/88` UI 欄位回滾、`cacheSource` 回滾、9 策略缺漏、舊排程復活、策略時間窗錯誤與 7 日追蹤欄位缺漏。
- Supabase schema 合約在 `ops/public-slot/ScorecardSourceContract.sql`；至少要有 `trade_records`、`strategy_daily_summary`、`v_scorecard_source_health`。

終端架構：

```text
fixed shell + Canvas / OffscreenCanvas + compact API + route snapshot
```

## 絕對不要做

- 不要隨便 bump 版本號。
- 不要用 cache bump / version bump 假裝修好資料或速度。
- 不要從 dirty 的 `C:\fuman-terminal` 直接 deploy。
- 不要復活 `C:\fuman-terminal-sync`。
- 不要復活 Google Sheet 正式資料源。
- 不要復活 static JSON data manifest。
- 不要讓客戶看到 Codex latency / debug 面板。
- 不要把策略2放進冷 snapshot。
- 不要把市場總覽退回泛用 `Rank / Code / Signal` 表格。
- 不要把 AI 判讀退回純文字列表。
- 不要讓自選股用任意四碼、placeholder 或 `name === code` 假卡新增成功。
- 不要把舊黃框跑馬燈 / 強弱統計區塊加回來。

## 日期規則

必須當天：

| 頁面 | 規則 |
|---|---|
| 市場總覽 | same-day |
| 策略2-當沖雷達 | same-day live |
| 即時雷達 | same-day live |

只要求最新完整掃，不要求當天：

| 頁面 | 規則 |
|---|---|
| 策略1 | latest-complete |
| 策略3 | latest-complete |
| 策略4 | latest-complete |
| 策略5 | latest-complete |
| 買賣超 | latest-complete |
| CB | latest-complete |
| 權證走向 | latest-complete |
| 自選股 | latest-match / route snapshot |

完整掃頁面顯示前一個交易日是正常狀態，不可誤判 stale。

## 買賣超 / Institution

買賣超是 `latest-complete` 頁，不要求盤中 same-day；正式資料權威是 Supabase complete run 與 `/api/institution-latest`，不是 static JSON。

正式接線：

```text
v_institution_latest_complete_run
-> institution_scan_results
-> api/institution-latest.js
-> terminal-runtime-config.js institutionCache / institutionSlim / institutionSummary / institutionMobileTop
-> terminal-desktop-fast-shell.js
-> terminal-chip-flow.js
```

Supabase 實體欄位至少要有：

```text
close
change_percent
trade_volume
trade_value
foreign_net
trust_net
dealer_net
total_net
payload
```

買賣超衍生欄位契約：

```text
fieldContractVersion = buy-sell-derived-fields-20260629-01
payload.foreignStreak / payload.trustStreak / payload.jointStreak
payload.fiveDayAvgVolume
payload.fiveDayPctSum
```

`foreignTrustVolumePct` / `foreignTrustBuyVolumePct` 可以不是 Supabase 原始欄位；若 payload 沒直接存，API 必須用：

```text
(foreign_net + trust_net) / payload.fiveDayAvgVolume * 100
```

輸出給前端。桌面快版必須同時支援 camelCase、snake_case 與 legacy 名稱，例如：

```text
fieldContract=buy-sell-derived-fields-20260629-01
foreignTrustBuyVolumePct
foreignTrustVolumePct
foreign_trust_buy_volume_pct
fiveDayAvgVolume
five_day_avg_volume
avg_volume_5d
```

畫面欄位不可退回：

```text
連買 = foreignStreak / trustStreak / jointStreak
佔均量 = foreignTrustVolumePct 或 API 回算值
```

若畫面出現 `0/0/0` 或 `0.00%`，先查 `/api/institution-latest?live=1` 與 `terminal-desktop-fast-shell.js` mapping，不要先判定 Supabase 沒資料。2026-06-29 已驗證：Supabase 最新 complete run 有 306 筆，`foreignStreak / trustStreak / jointStreak / fiveDayAvgVolume / fiveDayPctSum` 都在 `payload`；API live 306 筆皆輸出 `foreignTrustVolumePct`。

不能刪或退回的買賣超正式接線：

```text
api/institution-latest.js
terminal-desktop-fast-shell.js
terminal-chip-flow.js
terminal-runtime-config.js
scripts/guard-buy-sell-no-rollback.js
institutionAGENTS.MD
```

可以清理的只限退休 static cache / runtime cache，例如 `data/institution-mobile-top.json`、`data/institution-latest.json`、`data/institution-slim.json`、`data/institution-tdcc-breakout-top.json`、舊 page cache。清理前先跑：

```powershell
npm run cleanup:api-only-retired -- --dry-run --json --root C:\fuman-terminal
```

買賣超相關修改後至少跑：

```powershell
node --check api\institution-latest.js
node --check terminal-desktop-fast-shell.js
npm run guard:buy-sell-no-rollback
npm run verify:buy-sell-field-contract
npm run verify:publish-gate
```

## 市場總覽 / 熱力圖

市場總覽是正式桌面終端主畫面，不是泛用策略頁，也不是純表格頁。

### 導管驗證

市場總覽、熱力圖、AI 判讀、即時雷達、自選股必須一起驗，不可只看其中一個 API。

固定 gate：

```text
npm run verify:market-surfaces-chain
```

這支必須檢查：

- 市場總覽 `/api/market`
- 熱力圖 `/api/heatmap`
- AI 判讀 `/api/market-ai-live`
- 即時雷達 `/api/realtime-radar-latest`
- 自選股 `/api/watchlist-match-index`
- 桌面 UI E2E 市場總覽 / 即時雷達
- 手機 UI E2E AI / 自選股
- `terminal-market-overview-restore.js` 內的市場總覽、熱力圖 tabs、AI panel、即時雷達入口 contract

若 `verify:market-surfaces-chain` 失敗，不可用 redeploy、version bump、static JSON 或 service worker cache 掩蓋。

### 固定顯示

- 點左側「市場總覽」後，主畫面必須顯示市場總覽專用 UI。
- 上方市場總覽主卡必須顯示三張核心指標：加權指數、櫃買指數、台指期夜。
- 台指次月可保留作 fallback/延伸資料，但不可佔用市場總覽主卡位置。
- 指數卡必須顯示數值、漲跌、漲跌幅或明確等待狀態。
- 指數卡下方直接接熱力圖區塊。
- 熱力圖區塊必須有標題、資料時間 / source、分類 tabs、產業 / 族群卡片。
- 熱力圖不可退回泛用 `Rank / Code / Signal` 表格。

### 2026-06-28 固化合約

這輪市場總覽正式合約如下，不可再改回舊版：

- 桌面市場總覽由 `terminal-desktop-fast-shell.js` 主控。
- 正式 cache key 需使用具體修正理由，例如 `terminal-desktop-fast-shell.js?market-overview-core=20260628-01`。
- 不可用主版本 bump、service worker bump、redeploy side effect 代替真正 UI 修正。
- 市場總覽主卡固定只顯示三張：加權指數、櫃買指數、台指期夜。
- 台指次月可保留在 fallback / 延伸資料中，但不可出現在市場總覽主卡前三張之外當主要畫面。
- 熱力圖五個 tabs 必須全部存在且可切換：全部、官方產業、電子細分、群組概念、集團股。
- 每個熱力圖 tab 點選後都必須有分類卡片或受控空狀態，不可空白、不可靠舊 DOM 補畫。
- `terminal-market-overview-restore.js` 暫時保留 passive / fallback，不可讓它接管 fast shell 主畫面。
- 不要手動刪 `terminal-market-overview-restore.js`、`terminal-core.js`、`terminal-hotfix.js`、`terminal-app.js` 這類舊 runtime；等全 route E2E 證明完全不依賴後再分階段拔除。
- 若瀏覽器仍看到舊畫面，先確認正式 HTML 是否載到新的 fast shell query key；不要先叫使用者刪檔或手動清 production mirror。

### 熱力圖分類 tabs

熱力圖分類 tabs 固定包含：

```text
全部
官方產業
電子細分
群組概念
集團股
```

規則：

- tabs 必須可點選切換。
- 點選後要即時顯示對應分類卡片。
- 分類沒有資料時，要顯示受控空狀態，不可空白。
- 不可顯示假資料或用 `0` 假裝有資料。

### 產業 / 族群卡片

每張熱力圖卡片至少要顯示：

```text
產業 / 族群名稱
漲跌幅或平均漲跌
樣本數 / 檔數
上漲 / 下跌數
代表股票或領漲 / 領跌股票
成交值或可用量能資訊
```

卡片顏色規則：

- 上漲偏紅 / 暖色。
- 下跌偏綠 / 冷色。
- 盤整或中性要有明確中性色。
- 夜幕 / 陽光模式都要保持可讀性。

### 點擊互動 / modal

- 點熱力圖產業、族群、卡片或分類項目，要開啟相關股票 modal。
- modal 要維持深色質感卡片，不可跳成瀏覽器預設白底文字。
- modal 要顯示對應股票清單。
- modal 內容至少包含：股票代號、股票名稱、漲跌幅、成交值。
- 若資料有提供，也要顯示外資、投信、自營、成交量、族群、原因等欄位。
- modal 要有關閉按鈕。
- modal 沒有資料時，要顯示受控空狀態，不可空白。

### 資料規則

- 熱力圖資料來源必須走 Supabase API / snapshot。
- 不可用 Google Sheet。
- 不可用 static JSON data manifest。
- 不可用 service worker cache 當資料權威。
- 不可用 version bump / cache bump 假裝資料更新。
- 不可用 redeploy 掩蓋 Supabase snapshot / API 問題。
- 市場總覽 / 熱力圖屬於 same-day 資料頁。
- 若盤中資料未到，要顯示等待或最近 snapshot，並標明時間與 source。

### 已硬移除且不可恢復

- `ticker-strip`
- `strength-panel`
- 舊黃框跑馬燈
- 舊黃框強弱統計
- 市場總覽泛用 `Rank / Code / Signal` 表格
- 舊 DOM table
- 白底純文字熱力圖

### 相關檔案

```text
terminal-market-overview-restore.js
terminal-market-overview-restore.css
terminal-core.js
fuman-sw.js
```

修改市場總覽 / 熱力圖後，可以更新 market overview asset epoch 讓 service worker 吃新資產；不可 bump 主版本 `public-terminal-fast-20260623-09`。

### 修改後驗證

若修改熱力圖，必須驗：

- 市場總覽分頁能正常切換。
- 上方三張核心指數卡存在且有資料或受控等待狀態：加權指數、櫃買指數、台指期夜。
- 熱力圖分類 tabs 存在且可切換。
- 熱力圖卡片有資料或受控空狀態。
- 點產業 / 族群卡片會開啟股票 modal。
- modal 不是白底純文字。
- modal 內有股票代號、名稱、漲跌幅、成交值等資訊。
- `ticker-strip` 和 `strength-panel` 不存在。
- 正式 alias `https://fuman-terminal.vercel.app` 有更新，不只看 preview URL。

### 即時雷達七關驗收（2026-06-28）

即時雷達目前正式版為 DOM 版雷達頁，不再使用 Canvas 外殼包住。修改即時雷達 UI / API / scanner 後，至少要跑以下七關與 UI E2E 實測：

| 關卡 | 指令 / 檢查 | 2026-06-28 結果 |
|---|---|---|
| 1. worktree 同步 | `git status --short --branch` | PASS：`main...origin/main` |
| 2. fast shell 語法 | `node --check terminal-desktop-fast-shell.js` | PASS |
| 3. API 語法 | `node --check api/realtime-radar-latest.js` | PASS |
| 4. scanner 語法 | `node --check scripts/scan-realtime-radar-cache.js` | PASS |
| 5. publish governance | `npm run verify:publish-gate` | PASS |
| 6. live deployment/version | `npm run verify:live-version` + `npm run verify:deploy` | PASS |
| 7. market surfaces chain | `npm run verify:market-surfaces-chain` | PASS |

本次 UI E2E 實測：

```text
npm run verify:terminal-ui-e2e -- --out=outputs/terminal-ui-e2e-realtime-radar-seven-gate-desktop --only=desktop-night --routes=market,realtime-radar
npm run verify:terminal-ui-e2e -- --out=outputs/terminal-ui-e2e-realtime-radar-seven-gate-mobile --only=mobile-phone-portrait-night --routes=ai,watch
```

正式站桌面即時雷達驗證結果：

```text
baseUrl=https://fuman-terminal.vercel.app
route=realtime-radar
rowsVisible=15
domRows=15
canvasRows=0
canvasSize=null
result=PASS
report=outputs/terminal-ui-e2e-realtime-radar-seven-gate-desktop/terminal-ui-e2e-report.json
```

正式 API 實測：

```text
/api/realtime-radar-latest?full=1&limit=1200
status=200
rows=80
totalCount=80
displayWindow=09:00-13:30
cacheSource=supabase-radar-cache
reason=non-trading-day-cache
marketSession.taipeiDate=2026-06-28
marketSession.marketDataDate=2026-06-26
```

注意：`2026-06-28` 是週日，正式站顯示 80 筆休市快取是正常狀態；下一個開盤日才會從 09:00 開始累積到 13:30。不可因週末快取 rows=80 誤判完整盤中功能失效。

防回滾設定（2026-06-28 已實作）：`scripts/verify-publish-gate.js` 會擋即時雷達 API full-session、DOM shell、scanner session limit 與 UI E2E marker 回退；`scripts/verify-terminal-ui-e2e.js` 會擋 `realtime-radar` 重新出現 legacy Canvas shell、canvas element、`canvasRows` 與缺少 `09:00-13:30`；`scripts/verify-market-surfaces-chain.js` 會打 `/api/realtime-radar-latest?full=1&limit=1200` 並檢查 `displayWindow=09:00-13:30` 與 `totalCount >= rows`。

### 發布 / 上傳限制

- 只改 `AGENTS.md`、策略文件、SQL patch、純操作說明時，不需要 Vercel deploy；只需 commit / push。
- 修改正式站 UI / API / route / package scripts / runtime 程式後，才可走正式 Vercel production deploy。
- 正式程式上傳固定流程：乾淨 worktree -> local gates -> commit -> push main -> `npm run verify:publish-gate` -> `npm run guard:production:pre` -> 確認 Vercel project -> `vercel --prod` -> live 驗證。
- 嚴禁從 dirty worktree deploy。
- 嚴禁從 `C:\fuman-terminal` 或 `C:\fuman-terminal-sync` deploy。
- `C:\fuman-terminal` 只當 production mirror，只允許 `git pull --ff-only`，不可直接修改後當正式修復。
- 上傳前必查 `.vercel/project.json`：projectName 必須是 `fuman-terminal`，projectId 必須是 `prj_x0R2mMFsL0Xto4whcbPTKQTKJRUl`，Node 必須是 `24.x`。
- 不可讓 Vercel CLI 自動 link 到新 project、preview project、sync project 或任何非 `fuman-terminal` project。
- 發布前必跑 `git status --short`、`npm run verify:publish-gate`、`npm run guard:production:pre`。
- 修改市場總覽 / 熱力圖 / AI 判讀時，還必跑 `npm run verify:market-surfaces-chain` 與 `npm run verify:terminal-ui-e2e -- --routes=heatmap,market-ai --only=desktop-night,desktop-sun`。
- 修改 fast shell / runtime ownership 時，還必跑 `npm run verify:runtime-ownership` 與 `npm run verify:fast-shell-self-contained`。
- deploy 後必跑 `npm run guard:production`，並用 live UI E2E 驗正式 alias `https://fuman-terminal.vercel.app`。
- 不可用 version bump、service worker bump、cache bump、redeploy side effect 假裝修好 UI 或資料問題。
- 不可用 Google Sheet、Streamlit、static JSON manifest、`C:\fuman-terminal-sync` 當正式來源或正式部署路徑。
- 不要把 `data/scan-receipts/*` 跟熱力圖程式修正混 commit。
- 不要把 `data/*.json`、`data/mobile-*`、`data/terminal-home-*` 這類 static cache dirty 檔混進正式程式修正 commit。
- 不要手動 full scan 來掩蓋熱力圖資料問題。

## 自選股固定契約

自選股是正式桌面終端功能，不是暫時 fragment，也不是任意四碼記帳器。任何自選股修改都要比照 AI 判讀的規格逐步檢查：資料、畫面、互動、夜幕 / 陽光、desktop E2E、正式站 live 都要驗。

### 2026-06-28 事故紀錄

問題：

- 使用者輸入 `2334` 時，畫面曾顯示「已加入」或「尚未同步」，但左側卡片列表沒有可靠新增。
- 某些路徑會新增成名稱等於代號的假卡，例如 `{ code: "2334", name: "2334", market: "台股" }`。
- `2334` 不在 `data/stocks-slim.json` / `data/stocks-index.json` 台股 universe，正式行為必須拒絕。
- `2344` 是有效台股 `華邦電`，正式行為必須能正常新增卡片。
- 使用者常輸入很多台股，所以不能只處理單一代號或單次新增；列表必須可持續往下新增到上限。

根因：

- `terminal-watchlist-shell.js` 找不到股票 meta 時仍可能透過 fallback row 建立卡片。
- `terminal-hotfix.js` bridge 曾有直接寫入 `localStorage` 的 fallback path，繞過 shell 驗證。
- 舊 E2E 曾把 invalid `2334` seed 成 `旺宏`，導致測試誤把錯誤行為當成功。
- 舊 storage key `fuman_watchlist` / `fuman_mobile_watchlist_v1` 內若已殘留 invalid rows，會讓畫面出現「已加入但沒有正常卡片」或「尚未同步」。
- 只清 service worker cache 或 bump version 不能修掉資料驗證錯誤；真正問題在新增流程與 storage guard。
- 手機版曾出現正式 `/mobile` HTML 已更新，但真人操作仍停在 `正在確認台股代號` 或新增後沒卡片；這表示不能只依賴舊 tab click 觸發重畫，手機新增成功後必須由新增流程直接重畫 `.watch-row`。

正式修正：

- `terminal-watchlist-shell.js` marker 必須保留 `watchlist-rich-shell-20260628-07`。
- 新增前必須走 `resolveStockMeta` / `validateTaiwanStockCode`。
- 股票 meta 優先從 `data/stocks-slim.json` 解析，備援 `/api/stocks?watchlist=1`。
- 有效 meta 至少要符合：code 相同、name 不空、name 不等於 code、market 可辨識。
- invalid code 必須顯示 `不是有效上市/上櫃台股代號`。
- invalid code 不可寫入 `localStorage`，不可生成 `.watchlist-card`，不可佔用 `1/10` 到 `10/10` 名額。
- `validateStoredRows()` 必須清除舊 storage 裡已殘留的 invalid rows。
- `terminal-hotfix.js` bridge marker 必須保留 `20260628-06`，並等待 shell async add result。
- `terminal-hotfix.js` 必須保留 `watchlist-storage-guard-20260628-03`。
- storage guard 必須攔截 placeholder row，並透過 `scheduleShellValidation` 交給 shell 驗證。
- `fuman-sw.js` 必須保留 watchlist shell / hotfix asset epoch purge，讓正式站吃到新自選股資產。
- 手機版 `mobile.html` 必須保留 `mobile-watch-v2-direct-render-20260628-04` 與 `FUMAN_MOBILE_MANUAL_WATCH_ADD_V2`。
- 手機版手動新增與策略卡「加入自選」必須由 V2 capture handler 接管：先用 `/api/mobile-watch-meta?code=XXXX` 查單一代號並驗證台股 universe，再同步 `fuman_watchlist` / `fuman_mobile_watchlist_v1`、成功後直接 render 自選 tab 卡片，不可只等待舊 fragment/tab click 重畫，也不可在手機端先拉整包股票清單才新增。
- 手機版 V2 capture bridge 必須保留 `mobile-watch-v2-early-bridge-20260628-01`，且用 `event.composedPath()` 找到真實點擊來源；不能只靠 `event.target.closest()`，因為真人點文字節點 / 內層節點時可能被舊 document-capture handler 搶走。
- 手機版 V2 rescue renderer 必須保留 `mobile-watch-v2-rescue-render-20260628-01`；若畫面已出現「已加入自選 / 已在自選股」但舊流程沒有畫出 `.watch-row`，rescue 必須從 storage / pending click / DOM rows 合併資料並直接重畫自選 tab。
- 手機版 success status renderer 必須保留 `mobile-watch-success-status-render-20260628-01`；若 watch tab 已顯示 `XXXX 名稱 已加入自選`，但下方仍是 `尚未加入` 或沒有該代號 `.watch-row`，必須從狀態文字與 storage 直接補卡，不能只依賴 pending click。
- 手機版 V2 add recovery 必須保留 `mobile-watch-v2-add-recovery-20260628-01`；若手動輸入或策略加入停在 `正在確認台股代號` / `加入中`，watchdog 必須再次查 `/api/mobile-watch-meta?code=XXXX`，valid 就同步 `fuman_watchlist` / `fuman_mobile_watchlist_v1` 並直接補出 `.watch-row`，invalid 不可補卡。
- 手機版 stuck status recovery 必須保留 `mobile-watch-v2-stuck-status-recovery-20260628-01`；若 watch tab 狀態文字停在 `XXXX 正在確認台股代號`，即使原本 click promise 沒回來，也必須從狀態文字抓代號、查 `/api/mobile-watch-meta?code=XXXX`，valid 直接補卡。
- 手機版 V2 必須保留 JSONP fallback，因為部分真實 Chrome 分頁 / 受控環境可能沒有可用的 `fetch`；`/api/mobile-watch-meta` 也必須支援 `callback=`。
- 手機版 V2 必須用 `MutationObserver` 防止舊 mobile watch renderer 晚到時覆蓋 V2 `.watch-row`。
- 手機版 V2 必須保留 in-memory rows fallback；`localStorage.setItem` 失敗時仍要畫出 `.watch-row`，不可停在 `正在確認台股代號`。
- in-memory rows fallback 只可在 storage 寫入或讀回失敗時使用；正常讀到任一 storage key 時，不可把舊 memory rows 混回列表，避免重設 storage 或切頁後舊股票復活。
- storage 寫入必須 read-back 驗證，例如保留 `localStorage.getItem(KEY) === value`；只有真的寫回成功，才可關閉 memory fallback。
- 手機版 V2 必須保留 `mobile-watch-merge-storage-20260629-01`；讀取自選股時必須合併 `fuman_watchlist` 與 `fuman_mobile_watchlist_v1`，不可用 `localStorage.getItem(KEY) || localStorage.getItem(MOBILE_KEY)` 只讀第一個非空 key。
- 若兩個 storage key 分裂，例如 `fuman_watchlist=["3504"]`、`fuman_mobile_watchlist_v1=["3028","3504"]`，watch tab 必須自動合併、寫回兩個 key，並顯示 `3504` 與 `3028` 兩張卡，不得只顯示第一個 key 的卡片。

不可恢復：

- 不得恢復「任意四碼即可新增」。
- 不得恢復 `fallbackRow(code)` 當作新增成功。
- 不得恢復 `name === code` placeholder fake card。
- 不得讓 invalid code 只顯示「尚未同步」但仍留在列表或 storage。
- 不得讓 bridge、mobile fragment 或 hotfix 直接繞過 shell 寫卡。
- 不得把 `2334` 當 valid E2E seed。
- 不得用 service worker cache、version bump、redeploy 來掩蓋 universe / meta 驗證問題。
- 不得要求使用者用 PowerShell 手動刪 cache 才能讓自選股新增成立；若正式頁需要更新，應由 no-store route、asset epoch、service worker activate / purge 或 direct-render hotfix 自我處理。

### UI / E2E 固定規格

自選股 UI 必須持續符合：

- 左側自選股卡片可連續新增有效台股，卡片可往下堆疊，不得只顯示第一張。
- 左側計數必須正確顯示，例如 `1/10`、`2/10`。
- 有效台股卡片必須包含代號、名稱、市場 badge、價格或受控等待值、漲跌幅、移除按鈕。
- 點左側卡片後，右側個股分析必須同步切到該股票。
- 右側分析至少要有標的、趨勢判讀、漲跌幅、符合策略、價位、籌碼、風險、操作提醒與判讀理由。
- invalid code 要停在輸入區狀態訊息，不得新增卡片。
- 夜幕 / 陽光模式都不可爆版、重疊或讓文字溢出卡片。
- 手機版自選股不可只顯示既有 storage；必須有 `mobile-watch-input` 與 `data-mobile-watch-add` 可手動新增。
- 手機版自選股目前硬上限是 10 檔；到 10 檔時必須顯示 `已達 10 檔上限`，輸入框與新增按鈕 disabled。若要改上限，必須同步修改手機頁、桌機契約、storage cap、E2E 期待值與本 AGENTS 規則。
- 手機版所有策略卡的「加入自選」按鈕必須能寫入 `fuman_watchlist` 與 `fuman_mobile_watchlist_v1`，切到自選頁後要看得到卡片。
- 手機版策略 1-5 的「加入自選」不可只檢查 selector 存在；E2E 必須實際點策略卡按鈕，確認兩個 storage key 寫入，再切到自選頁確認 `.watch-row` 顯示該代號。
- 手機版新增也必須驗台股 universe；`2334` 這類 invalid code 不可進 storage，不可顯示卡片。
- 手機版自選 tab 必須確認 `FUMAN_MOBILE_MANUAL_WATCH_ADD_V2` 是 function，且畫面根節點帶有 `data-mobile-watch-hotfix="mobile-watch-v2-direct-render-20260628-04"`。

`scripts/verify-terminal-ui-e2e.js` 必須保留自選股 negative test：

- 輸入 `2334`。
- `localStorage` 不含 `2334`。
- DOM 不含 `.watchlist-card[data-code="2334"]`。
- status 含 `不是有效上市/上櫃台股代號`。
- count 維持原本名額，例如 `1/10`。
- 手機 watch E2E 不可只預塞 10 檔；必須實際點手機新增：
  - 先輸入 `2334`，確認拒絕且 storage / DOM 都不含 `2334`。
  - 再用使用者流程輸入有效台股，例如 `3028`，確認手機自選頁新增第 10 張卡片，且兩個 storage key 都同步。
  - 手機手動新增不可卡在 `正在確認台股代號`；台股 universe 讀取必須有 timeout / fallback，失敗也要顯示受控錯誤。
  - 手機手動新增成功後必須直接重畫 `.watch-row`，不可只驗 storage 或 status。
  - E2E 必須模擬 legacy 成功狀態：`3028 增你強 已加入自選` + 下方 `尚未加入`，並確認 rescue 自動補出 `3028` `.watch-row`。
  - E2E 必須模擬雙 storage key 分裂：`fuman_watchlist` 只有 `3504`、`fuman_mobile_watchlist_v1` 有 `3028,3504`，並確認 watch tab 顯示兩張卡且兩個 key 都被合併寫回。
  - E2E 必須從空列表用真人式座標點擊連續新增 `3504 -> 3028 -> 3717 -> 6174`，每一步都要驗 DOM 卡片數與兩個 storage key 同步增加；不可只驗預塞 9 檔後新增第 10 檔。
  - 手機手動新增必須驗 `/api/mobile-watch-meta?code=3028` valid，並驗 `/api/mobile-watch-meta?code=2334` invalid。
  - watch tab 手動測試必須以 9 檔有效台股 seed 開始，拒絕 `2334` 後筆數維持 9，再新增 `3028` 補到 10；不可在滿 10 檔時測 invalid/valid，否則只會測到上限 guard。
  - 至少驗 phone portrait、phone landscape、tablet 的 night / sun 六種手機 / 平板模式。
- 手機策略 E2E 必須覆蓋 `strategy1,strategy2,strategy3,strategy4,strategy5`：
  - 進策略分頁後清空手機自選 storage。
  - 用 Chrome `Input.dispatchMouseEvent` / 真實座標點擊第一個 `[data-ai-watch-code]` 的「加入自選」，不可只在頁面內呼叫 `button.click()`。
  - 點擊後按鈕文案 `加入中` / `已加入自選` 可作輔助訊號，但不能作唯一通過條件；手機切頁或 fragment 重繪時按鈕可能被卸載，最終必須以兩個 storage key 寫入與 watch tab `.watch-row` 出現作準。
  - 確認 `fuman_watchlist` 與 `fuman_mobile_watchlist_v1` 同步包含該代號。
  - 切到自選頁後確認該代號已出現在 `.watch-row`。
- 手機 / 平板 E2E 必須避免跨 viewport 假陰性：
  - 每個 mobile viewport / theme run 結束後，將當前 tab 導回 `data:text/html,FUMAN_E2E`，並用 `Storage.clearDataForOrigin` 清掉 `https://fuman-terminal.vercel.app` origin storage。
  - watch tab 手動測試 seed 完 9 檔後必須重新載入 `/mobile`，讓頁面從乾淨 storage 啟動，避免前一個策略卡的延遲 recovery timer 把舊標的補回來。
  - 手動 watch code submit 必須在同一個頁面事件中設定 `#mobile-watch-input`、派發 `input/change`，再點 `[data-mobile-watch-add]`；分成兩個 CDP 動作時，手機橫向 / 平板陽光模式可能被重新 render 清掉 input，造成假 `請輸入四碼股票代號`。

E2E seed 必須使用有效台股，例如：

```text
2344 華邦電
```

修改自選股後至少要跑：

```powershell
node --check terminal-watchlist-shell.js
node --check terminal-hotfix.js
node --check scripts/verify-terminal-ui-e2e.js
npm run verify:runtime-hotfix
npm run verify:sw
npm run verify:publish-gate
```

正式部署後至少要跑：

```powershell
npm run guard:production
npm run verify:mobile-api-only:live
npm run verify:mobile-cache-contract:live
npm run verify:runtime-hotfix -- --live
npm run verify:terminal-route-stress -- --base-url=https://fuman-terminal.vercel.app --loops=3 --routes=heatmap,market-ai,watchlist,realtime-radar --route-timeout=60000
npm run verify:terminal-ui-e2e -- --base-url=https://fuman-terminal.vercel.app --only=desktop-night,desktop-sun --routes=watchlist --route-timeout=90000 --eval-timeout=60000
npm run verify:terminal-ui-e2e -- --base-url=https://fuman-terminal.vercel.app --only=mobile-phone-portrait-night,mobile-phone-portrait-sun,mobile-phone-landscape-night,mobile-phone-landscape-sun,mobile-tablet-night,mobile-tablet-sun --routes=strategy1,strategy2,strategy3,strategy4,strategy5,watch --route-timeout=120000 --eval-timeout=60000
```

runtime guard 必須檢查以下 marker：

```text
watchlist-rich-shell-20260628-07
validateTaiwanStockCode
watchlist-storage-guard-20260628-03
scheduleShellValidation
不是有效上市/上櫃台股代號
```

### 上傳 / 部署規則

自選股屬於正式站 UI / runtime。修改 `terminal-watchlist-shell.js`、`terminal-hotfix.js`、`index.html`、`fuman-sw.js`、自選股 API 或相關 E2E 後，必須走正式發布 / 上傳硬規則。

- 發布只能從乾淨 release clone / worktree。
- 發布前必須確認 `git status -sb` 乾淨，且 `npm run verify:publish-gate` 通過。
- 必須 commit 並 push 到 `origin/main`，不可只停在本機或 preview。
- 正式部署只認 `https://fuman-terminal.vercel.app`，不可只看 Vercel preview URL。
- `vercel --prod --yes` 後必須跑 production guard 與 live UI E2E。
- 若只修改 `AGENTS.md` 或文件，不需要重新 deploy Vercel，但仍要 commit / push 讓契約留在 repo。
- 使用者不需要用 PowerShell 手動刪 cache 才能讓正確功能成立；若需要換資產，應透過正式 asset epoch / service worker 規則處理。

### 本次收斂紀錄

- 最終修正 commit：`1fe811e4 Validate Taiwan stock watchlist adds`。
- 正式部署：`dpl_A7BUAZa8GgQjtmSTaPhJGZsMUVB6`。
- 正式網址：`https://fuman-terminal.vercel.app`。
- live runtime hotfix 驗證已通過，`/api/mobile-page` 是 200，標題為「輔滿極速手機版」。
- live desktop watchlist E2E 已通過 night / sun matrix，結果為 `ok desktop/night/watchlist rows=21`、`ok desktop/sun/watchlist rows=21`。
- 2026-06-28 第二次收斂 commit：`6d05af4a Stabilize mobile watchlist and route stress`。
- 第二次正式部署：`dpl_AkNsX61NJGW8oE3WbNnUkvWfECDE`，alias `https://fuman-terminal.vercel.app`。
- 本次實際問題：正式 `/mobile` 已顯示成功訊息，例如 `2327 國巨* 已加入自選`，但 `.watch-row` 仍為 0；代表舊 mobile handler 已寫狀態但沒有讓自選 tab 直渲染。修正方式是 composedPath capture bridge 加上 rescue renderer，而不是要求使用者手動清 cache。
- 本次 route-stress 已改成單一 Chrome / 單一 tab 連續切頁；`Page.enable` 只記錄不作 fatal，避免每 route / 每輪重開 Chrome 造成假失敗。
- 第二次正式站七關已過：`verify:mobile-api-only:live`、`guard:production`、`verify:mobile-cache-contract:live`、`verify:runtime-ownership`、`verify:terminal-resource-chain`、`verify:terminal-cold-start`、`verify:terminal-route-stress --loops=3`、`verify:mobile-layout:live`、手機 / 平板 `verify:terminal-ui-e2e` matrix。
- 手機 / 平板自選股 live E2E 已覆蓋：phone portrait、phone landscape、tablet，night / sun，策略1-5 的「加入自選」與 watch tab；聚焦 watch route 也已驗 `2334` invalid reject 與 `3028` valid manual add。
- 2026-06-28 第三次手機自選收斂 commit：`b8e9593b Recover mobile watch cards after strategy adds`，新增 `mobile-watch-v2-add-recovery-20260628-01`，避免 valid code 停在 `正在確認台股代號` 而沒有卡片。
- 第三次正式部署：`dpl_2F7ZS5sKqDxvRKnJuvBXyFvxyx79`，但 live E2E 抓到舊策略 recovery timer 會在切到 watch / 重設 storage 後晚到，污染 watch 手動新增測試。
- 最終手機自選收斂 commit：`16777e19 Prevent stale mobile strategy watch recovery`；策略 recovery 只允許原策略按鈕仍在 DOM 時執行，切頁後舊 timer 必須失效。
- 最終正式部署：`dpl_G3R6fBM2eBaHSyGopvWjXHkBbpUY`，alias `https://fuman-terminal.vercel.app`。
- 最終 live 驗證：`npm run verify:mobile-api-only:live` 通過、`npm run guard:production` 通過、手機 / 平板 `verify:terminal-ui-e2e` matrix 通過 `ok 36/36`。此矩陣實際點策略1-5「加入自選」，再切 watch tab 驗 `.watch-row` 出現，並驗 watch tab 手動 `2334` invalid reject / `3028` valid add。
- 2026-06-28 手機手動 `3028 正在確認台股代號` 卡住收斂 commit：`0d875080 Recover stuck mobile manual watch adds`；正式部署 `dpl_5e7Pty7SD5fQk9pd23RTBWeeEZch`，alias `https://fuman-terminal.vercel.app`。
- 本次根因確認：`/api/mobile-watch-meta?code=3028` live 回傳 valid，但舊 click promise / tab render 可能停在 `3028 正在確認台股代號`，所以手機 V2 stuck status recovery 必須從狀態文字抓代號、查 meta、寫入兩個 storage key 並直接補 `.watch-row`。
- 2026-06-28 E2E 隔離收斂 commit：`3abbaaf6 Stabilize mobile watchlist E2E isolation`；這是測試器修正，不需要重新 deploy Vercel。
- E2E 隔離根因：同一個 Chrome 連跑多個 mobile viewport 時，前一個 `/mobile` tab 沒真正關閉，origin storage 與 strategy recovery timer 會污染下一格 watch 手動新增，造成滿 10 檔或 `請輸入四碼股票代號` 的假失敗。處理方式是 watch tab 測試 seed 9 檔後 reload，submit 代號與 click 原子化，每個 mobile run 結束導回 blank 並清 origin storage。
- 最新正式站手機 / 平板 live E2E 已於 `3abbaaf6` 後重跑通過：`npm run verify:terminal-ui-e2e -- --base-url=https://fuman-terminal.vercel.app --only=mobile-phone-portrait-night,mobile-phone-portrait-sun,mobile-phone-landscape-night,mobile-phone-landscape-sun,mobile-tablet-night,mobile-tablet-sun --routes=strategy1,strategy2,strategy3,strategy4,strategy5,watch --route-timeout=120000 --eval-timeout=60000`，結果 `ok 36/36`。此矩陣驗 strategy1-5 實際點「加入自選」後切 watch 看卡，並驗 watch tab `2334` invalid reject / `3028` valid add 到第 10 張。
- 2026-06-28 success status 無卡片收斂 commit：`4a2225ad Render mobile watch cards from success status`；正式部署 `dpl_GTgJtk8nxBPxc3hg7H5CoAcAAoXY`，alias `https://fuman-terminal.vercel.app`。
- 本次真人截圖根因：手機自選 tab 上方已顯示 `3028 增你強 已加入自選`，代表舊流程已寫入成功狀態或 storage，但下方仍是 `尚未加入。`，因為既有 rescue 只看 pending click / storage，不會從成功狀態文字反推應補出的卡片。
- 本次修正：`mobile.html` 新增 `mobile-watch-success-status-render-20260628-01`，當 `#mobile-watch-status` 出現 `XXXX 名稱 已加入自選` 或 `已在自選股` 且目前沒有該代號 `.watch-row` 時，必須從狀態文字、storage 與 meta fallback 合併資料並直接重畫 watch list；不可只顯示成功訊息。
- `scripts/verify-mobile-api-only.js` 必須檢查 `mobile-watch-success-status-render-20260628-01`；`scripts/verify-terminal-ui-e2e.js` 必須模擬 `3028 增你強 已加入自選` + `尚未加入。` 的 legacy DOM 狀態，並確認 rescue 自動補出 `3028` `.watch-row`。
- 本次正式站驗證：`npm run guard:production` 通過、`npm run verify:mobile-cache-contract:live` 通過、`npm run verify:mobile-api-only:live` 通過、聚焦 live watch E2E 通過 `ok mobile/phone-portrait/sun/watch rows=11`，完整手機 / 平板矩陣 `npm run verify:terminal-ui-e2e -- --base-url=https://fuman-terminal.vercel.app --only=mobile-phone-portrait-night,mobile-phone-portrait-sun,mobile-phone-landscape-night,mobile-phone-landscape-sun,mobile-tablet-night,mobile-tablet-sun --routes=strategy1,strategy2,strategy3,strategy4,strategy5,watch --route-timeout=120000 --eval-timeout=60000` 通過 `ok 36/36`。
- 補充：沙盒內直接 `node fetch('https://fuman-terminal.vercel.app/mobile')` 曾因本機 sandbox network `EACCES` 失敗；改以正式 live gate 執行後通過，這不是 production `/mobile` 失敗。

### 驗證注意事項 / 已知坑

- `verify:terminal-ui-e2e` 預設打正式網址 `https://fuman-terminal.vercel.app`；部署前用它驗新碼，會打到舊 production。
- `verify:terminal-route-stress` 必須維持單一瀏覽器內連續切頁；不可回退成每輪或每 route spawn `verify-terminal-cold-start-performance.js` / 重開 Chrome。
- route-stress 收斂前必須確認 active panel 仍是當前 route；正式站初始化可能在第一輪把頁面拉回前一個 route，壓測要在同一 tab 內重新點 nav / `showView`，不可把這誤判成資料列失敗。
- 本地 `scripts/local-api-only-server.js` 曾因 `/api/mobile-boot` handler 出現 `ERR_HTTP_HEADERS_SENT` 中斷；這是本地測試 server 限制，不代表自選股功能失敗。
- `vercel dev` 曾因專案 dev script 遞迴呼叫自身而不可用，不要把這個當成自選股 runtime 失敗。
- live UI E2E 偶爾會遇到 Chrome CDP 啟動瞬間拒連或第一輪事件時序抖動；以最終 desktop night / sun matrix 綠燈為準，必要時重跑確認。
- 若使用者回報「尚未同步」或「加了很多台股但卡片沒增加」，先查新增流程、storage guard、invalid meta、E2E negative test，不要先叫使用者清 cache。

## AI 判讀

AI 判讀是市場總覽的第二分頁。

固定顯示：

- 上方顯示 AI 判讀總覽圖表 / 儀表板。
- 必須包含樣本數、上漲、下跌、信心、盤勢結論、風險或領先族群等摘要。
- 下方顯示 AI 今日重點、風險提醒、觀察標的 / 族群列表。
- 黃框箭頭或可點擊符號點進去，要開啟對應股票 / 族群 modal。
- modal 要維持深色質感卡片，不可跳成瀏覽器預設白底文字。
- AI 判讀 09:00-13:30 巡邏；收盤後顯示最後 13:30 snapshot。
- 若 13:30 snapshot 尚未產生，可顯示最近 snapshot，但必須標明 snapshot 時間與 source。

AI 判讀不可只顯示純文字，不可沒有圖表 / 儀表板。

## 策略2

策略2是當沖即時資料。

規則：

- 不可冷處理。
- 不可放進 desktop route snapshot。
- 可做 compact / live API。
- 可做 pointerdown prewarm。
- 可做 memory cache，但必須保留 live intent。

## Strategy1 戰鬥契約

策略1是「明日開盤入 / open-buy」API-only / Supabase complete-run 策略。  
2026-06-26 校正後，以下規則是正式口徑。

### 權威資料來源

Strategy1 正式來源只認：

- Supabase `strategy1_open_buy_runs`
- Supabase `strategy1_open_buy_results`
- Supabase `strategy1_open_buy_audit`
- Supabase `v_strategy1_ready_status`
- Supabase `strategy1_futopt_preopen_live_snapshot`
- Supabase `v_strategy1_futopt_preopen_join_terminal`
- Supabase `v_strategy1_preopen_features`
- Supabase `v_strategy1_preopen_history_coverage`
- `/api/open-buy-latest`

不可用 static JSON、暫存檔、舊 snapshot 或人工結果當正式權威。

### 三段式時間窗

Strategy1 分成三個正式階段：

```text
21:30  chip candidate / open-buy candidate
08:45  futopt preopen observe
08:55  final flame gate
```

21:30 是候選，不是買進訊號。  
08:45 是個股期貨與試搓觀察，不是買進訊號。  
08:55 才是最終火焰 gate。

### 顯示與 Publish 規則

- 21:30 candidate card 只顯示候選，不可顯示火焰。
- 08:45 observe card 只顯示期貨強 / 試搓強觀察，不等於 BUY。
- 08:55 final flame gate 全過，且 result decision 是 BUY，才可顯示火焰。
- 主清單 `main_matches` 只顯示 `decision=BUY`。
- `WATCH` / `BLOCK` 不進主清單，只留在 Supabase results / audit / debug。
- Strategy1 不可因 preopen / futopt 還沒 ready 就清空 latest complete run。
- 非時間窗或 controlled not_ready 時，terminal 必須顯示 reason，不可誤判 source missing。

### 休假日 / 非交易日 Carry-Forward

休假日、週末、非交易日，或尚未到 08:45 / 08:55 source ready 的時間，不可把 Strategy1 顯示成 0 檔空白。

正式口徑：

```text
星期五 21:30 complete run
-> 週末 / 休假日 terminal 繼續顯示該 21:30 初篩名單
-> 星期一 08:45 接續個股期貨 / preopen observe
-> 星期一 08:55 再做 final flame gate
```

顯示時必須標明：

```text
previous_2130_carry_forward
previous-2130-carry-forward
休假日沿用 21:30 初篩名單
等待 08:45 個股期貨 / 08:55 搓合
```

不可做：

- 不可因 `not_trading_day` / `preopen_not_ready` / `futopt_not_ready` 清空 latest complete run。
- 不可把 Friday 21:30 candidate 誤標成 Monday 08:55 BUY。
- 不可讓 `desktop_route_snapshot` 的舊 `waiting_snapshot` 覆蓋 API live carry-forward。
- 不可讓手機 fragment 顯示舊空 snapshot。

必須保護的程式路徑：

- `/api/open-buy-latest` 必須允許 `allowPrevious2130Run`。
- `/api/mobile-fragment?tab=strategy1` 必須避開 Strategy1 stale waiting snapshot。
- `/api/terminal-fast-bundle` 必須在 Strategy1 snapshot 是空 waiting 狀態時執行 `strategy1-previous-2130-carry-forward` repair。
- `scripts/verify-publish-gate.js` 必須檢查以上 marker，少一個就擋 publish。

### Strategy1 七關驗證

Strategy1 修改後至少要過以下七關，不能只看 API：

| 關卡 | 驗證重點 |
|---|---|
| 冷啟動 | `npm run verify:terminal-cold-start -- --routes=strategy1` |
| 切頁互動 | `npm run verify:terminal-ui-e2e -- --routes=strategy1` |
| 快取一致 | `/api/open-buy-latest`、`/api/terminal-fast-bundle`、`/api/mobile-fragment?tab=strategy1` 的 runId / count 必須一致 |
| 空資料保護 | `npm run verify:strategy1-open-buy-ui`，且休假日不可回 0 檔 waiting snapshot |
| 手機布局 | UI E2E 必須涵蓋手機直向 / 手機陽光 / 電腦看手機版 |
| Runtime ownership | `npm run verify:runtime-ownership`、`npm run verify:fast-shell-self-contained` |
| Live 驗證 | `npm run guard:production`，並確認正式站 Strategy1 API / fast bundle / mobile fragment 都有 rows |

### 21:30 Candidate Gate

21:30 候選階段需要：

- `daily_ready = true`
- `chip_ready = true`
- `strategy1_open_buy_runs` 有 latest complete run
- `strategy1_open_buy_results` 有候選結果
- `strategy1_open_buy_results` 必須可用 `run_id` / `trade_date` / `symbol` 或 `code` 查回

21:30 階段允許顯示：

```text
候選卡
BUY/WATCH/BLOCK 統計
籌碼佳 / 日線佳 reason
```

21:30 階段禁止：

```text
顯示火焰
提示可盤前掛漲停
把候選直接當 08:55 BUY
```

### 08:45 Futopt / Preopen Observe Gate

08:45 觀察階段需要：

- `strategy1_futopt_preopen_live_snapshot` 有當日資料
- `v_strategy1_futopt_preopen_join_terminal` 有當日 join rows
- `futopt_quotes_live` 必須有可被 terminal 使用的 `symbol` 或 `source_symbol`
- `v_futopt_stock_mapping_ready` 必須能把個股期貨對回股票代號
- `v_strategy1_ready_status.futopt_ready` 要能明確回 true / false

08:45 階段允許：

```text
顯示期貨強觀察
顯示試搓強觀察
顯示 futopt/preopen source health
```

08:45 階段禁止：

```text
顯示火焰
發布 final BUY
用空結果覆蓋 latest complete run
```

### 08:55 Final Flame Gate

08:55 火焰 gate 需要同時成立：

- `preopen_ready = true`
- `futopt_ready = true`
- `decision_ready = true`
- `flame_gate_open = true`
- result `decision = BUY`
- setup type 是 A 級 / open-buy 正式型態

只有 08:55 final flame gate 全過的標的，股票名稱旁才可顯示火焰。

若以下任一條件不成立：

- `preopen_ready = false`
- `futopt_ready = false`
- `decision_ready = false`
- `flame_gate_open = false`

則狀態是 controlled not_ready，terminal 必須保留 latest complete run 並顯示 `flame_reason`。

### Ready Status Contract

`v_strategy1_ready_status` 必須提供以下欄位：

```text
strategy
local_date
local_time
current_phase
trade_date
daily_ready
chip_ready
preopen_ready
futopt_ready
decision_ready
flame_gate_open
flame_reason
updated_at
```

語意：

- `daily_ready`：日線 / 基礎資料 ready。
- `chip_ready`：籌碼資料 ready。
- `preopen_ready`：當次盤前試搓資料 ready。
- `futopt_ready`：當次 08:45 個股期貨觀察資料 ready。
- `decision_ready`：可做最終 BUY 判斷。
- `flame_gate_open`：允許 terminal 顯示火焰。
- `flame_reason`：not_ready 時必須可讀，不可空白。

### Terminal Key Contract

所有 Strategy1 terminal / scanner / API 使用的資料列，至少要看得到：

```text
run_id
trade_date 或 scan_date
symbol 或 code
name
decision
score
reason
setup_type
block_reason
updated_at
payload
```

若底層 source 只有 `code` 沒有 `symbol`，Supabase view 必須補出 `symbol`。  
若底層 source 只有 `symbol` 沒有 `code`，Supabase view 必須補出 `code`。  
terminal 不可因欄位命名差異而讀不到標的。

### Source Visibility / Coverage Gate

Strategy1 每次檢查都要分三件事：

```text
1. 資料存在嗎？
2. health view 算得對嗎？
3. terminal scanner key 看得到嗎？
```

source connected 不等於 final gate open。  
若資料存在但時間窗未開，狀態應該是 controlled not_ready。  
若資料不存在或欄位缺失，狀態才是 source missing / failed。

### API Contract

正式 API：

```text
/api/open-buy-latest
```

terminal compact path 必須支援：

```text
/api/open-buy-latest?canvas=1&compact=1&shell=1&limit=N&live=1
```

API 必須讀 Supabase runs/results 與 `v_strategy1_ready_status`。  
API 不可使用 retired static JSON fallback 當正式資料。  
compact / snapshot path 在 `decision_ready=false` 時，可以顯示 latest complete candidate，但必須標明 decision pending / not_ready reason。

### Self-Test Gate

Strategy1 daily verify 必須確認：

- `/api/open-buy-latest` 可讀
- latest complete run 可讀
- result rows 可讀
- `decision=BUY` 主清單可讀
- `WATCH` / `BLOCK` 留在 audit/debug，不混入主清單
- `v_strategy1_ready_status` 有完整 ready flags
- 21:30 / 08:45 / 08:55 phase status 都能回 reason
- terminal key `run_id` / `trade_date` / `symbol` 或 `code` 可讀

失敗時不可覆蓋 latest complete run。

### 排程原則

Strategy1 每日節奏：

```text
21:30 產生 open-buy candidate / 籌碼佳候選
08:45 刷新 futopt preopen observe source
08:55 執行 final flame gate / decision readiness check
```

Strategy1 battle verify 排程：

```text
21:35 verify candidate
08:50 verify futopt / preopen observe
08:52 verify flame gate
```

08:55 前不可顯示火焰。  
08:55 後若 final gate 未開，也不可顯示火焰。  
只有 final gate 全過標的才可顯示火焰。

### 失敗處理規則

遇到以下任何狀況，Strategy1 不可發布壞資料：

- source table / view 缺欄位
- `v_strategy1_ready_status` 缺 ready flag
- `flame_reason` 空白
- latest complete run 不可讀
- result rows 不可讀
- terminal key 看不到 `symbol` / `code`
- 08:55 final gate 未開

正確行為：

```text
preserve latest complete run
surface reason
show warning
do not publish bad data
do not show flame
```

## Strategy3 戰鬥契約

策略3是隔日沖 API-only / Supabase complete-run 策略。2026-06-26 校正後，以下規則是正式口徑。

### 顯示與 Publish 規則

- 候選清單固定顯示 field gate 後的 12 檔。
- TradingView / TV 條件只負責加火焰，不可把候選清單砍成 0 檔。
- complete run 不可因 tvPassCount=0 而寫 0 筆；tvPassCount 可以是 0，但 count 必須維持 12。
- 若 fieldGateReadyCount < 12，scanner 必須 failed/block，不可覆蓋 latest complete run。
- API 最新來源是 `/api/strategy3-latest` 與 Supabase `strategy3_scan_runs` / `strategy3_scan_results`，不使用 static JSON 作為權威。

### Field Gate 硬門檻

- 漲幅 3% 到 5%。
- 量比 > 1，量比不足時以 `stock_daily_volume` 補 `avgVolume` 後計算。
- 外盤 > 內盤。
- 成交張數保留為欄位與評分資訊，不使用「內外盤累計 < 3000 張」作為硬剔除。
- 已移除「貼近近 100 根收盤高點」硬剔除；`nearHigh` 只作為診斷欄位。

### TV Close-Price Proxy

- 控盤線與 OBV 以 close-price proxy 為正式口徑，避免 Supabase 1m high/low 大量退化造成誤判。
- TV pass 條件：`controlOk=true` 且 `obvOk=true`，`nearHigh` 不作硬門檻，除非 `STRATEGY3_REQUIRE_NEAR_100_HIGH=1`。
- 每檔 result payload 必須保留 `tvBreakdown`：`controlOk / obvOk / nearHigh / nearHighOk / candleRows / candleSource / degenerateRatio / after1300Rows / formulaVersion / controlSource`。

### Source Drift Gate

每次 scanner publish 前必須檢查：

- `v_strategy3_quote_ready` count >= 1000
- `strategy3_ready_snapshot` count >= 1000
- `fugle_quotes_latest` count >= 1000
- `stock_daily_volume` count >= 1000 且 latestDate 存在

任一來源 failed 時，scanner 不可硬跑，不可覆蓋 latest complete run。

### Self-Test Gate

scanner 必須有兩段 self-test：

- pre-publish `selfTest`：`fieldGateReadyCount=12`、`tvPassCount` 欄位存在、每檔有 `tvOvernightEntry` breakdown、`sourceDriftHealth=ready`。
- published `publishedSelfTest`：寫入 Supabase 後讀回 `count=12`、`missingBreakdown=0`、`tvPassCount` 可讀。

驗證指令：

```powershell
Set-Location -LiteralPath C:\fuman-terminal
node scripts\verify-strategy3-battle-state.js
```

成功條件：`ok=true`、API `count=12`、`fieldGateReadyCount=12`、`tvBreakdownRows=12`、`publishedSelfTest.ok=true`、`sourceDriftHealth.status=ready`。

### 排程

正式 Strategy3 建議三段：

- 13:00 complete scan；掃描腳本會先 refresh ready snapshot，再跑 resource health gate / self-test，通過才 publish。
- 13:05 battle verify / watchdog；必須在 13:30 收盤前完成，避免事後才發現壞 run。

安裝腳本：

```powershell
Set-Location -LiteralPath C:\fuman-terminal
.\install-strategy3-battle-tasks.ps1
```

## 正式發布 / 上傳硬規則

以下是所有 Codex 都必須遵守的上傳規則。缺一項就不要發布。

### 來源規則

- 不要從 dirty 的 `C:\fuman-terminal` 直接 deploy。
- 正式發布只能從乾淨 release clone / worktree 執行。
- origin 必須指向：

```text
https://github.com/ginova777-cmd/fuman-terminal.git
```

- branch 必須追蹤 `origin/main` 或明確 release branch。
- 不可把本機 `C:\fuman-terminal` 當 upstream。
- 不可把舊 `C:\fuman-terminal-sync` 當 upstream。
- 不可使用舊 sync / publish-sync / preview project 當正式來源。

### 發布前必跑

發布前一定先跑：

```powershell
git status -sb
npm run verify:publish-gate
```

要求：

- `git status -sb` 不能有未確認 dirty / unrelated files。
- `verify:publish-gate` 必須通過。
- 若 publish gate 擋住，先修正原因；不可繞過。
- 不可為了通過 gate 復活舊檔案、舊 workflow、static JSON、Google Sheet 或舊 sync 路徑。

### 正式部署指令

只有 publish gate 通過後，才可以：

```powershell
vercel --prod --yes
```

部署時必須確認：

- Vercel project 是正式 `fuman-terminal`。
- 正式 alias 是 `https://fuman-terminal.vercel.app`。
- 不可只看 preview URL 就回報完成。

### 部署後必跑

deploy 後一定跑：

```powershell
npm run guard:production
npm run verify:live-version
npm run monitor:production
```

若修改手機，追加：

```powershell
npm run verify:mobile-api-only:live
npm run verify:mobile-cache-contract:live
```

若修改桌面 UI，必須實際驗：

```text
市場總覽
AI 判讀
策略1
策略2
策略3
策略4
策略5
買賣超
CB
權證
自選股
```

若修改自選股，追加：

```powershell
node --check terminal-watchlist-shell.js
node --check terminal-hotfix.js
node --check scripts/verify-terminal-ui-e2e.js
npm run verify:runtime-hotfix
npm run verify:sw
npm run verify:terminal-ui-e2e -- --only=desktop-night,desktop-sun --routes=watchlist --route-timeout=90000 --eval-timeout=60000
```

自選股 deploy 後追加：

```powershell
npm run verify:runtime-hotfix -- --live
npm run verify:terminal-ui-e2e -- --only=desktop-night,desktop-sun --routes=watchlist --route-timeout=90000 --eval-timeout=60000
```

### Commit / receipts 規則

- `data/scan-receipts/*` 不要跟核心程式修正混 commit。
- receipts 只有在明確決定成為新 baseline 時才 commit。
- runtime receipt、暫存輸出、scanner log 不可混入 UI / API 修正。
- 修改 AGENTS.md 或文件，不需要重新 deploy Vercel。
- 修改正式站程式、API、UI、路由或 service worker，才需要 deploy。

### 禁止用上傳掩蓋問題

- 不要手動 full scan 來掩蓋問題。
- 不要用 version bump 掩蓋資料錯誤。
- 不要用 cache bump 掩蓋 renderer 錯誤。
- 不要用 redeploy 掩蓋 Supabase snapshot / API 問題。
- 策略1/3/4/5、買賣超、CB、權證等完整掃資料等自然排程更新。
- 策略2、即時雷達、市場總覽才要求 same-day。

## 策略 / 籌碼 Codex 合約

每個策略或籌碼 Codex 只負責自己的：

```text
scanner
Supabase complete run / table / view / RPC
API handler
snapshot payload
```

不可碰：

```text
terminal shell
fixed shell / Canvas 架構
版本號
Vercel 部署
其他策略規則
```

API 必須支援：

```text
canvas=1&compact=1&shell=1&limit=N
```

API 回傳至少要有：

```text
runId
date / usedDate / updatedAt
source
count / resultCount
rows / items
```

## 驗證

正式 repo 內常用輕量驗證：

```powershell
npm run verify:run-gates
npm run monitor:production
npm run verify:live-version
node --use-system-ca scripts\verify-deployment.js
npm run e2e:smoke
```

工作區只讀檢查：

```powershell
node verify-strategy-connections.js
node verify-legacy-flow-guards.js C:\fuman-terminal
```

## 回報格式

回報使用者時分三類：

```text
已完成
驗證結果
剩餘風險 / 下一步
```

不要只說「好了」。要講清楚有沒有部署、有沒有 bump version、有沒有碰 dirty tree、有沒有驗正式 alias。
