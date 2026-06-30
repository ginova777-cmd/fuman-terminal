"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const marketAiLive = require("../api/market-ai-live");

const {
  buildMarketAiInsights,
  canServeCachedPayload,
  heatmapQueryForMarketAi,
  marketSessionState,
  normalizeStockRow,
  requiresTodayDetection,
  scoreRow,
} = marketAiLive.__test;

const ROOT = path.resolve(__dirname, "..");
const readText = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const readJson = (file) => JSON.parse(readText(file));

const aiGuardSource = readText("terminal-ai-risk-guard.js");
const terminalAppSource = readText("terminal-app.js");
const indexHtml = readText("index.html");
const apiSource = readText("api/market-ai-live.js");
const heatmapApiSource = readText("api/heatmap.js");
const scheduleRegistry = readJson("scripts/fuman-schedule-registry.json");
const terminalVersion = readJson("version.json").version;
const activeTasks = new Set(scheduleRegistry.policy.activeTasks || []);
const retiredTasks = new Set(scheduleRegistry.policy.retiredTasks || []);

assert(aiGuardSource.includes("installMarketAiLiveContractPanel"), "frontend AI live contract guard missing");
assert(aiGuardSource.includes("installMarketHeatmapLiveContractPanel"), "frontend heatmap live contract guard missing");
assert(aiGuardSource.includes("載入今日正式 AI 判讀/熱力圖資料中"), "same-day loading copy missing");
assert(aiGuardSource.includes("/api/market-ai-live?canvas=1&compact=1&shell=1&limit=40"), "frontend AI must fetch official market-ai-live API");
assert(aiGuardSource.includes("/api/heatmap?limit=999&stocks=999&source=desktop-live-contract"), "frontend heatmap must fetch official live heatmap API");
assert(aiGuardSource.includes('panel.dataset.marketApiAi = "live-contract"'), "AI panel live-contract marker missing");
assert(aiGuardSource.includes('panel.dataset.heatmapApi = "live-contract"'), "heatmap live-contract marker missing");
assert(aiGuardSource.includes("staleLegacyPanel"), "AI stale first-paint detector missing");
assert(aiGuardSource.includes("staleLegacyHeatmap"), "heatmap stale first-paint detector missing");
assert(aiGuardSource.includes("hyphenDates"), "heatmap stale detector must catch YYYY-MM-DD first-paint dates");
assert(aiGuardSource.includes("setMarketChrome"), "heatmap first-paint guard must update market timestamp chrome");
assert(aiGuardSource.includes("啟動市場總覽"), "heatmap first-paint guard must start before old snapshot can settle");
assert(aiGuardSource.includes("不使用舊 heatmap cache 當正常資料"), "heatmap stale/no-data display must reject old cache");
assert(aiGuardSource.includes("不顯示舊 panel cache"), "AI loading display must reject old panel cache");
assert(terminalAppSource.includes("const liveWindow=!!isHeatmapPollingWindow?.();const hasSnapshot=liveWindow?!1:await loadHeatmapLatestSnapshot(force)"), "terminal app must not render heatmap snapshot before live data during polling window");
const guardScript = `terminal-ai-risk-guard.js?v=${terminalVersion}`;
assert(indexHtml.includes(guardScript), "index must load the AI/heatmap freshness guard through the terminal version contract");
assert(
  indexHtml.indexOf(guardScript) < indexHtml.indexOf("terminal-desktop-fast-shell.js"),
  "freshness guard must load before desktop fast shell so stale market snapshots cannot first-paint as normal"
);
assert(
  indexHtml.indexOf(guardScript) < indexHtml.indexOf("terminal-core.js"),
  "freshness guard must load before terminal core so it can intercept app-rendered stale panels"
);
assert(apiSource.includes("delete query.snapshot") && apiSource.includes('source: "market-ai-live"'), "market-ai-live must strip snapshot query during same-day detection");
assert(apiSource.includes("requireLiveHeatmap") && apiSource.includes("isMarketAiDetectWindow(clock)") && apiSource.includes("HEATMAP_LIVE_TIMEOUT_MS"), "market-ai-live must require live heatmap throughout the active AI window");
assert(heatmapApiSource.includes("isUsableHeatmapMemoryPayload"), "heatmap API must reject unusable memory cache payloads");
assert(heatmapApiSource.includes("stockCount < 500"), "heatmap memory cache must enforce minimum stock coverage");
assert(heatmapApiSource.includes("health.isHealthy !== false"), "heatmap memory cache must enforce health before serving");
assert(heatmapApiSource.includes("heatmapCache = isUsableHeatmapMemoryPayload(payload, clock)"), "heatmap API must not store unusable live payloads in memory cache");
assert(activeTasks.has("Fuman Freshness Gate Fast 0845-1645"), "schedule registry missing fast live freshness gate");
assert(activeTasks.has("Fuman Freshness Gate Full 2010"), "schedule registry missing full freshness gate");
assert(activeTasks.has("Fuman Terminal Local Freshness Verify 0830-2230"), "schedule registry missing local terminal freshness verify");
assert(retiredTasks.has("Fuman Market Overview Patrol 0900"), "old market overview patrol must stay retired");
assert(retiredTasks.has("Fuman Market Overview Watchdog 0901"), "old market overview watchdog must stay retired");

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
assert.deepStrictEqual(
  heatmapQueryForMarketAi({ snapshot: "1", compact: "1", shell: "1", limit: "60" }, true),
  { limit: "999", stocks: "999", source: "market-ai-live" }
);
assert.deepStrictEqual(
  heatmapQueryForMarketAi({ limit: "30" }, false),
  { limit: "60", snapshot: "1", compact: "1", shell: "1" }
);

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

const unhealthyTodayHeatmapInsights = buildMarketAiInsights(
  { dashboard: { tradeDate: "20260629" }, rows: [] },
  {
    updatedAt: "2026-06-29T02:50:03.913Z",
    stockCount: 1960,
    realtimeStockCount: 0,
    health: {
      today: "20260629",
      stockCount: 0,
      realtimeStockCount: 0,
      badDate: 0,
      notRealtime: 0,
      noPrice: 0,
      quoteTime: "",
      isHealthy: false,
    },
    sectors: [],
  },
  {
    tradeDate: "20260629",
    rows: [{
      code: "2330",
      name: "台積電",
      close: 1000,
      change_percent: 1.2,
      value: 10000000000,
      quoteDate: "20260629",
      side: "long",
      reason: "即時雷達",
    }],
  },
  clock,
  { ...session, marketDataDate: "20260629", hasTodayMarketData: true, stale: false }
);
assert.strictEqual(unhealthyTodayHeatmapInsights.dataFreshness.heatmapIsToday, true);
assert.strictEqual(unhealthyTodayHeatmapInsights.dataFreshness.heatmapUsable, false);
assert(unhealthyTodayHeatmapInsights.dataFreshness.sourceIssues[0].includes("熱力圖即時報價水源不健康"));
assert(unhealthyTodayHeatmapInsights.todayPoints.some((point) => point.includes("水源狀態")));

console.log("[market-ai-freshness-guard] ok");
