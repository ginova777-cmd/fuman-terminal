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
