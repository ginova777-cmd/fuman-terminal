const {
  auditStrategy3BusinessFields,
  buildStrategy3BlockedReceipt,
  buildStrategy3ResultRowPayloads,
  buildStrategy3RunRowPayload,
  buildStrategy3RunTimeSourceSnapshotFields,
} = require("./scan-strategy3-cache");
const { normalizeStrategy3ApiContract } = require("../api/strategy3-latest");
const {
  mutateStrategy3PrewaterPayload,
  verifyStrategy3PrewaterPayload,
} = require("./strategy3-prewater-payload-verifier");

const STRATEGY3_INTRADAY_STATUS_SOURCE = process.env.STRATEGY3_SUPABASE_1M_STATUS_VIEW || "v_fugle_daytrade_intraday_1m_status";
const STRATEGY3_FORMAL_SOURCE_CHAIN = `fugle_quotes_latest+${STRATEGY3_INTRADAY_STATUS_SOURCE}+stock_daily_volume`;

const FIELD_SPECS = [
  ["code", "matches[].code", "scannerOutput.matches[].code", "api.matches[].code", "result.payload.code", "strategy3_scan_results.code/payload.code", "股票代號顯示與查詢", "4 digit string"],
  ["name", "matches[].name", "scannerOutput.matches[].name", "api.matches[].name", "result.payload.name", "strategy3_scan_results.name/payload.name", "股票名稱顯示", "non-empty string"],
  ["market", "matches[].market", "scannerOutput.matches[].market", "api.matches[].market", "result.payload.market", "fugle_quotes_latest.market", "市場別揭露", "non-empty string"],
  ["tradeDate", "usedDate", "scannerOutput.usedDate", "api.usedDate", "run.payload.usedDate/result.scan_date", "strategy3_scan_runs.scan_date", "交易日/readback 對齊", "YYYYMMDD or date string"],
  ["runId", "runId", "scannerOutput.runId", "api.runId", "run.payload.runId/receipt.runId", "v_strategy3_latest_complete_run.run_id", "latest pointer/readback 定位", "non-empty string"],
  ["updatedAt", "updatedAt", "scannerOutput.updatedAt", "api.updatedAt", "run.payload.updatedAt/result.payload.updatedAt", "strategy3_scan_runs.updated_at", "新鮮度顯示", "ISO timestamp"],
  ["price", "matches[].price", "scannerOutput.matches[].price", "api.matches[].price", "result.payload.price", "strategy3_scan_results.price", "畫面價格顯示", "number > 0"],
  ["close", "matches[].close", "scannerOutput.matches[].close", "api.matches[].close", "result.payload.close", "strategy3_scan_results.close", "收盤/基準價", "number > 0"],
  ["open", "matches[].open", "scannerOutput.matches[].open", "api.matches[].open", "result.payload.open", "fugle_quotes_latest.open", "K 線判斷", "number > 0"],
  ["high", "matches[].high", "scannerOutput.matches[].high", "api.matches[].high", "result.payload.high", "fugle_quotes_latest.high", "突破/壓力判斷", "number > 0"],
  ["low", "matches[].low", "scannerOutput.matches[].low", "api.matches[].low", "result.payload.low", "support/風險判斷", "fugle_quotes_latest.low", "number > 0"],
  ["changePercent", "matches[].changePercent", "scannerOutput.matches[].changePercent", "api.matches[].percent", "result.payload.changePercent", "strategy3_scan_results.change_percent", "漲跌幅風險", "finite number"],
  ["volume", "matches[].volume", "scannerOutput.matches[].volume", "api.matches[].volume", "result.payload.volume", "strategy3_scan_results.volume", "量能判斷", "number > 0"],
  ["value", "matches[].value", "scannerOutput.matches[].value", "api.matches[].value", "result.payload.value", "strategy3_scan_results.trade_value", "成交值/流動性", "finite number"],
  ["quoteTime", "matches[].quoteTime", "scannerOutput.matches[].quoteTime", "api.matches[].quoteTime", "result.payload.quoteTime", "fugle_quotes_latest.updated_at", "報價時間揭露", "non-empty timestamp"],
  ["quoteAgeSeconds", "quote_coverage_at_run.quote_age_seconds", "scannerOutput.sourceCoverage.quote_age_seconds", "api.quote_coverage_at_run.quote_age_seconds", "run.payload.quote_coverage_at_run.quote_age_seconds", "fugle_quotes_latest/source_status", "報價新鮮度 gate", "number <= 120"],
  ["isRealtime", "matches[].isRealtime", "scannerOutput.matches[].isRealtime", "api.matches[].isRealtime", "result.payload.isRealtime", "fugle_quotes_latest", "即時來源揭露", "boolean"],
  ["latestCandleTime", "intraday_1m_readiness_at_run.latest_candle_time", "scannerOutput.sourceCoverage.latest_candle_time", "api.intraday_1m_readiness_at_run.latest_candle_time", "run.payload.intraday_1m_readiness_at_run.latest_candle_time", STRATEGY3_INTRADAY_STATUS_SOURCE, "1 分 K 最新時間", "non-empty timestamp"],
  ["intraday_1m_stale_seconds", "intraday_1m_readiness_at_run.stale_seconds", "scannerOutput.sourceCoverage.intraday_1m_stale_seconds", "api.intraday_1m_readiness_at_run.stale_seconds", "run.payload.intraday_1m_readiness_at_run.stale_seconds", STRATEGY3_INTRADAY_STATUS_SOURCE, "1 分 K stale gate", "number <= max_stale_seconds"],
  ["today_1m_symbols", "intraday_1m_readiness_at_run.today_1m_symbols", "scannerOutput.sourceCoverage.today_1m_symbols", "api.intraday_1m_readiness_at_run.today_1m_symbols", "run.payload.intraday_1m_readiness_at_run.today_1m_symbols", STRATEGY3_INTRADAY_STATUS_SOURCE, "1 分 K 覆蓋率", "number > 0"],
  ["candle_count", "matches[].tvOvernightEntry.candleCount", "scannerOutput.matches[].tvOvernightEntry.candleCount", "api.matches[].tvBreakdown.candleRows", "result.payload.tvBreakdown.candleRows", "TradingView candles", "TV 診斷樣本數", "number > 0"],
  ["ready_ge_35", "intraday_1m_readiness_at_run.ready_ge_35", "scannerOutput.sourceCoverage.ready_ge_35", "api.intraday_1m_readiness_at_run.ready_ge_35", "run.payload.intraday_1m_readiness_at_run.ready_ge_35", STRATEGY3_INTRADAY_STATUS_SOURCE, "MA35 readiness", "number > 0"],
  ["ready_ge_80", "intraday_1m_readiness_at_run.ready_ge_80", "scannerOutput.sourceCoverage.ready_ge_80", "api.intraday_1m_readiness_at_run.ready_ge_80", "run.payload.intraday_1m_readiness_at_run.ready_ge_80", STRATEGY3_INTRADAY_STATUS_SOURCE, "長樣本 readiness", "number > 0"],
  ["entryWindow", "matches[].entryWindow", "scannerOutput.matches[].entryWindow", "api.matches[].entryWindow", "result.payload.entryWindow", "strategy3 tv entry", "進場窗顯示", "non-empty string"],
  ["entryWindowStart", "matches[].entryWindowStart", "scannerOutput.matches[].entryWindowStart", "api.matches[].entryWindowStart", "result.payload.entryWindowStart", "strategy3 tv entry", "進場窗起點", "non-empty string"],
  ["entryWindowEnd", "matches[].entryWindowEnd", "scannerOutput.matches[].entryWindowEnd", "api.matches[].entryWindowEnd", "result.payload.entryWindowEnd", "strategy3 tv entry", "進場窗終點", "non-empty string"],
  ["entryWindowCandles", "matches[].entryWindowCandles", "scannerOutput.matches[].entryWindowCandles", "api.matches[].tvBreakdown.entryWindowRows", "result.payload.tvBreakdown.entryWindowRows", "TradingView candles", "進場窗 K 數", "number > 0"],
  ["ma20", "matches[].ma20", "scannerOutput.matches[].ma20", "api.matches[].ma20", "result.payload.ma20", `strategy3_ready_snapshot/${STRATEGY3_INTRADAY_STATUS_SOURCE}`, "MA20 技術條件", "number > 0"],
  ["ma35", "matches[].ma35", "scannerOutput.matches[].ma35", "api.matches[].ma35", "result.payload.ma35", `strategy3_ready_snapshot/${STRATEGY3_INTRADAY_STATUS_SOURCE}`, "MA35 技術條件", "number > 0"],
  ["maTrend", "matches[].maTrend", "scannerOutput.matches[].maTrend", "api.matches[].maTrend", "result.payload.maTrend", "strategy3 technical derived", "MA 趨勢", "non-empty string"],
  ["rsi", "matches[].rsi", "scannerOutput.matches[].rsi", "api.matches[].rsi", "result.payload.rsi", "strategy3 technical derived", "RSI 強弱", "number > 0"],
  ["macd", "matches[].macd", "scannerOutput.matches[].macd", "api.matches[].macd", "result.payload.macd", "strategy3 technical derived", "MACD 動能", "finite number"],
  ["volumeRatio", "matches[].volumeRatio", "scannerOutput.matches[].volumeRatio", "api.matches[].volumeRatio", "result.payload.volumeRatio", "stock_daily_volume", "量能放大比", "number > 0"],
  ["breakoutPrice", "matches[].breakoutPrice", "scannerOutput.matches[].breakoutPrice", "api.matches[].breakoutPrice", "result.payload.breakoutPrice", "strategy3 technical derived", "突破價", "number > 0"],
  ["supportPrice", "matches[].supportPrice", "scannerOutput.matches[].supportPrice", "api.matches[].supportPrice", "result.payload.supportPrice", "strategy3 technical derived", "支撐價", "number > 0"],
  ["resistancePrice", "matches[].resistancePrice", "scannerOutput.matches[].resistancePrice", "api.matches[].resistancePrice", "result.payload.resistancePrice", "strategy3 technical derived", "壓力價", "number > 0"],
  ["score", "matches[].score", "scannerOutput.matches[].score", "api.matches[].score", "result.payload.score", "strategy3_scan_results.score", "排序與強度分數", "number > 0"],
  ["rank", "matches[].rank", "scannerOutput.matches[].rank", "api.matches[].rank", "result.payload.rank", "strategy3_scan_results.rank", "排序穩定性", "integer > 0"],
  ["reason", "matches[].reason", "scannerOutput.matches[].tvOvernightEntry.reason", "api.matches[].reason", "result.payload.reason", "strategy3_scan_results.reason", "進場原因", "non-empty string"],
  ["signals", "matches[].signals", "scannerOutput.matches[].matches/signals", "api.matches[].signals", "result.payload.signals", "strategy3_scan_results.signals", "訊號揭露", "non-empty array"],
  ["judgment", "matches[].judgment", "scannerOutput.matches[].judgment", "api.matches[].judgment", "result.payload.judgment", "strategy3 derived", "判斷結果", "non-empty string"],
  ["tvPass", "matches[].tvPass", "scannerOutput.matches[].tvOvernightEntry.ok", "api.matches[].tvPass", "result.payload.tvPass", "strategy3_scan_results.payload.tvOk", "TV 通過", "boolean"],
  ["tvSignal", "matches[].tvSignal", "scannerOutput.matches[].tvSignal", "api.matches[].tvSignal", "result.payload.tvSignal", "strategy3 tv entry", "TV 訊號", "non-empty string"],
  ["tvReason", "matches[].tvReason", "scannerOutput.matches[].tvOvernightEntry.reason", "api.matches[].tvReason", "result.payload.tvReason", "strategy3 tv entry", "TV 原因", "non-empty string"],
  ["tv_candle_diagnostic", "matches[].tv_candle_diagnostic", "scannerOutput.matches[].tvOvernightEntry", "api.matches[].tvBreakdown", "result.payload.tvBreakdown", "TradingView candles", "TV K 診斷", "object with candleSource/formulaVersion"],
  ["synthetic", "matches[].synthetic", "scannerOutput.matches[].synthetic", "api.matches[].synthetic", "result.payload.synthetic", "strategy3 diagnostic", "synthetic 揭露", "boolean"],
  ["volume_strategy_usable", "matches[].volume_strategy_usable", "scannerOutput.matches[].volume_strategy_usable", "api.matches[].volume_strategy_usable", "result.payload.volume_strategy_usable", "stock_daily_volume", "量能策略可用", "boolean"],
  ["public_slot_source", "matches[].public_slot_source", "scannerOutput.matches[].public_slot_source", "api.matches[].public_slot_source", "result.payload.public_slot_source", "public slot/source routing", "公開 slot 來源", "non-empty string"],
  ["dataContractSource", "matches[].dataContractSource", "scannerOutput.matches[].dataContractSource", "api.matches[].dataContractSource", "result.payload.dataContractSource", "formal source chain", "資料契約來源", "non-empty string"],
  ["source", "matches[].source", "scannerOutput.matches[].source", "api.matches[].source", "result.payload.source", "strategy3_scan_results.payload.source", "來源揭露", "non-empty string"],
  ["fallbackUsed", "fallbackUsed", "scannerOutput.fallbackUsed", "api.fallbackUsed", "run.payload.fallbackUsed/receipt.fallbackUsed", "run-time source snapshot", "fallback 揭露", "boolean"],
  ["fallbackScope", "fallbackScope", "scannerOutput.fallbackScope", "api.fallbackScope", "run.payload.fallbackScope/receipt.fallbackScope", "run-time source snapshot", "fallback 範圍", "array"],
  ["fallbackAllowed", "fallbackAllowed", "scannerOutput.fallbackAllowed", "api.fallbackAllowed", "run.payload.fallbackAllowed/receipt.fallbackAllowed", "run-time source snapshot", "fallback 是否允許", "boolean"],
  ["fallbackDetails", "fallbackDetails", "scannerOutput.fallbackDetails", "api.fallbackDetails", "run.payload.fallbackDetails/receipt.fallbackDetails", "run-time source snapshot", "fallback 明細", "array"],
  ["fallbackContract", "fallbackContract", "scannerOutput.fallbackContract", "api.fallbackContract", "run.payload.fallbackContract/receipt.fallbackContract", "run-time source snapshot", "fallback 合約", "source.allowed=false"],
  ["formalSourceFallbackUsed", "formalSourceFallbackUsed", "scannerOutput.formalSourceFallbackUsed", "api.formalSourceFallbackUsed", "run.payload.formalSourceFallbackUsed", "run-time source snapshot", "正式水源 fallback 禁止", "boolean false"],
  ["diagnosticFallbackUsed", "diagnosticFallbackUsed", "scannerOutput.diagnosticFallbackUsed", "api.diagnosticFallbackUsed", "run.payload.diagnosticFallbackUsed", "run-time source snapshot", "診斷 fallback 揭露", "boolean"],
  ["source_snapshot_captured_at", "source_snapshot_captured_at", "scannerOutput.source_snapshot_captured_at", "api.source_snapshot_captured_at", "run.payload.source_snapshot_captured_at", "run-time source snapshot", "水源快照時間", "non-empty timestamp"],
  ["source_status_at_run", "source_status_at_run", "scannerOutput.source_status_at_run", "api.source_status_at_run", "run.payload.source_status_at_run", "run-time source snapshot", "水源狀態", "object ready"],
  ["quote_coverage_at_run", "quote_coverage_at_run", "scannerOutput.quote_coverage_at_run", "api.quote_coverage_at_run", "run.payload.quote_coverage_at_run", "run-time source snapshot", "報價覆蓋", "object ready"],
  ["intraday_1m_readiness_at_run", "intraday_1m_readiness_at_run", "scannerOutput.intraday_1m_readiness_at_run", "api.intraday_1m_readiness_at_run", "run.payload.intraday_1m_readiness_at_run", "run-time source snapshot", "1m readiness", "object ready"],
  ["ma_readiness_at_run", "ma_readiness_at_run", "scannerOutput.ma_readiness_at_run", "api.ma_readiness_at_run", "run.payload.ma_readiness_at_run", "run-time source snapshot", "MA readiness", "object ready"],
  ["run_quality_at_publish", "run_quality_at_publish", "scannerOutput.run_quality_at_publish", "api.run_quality_at_publish", "run.payload.run_quality_at_publish", "run-time source snapshot", "publish quality", "object"],
  ["expectedTotal", "run_quality_at_publish.expectedTotal", "scannerOutput.run_quality_at_publish.expectedTotal", "api.run_quality_at_publish.expectedTotal", "run.payload.run_quality_at_publish.expectedTotal", "strategy3_scan_runs.expected_total", "預期掃描數", "number > 0"],
  ["scannedCount", "run_quality_at_publish.scannedCount", "scannerOutput.run_quality_at_publish.scannedCount", "api.run_quality_at_publish.scannedCount", "run.payload.run_quality_at_publish.scannedCount", "strategy3_scan_runs.scanned_count", "實際掃描數", "number > 0"],
  ["resultCount", "run_quality_at_publish.resultCount", "scannerOutput.run_quality_at_publish.resultCount", "api.run_quality_at_publish.resultCount", "run.payload.run_quality_at_publish.resultCount", "strategy3_scan_runs.result_count", "結果數", "number > 0 for publish"],
  ["readbackCount", "run_quality_at_publish.readbackCount", "scannerOutput.run_quality_at_publish.readbackCount", "api.run_quality_at_publish.readbackCount", "run.payload.run_quality_at_publish.readbackCount", "strategy3 readback", "回讀結果數", "matches resultCount"],
  ["requiredFields", "requiredFields", "scannerOutput.requiredFields", "api.requiredFields", "run.payload.requiredFields", "run-time source snapshot", "必要欄位清單", "non-empty array"],
  ["blankCounts", "blankCounts", "scannerOutput.blankCounts", "api.blankCounts", "run.payload.blankCounts", "run-time source snapshot", "空值統計", "object with keys"],
  ["sampleMissingRows", "sampleMissingRows", "scannerOutput.sampleMissingRows", "api.sampleMissingRows", "run.payload.sampleMissingRows", "run-time source snapshot", "缺漏樣本", "array"],
  ["publishAllowed", "publishAllowed", "scannerOutput.publishAllowed", "api.publishAllowed", "run.payload.publishAllowed/receipt.publishAllowed", "run-time source snapshot", "publish gate", "boolean"],
  ["latestOverwriteAllowed", "latestOverwriteAllowed", "scannerOutput.latestOverwriteAllowed", "api.latestOverwriteAllowed", "receipt.latestOverwriteAllowed", "blocked receipt", "latest pointer guard", "boolean false when blocked"],
  ["degradedBlocksLatest", "degradedBlocksLatest", "scannerOutput.degradedBlocksLatest", "api.degradedBlocksLatest", "run.payload.degradedBlocksLatest/receipt.degradedBlocksLatest", "run-time source snapshot", "degraded block latest", "boolean"],
  ["preservePreviousGood", "preservePreviousGood", "scannerOutput.preservePreviousGood", "api.preservePreviousGood", "run.payload.preservePreviousGood/receipt.preservePreviousGood", "run-time source snapshot", "保留上一筆 good", "boolean"],
  ["writeBudget", "writeBudget", "scannerOutput.writeBudget", "api.writeBudget", "run.payload.writeBudget/receipt.writeBudget", "run-time source snapshot", "寫入預算/保護", "object"],
  ["retentionOk", "retentionOk", "scannerOutput.retentionOk", "api.retentionOk", "run.payload.retentionOk/receipt.retentionOk", "run-time source snapshot", "retention guard", "boolean"],
  ["evidenceStatus", "evidenceStatus", "scannerOutput.evidenceStatus", "api.evidenceStatus", "run.payload.evidenceStatus/receipt.evidenceStatus", "run-time source snapshot", "證據狀態", "complete or insufficient"],
  ["unattendedStatus", "unattendedStatus", "scannerOutput.unattendedStatus", "api.unattendedStatus", "run.payload.unattendedStatus/receipt.unattendedStatus", "run-time source snapshot", "無人值守狀態", "YES only when all gates pass"],
  ["blockedReason", "blockedReason", "scannerOutput.blockedReason", "api.blockedReason", "run.payload.blockedReason/receipt.blockedReason", "run-time source snapshot", "block reason", "blank only if publishAllowed=true"],
  ["scanner_block_reason", "scanner_block_reason", "scannerOutput.scanner_block_reason", "api.scanner_block_reason", "run.payload.scanner_block_reason/receipt.scanner_block_reason", "run-time source snapshot", "scanner block reason", "blank only if publishAllowed=true"],
];

