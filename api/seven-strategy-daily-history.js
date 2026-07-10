const { serverSupabaseKey, serverSupabaseUrl } = require("../lib/server-supabase-key");
const { buildMarketCalendarContract } = require("../lib/market-calendar-contract");

const SOURCE_NAME = "seven_strategy_daily_history";
const TABLE_NAME = "public.seven_strategy_daily_history";
const REST_TABLE_NAME = "seven_strategy_daily_history";
const TAIPEI_TIME_ZONE = "Asia/Taipei";
const REQUIRED_FIELDS = ["tradeDate", "detectTime", "symbol", "name", "entryPrice", "strategy"];
const SELECT_FIELDS = [
  "trade_date",
  "detect_time",
  "entry_time",
  "symbol",
  "name",
  "entry_price",
  "current_price",
  "change_percent",
  "score",
  "strategy",
  "strategy_label",
  "signal_type",
  "source",
  "updated_at",
];
const LEGACY_SELECT_FIELDS = SELECT_FIELDS.filter((field) => field !== "entry_time" && field !== "strategy_label");

function text(value) {
  return String(value ?? "").trim();
}

function todayTaipeiDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TAIPEI_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function normalizeTradeDate(value) {
  const raw = text(value);
  const match = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (match) return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  const digits = raw.replace(/\D/g, "");
  if (/^\d{8}$/.test(digits)) return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  return "";
}

function normalizeDetectTime(value) {
  const raw = text(value);
  const clock = raw.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (clock) return `${clock[1].padStart(2, "0")}:${clock[2]}:${(clock[3] || "00").padStart(2, "0")}`;
  return "";
}

