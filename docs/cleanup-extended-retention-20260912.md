# 清理擴充正式運作流程

版本日期：2026-09-12；時區：Asia/Taipei。

沿用原五段 Windows 排程，新增類別置於第五段 Daily Retention Maintenance。非交易日不執行刪除，只有具當日有效使用者授權的 maintenance runner 可例外執行。16:15 前資料庫拒絕新增清理的 apply。

1. 驗證正式 root、交易日／當日授權、Supabase incident guard、獨立鎖。
2. 完整串流盤點 runtime state/data/status/config JSON 的 runId 與檔案引用；大型檔案不因容量略過，讀取中變更則停止。
3. 八組策略：清理逾 15 天且已明確失敗、取消或中止的批次，保留最近 20 批（策略2為60批）、最新成功批次、待修復與所有引用；逾45天的孤兒結果必須同時沒有父批次及引用。
4. 原始資料去重只處理逾15天、除 id 外整列完全一致的報價快照，保留至少一筆；同時間不同來源／runId／價格／payload 不合併。market_snapshots 與 finmind_chip_raw 維持既有主鍵唯一性，不清除日K計算所需歷史。
5. 通知僅壓縮逾30天已成功送達 claim 的大型原文，保留防重送 key、payload hash、送達摘要與目的地。未送達、待重試、當前 outbox、正式交付回執不動。
6. 雲端完整列出 Supabase buckets 與 Vercel Blob；/88 成績單保護。tests/、test-exports/、temporary-exports/ 下物件需有對應 retirement manifest、30天期限、完整引用審查、無回復用途，刪除前核對版本及刪除後重新讀回。出現新 Supabase bucket 時先要求該 bucket 引用契約，不能宣稱已驗收。
7. Preview 沿用完整分頁歷史清理，正式 production、active alias 及回復版本保護。尚無停用／無流量證據的網址不得只因年齡解除保護。
8. 檢查 Windows 完全相同 action/trigger 的重複工作、Vercel cron；未證明 canonical replacement 前不關閉任務。檢查資料庫容量、dead tuples、autovacuum 與最近運作時間，不自動 VACUUM FULL 或宣稱等額省費。無帳單用量則 realizedSavings=null。
9. 產生 extended-cleanup-v1 applied receipt，重新預覽證明沒有剩餘可刪項目，最新 complete 結果雜湊需相同。Root Monitor 再執行 --verify 獨立讀回，與原有五段、1分K、來源觀測、成本回執共同驗收。

所有零候選、受保護、缺證據與實際刪除量分開記錄。測試、程式部署、已啟用規則不能代替 actual apply 與 canonical COMPLETE。原有完整清理的失敗 journal 永久保留於本次交付證據，不修改成成功。
