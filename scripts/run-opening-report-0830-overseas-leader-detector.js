"use strict";

const fs = require("fs");
const path = require("path");
const { OPENING_REPORT_0830_INDUSTRY_MAP, leaderPairs } = require("./opening-report-0830-industry-map-contract.js");
const { applyLeaderFreshness, summarizeReceiptFreshness } = require("../lib/opening-report-asia-freshness");
const { buildUsEquityMarketCalendar } = require("./us-equity-market-calendar.js");

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
  return Date.parse(`${tradeDate}T08:20:59.999+08:00`);
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
  // US leaders must include the overnight after-hours/pre-market session that is
  // available at the 08:20 Taipei freeze.  Japan/Korea are still constrained
  // below to their 08:00-08:20 Asia/Taipei window.
  const includePrePost = true;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeYahooSymbol(leader.yahoo)}?period1=${period1}&period2=${period2}&interval=5m&includePrePost=${includePrePost}`;
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
  const usLeader = !/\.(?:T|KS|KQ)$/i.test(String(leader.yahoo || ""));
  if (selected < 0) return { ok: false, source: "Yahoo Finance chart", source_url: url, reason_code: usLeader ? "us_overnight_bar_missing_before_0820" : "no_bar_at_or_before_0820_cutoff", attempts: fetched.attempts };
  const selectedMs = timestamps[selected] * 1000;
  const asiaWindowStart = Date.parse(`${tradeDate}T08:00:00+08:00`);
  const asiaEarlySessionRequired = /\.(?:T|KS|KQ)$/i.test(String(leader.yahoo || ""));
  if (asiaEarlySessionRequired && (selectedMs < asiaWindowStart || selectedMs > cut)) {
    return {
      ok: false,
      source: "Yahoo Finance chart",
      source_url: url,
      ticker: leader.yahoo,
      selected_time: new Date(selectedMs).toISOString(),
      cutoff: `${tradeDate} 08:20:59 Asia/Taipei`,
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
    cutoff: `${tradeDate} 08:20:59 Asia/Taipei`,
    close: Number(close.toFixed(4)),
    previous_close: Number.isFinite(previousClose) ? Number(previousClose.toFixed(4)) : null,
    percent: Number.isFinite(percent) ? Number(percent.toFixed(2)) : null,
    direction: classified.direction,
    display: classified.display,
    session_contract: usLeader ? "us_overnight_after_hours" : "08:00-08:20 Asia/Taipei",
    reason_code: Number.isFinite(percent) ? (usLeader ? "us_overnight_after_hours" : classified.reason_code) : "previous_close_missing",
    attempts: fetched.attempts,
  };
}

function koreanCode(symbol) {
  const match = String(symbol || "").match(/^(\d{6})\.(?:KS|KQ)$/i);
  return match ? match[1] : "";
}

function naverLocalTradedAtMs(value) {
  const text = String(value || "").trim();
  if (!text) return NaN;
  if (/[zZ]$|[+-]\d\d:?\d\d$/.test(text)) return Date.parse(text);
  return Date.parse(`${text}+09:00`);
}

function parseNaverKoreaBasic(json, leader, tradeDate, sourceUrl = "") {
  const expectedCode = koreanCode(leader.yahoo);
  const returnedCode = String(json?.itemCode || "").trim();
  const sourceMs = naverLocalTradedAtMs(json?.localTradedAt);
  const percent = Number(json?.fluctuationsRatio);
  const windowStart = Date.parse(`${tradeDate}T08:00:00+08:00`);
  const windowCutoff = cutoffMs(tradeDate);
  const base = {
    source: "Naver Finance KRX basic",
    source_url: sourceUrl,
    ticker: leader.yahoo,
    selected_time: Number.isFinite(sourceMs) ? new Date(sourceMs).toISOString() : "",
    cutoff: `${tradeDate} 08:20:59 Asia/Taipei`,
    source_fields: ["fluctuationsRatio", "localTradedAt"],
    session_contract: "08:00-08:20 Asia/Taipei",
  };
  if (!expectedCode || returnedCode !== expectedCode) return { ...base, ok: false, reason_code: "naver_korea_symbol_mismatch" };
  if (!Number.isFinite(sourceMs)) return { ...base, ok: false, reason_code: "naver_korea_source_time_missing" };
  if (sourceMs < windowStart || sourceMs > windowCutoff) return { ...base, ok: false, reason_code: "naver_korea_outside_0800_0820_window" };
  if (!Number.isFinite(percent)) return { ...base, ok: false, reason_code: "naver_korea_percent_missing" };
  const rounded = Number(percent.toFixed(2));
  const classified = classifyPercent(rounded);
  return {
    ...base,
    ok: true,
    percent: rounded,
    direction: classified.direction,
    display: classified.display,
    reason_code: "korea_naver_change_percent_primary",
  };
}

const naverCache = new Map();
async function naverKoreaSnapshot(leader, tradeDate) {
  const code = koreanCode(leader.yahoo);
  const url = `https://m.stock.naver.com/api/stock/${code}/basic`;
  const cacheKey = `${tradeDate}:${code}`;
  if (!naverCache.has(cacheKey)) naverCache.set(cacheKey, fetchJson(url));
  const fetched = await naverCache.get(cacheKey);
  if (!fetched.ok) return { ok: false, source: "Naver Finance KRX basic", source_url: url, source_fields: ["fluctuationsRatio", "localTradedAt"], reason_code: `naver_korea_http_${fetched.status || 0}`, attempts: fetched.attempts };
  return { ...parseNaverKoreaBasic(fetched.json, leader, tradeDate, url), attempts: fetched.attempts };
}

