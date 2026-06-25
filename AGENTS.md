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

市場總覽是正式桌面終端主畫面，不是泛用策略頁。

固定顯示：

- 上方四張指數卡：加權指數、櫃買指數、台指期夜盤、台指次月。
- 下方是熱力圖。
- 熱力圖分類 tabs 固定包含：`全部`、`官方產業`、`電子細分`、`群組概念`、`集團股`。
- 點熱力圖產業 / 分類項目，要開啟相關股票 modal。
- modal 要顯示股票代號、名稱、漲跌幅、成交值，以及可用的外資 / 投信 / 自營等欄位。
- 熱力圖細項沒有資料時，要顯示明確受控空狀態，不可空白。

已硬移除且不可恢復：

- `ticker-strip`
- `strength-panel`
- 舊黃框跑馬燈
- 舊黃框強弱統計
- 市場總覽泛用 `Rank / Code / Signal` 表格

相關檔案：

```text
terminal-market-overview-restore.js
terminal-market-overview-restore.css
terminal-core.js
fuman-sw.js
```

修改市場總覽後，可以更新 market overview asset epoch 讓 service worker 吃新資產；不可 bump 主版本。

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

## 發布 / 上傳規則

正式發布只能從乾淨 release clone / worktree 執行。

固定規則：

1. origin 必須是：

```text
https://github.com/ginova777-cmd/fuman-terminal.git
```

2. branch 必須追蹤 `origin/main` 或明確 release branch。
3. 不可把 `C:\fuman-terminal` 或舊 `C:\fuman-terminal-sync` 當 upstream。
4. 發布前必跑：

```powershell
git status -sb
npm run verify:publish-gate
```

5. publish gate 必須通過才可：

```powershell
vercel --prod --yes
```

6. deploy 後一定驗正式 alias：

```powershell
npm run guard:production
npm run verify:live-version
npm run monitor:production
```

7. 若修改手機，追加：

```powershell
npm run verify:mobile-api-only:live
npm run verify:mobile-cache-contract:live
```

8. 若修改桌面 UI，必須實際驗：市場總覽、AI 判讀、策略1-5、買賣超、CB、權證、自選股。
9. `data/scan-receipts/*` 不要跟核心程式修正混 commit，除非明確決定它們是新的 baseline。
10. 不要手動 full scan 來掩蓋問題。策略1/3/4/5、買賣超、CB、權證等完整掃資料等自然排程更新。

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
