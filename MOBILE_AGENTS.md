# MOBILE_AGENTS.md

Last updated: 2026-06-29 Asia/Taipei

本檔是手機終端 `/mobile` 的專用防回滾契約。修改 `mobile.html`、`api/mobile-*`、手機自選股、手機版策略卡或手機 E2E 前必讀。

## 正式來源

正式手機網址固定：

```text
https://fuman-terminal.vercel.app/mobile
```

手機資料主線：

```text
/mobile
-> mobile.html
-> /api/mobile-boot
-> /api/mobile-fragment?tab=...
-> strategy complete/live APIs
```

規則：

- `/api/mobile-boot`、`/api/mobile-fragment`、`/api/mobile-watch-meta` 必須 no-store。
- 手機正式資料不可退回 `/data/mobile-boot.json`、`/data/mobile-terminal-latest.json`、`backup.json` 或 service worker cache。
- 手機頁不可用 redeploy、version bump、cache bump 代替資料或 UI 修正。
- 正式網址永遠看 `https://fuman-terminal.vercel.app/mobile`，不可把 preview URL 當驗收。

## 手機自選股固定契約

手機自選股上限目前固定 10 檔。若要改上限，必須同步改手機頁、桌機契約、storage cap、E2E 和本檔。

新增來源必須包含兩種真人流程：

- 在自選 tab 手動輸入四碼台股代號後按「新增」。
- 在策略 1-5 卡片按「加入自選」。

成功條件：

- 代號必須經 `/api/mobile-watch-meta?code=XXXX` 驗證為有效上市 / 上櫃台股。
- `2334` 這類 invalid code 不可進 storage，不可顯示卡片，不可佔名額。
- 成功後必須同步寫入 `fuman_watchlist` 與 `fuman_mobile_watchlist_v1`。
- 成功後必須直接 render `.watch-row`，不可只顯示「已加入自選」或只更新 storage。
- 切到自選 tab 時，策略加入的標的必須看得到卡片。

## 2026-06-29 根因與修正

事故：使用者加入多檔股票後，手機自選頁只顯示 `3504`，其他如 `3028` 顯示已加入但沒有卡片。

根因：

- 舊 storage key 分裂：`fuman_watchlist` 只有 `3504`，`fuman_mobile_watchlist_v1` 有 `3028,3504`。
- 舊讀法使用 `localStorage.getItem(KEY) || localStorage.getItem(MOBILE_KEY)` 或最早期 fallback 的 `localStorage.getItem(w)||localStorage.getItem(l)`。
- 只讀第一個非空 key 會讓後面的有效股票被藏起來，造成「已加入但沒有卡片」。

正式修正：

- `mobile.html` 必須保留 `mobile-watch-merge-storage-20260629-01`。
- V2 `readList()` 必須用 `parseStoredRows(KEY)` 與 `parseStoredRows(MOBILE_KEY)` 讀兩邊並合併。
- rescue renderer 必須用 `parseRows(KEY)` 與 `parseRows(MOBILE_KEY)` 讀兩邊並合併。
- 最早期 mobile shell fallback 也必須讀兩個 key、去重、截到 10 檔並寫回兩個 key。
- 合併後必須寫回 `fuman_watchlist` 與 `fuman_mobile_watchlist_v1`，讓兩個 key 回到一致。

禁止恢復：

- 禁止 `localStorage.getItem(KEY) || localStorage.getItem(MOBILE_KEY)`。
- 禁止 `localStorage.getItem(w)||localStorage.getItem(l)`。
- 禁止只看 status 文字就算成功。
- 禁止只預塞 storage 而不實際點擊手機 UI。
- 禁止讓舊 memory fallback 在正常 storage 可讀時復活舊標的。

## 防回滾閘門

`scripts/verify-mobile-api-only.js` 必須檢查：

- `mobile-watch-merge-storage-20260629-01`
- `parseStoredRows(KEY)`
- `parseStoredRows(MOBILE_KEY)`
- `parseRows(KEY)`
- `parseRows(MOBILE_KEY)`
- 拒絕 `localStorage.getItem(KEY) || localStorage.getItem(MOBILE_KEY)`
- 拒絕 `localStorage.getItem(w)||localStorage.getItem(l)`

`scripts/verify-publish-gate.js` 必須檢查：

- `verify-mobile-api-only.js` 仍保留上述 no-rollback markers。
- `mobile.html` 不含 first-non-empty storage read。
- `scripts/verify-terminal-ui-e2e.js` 仍保留 `verifyMobileDivergedStorageMerge`。
- `scripts/verify-terminal-ui-e2e.js` 仍保留 `verifyMobileConsecutiveManualAdds`。

`scripts/verify-terminal-ui-e2e.js` 必須真人式驗：

- 雙 storage key 分裂：`fuman_watchlist=["3504"]`、`fuman_mobile_watchlist_v1=["3028","3504"]` 時，自選 tab 顯示兩張卡，且兩個 key 都被合併寫回。
- 從空列表連續新增 `3504 -> 3028 -> 3717 -> 6174`，每一步都驗 DOM `.watch-row` 與兩個 storage key。
- 手機策略 1-5 實際用座標點「加入自選」，再切到自選 tab 驗卡片。
- phone portrait、phone landscape、tablet 的 night / sun 都要跑。

## 發布 / 上傳規則

只改本檔或 `AGENTS.md` 這類純文件，不需要 Vercel deploy；需要 commit / push。

修改 `mobile.html`、`api/mobile-*`、手機 runtime、package scripts、E2E 或 publish gate 後，至少要跑：

```powershell
node --check scripts/verify-mobile-api-only.js
node --check scripts/verify-terminal-ui-e2e.js
node --check scripts/verify-publish-gate.js
npm run verify:mobile-api-only
npm run verify:publish-gate
```

若改到正式手機 runtime，發布流程固定：

```powershell
git status --short --branch
npm run verify:mobile-api-only
npm run verify:publish-gate
npm run guard:production:pre
vercel --prod
npm run guard:production
npm run verify:mobile-api-only:live
npm run verify:mobile-cache-contract:live
npm run verify:runtime-hotfix -- --live
npm run verify:terminal-ui-e2e -- --base-url=https://fuman-terminal.vercel.app --only=mobile-phone-portrait-night,mobile-phone-portrait-sun,mobile-phone-landscape-night,mobile-phone-landscape-sun,mobile-tablet-night,mobile-tablet-sun --routes=strategy1,strategy2,strategy3,strategy4,strategy5,watch --route-timeout=120000 --eval-timeout=60000
```

不可從 dirty worktree deploy。不可從 `C:\fuman-terminal` 或 `C:\fuman-terminal-sync` deploy。`C:\fuman-terminal` 只可當 production mirror。

## 不需要使用者手動清除的項目

手機自選股正常修復不應要求使用者刪 browser cache、service worker cache 或 localStorage 才能成立。若正式頁仍顯示舊行為，先檢查：

- production alias 是否已部署到新 commit。
- `/mobile` 是否取得新 `mobile.html`。
- `verify-mobile-api-only:live` 是否看到新 marker。
- E2E 是否真的在正式 alias 上操作。

可停用或避免使用的舊流程：

- 舊本機 Node / Vercel dev server。
- 舊排程 `Fuman Scorecard Snapshot 1538`。
- 舊排程 `Fuman Auto Main Release 1615`。
- 舊同步樹 `C:\fuman-terminal-sync`。

不要要求使用者靠 PowerShell 清 localStorage 才能新增卡片；storage 分裂必須由手機 runtime 自動合併修復。
