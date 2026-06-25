# Fuman Terminal AGENTS.md

Last updated: 2026-06-24 Asia/Taipei

給後續接手的 Codex：這份是目前有效狀態。舊版同步站、舊 GitHub workflow、舊 auto-release、舊 governance 文件、舊排程 wrapper 都已退休。不要為了通過舊檢查而把它們復活。

## 目前目標

使用者要的是一個快、穩、可公開給客戶看的輔滿股票終端。

目前方向：

- 正式站只用 `https://fuman-terminal.vercel.app`
- 架構以 Supabase API / snapshot 為資料核心
- 桌面與手機都走固定 shell、快照優先、即時資料分流
- 策略2當沖維持即時，不冷處理
- 其他策略與籌碼頁面盡量走後端預產 route snapshot
- 不靠 bump 版本號解決資料或手感問題
- 不靠 Google Sheet、靜態 JSON、瀏覽器強刷、舊 workflow 當正式資料來源

## 目前正式入口

```text
Production URL:
https://fuman-terminal.vercel.app

Production repo / app:
C:\fuman-terminal

Vercel project:
fuman-terminal
```

只把 `C:\fuman-terminal` 當正式程式根目錄。不要再建立或依賴已退休的同步/發布副本。

部署安全規則：

- 不要從 dirty 的 `C:\fuman-terminal` repo 部署；若正式根目錄有本機 dirty 內容，必須改用乾淨 worktree。
- 乾淨 worktree 部署前必須確認 `.vercel/project.json` 指向正式 `fuman-terminal` 專案。
- 若乾淨 worktree 沒有 `.vercel/project.json`，不可盲部署；先確認 projectId / projectName，避免部署到舊 sync 或錯誤 Vercel 專案。

## 已退休且不可復活

以下流程已刪除或退出正式鏈路：

- GitHub Actions workflow dispatch
- 舊外部排程 dispatch API
- 舊 auto main release wrapper
- 舊 patrol schedule wrapper
- 舊 fuman master schedule wrapper
- 舊 sync / publish-sync Vercel 專案
- 舊 root workflow yml
- 舊 workflow alert 寄信腳本
- 舊 sync-only governance docs
- 舊 static JSON 當正式 freshness authority

如果 verifier 或程式碼還要求以上舊檔案，優先更新 verifier / 引用，不要把舊檔案加回來。

## 目前資料權威

正式資料流：

```text
scanner / writer
-> Supabase run 或 route snapshot
-> no-store API
-> fixed shell / Canvas UI
```

正式 freshness 來源：

- Supabase complete run
- Supabase route snapshot
- API 回傳的 `runId` / `snapshotId` / `updatedAt` / `usedDate`

策略快照 / API gate 不能只看 `run_id`。所有策略資料接入 desktop snapshot 或 terminal fast bundle 前，至少要核對：

- run row 必須 `status=complete` 且 `complete=true`。
- scanner readback 必須成功，不能只寫入後未回讀就當完成。
- `expected_total` / `scanned_count` / `readback_count` 這類完整性欄位必須合理。
- 有 `expected_total` 的策略必須確認 `expected_total > 0`、`scanned_count > 0`、`expected_total === scanned_count`。
- results row count 必須和 run metadata 對得上；若有 `result_count`，readback row count 必須一致。
- results row count 為 0 或小於預期時，不能把它包進正式 snapshot。
- 小包 API 可只回 `limit=N` 筆可畫資料，但 `count` / `resultCount` / readback 必須代表完整 complete run 結果，不可把小包筆數誤當完整結果。
- API 回傳給前端的小包可以限制 `limit`，但完整性判斷必須在後端用 complete/readback/expected_total 做完。
- 若 complete/readback/expected_total 任一 gate 不過，保留上一版可用 snapshot，不要發布 partial 或空包假裝成功。

不是正式 freshness 來源：

- `/data/*.json`
- `version.json`
- service worker cache
- frontend version bump
- browser hard refresh
- Vercel redeploy side effect
- Google Sheet

## Supabase

Supabase project:

```text
https://jxnqyqnigsppqsxinlrq.supabase.co
```

正式站需要以下 Vercel environment variables：

```text
SUPABASE_URL
SUPABASE_ANON_KEY
FUMAN_SUPABASE_SERVICE_ROLE_KEY
```

注意：

- service role key 只能放在 Vercel / 本機 secret，不要寫進程式碼、文件、commit、聊天。
- 若 service role key 曾外洩，請使用者到 Supabase 旋轉。
- 前端展示用 anon key / RLS；寫 snapshot 或維護任務才用 service role。

## 桌面終端目前架構

桌面已朝極致化方向改造：

- fixed shell
- Canvas / OffscreenCanvas 列表
- memory snapshot
- IndexedDB / local snapshot fallback
- route snapshot first
- latency log
- polling 降噪
- 舊大主程式冷啟與隔離
- 非策略頁逐步 fixed shell / virtual list

重要原則：

