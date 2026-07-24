const fs = require("fs");
const path = require("path");

const PROJECT_URL = process.env.SUPABASE_URL || "https://cpmpfhbzutkiecccekfr.supabase.co";
const SOURCE_NAME = process.env.DAYTRADE_SOURCE_NAME || "fugle_daytrade_source";

function readTextSecret(paths) {
  for (const file of paths) {
    try {
      if (!fs.existsSync(file)) continue;
      const value = fs.readFileSync(file, "utf8").trim();
      if (value) return value;
    } catch {
      // optional secret path
    }
  }
  return "";
}

function numberValue(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(String(value).replace(/,/g, "").replace(/%/g, "").trim());
  return Number.isFinite(parsed) ? parsed : fallback;
}

function hasValue(object, key) {
  return object && Object.prototype.hasOwnProperty.call(object, key) && object[key] !== null && object[key] !== undefined && object[key] !== "";
}

function stringValue(value) {
  if (value === null || value === undefined) return "";
  return String(value);
}

function boolValue(value) {
  if (typeof value === "boolean") return value;
  return /^(1|true|yes|ok|ready)$/i.test(String(value || "").trim());
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientRestError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return message.includes("57014")
    || message.includes("statement timeout")
    || message.includes("operation was aborted")
    || message.includes("timeout");
}

async function retryTransient(label, action) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      lastError = error;
      if (!isTransientRestError(error) || attempt === 3) throw error;
      await sleepMs(350 * attempt);
    }
  }
  throw lastError || new Error(`${label} failed`);
}
function firstObject(value) {
  return Array.isArray(value) ? value[0] || null : value || null;
}

