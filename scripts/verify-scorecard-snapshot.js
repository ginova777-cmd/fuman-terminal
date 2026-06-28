const fs = require("fs");
const https = require("https");
const path = require("path");
const { readSnapshot } = require("../lib/supabase-snapshots");
const { verifyScorecardStrategyRules } = require("../lib/scorecard-rule-locks");

const ROOT = path.resolve(__dirname, "..");
const SNAPSHOT_KEY = process.env.FUMAN_SCORECARD_SNAPSHOT_KEY || "scorecard_latest";
const BASE_URL = (process.env.FUMAN_SCORECARD_BASE_URL || process.env.FUMAN_PRODUCTION_URL || "https://fuman-terminal.vercel.app").replace(/\/+$/, "");
const CHECK_LIVE = !process.argv.includes("--no-live");
const LOCAL_FILE = path.join(ROOT, "data", "scorecard-latest.json");

function fetchJson(pathname, timeoutMs = 30000) {
  const url = `${BASE_URL}${pathname}${pathname.includes("?") ? "&" : "?"}t=${Date.now()}`;
  return new Promise((resolve, reject) => {
    const request = https.get(url, { timeout: timeoutMs, headers: { "cache-control": "no-cache" } }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => {
        let json = null;
        try {
          json = body ? JSON.parse(body) : null;
        } catch (error) {
          reject(new Error(`${pathname} invalid JSON HTTP ${response.statusCode}: ${error.message}`));
          return;
        }
        resolve({ status: response.statusCode, json });
      });
    });
    request.on("timeout", () => request.destroy(new Error(`timeout ${url}`)));
    request.on("error", reject);
  });
}

function countRows(payload) {
  return Array.isArray(payload?.records) ? payload.records.length : Number(payload?.summary?.rows || 0);
}

function rowSource(row = {}) {
  return String(row.source || row.dataSource || row.data_source || row.source_sheet || "").trim();
}

function countMissingRecordSources(payload) {
  return Array.isArray(payload?.records) ? payload.records.filter((row) => !rowSource(row)).length : 0;
}

function countMissingDailySources(payload) {
  return Array.isArray(payload?.summary?.daily) ? payload.summary.daily.filter((row) => !rowSource(row)).length : 0;
}

function summarizePayload(payload, source) {
  const strategyRules = verifyScorecardStrategyRules(payload || {}, { source });
  return {
    ok: Boolean(payload && payload.ok !== false),
    latestDate: payload?.latestDate || payload?.summary?.latestDate || "",
    rows: countRows(payload),
    cacheSource: payload?.cacheSource || source,
    missingRecordSources: countMissingRecordSources(payload),
    missingDailySources: countMissingDailySources(payload),
    strategyRules: {
      ok: strategyRules.ok,
      strict: strategyRules.strict,
      issues: strategyRules.issues,
    },
  };
}

async function main() {
  const issues = [];
  let snapshotPayload = null;
  const snapshot = await readSnapshot(SNAPSHOT_KEY, { allowLatestFallback: true, timeoutMs: 30000 }).catch((error) => ({ error }));
  if (snapshot?.payload) {
    snapshotPayload = snapshot.payload;
  } else if (fs.existsSync(LOCAL_FILE)) {
    snapshotPayload = JSON.parse(fs.readFileSync(LOCAL_FILE, "utf8"));
  }
  const snapshotSummary = summarizePayload(snapshotPayload, snapshot?.payload ? "supabase-snapshot" : "json-snapshot");
  if (!snapshotSummary.ok) issues.push("scorecard snapshot ok=false or missing");
  if (!snapshotSummary.latestDate) issues.push("scorecard snapshot latestDate missing");
  if (snapshotSummary.rows <= 0) issues.push(`scorecard snapshot rows invalid: ${snapshotSummary.rows}`);
  if (snapshotSummary.missingRecordSources > 0) issues.push(`scorecard snapshot records missing source fields: ${snapshotSummary.missingRecordSources}`);
  if (snapshotSummary.missingDailySources > 0) issues.push(`scorecard snapshot daily rows missing source fields: ${snapshotSummary.missingDailySources}`);
  if (!snapshotSummary.strategyRules.ok) issues.push(`scorecard snapshot strategy rule lock failed: ${snapshotSummary.strategyRules.issues.join(",")}`);

  let liveSummary = null;
  if (CHECK_LIVE) {
    const live = await fetchJson("/api/scorecard", 35000);
    liveSummary = {
      status: live.status,
      ...summarizePayload(live.json, live.json?.cacheSource || "live"),
    };
    if (live.status < 200 || live.status >= 300) issues.push(`live /api/scorecard HTTP ${live.status}`);
    if (!liveSummary.ok) issues.push("live /api/scorecard ok=false");
    if (liveSummary.rows <= 0) issues.push(`live /api/scorecard rows invalid: ${liveSummary.rows}`);
    if (liveSummary.missingRecordSources > 0) issues.push(`live /api/scorecard records missing source fields: ${liveSummary.missingRecordSources}`);
    if (liveSummary.missingDailySources > 0) issues.push(`live /api/scorecard daily rows missing source fields: ${liveSummary.missingDailySources}`);
    if (!liveSummary.strategyRules.ok) issues.push(`live /api/scorecard strategy rule lock failed: ${liveSummary.strategyRules.issues.join(",")}`);
  }

  const report = {
    ok: issues.length === 0,
    snapshot: snapshotSummary,
    live: liveSummary,
    issues,
  };
  console.log(JSON.stringify(report, null, 2));
  if (issues.length) process.exit(1);
}

main().catch((error) => {
  console.error(`[verify-scorecard-snapshot] failed: ${error.stack || error.message}`);
  process.exit(1);
});