- 左側分頁點擊必須先立即切 shell，不等 API。
- 舊資料可以先用 snapshot 顯示，再背景更新。
- 點擊期間暫停背景 polling，避免搶主執行緒。
- 不要讓舊 `terminal-app.js` 的 showView / render / warm load 搶回主控制權。

### 2026-06-24 策略 fast shell API-only 修正

正式站目前策略頁 fast shell 基準：

```text
Latest strategy fast shell UI cleanup commit:
30b76d194fb1bd2018fa2d83fca70551179328e0

API-only polling stability commit:
43e89f01cee68948c3b3da53d2bca9920d569f38

Strategy3 API bridge commit:
057f7ec1a14abcaddcb830b90246c66537940bad
```

策略1 / 3 / 4 / 5 在桌面 fixed shell 必須走 API-only rows：

- 不再用 DOM snapshot 當策略資料來源。
- fast shell 啟動時會清掉策略1 / 3 / 4 / 5 的舊 `sessionStorage` / `IndexedDB` DOM snapshot。
- `strategy3` 不可再顯示 `dom-snapshot` 來源，不可把 DOM 文字抽成 `多多訊號2035`、`A區數量` 這類錯欄位資料。
- `terminal-desktop-fast-shell.js` 的 `__fumanDesktopFastShellApiOnlyPoll` marker 必須保留，避免同頁重新載入新 fast shell 腳本時被舊 marker 擋住。
- API-only polling 需要保守輪詢，目前 `API_ONLY_POLL_MS = 30000`；不要改成密集 polling。
- polling 必須用 row signature 比對；資料簽名沒變時不可重建整個 DOM，只更新 Canvas / status，避免每 30 秒跳動。
- 策略2當沖維持 live intent，不放進冷處理；不要把策略2加入 API-only cold snapshot 清理規則。

策略1 / 2 / 3 / 4 / 5 的策略頁舊 chrome 已剔除：

- 隱藏舊 `strategy-header`。
- 隱藏左側 `strategy-list` / 策略清單。
- 隱藏舊 `strategy-toolbar`。
- 隱藏舊三張 metrics 卡。
- 隱藏舊搜尋股票列。
- 隱藏 Canvas shell 內部搜尋 / 刷新 / status toolbar。
- 保留且優先顯示 fixed shell / Canvas 策略結果主畫面。

不可回復：

- 不要恢復黃框區域的舊策略清單、舊 toolbar、舊 metrics、舊搜尋列。
- 不要用 DOM snapshot / session snapshot / IndexedDB snapshot 取代策略 API rows。
- 不要靠 bump 版本號或 service worker cache bump 掩蓋資料或畫面錯誤。
- 不要把 Codex latency/debug 面板露給客戶。

### 2026-06-24 買賣超 / CB fixed shell 銜接狀態

本段是給後續 Codex 的戰鬥狀態交接。使用者已明確指出買賣超畫面曾經「沒有資料」、「內容顯示很奇怪而且很慢」、「外資+投信佔5日均量不可能是 0」。這些都不是前端殼要重寫的問題，而是資料源、renderer 與舊 verifier 的銜接問題。

目前正式 main / production 已接上的基準：

```text
Latest verified production HEAD:
19e6b38e731b9c7fab3d5d6d12c7805247325e5b

Known included commits:
794f59dc Remove retired chip static checks
b81fb1de Render fixed chip pages on main canvas
13afa1d8 Restore chip trade canvas filters
f64fd324 Render chip trade canvas table directly
6136d143 Fix chip foreign trust volume counts
```

買賣超固定 shell 現況：

- `terminal-desktop-fast-shell.js` 不可再讓買賣超 / CB / 權證走泛用策略 Canvas worker renderer；這三個 fixed pages 必須由 main thread Canvas 直接畫，避免空白或欄位錯位。
- 買賣超不可顯示泛用策略表格欄位 `Rank / Code / Signal`；要用買賣超自己的欄位，例如 `外資買超 / 投信買超 / 連買 / 佔均量 / 漲幅`。
- fast shell 第一屏買賣超預設 filter 是 `foreignStreak`，讓 Supabase snapshot / institution API 可立即畫出資料。
- `tdcc1000` 是較慢的 TDCC 組合條件，必須保留，但只在使用者點擊該 filter 時才打 `/api/institution-tdcc-breakout-latest`，不要拿它阻塞第一屏。

買賣超原本 5 個策略模式都要存在：

```text
tdcc1000                外資連3買 + 1000張連3週增     -> /api/institution-tdcc-breakout-latest
foreignTrustVolumePct   外資+投信佔5日均量             -> /api/institution-latest
foreignStreak           外資連買日                     -> /api/institution-latest
trustStreak             投信連買日                     -> /api/institution-latest
jointStreak             同買日                         -> /api/institution-latest
```

買賣超 API / scanner 規則：

