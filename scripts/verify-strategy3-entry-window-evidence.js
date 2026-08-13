"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { terminalSupabaseKey, terminalSupabaseUrl } = require("../lib/server-supabase-key");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const SUPABASE_URL = terminalSupabaseUrl({ root: ROOT, runtimeDir: RUNTIME_DIR }).replace(/\/+$/, "");
const SUPABASE_KEY = terminalSupabaseKey({ root: ROOT, runtimeDir: RUNTIME_DIR });
const RESULTS_TABLE = process.env.STRATEGY3_SUPABASE_RESULTS_TABLE || "strategy3_scan_results";
const RUN_VIEW = process.env.STRATEGY3_SUPABASE_LATEST_RUN_VIEW || "v_strategy3_latest_complete_run";
const ENTRY_WINDOW_START = 12 * 60 + 59;
const ENTRY_WINDOW_TARGET = 13 * 60;
const ENTRY_WINDOW_END = 13 * 60 + 2;
const TAIL_WINDOW_START = 12 * 60 + 45;
const TAIL_WINDOW_END = 12 * 60 + 58;
const TAIL_VOLUME_RATIO_MIN = Number(process.env.STRATEGY3_TAIL_VOLUME_RATIO_MIN || 1);
const TAIL_HISTORY_MIN = Number(process.env.STRATEGY3_TAIL_HISTORY_MIN || 5);
const VALID_SOURCES = new Set(["intraday_1m_1300", "intraday_1m_1300_exact", "intraday_1m_entry_window_tolerance", "intraday_1m_tail_volume_confirmed"]);

function cleanNumber(value) {
  const number = Number(String(value ?? "").replace(/[,％%+]/g, "").trim());
  return Number.isFinite(number) ? number : 0;
}

function normalizeCode(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 4);
}

function taipeiDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return get("year") + "-" + get("month") + "-" + get("day");
}

function minuteFromTime(value) {
  const text = String(value || "");
  const parsed = Date.parse(text);
  if (Number.isFinite(parsed) && /[zZ]|[+-]\d{2}:?\d{2}/.test(text)) {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Taipei",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date(parsed));
    const hour = Number(parts.find((part) => part.type === "hour")?.value || 0);
    const minute = Number(parts.find((part) => part.type === "minute")?.value || 0);
    return hour * 60 + minute;
  }
  const iso = text.match(/T(\d{2}):(\d{2})/);
  if (iso) return Number(iso[1]) * 60 + Number(iso[2]);
  const plain = text.match(/\b(\d{1,2}):(\d{2})(?::\d{2})?\b/);
  if (plain) return Number(plain[1]) * 60 + Number(plain[2]);
  return 0;
}

function sourceExpectedForMinute(minute) {
  if (minute === ENTRY_WINDOW_TARGET) return "intraday_1m_1300_exact";
  if (minute >= ENTRY_WINDOW_START && minute <= ENTRY_WINDOW_END) return "intraday_1m_entry_window_tolerance";
  return "";
}

function sourceOkForMinute(source, minute) {
  if (source === "intraday_1m_tail_volume_confirmed") return minute >= TAIL_WINDOW_START && minute <= TAIL_WINDOW_END;
  if (source === "intraday_1m_1300") return minute === ENTRY_WINDOW_TARGET;
  return source === sourceExpectedForMinute(minute);
}

function rowPayload(row = {}) {
  return row.payload && typeof row.payload === "object" ? row.payload : {};
}

function normalizeRow(row = {}, index = 0) {
  const payload = rowPayload(row);
  const entryPrice = cleanNumber(payload.entryPrice ?? payload.entry_price ?? row.entryPrice ?? row.entry_price ?? row.price ?? row.close);
  const entryCandleTime = String(payload.entryCandleTime || payload.entry_candle_time || row.entryCandleTime || row.entry_candle_time || "");
  const entryMinute = cleanNumber(payload.entryMinute || row.entryMinute) || minuteFromTime(entryCandleTime);
  return {
    rank: cleanNumber(row.rank || payload.rank || index + 1),
    code: normalizeCode(row.code || row.symbol || payload.code || payload.symbol),
    name: String(payload.name || payload.displayName || row.name || "").replace(/🔥/g, "").trim(),
    price: entryPrice,
    entryPrice,
    entryPriceSource: String(payload.entryPriceSource || payload.entry_price_source || row.entryPriceSource || row.entry_price_source || "").trim(),
    entryCandleTime,
    entryMinute,
    entryTradeDate: String(payload.entryTradeDate || payload.entry_trade_date || row.entryTradeDate || row.entry_trade_date || row.scan_date || "").slice(0, 10),
    entryWindow: String(payload.entryWindow || row.entryWindow || ""),
    entryWindowStart: String(payload.entryWindowStart || row.entryWindowStart || ""),
    entryWindowEnd: String(payload.entryWindowEnd || row.entryWindowEnd || ""),
    tailVolumeRatio: cleanNumber(payload.tailVolumeRatio ?? row.tailVolumeRatio),
    tailVolumeHistoryCount: cleanNumber(payload.tailVolumeHistoryCount ?? row.tailVolumeHistoryCount),
  };
}

