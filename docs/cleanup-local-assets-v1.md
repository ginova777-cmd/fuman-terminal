# 清理員本機資產擴充 v1

正式清理入口沿用 `cleanup-runtime-retention.js`，在既有每日第五段呼叫
`run-cleanup-local-assets.js`。獨立讀回由 `verify-cleanup-local-assets.js` 執行，
接入 `verify-daily-retention-maintenance.js`。不建立新 Windows 任務。

固定契約：`data/contracts/cleanup_local_assets_v1.json`。

| 類別 | 保留期 | 動作 |
|---|---|---|
| 退役版本建置／套件快取 | 30 日 | 刪除可重新產生的指定快取 |
| 已結案且無引用測試截圖／trace／影片 | 30 日 | 刪除指定測試產物 |
| 已關閉日誌分段 | 30 日 | gzip、解壓讀回比對、保存索引後移除原分段 |
| 退役 worktree／重複備份 | 45 日 | 正常 git worktree remove／移除已證明重複備份 |
| 中斷作業殘留 | 7 日 | 確認程序終止及 lease 不存在後刪除指定暫存 |

年齡是必要條件，不是刪除授權。所有項目須同時滿足內容 hash、結案／退役、
無正式引用、無 rollback 需求、無未處理修改、無活動程序及排程引用。
不存在正式退役清冊時仍完成盤點，回執 `manifestPresent=false`，候選為零；
這表示「全部保留」，不代表已清空空間。

## 退役清冊

執行期清冊 `C:/fuman-runtime/config/cleanup-local-assets.json`：

```json
{
  "contract": "cleanup-local-assets-manifest-v1",
  "entries": [
    {
      "category": "test_artifact",
      "path": "C:/fuman-runtime/outputs/closed-test/screenshot.png",
      "retiredAt": "實際結案時間 ISO8601",
      "evidenceFile": "退役證據絕對路徑",
      "evidenceSha256": "退役證據檔案 SHA256"
    }
  ]
}
```

退役證據契約為 `cleanup-local-retirement-evidence-v1`，必要欄位：
`type`（依類別契約）、`path`、`retiredAt`、`status=closed`、`owner`、`reason`、
`checkedAt`、`formalEvidence=false`、`rollbackRequired=false`、`unresolvedWork=false`、
`leasePaths`、`treeSha256`。treeSha256 由正式 `fingerprint()` 的相對路徑、bytes、
逐檔 hash 排序結果計算；檔案改變須重新審核，不能沿用舊證據。

額外證據：

- 日誌：`sealedAt`、`readerSupportsGzip=true`，只接受已關閉分段；目前寫入中的日誌不截斷。
- 暫存：`ownerPid`、`terminatedAt`；PID 若仍存在即拒絕，鎖定檔永遠只報告。
- 退役版本：`repository`、`integratedCommit`、`retainedRollbackRoot`；實查 Git clean、
  HEAD、正式 production 祖先關係，保留 rollback 也須 clean 且已整合。worktree
  必須指定 `worktreeOwner` 並在其實際註冊清單內；不使用 force。
- 重複備份：`replacementBackup`、`replacementTreeSha256`，內容必須完全相同，
  並有 `restoreReceiptFile`、`restoreReceiptSha256` 指向
  `backup-restore-verification-v1` 成功回執。沒有可證明的替代備份不得清除。

## 保護與讀回

`C:/fuman-terminal-preserved-20260919-cleanup`、正式 source／prod／mirror、
通知防重送日誌、production-health.jsonl、鎖定檔及 receipt 子檔均受保護。
路徑或子項目含連結拒絕；所有遞迴移除先驗證實際路徑。

候選使用既有完整 runtime JSON 引用掃描；排除該項自身退役清冊與證據，
其他引用保留。套用前重新讀引用與 Windows 程序／排程，重新檢查內容 hash。
引用掃描或活動查詢失敗即停止。新入口持有獨立執行鎖，鎖存在不移除或重跑。

每次產生 `status/cleanup-local-assets-YYYYMMDD.json`，記錄 inventory、候選、
處理與保留原因、錯誤、保護證據與讀回。獨立 verifier 確認刪除後來源不存在，
壓縮內容與原始 hash 一致；正式健康日誌允許自然追加，但已存在內容不得變動或縮短。

舊 runtime 測試目錄、日誌、final-audit 目錄按年齡刪除，以及 retired runner 的
通用 logs/tmp 年齡刪除已移交本入口，不再繞過退役證據。原歷史行情、DB、
通知等清理契約不變。正式 apply 仍需通過版本 authority 與交易日／有效維護授權。

## 無法解析的通知 claim

通知原文清理只接受可證明已送達、具防重送識別且超過30日的紀錄。無法解析的 claim 不具刪除資格，必須原位保留，以維持 exclusive-create 防重送；不得補寫成已送達、刪除或移走。擴充清理回執逐檔記錄 bytes、SHA256、未知交付狀態及原位讀回結果，獨立 verifier 重新盤點。這類保護保留可完成清理驗收，但不代表通知來源損壞已修復。保護檔在本次盤點中有變動時仍必須失敗。

Authorized history maintenance uses the authorization issuedAt as the retention reference for Supabase event, snapshot, date, run and Vercel deployment cutoffs. The runner and independent readback pass the same authorization; journal verification rejects a mismatched run, authorization hash or reference time. Items becoming eligible after that reference belong to a later cleanup, avoiding moving-cutoff false failures. Full runtime inventory readback has a bounded 10-minute timeout.
