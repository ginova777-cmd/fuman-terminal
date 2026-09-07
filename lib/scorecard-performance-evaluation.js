"use strict";

const CONTRACT = "scorecard-performance-evaluation-v1";

function number(value, fallback = 0) {
  if (value === null || value === undefined || String(value).trim() === "") return fallback;
  const parsed = Number(String(value ?? "").replace(/[,%+]/g, "").trim());
  return Number.isFinite(parsed) ? parsed : fallback;
}

function text(value) { return String(value ?? "").trim(); }
function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(number(value) * factor) / factor;
}
function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
function strategyRows(records) {
  const grouped = new Map();
  for (const row of Array.isArray(records) ? records : []) {
    const strategy = text(row.strategy) || "未分類";
    if (!grouped.has(strategy)) grouped.set(strategy, []);
    grouped.get(strategy).push(row);
  }
  return grouped;
}

function evaluateStrategy(strategy, rows) {
  const observations = rows.map((row) => {
    const entry = number(row.entry_price ?? row.entryPrice);
    const high = number(row.high_price ?? row.highPrice);
    const exit = number(row.exit_price ?? row.exitPrice, NaN);
    const gross = Number.isFinite(exit) && entry > 0 ? ((exit - entry) / entry) * 100 : NaN;
    const explicitNet = number(row.net_return_pct ?? row.netReturnPct, NaN);
    const costs = number(row.total_cost_pct ?? row.totalCostPct, NaN);
    const net = Number.isFinite(explicitNet) ? explicitNet : Number.isFinite(gross) && Number.isFinite(costs) ? gross - costs : NaN;
    return {
      entry,
      high,
      mfePct: entry > 0 && high > 0 ? ((high - entry) / entry) * 100 : NaN,
      exit,
      gross,
      net,
      hasTracking: entry > 0 && high > 0,
      hasRealized: entry > 0 && Number.isFinite(exit) && exit > 0 && Number.isFinite(net),
    };
  });
  const tracking = observations.filter((row) => row.hasTracking);
  const realized = observations.filter((row) => row.hasRealized);
  const mfe = tracking.map((row) => row.mfePct);
  const net = realized.map((row) => row.net);
  const wins = mfe.filter((value) => value > 0).length;
  const losses = mfe.filter((value) => value < 0).length;
  const realizedWins = net.filter((value) => value > 0).length;
  const realizedLosses = net.filter((value) => value < 0).length;
  const grossProfit = net.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const grossLoss = Math.abs(net.filter((value) => value < 0).reduce((sum, value) => sum + value, 0));
  return {
    strategy,
    status: realized.length === rows.length && rows.length > 0 ? "COMPLETE" : "NOT_EVALUABLE",
    statusReason: realized.length === rows.length && rows.length > 0
      ? "all_rows_have_exit_price_and_net_cost_evidence"
      : "missing_exit_price_or_cost_evidence; MFE is tracking evidence, not realized profit",
    samples: rows.length,
    trackingSamples: tracking.length,
    realizedSamples: realized.length,
    tracking: {
      metric: "MFE_PROXY",
      wins,
      losses,
      flats: Math.max(0, tracking.length - wins - losses),
      positiveRatePct: tracking.length ? round((wins / tracking.length) * 100, 2) : 0,
      averageMfePct: tracking.length ? round(mfe.reduce((sum, value) => sum + value, 0) / tracking.length, 4) : 0,
      medianMfePct: round(median(mfe), 4),
      bestMfePct: tracking.length ? round(Math.max(...mfe), 4) : 0,
    },
    backtest: {
      metric: "REALIZED_NET_RETURN",
      wins: realizedWins,
      losses: realizedLosses,
      winRatePct: realized.length ? round((realizedWins / realized.length) * 100, 2) : 0,
      averageNetReturnPct: realized.length ? round(net.reduce((sum, value) => sum + value, 0) / realized.length, 4) : null,
      profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss, 4) : (grossProfit > 0 ? null : 0),
    },
  };
}

function buildScorecardPerformanceEvaluation(records, options = {}) {
  const rows = Array.isArray(records) ? records : [];
  const byStrategy = [...strategyRows(rows).entries()]
    .map(([strategy, items]) => evaluateStrategy(strategy, items))
    .sort((a, b) => a.strategy.localeCompare(b.strategy, "zh-Hant"));
  const allComplete = byStrategy.length > 0 && byStrategy.every((item) => item.status === "COMPLETE");
  return {
    contract: CONTRACT,
    status: allComplete ? "COMPLETE" : "PARTIAL",
    selectedDate: text(options.selectedDate),
    scope: text(options.scope || "calendar_month_scorecard_records"),
    methodology: {
      tracking: "entry_price to observed high_price; Maximum Favorable Excursion proxy only",
      backtest: "requires exit_price and net cost evidence for every evaluated row",
      warning: "high_price and pnl are not realized exit performance",
    },
    strategyCount: byStrategy.length,
    samples: rows.length,
    completeStrategies: byStrategy.filter((item) => item.status === "COMPLETE").length,
    notEvaluableStrategies: byStrategy.filter((item) => item.status !== "COMPLETE").length,
    byStrategy,
    generatedAt: new Date().toISOString(),
  };
}

module.exports = { CONTRACT, buildScorecardPerformanceEvaluation, evaluateStrategy };
