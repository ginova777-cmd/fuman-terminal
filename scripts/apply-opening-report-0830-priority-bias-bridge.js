"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime";
const PROJECT_URL = process.env.SUPABASE_URL || "https://cpmpfhbzutkiecccekfr.supabase.co";
const DEFAULT_INPUT = path.join(RUNTIME_DIR, "state", "opening_report_0830.industry_bias_json");
const DEFAULT_RECEIPT = path.join(RUNTIME_DIR, "data", "scan-receipts", "opening-report-0830-priority-bias-bridge-latest.json");
const SOURCE = "opening_report_0830";
const MODE = "priority_bias_only";
const ALLOWED_ACTION = "boost_scan_priority_only";
const FORBIDDEN_ACTION = "publish_formal_candidate_without_taiwan_evidence";
const REASON_CODE = "opening_report_0830_industry_bias";
const FORMAL_RANK_FLOOR = 41;
const MOTHER_POOL_START_RANK = 300;
const BOOST_STEP = 25;
const MOTHER_POOL_MIN_PRICE = 50;

function argValue(name, fallback = "") {
  const prefix = `${name}=`;
  const match = process.argv.find((item) => item === name || item.startsWith(prefix));
  return match === name ? "1" : (match ? match.slice(prefix.length) : fallback);
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function normalizeSymbol(value) {
  const symbol = String(value ?? "").trim();
  return /^\d{4,6}$/.test(symbol) ? symbol : "";
}

function compactDate(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 8);
}

function taipeiDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(date).replace(/\D/g, "");
}

function parseInput(raw) {
  if (raw?.opening_report_0830?.industry_bias_json) return raw.opening_report_0830.industry_bias_json;
  if (raw?.industry_bias_json && typeof raw.industry_bias_json === "object") return raw.industry_bias_json;
  return raw;
}

function validate(payload, options = {}) {
  const issues = [];
  const required = ["date", "report_time", "run_id", "source", "mode", "industry", "bias", "confidence", "evidence_summary", "mapped_symbols", "allowed_action", "forbidden_action"];
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) issues.push("industry_bias_json_missing_or_not_object");
  for (const field of required) if (payload?.[field] === undefined || payload?.[field] === null || payload?.[field] === "") issues.push(`missing_field:${field}`);
  const date = compactDate(payload?.date);
  if (date.length !== 8) issues.push("invalid_date");
  if (options.expectedDate && date !== compactDate(options.expectedDate)) issues.push("date_mismatch");
  if (!/^08:30(?:$|[:+T\s])/.test(String(payload?.report_time || ""))) issues.push("report_time_not_0830");
  if (options.expectedRunId && String(payload?.run_id || "") !== String(options.expectedRunId)) issues.push("run_id_mismatch");
  if (payload?.source !== SOURCE) issues.push("source_mismatch");
  if (payload?.mode !== MODE) issues.push("mode_mismatch");
  if (payload?.allowed_action !== ALLOWED_ACTION) issues.push("allowed_action_mismatch");
  if (payload?.forbidden_action !== FORBIDDEN_ACTION) issues.push("forbidden_action_mismatch");
  if (!Array.isArray(payload?.mapped_symbols) || payload.mapped_symbols.length === 0) issues.push("mapped_symbols_missing_or_empty");
  const confidence = Number(payload?.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) issues.push("confidence_invalid");
  if (typeof payload?.evidence_summary !== "string" || !payload.evidence_summary.trim()) issues.push("evidence_summary_missing");
  return { ok: issues.length === 0, issues, date, runId: String(payload?.run_id || "") };
}

function readSecret(name) {
  for (const file of [path.join(RUNTIME_DIR, "secrets", name), path.join(ROOT, "secrets", name)]) {
    try { const value = fs.readFileSync(file, "utf8").trim(); if (value) return value; } catch {}
  }
  return "";
}

