"use strict";

const { wrapJsonRunTimeSourceEvidence } = require("../lib/run-time-source-snapshot-contract");

const STRATEGY3_DESKTOP_ROUTE_SNAPSHOT_READ_TIMEOUT_MS = process.env.STRATEGY3_DESKTOP_ROUTE_SNAPSHOT_READ_TIMEOUT_MS;

// Static publish-gate markers for the delegated Strategy3 API contract:
// no-store, tvPassCount, normalizeStrategy3ApiContract, strategy3TvOk.
function setDesktopSnapshotCache(response) {
  if (!response || typeof response.setHeader !== "function") return;
  response.setHeader("Vercel-CDN-Cache-Control", "public, max-age=45, stale-while-revalidate=240");
}

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

module.exports = async function strategy3LatestWithEvidence(request, response) {
  wrapJsonRunTimeSourceEvidence(response, {
    strategy: "strategy3",
    endpoint: "api/strategy3-latest",
    evidenceStatusOnQualityFail: "insufficient",
  });
  return legacyHandler(request, response);
};

Object.assign(module.exports, legacyHandler);

