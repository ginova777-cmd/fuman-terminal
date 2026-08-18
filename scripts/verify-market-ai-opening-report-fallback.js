"use strict";

const assert = require("assert");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const calls = { market: 0, heatmap: 0, radar: 0, strategy: 0, snapshot: 0 };

function taipeiClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now).reduce((acc, part) => {
    if (part.type !== "literal") acc[part.type] = part.value;
    return acc;
  }, {});
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    ymd: `${parts.year}${parts.month}${parts.day}`,
  };
}

function installStub(relative, exports) {
  const resolved = require.resolve(path.join(ROOT, relative));
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports,
  };
}

const clock = taipeiClock();
const topIndustries = [
  {
    industry: "III_V_OPTICAL",
    display_name: "III-V 材料／光通訊",
    a_symbols: [
      { symbol: "3105", name: "穩懋" },
      { symbol: "3081", name: "聯亞" },
      { symbol: "2455", name: "全新" },
      { symbol: "8086", name: "宏捷科" },
    ],
  },
  {
    industry: "OPTICAL_COMM",
    display_name: "光通訊／CPO／矽光子",
    a_symbols: [
      { symbol: "3363", name: "上詮" },
      { symbol: "6442", name: "光聖" },
      { symbol: "4979", name: "華星光" },
      { symbol: "3163", name: "波若威" },
      { symbol: "3081", name: "聯亞" },
      { symbol: "3450", name: "聯鈞" },
      { symbol: "4977", name: "眾達-KY" },
      { symbol: "4908", name: "前鼎" },
    ],
  },
  {
    industry: "MEMORY",
    display_name: "記憶體",
    a_symbols: [
      { symbol: "2408", name: "南亞科" },
      { symbol: "2344", name: "華邦電" },
      { symbol: "6770", name: "力積電" },
      { symbol: "8299", name: "群聯" },
      { symbol: "3260", name: "威剛" },
    ],
  },
];
const expectedCodes = [
  "3105", "3081", "2455", "8086",
  "3363", "6442", "4979", "3163", "3450", "4977", "4908",
  "2408", "2344", "6770", "8299", "3260",
];
const expectedNames = [
  "穩懋", "聯亞", "全新", "宏捷科",
  "上詮", "光聖", "華星光", "波若威", "聯鈞", "眾達-KY", "前鼎",
  "南亞科", "華邦電", "力積電", "群聯", "威剛",
];
const openingMorningReport = {
  contract: "opening-report-0830-terminal-briefing-v1",
  ok: true,
  date: clock.date,
  run_id: `opening-report-0830-${clock.ymd}-verifier`,
  display_label: "今日觀察",
  allowed_action: "industry_observation_only",
  forbidden_action: "formal_trading_use",
  priority_industries: topIndustries.map((row) => ({ ...row, bias: "positive_detected", confidence: 0.95 })),
  recommended_symbols: topIndustries.flatMap((industryRow) => industryRow.a_symbols.map((stock) => ({
    ...stock,
    industry: industryRow.display_name,
    bias: "positive_detected",
  }))).slice(0, 12),
};

installStub("lib/market-calendar-contract.js", {
  buildMarketCalendarContract: async () => ({
    ok: true,
    marketOpen: true,
    marketStatus: "open",
    marketDate: clock.date,
  }),
  installMarketCalendarResponse: () => {},
});
installStub("lib/supabase-snapshots.js", {
  readSnapshot: async (key) => {
    calls.snapshot += 1;
    if (key !== "opening_report_0830_terminal_briefing") return null;
    return { payload: openingMorningReport, updatedAt: `${clock.date}T00:49:03.254+08:00` };
  },
});
installStub("api/market.js", async (req, res) => {
  calls.market += 1;
  res.status(200).json({
    ok: true,
    source: "MIS即時",
    marketStatus: "day",
    trading: true,
    today: clock.ymd,
    updatedAt: `${clock.date}T05:30:00.000Z`,
    indexes: [
      { "指數": "發行量加權股價指數", "收盤指數": "45308.68", "漲跌": "-", "漲跌點數": "548.59", "漲跌百分比": "1.20", _source: "MIS即時" },
      { "指數": "櫃買指數", "收盤指數": "390.83", "漲跌": "-", "漲跌點數": "7.49", "漲跌百分比": "1.88", _source: "MIS即時" },
    ],
    futuresNear: { name: "台指近月", price: "44925", change: "-160", pct: "-0.36%", basisLabel: "空方勢", basisSide: "short" },
    futures: { name: "台指近月", price: "44925", change: "-160", pct: "-0.36%", basisLabel: "空方勢", basisSide: "short" },
  });
});
installStub("api/latest-strategy.js", async (req, res) => {
  calls.strategy += 1;
  res.status(200).json({ ok: true, rows: [] });
});
installStub("api/realtime-radar-latest.js", async (req, res) => {
  calls.radar += 1;
  res.status(200).json({ ok: true, tradeDate: clock.ymd, rows: [] });
});
installStub("api/heatmap.js", async (req, res) => {
  calls.heatmap += 1;
  res.status(200).json({
    ok: true,
    tradeDate: clock.ymd,
    resolvedTradeDate: clock.ymd,
    stockCount: 0,
    realtimeStockCount: 0,
    health: { isHealthy: false, stockCount: 0, realtimeStockCount: 0, badDate: 0, notRealtime: 0, noPrice: 0 },
    sectors: [],
  });
});

