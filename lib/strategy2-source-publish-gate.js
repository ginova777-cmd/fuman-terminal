"use strict";

function cleanNumber(value, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value === null || value === undefined) return fallback;
  const text = String(value).replace(/[,+%]/g, "").trim();
  if (!text) return fallback;
  const number = Number(text);
  return Number.isFinite(number) ? number : fallback;
}

function boolValue(value) {
  if (value === true) return true;
  if (value === false) return false;
  return /^(1|true|yes|ready|ok)$/i.test(String(value ?? "").trim());
}

function taipeiMinuteOfDay(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(now);
  const hour = Number(parts.find((item) => item.type === "hour")?.value || 0);
  const minute = Number(parts.find((item) => item.type === "minute")?.value || 0);
  return hour * 60 + minute;
}

function statusOk(value) {
  const text = String(value || "").toLowerCase();
  return !text || ["ok", "ready", "fresh", "complete"].includes(text);
}

function badStatus(value) {
  return /^(degraded|critical|stale|failed|error|not_ready|blocked)$/i.test(String(value || "").trim());
}

function buildCoverage(sourceStatusRow = {}) {
  const payload = sourceStatusRow?.payload && typeof sourceStatusRow.payload === "object" ? sourceStatusRow.payload : {};
  const motherPoolSymbols = cleanNumber(payload.mother_pool_symbols, cleanNumber(payload.active_symbols, cleanNumber(payload.eligible_symbols)));
  const freshQuoteCoverage120s = cleanNumber(
    payload.fresh_quote_coverage_120s,
    motherPoolSymbols > 0 ? cleanNumber(payload.fresh_quotes_120s) / motherPoolSymbols : cleanNumber(payload.eligible_quote_coverage)
  );
  const today1mSymbols = cleanNumber(payload.today_1m_symbols, cleanNumber(payload.intraday_1m_symbols_today));
  const readyGe35 = cleanNumber(payload.ready_ge_35_symbols, cleanNumber(payload.ready_ge_35, cleanNumber(payload.ready_ma35_continuous_symbols)));
  const dailyVolumeReady = cleanNumber(payload.daily_volume_ready_symbols, cleanNumber(payload.daily_volume_rows, cleanNumber(payload.daily_volume_avg_rows)));
  const preopenRows = cleanNumber(payload.preopen_rows, cleanNumber(payload.preopen_count, cleanNumber(payload.preopen)));
  const staleSeconds = cleanNumber(payload.intraday_1m_stale_seconds, 999999);
  const fallbackUsed = boolValue(payload.fallbackUsed || payload.fallback_used || payload.degraded_but_usable_for_intraday);
  return {
    sourceStatus: String(sourceStatusRow?.status || payload.status || "").toLowerCase(),
    quoteStatus: String(payload.quote_status || "").toLowerCase(),
    intraday1mStatus: String(payload.intraday_1m_status || "").toLowerCase(),
    preopenStatus: String(payload.preopen_status || "").toLowerCase(),
    dailyVolumeStatus: String(payload.daily_volume_status || "").toLowerCase(),
    sourceCoreOk: boolValue(payload.source_core_ok || payload.source_parts?.source_core_ok),
    quotesOk: boolValue(payload.quotes_ok || payload.source_parts?.quotes_ok),
    intraday1mOk: boolValue(payload.intraday_1m_ok || payload.source_parts?.intraday_1m_ok),
    dailyVolumeOk: boolValue(payload.daily_volume_ok || payload.source_parts?.daily_volume_ok),
    preopenOk: boolValue(payload.preopen_ok || payload.source_parts?.preopen_ok) || preopenRows > 0,
    fallbackUsed,
    freshQuoteCoverage120s,
    today1mSymbols,
    readyGe35,
    motherPoolSymbols,
    latestCandleTime: payload.latest_candle_time || payload.intraday_1m_latest_candle_time || "",
    intraday1mStaleSeconds: staleSeconds,
    preopenRows,
    dailyVolumeReady,
    writeBudget: payload.writeBudget || payload.write_budget || null,
    retentionOk: payload.retentionOk ?? payload.retention_ok ?? null,
    checkedAt: sourceStatusRow?.updated_at || "",
    payload,
  };
}

