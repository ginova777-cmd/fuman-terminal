"use strict";

const STRATEGIES = [
  ["策略1開盤入成績單", "2330", "台積電"],
  ["策略2成績單", "2317", "鴻海"],
  ["策略3隔日沖成績單", "2454", "聯發科"],
  ["策略4成績單", "2303", "聯電"],
  ["策略5成績單", "2881", "富邦金"],
  ["買賣超成績單", "2882", "國泰金"],
  ["權證成績單", "0050", "元大台灣50"],
  ["CB成績單", "2308", "台達電"],
  ["即時雷達成績單", "3034", "聯詠"],
];

function buildScorecardFixture() {
  const updatedAt = "2026-07-04T06:00:00.000Z";
  const records = STRATEGIES.map(([strategy, ticker, name], index) => ({
    record_id: `fixture-${index + 1}`,
    record_date: "2026-07-04",
    strategy,
    ticker,
    name,
    entry_time: strategy === "策略3隔日沖成績單" ? "13:00" : "09:30",
    entry_price: 100 + index,
    high_price: 105 + index,
    pnl: 5,
    reason: `fixture formal evidence ${strategy}`,
    rule_group: "fixture",
    rule_tags: ["fixture"],
  }));
  return {
    ok: true,
    source: "supabase:scorecard_snapshot",
    cacheSource: "supabase-snapshot",
    exportSource: "supabase:trade_records+strategy_daily_summary",
    updatedAt,
    latestDate: "2026-07-04",
    marketDate: "2026-07-04",
    qualityStatus: "complete",
    contract: "scorecard-resource-chain-v1",
    runId: "scorecard-20260704-fixture",
    source_snapshot_captured_at: updatedAt,
    days: 30,
    records,
    summary: {
      latestDate: "2026-07-04",
      rows: records.length,
      daily: STRATEGIES.map(([strategy]) => ({
        summary_date: "2026-07-04",
        strategy,
        signals: 1,
        status: "complete",
      })),
    },
  };
}

module.exports = {
  buildScorecardFixture,
};
