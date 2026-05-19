# 輔滿終端 Codex 維護規則

## 唯一主資料夾

只使用這個資料夾：

```text
C:/Users/qutie/Documents/Codex/2026-05-16/files-mentioned-by-the-user-33
```

不要使用 `2026-05-18`、`2026-05-19`、`history-*` 資料夾當主檔。

## 固定規則

```text
盤後籌碼 / 買賣超：每日 06:00 / 21:00 完整掃
權證走向：每日 06:00 / 21:00 完整掃
策略3：不再順手掃買賣超
策略4：不再順手掃權證走向
```

## 最新維護紀錄

```text
2026-05-19：
- 盤後籌碼 / 買賣超與權證走向已改成獨立快取資料源。
- 前端只讀快取與備份檔，不要改回盤中每 10 分鐘自動抓 API。
- 買賣超快取必須自己帶收盤價、漲跌、漲幅、成交量。
- 權證走向快取必須自己帶標的代號、標的名稱、收盤價。
- 策略3 不負責補買賣超資料。
- 策略4 不負責補權證走向資料。
```

## 對應檔案

```text
主前端：
C:/Users/qutie/Documents/Codex/2026-05-16/files-mentioned-by-the-user-33/terminal.js

盤後籌碼與權證走向獨立排程：
C:/Users/qutie/Documents/Codex/2026-05-16/files-mentioned-by-the-user-33/.github/workflows/flow-cache.yml

盤後籌碼快取腳本：
C:/Users/qutie/Documents/Codex/2026-05-16/files-mentioned-by-the-user-33/scripts/scan-institution-cache.js

權證走向快取腳本：
C:/Users/qutie/Documents/Codex/2026-05-16/files-mentioned-by-the-user-33/scripts/scan-warrant-flow-cache.js

盤後籌碼快取資料：
C:/Users/qutie/Documents/Codex/2026-05-16/files-mentioned-by-the-user-33/data/institution-latest.json
C:/Users/qutie/Documents/Codex/2026-05-16/files-mentioned-by-the-user-33/data/institution-backup.json

權證走向快取資料：
C:/Users/qutie/Documents/Codex/2026-05-16/files-mentioned-by-the-user-33/data/warrant-flow-latest.json
C:/Users/qutie/Documents/Codex/2026-05-16/files-mentioned-by-the-user-33/data/warrant-flow-backup.json

策略3排程：
C:/Users/qutie/Documents/Codex/2026-05-16/files-mentioned-by-the-user-33/.github/workflows/strategy3-background-scan.yml

策略4排程：
C:/Users/qutie/Documents/Codex/2026-05-16/files-mentioned-by-the-user-33/.github/workflows/strategy4-background-scan.yml
```

## 上傳規則

修改完只給使用者明確檔案路徑，不要叫使用者自己找檔案。

GitHub repo：

```text
https://github.com/ginova777-cmd/fuman-terminal
```

上傳網址：

```text
https://github.com/ginova777-cmd/fuman-terminal/upload/main
```
