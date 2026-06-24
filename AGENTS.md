# AGENTS.md

Last updated: 2026-06-24 16:30 Asia/Taipei

給後續接手這個工作區的 Codex：請先讀這份，再改程式。這份只保留目前有效狀態。

## 目前主線

使用者目前主線是「Fuman Terminal 正式股票終端」。

正式站：

```text
https://fuman-terminal.vercel.app
```

目前固定版本：

```text
public-terminal-fast-20260623-09
```

最新 production/main commit：

```text
a35aca73aa4211db0cb05e0c52d3c492dbcc3168
```

目前極致化狀態：

```text
約 93% - 95%
```

使用者明確要求：

- 不要隨便 bump 版本號。
- 不要用版本號/cache bump 假裝變快。
- 策略2是當沖即時資料，不可冷處理、不可放進 desktop route snapshot。
- 桌面與手機都要速度、手感、穩定。
- 左側分頁切換要立即反應，側欄選取、標題、內容要同步。
- 不要把 Codex latency/debug 面板給客人看。

## 目前有效專案位置

正式專案資料夾：

```text
C:\fuman-terminal
```

Git remote/main 來源：

```text
https://github.com/ginova777-cmd/fuman-terminal.git
```

注意：`C:\fuman-terminal` 目前有本機 dirty 內容，而且本機 HEAD 可能落後 `origin/main`。不要在沒有確認的情況下直接從這個 dirty 目錄部署。

若要部署或做大修改，建議：

```text
1. 先確認 origin/main 是最新。
2. 用乾淨 worktree 或先處理好本機 dirty 狀態。
3. 不要 git reset / checkout 覆蓋使用者變更。
4. 部署前跑 production guard。
```

## 目前架構

桌面終端目前使用：

```text
fixed shell
Canvas / OffscreenCanvas 列表
compact API payload
desktop route snapshot
memory / session / IndexedDB snapshot
production health monitor
防回滾 guard
```

核心檔案：

```text
terminal-desktop-fast-shell.js
terminal-desktop-canvas-worker.js
terminal-strategy-module.js
terminal-chip-snapshot-module.js
terminal-market-snapshot-module.js
terminal-watchlist-shell.js
terminal.js
terminal-hotfix.js
terminal-app.js
api/terminal-fast-bundle.js
api/desktop-route-snapshot.js
api/desktop-route-snapshot-refresh.js
api/production-health.js
api/performance-report.js
api/desktop-latency-latest.js
lib/desktop-route-snapshot-builder.js
lib/desktop-route-snapshot-cache.js
scripts/write-desktop-route-snapshot.js
scripts/monitor-production-health.js
scripts/verify-production-guard.js
run-full-scan.ps1
run-production-health-monitor.ps1
scripts/install-production-health-monitor-task.ps1
```

## 已完成的速度與穩定性處理

目前已完成：

- 桌面固定 fast shell。
- Canvas / OffscreenCanvas 列表常駐。
- DOM 只保留按鈕、搜尋、詳細彈窗等必要互動。
- 左側分頁快切，不應等待 API 才切畫面。
- 策略頁、籌碼頁、CB、權證、市場、自選都走 fixed shell / compact payload。
- `/api/terminal-fast-bundle` 優先讀 Supabase `desktop_route_snapshot`。
- `/api/desktop-route-snapshot-refresh` 可預產 13 個 route endpoint 小包。
- 遠端 snapshot refresh 預設只寫主 `desktop_route_snapshot`，避免 Vercel serverless request 因連續寫多個 endpoint snapshot 被 `ECONNRESET`。
- full scan 寫 desktop snapshot 已改成硬性門檻：`--fail-on-partial --min-endpoints=10`。
- endpoint-level snapshot cache 已有底層支援，適合由本機 full scan / scanner 寫入，不建議由 Vercel request 一次寫太多筆。
- production health API 會檢查 snapshot fresh、partial=false、endpoint count、策略2即時。
- latency log 會寫入 Supabase `desktop_route_latency_latest`，並由 `/api/desktop-latency-latest` 讀取。
- Windows 排程 `FumanTerminalProductionHealthMonitor` 已建立，每 5 分鐘巡檢正式站。
- monitor 會把本機 git drift 當 warning，不再因 `C:\fuman-terminal` dirty 而誤報正式站壞掉。
- 防回滾 guard 仍會把 dirty worktree / local HEAD 落後 origin 當部署阻擋條件，這是正確行為。