function evaluateStrategy2SourceGate({ sourceStatusRow, readinessRow, now = new Date(), strict = true } = {}) {
  const minute = taipeiMinuteOfDay(now);
  const coverage = buildCoverage(sourceStatusRow || {});
  const issues = [];
  const warnings = [];
  const readinessReady = readinessRow?.strategy2_ready_100 === true;
  const minFreshQuoteCoverage120s = cleanNumber(process.env.STRATEGY2_SOURCE_GATE_MIN_FRESH_QUOTE_COVERAGE_120S, 0.9);
  const maxStaleSeconds = cleanNumber(process.env.STRATEGY2_SOURCE_GATE_MAX_STALE_SECONDS, 120);
  const criticalStaleSeconds = cleanNumber(process.env.STRATEGY2_SOURCE_GATE_CRITICAL_STALE_SECONDS, 180);
  const min0910Today1mRatio = cleanNumber(process.env.STRATEGY2_SOURCE_GATE_0910_TODAY_1M_RATIO, 0.8);
  const min0930ReadyGe35Ratio = cleanNumber(process.env.STRATEGY2_SOURCE_GATE_0930_READY_GE35_RATIO, 0.95);

  if (!sourceStatusRow) issues.push("legacy shared source row missing (observation-only)");
  if (badStatus(coverage.sourceStatus)) issues.push(`source_status=${coverage.sourceStatus}`);
  if (!coverage.sourceCoreOk && badStatus(coverage.sourceStatus)) issues.push("source_core_ok=false");
  if (coverage.fallbackUsed) issues.push("fallbackUsed=true");
  if (!coverage.quotesOk && !statusOk(coverage.quoteStatus)) issues.push(`quote_status=${coverage.quoteStatus || "not_ready"}`);
  if (coverage.freshQuoteCoverage120s < minFreshQuoteCoverage120s) {
    issues.push(`fresh_quote_coverage_120s ${coverage.freshQuoteCoverage120s.toFixed(4)} < ${minFreshQuoteCoverage120s}`);
  }
  if (!coverage.dailyVolumeOk && !statusOk(coverage.dailyVolumeStatus)) issues.push(`daily_volume_status=${coverage.dailyVolumeStatus || "not_ready"}`);
  if (minute >= 8 * 60 + 55 && minute < 9 * 60 && (!coverage.preopenOk || badStatus(coverage.preopenStatus))) {
    issues.push(`preopen coverage not ready rows=${coverage.preopenRows} status=${coverage.preopenStatus || "missing"}`);
  }
  if (minute >= 9 * 60 + 1) {
    if (!coverage.latestCandleTime) issues.push("latest_candle_time missing after 09:01");
    if (coverage.intraday1mStaleSeconds > criticalStaleSeconds) issues.push(`intraday_1m_stale_seconds ${coverage.intraday1mStaleSeconds} > ${criticalStaleSeconds} critical`);
    else if (coverage.intraday1mStaleSeconds > maxStaleSeconds) issues.push(`intraday_1m_stale_seconds ${coverage.intraday1mStaleSeconds} > ${maxStaleSeconds}`);
  }
  if (minute >= 9 * 60 + 5 && coverage.today1mSymbols <= 0) issues.push("09:05 first batch fugle_intraday_1m missing");
  if (minute >= 9 * 60 + 10 && coverage.motherPoolSymbols > 0) {
    const ratio = coverage.today1mSymbols / coverage.motherPoolSymbols;
    if (ratio < min0910Today1mRatio) issues.push(`09:10 today_1m_symbols ${coverage.today1mSymbols}/${coverage.motherPoolSymbols} < ${min0910Today1mRatio}`);
  }
  if (minute >= 9 * 60 + 30 && coverage.motherPoolSymbols > 0) {
    const ratio = coverage.readyGe35 / coverage.motherPoolSymbols;
    if (ratio < min0930ReadyGe35Ratio) issues.push(`09:30 ready_ge_35 ${coverage.readyGe35}/${coverage.motherPoolSymbols} < ${min0930ReadyGe35Ratio}`);
  }
  if (readinessRow && readinessRow.strategy2_ready_100 !== true) {
    warnings.push(`strategy2_readiness_status=${readinessRow.status || "not_ready"} reason=${readinessRow.reason || ""}`.trim());
  }
  if (readinessReady && issues.length) {
    warnings.push(`strategy2_readiness_100_observed_but_source_gate_still_blocks: ${issues.join("; ")}`);
  }

  const ok = issues.length === 0;
  const payloadLatestRunId = String(coverage.payload.latest_run_id || coverage.payload.latestRunId || "").trim();
  const readinessLatestRunId = String(readinessRow?.latest_run_id || "").trim();
  const latestRunId = payloadLatestRunId || readinessLatestRunId;
  return {
    ok,
    publishAllowed: ok,
    sourceCoverage: coverage,
    sourceStatus: ok ? "ready" : "degraded",
    staleSeconds: coverage.intraday1mStaleSeconds,
    fallbackUsed: coverage.fallbackUsed,
    writeBudget: coverage.writeBudget,
    retentionOk: coverage.retentionOk,
    latestRunId,
    latestRunIdSource: payloadLatestRunId ? "source_status.payload" : readinessLatestRunId ? "v_strategy2_readiness_status" : "",
    issues,
    warnings,
    suggestedScannerBehavior: ok ? "publish allowed" : "PreserveLatest; do not write latest; do not overwrite previous complete run; surface degraded reason",
    thresholds: {
      minFreshQuoteCoverage120s,
      maxStaleSeconds,
      criticalStaleSeconds,
      min0910Today1mRatio,
      min0930ReadyGe35Ratio,
      strict,
    },
  };
}

