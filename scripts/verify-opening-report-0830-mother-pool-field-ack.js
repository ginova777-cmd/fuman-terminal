#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME = process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime";
const STATE_DIR = path.join(RUNTIME, "state");
const RECEIPT_DIR = path.join(RUNTIME, "data", "scan-receipts");
const REPORT_DIR = path.join(RUNTIME, "data", "opening-report-0830");
const PROJECT_URL = String(process.env.SUPABASE_URL || "https://cpmpfhbzutkiecccekfr.supabase.co").replace(/\/$/, "");
const CONTRACT = "opening-report-0830-mother-pool-field-ack-v1";
const SOURCE = "opening_report_0830";
const MODE = "priority_bias_only";
const REASON = "opening_report_0830_industry_bias";
const ALLOWED_BASIS = new Set(["positive_industry_top3", "us_market_closed_asia_positive_leader_top3"]);

function arg(name, fallback = "") {
  const prefix = `--${name}=`;
  const found = process.argv.find((value) => value.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function taipeiDate(value = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
}

function compact(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 8);
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readSecret(name) {
  for (const file of [path.join(RUNTIME, "secrets", name), path.join(ROOT, "secrets", name)]) {
    try { const value = fs.readFileSync(file, "utf8").trim(); if (value) return value; } catch {}
  }
  return "";
}

function symbol(value) {
  const result = String(value?.symbol || value || "").trim();
  return /^\d{4}$/.test(result) ? result : "";
}

function validatePayload(payload, tradeDate, reportRunId) {
  const issues = [];
  const requiredText = ["run_id", "source", "mode", "industry", "display_name", "priority_observation_basis", "bias", "evidence_summary", "allowed_action", "forbidden_action"];
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return ["payload_missing"];
  if (payload.date !== tradeDate) issues.push("date_mismatch");
  if (payload.report_time !== "08:30") issues.push("report_time_not_0830");
  for (const field of requiredText) if (!String(payload[field] ?? "").trim()) issues.push(`missing_field:${field}`);
  if (!String(payload.run_id || "").startsWith(`${reportRunId}-`)) issues.push("run_id_not_bound_to_report");
  if (payload.source !== SOURCE) issues.push("source_mismatch");
  if (payload.mode !== MODE) issues.push("mode_mismatch");
  if (!ALLOWED_BASIS.has(payload.priority_observation_basis)) issues.push("priority_observation_basis_invalid");
  const rank = Number(payload.priority_observation_rank);
  if (!Number.isInteger(rank) || rank < 1 || rank > 3) issues.push("priority_observation_rank_invalid");
  const confidence = Number(payload.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) issues.push("confidence_invalid");
  if (payload.allowed_action !== "boost_scan_priority_only") issues.push("allowed_action_mismatch");
  if (payload.forbidden_action !== "publish_formal_candidate_without_taiwan_evidence") issues.push("forbidden_action_mismatch");

  const a = Array.isArray(payload.mapped_symbols_a) ? payload.mapped_symbols_a : [];
  const b = Array.isArray(payload.mapped_symbols_b) ? payload.mapped_symbols_b : [];
  const mapped = Array.isArray(payload.mapped_symbols) ? payload.mapped_symbols : [];
  if (!a.length) issues.push("mapped_symbols_a_missing");
  if (!b.length) issues.push("mapped_symbols_b_missing");
  const validateTier = (row, tier) => Boolean(symbol(row) && String(row?.name || "").trim() && row?.tier === tier);
  if (!a.every((row) => validateTier(row, "A"))) issues.push("mapped_symbols_a_invalid");
  if (!b.every((row) => validateTier(row, "B"))) issues.push("mapped_symbols_b_invalid");
  const expected = [...new Set([...a, ...b].map(symbol).filter(Boolean))];
  const actual = [...new Set(mapped.map(symbol).filter(Boolean))];
  if (expected.length !== a.length + b.length) issues.push("mapped_symbols_a_b_duplicate");
  if (JSON.stringify(actual) !== JSON.stringify(expected)) issues.push("mapped_symbols_union_mismatch");

  if (payload.priority_observation_basis === "us_market_closed_asia_positive_leader_top3") {
    const leaders = Array.isArray(payload.priority_overseas_leaders) ? payload.priority_overseas_leaders : [];
    if (!leaders.length) issues.push("priority_overseas_leaders_missing");
    for (const leader of leaders) {
      if (!/\.(?:T|KS|KQ)$/i.test(String(leader?.symbol || ""))) issues.push("priority_overseas_leader_market_invalid");
      if (!(Number(leader?.percent) > 0)) issues.push("priority_overseas_leader_percent_invalid");
      if (!String(leader?.source_time || "").trim()) issues.push("priority_overseas_leader_source_time_missing");
      if (!Number.isInteger(Number(leader?.rank)) || Number(leader.rank) < 1 || Number(leader.rank) > 3) issues.push("priority_overseas_leader_rank_invalid");
    }
  }
  return [...new Set(issues)];
}

function validateBridge(receipt, payload) {
  const issues = [];
  const required = {
    contract: "opening-report-0830-priority-bias-bridge-v1",
    ok: true,
    received: true,
    source: SOURCE,
    mode: MODE,
    status: "priority_scan",
    reason_code: REASON,
    forbidden_publish_guard: true,
    formal_candidate_count: 0,
    formal_candidate_allowed: false,
    publish_allowed: false,
    opening_report_status_unchanged: true,
  };
  if (!receipt) return ["bridge_receipt_missing"];
  for (const [field, expected] of Object.entries(required)) if (receipt[field] !== expected) issues.push(`bridge_${field}_mismatch`);
  if (receipt.run_id !== payload.run_id) issues.push("bridge_run_id_mismatch");
  if (receipt.validation?.ok !== true) issues.push("bridge_validation_not_ok");
  if (!Array.isArray(receipt.rejected_symbols)) issues.push("bridge_rejected_symbols_missing");
  return issues;
}

async function request(resource, key) {
  const response = await fetch(`${PROJECT_URL}/rest/v1/${resource}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" },
    signal: AbortSignal.timeout(20000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`anon_readback_http_${response.status}:${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : [];
}

function validateDbRow(row, expectedPayload) {
  const issues = [];
  const evidence = row?.payload?.openingReport0830IndustryBias;
  if (!row) return ["db_row_missing"];
  if (row.market !== "TW") issues.push("market_not_TW");
  if (row.priority_reason !== REASON) issues.push("priority_reason_mismatch");
  if (row.source !== SOURCE) issues.push("source_mismatch");
  if (!evidence) return [...issues, "opening_report_evidence_missing"];
  const requiredEqual = {
    date: expectedPayload.date,
    report_time: "08:30",
    run_id: expectedPayload.run_id,
    source: SOURCE,
    mode: MODE,
    industry: expectedPayload.industry,
    priority_observation_basis: expectedPayload.priority_observation_basis,
    priority_observation_rank: Number(expectedPayload.priority_observation_rank),
    boost_once: true,
    reason_code: REASON,
    status: "watchlist_boosted",
    formal_candidate: false,
    formal_candidate_allowed: false,
    forbidden_publish_guard: true,
  };
  for (const [field, expected] of Object.entries(requiredEqual)) if (evidence[field] !== expected) issues.push(`payload_${field}_mismatch`);
  if (!Array.isArray(evidence.linked_industries) || !evidence.linked_industries.includes(expectedPayload.industry)) issues.push("payload_linked_industries_mismatch");
  if (!Array.isArray(evidence.priority_overseas_leaders)) issues.push("payload_priority_overseas_leaders_missing");
  return issues;
}

function fixture() {
  const reportRunId = "opening-report-0830-20260908-fixture";
  const payload = {
    date: "2026-09-08", report_time: "08:30", run_id: `${reportRunId}-ROBOTICS_AUTOMATION`, source: SOURCE, mode: MODE,
    industry: "ROBOTICS_AUTOMATION", display_name: "機器人／自動化", priority_observation_basis: "us_market_closed_asia_positive_leader_top3", priority_observation_rank: 1,
    priority_overseas_leaders: [{ rank: 1, symbol: "6861.T", percent: 1.18, source_time: "2026-09-08T00:05:07Z" }],
    mapped_symbols_a: [{ symbol: "2049", name: "上銀", tier: "A" }], mapped_symbols_b: [{ symbol: "2308", name: "台達電", tier: "B" }],
    mapped_symbols: [{ symbol: "2049", name: "上銀", tier: "A" }, { symbol: "2308", name: "台達電", tier: "B" }],
    bias: "positive", confidence: 0.8, evidence_summary: "fixture", allowed_action: "boost_scan_priority_only", forbidden_action: "publish_formal_candidate_without_taiwan_evidence",
  };
  const bridge = { contract: "opening-report-0830-priority-bias-bridge-v1", ok: true, received: true, source: SOURCE, mode: MODE, status: "priority_scan", reason_code: REASON, forbidden_publish_guard: true, formal_candidate_count: 0, formal_candidate_allowed: false, publish_allowed: false, opening_report_status_unchanged: true, run_id: payload.run_id, validation: { ok: true }, rejected_symbols: [] };
  const db = { symbol: "2049", market: "TW", priority_reason: REASON, source: SOURCE, payload: { openingReport0830IndustryBias: { date: payload.date, report_time: "08:30", run_id: payload.run_id, source: SOURCE, mode: MODE, industry: payload.industry, linked_industries: [payload.industry], priority_observation_basis: payload.priority_observation_basis, priority_observation_rank: 1, priority_overseas_leaders: payload.priority_overseas_leaders, boost_once: true, reason_code: REASON, status: "watchlist_boosted", formal_candidate: false, formal_candidate_allowed: false, forbidden_publish_guard: true } } };
  const assertions = { payload: validatePayload(payload, payload.date, reportRunId).length === 0, bridge: validateBridge(bridge, payload).length === 0, db: validateDbRow(db, payload).length === 0, gap_isolated: validateDbRow(null, payload)[0] === "db_row_missing" };
  return { ok: Object.values(assertions).every(Boolean), contract: `${CONTRACT}-fixture`, fixture: true, writes_supabase: false, sends_line: false, assertions };
}

async function main() {
  if (process.argv.includes("--fixture")) {
    const result = fixture();
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
  }
  const tradeDate = arg("trade-date", taipeiDate());
  const reportRunId = arg("report-run-id");
  const ymd = compact(tradeDate);
  const output = path.resolve(arg("output", path.join(RECEIPT_DIR, `opening-report-0830-mother-pool-field-ack-${ymd}.json`)));
  const aggregatePath = path.resolve(arg("bridge-aggregate", path.join(REPORT_DIR, `opening-report-0830-bridge-aggregate-${ymd}.json`)));
  const aggregate = readJson(aggregatePath);
  const missingFields = [];
  if (!reportRunId) missingFields.push("report_run_id_missing");
  if (!aggregate) missingFields.push("bridge_aggregate_missing");
  if (aggregate?.run_id !== reportRunId) missingFields.push("bridge_aggregate_run_id_mismatch");
  if (aggregate?.status !== "BRIDGE_OK") missingFields.push("bridge_aggregate_not_ok");

  const files = fs.existsSync(STATE_DIR) ? fs.readdirSync(STATE_DIR).filter((name) => /^opening_report_0830\.industry_bias\..+\.json$/.test(name)) : [];
  const payloads = files.map((name) => readJson(path.join(STATE_DIR, name))).filter((row) => row?.date === tradeDate && Number(row?.priority_observation_rank) >= 1 && Number(row?.priority_observation_rank) <= 3 && String(row?.run_id || "").startsWith(`${reportRunId}-`));
  const expectedBySymbol = new Map();
  const accepted = new Set();
  const rejected = [];
  for (const payload of payloads) {
    for (const issue of validatePayload(payload, tradeDate, reportRunId)) missingFields.push(`${payload.industry}:${issue}`);
    const bridgePath = path.join(RECEIPT_DIR, `opening-report-0830-priority-bias-bridge-${payload.industry}-${ymd}.json`);
    const bridge = readJson(bridgePath);
    for (const issue of validateBridge(bridge, payload)) missingFields.push(`${payload.industry}:${issue}`);
    for (const value of Array.isArray(bridge?.accepted_symbols) ? bridge.accepted_symbols : []) accepted.add(String(value));
    for (const value of Array.isArray(bridge?.rejected_symbols) ? bridge.rejected_symbols : []) rejected.push(value);
    for (const value of Array.isArray(payload.mapped_symbols) ? payload.mapped_symbols : []) {
      const code = symbol(value);
      if (code) expectedBySymbol.set(code, payload);
    }
  }
  if (payloads.length !== Number(aggregate?.industry_count || 0)) missingFields.push("received_industry_count_mismatch");

  const key = process.env.SUPABASE_ANON_KEY || process.env.FUMAN_SUPABASE_ANON_KEY || readSecret("supabase-anon-key.txt");
  let rows = [];
  let readbackError = "";
  try {
    if (!key) throw new Error("supabase_anon_key_missing");
    const symbols = [...expectedBySymbol.keys()];
    if (symbols.length) rows = await request(`fugle_daytrade_priority_pool?select=symbol,name,market,priority_rank,priority_reason,source,updated_at,payload&symbol=in.(${symbols.join(",")})&order=symbol.asc`, key);
  } catch (error) {
    readbackError = error.message || String(error);
    missingFields.push(readbackError);
  }
  const rowBySymbol = new Map(rows.map((row) => [String(row.symbol), row]));
  for (const [code, payload] of expectedBySymbol) {
    if (!accepted.has(code)) missingFields.push(`${code}:not_in_bridge_accepted_symbols`);
    for (const issue of validateDbRow(rowBySymbol.get(code), payload)) missingFields.push(`${code}:${issue}`);
  }
  const uniqueMissing = [...new Set(missingFields)];
  const complete = uniqueMissing.length === 0 && rejected.length === 0 && rows.length === expectedBySymbol.size;
  const receipt = {
    contract: CONTRACT,
    status: complete ? "complete" : "failed",
    complete,
    ok: complete,
    trade_date: tradeDate,
    report_run_id: reportRunId,
    priority_observation_mode: aggregate?.priority_observation_mode || "",
    received_industries: payloads.length,
    received_symbols: expectedBySymbol.size,
    accepted_symbols: [...accepted].sort(),
    rejected_symbols: rejected,
    db_readback_symbols: [...rowBySymbol.keys()].sort(),
    missing_fields: uniqueMissing,
    db_readback_ok: !readbackError && rows.length === expectedBySymbol.size,
    formal_candidate_count: 0,
    formal_candidate_allowed: false,
    forbidden_publish_guard: true,
    first_blocker: complete ? null : (uniqueMissing[0] || "rejected_symbols_present"),
    exitCode: complete ? 0 : 1,
    credential_role: "anon_read_only",
    checked_at: new Date().toISOString(),
    receipt_path: output,
  };
  writeJson(output, receipt);
  console.log(JSON.stringify(receipt, null, 2));
  if (!complete) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});

module.exports = { validatePayload, validateBridge, validateDbRow, fixture };
