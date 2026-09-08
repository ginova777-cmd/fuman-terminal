# STAR 盤前型態輸入 v2

正式 per-slot 契約：`star_preopen_slot_symbol_canonical_verifier_v1`  
契約版本：`slot-symbol-isolation-v2`

Viewer 綁定 `verification_run_id` 後，從 `v_fugle_daytrade_star_slot_symbol_readback.technical_data` 讀取：

```text
future_0845_open_price
future_preopen_high_price
future_preopen_low_price
future_preopen_sample_count
future_preopen_range_start_at
future_preopen_range_end_at
future_0845_source_event_at
future_latest_source_event_at
future_pattern_evidence_mode
recent_1m_three_sample_supported
```

`future_0845_open_price` 只取同交易日、`natural_schedule_evidence=true`、08:45 槽內最早的有效股期價。高低價只涵蓋 08:45 至目前槽的自然快照，不使用 09:00 後盤中高低價。每一個槽只聚合到該槽，不能偷看後續槽。

目前 producer 的正式自然證據為 08:45／08:50／08:55／08:59 四槽，不是最近一分鐘連續三筆 tick，因此固定回報：

```text
future_pattern_evidence_mode = natural_slot_snapshots_0845_through_current_slot
recent_1m_three_sample_supported = false
```

Viewer 不得用四槽資料冒充舊版最近一分鐘三筆穩定度分支。若任何開盤、區間高低、樣本數或範圍時間缺失，該股票為 `DATA_GAP`；其他 `READY` 股票不受影響。共同批次身分失敗時才整批 `BLOCKED_COMMON`。
