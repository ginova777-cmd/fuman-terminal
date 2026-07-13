"use strict";

const fs = require("fs");
const path = require("path");
const { serverSupabaseKey, serverSupabaseUrl } = require("../lib/server-supabase-key");
const { isTwseTradingDay } = require("./twse-trading-day");
const { RULE_CONTRACT, applyScorecardRuleMetadata } = require("../lib/scorecard-rule-locks");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const OUT_FILE = process.argv.find((arg) => arg.startsWith("--out="))?.slice("--out=".length)
  || path.join(RUNTIME_DIR, "data", "scorecard-terminal-current.json");
const DEFAULT_OUT_FILE = path.join(RUNTIME_DIR, "data", "scorecard-terminal-current.json");
const BLOCKED_RECEIPT_DIR = path.join(RUNTIME_DIR, "data", "scan-receipts");
const MIN_CURRENT_RETAIN_RATIO = Number(process.env.FUMAN_SCORECARD_MIN_CURRENT_RETAIN_RATIO || 0.75);

const TASKS = [
  {
    key: "strategy1",
    strategy: "策略1開盤入成績單",
    endpoint: "/api/open-buy-latest",
    modulePath: "../api/open-buy-latest",
    arrayKeys: ["matches", "rows", "buyMatches"],
    limit: 120,
  },
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
  {
    key: "cb",
    strategy: "CB成績單",
    endpoint: "/api/cb-detect-latest",
    modulePath: "../api/cb-detect-latest",
    arrayKeys: ["rows", "matches"],
    limit: 120,
  },
  {
    key: "warrant",
    strategy: "權證成績單",
    endpoint: "/api/warrant-flow-latest",
    modulePath: "../api/warrant-flow-latest",
    arrayKeys: ["rows", "matches", "volumeMatches", "singleSignals"],
    limit: 120,
  },
  {
    key: "realtime-radar",
    strategy: "即時雷達成績單",
    endpoint: "/api/realtime-radar-latest",
    modulePath: "../api/realtime-radar-latest",
    arrayKeys: ["rows", "cards", "leaders"],
    limit: 120,
  },
];