function readField(row, names, fallback = "") {
  for (const name of names) {
    if (row?.[name] !== undefined && row?.[name] !== null && row?.[name] !== "") return row[name];
  }
  return fallback;
}

function buildDaytradeCanonicalCoverage(row = {}) {
  const payload = row?.payload && typeof row.payload === "object" ? row.payload : {};
  const merged = { ...payload, ...row };
  const priorityPoolSymbols = cleanNumber(readField(merged, ["priority_pool_symbols", "priorityPoolSymbols", "mother_pool_symbols", "motherPoolSymbols"], 0));
  const priorityFreshCoverage = cleanNumber(readField(merged, ["priority_fresh_quote_coverage_120s", "priorityFreshQuoteCoverage120s", "fresh_quote_coverage_120s", "freshQuoteCoverage120s"], 0));
  const freshQuoteCoverage120s = cleanNumber(readField(merged, ["fresh_quote_coverage_120s", "freshQuoteCoverage120s"], priorityFreshCoverage));
  const freshQuotes120s = cleanNumber(readField(merged, ["fresh_quotes_120s", "freshQuotes120s", "priority_fresh_quotes_120s", "priorityFreshQuotes120s"], 0));
  const today1mSymbols = cleanNumber(readField(merged, ["today_1m_symbols", "today1mSymbols", "intraday_1m_symbols_today"], 0));
  const readyGe35 = cleanNumber(readField(merged, ["ready_ge_35", "readyGe35", "ready_ma35_continuous", "ready_ma35_continuous_symbols"], 0));
  const staleSeconds = cleanNumber(readField(merged, ["intraday_1m_stale_seconds", "intraday1mStaleSeconds", "quote_age_seconds", "quoteAgeSeconds"], 999999));
  const dailyVolumeReady = cleanNumber(readField(merged, ["daily_volume_ready", "dailyVolumeReady", "daily_volume_ready_symbols", "daily_volume_rows"], 0));
  const scannerCanRunOpening = boolValue(readField(merged, ["scanner_can_run_opening", "scannerCanRunOpening"], false));
  const scannerCanRunQuoteOnly = boolValue(readField(merged, ["scanner_can_run_quote_only", "scannerCanRunQuoteOnly"], false));
  return {
    sourceStatus: String(readField(merged, ["source_status", "sourceStatus", "status"], "")).toLowerCase(),
    quoteStatus: String(readField(merged, ["quote_status", "quoteStatus"], "")).toLowerCase(),
    intraday1mStatus: String(readField(merged, ["intraday_1m_status", "intraday1mStatus"], "")).toLowerCase(),
    preopenStatus: String(readField(merged, ["preopen_status", "preopenStatus"], "")).toLowerCase(),
    dailyVolumeStatus: String(readField(merged, ["daily_volume_status", "dailyVolumeStatus"], "")).toLowerCase(),
    sourceCoreOk: boolValue(readField(merged, ["daytrade_source_speed_ok", "daytradeSourceSpeedOk", "source_core_ok"], false)),
    quotesOk: freshQuoteCoverage120s > 0 || freshQuotes120s > 0,
    intraday1mOk: today1mSymbols > 0 || readyGe35 > 0,
    dailyVolumeOk: statusOk(readField(merged, ["daily_volume_status", "dailyVolumeStatus"], "")) || dailyVolumeReady > 0,
    preopenOk: true,
    fallbackUsed: boolValue(readField(merged, ["fallback_used", "fallbackUsed"], false)),
    freshQuoteCoverage120s,
    today1mSymbols,
    readyGe35,
    motherPoolSymbols: priorityPoolSymbols,
    latestCandleTime: readField(merged, ["latest_candle_time", "latestCandleTime", "intraday_1m_latest_candle_time"], ""),
    intraday1mStaleSeconds: staleSeconds,
    preopenRows: cleanNumber(readField(merged, ["preopen_rows", "preopenRows"], 0)),
    dailyVolumeReady,
    writeBudget: readField(merged, ["write_budget", "writeBudget"], null),
    retentionOk: readField(merged, ["retention_ok", "retentionOk"], null),
    checkedAt: readField(merged, ["checked_at", "checkedAt", "updated_at", "updatedAt"], ""),
    scannerCanRunOpening,
    scannerCanRunQuoteOnly,
    gateGrade: String(readField(merged, ["grade", "daytrade_gate_grade", "daytradeGateGrade"], "D")).toUpperCase(),
    formalEntryAllowed: boolValue(readField(merged, ["formal_entry_allowed", "formalEntryAllowed"], false)),
    stopNewSignals: boolValue(readField(merged, ["stop_new_signals", "stopNewSignals"], true)),
    payload,
  };
}

