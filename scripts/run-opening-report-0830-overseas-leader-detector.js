"use strict";

const fs = require("fs");
const path = require("path");
const { OPENING_REPORT_0830_INDUSTRY_MAP, leaderPairs } = require("./opening-report-0830-industry-map-contract.js");
const { applyLeaderFreshness, summarizeReceiptFreshness } = require("../lib/opening-report-asia-freshness");

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime";
const OUT_DIR = path.join(RUNTIME_DIR, "data", "opening-report-0830");

function argValue(name, fallback = "") {
  const prefix = `${name}=`;
  const match = process.argv.find((item) => item === name || item.startsWith(prefix));
  return match === name ? "1" : (match ? match.slice(prefix.length) : fallback);
}

function taipeiDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function ensureDir(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

function writeJson(file, value) {
  ensureDir(file);
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function cutoffMs(tradeDate) {
  return Date.parse(`${tradeDate}T08:20:00+08:00`);
}

function classifyPercent(percent) {
  const value = Number(percent);
  if (!Number.isFinite(value)) return { direction: "unknown", display: "來源不足", reason_code: "leader_numeric_missing" };
  if (value > 0.3) return { direction: "positive", display: "偏強", reason_code: "leader_positive" };
  if (value < -0.3) return { direction: "negative", display: "偏弱", reason_code: "leader_negative" };
  return { direction: "neutral", display: "中性", reason_code: "leader_neutral" };
}

function encodeYahooSymbol(symbol) {
  return encodeURIComponent(symbol).replace(/%3D/g, "%3D");
}

function dateKeyInZone(timestampSec, timeZone) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timeZone || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(timestampSec * 1000));
}

function previousTradingClose({ timestamps, closes, selectedIndex, timeZone }) {
  const selectedDate = dateKeyInZone(timestamps[selectedIndex], timeZone);
  for (let index = selectedIndex - 1; index >= 0; index -= 1) {
    if (dateKeyInZone(timestamps[index], timeZone) !== selectedDate && Number.isFinite(Number(closes[index])) && Number(closes[index]) > 0) {
      return Number(closes[index]);
    }
  }
  return null;
}

async function fetchJson(url) {
  const attempts = [];
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { "user-agent": "Mozilla/5.0 FumanTerminal/1.0" },
        signal: AbortSignal.timeout ? AbortSignal.timeout(9000) : undefined,
      });
      const text = await response.text();
      attempts.push({ attempt, status: response.status });
      if (response.ok) return { ok: true, status: response.status, json: JSON.parse(text), attempts };
      if (response.status !== 429 && response.status < 500) return { ok: false, status: response.status, text: text.slice(0, 300), attempts };
    } catch (error) {
      attempts.push({ attempt, status: 0, error: error?.message || String(error) });
    }
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 1200));
  }
  return { ok: false, status: attempts.at(-1)?.status || 0, attempts };
}

