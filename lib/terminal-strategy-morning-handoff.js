"use strict";

const path = require("path");
const { isTwseTradingDay, dateKey, taipeiDateParts } = require("../scripts/twse-trading-day");

// A03's approved union has one canonical buy/sell source: the institutional
// (買賣超) run.  Do not register a second synthetic `buy_sell` key; it would
// force a permanently blocked handoff despite the real institution producer.
const STRATEGIES = new Set(["strategy2", "strategy3", "strategy4", "strategy5", "institution", "ranking"]);
// A03 source registry is executable metadata, not documentation-only.  Every
// entry must either name a real producer/read path or remain explicitly
// blocked; Strategy1 is deliberately absent and can never enter the union.
const SOURCE_REGISTRY = Object.freeze({
  strategy2: { producer: "strategy2_scan_runs/strategy2_scan_results", contract: "strategy2-live-v3", mode: "run_results" },
  strategy3: { producer: "v_strategy3_v2_latest_complete_run/strategy3_v2_scan_results", contract: "strategy3-v2", mode: "run_results" },
  strategy4: { producer: "strategy4_scan_runs/strategy4_scan_results", contract: "strategy4", mode: "run_results" },
  strategy5: { producer: "v_strategy5_latest_complete_run/strategy5_scan_results", contract: "strategy5", mode: "run_results" },
  institution: { producer: "v_institution_latest_complete_run/institution_scan_results", contract: "institution", mode: "run_results" },
  ranking: { producer: "turnover_receipt", contract: "daytrade_intraday_turnover_verifier_v1", mode: "run_receipt", canonical_source: "fugle_daytrade_source" },
});
const compact = (value) => String(value || "").replace(/\D/g, "").slice(0, 8);
const iso = (value) => { const d = compact(value); return /^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : ""; };
const todayTaipei = (now) => dateKey(taipeiDateParts(now));

async function previousCompletedTradingDate(executionDate, stateDir) {
  const base = new Date(`${executionDate}T12:00:00+08:00`);
  for (let offset = 1; offset <= 14; offset += 1) {
    const status = await isTwseTradingDay(new Date(base.getTime() - offset * 86400000), { stateDir }).catch(() => null);
    if (status?.isTradingDay === true) return status.date || todayTaipei(new Date(base.getTime() - offset * 86400000));
  }
  return "";
}

function sourceFields(receipt = {}) {
  return {
    sourceDate: iso(receipt.sourceDate || receipt.source_date || receipt.tradeDate || receipt.trade_date || receipt.scanDate || receipt.scan_date || receipt.expectedDate),
    runId: String(receipt.runId || receipt.run_id || receipt.sourceRunId || receipt.source_run_id || receipt.published?.runId || ""),
    canonical: String(receipt.canonical_run_id || receipt.canonicalRunId || receipt.source_canonical_run_id || receipt.sourceCanonicalRunId || ""),
    version: String(receipt.strategy_version || receipt.strategyVersion || receipt.schema_version || receipt.schemaVersion || receipt.contract_version || receipt.contractVersion || receipt.published?.strategy_version || ""),
    complete: receipt.complete === true || receipt.status === "complete" || receipt.published?.complete === true,
    checkedAt: Date.parse(receipt.checked_at || receipt.checkedAt || receipt.finishedAt || receipt.finished_at || receipt.published?.checked_at || ""),
  };
}

async function resolveStrategyHandoff({ strategyId, sourceReceipt, executionDate, now = new Date(), stateDir } = {}) {
  const strategy = String(strategyId || "").trim().toLowerCase();
  const execution = iso(executionDate) || todayTaipei(now);
  const failures = [];
  if (!STRATEGIES.has(strategy)) failures.push("UNKNOWN_STRATEGY");
  const calendar = await isTwseTradingDay(new Date(`${execution}T12:00:00+08:00`), { stateDir }).catch(() => null);
  const expectedSource = calendar?.isTradingDay === true ? await previousCompletedTradingDate(execution, stateDir) : await previousCompletedTradingDate(execution, stateDir);
  const source = sourceFields(sourceReceipt);
  if (!sourceReceipt || typeof sourceReceipt !== "object") failures.push("SOURCE_NOT_READY");
  if (!source.sourceDate) failures.push("SOURCE_NOT_READY");
  else if (source.sourceDate !== expectedSource) failures.push("SOURCE_DATE_MISMATCH");
  if (!source.complete) failures.push("SOURCE_NOT_READY");
  if (!source.runId) failures.push("SOURCE_RUN_MISSING");
  if (!source.version) failures.push("SOURCE_STRATEGY_VERSION_MISSING");
  const expectedCanonical = `${SOURCE_REGISTRY[strategy]?.canonical_source || strategy}:${compact(source.sourceDate)}:canonical`;
  if (source.canonical && source.canonical !== expectedCanonical) failures.push("SOURCE_CANONICAL_MISMATCH");
  if (!Number.isFinite(source.checkedAt)) failures.push("SOURCE_TIMESTAMP_MISSING");
  else if (source.checkedAt > now.getTime()) failures.push("SOURCE_TIMESTAMP_IN_FUTURE");
  else if ((now.getTime() - source.checkedAt) > Number(process.env.TERMINAL_HANDOFF_MAX_AGE_DAYS || 3) * 86400000) failures.push("STALE_SOURCE");
  if (calendar?.isTradingDay !== true) failures.push("MARKET_CLOSED");
  const sourceVersion = source.version || `${strategy}:unknown`;
  return {
    contract: "terminal_strategy_morning_handoff_v1",
    strategy_id: strategy,
    ok: failures.length === 0,
    status: failures.length === 0 ? "READY" : "BLOCKED",
    reason_code: failures[0] || null,
    failed_checks: [...new Set(failures)],
    strategy_source_date: source.sourceDate || null,
    handoff_trade_date: execution,
    handoff_run_id: `morning-handoff:${compact(execution)}:${strategy}:${source.runId || "missing"}`,
    source_run_id: source.runId || null,
    source_strategy_version: sourceVersion,
    source_canonical_run_id: source.canonical || expectedCanonical,
    previous_completed_trade_date: expectedSource || null,
    source_checked_at: Number.isFinite(source.checkedAt) ? new Date(source.checkedAt).toISOString() : null,
    checked_at: now.toISOString(),
    calendar: calendar || null,
  };
}

async function buildTerminalStrategyHandoffs({ receipts = {}, executionDate, now = new Date(), stateDir } = {}) {
  const results = {};
  for (const strategy of STRATEGIES) results[strategy] = await resolveStrategyHandoff({ strategyId: strategy, sourceReceipt: receipts[strategy], executionDate, now, stateDir });
  const ready = Object.values(results).filter((item) => item.ok).map((item) => item.strategy_id);
  return { contract: "terminal_strategy_morning_handoff_v1", execution_trade_date: iso(executionDate) || todayTaipei(now), source_registry: SOURCE_REGISTRY, strategies: results, ready_strategies: ready, complete: ready.length > 0 && Object.values(results).every((item) => item.ok || item.reason_code === "SOURCE_NOT_READY"), first_blocker: Object.values(results).find((item) => !item.ok)?.reason_code || null };
}

module.exports = { STRATEGIES: [...STRATEGIES], SOURCE_REGISTRY, sourceFields, resolveStrategyHandoff, buildTerminalStrategyHandoffs, previousCompletedTradingDate };
