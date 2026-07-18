const { buildMarketCalendarContract, installMarketCalendarResponse } = require("../lib/market-calendar-contract");
const { withEntitlementRequired } = require("../lib/server-entitlement-guard");
"use strict";

async function readScorecardPayload(request) {
  const scorecard = require("./scorecard");
  if (scorecard.__test?.buildPayload) {
    return scorecard.__test.buildPayload(request.query?.date || request.query?.record_date || "", {
      liveSourceReports: request.query?.live === "1" || request.query?.strictLiveReports === "1" || request.query?.refreshSourceReports === "1",
      timeoutMs: 800,
    });
  }
  throw new Error("scorecard_build_payload_unavailable");
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

  let payload = {};
  let statusCode = 200;
  try {
    payload = await readScorecardPayload(request);
  } catch (error) {
    statusCode = 500;
    payload = { ok: false, error: "scorecard_source_reports_failed", reason: error?.message || String(error) };
  }
  const sourceReports = Array.isArray(payload.sourceReports) ? payload.sourceReports : [];
  response.status(statusCode < 400 ? 200 : statusCode).json({
    ok: payload.ok !== false && statusCode < 400,
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
