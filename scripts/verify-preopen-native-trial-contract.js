"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const CONTRACT = "preopen_native_trial_runner_verifier_receipt_v1";
const RECEIPT_FIELDS = [
  "symbol", "trade_date", "run_id", "capture_slot", "is_trial",
  "trial_price", "trial_price_source", "trial_event_at",
  "natural_schedule_evidence", "has_trial_price", "trial_change_pct",
  "data_gap_reason",
];

function taipeiParts(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return { tradeDate: `${get("year")}-${get("month")}-${get("day")}`, slot: `${get("hour")}${get("minute")}` };
}

function classify(input) {
  const time = taipeiParts(input.trial_event_at);
  const expectedRunId = `preopen_trial:${input.trade_date.replace(/-/g, "")}:canonical`;
  const valid = input.is_trial === true
    && Number(input.trial_price) > 0
    && input.trial_price_source === "fugle_native_trial"
    && time?.tradeDate === input.trade_date
    && time?.slot === input.capture_slot
    && ["0845", "0850"].includes(input.capture_slot)
    && input.natural_schedule_evidence === true
    && input.run_id === expectedRunId
    && input.close_fallback_used !== true
    && input.bid_ask_fallback_used !== true
    && input.post_0900_backfill_used !== true;
  const reference = Number(input.reference_price);
  return {
    ...Object.fromEntries(RECEIPT_FIELDS.map((field) => [field, input[field] ?? null])),
    has_trial_price: valid,
    trial_price: valid ? Number(input.trial_price) : null,
    trial_change_pct: valid && reference > 0 ? Number((((Number(input.trial_price) - reference) / reference) * 100).toFixed(6)) : null,
    data_gap_reason: valid ? null : "DATA_GAP_TRIAL",
    creates_order: false,
    creates_formal_candidate: false,
    publish_allowed: false,
  };
}

function main() {
  const tradeDate = "2026-09-10";
  const runId = "preopen_trial:20260910:canonical";
  const base = { trade_date: tradeDate, run_id: runId, capture_slot: "0850", is_trial: true, trial_price: 110, reference_price: 100, trial_price_source: "fugle_native_trial", trial_event_at: "2026-09-10T00:50:20.000Z", natural_schedule_evidence: true, close_fallback_used: false, bid_ask_fallback_used: false, post_0900_backfill_used: false };
  const cases = {
    A_native_trial: classify({ ...base, symbol: "2330" }),
    B_close_only: classify({ ...base, symbol: "2317", trial_price: null, quote_close: 110, is_trial: false, trial_price_source: null }),
    C_zero_trial: classify({ ...base, symbol: "2454", trial_price: 0 }),
    D_post_0900: classify({ ...base, symbol: "2303", trial_event_at: "2026-09-10T01:00:01.000Z", post_0900_backfill_used: true }),
    E_3406_replay: classify({ ...base, symbol: "3406", is_trial: false, trial_price_source: "quote.close", trial_event_at: null, natural_schedule_evidence: false }),
    E_6505_replay: classify({ ...base, symbol: "6505", is_trial: false, trial_price_source: "quote.close", trial_event_at: null, natural_schedule_evidence: false }),
  };
  const shared = fs.readFileSync(path.join(ROOT, "ops", "public-slot", "Run-PublicSlotSharedSource.ps1"), "utf8");
  const candidate = fs.readFileSync(path.join(ROOT, "scripts", "verify-opening-limit-order-candidate-readonly.js"), "utf8");
  const checks = {
    close_fallback_absent: !/trialPrice\s*-le\s*0\)\s*\{\s*\$trialPrice\s*=\s*Get-Number\s+\$quote\.close/i.test(shared),
    bid_ask_fallback_absent: !/trialPrice\s*=.*(?:best_bid|best_ask|bid_ask_mid)/i.test(shared),
    native_source_required: shared.includes('trial_price_source = if ($null -ne $trialPrice) { "fugle_native_trial" }'),
    explicit_is_trial_required: candidate.includes("payload.is_trial === true"),
    trial_event_slot_required: candidate.includes("eventSlot === captureSlot"),
    trade_date_and_run_id_match: candidate.includes("payload.run_id === expectedRunId"),
    receipt_schema_complete: RECEIPT_FIELDS.every((field) => Object.hasOwn(cases.A_native_trial, field)),
    case_A_accepted: cases.A_native_trial.has_trial_price === true && cases.A_native_trial.trial_change_pct === 10,
    case_B_rejected: cases.B_close_only.has_trial_price === false && cases.B_close_only.trial_price === null && cases.B_close_only.trial_change_pct === null,
    case_C_rejected: cases.C_zero_trial.has_trial_price === false,
    case_D_rejected: cases.D_post_0900.has_trial_price === false,
    case_E_3406_rejected: cases.E_3406_replay.data_gap_reason === "DATA_GAP_TRIAL",
    case_E_6505_rejected: cases.E_6505_replay.data_gap_reason === "DATA_GAP_TRIAL",
    safety_closed: Object.values(cases).every((row) => row.creates_order === false && row.creates_formal_candidate === false && row.publish_allowed === false),
  };
  const failedChecks = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
  const receipt = { contract: CONTRACT, status: failedChecks.length ? "failed" : "complete", complete: failedChecks.length === 0, failed_checks: failedChecks, first_blocker: failedChecks[0] || null, checks, cases, writes_runtime: false, rewrites_frozen_0850_receipt: false };
  console.log(JSON.stringify(receipt, null, 2));
  if (failedChecks.length) process.exitCode = 1;
}

main();
