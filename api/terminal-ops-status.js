"use strict";

const { buildLatestOpsStatus, mergeLiveSourceReports } = require("../lib/terminal-ops-status");
const { withEntitlementRequired } = require("../lib/server-entitlement-guard");


async function buildLiveOverlayPayload(payload) {
  if (process.env.FUMAN_TERMINAL_OPS_LIVE_OVERLAY === "0") return payload;
  try {
    const scorecard = require("./scorecard");
    const buildPayload = scorecard?.__test?.buildPayload;
    if (typeof buildPayload !== "function") {
      return {
        ...payload,
        liveOverlay: {
          ok: false,
          source: "scorecard-sourceReports",
          reason: "scorecard_test_builder_unavailable",
          checkedAt: new Date().toISOString(),
        },
      };
    }
    const timeoutMs = Number(process.env.FUMAN_SOURCE_REPORTS_TIMEOUT_MS || 2500);
    const liveScorecard = await buildPayload("", { liveSourceReports: true, timeoutMs });
    return mergeLiveSourceReports(payload, liveScorecard);
  } catch (error) {
    return {
      ...payload,
      liveOverlay: {
        ok: false,
        source: "scorecard-sourceReports",
        reason: "live_overlay_error",
        error: error?.message || String(error),
        checkedAt: new Date().toISOString(),
      },
    };
  }
}

function setNoStore(response) {
  response.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
  response.setHeader("CDN-Cache-Control", "no-store");
  response.setHeader("Vercel-CDN-Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
}

async function handler(request, response) {
  setNoStore(response);
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.status(405).json({ ok: false, error: "method_not_allowed" });
    return;
  }
  let payload = buildLatestOpsStatus();
  payload = await buildLiveOverlayPayload(payload);
  const status = payload.state === "ARTIFACT_MISSING" ? 503 : 200;
  response.status(status).json(payload);
}

module.exports = withEntitlementRequired(handler, "terminal-ops-status");
module.exports.__test = { handler, buildLatestOpsStatus, buildLiveOverlayPayload };
