"use strict";

const { buildLatestOpsStatus } = require("../lib/terminal-ops-status");
const { withEntitlementRequired } = require("../lib/server-entitlement-guard");

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
  const payload = buildLatestOpsStatus();
  const status = payload.state === "ARTIFACT_MISSING" ? 503 : 200;
  response.status(status).json(payload);
}

module.exports = withEntitlementRequired(handler, "terminal-ops-status");
module.exports.__test = { handler, buildLatestOpsStatus };