## Strategy 2 原則

策略2是當沖即時資料。

規則：

```text
不可冷處理。
不可放進 desktop route snapshot。
不可因速度把它改成 stale snapshot。
可以做 compact/live API。
可以做 pointerdown 預熱。
可以做 memory cache，但要保留 live intent。
```

production health 目前確認：

```text
hasStrategy2Snapshot = false
strategy2 API = ok
```

## Desktop Route Snapshot 狀態

最後一次正式檢查結果：

```text
snapshot ok = true
partial = false
endpointCount = 13
misses = []
source = codex-final-check
updatedAt = 2026-06-24T08:29:13.665Z
elapsedMs = 15441
```

目前納入 snapshot / fast bundle 的重點 endpoint：

```text
/api/terminal-home
/api/market?canvas=1&compact=1&shell=1&limit=24
/api/stocks?limit=120&compact=1&shell=1
/api/open-buy-latest?canvas=1&compact=1&shell=1&limit=60
/api/strategy3-latest?canvas=1&compact=1&shell=1&limit=60
/api/strategy4-latest?canvas=1&compact=1&shell=1&limit=70
/api/strategy5-latest?canvas=1&compact=1&shell=1&limit=70
/api/latest-signals?strategy=strategy4&compact=1&shell=1&limit=70
/api/realtime-radar-latest?compact=1&shell=1&limit=50
/api/institution-latest?canvas=1&compact=1&shell=1&limit=60
/api/cb-detect-latest?canvas=1&compact=1&shell=1&limit=60
/api/warrant-flow-latest?canvas=1&compact=1&shell=1&limit=60
/api/watchlist-match-index?compact=1&shell=1&limit=80
```

策略2不在 snapshot endpoint 裡，這是刻意設計。

## 正式站健康監控

Windows 排程：

```text
FumanTerminalProductionHealthMonitor
```

執行內容：

```text
C:\Program Files\PowerShell\7\pwsh.exe -NoProfile -ExecutionPolicy Bypass -File "C:\fuman-terminal\run-production-health-monitor.ps1" -ProjectRoot "C:\fuman-terminal"
```

頻率：

```text
每 5 分鐘
```

最後確認：

```text
Last Result = 0
Status = Ready
Scheduled Task State = Enabled
```

log / receipt：

```text
C:\fuman-runtime\logs\production-health-monitor-YYYYMMDD.log
C:\fuman-runtime\data\scan-receipts\production-health-monitor.json
C:\fuman-runtime\logs\production-health.jsonl
```

## 驗證狀態

2026-06-24 16:30 左右已完成以下正式站驗證：

```text
npm run monitor:production      -> ok
npm run verify:live-version     -> ok
node --use-system-ca scripts\verify-deployment.js -> ok
npm run e2e:smoke               -> ok
npm run snapshot:desktop -- --remote --fail-on-partial --min-endpoints=10 --source=codex-final-check --base-url=https://fuman-terminal.vercel.app -> ok
```

`npm run guard:production` 在 `C:\fuman-terminal` 會失敗，原因不是正式站壞，而是該本機資料夾 dirty 且 local HEAD 落後 origin/main。這是防回滾 guard 的正確保護。若要讓 guard 通過，請用乾淨 worktree 或先安全處理本機 dirty 狀態。

## 部署前必跑

修改後至少跑：

```text
node --check terminal-desktop-fast-shell.js
node --check terminal-desktop-canvas-worker.js
node --check terminal-strategy-module.js
node --check terminal.js
node --check terminal-hotfix.js
node --check api/strategy2-latest.js
npm run verify:version
```

部署後至少跑：

```text
npm run verify:live-version
node --use-system-ca scripts\verify-deployment.js
npm run e2e:smoke
npm run monitor:production
npm run guard:production
```

如果是在 dirty 的 `C:\fuman-terminal` 跑 `guard:production` 失敗，請先確認是不是本機狀態問題，不要直接判定正式站壞。

