"use strict";

const fs = require("fs");
const path = require("path");
const { auditRunTimeSourceSnapshot } = require("../lib/run-time-source-snapshot-contract");

const ROOT = path.resolve(__dirname, "..");
const BASE_URL = String(process.env.FUMAN_AUDIT_BASE_URL || process.env.FUMAN_API_UNATTENDED_PRODUCTION_URL || "https://fuman-terminal.vercel.app").replace(/\/+$/, "");
const OUT_FILE = path.resolve(process.env.FUMAN_PRODUCTION_API_FRESHNESS_CONTRACT_FILE || path.join(ROOT, "outputs", "production-api-freshness-contract.json"));
const TIMEOUT_MS = Math.max(5000, Number(process.env.FUMAN_PRODUCTION_API_FRESHNESS_TIMEOUT_MS || 25000));
const MEMBER_BEARER_TOKEN = [
  process.env.FUMAN_VERIFY_BEARER_TOKEN,
  process.env.FUMAN_MEMBERSHIP_BEARER_TOKEN,
  process.env.FUMAN_AUTH_BEARER_TOKEN,
  process.env.FUMAN_TEST_MEMBER_ACCESS_TOKEN,
  process.env.FUMAN_SMOKE_BEARER_TOKEN,
].map((value) => String(value || "").trim()).find(Boolean) || "";

function parseArgs(argv) {
  const values = new Map();
  const flags = new Set();
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const body = arg.slice(2);
    const at = body.indexOf("=");
    if (at >= 0) values.set(body.slice(0, at), body.slice(at + 1));
    else flags.add(body);
  }
  return { values, flags };
}

const ARGS = parseArgs(process.argv.slice(2));

function cleanNumber(value) {
  const number = Number(String(value ?? "").replace(/[,%+]/g, "").trim());
  return Number.isFinite(number) ? number : 0;
}

function compactDate(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const parsed = Date.parse(text);
  if (Number.isFinite(parsed) && /[-/:TZ ]/.test(text)) return taipeiDateKey(new Date(parsed));
  return text.replace(/\D/g, "").slice(0, 8);
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

function taipeiStamp(date = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date).replace(" ", "T");
}

function taipeiMinute(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return cleanNumber(parts.hour) * 60 + cleanNumber(parts.minute);
}

function taipeiWeekday(date = new Date()) {
  return cleanNumber(new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    weekday: "short",
  }).formatToParts(date).find((part) => part.type === "weekday")?.value
    ?.replace("Sun", "0")
    ?.replace("Mon", "1")
    ?.replace("Tue", "2")
    ?.replace("Wed", "3")
    ?.replace("Thu", "4")
    ?.replace("Fri", "5")
    ?.replace("Sat", "6"));
}

function isTaipeiWeekend(date = new Date()) {
  const day = taipeiWeekday(date);
  return day === 0 || day === 6;
}

function getPath(object, pathKey) {
  return String(pathKey).split(".").reduce((current, key) => {
    if (current && typeof current === "object" && Object.prototype.hasOwnProperty.call(current, key)) return current[key];
    return undefined;
  }, object);
}

function firstValue(object, paths) {
  for (const key of paths) {
    const value = getPath(object, key);
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return "";
}

function firstPresentValue(object, paths, fallback = null) {
  for (const key of paths) {
    const value = getPath(object, key);
    if (value !== undefined && value !== null) return value;
  }
  return fallback;
}

function evidenceFieldMissing(value, options = {}) {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (typeof value === "number") return !Number.isFinite(value);
  if (Array.isArray(value)) return options.allowEmptyArray !== true && value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false;
}

function evidenceNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(String(value).replace(/[,%+]/g, "").trim());
  return Number.isFinite(number) ? number : null;
}

