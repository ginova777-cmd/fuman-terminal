"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const {
  fetchActiveCommonStockQuotes,
  fetchDailyVolumeAverages,
  fetchIntraday1mStatus,
  fetchPreopenSnapshots,
  fetchSourceStatus,
  getStrategy2SourceHealth,
} = require("../lib/supabase-public-slot");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const STATE_DIR = path.join(RUNTIME_DIR, "state");
const RECEIPT_DIR = path.join(RUNTIME_DIR, "data", "scan-receipts");
const OUT_FILE = process.env.FUMAN_SUPABASE_PUBLISH_GATE_FILE || path.join(STATE_DIR, "supabase-publish-hard-gate.json");
const ALERT_RECEIPT = process.env.FUMAN_SUPABASE_PUBLISH_GATE_ALERT_RECEIPT || path.join(RECEIPT_DIR, "supabase-publish-hard-gate-alert.json");

const MIN_QUOTE_COVERAGE = Number(process.env.FUMAN_PUBLISH_MIN_QUOTE_COVERAGE || process.env.STRATEGY2_COVERAGE_MIN_QUOTES || 0.9);
const MAX_QUOTE_AGE_SECONDS = Number(process.env.FUMAN_PUBLISH_MAX_QUOTE_AGE_SECONDS || 120);
const MIN_TODAY_1M_SYMBOLS = Number(process.env.FUMAN_PUBLISH_MIN_TODAY_1M_SYMBOLS || 1);
const MIN_READY_GE_35 = Number(process.env.FUMAN_PUBLISH_MIN_READY_GE_35 || 1);
const MAX_INTRADAY_1M_STALE_SECONDS = Number(process.env.FUMAN_PUBLISH_MAX_INTRADAY_1M_STALE_SECONDS || 180);
const MIN_PREOPEN_ROWS = Number(process.env.FUMAN_PUBLISH_MIN_PREOPEN_ROWS || 1);
const MIN_DAILY_VOLUME_COVERAGE = Number(process.env.FUMAN_PUBLISH_MIN_DAILY_VOLUME_COVERAGE || 0.5);
const SAMPLE_LIMIT = Number(process.env.FUMAN_PUBLISH_COVERAGE_SAMPLE_LIMIT || 500);

function cleanNumber(value, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value === null || value === undefined) return fallback;
  const text = String(value).replace(/[,+%]/g, "").trim();
  if (!text) return fallback;
  const number = Number(text);
  return Number.isFinite(number) ? number : fallback;
}

function ensureDirs() {
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.mkdirSync(path.dirname(ALERT_RECEIPT), { recursive: true });
}

function taipeiMinuteOfDay(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return Number(parts.hour) * 60 + Number(parts.minute);
}

function staleSeconds(value, now = new Date()) {
  const time = Date.parse(String(value || ""));
  if (!Number.isFinite(time)) return 999999;
  return Math.max(0, Math.round((now.getTime() - time) / 1000));
}

function issue(severity, id, message, details = {}) {
  return { severity, id, message, details };
}

function alertFailure(payload, dryRun = false) {
  const summary = [
    "Supabase publish hard gate blocked strategy publish.",
    `status=${payload.status}`,
    `latestRunId=${payload.latestRunId || ""}`,
    `fallbackUsed=${payload.fallbackUsed}`,
    `writeBudget=${payload.writeBudget?.status || ""}`,
    `criticalIssues=${payload.issues.length}`,
    "",
    JSON.stringify({
      sourceCoverage: payload.sourceCoverage,
      staleSeconds: payload.staleSeconds,
      issues: payload.issues.slice(0, 12),
      warnings: payload.warnings.slice(0, 12),
    }, null, 2),
  ].join("\n");

  const result = spawnSync(process.execPath, [
    "--use-system-ca",
    path.join(ROOT, "scripts", "send-workflow-alert.js"),
    "--kind=supabase-publish-hard-gate",
    `--receipt=${ALERT_RECEIPT}`,
    "--subject=Fuman Terminal Supabase publish gate blocked",
    ...(dryRun ? ["--dry-run"] : []),
  ], {
    cwd: ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      FUMAN_ALERT_KIND: "supabase-publish-hard-gate",
      FUMAN_ALERT_SOURCE: "verify-supabase-publish-hard-gate.js",
      FUMAN_ALERT_RECEIPT_FILE: ALERT_RECEIPT,
      FUMAN_ALERT_SUBJECT: "Fuman Terminal Supabase publish gate blocked",
      FUMAN_ALERT_TEXT: summary,
      ...(dryRun ? { FUMAN_ALERT_DRY_RUN: "1" } : {}),
    },
  });

  return {
    ok: result.status === 0,
    exitCode: result.status,
    receiptFile: ALERT_RECEIPT,
    stdout: String(result.stdout || "").slice(0, 1000),
    stderr: String(result.stderr || "").slice(0, 1000),
  };
}

