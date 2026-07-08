"use strict";

const { serverSupabaseKey, serverSupabaseUrl } = require("./server-supabase-key");

const ENTRY_TABLE = "fugle_daytrade_entry_history";
const SOURCE_STATUS_TABLE = "source_status";
const SOURCE_NAME = "fugle_daytrade_source";
const TAIPEI_TIME_ZONE = "Asia/Taipei";
const REQUIRED_FIELDS = [
  "trade_date",
  "entry_time",
  "symbol",
  "name",
  "entry_price",
  "current_price",
  "strategy_label",
  "source",
];

function text(value) {
  return String(value ?? "").trim();
}

function numberOrNull(value) {
  if (value === null || value === undefined || text(value) === "") return null;
  const number = Number(String(value ?? "").replace(/[, ]/g, ""));
  return Number.isFinite(number) ? number : null;
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

function sourceGateGrade(sourceStatus = {}) {
  const payload = sourceStatus.payload && typeof sourceStatus.payload === "object" ? sourceStatus.payload : {};
  return text(
    payload.daytrade_gate_grade
    || payload.gate_grade
    || payload.gateGrade
    || sourceStatus.gate_grade
    || sourceStatus.gateGrade
  ).toUpperCase();
}

function sourceStatusOk(sourceStatus = {}) {
  const status = text(sourceStatus.status || sourceStatus.payload?.status).toLowerCase();
  return status === "ok" || status === "ready" || status === "running";
}

function normalizeEntry(input = {}, options = {}) {
  const now = options.now || new Date();
  return {
    trade_date: normalizeDate(input.trade_date || input.tradeDate || todayTaipeiDate(now)),
    entry_time: normalizeTime(input.entry_time || input.entryTime || input.time),
    symbol: text(input.symbol || input.code || input.ticker),
    name: text(input.name),
    entry_price: numberOrNull(input.entry_price ?? input.entryPrice),
    current_price: numberOrNull(input.current_price ?? input.currentPrice ?? input.price),
    strategy_label: text(input.strategy_label || input.strategyLabel || "PS1"),
    note: text(input.note),
    source: text(input.source || "ps1-live"),
    run_id: text(input.run_id || input.runId),
    evidence: input.evidence && typeof input.evidence === "object" ? input.evidence : {},
    created_at: text(input.created_at || input.createdAt || new Date(now).toISOString()),
  };
}

function validateEntry(entry, options = {}) {
  const today = options.today || todayTaipeiDate(options.now || new Date());
  const issues = [];
  for (const field of REQUIRED_FIELDS) {
    const value = entry[field];
    if (value === null || value === undefined || text(value) === "") issues.push(`missing_${field}`);
  }
  if (entry.trade_date !== today) issues.push(`trade_date_not_today:${entry.trade_date || "missing"}:${today}`);
  const key = seconds(entry.entry_time);
  if (key < seconds("09:00:00") || key > seconds("13:30:00")) issues.push(`entry_time_outside_window:${entry.entry_time || "missing"}`);
  const formalText = `${entry.source} ${entry.strategy_label}`.toLowerCase();
  if (formalText.includes("replay")) issues.push("source_contains_replay");
  if (formalText.includes("observation")) issues.push("source_contains_observation");
  if (!/^\d{4,6}[A-Z]?$/.test(entry.symbol)) issues.push(`symbol_invalid:${entry.symbol || "missing"}`);
  if (!(Number(entry.entry_price) > 0)) issues.push("entry_price_not_positive");
  if (!(Number(entry.current_price) > 0)) issues.push("current_price_not_positive");
  return { ok: issues.length === 0, issues };
}

function validateSourceGate(sourceStatus, options = {}) {
  if (options.skipSourceGate) return { ok: true, issue: "", grade: "SKIPPED" };
  const grade = sourceGateGrade(sourceStatus);
  if (!sourceStatus || typeof sourceStatus !== "object") return { ok: false, issue: "source_status_missing", grade };
  if (!sourceStatusOk(sourceStatus)) return { ok: false, issue: `source_status_not_ok:${text(sourceStatus.status || sourceStatus.payload?.status || "missing")}`, grade };
  if (grade !== "A") return { ok: false, issue: `source_gate_not_A:${grade || "missing"}`, grade };
  return { ok: true, issue: "", grade };
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

async function fetchSourceStatus(options = {}) {
  if (options.sourceStatus) return options.sourceStatus;
  const url = (options.supabaseUrl || serverSupabaseUrl()).replace(/\/+$/, "");
  const key = options.supabaseKey || serverSupabaseKey();
  if (!url || !key) throw new Error("missing_supabase_credentials");
  const query = new URLSearchParams();
  query.set("source_name", `eq.${SOURCE_NAME}`);
  query.set("select", "source_name,status,updated_at,payload");
  query.set("limit", "1");
  const response = await fetch(`${url}/rest/v1/${SOURCE_STATUS_TABLE}?${query.toString()}`, {
    headers: supabaseHeaders(key),
    signal: AbortSignal.timeout ? AbortSignal.timeout(Number(options.timeoutMs || 15000)) : undefined,
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`source_status_read_failed:${response.status}:${body.slice(0, 180)}`);
  const rows = body ? JSON.parse(body) : [];
  return Array.isArray(rows) ? rows[0] : null;
}

async function writeEntry(entry, options = {}) {
  const url = (options.supabaseUrl || serverSupabaseUrl()).replace(/\/+$/, "");
  const key = options.supabaseKey || serverSupabaseKey();
  if (!url || !key) throw new Error("missing_supabase_credentials");
  const response = await fetch(`${url}/rest/v1/${ENTRY_TABLE}?on_conflict=trade_date,symbol,strategy_label,entry_time,source`, {
    method: "POST",
    headers: supabaseHeaders(key, "resolution=merge-duplicates,return=representation"),
    body: JSON.stringify([entry]),
    signal: AbortSignal.timeout ? AbortSignal.timeout(Number(options.timeoutMs || 15000)) : undefined,
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`entry_history_upsert_failed:${response.status}:${body.slice(0, 240)}`);
  const rows = body ? JSON.parse(body) : [];
  return { written: Array.isArray(rows) ? rows.length : 1, rows: Array.isArray(rows) ? rows : [] };
}

async function publishPs1Entry(input, options = {}) {
  const entry = normalizeEntry(input, options);
  const entryValidation = validateEntry(entry, options);
  if (!entryValidation.ok) return { ok: false, rawOk: false, action: "blocked", issues: entryValidation.issues, entry };
  const sourceStatus = await fetchSourceStatus(options);
  const sourceGate = validateSourceGate(sourceStatus, options);
  if (!sourceGate.ok) return { ok: false, rawOk: false, action: "blocked", issues: [sourceGate.issue], sourceGate, entry };
  if (options.dryRun) return { ok: true, rawOk: true, action: "dry_run", issues: [], sourceGate, entry };
  const write = await writeEntry(entry, options);
  return { ok: true, rawOk: true, action: "written", issues: [], sourceGate, entry, write };
}

module.exports = {
  ENTRY_TABLE,
  SOURCE_NAME,
  REQUIRED_FIELDS,
  normalizeEntry,
  validateEntry,
  validateSourceGate,
  sourceGateGrade,
  fetchSourceStatus,
  writeEntry,
  publishPs1Entry,
  todayTaipeiDate,
};