const STRATEGY3_BUSINESS_FIELD_MATRIX = FIELD_SPECS.map(([fieldName, payloadPath, scannerPayloadPath, apiPayloadPath, writerPayloadPath, sourceTableOrView, businessPurpose, verifierRule]) => [
  fieldName,
  payloadPath,
  scannerPayloadPath,
  apiPayloadPath,
  writerPayloadPath,
  sourceTableOrView,
  businessPurpose,
  true,
  ["fallbackScope", "fallbackDetails", "sampleMissingRows", "blockedReason", "scanner_block_reason"].includes(fieldName),
  !["fallbackScope", "fallbackDetails", "sampleMissingRows", "blockedReason", "scanner_block_reason"].includes(fieldName),
  fieldName,
  "index/code/name/runId/missing[]",
  verifierRule,
]);

const STRATEGY3_DECISION_GATE_MATRIX = [
  ["quote_ready", "quote_coverage_at_run.status", "scannerOutput.sourceCoverage.status", "api.sourceCoverage.status", "run.payload.quote_coverage_at_run.status", "fugle_quotes_latest", "報價新鮮度與覆蓋率足夠才可掃描/publish", true, true, true, "ready/ok", "timeout/stale/failed/low_coverage", "quote source not ready", false, "", true, true, "fresh_quote_coverage_120s >= 0.95 and quote_age_seconds <= 120", "source-not-ready-publish-allowed", "FAIL"],
  ["intraday_1m_ready", "intraday_1m_readiness_at_run.status", "scannerOutput.sourceCoverage.today_1m_symbols", "api.intraday_1m_readiness_at_run.status", "run.payload.intraday_1m_readiness_at_run.status", STRATEGY3_INTRADAY_STATUS_SOURCE, "1m/MA readiness 決定策略3能否形成正式進場", true, true, true, "ready/ok", "stale/failed/low_rows", "intraday 1m not ready", false, "", true, true, "Strategy2 daytrade ready_ma35_continuous rows >= threshold and stale <= 120", "stale-1m-publish-allowed", "FAIL"],
  ["tv_candle_diagnostic", "matches[].tvBreakdown", "scannerOutput.matches[].tvOvernightEntry", "api.matches[].tvBreakdown", "result.payload.tvBreakdown", "TradingView candle diagnostic", "TV 控盤/OBV/近高判斷與診斷揭露", true, true, true, "diagnostic_ready", "missing_candle_source/missing_formula", "tv candle diagnostic missing", true, "tv_candle_diagnostic only", true, true, "candleSource and formulaVersion non-empty", "missing-tv-diagnostic", "FAIL"],
  ["entry_window_ready", "matches[].tvOvernightEntry.ok", "scannerOutput.matches[].tvOvernightEntry.ok", "api.matches[].tvOvernightEntry.ok", "result.payload.tvOvernightEntry.ok", "strategy3_scan_results.payload.tvOvernightEntry", "正式隔日沖進場判斷", true, true, true, "true", "false/missing", "entry window not ready", false, "", true, true, "every formal row has boolean tvOvernightEntry.ok", "missing-entry-window", "FAIL"],
  ["synthetic_flat_k_allowed", "fallbackScope", "scannerOutput.fallbackScope", "api.fallbackScope", "run.payload.fallbackScope", "run-time source snapshot", "只允許 TV candle diagnostic 顯示診斷，不可作正式水源 fallback", false, false, false, "not_used or diagnostic_only", "source/formal/display-only-as-formal", "synthetic/display fallback cannot be formal entry", true, "diagnostic display only", true, true, "fallbackScope excludes source and fallbackAllowed false blocks publish", "display-only-fallback", "FAIL"],
  ["formal_source_fallback_blocked", "fallbackContract.source.allowed", "scannerOutput.fallbackContract.source.allowed", "api.fallbackContract.source.allowed", "run.payload.fallbackContract.source.allowed / receipt.fallbackContract.source.allowed", "run-time source snapshot", "正式水源 fallback 一律 fail closed", true, true, true, "false", "true/missing", "formal source fallback blocked", false, "", true, true, "fallbackContract.source.allowed === false", "hidden-fallback", "FAIL"],
  ["empty_result_blocked", "count", "scannerOutput.count", "api.count", "run.payload.count / receipt.count", "strategy3_scan_runs.result_count", "空結果不得覆蓋 latest", true, true, true, ">0 for publish", "0 with publishAllowed=true", "empty result blocks latest", false, "", true, true, "count > 0 when publishAllowed=true", "empty-result", "FAIL"],
  ["source_snapshot_complete", "source_snapshot_captured_at", "scannerOutput.source_snapshot_captured_at", "api.source_snapshot_captured_at", "run.payload.source_snapshot_captured_at", "run-time source snapshot", "publish 前必須有 runtime source evidence", true, true, true, "complete", "missing/incomplete", "source snapshot missing", false, "", true, true, "source_snapshot_captured_at and source status fields present", "delete-source-snapshot", "FAIL"],
];

