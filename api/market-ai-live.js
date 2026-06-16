const strategy2Latest = require("./strategy2-latest");
const realtimeRadarLatest = require("./realtime-radar-latest");
const market = require("./market");

function capture(handler, req) {
  return new Promise((resolve) => {
    const headers = {};
    const res = {
      setHeader(key, value) { headers[String(key).toLowerCase()] = value; },
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        resolve({ statusCode: this.statusCode || 200, headers, payload });
      },
      end() {
        resolve({ statusCode: this.statusCode || 204, headers, payload: null });
      },
    };
    Promise.resolve(handler(req, res)).catch((error) => {
      resolve({ statusCode: 500, headers, payload: { ok: false, error: error?.message || String(error) } });
    });
  });
}

function count(payload) {
  return Array.isArray(payload?.rows) ? payload.rows.length
    : Array.isArray(payload?.records) ? payload.records.length
      : Array.isArray(payload?.events) ? payload.events.length
        : Array.isArray(payload?.matches) ? payload.matches.length
          : 0;
}

module.exports = async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
  response.setHeader("CDN-Cache-Control", "no-store");
  response.setHeader("Vercel-CDN-Cache-Control", "no-store");

  if (request.method !== "GET") {
    response.status(405).json({ ok: false, error: "method_not_allowed" });
    return;
  }

  const req = { ...request, method: "GET", query: request.query || {} };
  const [marketResult, strategy2Result, radarResult] = await Promise.all([
    capture(market, req),
    capture(strategy2Latest, req),
    capture(realtimeRadarLatest, req),
  ]);
  const strategy2 = strategy2Result.payload || {};
  const realtimeRadar = radarResult.payload || {};
  const marketPayload = marketResult.payload || {};

  response.status(200).json({
    ok: Boolean(marketPayload.ok || strategy2.ok !== false || realtimeRadar.ok !== false),
    source: "live-api-bundle",
    updatedAt: new Date().toISOString(),
    market: marketPayload,
    strategy2,
    realtimeRadar,
    summary: {
      marketStatus: marketPayload.marketStatus || "",
      trading: marketPayload.trading === true,
      strategy2Count: count(strategy2),
      realtimeRadarCount: count(realtimeRadar),
      strategy2Source: strategy2.cacheSource || strategy2.transport?.source || "",
      realtimeRadarSource: realtimeRadar.cacheSource || realtimeRadar.transport?.source || "",
    },
  });
};