async function yahooChartSnapshot(leader, tradeDate) {
  if (!leader.yahoo) {
    return {
      ok: false,
      source: "manual_background_metric",
      source_url: "",
      reason_code: leader.reason_code || "leader_without_public_intraday_symbol",
      attempts: [],
    };
  }
  const cut = cutoffMs(tradeDate);
  const period1 = Math.floor((cut - 8 * 24 * 3600 * 1000) / 1000);
  const period2 = Math.floor((cut + 60 * 1000) / 1000);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeYahooSymbol(leader.yahoo)}?period1=${period1}&period2=${period2}&interval=5m&includePrePost=false`;
  const fetched = await fetchJson(url);
  if (!fetched.ok) return { ok: false, source: "Yahoo Finance chart", source_url: url, reason_code: `yahoo_chart_http_${fetched.status || 0}`, attempts: fetched.attempts };
  const result = fetched.json?.chart?.result?.[0];
  const timestamps = Array.isArray(result?.timestamp) ? result.timestamp : [];
  const quote = result?.indicators?.quote?.[0] || {};
  const closes = Array.isArray(quote.close) ? quote.close : [];
  let selected = -1;
  for (let index = 0; index < timestamps.length; index += 1) {
    const ms = timestamps[index] * 1000;
    if (ms <= cut && Number.isFinite(Number(closes[index])) && Number(closes[index]) > 0) selected = index;
  }
  if (selected < 0) return { ok: false, source: "Yahoo Finance chart", source_url: url, reason_code: "no_bar_at_or_before_0820_cutoff", attempts: fetched.attempts };
  const selectedMs = timestamps[selected] * 1000;
  const asiaWindowStart = Date.parse(`${tradeDate}T08:00:00+08:00`);
  const asiaEarlySessionRequired = /\.(?:T|KS)$/i.test(String(leader.yahoo || ""));
  if (asiaEarlySessionRequired && (selectedMs < asiaWindowStart || selectedMs > cut)) {
    return {
      ok: false,
      source: "Yahoo Finance chart",
      source_url: url,
      ticker: leader.yahoo,
      selected_time: new Date(selectedMs).toISOString(),
      cutoff: `${tradeDate} 08:20:00 Asia/Taipei`,
      reason_code: "asia_no_bar_in_0800_0820_window",
      attempts: fetched.attempts,
    };
  }
  const close = Number(closes[selected]);
  const previousClose = previousTradingClose({
    timestamps,
    closes,
    selectedIndex: selected,
    timeZone: result?.meta?.exchangeTimezoneName || result?.meta?.timezone || "UTC",
  });
  const percent = Number.isFinite(previousClose) && previousClose > 0 ? ((close - previousClose) / previousClose) * 100 : null;
  const classified = classifyPercent(percent);
  return {
    ok: Number.isFinite(percent),
    source: "Yahoo Finance chart",
    source_url: url,
    ticker: leader.yahoo,
    selected_time: new Date(timestamps[selected] * 1000).toISOString(),
    cutoff: `${tradeDate} 08:20:00 Asia/Taipei`,
    close: Number(close.toFixed(4)),
    previous_close: Number.isFinite(previousClose) ? Number(previousClose.toFixed(4)) : null,
    percent: Number.isFinite(percent) ? Number(percent.toFixed(2)) : null,
    direction: classified.direction,
    display: classified.display,
    reason_code: Number.isFinite(percent) ? classified.reason_code : "previous_close_missing",
    attempts: fetched.attempts,
  };
}

const INDUSTRIES = OPENING_REPORT_0830_INDUSTRY_MAP.map((row) => ({
  industry: row.industry,
  display_name: row.display_name,
  leaders: leaderPairs(row),
}));

async function detectLeader(industry, leader, tradeDate) {
  const [name, yahoo, reason] = leader;
  const y = await yahooChartSnapshot({ name, yahoo, reason_code: reason }, tradeDate);
  return applyLeaderFreshness({
    name,
    yahoo_symbol: yahoo || "",
    industry: industry.industry,
    ok: y.ok === true,
    source: y.source,
    source_url: y.source_url,
    source_time: y.selected_time || "",
    percent: y.percent ?? null,
    display: y.display || "來源不足",
    direction: y.direction || "unknown",
    close: y.close ?? null,
    previous_close: y.previous_close ?? null,
    reason_code: y.reason_code,
  }, tradeDate);
}

function industrySummary(industry, rows) {
  const valid = rows.filter((row) => row.ok && Number.isFinite(Number(row.percent)));
  const unavailable = rows.filter((row) => !row.ok);
  const avg = valid.length ? valid.reduce((sum, row) => sum + Number(row.percent), 0) / valid.length : null;
  const classified = classifyPercent(avg);
  return {
    industry: industry.industry,
    display_name: industry.display_name,
    leader_count: rows.length,
    valid_count: valid.length,
    unavailable_count: unavailable.length,
    average_percent: avg === null ? null : Number(avg.toFixed(2)),
    display: avg === null ? "來源不足" : classified.display,
    direction: avg === null ? "unknown" : classified.direction,
    reason_code: avg === null ? "industry_no_valid_leader_snapshot" : classified.reason_code,
    leaders: rows,
  };
}

async function main() {
  const tradeDate = argValue("--date", process.env.FUMAN_TRADE_DATE || taipeiDateKey());
  const runId = argValue("--run-id", `overseas-leaders-0830-${tradeDate.replace(/\D/g, "")}-${Date.now()}`);
  const industries = [];
  for (const industry of INDUSTRIES) {
    const rows = [];
    for (const leader of industry.leaders) rows.push(await detectLeader(industry, leader, tradeDate));
    industries.push(industrySummary(industry, rows));
  }
  const allLeaders = industries.flatMap((row) => row.leaders);
  const freshness = summarizeReceiptFreshness({ industries }, tradeDate);
  const receipt = {
    contract: "opening-report-0830-overseas-leaders-v2",
    ok: allLeaders.some((row) => row.ok),
    date: tradeDate,
    run_id: runId,
    checked_at: new Date().toISOString(),
    cutoff: `${tradeDate} 08:20:00 Asia/Taipei`,
    source_policy: "US uses the previous official close; Japan and Korea use the 08:00-08:20 Asia/Taipei early-session window. Later data must not be backfilled into the 08:30 report.",
    total_leaders: allLeaders.length,
    valid_leaders: allLeaders.filter((row) => row.ok).length,
    unavailable_leaders: allLeaders.filter((row) => !row.ok).length,
    source_gap_leaders: freshness.source_gap_count,
    stale_promoted_leaders: freshness.stale_promoted_count,
    source_freshness_policy: "Japan and Korea leaders outside the same-day 08:00-08:20 Asia/Taipei window are source_gap and contribute no industry score. Other industries remain publishable.",
    industries,
  };
  const file = path.join(OUT_DIR, `overseas-leaders-0830-${tradeDate.replace(/\D/g, "")}.json`);
  writeJson(file, receipt);
  console.log(JSON.stringify({ ok: receipt.ok, file, total_leaders: receipt.total_leaders, valid_leaders: receipt.valid_leaders, unavailable_leaders: receipt.unavailable_leaders }, null, 2));
  if (!receipt.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
