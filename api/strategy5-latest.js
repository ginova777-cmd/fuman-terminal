const { withEntitlementRequired } = require("../lib/server-entitlement-guard");
const { buildMarketCalendarContract, installMarketCalendarResponse } = require("../lib/market-calendar-contract");
const fs = require("fs");
const path = require("path");
const { readEndpointFromDesktopSnapshot } = require("../lib/desktop-route-snapshot-cache");
const { runTimeSourceSnapshotResponseFields, wrapJsonRunTimeSourceEvidence } = require("../lib/run-time-source-snapshot-contract");
const { terminalSupabaseKey, terminalSupabaseUrl } = require("../lib/server-supabase-key");

function readSecretText(file) {
  try { return fs.readFileSync(file, "utf8").trim(); } catch { return ""; }
}

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const SUPABASE_URL = terminalSupabaseUrl({ runtimeDir: RUNTIME_DIR });
const SUPABASE_KEY = terminalSupabaseKey({ runtimeDir: RUNTIME_DIR });

const TABLE = process.env.STRATEGY5_SUPABASE_RESULTS_TABLE || "strategy5_scan_results";
const LATEST_RUN_VIEW = process.env.STRATEGY5_SUPABASE_LATEST_RUN_VIEW || "v_strategy5_latest_complete_run";
const COMPLETE_RUN_GATE = "complete-run-authoritative+result-readback";
const UNATTENDED_CONTRACT = "strategy5-unattended-api-20260630-01";
const MAX_CHIP_SOURCE_AGE_DAYS = Number(process.env.STRATEGY5_MAX_FINMIND_CHIP_AGE_DAYS || 3);
const WRITE_BUDGET_LIMIT_ROWS = Number(process.env.STRATEGY5_WRITE_BUDGET_LIMIT_ROWS || 3000);
const RAW_RETENTION_DAYS = Number(process.env.STRATEGY5_RAW_RETENTION_DAYS || 7);
const FORBIDDEN_UI_MATCH_IDS = new Set(["foreign_trust_breakout"]);
const STRATEGY5_UI_MATCH_META = {
  chip_k_confluence: { label: "籌碼共振", short: "籌碼共振" },
  multi_strategy_confluence: { label: "多策略共振", short: "共振" },
  volume_turnover_breakout: { label: "量價周轉強攻", short: "量價周轉" },
  bollinger_kdj_buy: { label: "布林隨機買點", short: "布林隨機" },
  momentum: { label: "動能分數達標", short: "動能" },
  main_force_chip: { label: "主力籌碼盤整", short: "主力" },
  limit_up_doji: { label: "漲停十字星", short: "漲停十字" },
  twenty_day_breakout: { label: "突破20日新高", short: "突破" },
  opening_power: { label: "開盤即戰力狙擊", short: "開盤" },
  red_to_green: { label: "昨日紅轉綠", short: "紅轉綠" },
  investment_trust: { label: "投信連買認養股", short: "投信" },
  vcp: { label: "波段收斂型態", short: "收斂" },
  ma_bull: { label: "均線多頭排列", short: "均線" },
  sync_backtest: { label: "高同步率回測", short: "同步" },
  overnight_chip: { label: "隔日沖吸籌監控", short: "隔日" },
  short_fund_flow: { label: "短線資金動能", short: "資金" },
  chip_health_strong: { label: "籌碼健檢強勢", short: "籌碼" },
  one_day_rebound: { label: "大跌一日反彈", short: "反彈" },
  short_squeeze: { label: "融券嘎空雷達", short: "嘎空" },
  ultra_short: { label: "超短線操作", short: "短打" },
};

function apiOnlyError(reason = "") {
  return {
    ok: false,
    error: "strategy5_api_only_unavailable",
    detail: reason,
    cacheSource: "none",
    matches: [],
    unattended: {
      status: "NO",
      canRunUnattended: false,
      contract: UNATTENDED_CONTRACT,
      reasons: [reason || "strategy5_api_only_unavailable"],
      checkedAt: new Date().toISOString(),
    },
    transport: {
      source: "supabase",
      latestRunView: LATEST_RUN_VIEW,
      gate: COMPLETE_RUN_GATE,
      via: "api/strategy5-latest",
      fetchedAt: new Date().toISOString(),
    },
    sourceCoverage: {
      ok: false,
      sourceStatus: "unavailable",
      strategyAuthority: "chip",
      quoteFreshCoverage120s: null,
      today1mSymbols: null,
      readyGe35: null,
      preopenCoverage: null,
      chipCoverageStatus: "",
      fallbackUsed: false,
    },
    publishGate: {
      publishAllowed: false,
      latestOverwriteAllowed: false,
      degradedBlocksLatest: true,
      reason: reason || "strategy5_api_only_unavailable",
    },
    fallbackUsed: false,
    fallback: {
      used: false,
      source: "",
      reason: "",
      contractAllowed: false,
      officialSource: false,
    },
    fallbackScope: [],
    fallbackAllowed: true,
    fallbackDetails: [],
    fallbackContract: "strategy5-fallback-disallowed-for-publish",
    writeBudget: {
      ok: false,
      limitRows: WRITE_BUDGET_LIMIT_ROWS,
      estimatedRowsWritten: 0,
      remainingRows: WRITE_BUDGET_LIMIT_ROWS,
      overBudget: false,
      reason: reason || "strategy5_api_only_unavailable",
    },
    retentionOk: false,
    evidenceStatus: "insufficient",
    unattendedStatus: "NO",
    degradedBlocksLatest: true,
    preservePreviousGood: true,
    requiredFields: STRATEGY5_REQUIRED_FIELD_GROUPS,
    blankCounts: {},
    sampleMissingRows: [],
    blockedReason: reason || "strategy5_api_only_unavailable",
    scanner_block_reason: reason || "strategy5_api_only_unavailable",
    retention: {
      ok: false,
      rawRetentionDays: RAW_RETENTION_DAYS,
      latestUpsert: true,
      runsPreserved: true,
      dailySummaryTable: "strategy_cache_status",
      reason: reason || "strategy5_api_only_unavailable",
    },
  };
}