async function buildPayload() {
  const now = new Date();
  const minute = taipeiMinuteOfDay(now);
  const marketSession = minute >= 9 * 60 && minute <= 13 * 60 + 40;
  const first1mRequired = minute >= 9 * 60 + 5 && minute <= 13 * 60 + 40;
  const hard0910Required = minute >= 9 * 60 + 10 && minute <= 13 * 60 + 40;
  const ready35Required = minute >= 9 * 60 + 30 && minute <= 13 * 60 + 40;
  const preopenRequired = minute >= 8 * 60 + 55 && minute < 9 * 60;

  const health = await getStrategy2SourceHealth({
    verifyAnonReadAccess: true,
    requireIntraday1m: false,
    maxQuoteAgeSeconds: MAX_QUOTE_AGE_SECONDS,
    minQuoteCoverage: MIN_QUOTE_COVERAGE,
    allowWarmupSource: true,
  });
  const quoteResult = await fetchActiveCommonStockQuotes({
    allowWarmupSource: true,
    maxQuoteAgeSeconds: marketSession ? MAX_QUOTE_AGE_SECONDS : 900,
    minQuoteCoverage: MIN_QUOTE_COVERAGE,
  }).catch((error) => ({ ok: false, error: error?.message || String(error), quotes: [] }));
  const quoteRows = Array.isArray(quoteResult.quotes) ? quoteResult.quotes : [];
  const quoteCodes = quoteRows.map((row) => String(row.code || row.symbol || "").replace(/\D/g, "").slice(0, 4)).filter(Boolean);
  const sampleCodes = quoteCodes.slice(0, SAMPLE_LIMIT);

  const [intradayResult, dailyResult, preopenResult, sourceStatusResult] = await Promise.all([
    sampleCodes.length ? fetchIntraday1mStatus(sampleCodes).catch((error) => ({ ok: false, error: error?.message || String(error), byCode: new Map() })) : { ok: false, error: "no quote rows", byCode: new Map() },
    sampleCodes.length ? fetchDailyVolumeAverages(sampleCodes, 5).catch((error) => ({ ok: false, error: error?.message || String(error), byCode: new Map() })) : { ok: false, error: "no quote rows", byCode: new Map() },
    fetchPreopenSnapshots([], { limit: 5000 }).catch((error) => ({ ok: false, error: error?.message || String(error), rows: [] })),
    fetchSourceStatus().catch((error) => ({ ok: false, error: error?.message || String(error), latest: null })),
  ]);

  const intradayRows = [...(intradayResult.byCode || new Map()).values()];
  const today1mSymbols = intradayRows.filter((row) => cleanNumber(row.today_candle_count ?? row.rows_today) > 0).length;
  const payloadToday1mSymbols = cleanNumber(health.payload?.today_1m_symbols || health.payload?.intraday_1m_symbols_today || health.payload?.today_candle_symbols);
  const readyGe35 = cleanNumber(health.payload?.ready_ge_35)
    || intradayRows.filter((row) => row.ready_ma35_continuous === true || row.ready_ge_35 === true || cleanNumber(row.continuous_candle_count ?? row.candle_count) >= 35).length;
  const latestCandleTime = health.payload?.latest_candle_time || health.payload?.intraday_1m_latest_candle_time || intradayRows.map((row) => row.latest_candle_time || row.updated_at).filter(Boolean).sort().at(-1) || "";
  const intraday1mStaleSeconds = cleanNumber(health.payload?.intraday_1m_stale_seconds) || staleSeconds(latestCandleTime, now);
  const freshQuoteCoverage120s = cleanNumber(health.payload?.fresh_quote_coverage_120s || health.payload?.quote_coverage_ratio || health.payload?.eligible_quote_coverage || health.quoteHealth?.coverage_120s);
  const quoteAgeSeconds = cleanNumber(health.sourceAgeSeconds ?? health.payload?.quote_age_seconds);
  const dailyRows = [...(dailyResult.byCode || new Map()).values()].filter((row) => cleanNumber(row.avgVolume || row.avg5dVolume) > 0).length;
  const dailyVolumeFreshness = cleanNumber(health.payload?.daily_volume_coverage || health.payload?.daily_volume_freshness || health.payload?.dailyVolumeFreshness)
    || (health.payload?.daily_volume_ok === true ? 1 : 0)
    || (sampleCodes.length ? dailyRows / sampleCodes.length : 0);
  const sourceStatus = health.status?.status || sourceStatusResult.latest?.status || "";
  const sourceStatusUpdatedAt = health.status?.updated_at || sourceStatusResult.latest?.updated_at || "";
  const sourceStatusStaleSeconds = staleSeconds(sourceStatusUpdatedAt, now);
  const fallbackUsed = health.fallbackUsed === true || health.payload?.fallbackUsed === true || health.payload?.fallback_used === true || quoteResult.fallbackUsed === true;
  const latestRunId = health.payload?.latest_run_id || health.payload?.latestRunId || health.latestRunId || "";
  const latestRunIdSource = health.payload?.latest_run_id || health.payload?.latestRunId
    ? "source_status.payload"
    : health.latestRunIdSource || "";
  const writeBudget = health.payload?.writeBudget || health.payload?.write_budget || { status: "read-only", allowed: false, reason: "publish hard gate is read-only" };
  const retentionOk = health.payload?.retentionOk !== false && health.payload?.retention_ok !== false;
  const sourceCoverage = {
    fresh_quote_coverage_120s: freshQuoteCoverage120s,
    today_1m_symbols: payloadToday1mSymbols || today1mSymbols,
    ready_ge_35: readyGe35,
    latest_candle_time: latestCandleTime,
    intraday_1m_stale_seconds: intraday1mStaleSeconds,
    preopen_coverage: Array.isArray(preopenResult.rows) ? preopenResult.rows.length : 0,
    daily_volume_freshness: dailyVolumeFreshness,
    quote_age_seconds: quoteAgeSeconds,
    source_status: sourceStatus,
    source_status_stale_seconds: sourceStatusStaleSeconds,
  };

  const issues = [];
  const warnings = [];
  if (sourceStatusResult.ok === false || !sourceStatus) issues.push(issue("critical", "source-status-missing", "source_status readback failed", { error: sourceStatusResult.error || "" }));
  if (marketSession && sourceStatusStaleSeconds > MAX_QUOTE_AGE_SECONDS) issues.push(issue("critical", "source-status-stale", "source_status is stale during market session", { sourceStatusStaleSeconds, max: MAX_QUOTE_AGE_SECONDS }));
  if (marketSession && !(sourceStatus === "ok" || health.payload?.source_core_ok === true || health.payload?.source_parts?.source_core_ok === true)) issues.push(issue("critical", "source-status-not-ok", "source_status is not ok during market session", { sourceStatus }));
  if (hard0910Required && freshQuoteCoverage120s < MIN_QUOTE_COVERAGE) issues.push(issue("critical", "fresh-quote-coverage-low", "fresh_quote_coverage_120s below publish threshold", { freshQuoteCoverage120s, min: MIN_QUOTE_COVERAGE }));
  if (marketSession && quoteAgeSeconds > MAX_QUOTE_AGE_SECONDS) issues.push(issue("critical", "quote-stale", "quote age exceeds publish threshold", { quoteAgeSeconds, max: MAX_QUOTE_AGE_SECONDS }));
  if (first1mRequired && sourceCoverage.today_1m_symbols < MIN_TODAY_1M_SYMBOLS) issues.push(issue("critical", "today-1m-missing", "09:05 today 1m symbols missing", { today1mSymbols: sourceCoverage.today_1m_symbols, min: MIN_TODAY_1M_SYMBOLS }));
  if (hard0910Required && intraday1mStaleSeconds > MAX_INTRADAY_1M_STALE_SECONDS) issues.push(issue("critical", "intraday-1m-stale", "intraday_1m_stale_seconds exceeds critical threshold", { intraday1mStaleSeconds, max: MAX_INTRADAY_1M_STALE_SECONDS }));
  if (ready35Required && readyGe35 < MIN_READY_GE_35) issues.push(issue("critical", "ready-ge35-low", "09:30 ready_ge_35 hard gate failed", { readyGe35, min: MIN_READY_GE_35 }));
  if (preopenRequired && sourceCoverage.preopen_coverage < MIN_PREOPEN_ROWS) issues.push(issue("critical", "preopen-coverage-low", "08:55 preopen snapshot coverage below threshold", { preopenRows: sourceCoverage.preopen_coverage, min: MIN_PREOPEN_ROWS }));
  if (dailyVolumeFreshness < MIN_DAILY_VOLUME_COVERAGE) issues.push(issue("critical", "daily-volume-freshness-low", "daily volume freshness below publish threshold", { dailyVolumeFreshness, min: MIN_DAILY_VOLUME_COVERAGE }));
  if (fallbackUsed) issues.push(issue("critical", "fallback-used", "fallbackUsed is true; fallback or old cache cannot satisfy publish gate"));
  if (retentionOk !== true) issues.push(issue("critical", "retention-not-ok", "retentionOk is not true"));
  if (!health.anonRead?.ok) issues.push(issue("critical", "anon-read-failed", "Supabase anon read target check failed", { failed: health.anonRead?.failed || [] }));
  if (!latestCandleTime && marketSession) warnings.push(issue("warning", "latest-candle-time-missing", "latest_candle_time is missing"));
  if (!latestRunId) warnings.push(issue("warning", "latest-run-id-missing", "latestRunId missing from source_status payload and readiness status"));

  const status = issues.length ? "critical" : "ready";
  return {
    ok: issues.length === 0,
    status,
    checkedAt: now.toISOString(),
    source: "supabase-publish-hard-gate",
    sourceCoverage,
    staleSeconds: Math.max(sourceStatusStaleSeconds, marketSession ? quoteAgeSeconds : 0, latestCandleTime ? intraday1mStaleSeconds : 0),
    latestRunId,
    latestRunIdSource,
    fallbackUsed,
    writeBudget,
    retentionOk,
    publishAllowed: issues.length === 0 && !fallbackUsed,
    scannerBehavior: issues.length === 0
      ? "publish_allowed"
      : "publish_blocked; preserve previous complete run; do not write latest; API/front-end must surface degraded reason",
    issues,
    warnings,
    thresholds: {
      minQuoteCoverage: MIN_QUOTE_COVERAGE,
      maxQuoteAgeSeconds: MAX_QUOTE_AGE_SECONDS,
      minToday1mSymbols: MIN_TODAY_1M_SYMBOLS,
      minReadyGe35: MIN_READY_GE_35,
      maxIntraday1mStaleSeconds: MAX_INTRADAY_1M_STALE_SECONDS,
      minPreopenRows: MIN_PREOPEN_ROWS,
      minDailyVolumeFreshness: MIN_DAILY_VOLUME_COVERAGE,
    },
    alertReceipt: ALERT_RECEIPT,
  };
}