const INDUSTRIES = OPENING_REPORT_0830_INDUSTRY_MAP.map((row) => ({
  industry: row.industry,
  display_name: row.display_name,
  leaders: leaderPairs(row),
}));

async function detectLeader(industry, leader, tradeDate, usMarket) {
  const [name, yahoo, reason] = leader;
  const korea = /\.(?:KS|KQ)$/i.test(String(yahoo || ""));
  const asia = /\.(?:T|KS|KQ)$/i.test(String(yahoo || ""));
  const usLeader = Boolean(yahoo) && !asia;
  const y = korea
    ? await naverKoreaSnapshot({ name, yahoo, reason_code: reason }, tradeDate)
    : await yahooChartSnapshot({ name, yahoo, reason_code: reason }, tradeDate);
  const noNewUsSession = usLeader && usMarket?.no_new_us_session === true;
  return applyLeaderFreshness({
    name,
    yahoo_symbol: yahoo || "",
    industry: industry.industry,
    ok: noNewUsSession ? false : y.ok === true,
    source: y.source,
    source_url: y.source_url,
    source_time: y.selected_time || "",
    percent: noNewUsSession ? null : (y.percent ?? null),
    display: noNewUsSession ? "美股休市／無新 session" : (y.display || "來源不足"),
    direction: noNewUsSession ? "unknown" : (y.direction || "unknown"),
    close: y.close ?? null,
    previous_close: y.previous_close ?? null,
    source_fields: y.source_fields,
    reason_code: noNewUsSession ? "us_market_closed_no_new_session" : y.reason_code,
    source_gap: false,
    us_market_status: usLeader ? usMarket?.us_market_status : undefined,
    us_session_date: usLeader ? usMarket?.us_session_date : undefined,
    us_holiday_name: usLeader ? usMarket?.us_holiday_name : undefined,
    us_closed_reason: usLeader ? usMarket?.us_closed_reason : undefined,
    no_new_us_session: usLeader ? usMarket?.no_new_us_session : undefined,
    previous_official_session_date: usLeader ? usMarket?.previous_official_session_date : undefined,
    session_contract: noNewUsSession ? "us_market_closed_previous_session_background_only" : y.session_contract,
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
  const usMarket = buildUsEquityMarketCalendar(tradeDate);
  const industries = [];
  for (const industry of INDUSTRIES) {
    const rows = [];
    for (const leader of industry.leaders) rows.push(await detectLeader(industry, leader, tradeDate, usMarket));
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
    cutoff: `${tradeDate} 08:20:59 Asia/Taipei`,
    source_policy: "US market-closed sessions are labeled and excluded from ranking; fresh Japan/Korea 08:00-08:20 Asia/Taipei evidence remains eligible. Later data must not be backfilled.",
    us_market: usMarket,
    total_leaders: allLeaders.length,
    valid_leaders: allLeaders.filter((row) => row.ok).length,
    unavailable_leaders: allLeaders.filter((row) => !row.ok).length,
    source_gap_leaders: freshness.source_gap_count,
    stale_promoted_leaders: freshness.stale_promoted_count,
    source_freshness_policy: "Japan and Korea leaders outside the same-day 08:00-08:20 Asia/Taipei window are source_gap and contribute no industry score. Other industries remain publishable.",
    korea_source_contract: "korea_direct_naver_change_percent_only_v1",
    korea_direct_source: "Naver Finance KRX basic",
    korea_direct_valid_count: allLeaders.filter((row) => /\.(?:KS|KQ)$/i.test(row.yahoo_symbol || "") && row.ok === true && row.source === "Naver Finance KRX basic").length,
    overseas_source_counts: allLeaders.reduce((out, row) => { const key = row.source || "unknown"; out[key] = (out[key] || 0) + 1; return out; }, {}),
    industries,
  };
  const file = path.join(OUT_DIR, `overseas-leaders-0830-${tradeDate.replace(/\D/g, "")}.json`);
  writeJson(file, receipt);
  console.log(JSON.stringify({ ok: receipt.ok, file, total_leaders: receipt.total_leaders, valid_leaders: receipt.valid_leaders, unavailable_leaders: receipt.unavailable_leaders }, null, 2));
  if (!receipt.ok) process.exitCode = 1;
}

if (require.main === module) main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});

module.exports = { classifyPercent, koreanCode, naverLocalTradedAtMs, parseNaverKoreaBasic, yahooChartSnapshot, industrySummary };