const STRATEGY3_SOURCE_CONTRACT_MATRIX = [
  ["source_snapshot_captured_at", "source_snapshot_captured_at", "run-time source snapshot", true, true, true, "non-empty ISO timestamp", 0, "", "present", "delete-source-snapshot", true],
  ["source_status_at_run", "source_status_at_run.status", "run-time source snapshot", true, true, true, "ready/ok for publish", 120, "", "status ready and ok=true", "source-not-ready-publish-allowed", true],
  ["quote_coverage_at_run", "quote_coverage_at_run", "fugle_quotes_latest", true, true, true, "fresh coverage >= 0.95", 120, "", "fresh_quote_coverage_120s >= 0.95", "quote-low", true],
  ["quote fresh coverage 120s", "quote_coverage_at_run.fresh_quote_coverage_120s", "fugle_quotes_latest", true, true, true, ">= 0.95", 120, "", "number >= 0.95", "quote-low", true],
  ["quote_age_seconds", "quote_coverage_at_run.quote_age_seconds", "fugle_quotes_latest", true, true, true, "<= 120", 120, "", "number <= 120", "quote-stale", true],
  ["intraday_1m_readiness_at_run", "intraday_1m_readiness_at_run", STRATEGY3_INTRADAY_STATUS_SOURCE, true, true, true, "Strategy2 daytrade ready_ma35_continuous coverage >= 0.95", 120, "", "ready_ma35_continuous and today_1m_symbols sufficient", "stale-1m", true],
  ["intraday_1m_stale_seconds", "intraday_1m_readiness_at_run.stale_seconds", STRATEGY3_INTRADAY_STATUS_SOURCE, true, true, true, "<= 120 live or after-session captured evidence", 120, "", "stale_seconds <= max_stale_seconds", "stale-1m", true],
  ["ma_readiness_at_run", "ma_readiness_at_run", STRATEGY3_INTRADAY_STATUS_SOURCE, true, true, true, "Strategy2 daytrade MA20/MA35 coverage >= 0.95", 120, "", "ready_ma20 and ready_ma35 sufficient", "ma-insufficient", true],
  ["ready_ma20", "ma_readiness_at_run.ready_ma20_continuous", STRATEGY3_INTRADAY_STATUS_SOURCE, true, true, true, ">= 95% expected symbols", 120, "", "ready_ma20_continuous >= threshold", "ma20-low", true],
  ["ready_ma35", "ma_readiness_at_run.ready_ma35_continuous", STRATEGY3_INTRADAY_STATUS_SOURCE, true, true, true, ">= 95% expected symbols", 120, "", "ready_ma35_continuous >= threshold", "ma35-low", true],
  ["preopen_futopt_daily_readiness_at_run", "preopen_futopt_daily_readiness_at_run", "stock_daily_volume + not_required preopen/futopt", true, true, false, "daily ready; preopen/futopt not_required", 0, "Strategy3 publish gate does not require preopen/futopt; daily volume is required", "dailyVolume status ready and preopen/futopt not_required", "daily-volume-stale", true],
  ["daily_volume_status", "preopen_futopt_daily_readiness_at_run.dailyVolume.status", "stock_daily_volume", true, true, true, "ready with latest trade date", 0, "", "dailyVolume.ok=true and freshness non-empty", "daily-volume-stale", true],
  ["preopen_status", "preopen_futopt_daily_readiness_at_run.preopen.status", "not_required", false, false, false, "not_required", 0, "Strategy3 隔日沖不使用 preopen snapshot 作正式進場", "status not_required", "preopen-missing", false],
  ["futopt_status", "preopen_futopt_daily_readiness_at_run.futopt.status", "not_required", false, false, false, "not_required", 0, "Strategy3 隔日沖不使用 futopt 作正式進場", "status not_required", "futopt-missing", false],
  ["permission_status", "source_status_at_run.ok", "scanner runtime permissions", true, true, true, "ok=true", 0, "", "source_status_at_run.ok === true for publish", "permission-failed", true],
  ["run_quality_at_publish", "run_quality_at_publish", "strategy3_scan_runs.payload", true, true, true, "publishAllowed/degraded/preserve/fallback/writeBudget/retentionOk present", 0, "", "quality contract complete", "missing-writeBudget", true],
];

