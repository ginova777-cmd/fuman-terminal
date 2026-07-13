
"use strict";

const assert = require("assert");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const calls = { market: 0, heatmap: 0, radar: 0, strategy: 0 };

function installStub(relative, handler) {
  const resolved = require.resolve(path.join(ROOT, relative));
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports: handler,
  };
}

installStub("api/market.js", async (req, res) => {
  calls.market += 1;
  res.status(200).json({
    ok: true,
    source: "MIS即時",
    marketStatus: "day",
    trading: true,
    updatedAt: "2026-07-13T01:15:00.000Z",
    indexes: [
      { "指數": "發行量加權股價指數", "收盤指數": "22888.88", "漲跌": "+", "漲跌點數": "120.50", "漲跌百分比": "0.53", _source: "MIS即時" },
      { "指數": "櫃買指數", "收盤指數": "255.55", "漲跌": "-", "漲跌點數": "0.20", "漲跌百分比": "0.08", _source: "MIS即時" },
    ],
    futuresNear: { name: "台指近月", price: "22920", change: "+85", pct: "+0.37%", basisLabel: "多方勢", basisSide: "long" },
    futures: { name: "台指近月", price: "22920", change: "+85", pct: "+0.37%", basisLabel: "多方勢", basisSide: "long" },
  });
});
installStub("api/heatmap.js", async () => {
  calls.heatmap += 1;
  throw new Error("heatmap must not be called by simple index report");
});
installStub("api/realtime-radar-latest.js", async () => {
  calls.radar += 1;
  throw new Error("realtime radar must not be called by simple index report");
});
installStub("api/latest-strategy.js", async () => {
  calls.strategy += 1;
  throw new Error("latest strategy must not be called by simple index report");
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
    Promise.resolve(handler(req, res)).catch((error) => resolve({ statusCode: 500, headers, payload: { ok: false, error: error.message } }));
  });
}

(async () => {
  const result = await capture(marketAiLive, {
    method: "GET",
    query: { canvas: "1", compact: "1", shell: "1", limit: "40" },
    headers: { host: "localhost" },
    url: "/api/market-ai-live?canvas=1&compact=1&shell=1&limit=40",
  });
  const body = result.payload || {};
  assert.strictEqual(result.statusCode, 200);
  assert.strictEqual(body.source, "market-ai-index-report");
  assert.strictEqual(body.reportMode, "weighted-index-simple-report");
  assert.strictEqual(body.usesHeatmap, false);
  assert.strictEqual(body.usesRealtimeRadar, false);
  assert.strictEqual(body.heatmap?.disabled, true);
  assert.strictEqual(body.realtimeRadar?.disabled, true);
  assert.strictEqual(body.summary?.realtimeRadarCount, 0);
  assert.strictEqual(body.publishAllowed, false);
  assert.strictEqual(body.preservePreviousGood, true);
  assert.strictEqual(body.displayAllowed, true);
  assert.strictEqual(body.sourceEvidenceStatus, "display_only");
  assert.strictEqual(body.evidenceStatus, "display_only");
  assert.deepStrictEqual(body.sourceEvidenceIssues || [], []);
  assert.strictEqual(body.dataFreshness?.heatmapQuoteCoverage?.status, "not_required");
  assert.ok(body.dashboard?.dataSources?.weightedIndex, "weighted index evidence missing");
  assert.ok(body.dashboard?.dataSources?.otcIndex, "OTC index evidence missing");
  assert.ok(body.dashboard?.dataSources?.txfNear, "TXF evidence missing");
  assert.ok((body.todayPoints || []).some((text) => /加權指數/.test(text)), "report must mention weighted index");
  assert.ok((body.reasoning || []).some((item) => /heatmap \/ realtime-radar/.test(item.text || "")), "resource policy evidence missing");
  assert.deepStrictEqual(calls, { market: 1, heatmap: 0, radar: 0, strategy: 0 });
  console.log("[market-ai-index-report] ok", JSON.stringify({ rows: body.rows?.length || 0, bias: body.summary?.bias, action: body.summary?.action }));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
