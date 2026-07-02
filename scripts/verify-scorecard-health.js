"use strict";

const https = require("https");

const BASE_URL = (process.env.FUMAN_SCORECARD_BASE_URL || process.env.FUMAN_PRODUCTION_URL || "https://fuman-terminal.vercel.app").replace(/\/+$/, "");
const CHECK_LIVE = !process.argv.includes("--no-live");
const MIN_SOURCE_COUNT = 9;

function fetchJson(pathname, timeoutMs = 45000) {
  const url = `${BASE_URL}${pathname}${pathname.includes("?") ? "&" : "?"}verify=${Date.now()}`;
  return new Promise((resolve, reject) => {
    const request = https.get(url, { timeout: timeoutMs, headers: { "cache-control": "no-cache" } }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => {
        try {
          resolve({ status: response.statusCode || 0, headers: response.headers, json: JSON.parse(body || "null") });
        } catch (error) {
          reject(new Error(`${pathname} invalid JSON HTTP ${response.statusCode}: ${error.message}`));
        }
      });
    });
    request.on("timeout", () => request.destroy(new Error(`timeout ${url}`)));
    request.on("error", reject);
  });
}

async function main() {
  if (!CHECK_LIVE) {
    console.log("[scorecard-health] skipped live check");
    return;
  }
  const response = await fetchJson("/api/scorecard-health", 60000);
  const payload = response.json || {};
  const issues = [];
  if (response.status < 200 || response.status >= 300) issues.push(`HTTP ${response.status}`);
  if (payload.ok !== true) issues.push(`ok=${payload.ok}`);
  const stages = payload.stages || {};
  for (const name of ["sources", "supabaseSource", "scorecardLatest", "apiScorecard", "scorecardFreshness", "page88"]) {
    if (stages[name]?.ok !== true) issues.push(`stage ${name} not ok`);
  }
  const endpointCount = Object.keys(stages.sources?.endpoints || {}).length;
  if (endpointCount < MIN_SOURCE_COUNT) issues.push(`source endpoint count too low: ${endpointCount}`);
  if (issues.length) {
    console.error("[scorecard-health] failed");
    for (const issue of issues) console.error("- " + issue);
    process.exit(1);
  }
  console.log(`[scorecard-health] ok latestDate=${stages.apiScorecard?.summary?.latestDate || ""} rows=${stages.apiScorecard?.summary?.rows || 0} endpoints=${endpointCount}`);
}

main().catch((error) => {
  console.error(`[scorecard-health] failed: ${error.stack || error.message || error}`);
  process.exit(1);
});
