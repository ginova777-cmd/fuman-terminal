"use strict";

const fs = require("fs");
const path = require("path");

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime";
const STATE_DIR = path.join(RUNTIME_DIR, "state");
const OUTPUT_DIR = path.join(RUNTIME_DIR, "data", "opening-report-0830");
const PRIORITY_FILE = process.env.FUGLE_DAYTRADE_PRIORITY_SYMBOLS_FILE
  || path.join(RUNTIME_DIR, "cache", "intraday", "fugle-daytrade-ws-priority-symbols.json");
const CONTRACT = "opening_report_0830_mother_pool_top3_bridge_v1";
const ALLOWED_ACTION = "boost_scan_priority_only";
const FORBIDDEN_ACTION = "publish_formal_candidate_without_taiwan_evidence";
const BOOSTS = new Map([[1, 20], [2, 16], [3, 12]]);

function argValue(name, fallback = "") {
  const prefix = `${name}=`;
  const match = process.argv.find((value) => value.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

function taipeiDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(now);
}

function compactDate(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 8);
}

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function normalizeSymbol(value) {
  const symbol = String(value?.symbol || value?.code || value || "").trim();
  return /^\d{4}$/.test(symbol) ? symbol : "";
}

function inputDate(payload) {
  return String(payload?.trade_date || payload?.date || "").slice(0, 10);
}

function validateInput(payload, tradeDate) {
  const failures = [];
  if (!payload || typeof payload !== "object") return ["industry_bias_json_missing_or_invalid"];
  if (inputDate(payload) !== tradeDate) failures.push("trade_date_mismatch");
  if (!/^08:30(?:$|[:+T\s])/.test(String(payload.report_time || ""))) failures.push("report_time_not_0830");
  if (!String(payload.run_id || "").trim()) failures.push("run_id_missing");
  if (payload.source !== "opening_report_0830") failures.push("source_mismatch");
  if (payload.mode !== "priority_bias_only") failures.push("mode_mismatch");
  if (!String(payload.industry || "").trim()) failures.push("industry_missing");
  if (!String(payload.bias || "").trim()) failures.push("bias_missing");
  if (!String(payload.direction || payload.bias || "").trim()) failures.push("direction_missing");
  const rank = Number(payload.rank);
  if (!Number.isInteger(rank) || rank < 1) failures.push("rank_invalid");
  if (!String(payload.evidence_summary || "").trim()) failures.push("evidence_summary_missing");
  if (!Array.isArray(payload.mapped_symbols) || payload.mapped_symbols.length === 0) failures.push("mapped_symbols_missing");
  const confidence = Number(payload.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) failures.push("confidence_invalid");
  if (payload.allowed_action !== ALLOWED_ACTION) failures.push("allowed_action_mismatch");
  if (payload.forbidden_action !== FORBIDDEN_ACTION) failures.push("forbidden_action_missing_or_mismatch");
  const return1d = Number(payload.overseas_return_1d_pct);
  if (!Number.isFinite(return1d)) failures.push("overseas_return_1d_pct_invalid");
  const return2d = Number(payload.overseas_return_2d_pct);
  if (!Number.isFinite(return2d)) failures.push("overseas_return_2d_pct_invalid");
  return failures;
}

function selectTop3(inputs) {
  return [...inputs]
    .filter(({ payload }) => ["positive", "strong"].includes(String(payload.bias || "").toLowerCase())
      && ["positive", "strong"].includes(String(payload.direction || payload.bias || "").toLowerCase())
      && Number(payload.overseas_return_1d_pct) > 0)
    .sort((a, b) => Number(b.payload.overseas_return_1d_pct) - Number(a.payload.overseas_return_1d_pct))
    .slice(0, 3)
    .map((entry, index) => ({ ...entry, bridgeRank: index + 1 }));
}

function buildBoosts(top3) {
  const bySymbol = new Map();
  for (const entry of top3) {
    for (const value of entry.payload.mapped_symbols) {
      const symbol = normalizeSymbol(value);
      if (!symbol) continue;
      const current = bySymbol.get(symbol) || {
        symbol,
        boost_applied: true,
        boost_once: true,
        linked_industries: [],
        highest_industry_rank: entry.bridgeRank,
        entry_score_boost: BOOSTS.get(entry.bridgeRank),
        upgrade_score_boost: BOOSTS.get(entry.bridgeRank),
        priority_scan_score_boost: BOOSTS.get(entry.bridgeRank),
        reasons: [],
      };
      if (!current.linked_industries.includes(entry.payload.industry)) current.linked_industries.push(entry.payload.industry);
      current.highest_industry_rank = Math.min(current.highest_industry_rank, entry.bridgeRank);
      const score = BOOSTS.get(current.highest_industry_rank);
      current.entry_score_boost = score;
      current.upgrade_score_boost = score;
      current.priority_scan_score_boost = score;
      current.reasons = [
        "opening_report_0830_top3_industry_bias",
        "opening_report_0830_positive_industry_rank",
        "opening_report_0830_mapped_symbol_boost",
      ];
      bySymbol.set(symbol, current);
    }
  }
  return [...bySymbol.values()];
}