- `api/institution-latest.js` 必須支援 `canvas=1&compact=1&shell=1&limit=N`，並回小包可畫 rows，不要回整包大資料。
- `api/institution-tdcc-breakout-latest.js` 也必須支援 `canvas=1&compact=1&shell=1&limit=N`。
- `api/institution-latest.js` 的 transport gate 是 `complete-run-readback`；只允許 Supabase complete run + readback 完整通過後進正式輸出。
- `scripts/scan-institution-cache.js` 寫入 Supabase 後必須 read back，確認 count / completeness 後才 mark complete。
- 小包 `limit` 只能限制前端繪圖 rows；完整性判斷不能用小包筆數代替完整 run count。

買賣超「外資+投信佔5日均量」不可再假 0：

- API rows 若有 `foreignTrustBuyVolumePct` / `institutionBuyVolumePct`，前端可直接使用。
- 若舊 snapshot 只有 `foreign`、`trust`、`fiveDayAvgVolume`，必須用 `(foreign + trust) / fiveDayAvgVolume * 100` 推導。
- 若對應 endpoint 尚未載入，filter badge count 顯示 `...`，不要顯示 `0`。
- 只有在對應 endpoint 實際完成 fetch 且回傳 zero results 時，才可以顯示 `0`。

已確認解法，不要回退：

- `api/institution-latest.js` 現在必須直接補出 `foreignTrustBuyVolumePct` 與 `institutionBuyVolumePct`。
- 公式固定為 `(外資 + 投信) / 5日均量 * 100`；欄位來源是 `foreign` + `trust` / `fiveDayAvgVolume`。
- `terminal-desktop-fast-shell.js` 必須保留前端 fallback：即使吃到舊 snapshot 沒帶 `foreignTrustBuyVolumePct` / `institutionBuyVolumePct`，也要用 `foreign` / `trust` / `fiveDayAvgVolume` 現算。
- 不可把缺欄位、舊 snapshot、跨 endpoint 未載入誤判成 `0`。
- TDCC 這類另一個 endpoint 尚未載入的 count 要顯示待載入符號 `...`，不可顯示假 `0`。

這次實際遇到的舊阻擋：

- 舊 `verify:chip` / `health:chip` 仍硬追已退休的 `data/institution-latest.json`，在乾淨 API-only clone 會失敗；處理方式是刪 verifier / script 引用，不恢復靜態 JSON。
- 舊 snapshot 可能沒有 `foreignTrustBuyVolumePct` / `institutionBuyVolumePct`，導致前端若只看顯式欄位會顯示假 `0`；處理方式是 API 補欄位 + fast shell fallback。
- 舊泛用策略 renderer 會把買賣超畫成 `Rank / Code / Signal`，內容怪且像沒資料；處理方式是買賣超使用自己的 Canvas table renderer。
- 部署驗證時 preview deployment 與正式 alias 可能短暫不同步；驗證必須看 `https://fuman-terminal.vercel.app` 正式 alias 與 production monitor，不可只看 preview URL。

已退休的買賣超靜態 verifier 不可復活：

- `verify:chip` / `health:chip` 已從 `package.json` 移除。
- `scripts/verify-chip-trade-contract.js` 已移除。
- `scripts/health-check-chip-trade.js` 已移除。
- 不要為了舊 verifier 恢復 `data/institution-latest.json`；乾淨 API-only clone 沒有這個退休靜態 JSON 是正確狀態。

route snapshot / fast bundle 接入要求：

- 非策略2的 fixed / 策略資料源要能被 `/api/desktop-route-snapshot` 收進 endpoints。
- `/api/terminal-fast-bundle` 要優先讀 Supabase `desktop_route_snapshot`。
- strategy2 是當沖即時資料，不可放進 desktop route snapshot；可做 compact/live API、pointerdown prewarm、memory cache，但必須保留 live intent。
- 不要新增密集 polling，不要讓 `terminal-app.js` 在切頁瞬間重新接管畫面。

部署與驗證：

- 不要直接從 dirty 的 `C:\fuman-terminal` 部署；必要時使用乾淨 worktree。
- 修改 JS 後至少跑 `node --check <改過的 js 檔>`、`npm run verify:version`、`npm run verify:runtime-hotfix`、`npm run verify:desktop-api-only`。
- 部署後驗正式站，不只看 preview URL：`npm run verify:live-version`、`node --use-system-ca scripts\verify-deployment.js`、`npm run e2e:smoke`、`npm run monitor:production`。
- production health 應維持 `snapshotHit=true`、`snapshotFresh=true`、`partial=false`、`endpointCount>=10`、`hasStrategy2Snapshot=false`。

## 策略規則

### 策略1：明日開盤入正式流程

策略1保留在終端，不能刪掉，也不能改成會員牆或靜態展示。策略1目前是正式站實戰鏈路：

```text
21:30 候選完整掃
-> Supabase strategy1 complete run
-> 08:55 最終確認 / decision_ready
-> /api/open-buy-latest no-store API
-> /api/desktop-route-snapshot
-> /api/terminal-fast-bundle snapshot first
-> 終端策略1畫面
-> 09:00 只執行 BUY 名單
```

目前程式基準：

