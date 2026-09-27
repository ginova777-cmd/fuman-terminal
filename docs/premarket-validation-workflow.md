# 盤前劇本工程接線：第1～3項

此入口完成資料轉換、共用劇本流程與不發送的端到端驗證。它不代表正式策略發布、全市場來源齊備或真實交易回測完成。額外否決條件依使用者要求留待累積劇本後確認，現在保持阻擋。

## 執行鏈

既有 FinMind 靜態來源 → T−1 日K／法人／第一淨買超分點買進均價 → 08:59 Fugle試撮與交易日曆檢查 → A/B劇本候選 → 固定方向 → 原巨量／瞬間拉抬 → 原1分K位置及交叉 → 三類通知預覽 → 本機讀回 → 三端元件驗證 → 工程receipt。

正式入口提供 `--premarket-validation` 分支；此分支不進入原有 DB寫入或Telegram發送流程。其他模式維持原有正式runner行為。

```powershell
node scripts/run-telegram-three-detectors.js --premarket-validation --static=<FinMind快照.json> --date=YYYY-MM-DD --base-date=YYYY-MM-DD --as-of=<含時區的驗證時間> --output=<工作區輸出目錄>
```

- 省略 `--symbols` 會處理快照內每一檔，明列來源總數與處理數；不能把386檔來源宣稱全市場。
- 預設只讀既有 runtime 的試撮quote快照、分鐘線及同分鐘歷史；可用 `--runtime-root` 指定另一個唯讀來源根。
- `--trials` 可接既有 `fugle_preopen_snapshot_history` 格式的JSON或原生quote資料。僅接受08:59、有來源與時間的試撮；不以實際開盤價或案例文字替代。
- `--calendar` 可提供包含 `verified/source/trading_dates` 的來源證據；預設讀既有TWSE年度日曆快取。缺年度或历史日期不連續會標示缺口，不用平日假定通過。
- `--intraday` 可接 `{groups,histories,quotes}` 的保存資料。合成測試與真實來源分目錄、分receipt，均不發送。
- 盤前日K快照不得晚於08:59凍結窗口；近五日均量排除T−1當根，即相對該根之前五個交易資料日。

## 目前已接規則

- 主力成本：T−1正淨買超量最大分點的 `Σ(price×buy)/Σbuy`；淨量同分以分點ID固定排序，保留明细證據。缺資料不回退到舊公式。
- B採12分排序，0分排除；A獨立辨識價格強與外資持續賣出的候選。樣本描述不能代替正式來源。
- 成本＋3%位置允許目標價上下1%，邊界包含；不更改盤中2 tick規則。
- 歷史支撐、成本參考與跌幅推算目標分開；未確認前後兩根的低點不使用。
- 固定空方只送入壓力／死亡交叉判斷。驗證中可看到技術條件成立，但 `notification_allowed=false`、`preopen_action=NO_TRADE`。
- 不到完整確認K、超過確認時間120秒或資料不足，不產出可誤認為即時的盤中通知預覽。

## 驗收

```powershell
node scripts/verify-telegram-three-detectors.js --contract
$env:CHROME_PATH='C:\Program Files\Google\Chrome\Application\chrome.exe'
node scripts/verify-premarket-validation-ui.cjs <輸出目錄>/validation.json <輸出目錄>/ui
node scripts/verify-premarket-engineering.cjs <輸出目錄>
```

三端驗證在本機使用真實桌機／手機／88頁面標記與樣式載入同一個新元件；停用與此驗證無關的頁面腳本及外部HTTPS，避免觸發正式登入或資料服務。它不是完整正式網站E2E。

`final-engineering-receipt.json` 的complete只對 `steps_1_to_3_no_send_local_integration` 有效，必須同時保留 `formal_complete=false`、`production_deployed=false`、`notifications_sent=0`。正式發布與自然交易日驗收屬後續步驟。

## 增加劇本

新增案例至 `premarket-example-cases.cjs`，明列原始數字與使用者預期；在 `premarket-scenario-workflow.cjs` 加入獨立條件與路徑，再加正反案例。實際資料與描述不符時保留差異，不按股票代號強制命中。

## 已知資料差異

9/23本機來源重算：聯鈞成本527.7395905490885、B分數11；金像電成本1105.166420533398、B分數1。金像電9/18外資買超，9/21～23賣超，因此來源不符合原例所述連賣4天。08:59正式歷史證據尚不完整；不可將這兩例稱為已通過正式回測。