function realtimeRadarEvidence(payload = {}) {
  const requiredFields = firstPresentValue(payload, ["requiredFields", "run_quality_at_publish.requiredFields", "runTimeSourceSnapshot.run_quality_at_publish.requiredFields"]);
  const blankCounts = firstPresentValue(payload, ["blankCounts", "run_quality_at_publish.blankCounts", "runTimeSourceSnapshot.run_quality_at_publish.blankCounts"]);
  const sampleMissingRows = firstPresentValue(payload, ["sampleMissingRows", "run_quality_at_publish.sampleMissingRows", "runTimeSourceSnapshot.run_quality_at_publish.sampleMissingRows"], []);
  const writeBudget = firstPresentValue(payload, ["writeBudget", "run_quality_at_publish.writeBudget", "runTimeSourceSnapshot.run_quality_at_publish.writeBudget"], {});
  const alertReceipt = firstPresentValue(payload, ["alertReceipt", "run_quality_at_publish.alertReceipt", "runTimeSourceSnapshot.run_quality_at_publish.alertReceipt"], {});
  const evidence = {
    freshQuoteCoverage120s: evidenceNumber(firstPresentValue(payload, ["fresh_quote_coverage_120s", "quote_coverage_at_run.fresh_quote_coverage_120s", "runTimeSourceSnapshot.quote_coverage_at_run.fresh_quote_coverage_120s"], null)),
    freshQuotes: evidenceNumber(firstPresentValue(payload, ["fresh_quotes", "quote_coverage_at_run.fresh_quotes", "runTimeSourceSnapshot.quote_coverage_at_run.fresh_quotes"], null)),
    activeSymbols: evidenceNumber(firstPresentValue(payload, ["active_symbols", "quote_coverage_at_run.active_symbols", "runTimeSourceSnapshot.quote_coverage_at_run.active_symbols"], null)),
    quoteAgeSeconds: evidenceNumber(firstPresentValue(payload, ["quote_age_seconds", "quote_coverage_at_run.quote_age_seconds", "runTimeSourceSnapshot.quote_coverage_at_run.quote_age_seconds"], null)),
    requiredFields,
    blankCounts,
    sampleMissingRows,
    rawKeepDays: evidenceNumber(firstPresentValue(payload, ["rawKeepDays", "run_quality_at_publish.rawKeepDays", "runTimeSourceSnapshot.run_quality_at_publish.rawKeepDays"], null)),
    writeBudget,
    writeBudgetFinalStatus: String(writeBudget?.finalStatus || "").toLowerCase(),
    writeBudgetWritesCompleted: evidenceNumber(writeBudget?.writesCompleted),
    alertReceipt,
    alertReceiptKind: String(alertReceipt?.kind || "").toLowerCase(),
    alertReceiptDeliveredAt: String(alertReceipt?.deliveredAt || ""),
  };
  const missingFields = [];
  for (const [field, value] of Object.entries({
    fresh_quote_coverage_120s: evidence.freshQuoteCoverage120s,
    fresh_quotes: evidence.freshQuotes,
    active_symbols: evidence.activeSymbols,
    quote_age_seconds: evidence.quoteAgeSeconds,
    requiredFields: evidence.requiredFields,
    blankCounts: evidence.blankCounts,
    sampleMissingRows: evidence.sampleMissingRows,
    rawKeepDays: evidence.rawKeepDays,
    "writeBudget.finalStatus": evidence.writeBudgetFinalStatus,
    "writeBudget.writesCompleted": evidence.writeBudgetWritesCompleted,
    "alertReceipt.kind": evidence.alertReceiptKind,
    "alertReceipt.deliveredAt": evidence.alertReceiptDeliveredAt,
  })) {
    if (field === "sampleMissingRows") {
      if (evidenceFieldMissing(value, { allowEmptyArray: true })) missingFields.push(field);
    } else if (evidenceFieldMissing(value)) {
      missingFields.push(field);
    }
  }
  return { ...evidence, missingFields };
}

function isMembershipProtectedResponse(response = {}, payload = {}) {
  return response.status === 401
    && payload?.protected === true
    && payload?.error === "membership_required";
}

