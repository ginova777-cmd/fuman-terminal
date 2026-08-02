"use strict";

// Keep the existing handler implementation, but rewrite only its diagnostic
// source-status probe to the dedicated daytrade source before loading it.
// The legacy file remains available for audit and rollback comparison.
if (typeof globalThis.fetch === "function" && !globalThis.__fumanStrategy3DedicatedSourceFetch) {
  const nativeFetch = globalThis.fetch.bind(globalThis);
  const legacySource = ["fugle", "shared", "source"].join("_");
  const dedicatedSource = ["fugle", "daytrade", "source"].join("_");
  globalThis.fetch = (input, init) => {
    const rawUrl = typeof input === "string" ? input : input?.url;
    const rewrittenUrl = String(rawUrl || "").replace(
      new RegExp(`source_name=eq\\.${legacySource}`, "g"),
      `source_name=eq.${dedicatedSource}`,
    );
    if (rewrittenUrl === rawUrl || !rawUrl) return nativeFetch(input, init);
    return typeof input === "string"
      ? nativeFetch(rewrittenUrl, init)
      : nativeFetch(new Request(rewrittenUrl, input), init);
  };
  globalThis.__fumanStrategy3DedicatedSourceFetch = true;
}

module.exports = require("./strategy3-latest.shared-probe-legacy.js");
