"use strict";

const fs = require("fs");
const path = require("path");
const {
  fetchActiveCommonStockQuotes,
  fetchDailyVolumeAverages,
  fetchFutoptQuotesLive,
  fetchFutoptStockMappingReady,
  fetchIntraday1mStatus,
  fetchPreopenFinalBlindBuyReady,
  fetchPreopenSnapshots,
  fetchSourceStatus,
  getStrategy2SourceHealth,
} = require("../lib/supabase-public-slot");

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const STATE_DIR = path.join(RUNTIME_DIR, "state");
const LOG_DIR = path.join(RUNTIME_DIR, "logs");
const OUT_FILE = process.env.STRATEGY2_SUPABASE_COVERAGE_FILE || path.join(STATE_DIR, "strategy2-supabase-coverage.json");
const LOG_FILE = path.join(LOG_DIR, `strategy2-supabase-coverage-${dateStamp()}.log`);

const MIN_QUOTE_COVERAGE = Number(process.env.STRATEGY2_COVERAGE_MIN_QUOTES || 0.5);
const MIN_QUOTE_AGE_SECONDS = Number(process.env.STRATEGY2_COVERAGE_MAX_QUOTE_AGE_SECONDS || 120);
const MIN_QUOTES = Number(process.env.STRATEGY2_COVERAGE_MIN_QUOTE_ROWS || 1);
const MIN_1M_ROWS_TODAY = Number(process.env.STRATEGY2_COVERAGE_MIN_1M_ROWS_TODAY || 1);
const MIN_DAILY_VOLUME_COVERAGE = Number(process.env.STRATEGY2_COVERAGE_MIN_DAILY_VOLUME || 0.5);
const MIN_PREOPEN_ROWS = Number(process.env.STRATEGY2_COVERAGE_MIN_PREOPEN_ROWS || 1);
const MIN_FUTOPT_MAPPING_ROWS = Number(process.env.STRATEGY2_COVERAGE_MIN_FUTOPT_MAPPING_ROWS || 1);
const MIN_FUTOPT_QUOTE_ROWS = Number(process.env.STRATEGY2_COVERAGE_MIN_FUTOPT_QUOTES || 1);

function cleanNumber(value) {
  const number = Number(String(value ?? "").replace(/[,+%]/g, "").trim());
  return Number.isFinite(number) ? number : 0;
}

function dateStamp(date = new Date()) {
  return date.toISOString().replace(/\D/g, "").slice(0, 12);
}

function taipeiParts(date = new Date()) {
  return Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date).map((part) => [part.type, part.value]));
}

