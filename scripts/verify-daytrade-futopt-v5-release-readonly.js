#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const wrapper = read("ops/public-slot/Run-DaytradeSourceWriter.ps1");
const collector = read("scripts/fugle-futopt-websocket-collector.js");
const aggregate = read("lib/fugle-websocket-quotes.js");
const checks = {
  writerReleaseV5: wrapper.includes('$FutoptCollectorRelease = "futopt-formal-live-mirror-v5"'),
  collectorReleaseV5: collector.includes('const COLLECTOR_RELEASE = "futopt-formal-live-mirror-v5"'),
  collectorBatchMirror: collector.includes("FORMAL_LIVE_MIRROR_BATCH_SIZE") && collector.includes("receipt.batch_count"),
  collectorSubscribePacing: collector.includes("STREAMING_SUBSCRIBE_PACE_MS") && collector.includes("await delay(STREAMING_SUBSCRIBE_PACE_MS)"),
  aggregateFormalPriority: aggregate.includes("const formalLastPrice =") && aggregate.includes("const close = formalLastPrice || trialPrice || referencePrice"),
  aggregateMetadata: aggregate.includes("formalLastPrice: formalLastPrice || null") && aggregate.includes("isTrial: !formalLastPrice && trialPrice > 0"),
  noWriterV3: !wrapper.includes("futopt-formal-live-mirror-v3"),
  noCollectorV3: !collector.includes("futopt-formal-live-mirror-v3"),
};
const failedChecks = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
const result = { ok: failedChecks.length === 0, contract: "daytrade_futopt_v5_release_readonly_v1", checks, failedChecks, formalGateRelaxed: false };
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exit(1);