function failReceipt(tradeDate, receiptPath, failures) {
  const receipt = {
    contract: CONTRACT,
    ok: false,
    status: "FAIL_CLOSED",
    trade_date: tradeDate,
    first_blocker: failures[0] || "industry_bias_json_missing_or_invalid",
    failures,
    accepted_industry_count: 0,
    accepted_symbol_count: 0,
    accepted_industries: [],
    accepted_symbols: [],
    rejected_industries: [],
    applied_boosts: [],
    formal_candidate_count: 0,
    formal_candidate_allowed: false,
    publish_allowed: false,
    forbidden_publish_guard: true,
    allowed_action: "wait_for_opening_report_then_retry_bridge",
    forbidden_action: FORBIDDEN_ACTION,
    opening_report_status_unchanged: true,
    checked_at: new Date().toISOString(),
  };
  writeJson(receiptPath, receipt);
  return receipt;
}

function applyBridge({ tradeDate, stateDir = STATE_DIR, outputDir = OUTPUT_DIR, priorityFile = PRIORITY_FILE, require19 = true }) {
  const compact = compactDate(tradeDate);
  const receiptPath = path.join(outputDir, `opening-report-0830-mother-pool-bridge-${compact}.json`);
  let files = [];
  try { files = fs.readdirSync(stateDir).filter((name) => /^opening_report_0830\.industry_bias\..+\.json$/i.test(name)); } catch {}
  const inputs = files.map((name) => ({ file: path.join(stateDir, name), payload: readJson(path.join(stateDir, name)) }));
  const failures = [];
  if (require19 && inputs.length !== 19) failures.push(`industry_bias_files_not_19:${inputs.length}`);
  for (const entry of inputs) failures.push(...validateInput(entry.payload, tradeDate).map((reason) => `${path.basename(entry.file)}:${reason}`));
  const runIds = [...new Set(inputs.map(({ payload }) => String(payload?.run_id || "")).filter(Boolean))];
  if (runIds.length !== 1) failures.push("run_id_mismatch");
  if (failures.length) return { receiptPath, receipt: failReceipt(tradeDate, receiptPath, failures) };

  const top3 = selectTop3(inputs);
  if (top3.length !== 3) return { receiptPath, receipt: failReceipt(tradeDate, receiptPath, ["top3_positive_industries_unavailable"]) };
  const boosts = buildBoosts(top3);
  if (!boosts.length) return { receiptPath, receipt: failReceipt(tradeDate, receiptPath, ["top3_mapped_symbols_empty"]) };
  const acceptedSymbols = boosts.map((row) => row.symbol);
  const existing = readJson(priorityFile, {});
  const sameDate = String(existing.tradeDate || existing.trade_date || "").slice(0, 10) === tradeDate;
  const base = sameDate ? existing : {};
  const mergeSymbols = (values) => [...new Set([...(Array.isArray(values) ? values : []), ...acceptedSymbols].map(normalizeSymbol).filter(Boolean))];
  const next = {
    ...base,
    tradeDate,
    openingReport0830Top3RunId: runIds[0],
    openingReport0830Top3Symbols: acceptedSymbols,
    openingReport0830QuoteRefreshSymbols: mergeSymbols(base.openingReport0830QuoteRefreshSymbols),
    openingReport0830CandlePrioritySymbols: mergeSymbols(base.openingReport0830CandlePrioritySymbols),
    openingReport0830MaWarmupSymbols: mergeSymbols(base.openingReport0830MaWarmupSymbols),
    openingReport0830PriorityHotSymbols: mergeSymbols(base.openingReport0830PriorityHotSymbols),
    openingReport0830DeepScanSymbols: mergeSymbols(base.openingReport0830DeepScanSymbols),
    openingReport0830Boosts: boosts,
    openingReport0830UpdatedAt: new Date().toISOString(),
  };
  writeJson(priorityFile, next);
  const rejectedIndustries = inputs
    .filter((entry) => !top3.includes(entry))
    .map(({ payload }) => ({ industry: payload.industry, reason: "not_positive_top3", overseas_return_1d_pct: payload.overseas_return_1d_pct }));
  const receipt = {
    contract: CONTRACT,
    ok: true,
    status: "priority_scan",
    trade_date: tradeDate,
    run_id: runIds[0],
    source: "opening_report_0830",
    bridge_mode: "priority_bias_only",
    accepted_industry_count: top3.length,
    accepted_symbol_count: acceptedSymbols.length,
    accepted_industries: top3.map(({ payload, bridgeRank }) => ({ industry: payload.industry, rank: bridgeRank, overseas_return_1d_pct: payload.overseas_return_1d_pct })),
    accepted_symbols: acceptedSymbols,
    rejected_industries: rejectedIndustries,
    applied_boosts: boosts,
    queue_readback: {
      quote_refresh: acceptedSymbols,
      candle_priority: acceptedSymbols,
      ma_warmup: acceptedSymbols,
      priority_hot: acceptedSymbols,
      deep_scan: acceptedSymbols,
    },
    formal_candidate_count: 0,
    formal_candidate_allowed: false,
    publish_allowed: false,
    forbidden_publish_guard: true,
    allowed_action: ALLOWED_ACTION,
    forbidden_action: FORBIDDEN_ACTION,
    opening_report_status_unchanged: true,
    checked_at: new Date().toISOString(),
  };
  writeJson(receiptPath, receipt);
  return { receiptPath, receipt };
}

if (require.main === module) {
  const tradeDate = argValue("--trade-date", taipeiDate());
  const result = applyBridge({ tradeDate });
  console.log(JSON.stringify({ ...result.receipt, receipt_path: result.receiptPath }, null, 2));
  if (!result.receipt.ok) process.exitCode = 1;
}

module.exports = { applyBridge, validateInput, selectTop3, buildBoosts, constants: { CONTRACT, ALLOWED_ACTION, FORBIDDEN_ACTION } };