```text
Production code baseline before this AGENTS update:
e40588a2

Strategy1 API:
api/open-buy-latest.js

Strategy1 scanner:
scripts/scan-open-buy-cache.js
api/scan-open-buy.js

Desktop snapshot builder:
lib/desktop-route-snapshot-builder.js

Fast bundle:
api/terminal-fast-bundle.js
```

策略1資料權威：

- `strategy1_open_buy_runs`
- `strategy1_open_buy_results`
- `v_strategy1_ready_status`
- `/api/open-buy-latest`
- `/api/desktop-route-snapshot`
- `/api/terminal-fast-bundle`

策略1不是資料權威：

- `data/open-buy-latest.json`
- `data/open-buy-page-*.json`
- `data/open-buy-backup.json`
- `data-manifest`
- `data-status-index`
- `live-freshness-ok`
- `verify-data-freshness`
- `fuman-terminal-sync`
- `schedule-dispatch`
- service worker cache
- frontend version bump

策略1完整掃時間與用途：

- `21:30`：產生明日候選。完整掃全市場普通股，寫入 Supabase complete run。
- `08:55`：最終確認。確認期貨/市場必要資料、run readiness、`decision_ready`，供開盤前展示與執行。
- `09:00`：只執行 `decision=BUY` 名單。`WATCH` 只觀察，`BLOCK` 不進場。
- `09:01`：只有部分 setup 的進場提示會要求站回開盤價；這是策略輸出文字的一部分，不要在前端另改規則。

策略1 scanner 必須這樣跑：

```powershell
$env:FULL_SCAN="1"
node scripts\scan-open-buy-cache.js
```

scanner 規則：

- `FULL_SCAN=1` 是必要條件；非 full scan 必須直接失敗。
- `OPEN_BUY_API_ONLY = true` 必須維持。
- 不允許 partial static JSON 發布。
- 掃描全市場股票 universe，預設批次 `OPEN_BUY_BATCH_SIZE=48`。
- 每個 chunk 失敗最多 retry 3 次；仍失敗時切半重試。
- 任何 failed code、掃描數不足、`scanned.size !== codes.length` 都不能 publish complete。
- running 狀態只可寫 Supabase status，不可覆蓋 latest complete result。
- complete output 才能 upsert `strategy1_open_buy_runs` / `strategy1_open_buy_results` / latest row。
- readback 必須核對 latest row、latest complete run、results row count 與 run count。

策略1 API gate：

```text
gate = complete-run-authoritative+decision-ready
```

`/api/open-buy-latest` 必須：

- 永遠回 `Cache-Control: no-store`。
- 支援 `canvas=1&compact=1&shell=1&limit=N`。
- compact / shell / snapshotBuild / fastBundle 路徑也必須讀 `v_strategy1_ready_status`，不能跳過 `decision_ready`。
- 先讀 `v_strategy1_ready_status`。
- `decision_ready !== true` 時，不可把今日未就緒空資料當正式結果。
- 再讀 `strategy1_open_buy_runs` 最新 complete run。
- complete run 必須 `status=complete`、`complete=true`、`expected_total > 0`、`scanned_count > 0`、`expected_total === scanned_count`。
- 若 ready status 有 `latest_trading_day` / `trade_date`，run date 必須對齊。
- 再用 `run_id` 讀 `strategy1_open_buy_results`。
- 只把 `decision=BUY` 放入 `matches` / `rows` 給前端主清單。
- `WATCH` / `BLOCK` 可以保留統計與 meta，但不能混入 BUY 執行名單。

策略1未就緒空包保護：

- `futopt_not_ready`
- `waiting_snapshot`
- `decisionReady=false`
- `strategy1_decision_not_ready`
- `strategy1_complete_run_missing`
- `strategy1_complete_run_empty`
- `strategy1_complete_run_fetch_failed`
- `snapshot-friendly-empty`

遇到以上狀態時：

- 不准覆蓋既有可用 desktop snapshot 畫面。
- 不准把空包寫成 complete snapshot。
- 不准讓 terminal 畫面被今日未就緒資料洗空。
- desktop route snapshot builder 要把策略1當 soft snapshot endpoint 處理。
- 若新建 snapshot partial，且上一版 complete snapshot 可用，必須保留上一版 complete snapshot。
- `/api/terminal-fast-bundle` 預設必須先讀 Supabase `desktop_route_snapshot`，不是直接 live 打所有 API。

策略1偵測條件由 `api/scan-open-buy.js` 管控，接手者不要自行改條件。現行高層條件如下，僅供理解與回歸檢查：

- 母池先排除：非四碼、`00` 開頭、ETF/ETN、指數商品、高股息、槓反、期貨、債、權證、認購/認售、牛熊證、CB/可轉債、停牌/暫停交易、黑名單。
- 額外排除：水泥、軍工、國防、航太、金融、航空等程式內硬排除族群。
- 日K 少於 35 根直接 `BLOCK`。
- 基本品質：價格、流動性、MA35、MA5/MA10/MA20、20日高低、量比、成交量、紅K/影線/收近高點等由程式計算。
- BUY setup 來源：`A級 開盤無腦入`、`B級 突破候選`、`B級 第一/二根攻擊`、`B級 高周轉候選`、`C級 深跌反彈`、`C級 洗盤反彈`。
- WATCH setup：品質與 MA35 達標但未達 21:30 BUY 候選強度。
- 分數由各 setup 公式計算；不要改權重、閾值、setup 名稱、BUY/WATCH/BLOCK 規則，除非使用者明確要求改策略。

