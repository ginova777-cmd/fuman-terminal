# Telegram 三階段 PowerShell 入口

入口：`Run-Telegram-Workflow.ps1`，放在正式程式 checkout 根目錄。這是既有引擎的不發送整合入口，不會建立重複排程、呼叫通知 sender 或下單。既有自然排程不變。

## 使用

```powershell
& 'C:\Users\ginov\Documents\Codex\2026-09-24\new-chat\work\telegram-deploy-297\Run-Telegram-Workflow.ps1'
```

預設只讀當日 runtime 來源、試撮存檔、交易日曆與1分K；結果放在使用者 Documents 下 `Codex\Telegram-Workflow\日期時間-唯一識別`。休市或來源缺漏時寫 blocked receipt，不擅自改讀前一日充當當日資料。

指定歷史來源：

```powershell
.\Run-Telegram-Workflow.ps1 -StaticFile '快照.json' -TradeDate '2026-09-23' -BaseDate '2026-09-22' -AsOf '2026-09-23T08:59:59+08:00' -TrialFile '試撮.json' -CalendarFile '日曆.json' -OutputDirectory 'C:\Users\ginov\Documents\Codex\Telegram-Workflow\歷史驗證'
```

`-IntradayFile` 可指定保存的 groups/histories/quotes。`-VerifyUI` 另外驗證桌機、手機、88本機元件，需可用Chrome；不表示已將資料發布到正式網站。

## 產物

- workflow.html：三段可閱讀報表，手機可開啟，表格可橫向捲動。
- daily-ranking.json：T−1資料、分點成本與既有空方分數排序。**尚非完整全市場多空排名**；多方排名待接，不能用空方分数當多方排名。
- trial-analysis.json：既有試撮、劇本、成本±1%、支撐壓力與方向候選。
- intraday-signals.json：既有1分K巨量／拉抬及位置交叉驗證事件。
- validation.json：共用三端元件可讀格式，不寫正式 DB 最新指標。
- workflow-receipt.json：本次入口是否執行、每段狀態、資料範圍與阻擋原因。

退出碼1表示執行錯誤，2表示結果已產出但正式流程尚有缺口。不能把入口執行成功當作全市場/自然通知 complete。輸出目錄已有收據則拒絕覆寫。

## 目前限制

第一段尚缺完整多方評分與全市場 universe涵蓋驗證；既有劇本仍有待確認規則。這個入口讓缺口可以檢查，並未替代正式自然排程或證明整套策略完成。Telegram及LINE持續停送，所有資料由既有runner邏輯計算，沒有把案例文字變成真實試撮。
