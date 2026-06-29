"use strict";

const assert = require("assert");
const marketAiLive = require("../api/market-ai-live");

const {
  buildMarketAiInsights,
  canServeCachedPayload,
  marketSessionState,
  normalizeStockRow,
  requiresTodayDetection,
  scoreRow,
} = marketAiLive.__test;

const clock = {
  date: "2026-06-29",
  ymd: "20260629",
  time: "09:05:00",
  seconds: 9 * 60 * 60 + 5 * 60,
  weekday: "Mon",
};
const session = {
  taipeiDate: clock.date,
  today: clock.ymd,
  marketDataDate: "20260626",
  hasTodayMarketData: false,
  stale: true,
  closed: false,
};
const openingSession = marketSessionState(
  clock,
  null,
  { marketDates: { twse: "20260626", tpex: "20260626" } },
  { resolvedTradeDate: "20260626" },
  null
);
assert.strictEqual(openingSession.closed, false);
assert.strictEqual(openingSession.reason, "awaiting-today-market-data");
assert.strictEqual(requiresTodayDetection(clock, openingSession), true);
assert.strictEqual(canServeCachedPayload({ method: "GET", query: {} }, true, true), false);

const weekendClock = {
  date: "2026-06-28",
  ymd: "20260628",
  time: "09:05:00",
  seconds: clock.seconds,
  weekday: "Sun",
};
const weekendSession = marketSessionState(
  weekendClock,
  null,
  { marketDates: { twse: "20260626", tpex: "20260626" } },
  { resolvedTradeDate: "20260626" },
  null
);
assert.strictEqual(weekendSession.closed, true);
assert.strictEqual(weekendSession.reason, "weekend");
assert.strictEqual(requiresTodayDetection(weekendClock, weekendSession), false);
assert.strictEqual(canServeCachedPayload({ method: "GET", query: {} }, true, false), true);

const staleHeatmap = {
  resolvedTradeDate: "20260626",
  stockCount: 1962,
  sectors: [{
    name: "網通設備組件",
    pct: 1.2,
    up: 9,
    down: 1,
    stocks: [{
      Code: "2345",
      Name: "智邦",
      ClosingPrice: 2447.5,
      Change: 67.5,
      TradeValue: 8473245000,
      percent: "",
      quoteDate: "20260626",
    }],
  }],
};

const changeOnlyScore = scoreRow(staleHeatmap.sectors[0].stocks[0], "熱力圖");
assert(changeOnlyScore < 100, `Change-only row must not clamp to 100, actual=${changeOnlyScore}`);

const normalizedChangeOnly = normalizeStockRow(staleHeatmap.sectors[0].stocks[0], "熱力圖");
assert.strictEqual(normalizedChangeOnly.percentSource, "");
assert.strictEqual(normalizedChangeOnly.pct, 0);

const staleInsights = buildMarketAiInsights(
  { dashboard: { tradeDate: "20260626" }, rows: [] },
  staleHeatmap,
  { tradeDate: "20260626", rows: [] },
  clock,
  session
);
assert.strictEqual(staleInsights.rows.length, 0);
assert.strictEqual(staleInsights.hotStocks.length, 0);
assert.strictEqual(staleInsights.priorityObservation.stock, null);
assert.strictEqual(staleInsights.priorityObservation.staleBlocked, true);
assert.strictEqual(staleInsights.dataFreshness.heatmapIsToday, false);
assert(staleInsights.priorityObservation.text.includes("20260629"));

const freshRadarInsights = buildMarketAiInsights(
  { dashboard: { tradeDate: "20260629" }, rows: [] },
  { resolvedTradeDate: "20260626", sectors: staleHeatmap.sectors },
  {
    tradeDate: "20260629",
    rows: [{
      code: "2345",
      name: "智邦",
      close: 2340,
      change_percent: -1.68,
      value: 13130160000,
      quoteDate: "20260629",
      side: "short",
      reason: "短線轉弱",
    }],
  },
  clock,
  { ...session, marketDataDate: "20260629", hasTodayMarketData: true, stale: false }
);
assert.strictEqual(freshRadarInsights.dataFreshness.radarIsToday, true);
assert.notStrictEqual(freshRadarInsights.priorityObservation.stock?.score, 100);
assert.strictEqual(freshRadarInsights.priorityObservation.stock?.percentSource, "change_percent");

console.log("[market-ai-freshness-guard] ok");