function cleanText(value) {
  return String(value ?? "").trim();
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

function scorecardRecordDate(task, payload, row) {
  const explicit = isoDate(row.record_date || row.scorecardDate || payload.scorecardDate || payload.recordDate || "", "");
  if (explicit) return explicit;

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
  if (sourceDate) return sourceDate;

  const runDate = latestRunIdDate(row.runId || row.run_id || payload.runId || payload.transport?.runId || payload.transport?.snapshotId);
  if (runDate) return runDate;

  const updatedDate = taipeiDateFromTimestamp(row.updatedAt || row.updated_at || payload.updatedAt || payload.generatedAt || payload.timestamp);
  if (updatedDate) return updatedDate;

  return taipeiDate();
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
    const key = `${row._scorecardArrayKey || "rows"}:${code}:${cleanText(row.name || row.cbName || row.warrantName)}:${index}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
  if (task.key === "strategy1") return "21:30";
  if (task.key === "strategy3") return "13:00";
  if (task.key === "strategy4") return "13:30";
  if (task.key === "strategy5") return "14:00";
  if (task.key === "institution") return "14:00";
  if (task.key === "warrant") return "14:00";
  if (task.key === "cb") return taipeiTime(payload.updatedAt || payload.generatedAt || payload.finishedAt || payload.timestamp) || "14:00";
  return taipeiTime(payload.updatedAt || payload.generatedAt || payload.finishedAt || payload.timestamp);
}

function entryTimeOf(task, payload, row) {
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
  if (["strategy1", "strategy3", "strategy5", "institution", "warrant"].includes(task.key)) {
    return fallbackEntryTime(task, payload);
  }
  const latest = row?.latestRecord && typeof row.latestRecord === "object" ? row.latestRecord : {};
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
  return {
    ok: true,
    source: "supabase:strategy3_scan_results",
    runId: cleanText(run.run_id),
    usedDate: scanDate,
    date: scanDate,
    updatedAt: cleanText(run.finished_at || run.updated_at),
    count: Math.max(rows.length, cleanNumber(run.result_count)),
    matches: rows,
    rows,
    reason: `scorecard_source_previous_trading_day:${scanDate}`,
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

function normalizeRecord(task, payload, row, index) {
  const recordDate = scorecardRecordDate(task, payload, row);
  const code = codeOf(row, `${task.key}-${index + 1}`);
  const entryPrice = priceOf(row);
  const highPrice = highOf(row, entryPrice);
  const sourceDate = normalizeDate(row._strategy3ScorecardSourceDate || row._strategy5ScorecardSourceDate || row.source_date || row.scan_date || payload.sourceDate || payload.usedDate || "");
  const source = "terminal-complete-run-scorecard";
  const reason = reasonOf(row, task);
  return applyScorecardRuleMetadata({
    taskKey: task.key,
    sourceRow: row,
    payload,
    record: {
    record_id: `${recordDate}-${task.key}-${code}-${index + 1}`,
    record_date: recordDate,
    source_date: sourceDate || recordDate,
    strategy: task.strategy,
    ticker: code,
    name: nameOf(row, code),
    entry_time: entryTimeOf(task, payload, row),
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

function strategySetOf(records) {
  return new Set(records.map((row) => cleanText(row.strategy)).filter(Boolean));
}

function scorecardCurrentWriteDecision(nextPayload, outFile) {
  if (path.resolve(outFile) !== path.resolve(DEFAULT_OUT_FILE)) {
    return { allow: true, reason: "non_default_out_file" };
  }
  if (process.env.FUMAN_SCORECARD_ALLOW_CURRENT_SHRINK === "1") {
    return { allow: true, reason: "explicit_allow_current_shrink" };
  }
  const previous = readJsonSafe(outFile);
  const previousRecords = recordsOf(previous);
  const nextRecords = recordsOf(nextPayload);
  if (!previousRecords.length || !nextRecords.length) {
    return { allow: Boolean(nextRecords.length), reason: nextRecords.length ? "no_previous_good" : "next_empty" };
  }
  const previousStrategies = strategySetOf(previousRecords);
  const nextStrategies = strategySetOf(nextRecords);
  const retainRatio = previousRecords.length ? nextRecords.length / previousRecords.length : 1;
  const missingStrategies = [...previousStrategies].filter((strategy) => !nextStrategies.has(strategy));
  const suspiciousShrink = nextRecords.length < previousRecords.length && (
    retainRatio < MIN_CURRENT_RETAIN_RATIO ||
    missingStrategies.length > 0 ||
    nextStrategies.size < previousStrategies.size
  );
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
  for (const task of TASKS) {
    const result = await callApi(task);
    const payload = result.payload || {};
    const rows = arraysFromTaskPayload(task, payload);
    rows.forEach((row, index) => records.push(normalizeRecord(task, payload, row, index)));
    reports.push({
      key: task.key,
      strategy: task.strategy,
      statusCode: result.statusCode,
      ok: payload.ok !== false && Number(result.statusCode || 0) < 400,
      runId: cleanText(payload.runId || payload.transport?.runId),
      count: cleanNumber(payload.count ?? payload.total ?? rows.length),
      emittedRows: rows.length,
      date: cleanText(payload.usedDate || payload.tradeDate || payload.sourceDate || payload.date),
      reason: cleanText(payload.reason || payload.detail || payload.error),
    });
  }
  let rawRecords = records.filter((row) => row.record_date && row.ticker);
  const tradingDay = await isTwseTradingDay(new Date(), { stateDir: path.join(RUNTIME_DIR, "state") });
  const sourceLatestDate = reports.filter((report) => cleanNumber(report.emittedRows ?? report.count) > 0).map(dateFromReport).filter(Boolean).sort().at(-1) || "";
  const batchLatestDate = rawRecords.map((row) => row.record_date).sort().at(-1) || taipeiDate();
  let latestDate = tradingDay.isTradingDay ? batchLatestDate : (sourceLatestDate || batchLatestDate);
  const strategy3SourceDate = await previousTwseTradingDate(latestDate);
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
      report.emittedRows = strategy3Payload.matches.length;
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
  const daily = summarize(filtered);
  const payload = {
    ok: true,
    source: "terminal-complete-run-scorecard",
    cacheSource: "json-snapshot",
    exportSource: "terminal-complete-run-scorecard",
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
      strategy1EntryTime: "21:30",
      strategy1Settlement: "前一日21:30顯示，當日收盤後結算",
      strategy2Window: "09:00-13:30",
      strategy3EntryTime: "13:00",
      strategy3HighPrice: "隔天高點",
      followupPositiveGrowthDays: 7,
      followupPositiveGrowthRule: "close_or_high_T+7 > entry_price",
    },
    days: 1,
    records: filtered,
    summary: {
      latestDate,
      rows: filtered.length,
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
    sourceReports: reports,
  };
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  const writeDecision = scorecardCurrentWriteDecision(payload, OUT_FILE);
  if (!writeDecision.allow) {
    const receiptFile = writeBlockedCurrentReceipt(writeDecision, payload);
    console.log(JSON.stringify({
      ok: true,
      out: OUT_FILE,
      latestDate,
      rows: filtered.length,
      dailyRows: daily.length,
      reports,
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
    rows: filtered.length,
    dailyRows: daily.length,
    reports,
    currentWriteAllowed: true,
    writeDecision,
  }, null, 2));
  if (!filtered.length) process.exit(2);
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error?.message || String(error) }, null, 2));
  process.exit(1);
});