策略1前端 / shell 規則：

- 策略1到策略5共用 `strategy` view，`strategy` 必須留在 `PUBLIC_VIEWS`。
- 策略1不應被會員牆擋住；登入與否不是策略頁可見性的判斷來源。
- 前端只畫後端整理好的小包，策略1 compact 通常 `limit=60`。
- 不要讓 `terminal-app.js` 在切頁瞬間重新接管畫面。
- 不要新增密集 polling。
- 不要用 cache bump 或版本 bump 假裝修資料。
- 不要把 Codex latency/debug 面板給客人看。

策略1進 desktop snapshot：

- `lib/desktop-route-snapshot-builder.js` 必須包含 `/api/open-buy-latest`。
- query 必須含 `canvas=1&compact=1&shell=1&limit=60`。
- build request 會追加 `fastBundle=1&snapshotBuild=1`。
- 策略1如果回 `snapshot-friendly-empty` 或 waiting 狀態，不能使完整 snapshot 被 partial 空包覆蓋。
- `/api/terminal-fast-bundle` 正常 production 應顯示：
  - `cacheSource = supabase:desktop_route_snapshot`
  - `snapshotHit = true`
  - `snapshotFresh = true`
  - `partial = false`
  - `endpointCount >= 10`
  - `hasStrategy2Snapshot = false`

策略1修改後至少驗證：

```powershell
node --check api\open-buy-latest.js
node --check scripts\scan-open-buy-cache.js
node --check lib\desktop-route-snapshot-builder.js
node --check api\terminal-fast-bundle.js
npm run verify:strategy1-open-buy-ui
npm run verify:version
npm run verify:runtime-hotfix
npm run verify:desktop-api-only
npm run verify:publish-gate
```

部署後驗正式站：

```powershell
npm run verify:live-version
npm run verify:deploy
npm run e2e:smoke
npm run monitor:production
```

若 `monitor:production`、`verify:deploy`、`production-health` 與直接 API 檢查衝突，以現行 production health 與 live API 事實為準，並更新舊 verifier；不要復活 retired static freshness / manifest 檢查鏈。

### 策略3：隔日沖正式條件與流程

#### 策略3給下一位 Codex 的接手摘要

策略3目前已定位為「13:00 後尾盤隔日沖候選」的正式實戰資料源。接手時請先確認自己處理的是策略3資料鏈，不是策略2當沖 live，也不是舊 DOM snapshot 畫面。

一句話原則：

```text
策略3只相信 scanner -> Supabase complete/readback -> no-store API -> desktop route snapshot -> fixed shell rows。
```

接手第一步必查：

- 先讀本文件，再讀 `scripts\scan-strategy3-cache.js`、`api\strategy3-latest.js`、`lib\desktop-route-snapshot-builder.js`、`terminal-desktop-fast-shell.js`。
- 確認正式站仍是 `https://fuman-terminal.vercel.app`。
- 確認 public version 不可因策略3資料問題而 bump。
- 確認策略3 endpoint 是 `/api/strategy3-latest`，且支援 `canvas=1&compact=1&shell=1&limit=N`。
- 確認 strategy3 route 可以被 `/api/desktop-route-snapshot` 收進 endpoints。
- 確認 `/api/terminal-fast-bundle` 優先讀 Supabase `desktop_route_snapshot`。
- 確認 production health 維持 `hasStrategy2Snapshot=false`，不要把策略2冷塞進 snapshot。

策略3實戰輸出不可只看 `run_id`。每次判斷「資料接好了」必須同時看：

- run row：`status=complete`、`complete=true`。
- run metadata：`expected_total > 0`、`scanned_count > 0`、`expected_total === scanned_count`。
- result metadata：`result_count` 必須合理，且 readback row count 要能對上。
- scanner readback：寫完 Supabase 後必須能讀回 latest row、latest complete run、results rows。
- snapshot readback：`strategy3_latest` snapshot 不能空、不能 partial、不能拿舊 DOM rows。
- API readback：`/api/strategy3-latest?canvas=1&compact=1&shell=1&limit=60` 要回今日 complete run 的可畫 rows。
- fast bundle readback：`/api/terminal-fast-bundle` 需要顯示 snapshot hit/fresh，且 endpoint count 正常。

如果以上任一項不過：

- 不准把新資料寫入 desktop route snapshot。
- 不准用空包覆蓋上一版可用 snapshot。
- 不准在前端硬補欄位或用舊 DOM snapshot 湊資料。
- 不准用 cache bump / version bump 假裝資料已更新。

策略3固定時間與意義：

