"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto"), { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const commands = [
  ["--check", "scripts/run-daytrade-source-writer.js"],
  ["scripts/run-daytrade-source-writer.js", "--local-check"],
  ["scripts/test-daytrade-intraday-5m-source-lineage.js"],
  ["scripts/test-daytrade-intraday-5m-coverage-contract.js"],
  ["scripts/test-daytrade-five-minute-priority.js"],
  ["scripts/test-daytrade-industry-discovery-round.js"],
  ["scripts/test-daytrade-candle-priority-persistence.js"],
  ["scripts/verify-daytrade-mother-pool-closed-loop.js", "--static-only"]
];
const results = commands.map(args => {
  const r = spawnSync(process.execPath, args, { cwd: root, encoding: "utf8", windowsHide: true, timeout: 60000 });
  return { command: "node " + args.join(" "), exit_code: r.status, passed: r.status === 0,
    stdout: r.stdout || "", stderr: r.stderr || "", error: r.error?.message || null };
});
const failed = results.filter(r => !r.passed).map(r => r.command);
const source = "scripts/run-daytrade-source-writer.js";
const receipt = { contract: "daytrade_intraday_integration_isolated_v1", checked_at: new Date().toISOString(),
  scope: "isolated_contract_tests_only", status: failed.length ? "failed" : "complete", complete: !failed.length,
  exit_code: failed.length ? 1 : 0, failed_checks: failed, first_blocker: failed[0] || null,
  writer_sha256: crypto.createHash("sha256").update(fs.readFileSync(path.join(root, source))).digest("hex"),
  results, production_deployed: false, natural_batches_verified: false, all_19_items_complete: false };
const output = path.join(root, "outputs/daytrade-intraday-integration-isolated-receipt.json");
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(receipt, null, 2) + "\n");
console.log(JSON.stringify({ ...receipt, results: results.map(({stdout, stderr, ...r}) => r), receipt_path: output }, null, 2));
process.exitCode = receipt.exit_code;