function setDesktopSnapshotCache(response) {
  response.setHeader("Cache-Control", "public, max-age=45, stale-while-revalidate=180");
  response.setHeader("CDN-Cache-Control", "public, max-age=45, stale-while-revalidate=240");
  response.setHeader("Vercel-CDN-Cache-Control", "public, max-age=45, stale-while-revalidate=240");
}

async function fetchRowsFrom(table, query) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`${table} HTTP ${response.status} ${text.slice(0, 180)}`.trim());
  }
  const rows = await response.json();
  return Array.isArray(rows) ? rows : [];
}

async function fetchRowsWithCount(table, query) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Accept: "application/json",
      Prefer: "count=exact",
    },
    cache: "no-store",
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`${table} HTTP ${response.status} ${text.slice(0, 180)}`.trim());
  }
  const rows = await response.json();
  const contentRange = response.headers.get("content-range") || "";
  const exactCount = Number(contentRange.split("/").pop());
  return {
    rows: Array.isArray(rows) ? rows : [],
    exactCount: Number.isFinite(exactCount) ? exactCount : null,
  };
}

function cleanNumber(value) {
  const number = Number(String(value ?? "").replace(/[,+%]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function cleanNullableNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && !value.trim()) return null;
  const number = Number(String(value).replace(/[,+%]/g, ""));
  return Number.isFinite(number) ? number : null;
}

function compactDateKey(value) {
  const compact = String(value || "").replace(/\D/g, "").slice(0, 8);
  return /^\d{8}$/.test(compact) ? compact : "";
}

function taipeiDateKey(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}${parts.month}${parts.day}`;
}

function dateAgeDays(dateKey) {
  const compact = compactDateKey(dateKey);
  if (!compact) return null;
  const today = taipeiDateKey();
  const toUtc = (value) => Date.UTC(Number(value.slice(0, 4)), Number(value.slice(4, 6)) - 1, Number(value.slice(6, 8)));
  return Math.floor((toUtc(today) - toUtc(compact)) / 86400000);
}

function staleStrategy5SnapshotReason(payload) {
  if (!payload || typeof payload !== "object") return "snapshot_payload_missing";
  if (payload.unattended?.contract !== UNATTENDED_CONTRACT) return "snapshot_unattended_contract_missing";
  const status = String(payload.dataFreshness?.status || payload.qualityStatus || "").toLowerCase();
  if (["stale", "degraded", "partial", "incomplete"].includes(status)) return `snapshot_status_${status}`;
  const sourceDate = compactDateKey(payload.sourceDate || payload.usedDate || payload.marketSession?.marketDataDate);
  const ageDays = dateAgeDays(sourceDate);
  if (!sourceDate) return "snapshot_source_date_missing";
  if (ageDays == null || ageDays > MAX_CHIP_SOURCE_AGE_DAYS) return `snapshot_source_date_stale:${sourceDate}`;
  return "";
}

function resolveStrategy5SourceDate(run, scanDate, chipSourceHealth = null) {
  const payloadHealth = run?.payload?.sourceHealth && typeof run.payload.sourceHealth === "object" ? run.payload.sourceHealth : {};
  const healthStatus = String(chipSourceHealth?.coverage_status || "").toLowerCase();
  const liveHealthDate = ["ready", "ok"].includes(healthStatus) ? compactDateKey(chipSourceHealth?.latest_trade_date) : "";
  return liveHealthDate
    || compactDateKey(payloadHealth.chipLatestTradeDate)
    || compactDateKey(payloadHealth.institutionLatestDate)
    || compactDateKey(run?.payload?.sourceDate)
    || compactDateKey(run?.payload?.usedDate)
    || compactDateKey(scanDate);
}

async function fetchChipSourceHealth() {
  try {
    const rows = await fetchRowsFrom(
      "v_institution_source_health",
      [
        "select=coverage_status,latest_trade_date,institutional_latest_trade_date,margin_latest_trade_date,unified_latest_trade_date,institutional_rows,margin_rows,unified_rows,valid_after_exclusion_rows,min_required_rows,stale_days,reason,unified_latest_updated_at,margin_latest_updated_at,institutional_latest_updated_at,suggested_scanner_behavior",
        "limit=1",
      ].join("&")
    );
    return rows[0] || null;
  } catch {
    return null;
  }
}

function isoDateKey(compact) {
  const date = compactDateKey(compact);
  return date ? `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}` : "";
}

function buildChipSourceStatusAtRun(sourceHealth = {}, sourceDate = "") {
  const coverageStatus = String(sourceHealth.coverageStatus || sourceHealth.coverage_status || "").toLowerCase();
  const minRows = cleanNumber(sourceHealth.minRequiredRows || sourceHealth.min_required_rows) || 1500;
  const institutionalRows = cleanNumber(sourceHealth.institutionalRows || sourceHealth.institutional_rows);
  const marginRows = cleanNumber(sourceHealth.marginRows || sourceHealth.margin_rows);
  const unifiedRows = cleanNumber(sourceHealth.unifiedRows || sourceHealth.unified_rows);
  const validRows = cleanNumber(sourceHealth.validAfterExclusionRows || sourceHealth.valid_after_exclusion_rows);
  const latestTradeDate = sourceHealth.latestTradeDate || sourceHealth.latest_trade_date || sourceDate || "";
  const ok = coverageStatus === "ready" && validRows >= minRows;
  return {
    ok,
    status: ok ? "ready" : (coverageStatus || "not_ready"),
    strategyAuthority: "chip",
    source: "run_payload.sourceHealth",
    coverageStatus,
    latestTradeDate,
    latestTradeDateKey: compactDateKey(latestTradeDate),
    institutionalRows,
    marginRows,
    marginCoverageRequired: false,
    unifiedRows,
    validAfterExclusionRows: validRows,
    minRequiredRows: minRows,
    staleDays: cleanNumber(sourceHealth.staleDays || sourceHealth.stale_days),
    reason: sourceHealth.healthReason || sourceHealth.reason || (ok ? "chip source ready at run" : "chip source not ready at run"),
  };
}

function notRequiredSourceEvidence(reason) {
  return { ok: true, status: "not_required", reason };
}

const STRATEGY5_FIELD_COMPLETENESS_CONTRACT = "strategy5-field-completeness-20260703";
const STRATEGY5_REQUIRED_FIELD_GROUPS = {
  code: ["code"],
  name: ["name"],
  price: ["close", "price"],
  changePercent: ["percent", "changePercent", "change_percent"],
  volume: ["tradeVolume", "volume", "trade_volume"],
  score: ["score"],
  reason: ["reason", "activeMatch.reason", "matches.0.reason"],
  signals: ["matches", "signals", "sourceSignals", "activeMatch"],
};

function strategy5DeepValue(object, key) {
  const parts = String(key || "").split(".").filter(Boolean);
  let cursor = object;
  for (const part of parts) {
    if (Array.isArray(cursor) && /^\d+$/.test(part)) cursor = cursor[Number(part)];
    else if (cursor && typeof cursor === "object") cursor = cursor[part];
    else return undefined;
  }
  return cursor;
}

function strategy5HasFieldValue(row, fields, group = "") {
  return fields.some((field) => {
    const value = strategy5DeepValue(row, field);
    if (value === null || value === undefined) return false;
    if (Array.isArray(value)) return value.length > 0;
    if (["price", "volume", "score"].includes(group)) return Number(value) > 0;
    if (group === "changePercent") return !(typeof value === "string" && !value.trim()) && Number.isFinite(Number(value));
    if (typeof value === "string") return value.trim().length > 0;
    return true;
  });
}

function buildStrategy5FieldCompleteness(rows) {
  const checkedRows = Array.isArray(rows) ? rows : [];
  const blankCounts = Object.fromEntries(Object.keys(STRATEGY5_REQUIRED_FIELD_GROUPS).map((key) => [key, 0]));
  const sampleMissingRows = [];
  checkedRows.forEach((row, index) => {
    const missingGroups = [];
    for (const [group, fields] of Object.entries(STRATEGY5_REQUIRED_FIELD_GROUPS)) {
      if (!strategy5HasFieldValue(row, fields, group)) {
        blankCounts[group] += 1;
        missingGroups.push(group);
      }
    }
    if (missingGroups.length && sampleMissingRows.length < 5) {
      sampleMissingRows.push({
        index,
        code: String(row?.code || "").trim(),
        name: String(row?.name || "").trim(),
        missingGroups,
      });
    }
  });
  const blankTotal = Object.values(blankCounts).reduce((sum, value) => sum + value, 0);
  const denominator = Math.max(1, checkedRows.length * Object.keys(STRATEGY5_REQUIRED_FIELD_GROUPS).length);
  return {
    contract: STRATEGY5_FIELD_COMPLETENESS_CONTRACT,
    requiredFields: STRATEGY5_REQUIRED_FIELD_GROUPS,
    rowsChecked: checkedRows.length,
    blankCounts,
    blankTotal,
    blankRate: Number((blankTotal / denominator).toFixed(6)),
    sampleMissingRows,
  };
}

function strategy5RunTimeSourceEvidence({ run, sourceHealth, sourceDate, apiState, expectedTotal, scannedCount, resultCount, fieldCompleteness = {} }) {
  const persisted = runTimeSourceSnapshotResponseFields(run?.payload || {});
  const persistedStatus = persisted.source_status_at_run && typeof persisted.source_status_at_run === "object"
    ? persisted.source_status_at_run
    : null;
  const shouldUseChipStatus = !persistedStatus?.ok && (sourceHealth.coverageStatus || sourceHealth.validAfterExclusionRows || sourceHealth.latestTradeDate);
  const chipStatus = run?.payload?.chip_source_status_at_run || buildChipSourceStatusAtRun(sourceHealth, sourceDate);
  const sourceStatusAtRun = shouldUseChipStatus ? chipStatus : (persisted.source_status_at_run || chipStatus);
  const capturedAt = persisted.source_snapshot_captured_at || run?.finished_at || run?.updated_at || new Date().toISOString();
  const persistedQuality = persisted.run_quality_at_publish && typeof persisted.run_quality_at_publish === "object"
    ? persisted.run_quality_at_publish
    : {};
  const runQuality = {
    ...persistedQuality,
    runId: run?.run_id || persistedQuality.runId || "",
    status: run?.quality_status || run?.status || persistedQuality.status || "",
    publishAllowed: apiState.publishGate.publishAllowed,
    degradedBlocksLatest: true,
    preservePreviousGood: true,
    fallbackUsed: apiState.fallback.used,
    fallbackScope: Array.isArray(persistedQuality.fallbackScope) ? persistedQuality.fallbackScope : [],
    fallbackAllowed: false,
    fallbackDetails: Array.isArray(persistedQuality.fallbackDetails) ? persistedQuality.fallbackDetails : [],
    fallbackContract: persistedQuality.fallbackContract || "strategy5-fallback-disallowed-for-publish",
    expectedTotal: cleanNumber(expectedTotal),
    scannedCount: cleanNumber(scannedCount),
    resultCount: cleanNumber(resultCount),
    readbackCount: cleanNumber(run?.readback_count),
    writeBudget: apiState.writeBudget,
    retentionOk: apiState.retention.ok,
    fieldCompletenessContract: fieldCompleteness.contract || STRATEGY5_FIELD_COMPLETENESS_CONTRACT,
    requiredFields: fieldCompleteness.requiredFields || STRATEGY5_REQUIRED_FIELD_GROUPS,
    rowsChecked: cleanNumber(fieldCompleteness.rowsChecked),
    blankCounts: fieldCompleteness.blankCounts || {},
    blankTotal: cleanNumber(fieldCompleteness.blankTotal),
    blankRate: cleanNumber(fieldCompleteness.blankRate),
    sampleMissingRows: Array.isArray(fieldCompleteness.sampleMissingRows) ? fieldCompleteness.sampleMissingRows : [],
    blockedReason: persistedQuality.blockedReason || persistedQuality.scanner_block_reason || (apiState.publishGate.publishAllowed ? "" : apiState.publishGate.reason),
    scanner_block_reason: persistedQuality.scanner_block_reason || persistedQuality.blockedReason || (apiState.publishGate.publishAllowed ? "" : apiState.publishGate.reason),
    rawKeepDays: RAW_RETENTION_DAYS,
    qualityStatus: run?.quality_status || persistedQuality.qualityStatus || "",
  };
  const snapshot = {
    ...(persisted.runTimeSourceSnapshot || {}),
    contract: "run-time-source-snapshot-v1",
    strategy: "strategy5",
    runId: run?.run_id || "",
    source_snapshot_captured_at: capturedAt,
    source_status_at_run: sourceStatusAtRun,
    quote_coverage_at_run: persisted.quote_coverage_at_run || notRequiredSourceEvidence("strategy5 chip source does not require intraday quote freshness"),
    intraday_1m_readiness_at_run: persisted.intraday_1m_readiness_at_run || notRequiredSourceEvidence("strategy5 chip source does not require intraday 1m"),
    ma_readiness_at_run: persisted.ma_readiness_at_run || notRequiredSourceEvidence("strategy5 chip source does not require MA readiness"),
    preopen_futopt_daily_readiness_at_run: persisted.preopen_futopt_daily_readiness_at_run || notRequiredSourceEvidence("strategy5 chip source does not require preopen/futopt/daily volume readiness"),
    run_quality_at_publish: runQuality,
  };
  return {
    runTimeSourceSnapshot: snapshot,
    run_time_source_snapshot: snapshot,
    source_snapshot_captured_at: snapshot.source_snapshot_captured_at,
    source_status_at_run: snapshot.source_status_at_run,
    chip_source_status_at_run: sourceStatusAtRun,
    quote_coverage_at_run: snapshot.quote_coverage_at_run,
    intraday_1m_readiness_at_run: snapshot.intraday_1m_readiness_at_run,
    ma_readiness_at_run: snapshot.ma_readiness_at_run,
    preopen_futopt_daily_readiness_at_run: snapshot.preopen_futopt_daily_readiness_at_run,
    run_quality_at_publish: snapshot.run_quality_at_publish,
  };
}

function buildStrategy5ApiState({ run, sourceDate, chipSourceHealth, resultCount, expectedTotal, scannedCount, returnedCount }) {
  const checkedAt = new Date().toISOString();
  const coverageStatus = String(chipSourceHealth?.coverage_status || "").toLowerCase();
  const latestTradeDate = compactDateKey(chipSourceHealth?.latest_trade_date);
  const ageDays = dateAgeDays(sourceDate);
  const minRows = cleanNumber(chipSourceHealth?.min_required_rows) || 1500;
  const institutionalRows = cleanNumber(chipSourceHealth?.institutional_rows);
  const marginRows = cleanNumber(chipSourceHealth?.margin_rows);
  const validRows = cleanNumber(chipSourceHealth?.valid_after_exclusion_rows);
  const readbackCount = cleanNumber(run?.readback_count);
  const estimatedRowsWritten = cleanNumber(scannedCount) + cleanNumber(resultCount) + 1;
  const writeBudgetOk = estimatedRowsWritten > 0 && estimatedRowsWritten <= WRITE_BUDGET_LIMIT_ROWS;
  const issues = [];
  const warnings = [];
  const sourceReady = coverageStatus === "ready";
  const sourceFresh = Boolean(sourceDate) && ageDays != null && ageDays <= MAX_CHIP_SOURCE_AGE_DAYS;
  const completeRun = String(run?.status || "").toLowerCase() === "complete" && run?.complete === true;
  const scanComplete = cleanNumber(expectedTotal) > 0 && cleanNumber(expectedTotal) === cleanNumber(scannedCount);
  const resultReadbackOk = readbackCount > 0 && readbackCount === cleanNumber(resultCount);
  const dateAligned = !latestTradeDate || latestTradeDate === compactDateKey(sourceDate);
  if (!sourceReady) issues.push(`chip_source_not_ready:${coverageStatus || "missing"}`);
  if (!sourceFresh) issues.push(`chip_source_stale:${sourceDate || "missing"}`);
  if (institutionalRows < minRows) issues.push(`institutional_rows_below_min:${institutionalRows}/${minRows}`);
  if (marginRows < minRows) warnings.push(`margin_rows_below_min_warning:${marginRows}/${minRows}`);
  if (validRows < minRows) issues.push(`valid_rows_below_min:${validRows}/${minRows}`);
  if (!completeRun) issues.push("complete_run_not_complete");
  if (!scanComplete) issues.push(`scan_count_mismatch:${scannedCount}/${expectedTotal}`);
  if (!resultReadbackOk) issues.push(`result_readback_mismatch:${readbackCount}/${resultCount}`);
  if (!dateAligned) issues.push(`source_date_mismatch:${sourceDate}/${latestTradeDate}`);
  if (cleanNumber(returnedCount) <= 0) issues.push("api_rows_empty");
  if (!writeBudgetOk) issues.push(`write_budget_exceeded:${estimatedRowsWritten}/${WRITE_BUDGET_LIMIT_ROWS}`);
  const ok = issues.length === 0;
  const today = taipeiDateKey();
  const dataFreshness = {
    status: ok ? "fresh" : (sourceReady ? "stale" : "degraded"),
    reason: ok ? "chip_source_ready_and_complete_run_aligned" : issues.join(";"),
    today,
    sourceDate,
    sourceDateIso: isoDateKey(sourceDate),
    latestTradeDate: chipSourceHealth?.latest_trade_date || "",
    latestTradeDateKey: latestTradeDate,
    ageDays,
    maxAgeDays: MAX_CHIP_SOURCE_AGE_DAYS,
    coverageStatus: chipSourceHealth?.coverage_status || "",
    priorityStaleBlocked: !ok,
  };
  return {
    issues,
    warnings,
    dataFreshness,
    sourceStatus: ok ? "ready" : (sourceReady ? "stale" : "degraded"),
    sourceCoverage: {
      ok: sourceReady && sourceFresh,
      sourceStatus: sourceReady && sourceFresh ? "ready" : (sourceReady ? "stale" : "degraded"),
      strategyAuthority: "chip",
      quoteFreshCoverage120s: null,
      quoteFreshnessRequired: false,
      today1mSymbols: null,
      readyGe35: null,
      intraday1mFreshnessRequired: false,
      latestCandleTime: null,
      intraday1mStaleSeconds: null,
      preopenCoverage: null,
      preopenRequired: false,
      dailyVolumeFresh: null,
      dailyVolumeRequired: false,
      chipCoverageStatus: chipSourceHealth?.coverage_status || "",
      chipLatestTradeDate: chipSourceHealth?.latest_trade_date || "",
      chipAgeDays: ageDays,
      institutionalRows,
      marginRows,
      marginCoverageRequired: false,
      marginCoverageWarning: marginRows < minRows ? `margin_rows_below_min_warning:${marginRows}/${minRows}` : "",
      unifiedRows: cleanNumber(chipSourceHealth?.unified_rows),
      validAfterExclusionRows: validRows,
      minRequiredRows: minRows,
      fallbackUsed: false,
    },
    publishGate: {
      publishAllowed: ok,
      latestOverwriteAllowed: ok,
      degradedBlocksLatest: true,
      reason: ok ? "source_ready_complete_run_readback_aligned" : issues.join(";"),
      hardGate: `coverage_status=ready && valid chip rows >= min_required_rows && chip source age <= ${MAX_CHIP_SOURCE_AGE_DAYS}d && scanned_count=expected_total && result readback=result_count && write budget <= ${WRITE_BUDGET_LIMIT_ROWS}`,
    },
    fallback: {
      used: false,
      source: "",
      reason: "",
      contractAllowed: false,
      officialSource: false,
      rescueDisplayOnly: false,
    },
    writeBudget: {
      ok: writeBudgetOk,
      budgetName: "strategy5-daily-complete-run",
      limit: WRITE_BUDGET_LIMIT_ROWS,
      limitRows: WRITE_BUDGET_LIMIT_ROWS,
      used: estimatedRowsWritten,
      estimatedRowsWritten,
      writesCompleted: estimatedRowsWritten,
      scannedCount: cleanNumber(scannedCount),
      resultCount: cleanNumber(resultCount),
      runRows: 1,
      remaining: Math.max(0, WRITE_BUDGET_LIMIT_ROWS - estimatedRowsWritten),
      remainingRows: Math.max(0, WRITE_BUDGET_LIMIT_ROWS - estimatedRowsWritten),
      finalStatus: writeBudgetOk ? "complete" : "blocked",
      overBudget: !writeBudgetOk,
      reason: writeBudgetOk ? "within_strategy5_write_budget" : "strategy5_write_budget_exceeded",
    },
    retention: {
      ok: ok && resultReadbackOk,
      rawRetentionDays: RAW_RETENTION_DAYS,
      latestUpsert: true,
      latestRunPreserved: completeRun,
      runsPreserved: true,
      dailySummaryTable: "strategy_cache_status",
      runsTable: "strategy5_scan_runs",
      rawResultsTable: TABLE,
      resultReadbackCount: readbackCount,
      resultCount: cleanNumber(resultCount),
      reason: resultReadbackOk ? "latest complete run and raw result readback aligned" : "result readback mismatch",
    },
    marketSession: {
      today,
      marketDataDate: sourceDate,
      marketDataIsoDate: isoDateKey(sourceDate),
      hasTodayMarketData: sourceDate === today,
      acceptableLatestTradingDate: sourceFresh,
    },
    unattended: {
      status: ok ? "YES" : "NO",
      canRunUnattended: ok,
      contract: UNATTENDED_CONTRACT,
      checkedAt,
      officialSources: [
        "v_institution_source_health",
        "v_chip_flows_latest",
        LATEST_RUN_VIEW,
        TABLE,
      ],
      autoUpdateTrigger: "run-strategy5.ps1 -> scripts/scan-strategy5-cache.js -> Supabase complete run -> refresh-desktop-route-snapshot.ps1",
      freshnessGate: `coverage_status=ready && chip source age <= ${MAX_CHIP_SOURCE_AGE_DAYS}d && complete run readback aligned`,
      scannerBehavior: ok
        ? "allow Strategy5 publish and immediate display"
        : "preserve latest complete run; expose source health reason; do not publish stale result as fresh",
      sourceReady,
      sourceFresh,
      completeRun,
      scanComplete,
      resultReadbackOk,
      dateAligned,
      publishAllowed: ok,
      fallbackUsed: false,
      writeBudgetOk,
      retentionOk: ok && resultReadbackOk,
      snapshotGuard: "live=1/noSnapshot=1 bypasses snapshot; stale or missing unattended snapshots are rejected",
      reasons: ok ? ["ready"] : issues,
      warnings,
    },
  };
}

function parseRequestOptions(request) {
  try {
    const url = new URL(request.url || "", "http://localhost");
    const canvas = url.searchParams.get("canvas") === "1"
      || url.searchParams.get("compact") === "1"
      || url.searchParams.get("shell") === "1";
    const live = url.searchParams.get("live") === "1" || url.searchParams.get("noSnapshot") === "1";
    const limit = Math.max(1, Math.min(canvas ? 140 : 2000, cleanNumber(url.searchParams.get("limit")) || (canvas ? 70 : 2000)));
    return { canvas, live, limit };
  } catch {
    return { canvas: false, live: false, limit: 2000 };
  }
}

function normalizeMatch(match) {
  if (!match || typeof match !== "object") return null;
  const id = String(match.id || match.key || match.type || "").trim();
  if (!id || FORBIDDEN_UI_MATCH_IDS.has(id)) return null;
  const meta = STRATEGY5_UI_MATCH_META[id] || {};
  return {
    ...match,
    id,
    label: match.label || match.title || match.name || meta.label || id,
    short: match.short || meta.short || meta.label || match.label || id,
  };
}

function normalizePayload(row) {
  const payload = row.payload && typeof row.payload === "object" ? row.payload : {};
  const rawMatches = Array.isArray(payload.matches || row.signals) ? (payload.matches || row.signals) : [];
  const matches = rawMatches.map(normalizeMatch).filter(Boolean);
  const activeMatchId = String(payload.activeMatch?.id || payload.activeMatch?.key || payload.activeMatch?.type || "");
  const activeMatch = activeMatchId && !FORBIDDEN_UI_MATCH_IDS.has(activeMatchId) ? normalizeMatch(payload.activeMatch) : matches[0] || null;
  const sourceInst = payload.inst && typeof payload.inst === "object" ? payload.inst : {};
  const percent = cleanNullableNumber(payload.percent ?? payload.changePercent ?? row.change_percent);
  const institutionTotalNet = cleanNumber(payload.institutionTotalNet ?? payload.institution_total_net ?? payload.totalNet ?? payload.total_net ?? sourceInst.total ?? row.institution_total_net ?? row.total_net);
  const foreignNet = cleanNumber(payload.foreignNet ?? payload.foreign_net ?? sourceInst.foreign ?? row.foreign_net);
  const trustNet = cleanNumber(payload.trustNet ?? payload.investmentTrustNet ?? payload.investment_trust_net ?? sourceInst.trust ?? row.trust_net);
  const dealerNet = cleanNumber(payload.dealerNet ?? payload.dealer_net ?? sourceInst.dealer ?? row.dealer_net);
  const inst = {
    ...sourceInst,
    total: cleanNumber(sourceInst.total ?? institutionTotalNet),
    foreign: cleanNumber(sourceInst.foreign ?? foreignNet),
    trust: cleanNumber(sourceInst.trust ?? trustNet),
    dealer: cleanNumber(sourceInst.dealer ?? dealerNet),
  };
  return {
    ...payload,
    inst,
    matches,
    sourceSignals: rawMatches.filter((match) => match && typeof match === "object"),
    code: String(payload.code || row.code || "").trim(),
    name: String(payload.name || row.name || "").trim(),
    close: cleanNumber(payload.close || payload.price || row.close || row.price),
    price: cleanNumber(payload.price || payload.close || row.price || row.close),
    percent,
    tradeVolume: cleanNumber(payload.tradeVolume || payload.volume || row.trade_volume || row.volume),
    volume: cleanNumber(payload.volume || payload.tradeVolume || row.volume || row.trade_volume),
    value: cleanNumber(payload.value || payload.tradeValue || row.trade_value),
    tradeValue: cleanNumber(payload.tradeValue || payload.value || row.trade_value),
    score: cleanNumber(payload.score || row.score),
    institutionTotalNet,
    institution_total_net: institutionTotalNet,
    totalNet: institutionTotalNet,
    total_net: institutionTotalNet,
    foreignNet,
    foreign_net: foreignNet,
    trustNet,
    investmentTrustNet: trustNet,
    investment_trust_net: trustNet,
    dealerNet,
    dealer_net: dealerNet,
    activeMatch,
    reason: String(payload.reason || row.reason || matches.map((signal) => signal.reason).filter(Boolean).join("；")).trim(),
  };
}

function buildPayload(rows, run, options = {}) {
  const first = rows[0] || {};
  const expectedTotal = cleanNumber(run?.expected_total);
  const scannedCount = cleanNumber(run?.scanned_count);
  const resultCount = cleanNumber(run?.result_count) || rows.length;
  const normalizedRows = rows
    .slice()
    .sort((a, b) => cleanNumber(a.rank) - cleanNumber(b.rank) || String(a.code).localeCompare(String(b.code)))
    .map(normalizePayload);
  const matches = normalizedRows.filter((row) => row.matches.length);
  const scanDate = String(first.scan_date || run?.scan_date || "").replace(/-/g, "");
  const chipSourceHealth = options.chipSourceHealth || null;
  const sourceDate = resolveStrategy5SourceDate(run, scanDate, chipSourceHealth);
  const sourceHealth = {
    ...(run?.payload?.sourceHealth || {}),
    ...(chipSourceHealth ? {
      coverageStatus: chipSourceHealth.coverage_status || "",
      latestTradeDate: chipSourceHealth.latest_trade_date || "",
      institutionalLatestTradeDate: chipSourceHealth.institutional_latest_trade_date || "",
      marginLatestTradeDate: chipSourceHealth.margin_latest_trade_date || "",
      unifiedLatestTradeDate: chipSourceHealth.unified_latest_trade_date || "",
      institutionalRows: cleanNumber(chipSourceHealth.institutional_rows),
      marginRows: cleanNumber(chipSourceHealth.margin_rows),
      unifiedRows: cleanNumber(chipSourceHealth.unified_rows),
      validAfterExclusionRows: cleanNumber(chipSourceHealth.valid_after_exclusion_rows),
      minRequiredRows: cleanNumber(chipSourceHealth.min_required_rows),
      staleDays: cleanNumber(chipSourceHealth.stale_days),
      healthReason: chipSourceHealth.reason || "",
      healthUpdatedAt: chipSourceHealth.unified_latest_updated_at || chipSourceHealth.margin_latest_updated_at || chipSourceHealth.institutional_latest_updated_at || "",
      suggestedScannerBehavior: chipSourceHealth.suggested_scanner_behavior || "",
    } : {}),
  };
  const apiState = buildStrategy5ApiState({
    run,
    sourceDate,
    chipSourceHealth,
    resultCount,
    expectedTotal,
    scannedCount,
    returnedCount: matches.length,
  });
  const fieldCompleteness = buildStrategy5FieldCompleteness(normalizedRows);
  const runTimeEvidence = strategy5RunTimeSourceEvidence({
    run,
    sourceHealth,
    sourceDate,
    apiState,
    expectedTotal,
    scannedCount,
    resultCount,
    fieldCompleteness,
  });
  return {
    ok: true,
    source: "supabase:strategy5_scan_results",
    cacheSource: "supabase-api",
    ...runTimeEvidence,
    runId: String(first.run_id || run?.run_id || ""),
    updatedAt: String(run?.finished_at || first.updated_at || new Date().toISOString()),
    generatedDate: scanDate,
    scanDate,
    tradeDate: scanDate,
    usedDate: sourceDate || scanDate,
    sourceDate: sourceDate || scanDate,
    dataFreshness: apiState.dataFreshness,
    issues: apiState.issues,
    warnings: apiState.warnings,
    sourceStatus: apiState.sourceStatus,
    sourceCoverage: apiState.sourceCoverage,
    publishGate: apiState.publishGate,
    fallbackUsed: apiState.fallback.used,
    fallback: apiState.fallback,
    fallbackScope: runTimeEvidence.run_quality_at_publish?.fallbackScope || [],
    fallbackAllowed: runTimeEvidence.run_quality_at_publish?.fallbackAllowed === true,
    fallbackDetails: runTimeEvidence.run_quality_at_publish?.fallbackDetails || [],
    fallbackContract: runTimeEvidence.run_quality_at_publish?.fallbackContract || "strategy5-fallback-disallowed-for-publish",
    writeBudget: apiState.writeBudget,
    retentionOk: apiState.retention.ok,
    evidenceStatus: apiState.unattended.status === "YES" ? "complete" : "insufficient",
    unattendedStatus: apiState.unattended.status,
    degradedBlocksLatest: apiState.publishGate.degradedBlocksLatest,
    preservePreviousGood: true,
    requiredFields: fieldCompleteness.requiredFields || STRATEGY5_REQUIRED_FIELD_GROUPS,
    blankCounts: fieldCompleteness.blankCounts || {},
    sampleMissingRows: fieldCompleteness.sampleMissingRows || [],
    blockedReason: apiState.publishGate.publishAllowed ? "" : apiState.publishGate.reason,
    scanner_block_reason: apiState.publishGate.publishAllowed ? "" : apiState.publishGate.reason,
    retention: apiState.retention,
    rawKeepDays: RAW_RETENTION_DAYS,
    marketSession: apiState.marketSession,
    unattended: apiState.unattended,
    schedule: run?.payload?.schedule || "daily complete scan",
    fullScan: true,
    complete: true,
    canvas: Boolean(options.canvas),
    qualityStatus: String(first.quality_status || run?.quality_status || "complete"),
    schemaVersion: String(first.schema_version || run?.schema_version || "strategy5-run-id-complete-v1"),
    dataContractSource: String(first.data_contract_source || run?.data_contract_source || "strategy5-cache"),
    expectedTotal,
    scannedCount,
    resultCount,
    total: Math.max(matches.length, expectedTotal),
    scannedThisRun: scannedCount || matches.length,
    count: resultCount,
    returnedCount: matches.length,
    sourceHealth,
    matches,
    transport: {
      source: "supabase",
      table: TABLE,
      latestRunView: LATEST_RUN_VIEW,
      gate: COMPLETE_RUN_GATE,
      runId: String(first.run_id || run?.run_id || ""),
      resultReadbackCount: cleanNumber(run?.readback_count),
      via: "api/strategy5-latest",
      fetchedAt: new Date().toISOString(),
    },
  };
}

function validateCompleteRun(run, readbackCount, options = {}) {
  const requireReadback = options.requireReadback !== false;
  if (!run?.run_id) return "strategy5_complete_run_missing";
  if (String(run.status || "") !== "complete" || run.complete !== true) return "strategy5_complete_run_not_complete";
  const expectedTotal = cleanNumber(run.expected_total);
  const scannedCount = cleanNumber(run.scanned_count);
  const resultCount = cleanNumber(run.result_count);
  if (expectedTotal <= 0) return "strategy5_expected_total_empty";
  if (scannedCount <= 0) return "strategy5_scanned_count_empty";
  if (expectedTotal !== scannedCount) return "strategy5_incomplete_scan_count";
  if (resultCount <= 0) return "strategy5_result_count_empty";
  if (!requireReadback) return "";
  if (!Number.isFinite(readbackCount)) return "strategy5_result_readback_unavailable";
  if (Number.isFinite(readbackCount) && readbackCount !== resultCount) return "strategy5_result_readback_mismatch";
  return "";
}

async function fetchLatestCompleteRun() {
  const rows = await fetchRowsFrom(
    LATEST_RUN_VIEW,
    [
      "select=*",
      "strategy=eq.strategy5",
      "status=eq.complete",
      "complete=eq.true",
      "limit=1",
    ].join("&")
  );
  return rows[0]?.run_id ? rows[0] : null;
}

async function fetchLatestCompleteRows(limit = 2000) {
  const run = await fetchLatestCompleteRun();
  const runIssue = validateCompleteRun(run, null, { requireReadback: false });
  if (runIssue) return { rows: [], run, gate: runIssue };
  const result = await fetchRowsWithCount(
    TABLE,
    [
      "select=run_id,scan_date,code,name,price,close,change_percent,volume,trade_volume,trade_value,score,rank,reason,signals,payload,complete,quality_status,schema_version,data_contract_source,generated_at,updated_at",
      "strategy=eq.strategy5",
      `run_id=eq.${encodeURIComponent(run.run_id)}`,
      "complete=eq.true",
      "order=rank.asc",
      `limit=${Math.max(1, Math.min(2000, cleanNumber(limit) || 2000))}`,
    ].join("&")
  );
  const readbackCount = result.exactCount;
  const readbackIssue = validateCompleteRun(run, readbackCount);
  if (readbackIssue) return { rows: [], run: { ...run, readback_count: readbackCount }, gate: readbackIssue };
  return { rows: result.rows, run: { ...run, readback_count: readbackCount }, gate: COMPLETE_RUN_GATE };
}

async function handler(request, response) {
  const marketCalendar = await buildMarketCalendarContract().catch(() => null);
  installMarketCalendarResponse(response, marketCalendar);
  wrapJsonRunTimeSourceEvidence(response, { strategy: "strategy5", endpoint: "api/strategy5-latest" });
  response.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
  response.setHeader("CDN-Cache-Control", "no-store");
  response.setHeader("Vercel-CDN-Cache-Control", "no-store");

  if (request.method !== "GET") {
    response.status(405).json({ ok: false, error: "method_not_allowed" });
    return;
  }

  const options = parseRequestOptions(request);
  if (!options.live) {
    const cached = await readEndpointFromDesktopSnapshot(request, {
      timeoutMs: 650,
      via: "api/strategy5-latest",
    });
    const staleReason = staleStrategy5SnapshotReason(cached);
    if (cached && !staleReason) {
      setDesktopSnapshotCache(response);
      response.status(200).json(cached);
      return;
    }
  }

  try {
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      response.status(503).json(apiOnlyError("supabase_not_configured"));
      return;
    }
    const latest = await fetchLatestCompleteRows(options.limit);
    if (!latest.rows.length) {
      response.status(404).json(apiOnlyError(latest.gate || "strategy5_scan_results_latest_empty"));
      return;
    }
    options.chipSourceHealth = await fetchChipSourceHealth();
    setDesktopSnapshotCache(response);
    response.status(200).json(buildPayload(latest.rows, latest.run, options));
  } catch (error) {
    response.status(503).json(apiOnlyError(error?.message || String(error)));
  }
}

module.exports = withEntitlementRequired(handler, "strategy5");
module.exports._test = {
  buildPayload,
  fetchLatestCompleteRows,
  buildStrategy5ApiState,
  buildStrategy5FieldCompleteness,
  strategy5RunTimeSourceEvidence,
};

