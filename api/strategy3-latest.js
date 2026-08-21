"use strict";

const { wrapJsonRunTimeSourceEvidence } = require("../lib/run-time-source-snapshot-contract");
const {
  taipeiDate,
  readJson,
  scanReceiptPath,
} = require("../scripts/strategy3-v2-contract");

const STRATEGY3_DESKTOP_ROUTE_SNAPSHOT_READ_TIMEOUT_MS = Number(
  process.env.STRATEGY3_DESKTOP_ROUTE_SNAPSHOT_READ_TIMEOUT_MS
    || process.env.FUMAN_STRATEGY3_DESKTOP_ROUTE_SNAPSHOT_READ_TIMEOUT_MS
    || 2500
);

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
const strategy3V2Latest = require("./strategy3-v2-latest.js");

function requestQuery(request) {
  if (request?.query && typeof request.query === "object") return request.query;
  try {
    const url = new URL(request?.url || "", "https://fuman-terminal.local");
    return Object.fromEntries(url.searchParams.entries());
  } catch {
    return {};
  }
}

function shouldUseStrategy3V2(request) {
  const query = requestQuery(request);
  if (String(query.legacy || query.v1 || "").trim() === "1") return false;
  return true;
}

module.exports = async function strategy3LatestWithEvidence(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
  response.setHeader("CDN-Cache-Control", "no-store");
  response.setHeader("Vercel-CDN-Cache-Control", "no-store");
  if (shouldUseStrategy3V2(request)) {
    const result = await strategy3V2Latest(request, response);
    response.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
    response.setHeader("CDN-Cache-Control", "no-store");
    response.setHeader("Vercel-CDN-Cache-Control", "no-store");
    return result;
  }
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
module.exports.STRATEGY3_DESKTOP_ROUTE_SNAPSHOT_READ_TIMEOUT_MS = STRATEGY3_DESKTOP_ROUTE_SNAPSHOT_READ_TIMEOUT_MS;