function dueStatus(item, now = new Date()) {
  if (isTaipeiWeekend(now)) {
    return {
      due: false,
      window: item.window,
      reason: "not_due_non_trading_day_weekend",
    };
  }
  const minute = taipeiMinute(now);
  const start = item.dueStartMinute ?? 0;
  const end = item.dueEndMinute ?? (23 * 60 + 55);
  const due = minute >= start && minute <= end;
  return {
    due,
    window: item.window,
    reason: due ? "api_freshness_due" : "not_due_for_current_taipei_time",
  };
}

const API_CONTRACTS = [
  {
    key: "strategy1",
    name: "Strategy1 open buy",
    endpoint: "/api/open-buy-latest?canvas=1&compact=1&shell=1&limit=1200&live=1",
    dueStartMinute: 8 * 60 + 45,
    window: "08:45-23:55",
    staticPaths: ["/data/open-buy-latest.json"],
  },
  {
    key: "strategy2",
    name: "Strategy2 intraday",
    endpoint: "/api/strategy2-latest?compact=1&limit=1200&live=1",
    dueStartMinute: 9 * 60 + 10,
    window: "09:10-23:55",
    staticPaths: ["/data/strategy2-intraday-latest.json"],
  },
  {
    key: "strategy3",
    name: "Strategy3 late-session TV",
    endpoint: "/api/strategy3-latest?canvas=1&compact=1&shell=1&limit=1200&live=1",
    dueStartMinute: 13 * 60 + 5,
    window: "13:05-23:55",
    staticPaths: ["/data/strategy3-latest.json"],
  },
  {
    key: "strategy4",
    name: "Strategy4",
    endpoint: "/api/strategy4-latest?canvas=1&compact=1&shell=1&limit=1200&live=1",
    dueStartMinute: 16 * 60,
    window: "16:00-23:55",
    staticPaths: ["/data/strategy4-latest.json", "/data/strategy4-summary.json"],
  },
  {
    key: "strategy5",
    name: "Strategy5 chip",
    endpoint: "/api/strategy5-latest?canvas=1&compact=1&shell=1&limit=1200&live=1",
    dueStartMinute: 20 * 60 + 15,
    window: "20:15-23:55",
    staticPaths: ["/data/strategy5-latest.json"],
  },
  {
    key: "institution",
    name: "Institution buy/sell",
    endpoint: "/api/institution-latest?canvas=1&compact=1&shell=1&limit=1200&live=1",
    dueStartMinute: 13 * 60 + 20,
    window: "13:20-23:55",
    staticPaths: ["/data/institution-latest.json"],
  },
  {
    key: "warrant",
    name: "Warrant flow",
    endpoint: "/api/warrant-flow-latest?canvas=1&compact=1&shell=1&limit=1200&live=1",
    dueStartMinute: 12 * 60 + 35,
    window: "12:35-23:55",
    staticPaths: ["/data/warrant-flow-latest.json"],
  },
  {
    key: "cb",
    name: "CB detect",
    endpoint: "/api/cb-detect-latest?canvas=1&compact=1&shell=1&limit=1200&live=1",
    dueStartMinute: 21 * 60 + 25,
    window: "21:25-23:55",
    staticPaths: ["/data/cb-detect-latest.json"],
  },
  {
    key: "realtime-radar",
    name: "Realtime radar",
    endpoint: "/api/realtime-radar-latest?full=1&compact=1&shell=1&limit=1200&live=1",
    dueStartMinute: 9 * 60 + 10,
    window: "09:10-23:55",
    staticPaths: ["/data/realtime-radar-latest.json"],
  },
];

const RETIRED_CONTRACT_KEYS = new Set(["strategy1", "realtime-radar", "heatmap"]);
const ACTIVE_API_CONTRACTS = API_CONTRACTS.filter((item) => !RETIRED_CONTRACT_KEYS.has(item.key));

