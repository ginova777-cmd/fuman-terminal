"use strict";

const { serverSupabaseKey, serverSupabaseUrl } = require("./server-supabase-key");

const TABLE_NAME = "seven_strategy_daily_history";
const SOURCE_NAME = "seven_strategy_daily_history";
const TAIPEI_TIME_ZONE = "Asia/Taipei";
const REQUIRED_FIELDS = ["trade_date", "detect_time", "symbol", "name", "entry_price", "strategy", "signal_type", "source"];

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

function normalizeDate(value) {
  const raw = text(value);
  const match = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (match) return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  const digits = raw.replace(/\D/g, "");
  if (/^\d{8}$/.test(digits)) return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  return "";
}

function normalizeTime(value) {
  const raw = text(value);
  const match = raw.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return "";
  return `${match[1].padStart(2, "0")}:${match[2]}:${(match[3] || "00").padStart(2, "0")}`;
}

function seconds(value) {
  const match = normalizeTime(value).match(/^(\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return -1;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

function numberOrNull(value) {
  if (value === null || value === undefined || text(value) === "") return null;
  const number = Number(String(value).replace(/[,% ]/g, ""));
  return Number.isFinite(number) ? number : null;
}

function normalizeSignalType(value, sourceHint = "") {
  const raw = text(value).toLowerCase();
  const hint = text(sourceHint).toLowerCase();
  if (raw === "formal" || raw === "entry" || hint.includes("entry")) return "formal";
  return "detected";
}

function normalizeRow(input = {}, options = {}) {
  const now = options.now || new Date();
  const signalType = normalizeSignalType(input.signal_type ?? input.signalType, options.sourceHint);
  const normalizedTime = normalizeTime(input.detect_time ?? input.detectTime ?? input.entry_time ?? input.entryTime ?? input.time ?? input.updated_at ?? input.updatedAt);
  const normalizedStrategy = text(input.strategy ?? input.strategy_label ?? input.strategyLabel ?? "七策略");
  return {
    trade_date: normalizeDate(input.trade_date ?? input.tradeDate ?? input.date ?? todayTaipeiDate(now)),
    detect_time: normalizedTime,
    entry_time: normalizedTime,
    symbol: text(input.symbol ?? input.code ?? input.ticker),
    name: text(input.name),
    entry_price: numberOrNull(input.entry_price ?? input.entryPrice ?? input.price),
    current_price: numberOrNull(input.current_price ?? input.currentPrice ?? input.current ?? input.price),
    change_percent: numberOrNull(input.change_percent ?? input.changePercent ?? input.change_pct ?? input.changePct),
    score: numberOrNull(input.score),
    strategy: normalizedStrategy,
    strategy_label: normalizedStrategy,
    signal_type: signalType,
    source: text(input.source || `${SOURCE_NAME}:${signalType}`),
    run_id: text(input.run_id ?? input.runId),
    evidence: input.evidence && typeof input.evidence === "object" ? input.evidence : {},
    updated_at: text(input.updated_at ?? input.updatedAt ?? new Date(now).toISOString()),
  };
}

function rowHasReplay(row) {
  return [row.source, row.strategy, row.strategy_label, row.signal_type].some((value) => text(value).toLowerCase().includes("replay"));
}

function validateRow(row, options = {}) {
  const today = options.today || todayTaipeiDate(options.now || new Date());
  const issues = [];
  for (const field of REQUIRED_FIELDS) {
    const value = row[field];
    if (value === null || value === undefined || text(value) === "") issues.push(`missing_${field}`);
  }
  if (row.trade_date !== today) issues.push(`trade_date_not_today:${row.trade_date || "missing"}:${today}`);
  const key = seconds(row.detect_time);
  if (key < seconds("09:00:00") || key > seconds("13:30:00")) issues.push(`detect_time_outside_window:${row.detect_time || "missing"}`);
  if (rowHasReplay(row)) issues.push("source_contains_replay");
  if (row.signal_type !== "formal" && row.signal_type !== "detected") issues.push(`invalid_signal_type:${row.signal_type || "missing"}`);
  if (!/^\d{4,6}[A-Z]?$/.test(row.symbol)) issues.push(`symbol_invalid:${row.symbol || "missing"}`);
  if (!(Number(row.entry_price) > 0)) issues.push("entry_price_not_positive");
  return { ok: issues.length === 0, issues };
}

function normalizeRows(rows, options = {}) {
  const accepted = [];
  const rejected = [];
  for (const input of Array.isArray(rows) ? rows : []) {
    const row = normalizeRow(input, options);
    const validation = validateRow(row, options);
    if (validation.ok) accepted.push(row);
    else rejected.push({ row, issues: validation.issues });
  }
  accepted.sort((a, b) =>
    seconds(b.detect_time) - seconds(a.detect_time)
    || text(b.updated_at).localeCompare(text(a.updated_at))
    || text(a.symbol).localeCompare(text(b.symbol))
  );
  return { accepted, rejected };
}

function supabaseHeaders(key, prefer = "") {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    Accept: "application/json",
    "Content-Type": "application/json",
    ...(prefer ? { Prefer: prefer } : {}),
  };
}

async function writeRows(rows, options = {}) {
  const url = (options.supabaseUrl || serverSupabaseUrl()).replace(/\/+$/, "");
  const key = options.supabaseKey || serverSupabaseKey();
  if (!url || !key) throw new Error("missing_supabase_credentials");
  if (!rows.length) return { written: 0, rows: [] };
  const response = await fetch(`${url}/rest/v1/${TABLE_NAME}?on_conflict=trade_date,detect_time,symbol,strategy,signal_type,source`, {
    method: "POST",
    headers: supabaseHeaders(key, "resolution=merge-duplicates,return=representation"),
    body: JSON.stringify(rows),
    signal: AbortSignal.timeout ? AbortSignal.timeout(Number(options.timeoutMs || 20000)) : undefined,
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`seven_strategy_daily_history_upsert_failed:${response.status}:${body.slice(0, 240)}`);
  const writtenRows = body ? JSON.parse(body) : [];
  return { written: Array.isArray(writtenRows) ? writtenRows.length : rows.length, rows: Array.isArray(writtenRows) ? writtenRows : [] };
}

async function publishRows(rows, options = {}) {
  const normalized = normalizeRows(rows, options);
  if (options.dryRun) return { rawOk: true, action: "dry_run", ...normalized, write: { written: 0, rows: [] } };
  const write = await writeRows(normalized.accepted, options);
  return { rawOk: true, action: "written", ...normalized, write };
}

module.exports = {
  TABLE_NAME,
  SOURCE_NAME,
  REQUIRED_FIELDS,
  normalizeRow,
  normalizeRows,
  validateRow,
  publishRows,
  writeRows,
  todayTaipeiDate,
};
