"use strict";

const fs = require("fs");
const path = require("path");

const FIXTURE_FILE = path.join(__dirname, "..", "data", "fixtures", "strategy4-prewater-fixtures.json");
const REQUIRED_TOP_FIELDS = [
  "source_snapshot_captured_at",
  "source_status_at_run",
  "quote_coverage_at_run",
  "intraday_1m_readiness_at_run",
  "ma_readiness_at_run",
  "preopen_futopt_daily_readiness_at_run",
  "run_quality_at_publish",
  "fallbackUsed",
  "fallbackScope",
  "fallbackAllowed",
  "fallbackDetails",
  "fallbackContract",
  "degradedBlocksLatest",
  "preservePreviousGood",
  "writeBudget",
  "retentionOk",
  "evidenceStatus",
  "unattendedStatus",
  "requiredFields",
  "blankCounts",
  "sampleMissingRows",
  "blockedReason",
  "scanner_block_reason"
];

function readArg(name, fallback = "") {
  const prefix = `${name}=`;
  const found = process.argv.find((arg) => arg === name || arg.startsWith(prefix));
  if (!found) return fallback;
  return found === name ? "1" : found.slice(prefix.length);
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepMerge(base, overlay) {
  if (!overlay || typeof overlay !== "object" || Array.isArray(overlay)) return deepClone(overlay);
  const out = deepClone(base || {});
  for (const [key, value] of Object.entries(overlay)) {
    if (key === "$base") continue;
    if (value && typeof value === "object" && !Array.isArray(value) && out[key] && typeof out[key] === "object" && !Array.isArray(out[key])) {
      out[key] = deepMerge(out[key], value);
    } else {
      out[key] = deepClone(value);
    }
  }
  return out;
}

function loadFixtures() {
  const raw = JSON.parse(fs.readFileSync(FIXTURE_FILE, "utf8"));
  const resolve = (name, stack = []) => {
    if (!raw[name]) throw new Error(`unknown fixture ${name}`);
    if (stack.includes(name)) throw new Error(`fixture cycle ${stack.concat(name).join(" -> ")}`);
    const item = raw[name];
    if (!item.$base) return deepClone(item);
    return deepMerge(resolve(item.$base, stack.concat(name)), item);
  };
  return Object.fromEntries(Object.keys(raw).map((name) => [name, resolve(name)]));
}

function isBlank(value) {
  return value === undefined || value === null || value === "";
}

function sourceReady(payload) {
  return payload.source_status_at_run?.ok === true
    && payload.quote_coverage_at_run?.ok === true
    && payload.intraday_1m_readiness_at_run?.ok === true
    && payload.ma_readiness_at_run?.ok === true
    && payload.preopen_futopt_daily_readiness_at_run?.ok === true
    && !["insufficient", "degraded", "failed"].includes(String(payload.run_quality_at_publish?.status || ""));
}

function verify(name, payload) {
  const issues = [];
  for (const field of REQUIRED_TOP_FIELDS) {
    if (!(field in payload)) issues.push(`missing ${field}`);
  }
  if (isBlank(payload.source_snapshot_captured_at)) issues.push("missing source_snapshot_captured_at");
  if (isBlank(payload.evidenceStatus)) issues.push("missing evidenceStatus");
  if (isBlank(payload.unattendedStatus)) issues.push("missing unattendedStatus");
  if (!Array.isArray(payload.fallbackScope)) issues.push("fallbackScope must be array");
  if (!Array.isArray(payload.fallbackDetails)) issues.push("fallbackDetails must be array");
  if (isBlank(payload.fallbackContract)) issues.push("missing fallbackContract");

  if (payload.fallbackUsed === true) {
    if (!payload.fallbackScope.length) issues.push("fallback used without fallbackScope");
    if (!payload.fallbackDetails.length) issues.push("fallback used without fallbackDetails");
    if (payload.fallbackAllowed === true) issues.push("fallbackUsed=true must not be A-allowed for Strategy4 latest publish");
  }

  const ready = sourceReady(payload);
  const allowLatest = payload.writeBudget?.allowLatestWrite === true || payload.latestWriteAttempted === true;
  if (!ready && allowLatest) issues.push("source not ready but latest write allowed/attempted");
  if (payload.emptyResult === true && allowLatest) issues.push("empty result would overwrite previous good");
  if (!ready && payload.preservePreviousGood !== true) issues.push("not ready must preserve previous good");
  if (!ready && payload.degradedBlocksLatest !== true) issues.push("not ready must block latest");
  if (!ready && payload.blockedReceiptWritten !== true) issues.push("not ready must write blocked receipt");
  if (!ready && !["insufficient", "NO", "failed", "degraded"].includes(String(payload.evidenceStatus))) issues.push("not ready must have insufficient/NO evidenceStatus");
  if (!ready && payload.unattendedStatus === "YES") issues.push("unattendedStatus fake YES");
  if (ready && payload.unattendedStatus !== "YES") issues.push("ready fixture should be YES");

  return {
    fixture: name,
    ok: issues.length === 0,
    sourceReady: ready,
    issues
  };
}

function runCli() {
  const fixtures = loadFixtures();
  const requested = readArg("--fixture", "all");
  const names = requested === "all" ? Object.keys(fixtures) : [requested];
  const results = names.map((name) => verify(name, fixtures[name]));
  console.log(JSON.stringify({ ok: results.every((item) => item.ok), results }, null, 2));
  if (!results.every((item) => item.ok)) process.exit(1);
}

if (require.main === module) runCli();

module.exports = {
  REQUIRED_TOP_FIELDS,
  loadFixtures,
  sourceReady,
  verify
};