## 正式部署流程

建議使用乾淨 worktree：

```text
git fetch origin
git worktree add <clean-worktree-path> origin/main
```

修改後：

```text
git status -sb
npm run verify:version
git add <files>
git commit -m "<message>"
git push origin HEAD:main
vercel --prod --yes
npm run snapshot:desktop -- --remote --fail-on-partial --min-endpoints=10 --source=<reason> --base-url=https://fuman-terminal.vercel.app
npm run verify:live-version
node --use-system-ca scripts\verify-deployment.js
npm run e2e:smoke
npm run monitor:production
npm run guard:production
```

部署後一定看正式 alias：

```text
https://fuman-terminal.vercel.app
```

不要只看 preview URL。

## 給策略 / 籌碼 Codex 的接手說明

請貼給負責策略或籌碼的 Codex：

```text
不要改版本號，不要重寫前端殼。
現在正式終端走 fixed shell + Canvas + desktop route snapshot。
你只更新自己的 scanner / Supabase complete run / API handler。
API 必須支援 canvas=1&compact=1&shell=1&limit=N，只回前 30-70 筆可畫資料。
route 要能被 /api/desktop-route-snapshot 收進 endpoints，讓 /api/terminal-fast-bundle 先讀快照。
策略2是當沖即時，不要冷處理，不要放 desktop snapshot。
不要新增密集 polling，不要讓 terminal-app.js 在切頁瞬間接管畫面。
不要改策略條件、分數、掃描規則來解決速度問題。
改完先 node --check，再驗正式 alias。
```

## Latency / Debug

客人正常網址：

```text
https://fuman-terminal.vercel.app/?desktop=1
```

Codex 除錯網址：

```text
https://fuman-terminal.vercel.app/?desktop=1&codexLatency=1&codexLatencyAuto=1
```

客人不應看到 latency 面板。舊的公開參數不應再顯示面板：

```text
latency=1
latencyAuto=1
```

Console helper：

```js
FUMAN_DESKTOP_PERF_LOG.summary()
FUMAN_DESKTOP_PERF_LOG.recommend()
FUMAN_DESKTOP_PERF_LOG.read()
FUMAN_DESKTOP_PERF_LOG.flush()
FUMAN_DESKTOP_PERF_LOG.clear()
```

判讀：

```text
nav 高   -> 側欄事件 / active 狀態 / CSS selector
shell 高 -> Canvas 首畫 / 固定殼 DOM
api 高   -> API payload / cache / TTL / Supabase query / snapshot freshness
```

最新 latency 會寫到：

```text
/api/desktop-latency-latest
Supabase snapshot key: desktop_route_latency_latest
```

## CSS 清理原則

目前不要啟用機器人自動刪 CSS。

可以做：

- CSS audit report
- 重複 selector report
- `!important` 數量 report
- 色票與主題覆蓋 report
- 人工小範圍合併

不要做：

- 自動刪 `styles.css`
- 自動刪 `terminal-theme.css`
- 自動刪 runtime theme CSS
- 未經畫面驗證就自動合併 hotfix CSS

CSS 清理前至少驗：

```text
桌面夜幕
桌面陽光
手機夜幕
手機陽光
```

## 不要做的事

- 不要 bump version，除非使用者明確要求。
- 不要把速度問題用版本號/cache bump 假裝解決。
- 不要回退到大量 DOM table。
- 不要讓左側分頁點擊立即喚醒整包 `terminal-app.js`。
- 不要改策略規則來假裝速度變快。
- 不要把 Codex latency 面板暴露給客人。
- 不要直接從 dirty 的 `C:\fuman-terminal` 強行部署。
- 不要說「修好了」但沒有驗正式 alias。

## 接手優先順序

```text
1. 讀本 AGENTS.md。
2. 確認正式站版本仍是 public-terminal-fast-20260623-09。
3. 確認 production health / snapshot / smoke。
4. 若是速度問題，先看 FUMAN_DESKTOP_PERF_LOG.summary() 或 /api/desktop-latency-latest。
5. nav / shell / api 哪個高，就修哪一層。
6. 不改策略規則，不亂 bump 版本。
7. 驗證正式 alias 後再回報。
```
