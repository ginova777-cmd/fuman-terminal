"use strict";

const RETENTION_CONTRACT = "scorecard-calendar-month-trading-days-v1";
const cleanText = (value) => String(value ?? "").trim();
function isoDate(value) {
  const match = cleanText(value).match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (!match) return "";
  const date = `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date ? "" : date;
}
function calendarMonthBounds(anchorDate) {
  const anchor = isoDate(anchorDate);
  if (!anchor) return { month: "", startDate: "", endDate: "" };
  const year = Number(anchor.slice(0, 4));
  const monthNumber = Number(anchor.slice(5, 7));
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const month = anchor.slice(0, 7);
  return { month, startDate: `${month}-01`, endDate: `${month}-${String(lastDay).padStart(2, "0")}` };
}
function isWeekday(dateValue) {
  const date = isoDate(dateValue);
  if (!date) return false;
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day >= 1 && day <= 5;
}
function isInCalendarMonth(dateValue, anchorDate) {
  const date = isoDate(dateValue);
  const bounds = calendarMonthBounds(anchorDate);
  return Boolean(date && bounds.startDate && date >= bounds.startDate && date <= bounds.endDate);
}
function retainCalendarMonthRecords(records, anchorDate, options = {}) {
  const weekdaysOnly = options.weekdaysOnly !== false;
  return (Array.isArray(records) ? records : []).filter((row) => {
    const date = isoDate(row?.record_date);
    return isInCalendarMonth(date, anchorDate) && (!weekdaysOnly || isWeekday(date));
  });
}
function scorecardRecordKey(row) {
  const entryTime = cleanText(row?.entry_time);
  return `${isoDate(row?.record_date)}|${cleanText(row?.strategy)}|${cleanText(row?.ticker)}|${entryTime || cleanText(row?.record_id)}`;
}
function sortRecords(records) {
  return [...records].sort((left, right) => {
    const dateCompare = isoDate(right?.record_date).localeCompare(isoDate(left?.record_date));
    if (dateCompare) return dateCompare;
    const strategyCompare = cleanText(left?.strategy).localeCompare(cleanText(right?.strategy), "zh-Hant");
    if (strategyCompare) return strategyCompare;
    const timeCompare = cleanText(left?.entry_time).localeCompare(cleanText(right?.entry_time));
    if (timeCompare) return timeCompare;
    return cleanText(left?.ticker).localeCompare(cleanText(right?.ticker));
  });
}
function scorecardHistoryDates(records) {
  return [...new Set((Array.isArray(records) ? records : []).map((row) => isoDate(row?.record_date)).filter(Boolean))].sort().reverse();
}
function mergeCalendarMonthRecords({ previousRecords = [], freshRecords = [], anchorDate, replaceDate = anchorDate, replaceStrategies = [] } = {}) {
  const normalizedReplaceDate = isoDate(replaceDate);
  const replaceSet = new Set((Array.isArray(replaceStrategies) ? replaceStrategies : []).map(cleanText).filter(Boolean));
  const previous = retainCalendarMonthRecords(previousRecords, anchorDate).filter((row) => {
    if (!normalizedReplaceDate || isoDate(row?.record_date) !== normalizedReplaceDate) return true;
    return !replaceSet.has(cleanText(row?.strategy));
  });
  const fresh = retainCalendarMonthRecords(freshRecords, anchorDate);
  const rowsByKey = new Map();
  for (const row of [...previous, ...fresh]) rowsByKey.set(scorecardRecordKey(row), row);
  return sortRecords([...rowsByKey.values()]);
}
function buildCalendarMonthRetention(anchorDate, records = []) {
  const bounds = calendarMonthBounds(anchorDate);
  const historyDates = scorecardHistoryDates(retainCalendarMonthRecords(records, anchorDate));
  return {
    contract: RETENTION_CONTRACT,
    mode: "calendar-month-trading-days",
    month: bounds.month,
    startDate: bounds.startDate,
    endDate: bounds.endDate,
    tradingDaysOnly: true,
    nonTradingDayPlaceholders: false,
    crossMonthRecordsAllowed: false,
    retainedTradingDates: historyDates,
    retainedTradingDayCount: historyDates.length,
  };
}

module.exports = { RETENTION_CONTRACT, isoDate, calendarMonthBounds, isWeekday, isInCalendarMonth, retainCalendarMonthRecords, scorecardRecordKey, scorecardHistoryDates, mergeCalendarMonthRecords, buildCalendarMonthRetention };
