"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "run-daytrade-source-writer.js"), "utf8");
const start = source.indexOf("function writeIntradayBurstTelegramOutbox(");
const end = source.indexOf("\nfunction ", start + 1);
assert.ok(start > 0 && end > start);
const date = "2026-09-16", canonical = "fugle_daytrade_source:20260916:canonical", at = "2026-09-16T02:00:00Z";
let previous, written;
const context = { Map, Set, Date, Number, String, Math, Boolean,
  INTRADAY_BURST_TELEGRAM_OUTBOX_FILE: "outbox", INDUSTRY_SIGNAL_FAST_INJECT_FILE: "discovery",
  DRY_RUN: false, WINDOW_SECONDS: 120, MOTHER_POOL_MIN_PRICE: 50, FORMAL_SIGNAL_MIN_TRADE_VALUE: 100,
  canonicalDaytradeRunId: () => canonical,
  taipeiClockMinutesFrom: value => { const d = new Date(Date.parse(value) + 28800000); return d.getUTCHours() * 60 + d.getUTCMinutes(); },
  taipeiDateFrom: value => new Date(Date.parse(value) + 28800000).toISOString().slice(0, 10),
  readJson: () => previous, writeJson: (file, value) => { assert.equal(file, "discovery"); written = value; },
  buildIntradayBurstCandleCacheBySymbol: () => new Map(), readHeatmapStaticGroupMap: () => new Map(), readMopsOfficialIndustryCacheMap: () => new Map(),
  normalizeCode: value => String(value), numberValue: value => Number(value) || 0,
  quoteFreshnessTime: quote => quote.quote_seen_at,
  intradayIndustryClassification: row => ({ industry: row.industry, classificationStatus: "ready" }),
  finalizeIntradayIndustryHeatmap: map => [...map.values()].map((r, i) => ({ ...r, flow_rank: i + 1, net_flow_proxy: r.up_trade_value - r.down_trade_value,
    average_change_percent: r.change_percent_sum / r.symbol_count, breadth_percent: 100, flow_direction: "inflow",
    volume_expansion_symbol_count: r.volume_expansion_count, volume_expansion_ratio_percent: 100 })) };
vm.createContext(context);
vm.runInContext(source.slice(start, end) + "\nthis.discover = writeIntradayBurstTelegramOutbox;", context);
const rows = Array.from({ length: 62 }, (_, i) => ({ symbol: String(1000 + i), industry: "test", metrics: { price: 100, previousClose: 90, changePercent: 10, tradeValue: 10000000, volumeRatio5: 2, quoteFresh: true } }));
const quotes = new Map(rows.map(r => [r.symbol, { quote_seen_at: at, trade_value: 10000000, total_volume: 100 }]));
previous = { trade_date: date, run_id: canonical, updated_at: "2026-09-16T01:59:00Z", industry_heatmap: [{ industry: "test", net_flow_proxy: 1, average_change_percent: 9 }] };
const run = () => context.discover([], date, at, canonical, quotes, rows, true);
const good = run();
assert.equal(good.injection_count, 60);
assert.equal(good.truncated_count, 2);
assert.equal(good.candidate_count, 62);
assert.equal(good.canonical_run_id, canonical);
assert.equal(good.formal_candidate_allowed, false);
quotes.get("1000").quote_seen_at = "2026-09-16T01:00:00Z";
quotes.get("1001").trade_value = null;
quotes.get("1002").quote_seen_at = "2026-09-16T02:01:00Z";
const gaps = run();
assert.equal(gaps.accepted_source_count, 59);
assert.equal(gaps.source_rejected.length, 3);
assert.equal(gaps.source_rejected.find(r => r.symbol === "1001").reason, "source_trade_value_missing", "must not infer turnover from untyped volume or stale metrics");
previous.trade_date = "2026-09-15";
assert.equal(run().injection_count, 0, "cross-day baseline cannot confirm continuation");
previous.trade_date = date; previous.run_id = "wrong-canonical";
assert.equal(run().injection_count, 0);
written = null;
assert.equal(context.discover([], date, "2026-09-16T05:30:00Z", canonical, quotes, rows, true).status, "not_due");
assert.equal(written, null);
assert.ok(source.indexOf("const sameRoundIndustryDiscovery =") < source.indexOf('tickStage("priority_build_intraday:start")'), "discovery precedes membership rebuild");
console.log("PASS same-round industry discovery: full-universe input, native turnover, freshness, canonical delta, cap accounting and off-session guards");
