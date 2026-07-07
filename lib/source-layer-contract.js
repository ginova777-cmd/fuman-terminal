"use strict";

function taipeiParts(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date).reduce((acc, part) => {
    if (part.type !== "literal") acc[part.type] = part.value;
    return acc;
  }, {});
}

function taipeiMinuteOfDay(date = new Date()) {
  const parts = taipeiParts(date);
  return Number(parts.hour || 0) * 60 + Number(parts.minute || 0);
}

function classifyTaipeiSourcePhase(date = new Date()) {
  const minute = taipeiMinuteOfDay(date);
  const parts = taipeiParts(date);
  const ymd = `${parts.year}-${parts.month}-${parts.day}`;
  if (minute < 8 * 60 + 30) {
    return { phase: "pre_warmup", ymd, minuteOfDay: minute, strictLiveQuoteRequired: false, formalScannerWindow: false, displayReadbackAllowed: true };
  }
  if (minute < 9 * 60) {
    return { phase: "preopen_warmup", ymd, minuteOfDay: minute, strictLiveQuoteRequired: false, formalScannerWindow: false, displayReadbackAllowed: true };
  }
  if (minute <= 13 * 60 + 30) {
    return { phase: "regular_session", ymd, minuteOfDay: minute, strictLiveQuoteRequired: true, formalScannerWindow: true, displayReadbackAllowed: true };
  }
  if (minute <= 14 * 60 + 5) {
    return { phase: "post_close_grace", ymd, minuteOfDay: minute, strictLiveQuoteRequired: false, formalScannerWindow: false, displayReadbackAllowed: true };
  }
  return { phase: "off_session", ymd, minuteOfDay: minute, strictLiveQuoteRequired: false, formalScannerWindow: false, displayReadbackAllowed: true };
}

function cleanNumber(value, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value ?? "").replace(/[,％%]/g, "").trim();
  if (!text) return fallback;
  const number = Number(text);
  return Number.isFinite(number) ? number : fallback;
}

function boolValue(value, fallback = false) {
  if (value === true || value === false) return value;
  if (value === null || value === undefined || value === "") return fallback;
  return /^(1|true|yes|ok|ready|a|allow|allowed)$/i.test(String(value).trim());
}

function evaluateSharedMarketSource(row = {}, options = {}) {
  const phase = options.phase || classifyTaipeiSourcePhase(options.now || new Date());
  const minCoverage = Number(options.minFreshQuoteCoverage120s ?? 0.9);
  const maxQuoteAgeSeconds = Number(options.maxQuoteAgeSeconds ?? 120);
  const maxIntraday1mStaleSeconds = Number(options.maxIntraday1mStaleSeconds ?? 120);
  const minReadyMa35Continuous = Number(options.minReadyMa35Continuous ?? 1500);
  const metrics = {
    freshQuoteCoverage120s: cleanNumber(row.fresh_quote_coverage_120s ?? row.freshQuoteCoverage120s, 0),
    freshQuotes120: cleanNumber(row.fresh_quotes_120s ?? row.freshQuotes120 ?? row.fresh_quote_count_120s, 0),
    activeSymbols: cleanNumber(row.active_symbols ?? row.activeSymbols, 0),
    quoteAgeSeconds: cleanNumber(row.quote_age_seconds ?? row.quoteAgeSeconds, 999999),
    intraday1mStaleSeconds: cleanNumber(row.intraday_1m_stale_seconds ?? row.intraday1mStaleSeconds, 999999),
    readyMa35Continuous: cleanNumber(row.ready_ma35_continuous ?? row.readyMa35Continuous, 0),
    scannerCanRunQuoteOnly: boolValue(row.scanner_can_run_quote_only ?? row.scannerCanRunQuoteOnly, false),
    scannerCanRunOpening: boolValue(row.scanner_can_run_opening ?? row.scannerCanRunOpening, false),
  };
  const issues = [];
  if (metrics.freshQuoteCoverage120s < minCoverage) issues.push(`fresh_quote_coverage_120s_${metrics.freshQuoteCoverage120s}_below_${minCoverage}`);
  if (metrics.quoteAgeSeconds > maxQuoteAgeSeconds) issues.push(`quote_age_seconds_${metrics.quoteAgeSeconds}_above_${maxQuoteAgeSeconds}`);
  if (metrics.intraday1mStaleSeconds > maxIntraday1mStaleSeconds) issues.push(`intraday_1m_stale_seconds_${metrics.intraday1mStaleSeconds}_above_${maxIntraday1mStaleSeconds}`);
  if (metrics.readyMa35Continuous < minReadyMa35Continuous) issues.push(`ready_ma35_continuous_${metrics.readyMa35Continuous}_below_${minReadyMa35Continuous}`);

  if (!phase.strictLiveQuoteRequired) {
    return {
      ok: true,
      layer: "shared_market",
      status: "off_session_not_required",
      liveScannerAllowed: false,
      displayReadbackAllowed: phase.displayReadbackAllowed,
      reason: `${phase.phase}_strict_120s_quote_freshness_not_required`,
      phase,
      metrics,
      strictIssuesIfInSession: issues,
      issues: [],
    };
  }

  const liveOk = issues.length === 0 && metrics.scannerCanRunQuoteOnly === true;
  return {
    ok: liveOk,
    layer: "shared_market",
    status: liveOk ? "ready" : "critical",
    liveScannerAllowed: liveOk,
    displayReadbackAllowed: liveOk,
    reason: liveOk ? "shared_market_live_source_ready" : "shared_market_live_source_not_ready",
    phase,
    metrics,
    issues,
  };
}

function strategySourceLayer(strategy) {
  const key = String(strategy || "").toLowerCase();
  if (["strategy1", "strategy2", "strategy3", "seven-strategies", "seven", "daytrade"].includes(key)) return "daytrade_dedicated";
  if (["heatmap", "market-ai", "market_ai", "realtime-radar", "realtime_radar"].includes(key)) return "shared_market";
  if (["strategy4", "strategy5", "institution", "cb", "warrant"].includes(key)) return "daily_after_close";
  return "strategy_specific";
}

module.exports = {
  taipeiParts,
  taipeiMinuteOfDay,
  classifyTaipeiSourcePhase,
  evaluateSharedMarketSource,
  strategySourceLayer,
};