async function main() {
  ensureDirs();
  const args = new Set(process.argv.slice(2));
  const dryRunAlert = args.has("--dry-run-alert");
  const payload = await buildPayload();
  if (!payload.ok || dryRunAlert) {
    payload.alert = alertFailure(payload, dryRunAlert);
  }
  fs.writeFileSync(OUT_FILE, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`[supabase-publish-hard-gate] status=${payload.status} ok=${payload.ok} publishAllowed=${payload.publishAllowed} fallbackUsed=${payload.fallbackUsed} issues=${payload.issues.length} warnings=${payload.warnings.length}`);
  if (!payload.ok) process.exit(1);
}

main().catch((error) => {
  ensureDirs();
  const payload = {
    ok: false,
    status: "critical",
    checkedAt: new Date().toISOString(),
    source: "supabase-publish-hard-gate",
    sourceCoverage: {},
    staleSeconds: 999999,
    latestRunId: "",
    latestRunIdSource: "",
    fallbackUsed: false,
    writeBudget: { status: "blocked", allowed: false, reason: "verifier failed before publish" },
    retentionOk: false,
    publishAllowed: false,
    scannerBehavior: "publish_blocked; preserve previous complete run; do not write latest",
    issues: [issue("critical", "supabase-publish-hard-gate-error", error?.message || String(error))],
    warnings: [],
    alertReceipt: ALERT_RECEIPT,
    error: error?.stack || error?.message || String(error),
  };
  payload.alert = alertFailure(payload);
  fs.writeFileSync(OUT_FILE, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.error(error);
  process.exit(1);
});