- `13:00` 前不能發布正式 complete run，因為策略3要看 13:00-13:30 尾盤 1 分K。
- `13:00-13:30` 是 TradingView 進場確認核心區間。
- 盤後 scanner 產出的是隔日候選，不是當下追價訊號。
- 前端可 30 秒 API-only polling，但資料簽名沒變時不能重建 DOM。

策略3前端欄位必須是正式隔日沖欄位：

- 排名
- 股票
- 多空
- 價格
- 漲幅
- 量
- 推估量比
- 成交額
- 法人5D
- 分數
- AI分析
- 觸發原因

前端不可再出現舊錯欄位：

- `Rank / Code / Signal / Score / Change` 的 dom-snapshot 簡表
- `多多訊號2035`
- `A區數量`
- 任何從 DOM 文字誤抽出的假資料

策略3畫面舊 chrome 必須保持剔除：

- 左側策略清單
- 舊 header
- 舊 toolbar
- 舊 metrics cards
- 舊搜尋列
- Canvas shell 內部搜尋 / 刷新 / status toolbar

策略3與策略2邊界：

- 策略3是盤後/尾盤隔日沖候選，可進 desktop snapshot。
- 策略2是當沖即時資料，不可冷處理，不可放進 desktop route snapshot。
- 不要把策略2 live intent 套給策略3。
- 不要把策略3 cold snapshot 規則套給策略2。

策略3部署防呆：

- 不要從 dirty 的 `C:\fuman-terminal` 直接部署。
- 乾淨 worktree 部署前必須檢查 `.vercel/project.json`。
- `.vercel/project.json` 必須指向正式 `fuman-terminal`：

```json
{
  "projectId": "prj_x0R2mMFsL0Xto4whcbPTKQTKJRUl",
  "orgId": "team_HfAXzMLgDcpw6UFbnexhuxHG",
  "projectName": "fuman-terminal"
}
```

不符合就直接中止，不要讓 Vercel CLI 自動 link 或開新 project。

策略3完成定義：

```text
scanner complete
+ Supabase readback ok
+ strategy3_latest snapshot ok
+ /api/strategy3-latest compact rows ok
+ /api/desktop-route-snapshot includes strategy3
+ /api/terminal-fast-bundle snapshotHit/fresh ok
+ fixed shell 顯示正式欄位
+ production health ok
```

策略3是「隔日沖」候選，不是當沖即時頁。正式鏈路必須是：

```text
13:00 後 1 分K / 盤後資料齊備
-> scripts\scan-strategy3-cache.js 完整掃描
-> Supabase strategy3 complete run
-> Supabase strategy3_latest snapshot
-> /api/strategy3-latest no-store API
-> /api/desktop-route-snapshot
-> /api/terminal-fast-bundle snapshot first
-> fixed shell / Canvas 策略3畫面
```

策略3目前程式基準：

```text
Strategy3 scanner:
scripts\scan-strategy3-cache.js

Strategy3 API:
api\strategy3-latest.js

Desktop snapshot builder:
lib\desktop-route-snapshot-builder.js

Fast shell endpoint map:
terminal-desktop-fast-shell.js
```

策略3資料權威：

- Supabase `strategy3_scan_runs`
- Supabase `strategy3_scan_results`
- Supabase snapshot key `strategy3_latest`
- `/api/strategy3-latest`
- `/api/desktop-route-snapshot`
- `/api/terminal-fast-bundle`

策略3不是資料權威：

- DOM snapshot
- `sessionStorage` route snapshot
- IndexedDB DOM route snapshot
- 靜態 `data/*.json`
- Google Sheet
- frontend map / filter / sort
- service worker cache
- version bump / cache bump

策略3運作時間與時機：

- 策略3要看尾盤與盤後籌碼/量價候選，不能在 13:00 前發布 complete run。
- scanner 需要確認 13:00 後 1 分K 候選數；預設 `STRATEGY3_REQUIRE_AFTER_1300 !== "0"`，且 `STRATEGY3_MIN_AFTER_1300_CANDIDATES = 20`。
- TradingView 進場確認只看 13:00 到 13:30 的尾盤 1 分K 條件。
- 若 13:00 後資料不足，scanner 必須 fail，不可發布空包或 partial 當 complete。
- 前端可以 30 秒保守 polling API rows，但資料簽名沒變時不能重建 DOM，避免畫面跳動。

策略3資料來源流程：

- 優先從 Supabase 讀 universe / quote ready / intraday 1m 狀態。
- 若 Supabase universe 取不到股票，才 fallback 到 `STOCK_URL`，預設 `https://fuman-terminal.vercel.app/api/stocks`。
- scanner 會補 issued shares、歷史均量、13:00 後 1 分K 狀態、資本額資訊。
- `STRATEGY3_USE_SUPABASE !== "0"` 必須維持，正式站不要退回純靜態資料鏈。
- `STRATEGY3_APPLY_BLACKLIST !== "0"` 必須維持，黑名單與不適合當沖/停牌/試撮等排除要在 scanner 端處理。

