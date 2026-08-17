"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync, execFileSync } = require("child_process");
const {
  ROOT,
  LEGACY_ROOT_PATTERN,
  CONTRACT_VERSION,
  STRATEGY,
  RESULTS_TABLE,
  RUNS_TABLE,
  LATEST_VIEW,
  MIN_READY_SYMBOLS,
  taipeiDate,
  readJson,
  scanReceiptPath,
  lineReceiptPath,
} = require("./strategy3-v2-contract");

const tradeDate = process.argv.find((arg) => arg.startsWith("--trade-date="))?.slice("--trade-date=".length) || taipeiDate();
const compactDate = tradeDate.replace(/\D/g, "");
const productionApply = process.argv.includes("--apply");
const issues = [];

function add(condition, code, details = {}) {
  if (!condition) issues.push({ code, ...details });
}

function runNode(label, script, args = []) {
  const child = spawnSync(process.execPath, ["--use-system-ca", path.join(ROOT, "scripts", script), ...args], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    timeout: 120000,
  });
  return { label, exitCode: child.status, stdout: child.stdout, stderr: child.stderr };
}

function runTerminalLegacyApiProbe(date) {
  const probe = `
    const handler = require("./api/strategy3-latest.js");
    const result = {};
    const response = {
      headers: {},
      setHeader(key, value) { this.headers[key] = value; },
      status(code) { this.code = code; return this; },
      json(payload) {
        result.payload = payload;
        console.log(JSON.stringify({
          code: this.code,
          ok: payload && payload.ok,
          strategy: payload && payload.strategy,
          runId: payload && payload.runId,
          count: payload && (payload.count || payload.resultCount || (payload.rows || []).length),
          publishAllowed: payload && payload.publishAllowed,
          evidenceStatus: payload && payload.evidenceStatus,
          unattendedStatus: payload && payload.unattendedStatus,
          displayMode: payload && payload.terminalAuthority && payload.terminalAuthority.displayMode,
          firstCode: payload && payload.rows && payload.rows[0] && payload.rows[0].code
        }));
      },
    };
    Promise.resolve(handler({ query: { date: "${date}" }, url: "/api/strategy3-latest?date=${date}" }, response))
      .catch((error) => { console.error(error && (error.stack || error.message) || String(error)); process.exit(1); });
  `;
  const child = spawnSync(process.execPath, ["--use-system-ca", "-e", probe], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    timeout: 30000,
  });
  let payload = null;
  try { payload = JSON.parse(String(child.stdout || "").trim().split(/\r?\n/).pop() || "{}"); } catch {}
  return { label: "terminal_legacy_api", exitCode: child.status, stdout: child.stdout, stderr: child.stderr, payload };
}


