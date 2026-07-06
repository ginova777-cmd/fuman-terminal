const fs = require("fs");
const path = require("path");
const { verifyStrategy3PrewaterPayload } = require("./strategy3-prewater-payload-verifier");

const ROOT = path.resolve(__dirname, "..");
const FIXTURE_DIR = path.join(ROOT, "fixtures", "strategy3-prewater");

const REQUIRED_FIELDS = [
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
  "scanner_block_reason",
];

function parseArgs(argv) {
  const flags = new Set();
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const body = arg.slice(2);
    const splitAt = body.indexOf("=");
    if (splitAt >= 0) values.set(body.slice(0, splitAt), body.slice(splitAt + 1));
    else if (argv[index + 1] && !argv[index + 1].startsWith("--")) values.set(body, argv[index + 1]);
    else flags.add(body);
  }
  return { flags, values };
}

function isBlank(value) {
  return value === null
    || value === undefined
    || value === ""
    || (Array.isArray(value) && value.length === 0);
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function verifyFixture(name) {
  const file = path.join(FIXTURE_DIR, `${name}.json`);
  const doc = JSON.parse(fs.readFileSync(file, "utf8"));
  const payload = doc.payload || {};
  const result = verifyStrategy3PrewaterPayload(payload, {
    label: name,
    expectBlocked: doc.expectedBlocked === true,
  });
  const issues = result.issues.slice();

  for (const field of REQUIRED_FIELDS) {
    if (!hasOwn(payload, field)) issues.push(`missing_${field}`);
  }
  for (const field of [
    "source_snapshot_captured_at",
    "source_status_at_run",
    "quote_coverage_at_run",
    "intraday_1m_readiness_at_run",
    "ma_readiness_at_run",
    "preopen_futopt_daily_readiness_at_run",
    "run_quality_at_publish",
  ]) {
    if (isBlank(payload[field])) issues.push(`blank_${field}`);
  }

  if (doc.expectedBlocked === true) {
    if (!payload.blockedReceipt) issues.push("blocked_fixture_missing_blocked_receipt");
  }

  return {
    ok: issues.length === 0,
    fixture: name,
    expectedBlocked: doc.expectedBlocked === true,
    latestBlocked: result.latestBlocked,
    preservePreviousGood: result.preservePreviousGood,
    evidenceStatus: payload.evidenceStatus || "",
    unattendedStatus: payload.unattendedStatus || "",
    issues,
  };
}

function fixtureNames(args) {
  if (args.flags.has("all")) {
    return fs.readdirSync(FIXTURE_DIR)
      .filter((name) => name.endsWith(".json"))
      .map((name) => name.replace(/\.json$/i, ""))
      .sort();
  }
  const name = args.values.get("fixture");
  if (!name) throw new Error("usage: node scripts/verify-strategy3-prewater-fixtures.js --all|--fixture ready");
  return [name];
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const results = fixtureNames(args).map(verifyFixture);
  const issues = results.flatMap((result) => result.issues.map((issue) => `${result.fixture}:${issue}`));
  const payload = {
    ok: issues.length === 0,
    checkedAt: new Date().toISOString(),
    fixtureDir: FIXTURE_DIR,
    count: results.length,
    results,
    issues,
  };
  console.log(JSON.stringify(payload, null, 2));
  if (!payload.ok) process.exitCode = 1;
}

try {
  main();
} catch (error) {
  console.error(`[strategy3-prewater-fixtures] failed: ${error.message || String(error)}`);
  process.exitCode = 1;
}
