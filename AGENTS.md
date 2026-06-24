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