const marketAiLive = require("../api/market-ai-live");

function capture(handler, req) {
  return new Promise((resolve) => {
    const headers = {};
    const res = {
      setHeader(key, value) { headers[String(key).toLowerCase()] = value; },
      status(code) { this.statusCode = code; return this; },
      json(payload) { resolve({ statusCode: this.statusCode || 200, headers, payload }); },
      end() { resolve({ statusCode: this.statusCode || 204, headers, payload: null }); },
    };
    Promise.resolve(handler(req, res)).catch((error) => resolve({ statusCode: 500, headers, payload: { ok: false, error: error.stack || error.message } }));
  });
}

(async () => {
  const result = await capture(marketAiLive, {
    method: "GET",
    query: { canvas: "1", compact: "1", shell: "1", limit: "40", t: "market-ai-opening-report-fallback-verifier" },
    headers: { host: "localhost" },
    url: "/api/market-ai-live?canvas=1&compact=1&shell=1&limit=40&t=market-ai-opening-report-fallback-verifier",
  });
  const body = result.payload || {};
  assert.strictEqual(result.statusCode, 200, body.error || "http status mismatch");
  assert.strictEqual(body.ok, true, "API ok must be true");
  assert.notStrictEqual(body.reportMode, "weighted-index-simple-report", "default terminal shell must not use simple index-only report");
  assert.notStrictEqual(body.source, "market-ai-index-report", "default terminal shell must stay on market-ai live bundle");
  assert.strictEqual(body.source, "live-api-bundle", "market AI source must be live-api-bundle");
  assert.strictEqual(body.dataFreshness?.openingReportFallbackUsed, true, "opening report fallback must be marked when official rows are empty");
  assert.strictEqual(body.dashboard?.dataSources?.openingReportFallbackRows, expectedCodes.length, "fallback must expose all top-3 industry A symbols");
  assert.strictEqual(body.count, expectedCodes.length, "count must match fallback rows");
  assert.strictEqual(body.groups?.all?.rows?.length, expectedCodes.length, "all group must include full fallback rows");
  assert.ok(Array.isArray(body.hotStocks) && body.hotStocks.length === 10, "hotStocks should expose the first 10 observation rows");

  const allRows = Array.isArray(body.groups?.all?.rows) ? body.groups.all.rows : [];
  const allCodes = allRows.map((row) => String(row?.code || "").trim());
  const allNames = allRows.map((row) => String(row?.name || "").trim());
  assert.deepStrictEqual([...new Set(allCodes)], expectedCodes, "fallback rows must preserve top-3 industry Taiwan symbols in order");
  assert.deepStrictEqual(expectedNames.filter((name) => !allNames.includes(name)), [], "fallback rows missing expected Taiwan stock names");
  assert.ok((body.todayPoints || []).some((text) => topIndustries.every((row) => String(text).includes(row.display_name))), "today focus must show the three strongest industries");
  assert.strictEqual(body.priorityObservation?.title, "3105 穩懋", "priority observation must start from the strongest industry first stock");
  assert.ok(allRows.every((row) => row.source === "晨報產業觀察"), "fallback rows must be labelled as morning-report industry observations");
  assert.ok(allRows.every((row) => /僅供開盤前海外產業觀察排序/.test(String(row.reason || ""))), "fallback rows must not imply formal entry judgement");
  assert.ok(calls.snapshot >= 1, "opening report snapshot must be read");
  assert.ok(calls.heatmap >= 1, "default shell must still check heatmap/live market context");
  assert.ok(calls.market === 0 || calls.market === 1, "market fanout must be snapshot-first optional");
  assert.ok(calls.radar === 0 || calls.radar === 1, "radar fanout must be snapshot-first optional");
  assert.ok(calls.strategy === 0 || calls.strategy === 1, "strategy fanout must be snapshot-first optional");
  assert.ok(
    calls.market + calls.radar + calls.strategy > 0 || body.dataFreshness?.openingReportFallbackUsed === true,
    "snapshot-first shell must still prove opening report fallback is active when live fanout is skipped"
  );

  console.log("[market-ai-opening-report-fallback] ok", JSON.stringify({
    count: body.count,
    openingReportFallbackRows: body.dashboard?.dataSources?.openingReportFallbackRows,
    liveFanout: { market: calls.market, radar: calls.radar, strategy: calls.strategy, heatmap: calls.heatmap },
    focus: body.todayPoints?.find((text) => /族群聚焦/.test(text)) || "",
    rows: allRows.map((row) => `${row.code} ${row.name}`),
  }));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

