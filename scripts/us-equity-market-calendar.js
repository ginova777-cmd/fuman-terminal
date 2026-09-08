"use strict";

const FULL_DAY_HOLIDAYS_2026 = new Map([
  ["2026-01-01", "New Year's Day"],
  ["2026-01-19", "Martin Luther King, Jr. Day"],
  ["2026-02-16", "Washington's Birthday"],
  ["2026-04-03", "Good Friday"],
  ["2026-05-25", "Memorial Day"],
  ["2026-06-19", "Juneteenth National Independence Day"],
  ["2026-07-03", "Independence Day observed"],
  ["2026-09-07", "Labor Day"],
  ["2026-11-26", "Thanksgiving Day"],
  ["2026-12-25", "Christmas Day"],
]);

const EARLY_CLOSES_2026 = new Set(["2026-11-27", "2026-12-24"]);

function dateKeyInZone(date, timeZone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function weekdayInNewYork(dateKey) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "long",
  }).format(new Date(`${dateKey}T12:00:00-05:00`));
}

function closedReason(dateKey) {
  const holiday = FULL_DAY_HOLIDAYS_2026.get(dateKey);
  if (holiday) return holiday;
  const weekday = weekdayInNewYork(dateKey);
  return weekday === "Saturday" || weekday === "Sunday" ? weekday : null;
}

function previousOfficialSessionDate(dateKey) {
  let cursor = new Date(`${dateKey}T12:00:00Z`);
  for (let attempt = 0; attempt < 14; attempt += 1) {
    cursor = new Date(cursor.getTime() - 86400000);
    const candidate = cursor.toISOString().slice(0, 10);
    if (!closedReason(candidate)) return candidate;
  }
  return null;
}

function buildUsEquityMarketCalendar(tradeDate, options = {}) {
  const cutoff = options.cutoff || new Date(`${tradeDate}T08:20:00+08:00`);
  const cutoffNewYorkDate = dateKeyInZone(cutoff, "America/New_York");
  const reason = closedReason(cutoffNewYorkDate);
  const earlyClose = !reason && EARLY_CLOSES_2026.has(cutoffNewYorkDate);
  return {
    us_market_status: reason ? "market_closed" : (earlyClose ? "early_close" : "regular"),
    us_session_date: reason ? null : cutoffNewYorkDate,
    us_holiday_name: FULL_DAY_HOLIDAYS_2026.get(cutoffNewYorkDate) || null,
    us_closed_reason: reason,
    us_early_close: earlyClose,
    us_regular_close_at: earlyClose ? `${cutoffNewYorkDate}T13:00:00-05:00` : null,
    no_new_us_session: Boolean(reason),
    previous_official_session_date: previousOfficialSessionDate(cutoffNewYorkDate),
    calendar_authority: "NYSE_NASDAQ_2026",
    calendar_timezone: "America/New_York",
    cutoff_new_york_date: cutoffNewYorkDate,
  };
}

module.exports = {
  FULL_DAY_HOLIDAYS_2026,
  EARLY_CLOSES_2026,
  buildUsEquityMarketCalendar,
  closedReason,
  previousOfficialSessionDate,
};