function evaluateStrategy2DaytradeCanonicalGate({ gateRow, readinessRow } = {}) {
  const coverage = buildDaytradeCanonicalCoverage(gateRow || {});
  const readinessReady = readinessRow?.strategy2_ready_100 === true || String(readinessRow?.status || "").toLowerCase() === "ready";
  const issues = [];
  const warnings = [];
  if (!gateRow) issues.push("daytrade canonical gate missing");
  if (!readinessReady) warnings.push(`strategy2_readiness_status=${readinessRow?.status || "not_ready"} reason=${readinessRow?.reason || ""}`.trim());
  if (!statusOk(coverage.sourceStatus)) issues.push(`daytrade_source_status=${coverage.sourceStatus || "missing"}`);
  if (coverage.gateGrade !== "A") issues.push(`daytrade_gate_grade=${coverage.gateGrade || "D"}`);
  if (coverage.formalEntryAllowed !== true) issues.push("formal_entry_allowed=false");
  if (coverage.stopNewSignals === true) issues.push("stop_new_signals=true");
  if (coverage.fallbackUsed) issues.push("fallbackUsed=true");

  const ok = gateRow && readinessReady && issues.length === 0;
  const latestRunId = String(
    readField(gateRow || {}, ["latest_run_id", "latestRunId"], "")
    || readinessRow?.latest_run_id
    || ""
  ).trim();
  return {
    ok,
    publishAllowed: ok,
    sourceCoverage: coverage,
    sourceStatus: ok ? "ready" : "degraded",
    staleSeconds: coverage.intraday1mStaleSeconds,
    fallbackUsed: coverage.fallbackUsed,
    writeBudget: coverage.writeBudget || {
      status: ok ? "allow" : "blocked",
      allowed: ok,
      reason: ok ? "dedicated daytrade canonical gate ready" : "dedicated daytrade canonical gate blocked",
    },
    retentionOk: coverage.retentionOk,
    latestRunId,
    latestRunIdSource: latestRunId ? "daytrade_canonical_gate" : "",
    issues,
    warnings,
    suggestedScannerBehavior: ok ? "publish allowed" : "PreserveLatest; do not write latest; do not overwrite previous complete run; surface degraded reason",
    thresholds: {
      formalGateView: process.env.STRATEGY2_DAYTRADE_CANONICAL_GATE_VIEW || "v_fugle_daytrade_unattended_gate_status",
      fallbackGateView: "v_fugle_daytrade_source_contract_health",
      sharedSourceFormalAllowed: false,
    },
  };
}