策略3 source health gate：

- 13:00 後候選數不足時，source health 直接 failed。
- 若 `STRATEGY3_REQUIRE_TURNOVER = "1"`，issued shares count 不足 `STRATEGY3_MIN_ISSUED_SHARES_COUNT` 時必須 failed。
- 若 `STRATEGY3_REQUIRE_VOLUME_AVERAGE = "1"`，均量 count 不足 `STRATEGY3_MIN_VOLUME_AVERAGE_COUNT` 時必須 failed。
- source warning 超過 `STRATEGY3_SOURCE_WARNING_LIMIT`，預設 3，必須 failed。
- failed 時不可寫入新的 complete run，不可覆蓋既有可用 snapshot。

策略3候選前置條件：

- 股票要有有效價格，`close > 0`。
- 股票要有 13:00 後 1 分K，`hasAfter1300Candle` 或 `after1300CandleCount > 0`。
- 排除黑名單、停牌、試撮、不適合當沖、ETF、權證、CB 等 scanner 標記不可交易或不合策略的標的。
- 不要在前端補條件；條件、排序、分組、分頁都在 scanner / API 端完成。

策略3分數只供排序，不可自行改權重：

- 漲幅分數：`min((pct - 3) * 18, 36)`。
- 成交量分數：`min(volumeLots / 80, 18)`。
- 周轉分數：`min(turnoverRate * 6, 30)`。
- 量比分數：`min(volumeRatio * 12, 20)`。
- 過熱/弱勢扣分：`pct > 8.8` 扣 24，`pct > 6.5` 扣 12，`pct < 0` 扣 30。
- 最終 `overnightScore` clamp 到 0 到 100。
- 排序優先 `overnightScore` 高，再看成交值 `value`。

策略3 TradingView 進場確認：

- 預設 `STRATEGY3_REQUIRE_TV_ENTRY !== "0"`，也就是必須通過 TV 進場確認。
- 1 分K 至少要有 35 根有效 candles。
- 使用 money flow 的 EMA8，再做 SMA2 control line。
- 使用 OBV，再做 EMA10。
- 必須存在 13:00 到 13:30 的尾盤 candle。
- 尾盤收盤必須貼近最近 100 根高點 98% 內。
- control line 必須為正，且相對前一根上彎。
- OBV 必須為正。
- 以上全數成立才是正式隔日沖候選。

策略3發布與寫回：

- scanner output 必須 `complete=true`。
- 若 matches 為 0，scanner 會保留上一版可用輸出並拒絕發布空結果；不要把空結果改成 complete。
- Supabase run id 格式為 `strategy3-交易日-時間`。
- 寫入順序是 running run row、results rows、complete run row、`strategy3_latest` snapshot、cache status。
- `STRATEGY3_API_ONLY = true` 必須維持；靜態 `strategy3*.json` 只是不正式的 legacy/safeguard，不可恢復成正式資料來源。

策略3 API contract：

- `/api/strategy3-latest` 必須永遠回 `Cache-Control: no-store`。
- 必須支援 `canvas=1&compact=1&shell=1&limit=N`。
- compact / shell 預設小包，正式畫面通常 `limit=60`，最大不要超過 API 現有限制。
- API 先讀 desktop route snapshot；若是 live / bypass / snapshotBuild 才走即時讀取。
- Supabase 讀取順序是 `strategy3_latest` snapshot，fallback 到 latest complete run，再讀 `strategy3_scan_results` rows。
- 回傳要包含可追蹤欄位，例如 `runId`、`snapshotId`、`updatedAt`、`usedDate`、`complete`、`returnedCount`、`sourceHealth`、`matches`。

策略3進 desktop snapshot：

- `lib/desktop-route-snapshot-builder.js` 必須包含 `/api/strategy3-latest`。
- query 必須含 `canvas=1&compact=1&shell=1&limit=60`。
- `/api/terminal-fast-bundle` 必須優先讀 Supabase `desktop_route_snapshot`。
- production health 應維持：
  - `snapshotHit = true`
  - `snapshotFresh = true`
  - `partial = false`
  - `endpointCount >= 10`
  - `hasStrategy2Snapshot = false`

策略3前端 / fixed shell 規則：

- 策略3只吃 API rows，不吃 DOM snapshot。
- fast shell 啟動時要清掉策略3舊 `sessionStorage` / IndexedDB DOM snapshot。
- 畫面來源不可顯示 `dom-snapshot`。
- 不可再出現 `多多訊號2035`、`A區數量` 這種 DOM 文字被誤抽成列資料的錯欄位。
- 不可恢復黃框舊 chrome：左側策略清單、舊 header、舊 toolbar、舊 metrics 卡、舊搜尋列都要隱藏。
- polling 保持保守；目前 `API_ONLY_POLL_MS = 30000`。
- row signature 沒變時不可重建整個 DOM，只更新必要狀態。
- 不要讓 `terminal-app.js` 在切頁瞬間重新接管畫面。

策略3修改後至少驗證：

