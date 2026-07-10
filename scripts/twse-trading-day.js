const fs = require("fs");
const path = require("path");

const HOLIDAY_API_URL = process.env.TWSE_HOLIDAY_API_URL || "https://openapi.twse.com.tw/v1/holidaySchedule/holidaySchedule";
const CACHE_MAX_AGE_MS = Math.max(60 * 60 * 1000, Number(process.env.TWSE_HOLIDAY_CACHE_MAX_AGE_MS || 7 * 24 * 60 * 60 * 1000));

function taipeiDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function dateKey(parts = taipeiDateParts()) {
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function rocDateKey(parts = taipeiDateParts()) {
  return `${Number(parts.year) - 1911}${parts.month}${parts.day}`;
}

function isWeekend(parts = taipeiDateParts()) {
  const weekday = String(parts.weekday || "").toLowerCase();
  return weekday.startsWith("sat") || weekday.startsWith("sun");
}

function stripHtml(value) {
  return String(value || "").replace(/<[^>]*>/g, " ");
}

function rowText(row) {
  return `${row?.Name || ""} ${stripHtml(row?.Description || "")}`;
}

function isExplicitTradingRow(row) {
  const text = rowText(row);
  return /開始交易|最後交易|補行交易|恢復交易/.test(text) && !/市場無交易|停止交易|休市/.test(text);
}

function isClosedRow(row) {
  const text = rowText(row);
  if (isExplicitTradingRow(row)) return false;
  return /市場無交易|停止交易|休市|放假|暫停交易/.test(text);
}

function cacheFileForYear(stateDir, year) {
  return path.join(stateDir, `twse-holiday-schedule-${year}.json`);
}

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function overrideFiles(stateDir) {
  return [
    process.env.FUMAN_MARKET_CALENDAR_OVERRIDE_FILE,
    path.join(process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime", "data", "market-calendar-overrides.json"),
    path.resolve(__dirname, "..", "data", "market-calendar-overrides.json"),
    path.join(stateDir, "market-calendar-overrides.json"),
  ].filter(Boolean);
}

function normalizeOverride(row, key) {
  if (!row || typeof row !== "object") return null;
  const marketOpen = row.marketOpen === true || row.isTradingDay === true
    ? true
    : row.marketOpen === false || row.isTradingDay === false
      ? false
      : null;
  if (marketOpen === null) return null;
  const reason = String(row.closedReason || row.reason || (marketOpen ? "manual_trading_day" : "manual_market_closed")).trim();
  return {
    isTradingDay: marketOpen,
    date: key,
    rocDate: String(row.rocDate || "").trim(),
    reason,
    source: String(row.source || "manual_override").trim(),
    row: {
      ...row,
      Date: row.Date || key.replace(/\D/g, ""),
      Name: row.Name || row.name || reason,
      Description: row.Description || row.description || reason,
    },
    override: true,
    lockedBy: String(row.lockedBy || row.owner || "").trim(),
  };
}

function readTradingDayOverride(stateDir, key) {
  for (const file of overrideFiles(stateDir)) {
    const payload = readJson(file);
    if (!payload) continue;
    const rows = Array.isArray(payload) ? payload : (Array.isArray(payload.days) ? payload.days : payload.overrides);
    if (Array.isArray(rows)) {
      const row = rows.find((item) => String(item?.date || item?.tradeDate || item?.marketDate || "").slice(0, 10) === key);
      const normalized = normalizeOverride(row, key);
      if (normalized) return { ...normalized, overrideFile: file };
    } else if (payload[key]) {
      const normalized = normalizeOverride(payload[key], key);
      if (normalized) return { ...normalized, overrideFile: file };
    }
  }
  return null;
}

async function fetchHolidayRows(stateDir, year) {
  const cacheFile = cacheFileForYear(stateDir, year);
  const cached = readJson(cacheFile);
  const cachedAt = cached?.cachedAt ? Date.parse(cached.cachedAt) : 0;
  if (Array.isArray(cached?.rows) && cached.rows.length && cachedAt && Date.now() - cachedAt < CACHE_MAX_AGE_MS) {
    return { rows: cached.rows, source: "cache" };
  }

  try {
    const response = await fetch(HOLIDAY_API_URL, {
      headers: { "User-Agent": "FumanRealtimeRadarTradingDay/1.0" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const rows = await response.json();
    if (!Array.isArray(rows)) throw new Error("unexpected TWSE holiday response");
    writeJson(cacheFile, { cachedAt: new Date().toISOString(), rows });
    return { rows, source: "twse" };
  } catch (error) {
    if (Array.isArray(cached?.rows) && cached.rows.length) {
      return { rows: cached.rows, source: "stale_cache", error: error.message };
    }
    return { rows: [], source: "weekend_fallback", error: error.message };
  }
}

async function isTwseTradingDay(date = new Date(), options = {}) {
  const stateDir = options.stateDir || process.env.FUMAN_STATE_DIR || path.resolve(__dirname, "..", "state");
  const parts = taipeiDateParts(date);
  const key = dateKey(parts);
  const override = readTradingDayOverride(stateDir, key);
  if (override && options.ignoreOverrides !== true) return override;
  const rocKey = rocDateKey(parts);
  const weekend = isWeekend(parts);
  const { rows, source, error } = await fetchHolidayRows(stateDir, parts.year);
  const row = rows.find((item) => String(item?.Date || "") === rocKey);

  if (row && isExplicitTradingRow(row)) {
    return { isTradingDay: true, date: key, rocDate: rocKey, reason: "special_trading_day", source, row };
  }
  if (row && isClosedRow(row)) {
    return { isTradingDay: false, date: key, rocDate: rocKey, reason: "twse_closed_day", source, row };
  }
  if (weekend) {
    return { isTradingDay: false, date: key, rocDate: rocKey, reason: "weekend", source, row: row || null };
  }
  return { isTradingDay: true, date: key, rocDate: rocKey, reason: error ? "weekday_fallback" : "regular_weekday", source, row: row || null, error };
}

module.exports = {
  isTwseTradingDay,
  taipeiDateParts,
  dateKey,
};
