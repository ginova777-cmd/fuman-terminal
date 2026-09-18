const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const RUNNER = path.join(ROOT, "scripts", "run-strategy3-v2-isolated-backtest.js");
const args = process.argv.slice(2);
const artifactArg = args.find((arg) => arg.startsWith("--artifact="));
const requiredSafetyTokens = [
  'backtest_only: true',
  'formal_allowed: false',
  'publish_allowed: false',
  'line_allowed: false',
  'supabase_write_allowed: false',
  'formal_receipt_write_allowed: false',
  '"fugle_historical_candles"',
  '"DATA_GAP"',
  '"historical_candle_fetch_failed"',
];

const source = fs.readFileSync(RUNNER, "utf8");
const checks = {
  runner_exists: fs.existsSync(RUNNER),
  safety_contract_present: requiredSafetyTokens.every((token) => source.includes(token)),
  no_supabase_endpoint: !/supabase\.co|\/rest\/v1\//i.test(source),
  no_line_publish: !/line[_-]?notify|line[_-]?push|messaging-api/i.test(source),
  no_formal_scan_receipt_path: !/scan-receipts/i.test(source),
  only_backtest_output_path: source.includes('"data", "backtest", "strategy3-v2"'),
};

if (artifactArg) {
  const artifactPath = path.resolve(artifactArg.slice("--artifact=".length));
  try {
    const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
    checks.artifact_backtest_only = artifact.backtest_only === true;
    checks.artifact_formal_blocked = artifact.formal_allowed === false && artifact.publish_allowed === false && artifact.line_allowed === false;
    checks.artifact_supabase_blocked = artifact.supabase_write_allowed === false && artifact.formal_receipt_write_allowed === false;
    checks.artifact_data_gap_contract = Array.isArray(artifact.symbols) && artifact.symbols.every((row) => row.status === "READY_FOR_BACKTEST" || row.status === "DATA_GAP");
  } catch (error) {
    checks.artifact_readable = false;
    checks.artifact_error = error.message || String(error);
  }
}

const failed_checks = Object.entries(checks).filter(([, ok]) => ok !== true).map(([name]) => name);
console.log(JSON.stringify({
  ok: failed_checks.length === 0,
  contract: "strategy3_v2_isolated_backtest_v1",
  runner: RUNNER,
  checks,
  failed_checks,
  first_blocker: failed_checks[0] || null,
  read_only: true,
}, null, 2));
process.exitCode = failed_checks.length ? 1 : 0;
