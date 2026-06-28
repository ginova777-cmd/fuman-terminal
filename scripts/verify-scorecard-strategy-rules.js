"use strict";

const fs = require("fs");
const https = require("https");
const path = require("path");
const { readSnapshot } = require("../lib/supabase-snapshots");
const { verifyScorecardStrategyRules, RULE_CONTRACT } = require("../lib/scorecard-rule-locks");

const ROOT = path.resolve(__dirname, "..");
const BASE_URL = (process.env.FUMAN_SCORECARD_BASE_URL || process.env.FUMAN_PRODUCTION_URL || "https://fuman-terminal.vercel.app").replace(/\/+$/, "");
const SNAPSHOT_KEY = process.env.FUMAN_SCORECARD_SNAPSHOT_KEY || "scorecard_latest";
const CHECK_LIVE = !process.argv.includes("--no-live");
const WRITE_OUTPUT = !process.argv.includes("--no-output");
const REQUIRE_CONTRACT = process.argv.includes("--require-contract");
const SNAPSHOT_FILE = argValue("--snapshot-file", process.env.FUMAN_SCORECARD_SNAPSHOT_FILE || "");
const LOCAL_FILE = path.join(ROOT, "data", "scorecard-latest.json");

function argValue(name, fallback = "") {
  const prefix = `${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function fetchJson(pathname, timeoutMs = 35000) {
  const url = `${BASE_URL}${pathname}${pathname.includes("?") ? "&" : "?"}rules=${Date.now()}`;
  return new Promise((resolve, reject) => {
    const request = https.get(url, { timeout: timeoutMs, headers: { "cache-control": "no-cache" } }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => {
        try {
          resolve({ status: response.statusCode || 0, json: body ? JSON.parse(body) : null });
        } catch (error) {
          reject(new Error(`${pathname} invalid JSON HTTP ${response.statusCode}: ${error.message}`));
        }
      });
    });
    request.on("timeout", () => request.destroy(new Error(`timeout ${url}`)));
    request.on("error", reject);
  });
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}

async function loadSnapshotPayload() {
  if (SNAPSHOT_FILE) return { source: "snapshot-file", payload: readJson(path.resolve(SNAPSHOT_FILE)) };
  const snapshot = await readSnapshot(SNAPSHOT_KEY, { allowLatestFallback: true, timeoutMs: 30000 }).catch(() => null);
  if (snapshot?.payload) return { source: "supabase-snapshot", payload: snapshot.payload };
  if (fs.existsSync(LOCAL_FILE)) return { source: "local-file", payload: readJson(LOCAL_FILE) };
  return { source: "missing", payload: null };
}

async function main() {
  const reports = [];
  const snapshot = await loadSnapshotPayload();
  if (snapshot.payload) {
    reports.push({
      source: snapshot.source,
      ...verifyScorecardStrategyRules(snapshot.payload, {
        source: snapshot.source,
        requireContract: REQUIRE_CONTRACT || snapshot.source === "snapshot-file",
      }),
    });
  } else {
    reports.push({
      source: snapshot.source,
      ok: false,
      contract: RULE_CONTRACT,
      issues: ["snapshot-missing"],
      checks: [{ id: "snapshot-missing", ok: false, message: "scorecard snapshot payload missing" }],
    });
  }

  if (CHECK_LIVE) {
    const live = await fetchJson("/api/scorecard");
    reports.push({
      source: "live-api",
      httpStatus: live.status,
      ...verifyScorecardStrategyRules(live.json || {}, {
        source: "live-api",
        requireContract: REQUIRE_CONTRACT,
      }),
    });
  }

  const failed = reports.flatMap((report) => (report.checks || [])
    .filter((check) => !check.ok)
    .map((check) => ({ source: report.source, ...check })));
  const output = {
    ok: failed.length === 0,
    checkedAt: new Date().toISOString(),
    contract: RULE_CONTRACT,
    requireContract: REQUIRE_CONTRACT,
    reports,
    failed,
  };

  if (WRITE_OUTPUT) {
    const outDir = path.join(ROOT, "outputs", "scorecard-strategy-rules");
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "scorecard-strategy-rules.json"), `${JSON.stringify(output, null, 2)}\n`, "utf8");
    fs.writeFileSync(path.join(outDir, "scorecard-strategy-rules.md"), [
      "# Scorecard Strategy Rule Locks",
      "",
      `ok: ${output.ok}`,
      `contract: ${output.contract}`,
      `requireContract: ${output.requireContract}`,
      "",
      ...reports.flatMap((report) => [
        `## ${report.source}`,
        `ok: ${report.ok}`,
        `latestDate: ${report.latestDate || ""}`,
        `rows: ${report.rows || 0}`,
        `strict: ${report.strict}`,
        ...(report.checks || []).map((check) => `- ${check.ok ? "OK" : "FAIL"} ${check.id}: ${check.message}`),
        "",
      ]),
    ].join("\n"), "utf8");
  }

  if (failed.length) {
    console.error("[scorecard-strategy-rules] failed");
    for (const item of failed.slice(0, 30)) {
      console.error(`- ${item.source} ${item.id}: ${item.message}`);
    }
    process.exit(1);
  }
  console.log(`[scorecard-strategy-rules] ok contract=${RULE_CONTRACT}`);
}

main().catch((error) => {
  console.error(`[scorecard-strategy-rules] failed: ${error.stack || error.message || error}`);
  process.exit(1);
});