function secondsFromTime(value) {
  const match = normalizeDetectTime(value).match(/^(\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return -1;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

function inRegularWindow(value) {
  const key = secondsFromTime(value);
  return key >= secondsFromTime("09:00:00") && key <= secondsFromTime("13:30:00");
}

function numberOrNull(value) {
  if (value === null || value === undefined || text(value) === "") return null;
  const number = Number(String(value).replace(/[,% ]/g, ""));
  return Number.isFinite(number) ? number : null;
}

function normalizeSignalType(value, source = "") {
  const raw = text(value).toLowerCase();
  const sourceText = text(source).toLowerCase();
  if (raw === "formal" || raw === "entry") return "formal";
  if (raw === "detected" || raw === "observation" || raw === "observe") return "detected";
  if (sourceText.includes("entry")) return "formal";
  return "detected";
}

function normalizeRow(row) {
  const detectTime = normalizeDetectTime(row.detect_time ?? row.detectTime ?? row.entry_time ?? row.entryTime);
  const strategy = text(row.strategy ?? row.strategy_label ?? row.strategyLabel);
  return {
    tradeDate: normalizeTradeDate(row.trade_date ?? row.tradeDate),
    detectTime,
    entryTime: detectTime,
    symbol: text(row.symbol),
    name: text(row.name),
    entryPrice: numberOrNull(row.entry_price ?? row.entryPrice),
    currentPrice: numberOrNull(row.current_price ?? row.currentPrice),
    changePercent: numberOrNull(row.change_percent ?? row.changePercent),
    score: numberOrNull(row.score),
    strategy,
    strategyLabel: strategy,
    signalType: normalizeSignalType(row.signal_type ?? row.signalType, row.source),
    source: text(row.source || SOURCE_NAME),
    updatedAt: text(row.updated_at ?? row.updatedAt),
  };
}

function rowHasReplay(row) {
  return [row.source, row.strategy, row.signalType].some((value) => text(value).toLowerCase().includes("replay"));
}

function blankRequiredFields(row) {
  return REQUIRED_FIELDS.filter((field) => {
    const value = row[field];
    if (value === null || value === undefined) return true;
    if (typeof value === "number") return !Number.isFinite(value);
    return text(value) === "";
  });
}

function normalizeRows(rows, today = todayTaipeiDate(), limit = 100) {
  const sourceRows = Array.isArray(rows) ? rows : [];
  const filtered = {
    nonToday: 0,
    outsideWindow: 0,
    replay: 0,
    blankRequired: 0,
    invalidSignalType: 0,
  };
  const kept = [];
  for (const raw of sourceRows) {
    const row = normalizeRow(raw || {});
    if (row.tradeDate !== today) {
      filtered.nonToday += 1;
      continue;
    }
    if (!inRegularWindow(row.detectTime)) {
      filtered.outsideWindow += 1;
      continue;
    }
    if (rowHasReplay(row)) {
      filtered.replay += 1;
      continue;
    }
    if (row.signalType !== "formal" && row.signalType !== "detected") {
      filtered.invalidSignalType += 1;
      continue;
    }
    if (blankRequiredFields(row).length) {
      filtered.blankRequired += 1;
      continue;
    }
    kept.push(row);
  }
  kept.sort((a, b) =>
    secondsFromTime(b.detectTime) - secondsFromTime(a.detectTime)
    || text(b.updatedAt).localeCompare(text(a.updatedAt))
    || text(a.symbol).localeCompare(text(b.symbol))
  );
  return { rows: kept.slice(0, limit), totalKept: kept.length, filtered };
}

function summarizeRows(rows) {
  const formalCount = rows.filter((row) => row.signalType === "formal").length;
  const detectedCount = rows.filter((row) => row.signalType === "detected").length;
  const strategyDistribution = {};
  for (const row of rows) {
    const key = row.strategy || "unknown";
    strategyDistribution[key] = (strategyDistribution[key] || 0) + 1;
  }
  return {
    total: rows.length,
    formalCount,
    detectedCount,
    strategyDistribution,
  };
}

async function fetchSupabaseRows(tradeDate, limit) {
  const url = serverSupabaseUrl();
  const key = serverSupabaseKey();
  if (!url || !key) {
    return { ok: false, status: 503, reason: "missing_supabase_credentials", rawRows: [] };
  }
  async function query(fields, legacy = false) {
  const params = new URLSearchParams();
  params.set("select", fields.join(","));
  params.set("trade_date", `eq.${tradeDate}`);
  if (legacy) {
    params.append("detect_time", "gte.09:00:00");
    params.append("detect_time", "lte.13:30:00");
    params.set("order", "detect_time.desc,updated_at.desc");
  } else {
    params.set("order", "updated_at.desc");
  }
  params.set("limit", String(Math.max(500, Math.min(Math.max(Number(limit) || 100, 1), 500))));
  const endpoint = `${url.replace(/\/+$/, "")}/rest/v1/${REST_TABLE_NAME}?${params.toString()}`;
  const response = await fetch(endpoint, {
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      accept: "application/json",
      "cache-control": "no-store",
    },
  });
    return response;
  }
  let response = await query(SELECT_FIELDS);
  const rawText = await response.text();
  let data = null;
  try {
    data = rawText ? JSON.parse(rawText) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    if (/entry_time|strategy_label/i.test(rawText)) {
      response = await query(LEGACY_SELECT_FIELDS, true);
      const fallbackText = await response.text();
      try {
        data = fallbackText ? JSON.parse(fallbackText) : null;
      } catch {
        data = null;
      }
      if (response.ok) return { ok: true, status: response.status, reason: "legacy_without_entry_time_strategy_label", rawRows: Array.isArray(data) ? data : [] };
      return {
        ok: false,
        status: response.status,
        reason: "seven_strategy_daily_history_query_failed",
        error: data?.message || fallbackText.slice(0, 240),
        rawRows: [],
      };
    }
    return {
      ok: false,
      status: response.status,
      reason: "seven_strategy_daily_history_query_failed",
      error: data?.message || rawText.slice(0, 240),
      rawRows: [],
    };
  }
  return { ok: true, status: response.status, reason: "", rawRows: Array.isArray(data) ? data : [] };
}

async function fetchLatestAvailableTradeDate(maxDate) {
  const url = serverSupabaseUrl();
  const key = serverSupabaseKey();
  if (!url || !key) return "";
  const params = new URLSearchParams();
  params.set("select", "trade_date");
  params.append("trade_date", `lte.${maxDate}`);
  params.set("order", "trade_date.desc,updated_at.desc");
  params.set("limit", "1");
  const endpoint = `${url.replace(/\/+$/, "")}/rest/v1/${REST_TABLE_NAME}?${params.toString()}`;
  const result = await fetch(endpoint, {
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      accept: "application/json",
      "cache-control": "no-store",
    },
  });
  if (!result.ok) return "";
  const rows = await result.json().catch(() => []);
  return normalizeTradeDate(Array.isArray(rows) ? rows[0]?.trade_date : "");
}

function noStore(response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  response.setHeader("Pragma", "no-cache");
}

async function buildPayload(options = {}) {
  const requestedDate = normalizeTradeDate(options.tradeDate) || todayTaipeiDate();
  let tradeDate = requestedDate;
  const limit = Math.min(Math.max(Number(options.limit) || 100, 1), 200);
  const marketCalendar = options.rawRows ? null : await buildMarketCalendarContract().catch(() => null);
  let fetched = options.rawRows
    ? { ok: true, status: 200, reason: "", rawRows: options.rawRows }
    : await fetchSupabaseRows(tradeDate, limit);
  let marketClosedPreviousGood = false;
  if (!options.rawRows && marketCalendar?.marketOpen === false && fetched.ok && !fetched.rawRows.length) {
    const latestTradeDate = await fetchLatestAvailableTradeDate(requestedDate);
    if (latestTradeDate && latestTradeDate !== requestedDate) {
      tradeDate = latestTradeDate;
      fetched = await fetchSupabaseRows(tradeDate, limit);
      marketClosedPreviousGood = true;
    }
  }
  const normalized = normalizeRows(fetched.rawRows, tradeDate, limit);
  const summary = summarizeRows(normalized.rows);
  return {
    ok: fetched.ok,
    sourceName: SOURCE_NAME,
    source: `supabase:${TABLE_NAME}`,
    table: TABLE_NAME,
    requestedDate,
    tradeDate,
    displayTradeDate: marketClosedPreviousGood ? tradeDate : undefined,
    marketOpen: marketCalendar?.marketOpen,
    marketStatus: marketCalendar?.marketStatus,
    closedReason: marketCalendar?.closedReason,
    formalScanSkipped: marketCalendar?.formalScanSkipped,
    preservePreviousGood: marketClosedPreviousGood || marketCalendar?.preservePreviousGood,
    marketClosedPreviousGood,
    timeWindow: { from: "09:00:00", to: "13:30:00", timezone: TAIPEI_TIME_ZONE },
    order: "coalesce(detect_time,entry_time).desc,updated_at.desc",
    limit,
    count: normalized.rows.length,
    totalKept: normalized.totalKept,
    formalCount: summary.formalCount,
    detectedCount: summary.detectedCount,
    strategyDistribution: summary.strategyDistribution,
    rows: normalized.rows,
    filtered: normalized.filtered,
    reason: marketClosedPreviousGood ? "market_closed_previous_good" : (fetched.reason || ""),
    error: fetched.error || "",
    updatedAt: new Date().toISOString(),
  };
}

async function handler(request, response) {
  noStore(response);
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.status(405).json({ ok: false, error: "method_not_allowed" });
    return;
  }
  try {
    const payload = await buildPayload({
      tradeDate: request.query?.date || request.query?.tradeDate || request.query?.trade_date,
      limit: request.query?.limit,
    });
    if (request.method === "HEAD") response.status(payload.ok ? 200 : payload.status || 500).end("");
    else response.status(payload.ok ? 200 : payload.status || 500).json(payload);
  } catch (error) {
    response.status(500).json({
      ok: false,
      sourceName: SOURCE_NAME,
      source: `supabase:${TABLE_NAME}`,
      table: TABLE_NAME,
      tradeDate: todayTaipeiDate(),
      timeWindow: { from: "09:00:00", to: "13:30:00", timezone: TAIPEI_TIME_ZONE },
      count: 0,
      rows: [],
      filtered: { nonToday: 0, outsideWindow: 0, replay: 0, blankRequired: 0, invalidSignalType: 0 },
      reason: "seven_strategy_daily_history_unhandled_error",
      error: error?.message || String(error),
      updatedAt: new Date().toISOString(),
    });
  }
}

module.exports = handler;
module.exports.__test = {
  SOURCE_NAME,
  TABLE_NAME,
  REQUIRED_FIELDS,
  SELECT_FIELDS,
  todayTaipeiDate,
  normalizeTradeDate,
  normalizeDetectTime,
  inRegularWindow,
  normalizeSignalType,
  normalizeRows,
  summarizeRows,
  buildPayload,
};
