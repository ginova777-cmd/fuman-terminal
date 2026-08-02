#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime";
const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.FUMAN_SUPABASE_URL || "https://cpmpfhbzutkiecccekfr.supabase.co").replace(/\/+$/, "");
const REQUIRE_LIVE = process.argv.includes("--require-live");
const TAIPEI = "Asia/Taipei";
const PASS_STATUS = new Set(["ok", "ready"]);

function text(value) { return String(value ?? "").trim(); }
function number(value, fallback = null) {
  if (value === null || value === undefined || text(value) === "") return fallback;
  const parsed = Number(String(value).replace(/[% ,]/g, ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}
function bool(value) {
  if (typeof value === "boolean") return value;
  return /^(true|yes|1|ok|ready)$/i.test(text(value));
}
function readSecret(name) {
  for (const file of [path.join(RUNTIME_DIR, "secrets", name), path.join(ROOT, "secrets", name)]) {
    try { const value = fs.readFileSync(file, "utf8").trim(); if (value) return value; } catch {}
  }
  return "";
}
function taipeiNow() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TAIPEI, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { date: `${values.year}-${values.month}-${values.day}`, minutes: Number(values.hour) * 60 + Number(values.minute), iso: new Date().toISOString() };
}
function firstRow(value) { return Array.isArray(value) ? value[0] || {} : value && typeof value === "object" ? value : {}; }
function payloadOf(row) { return row?.payload && typeof row.payload === "object" ? row.payload : {}; }
function valueFrom(...values) { return values.find((value) => value !== undefined && value !== null && text(value) !== ""); }
function responseRows(response) { return Array.isArray(response?.body) ? response.body : []; }

async function restGet(key, resource, options = {}) {
  const query = resource.startsWith("/") ? resource : `/rest/v1/${resource}`;
  const response = await fetch(`${SUPABASE_URL}${query}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json", "Cache-Control": "no-store", ...(options.prefer ? { Prefer: options.prefer } : {}) },
    signal: AbortSignal.timeout ? AbortSignal.timeout(options.timeoutMs || 10000) : undefined,
  });
  const raw = await response.text();
  let body = [];
  try { body = raw ? JSON.parse(raw) : []; } catch { body = []; }
  if (!response.ok) throw new Error(`${resource} HTTP ${response.status}: ${raw.slice(0, 180)}`);
  return { body, headers: response.headers, status: response.status };
}

async function optionalGet(key, resource, options = {}) {
  try { return await restGet(key, resource, options); } catch (error) { return { body: [], error: error.message || String(error) }; }
}

async function countRows(key, view) {
  const result = await optionalGet(key, `${view}?select=symbol&limit=1000`, { prefer: "count=exact" });
  const range = result.headers?.get("content-range") || "";
  const match = range.match(/\/([0-9]+|\*)$/);
  return { rows: responseRows(result).length, exact: match && match[1] !== "*" ? Number(match[1]) : null, error: result.error || "" };
}

function staticChecks() {
  const writer = fs.readFileSync(path.join(ROOT, "scripts", "run-daytrade-source-writer.js"), "utf8");
  const historyWriter = fs.readFileSync(path.join(ROOT, "lib", "seven-strategy-daily-history-writer.js"), "utf8");
  const gateRuntime = fs.readFileSync(path.join(ROOT, "runtime-daytrade-unattended-gate-runtime.js"), "utf8");
  const collector = fs.readFileSync(path.join(ROOT, "scripts", "fugle-websocket-collector.js"), "utf8");
  const daytradeWrapper = fs.readFileSync(path.join(ROOT, "ops", "public-slot", "Run-DaytradeSourceWriter.ps1"), "utf8");
  const dedicatedSupervisor = fs.readFileSync(path.join(ROOT, "ops", "public-slot", "Run-DaytradeWebSocketCollector.ps1"), "utf8");
  const dedicatedInstaller = fs.readFileSync(path.join(ROOT, "ops", "public-slot", "install-daytrade-websocket-collector-task.ps1"), "utf8");
  const selfHeal = fs.readFileSync(path.join(ROOT, "scripts", "run-daytrade-warmup-self-heal.js"), "utf8");
  const motherScope = fs.readFileSync(path.join(ROOT, "ops", "public-slot", "DaytradeMotherPoolWarmingScopePatch_20260730.sql"), "utf8");
  const canonicalGateSql = fs.readFileSync(path.join(ROOT, "ops", "public-slot", "DaytradeSourceCanonicalGatePriorityFirstPatch_20260708.sql"), "utf8");
  const writerLeaseSql = fs.readFileSync(path.join(ROOT, "ops", "public-slot", "DaytradeSourceWriterLease_20260731.sql"), "utf8");
  const hostContractDoc = fs.readFileSync(path.join(ROOT, "ops", "public-slot", "DaytradeSourceHostContract_20260731.md"), "utf8");
  return {
    writerWebSocketEvidence: writer.includes("websocket_last_message_at") && writer.includes("websocket_fresh_symbols_120s"),
    writer0901Evidence: writer.includes("opening_0901_candle_required") && writer.includes("opening_0901_candle_schema"),
    dedicatedDaytradeQuoteSource: writer.includes('formal_quote_source: "fugle_daytrade_quotes_live"'),
    noSharedFormalFallback: writer.includes("formal_source_alignment_ok") && writer.includes("opening0901Ready"),
    historyFormalEvidenceGuard: historyWriter.includes("validateFormalSourceEvidence") && historyWriter.includes("formal_entry_allowed"),
    fullMarketSignalEvidence: writer.includes("full_market_intraday_signal_evidence") && writer.includes("full_market_bullish_gain_volume_candidates"),
    bullishGainVolumeRule: writer.includes("change_percent>2 AND ma5>ma10>ma35 AND volume_expanding"),
    volumeSurgeTop100Rule: writer.includes("total_volume>10000") && writer.includes("volume_rank<=100") && writer.includes("volume_surge_top100"),
    motherPoolDynamicRange: writer.includes("Math.min(600") && writer.includes("mother_pool_300_600_rotation"),
    priorityFromStrategyAndChipResults: ["strategy2", "strategy3", "strategy4", "strategy5", "institution", "warrant", "cb"].every((name) => writer.includes(`addMany("${name}"`)),
    gateRuntimePriorityBridgePreserved: gateRuntime.includes("readPriorityBridgeFields") && gateRuntime.includes("...readPriorityBridgeFields(),"),
    websocketCandleWarmup: writer.includes("syncWebSocketIntraday1mCandles") && writer.includes("fugle-websocket-candles-cache"),
    websocketMotherReadthrough: writer.includes("const writebackQuoteMap = new Map(quoteMap)") && writer.includes("websocket_quote_readthrough_fresh_rows"),
    motherPoolWarmingScope: motherScope.includes("basePoolPending") && motherScope.includes("create or replace view public.v_fugle_daytrade_mother_pool") && motherScope.includes("create or replace view public.v_fugle_daytrade_mother_pool_contract_health"),
    runtimePriorityArtifactContract: writer.includes("formalPriorityStrategyChip") && writer.includes("completeLatestRunEvidence") && writer.includes("top40SymbolCount"),
    strategyChipCompleteRunHardGate: writer.includes("strategyChipCompleteLatestRun") && writer.includes("strategy_chip_complete_latest_run_missing") && canonicalGateSql.includes("formal_priority_strategy_chip_complete_latest_run_evidence") && canonicalGateSql.includes("strategy_chip_complete_latest_run_missing"),
    canonicalGateLastMessageFreshness: canonicalGateSql.includes("websocket_last_message_age_seconds") && canonicalGateSql.includes("websocket_last_message_age_seconds <= 300"),
    offSessionPayloadAlignment: writer.includes('gate_grade: offSession ? "D"') && writer.includes('websocket_formal_ready: offSession ? false') && writer.includes('off_session_source_stopped'),
    websocketSilentStaleRecovery: collector.includes("STREAMING_STALE_RECONNECT_MS") && collector.includes("staleDataWindow") && collector.includes("reconnect_stale_source") && collector.includes('ws.close(1000, "stale source self-heal")'),
    daytradeSharedSourceIsolation: collector.includes("COLLECTOR_ROLE") && collector.includes("fugle-daytrade-ws-priority-symbols.json") && daytradeWrapper.includes("--daytrade-source") && daytradeWrapper.includes("FUGLE_DAYTRADE_PRIORITY_SYMBOLS_FILE") && daytradeWrapper.includes("-and\n      [string]$_.CommandLine"),
      dedicatedCollectorSupervisor: dedicatedSupervisor.includes("FumanFugleDaytradeWebSocketCollector") && dedicatedSupervisor.includes("--daytrade-source") && dedicatedSupervisor.includes("Start-Process") && dedicatedSupervisor.includes("Start-Sleep") && dedicatedSupervisor.includes("FUGLE_WS_PRIORITY_SYMBOLS_FILE") && dedicatedSupervisor.includes("FUGLE_STREAMING_STALE_RECONNECT_MS"),
    dedicatedCollectorTaskPolicy: dedicatedInstaller.includes("Fuman Fugle Daytrade WebSocket Collector 0600-1330") && dedicatedInstaller.includes("New-ScheduledTaskSettingsSet") && dedicatedInstaller.includes("MultipleInstances Ignore") && dedicatedInstaller.includes("StartWhenAvailable"),
    dedicatedCollectorStartupEvidence: dedicatedSupervisor.includes("Write-State -Status \"starting\"") && dedicatedSupervisor.includes("$mutex = $null") && dedicatedSupervisor.includes("supervisor_start"),
    selfHealWindowsSafeReceipts: selfHeal.includes("replace(/[^A-Za-z0-9._-]+/g, \"_\")") && selfHeal.includes("fs.mkdirSync(path.dirname(file), { recursive: true })"),
    nodeSourceHostApproval: writer.includes("ensureApprovedSourceHost") && collector.includes("assertApprovedDaytradeSourceHost") && writer.includes("SOURCE_HOST_APPROVAL_FILE"),
    dedicatedSupervisorHostApproval: dedicatedSupervisor.includes("daytrade_source_host_approval_missing") && dedicatedSupervisor.includes("daytrade_source_host_not_approved"),
    sourceHostApproval: daytradeWrapper.includes("Assert-DaytradeSourceHostApproval") && daytradeWrapper.includes("READ_ONLY mode: collector start skipped") && dedicatedSupervisor.includes("authoritativeWriter = $true"),
    crossHostWriterIdentity: writer.includes("source_host_id") && writer.includes("writer_instance_id") && writer.includes("ensureWriterLease") && daytradeWrapper.includes("FUMAN_DAYTRADE_SOURCE_HOST_ID") && daytradeWrapper.includes("Assert-DaytradeSourceHostApproval") && dedicatedSupervisor.includes("authoritativeWriter = $true"),
    crossHostReaderIsolation: writer.includes("daytrade_writer_host_role_required") && hostContractDoc.toLowerCase().includes("reader/viewer") && hostContractDoc.includes("service_role"),
    distributedWriterLease: writerLeaseSql.includes("claim_fugle_daytrade_source_writer_lease") && writerLeaseSql.includes("lease_expires_at") && writerLeaseSql.includes("writer_instance_id"),
  };
}

function getField(daytrade, canonical, unattended, ...names) {
  const sources = [canonical, unattended, daytrade].filter(Boolean);
  for (const source of sources) {
    for (const name of names) if (source[name] !== undefined && source[name] !== null && text(source[name]) !== "") return source[name];
    const payload = payloadOf(source);
    for (const name of names) if (payload[name] !== undefined && payload[name] !== null && text(payload[name]) !== "") return payload[name];
  }
  return null;
}

function buildDecision({ shared, daytrade, canonical, unattended, counts, time }) {
  const sourcePayload = payloadOf(daytrade);
  const canonicalRow = firstRow(canonical);
  const unattendedRow = firstRow(unattended);
  const sharedPayload = payloadOf(shared);
  const fullMarketEvidence = sourcePayload.full_market_intraday_signal_evidence && typeof sourcePayload.full_market_intraday_signal_evidence === "object"
    ? sourcePayload.full_market_intraday_signal_evidence
    : {};
  const sharedStatus = text(valueFrom(shared.source_status, shared.status, sharedPayload.source_status, sharedPayload.status)).toLowerCase();
  const daytradeStatus = text(valueFrom(daytrade.status, sourcePayload.source_status, sourcePayload.status)).toLowerCase();
  const fields = {
    shared_status: sharedStatus || "missing",
    shared_fresh_quote_coverage_120s: number(valueFrom(shared.fresh_quote_coverage_120s, sharedPayload.fresh_quote_coverage_120s), 0),
    shared_scanner_can_run_opening: bool(valueFrom(shared.scanner_can_run_opening, sharedPayload.scanner_can_run_opening)),
    daytrade_status: daytradeStatus || "missing",
    daytrade_priority_quote_coverage_120s: number(getField(sourcePayload, canonicalRow, unattendedRow, "priority_quote_coverage_120s", "priority_fresh_quote_coverage_120s", "priority_top40_fresh_quote_coverage_120s"), 0),
    daytrade_formal_entry_speed_verdict: text(getField(sourcePayload, canonicalRow, unattendedRow, "formal_entry_speed_verdict")).toUpperCase() || "MISSING",
    equity_daytrade_gate_status: text(getField(sourcePayload, canonicalRow, unattendedRow, "gate_status", "canonical_gate_status", "equity_daytrade_gate_status")).toLowerCase() || "missing",
    canonical_gate_grade: text(getField(sourcePayload, canonicalRow, unattendedRow, "gate_grade", "canonical_gate_grade", "daytrade_gate_grade")).toUpperCase() || "MISSING",
    formal_entry_allowed: bool(getField(sourcePayload, canonicalRow, unattendedRow, "formal_entry_allowed")),
    scanner_can_run_opening: bool(getField(sourcePayload, canonicalRow, unattendedRow, "scanner_can_run_opening")),
    priority_top40_ready_count: number(valueFrom(sourcePayload.priority_top40_symbols, sourcePayload.formal_daytrade_priority_symbols, sourcePayload.priority_pool_symbols), counts.priorityTop40.exact ?? counts.priorityTop40.rows),
    futopt_stock_mapped: number(getField(sourcePayload, canonicalRow, unattendedRow, "futopt_stock_mapped", "mapped_underlying_count"), 0),
    futopt_stock_this_loop: number(getField(sourcePayload, canonicalRow, unattendedRow, "futopt_stock_this_loop", "futopt_stock_quotes_this_loop"), 0),
    daily_volume_status: text(getField(sourcePayload, canonicalRow, unattendedRow, "daily_volume_status")).toLowerCase() || "missing",
    intraday_1m_stale_seconds: number(getField(sourcePayload, canonicalRow, unattendedRow, "intraday_1m_stale_seconds"), 999999),
    quote_age_seconds: number(getField(sourcePayload, canonicalRow, unattendedRow, "quote_age_seconds"), 999999),
    websocket_formal_ready: bool(getField(sourcePayload, canonicalRow, unattendedRow, "websocket_formal_ready", "websocketFormalReady")),
    full_market_signal_evidence_present: Object.keys(fullMarketEvidence).length > 0,
    full_market_signal_evidence_source: text(fullMarketEvidence.source) || "missing",
    full_market_universe: text(fullMarketEvidence.universe) || "missing",
    full_market_active_symbols: number(fullMarketEvidence.activeSymbols, 0),
    full_market_fresh_quote_coverage_120s: number(fullMarketEvidence.freshQuoteCoverage120s, 0),
    full_market_bullish_gain_volume_candidate_count: number(valueFrom(fullMarketEvidence.bullishGainVolumeCandidateCount, sourcePayload.full_market_bullish_gain_volume_candidate_count), 0),
    full_market_volume_surge_top100_candidate_count: number(valueFrom(fullMarketEvidence.volumeSurgeTop100CandidateCount, sourcePayload.full_market_volume_surge_top100_candidate_count), 0),
  };
  const failures = [];
  const fail = (ok, code, detail) => { if (!ok) failures.push({ code, detail }); };
  fail(counts.priorityTop40.exact === 40 || counts.priorityTop40.rows === 40, "priority_top40_not_40", `${counts.priorityTop40.exact ?? counts.priorityTop40.rows}/40`);
  fail(fields.daytrade_priority_quote_coverage_120s >= 0.95, "priority_quote_coverage_below_095", fields.daytrade_priority_quote_coverage_120s);
  fail(fields.scanner_can_run_opening, "scanner_can_run_opening_false", fields.scanner_can_run_opening);
  fail(fields.daytrade_formal_entry_speed_verdict === "YES", "formal_entry_speed_verdict_not_yes", fields.daytrade_formal_entry_speed_verdict);
  fail(fields.equity_daytrade_gate_status === "ready", "equity_daytrade_gate_not_ready", fields.equity_daytrade_gate_status);
  fail(fields.canonical_gate_grade === "A", "canonical_gate_not_a", fields.canonical_gate_grade);
  fail(fields.formal_entry_allowed, "formal_entry_not_allowed", fields.formal_entry_allowed);
  fail(fields.futopt_stock_mapped > 0, "futopt_stock_mapped_empty", fields.futopt_stock_mapped);
  fail(fields.futopt_stock_this_loop > 0, "futopt_stock_this_loop_empty", fields.futopt_stock_this_loop);
  fail(fields.daily_volume_status === "ready", "daily_volume_not_ready", fields.daily_volume_status);
  fail(fields.intraday_1m_stale_seconds <= 120, "intraday_1m_stale", fields.intraday_1m_stale_seconds);
  fail(fields.quote_age_seconds <= 90, "quote_stale", fields.quote_age_seconds);
  fail(PASS_STATUS.has(fields.daytrade_status), "daytrade_source_not_ready", fields.daytrade_status);
  fail(fields.websocket_formal_ready, "websocket_formal_not_ready", fields.websocket_formal_ready);
  fail(fields.full_market_signal_evidence_present, "full_market_signal_evidence_missing", fields.full_market_signal_evidence_source);
  fail(fields.full_market_universe === "full_market_active_common_stock", "full_market_universe_invalid", fields.full_market_universe);
  fail(fields.full_market_active_symbols > 0, "full_market_active_symbols_empty", fields.full_market_active_symbols);
  const formalGateReady = fields.equity_daytrade_gate_status === "ready"
    && fields.canonical_gate_grade === "A"
    && fields.daytrade_formal_entry_speed_verdict === "YES"
    && fields.formal_entry_allowed;
  const inFormalWindow = time.minutes >= 8 * 60 + 45 && time.minutes <= 13 * 60 + 30;
  if (inFormalWindow && fields.scanner_can_run_opening !== formalGateReady) {
    failures.push({
      code: "gate_field_inconsistent",
      detail: JSON.stringify({
        scanner_can_run_opening: fields.scanner_can_run_opening,
        formalGateReady,
        gate_status: fields.equity_daytrade_gate_status,
        gate_grade: fields.canonical_gate_grade,
        formal_entry_speed_verdict: fields.daytrade_formal_entry_speed_verdict,
        formal_entry_allowed: fields.formal_entry_allowed,
      }),
    });
  }
  if (time.minutes < 8 * 60 + 45 || time.minutes > 13 * 60 + 30) failures.push({ code: "observe_preserve_outside_formal_window", detail: `${time.date} ${time.minutes} Asia/Taipei` });  const sourceMismatch = fields.shared_status !== "missing" && fields.daytrade_status !== "missing" && fields.shared_status !== fields.daytrade_status;
  const sourceMismatchWarning = sourceMismatch ? { code: "source_mismatch_shared_vs_daytrade", detail: `${fields.shared_status} vs ${fields.daytrade_status}` } : null;
  return { fields, failures, sourceMismatch, warnings: sourceMismatchWarning ? [sourceMismatchWarning] : [], formalPass: failures.length === 0 };
}

async function main() {
  const staticResult = staticChecks();
  const staticFailures = Object.entries(staticResult).filter(([, ok]) => !ok).map(([name]) => `static_${name}_missing`);
  if (!REQUIRE_LIVE) {
    console.log(JSON.stringify({ ok: staticFailures.length === 0, mode: "static", checkedAt: new Date().toISOString(), static: staticResult, issues: staticFailures }, null, 2));
    process.exitCode = staticFailures.length ? 1 : 0;
    return;
  }
  const key = process.env.SUPABASE_ANON_KEY || readSecret("supabase-anon-key.txt");
  if (!key) throw new Error("missing_supabase_anon_key");
  const time = taipeiNow();
  const [sharedResult, sharedStatusResult, daytradeResult, canonicalResult, unattendedResult, priorityTop40, formalTop40, motherPool, writerLeaseResult] = await Promise.all([
    optionalGet(key, "v_fuman_shared_source_readonly_scorecard?select=*&limit=1"),
    optionalGet(key, "source_status?source_name=eq.fugle_shared_source&select=source_name,status,updated_at,payload&limit=1"),
    optionalGet(key, "source_status?source_name=eq.fugle_daytrade_source&select=source_name,status,updated_at,message,payload&limit=1"),
    optionalGet(key, "v_fugle_daytrade_canonical_gate?select=*&limit=1"),
    optionalGet(key, "v_fugle_daytrade_unattended_gate_status?select=*&limit=1"),
    countRows(key, "v_fugle_daytrade_priority_top40"),
    countRows(key, "v_fugle_daytrade_formal_priority_top40"),
    countRows(key, "v_fugle_daytrade_mother_pool"),
    optionalGet(key, "v_fugle_daytrade_source_writer_lease?select=*&limit=1"),
  ]);
  const shared = firstRow(responseRows(sharedResult).length ? sharedResult.body : sharedStatusResult.body);
  const daytrade = firstRow(daytradeResult.body);
  const canonical = firstRow(canonicalResult.body);
  const unattended = firstRow(unattendedResult.body);
  const counts = { priorityTop40, formalTop40, motherPool };
  const writerLease = firstRow(writerLeaseResult.body);
  const leaseExpiryMs = Date.parse(writerLease.lease_expires_at || "");
  const writerLeaseFailures = writerLeaseResult.error
    ? [{ code: "writer_lease_readback_unavailable", detail: writerLeaseResult.error }]
    : !writerLease.source_name
      ? [{ code: "writer_lease_not_claimed", detail: "lease view returned no row" }]
      : !Number.isFinite(leaseExpiryMs) || leaseExpiryMs <= Date.now()
        ? [{ code: "writer_lease_expired", detail: writerLease.lease_expires_at || "missing" }]
        : [];
  const decision = buildDecision({ shared, daytrade, canonical, unattended, counts, time });
  const result = {
    ok: staticFailures.length === 0 && decision.formalPass && writerLeaseFailures.length === 0,
    mode: "live_required",
    checkedAt: new Date().toISOString(),
    authoritativeTime: time,
    static: staticResult,
    sourceLayer: {
      shared: { role: "diagnostic_only", formalEntryAuthority: false, canonicalGateAuthority: false, latestPointerAuthority: false, unattendedAuthority: false, status: decision.fields.shared_status, fresh_quote_coverage_120s: decision.fields.shared_fresh_quote_coverage_120s, scanner_can_run_opening: decision.fields.shared_scanner_can_run_opening },
      daytrade: { role: "formal_authority", formalEntryAuthority: true, canonicalGateAuthority: true, latestPointerAuthority: true, unattendedAuthority: true, sourceName: "fugle_daytrade_source", status: decision.fields.daytrade_status, priority_quote_coverage_120s: decision.fields.daytrade_priority_quote_coverage_120s, formal_entry_speed_verdict: decision.fields.daytrade_formal_entry_speed_verdict },
      mismatch: decision.sourceMismatch,
      warnings: decision.warnings || [],
      writerLease,
    },
    counts,
    acceptance: decision.fields,
    failures: [...staticFailures.map((code) => ({ code, detail: true })), ...decision.failures, ...writerLeaseFailures],
    final: decision.formalPass && staticFailures.length === 0 ? "PASS" : "observe/preserve only",
    endpoints: {
      shared: "v_fuman_shared_source_readonly_scorecard or source_status:fugle_shared_source",
      daytrade: "source_status:fugle_daytrade_source",
      canonical: "v_fugle_daytrade_canonical_gate",
      unattended: "v_fugle_daytrade_unattended_gate_status",
      motherPool: "v_fugle_daytrade_mother_pool",
      priorityTop40: "v_fugle_daytrade_priority_top40",
      formalTop40: "v_fugle_daytrade_formal_priority_top40",
    },
  };
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.ok ? 0 : 1;
}

main().catch((error) => { console.error(JSON.stringify({ ok: false, mode: REQUIRE_LIVE ? "live_required" : "static", error: error.message || String(error) }, null, 2)); process.exitCode = 2; });
