"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "run-daytrade-source-writer.js"), "utf8");
const start = source.indexOf("function writeIntradayBurstTelegramOutbox(");
const end = source.indexOf("\nfunction ", start + 1);
assert.ok(start > 0 && end > start);
const date = "2026-09-18", canonical = "fugle_daytrade_source:20260918:canonical", at = "2026-09-18T02:00:00Z";
const mapping=require('../lib/verify-mother-pool-industry-mapping').staticMapping();
const symbols=mapping.groups['電子零組件'].map(String).slice(0,62);
const classification=symbol=>({industry:'電子零組件',industryParent:'電子零組件',classificationStatus:'ready',
 officialEvidence:{source_url:'https://mopsfin.twse.com.tw/opendata/t187ap03_L.csv',response_sha256:'a'.repeat(64),fetched_at:at,raw_row:{'出表日期':'1150918','公司代號':symbol,'產業別':'28'}},
 detailedEvidence:{symbol,industry:'電子零組件',source:'api/heatmap.js:BB_HEATMAP_GROUPS',version:mapping.version,valid_from:mapping.valid_from}});
let previous, written;
const context = { Map, Set, Date, Number, String, Math, Boolean, require,
  writerTickIdentity:{trade_date:date,canonical_run_id:canonical,writer_run_id:'current-writer',generation_id:'current-generation'},
  runtimePath:(...parts)=>parts.join('/'),
  INTRADAY_BURST_TELEGRAM_OUTBOX_FILE: "outbox", INDUSTRY_SIGNAL_FAST_INJECT_FILE: "discovery",
  DRY_RUN: false, WINDOW_SECONDS: 120, MOTHER_POOL_MIN_PRICE: 50, FORMAL_SIGNAL_MIN_TRADE_VALUE: 100,
  canonicalDaytradeRunId: () => canonical,
  taipeiClockMinutesFrom: value => { const d = new Date(Date.parse(value) + 28800000); return d.getUTCHours() * 60 + d.getUTCMinutes(); },
  taipeiDateFrom: value => new Date(Date.parse(value) + 28800000).toISOString().slice(0, 10),
  readJson: () => previous, writeJson: (file, value) => { if(file==='discovery')written = value; },
  buildIntradayBurstCandleCacheBySymbol: () => new Map(), readHeatmapStaticGroupMap: () => new Map(), readMopsOfficialIndustryCacheMap: () => new Map(),
  normalizeCode: value => String(value), numberValue: value => Number(value) || 0,
  quoteFreshnessTime: quote => quote.quote_seen_at,
  intradayIndustryClassification: row => classification(row.symbol),
  finalizeIntradayIndustryHeatmap: map => [...map.values()].map((r, i) => ({ ...r, flow_rank: i + 1, net_flow_proxy: r.up_trade_value - r.down_trade_value,
    average_change_percent: r.change_percent_sum / r.symbol_count, breadth_percent: 100, flow_direction: "inflow",
    updated_at:at,formula_version:'executed_trade_value_direction_proxy_v1',
    volume_expansion_symbol_count: r.volume_expansion_count, volume_expansion_ratio_percent: 100 })) };
vm.createContext(context);
vm.runInContext(source.slice(start, end) + "\nthis.discover = writeIntradayBurstTelegramOutbox;", context);
const rows = symbols.map(symbol => ({ symbol, industry: '電子零組件', metrics: { price: 100, previousClose: 90, changePercent: 10, tradeValue: 10000000, volumeRatio5: 2, quoteFresh: true } }));
const quotes = new Map(rows.map(r => [r.symbol, { quote_seen_at: at, trade_value: 10000000, total_volume: 100,payload:{tradeValueEvidence:{value:10000000,unit:'TWD',source:'fugle.websocket.aggregates.total.tradeValue',event_at:at,is_synthetic:false,calculation:'provider_reported_cumulative'}} }]));
previous = { trade_date: date, run_id: canonical, updated_at: date+'T01:59:00Z', industry_heatmap: [{ industry:'電子零組件',trade_date:date,canonical_run_id:canonical,writer_run_id:'previous-writer',updated_at:date+'T01:59:00Z',symbols,formula_version:'executed_trade_value_direction_proxy_v1',net_flow_proxy:1,average_change_percent:9 }] };
const run = () => context.discover([], date, at, canonical, quotes, rows, true);
const good = run();
assert.equal(good.injection_count, 60);
assert.equal(good.truncated_count, 2);
assert.equal(good.candidate_count, 62);
assert.equal(good.canonical_run_id, canonical);
assert.equal(good.formal_candidate_allowed, false);
quotes.get(symbols[0]).quote_seen_at = date+'T01:00:00Z';
quotes.get(symbols[1]).payload.tradeValueEvidence.value = null;
quotes.get(symbols[2]).quote_seen_at = date+'T02:01:00Z';
const gaps = run();
assert.equal(gaps.accepted_source_count, 59);
assert.equal(gaps.source_rejected.length, 3);
assert.equal(gaps.source_rejected.find(r => r.symbol === symbols[1]).reason, "source_trade_value_missing", "must not infer turnover from untyped volume or stale metrics");
previous.trade_date = "2026-09-15";
assert.equal(run().injection_count, 0, "cross-day baseline cannot confirm continuation");
previous.trade_date = date; previous.run_id = "wrong-canonical";
assert.equal(run().injection_count, 0);
written = null;
assert.equal(context.discover([], date, date+'T05:30:00Z', canonical, quotes, rows, true).status, "not_due");
assert.equal(written, null);
assert.ok(source.indexOf("const sameRoundIndustryDiscovery =") < source.indexOf('tickStage("priority_build_intraday:start")'), "discovery precedes membership rebuild");
console.log("PASS same-round industry discovery: full-universe input, native turnover, freshness, canonical delta, cap accounting and off-session guards");
