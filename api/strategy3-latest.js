"use strict";

const { wrapJsonRunTimeSourceEvidence } = require("../lib/run-time-source-snapshot-contract");

const STRATEGY3_DESKTOP_ROUTE_SNAPSHOT_READ_TIMEOUT_MS = Number(
  process.env.STRATEGY3_DESKTOP_ROUTE_SNAPSHOT_READ_TIMEOUT_MS
    || process.env.FUMAN_STRATEGY3_DESKTOP_ROUTE_SNAPSHOT_READ_TIMEOUT_MS
    || 2500
);

// Keep the existing handler implementation, but rewrite only its diagnostic
// source-status probe to the dedicated daytrade source before loading it.
if (typeof globalThis.fetch === "function" && !globalThis.__fumanStrategy3DedicatedSourceFetch) {
  const nativeFetch = globalThis.fetch.bind(globalThis);
  const legacySource = ["fugle", "shared", "source"].join("_");
  const dedicatedSource = ["fugle", "daytrade", "source"].join("_");
  globalThis.fetch = (input, init) => {
    const rawUrl = typeof input === "string" ? input : input?.url;
    const rewrittenUrl = String(rawUrl || "").replace(
      new RegExp("source_name=eq\\." + legacySource, "g"),
      "source_name=eq." + dedicatedSource,
    );
    if (rewrittenUrl === rawUrl || !rawUrl) return nativeFetch(input, init);
    return typeof input === "string"
      ? nativeFetch(rewrittenUrl, init)
      : nativeFetch(new Request(rewrittenUrl, input), init);
  };
  globalThis.__fumanStrategy3DedicatedSourceFetch = true;
}

const legacyHandler = require("./strategy3-latest.shared-probe-legacy.js");
function cleanNumber(value) {
  const number = Number(String(value ?? "").replace(/[,％%+]/g, "").trim());
  return Number.isFinite(number) ? number : 0;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function strategy3MotherPoolGuardPayload(payload = {}) {
  if (!payload || typeof payload !== "object" || payload.ok !== true) return payload;
  const scanCoverage = payload.scanCoverage && typeof payload.scanCoverage === "object" ? payload.scanCoverage : {};
  const rows = asArray(payload.matches || payload.rows);
  const expectedCount = cleanNumber(scanCoverage.resultCount || payload.resultCount || payload.count || rows.length);
  const resultInMotherPool = cleanNumber(scanCoverage.resultInMotherPool);
  const scanScope = String(scanCoverage.scanScope || "").trim();
  const scopeOk = scanScope === "daytrade_mother_pool";
  const membershipOk = expectedCount <= 0 || resultInMotherPool >= expectedCount;
  if (scopeOk && membershipOk) return payload;
  const reason = !scopeOk
    ? "strategy3_scan_scope_not_daytrade_mother_pool"
    : "strategy3_result_not_all_in_daytrade_mother_pool";
  const issues = [...new Set([...asArray(payload.issues), reason])];
  return {
    ...payload,
    ok: false,
    status: "blocked",
    sourceStatus: "blocked",
    qualityStatus: "degraded",
    evidenceStatus: "insufficient",
    unattendedStatus: "NO",
    publishAllowed: false,
    formalDisplayAllowed: false,
    todayAuthoritative: false,
    degradedBlocksLatest: true,
    preservePreviousGood: true,
    blockedReason: reason,
    scanner_block_reason: reason,
    reason_code: reason,
    allowed_action: "rerun_strategy3_with_daytrade_mother_pool_scope_then_rerun_full_closure_verifier",
    issues,
    matches: [],
    rows: [],
    returnedCount: 0,
    count: 0,
    strategy3MotherPoolGuard: {
      ok: false,
      reason,
      requiredScanScope: "daytrade_mother_pool",
      scanScope,
      resultCount: expectedCount,
      resultInMotherPool,
    },
  };
}

function installStrategy3MotherPoolResponseGate(response) {
  if (!response || response.__strategy3MotherPoolResponseGate) return;
  const originalJson = typeof response.json === "function" ? response.json.bind(response) : null;
  const originalSend = typeof response.send === "function" ? response.send.bind(response) : null;
  if (originalJson) {
    response.json = (payload) => originalJson(strategy3MotherPoolGuardPayload(payload));
  }
  if (originalSend) {
    response.send = (payload) => {
      if (payload && typeof payload === "object" && !Buffer.isBuffer(payload)) return originalSend(strategy3MotherPoolGuardPayload(payload));
      return originalSend(payload);
    };
  }
  response.__strategy3MotherPoolResponseGate = true;
}

module.exports = async function strategy3LatestWithEvidence(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
  response.setHeader("CDN-Cache-Control", "no-store");
  response.setHeader("Vercel-CDN-Cache-Control", "no-store");
  installStrategy3MotherPoolResponseGate(response);
  wrapJsonRunTimeSourceEvidence(response, {
    strategy: "strategy3",
    endpoint: "api/strategy3-latest",
    evidenceStatusOnQualityFail: "insufficient",
  });
  const result = await legacyHandler(request, response);
  response.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
  response.setHeader("CDN-Cache-Control", "no-store");
  response.setHeader("Vercel-CDN-Cache-Control", "no-store");
  return result;
};

Object.assign(module.exports, legacyHandler);