function taipeiTimestamp(date = new Date()) {
  const p = taipeiParts(date);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

function taipeiMinuteOfDay(date = new Date()) {
  const p = taipeiParts(date);
  return Number(p.hour) * 60 + Number(p.minute);
}

function parseTimeToMinute(value) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function ensureDirs() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function log(line) {
  const text = `[${taipeiTimestamp()}] ${line}`;
  console.log(text);
  fs.appendFileSync(LOG_FILE, `${text}\n`, "utf8");
}

function issue(ok, severity, id, message, details = {}) {
  return ok ? null : { severity, id, message, details };
}

function countRows(value) {
  if (Array.isArray(value)) return value.length;
  return 0;
}

function ageSeconds(value, now = new Date()) {
  const time = Date.parse(String(value || ""));
  if (!Number.isFinite(time)) return 999999;
  return Math.max(0, Math.round((now.getTime() - time) / 1000));
}

async function checkOnce() {
  const checkedAt = new Date();
  const health = await getStrategy2SourceHealth({
    verifyAnonReadAccess: true,
    requireIntraday1m: false,
    maxQuoteAgeSeconds: MIN_QUOTE_AGE_SECONDS,
    minQuotes: MIN_QUOTES,
    minQuoteCoverage: MIN_QUOTE_COVERAGE,
    allowWarmupSource: true,
  });

  const quoteResult = await fetchActiveCommonStockQuotes({
    allowWarmupSource: true,
    maxQuoteAgeSeconds: Math.max(MIN_QUOTE_AGE_SECONDS, 900),
    minQuotes: MIN_QUOTES,
    minQuoteCoverage: MIN_QUOTE_COVERAGE,
  }).catch((error) => ({ ok: false, error: error?.message || String(error), quotes: [], health }));

  const quoteRows = quoteResult.quotes || [];
  const quoteCodes = quoteRows.map((row) => String(row.code || "")).filter(Boolean);
  const statusResult = quoteCodes.length
    ? await fetchIntraday1mStatus(quoteCodes.slice(0, 500)).catch((error) => ({ ok: false, error: error?.message || String(error), byCode: new Map() }))
    : { ok: false, error: "no quote rows", byCode: new Map() };
  const dailyVolumeResult = quoteCodes.length
    ? await fetchDailyVolumeAverages(quoteCodes.slice(0, 500), 5).catch((error) => ({ ok: false, error: error?.message || String(error), byCode: new Map() }))
    : { ok: false, error: "no quote rows", byCode: new Map() };

  const preopenResult = await fetchPreopenSnapshots([], { limit: 5000 }).catch((error) => ({ ok: false, error: error?.message || String(error), rows: [] }));
  const finalBlindBuyResult = quoteCodes.length
    ? await fetchPreopenFinalBlindBuyReady(quoteCodes.slice(0, 500), { limit: 5000 }).catch((error) => ({ ok: false, error: error?.message || String(error), rows: [] }))
    : { ok: false, error: "no quote rows", rows: [] };
  const futoptMappingResult = await fetchFutoptStockMappingReady({ limit: 5000 }).catch((error) => ({ ok: false, error: error?.message || String(error), rows: [] }));
  const futoptQuoteResult = await fetchFutoptQuotesLive([], { limit: 5000 }).catch((error) => ({ ok: false, error: error?.message || String(error), bySymbol: new Map(), count: 0 }));
  const sourceStatusResult = await fetchSourceStatus().catch((error) => ({ ok: false, error: error?.message || String(error), latest: null }));

  const intradayRowsReady = [...(statusResult.byCode || new Map()).values()]
    .filter((row) => cleanNumber(row.today_candle_count ?? row.rows_today) >= MIN_1M_ROWS_TODAY)
    .length;
  const dailyVolumeRows = [...(dailyVolumeResult.byCode || new Map()).values()]
    .filter((row) => cleanNumber(row.avgVolume || row.avg5dVolume) > 0)
    .length;
  const quoteCoverage = cleanNumber(health.payload?.quote_coverage_ratio || health.payload?.eligible_quote_coverage || health.quoteHealth?.coverage_120s);
  const quoteAge = cleanNumber(health.sourceAgeSeconds ?? health.payload?.quote_age_seconds);
  const quoteCount = cleanNumber(health.payload?.quotes || health.payload?.quote_count || health.quoteHealth?.quote_count) || quoteRows.length;
  const activeSymbols = cleanNumber(health.payload?.active_symbols || health.payload?.eligible_symbols || health.payload?.symbols || health.quoteHealth?.active_symbols);
  const dailyVolumeCoverage = quoteCodes.length ? dailyVolumeRows / Math.min(quoteCodes.length, 500) : 0;
  const minuteOfDay = taipeiMinuteOfDay(checkedAt);
  const liveFreshnessRequired = minuteOfDay >= 9 * 60 && minuteOfDay <= 13 * 60 + 40;
  const strictQuoteFreshRequired = liveFreshnessRequired;
  const intraday1mMa35Required = liveFreshnessRequired && minuteOfDay >= 9 * 60 + 35;
  const sourceStatus = health.status?.status || sourceStatusResult.latest?.status || "";
  const sourceUpdatedAt = health.status?.updated_at || sourceStatusResult.latest?.updated_at || "";
  const sourceStatusAgeSeconds = ageSeconds(sourceUpdatedAt, checkedAt);
  const sourceCoreOk = health.payload?.source_core_ok === true || health.payload?.source_parts?.source_core_ok === true;
  const intraday1mOk = health.payload?.intraday_1m_ok === true || health.payload?.source_parts?.intraday_1m_ok === true;
  const intraday1mReadyGe35 = cleanNumber(health.payload?.ready_ge_35);
  const latestCandleTime = health.payload?.latest_candle_time || health.payload?.intraday_1m_latest_candle_time || "";
  const intraday1mStaleSeconds = cleanNumber(health.payload?.intraday_1m_stale_seconds) || ageSeconds(latestCandleTime, checkedAt);

  const issues = [
    issue(sourceStatusResult.ok !== false && Boolean(sourceStatusResult.latest || health.status), "critical", "source-status-missing", "source_status fugle_shared_source readback failed", { error: sourceStatusResult.error || "" }),
    issue(!strictQuoteFreshRequired || sourceStatusAgeSeconds <= MIN_QUOTE_AGE_SECONDS, "critical", "source-status-stale", `source_status updated_at age ${sourceStatusAgeSeconds}s exceeds ${MIN_QUOTE_AGE_SECONDS}s during market session`, { sourceUpdatedAt, sourceStatusAgeSeconds, max: MIN_QUOTE_AGE_SECONDS }),
    issue(!strictQuoteFreshRequired || sourceStatus === "ok" || sourceCoreOk, "critical", "source-status-not-ok", `source_status is ${sourceStatus || "missing"} during market session`, { sourceStatus, sourceCoreOk }),
    issue(
      !liveFreshnessRequired
        || health.payload?.quotes_ok === true
        || health.payload?.source_parts?.quotes_ok === true
        || quoteCoverage >= MIN_QUOTE_COVERAGE,
      "critical",
      "quotes-not-ok",
      "source_status does not report quotes_ok and quote coverage is below threshold",
      { status: health.status?.status || "", quotesOk: health.payload?.quotes_ok, quoteCoverage, minQuoteCoverage: MIN_QUOTE_COVERAGE }
    ),
    issue(!strictQuoteFreshRequired || (quoteAge > 0 && quoteAge <= MIN_QUOTE_AGE_SECONDS), "critical", "quote-age-stale", `quote age ${quoteAge || "missing"}s exceeds ${MIN_QUOTE_AGE_SECONDS}s during market session`, { quoteAge, max: MIN_QUOTE_AGE_SECONDS }),
    issue(!liveFreshnessRequired || quoteCoverage >= MIN_QUOTE_COVERAGE || health.payload?.quotes_ok === true, "critical", "quote-coverage-low", `quote coverage ${quoteCoverage} below ${MIN_QUOTE_COVERAGE}`, { quoteCoverage, min: MIN_QUOTE_COVERAGE }),
    issue(quoteCount >= MIN_QUOTES, "warning", "quote-rows-low", `quote rows ${quoteCount} below ${MIN_QUOTES}`, { quoteCount, min: MIN_QUOTES }),
    issue(Boolean(health.anonRead?.ok), "critical", "anon-read-failed", "anon read target check failed", { failed: health.anonRead?.failed || [] }),
    issue(quoteRows.length > 0, "critical", "active-quotes-empty", "fugle_quotes_live returned no active common stock quotes", { error: quoteResult.error || "" }),
    issue(intradayRowsReady > 0 || taipeiMinuteOfDay(checkedAt) < 9 * 60, "warning", "intraday-1m-not-ready", "fugle_intraday_1m status has no today rows yet", { intradayRowsReady, error: statusResult.error || "" }),
    issue(!intraday1mMa35Required || intraday1mOk, "critical", "intraday-1m-source-not-ok", "source_status reports intraday_1m_ok=false after MA35 gate time", { intraday1mOk, sourceStatus, sourceUpdatedAt }),
    issue(!intraday1mMa35Required || intraday1mReadyGe35 > 0, "critical", "intraday-1m-ready-ge35-zero", "ready_ge_35 is zero after MA35 gate time", { readyGe35: intraday1mReadyGe35, latestCandleTime: health.payload?.latest_candle_time || health.payload?.intraday_1m_latest_candle_time || "" }),
    issue(!liveFreshnessRequired || minuteOfDay < 9 * 60 + 1 || intraday1mStaleSeconds <= 180, "critical", "intraday-1m-stale-critical", "intraday_1m_stale_seconds exceeds 180s hard threshold", { intraday1mStaleSeconds, latestCandleTime }),
    issue(dailyVolumeCoverage >= MIN_DAILY_VOLUME_COVERAGE, "warning", "daily-volume-coverage-low", `daily volume coverage ${dailyVolumeCoverage.toFixed(4)} below ${MIN_DAILY_VOLUME_COVERAGE}`, { dailyVolumeRows, sampleSize: Math.min(quoteCodes.length, 500) }),
    issue(countRows(preopenResult.rows) >= MIN_PREOPEN_ROWS || taipeiMinuteOfDay(checkedAt) >= 9 * 60, "warning", "preopen-snapshot-low", "preopen snapshot rows are not ready", { rows: countRows(preopenResult.rows), error: preopenResult.error || "" }),
    issue(countRows(finalBlindBuyResult.rows) >= 0, "warning", "final-blind-buy-read-failed", "final blind buy ready read failed", { error: finalBlindBuyResult.error || "" }),
    issue(countRows(futoptMappingResult.rows) >= MIN_FUTOPT_MAPPING_ROWS, "warning", "futopt-mapping-low", "stock futures mapping rows are not ready", { rows: countRows(futoptMappingResult.rows), error: futoptMappingResult.error || "" }),
    issue(cleanNumber(futoptQuoteResult.count || futoptQuoteResult.bySymbol?.size) >= MIN_FUTOPT_QUOTE_ROWS, "warning", "futopt-quotes-low", "futopt quote rows are not ready", { rows: cleanNumber(futoptQuoteResult.count || futoptQuoteResult.bySymbol?.size), error: futoptQuoteResult.error || "" }),
  ].filter(Boolean);

  const criticalIssues = issues.filter((item) => item.severity === "critical");
  const payload = {
    ok: criticalIssues.length === 0,
    source: "strategy2-supabase-coverage",
    checkedAt: checkedAt.toISOString(),
    checkedAtTaipei: taipeiTimestamp(checkedAt),
    thresholds: {
      minQuoteCoverage: MIN_QUOTE_COVERAGE,
      maxQuoteAgeSeconds: MIN_QUOTE_AGE_SECONDS,
      minQuotes: MIN_QUOTES,
      minDailyVolumeCoverage: MIN_DAILY_VOLUME_COVERAGE,
      minPreopenRows: MIN_PREOPEN_ROWS,
      minFutoptMappingRows: MIN_FUTOPT_MAPPING_ROWS,
      minFutoptQuoteRows: MIN_FUTOPT_QUOTE_ROWS,
    },
    coverage: {
      sourceStatus,
      sourceUpdatedAt,
      sourceStatusAgeSeconds,
      sourceCoreOk,
      quotesOk: health.payload?.quotes_ok === true || health.payload?.source_parts?.quotes_ok === true,
      quoteAgeSeconds: quoteAge,
      liveFreshnessRequired,
      strictQuoteFreshRequired,
      quoteCoverageRatio: quoteCoverage,
      quoteCount,
      activeSymbols,
      activeCommonStockQuotes: quoteRows.length,
      intraday1mReadyRows: intradayRowsReady,
      intraday1mOk,
      intraday1mMa35Required,
      intraday1mReadyGe35,
      intraday1mStaleSeconds,
      dailyVolumeRows,
      dailyVolumeCoverage,
      preopenRows: countRows(preopenResult.rows),
      finalBlindBuyRows: countRows(finalBlindBuyResult.rows),
      futoptMappingRows: countRows(futoptMappingResult.rows),
      futoptQuoteRows: cleanNumber(futoptQuoteResult.count || futoptQuoteResult.bySymbol?.size),
      latestCandleTime: health.payload?.latest_candle_time || health.payload?.intraday_1m_latest_candle_time || "",
      intraday1mRowsToday: cleanNumber(health.payload?.intraday_1m_rows_today || health.payload?.intraday_1m_rows),
    },
    issues,
    healthReason: health.reason || "",
    logFile: LOG_FILE,
  };
  fs.writeFileSync(OUT_FILE, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  log(`coverage ok=${payload.ok} source=${sourceStatus || "--"} sourceAge=${sourceStatusAgeSeconds}s quotes=${quoteCount} coverage=${quoteCoverage || 0} age=${quoteAge || "--"} 1m=${intradayRowsReady} ready35=${intraday1mReadyGe35} daily=${dailyVolumeRows} preopen=${payload.coverage.preopenRows} futopt=${payload.coverage.futoptQuoteRows} issues=${issues.length}`);
  return payload;
}

async function main() {
  ensureDirs();
  const args = new Set(process.argv.slice(2));
  const watch = args.has("--watch");
  const intervalArg = process.argv.find((arg) => arg.startsWith("--interval="));
  const untilArg = process.argv.find((arg) => arg.startsWith("--until="));
  const intervalSeconds = Math.max(15, Number(intervalArg?.split("=")[1] || process.env.STRATEGY2_COVERAGE_INTERVAL_SECONDS || 60));
  const untilMinute = parseTimeToMinute(untilArg?.split("=")[1] || process.env.STRATEGY2_COVERAGE_UNTIL || "09:10");

  let last = await checkOnce();
  if (!watch) {
    if (!last.ok && args.has("--fail-on-critical")) process.exitCode = 1;
    return;
  }
  while (untilMinute == null || taipeiMinuteOfDay() <= untilMinute) {
    await new Promise((resolve) => setTimeout(resolve, intervalSeconds * 1000));
    last = await checkOnce();
  }
  if (!last.ok && args.has("--fail-on-critical")) process.exitCode = 1;
}

main().catch((error) => {
  ensureDirs();
  const payload = {
    ok: false,
    source: "strategy2-supabase-coverage",
    checkedAt: new Date().toISOString(),
    checkedAtTaipei: taipeiTimestamp(),
    issues: [{ severity: "critical", id: "coverage-script-error", message: error?.message || String(error) }],
    error: error?.stack || error?.message || String(error),
    logFile: LOG_FILE,
  };
  fs.writeFileSync(OUT_FILE, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  log(`coverage failed: ${error?.message || String(error)}`);
  process.exit(1);
});
