# AGENTS.md

Last updated: 2026-06-25 Asia/Taipei

給後續接手本工作區的 Codex：這份只保留目前有效狀態。不要沿用舊 Google Sheet、舊 static JSON、舊同步路徑、舊版本 bump、舊黃框 UI、舊部署流程。

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

## 市場總覽 / 熱力圖

市場總覽是正式桌面終端主畫面，不是泛用策略頁，也不是純表格頁。

### 固定顯示

- 點左側「市場總覽」後，主畫面必須顯示市場總覽專用 UI。
- 上方必須顯示四張指數卡：加權指數、櫃買指數、台指期夜盤、台指次月。
- 指數卡必須顯示數值、漲跌、漲跌幅或明確等待狀態。
- 指數卡下方直接接熱力圖區塊。
- 熱力圖區塊必須有標題、資料時間 / source、分類 tabs、產業 / 族群卡片。
- 熱力圖不可退回泛用 `Rank / Code / Signal` 表格。

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
- 上方四張指數卡存在且有資料或受控等待狀態。
- 熱力圖分類 tabs 存在且可切換。
- 熱力圖卡片有資料或受控空狀態。
- 點產業 / 族群卡片會開啟股票 modal。
- modal 不是白底純文字。
- modal 內有股票代號、名稱、漲跌幅、成交值等資訊。
- `ticker-strip` 和 `strength-panel` 不存在。
- 正式 alias `https://fuman-terminal.vercel.app` 有更新，不只看 preview URL。

### 發布 / 上傳限制

- 修改熱力圖程式後，必須走正式發布 / 上傳硬規則。
- 不要從 dirty 的 `C:\fuman-terminal` deploy。
- 只能從乾淨 release clone / worktree 發布。
- 發布前必跑 `git status -sb` 和 `npm run verify:publish-gate`。
- publish gate 必須通過才可 `vercel --prod --yes`。
- deploy 後必跑 `npm run guard:production`、`npm run verify:live-version`、`npm run monitor:production`。
- 不要把 `data/scan-receipts/*` 跟熱力圖程式修正混 commit。
- 不要手動 full scan 來掩蓋熱力圖資料問題。

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