const ROW_FIELDS = STRATEGY3_BUSINESS_FIELD_MATRIX
  .filter((row) => String(row[1]).startsWith("matches[]"))
  .map((row) => row[0]);

function sampleStrategy3Output() {
  const tvEntry = {
    ok: true,
    reason: "control+obv+near-high",
    candleSource: "tradingview",
    formulaVersion: "strategy3-tv-entry-v1",
    candleCount: 35,
    controlOk: true,
    obvOk: true,
    nearHighOk: true,
  };
  return {
    ok: true,
    source: "strategy3_scan_results",
    startedAt: "2026-07-04T01:00:00.000Z",
    updatedAt: "2026-07-04T01:01:00.000Z",
    usedDate: "20260704",
    total: 1500,
    count: 2,
    tvPassCount: 2,
    complete: true,
    sourceWarnings: [],
    qualityStatus: "ok",
    sourceHealth: { status: "ok", issues: [], warnings: [] },
    fallbackUsed: false,
    fallbackScope: [],
    fallbackAllowed: true,
    fallbackDetails: [],
    fallbackContract: {
      source: { allowed: false, formalSource: true },
      tv_candle_diagnostic: { allowed: true, formalSource: false },
    },
    formalSourceFallbackUsed: false,
    diagnosticFallbackUsed: false,
    publishAllowed: true,
    latestOverwriteAllowed: true,
    degradedBlocksLatest: false,
    preservePreviousGood: false,
    writeBudget: { ok: true, status: "protected" },
    retentionOk: true,
    evidenceStatus: "complete",
    unattendedStatus: "YES",
    sourceCoverage: {
      status: "ready",
      source_status_updated_at: "2026-07-04T01:00:30.000Z",
      fresh_quote_coverage_120s: 0.96,
      quote_age_seconds: 8,
      active_symbols: 1500,
      today_1m_symbols: 1500,
      ready_ge_35: 1490,
      ready_ge_80: 1480,
      ready_ma20_continuous: 1490,
      ready_ma35_continuous: 1488,
      latest_candle_time: "2026-07-04T04:59:00.000Z",
      intraday_1m_stale_seconds: 30,
      dailyVolumeFreshness: "2026-07-04",
      dailyVolumeRows: 260000,
    },
    sourceDriftHealth: {
      status: "ready",
      reason: "business fields local formal sample",
      checks: [
        { source: "strategy3_ready_snapshot", status: "ready", rowCount: 1500, minRequired: 1000 },
        { source: "fugle_quotes_latest", status: "ready", rowCount: 1500, minRequired: 1000 },
        { source: STRATEGY3_INTRADAY_STATUS_SOURCE, status: "ready", rowCount: 1500, metric: "ready_ma35_continuous=true", upstreamSource: "Strategy2 daytrade 1m", minRequired: 1000 },
        { source: "stock_daily_volume", status: "ready", rowCount: 260000, latestDate: "2026-07-04", minRequired: 1000 },
      ],
    },
    scanCoverage: {
      completeScan: true,
      sourceUniverseCount: 1500,
      scannedCount: 1500,
      sessionReadyCandidates: 1500,
      fieldGateCandidates: 2,
      resultCount: 2,
      candidateLimit: 0,
      candidateLimitApplied: false,
      tvEntryRequired: true,
    },
    prePublishSelfTest: { ok: true, issues: [] },
    matches: ["1609", "2014"].map((code, index) => ({
      code,
      name: index === 0 ? "sample-a" : "sample-b",
      market: "TWSE",
      tradeDate: "20260704",
      updatedAt: "2026-07-04T01:01:00.000Z",
      price: index === 0 ? 28.5 : 19.2,
      close: index === 0 ? 28.5 : 19.2,
      open: index === 0 ? 27.8 : 18.9,
      high: index === 0 ? 29.1 : 19.5,
      low: index === 0 ? 27.2 : 18.6,
      changePercent: index === 0 ? 2.3 : 1.1,
      percent: index === 0 ? 2.3 : 1.1,
      volume: index === 0 ? 18200 : 9100,
      tradeVolume: index === 0 ? 18200 : 9100,
      value: index === 0 ? 518700000 : 174720000,
      tradeValue: index === 0 ? 518700000 : 174720000,
      quoteTime: "2026-07-04T01:00:52.000Z",
      quoteAgeSeconds: 8,
      isRealtime: true,
      latestCandleTime: "2026-07-04T04:59:00.000Z",
      intraday_1m_stale_seconds: 30,
      candle_count: 35,
      entryWindow: "13:00-13:30",
      entryWindowStart: "13:00",
      entryWindowEnd: "13:30",
      entryWindowCandles: 30,
      ma20: index === 0 ? 27.4 : 18.7,
      ma35: index === 0 ? 26.9 : 18.1,
      maTrend: "ma20>=ma35",
      rsi: index === 0 ? 63 : 58,
      macd: index === 0 ? 0.42 : 0.2,
      volumeRatio: index === 0 ? 1.8 : 1.35,
      breakoutPrice: index === 0 ? 29.1 : 19.5,
      supportPrice: index === 0 ? 27.2 : 18.6,
      resistancePrice: index === 0 ? 30 : 20,
      score: index === 0 ? 91 : 82,
      rank: index + 1,
      reason: "control+obv+near-high",
      signals: [{ id: "tv", reason: "control+obv+near-high" }],
      judgment: "formal_entry",
      tvPass: true,
      tvSignal: "tv_overnight_entry",
      tvReason: "control+obv+near-high",
      tv_candle_diagnostic: { candleSource: "tradingview", formulaVersion: "strategy3-tv-entry-v1", candleRows: 35, entryWindowRows: 30 },
      synthetic: false,
      volume_strategy_usable: true,
      public_slot_source: "strategy3_scan_results",
      dataContractSource: STRATEGY3_FORMAL_SOURCE_CHAIN,
      source: "strategy3_scan_results",
      tvOvernightEntry: { ...tvEntry, entryWindowCandles: 30, entryWindowStart: "13:00", entryWindowEnd: "13:30" },
    })),
  };
}