async function restRequest(key, resource, options = {}) {
  const response = await fetch(`${PROJECT_URL.replace(/\/$/, "")}/rest/v1/${resource}`, {
    method: options.method || "GET",
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json", "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=representation" },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout ? AbortSignal.timeout(20000) : undefined,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${options.method || "GET"} ${resource} HTTP ${response.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : [];
}

function buildReceipt({ inputPath, receiptPath, payload, validation, acceptedSymbols, rejectedSymbols, appliedBoosts, error = "" }) {
  return {
    contract: "opening-report-0830-priority-bias-bridge-v1",
    received: Boolean(payload),
    accepted_symbols: acceptedSymbols,
    rejected_symbols: rejectedSymbols,
    applied_boosts: appliedBoosts,
    forbidden_publish_guard: true,
    formal_candidate_count: 0,
    formal_candidate_allowed: false,
    run_id: validation.runId,
    date: validation.date,
    source: payload?.source || SOURCE,
    mode: payload?.mode || MODE,
    reason_code: REASON_CODE,
    status: "priority_scan",
    evidence_path: inputPath,
    receipt_path: receiptPath,
    validation: { ok: validation.ok && !error, issues: validation.issues, error },
    allowed_action: ALLOWED_ACTION,
    forbidden_action: FORBIDDEN_ACTION,
    bias: payload?.bias ?? null,
    confidence: payload?.confidence ?? null,
    industry: payload?.industry || "",
    evidence_summary: payload?.evidence_summary || "",
    checked_at: new Date().toISOString(),
  };
}

function symbolFromEntry(value) {
  return normalizeSymbol(value && typeof value === "object" ? value.symbol : value);
}

function entryPrice(value) {
  if (!value || typeof value !== "object") return 0;
  const price = Number(value.price ?? value.last_price ?? value.lastPrice ?? value.close ?? value.previous_close);
  return Number.isFinite(price) ? price : 0;
}

async function main() {
  const inputPath = path.resolve(argValue("--input", process.env.OPENING_REPORT_0830_BIAS_INPUT || DEFAULT_INPUT));
  const receiptPath = path.resolve(argValue("--receipt", process.env.OPENING_REPORT_0830_BIAS_RECEIPT || DEFAULT_RECEIPT));
  const expectedDate = argValue("--expected-date", process.env.FUMAN_TRADE_DATE || taipeiDateKey());
  const expectedRunId = argValue("--expected-run-id", process.env.FUMAN_EXPECTED_OPENING_REPORT_RUN_ID || "");
  const raw = readJson(inputPath);
  const payload = parseInput(raw);
  const validation = validate(payload, { expectedDate, expectedRunId });
  let acceptedSymbols = [];
  const rejectedSymbols = [];
  const mappedEntryBySymbol = new Map();
  const seen = new Set();
  for (const value of Array.isArray(payload?.mapped_symbols) ? payload.mapped_symbols : []) {
    const symbol = symbolFromEntry(value);
    const price = entryPrice(value);
    if (!symbol || seen.has(symbol)) rejectedSymbols.push(value);
    else if (price > 0 && price < MOTHER_POOL_MIN_PRICE) rejectedSymbols.push({ symbol, reason: "price_below_50", price });
    else { seen.add(symbol); mappedEntryBySymbol.set(symbol, value); acceptedSymbols.push(symbol); }
  }
  if (!acceptedSymbols.length && validation.ok) validation.issues.push("no_valid_mapped_symbols");
  validation.ok = validation.ok && validation.issues.length === 0;
  if (!validation.ok) {
    const receipt = buildReceipt({ inputPath, receiptPath, payload, validation, acceptedSymbols: [], rejectedSymbols: Array.isArray(payload?.mapped_symbols) ? payload.mapped_symbols : rejectedSymbols, appliedBoosts: [] });
    writeJson(receiptPath, receipt);
    console.log(JSON.stringify({ ok: false, receipt: receiptPath, received: receipt.received, accepted_symbols: [], rejected_symbols: receipt.rejected_symbols, applied_boosts: [], forbidden_publish_guard: true, reason_code: REASON_CODE, issues: validation.issues }, null, 2));
    process.exitCode = 1;
    return;
  }
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.FUMAN_SUPABASE_SERVICE_ROLE_KEY || readSecret("supabase-service-role-key.txt");
  if (!key) {
    const receipt = buildReceipt({ inputPath, receiptPath, payload, validation, acceptedSymbols: [], rejectedSymbols: acceptedSymbols, appliedBoosts: [], error: "missing_supabase_service_role_key" });
    writeJson(receiptPath, receipt);
    console.log(JSON.stringify({ ok: false, receipt: receiptPath, received: true, accepted_symbols: [], rejected_symbols: acceptedSymbols, applied_boosts: [], forbidden_publish_guard: true, reason_code: REASON_CODE, issues: ["missing_supabase_service_role_key"] }, null, 2));
    process.exitCode = 1;
    return;
  }
  try {
    const existingRows = [];
    for (const symbol of acceptedSymbols) {
      const rows = await restRequest(key, "fugle_daytrade_priority_pool?select=symbol,name,market,price,priority_rank,priority_reason,source,updated_at,payload&symbol=eq." + encodeURIComponent(symbol) + "&limit=1");
      if (Array.isArray(rows) && rows[0]) existingRows.push(rows[0]);
    }
    const bySymbol = new Map(existingRows.map((row) => [symbolFromEntry(row), row]));
    const priceFloorRejected = [];
    acceptedSymbols = acceptedSymbols.filter((symbol) => {
      const existingPrice = Number(bySymbol.get(symbol)?.price);
      if (Number.isFinite(existingPrice) && existingPrice > 0 && existingPrice < MOTHER_POOL_MIN_PRICE) {
        priceFloorRejected.push({ symbol, reason: "price_below_50", price: existingPrice });
        return false;
      }
      return true;
    });
    rejectedSymbols.push(...priceFloorRejected);
    if (!acceptedSymbols.length) {
      validation.issues.push("no_mapped_symbols_at_or_above_50");
      validation.ok = false;
      const receipt = buildReceipt({ inputPath, receiptPath, payload, validation, acceptedSymbols: [], rejectedSymbols, appliedBoosts: [] });
      writeJson(receiptPath, receipt);
      console.log(JSON.stringify({ ok: false, receipt: receiptPath, received: true, accepted_symbols: [], rejected_symbols: rejectedSymbols, applied_boosts: [], forbidden_publish_guard: true, reason_code: REASON_CODE, issues: validation.issues }, null, 2));
      process.exitCode = 1;
      return;
    }
    const appliedBoosts = [];
    const now = new Date().toISOString();
    const rows = acceptedSymbols.map((symbol, index) => {
      const old = bySymbol.get(symbol) || {};
      const oldRank = Number.isFinite(Number(old.priority_rank)) ? Number(old.priority_rank) : null;
      const baseRank = oldRank !== null && oldRank < 999999 ? oldRank : MOTHER_POOL_START_RANK + index;
      const nextRank = Math.max(FORMAL_RANK_FLOOR, baseRank - BOOST_STEP);
      const oldPayload = old.payload && typeof old.payload === "object" ? old.payload : {};
      const biasEvidence = { date: payload.date, report_time: payload.report_time, run_id: payload.run_id, source: SOURCE, mode: MODE, industry: payload.industry, bias: payload.bias, confidence: payload.confidence, evidence_summary: payload.evidence_summary, reason_code: REASON_CODE, status: "watchlist_boosted", formal_candidate: false, formal_candidate_allowed: false, forbidden_publish_guard: true };
      appliedBoosts.push({ symbol, previous_priority_rank: oldRank, applied_priority_rank: nextRank, boost: Math.max(0, baseRank - nextRank), status: "watchlist_boosted" });
      return { symbol, name: old.name || mappedEntryBySymbol.get(symbol)?.name || symbol, market: old.market || "", priority_rank: nextRank, priority_reason: REASON_CODE, source: SOURCE, updated_at: now, payload: { ...oldPayload, openingReport0830IndustryBias: biasEvidence, priority_reason: REASON_CODE, priority_status: "watchlist_boosted", formal_candidate: false, formal_candidate_allowed: false, forbidden_publish_guard: true } };
    });
    await restRequest(key, "fugle_daytrade_priority_pool", { method: "POST", body: rows });
    const receipt = buildReceipt({ inputPath, receiptPath, payload, validation, acceptedSymbols, rejectedSymbols, appliedBoosts });
    writeJson(receiptPath, receipt);
    console.log(JSON.stringify({ ok: true, receipt: receiptPath, received: true, accepted_symbols: acceptedSymbols, rejected_symbols: rejectedSymbols, applied_boosts: appliedBoosts, forbidden_publish_guard: true, run_id: payload.run_id, evidence_path: inputPath }, null, 2));
  } catch (error) {
    const receipt = buildReceipt({ inputPath, receiptPath, payload, validation, acceptedSymbols: [], rejectedSymbols: acceptedSymbols, appliedBoosts: [], error: error.message || String(error) });
    writeJson(receiptPath, receipt);
    console.log(JSON.stringify({ ok: false, receipt: receiptPath, received: true, accepted_symbols: [], rejected_symbols: acceptedSymbols, applied_boosts: [], forbidden_publish_guard: true, reason_code: REASON_CODE, error: error.message || String(error) }, null, 2));
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { validate, parseInput, normalizeSymbol, buildReceipt, constants: { SOURCE, MODE, ALLOWED_ACTION, FORBIDDEN_ACTION, REASON_CODE, FORMAL_RANK_FLOOR } };
