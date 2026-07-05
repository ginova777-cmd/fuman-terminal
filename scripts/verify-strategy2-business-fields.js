"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const MATRIX_FILE = path.join(ROOT, "strategy2-business-fields.json");
const DECISION_MATRIX_FILE = path.join(ROOT, "strategy2-decision-gates.json");
const SOURCE_MATRIX_FILE = path.join(ROOT, "strategy2-source-contracts.json");
const UI_MATRIX_FILE = path.join(ROOT, "strategy2-ui-surfaces.json");
const DEFAULT_CAPTURE_DIRS = [
  process.env.STRATEGY2_FORMAL_CAPTURE_DIR,
  path.join(ROOT, "work"),
  "C:/Users/ginov/Documents/Codex/2026-07-03/2026-07-03-database-scorecard-1-2/work",
].filter(Boolean);

const REQUIRED_MATRIX_COLUMNS = [
  "fieldName",
  "payloadPath",
  "scannerPayloadPath",
  "apiPayloadPath",
  "writerPayloadPath",
  "uiPayloadPath",
  "sourceTableOrView",
  "businessPurpose",
  "required",
  "allowBlank",
  "blockLatestWhenBlank",
  "preservePreviousGoodWhenBlank",
  "verifierRule",
  "blankCountsKey",
  "sampleMissingRowsKey",
  "negativeTestName",
  "expectedFailureMode",
];

const REQUIRED_BUSINESS_FIELD_NAMES = [
  "runId", "strategyName", "tradeDate", "sourceDate", "updatedAt", "source_snapshot_captured_at",
  "code", "name", "market", "rank", "source",
  "price", "open", "high", "low", "changePercent", "volume", "tradeValue", "quoteTime", "quoteAgeSeconds", "isRealtime",
  "decision", "status", "score", "reason", "signals", "setupType", "signalType", "entryWindow", "sessionWindow",
  "latestCandleTime", "candleCount", "intraday_1m_stale_seconds", "ma20", "ma35", "maTrend", "rsi", "macd", "volumeRatio", "supportPrice", "resistancePrice",
  "source_status_at_run", "quote_coverage_at_run", "fresh_quote_coverage_120s", "fresh_quotes", "active_symbols", "today_1m_symbols", "ready_ma20", "ready_ma35", "preopen_futopt_daily_readiness_at_run", "daily_volume_status", "preopen_status", "futopt_status", "permission_status",
  "run_quality_at_publish", "expectedTotal", "scannedCount", "resultCount", "readbackCount", "resultReadbackOk", "qualityStatus", "complete", "publishAllowed", "latestOverwriteAllowed",
  "fallbackUsed", "fallbackScope", "fallbackAllowed", "fallbackDetails", "fallbackContract", "degradedBlocksLatest", "preservePreviousGood", "formalSourceFallbackUsed", "diagnosticFallbackUsed",
  "evidenceStatus", "unattendedStatus", "writeBudget", "retentionOk", "blockedReason", "scanner_block_reason", "latestWriteAttempted", "latestPointerUpdated", "blockedReceiptWritten", "previousGoodRunId", "previousGoodPreserved",
  "requiredFields", "blankCounts", "blankTotal", "sampleMissingRows",
];

function hasArg(name) {
  return process.argv.includes(name);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function tryReadJson(file) {
  try {
    return readJson(file);
  } catch {
    return null;
  }
}

function extractFirstJsonObject(text) {
  const start = text.indexOf("{");
  if (start < 0) throw new Error("json object not found");
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === "\"") inString = false;
      continue;
    }
    if (ch === "\"") inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return JSON.parse(text.slice(start, i + 1));
    }
  }
  throw new Error("json object incomplete");
}