```powershell
node --check scripts\scan-strategy3-cache.js
node --check api\strategy3-latest.js
node --check terminal-desktop-fast-shell.js
npm run verify:version
npm run verify:runtime-hotfix
npm run verify:desktop-api-only
npm run verify:publish-gate
```

部署後驗正式站：

```powershell
npm run verify:live-version
node --use-system-ca scripts\verify-deployment.js
npm run e2e:smoke
npm run monitor:production
```

策略3不可做：

- 不要改策略條件、TV 條件、分數規則、排序權重。
- 不要新增密集 polling。
- 不要用 cache bump / version bump 假裝修資料。
- 不要從 dirty 的 `C:\fuman-terminal` 強行部署。
- 不要把策略3放回 DOM snapshot / static JSON / Google Sheet 鏈路。
- 不要把策略2的 live intent 套到策略3，也不要把策略3的 cold snapshot 規則套到策略2。

策略2：

- 當沖頁，必須即時。
- 不要冷處理。
- 可以做 fast bundle / memory cache / partial degrade，但不能用過舊 snapshot 假裝最新。

策略1 / 3 / 4 / 5：

- 可走 snapshot-first。
- 掃描器或後端排程應預產每頁小包。
- 前端只畫 30-70 筆或使用 Canvas / virtual list。

籌碼：

- 買賣超、CB、權證應走各自 route snapshot / API 小包。
- 不要共用大包資料後在前端大量 filter / sort。

## 目前 Vercel 狀態

正式只保留 `fuman-terminal` 作為使用者入口。舊 sync / publish-sync 專案已退休，不應再部署、不應再寄通知。

部署硬規則：

- 不要從 dirty 的 `C:\fuman-terminal` 直接部署。
- `C:\fuman-terminal` 若有未提交或未確認的本機修改，先中止，改用乾淨 worktree 從 `origin/main` 接最新狀態後再改、驗證、部署。
- 部署前必須確認工作樹乾淨；若有 unrelated dirty changes，不要混進部署。

### 部署防呆：Vercel project 必查

任何乾淨 clone、臨時 worktree、Codex workspace、或非 `C:\fuman-terminal` 的工作目錄，在部署前都必須先檢查 `.vercel/project.json`。

正式站唯一允許的 Vercel 專案設定：

```json
{
  "projectId": "prj_x0R2mMFsL0Xto4whcbPTKQTKJRUl",
  "orgId": "team_HfAXzMLgDcpw6UFbnexhuxHG",
  "projectName": "fuman-terminal"
}
```

部署前硬性規則：

- `.vercel/project.json` 不存在：直接中止，不要執行 `vercel --prod`。
- `projectName` 不是 `fuman-terminal`：直接中止。
- `projectId` 不是 `prj_x0R2mMFsL0Xto4whcbPTKQTKJRUl`：直接中止。
- `orgId` 不是 `team_HfAXzMLgDcpw6UFbnexhuxHG`：直接中止。
- 不要讓 Vercel CLI 自動 `link` 或自動建立新 project。
- 不要部署到 preview / sync / publish-sync / 新開的 Vercel project 後再說是正式站。
- 如果 project link 不對，先修正 link，重新確認 `.vercel/project.json`，再部署。

目前有效 cron / health 方向：

- `/api/desktop-route-snapshot-refresh`
- `/api/production-health`

已刪除舊外部排程 dispatch API。若外部舊排程仍打舊端點，正式站應回 404，不應觸發任何 workflow。

## 驗證

常用驗證：

```powershell
npm run monitor:production
npm run e2e:smoke
npm run verify:live-version
```

若 `verify:publish-gate` 因舊流程檢查失敗，要先判斷是否是 retired workflow / retired sync path / retired static JSON。若是舊流程造成，更新 gate，不要恢復舊流程。

## 開發規則

- 使用繁體中文回覆使用者。
- 使用者重視速度、手感、穩定、不要回滾。
- 不要再用 bump 版本號當修復手段。
- 不要偷偷恢復舊 workflow、舊 Vercel 專案、舊 sync repo。
- 不要把 key 寫進 repo。
- 不要刪 Supabase 資料，除非使用者明確要求。
- 修改正式流程後要驗證正式站。
- 若要清除舊檔，先確認沒有引用，再刪除。

## 給其他策略 Codex 的銜接話術

請接新版架構，不要接舊 workflow / sync repo：

```text
目前正式終端已改成 Supabase API-only + route snapshot + fixed shell。
正式根目錄是 C:\fuman-terminal，正式站是 https://fuman-terminal.vercel.app。
不要使用已退休的同步副本、發布副本、GitHub workflow dispatch、舊排程 dispatch、舊 auto-release。
策略2維持即時，其它策略和籌碼請寫入各自 Supabase complete run / route snapshot。
前端只讀 no-store API 或 desktop route snapshot，不要再靠靜態 JSON / Google Sheet / 版本 bump。
如果遇到舊 verifier 要求舊檔案，請改 verifier，不要恢復舊檔案。
```
