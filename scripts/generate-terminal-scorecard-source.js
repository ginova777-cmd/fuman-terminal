"use strict";

const fs = require("fs");
const path = require("path");
const { serverSupabaseKey, serverSupabaseUrl } = require("../lib/server-supabase-key");
const { isTwseTradingDay } = require("./twse-trading-day");
const { RULE_CONTRACT, applyScorecardRuleMetadata, verifyScorecardStrategyRules } = require("../lib/scorecard-rule-locks");
const { buildScanAudit } = require("../lib/scorecard-scan-audit");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const OUT_FILE = process.argv.find((arg) => arg.startsWith("--out="))?.slice("--out=".length)
  || path.join(RUNTIME_DIR, "data", "scorecard-terminal-current.json");
const DEFAULT_OUT_FILE = path.join(RUNTIME_DIR, "data", "scorecard-terminal-current.json");
const BLOCKED_RECEIPT_DIR = path.join(RUNTIME_DIR, "data", "scan-receipts");
const MIN_CURRENT_RETAIN_RATIO = Number(process.env.FUMAN_SCORECARD_MIN_CURRENT_RETAIN_RATIO || 0.75);

const TASKS = [
  {
    key: "strategy2",
    strategy: "策略2成績單",
    endpoint: "/api/strategy2-latest",
    modulePath: "../api/strategy2-latest",
    arrayKeys: ["events", "records", "matches", "rows"],
    limit: 120,
  },
  {
    key: "strategy3",
    strategy: "策略3隔日沖成績單",
    endpoint: "/api/strategy3-latest",
    modulePath: "../api/strategy3-latest",
    arrayKeys: ["matches", "rows"],
    limit: 120,
  },
  {
    key: "strategy4",
    strategy: "策略4成績單",
    endpoint: "/api/strategy4-latest",
    modulePath: "../api/strategy4-latest",
    arrayKeys: ["matches", "rows"],
    limit: 120,
  },
  {
    key: "strategy5",
    strategy: "策略5成績單",
    endpoint: "/api/strategy5-latest",
    modulePath: "../api/strategy5-latest",
    arrayKeys: ["matches", "rows"],
    limit: 120,
  },
  {
    key: "institution",
    strategy: "買賣超成績單",
    endpoint: "/api/institution-latest",
    modulePath: "../api/institution-latest",
    arrayKeys: ["rows", "matches"],
    limit: 120,
  },
];

function cleanText(value) {
  return String(value ?? "").trim();
}

function isRetiredScorecardStrategy(value) {
  return /即時雷達|熱力圖|realtime-radar|heatmap|strategy1|open-buy|openBuy|open_buy|明日開盤|開盤入/i.test(cleanText(value));
}

function cleanNumber(value) {
  const number = Number(String(value ?? "").replace(/[,+%]/g, "").trim());
  return Number.isFinite(number) ? number : 0;
}

function roundPrice(value) {
  return Math.round(cleanNumber(value) * 10000) / 10000;
}

function taipeiDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function isoDate(value, fallback = taipeiDate()) {
  const text = cleanText(value);
  if (!text) return fallback;
  const digits = text.replace(/\D/g, "");
  if (/^\d{8}$/.test(digits)) return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  if (/^\d{1,2}\/\d{1,2}$/.test(text)) {
    const [month, day] = text.split("/");
    return `${fallback.slice(0, 4)}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  return fallback;
}

function scorecardFallbackDate() {
  return isoDate(process.env.FUMAN_SCANNER_TARGET_DATE || process.env.FUMAN_SCANNER_TARGET_TRADE_DATE || process.env.FUMAN_SCORECARD_EXPECTED_DATE || "", taipeiDate());
}

function taipeiDateFromTimestamp(value) {
  const parsed = Date.parse(cleanText(value));
  return Number.isFinite(parsed) ? taipeiDate(new Date(parsed)) : "";
}

function compactToIso(value) {
  const digits = cleanText(value).replace(/\D/g, "");
  return /^\d{8}$/.test(digits) ? `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}` : "";
}

function normalizeDate(value) {
  return isoDate(value, "");
}

function dateFromReport(report) {
  return normalizeDate(report?.date || "");
}

function latestRunIdDate(runId) {
  const matches = cleanText(runId).match(/20\d{6}/g) || [];
  return compactToIso(matches.at(-1) || "");
}

function boundedRecordDate(value) {
  const date = isoDate(value || "", "");
  const expected = scorecardFallbackDate();
  return expected && date && date > expected ? expected : date;
}
function scorecardRecordDate(task, payload, row) {
  const explicit = isoDate(row.record_date || row.scorecardDate || payload.scorecardDate || payload.recordDate || "", "");
  if (explicit) return boundedRecordDate(explicit);

  const sourceDate = isoDate(
    row.scan_date
      || row._strategy3ScorecardSourceDate
      || row._strategy5ScorecardSourceDate
      || row.tradeDate
      || row.usedDate
      || row.date
      || payload.scanDate
      || payload.tradeDate
      || payload.usedDate
      || payload.sourceDate
      || payload.date,
    "",
  );
  if (sourceDate) return boundedRecordDate(sourceDate);

  const runDate = latestRunIdDate(row.runId || row.run_id || payload.runId || payload.transport?.runId || payload.transport?.snapshotId);
  if (runDate) return boundedRecordDate(runDate);

  const updatedDate = taipeiDateFromTimestamp(row.updatedAt || row.updated_at || payload.updatedAt || payload.generatedAt || payload.timestamp);
  if (updatedDate) return boundedRecordDate(updatedDate);

  return boundedRecordDate(scorecardFallbackDate());
}

function buildEndpoint(endpoint, query = {}) {
  const url = new URL(endpoint, "https://fuman.local");
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  return `${url.pathname}${url.search}`;
}

function createCaptureResponse(resolve, label) {
  let settled = false;
  const done = (statusCode, payload, headers = {}) => {
    if (settled) return;
    settled = true;
    resolve({ statusCode, payload, headers, label });
  };
  return {
    statusCode: 200,
    headers: {},
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = value;
    },
    status(code) {
      this.statusCode = Number(code) || 200;
      return this;
    },
    json(payload) {
      done(this.statusCode || 200, payload, this.headers);
      return this;
    },
    send(payload) {
      done(this.statusCode || 200, payload, this.headers);
      return this;
    },
    end(payload = "") {
      done(this.statusCode || 204, payload, this.headers);
      return this;
    },
  };
}

function callApi(task, timeoutMs = 45000) {
  return new Promise((resolve) => {
    const handler = require(task.modulePath);
    const query = {
      canvas: "1",
      compact: "1",
      shell: "1",
      live: "1",
      date: scorecardFallbackDate(),
      limit: String(task.limit || 120),
    };
    const endpoint = buildEndpoint(task.endpoint, query);
    const timer = setTimeout(() => {
      resolve({
        statusCode: 504,
        payload: { ok: false, error: "scorecard_source_api_timeout", endpoint },
        label: endpoint,
      });
    }, timeoutMs);
    const finish = (result) => {
      clearTimeout(timer);
      resolve(result);
    };
    const request = {
      method: "GET",
      url: endpoint,
      headers: { host: "localhost", "x-scorecard-source": "1" },
      query,
      fumanInternalVerify: true,
    };
    Promise.resolve(handler(request, createCaptureResponse(finish, endpoint))).catch((error) => {
      finish({
        statusCode: 500,
        payload: { ok: false, error: "scorecard_source_api_failed", message: error?.message || String(error), endpoint },
        label: endpoint,
      });
    });
  });
}

function arraysFromTaskPayload(task, payload) {
  let selected = [];
  let selectedKey = "";
  for (const key of task.arrayKeys || []) {
    if (Array.isArray(payload?.[key])) {
      selected = payload[key];
      selectedKey = key;
      if (selected.length) break;
    }
  }
  const rows = selected.map((row) => ({ ...row, _scorecardArrayKey: selectedKey || "rows" }));
  if (!rows.length && payload?.data && typeof payload.data === "object" && !Array.isArray(payload.data)) {
    for (const [code, row] of Object.entries(payload.data)) rows.push({ ...(row || {}), code });
  }
  const seen = new Set();
  return rows.filter((row, index) => {
    const code = cleanText(row.code || row.symbol || row.ticker || row.underlyingCode || row.cbCode || row.warrantCode || index);
    const rowKey = [row._scorecardArrayKey || "rows", code, cleanText(row.name || row.cbName || row.warrantName), index].join(":");
    if (seen.has(rowKey)) return false;
    seen.add(rowKey);
    return true;
  });
}

function lowerText(value) {
  return cleanText(value).toLowerCase();
}

function boolFalse(value) {
  return value === false || lowerText(value) === "false" || lowerText(value) === "no";
}

function boolTrue(value) {
  return value === true || lowerText(value) === "true" || lowerText(value) === "yes";
}

function payloadDecisionDate(payload = {}) {
  return normalizeDate(payload.usedDate || payload.tradeDate || payload.sourceDate || payload.date || payload.scanDate || payload.marketDate || latestRunIdDate(payload.runId || payload.transport?.runId));
}

function rowPublishDecision(task, payload = {}, result = {}, context = {}) {
  const quality = payload.run_quality_at_publish || payload.runQualityAtPublish || {};
  const sourceCoverage = payload.sourceCoverage || payload.source_coverage || {};
  const evidence = lowerText(payload.evidenceStatus || payload.sourceEvidenceStatus || quality.evidenceStatus || payload.qualityStatus);
  const reasonText = lowerText([
    payload.reason,
    payload.error,
    payload.detail,
    payload.status,
    payload.qualityStatus,
    payload.cacheSource,
    payload.source,
    payload.fallbackReason,
  ].join(" "));
  const payloadDate = payloadDecisionDate(payload);
  const expectedDisplayDate = normalizeDate(context.expectedDisplayDate || "");
  const marketClosedLastGood = context.marketClosed === true
    && expectedDisplayDate
    && payloadDate === expectedDisplayDate
    && !boolTrue(payload.fallbackUsed)
    && !boolTrue(payload.fallback)
    && !boolTrue(payload.rawFallback)
    && !/source_quality_fail|insufficient|stale|degraded|not_ready|blocked/.test([reasonText, evidence].join(" "));
  const runIdDate = latestRunIdDate(payload.runId || payload.transport?.runId);
  const todayCompleteAuthoritative = Boolean(
    expectedDisplayDate
    && payloadDate === expectedDisplayDate
    && (!runIdDate || runIdDate === expectedDisplayDate)
    && Number(result.statusCode || 0) < 400
    && payload.ok !== false
    && !boolFalse(payload.publishAllowed)
    && !boolFalse(quality.publishAllowed)
    && !boolTrue(payload.fallbackUsed)
    && !boolTrue(payload.fallback)
    && !boolTrue(payload.rawFallback)
    && /complete|ok|ready/.test(evidence || lowerText(payload.qualityStatus))
    && !/source_quality_fail|insufficient|stale|degraded|not_ready|blocked|fallback/.test([reasonText, evidence].join(" "))
  );
  const blockers = [];
  if (Number(result.statusCode || 0) >= 400) blockers.push(`http_${result.statusCode}`);
  if (payload.ok === false) blockers.push("payload_ok_false");
  if (boolFalse(payload.publishAllowed) || boolFalse(quality.publishAllowed)) blockers.push("publish_not_allowed");
  if ((boolTrue(payload.fallbackUsed) || boolTrue(payload.fallback) || boolTrue(payload.rawFallback)) && !marketClosedLastGood) blockers.push("fallback_used");
  if ((payload.preservePreviousGood === true || quality.preservePreviousGood === true) && !marketClosedLastGood && !todayCompleteAuthoritative) blockers.push("preserve_previous_good");
  if (sourceCoverage.ok === false && !todayCompleteAuthoritative) blockers.push("source_coverage_not_ok");
  if (/insufficient|source_quality_fail|degraded|blocked|not_ready|fallback|previous_good|stale/.test(evidence)) blockers.push(`evidence_${evidence || "not_complete"}`);
  if (/source_quality_fail|fallback|previous_good|stale|degraded|not_ready|blocked/.test(reasonText) && !marketClosedLastGood && !todayCompleteAuthoritative) blockers.push("reason_blocked_or_stale");
  return {
    allow: blockers.length === 0,
    reason: blockers[0] || (marketClosedLastGood ? "market_closed_last_good" : "publishable"),
    blockers,
    marketClosedLastGood,
    payloadDate,
    expectedDisplayDate,
  };
}

function codeOf(row, fallback) {
  return cleanText(row.code || row.symbol || row.ticker || row.underlyingCode || row.cbCode || row.warrantCode || fallback);
}

function nameOf(row, code) {
  return cleanText(row.rawName || row.name || row.displayName || row.underlyingName || row.cbName || row.warrantName || code);
}

function priceOf(row) {
  const latest = row?.latestRecord && typeof row.latestRecord === "object" ? row.latestRecord : {};
  return cleanNumber(
    row.entry_price
      ?? row.entryPrice
      ?? row.entryPriceValue
      ?? row.stockPrice
      ?? row.firstTradableAPrice
      ?? row.firstAPrice
      ?? row.latestAPrice
      ?? row.firstBPrice
      ?? row.latestBPrice
      ?? row.latestSeenPrice
      ?? row.close
      ?? row.price
      ?? row.lastPrice
      ?? row.referencePrice
      ?? latest.entryPrice
      ?? latest.observedPrice
      ?? latest.dayHigh
  );
}

function highOf(row, entryPrice) {
  const latest = row?.latestRecord && typeof row.latestRecord === "object" ? row.latestRecord : {};
  return cleanNumber(
    row.high_price
      ?? row.highPrice
      ?? row.highestPrice
      ?? row.highAfterA
      ?? row.highAfterB
      ?? row.dayHigh
      ?? row.high
      ?? row.close
      ?? row.price
      ?? latest.observedHigh
      ?? latest.dayHigh
  ) || entryPrice;
}

function pnlOf(row, entryPrice, highPrice) {
  if (entryPrice && highPrice) return roundPrice(highPrice - entryPrice);
  const explicit = cleanNumber(row.pnl ?? row.profit ?? row.profit_loss ?? row.return_amount);
  if (Number.isFinite(explicit)) return roundPrice(explicit);
  return 0;
}

function timeMinutes(value) {
  const text = cleanText(value);
  const match = text.match(/(?:^|T|\s)(\d{1,2}):(\d{2})(?::\d{2})?/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

function taipeiTime(value) {
  const text = cleanText(value);
  if (!text) return "";
  if (/^\d{4}-\d{2}-\d{2}(?:T|\s)/.test(text)) {
    const parsed = Date.parse(text);
    if (Number.isFinite(parsed)) {
      const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Taipei",
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }).formatToParts(new Date(parsed));
      const get = (type) => parts.find((part) => part.type === type)?.value || "00";
      return `${get("hour")}:${get("minute")}:${get("second")}`;
    }
  }
  const clock = text.match(/(?:^|T|\s)(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (clock) {
    return `${clock[1].padStart(2, "0")}:${clock[2]}${clock[3] ? `:${clock[3]}` : ""}`;
  }
  const numeric = Number(text);
  if (Number.isFinite(numeric) && numeric > 1000000000) {
    const millis = numeric > 100000000000000000 ? numeric / 1000000
      : numeric > 10000000000000 ? numeric / 1000
        : numeric;
    return taipeiTime(new Date(millis).toISOString());
  }
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Taipei",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(parsed));
  const get = (type) => parts.find((part) => part.type === type)?.value || "00";
  return `${get("hour")}:${get("minute")}:${get("second")}`;
}

function clampRealtimeRadarEntryTime(value) {
  const text = taipeiTime(value);
  const minutes = timeMinutes(text);
  if (minutes === null) return "13:30";
  if (minutes < 9 * 60) return "09:00";
  if (minutes > 13 * 60 + 30) return "13:30";
  return text;
}

function fallbackEntryTime(task, payload) {
  if (task.key === "strategy3") return "13:00";
  if (task.key === "strategy4") return "13:30";
  if (task.key === "strategy5") return "14:00";
  if (task.key === "institution") return "14:00";
  return taipeiTime(payload.updatedAt || payload.generatedAt || payload.finishedAt || payload.timestamp);
}

function entryTimeOf(task, payload, row) {
  if (task.key === "strategy3") return "13:00";
  if (task.key === "realtime-radar") {
    return clampRealtimeRadarEntryTime(
      row.entry_time
        || row.entryTime
        || row.time
        || row.quoteTime
        || row.latestSeenAt
        || row.updatedAt
        || payload.updatedAt
        || payload.generatedAt
        || payload.timestamp,
    );
  }
  const latest = row?.latestRecord && typeof row.latestRecord === "object" ? row.latestRecord : {};
  if (task.key === "strategy2") {
    const strategy2Candidates = [
      row.quoteTime,
      row.quote_time,
      latest.quoteTime,
      latest.quote_time,
      row.entry_time,
      row.entryTime,
      row.firstTradableAAt,
      row.firstAAt,
      row.latestAAt,
      row.latestSeenAt,
      latest.entryAt,
      latest.timestamp,
      row.entryAt,
      row.time,
      row.updatedAt,
      payload.updatedAt,
    ];
    for (const candidate of strategy2Candidates) {
      const time = taipeiTime(candidate);
      if (time) return time;
    }
    return fallbackEntryTime(task, payload);
  }
  const candidates = [
    row.entry_time,
    row.entryTime,
    row.entryAt,
    row.firstTradableAAt,
    row.firstAAt,
    row.latestAAt,
    row.firstBAt,
    row.latestBAt,
    row.latestSeenAt,
    row.time,
    row.quoteTime,
    row.updatedAt,
    row.updated_at,
    row.scanTime,
    row.scan_time,
    row.detectedAt,
    row.detected_at,
    row.createdAt,
    row.created_at,
    latest.entryAt,
    latest.timestamp,
    latest.quoteTime,
    latest.updatedAt,
    latest.updated_at,
    latest.time,
  ];
  for (const candidate of candidates) {
    const time = taipeiTime(candidate);
    if (time) return time;
  }
  return fallbackEntryTime(task, payload);
}

function includeInScorecard(row) {
  const minutes = timeMinutes(row.entry_time);
  if (row.strategy === "策略2成績單") {
    return minutes !== null && minutes >= 9 * 60 && minutes <= 13 * 60 + 30;
  }
  if (row.strategy === "即時雷達成績單") {
    return minutes !== null && minutes >= 9 * 60 && minutes <= 13 * 60 + 30;
  }
  return true;
}

async function fetchQuoteHighMap(records) {
  const url = serverSupabaseUrl();
  const key = serverSupabaseKey();
  if (!url || !key) return new Map();
  const codes = [...new Set(records.map((row) => cleanText(row.ticker)).filter((code) => /^\d{4}$/.test(code)))];
  const map = new Map();
  for (let index = 0; index < codes.length; index += 80) {
    const chunk = codes.slice(index, index + 80);
    const query = [
      "select=code,symbol,name,close,last_price,high,updated_at,last_trade_time",
      `code=in.(${chunk.map(encodeURIComponent).join(",")})`,
    ].join("&");
    try {
      const response = await fetch(`${url}/rest/v1/fugle_quotes_latest?${query}`, {
        headers: {
          apikey: key,
          authorization: `Bearer ${key}`,
          accept: "application/json",
        },
      });
      if (!response.ok) continue;
      const rows = await response.json();
      for (const row of Array.isArray(rows) ? rows : []) {
        const code = cleanText(row.code || row.symbol);
        const high = cleanNumber(row.high);
        if (code && high) map.set(code, { high, name: cleanText(row.name), updatedAt: cleanText(row.updated_at || row.last_trade_time) });
      }
    } catch {}
  }
  return map;
}

async function enrichWithQuoteHighs(records) {
  const quoteMap = await fetchQuoteHighMap(records);
  if (!quoteMap.size) return records;
  return records.map((row) => {
    if (cleanText(row.strategy) === "策略3隔日沖成績單") return row;
    const quote = quoteMap.get(cleanText(row.ticker));
    if (!quote) return row;
    const entryPrice = cleanNumber(row.entry_price);
    const sourceHigh = cleanNumber(row.high_price);
    const highPrice = Math.max(sourceHigh, cleanNumber(quote.high), entryPrice);
    const next = {
      ...row,
      name: cleanText(row.name) || quote.name || row.ticker,
      high_price: roundPrice(highPrice),
      pnl: pnlOf(row, entryPrice, highPrice),
    };
    if (quote.high && quote.high > sourceHigh) {
      next.reason = `${row.reason}；最高價補值=fugle_quotes_latest ${roundPrice(quote.high)}`.slice(0, 500);
    }
    return next;
  });
}

async function fetchSupabaseRows(table, query) {
  const url = serverSupabaseUrl();
  const key = serverSupabaseKey();
  if (!url || !key) return [];
  try {
    const response = await fetch(`${url}/rest/v1/${table}?${query}`, {
      headers: {
        apikey: key,
        authorization: `Bearer ${key}`,
        accept: "application/json",
      },
    });
    if (!response.ok) return [];
    const rows = await response.json();
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

async function previousTwseTradingDate(dateText) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanText(dateText))) return "";
  const date = new Date(`${dateText}T12:00:00+08:00`);
  for (let index = 0; index < 14; index += 1) {
    date.setUTCDate(date.getUTCDate() - 1);
    const candidate = taipeiDate(date);
    const status = await isTwseTradingDay(new Date(`${candidate}T12:00:00+08:00`), { stateDir: path.join(RUNTIME_DIR, "state") });
    if (status.isTradingDay) return candidate;
  }
  return "";
}

function chunkValues(values = [], size = 80) {
  const out = [];
  for (let index = 0; index < values.length; index += size) out.push(values.slice(index, index + size));
  return out;
}

function candleMinute(row = {}) {
  const text = cleanText(row.candle_time || row.candleTime || row.time || "");
  const parsed = Date.parse(text);
  if (Number.isFinite(parsed)) {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Taipei", hour12: false, hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(parsed));
    const hour = Number(parts.find((part) => part.type === "hour")?.value || 0);
    const minute = Number(parts.find((part) => part.type === "minute")?.value || 0);
    return hour * 60 + minute;
  }
  return timeMinutes(text);
}

function normalizeCandleRow(row = {}) {
  return {
    symbol: codeOf(row, ""),
    trade_date: normalizeDate(row.trade_date || ""),
    candle_time: cleanText(row.candle_time || row.candleTime || row.time || ""),
    open: cleanNumber(row.open),
    high: cleanNumber(row.high),
    low: cleanNumber(row.low),
    close: cleanNumber(row.close),
    volume: cleanNumber(row.volume),
    updated_at: cleanText(row.updated_at || row.updatedAt || ""),
  };
}

async function fetchStrategy3Entry1mMap(scanDate, rows = []) {
  const tradeDate = normalizeDate(scanDate || "");
  const symbols = [...new Set((rows || []).map((row) => codeOf(row, "")).filter((code) => /^\d{4}$/.test(code)))];
  const byCode = new Map();
  if (!tradeDate || !symbols.length) return { ok: false, byCode, missing: symbols, source: "fugle_daytrade_intraday_1m", reason: "missing_trade_date_or_symbols" };
  const table = process.env.STRATEGY3_SUPABASE_1M_TABLE || "fugle_daytrade_intraday_1m";
  const entryWindowStartUtc = `${tradeDate}T04:50:00.000Z`;
  const entryWindowEndUtc = `${tradeDate}T05:00:59.999Z`;
  for (const group of chunkValues(symbols, 80)) {
    const query = [
      "select=symbol,market,candle_time,open,high,low,close,volume,updated_at,trade_date",
      `trade_date=eq.${encodeURIComponent(tradeDate)}`,
      `candle_time=gte.${encodeURIComponent(entryWindowStartUtc)}`,
      `candle_time=lte.${encodeURIComponent(entryWindowEndUtc)}`,
      `symbol=in.(${group.map(encodeURIComponent).join(",")})`,
      "order=symbol.asc,candle_time.desc",
      `limit=${Math.max(1000, group.length * 260)}`,
    ].join("&");
    const candles = await fetchSupabaseRows(table, query);
    for (const raw of candles) {
      const candle = normalizeCandleRow(raw);
      const minute = candleMinute(candle);
      if (!/^\d{4}$/.test(candle.symbol)) continue;
      if (candle.trade_date !== tradeDate) continue;
      if (!(candle.close > 0)) continue;
      if (minute == null || minute < 12 * 60 + 50 || minute > 13 * 60) continue;
      const current = byCode.get(candle.symbol);
      if (!current || minute > current.minute || (minute === current.minute && Date.parse(candle.candle_time) > Date.parse(current.candle_time))) byCode.set(candle.symbol, { ...candle, minute });
    }
  }
  const missing = symbols.filter((symbol) => !byCode.has(symbol));
  return { ok: missing.length === 0, byCode, missing, source: `${table}:12:50-13:00`, tradeDate, found: byCode.size, expected: symbols.length, reason: missing.length ? "strategy3_1300_intraday_1m_missing_symbols" : "strategy3_1300_intraday_1m_ready" };
}

function applyStrategy3Entry1m(rows = [], entryMapResult = {}) {
  const byCode = entryMapResult.byCode || new Map();
  return (rows || []).map((row) => {
    const code = codeOf(row, "");
    const candle = byCode.get(code);
    if (!candle) return row;
    const entryPrice = roundPrice(candle.close);
    const reason = `${cleanText(row.reason)}；Strategy3 13:00進場價=intraday_1m ${candle.candle_time}`.slice(0, 500);
    return { ...row, entry_price: entryPrice, entryPrice: entryPrice, entry_price_source: "intraday_1m_1300", entryPriceSource: "intraday_1m_1300", entry_candle_time: candle.candle_time, entry_trade_date: candle.trade_date, entry_price_source_detail: entryMapResult.source || "fugle_daytrade_intraday_1m", high_price: entryPrice, highPrice: entryPrice, highestPrice: entryPrice, pnl: 0, reason };
  });
}
async function fetchStrategy3PayloadForScanDate(scanDate) {
  const runRows = await fetchSupabaseRows(
    process.env.STRATEGY3_SUPABASE_RUNS_TABLE || "strategy3_scan_runs",
    [
      "select=run_id,scan_date,finished_at,status,complete,result_count,updated_at,payload",
      "strategy=eq.strategy3",
      "status=eq.complete",
      "complete=eq.true",
      `scan_date=eq.${encodeURIComponent(scanDate)}`,
      "order=updated_at.desc",
      "limit=1",
    ].join("&"),
  );
  const run = runRows[0];
  if (!run?.run_id) return null;
  const resultRows = await fetchSupabaseRows(
    process.env.STRATEGY3_SUPABASE_RESULTS_TABLE || "strategy3_scan_results",
    [
      "select=run_id,scan_date,code,name,price,close,change_percent,volume,trade_volume,trade_value,score,rank,reason,signals,payload,complete,quality_status,generated_at,updated_at",
      "strategy=eq.strategy3",
      `run_id=eq.${encodeURIComponent(run.run_id)}`,
      "order=rank.asc",
      "limit=120",
    ].join("&"),
  );
  const rows = resultRows.map((row, index) => {
    const payload = row.payload && typeof row.payload === "object" ? row.payload : {};
    const signals = Array.isArray(payload.matches) ? payload.matches : Array.isArray(payload.signals) ? payload.signals : row.signals;
    return {
      ...payload,
      code: cleanText(payload.code || row.code),
      name: cleanText(payload.rawName || payload.name || row.name || row.code),
      rawName: cleanText(payload.rawName || payload.name || row.name || row.code),
      close: cleanNumber(payload.close || payload.price || row.close || row.price),
      price: cleanNumber(payload.price || payload.close || row.price || row.close),
      percent: cleanNumber(payload.percent ?? payload.changePercent ?? row.change_percent),
      tradeVolume: cleanNumber(payload.tradeVolume || payload.volume || row.trade_volume || row.volume),
      volume: cleanNumber(payload.volume || payload.tradeVolume || row.volume || row.trade_volume),
      value: cleanNumber(payload.value || payload.tradeValue || row.trade_value),
      tradeValue: cleanNumber(payload.tradeValue || payload.value || row.trade_value),
      score: cleanNumber(payload.score || payload.overnightScore || row.score),
      rank: cleanNumber(payload.rank || row.rank) || index + 1,
      matches: Array.isArray(signals) ? signals : [],
      reason: cleanText(payload.tvOvernightEntry?.reason || payload.reason || row.reason || (Array.isArray(signals) ? signals.map((signal) => signal.reason).filter(Boolean).join("；") : "")),
      scan_date: scanDate,
      usedDate: scanDate,
      _strategy3ScorecardSourceDate: scanDate,
    };
  });
  const entryMapResult = await fetchStrategy3Entry1mMap(scanDate, rows);
  const acceptedEntrySources = new Set(["intraday_1m_1300", "intraday_1m_1300_exact", "intraday_1m_entry_window_tolerance", "intraday_1m_tail_volume_confirmed"]);
  const enrichedRows = applyStrategy3Entry1m(rows, entryMapResult)
    .filter((row) => acceptedEntrySources.has(cleanText(row.entry_price_source || row.entryPriceSource)));
  const emittedSymbols = new Set(enrichedRows.map((row) => codeOf(row, "")));
  const missingSymbols = rows.map((row) => codeOf(row, "")).filter((code) => code && !emittedSymbols.has(code));
  const tailVolumeRows = enrichedRows.filter((row) => cleanText(row.entry_price_source || row.entryPriceSource) === "intraday_1m_tail_volume_confirmed");
  const evidenceComplete = enrichedRows.length === rows.length && missingSymbols.length === 0;
  return {
    ok: evidenceComplete && enrichedRows.length > 0,
    source: "supabase:strategy3_scan_results+fugle_daytrade_intraday_1m_entry_evidence",
    runId: cleanText(run.run_id),
    usedDate: scanDate,
    date: scanDate,
    updatedAt: cleanText(run.finished_at || run.updated_at),
    count: Math.max(enrichedRows.length, cleanNumber(run.result_count)),
    matches: enrichedRows,
    rows: enrichedRows,
    publishAllowed: enrichedRows.length > 0,
    qualityStatus: evidenceComplete ? "complete" : "degraded",
    evidenceStatus: evidenceComplete ? "complete" : "degraded",
    sourceCoverage: {
      ok: evidenceComplete,
      source: entryMapResult.source,
      tradeDate: entryMapResult.tradeDate,
      expectedSymbols: entryMapResult.expected,
      foundSymbols: entryMapResult.found,
      emittedSymbols: enrichedRows.length,
      suppressedSymbols: missingSymbols.length,
      missingSymbols,
      tailVolumeConfirmedSymbols: tailVolumeRows.length,
    },
    reason: evidenceComplete
      ? `scorecard_source_previous_trading_day:${scanDate}; strategy3_entry_evidence_ready; tail_volume=${tailVolumeRows.length}`
      : `strategy3_entry_evidence_partial:${enrichedRows.length}/${rows.length}; missing=${missingSymbols.slice(0, 20).join(",")}`,
  };
}

function reasonOf(row, task) {
  const signals = Array.isArray(row.signals) ? row.signals.join("；") : "";
  const strategyReasons = Array.isArray(row.strategyReasons) ? row.strategyReasons.join("；") : "";
  const strategyTags = Array.isArray(row.strategyTags) ? row.strategyTags.join("；") : "";
  const latest = row?.latestRecord && typeof row.latestRecord === "object" ? row.latestRecord : {};
  return cleanText(
    row.reason
      || row.stateReason
      || row.blockReason
      || strategyReasons
      || strategyTags
      || latest.reason
      || latest.stateReason
      || row.tags?.join?.("；")
      || signals
      || `${task.strategy} latest complete run`
  );
}

function strategy3ScorecardEntryEvidence(row = {}, payload = {}) {
  const detail = cleanText(row.entry_price_source_detail || row.entryPriceSourceDetail || row.entry_price_source || row.entryPriceSource || "");
  const candleTime = cleanText(row.entry_candle_time || row.entryCandleTime || "");
  const tradeDate = normalizeDate(row.entry_trade_date || row.entryTradeDate || row._strategy3ScorecardSourceDate || row.scan_date || row.usedDate || payload.scanDate || payload.usedDate || payload.tradeDate || payload.date || "");
  const minutes = timeMinutes(taipeiTime(candleTime));
  const entryPrice = priceOf(row);
  const known = new Set(["intraday_1m_1300", "intraday_1m_1300_exact", "intraday_1m_entry_window_tolerance", "intraday_1m_tail_volume_confirmed"]);
  const explicit = cleanText(row.entry_price_source || row.entryPriceSource || "");
  if (known.has(explicit)) return { source: explicit, detail, candleTime, tradeDate };
  const fugleFormal = /fugle.*intraday_1m|intraday_1m.*fugle/i.test([detail, cleanText(row.reason)].join(" "));
  if (!fugleFormal || !tradeDate || !(entryPrice > 0) || minutes === null || minutes < 12 * 60 + 59 || minutes > 13 * 60 + 2) {
    return { source: "", detail, candleTime, tradeDate };
  }
  return {
    source: minutes === 13 * 60 ? "intraday_1m_1300_exact" : "intraday_1m_entry_window_tolerance",
    detail,
    candleTime,
    tradeDate,
  };
}

function normalizeRecord(task, payload, row, index) {
  const recordDate = scorecardRecordDate(task, payload, row);
  const code = codeOf(row, `${task.key}-${index + 1}`);
  const entryPrice = priceOf(row);
  const highPrice = highOf(row, entryPrice);
  const sourceDate = normalizeDate(row._strategy3ScorecardSourceDate || row._strategy5ScorecardSourceDate || row.source_date || row.scan_date || payload.sourceDate || payload.usedDate || "");
  const source = "terminal-complete-run-scorecard";
  const reason = reasonOf(row, task);
  const strategy3Evidence = task.key === "strategy3" ? strategy3ScorecardEntryEvidence(row, payload) : null;
  const sourceRow = strategy3Evidence ? {
    ...row,
    entry_price_source: strategy3Evidence.source,
    entryPriceSource: strategy3Evidence.source,
    entry_price_source_detail: strategy3Evidence.detail,
    entry_candle_time: strategy3Evidence.candleTime,
    entry_trade_date: strategy3Evidence.tradeDate,
  } : row;
  return applyScorecardRuleMetadata({
    taskKey: task.key,
    sourceRow,
    payload,
    record: {
    record_id: `${recordDate}-${task.key}-${code}-${index + 1}`,
    record_date: recordDate,
    source_date: sourceDate || recordDate,
    strategy: task.strategy,
    ticker: code,
    name: nameOf(row, code),
    entry_time: entryTimeOf(task, payload, row),
    entry_candle_time: strategy3Evidence ? strategy3Evidence.candleTime : cleanText(row.entry_candle_time || row.entryCandleTime),
    entry_trade_date: strategy3Evidence ? strategy3Evidence.tradeDate : cleanText(row.entry_trade_date || row.entryTradeDate || sourceDate),
    entry_price_source_detail: strategy3Evidence ? strategy3Evidence.detail : cleanText(row.entry_price_source_detail || row.entryPriceSourceDetail),
    entry_price: entryPrice,
    high_price: highPrice,
    pnl: pnlOf(row, entryPrice, highPrice),
    source,
    source_sheet: source,
    reason: task.key === "strategy3" && sourceDate ? `${reason}；策略3來源日=${sourceDate}`.slice(0, 500) : reason,
    },
  });
}

async function fetchStrategy4LatestCompletePayload() {
  const runRows = await fetchSupabaseRows(
    process.env.STRATEGY4_SUPABASE_RUNS_TABLE || "strategy4_scan_runs",
    [
      "select=run_id,scan_date,finished_at,status,complete,result_count,updated_at,payload",
      "strategy=eq.strategy4",
      "status=eq.complete",
      "complete=eq.true",
      "order=updated_at.desc",
      "limit=1",
    ].join("&"),
  );
  const run = runRows[0];
  if (!run?.run_id) return null;
  const resultRows = await fetchSupabaseRows(
    process.env.STRATEGY4_SUPABASE_RESULTS_TABLE || "strategy4_scan_results",
    [
      "select=*",
      `run_id=eq.${encodeURIComponent(run.run_id)}`,
      "order=rank.asc",
      "limit=120",
    ].join("&"),
  );
  const rows = resultRows.map((row, index) => {
    const payload = row.payload && typeof row.payload === "object" ? row.payload : {};
    return {
      ...payload,
      code: cleanText(payload.code || row.code),
      name: cleanText(payload.rawName || payload.name || row.name || row.code),
      rawName: cleanText(payload.rawName || payload.name || row.name || row.code),
      close: cleanNumber(payload.close || payload.price || row.close || row.price),
      price: cleanNumber(payload.price || payload.close || row.price || row.close),
      tradeVolume: cleanNumber(payload.tradeVolume || payload.volume || row.volume),
      volume: cleanNumber(payload.volume || payload.tradeVolume || row.volume),
      score: cleanNumber(payload.score || row.score),
      rank: cleanNumber(payload.rank || row.rank) || index + 1,
      reason: cleanText(payload.reason || row.reason || "Strategy4 latest complete run"),
      scan_date: row.scan_date || row.trade_date || run.scan_date,
      usedDate: row.scan_date || row.trade_date || run.scan_date,
      _strategy4ScorecardSourceDate: row.scan_date || row.trade_date || run.scan_date,
    };
  });
  return {
    ok: true,
    source: "supabase:strategy4_scan_results",
    runId: cleanText(run.run_id),
    usedDate: run.scan_date,
    date: run.scan_date,
    updatedAt: cleanText(run.finished_at || run.updated_at),
    count: Math.max(rows.length, cleanNumber(run.result_count)),
    matches: rows,
    rows,
    reason: "scorecard_source_supabase_latest",
  };
}
async function fetchStrategy5LatestCompletePayload() {
  const runRows = await fetchSupabaseRows(
    process.env.STRATEGY5_SUPABASE_RUNS_TABLE || "strategy5_scan_runs",
    [
      "select=run_id,scan_date,finished_at,status,complete,result_count,updated_at,payload",
      "strategy=eq.strategy5",
      "status=eq.complete",
      "complete=eq.true",
      "order=updated_at.desc",
      "limit=1",
    ].join("&"),
  );
  const run = runRows[0];
  if (!run?.run_id) return null;
  const resultRows = await fetchSupabaseRows(
    process.env.STRATEGY5_SUPABASE_RESULTS_TABLE || "strategy5_scan_results",
    [
      "select=run_id,scan_date,code,name,price,close,change_percent,volume,trade_volume,trade_value,score,rank,reason,signals,payload,complete,quality_status,generated_at,updated_at",
      "strategy=eq.strategy5",
      `run_id=eq.${encodeURIComponent(run.run_id)}`,
      "order=rank.asc",
      "limit=120",
    ].join("&"),
  );
  const rows = resultRows.map((row, index) => {
    const payload = row.payload && typeof row.payload === "object" ? row.payload : {};
    const signals = Array.isArray(payload.matches) ? payload.matches : Array.isArray(payload.signals) ? payload.signals : row.signals;
    return {
      ...payload,
      code: cleanText(payload.code || row.code),
      name: cleanText(payload.rawName || payload.name || row.name || row.code),
      rawName: cleanText(payload.rawName || payload.name || row.name || row.code),
      close: cleanNumber(payload.close || payload.price || row.close || row.price),
      price: cleanNumber(payload.price || payload.close || row.price || row.close),
      percent: cleanNumber(payload.percent ?? payload.changePercent ?? row.change_percent),
      tradeVolume: cleanNumber(payload.tradeVolume || payload.volume || row.trade_volume || row.volume),
      volume: cleanNumber(payload.volume || payload.tradeVolume || row.volume || row.trade_volume),
      value: cleanNumber(payload.value || payload.tradeValue || row.trade_value),
      tradeValue: cleanNumber(payload.tradeValue || payload.value || row.trade_value),
      score: cleanNumber(payload.score || row.score),
      rank: cleanNumber(payload.rank || row.rank) || index + 1,
      matches: Array.isArray(signals) ? signals : [],
      reason: cleanText(payload.reason || payload.activeMatch?.reason || row.reason || (Array.isArray(signals) ? signals.map((signal) => signal.reason).filter(Boolean).join("；") : "")),
      scan_date: row.scan_date || run.scan_date,
      usedDate: row.scan_date || run.scan_date,
      _strategy5ScorecardSourceDate: row.scan_date || run.scan_date,
    };
  });
  return {
    ok: true,
    source: "supabase:strategy5_scan_results",
    runId: cleanText(run.run_id),
    usedDate: run.scan_date,
    date: run.scan_date,
    updatedAt: cleanText(run.finished_at || run.updated_at),
    count: Math.max(rows.length, cleanNumber(run.result_count)),
    matches: rows,
    rows,
    reason: "scorecard_source_supabase_latest",
  };
}

function summarize(records) {
  const map = new Map();
  for (const row of records) {
    const key = `${row.record_date}|||${row.strategy}`;
    const rows = map.get(key) || [];
    rows.push(row);
    map.set(key, rows);
  }
  return [...map.entries()].map(([key, rows]) => {
    const [summaryDate, strategy] = key.split("|||");
    const pnls = rows.map((row) => cleanNumber(row.pnl));
    const wins = pnls.filter((value) => value > 0).length;
    const losses = pnls.filter((value) => value < 0).length;
    const flats = pnls.length - wins - losses;
    const totalPnl = pnls.reduce((sum, value) => sum + value, 0);
    return {
      summary_date: summaryDate,
      strategy,
      signals: rows.length,
      backtestable: rows.length,
      wins,
      losses,
      flats,
      win_rate_pct: rows.length ? (wins / rows.length) * 100 : 0,
      total_pnl: totalPnl,
      avg_pnl: rows.length ? totalPnl / rows.length : 0,
      max_profit: pnls.length ? Math.max(...pnls) : 0,
      max_loss: pnls.length ? Math.min(...pnls) : 0,
      status: "complete",
      note: "Generated from terminal latest complete-run APIs; pnl is signal-time conservative value when no settled performance exists.",
      source: "terminal-complete-run-scorecard",
      source_sheet: "terminal-complete-run-scorecard",
    };
  });
}

function readJsonSafe(file) {
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function recordsOf(payload) {
  return Array.isArray(payload?.records) ? payload.records : [];
}

function activeScorecardRecords(records) {
  return (Array.isArray(records) ? records : []).filter((row) => {
    const surfaceName = `${row?.strategy || ""} ${row?.source || ""} ${row?.dataSource || ""} ${row?.key || ""}`;
    return !isRetiredScorecardStrategy(surfaceName);
  });
}
function strategySetOf(records) {
  return new Set(records.map((row) => cleanText(row.strategy || row.strategyName || row.source || row.dataSource)).filter(Boolean));
}

function scorecardCurrentWriteDecision(nextPayload, outFile) {
  if (nextPayload?.ok === false) {
    return { allow: false, reason: cleanText(nextPayload.ruleVerification?.issues?.join(",") || nextPayload.issues?.join(",") || "scorecard_payload_not_ok") };
  }
  if (path.resolve(outFile) !== path.resolve(DEFAULT_OUT_FILE)) {
    return { allow: true, reason: "non_default_out_file" };
  }
  if (process.env.FUMAN_SCORECARD_ALLOW_CURRENT_SHRINK === "1") {
    return { allow: true, reason: "explicit_allow_current_shrink" };
  }
  const previous = readJsonSafe(outFile);
  const previousRecords = activeScorecardRecords(recordsOf(previous));
  const nextRecords = activeScorecardRecords(recordsOf(nextPayload));
  if (!previousRecords.length || !nextRecords.length) {
    return { allow: Boolean(nextRecords.length), reason: nextRecords.length ? "no_previous_good" : "next_empty" };
  }
  const previousStrategies = strategySetOf(previousRecords);
  for (const report of Array.isArray(previous?.sourceReports) ? previous.sourceReports : []) {
    const strategy = cleanText(report?.strategy || report?.strategyName || report?.source || report?.key);
    if (strategy && !isRetiredScorecardStrategy(strategy)) previousStrategies.add(strategy);
  }
  const nextStrategies = strategySetOf(nextRecords);
  for (const report of Array.isArray(nextPayload?.sourceReports) ? nextPayload.sourceReports : []) {
    const strategy = cleanText(report?.strategy || report?.strategyName || report?.source || report?.key);
    if (strategy && !isRetiredScorecardStrategy(strategy)) nextStrategies.add(strategy);
  }
  const previousDate = isoDate(previous?.latestDate || previous?.summary?.latestDate || "", "");
  const nextDate = isoDate(nextPayload?.latestDate || nextPayload?.summary?.latestDate || "", "");
  if (previousDate && nextDate && nextDate > previousDate) {
    return {
      allow: true,
      reason: "current_write_date_advanced",
      previousRows: previousRecords.length,
      nextRows: nextRecords.length,
      previousDate,
      nextDate,
      previousStrategies: previousStrategies.size,
      nextStrategies: nextStrategies.size,
    };
  }
  const retainRatio = previousRecords.length ? nextRecords.length / previousRecords.length : 1;
  const missingStrategies = [...previousStrategies].filter((strategy) => !nextStrategies.has(strategy));
  const suspiciousShrink = missingStrategies.length > 0 || nextStrategies.size < previousStrategies.size;
  if (!suspiciousShrink) {
    return {
      allow: true,
      reason: "current_write_safe",
      previousRows: previousRecords.length,
      nextRows: nextRecords.length,
      previousStrategies: previousStrategies.size,
      nextStrategies: nextStrategies.size,
      retainRatio,
    };
  }
  return {
    allow: false,
    reason: "blocked_current_shrink_preserve_previous_good",
    previousRows: previousRecords.length,
    nextRows: nextRecords.length,
    previousStrategies: previousStrategies.size,
    nextStrategies: nextStrategies.size,
    retainRatio,
    missingStrategies,
    previousRunId: cleanText(previous.runId || previous.scorecardRunId),
    nextRunId: cleanText(nextPayload.runId || nextPayload.scorecardRunId),
  };
}

function writeBlockedCurrentReceipt(decision, nextPayload) {
  fs.mkdirSync(BLOCKED_RECEIPT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const receiptFile = path.join(BLOCKED_RECEIPT_DIR, `scorecard-current-shrink-blocked-${stamp}.json`);
  const payload = {
    ok: false,
    contract: "scorecard-current-preserve-previous-good-v1",
    blocked: true,
    previousGoodPreserved: true,
    checkedAt: new Date().toISOString(),
    out: OUT_FILE,
    decision,
    nextSummary: {
      latestDate: nextPayload.latestDate,
      rows: recordsOf(nextPayload).length,
      sourceReports: Array.isArray(nextPayload.sourceReports) ? nextPayload.sourceReports : [],
    },
  };
  fs.writeFileSync(receiptFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return receiptFile;
}

function alignRecordDate(row, recordDate) {
  if (!recordDate || row.record_date === recordDate) return row;
  const sourceDate = normalizeDate(row.source_date || row.scan_date || "");
  if (sourceDate) return row;
  const recordId = cleanText(row.record_id);
  return {
    ...row,
    record_id: /^\d{4}-\d{2}-\d{2}-/.test(recordId)
      ? recordId.replace(/^\d{4}-\d{2}-\d{2}/, recordDate)
      : `${recordDate}-${recordId || row.strategy || row.ticker}`,
    record_date: recordDate,
  };
}

async function main() {
  const reports = [];
  const records = [];
  const tradingDay = await isTwseTradingDay(new Date(), { stateDir: path.join(RUNTIME_DIR, "state") });
  const requestedScorecardDate = normalizeDate(process.env.FUMAN_SCORECARD_EXPECTED_DATE || process.env.FUMAN_SCANNER_TARGET_DATE || process.env.FUMAN_SCANNER_TARGET_TRADE_DATE || "");
  const expectedDisplayDate = requestedScorecardDate || (tradingDay.isTradingDay ? tradingDay.date : (await previousTwseTradingDate(tradingDay.date) || tradingDay.date));
  const explicitExpectedDateMode = Boolean(requestedScorecardDate);
  for (const task of TASKS.filter((item) => item.key && item.modulePath && item.endpoint)) {
    const result = await callApi(task);
    const payload = result.payload || {};
    const rows = arraysFromTaskPayload(task, payload);
    const publishDecision = rowPublishDecision(task, payload, result, {
      marketClosed: explicitExpectedDateMode ? false : tradingDay.isTradingDay === false,
      expectedDisplayDate,
    });
    const emittedRows = publishDecision.allow ? rows : [];
    emittedRows.forEach((row, index) => records.push(normalizeRecord(task, payload, row, index)));
    reports.push({
      key: task.key,
      strategy: task.strategy,
      statusCode: result.statusCode,
      ok: payload.ok !== false && Number(result.statusCode || 0) < 400 && publishDecision.allow,
      runId: cleanText(payload.runId || payload.transport?.runId),
      count: cleanNumber(payload.count ?? payload.total ?? rows.length),
      emittedRows: emittedRows.length,
      suppressedRows: rows.length - emittedRows.length,
      rowSuppressionReason: publishDecision.allow ? "" : publishDecision.reason,
      rowSuppressionBlockers: publishDecision.blockers,
      publishAllowed: payload.publishAllowed ?? payload.run_quality_at_publish?.publishAllowed,
      evidenceStatus: cleanText(payload.evidenceStatus || payload.sourceEvidenceStatus || payload.run_quality_at_publish?.evidenceStatus || payload.qualityStatus),
      fallbackUsed: payload.fallbackUsed === true || payload.fallback === true || payload.rawFallback === true,
      marketClosedLastGood: publishDecision.marketClosedLastGood === true,
      expectedDisplayDate: publishDecision.expectedDisplayDate || "",
      date: cleanText(payload.usedDate || payload.tradeDate || payload.sourceDate || payload.date),
      reason: cleanText(payload.reason || payload.detail || payload.error || publishDecision.reason),
    });
  }
  let rawRecords = records.filter((row) => row.record_date && row.ticker);
  const sourceLatestDate = reports.filter((report) => cleanNumber(report.emittedRows ?? report.count) > 0).map(dateFromReport).filter(Boolean).sort().at(-1) || "";
  const batchLatestDate = rawRecords.map((row) => row.record_date).sort().at(-1) || taipeiDate();
  let latestDate = tradingDay.isTradingDay ? batchLatestDate : (sourceLatestDate || batchLatestDate);
  const strategy3SourceDate = latestDate;
  const strategy3Task = TASKS.find((task) => task.key === "strategy3");
  const strategy3Payload = strategy3SourceDate ? await fetchStrategy3PayloadForScanDate(strategy3SourceDate) : null;
  if (strategy3Task && strategy3Payload?.matches?.length) {
    for (let index = records.length - 1; index >= 0; index -= 1) {
      if (records[index]?.strategy === strategy3Task.strategy) records.splice(index, 1);
    }
    strategy3Payload.matches.forEach((row, index) => records.push(normalizeRecord(strategy3Task, strategy3Payload, row, index)));
    const report = reports.find((item) => item.key === "strategy3");
    if (report) {
      report.runId = cleanText(strategy3Payload.runId);
      report.count = cleanNumber(strategy3Payload.count);
      report.emittedRows = strategy3Payload.ok === true ? strategy3Payload.matches.length : 0;
      report.suppressedRows = cleanNumber(strategy3Payload.sourceCoverage?.suppressedSymbols || 0);
      report.rowSuppressionReason = report.suppressedRows ? (strategy3Payload.reason || "strategy3_1300_intraday_1m_partial") : "";
      report.rowSuppressionBlockers = report.suppressedRows ? ["strategy3_1300_intraday_1m_partial"] : [];
      report.ok = strategy3Payload.ok === true && !report.suppressedRows;
      report.publishAllowed = strategy3Payload.publishAllowed === true;
      report.evidenceStatus = strategy3Payload.evidenceStatus || strategy3Payload.qualityStatus || "";
      report.date = strategy3SourceDate;
      report.reason = strategy3Payload.reason;
    }
    rawRecords = records.filter((row) => row.record_date && row.ticker);
  }
  const strategy4Task = TASKS.find((task) => task.key === "strategy4");
  const strategy4Report = reports.find((item) => item.key === "strategy4");
  const strategy4NeedsFallback = strategy4Report && (!strategy4Report.ok || !strategy4Report.emittedRows);
  const strategy4Payload = strategy4NeedsFallback ? await fetchStrategy4LatestCompletePayload() : null;
  if (strategy4Task && strategy4Payload?.matches?.length) {
    for (let index = records.length - 1; index >= 0; index -= 1) {
      if (records[index]?.strategy === strategy4Task.strategy) records.splice(index, 1);
    }
    strategy4Payload.matches.forEach((row, index) => records.push(normalizeRecord(strategy4Task, strategy4Payload, row, index)));
    if (strategy4Report) {
      strategy4Report.statusCode = 200;
      strategy4Report.ok = true;
      strategy4Report.runId = cleanText(strategy4Payload.runId);
      strategy4Report.count = cleanNumber(strategy4Payload.count);
      strategy4Report.emittedRows = strategy4Payload.matches.length;
      strategy4Report.date = cleanText(strategy4Payload.usedDate || strategy4Payload.date);
      strategy4Report.reason = strategy4Payload.reason;
    }
    rawRecords = records.filter((row) => row.record_date && row.ticker);
  }
  const strategy5Task = TASKS.find((task) => task.key === "strategy5");
  const strategy5Report = reports.find((item) => item.key === "strategy5");
  const strategy5NeedsFallback = strategy5Report && (!strategy5Report.ok || !strategy5Report.emittedRows);
  const strategy5Payload = strategy5NeedsFallback ? await fetchStrategy5LatestCompletePayload() : null;
  if (strategy5Task && strategy5Payload?.matches?.length) {
    for (let index = records.length - 1; index >= 0; index -= 1) {
      if (records[index]?.strategy === strategy5Task.strategy) records.splice(index, 1);
    }
    strategy5Payload.matches.forEach((row, index) => records.push(normalizeRecord(strategy5Task, strategy5Payload, row, index)));
    if (strategy5Report) {
      strategy5Report.statusCode = 200;
      strategy5Report.ok = true;
      strategy5Report.runId = cleanText(strategy5Payload.runId);
      strategy5Report.count = cleanNumber(strategy5Payload.count);
      strategy5Report.emittedRows = strategy5Payload.matches.length;
      strategy5Report.date = cleanText(strategy5Payload.usedDate || strategy5Payload.date);
      strategy5Report.reason = strategy5Payload.reason;
    }
    rawRecords = records.filter((row) => row.record_date && row.ticker);
  }
  const scorecardRecords = rawRecords.filter(includeInScorecard);
  const finalBatchLatestDate = scorecardRecords.map((row) => row.record_date).filter(Boolean).sort().at(-1) || latestDate;
  latestDate = tradingDay.isTradingDay ? finalBatchLatestDate : (sourceLatestDate || finalBatchLatestDate);
  const filtered = await enrichWithQuoteHighs(scorecardRecords.map((row) => alignRecordDate(row, latestDate)));
  const activeFiltered = filtered.filter((row) => !isRetiredScorecardStrategy(`${row.strategy || ""} ${row.source || ""} ${row.endpoint || ""}`));
  const activeReports = reports.filter((report) => !isRetiredScorecardStrategy(`${report.key || ""} ${report.strategy || ""} ${report.endpoint || ""}`));
  const blockedReports = activeReports.filter((report) => report.ok !== true || Number(report.statusCode || 0) >= 400 || Number(report.suppressedRows || 0) > 0);
  const daily = summarize(activeFiltered);
  const payload = {
    ok: true,
    contract: "scorecard-resource-chain-v1",
    source: "terminal-complete-run-scorecard",
    cacheSource: "json-snapshot",
    exportSource: "terminal-complete-run-scorecard",
    qualityStatus: blockedReports.length ? "degraded" : "complete",
    unattendedStatus: blockedReports.length ? "NO" : "YES",
    displayMode: blockedReports.length ? "same-day-degraded-source-report" : "same-day-complete",
    issues: blockedReports.map((report) => String(report.key || report.strategy || "unknown") + ":rows_suppressed_or_source_blocked:" + String(report.rowSuppressionReason || report.reason || report.statusCode || "unknown")),
    updatedAt: new Date().toISOString(),
    latestDate,
    marketStatus: {
      isTradingDay: tradingDay.isTradingDay,
      taipeiDate: tradingDay.date,
      latestOpenDate: latestDate,
      batchDate: batchLatestDate,
      sourceLatestDate,
      reason: tradingDay.reason,
      source: tradingDay.source,
    },
    displayRules: {
      strategyRuleContract: RULE_CONTRACT,
      realtimeRadarWindow: "09:00-13:30",
      strategy2Window: "09:00-13:30",
      strategy3EntryTime: "13:00",
      strategy3HighPrice: "隔天高點",
      followupPositiveGrowthDays: 7,
      followupPositiveGrowthRule: "close_or_high_T+7 > entry_price",
    },
    days: 1,
    records: activeFiltered,
    summary: {
      latestDate,
      rows: activeFiltered.length,
      daily,
      byStrategy: daily.map((row) => ({
        strategy: row.strategy,
        rows: row.signals,
        wins: row.wins,
        losses: row.losses,
        flats: row.flats,
        winRate: row.win_rate_pct,
        pnl: row.total_pnl,
      })),
    },
    sourceReports: activeReports,
    scanAudit: buildScanAudit({ runtimeDir: RUNTIME_DIR }),
  };
  const ruleVerification = verifyScorecardStrategyRules(payload, { source: "terminal-complete-run-scorecard", requireContract: true });
  payload.ruleVerification = ruleVerification;
  if (!ruleVerification.ok) {
    payload.ok = false;
    payload.qualityStatus = "degraded";
    payload.unattendedStatus = "NO";
    payload.displayMode = "same-day-rule-verification-failed";
    payload.issues = [...(payload.issues || []), ...ruleVerification.issues];
  }
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  const writeDecision = scorecardCurrentWriteDecision(payload, OUT_FILE);
  if (!writeDecision.allow) {
    const receiptFile = writeBlockedCurrentReceipt(writeDecision, payload);
    console.log(JSON.stringify({
      ok: true,
      out: OUT_FILE,
      latestDate,
      rows: activeFiltered.length,
      dailyRows: daily.length,
      reports: activeReports,
      currentWriteAllowed: false,
      previousGoodPreserved: true,
      reason: writeDecision.reason,
      writeDecision,
      receiptFile,
    }, null, 2));
    return;
  }
  fs.writeFileSync(OUT_FILE, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    ok: true,
    out: OUT_FILE,
    latestDate,
    rows: activeFiltered.length,
    dailyRows: daily.length,
    reports: activeReports,
    currentWriteAllowed: true,
    writeDecision,
  }, null, 2));
  if (!activeFiltered.length) process.exit(2);
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error?.message || String(error) }, null, 2));
  process.exit(1);
});













