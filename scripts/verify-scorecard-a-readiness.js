#!/usr/bin/env node
"use strict";

const https = require("https");

const BASE_URL = String(process.env.FUMAN_SCORECARD_BASE_URL || process.env.FUMAN_PRODUCTION_URL || "https://fuman-terminal.vercel.app").replace(/\/+$/, "");

function todayTaipeiDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function fetchJson(pathname, timeoutMs = 60000) {
  const url = `${BASE_URL}${pathname}${pathname.includes("?") ? "&" : "?"}verify=${Date.now()}`;
  return new Promise((resolve, reject) => {
    const request = https.get(url, { timeout: timeoutMs, headers: { "cache-control": "no-cache", accept: "application/json" } }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => {
        try {
          resolve({ status: response.statusCode || 0, json: JSON.parse(body || "null"), body });
        } catch (error) {
          reject(new Error(`${pathname} invalid JSON HTTP ${response.statusCode}: ${error.message}; body=${body.slice(0, 240)}`));
        }
      });
    });
    request.on("timeout", () => request.destroy(new Error(`timeout ${url}`)));
    request.on("error", reject);
  });
}

function secondsFromTime(value) {
  const match = String(value || "").match(/^(\d{2}):(\d{2}):(\d{2})/);
  if (!match) return -1;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

function marketClosedEvidence(healthPayload = {}) {
  const freshness = healthPayload?.stages?.scorecardFreshness || {};
  const evidence = freshness.marketClosedEvidence || {};
  if (freshness.marketClosed === true || evidence.marketClosed === true) {
    return {
      marketClosed: true,
      reason: String(evidence.reason || freshness.reason || "market_closed"),
      source: String(evidence.source || "scorecard-health"),
    };
  }
  return { marketClosed: false, reason: "", source: "" };
}

function daytradeIssues(payload, expectedDate) {
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  const issues = [];
  if (payload.ok !== true) issues.push(`daytrade_payload_ok_${payload.ok}`);
  if (payload.table !== "public.fugle_daytrade_entry_history") issues.push(`daytrade_table_${payload.table || "missing"}`);
  if (payload.tradeDate !== expectedDate) issues.push(`daytrade_date_${payload.tradeDate || "missing"}_expected_${expectedDate}`);
  if (!String(payload.source || "").includes("supabase:public.fugle_daytrade_entry_history")) issues.push("daytrade_source_not_supabase");
  if (rows.length < 1) issues.push("daytrade_empty_rows");
  for (const [index, row] of rows.entries()) {
    if (row.trade_date !== expectedDate) issues.push(`daytrade_row_${index}_old_date`);
    const key = secondsFromTime(row.entry_time);
    if (key < secondsFromTime("09:00:00") || key > secondsFromTime("13:30:00")) issues.push(`daytrade_row_${index}_outside_window`);
    if (!String(row.symbol || "").trim()) issues.push(`daytrade_row_${index}_blank_symbol`);
    if (String(row.signal_type || "formal").toLowerCase() !== "formal") issues.push(`daytrade_row_${index}_signal_type_not_formal`);
  }
  return { rows: rows.length, issues };
}

function sevenStrategyIssues(payload, expectedDate, sourceReportsPayload) {
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  const reports = Array.isArray(sourceReportsPayload.sourceReports) ? sourceReportsPayload.sourceReports : [];
  const sourceReport = reports.find((report) => report.key === "seven_strategy_daily_history" || report.sourceName === "seven_strategy_daily_history");
  const issues = [];
  if (payload.ok !== true) issues.push(`seven_payload_ok_${payload.ok}`);
  if (payload.sourceName !== "seven_strategy_daily_history") issues.push(`seven_source_name_${payload.sourceName || "missing"}`);
  if (payload.table !== "public.seven_strategy_daily_history") issues.push(`seven_table_${payload.table || "missing"}`);
  if (payload.tradeDate !== expectedDate) issues.push(`seven_date_${payload.tradeDate || "missing"}_expected_${expectedDate}`);
  if (!String(payload.source || "").includes("supabase:public.seven_strategy_daily_history")) issues.push("seven_source_not_supabase");
  if (!sourceReport) issues.push("seven_missing_source_report");
  if (rows.length < 1) issues.push("seven_strategy_empty_rows");
  for (const [index, row] of rows.entries()) {
    if (row.tradeDate !== expectedDate) issues.push(`seven_row_${index}_old_date`);
    const key = secondsFromTime(row.detectTime);
    if (key < secondsFromTime("09:00:00") || key > secondsFromTime("13:30:00")) issues.push(`seven_row_${index}_outside_window`);
    for (const field of ["symbol", "name", "entryPrice", "strategy"]) {
      const value = row[field];
      if (value === null || value === undefined || String(value).trim() === "") issues.push(`seven_row_${index}_blank_${field}`);
    }
    if (row.signalType !== "formal" && row.signalType !== "detected") issues.push(`seven_row_${index}_bad_signal_type`);
  }
  return {
    rows: rows.length,
    formal: Number(payload.formalCount || 0),
    detected: Number(payload.detectedCount || 0),
    sourceReport: Boolean(sourceReport),
    issues,
  };
}

async function main() {
  const expectedDate = todayTaipeiDate();
  const [marketCalendar, health, daytrade, seven, reports, page] = await Promise.all([
    fetchJson("/api/market-calendar"),
    fetchJson("/api/scorecard-health"),
    fetchJson("/api/daytrade-entry-history"),
    fetchJson("/api/seven-strategy-daily-history?limit=100"),
    fetchJson("/api/source-reports"),
    fetchJson("/api/scorecard?live=1"),
  ]);
  const issues = [];
  const marketClosed = marketCalendar.status >= 200 && marketCalendar.status < 300
    && marketCalendar.json?.ok === true
    && marketCalendar.json?.marketOpen === false
    && marketCalendar.json?.formalScanSkipped === true
    && marketCalendar.json?.preservePreviousGood === true
    && marketCalendar.json?.latestPointerUpdated === false
    && marketCalendar.json?.emptyResultWritten === false;
  if (marketCalendar.status < 200 || marketCalendar.status >= 300 || marketCalendar.json?.ok !== true) issues.push(`market_calendar_${marketCalendar.status}_${marketCalendar.json?.ok}`);
  const daytradeResult = daytradeIssues(daytrade.json || {}, expectedDate);
  const sevenResult = sevenStrategyIssues(seven.json || {}, expectedDate, reports.json || {});
  const healthClosed = marketClosedEvidence(health.json || {});
  const combinedMarketClosed = marketClosed || healthClosed.marketClosed;
  if (!combinedMarketClosed && (health.status < 200 || health.status >= 300 || health.json?.ok !== true)) issues.push(`scorecard_health_${health.status}_${health.json?.ok}`);
  if (!combinedMarketClosed && (page.status < 200 || page.status >= 300 || page.json?.ok !== true)) issues.push(`scorecard_api_${page.status}_${page.json?.ok}`);
  if (!combinedMarketClosed) issues.push(...daytradeResult.issues, ...sevenResult.issues);
  const rawOk = issues.length === 0;
  const summary = [
    `rawOk=${rawOk}`,
    `base=${BASE_URL}`,
    `marketClosed=${combinedMarketClosed}`,
    `calendarClosed=${marketClosed}`,
    `healthClosed=${healthClosed.marketClosed}`,
    `closedReason=${marketCalendar.json?.closedReason || healthClosed.reason || ""}`,
    `displayTradeDate=${marketCalendar.json?.displayTradeDate || ""}`,
    `scorecardHealth=${health.status}`,
    `scorecardRunId=${page.json?.runId || ""}`,
    `daytradeRows=${daytradeResult.rows}`,
    `sevenRows=${sevenResult.rows}`,
    `sevenFormal=${sevenResult.formal}`,
    `sevenDetected=${sevenResult.detected}`,
    `sevenSourceReport=${sevenResult.sourceReport}`,
    `issues=${issues.join(",") || "none"}`,
  ].join(" ");
  console[rawOk ? "log" : "error"](`[scorecard-a-readiness] ${summary}`);
  process.exit(rawOk ? 0 : 1);
}

main().catch((error) => {
  console.error(`[scorecard-a-readiness] rawOk=false error=${error.stack || error.message || error}`);
  process.exit(1);
});