async function supabaseRows(pathname) {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error("missing_supabase_credentials");
  const response = await fetch(SUPABASE_URL + "/rest/v1/" + pathname, {
    headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY, Accept: "application/json" },
    cache: "no-store",
  });
  const text = await response.text();
  if (!response.ok) throw new Error((pathname + " HTTP " + response.status + " " + text.slice(0, 240)).trim());
  return text ? JSON.parse(text) : [];
}

async function readLatestRun() {
  const select = encodeURIComponent("run_id,scan_date,status,result_count,complete,updated_at,payload");
  const rows = await supabaseRows(RUN_VIEW + "?select=" + select + "&limit=1");
  const run = Array.isArray(rows) ? rows[0] : null;
  if (!run?.run_id) throw new Error("strategy3_latest_complete_run_missing");
  return run;
}

async function readPublishedRows(runId) {
  const select = encodeURIComponent("run_id,scan_date,rank,code,name,price,close,payload,updated_at");
  const rows = await supabaseRows(RESULTS_TABLE + "?select=" + select + "&run_id=eq." + encodeURIComponent(runId) + "&strategy=eq.strategy3&order=rank.asc&limit=500");
  return (rows || []).map(normalizeRow).filter((row) => /^\d{4}$/.test(row.code));
}

function runLineDryRun() {
  const output = execFileSync(process.execPath, [path.join(ROOT, "scripts", "send-strategy-line-card.js"), "--strategy=strategy3", "--dry-run"], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    timeout: 45000,
    env: { ...process.env, STRATEGY3_NOTIFICATION_DISABLED: "1" },
  });
  const match = output.match(/\{[\s\S]*\}\s*$/);
  const summary = match ? JSON.parse(match[0]) : {};
  const receiptPath = summary.receipt_path || path.join(RUNTIME_DIR, "data", "line-cards", "strategy3-line-card-" + taipeiDateKey().replace(/-/g, "") + ".json");
  const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
  return { summary, receipt, rows: (receipt.accepted_rows || []).map(normalizeRow).filter((row) => /^\d{4}$/.test(row.code)) };
}

function validateRows(label, rows, expectedTradeDate) {
  const issues = [];
  for (const row of rows) {
    if (!VALID_SOURCES.has(row.entryPriceSource)) issues.push(label + ":" + row.code + ":entry_source=" + (row.entryPriceSource || "missing"));
    if (!(row.price > 0)) issues.push(label + ":" + row.code + ":entry_price_not_positive");
    if (!row.entryCandleTime) issues.push(label + ":" + row.code + ":entry_candle_time_missing");
    const tailVolume = row.entryPriceSource === "intraday_1m_tail_volume_confirmed";
    if (tailVolume) {
      if (row.entryMinute < TAIL_WINDOW_START || row.entryMinute > TAIL_WINDOW_END) issues.push(label + ":" + row.code + ":tail_entry_minute_outside_12:45-12:58");
      if (row.tailVolumeRatio < TAIL_VOLUME_RATIO_MIN) issues.push(label + ":" + row.code + ":tail_volume_ratio_below_min");
      if (row.tailVolumeHistoryCount < TAIL_HISTORY_MIN) issues.push(label + ":" + row.code + ":tail_volume_history_below_min");
      if (row.entryWindow && row.entryWindow !== "12:45-12:58_tail_volume") issues.push(label + ":" + row.code + ":tail_entry_window=" + row.entryWindow);
    } else {
      if (row.entryMinute < ENTRY_WINDOW_START || row.entryMinute > ENTRY_WINDOW_END) issues.push(label + ":" + row.code + ":entry_minute=" + (row.entryMinute || "missing") + "_outside_12:59-13:02");
      if (row.entryWindow && row.entryWindow !== "12:59-13:02") issues.push(label + ":" + row.code + ":entry_window=" + row.entryWindow);
      if (row.entryWindowStart && row.entryWindowStart !== "12:59") issues.push(label + ":" + row.code + ":entry_window_start=" + row.entryWindowStart);
      if (row.entryWindowEnd && row.entryWindowEnd !== "13:02") issues.push(label + ":" + row.code + ":entry_window_end=" + row.entryWindowEnd);
    }
    if (!sourceOkForMinute(row.entryPriceSource, row.entryMinute)) issues.push(label + ":" + row.code + ":entry_source_minute_mismatch:" + row.entryPriceSource + "@" + row.entryMinute);
    if (row.entryTradeDate && expectedTradeDate && row.entryTradeDate !== expectedTradeDate) issues.push(label + ":" + row.code + ":entry_trade_date=" + row.entryTradeDate + "!=" + expectedTradeDate);
  }
  return issues;
}

