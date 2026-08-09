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

module.exports = async function strategy3LatestWithEvidence(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
  response.setHeader("CDN-Cache-Control", "no-store");
  response.setHeader("Vercel-CDN-Cache-Control", "no-store");
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