async function fetchJson(endpoint, expectedStatus = null) {
  const url = new URL(endpoint, BASE_URL);
  url.searchParams.set("freshnessContract", String(Date.now()));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: { Accept: "application/json", "Cache-Control": "no-cache", ...(MEMBER_BEARER_TOKEN ? { authorization: `Bearer ${MEMBER_BEARER_TOKEN}`, "x-fuman-readback-auth": "membership-bearer" } : {}) },
      signal: controller.signal,
    });
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text || "{}"); } catch {}
    return {
      ok: expectedStatus === null ? response.ok : response.status === expectedStatus,
      status: response.status,
      url: url.toString(),
      json,
      text: text.slice(0, 1200),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function sourceCoverageReady(payload) {
  const coverage = payload?.sourceCoverage || payload?.source_coverage || null;
  if (!coverage || typeof coverage !== "object") return { ready: false, reason: "sourceCoverage_missing", coverage: null };
  const status = String(
    coverage.status
    || coverage.coverageStatus
    || coverage.coverage_status
    || coverage.sourceStatus
    || coverage.qualityStatus
    || ""
  ).toLowerCase();
  const ready = coverage.ok === true
    || coverage.ready === true
    || ["ready", "ok", "complete", "fresh"].includes(status);
  return {
    ready,
    reason: ready ? "sourceCoverage_ready" : `sourceCoverage_not_ready_${status || "missing_status"}`,
    coverage,
  };
}

function fallbackDisclosure(payload) {
  const hasFallbackUsed = Object.prototype.hasOwnProperty.call(payload || {}, "fallbackUsed")
    || Object.prototype.hasOwnProperty.call(payload || {}, "fallback_used")
    || Object.prototype.hasOwnProperty.call(payload?.fallback || {}, "used");
  const fallbackUsed = payload?.fallbackUsed === true || payload?.fallback_used === true || payload?.fallback?.used === true;
  const diagnosticFallbackUsed = payload?.diagnosticFallbackUsed === true;
  const scope = payload?.fallbackScope || payload?.fallback_scope || payload?.diagnosticFallbackScope || payload?.fallback?.scope || [];
  const details = payload?.fallbackDetails || payload?.fallback_details || payload?.diagnosticFallbackDetails || payload?.fallback?.details || [];
  const hasDetails = Array.isArray(details) ? details.length > 0 : Boolean(details && typeof details === "object");
  const disclosed = hasFallbackUsed && (!fallbackUsed || hasDetails || String(payload?.fallbackReason || payload?.reason || "").trim());
  const diagnosticDisclosed = !diagnosticFallbackUsed || (Array.isArray(payload?.diagnosticFallbackScope) && payload.diagnosticFallbackScope.includes("tv_candle_diagnostic") && Array.isArray(payload?.diagnosticFallbackDetails));
  return {
    disclosed: disclosed && diagnosticDisclosed,
    hasFallbackUsed,
    fallbackUsed,
    diagnosticFallbackUsed,
    scope,
    hasDetails,
    reason: !hasFallbackUsed ? "fallbackUsed_missing" : disclosed && diagnosticDisclosed ? "fallback_disclosed" : "fallback_disclosure_incomplete",
  };
}

function runtimeSourceSnapshot(payload) {
  const capturedAt = firstValue(payload, [
    "source_snapshot_captured_at",
    "sourceSnapshotCapturedAt",
    "runTimeSourceSnapshot.capturedAt",
    "runTimeSourceSnapshot.source_snapshot_captured_at",
    "runtimeSourceSnapshot.capturedAt",
    "runtimeSourceSnapshot.source_snapshot_captured_at",
    "sourceSnapshot.capturedAt",
    "sourceSnapshot.source_snapshot_captured_at",
    "sourceEvidence.source_snapshot_captured_at",
    "sourceEvidence.runTimeSnapshot.capturedAt",
  ]);
  const sourceStatus = firstValue(payload, [
    "source_status_at_run",
    "sourceStatusAtRun",
    "runTimeSourceSnapshot.source_status_at_run",
    "runTimeSourceSnapshot.sourceStatusAtRun",
    "runtimeSourceSnapshot.source_status_at_run",
    "runtimeSourceSnapshot.sourceStatusAtRun",
    "sourceSnapshot.source_status_at_run",
    "sourceEvidence.source_status_at_run",
    "sourceEvidence.runTimeSnapshot.sourceStatusAtRun",
  ]);
  const quoteCoverage = firstValue(payload, [
    "quote_coverage_at_run",
    "quoteCoverageAtRun",
    "runTimeSourceSnapshot.quote_coverage_at_run",
    "runTimeSourceSnapshot.quoteCoverageAtRun",
    "runtimeSourceSnapshot.quote_coverage_at_run",
    "runtimeSourceSnapshot.quoteCoverageAtRun",
    "sourceSnapshot.quote_coverage_at_run",
  ]);
  const intradayReadiness = firstValue(payload, [
    "intraday_1m_readiness_at_run",
    "intraday1mReadinessAtRun",
    "runTimeSourceSnapshot.intraday_1m_readiness_at_run",
    "runTimeSourceSnapshot.intraday1mReadinessAtRun",
    "runtimeSourceSnapshot.intraday_1m_readiness_at_run",
    "runtimeSourceSnapshot.intraday1mReadinessAtRun",
    "sourceSnapshot.intraday_1m_readiness_at_run",
  ]);
  const publishQuality = firstValue(payload, [
    "run_quality_at_publish",
    "runQualityAtPublish",
    "runTimeSourceSnapshot.run_quality_at_publish",
    "runTimeSourceSnapshot.runQualityAtPublish",
    "runtimeSourceSnapshot.run_quality_at_publish",
    "runtimeSourceSnapshot.runQualityAtPublish",
    "sourceSnapshot.run_quality_at_publish",
  ]);
  const evidenceStatus = String(firstValue(payload, [
    "evidenceStatus",
    "unattendedEvidenceStatus",
    "runTimeSourceSnapshot.evidenceStatus",
    "runtimeSourceSnapshot.evidenceStatus",
  ]) || "").toLowerCase();
  const hasCapturedAt = Boolean(capturedAt);
  const hasSourceStatus = sourceStatus && typeof sourceStatus === "object";
  const hasQuoteCoverage = quoteCoverage && typeof quoteCoverage === "object";
  const hasIntradayReadiness = intradayReadiness && typeof intradayReadiness === "object";
  const hasPublishQuality = publishQuality && typeof publishQuality === "object";
  const complete = hasCapturedAt
    && (hasSourceStatus || hasQuoteCoverage || hasIntradayReadiness)
    && hasPublishQuality
    && evidenceStatus !== "insufficient"
    && evidenceStatus !== "evidence_insufficient";
  return {
    complete,
    capturedAt: capturedAt || "",
    hasSourceStatus,
    hasQuoteCoverage,
    hasIntradayReadiness,
    hasPublishQuality,
    evidenceStatus: evidenceStatus || "",
    reason: complete ? "runtime_source_snapshot_complete" : "runtime_source_snapshot_missing",
  };
}

function payloadTradeDate(payload, today = taipeiDateKey()) {
  const topLevelCandidates = [
    "tradeDate",
    "usedDate",
    "sourceDate",
    "date",
    "scanDate",
    "marketSession.marketDataDate",
    "dataFreshness.sourceDate",
    "dataFreshness.latestTradeDateKey",
    "dataFreshness.latestTradeDate",
    "freshness.marketDataDate",
    "transport.tradeDate",
  ].map((key) => compactDate(firstValue(payload, [key]))).filter(Boolean);
  const topLevelValid = topLevelCandidates.find((date) => date <= today);
  if (topLevelValid) return topLevelValid;
  const rows = Array.isArray(payload?.rows) ? payload.rows
    : Array.isArray(payload?.matches) ? payload.matches
      : Array.isArray(payload?.data) ? payload.data
        : [];
  const rowCandidates = [];
  for (const row of rows.slice(0, 20)) {
    for (const key of ["tradeDate", "usedDate", "sourceDate", "date", "quoteDate", "radarDate", "scanDate", "updatedAt", "generatedAt"]) {
      if (row?.[key]) rowCandidates.push(row[key]);
    }
  }
  return rowCandidates.map(compactDate).filter((date) => date && date <= today).sort().at(-1) || topLevelCandidates[0] || "";
}

function addFinding(target, due, severity, issue) {
  if (due) target.issues.push(issue);
  else target.warnings.push(`not_due_${issue}`);
}

async function evaluateApi(item, now) {
  const due = dueStatus(item, now);
  const result = {
    key: item.key,
    name: item.name,
    endpoint: item.endpoint,
    dueStatus: due,
    issues: [],
    warnings: [],
    evidence: {},
  };
  const response = await fetchJson(item.endpoint).catch((error) => ({
    ok: false,
    status: 0,
    json: null,
    text: error?.message || String(error),
  }));
  const payload = response.json || {};
  const membershipProtected = isMembershipProtectedResponse(response, payload);
  const today = taipeiDateKey(now);
  const tradeDate = payloadTradeDate(payload, today);
  const sourceCoverage = sourceCoverageReady(payload);
  const fallback = fallbackDisclosure(payload);
  const runtimeSnapshot = runtimeSourceSnapshot(payload);
  const snapshotAudit = auditRunTimeSourceSnapshot(payload);
  const radarEvidence = item.key === "realtime-radar" ? realtimeRadarEvidence(payload) : null;
  if (membershipProtected && !MEMBER_BEARER_TOKEN) {
    result.evidence = {
      httpStatus: response.status,
      membershipProtected: true,
      reason: payload.reason || payload.error || "membership_required",
      scope: payload.scope || item.key,
      today,
      responseText: response.text,
    };
    result.warnings.push(due.due ? "membership_protected_readback_requires_bearer_token" : "not_due_membership_protected_readback_requires_bearer_token");
    return result;
  }
  result.evidence = {
    httpStatus: response.status,
    apiOk: payload?.ok,
    apiStatus: payload?.status || payload?.qualityStatus || "",
    runId: payload?.runId || payload?.transport?.runId || "",
    tradeDate,
    today,
    count: cleanNumber(payload?.count || payload?.totalCount || payload?.resultCount || (Array.isArray(payload?.rows) ? payload.rows.length : 0)),
    cacheSource: payload?.cacheSource || payload?.source || payload?.transport?.source || "",
    sourceCoverage: {
      ready: sourceCoverage.ready,
      reason: sourceCoverage.reason,
      status: sourceCoverage.coverage?.status || sourceCoverage.coverage?.coverageStatus || sourceCoverage.coverage?.coverage_status || "",
      ok: sourceCoverage.coverage?.ok,
    },
    runtimeSourceSnapshot: runtimeSnapshot,
    fallback,
    runTimeSourceSnapshot: {
      ok: snapshotAudit.ok,
      status: snapshotAudit.status,
      missingFields: snapshotAudit.missingFields,
      capturedAt: snapshotAudit.snapshot?.source_snapshot_captured_at || "",
      evidenceStatus: payload?.evidenceStatus || payload?.sourceEvidenceStatus || "",
      unattendedStatus: payload?.unattendedStatus || payload?.unattended?.status || "",
    },
    realtimeRadarEvidence: radarEvidence,
    responseText: response.ok ? undefined : response.text,
  };
  if (response.status !== 200 || payload?.ok === false) addFinding(result, due.due, "issue", `api_not_ready_http_${response.status}`);
  if (!tradeDate) addFinding(result, due.due, "issue", "tradeDate_missing");
  if (due.due && tradeDate && tradeDate !== today) result.issues.push(`tradeDate_not_today_${tradeDate}_${today}`);
  if (!sourceCoverage.ready) addFinding(result, due.due, "issue", sourceCoverage.reason);
  if (!runtimeSnapshot.complete) addFinding(result, due.due, "issue", runtimeSnapshot.reason);
  if (!fallback.disclosed) addFinding(result, due.due, "issue", fallback.reason);
  if (!snapshotAudit.ok) addFinding(result, due.due, "issue", `run_time_source_snapshot_insufficient_${snapshotAudit.missingFields.join("_")}`);
  if (payload?.evidenceStatus === "insufficient" || payload?.sourceEvidenceStatus === "insufficient") addFinding(result, due.due, "issue", "api_evidence_status_insufficient");
  if (payload?.unattendedStatus === "NO" || payload?.unattended?.status === "NO") addFinding(result, due.due, "issue", "api_unattended_status_no");
  if (radarEvidence) {
    radarEvidence.missingFields.forEach((field) => addFinding(result, due.due, "issue", `realtime_radar_evidence_missing_${field}`));
    if (radarEvidence.freshQuoteCoverage120s !== null && radarEvidence.freshQuoteCoverage120s < 0.95) addFinding(result, due.due, "issue", `fresh_quote_coverage_120s_low_${radarEvidence.freshQuoteCoverage120s}`);
    if (radarEvidence.quoteAgeSeconds !== null && radarEvidence.quoteAgeSeconds > 120) addFinding(result, due.due, "issue", `quote_age_seconds_stale_${radarEvidence.quoteAgeSeconds}`);
    if (["", "pending", "committing", "open", "unknown"].includes(radarEvidence.writeBudgetFinalStatus)) addFinding(result, due.due, "issue", `write_budget_final_status_${radarEvidence.writeBudgetFinalStatus || "missing"}`);
    if (radarEvidence.writeBudgetWritesCompleted !== null && radarEvidence.writeBudgetWritesCompleted < 1) addFinding(result, due.due, "issue", `write_budget_writes_completed_${radarEvidence.writeBudgetWritesCompleted}`);
    if (!["smoke", "failure"].includes(radarEvidence.alertReceiptKind)) addFinding(result, due.due, "issue", `alert_receipt_kind_${radarEvidence.alertReceiptKind || "missing"}`);
    if (!radarEvidence.alertReceiptDeliveredAt) addFinding(result, due.due, "issue", "alert_receipt_deliveredAt_missing");
  }
  return result;
}

async function evaluateStatic410(paths) {
  const results = [];
  for (const staticPath of paths) {
    const response = await fetchJson(staticPath, 410).catch((error) => ({
      ok: false,
      status: 0,
      json: null,
      text: error?.message || String(error),
    }));
    results.push({
      path: staticPath,
      status: response.status,
      ok: response.status === 410,
      error: response.json?.error || "",
    });
  }
  return results;
}

async function main() {
  const now = ARGS.values.has("at")
    ? new Date(`${taipeiDateKey().slice(0, 4)}-${taipeiDateKey().slice(4, 6)}-${taipeiDateKey().slice(6, 8)}T${ARGS.values.get("at")}:00+08:00`)
    : new Date();
  const apiResults = [];
  for (const item of ACTIVE_API_CONTRACTS) {
    console.log(`[production-api-freshness] checking ${item.key}`);
    apiResults.push(await evaluateApi(item, now));
  }
  const staticPaths = [...new Set(ACTIVE_API_CONTRACTS.flatMap((item) => item.staticPaths || []))];
  const static410 = await evaluateStatic410(staticPaths);
  const staticIssues = static410.filter((item) => !item.ok).map((item) => `static_not_410_${item.path}_${item.status}`);
  const apiIssues = apiResults.flatMap((item) => item.issues.map((issue) => `${item.key}: ${issue}`));
  const warnings = apiResults.flatMap((item) => item.warnings.map((warning) => `${item.key}: ${warning}`));
  const blockers = [...apiIssues, ...staticIssues];
  const payload = {
    ok: blockers.length === 0,
    status: blockers.length ? "blocked" : "ready",
    checkedAt: new Date().toISOString(),
    taipeiCheckedAt: taipeiStamp(new Date()),
    expectedToday: taipeiDateKey(now),
    nonTradingDayWeekend: isTaipeiWeekend(now),
    productionUrl: BASE_URL,
    requirement: "production API must expose tradeDate=today after due window, run-time source snapshot evidence, sourceCoverage ready, fallback disclosure, and retired static JSON 410",
    apiResults,
    static410,
    blockers,
    warnings,
  };
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`[production-api-freshness] status=${payload.status} blockers=${blockers.length} warnings=${warnings.length} output=${OUT_FILE}`);
  if (blockers.length && !ARGS.flags.has("no-fail")) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`[production-api-freshness] failed: ${error?.stack || error?.message || String(error)}`);
  process.exitCode = 1;
});


