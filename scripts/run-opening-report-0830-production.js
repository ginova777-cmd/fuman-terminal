"use strict";

const fs = require("fs");
const crypto = require("crypto");
const path = require("path");
const { spawnSync } = require("child_process");
const { upsertSnapshot } = require("../lib/supabase-snapshots");
const { buildMarketCalendarContract } = require("../lib/market-calendar-contract");
const { OPENING_REPORT_0830_INDUSTRY_MAP, pairs, leaderPairs } = require("./opening-report-0830-industry-map-contract.js");
const { applyLeaderFreshness, summarizeReceiptFreshness } = require("../lib/opening-report-asia-freshness");

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime";
const STATE_DIR = process.env.BACKTEST_MODE === "1" ? path.join(RUNTIME_DIR, "state") : (process.env.FUMAN_STATE_DIR || path.join(RUNTIME_DIR, "state"));
const RECEIPT_DIR = path.join(RUNTIME_DIR, "data", "opening-report-0830");
const BRIDGE_SCRIPT = path.resolve(__dirname, "apply-opening-report-0830-priority-bias-bridge.js");
const VERIFY_BRIDGE_SCRIPT = path.resolve(__dirname, "verify-opening-report-0830-priority-bias-bridge.js");
const OVERSEAS_LEADER_DETECTOR_SCRIPT = path.resolve(__dirname, "run-opening-report-0830-overseas-leader-detector.js");
const SOURCE = "opening_report_0830";
const OVERSEAS_LEADER_DETECTOR_TIMEOUT_MS = Math.max(30000, Number(process.env.FUMAN_OPENING_REPORT_OVERSEAS_DETECTOR_TIMEOUT_MS || 75000));
const MODE = "priority_bias_only";
const ALLOWED_ACTION = "boost_scan_priority_only";
const FORBIDDEN_ACTION = "publish_formal_candidate_without_taiwan_evidence";

