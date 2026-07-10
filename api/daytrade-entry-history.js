const { serverSupabaseKey, serverSupabaseUrl } = require("../lib/server-supabase-key");
const { buildMarketCalendarContract } = require("../lib/market-calendar-contract");

const TABLE_NAME = "public.fugle_daytrade_entry_history";
const REST_TABLE_NAME = "fugle_daytrade_entry_history";
const TAIPEI_TIME_ZONE = "Asia/Taipei";
const ENTRY_FIELDS = [
  "trade_date",
  "entry_time",
  "symbol",
  "name",
  "entry_price",
  "current_price",
  "strategy_label",
  "signal_type",
  "note",
  "source",
  "created_at",
];
const LEGACY_ENTRY_FIELDS = ENTRY_FIELDS.filter((field) => field !== "signal_type");

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

function normalizeEntryTime(value) {
  const raw = text(value);
  const clock = raw.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (clock) return `${clock[1].padStart(2, "0")}:${clock[2]}:${(clock[3] || "00").padStart(2, "0")}`;
  return "";
}

function entryTimeKey(value) {
  const normalized = normalizeEntryTime(value);
  const match = normalized.match(/^(\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return -1;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

function isEntryInWindow(value) {
  const key = entryTimeKey(value);
  return key >= entryTimeKey("09:00:00") && key <= entryTimeKey("13:30:00");
}

function isFormalEntry(row) {
  const sourceText = [row?.source, row?.strategy_label, row?.signal_type].map(text).join(" ").toLowerCase();
  const signalType = text(row?.signal_type || "formal").toLowerCase();
  return (signalType === "formal" || signalType === "")
    && !sourceText.includes("replay")
    && !sourceText.includes("observation");
}

function normalizeEntry(row) {
  return {
    trade_date: normalizeTradeDate(row.trade_date),
    entry_time: normalizeEntryTime(row.entry_time),
    symbol: text(row.symbol),
    name: text(row.name),
    entry_price: row.entry_price ?? null,
    current_price: row.current_price ?? null,
    strategy_label: text(row.strategy_label),
    signal_type: text(row.signal_type || "formal"),
    note: text(row.note),
    source: text(row.source),
    created_at: text(row.created_at),
  };
}

function normalizeRows(rows, today = todayTaipeiDate()) {
  const sourceRows = Array.isArray(rows) ? rows : [];
  const filtered = {
    nonToday: 0,
    outsideWindow: 0,
    replayObservation: 0,
    blankSymbol: 0,
  };
  const kept = [];
  for (const raw of sourceRows) {
    const row = normalizeEntry(raw || {});
    if (row.trade_date !== today) {
      filtered.nonToday += 1;
      continue;
    }
    if (!isEntryInWindow(row.entry_time)) {
      filtered.outsideWindow += 1;
      continue;
    }
    if (!isFormalEntry(row)) {
      filtered.replayObservation += 1;
      continue;
    }
    if (!row.symbol) {
      filtered.blankSymbol += 1;
      continue;
    }
    kept.push(row);
  }
  kept.sort((a, b) =>
    entryTimeKey(b.entry_time) - entryTimeKey(a.entry_time)
    || text(b.created_at).localeCompare(text(a.created_at))
    || text(a.symbol).localeCompare(text(b.symbol))
  );
  return { rows: kept, filtered };
}

async function fetchSupabaseEntries(today) {
  const url = serverSupabaseUrl();
  const key = serverSupabaseKey();
  if (!url || !key) {
    return { ok: false, status: 503, reason: "missing_supabase_credentials", rawRows: [] };
  }
  async function query(fields) {
  const params = new URLSearchParams();
  params.set("select", fields.join(","));
  params.set("trade_date", `eq.${today}`);
  params.append("entry_time", "gte.09:00:00");
  params.append("entry_time", "lte.13:30:00");
  params.set("order", "entry_time.desc,created_at.desc");
  params.set("limit", "200");
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
  let response = await query(ENTRY_FIELDS);
  const rawText = await response.text();
  let data = null;
  try {
    data = rawText ? JSON.parse(rawText) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    if (/signal_type/i.test(rawText)) {
      response = await query(LEGACY_ENTRY_FIELDS);
      const fallbackText = await response.text();
      try {
        data = fallbackText ? JSON.parse(fallbackText) : null;
      } catch {
        data = null;
      }
      if (response.ok) return { ok: true, status: response.status, reason: "legacy_without_signal_type", rawRows: Array.isArray(data) ? data : [] };
      return {
        ok: false,
        status: response.status,
        reason: "supabase_entry_history_query_failed",
        error: data?.message || fallbackText.slice(0, 240),
        rawRows: [],
      };
    }
    return {
      ok: false,
      status: response.status,
      reason: "supabase_entry_history_query_failed",
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
  params.append("entry_time", "gte.09:00:00");
  params.append("entry_time", "lte.13:30:00");
  params.set("order", "trade_date.desc,entry_time.desc,created_at.desc");
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

async function handler(request, response) {
  noStore(response);
  const requestedDate = todayTaipeiDate();
  let tradeDate = requestedDate;
  try {
    const marketCalendar = await buildMarketCalendarContract().catch(() => null);
    let fetched = await fetchSupabaseEntries(tradeDate);
    let marketClosedPreviousGood = false;
    if (marketCalendar?.marketOpen === false && fetched.ok && !fetched.rawRows.length) {
      const latestTradeDate = await fetchLatestAvailableTradeDate(requestedDate);
      if (latestTradeDate && latestTradeDate !== requestedDate) {
        tradeDate = latestTradeDate;
        fetched = await fetchSupabaseEntries(tradeDate);
        marketClosedPreviousGood = true;
      }
    }
    const normalized = normalizeRows(fetched.rawRows, tradeDate);
    response.status(fetched.ok ? 200 : fetched.status || 500).json({
      ok: fetched.ok,
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
      order: "entry_time.desc,created_at.desc",
      count: normalized.rows.length,
      rows: normalized.rows,
      filtered: normalized.filtered,
      reason: marketClosedPreviousGood ? "market_closed_previous_good" : (fetched.reason || ""),
      error: fetched.error || "",
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    response.status(500).json({
      ok: false,
      source: `supabase:${TABLE_NAME}`,
      table: TABLE_NAME,
      requestedDate,
      tradeDate,
      timeWindow: { from: "09:00:00", to: "13:30:00", timezone: TAIPEI_TIME_ZONE },
      count: 0,
      rows: [],
      filtered: { nonToday: 0, outsideWindow: 0, replayObservation: 0, blankSymbol: 0 },
      reason: "daytrade_entry_history_unhandled_error",
      error: error?.message || String(error),
      updatedAt: new Date().toISOString(),
    });
  }
}

module.exports = handler;
module.exports.__test = {
  ENTRY_FIELDS,
  TABLE_NAME,
  todayTaipeiDate,
  normalizeTradeDate,
  normalizeEntryTime,
  isEntryInWindow,
  isFormalEntry,
  normalizeRows,
};