async function fetchRows(config, table, query) {
  const base = String(config.supabaseUrl || "").replace(/\/+$/, "");
  const key = config.serviceKey || config.publishKey || config.anonKey;
  if (!base || !key) throw new Error("missing Supabase config for Strategy2 source gate");
  const response = await fetch(`${base}/rest/v1/${table}?${query}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${table} HTTP ${response.status}: ${text.slice(0, 180)}`);
  return JSON.parse(text || "[]");
}

async function readFirstAvailableGateView(config, views) {
  const errors = [];
  for (const view of views) {
    try {
      const rows = await fetchRows(config, view, "select=*&limit=1");
      const row = Array.isArray(rows) ? rows[0] : null;
      if (row) return { view, row };
      errors.push(`${view}: empty`);
    } catch (error) {
      errors.push(`${view}: ${error?.message || String(error)}`);
    }
  }
  return { view: views[0], row: null, errors };
}

async function readStrategy2SourceGate(config) {
  const readinessRows = await fetchRows(
    config,
    "v_strategy2_readiness_status",
    "select=status,reason,strategy2_ready_100,latest_run_id,checked_at&limit=1"
  ).catch(() => []);
  const readinessRow = Array.isArray(readinessRows) ? readinessRows[0] : null;
  const canonicalView = process.env.STRATEGY2_DAYTRADE_CANONICAL_GATE_VIEW || "v_fugle_daytrade_unattended_gate_status";
  const canonical = await readFirstAvailableGateView(config, [
    canonicalView,
    "v_fugle_daytrade_source_contract_health",
  ]);
  const gate = evaluateStrategy2DaytradeCanonicalGate({
    gateRow: canonical.row,
    readinessRow,
  });
  gate.canonicalGateView = canonical.view;
  gate.canonicalGateReadErrors = canonical.errors || [];
  return gate;
}

async function assertStrategy2SourcePublishGate(config, options = {}) {
  const gate = await readStrategy2SourceGate(config);
  if (!gate.ok) {
    const error = new Error(`Strategy2 source publish gate blocked (${options.stage || "publish"}): ${gate.issues.join("; ")}`);
    error.gate = gate;
    throw error;
  }
  return gate;
}

module.exports = {
  assertStrategy2SourcePublishGate,
  buildCoverage,
  buildDaytradeCanonicalCoverage,
  evaluateStrategy2SourceGate,
  evaluateStrategy2DaytradeCanonicalGate,
  readStrategy2SourceGate,
};