async function restGet(anonKey, pathAndQuery) {
  return retryTransient(`GET ${pathAndQuery}`, async () => {
    const url = `${PROJECT_URL.replace(/\/$/, "")}/rest/v1/${pathAndQuery}`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout ? AbortSignal.timeout(10000) : undefined,
    });
    const text = await response.text();
    if (!response.ok) {
      const error = new Error(`GET ${pathAndQuery} HTTP ${response.status}: ${text.slice(0, 240)}`);
      error.status = response.status;
      throw error;
    }
    return text ? JSON.parse(text) : null;
  });
}
async function restPost(anonKey, rpcName, body) {
  return retryTransient(`POST rpc/${rpcName}`, async () => {
    const url = `${PROJECT_URL.replace(/\/$/, "")}/rest/v1/rpc/${rpcName}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body || {}),
      signal: AbortSignal.timeout ? AbortSignal.timeout(10000) : undefined,
    });
    const text = await response.text();
    if (!response.ok) {
      const error = new Error(`POST rpc/${rpcName} HTTP ${response.status}: ${text.slice(0, 240)}`);
      error.status = response.status;
      throw error;
    }
    return text ? JSON.parse(text) : null;
  });
}
function websocketEvidence(payload = {}) {
  const channels = arrayValue(payload.websocket_streaming_channels ?? payload.websocketStreamingChannels);
  return {
    quoteTransport: stringValue(payload.quote_transport),
    websocketStatusOk: boolValue(payload.websocket_status_ok),
    websocketMode: stringValue(payload.websocket_mode),
    websocketConnected: boolValue(payload.websocket_connected),
    websocketAuthenticated: boolValue(payload.websocket_authenticated),
    websocketRestDisabled: boolValue(payload.websocket_rest_disabled),
    websocketFormalReady: boolValue(payload.websocket_formal_ready),
    websocketStreamingChannels: channels,
    websocketRequiredChannelsReady: ["trades", "aggregates", "candles"].every((channel) => channels.includes(channel)),
  };
}

function normalizeSourceStatus(row) {
  const payload = row?.payload || {};
  return {
    status: stringValue(row?.status),
    message: stringValue(row?.message),
    updatedAt: stringValue(row?.updated_at),
    daytradeGateGrade: stringValue(payload.daytrade_gate_grade),
    priorityGateGrade: stringValue(payload.priority_gate_grade),
    priorityFreshQuotes120s: numberValue(payload.priority_fresh_quotes_120s),
    priorityPoolSymbols: numberValue(payload.priority_pool_symbols),
    priorityFreshQuoteCoverage120s: numberValue(payload.priority_fresh_quote_coverage_120s),
    hasPriorityPoolSymbols: hasValue(payload, "priority_pool_symbols"),
    hasPriorityFreshQuoteCoverage120s: hasValue(payload, "priority_fresh_quote_coverage_120s"),
    hasScannerCanRunOpening: hasValue(payload, "scanner_can_run_opening"),
    quoteAgeSeconds: numberValue(payload.quote_age_seconds, 999999),
    formalEntryAllowed: boolValue(payload.formal_entry_allowed),
    scannerCanRunQuoteOnly: boolValue(payload.scanner_can_run_quote_only),
    scannerCanRunOpening: boolValue(payload.scanner_can_run_opening),
    rateLimitStatus: stringValue(payload.rate_limit_status),
    readyMa20Continuous: numberValue(payload.ready_ma20_continuous),
    readyMa35Continuous: numberValue(payload.ready_ma35_continuous),
    formalGateScope: stringValue(payload.formal_gate_scope),
    formalSourceName: stringValue(payload.formal_source_name),
    formalGateSource: stringValue(payload.formal_gate_source),
    formalQuoteSource: stringValue(payload.formal_quote_source),
    formalIntraday1mSource: stringValue(payload.formal_intraday_1m_source),
    quoteSourceDaytradeOk: boolValue(payload.quote_source_daytrade_ok),
    intraday1mSourceDaytradeOk: boolValue(payload.intraday_1m_source_daytrade_ok),
    formalSourceAlignmentOk: boolValue(payload.formal_source_alignment_ok),
    formalPrioritySpeedOk: boolValue(payload.formal_priority_speed_ok),
    fullMarketSpeedBlocking: payload.full_market_speed_blocking === false ? false : boolValue(payload.full_market_speed_blocking),
    gateSpeedOk: boolValue(payload.gate_speed_ok),
    formalSpeedScope: stringValue(payload.formal_speed_scope),
    quoteSpeedScope: stringValue(payload.quote_speed_scope),
    ...websocketEvidence(payload),
  };
}

function normalizeGate(row) {
  return {
    gateGrade: stringValue(row?.canonical_gate_grade || row?.daytrade_gate_grade || row?.gate_grade || row?.gate),
    gateStatus: stringValue(row?.canonical_gate_status || row?.gate_status || row?.status),
    reason: stringValue(row?.canonical_gate_reason || row?.reason || row?.canonical_reason || row?.scanner_block_reason),
    hasCanonicalGateReason: hasValue(row, "canonical_gate_reason"),
    priorityPoolSymbols: numberValue(row?.priority_pool_symbols),
    priorityFreshQuoteCoverage120s: numberValue(row?.priority_fresh_quote_coverage_120s),
    scannerCanRunOpening: boolValue(row?.scanner_can_run_opening),
    hasPriorityPoolSymbols: hasValue(row, "priority_pool_symbols"),
    hasPriorityFreshQuoteCoverage120s: hasValue(row, "priority_fresh_quote_coverage_120s"),
    hasScannerCanRunOpening: hasValue(row, "scanner_can_run_opening"),
    quoteAgeSeconds: numberValue(row?.quote_age_seconds, 999999),
    freshQuotes120s: numberValue(row?.fresh_quotes_120s),
    scorecardRequiredOkCount: numberValue(row?.scorecard_required_ok_count),
    scorecardRequiredCount: numberValue(row?.scorecard_required_count),
    formalEntrySpeedVerdict: stringValue(row?.formal_entry_speed_verdict),
    readyMa20Continuous: numberValue(row?.ready_ma20_continuous_symbols ?? row?.ready_ma20_continuous),
    readyMa35Continuous: numberValue(row?.ready_ma35_continuous_symbols ?? row?.ready_ma35_continuous),
    ...websocketEvidence(row || {}),
  };
}

function sourceWebsocketOk(source) {
  return source.websocketStatusOk === true
    && source.websocketConnected === true
    && source.websocketAuthenticated === true
    && source.websocketMode === "streaming"
    && source.quoteTransport.startsWith("websocket_")
    && source.websocketRestDisabled === true
    && source.websocketRequiredChannelsReady === true;
}

function gateWebsocketOk(gate) {
  return sourceWebsocketOk(gate) && gate.websocketFormalReady === true;
}

function isSourceA(source) {
  return source.status === "ok"
    && source.daytradeGateGrade === "A"
    && source.hasPriorityPoolSymbols === true
    && source.priorityPoolSymbols === 40
    && source.hasPriorityFreshQuoteCoverage120s === true
    && source.priorityFreshQuoteCoverage120s >= 0.95
    && source.quoteAgeSeconds <= 90
    && source.formalEntryAllowed === true
    && source.scannerCanRunQuoteOnly === true
    && source.hasScannerCanRunOpening === true
    && source.scannerCanRunOpening === true
    && source.rateLimitStatus !== "rate_limited"
    && sourceWebsocketOk(source);
}

function isSourceFailClosed(source) {
  const message = `${source.status} ${source.message}`.toLowerCase();
  return ["ok", "degraded", "stopped", "not_ready"].includes(source.status)
    && source.daytradeGateGrade !== "A"
    && source.formalEntryAllowed === false
    && (source.scannerCanRunOpening === true || message.includes("formal entry not allowed") || message.includes("off-session"))
    && source.rateLimitStatus !== "rate_limited";
}

function isGateA(gate) {
  return gate.gateGrade === "A"
    && ["ready", "ok", "yes", ""].includes(gate.gateStatus.toLowerCase())
    && gate.hasCanonicalGateReason === true
    && gate.hasPriorityPoolSymbols === true
    && gate.priorityPoolSymbols === 40
    && gate.hasPriorityFreshQuoteCoverage120s === true
    && gate.priorityFreshQuoteCoverage120s >= 0.95
    && gate.hasScannerCanRunOpening === true
    && gate.scannerCanRunOpening === true
    && gate.quoteAgeSeconds <= 90
    && gate.formalEntrySpeedVerdict === "YES"
    && gateWebsocketOk(gate);
}

function isGateFailClosed(gate) {
  return gate.gateGrade !== "A"
    && gate.hasCanonicalGateReason === true
    && gate.gateStatus === "not_ready"
    && ["off_session_not_formal_entry", "formal_entry_not_allowed", "source_status_not_ok", "websocket_not_formal_ready"].includes(gate.reason)
    && gate.formalEntrySpeedVerdict === "NO";
}

function gateVerdict(source, canonicalGate, unattendedGate) {
  const sourceA = isSourceA(source);
  const sourceClosed = isSourceFailClosed(source);
  const canonicalA = isGateA(canonicalGate);
  const unattendedA = isGateA(unattendedGate);
  const canonicalClosed = isGateFailClosed(canonicalGate);
  const unattendedClosed = isGateFailClosed(unattendedGate);
  if (sourceA && canonicalA && unattendedA) return { ok: true, verdict: "A_READY_ALIGNED", mode: "formal_ready", issues: [] };
  if (sourceClosed && canonicalClosed && unattendedClosed) return { ok: true, verdict: "FAIL_CLOSED_ALIGNED", mode: "formal_entry_fail_closed", issues: [] };
  const issues = [];
  if (!sourceA && !sourceClosed) issues.push("source_status_not_a_or_fail_closed");
  if (!canonicalA && !canonicalClosed) issues.push("canonical_gate_not_a_or_fail_closed");
  if (!unattendedA && !unattendedClosed) issues.push("unattended_gate_not_a_or_fail_closed");
  return { ok: false, verdict: "NOT_ALIGNED", mode: "mismatch", issues };
}


function writerCodeRegressionChecks() {
  const writerPath = path.join(__dirname, "run-daytrade-source-writer.js");
  let source = "";
  try {
    source = fs.readFileSync(writerPath, "utf8");
  } catch (error) {
    return {
      ok: false,
      path: writerPath,
      checks: {},
      issues: [`writer_code_read_failed:${error.message}`],
    };
  }
  const checks = {
    openingDetectionPhaseExists: source.includes('"opening_detection_0900_0934"') || source.includes("'opening_detection_0900_0934'"),
    openingBoostActiveCovers0900: /openingBoostActive[\s\S]{0,240}opening_detection_0900_0934/.test(source),
    dailyVolumeFastMirrorFirst: /fugle_daytrade_daily_volume_avg[\s\S]{0,420}fugle_daily_volume_avg/.test(source),
    dailyVolumeHasAnonRetry: /for \(const service of \[true, false\]\)/.test(source),
    dailyVolumeSelectsAvg5Alias: source.includes("avg5_volume"),
    dailyVolumeSelectsStatus: source.includes("daily_volume_status"),
    dailyVolumeSourceEvidence: source.includes("daily_volume_source"),
    formalSourceAlignmentPayload: source.includes("formal_source_alignment_ok"),
    formalPrioritySpeedPayload: source.includes("formal_priority_speed_ok"),
    fullMarketSpeedNonBlockingPayload: source.includes("full_market_speed_blocking: false"),
    slowTableBatchReduction: source.includes('supabaseUpsert("fugle_daytrade_priority_pool", priorityRows, "symbol", { batchSize: 40 })')
      && source.includes('supabaseUpsert("fugle_daytrade_intraday_1m", rows, "symbol,candle_time", { batchSize: 40 })')
      && source.includes('supabaseUpsert("fugle_daytrade_futopt_quotes_live", rows, "future_symbol", { batchSize: 80 })'),
  };
  const issues = [];
  for (const [key, ok] of Object.entries(checks)) {
    if (!ok) issues.push(`writer_regression_${key}_missing`);
  }
  return { ok: issues.length === 0, path: writerPath, checks, issues };
}
async function optionalProbe(label, action) {
  try {
    return { label, ok: true, rows: await action() };
  } catch (error) {
    return { label, ok: false, error: error.message };
  }
}

async function main() {
  const anonKey = process.env.SUPABASE_ANON_KEY || readTextSecret([
    path.join("C:", "fuman-runtime", "secrets", "supabase-anon-key.txt"),
    path.join(__dirname, "..", "secrets", "supabase-anon-key.txt"),
  ]);
  if (!anonKey) throw new Error("SUPABASE_ANON_KEY is required.");

  const futoptGateSelect = "futopt_gate_status,futopt_txf_ok,txf_ok,futopt_ready_rows,futopt_stale_rows,futopt_contract_rows,latest_futopt_updated_at,latest_txf_updated_at,futopt_reason";
  const gateSelect = [
    "canonical_gate_grade",
    "canonical_gate_status",
    "canonical_gate_reason",
    "priority_pool_symbols",
    "priority_fresh_quote_coverage_120s",
    "scanner_can_run_opening",
    "quote_age_seconds",
    "fresh_quotes_120s",
    "scorecard_required_ok_count",
    "scorecard_required_count",
    "formal_entry_speed_verdict",
    "ready_ma20_continuous_symbols",
    "ready_ma35_continuous_symbols",
    "quote_transport",
    "websocket_status_ok",
    "websocket_mode",
    "websocket_connected",
    "websocket_authenticated",
    "websocket_rest_disabled",
    "websocket_formal_ready",
    "websocket_streaming_channels",
  ].join(",");  const [sourceRows, canonicalRows, unattendedRows, dailyAliasProbe, intradayRpcProbe, canonicalFutoptProbe, unattendedFutoptProbe] = await Promise.all([
    restGet(anonKey, `source_status?source_name=eq.${encodeURIComponent(SOURCE_NAME)}&select=source_name,status,updated_at,message,payload&limit=1`),
    restGet(anonKey, `v_fugle_daytrade_canonical_gate?select=${gateSelect}&limit=1`),
    restGet(anonKey, `v_fugle_daytrade_unattended_gate_status?select=${gateSelect}&limit=1`),
    optionalProbe("daily_volume_alias", () => restGet(anonKey, "fugle_daytrade_daily_volume_avg?select=symbol,avg_volume5,avg5_volume,daily_volume_status&limit=1")),
    optionalProbe("daytrade_intraday_latest_n_rpc", () => restPost(anonKey, "get_fugle_daytrade_intraday_1m_latest_n", { symbols: ["2330"], bars_per_symbol: 1 })),
    optionalProbe("canonical_futopt_gate_fields", () => restGet(anonKey, `v_fugle_daytrade_canonical_gate?select=${futoptGateSelect}&limit=1`)),
    optionalProbe("unattended_futopt_gate_fields", () => restGet(anonKey, `v_fugle_daytrade_unattended_gate_status?select=${futoptGateSelect}&limit=1`)),
  ]);

  const sourceStatus = normalizeSourceStatus(firstObject(sourceRows));
  const canonicalGate = normalizeGate(firstObject(canonicalRows));
  const unattendedGate = normalizeGate(firstObject(unattendedRows));
  const alignment = gateVerdict(sourceStatus, canonicalGate, unattendedGate);
  const issues = [...alignment.issues];
  const writerCodeRegression = writerCodeRegressionChecks();
  issues.push(...writerCodeRegression.issues);

  for (const [label, item] of [["source", sourceStatus], ["canonical", canonicalGate], ["unattended", unattendedGate]]) {
    if (item.hasPriorityPoolSymbols !== true) issues.push(`${label}_priority_pool_symbols_missing`);
    if (item.priorityPoolSymbols !== 40) issues.push(`${label}_priority_pool_symbols_not_40`);
    if (item.hasPriorityFreshQuoteCoverage120s !== true) issues.push(`${label}_priority_fresh_quote_coverage_120s_missing`);
    if (item.hasScannerCanRunOpening !== true) issues.push(`${label}_scanner_can_run_opening_missing`);
    if (item.scannerCanRunOpening !== true && item.gateGrade === "A") issues.push(`${label}_scanner_can_run_opening_false_for_a`);
    if (label !== "source" && item.hasCanonicalGateReason !== true) issues.push(`${label}_canonical_gate_reason_missing`);
    if (item.gateGrade === "A" && label !== "source" && gateWebsocketOk(item) !== true) issues.push(`${label}_websocket_formal_ready_false_for_a`);
    if ((label === "source" && item.daytradeGateGrade === "A") || (label !== "source" && item.gateGrade === "A")) {
      if (sourceWebsocketOk(item) !== true) issues.push(`${label}_websocket_evidence_not_formal`);
      if (label === "source") {
        if (item.formalGateScope !== "priority_top40") issues.push("source_formal_gate_scope_not_priority_top40");
        if (item.formalSourceName !== SOURCE_NAME) issues.push("source_formal_source_name_mismatch");
        if (!item.formalGateSource.includes("v_fugle_daytrade_canonical_gate")) issues.push("source_formal_gate_source_missing_canonical_gate");
        if (item.formalQuoteSource !== "fugle_daytrade_quotes_live") issues.push("source_formal_quote_source_mismatch");
        if (!item.formalIntraday1mSource) issues.push("source_formal_intraday_1m_source_missing");
        if (item.quoteSourceDaytradeOk !== true) issues.push("source_quote_source_daytrade_not_ok_for_a");
        if (item.intraday1mSourceDaytradeOk !== true) issues.push("source_intraday_1m_source_daytrade_not_ok_for_a");
        if (item.formalSourceAlignmentOk !== true) issues.push("source_formal_source_alignment_not_ok_for_a");
        if (item.formalPrioritySpeedOk !== true || item.gateSpeedOk !== true) issues.push("source_formal_priority_speed_not_ok_for_a");
        if (item.fullMarketSpeedBlocking !== false) issues.push("source_full_market_speed_should_be_nonblocking");
        if (item.formalSpeedScope !== "priority_top40") issues.push("source_formal_speed_scope_not_priority_top40");
      }
    }
  }

  if (!dailyAliasProbe.ok) issues.push(`daily_volume_alias_probe_failed:${dailyAliasProbe.error}`);
  const dailyAliasRows = Array.isArray(dailyAliasProbe.rows) ? dailyAliasProbe.rows : [];
  if (dailyAliasProbe.ok && dailyAliasRows.some((row) => !Object.prototype.hasOwnProperty.call(row || {}, "daily_volume_status"))) issues.push("daily_volume_status_missing_from_daily_volume_avg");
  if (dailyAliasProbe.ok && dailyAliasRows.some((row) => row && row.daily_volume_status !== "ready" && row.daily_volume_status !== "missing")) issues.push("daily_volume_status_invalid_value");
  if (!intradayRpcProbe.ok) issues.push(`daytrade_intraday_latest_n_rpc_probe_failed:${intradayRpcProbe.error}`);
  for (const probe of [canonicalFutoptProbe, unattendedFutoptProbe]) {
    if (!probe.ok) issues.push(`${probe.label}_probe_failed:${probe.error}`);
    const row = Array.isArray(probe.rows) ? probe.rows[0] : null;
    if (probe.ok && !row) issues.push(`${probe.label}_empty`);
    if (probe.ok && row) {
      for (const field of futoptGateSelect.split(",")) {
        if (!Object.prototype.hasOwnProperty.call(row, field)) issues.push(`${probe.label}_${field}_missing`);
      }
      if (!["ready", "not_required", "stale", "not_ready", "error"].includes(String(row.futopt_gate_status || ""))) issues.push(`${probe.label}_futopt_gate_status_invalid`);
      if (typeof row.futopt_txf_ok !== "boolean") issues.push(`${probe.label}_futopt_txf_ok_not_boolean`);
      if (typeof row.txf_ok !== "boolean") issues.push(`${probe.label}_txf_ok_not_boolean`);
    }
  }
  if (Math.abs(sourceStatus.priorityFreshQuoteCoverage120s - canonicalGate.priorityFreshQuoteCoverage120s) > 0.05) issues.push("source_vs_canonical_priority_coverage_mismatch");
  if (Math.abs(sourceStatus.priorityFreshQuoteCoverage120s - unattendedGate.priorityFreshQuoteCoverage120s) > 0.05) issues.push("source_vs_unattended_priority_coverage_mismatch");

  const result = {
    ok: issues.length === 0 && alignment.ok === true,
    checkedAt: new Date().toISOString(),
    sourceName: SOURCE_NAME,
    contract: "daytrade-source-contract-alignment-websocket-formal-v2",
    formalQuoteRule: "formal daytrade A requires Fugle WebSocket trades/aggregates/candles; REST may seed/backfill only",
    sourceStatus,
    canonicalGate,
    unattendedGate,
    writerCodeRegression,
    contractProbes: {
      dailyVolumeAlias: {
        ok: dailyAliasProbe.ok,
        endpoint: "fugle_daytrade_daily_volume_avg?select=symbol,avg_volume5,avg5_volume,daily_volume_status&limit=1",
        rows: Array.isArray(dailyAliasProbe.rows) ? dailyAliasProbe.rows.length : 0,
        error: dailyAliasProbe.error || "",
      },
      intradayLatestNRpc: {
        ok: intradayRpcProbe.ok,
        rpc: "get_fugle_daytrade_intraday_1m_latest_n",
        rows: Array.isArray(intradayRpcProbe.rows) ? intradayRpcProbe.rows.length : 0,
        error: intradayRpcProbe.error || "",
      },
      canonicalFutoptGateFields: {
        ok: canonicalFutoptProbe.ok,
        endpoint: `v_fugle_daytrade_canonical_gate?select=${futoptGateSelect}&limit=1`,
        rows: Array.isArray(canonicalFutoptProbe.rows) ? canonicalFutoptProbe.rows.length : 0,
        sample: Array.isArray(canonicalFutoptProbe.rows) ? canonicalFutoptProbe.rows[0] || null : null,
        error: canonicalFutoptProbe.error || "",
      },
      unattendedFutoptGateFields: {
        ok: unattendedFutoptProbe.ok,
        endpoint: `v_fugle_daytrade_unattended_gate_status?select=${futoptGateSelect}&limit=1`,
        rows: Array.isArray(unattendedFutoptProbe.rows) ? unattendedFutoptProbe.rows.length : 0,
        sample: Array.isArray(unattendedFutoptProbe.rows) ? unattendedFutoptProbe.rows[0] || null : null,
        error: unattendedFutoptProbe.error || "",
      },
    },
    issues,
    mode: alignment.mode,
    verdict: alignment.verdict,
  };
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.ok ? 0 : 1;
}

main().catch((error) => {
  console.error(`[daytrade-source-contract-alignment] ${error.message}`);
  process.exitCode = 2;
});