function main() {
  const files = [
    "scripts/strategy3-v2-contract.js",
    "scripts/check-strategy3-v2-readiness.js",
    "scripts/run-strategy3-v2-complete-scan.js",
    "scripts/send-strategy3-v2-line-card.js",
    "scripts/verify-strategy3-v2-full-closure.js",
    "scripts/verify-strategy3-v2-water-universe.js",
    "scripts/verify-strategy3-v2-schema-contract.js",
    "scripts/verify-strategy3-v2-collector-boot-contract.js",
    "api/strategy3-v2-latest.js",
    "api/strategy3-latest.js",
    "run-strategy3-v2-complete-scan.ps1",
  ].map((file) => path.join(ROOT, file));

  for (const file of files) {
    add(fs.existsSync(file), "strategy3_v2_required_file_missing", { file });
    if (fs.existsSync(file) && !["strategy3-v2-contract.js", "verify-strategy3-v2-schema-contract.js"].includes(path.basename(file))) {
      const text = fs.readFileSync(file, "utf8");
      add(!LEGACY_ROOT_PATTERN.test(text), "strategy3_v2_file_contains_legacy_root", { file });
    }
  }

  for (const file of files.filter((file) => file.endsWith(".js"))) {
    try { execFileSync(process.execPath, ["--check", file], { cwd: ROOT, encoding: "utf8", windowsHide: true, timeout: 20000 }); }
    catch (error) { add(false, "strategy3_v2_node_check_failed", { file, error: String(error?.stderr || error?.message || "").slice(0, 500) }); }
  }

  const pkg = readJson(path.join(ROOT, "package.json"), {});
  add(Boolean(pkg.scripts?.["strategy3-v2:scan"]), "package_script_missing_strategy3_v2_scan");
  add(Boolean(pkg.scripts?.["verify:strategy3-v2-full-closure"]), "package_script_missing_strategy3_v2_closure");
  add(Boolean(pkg.scripts?.["strategy3-v2:line:dry-run"]), "package_script_missing_strategy3_v2_line_dry_run");
  add(Boolean(pkg.scripts?.["verify:strategy3-v2-water-universe"]), "package_script_missing_strategy3_v2_water_universe");
  add(Boolean(pkg.scripts?.["verify:strategy3-v2-schema-contract"]), "package_script_missing_strategy3_v2_schema_contract");
  add(Boolean(pkg.scripts?.["verify:strategy3-v2-collector-boot-contract"]), "package_script_missing_strategy3_v2_collector_boot_contract");

  const readinessRun = runNode("readiness", "check-strategy3-v2-readiness.js", [`--trade-date=${tradeDate}`]);
  const scanArgs = [`--trade-date=${tradeDate}`];
  if (productionApply) scanArgs.push("--apply");
  const scanRun = runNode("scan", "run-strategy3-v2-complete-scan.js", scanArgs);
  const lineRun = runNode("line_dry_run", "send-strategy3-v2-line-card.js", [`--trade-date=${tradeDate}`, "--dry-run"]);
  const waterUniverseRun = runNode("water_universe", "verify-strategy3-v2-water-universe.js", []);
  const schemaContractRun = runNode("schema_contract", "verify-strategy3-v2-schema-contract.js", []);
  const collectorBootRun = runNode("collector_boot_contract", "verify-strategy3-v2-collector-boot-contract.js", []);
  const terminalLegacyApiRun = runTerminalLegacyApiProbe(compactDate);
  const scanReceipt = readJson(scanReceiptPath(compactDate), {});
  const lineReceipt = readJson(lineReceiptPath(compactDate, ".dry-run"), {});

  add(scanReceipt.strategy === STRATEGY, "strategy3_v2_scan_receipt_strategy_mismatch", { value: scanReceipt.strategy });
  add(scanReceipt.contract === CONTRACT_VERSION, "strategy3_v2_scan_receipt_contract_mismatch", { value: scanReceipt.contract });
  add(scanReceipt.status === "FAIL_CLOSED" || scanReceipt.status === "COMPLETE", "strategy3_v2_scan_receipt_status_invalid", { value: scanReceipt.status });
  add(scanReceipt.run_id ? String(scanReceipt.run_id).startsWith("strategy3v2-") : scanReceipt.status === "FAIL_CLOSED", "strategy3_v2_runid_prefix_invalid", { run_id: scanReceipt.run_id });
  add(lineReceipt.strategy === STRATEGY, "strategy3_v2_line_receipt_strategy_mismatch", { value: lineReceipt.strategy });
  add(lineReceipt.line_card_design_contract?.title === "隔日沖參考", "strategy3_v2_line_title_mismatch");
  add(lineReceipt.line_card_design_contract?.layout === "white_stock_card_pink_panel_six_box", "strategy3_v2_line_layout_mismatch");
  add(schemaContractRun.exitCode === 0, "strategy3_v2_schema_contract_verifier_failed", { exitCode: schemaContractRun.exitCode });
  add(waterUniverseRun.exitCode === 0, "strategy3_v2_water_universe_verifier_failed", { exitCode: waterUniverseRun.exitCode });
  add(readinessRun.exitCode === 0, "strategy3_v2_readiness_verifier_failed", { exitCode: readinessRun.exitCode, stderr: String(readinessRun.stderr || "").slice(0, 500) });
  add(collectorBootRun.exitCode === 0, "strategy3_v2_collector_boot_contract_verifier_failed", { exitCode: collectorBootRun.exitCode });
  add(terminalLegacyApiRun.exitCode === 0, "strategy3_v2_terminal_legacy_api_probe_failed", { exitCode: terminalLegacyApiRun.exitCode, stderr: String(terminalLegacyApiRun.stderr || "").slice(0, 500) });
  add(terminalLegacyApiRun.payload?.strategy === STRATEGY, "strategy3_v2_terminal_legacy_api_not_v2", { payload: terminalLegacyApiRun.payload });
  add(terminalLegacyApiRun.payload?.runId === scanReceipt.run_id, "strategy3_v2_terminal_legacy_api_runid_mismatch", { apiRunId: terminalLegacyApiRun.payload?.runId, scanRunId: scanReceipt.run_id });
  add(Number(terminalLegacyApiRun.payload?.count || 0) === Number(scanReceipt.result_count || 0), "strategy3_v2_terminal_legacy_api_count_mismatch", { apiCount: terminalLegacyApiRun.payload?.count, scanCount: scanReceipt.result_count });
  add(terminalLegacyApiRun.payload?.publishAllowed === true, "strategy3_v2_terminal_legacy_api_publish_not_allowed", { payload: terminalLegacyApiRun.payload });
  add(terminalLegacyApiRun.payload?.evidenceStatus === "complete", "strategy3_v2_terminal_legacy_api_evidence_not_complete", { payload: terminalLegacyApiRun.payload });
  add(terminalLegacyApiRun.payload?.unattendedStatus === "YES", "strategy3_v2_terminal_legacy_api_unattended_not_yes", { payload: terminalLegacyApiRun.payload });
  add(JSON.stringify(lineReceipt).includes("strategy3_scan_results") === false || lineReceipt.status === "FAIL_CLOSED", "strategy3_v2_line_receipt_mentions_legacy_results");

  const payload = {
    ok: issues.length === 0,
    status: issues.length === 0 ? "STRATEGY3_V2_CLEAN_CHAIN_READY" : "STRATEGY3_V2_CLEAN_CHAIN_NOT_READY",
    contract: CONTRACT_VERSION,
    strategy: STRATEGY,
    trade_date: tradeDate,
    tables: { results: RESULTS_TABLE, runs: RUNS_TABLE, latestView: LATEST_VIEW },
    minimums: { candleReadySymbols: MIN_READY_SYMBOLS },
    stages: {
      readiness: { exitCode: readinessRun.exitCode },
      scan: { exitCode: scanRun.exitCode, receipt: scanReceiptPath(compactDate), status: scanReceipt.status || "" },
      lineDryRun: { exitCode: lineRun.exitCode, receipt: lineReceiptPath(compactDate, ".dry-run"), status: lineReceipt.status || "" },
      waterUniverse: { exitCode: waterUniverseRun.exitCode },
      schemaContract: { exitCode: schemaContractRun.exitCode },
      collectorBootContract: { exitCode: collectorBootRun.exitCode },
      terminalLegacyApi: { exitCode: terminalLegacyApiRun.exitCode, payload: terminalLegacyApiRun.payload },
    },
    issues,
  };
  console.log(JSON.stringify(payload, null, 2));
  process.exitCode = payload.ok ? 0 : 1;
}

main();