function compareLineToPublished(publishedRows, lineRows) {
  const issues = [];
  const publishedCodes = publishedRows.map((row) => row.code).join(",");
  const lineCodes = lineRows.map((row) => row.code).join(",");
  if (publishedCodes !== lineCodes) issues.push("line_symbols_mismatch published=" + publishedCodes + " line=" + lineCodes);
  const byCode = new Map(lineRows.map((row) => [row.code, row]));
  for (const row of publishedRows) {
    const line = byCode.get(row.code);
    if (!line) continue;
    if (Math.abs(row.entryPrice - line.entryPrice) > 0.001) issues.push("line_price_mismatch:" + row.code + ":published=" + row.entryPrice + ":line=" + line.entryPrice);
    if (row.entryPriceSource !== line.entryPriceSource) issues.push("line_entry_source_mismatch:" + row.code + ":published=" + row.entryPriceSource + ":line=" + line.entryPriceSource);
    if (row.entryCandleTime !== line.entryCandleTime) issues.push("line_entry_candle_mismatch:" + row.code + ":published=" + row.entryCandleTime + ":line=" + line.entryCandleTime);
  }
  return issues;
}

async function main() {
  const run = await readLatestRun();
  const rows = await readPublishedRows(run.run_id);
  const line = runLineDryRun();
  const expectedTradeDate = String(run.scan_date || "").slice(0, 10);
  const issues = [];
  if (run.complete !== true || run.status !== "complete") issues.push("latest_run_not_complete:" + (run.status || "missing"));
  if (rows.length !== cleanNumber(run.result_count)) issues.push("published_count_mismatch rows=" + rows.length + " run=" + run.result_count);
  if (line.receipt.runId !== run.run_id) issues.push("line_runId_mismatch line=" + (line.receipt.runId || "missing") + " published=" + run.run_id);
  if (line.rows.length !== rows.length) issues.push("line_count_mismatch line=" + line.rows.length + " published=" + rows.length);
  issues.push(...validateRows("published", rows, expectedTradeDate));
  issues.push(...validateRows("line", line.rows, expectedTradeDate));
  issues.push(...compareLineToPublished(rows, line.rows));
  const exactRows = rows.filter((row) => row.entryPriceSource === "intraday_1m_1300_exact");
  const toleranceRows = rows.filter((row) => row.entryPriceSource === "intraday_1m_entry_window_tolerance");
  const tailVolumeRows = rows.filter((row) => row.entryPriceSource === "intraday_1m_tail_volume_confirmed");
  const output = {
    ok: issues.length === 0,
    verifier: "verify-strategy3-entry-window-evidence",
    checkedAt: new Date().toISOString(),
    runId: run.run_id,
    scanDate: expectedTradeDate,
    count: rows.length,
    entryWindow: "12:59-13:02_or_12:45-12:58_tail_volume",
    exactCount: exactRows.length,
    toleranceCount: toleranceRows.length,
    tailVolumeCount: tailVolumeRows.length,
    tailVolumeRule: "same_day_fugle_1m; close>=open; close>=previous_5_close_average; volume>=previous_5_volume_average",
    line: { runId: line.receipt.runId, count: line.rows.length, status: line.receipt.status, dryRun: true },
    sample: rows.slice(0, 8).map((row) => ({ rank: row.rank, code: row.code, name: row.name, entryPrice: row.entryPrice, entryPriceSource: row.entryPriceSource, entryCandleTime: row.entryCandleTime })),
    issues,
  };
  console.log(JSON.stringify(output, null, 2));
  if (issues.length) process.exit(1);
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, verifier: "verify-strategy3-entry-window-evidence", error: error?.message || String(error) }, null, 2));
  process.exit(1);
});
