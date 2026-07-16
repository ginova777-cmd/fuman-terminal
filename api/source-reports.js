const { buildMarketCalendarContract, installMarketCalendarResponse } = require("../lib/market-calendar-contract");
const { withEntitlementRequired } = require("../lib/server-entitlement-guard");
"use strict";

function createCaptureResponse(resolve) {
  let settled = false;
  const done = (statusCode, payload) => {
    if (settled) return;
    settled = true;
    resolve({ statusCode, payload });
  };
  return {
    statusCode: 200,
    setHeader() {},
    status(code) {
      this.statusCode = Number(code) || 200;
      return this;
    },
    json(payload) {
      done(this.statusCode || 200, payload);
      return this;
    },
    send(payload) {
      done(this.statusCode || 200, payload);
      return this;
    },
    end(payload = "") {
      done(this.statusCode || 204, payload);
      return this;
    },
  };
}

async function callScorecard(request) {
  const handler = require("./scorecard");
  return new Promise((resolve) => {
    const query = {
      ...(request.query || {}),
      live: request.query?.live || "1",
    };
    Promise.resolve(handler({
      ...request,
      method: "GET",
      fumanInternalVerify: true,
      url: "/api/scorecard?live=1",
      query,
    }, createCaptureResponse(resolve))).catch((error) => {
      resolve({
        statusCode: 500,
        payload: { ok: false, error: "scorecard_source_reports_failed", reason: error?.message || String(error) },
      });
    });
  });
}

async function handler(request, response) {
  const marketCalendar = await buildMarketCalendarContract().catch(() => null);
  installMarketCalendarResponse(response, marketCalendar);
  response.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
  response.setHeader("CDN-Cache-Control", "no-store");
  response.setHeader("Vercel-CDN-Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.status(405).json({ ok: false, error: "method_not_allowed" });
    return;
  }

  const result = await callScorecard(request);
  const payload = result.payload && typeof result.payload === "object" ? result.payload : {};
  const sourceReports = Array.isArray(payload.sourceReports) ? payload.sourceReports : [];
  response.status(result.statusCode && result.statusCode < 400 ? 200 : result.statusCode || 500).json({
    ok: payload.ok !== false && result.statusCode < 400,
    contract: "scorecard-source-reports-v1",
    source: "api:scorecard.sourceReports",
    runId: payload.runId || "",
    latestDate: payload.latestDate || "",
    marketDate: payload.marketDate || "",
    cacheSource: payload.cacheSource || "",
    count: sourceReports.length,
    sourceReports,
    error: payload.error || undefined,
    reason: payload.reason || payload.fallbackReason || undefined,
  });
};

module.exports = withEntitlementRequired(handler, "source-reports");