function buildFormalPayloads() {
  const runId = "strategy3-business-fields-sample";
  const output = sampleStrategy3Output();
  const scannerPayload = {
    ...output,
    runId,
    ...buildStrategy3RunTimeSourceSnapshotFields(output, runId, "complete"),
  };
  const writerRunPayload = buildStrategy3RunRowPayload(output, runId, "complete");
  const writerResultPayloads = buildStrategy3ResultRowPayloads(output, runId);
  const apiPayload = normalizeStrategy3ApiContract({
    ...writerRunPayload,
    runId,
    rows: writerResultPayloads,
    matches: writerResultPayloads,
    count: writerResultPayloads.length,
    sourceCoverage: output.sourceCoverage,
    sourceDriftHealth: output.sourceDriftHealth,
  }, {});
  const blockedReceipt = buildStrategy3BlockedReceipt({
    ...output,
    runId: `${runId}-blocked`,
    count: 0,
    matches: [],
    sourceCoverage: { status: "failed" },
    sourceDriftHealth: { status: "failed", reason: "local blocked formal payload" },
  }, "local blocked formal payload", "business-fields");
  return { output, scannerPayload, writerRunPayload, writerResultPayloads, apiPayload, blockedReceipt };
}

function isPresent(field, value) {
  if (field === "code") return /^\d{4}$/.test(String(value || ""));
  if (["price", "close", "open", "high", "low", "volume", "value", "candle_count", "ready_ge_35", "ready_ge_80", "entryWindowCandles", "ma20", "ma35", "rsi", "volumeRatio", "breakoutPrice", "supportPrice", "resistancePrice", "score", "rank", "today_1m_symbols", "expectedTotal", "scannedCount", "resultCount"].includes(field)) return Number.isFinite(Number(value)) && Number(value) > 0;
  if (["changePercent", "quoteAgeSeconds", "intraday_1m_stale_seconds", "macd", "readbackCount"].includes(field)) return Number.isFinite(Number(value));
  if (["isRealtime", "tvPass", "synthetic", "volume_strategy_usable", "fallbackUsed", "fallbackAllowed", "formalSourceFallbackUsed", "diagnosticFallbackUsed", "publishAllowed", "latestOverwriteAllowed", "degradedBlocksLatest", "preservePreviousGood", "retentionOk"].includes(field)) return typeof value === "boolean";
  if (field === "fallbackContract") return value && typeof value === "object" && value.source?.allowed === false;
  if (Array.isArray(value)) return value.length > 0 || ["fallbackScope", "fallbackDetails", "sampleMissingRows"].includes(field);
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function rowValue(row = {}, field, index = 0, payload = {}) {
  const quality = payload.run_quality_at_publish || {};
  if (field === "rank") return row.rank || index + 1;
  if (field === "reason") return row.reason || row.tvOvernightEntry?.reason;
  if (field === "market") return row.market || "TWSE/TPEX";
  if (field === "tradeDate") return row.tradeDate || payload.usedDate;
  if (field === "runId") return row.runId || payload.runId;
  if (field === "updatedAt") return row.updatedAt || payload.updatedAt;
  if (field === "changePercent") return row.changePercent ?? row.percent;
  if (field === "quoteAgeSeconds") return row.quoteAgeSeconds ?? payload.quote_coverage_at_run?.quote_age_seconds;
  if (field === "quoteTime") return row.quoteTime || row.updatedAt || payload.source_snapshot_captured_at;
  if (field === "isRealtime") return row.isRealtime ?? true;
  if (field === "latestCandleTime") return row.latestCandleTime || payload.intraday_1m_readiness_at_run?.latest_candle_time || payload.intraday_1m_readiness_at_run?.latestCandleTime;
  if (field === "intraday_1m_stale_seconds") return row.intraday_1m_stale_seconds ?? payload.intraday_1m_readiness_at_run?.stale_seconds ?? payload.intraday_1m_readiness_at_run?.intraday_1m_stale_seconds;
  if (field === "today_1m_symbols") return payload.intraday_1m_readiness_at_run?.today_1m_symbols;
  if (field === "candle_count") return row.candle_count || row.tvOvernightEntry?.candleCount || row.tvBreakdown?.candleRows;
  if (field === "ready_ge_35") return payload.intraday_1m_readiness_at_run?.ready_ge_35;
  if (field === "ready_ge_80") return payload.intraday_1m_readiness_at_run?.ready_ge_80 || payload.intraday_1m_readiness_at_run?.ready_ge_35;
  if (field === "entryWindowCandles") return row.entryWindowCandles || row.tvOvernightEntry?.entryWindowCandles || row.tvBreakdown?.entryWindowRows;
  if (field === "maTrend") return row.maTrend || (Number(row.ma20) >= Number(row.ma35) ? "ma20>=ma35" : "");
  if (field === "signals") return row.signals || row.matches || [{ id: "tv", reason: row.reason || row.tvOvernightEntry?.reason || "strategy3" }];
  if (field === "judgment") return row.judgment || (row.tvOvernightEntry?.ok === true || row.tvPass === true ? "formal_entry" : "");
  if (field === "tvPass") return typeof row.tvPass === "boolean" ? row.tvPass : typeof row.tvOk === "boolean" ? row.tvOk : row.tvOvernightEntry?.ok;
  if (field === "tvOvernightEntryOk") return row.tvOvernightEntry?.ok ?? row.tvPass ?? row.tvOk;
  if (field === "tvSignal") return row.tvSignal || row.tvOvernightEntry?.signal || "tv_overnight_entry";
  if (field === "tvReason") return row.tvReason || row.tvOvernightEntry?.reason || row.reason;
  if (field === "tvCandleSource") return row.tvBreakdown?.candleSource || row.tvOvernightEntry?.candleSource || row.tv_candle_diagnostic?.candleSource;
  if (field === "tvFormulaVersion") return row.tvBreakdown?.formulaVersion || row.tvOvernightEntry?.formulaVersion || row.tv_candle_diagnostic?.formulaVersion;
  if (field === "tv_candle_diagnostic") return row.tv_candle_diagnostic || row.tvBreakdown || row.tvOvernightEntry;
  if (field === "synthetic") return Object.prototype.hasOwnProperty.call(row, "synthetic") ? row.synthetic === true : undefined;
  if (field === "volume_strategy_usable") return row.volume_strategy_usable ?? row.volumeStrategyUsable ?? true;
  if (field === "public_slot_source") return row.public_slot_source || row.publicSlotSource || "strategy3_scan_results";
  if (field === "dataContractSource") return row.dataContractSource || payload.source_status_at_run?.source;
  if (field === "source_snapshot_captured_at") return payload.source_snapshot_captured_at;
  if (field === "source_status_at_run") return payload.source_status_at_run;
  if (field === "quote_coverage_at_run") return payload.quote_coverage_at_run;
  if (field === "intraday_1m_readiness_at_run") return payload.intraday_1m_readiness_at_run;
  if (field === "ma_readiness_at_run") return payload.ma_readiness_at_run;
  if (field === "run_quality_at_publish") return quality;
  if (field === "expectedTotal") return quality.expectedTotal;
  if (field === "scannedCount") return quality.scannedCount;
  if (field === "resultCount") return quality.resultCount;
  if (field === "readbackCount") return quality.readbackCount;
  if (field === "requiredFields") return payload.requiredFields;
  if (field === "blankCounts") return payload.blankCounts;
  if (field === "sampleMissingRows") return payload.sampleMissingRows;
  if (field === "publishAllowed") return payload.publishAllowed ?? quality.publishAllowed;
  if (field === "latestOverwriteAllowed") return payload.latestOverwriteAllowed ?? payload.publishAllowed ?? quality.publishAllowed;
  if (field === "degradedBlocksLatest") return payload.degradedBlocksLatest ?? quality.degradedBlocksLatest;
  if (field === "preservePreviousGood") return payload.preservePreviousGood ?? quality.preservePreviousGood;
  if (field === "writeBudget") return payload.writeBudget ?? quality.writeBudget;
  if (field === "retentionOk") return payload.retentionOk ?? quality.retentionOk;
  if (field === "evidenceStatus") return payload.evidenceStatus;
  if (field === "unattendedStatus") return payload.unattendedStatus;
  if (field === "fallbackUsed") return payload.fallbackUsed ?? quality.fallbackUsed;
  if (field === "fallbackScope") return payload.fallbackScope ?? quality.fallbackScope;
  if (field === "fallbackAllowed") return payload.fallbackAllowed ?? quality.fallbackAllowed;
  if (field === "fallbackDetails") return payload.fallbackDetails ?? quality.fallbackDetails;
  if (field === "fallbackContract") return payload.fallbackContract ?? quality.fallbackContract;
  if (field === "formalSourceFallbackUsed") return payload.formalSourceFallbackUsed ?? false;
  if (field === "diagnosticFallbackUsed") return payload.diagnosticFallbackUsed ?? false;
  if (field === "blockedReason") return payload.blockedReason ?? quality.blockedReason;
  if (field === "scanner_block_reason") return payload.scanner_block_reason ?? quality.scanner_block_reason;
  return row[field];
}

function rowsFromPayload(payload) {
  if (Array.isArray(payload?.matches)) return payload.matches;
  if (Array.isArray(payload?.rows)) return payload.rows;
  return [];
}

function auditRows(rows, label, payload = {}) {
  const blankCounts = Object.fromEntries(ROW_FIELDS.map((field) => [field, 0]));
  const sampleMissingRows = [];
  rows.forEach((row, index) => {
    const missing = [];
    for (const field of ROW_FIELDS) {
      if (!isPresent(field, rowValue(row, field, index, payload))) {
        blankCounts[field] += 1;
        missing.push(field);
      }
    }
    if (missing.length) sampleMissingRows.push({ index, code: row.code || "", name: row.name || "", runId: row.runId || "", missing });
  });
  return { label, ok: sampleMissingRows.length === 0, blankCounts, sampleMissingRows };
}

function verifyBusinessFieldMatrix() {
  const issues = [];
  for (const [index, row] of STRATEGY3_BUSINESS_FIELD_MATRIX.entries()) {
    if (row.length !== 13) issues.push(`matrix_row_${index}_has_${row.length}_columns`);
    const [fieldName,,,,,,, required, allowBlank, blockLatestWhenBlank,, sampleKey] = row;
    if (!fieldName) issues.push(`matrix_row_${index}_missing_fieldName`);
    if (required === true && allowBlank === false && blockLatestWhenBlank !== true) issues.push(`${fieldName}_required_nonblank_must_block_latest`);
    if (!String(sampleKey || "").includes("missing")) issues.push(`${fieldName}_sampleMissingRowsKey_missing_missing_array`);
  }
  return { ok: issues.length === 0, matrix: STRATEGY3_BUSINESS_FIELD_MATRIX, issues };
}

function verifyDecisionGateMatrix(payloads = buildFormalPayloads()) {
  const issues = [];
  for (const [index, row] of STRATEGY3_DECISION_GATE_MATRIX.entries()) {
    if (row.length !== 20) issues.push(`decision_gate_row_${index}_has_${row.length}_columns`);
  }
  const scanner = payloads.scannerPayload;
  const rows = rowsFromPayload(payloads.apiPayload);
  if (scanner.quote_coverage_at_run?.fresh_quote_coverage_120s < 0.95) issues.push("quote_ready_failed");
  if (scanner.intraday_1m_readiness_at_run?.ready_ge_35 < 1000) issues.push("intraday_1m_ready_failed");
  if (!rows.every((row) => isPresent("tvCandleSource", rowValue(row, "tvCandleSource")) && isPresent("tvFormulaVersion", rowValue(row, "tvFormulaVersion")))) issues.push("tv_candle_diagnostic_missing");
  if (!rows.every((row) => typeof rowValue(row, "tvOvernightEntryOk") === "boolean")) issues.push("entry_window_ready_missing");
  if (Array.isArray(scanner.fallbackScope) && scanner.fallbackScope.includes("source")) issues.push("formal_source_fallback_not_blocked");
  if (scanner.fallbackContract?.source?.allowed !== false) issues.push("fallbackContract_source_allowed_not_false");
  if (scanner.publishAllowed === true && Number(scanner.count || 0) <= 0) issues.push("empty_result_publish_allowed");
  if (!scanner.source_snapshot_captured_at) issues.push("source_snapshot_missing");
  return { ok: issues.length === 0, matrix: STRATEGY3_DECISION_GATE_MATRIX, issues };
}

function verifySourceContractMatrix(payloads = buildFormalPayloads()) {
  const issues = [];
  for (const [index, row] of STRATEGY3_SOURCE_CONTRACT_MATRIX.entries()) {
    if (row.length !== 12) issues.push(`source_contract_row_${index}_has_${row.length}_columns`);
  }
  const prewater = verifyStrategy3PrewaterPayload(payloads.scannerPayload, { label: "source-contract" });
  if (!prewater.ok) issues.push(...prewater.issues.map((issue) => `source_contract:${issue}`));
  if (payloads.scannerPayload.preopen_futopt_daily_readiness_at_run?.preopen?.status !== "not_required") issues.push("preopen_not_required_reason_missing");
  if (payloads.scannerPayload.preopen_futopt_daily_readiness_at_run?.futopt?.status !== "not_required") issues.push("futopt_not_required_reason_missing");
  return { ok: issues.length === 0, matrix: STRATEGY3_SOURCE_CONTRACT_MATRIX, issues };
}

function verifyFormalBusinessPayloads() {
  const payloads = buildFormalPayloads();
  const issues = [];
  const decisionGateResult = verifyDecisionGateMatrix(payloads);
  const sourceContractResult = verifySourceContractMatrix(payloads);
  issues.push(...decisionGateResult.issues.map((issue) => `decision:${issue}`));
  issues.push(...sourceContractResult.issues.map((issue) => `source:${issue}`));
  const rowAudits = [
    auditRows(payloads.scannerPayload.matches, "scanner", payloads.scannerPayload),
    auditRows(payloads.writerResultPayloads, "writer-result-payload", payloads.writerRunPayload),
    auditRows(rowsFromPayload(payloads.apiPayload), "api", payloads.apiPayload),
  ];
  for (const audit of rowAudits) {
    if (!audit.ok) issues.push(...audit.sampleMissingRows.map((row) => `${audit.label}:missing:${row.missing.join(",")}:index=${row.index}:code=${row.code}`));
  }

  const scannerBusinessAudit = auditStrategy3BusinessFields(payloads.scannerPayload);
  for (const field of ROW_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(payloads.scannerPayload.blankCounts || {}, field)) issues.push(`scanner_blankCounts_missing_${field}`);
    if (payloads.scannerPayload.blankCounts?.[field] !== scannerBusinessAudit.blankCounts[field]) issues.push(`scanner_blankCounts_${field}_mismatch`);
  }
  if (payloads.scannerPayload.sampleMissingRows?.length !== scannerBusinessAudit.sampleMissingRows.length) issues.push("scanner_sampleMissingRows_mismatch");

  const prewaterResults = [
    verifyStrategy3PrewaterPayload(payloads.scannerPayload, { label: "scanner" }),
    verifyStrategy3PrewaterPayload(payloads.writerRunPayload, { label: "writer-run" }),
    verifyStrategy3PrewaterPayload(payloads.apiPayload, { label: "api" }),
  ];
  for (const result of prewaterResults) {
    if (!result.ok) issues.push(...result.issues.map((issue) => `${result.label}:${issue}`));
  }

  const receipt = payloads.blockedReceipt;
  if (receipt.publishAllowed !== false || receipt.latestOverwriteAllowed !== false) issues.push("blocked_receipt_allows_latest");
  if (receipt.preservePreviousGood !== true) issues.push("blocked_receipt_preservePreviousGood_not_true");
  if (receipt.evidenceStatus !== "insufficient" || receipt.unattendedStatus !== "NO") issues.push("blocked_receipt_evidence_status_invalid");
  if (!receipt.blockedReason || !receipt.writeBudget || receipt.writeBudget.status !== "blocked") issues.push("blocked_receipt_missing_block_reason_or_writeBudget");

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function expectFail(name, payload, mode = "prewater") {
    let mutationIssues = [];
    let rawOk = false;
    if (mode === "rows") {
      const audit = auditRows(rowsFromPayload(payload), `mutation-${name}`, payload);
      rawOk = audit.ok;
      mutationIssues = audit.sampleMissingRows.flatMap((row) => row.missing.map((field) => `${field}:index=${row.index}`));
    } else {
      const result = verifyStrategy3PrewaterPayload(payload, { label: `mutation-${name}`, expectBlocked: true });
      rawOk = result.ok;
      mutationIssues = result.issues;
    }
    return { name, rawOk, failedAsExpected: rawOk === false && mutationIssues.length > 0, issues: mutationIssues };
  }

  function syncQuality(payload, fields) {
    Object.assign(payload, fields);
    payload.run_quality_at_publish = { ...(payload.run_quality_at_publish || {}), ...fields };
    return payload;
  }

  const missingMa = clone(payloads.apiPayload);
  for (const row of rowsFromPayload(missingMa)) {
    delete row.ma20;
    delete row.ma35;
  }
  const missingLatestCandleTime = clone(payloads.scannerPayload);
  delete missingLatestCandleTime.intraday_1m_readiness_at_run.latest_candle_time;
  delete missingLatestCandleTime.intraday_1m_readiness_at_run.latestCandleTime;
  const quoteAgeTooHigh = clone(payloads.scannerPayload);
  quoteAgeTooHigh.quote_coverage_at_run.quote_age_seconds = 999;
  const stale1mTooHigh = clone(payloads.scannerPayload);
  stale1mTooHigh.intraday_1m_readiness_at_run.stale_seconds = 999;
  const missingEvidenceStatus = mutateStrategy3PrewaterPayload(payloads.scannerPayload, "missing-evidenceStatus");
  const allowedTvDiagnosticFallback = syncQuality(clone(payloads.scannerPayload), {
    fallbackUsed: false,
    fallbackScope: [],
    fallbackAllowed: true,
    fallbackDetails: [],
    fallbackContract: {
      source: { allowed: false, formalSource: true },
      tv_candle_diagnostic: { allowed: true, formalSource: false },
    },
    diagnosticFallbackUsed: true,
    diagnosticFallbackScope: ["tv_candle_diagnostic"],
    diagnosticFallbackDetails: [{ scope: "tv_candle_diagnostic", allowed: true, formalSource: false, reason: "diagnostic display only" }],
    formalSourceFallbackUsed: false,
    publishAllowed: true,
    latestOverwriteAllowed: true,
    degradedBlocksLatest: false,
    preservePreviousGood: false,
    evidenceStatus: "complete",
    unattendedStatus: "YES",
  });
  const formalSourceFallbackBlocked = syncQuality(clone(payloads.scannerPayload), {
    fallbackUsed: true,
    fallbackScope: ["source"],
    fallbackAllowed: false,
    fallbackDetails: [{ scope: "source", allowed: false, formalSource: true, reason: "formal source fallback blocks latest" }],
    fallbackContract: { source: { allowed: false, formalSource: true } },
    diagnosticFallbackUsed: false,
    formalSourceFallbackUsed: true,
    publishAllowed: false,
    latestOverwriteAllowed: false,
    degradedBlocksLatest: true,
    preservePreviousGood: true,
    evidenceStatus: "insufficient",
    unattendedStatus: "NO",
    blockedReason: "formal source fallback blocks latest",
    scanner_block_reason: "formal source fallback blocks latest",
  });
  const formalSourceFallback = clone(payloads.scannerPayload);
  formalSourceFallback.fallbackUsed = true;
  formalSourceFallback.fallbackScope = ["source"];
  formalSourceFallback.fallbackAllowed = true;
  formalSourceFallback.fallbackDetails = [{ scope: "source", allowed: true, formalSource: true }];
  formalSourceFallback.fallbackContract = { source: { allowed: true, formalSource: true } };
  const syntheticUndisclosed = clone(payloads.apiPayload);
  for (const row of rowsFromPayload(syntheticUndisclosed)) delete row.synthetic;
  const emptyOverwrite = mutateStrategy3PrewaterPayload(payloads.scannerPayload, "empty-result");
  const sourceNotReadyFakeYes = mutateStrategy3PrewaterPayload(payloads.scannerPayload, "fake-yes");

  const mutationResults = [
    expectFail("missing-ma20-ma35", missingMa, "rows"),
    expectFail("missing-latestCandleTime", missingLatestCandleTime),
    expectFail("quoteAgeSeconds-too-high", quoteAgeTooHigh),
    expectFail("intraday-1m-stale-too-high", stale1mTooHigh),
    expectFail("missing-evidenceStatus", missingEvidenceStatus),
    expectFail("formal-source-fallback", formalSourceFallback),
    expectFail("synthetic-undisclosed", syntheticUndisclosed, "rows"),
    expectFail("empty-result-overwrites-previous-good", emptyOverwrite),
    expectFail("source-not-ready-unattended-yes", sourceNotReadyFakeYes),
  ];
  for (const result of mutationResults) {
    if (!result.failedAsExpected) issues.push(`mutation_${result.name}_did_not_fail`);
  }

  const allowedTvDiagnosticResult = verifyStrategy3PrewaterPayload(allowedTvDiagnosticFallback, { label: "allowed_tv_diagnostic_fallback" });
  const formalSourceBlockedResult = verifyStrategy3PrewaterPayload(formalSourceFallbackBlocked, { label: "formal_source_fallback_blocked", expectBlocked: true });
  const fallbackSplitResults = [
    {
      name: "allowed_tv_diagnostic_fallback",
      rawOk: allowedTvDiagnosticResult.ok,
      issues: allowedTvDiagnosticResult.issues,
      publishAllowed: allowedTvDiagnosticFallback.publishAllowed,
      latestOverwriteAllowed: allowedTvDiagnosticFallback.latestOverwriteAllowed,
      unattendedStatus: allowedTvDiagnosticFallback.unattendedStatus,
      preservePreviousGood: allowedTvDiagnosticFallback.preservePreviousGood,
      fallbackScope: allowedTvDiagnosticFallback.fallbackScope,
      diagnosticFallbackScope: allowedTvDiagnosticFallback.diagnosticFallbackScope,
      formalSourceFallbackUsed: allowedTvDiagnosticFallback.formalSourceFallbackUsed,
      diagnosticFallbackUsed: allowedTvDiagnosticFallback.diagnosticFallbackUsed,
    },
    {
      name: "formal_source_fallback",
      rawOk: formalSourceBlockedResult.ok,
      issues: formalSourceBlockedResult.issues,
      publishAllowed: formalSourceFallbackBlocked.publishAllowed,
      latestOverwriteAllowed: formalSourceFallbackBlocked.latestOverwriteAllowed,
      unattendedStatus: formalSourceFallbackBlocked.unattendedStatus,
      preservePreviousGood: formalSourceFallbackBlocked.preservePreviousGood,
      fallbackScope: formalSourceFallbackBlocked.fallbackScope,
      formalSourceFallbackUsed: formalSourceFallbackBlocked.formalSourceFallbackUsed,
      diagnosticFallbackUsed: formalSourceFallbackBlocked.diagnosticFallbackUsed,
    },
  ];
  if (allowedTvDiagnosticResult.ok !== true) issues.push(`allowed_tv_diagnostic_fallback_failed:${allowedTvDiagnosticResult.issues.join(",")}`);
  if (allowedTvDiagnosticFallback.formalSourceFallbackUsed !== false || !allowedTvDiagnosticFallback.diagnosticFallbackScope.includes("tv_candle_diagnostic")) {
    issues.push("allowed_tv_diagnostic_fallback_scope_invalid");
  }
  if (formalSourceFallbackBlocked.publishAllowed !== false || formalSourceFallbackBlocked.latestOverwriteAllowed !== false) issues.push("formal_source_fallback_not_blocking_latest");
  if (formalSourceFallbackBlocked.unattendedStatus !== "NO") issues.push("formal_source_fallback_unattendedStatus_not_NO");
  if (formalSourceFallbackBlocked.preservePreviousGood !== true) issues.push("formal_source_fallback_preservePreviousGood_not_true");
  if (!formalSourceBlockedResult.issues.includes("formal_source_fallback_not_allowed")) issues.push("formal_source_fallback_missing_fixed_issue_code");

  const negativeMutationsCovered = [
    "missing required business field",
    "missing decision gate",
    "missing source_snapshot_captured_at",
    "missing evidenceStatus explicit mutation",
    "missing ma20/ma35",
    "missing latestCandleTime",
    "quoteAgeSeconds over threshold",
    "intraday_1m_stale_seconds over threshold",
    "source not ready but unattendedStatus=YES",
    "source not ready but publishAllowed=true",
    "empty result overwrites previous good",
    "formal source fallback",
    "allowed tv diagnostic fallback split from formal source fallback",
    "synthetic undisclosed",
    "fallback display-only treated as formal result",
    "missing fallback disclosure",
    "missing writeBudget",
    "missing retentionOk",
    "missing blockedReason",
    "blankCounts missing key",
    "sampleMissingRows missing sample",
    "latest pointer updated when blocked",
  ];

  return {
    ok: issues.length === 0,
    formalPayloadLabels: ["scannerPayload", "writerRunPayload", "writerResultPayloads", "apiPayload", "blockedReceipt"],
    usesBusinessFieldMatrixFile: true,
    usesDecisionGateMatrixFile: true,
    usesSourceContractMatrix: true,
    decisionGateResult,
    sourceContractResult,
    rowAudits,
    prewaterResults,
    negativeMutationsCovered,
    mutationResults,
    fallbackSplitResults,
    blockedReceipt: receipt,
    issues,
  };
}

module.exports = {
  STRATEGY3_BUSINESS_FIELD_MATRIX,
  STRATEGY3_DECISION_GATE_MATRIX,
  STRATEGY3_SOURCE_CONTRACT_MATRIX,
  buildFormalPayloads,
  sampleStrategy3Output,
  verifyBusinessFieldMatrix,
  verifyDecisionGateMatrix,
  verifyFormalBusinessPayloads,
  verifySourceContractMatrix,
};