function argValue(name, fallback = "") {
  const prefix = `${name}=`;
  const match = process.argv.find((item) => item === name || item.startsWith(prefix));
  return match === name ? "1" : (match ? match.slice(prefix.length) : fallback);
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function taipeiDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function timestamp() {
  return new Date().toISOString();
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function ensureDir(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

function writeJson(file, value) {
  ensureDir(file);
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

function windowsUserEnv(name) {
  const processValue = String(process.env[name] || "").trim();
  if (processValue && !/你的|userId|groupId|LINE_TO/i.test(processValue)) return { value: processValue, source: "process_env" };
  const result = spawnSync("reg", ["query", "HKCU\\Environment", "/v", name], { encoding: "utf8", windowsHide: true });
  const text = `${result.stdout || ""}\n${result.stderr || ""}`;
  const line = text.split(/\r?\n/).find((row) => new RegExp(`\\s${name}\\s+REG_`).test(row));
  if (!line) return { value: "", source: "missing" };
  const parts = line.trim().split(/\s{2,}/);
  const value = parts.length >= 3 ? parts.slice(2).join("  ").trim() : "";
  return { value, source: value ? "windows_user_env" : "missing" };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryableStatus(status) {
  return status === 429 || status >= 500;
}

async function fetchWithRetry(url, options = {}) {
  const attempts = [];
  const backoff = [2000, 5000, 10000];
  for (let index = 0; index < 3; index += 1) {
    try {
      const response = await fetch(url, { ...options, signal: AbortSignal.timeout ? AbortSignal.timeout(options.timeoutMs || 9000) : undefined });
      const text = await response.text();
      attempts.push({ attempt: index + 1, status: response.status, retryable: retryableStatus(response.status) });
      if (response.ok) return { ok: true, status: response.status, text, attempts };
      if (!retryableStatus(response.status)) return { ok: false, status: response.status, text, attempts };
    } catch (error) {
      attempts.push({ attempt: index + 1, status: 0, retryable: true, error: error?.message || String(error) });
    }
    if (index < 2) await sleep(backoff[index]);
  }
  return { ok: false, status: attempts.at(-1)?.status || 0, text: "", attempts };
}

function approxBiasText(item) {
  return `${item.display_name}: ${item.bias}, confidence=${item.confidence}, ${item.evidence_summary}`;
}

function biasDisplay(bias) {
  const value = String(bias || "").toLowerCase();
  if (value.includes("positive")) return "分歧偏強";
  if (value.includes("negative")) return "分歧偏弱";
  if (value.includes("neutral")) return "中性";
  return bias || "未分類";
}

function biasColor(bias) {
  const value = String(bias || "").toLowerCase();
  if (value.includes("positive")) return "#ff6458";
  if (value.includes("negative")) return "#79d35f";
  return "#f4f0df";
}


function hasMarketPercent(percent) {
  return percent !== null && percent !== undefined && String(percent).trim() !== "" && Number.isFinite(Number(percent));
}

function classifyMarketPercent(percent) {
  const value = Number(percent);
  if (!Number.isFinite(value)) return { direction: "unknown", display: "來源不足", color: "#f4f0df", reason_code: "market_snapshot_value_missing" };
  if (value > 0.3) return { direction: "positive", display: "偏強", color: "#ff6458", reason_code: "market_snapshot_positive" };
  if (value < -0.3) return { direction: "negative", display: "偏弱", color: "#79d35f", reason_code: "market_snapshot_negative" };
  return { direction: "neutral", display: "中性", color: "#f4f0df", reason_code: "market_snapshot_neutral" };
}

function marketSnapshotItem({ key, label, percent, sourceTime, sourceUrl, sourceName, fallbackDisplay = "來源不足", reasonCode = "market_snapshot_value_missing" }) {
  const classified = classifyMarketPercent(percent);
  const hasPercent = hasMarketPercent(percent);
  return {
    key,
    label,
    percent: hasPercent ? Number(Number(percent).toFixed(2)) : null,
    display: hasPercent ? classified.display : fallbackDisplay,
    direction: hasPercent ? classified.direction : "unknown",
    color: hasPercent ? classified.color : "#f4f0df",
    source_time: sourceTime || "",
    source_url: sourceUrl || "",
    source_name: sourceName || "",
    reason_code: hasPercent ? classified.reason_code : reasonCode,
  };
}

function parseFinanceNumber(value) {
  const number = Number(String(value || "").replace(/[,%\s]/g, ""));
  return Number.isFinite(number) ? number : null;
}

function extractGoogleFinanceQuote(html) {
  const text = String(html || "");
  const lastPrice = parseFinanceNumber((text.match(/data-last-price="([^"]+)"/) || [])[1]);
  const timestampSec = Number((text.match(/data-last-normal-market-timestamp="(\d+)"/) || [])[1]);
  const previousClose = parseFinanceNumber((text.match(/Previous close[\s\S]{0,700}?<div class="P6K39c">([^<]+)/) || [])[1]);
  const sourceTimeIso = Number.isFinite(timestampSec) && timestampSec > 0 ? new Date(timestampSec * 1000).toISOString() : "";
  const percent = lastPrice !== null && previousClose !== null && previousClose > 0
    ? ((lastPrice - previousClose) / previousClose) * 100
    : null;
  return {
    last_price: lastPrice,
    previous_close: previousClose,
    percent: percent === null ? null : Number(percent.toFixed(2)),
    source_time: sourceTimeIso,
  };
}

function cutoffTimeMs(tradeDate) {
  const parsed = Date.parse(`${tradeDate}T08:20:00+08:00`);
  return Number.isFinite(parsed) ? parsed : 0;
}

function snapshotAfterCutoff(sourceTime, tradeDate) {
  const sourceMs = Date.parse(sourceTime || "");
  const cutoffMs = cutoffTimeMs(tradeDate);
  return Boolean(Number.isFinite(sourceMs) && cutoffMs && sourceMs > cutoffMs);
}

function yahooEncodeSymbol(symbol) {
  return encodeURIComponent(symbol).replace(/%3D/g, "%3D");
}

function yahooDateKey(timestampSec, timeZone) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timeZone || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(timestampSec * 1000));
}

function yahooPreviousTradingClose({ timestamps, closes, selectedIndex, timeZone }) {
  const selectedDate = yahooDateKey(timestamps[selectedIndex], timeZone);
  for (let index = selectedIndex - 1; index >= 0; index -= 1) {
    const value = Number(closes[index]);
    if (yahooDateKey(timestamps[index], timeZone) !== selectedDate && Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

async function yahooMarketSnapshotItem({ key, label, yahooSymbol, tradeDate, sourceName, fallbackDisplay = "來源不足", mockPercent = null, mockSourceTime = "" }) {
  if (mockPercent !== null && mockPercent !== undefined) {
    return marketSnapshotItem({ key, label, percent: mockPercent, sourceTime: mockSourceTime || `${tradeDate}T08:30:00+08:00`, sourceName, sourceUrl: `https://finance.yahoo.com/quote/${yahooSymbol}` });
  }
  const cut = cutoffTimeMs(tradeDate);
  const period1 = Math.floor((cut - 8 * 24 * 3600 * 1000) / 1000);
  const period2 = Math.floor((cut + 60 * 1000) / 1000);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooEncodeSymbol(yahooSymbol)}?period1=${period1}&period2=${period2}&interval=5m&includePrePost=false`;
  const result = await fetchWithRetry(url, { timeoutMs: 9000, headers: { "user-agent": "Mozilla/5.0 FumanTerminal/1.0" } });
  if (!result.ok) return marketSnapshotItem({ key, label, percent: null, sourceTime: timestamp(), sourceName, sourceUrl: url, fallbackDisplay, reasonCode: `yahoo_chart_http_${result.status || 0}` });
  let json = null;
  try { json = JSON.parse(result.text); } catch { return marketSnapshotItem({ key, label, percent: null, sourceTime: timestamp(), sourceName, sourceUrl: url, fallbackDisplay, reasonCode: "yahoo_chart_json_parse_failed" }); }
  const chart = json?.chart?.result?.[0];
  const timestamps = Array.isArray(chart?.timestamp) ? chart.timestamp : [];
  const closes = Array.isArray(chart?.indicators?.quote?.[0]?.close) ? chart.indicators.quote[0].close : [];
  let selected = -1;
  for (let index = 0; index < timestamps.length; index += 1) {
    const value = Number(closes[index]);
    if (timestamps[index] * 1000 <= cut && Number.isFinite(value) && value > 0) selected = index;
  }
  if (selected < 0) return marketSnapshotItem({ key, label, percent: null, sourceTime: timestamp(), sourceName, sourceUrl: url, fallbackDisplay, reasonCode: "yahoo_chart_no_bar_before_cutoff" });
  const close = Number(closes[selected]);
  const previousClose = yahooPreviousTradingClose({ timestamps, closes, selectedIndex: selected, timeZone: chart?.meta?.exchangeTimezoneName || chart?.meta?.timezone || "UTC" });
  const percent = Number.isFinite(previousClose) && previousClose > 0 ? ((close - previousClose) / previousClose) * 100 : null;
  if (!hasMarketPercent(percent)) return marketSnapshotItem({ key, label, percent: null, sourceTime: new Date(timestamps[selected] * 1000).toISOString(), sourceName, sourceUrl: url, fallbackDisplay, reasonCode: "yahoo_chart_previous_close_missing" });
  return {
    ...marketSnapshotItem({ key, label, percent, sourceTime: new Date(timestamps[selected] * 1000).toISOString(), sourceName, sourceUrl: url }),
    last_price: Number(close.toFixed(4)),
    previous_close: Number(previousClose.toFixed(4)),
  };
}

async function googleMarketSnapshotItem({ key, label, url, tradeDate, sourceName, fallbackDisplay = "來源不足", reasonCode = "market_snapshot_fetch_failed", mockPercent = null, mockSourceTime = "" }) {
  if (mockPercent !== null && mockPercent !== undefined) {
    return marketSnapshotItem({ key, label, percent: mockPercent, sourceTime: mockSourceTime || `${tradeDate}T08:30:00+08:00`, sourceName, sourceUrl: url });
  }
  const result = await fetchWithRetry(url, { timeoutMs: 9000 });
  if (!result.ok) {
    return marketSnapshotItem({ key, label, percent: null, sourceTime: timestamp(), sourceName, sourceUrl: url, fallbackDisplay, reasonCode: `${reasonCode}:http_${result.status || 0}` });
  }
  const quote = extractGoogleFinanceQuote(result.text);
  if (!hasMarketPercent(quote.percent)) {
    return marketSnapshotItem({ key, label, percent: null, sourceTime: quote.source_time || timestamp(), sourceName, sourceUrl: url, fallbackDisplay, reasonCode: "market_snapshot_numeric_parse_failed" });
  }
  if (snapshotAfterCutoff(quote.source_time, tradeDate)) {
    return {
      ...marketSnapshotItem({ key, label, percent: null, sourceTime: quote.source_time, sourceName, sourceUrl: url, fallbackDisplay: "晚到資料", reasonCode: "market_snapshot_after_0820_cutoff" }),
      raw_percent_after_cutoff: quote.percent,
      last_price: quote.last_price,
      previous_close: quote.previous_close,
    };
  }
  return {
    ...marketSnapshotItem({ key, label, percent: quote.percent, sourceTime: quote.source_time || timestamp(), sourceName, sourceUrl: url }),
    last_price: quote.last_price,
    previous_close: quote.previous_close,
  };
}

async function buildMarketSnapshot(tradeDate, runId, mock = false) {
  const mockTime = `${tradeDate}T08:20:00+08:00`;
  const items = mock
    ? [
      marketSnapshotItem({ key: "nasdaq", label: "NASDAQ", percent: 1.3, sourceTime: mockTime, sourceName: "mock/AP", sourceUrl: "https://apnews.com/article/9d586bdbf1fb230dcf1f915dcaf50858" }),
      marketSnapshotItem({ key: "sox", label: "SOX 半導體", percent: 2.6, sourceTime: mockTime, sourceName: "mock/Investopedia", sourceUrl: "https://www.investopedia.com/market-update-spacex-stock-surges-to-close-out-a-wild-week-of-trading-spcx-12036739" }),
      marketSnapshotItem({ key: "japan_semiconductor", label: "日股半導體", percent: null, sourceTime: mockTime, sourceName: "mock/Google Finance Nikkei proxy", sourceUrl: "https://www.google.com/finance/quote/NI225:INDEXNIKKEI", fallbackDisplay: "分歧", reasonCode: "directional_proxy_without_numeric" }),
      marketSnapshotItem({ key: "korea_memory", label: "韓股記憶體", percent: null, sourceTime: mockTime, sourceName: "mock/Google Finance KOSPI proxy", sourceUrl: "https://www.google.com/finance/quote/KOSPI:KRX", fallbackDisplay: "來源不足", reasonCode: "numeric_snapshot_missing_no_direction_claim" }),
    ]
    : await Promise.all([
      yahooMarketSnapshotItem({ key: "nasdaq", label: "NASDAQ", tradeDate, sourceName: "Yahoo Finance ^IXIC chart", yahooSymbol: "^IXIC" }),
      yahooMarketSnapshotItem({ key: "sox", label: "SOX 半導體", tradeDate, sourceName: "Yahoo Finance ^SOX chart", yahooSymbol: "^SOX" }),
      yahooMarketSnapshotItem({ key: "japan_semiconductor", label: "日股半導體", tradeDate, sourceName: "Yahoo Finance ^N225 chart", yahooSymbol: "^N225", fallbackDisplay: "來源不足" }),
      yahooMarketSnapshotItem({ key: "korea_memory", label: "韓股記憶體", tradeDate, sourceName: "Yahoo Finance ^KS11 chart", yahooSymbol: "^KS11", fallbackDisplay: "來源不足" }),
    ]);
  return {
    contract: "opening-report-0830-market-snapshot-v1",
    run_id: runId,
    date: tradeDate,
    checked_at: timestamp(),
    cutoff: `${tradeDate} 08:20:00 Asia/Taipei`,
    mode: "directional_approximate_with_readback",
    items,
  };
}
function marketSnapshotRows(snapshot) {
  const rows = Array.isArray(snapshot?.items) ? snapshot.items : [];
  return rows.length ? rows : [marketSnapshotItem({ key: "unknown", label: "國際盤面", percent: null })];
}

function marketSnapshotSourceText(snapshot) {
  const numeric = marketSnapshotRows(snapshot).filter((row) => hasMarketPercent(row.percent));
  if (!numeric.length) return "國際盤面：目前無可回讀數字，不宣告偏強/偏弱。";
  return numeric.map((row) => `${row.label} ${row.percent > 0 ? "+" : ""}${row.percent}%`).join("；");
}
function symbolNamesByTier(item, tier) {
  return (Array.isArray(item.mapped_symbols) ? item.mapped_symbols : [])
    .filter((row) => String(row.tier || "").toUpperCase() === tier)
    .map((row) => row.name || row.symbol)
    .filter(Boolean);
}

function compactNames(names, max = 7) {
  const list = Array.isArray(names) ? names.filter(Boolean) : [];
  if (list.length <= max) return list.join("、") || "無";
  return `${list.slice(0, max).join("、")} +${list.length - max}`;
}

function openingRead(item) {
  const reads = {
    PCB_CCL: "優先看抗跌、量能、開盤承接",
    MEMORY: "等台股試撮與量價確認",
    AI_GPU_CLOUD: "只觀察不追高",
    AWS_AI_DATACENTER: "等金像電、散熱與ASIC同步",
    FOUNDRY_ADVANCED_PROCESS: "看台積電與設備股承接",
    IC_DESIGN: "看聯發科、世芯是否同步轉強",
    ABF_SUBSTRATE: "不直接追，等載板量價確認",
    PASSIVE_COMPONENTS: "低權重觀察，等電子族群擴散",
    THERMAL_POWER: "只看強者恆強與量能續航",
    NETWORK_HIGH_SPEED: "開盤抗跌才提高權重",
    OPTICAL_COMM: "題材保留，等光通訊個股量價",
    III_V_OPTICAL: "低權重觀察，等族群同步",
    EV_AUTOMOTIVE: "非主軸，等事件或量價",
    ROBOTICS_AUTOMATION: "觀察，不列主攻",
    PANEL: "等台股量價，不預設追價",
    APPLE_CONSUMER: "不當主攻，只看個股事件",
    SHIPPING: "只看開盤承接與運價背景",
    MATERIALS: "背景觀察，等現貨與台股量價",
    BIOTECH: "事件股觀察，不用海外單點追價",
  };
  return reads[item.industry] || "列入觀察，正式進場仍看台股 evidence";
}

function priorityItems(items) {
  return items.slice().sort((a, b) => {
    const aPct = Number(a.overseas_return_1d_pct);
    const bPct = Number(b.overseas_return_1d_pct);
    const aPositive = Number.isFinite(aPct) && aPct > 0;
    const bPositive = Number.isFinite(bPct) && bPct > 0;
    if (aPositive !== bPositive) return bPositive ? 1 : -1;
    if (aPositive && bPositive && bPct !== aPct) return bPct - aPct;
    const coverageDiff = Number(b.overseas_leader_detection?.valid_count || 0) - Number(a.overseas_leader_detection?.valid_count || 0);
    if (coverageDiff) return coverageDiff;
    const confidenceDiff = Number(b.confidence || 0) - Number(a.confidence || 0);
    if (confidenceDiff) return confidenceDiff;
    return String(a.industry || "").localeCompare(String(b.industry || ""));
  });
}

function openingReportScoreForRank(rank) {
  if (!Number.isFinite(rank) || rank <= 0) return 0;
  if (rank === 1) return 20;
  if (rank === 2) return 16;
  if (rank === 3) return 12;
  if (rank === 4) return 8;
  return 4;
}

function rankIndustryItems(items) {
  const ordered = priorityItems(items);
  let positiveRank = 0;
  return ordered.map((item, index) => {
    const pct = Number(item.overseas_return_1d_pct);
    const positive = Number.isFinite(pct) && pct > 0;
    if (positive) positiveRank += 1;
    return {
      ...item,
      priority_rank: index + 1,
      positive_return_rank: positive ? positiveRank : null,
      opening_report_score: positive ? openingReportScoreForRank(positiveRank) : 0,
      opening_report_score_policy: "positive_overseas_return_desc_20_16_12_8_then_4_nonpositive_0_best_industry_once",
    };
  });
}

function lineConclusion(items) {
  const top = priorityItems(items).slice(0, 3);
  const names = top.map((item) => item.display_name || item.industry).filter(Boolean);
  const weak = top.filter((item) => String(item.bias || "").toLowerCase().includes("negative")).map((item) => item.display_name || item.industry);
  const lead = names.length ? `先看 ${names.slice(0, 2).join(" 與 ")}` : "先看海外強勢族群";
  const caution = weak.length ? `；${weak.join("、")}只觀察不追高` : "；正式進場仍等台股確認";
  return `${lead}${caution}，僅供開盤後觀察排序，不構成正式進場訊號。`;
}
function flexText(text, options = {}) {
  return {
    type: "text",
    text: String(text || ""),
    wrap: options.wrap !== false,
    size: options.size || "sm",
    color: options.color || "#f4f0df",
    weight: options.weight || "regular",
    align: options.align || "start",
    margin: options.margin || "none",
  };
}

function overseasLeaderHealthText(summary) {
  if (!summary || summary.ok !== true) return "海外來源：未驗證";
  return `海外來源：${summary.valid_leaders}/${summary.total_leaders}｜unavailable=${summary.unavailable_leaders}`;
}

function lineReportText({ tradeDate, items, marketSnapshot, overseasLeaderDetection }) {
  const lines = [];
  lines.push(`FUMAN 08:30 開盤前日報｜${tradeDate}`);
  lines.push("");
  lines.push("國際盤面");
  for (const row of marketSnapshotRows(marketSnapshot)) lines.push(`${row.label}：${row.display}${hasMarketPercent(row.percent) ? `（${row.percent > 0 ? "+" : ""}${row.percent}%）` : ""}｜${row.reason_code}`);
  lines.push(`來源：${marketSnapshotSourceText(marketSnapshot)}`);
  lines.push(overseasLeaderHealthText(overseasLeaderDetection));
  lines.push("");
  lines.push("1. 海外產業對應表");
  for (const item of items) {
    lines.push("");
    lines.push(item.display_name || item.industry);
    lines.push(`海外：${biasDisplay(item.bias)}｜confidence=${item.confidence}`);
    lines.push(`A：${compactNames(symbolNamesByTier(item, "A"), 10)}`);
    lines.push(`B：${compactNames(symbolNamesByTier(item, "B"), 10)}`);
    lines.push(`海外領先股：${(item.overseas_leaders || []).join("、") || "無"}`);
    lines.push(`判讀：${openingRead(item)}`);
  }
  lines.push("");
  lines.push("2. 觀察優先順序");
  priorityItems(items).slice(0, 4).forEach((item, index) => lines.push(`${index + 1}. ${item.display_name || item.industry}｜${biasDisplay(item.bias)}｜先看：${compactNames(symbolNamesByTier(item, "A"), 6)}｜確認：開盤後量價與族群承接｜避開：開高失守、量價轉弱或追價過大`));
  lines.push("");
  lines.push("交付狀態");
  lines.push(`report_status=${marketSnapshotRows(marketSnapshot).some((row) => hasMarketPercent(row.percent)) ? "REPORT_OK" : "REPORT_DEGRADED"}`);
  lines.push("formal_trading_use=false");
  lines.push("allowed_action=industry_observation_only");
  return `${lines.join("\n")}\n`;
}

function lineReportFlex({ tradeDate, items, marketSnapshot, overseasLeaderDetection }) {
  const priorities = priorityItems(items);
  const displayMarketRows = marketSnapshotRows(marketSnapshot);
  const industryRows = priorities.slice(0, 3).map((item) => ({
    type: "box",
    layout: "vertical",
    spacing: "xs",
    paddingAll: "10px",
    backgroundColor: "#10192a",
    cornerRadius: "8px",
    borderColor: "#30435d",
    borderWidth: "1px",
    contents: [
      {
        type: "box",
        layout: "horizontal",
        contents: [
          flexText(item.display_name || item.industry, { weight: "bold", size: "sm", color: "#fff7df", wrap: false }),
          flexText(`海外：${biasDisplay(item.bias)}`, { weight: "bold", size: "xs", color: biasColor(item.bias), align: "end", wrap: false }),
        ],
      },
      flexText(`A：${compactNames(symbolNamesByTier(item, "A"), 8)}`, { size: "xs", color: "#ffffff", margin: "sm" }),
      flexText(`B：${compactNames(symbolNamesByTier(item, "B"), 6)}`, { size: "xxs", color: "#c9d2e4" }),
      flexText(`判讀：${openingRead(item)}`, { size: "xxs", color: "#bac4d8" }),
    ],
  }));
  return {
    type: "bubble",
    size: "giga",
    body: {
      type: "box",
      layout: "vertical",
      backgroundColor: "#050608",
      paddingAll: "16px",
      spacing: "md",
      contents: [
        flexText("FUMAN 08:30", { size: "xxl", weight: "bold", color: "#ffd36a" }),
        flexText("台股開盤前日報｜海外強弱 / 產業對應", { size: "sm", weight: "bold", color: "#f4f0df", margin: "xs" }),
        flexText(tradeDate, { size: "lg", weight: "bold", color: "#ffd36a", align: "end" }),
        { type: "separator", color: "#d79b2b", margin: "md" },
        {
          type: "box",
          layout: "horizontal",
          spacing: "md",
          contents: [
            {
              type: "box",
              layout: "vertical",
              flex: 4,
              paddingAll: "12px",
              cornerRadius: "10px",
              borderColor: "#d79b2b",
              borderWidth: "1px",
              contents: [
                flexText("國際盤面", { size: "md", weight: "bold", color: "#ffd36a" }),
                ...displayMarketRows.map((row, index) => flexText(`${row.label}　${row.display}`, { color: row.color || "#f4f0df", margin: index === 0 ? "md" : "sm" })),
                flexText(marketSnapshotSourceText(marketSnapshot), { size: "xxs", color: "#9fb2ce", margin: "sm" }),
              ],
            },
            {
              type: "box",
              layout: "vertical",
              flex: 6,
              paddingAll: "12px",
              cornerRadius: "10px",
              borderColor: "#d79b2b",
              borderWidth: "1px",
              spacing: "sm",
              contents: [
                {
                  type: "box",
                  layout: "vertical",
                  backgroundColor: "#e4aa3d",
                  cornerRadius: "8px",
                  paddingAll: "8px",
                  contents: [flexText("今日觀察主軸", { size: "md", weight: "bold", color: "#060708", align: "center" })],
                },
                ...priorities.slice(0, 3).map((item, index) => ({
                  type: "box",
                  layout: "horizontal",
                  paddingAll: "8px",
                  cornerRadius: "6px",
                  borderColor: "#30435d",
                  borderWidth: "1px",
                  contents: [
                    flexText(`${index + 1}. ${item.display_name || item.industry}`, { color: "#ffffff", weight: "bold", wrap: false }),
                    flexText(biasDisplay(item.bias), { color: biasColor(item.bias), weight: "bold", align: "end", wrap: false }),
                  ],
                })),
              ],
            },
          ],
        },
        flexText("海外產業對應表", { size: "lg", weight: "bold", color: "#ffd36a" }),
        ...industryRows,
        {
          type: "box",
          layout: "vertical",
          backgroundColor: "#f1bd54",
          cornerRadius: "10px",
          paddingAll: "12px",
          contents: [flexText(`結論：${lineConclusion(items)}`, { size: "sm", weight: "bold", color: "#060708" })],
        },
        flexText(overseasLeaderHealthText(overseasLeaderDetection), { size: "xxs", color: "#9ee493" }),
        flexText("僅供觀察排序，不構成正式進場訊號。", { size: "xxs", color: "#bac4d8" }),
      ],
    },
  };
}

function invalidLineTarget(value) {
  const targets = String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (!targets.length) return true;
  return targets.some((text) => {
    if (/你的|userId|groupId|LINE_TO/i.test(text)) return true;
    return !/^[UCR][0-9a-fA-F]{20,}$/.test(text);
  });
}
function stock(symbol, name, tier) {
  return { symbol, name, tier };
}

function buildIndustryItem({ tradeDate, runId, industry, displayName, bias, confidence, evidence, overseas = [], a = [], b = [] }) {
  return {
    date: tradeDate,
    report_time: "08:30",
    run_id: `${runId}-${industry}`,
    source: SOURCE,
    mode: MODE,
    industry,
    bias,
    confidence,
    evidence_summary: evidence,
    overseas_leaders: overseas,
    mapped_symbols: [
      ...a.map(([symbol, name]) => stock(symbol, name, "A")),
      ...b.map(([symbol, name]) => stock(symbol, name, "B")),
    ],
    allowed_action: ALLOWED_ACTION,
    forbidden_action: FORBIDDEN_ACTION,
  };
}

function baseIndustryItems(tradeDate, runId) {
  return OPENING_REPORT_0830_INDUSTRY_MAP.map((item) => buildIndustryItem({
    tradeDate,
    runId,
    industry: item.industry,
    displayName: item.display_name,
    bias: item.default_bias,
    confidence: item.default_confidence,
    evidence: item.evidence_summary,
    overseas: item.overseas_leaders.map((leader) => leader.name),
    a: pairs(item.a),
    b: pairs(item.b),
  })).map((item, index) => ({ ...item, priority_rank: index + 1, display_name: OPENING_REPORT_0830_INDUSTRY_MAP[index].display_name }));
}
function overseasLeadersPath(tradeDate) {
  return path.join(RECEIPT_DIR, `overseas-leaders-0830-${tradeDate.replace(/\D/g, "")}.json`);
}

function frozenOverseasLeadersPath(tradeDate) {
  return path.join(RECEIPT_DIR, `opening-report-0820-overseas-leaders-${tradeDate.replace(/\D/g, "")}.json`);
}

function isFrozen0820Receipt(receipt, tradeDate) {
  return Boolean(receipt
    && String(receipt.date || "").replace(/\D/g, "") === tradeDate.replace(/\D/g, "")
    && String(receipt.cutoff || "").includes("08:20:00 Asia/Taipei")
    && Array.isArray(receipt.industries)
    && receipt.industries.length === OPENING_REPORT_0830_INDUSTRY_MAP.length);
}
function frozenMarketSnapshotPath(tradeDate) {
  return path.join(RECEIPT_DIR, `opening-report-0820-market-snapshot-${tradeDate.replace(/\D/g, "")}.json`);
}

function isFrozenMarketSnapshot(snapshot, tradeDate) {
  return Boolean(snapshot
    && String(snapshot.date || "").replace(/\D/g, "") === tradeDate.replace(/\D/g, "")
    && String(snapshot.cutoff || "").includes("08:20:00 Asia/Taipei")
    && Array.isArray(snapshot.items)
    && snapshot.items.length >= 4);
}

function frozenMarketSnapshotOrFallback(tradeDate, runId) {
  const frozen = readJson(frozenMarketSnapshotPath(tradeDate));
  if (isFrozenMarketSnapshot(frozen, tradeDate)) {
    return { ...frozen, delivery_read_only: true, delivery_run_id: runId };
  }
  const missing = (key, label) => marketSnapshotItem({ key, label, percent: null, sourceTime: "", sourceName: "opening_report_0820_preflight", fallbackDisplay: "來源不足", reasonCode: "opening_report_0820_market_snapshot_missing_or_invalid" });
  return {
    contract: "opening-report-0820-market-snapshot-v1",
    run_id: runId,
    date: tradeDate,
    checked_at: timestamp(),
    cutoff: `${tradeDate} 08:20:00 Asia/Taipei`,
    mode: "source_insufficient_no_0830_refetch",
    delivery_read_only: true,
    reason_code: "opening_report_0820_market_snapshot_missing_or_invalid",
    items: [missing("nasdaq", "NASDAQ"), missing("sox", "SOX 半導體"), missing("japan_semiconductor", "日股半導體"), missing("korea_memory", "韓股記憶體")],
  };
}

function writeOverseasLeaderFallbackReceipt(file, tradeDate, runId, reasonCode) {
  const industries = OPENING_REPORT_0830_INDUSTRY_MAP.map((row) => {
    const leaders = leaderPairs(row).map(([name, yahoo]) => ({
      name,
      yahoo_symbol: yahoo || "",
      industry: row.industry,
      ok: false,
      source: "opening_report_0830_fallback",
      source_url: "",
      source_time: "",
      percent: null,
      display: "來源不足",
      direction: "unknown",
      close: null,
      previous_close: null,
      reason_code: reasonCode,
    }));
    return {
      industry: row.industry,
      display_name: row.display_name,
      leader_count: leaders.length,
      valid_count: 0,
      unavailable_count: leaders.length,
      average_percent: null,
      display: "來源不足",
      direction: "unknown",
      reason_code: reasonCode,
      leaders,
    };
  });
  const allLeaders = industries.flatMap((row) => row.leaders);
  writeJson(file, {
    contract: "opening-report-0830-overseas-leaders-v1",
    ok: false,
    date: tradeDate,
    run_id: `${runId}-overseas-leaders-fallback`,
    checked_at: timestamp(),
    cutoff: `${tradeDate} 08:20:00 Asia/Taipei`,
    source_policy: "Fallback receipt written so the 08:30 report can fail closed without hanging; no directional claim is made.",
    total_leaders: allLeaders.length,
    valid_leaders: 0,
    unavailable_leaders: allLeaders.length,
    reason_code: reasonCode,
    industries,
  });
}

function runOverseasLeaderDetector(tradeDate, runId, mock) {
  const frozenFile = frozenOverseasLeadersPath(tradeDate);
  if (mock) return { ok: true, skipped: true, file: frozenFile, reason_code: "mock_overseas_leader_detector_skipped" };
  const frozen = readJson(frozenFile);
  if (isFrozen0820Receipt(frozen, tradeDate)) {
    return {
      ok: frozen.ok === true,
      skipped: false,
      file: frozenFile,
      exitCode: 0,
      preflight_run_id: frozen.run_id || "",
      reason_code: frozen.ok === true ? "frozen_0820_overseas_evidence_loaded" : "frozen_0820_overseas_evidence_degraded",
    };
  }
  const file = overseasLeadersPath(tradeDate);
  writeOverseasLeaderFallbackReceipt(file, tradeDate, runId, "opening_report_0820_preflight_missing_or_invalid");
  return {
    ok: false,
    skipped: false,
    file,
    exitCode: null,
    preflight_run_id: "",
    reason_code: "opening_report_0820_preflight_missing_or_invalid",
  };
}
function biasFromLeaderDirection(direction) {
  const value = String(direction || "").toLowerCase();
  if (value === "positive") return "positive_detected";
  if (value === "negative") return "negative_detected";
  if (value === "neutral") return "neutral_detected";
  return "source_insufficient";
}

function passiveComponentJapanAnchorDetection(detected) {
  const leaders = Array.isArray(detected?.leaders) ? detected.leaders : [];
  const byName = new Map(leaders.map((row) => [String(row.name || "").toLowerCase(), row]));
  const murata = byName.get("murata") || null;
  const percent = Number(murata?.percent);
  const isValid = murata?.ok === true && Number.isFinite(percent);
  const summary = murata ? `Murata:${Number.isFinite(percent) ? (percent > 0 ? "+" : "") + percent + "%" : murata.reason_code || "NA"}` : "Murata:missing";
  if (!isValid) {
    return { direction: "unknown", display: "來源不足", bias: "source_insufficient", confidence: 0.45, reason_code: "passive_components_murata_missing", evidence: `日股被動元件唯一主錨村田來源不足；${summary}` };
  }
  if (percent > 0.3) {
    return { direction: "positive", display: "偏強觀察", bias: "positive_detected", confidence: 0.9, reason_code: "passive_components_murata_positive", evidence: `被動元件只看村田：村田偏強；${summary}` };
  }
  if (percent < -0.3) {
    return { direction: "negative", display: "偏弱", bias: "negative_detected", confidence: 0.88, reason_code: "passive_components_murata_negative", evidence: `被動元件只看村田：村田偏弱；${summary}` };
  }
  return { direction: "neutral", display: "中性", bias: "neutral_detected", confidence: 0.72, reason_code: "passive_components_murata_flat", evidence: `被動元件只看村田：村田平盤附近；${summary}` };
}
function applyOverseasLeaderDetection(items, receipt) {
  const industries = Array.isArray(receipt?.industries) ? receipt.industries : [];
  const byIndustry = new Map(industries.map((row) => [row.industry, row]));
  return items.map((item) => {
    const detected = byIndustry.get(item.industry);
    if (!detected) return { ...item, overseas_leader_detection: { ok: false, reason_code: "overseas_leader_detection_missing" } };
    const leaders = (Array.isArray(detected.leaders) ? detected.leaders : []).map((leader) => applyLeaderFreshness(leader, item.date));
    const validLeaders = leaders.filter((leader) => leader.ok && Number.isFinite(Number(leader.percent)));
    const averagePercent = validLeaders.length ? validLeaders.reduce((sum, leader) => sum + Number(leader.percent), 0) / validLeaders.length : null;
    const normalizedDirection = averagePercent === null ? "unknown" : (averagePercent > 0.3 ? "positive" : (averagePercent < -0.3 ? "negative" : "neutral"));
    const normalizedDisplay = normalizedDirection === "positive" ? "偏強" : (normalizedDirection === "negative" ? "偏弱" : (normalizedDirection === "neutral" ? "中性" : "資料不足"));
    const normalized = { ...detected, leaders, valid_count: validLeaders.length, unavailable_count: leaders.filter((leader) => !leader.ok).length, average_percent: averagePercent === null ? null : Number(averagePercent.toFixed(2)), direction: normalizedDirection, display: normalizedDisplay, reason_code: averagePercent === null ? "industry_no_valid_leader_snapshot" : `leader_${normalizedDirection}` };
    const validRatio = Number(normalized.leader_count) > 0 ? Number(normalized.valid_count || 0) / Number(normalized.leader_count) : 0;
    const confidence = Math.max(0, Math.min(0.95, 0.45 + validRatio * 0.5));
    const unavailable = normalized.leaders.filter((row) => !row.ok).map((row) => `${row.name}:${row.reason_code}`);
    const passiveOverride = item.industry === "PASSIVE_COMPONENTS" ? passiveComponentJapanAnchorDetection(normalized) : null;
    const display = passiveOverride?.display || normalized.display;
    const direction = passiveOverride?.direction || normalized.direction;
    const reasonCode = passiveOverride?.reason_code || normalized.reason_code;
    return {
      ...item,
      bias: passiveOverride?.bias || biasFromLeaderDirection(normalized.direction),
      confidence: Number((passiveOverride?.confidence ?? confidence).toFixed(2)),
      evidence_summary: passiveOverride?.evidence || `海外逐檔偵測：${normalized.display}；valid=${normalized.valid_count}/${normalized.leader_count}；avg=${normalized.average_percent === null ? "NA" : normalized.average_percent + "%"}${unavailable.length ? "；source_gap=" + unavailable.join("、") : ""}`,
      overseas_leader_detection: {
        contract: receipt?.contract || "",
        display,
        direction,
        average_percent: normalized.average_percent,
        valid_count: normalized.valid_count,
        leader_count: normalized.leader_count,
        unavailable_count: normalized.unavailable_count,
        reason_code: reasonCode,
      },
      overseas_return_1d_pct: Number.isFinite(Number(normalized.average_percent)) ? Number(normalized.average_percent) : null,
      overseas_sector_up_1d: Number.isFinite(Number(normalized.average_percent)) && Number(normalized.average_percent) > 0,
      overseas_strength_contract: "opening_report_0830_overseas_strength_v1",
      overseas_evidence_cutoff: `${item.date} 08:20:00 Asia/Taipei`,
    };
  });
}

function readTaiwanGate(tradeDate) {
  const preflight = readJson(path.join(STATE_DIR, "daytrade-preflight-0830.json"));
  const watchdogCandidates = fs.existsSync(STATE_DIR)
    ? fs.readdirSync(STATE_DIR).filter((name) => name.startsWith(`daytrade-unattended-gate-watchdog-evidence-${tradeDate.replace(/\D/g, "")}`)).sort()
    : [];
  const watchdog = watchdogCandidates.length ? readJson(path.join(STATE_DIR, watchdogCandidates.at(-1))) : readJson(path.join(STATE_DIR, "daytrade-unattended-gate-watchdog.json"));
  const ok = preflight?.ok === true && watchdog?.formal_entry_allowed === true;
  return {
    ok,
    preflight_ok: preflight?.ok === true,
    formal_entry_allowed: watchdog?.formal_entry_allowed === true,
    canonical_gate_status: watchdog?.metrics?.canonical_gate_status || watchdog?.canonical_gate_status || "",
    canonical_gate_grade: watchdog?.metrics?.canonical_gate_grade || watchdog?.canonical_gate_grade || "",
    first_blocker: ok ? "" : "daytrade_preflight_0830_or_formal_gate_not_ready",
    reason_code: ok ? "taiwan_formal_gate_ready" : "taiwan_formal_gate_fail_closed"
  };
}

async function buildOverseasPreflight(tradeDate, runId, mock) {
  const groups = [
    { key: "us_close", url: "https://www.google.com/finance/quote/.IXIC:INDEXNASDAQ", required: true },
    { key: "japan_morning", url: "https://www.google.com/finance/quote/NI225:INDEXNIKKEI", required: true },
    { key: "korea_morning", url: "https://www.google.com/finance/quote/KOSPI:KRX", required: true }
  ];
  const checks = [];
  for (const group of groups) {
    if (mock) {
      checks.push({ key: group.key, ok: true, status: 200, attempts: [{ attempt: 1, status: 200 }], mode: "mock_self_test" });
      continue;
    }
    const result = await fetchWithRetry(group.url, { timeoutMs: 9000 });
    checks.push({ key: group.key, ok: result.ok, status: result.status, attempts: result.attempts, url: group.url });
  }
  const ok = checks.every((row) => row.ok || !groups.find((group) => group.key === row.key)?.required);
  return {
    contract: "opening-report-0830-overseas-preflight-v1",
    ok,
    status: ok ? "PASS" : "FAIL_CLOSED",
    date: tradeDate,
    run_id: runId,
    checked_at: timestamp(),
    mode: "directional_approximate",
    max_attempts: 3,
    retry_on: ["network_timeout", "dns_error", "http_429", "http_5xx"],
    checks,
    reason_code: ok ? "overseas_directional_sources_available" : "overseas_source_preflight_failed"
  };
}

function markdownReport({ tradeDate, runId, overseasPreflight, items, marketSnapshot }) {
  const lines = [];
  lines.push(`# Fuman 台股 08:30 開盤前日報`);
  lines.push("");
  lines.push(`日期：${tradeDate}`);
  lines.push(`run_id：${runId}`);
  lines.push(`資料截點：${tradeDate} 08:20:00 Asia/Taipei（日本／韓國早盤凍結；美股以前一交易日正式收盤）`);
  lines.push("");
  lines.push(`結論：本晨報僅供開盤後觀察排序；不構成正式進場訊號。`);
  lines.push("");
  lines.push("## 國際盤面");
  lines.push("");
  lines.push("| 項目 | 數值 | 顯示 | source_time | reason_code |");
  lines.push("|---|---:|---|---|---|");
  for (const row of marketSnapshotRows(marketSnapshot)) lines.push(`| ${row.label} | ${hasMarketPercent(row.percent) ? row.percent + "%" : ""} | ${row.display} | ${row.source_time || ""} | ${row.reason_code} |`);
  lines.push("");
  lines.push("## 1. 海外產業對應表");
  lines.push("");
  lines.push("| 產業 | 海外領先股 / proxy | 台股 A 直接對應 | 台股 B 次級對應 | 開盤判讀 |");
  lines.push("|---|---|---|---|---|");
  for (const item of items) {
    lines.push(`| ${item.display_name || item.industry} | ${(item.overseas_leaders || []).join("、") || "無"} | ${compactNames(symbolNamesByTier(item, "A"), 20)} | ${compactNames(symbolNamesByTier(item, "B"), 20)} | ${openingRead(item)} |`);
  }
  lines.push("");
  lines.push("## 2. 觀察優先順序");
  lines.push("");
  lines.push("| 順位 | 族群 | 優先原因 | 先看股票 | 確認條件 | 避開條件 |");
  lines.push("|---:|---|---|---|---|---|");
  priorityItems(items).slice(0, 4).forEach((item, index) => {
    lines.push(`| ${index + 1} | ${item.display_name || item.industry} | ${biasDisplay(item.bias)}；confidence=${item.confidence} | ${compactNames(symbolNamesByTier(item, "A"), 8)} | 開盤後量價與族群承接 | 開高失守、量價轉弱或追價過大 |`);
  });
  lines.push("");
  lines.push("## Final");
  lines.push("");
  lines.push("```text");
  lines.push(`report_status=${overseasPreflight.ok ? "REPORT_OK" : "REPORT_DEGRADED"}`);
  lines.push("formal_candidates=0");
  lines.push("watchlist_only=true");
  lines.push(`overseas_sources_ok=${overseasPreflight.ok}`);
  lines.push("formal_trading_use=false");
  lines.push("allowed_action=industry_observation_only");
  lines.push("```");
  return `${lines.join("\n")}\n`;
}

function verifyBridge(receiptPath, tradeDate) {
  const args = [VERIFY_BRIDGE_SCRIPT, "--receipt=" + receiptPath, "--expected-date=" + String(tradeDate).replace(/\D/g, "")];
  const result = spawnSync(process.execPath, args, {
    encoding: "utf8",
    windowsHide: true,
    cwd: path.resolve(__dirname, "..")
  });
  return { exitCode: result.status, stdout: result.stdout, stderr: result.stderr };
}

function runBridge(inputPath, receiptPath, tradeDate) {
  const result = spawnSync(process.execPath, [BRIDGE_SCRIPT, `--input=${inputPath}`, `--receipt=${receiptPath}`, `--expected-date=${tradeDate.replace(/\D/g, "")}`], {
    encoding: "utf8",
    windowsHide: true,
    cwd: path.resolve(__dirname, "..")
  });
  return { exitCode: result.status, stdout: result.stdout, stderr: result.stderr };
}

function splitLineTargets(value) {
  return String(value || "")
    .split(/[\s,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function lineTargetType(target) {
  const first = String(target || "")[0] || "";
  if (first === "U") return "user";
  if (first === "C") return "group";
  if (first === "R") return "room";
  return "unknown";
}

function invalidLineTarget(target) {
  const value = String(target || "").trim();
  return !/^[UCR][0-9a-f]{32}$/i.test(value);
}

function collectLineTargets() {
  const envNames = [
    "FUMAN_LINE_TO",
    "FUMAN_LINE_TO_USER",
    "FUMAN_LINE_USER_ID",
    "FUMAN_LINE_TO_GROUP",
    "FUMAN_LINE_GROUP_ID",
    "FUMAN_LINE_TO_ROOM",
    "FUMAN_LINE_ROOM_ID",
    "LINE_TO",
    "LINE_TARGET_ID",
    "LINE_USER_ID",
    "LINE_GROUP_ID",
  ];
  const seen = new Set();
  const targets = [];
  for (const envName of envNames) {
    const env = windowsUserEnv(envName);
    for (const target of splitLineTargets(env.value)) {
      if (seen.has(target)) continue;
      seen.add(target);
      targets.push({ target, env_name: envName, source: env.source, target_type: lineTargetType(target) });
    }
  }
  return targets;
}

async function pushLine({ cardText, flexCard, runId, dryRun, contentHash = "" }) {
  const token = windowsUserEnv("FUMAN_LINE_CHANNEL_ACCESS_TOKEN");
  const targets = collectLineTargets();
  const invalidTargets = targets.filter((row) => invalidLineTarget(row.target));
  const base = {
    ok: false,
    line_push_attempted: !dryRun,
    line_push_ok: false,
    attempts: 0,
    retryable_errors: [],
    non_retryable_error: "",
    token_source: token.source === "process_env" ? "windows_user_env" : token.source,
    token_logged: false,
    target_logged: false,
    report_run_id: runId,
    run_id: runId,
    delivery_content_hash: contentHash,
    checked_at: timestamp()
  };
  if (!token.value || targets.length === 0) {
    return { ...base, reason_code: "line_env_missing", missing_env: [!token.value ? "FUMAN_LINE_CHANNEL_ACCESS_TOKEN" : "", targets.length === 0 ? "FUMAN_LINE_TO_OR_TARGET_ENV" : ""].filter(Boolean), target_count: targets.length };
  }
  if (invalidTargets.length) {
    return { ...base, reason_code: "line_target_invalid", missing_env: invalidTargets.map((row) => row.env_name), target_count: targets.length, target_types: targets.map((row) => row.target_type) };
  }
  const messages = flexCard
    ? [{ type: "flex", altText: String(cardText || "Fuman 08:30 開盤前日報").slice(0, 400), contents: flexCard }]
    : [{ type: "text", text: String(cardText || "").slice(0, 4500) }];
  if (dryRun) {
    return {
      ...base,
      ok: true,
      line_push_attempted: false,
      line_push_ok: true,
      reason_code: "line_dry_run_flex_card_ready",
      message_type: flexCard ? "flex" : "text",
      target_count: targets.length,
      delivered_count: targets.length,
      target_types: targets.map((row) => row.target_type),
      has_user_target: targets.some((row) => row.target_type === "user"),
      has_group_target: targets.some((row) => row.target_type === "group"),
    };
  }
  const results = [];
  for (const row of targets) {
    const body = { to: row.target, messages };
    const result = await fetchWithRetry("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: { Authorization: "Bearer " + token.value, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      timeoutMs: 9000
    });
    results.push({ target_type: row.target_type, env_name: row.env_name, ok: result.ok, status: result.status, attempts: result.attempts.length, text: result.text || "" });
  }
  const failed = results.filter((row) => !row.ok);
  return {
    ...base,
    ok: failed.length === 0,
    line_push_attempted: true,
    line_push_ok: failed.length === 0,
    message_type: flexCard ? "flex" : "text",
    target_count: targets.length,
    delivered_count: results.filter((row) => row.ok).length,
    target_types: targets.map((row) => row.target_type),
    has_user_target: targets.some((row) => row.target_type === "user"),
    has_group_target: targets.some((row) => row.target_type === "group"),
    attempts: results.reduce((sum, row) => sum + row.attempts, 0),
    retryable_errors: [],
    non_retryable_error: failed.length ? "line_targets_failed_" + failed.length : "",
    line_error_detail: failed.map((row) => row.target_type + ":http_" + row.status + " " + String(row.text || "").slice(0, 160)).join("; "),
    reason_code: failed.length ? "line_push_failed" : "line_push_ok"
  };
}

async function syncTerminalBriefingSnapshot(tradeDate, runId, contentHash = "") {
  if (process.env.BACKTEST_MODE === "1") {
    return {
      ok: true,
      local_only: true,
      reason_code: "isolated_backtest_terminal_readback",
      report_run_id: runId,
      delivery_content_hash: contentHash,
    };
  }
  try {
    if (typeof upsertSnapshot !== "function") {
      return { ok: false, reason_code: "opening_report_0830_terminal_snapshot_writer_missing" };
    }
    const compact = String(tradeDate || "").replace(/\D/g, "").slice(0, 8);
    const marketAiLive = require("../api/market-ai-live");
    const briefing = marketAiLive.__test.readOpeningMorningReport({
      date: compact ? compact.slice(0, 4) + "-" + compact.slice(4, 6) + "-" + compact.slice(6, 8) : tradeDate,
      ymd: compact,
      seconds: 8 * 60 * 60 + 30 * 60,
      time: "08:30:00",
    });
    const payload = {
      ...briefing,
      source: "opening_report_0830_terminal_briefing",
      report_run_id: runId,
      delivery_content_hash: contentHash,
      updatedAt: timestamp(),
    };
    const result = await upsertSnapshot("opening_report_0830_terminal_briefing", payload, {
      tradeDate,
      snapshotId: runId,
      source: "opening_report_0830_terminal_briefing",
      reason: "opening-report-0830-production",
      locked: false,
    });
    return { ...result, report_run_id: runId, delivery_content_hash: contentHash };
  } catch (error) {
    return {
      ok: false,
      reason_code: "opening_report_0830_terminal_snapshot_sync_failed",
      error: error?.message || String(error),
    };
  }
}

function calendarDateAt(value, time = "08:30") {
  const digits = String(value || "").replace(/\D/g, "").slice(0, 8);
  const iso = digits.length === 8 ? `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}` : taipeiDateKey();
  return new Date(`${iso}T${time}:00+08:00`);
}

async function main() {
  const tradeDate = argValue("--date", process.env.FUMAN_TRADE_DATE || taipeiDateKey());
  const compact = tradeDate.replace(/\D/g, "");
  const runId = argValue("--run-id", `opening-report-0830-${compact}-${Date.now()}`);
  const reportPath = path.join(RECEIPT_DIR, `opening-report-0830-${compact}.md`);  if (hasFlag("--freeze-market-snapshot")) {
    const marketCalendar = await buildMarketCalendarContract({ now: calendarDateAt(tradeDate, "08:20"), stateDir: STATE_DIR });
    const snapshotPath = frozenMarketSnapshotPath(tradeDate);
    if (marketCalendar.tradingDayOpen !== true) {
      writeJson(snapshotPath, { contract: "opening-report-0820-market-snapshot-v1", ok: true, date: tradeDate, run_id: runId, cutoff: `${tradeDate} 08:20:00 Asia/Taipei`, skipped_for_market_closed: true, reason_code: "market_calendar_non_trading_day", items: [] });
      console.log(JSON.stringify({ ok: true, snapshot_path: snapshotPath, run_id: runId, reason_code: "market_calendar_non_trading_day" }, null, 2));
      return;
    }
    const snapshot = await buildMarketSnapshot(tradeDate, runId, hasFlag("--self-test") || hasFlag("--mock-overseas"));
    writeJson(snapshotPath, { ...snapshot, contract: "opening-report-0820-market-snapshot-v1", ok: true, frozen_at: timestamp(), source_policy: "08:20 global snapshot frozen; 08:30 delivery must read this receipt and must not refetch." });
    console.log(JSON.stringify({ ok: true, snapshot_path: snapshotPath, run_id: runId, cutoff: snapshot.cutoff, item_count: snapshot.items.length }, null, 2));
    return;
  }
  const overseasPath = path.join(RECEIPT_DIR, `overseas-preflight-${compact}.json`);
  const finalPath = path.join(RECEIPT_DIR, `opening-report-0830-final-receipt-${compact}.json`);
  const marketCalendar = await buildMarketCalendarContract({ now: calendarDateAt(tradeDate), stateDir: STATE_DIR });
  if (marketCalendar.tradingDayOpen !== true) {
    const skipped = {
      contract: "opening-report-0830-production-v1",
      ok: true,
      report_status: "SKIP_NON_TRADING_DAY",
      report_core_ok: false,
      report_core_status: "SKIP_NON_TRADING_DAY",
      date: tradeDate,
      run_id: runId,
      market_calendar: marketCalendar,
      skipped_for_market_closed: true,
      no_terminal_no_line_no_industry_bias_no_bridge: true,
      line_required: false,
      line_push_attempted: false,
      line_push_ok: false,
      industry_bias_exported: false,
      mother_pool_bridge_attempted: false,
      formal_candidates: 0,
      watchlist_only: true,
      reason_code: "market_calendar_non_trading_day",
      allowed_action: "skip_all_report_actions_until_next_trading_day",
      checked_at: timestamp(),
    };
    writeJson(finalPath, skipped);
    console.log(JSON.stringify({ ok: true, final_receipt: finalPath, run_id: runId, report_status: skipped.report_status, reason_code: skipped.reason_code }, null, 2));
    return;
  }
  const mock = hasFlag("--self-test") || hasFlag("--mock-overseas");
  // Bridge runs after delivery as an optional handoff; it cannot delay report or LINE.
  const applyBridge = false;
  if (hasFlag("--send-line")) throw new Error("line_delivery_retired_use_terminal_telegram_codex");
  const sendLine = false;
  const dryRunLine = true;
  const overseasLeaderDetector = runOverseasLeaderDetector(tradeDate, runId, mock);
  const overseasLeaderReceipt = readJson(overseasLeaderDetector.file);
  const overseasLeaderFreshness = summarizeReceiptFreshness(overseasLeaderReceipt, tradeDate);
  const overseasPreflight = {
    contract: "opening-report-0820-frozen-evidence-v1",
    ok: overseasLeaderReceipt?.ok === true,
    date: tradeDate,
    run_id: runId,
    checked_at: timestamp(),
    cutoff: `${tradeDate} 08:20:00 Asia/Taipei`,
    source_policy: "08:30 delivery consumes the frozen 08:20 overseas receipt only; source degradation must not be backfilled with later direction data.",
    preflight_run_id: overseasLeaderDetector.preflight_run_id || "",
    source_gap_leaders: overseasLeaderFreshness.source_gap_count,
    stale_promoted_leaders: overseasLeaderFreshness.stale_promoted_count,
    partial_source_gaps: overseasLeaderFreshness.source_gap_count > 0,
    checks: [{ key: "overseas_leaders_0820", ok: overseasLeaderReceipt?.ok === true, reason_code: overseasLeaderDetector.reason_code }],
  };
  const items = rankIndustryItems(applyOverseasLeaderDetection(baseIndustryItems(tradeDate, runId), overseasLeaderReceipt));
  const marketSnapshot = frozenMarketSnapshotOrFallback(tradeDate, runId);
  overseasPreflight.market_snapshot = marketSnapshot;

  ensureDir(reportPath);
  fs.writeFileSync(reportPath, markdownReport({ tradeDate, runId, overseasPreflight, items, marketSnapshot }), "utf8");
  writeJson(overseasPath, overseasPreflight);
  const bridgeResults = [];
  for (const item of items) {
    const inputPath = path.join(STATE_DIR, `opening_report_0830.industry_bias.${item.industry}.json`);
    const receiptPath = path.join(RUNTIME_DIR, "data", "scan-receipts", `opening-report-0830-priority-bias-bridge-${item.industry}-${compact}.json`);
    writeJson(inputPath, item);
    if (applyBridge) {
      const result = runBridge(inputPath, receiptPath, tradeDate);
      const verify = result.exitCode === 0 ? verifyBridge(receiptPath, tradeDate) : { exitCode: null, stdout: "", stderr: "bridge_apply_failed" };
      bridgeResults.push({ industry: item.industry, inputPath, receiptPath, result, verify });
    }
    else bridgeResults.push({ industry: item.industry, inputPath, receiptPath, skipped: true, reason_code: "bridge_apply_not_requested" });
  }
  const overseasLeaderSummary = overseasLeaderReceipt ? { contract: overseasLeaderReceipt.contract, ok: overseasLeaderReceipt.ok, total_leaders: overseasLeaderReceipt.total_leaders, valid_leaders: overseasLeaderReceipt.valid_leaders, unavailable_leaders: overseasLeaderReceipt.unavailable_leaders, source_gap_leaders: overseasLeaderFreshness.source_gap_count, stale_promoted_leaders: overseasLeaderFreshness.stale_promoted_count, file: overseasLeaderDetector.file } : null;
  const lineCardText = lineReportText({ tradeDate, items, marketSnapshot, overseasLeaderDetection: overseasLeaderSummary });
  const lineFlexCard = lineReportFlex({ tradeDate, items, marketSnapshot, overseasLeaderDetection: overseasLeaderSummary });
  const deliveryContentHash = sha256(JSON.stringify({ date: tradeDate, run_id: runId, market_snapshot: marketSnapshot, industries: items }));
  const lineReceipt = await pushLine({ cardText: lineCardText, flexCard: lineFlexCard, runId, dryRun: dryRunLine, contentHash: deliveryContentHash });
  const motherPoolBridgeOk = applyBridge
    ? bridgeResults.length > 0 && bridgeResults.every((row) => row.result?.exitCode === 0 && row.verify?.exitCode === 0)
    : null;
  const lineReceiptPath = path.join(RECEIPT_DIR, `line-push-receipt-${compact}.json`);
  writeJson(lineReceiptPath, lineReceipt);
  const reportCoreOk = Boolean(reportPath) && fs.existsSync(reportPath);
  const lineDeliveryOk = !sendLine || lineReceipt.line_push_ok === true;
  const overseasSnapshotReadable = marketSnapshotRows(marketSnapshot).some((row) => hasMarketPercent(row.percent));
  const reportDataStatus = overseasPreflight.ok === true && overseasSnapshotReadable ? "REPORT_OK" : "REPORT_DEGRADED";
  const reportOk = reportCoreOk && lineDeliveryOk;
  const motherPoolBridgeStatus = applyBridge
    ? (motherPoolBridgeOk === true ? "BRIDGE_OK" : "BRIDGE_FAIL_CLOSED")
    : "BRIDGE_NOT_REQUESTED";
  const final = {
    contract: "opening-report-0830-production-v1",
    market_calendar: marketCalendar,
    ok: reportOk,
    report_status: reportOk ? reportDataStatus : "REPORT_FAIL_CLOSED",
    report_core_ok: reportCoreOk,
    report_core_status: reportCoreOk ? "REPORT_CORE_OK" : "REPORT_CORE_FAIL_CLOSED",
    line_required: sendLine,
    line_delivery_ok: lineDeliveryOk,
    stage_status: {
      report_core: reportCoreOk ? "PASS" : "FAIL",
      line_flex_card: lineDeliveryOk ? (sendLine ? "PASS" : "SKIP_DRY_RUN") : "FAIL",
      mother_pool_priority_bias_bridge: motherPoolBridgeOk === true ? "PASS" : "OPTIONAL_FAIL_CLOSED",
      taiwan_formal_gate: "NOT_PART_OF_0830_REPORT",
    },
    overseas_sources_ok: overseasPreflight.ok === true && overseasSnapshotReadable,
    overseas_market_snapshot: marketSnapshot,
    overseas_leader_detector: overseasLeaderDetector,
    overseas_leader_detection: overseasLeaderSummary,
    overseas_source_gap_count: overseasLeaderFreshness.source_gap_count,
    overseas_stale_promoted_count: overseasLeaderFreshness.stale_promoted_count,
    overseas_partial_source_gaps: overseasLeaderFreshness.source_gap_count > 0,
    industry_bias_exported: true,
    mother_pool_bridge_attempted: applyBridge,
    mother_pool_bridge_ok: motherPoolBridgeOk,
    mother_pool_bridge_status: motherPoolBridgeStatus,
    mother_pool_bridge_optional_handoff: true,
    line_push_attempted: sendLine,
    line_push_ok: lineReceipt.line_push_ok,
    line_message_type: lineReceipt.message_type || "flex",
    delivery_content_hash: deliveryContentHash,
    formal_candidates: 0,
    watchlist_only: true,
    run_id: runId,
    date: tradeDate,
    report_path: reportPath,
    overseas_preflight_receipt: overseasPath,
    line_push_receipt: lineReceiptPath,
    bridge_results: bridgeResults.map((row) => ({ industry: row.industry, inputPath: row.inputPath, receiptPath: row.receiptPath, skipped: row.skipped === true, apply_exit_code: row.result?.exitCode ?? null, verify_exit_code: row.verify?.exitCode ?? null, reason_code: row.reason_code || "" })),

    checked_at: timestamp()
  };
  writeJson(finalPath, final);
  const terminalBriefingSnapshot = hasFlag("--no-terminal-snapshot") ? { ok: true, skipped: true, reason_code: "isolated_smoke_no_terminal_snapshot" } : await syncTerminalBriefingSnapshot(tradeDate, runId, deliveryContentHash);
  final.terminal_briefing_snapshot = terminalBriefingSnapshot;
  writeJson(finalPath, final);
  console.log(JSON.stringify({ ok: final.ok, final_receipt: finalPath, report_path: reportPath, run_id: runId, report_status: final.report_status, terminal_briefing_snapshot_ok: terminalBriefingSnapshot.ok === true }, null, 2));
  if (!final.ok || (hasFlag("--self-test") && !final.industry_bias_exported)) process.exitCode = 1;
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, reason_code: "opening_report_0830_runner_error", error: error?.stack || error?.message || String(error) }, null, 2));
  process.exitCode = 1;
});
