"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const bridge = require("./apply-opening-report-mother-pool-bridge.js");
const runner = fs.readFileSync(path.join(__dirname, "run-opening-report-0830-production.js"), "utf8");

function argValue(name, fallback = "") {
  const prefix = `${name}=`;
  const match = process.argv.find((value) => value.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

function taipeiDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date());
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value), "utf8");
}

function fixtureIndustry(tradeDate, rank, overrides = {}) {
  return {
    trade_date: tradeDate,
    date: tradeDate,
    run_id: `opening-report-0830-${tradeDate.replace(/\D/g, "")}-fixture`,
    report_time: "08:30",
    source: "opening_report_0830",
    mode: "priority_bias_only",
    industry: `industry_${rank}`,
    bias: rank <= 4 ? "positive" : "neutral",
    direction: rank <= 4 ? "positive" : "neutral",
    rank,
    overseas_return_1d_pct: rank <= 4 ? 10 - rank : 0,
    overseas_return_2d_pct: rank <= 4 ? 12 - rank : 0,
    mapped_symbols: [String(2300 + rank), rank === 2 ? "2301" : String(2400 + rank)],
    mapped_a_symbols: [],
    mapped_b_symbols: [],
    evidence_summary: "fixture evidence",
    confidence: 0.8,
    allowed_action: "boost_scan_priority_only",
    forbidden_action: "publish_formal_candidate_without_taiwan_evidence",
    ...overrides,
  };
}

function selfTest() {
  const tradeDate = "2026-09-02";
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "opening-report-top3-"));
  const stateDir = path.join(root, "state");
  const outputDir = path.join(root, "output");
  const priorityFile = path.join(root, "priority.json");
  fs.mkdirSync(stateDir, { recursive: true });
  for (let rank = 1; rank <= 19; rank += 1) {
    writeJson(path.join(stateDir, `opening_report_0830.industry_bias.industry_${rank}.json`), fixtureIndustry(tradeDate, rank));
  }
  const result = bridge.applyBridge({ tradeDate, stateDir, outputDir, priorityFile });
  const priority = JSON.parse(fs.readFileSync(priorityFile, "utf8"));
  const receipt = result.receipt;
  const duplicate = receipt.applied_boosts.find((row) => row.symbol === "2301");
  const checks = {
    receipt_ok: receipt.ok === true,
    exactly_top3: receipt.accepted_industry_count === 3,
    rank4_rejected: receipt.accepted_industries.every((row) => row.rank <= 3),
    positive_only: receipt.accepted_industries.every((row) => Number(row.overseas_return_1d_pct) > 0),
    duplicate_boost_once: duplicate?.boost_once === true && duplicate.linked_industries.length === 2,
    score_mapping: receipt.applied_boosts.some((row) => row.highest_industry_rank === 1 && row.entry_score_boost === 20)
      && receipt.applied_boosts.some((row) => row.highest_industry_rank === 3 && row.entry_score_boost === 12),
    queues_populated: [
      priority.openingReport0830QuoteRefreshSymbols,
      priority.openingReport0830CandlePrioritySymbols,
      priority.openingReport0830MaWarmupSymbols,
      priority.openingReport0830PriorityHotSymbols,
      priority.openingReport0830DeepScanSymbols,
    ].every((values) => Array.isArray(values) && values.length === receipt.accepted_symbol_count),
    formal_guard: receipt.formal_candidate_count === 0 && receipt.formal_candidate_allowed === false
      && receipt.publish_allowed === false && receipt.forbidden_publish_guard === true,
    report_status_isolated: receipt.opening_report_status_unchanged === true,
    runner_calls_after_state_write: runner.indexOf("const motherPoolTop3Bridge = applyBridge") > runner.indexOf("writeJson(inputPath, item)"),
    runner_success_does_not_depend_on_top3_bridge: runner.includes("ok: overseasPreflight.ok && Boolean(reportPath) && (!sendLine || lineReceipt.line_push_ok)")
      && !runner.includes("ok: motherPoolTop3Bridge"),
  };
  const failed_checks = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
  return { ok: failed_checks.length === 0, contract: bridge.constants.CONTRACT, checks, failed_checks, first_blocker: failed_checks[0] || null };
}

function verifyRuntime(tradeDate) {
  const compact = tradeDate.replace(/\D/g, "");
  const receiptPath = path.join(process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime", "data", "opening-report-0830", `opening-report-0830-mother-pool-bridge-${compact}.json`);
  let receipt = null;
  try { receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8")); } catch {}
  const checks = {
    receipt_exists: Boolean(receipt),
    receipt_contract: receipt?.contract === bridge.constants.CONTRACT,
    same_trade_date: receipt?.trade_date === tradeDate,
    exactly_top3: receipt?.accepted_industry_count === 3,
    boost_once: Array.isArray(receipt?.applied_boosts) && receipt.applied_boosts.every((row) => row.boost_once === true),
    queues_populated: ["quote_refresh", "candle_priority", "ma_warmup", "priority_hot", "deep_scan"]
      .every((key) => Array.isArray(receipt?.queue_readback?.[key]) && receipt.queue_readback[key].length === receipt.accepted_symbol_count),
    formal_guard: receipt?.formal_candidate_count === 0 && receipt?.formal_candidate_allowed === false
      && receipt?.publish_allowed === false && receipt?.forbidden_publish_guard === true,
    report_status_isolated: receipt?.opening_report_status_unchanged === true,
  };
  const failed_checks = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
  return { ok: failed_checks.length === 0, contract: bridge.constants.CONTRACT, trade_date: tradeDate, receipt_path: receiptPath, checks, receipt, failed_checks, first_blocker: failed_checks[0] || null, read_only: true };
}

const selfTestMode = process.argv.includes("--self-test");
const output = selfTestMode ? selfTest() : verifyRuntime(argValue("--trade-date", taipeiDate()));
console.log(JSON.stringify(output, null, 2));
if (!output.ok) process.exitCode = 1;