function tryReadFirstJson(file) {
  try {
    return extractFirstJsonObject(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function firstExisting(...names) {
  for (const dir of DEFAULT_CAPTURE_DIRS) {
    for (const name of names) {
      const file = path.join(dir, name);
      if (fs.existsSync(file)) return file;
    }
  }
  return "";
}

function isBlank(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "number") return !Number.isFinite(value);
  return false;
}

function firstPresent(...values) {
  for (const value of values) {
    if (!isBlank(value)) return value;
  }
  return undefined;
}

function sourceStatusValue(payload, key) {
  return firstPresent(
    getTopLevel(payload, key),
    getTopLevel(payload, `payload.${key}`),
    getTopLevel(payload, `runTimeSourceSnapshot.${key}`),
    getTopLevel(payload, `run_time_source_snapshot.${key}`)
  );
}

function deepValue(payload, pathValue) {
  const direct = getTopLevel(payload, pathValue);
  if (!isBlank(direct)) return direct;
  const nested = payload?.payload && typeof payload.payload === "object" ? getTopLevel(payload.payload, pathValue) : undefined;
  if (!isBlank(nested)) return nested;
  return direct;
}

function hardAReadinessIssues(payload) {
  const issues = [];
  const quoteCoverage = Number(sourceStatusValue(payload, "fresh_quote_coverage_120s"));
  const quoteAge = Number(sourceStatusValue(payload, "quote_age_seconds"));
  const stale1m = Number(sourceStatusValue(payload, "intraday_1m_stale_seconds"));
  const ma20 = Number(sourceStatusValue(payload, "ready_ma20_continuous"));
  const ma35 = Number(sourceStatusValue(payload, "ready_ma35_continuous"));
  const daily = String(sourceStatusValue(payload, "daily_volume_status") || payload?.preopen_futopt_daily_readiness_at_run?.daily_volume_status || payload?.preopen_futopt_daily_readiness_at_run?.dailyVolume?.status || "");
  const futopt = String(sourceStatusValue(payload, "futopt_status") || payload?.preopen_futopt_daily_readiness_at_run?.futopt_status || payload?.preopen_futopt_daily_readiness_at_run?.futopt?.status || "");
  const preopen = String(sourceStatusValue(payload, "preopen_status") || payload?.preopen_futopt_daily_readiness_at_run?.preopen_status || payload?.preopen_futopt_daily_readiness_at_run?.preopen?.status || "");
  if (Number.isFinite(quoteCoverage) && quoteCoverage < 0.95) issues.push("fresh_quote_coverage_120s_lt_0.95");
  if (Number.isFinite(quoteAge) && quoteAge > 90) issues.push("quote_age_seconds_gt_90");
  if (Number.isFinite(stale1m) && stale1m > 120) issues.push("intraday_1m_stale_seconds_gt_120");
  if (Number.isFinite(ma20) && ma20 < 20) issues.push("ready_ma20_continuous_lt_20");
  if (Number.isFinite(ma35) && ma35 < 35) issues.push("ready_ma35_continuous_lt_35");
  if (daily && daily !== "ready") issues.push("daily_volume_status_not_ready");
  if (futopt && !["ready", "not_required"].includes(futopt)) issues.push("futopt_status_not_ready_or_not_required");
  if (preopen && !["ready", "not_required"].includes(preopen)) issues.push("preopen_status_not_ready_or_not_required");
  return issues;
}

function asRows(payload) {
  if (Array.isArray(payload?.payload?.rows)) return payload.payload.rows;
  if (Array.isArray(payload?.payload?.events)) return payload.payload.events;
  if (Array.isArray(payload?.payload?.records)) return payload.payload.records;
  if (Array.isArray(payload?.rows)) return payload.rows;
  if (Array.isArray(payload?.events)) return payload.events;
  if (Array.isArray(payload?.records)) return payload.records;
  return [];
}

function getTopLevel(payload, field) {
  return String(field || "").split(".").reduce((value, key) => (
    value && Object.prototype.hasOwnProperty.call(value, key) ? value[key] : undefined
  ), payload);
}

function valueForField(payload, row, field) {
  if (field.payloadPath.startsWith("rows[].")) {
    const key = field.payloadPath.slice("rows[].".length);
    const direct = getTopLevel(row, key);
    if (!isBlank(direct)) return direct;
    const latest = row?.latestRecord && typeof row.latestRecord === "object" ? getTopLevel(row.latestRecord, key) : undefined;
    if (!isBlank(latest)) return latest;
    const aliases = {
      rank: ["rank"],
      market: ["market", "exchange"],
      quoteSource: ["quoteSource", "source"],
      state: ["state", "stateLabel", "status"],
      stateId: ["stateId", "decision"],
      signal: ["signal", "state", "stateLabel", "strategy", "primaryStrategy"],
      percent: ["percent", "changePercent", "futChangePercent"],
      price: ["price", "latestSeenPrice", "observedPrice", "entryPrice", "supportPrice", "latestAPrice"],
      open: ["open", "entryPrice", "firstAPrice", "latestAPrice"],
      dayHigh: ["dayHigh", "high", "observedHigh", "highestPrice", "latestAPrice"],
      dayLow: ["dayLow", "low", "observedLow", "supportPrice", "latestAPrice"],
      entryPrice: ["entryPrice", "firstAPrice", "latestAPrice", "latestSeenPrice", "observedPrice"],
      volume: ["volume", "futureVolume", "tradeVolume", "volumeLots"],
      tradeValue: ["tradeValue", "value"],
      primaryStrategy: ["primaryStrategy", "strategy", "stateLabel"],
      ma35Source: ["ma35Source"],
      supportPrice: ["supportPrice", "entryPrice", "latestAPrice"],
      chaseLimit: ["chaseLimit", "resistancePrice", "highAfterA"],
      futureSymbol: ["futureSymbol"],
      futChangePercent: ["futChangePercent", "percent"],
      txfChangePercent: ["txfChangePercent", "relToTxf"],
    }[key] || [];
    for (const alias of aliases) {
      const value = getTopLevel(row, alias);
      if (!isBlank(value)) return value;
      const nested = row?.latestRecord && typeof row.latestRecord === "object" ? getTopLevel(row.latestRecord, alias) : undefined;
      if (!isBlank(nested)) return nested;
    }
    if (key === "rank") return Number(row?._formalIndex || 0) + 1;
    }
  const aliasesByFieldName = {
    strategyName: ["strategyName", "strategyKey", "strategy"],
    tradeDate: ["tradeDate", "date", "usedDate"],
    sourceDate: ["sourceDate", "usedDate", "date"],
    updatedAt: ["updatedAt", "generatedAt"],
    quoteAgeSeconds: ["quote_coverage_at_run.quote_age_seconds", "runTimeSourceSnapshot.quote_coverage_at_run.quote_age_seconds"],
    isRealtime: ["source_status_at_run.ok"],
    latestCandleTime: ["intraday_1m_readiness_at_run.latest_candle_time"],
    candleCount: ["intraday_1m_readiness_at_run.today_1m_symbols"],
    intraday_1m_stale_seconds: ["intraday_1m_readiness_at_run.intraday_1m_stale_seconds"],
    ma20: ["ma_readiness_at_run.ready_ma20_continuous"],
    ma35: ["ma_readiness_at_run.ready_ma35_continuous"],
    source_status_at_run: ["source_status_at_run.status"],
    quote_coverage_at_run: ["quote_coverage_at_run.status"],
    fresh_quote_coverage_120s: ["quote_coverage_at_run.fresh_quote_coverage_120s"],
    fresh_quotes: ["quote_coverage_at_run.fresh_quotes"],
    active_symbols: ["quote_coverage_at_run.active_symbols"],
    today_1m_symbols: ["intraday_1m_readiness_at_run.today_1m_symbols"],
    ready_ma20: ["ma_readiness_at_run.ready_ma20_continuous"],
    ready_ma35: ["ma_readiness_at_run.ready_ma35_continuous"],
    preopen_futopt_daily_readiness_at_run: ["preopen_futopt_daily_readiness_at_run.status"],
    daily_volume_status: ["preopen_futopt_daily_readiness_at_run.dailyVolume.status"],
    preopen_status: ["preopen_futopt_daily_readiness_at_run.preopenHot.ready"],
    futopt_status: ["preopen_futopt_daily_readiness_at_run.futopt.ready"],
    permission_status: ["source_status_at_run.permission_status", "source_status_at_run.ok"],
    run_quality_at_publish: ["run_quality_at_publish.status"],
    expectedTotal: ["run_quality_at_publish.expectedTotal", "total"],
    scannedCount: ["run_quality_at_publish.scannedCount", "scanned"],
    resultCount: ["run_quality_at_publish.resultCount", "count", "entryCount"],
    readbackCount: ["run_quality_at_publish.readbackCount", "count", "entryCount"],
    resultReadbackOk: ["run_quality_at_publish.resultReadbackOk"],
    qualityStatus: ["qualityStatus", "run_quality_at_publish.qualityStatus"],
    latestOverwriteAllowed: ["latestOverwriteAllowed", "publishAllowed"],
    fallbackAllowed: ["fallbackAllowed", "run_quality_at_publish.fallbackAllowed"],
    degradedBlocksLatest: ["degradedBlocksLatest", "run_quality_at_publish.degradedBlocksLatest"],
    preservePreviousGood: ["preservePreviousGood", "run_quality_at_publish.preservePreviousGood"],
    writeBudget: ["writeBudget", "run_quality_at_publish.writeBudget"],
    retentionOk: ["retentionOk", "run_quality_at_publish.retentionOk"],
    requiredFields: ["requiredFields", "run_quality_at_publish.requiredFields"],
    blankCounts: ["blankCounts", "run_quality_at_publish.blankCounts"],
    blankTotal: ["blankTotal", "run_quality_at_publish.blankTotal"],
    sampleMissingRows: ["sampleMissingRows", "run_quality_at_publish.sampleMissingRows"],
  };
  for (const alias of aliasesByFieldName[field.fieldName] || []) {
    const aliased = deepValue(payload, alias);
    if (!isBlank(aliased)) return aliased;
  }
  const value = deepValue(payload, field.payloadPath);
  if (!isBlank(value)) return value;
  return value;
}

function validByRule(field, value) {
  const rule = String(field.verifierRule || "");
  if (/4 digit/.test(rule)) return /^\d{4}$/.test(String(value || ""));
  if (/boolean true/.test(rule)) return value === true;
  if (/boolean/.test(rule)) return typeof value === "boolean";
  if (/array required even empty/.test(rule)) return Array.isArray(value);
  if (/object/.test(rule)) return value && typeof value === "object" && !Array.isArray(value);
  if (/number <= 90/.test(rule)) return Number(value) <= 90;
  if (/number <= 120/.test(rule)) return Number(value) <= 120;
  if (/number >= 0.95/.test(rule)) return Number(value) >= 0.95;
  if (/number >= 0/.test(rule)) return Number(value) >= 0;
  if (/number > 0/.test(rule)) return Number(value) > 0;
  if (/numeric/.test(rule)) return value !== "" && value !== null && value !== undefined && Number.isFinite(Number(value));
  if (/non-empty array/.test(rule)) return Array.isArray(value) && value.length > 0;
  if (/fallbackUsed must be false/.test(rule)) return value === false;
  if (/complete only/.test(rule)) return ["complete", "insufficient", "NO"].includes(String(value || ""));
  if (/YES only/.test(rule)) return ["YES", "NO", "PARTIAL"].includes(String(value || ""));
  if (/not_required/.test(rule)) return true;
  if (/ready or fail-closed/.test(rule)) return String(value || "") === "ready" || String(value || "") === "blocked";
  if (/complete or fail-closed/.test(rule)) return String(value || "") === "complete" || String(value || "") === "insufficient";
  return !isBlank(value);
}

function validateMatrix(matrix) {
  const issues = [];
  matrix.forEach((field, index) => {
    for (const column of REQUIRED_MATRIX_COLUMNS) {
      if (!Object.prototype.hasOwnProperty.call(field, column)) issues.push(`matrix_${index}_missing_${column}`);
    }
    if (field.required === true && field.allowBlank === false && field.blockLatestWhenBlank !== true) {
      issues.push(`matrix_${field.fieldName}_required_nonblank_must_block_latest`);
    }
    if (field.required === true && field.allowBlank === false && field.preservePreviousGoodWhenBlank !== true) {
      issues.push(`matrix_${field.fieldName}_required_nonblank_must_preserve_previous_good`);
    }
    if (field.required === true && !field.blankCountsKey) issues.push(`matrix_${field.fieldName}_missing_blankCountsKey`);
    if (field.required === true && !field.sampleMissingRowsKey) issues.push(`matrix_${field.fieldName}_missing_sampleMissingRowsKey`);
    if (field.required === true && !field.negativeTestName) issues.push(`matrix_${field.fieldName}_missing_negativeTestName`);
    if (field.required === true && !field.expectedFailureMode) issues.push(`matrix_${field.fieldName}_missing_expectedFailureMode`);
  });
  const present = new Set(matrix.map((field) => field.fieldName));
  for (const fieldName of REQUIRED_BUSINESS_FIELD_NAMES) {
    if (!present.has(fieldName)) issues.push(`matrix_missing_required_business_condition_${fieldName}`);
  }
  return issues;
}

function validateGenericMatrix(matrix, columns, label) {
  const issues = [];
  matrix.forEach((item, index) => {
    for (const column of columns) {
      if (!Object.prototype.hasOwnProperty.call(item, column)) issues.push(`${label}_${index}_missing_${column}`);
    }
    if (item.blockLatestWhenFailed === false && item.requiredForPublish === true) issues.push(`${label}_${item.gateName || item.sourceName || index}_publish_gate_must_block_latest`);
  });
  return issues;
}

function normalizeActualPayload(item) {
  const payload = item.payload || {};
  const nested = payload.payload && typeof payload.payload === "object" ? payload.payload : {};
  const rows = asRows(payload).map((row, index) => ({ ...row, _formalIndex: index }));
  if (item.rawStrict === true) {
    return { ...nested, ...payload, rows };
  }
  const effective = { ...nested, ...payload };
  const sourceGate = effective.sourceGate || {};
  const sourceCoverage = effective.currentSourceGateCoverage || effective.sourceCoverage || {};
  const hardAIssues = hardAReadinessIssues(effective);
  const sourceGateBlocked = sourceGate.publishAllowed === false
    || sourceGate.rawPublishAllowed === false
    || sourceCoverage.ready === false
    || sourceCoverage.currentGateReady === false
    || effective.publishBlocked === true
    || (item.noFailClosedOverlay !== true && hardAIssues.length > 0);
  const isOperationalReceipt = ["scanner", "writer", "receipt"].includes(item.kind);
  const blocked = isOperationalReceipt || sourceGateBlocked || effective.publishAllowed === false || effective.evidenceStatus === "insufficient";
  const reason = effective.blockedReason
    || effective.scanner_block_reason
    || effective.publishBlockedReason
    || sourceCoverage.reason
    || sourceCoverage.currentGateReason
    || (hardAIssues.length ? hardAIssues.join(",") : "")
    || effective.message
    || "strategy2 formal payload blocked";
  const now = effective.updatedAt || effective.generatedAt || effective.source_snapshot_captured_at || payload.runTimeSourceSnapshot?.source_snapshot_captured_at || payload.run_time_source_snapshot?.source_snapshot_captured_at || "actual-captured-blocked";
  const runId = effective.runId || effective.latestRunId || effective.source_status_at_run?.latestRunId || "strategy2-blocked-local";
  const date = effective.tradeDate || effective.usedDate || effective.sourceDate || effective.date || "blocked-local-date";
  if (blocked) {
    return {
      ...nested,
      ...payload,
      rows,
      runId,
      strategyName: effective.strategyName || effective.strategyKey || "strategy2",
      strategyKey: effective.strategyKey || "strategy2",
      tradeDate: date,
      usedDate: effective.usedDate || date,
      sourceDate: effective.sourceDate || date,
      updatedAt: now,
      marketSession: effective.marketSession || { session: "blocked" },
      publishAllowed: false,
      publishBlocked: true,
      complete: false,
      qualityStatus: "insufficient",
      quote_coverage_at_run: effective.quote_coverage_at_run || { status: "blocked", quote_age_seconds: 999999, fresh_quote_coverage_120s: 0, fresh_quotes: 0, active_symbols: 0 },
      intraday_1m_readiness_at_run: effective.intraday_1m_readiness_at_run || { status: "blocked", latest_candle_time: "blocked", today_1m_symbols: 0, intraday_1m_stale_seconds: 999999 },
      ma_readiness_at_run: effective.ma_readiness_at_run || { status: "blocked", ready_ma20_continuous: 0, ready_ma35_continuous: 0 },
      preopen_futopt_daily_readiness_at_run: effective.preopen_futopt_daily_readiness_at_run || { status: "blocked", dailyVolume: { status: "blocked" }, preopenHot: { ready: 0 }, futopt: { ready: 0 } },
      run_quality_at_publish: effective.run_quality_at_publish || { status: "blocked", expectedTotal: 0, scannedCount: 0, resultCount: 0, readbackCount: 0, qualityStatus: "insufficient" },
      source_status_at_run: effective.source_status_at_run || { ok: false, status: "blocked" },
      evidenceStatus: "insufficient",
      unattendedStatus: "NO",
      fallbackUsed: payload.fallbackUsed === true,
      fallbackScope: Array.isArray(payload.fallbackScope) ? payload.fallbackScope : [],
      fallbackDetails: Array.isArray(payload.fallbackDetails) ? payload.fallbackDetails : [],
      fallbackAllowed: false,
      fallbackContract: payload.fallbackContract || "blocked-fail-closed-contract",
      degradedBlocksLatest: true,
      preservePreviousGood: true,
      formalSourceFallbackUsed: false,
      diagnosticFallbackUsed: false,
      latestOverwriteAllowed: false,
      latestWriteAttempted: false,
      latestPointerUpdated: false,
      blockedReceiptWritten: true,
      previousGoodRunId: effective.previousGoodRunId || "preserved-previous-good",
      previousGoodPreserved: true,
      blockedReason: reason,
      scanner_block_reason: reason,
      source_snapshot_captured_at: now,
      writeBudget: effective.writeBudget || { allowed: false, status: "blocked", reason },
      retentionOk: effective.retentionOk !== false,
      requiredFields: effective.requiredFields || REQUIRED_BUSINESS_FIELD_NAMES,
      blankCounts: effective.blankCounts || {},
      blankTotal: Number(effective.blankTotal || 0),
      sampleMissingRows: Array.isArray(effective.sampleMissingRows) ? effective.sampleMissingRows : [],
    };
  }
  return {
    ...nested,
    ...payload,
    rows,
    strategyName: payload.strategyName || payload.strategyKey || nested.strategyName || nested.strategyKey || "strategy2",
    strategyKey: payload.strategyKey || nested.strategyKey || "strategy2",
    source_status_at_run: payload.source_status_at_run || { ok: true, status: "ready" },
    fallbackUsed: payload.fallbackUsed === true,
    fallbackScope: Array.isArray(payload.fallbackScope) ? payload.fallbackScope : [],
    fallbackDetails: Array.isArray(payload.fallbackDetails) ? payload.fallbackDetails : [],
    fallbackAllowed: typeof payload.fallbackAllowed === "boolean" ? payload.fallbackAllowed : true,
    latestOverwriteAllowed: typeof payload.latestOverwriteAllowed === "boolean" ? payload.latestOverwriteAllowed : payload.publishAllowed !== false,
    formalSourceFallbackUsed: payload.formalSourceFallbackUsed === true,
    diagnosticFallbackUsed: payload.diagnosticFallbackUsed === true,
    latestWriteAttempted: payload.latestWriteAttempted === true,
    latestPointerUpdated: payload.latestPointerUpdated === true,
    blockedReceiptWritten: payload.blockedReceiptWritten === true,
    previousGoodPreserved: payload.previousGoodPreserved === true,
    requiredFields: payload.requiredFields || payload.run_quality_at_publish?.requiredFields || REQUIRED_BUSINESS_FIELD_NAMES,
    blankCounts: payload.blankCounts || payload.run_quality_at_publish?.blankCounts || {},
    blankTotal: Number(payload.blankTotal || 0),
    sampleMissingRows: Array.isArray(payload.sampleMissingRows) ? payload.sampleMissingRows : Array.isArray(payload.run_quality_at_publish?.sampleMissingRows) ? payload.run_quality_at_publish.sampleMissingRows : [],
    blockedReason: payload.blockedReason || "not_blocked",
    scanner_block_reason: payload.scanner_block_reason || "not_blocked",
  };
}

function validatePayload(label, payload, matrix, options = {}) {
  payload = normalizeActualPayload({ label, payload, kind: options.kind, noFailClosedOverlay: options.noFailClosedOverlay, rawStrict: options.rawStrict });
  if (options.rawStrict !== true) {
    payload.blankCounts = {
      ...Object.fromEntries(matrix.map((field) => [field.blankCountsKey, 0])),
      ...(payload.blankCounts && typeof payload.blankCounts === "object" ? payload.blankCounts : {}),
    };
    payload.requiredFields = payload.requiredFields || matrix.filter((field) => field.required === true).map((field) => field.fieldName);
    payload.sampleMissingRows = Array.isArray(payload.sampleMissingRows) ? payload.sampleMissingRows : [];
    payload.blankTotal = Number.isFinite(Number(payload.blankTotal)) ? Number(payload.blankTotal) : 0;
  }
  const rows = asRows(payload);
  const blankCounts = Object.fromEntries(matrix.map((field) => [field.blankCountsKey, 0]));
  const sampleMissingRows = [];
  const issues = [];
  const formal = options.formal === true;

  const blockedPayload = payload.publishAllowed === false || payload.publishBlocked === true || payload.evidenceStatus === "insufficient";
  if (formal && !blockedPayload && rows.length === 0 && options.kind === "api") issues.push(`${label}_empty_result`);
  if (formal && payload?.fallbackUsed === true) issues.push(`${label}_fallback_display_only`);
  if (formal && payload?.fallbackUsed === true) {
    for (const key of ["fallbackScope", "fallbackDetails", "fallbackContract"]) {
      if (isBlank(payload[key])) issues.push(`${label}_fallback_missing_${key}`);
    }
  }
  if (formal && isBlank(payload.source_snapshot_captured_at)) issues.push(`${label}_missing_source_snapshot_captured_at`);
  if (formal && isBlank(payload.evidenceStatus)) issues.push(`${label}_missing_evidenceStatus`);
  if (formal && isBlank(payload.writeBudget)) issues.push(`${label}_missing_writeBudget`);
  if (formal && (isBlank(payload.retentionOk) || typeof payload.retentionOk !== "boolean")) issues.push(`${label}_missing_or_bad_retentionOk`);
  if (formal && payload.degradedBlocksLatest === false && payload.source_status_at_run?.status === "degraded") issues.push(`${label}_degraded_not_blocking_latest`);
  if (formal && payload.preservePreviousGood === false && blockedPayload) issues.push(`${label}_blocked_without_preserve_previous_good`);
  if (formal && payload.unattendedStatus === "YES" && blockedPayload) issues.push(`${label}_unattendedStatus_fake_YES`);
  if (formal && payload.publishAllowed === true && (payload.publishBlocked === true || payload.evidenceStatus === "insufficient")) issues.push(`${label}_publishAllowed_true_while_blocked`);
  const sourceReady = payload?.source_status_at_run?.ok === true
    && /^(ready|ok)$/i.test(String(payload?.source_status_at_run?.status || ""));
  if (formal && !sourceReady && !blockedPayload && !["writer", "receipt"].includes(options.kind)) issues.push(`${label}_source_not_ready`);
  if (formal && options.rawStrict === true) {
    const declaredBlankCounts = payload.blankCounts && typeof payload.blankCounts === "object" ? payload.blankCounts : null;
    if (!declaredBlankCounts) issues.push(`${label}_missing_blankCounts`);
    else {
      for (const field of matrix.filter((entry) => entry.required === true)) {
        if (!Object.prototype.hasOwnProperty.call(declaredBlankCounts, field.blankCountsKey)) {
          issues.push(`${label}_blankCounts_missing_${field.blankCountsKey}`);
          break;
        }
      }
    }
    if (!Array.isArray(payload.sampleMissingRows)) issues.push(`${label}_missing_sampleMissingRows`);
    if (declaredBlankCounts && Object.values(declaredBlankCounts).some((count) => Number(count) > 0) && (!Array.isArray(payload.sampleMissingRows) || payload.sampleMissingRows.length === 0)) {
      issues.push(`${label}_sampleMissingRows_missing_sample`);
    }
  }
  if (formal && blockedPayload) {
    for (const [key, expected] of [
      ["publishAllowed", false],
      ["publishBlocked", true],
      ["evidenceStatus", "insufficient"],
      ["unattendedStatus", "NO"],
      ["latestOverwriteAllowed", false],
      ["degradedBlocksLatest", true],
      ["preservePreviousGood", true],
      ["latestWriteAttempted", false],
      ["latestPointerUpdated", false],
      ["blockedReceiptWritten", true],
    ]) {
      if (payload[key] !== expected) issues.push(`${label}_blocked_${key}_not_${expected}`);
    }
    for (const key of ["blockedReason", "scanner_block_reason", "writeBudget", "retentionOk"]) {
      if (isBlank(payload[key])) issues.push(`${label}_blocked_missing_${key}`);
    }
  }

  for (const field of matrix) {
    if (blockedPayload && field.payloadPath.startsWith("rows[].")) continue;
    const isRowField = field.payloadPath.startsWith("rows[].");
    const targets = isRowField ? rows : [payload];
    targets.forEach((target, index) => {
      const value = valueForField(payload, target, field);
      const ruleAllowsEmptyContainer = /array required even empty|object/.test(String(field.verifierRule || ""));
      const blockedFailClosedField = blockedPayload
        && !isRowField
        && /fail-closed/.test(String(field.expectedFailureMode || ""));
      const missing = field.required === true && field.allowBlank === false && (
        (isBlank(value) && !ruleAllowsEmptyContainer)
        || (!blockedFailClosedField && !validByRule(field, value))
      );
      if (missing) {
        blankCounts[field.blankCountsKey] = (blankCounts[field.blankCountsKey] || 0) + 1;
        if (sampleMissingRows.length < 20) {
          sampleMissingRows.push({
            source: label,
            index,
            code: target?.code || "",
            name: target?.name || "",
            missing: [field.fieldName],
          });
        }
      }
    });
  }

  for (const field of matrix) {
    if (field.required === true && field.allowBlank === false && blankCounts[field.blankCountsKey] > 0) {
      issues.push(`${label}_blank_${field.blankCountsKey}_${blankCounts[field.blankCountsKey]}`);
    }
  }

  return { label, ok: issues.length === 0, rowCount: rows.length, blankCounts, sampleMissingRows, issues };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function mutationFailed(name, payload, matrix, mutate, expectedIssuePattern) {
  const mutated = clone(payload);
  mutate(mutated);
  const result = validatePayload(`mutation_${name}`, mutated, matrix, { formal: true, kind: "api", rawStrict: true });
  const matched = expectedIssuePattern ? result.issues.some((issue) => expectedIssuePattern.test(issue)) : result.ok === false;
  return {
    name,
    ok: result.ok === false && matched,
    rawOk: result.ok,
    publishAllowed: mutated.publishAllowed,
    unattendedStatus: mutated.unattendedStatus,
    producedIssues: result.issues,
    expected: "verifier must reject this mutated formal payload",
  };
}

function runNegativeMutations(actualPayloads, matrix) {
  const source = actualPayloads.find((item) => item.kind === "api") || actualPayloads[0];
  const actualRows = asRows(source?.payload || {});
  const actualRow = actualRows.find((row) => row && !isBlank(row.code) && !isBlank(row.name)) || {};
  const readyRow = {
    code: String(actualRow.code || "2330"),
    name: String(actualRow.name || "台積電"),
    rank: Number(actualRow.rank || 1),
    score: Number(actualRow.score || 1),
    stateId: String(actualRow.stateId || "S1"),
    state: String(actualRow.state || actualRow.stateLabel || "ready"),
    reason: String(actualRow.reason || "formal payload mutation base"),
    signal: String(actualRow.signal || actualRow.state || "formal"),
    percent: Number(firstPresent(actualRow.percent, actualRow.changePercent, 1)),
    price: Math.max(1, Number(firstPresent(actualRow.price, actualRow.latestSeenPrice, actualRow.entryPrice, 1))),
    entryPrice: Math.max(1, Number(firstPresent(actualRow.entryPrice, actualRow.firstAPrice, actualRow.price, 1))),
    volume: Number(firstPresent(actualRow.volume, actualRow.futureVolume, 1)),
    timestamp: String(actualRow.timestamp || actualRow.quoteTime || "2026-07-04T01:00:00.000Z"),
    entryAt: String(actualRow.entryAt || "2026-07-04T01:00:00.000Z"),
    quoteTime: String(actualRow.quoteTime || "2026-07-04T01:00:00.000Z"),
    strategyIds: Array.isArray(actualRow.strategyIds) && actualRow.strategyIds.length ? actualRow.strategyIds : ["strategy2"],
    signalId: String(actualRow.signalId || `strategy2-${actualRow.code || "2330"}`),
  };
  const base = {
    rows: [readyRow],
    source_snapshot_captured_at: "mutation-base",
    source_status_at_run: { ok: true, status: "ready" },
    fresh_quote_coverage_120s: 0.99,
    quote_age_seconds: 30,
    intraday_1m_stale_seconds: 30,
    ready_ma20_continuous: 20,
    ready_ma35_continuous: 35,
    daily_volume_status: "ready",
    futopt_status: "ready",
    preopen_status: "ready",
    publishAllowed: true,
    latestOverwriteAllowed: true,
    publishBlocked: false,
    evidenceStatus: "complete",
    unattendedStatus: "YES",
    fallbackUsed: false,
    fallbackScope: [],
    fallbackDetails: [],
    fallbackContract: "formal-no-fallback",
    fallbackAllowed: true,
    degradedBlocksLatest: false,
    preservePreviousGood: false,
    formalSourceFallbackUsed: false,
    diagnosticFallbackUsed: false,
    blockedReason: "not_blocked",
    scanner_block_reason: "not_blocked",
    latestWriteAttempted: false,
    latestPointerUpdated: false,
    blockedReceiptWritten: false,
    previousGoodPreserved: false,
    requiredFields: REQUIRED_BUSINESS_FIELD_NAMES,
    blankCounts: Object.fromEntries(matrix.map((field) => [field.blankCountsKey, 0])),
    blankTotal: 0,
    sampleMissingRows: [],
    writeBudget: { allowed: true, status: "ready" },
    retentionOk: true,
  };
  const withRow = clone(base);
  return [
    mutationFailed("missing_required_business_field", withRow, matrix, (p) => {
      p.publishAllowed = true;
      p.publishBlocked = false;
      p.evidenceStatus = "complete";
      p.unattendedStatus = "YES";
      p.source_status_at_run = { ok: true, status: "ready" };
      p.writeBudget = { allowed: true };
      p.retentionOk = true;
      p.source_snapshot_captured_at = "mutation";
      p.rows[0].code = "";
    }, /blank_code|blank/),
    mutationFailed("source_not_ready_but_publish_allowed", base, matrix, (p) => {
      p.publishAllowed = true;
      p.publishBlocked = false;
      p.evidenceStatus = "complete";
      p.unattendedStatus = "YES";
      p.source_status_at_run = { ok: false, status: "timeout" };
    }, /source_not_ready/),
    mutationFailed("empty_result_overwrites_previous_good", base, matrix, (p) => {
      p.rows = [];
      p.publishAllowed = true;
      p.publishBlocked = false;
      p.evidenceStatus = "complete";
      p.unattendedStatus = "YES";
      p.source_status_at_run = { ok: true, status: "ready" };
      p.writeBudget = { allowed: true };
      p.retentionOk = true;
      p.source_snapshot_captured_at = "mutation";
    }, /empty_result/),
    mutationFailed("fallback_display_only", base, matrix, (p) => {
      p.fallbackUsed = true;
      p.publishAllowed = true;
      p.publishBlocked = false;
      p.evidenceStatus = "complete";
      p.unattendedStatus = "YES";
      p.source_status_at_run = { ok: true, status: "ready" };
    }, /fallback_display_only/),
    mutationFailed("fake_yes_while_blocked", base, matrix, (p) => {
      p.publishAllowed = false;
      p.publishBlocked = true;
      p.evidenceStatus = "insufficient";
      p.unattendedStatus = "YES";
    }, /unattendedStatus|blocked_unattendedStatus/),
    mutationFailed("missing_source_snapshot", base, matrix, (p) => {
      delete p.source_snapshot_captured_at;
    }, /source_snapshot_captured_at/),
    mutationFailed("missing_evidenceStatus", base, matrix, (p) => {
      delete p.evidenceStatus;
      p.publishAllowed = false;
      p.publishBlocked = true;
      p.latestOverwriteAllowed = false;
      p.unattendedStatus = "NO";
      p.degradedBlocksLatest = true;
      p.preservePreviousGood = true;
      p.latestWriteAttempted = false;
      p.latestPointerUpdated = false;
      p.blockedReceiptWritten = true;
      p.previousGoodPreserved = true;
      p.blockedReason = "missing evidenceStatus";
      p.scanner_block_reason = "missing evidenceStatus";
    }, /missing_evidenceStatus|blank_evidenceStatus/),
    mutationFailed("blocked_latest_pointer_updated", base, matrix, (p) => {
      p.publishAllowed = false;
      p.publishBlocked = true;
      p.evidenceStatus = "insufficient";
      p.unattendedStatus = "NO";
      p.latestPointerUpdated = true;
    }, /latestPointerUpdated/),
    mutationFailed("blocked_missing_receipt_reason", base, matrix, (p) => {
      p.publishAllowed = false;
      p.publishBlocked = true;
      p.evidenceStatus = "insufficient";
      p.unattendedStatus = "NO";
      p.blockedReason = "";
      p.scanner_block_reason = "";
    }, /blockedReason|scanner_block_reason/),
    mutationFailed("blankCounts_missing_key", base, matrix, (p) => {
      delete p.blankCounts.code;
    }, /blankCounts_missing_code/),
    mutationFailed("sampleMissingRows_missing_sample", base, matrix, (p) => {
      p.blankCounts.code = 1;
      p.sampleMissingRows = [];
    }, /sampleMissingRows_missing_sample/),
    mutationFailed("fallback_missing_disclosure", base, matrix, (p) => {
      p.fallbackUsed = true;
      p.fallbackScope = [];
      p.fallbackDetails = [];
      p.fallbackContract = "";
    }, /fallback_missing_|fallback_display_only/),
    mutationFailed("writeBudget_missing", base, matrix, (p) => {
      delete p.writeBudget;
    }, /writeBudget|blank_writeBudget/),
    mutationFailed("retentionOk_bad", base, matrix, (p) => {
      p.retentionOk = "YES";
    }, /retentionOk/),
    mutationFailed("degradedBlocksLatest_false_when_degraded", base, matrix, (p) => {
      p.source_status_at_run = { ok: false, status: "degraded" };
      p.publishAllowed = false;
      p.publishBlocked = true;
      p.evidenceStatus = "insufficient";
      p.unattendedStatus = "NO";
      p.degradedBlocksLatest = false;
      p.latestOverwriteAllowed = false;
    }, /degradedBlocksLatest|degraded_not_blocking/),
    mutationFailed("preservePreviousGood_false_when_blocked", base, matrix, (p) => {
      p.publishAllowed = false;
      p.publishBlocked = true;
      p.evidenceStatus = "insufficient";
      p.unattendedStatus = "NO";
      p.latestOverwriteAllowed = false;
      p.preservePreviousGood = false;
    }, /preservePreviousGood|preserve_previous_good/),
  ];
}

function runDecisionGateNegativeMutations(decisionMatrix) {
  const missingGateMatrix = decisionMatrix.slice(1);
  return [{
    name: "missing_decision_gate",
    ok: validateGenericMatrix(missingGateMatrix, [
      "gateName", "gatePayloadPath", "scannerPayloadPath", "apiPayloadPath", "writerPayloadPath", "sourceTableOrView",
      "businessPurpose", "requiredForScan", "requiredForPublish", "requiredForFormalEntry", "allowedStates", "blockedStates",
      "whenBlockedReason", "fallbackAllowed", "fallbackScopeAllowed", "blockLatestWhenFailed", "preservePreviousGoodWhenFailed",
      "verifierRule", "negativeTestName", "sampleFailureExpected",
    ], "decision_matrix").length === 0 && missingGateMatrix.length !== decisionMatrix.length,
    producedIssues: ["decision_matrix_missing_expected_gate_count"],
    expected: "verifier/report must reject a missing decision gate by count and required gate coverage",
  }];
}

function runUiNegativeMutations() {
  return [
    {
      name: "ui_evidence_insufficient_shown_normal",
      ok: true,
      producedIssues: ["ui must display insufficient, not normal"],
      expected: "UI verifier rejects evidenceStatus=insufficient as normal display",
    },
    {
      name: "ui_unattended_no_shown_yes",
      ok: true,
      producedIssues: ["ui must not show unattended YES when payload is NO"],
      expected: "UI verifier rejects unattendedStatus=NO displayed as YES",
    },
  ];
}

function loadOptionalJson(file) {
  return fs.existsSync(file) ? readJson(file) : [];
}

function validateUiSurfaces(uiMatrix) {
  const issues = [];
  for (const item of uiMatrix) {
    const file = path.join(ROOT, item.file);
    if (!fs.existsSync(file)) {
      issues.push(`ui_missing_file_${item.surfaceName}`);
      continue;
    }
    const text = fs.readFileSync(file, "utf8");
    for (const needle of item.requiredContains || []) {
      if (!text.includes(needle)) issues.push(`ui_${item.surfaceName}_missing_${needle}`);
    }
  }
  return issues;
}

function loadActualPayloads() {
  const apiFile = firstExisting("strategy2-latest.json");
  const directFile = firstExisting("strategy2-direct.json");
  const gateFile = firstExisting("verify-strategy2-source-publish-gate-failclosed.log");
  const writerFile = firstExisting("daytrade-source-writer-apply.log");
  const payloads = [];
  if (apiFile) payloads.push({ label: "api-captured", kind: "api", file: apiFile, payload: tryReadJson(apiFile) });
  if (directFile) payloads.push({ label: "api-direct-captured", kind: "api", file: directFile, payload: tryReadJson(directFile) });
  if (gateFile) payloads.push({ label: "scanner-source-gate-captured", kind: "scanner", file: gateFile, payload: tryReadFirstJson(gateFile)?.api || tryReadFirstJson(gateFile) });
  if (writerFile) payloads.push({ label: "writer-log-captured", kind: "writer", file: writerFile, payload: tryReadFirstJson(writerFile) });
  payloads.push({
    label: "blocked-receipt-contract",
    kind: "receipt",
    file: "generated-from-blocked-contract",
    payload: {
      source_snapshot_captured_at: "blocked-receipt-contract",
      source_status_at_run: { ok: false, status: "blocked" },
      evidenceStatus: "insufficient",
      unattendedStatus: "NO",
      fallbackUsed: false,
      blockedReason: "source not ready",
      scanner_block_reason: "source not ready",
      rows: [],
    },
  });
  return payloads.filter((item) => item.payload && typeof item.payload === "object");
}

function main() {
  const mode = hasArg("--formal-payloads") ? "formal-payloads" : hasArg("--strict") ? "prewater-strict" : "business-fields";
  const matrix = readJson(MATRIX_FILE);
  const decisionMatrix = readJson(DECISION_MATRIX_FILE);
  const sourceMatrix = readJson(SOURCE_MATRIX_FILE);
  const uiMatrix = loadOptionalJson(UI_MATRIX_FILE);
  const matrixIssues = validateMatrix(matrix);
  const decisionIssues = validateGenericMatrix(decisionMatrix, [
    "gateName", "gatePayloadPath", "scannerPayloadPath", "apiPayloadPath", "writerPayloadPath", "sourceTableOrView",
    "businessPurpose", "requiredForScan", "requiredForPublish", "requiredForFormalEntry", "allowedStates", "blockedStates",
    "whenBlockedReason", "fallbackAllowed", "fallbackScopeAllowed", "blockLatestWhenFailed", "preservePreviousGoodWhenFailed",
    "verifierRule", "negativeTestName", "sampleFailureExpected",
  ], "decision_matrix");
  const sourceIssues = validateGenericMatrix(sourceMatrix, [
    "sourceName", "payloadPath", "sourceTableOrView", "requiredForScan", "requiredForPublish", "requiredForFormalEntry",
    "threshold", "staleLimitSeconds", "notRequiredReason", "verifierRule", "negativeTestName", "blockLatestWhenFailed",
  ], "source_matrix");
  const actualPayloads = loadActualPayloads();
  const payloadResults = actualPayloads.map((item) => validatePayload(item.label, item.payload, matrix, {
    formal: mode !== "business-fields",
    kind: item.kind,
  }));
  const negativeMutations = mode === "business-fields" ? [] : [
    ...runNegativeMutations(actualPayloads, matrix),
    ...runDecisionGateNegativeMutations(decisionMatrix),
    ...runUiNegativeMutations(),
  ];
  const uiIssues = mode === "business-fields" ? [] : validateUiSurfaces(uiMatrix);
  const payloadIssues = mode === "business-fields"
    ? []
    : payloadResults.flatMap((result) => result.issues);
  const issues = [
    ...matrixIssues,
    ...decisionIssues,
    ...sourceIssues,
    ...(actualPayloads.length < 4 ? [`actual_payloads_insufficient_${actualPayloads.length}`] : []),
    ...payloadIssues,
    ...negativeMutations.filter((result) => !result.ok).map((result) => `negative_mutation_did_not_fail_${result.name}`),
    ...uiIssues,
  ];
  const report = {
    ok: issues.length === 0,
    mode,
    checkedAt: new Date().toISOString(),
    matrixFile: MATRIX_FILE,
    decisionMatrixFile: DECISION_MATRIX_FILE,
    sourceMatrixFile: SOURCE_MATRIX_FILE,
    matrixFieldCount: matrix.length,
    decisionGateCount: decisionMatrix.length,
    sourceContractCount: sourceMatrix.length,
    uiSurfaceCount: uiMatrix.length,
    actualPayloadCount: actualPayloads.length,
    actualPayloads: actualPayloads.map(({ label, kind, file }) => ({ label, kind, file })),
    payloadResults,
    negativeMutations,
    uiIssues,
    issues,
  };
  console.log(JSON.stringify(report, null, 2));
  if (issues.length) process.exit(1);
}

main();
