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
