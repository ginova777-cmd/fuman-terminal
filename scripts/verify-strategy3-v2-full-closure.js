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
  MOTHER_POOL_VIEW,
  MOTHER_POOL_RECEIPT_VIEW,
  taipeiDate,
  readJson,
  scanReceiptPath,
  lineReceiptPath,
} = require("./strategy3-v2-contract");

const tradeDate = process.argv.find((arg) => arg.startsWith("--trade-date="))?.slice("--trade-date=".length) || taipeiDate();
const compactDate = tradeDate.replace(/\D/g, "");
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

function main() {
  add(ROOT === path.resolve(__dirname, ".."), "strategy3_v2_root_not_self_derived", { root: ROOT });
  for (const retired of [
    "run-strategy3-battle-verify.ps1",
    "scripts/verify-strategy3-battle-state.js",
    "scripts/verify-strategy3-alert-path.js",
    "install-strategy3-battle-tasks.ps1",
    "api/strategy3-latest.shared-probe-legacy.js",
    "run-strategy3.ps1",
    "run-strategy3-complete-scan.ps1",
    "run-strategy3-ready-snapshot.ps1",
    "run-strategy3-watchdog.ps1",
    "run-daytrade-strategy3-closure-verify.ps1",
    "scripts/scan-strategy3-cache.js",
    "scripts/strategy3-business-field-contract.js",
    "scripts/strategy3-prewater-payload-verifier.js",
    "scripts/verify-daytrade-strategy3-closure-live.js",
    "scripts/verify-strategy3-water-scan-surface-scorecard.js",
    "scripts/repair-strategy3-v2-water-metadata.js",
  ]) {
    add(!fs.existsSync(path.join(ROOT, retired)), "strategy3_v2_retired_verifier_still_exists", { file: retired });
  }
  const files = [
    "scripts/strategy3-v2-contract.js",
    "scripts/check-strategy3-v2-readiness.js",
    "scripts/run-strategy3-v2-complete-scan.js",
    "scripts/send-strategy3-v2-line-card.js",
    "scripts/verify-strategy3-v2-full-closure.js",
    "scripts/verify-strategy3-v2-1255-first-attempt.js",
    "scripts/verify-strategy3-v2-water-universe.js",
    "scripts/verify-strategy3-v2-mother-pool-v4-1-scan-contract.js",
    "lib/strategy3-technical-trend-reader.js",
    "scripts/verify-strategy3-technical-trend-contract.js",
    "lib/strategy3-atr-rvol-reader.js",
    "scripts/verify-strategy3-atr-rvol-contract.js",
    "scripts/verify-strategy3-recovery-replay-complete.js",
    "scripts/verify-strategy3-v2-daily-unattended-closure.js",
    "scripts/verify-strategy3-v2-schema-contract.js",
    "api/strategy3-v2-latest.js",
    "api/strategy3-latest.js",
    "run-strategy3-v2-complete-scan.ps1",
    "run-strategy3-v2-1255-first-attempt.ps1",
    "run-strategy3-v2-readiness-guard.ps1",
    "scripts/verify-strategy3-v2-surface-closure.js",
    "scripts/retire-strategy3-legacy-authority.js",
    "ops/public-slot/Strategy3LegacyAuthorityRetirement_20260908.sql",
  ].map((file) => path.join(ROOT, file));

  for (const file of files) {
    add(fs.existsSync(file), "strategy3_v2_required_file_missing", { file });
    if (fs.existsSync(file) && !["strategy3-v2-contract.js", "verify-strategy3-v2-schema-contract.js"].includes(path.basename(file))) {
      const text = fs.readFileSync(file, "utf8");
      add(!LEGACY_ROOT_PATTERN.test(text), "strategy3_v2_file_contains_legacy_root", { file });
    }
  }

  for (const relative of ["scripts/check-strategy3-v2-readiness.js", "scripts/run-strategy3-v2-complete-scan.js", "scripts/verify-strategy3-v2-water-universe.js"]) {
    const file = path.join(ROOT, relative);
    const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    add(text.includes("readCanonicalDaytradeWater"), "strategy3_v2_v4_1_reader_missing", { file });
    add(text.includes("strategy3Consumer: true"), "strategy3_v2_v4_1_consumer_profile_missing", { file });
    add(!text.includes("fugle-daytrade-ws-priority-symbols.json"), "strategy3_v2_local_mother_pool_cache_still_formal", { file });
    add(!text.includes("fugle-daytrade-ws-candles-v2.json"), "strategy3_v2_local_candle_cache_still_formal", { file });
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
  add(Boolean(pkg.scripts?.["verify:strategy3-v2-mother-pool-v4-1-scan-contract"]), "package_script_missing_strategy3_v2_mother_pool_v4_1_scan_contract");
  add(Boolean(pkg.scripts?.["verify:strategy3-v2-technical-trend"]), "package_script_missing_strategy3_v2_technical_trend");
  add(Boolean(pkg.scripts?.["verify:strategy3-v2-atr-rvol"]), "package_script_missing_strategy3_v2_atr_rvol");
  add(Boolean(pkg.scripts?.["verify:strategy3-v2-recovery-complete"]), "package_script_missing_strategy3_v2_recovery_complete");
  add(Boolean(pkg.scripts?.["verify:strategy3-v2-schema-contract"]), "package_script_missing_strategy3_v2_schema_contract");
  add(Boolean(pkg.scripts?.["verify:strategy3-v2-legacy-retirement"]), "package_script_missing_strategy3_v2_legacy_retirement");

  const readerText = fs.readFileSync(path.join(ROOT, "lib", "daytrade-canonical-water-reader.js"), "utf8");
  add(readerText.includes(`const MOTHER_POOL_VIEW = "${MOTHER_POOL_VIEW}"`), "strategy3_v2_mother_pool_v4_1_source_missing");
  add(readerText.includes(`const MOTHER_POOL_RECEIPT_VIEW = "${MOTHER_POOL_RECEIPT_VIEW}"`), "strategy3_v2_mother_pool_v4_1_receipt_missing");
  add(readerText.includes('order: "symbol.asc"') && readerText.includes("pageSize: 200"), "strategy3_v2_mother_pool_v4_1_paging_contract_missing");
  const terminalResourceText = fs.readFileSync(path.join(ROOT, "scripts", "verify-terminal-resource-chain.js"), "utf8");
  add(terminalResourceText.includes('runView: { table: "v_strategy3_v2_latest_complete_run", strategy: "strategy3_v2" }'), "strategy3_v2_tri_surface_still_reads_legacy_run_view");
  add(terminalResourceText.includes('resultTable: "strategy3_v2_scan_results"'), "strategy3_v2_tri_surface_result_table_missing");
  const scorecardSourceText = fs.readFileSync(path.join(ROOT, "scripts", "generate-terminal-scorecard-source.js"), "utf8");
  add(scorecardSourceText.includes('process.env.STRATEGY3_V2_RUNS_TABLE || "strategy3_v2_scan_runs"'), "strategy3_v2_scorecard_still_reads_legacy_runs");
  add(scorecardSourceText.includes('process.env.STRATEGY3_V2_RESULTS_TABLE || "strategy3_v2_scan_results"'), "strategy3_v2_scorecard_still_reads_legacy_results");
  add(scorecardSourceText.includes('strategy3: "策略3隔日沖成績單"'), "strategy3_v2_scorecard_scope_label_mismatch");
  add(scorecardSourceText.includes("mother_pool_v4_1+intraday_1m_rpc_evidence"), "strategy3_v2_scorecard_v4_1_evidence_missing");
  add(!scorecardSourceText.includes("STRATEGY3_SUPABASE_1M_TABLE"), "strategy3_v2_scorecard_still_reads_retired_direct_1m_table");
  const finalizerText = fs.readFileSync(path.join(ROOT, "scripts", "finalize-strategy3-complete.js"), "utf8");
  add(finalizerText.includes("triSurfaceStatus") && finalizerText.includes("scorecardRunId") && finalizerText.includes("awaiting_scorecard_1315"), "strategy3_v2_final_receipt_missing_scorecard_closure_contract");
  const runnerText = fs.readFileSync(path.join(ROOT, "run-strategy3-v2-complete-scan.ps1"), "utf8");
  add(runnerText.includes("[switch]$Recovery") && runnerText.includes("scan and LINE push are not repeated"), "strategy3_v2_audited_recovery_contract_missing");

  const singleAuthorityFiles = [
    "api/strategy3-latest.js",
    "api/scorecard.js",
    "api/terminal-home.js",
    "run-full-scan.ps1",
    "run-live-freshness-gate.ps1",
    "scripts/run-daytrade-source-writer.js",
    "scripts/run-terminal-auto-roll-forward.js",
    "scripts/generate-terminal-scorecard-source.js",
    "ops/public-slot/Run-PublicSlotSharedSource.ps1",
  ];
  const retiredAuthorityMarkers = [
    "v_strategy3_latest_complete_run",
    "strategy3_scan_results",
    "strategy3_scan_runs",
    "scan-strategy3-cache.js",
    "run-strategy3-complete-scan.ps1",
    "strategy3-latest.shared-probe-legacy.js",
  ];
  for (const relative of singleAuthorityFiles) {
    const text = fs.readFileSync(path.join(ROOT, relative), "utf8");
    for (const marker of retiredAuthorityMarkers) {
      add(!text.includes(marker), "strategy3_v2_retired_authority_reference_present", { file: relative, marker });
    }
  }

  const readinessRun = runNode("readiness", "check-strategy3-v2-readiness.js", [`--trade-date=${tradeDate}`]);
  // Verifiers are read-only. They must never rerun the scanner or rewrite receipts.
  const surfaceRun = runNode("surface", "verify-strategy3-v2-surface-closure.js", [`--trade-date=${tradeDate}`]);
  const waterUniverseRun = runNode("water_universe", "verify-strategy3-v2-water-universe.js", [`--trade-date=${tradeDate}`]);
  const motherPoolV41ScanContractRun = runNode("mother_pool_v4_1_scan_contract", "verify-strategy3-v2-mother-pool-v4-1-scan-contract.js", []);
  const technicalTrendContractRun = runNode("technical_trend_contract", "verify-strategy3-technical-trend-contract.js", []);
  const atrRvolContractRun = runNode("atr_rvol_contract", "verify-strategy3-atr-rvol-contract.js", []);
  const schemaContractRun = runNode("schema_contract", "verify-strategy3-v2-schema-contract.js", []);
  const legacyRetirementRun = runNode("legacy_retirement", "retire-strategy3-legacy-authority.js", ["--no-write"]);
  const scanReceipt = readJson(scanReceiptPath(compactDate), {});
  const lineReceipt = readJson(lineReceiptPath(compactDate, ".dry-run"), {});

  add(scanReceipt.strategy === STRATEGY, "strategy3_v2_scan_receipt_strategy_mismatch", { value: scanReceipt.strategy });
  add(scanReceipt.contract === CONTRACT_VERSION, "strategy3_v2_scan_receipt_contract_mismatch", { value: scanReceipt.contract });
  add(scanReceipt.status === "FAIL_CLOSED" || scanReceipt.status === "COMPLETE", "strategy3_v2_scan_receipt_status_invalid", { value: scanReceipt.status });
  add(scanReceipt.run_id ? String(scanReceipt.run_id).startsWith("strategy3v2-") : scanReceipt.status === "FAIL_CLOSED", "strategy3_v2_runid_prefix_invalid", { run_id: scanReceipt.run_id });
  add(lineReceipt.strategy === STRATEGY, "strategy3_v2_line_receipt_strategy_mismatch", { value: lineReceipt.strategy });
  add(lineReceipt.line_card_design_contract?.title === "隔日沖參考", "strategy3_v2_line_title_mismatch");
  add(lineReceipt.line_card_design_contract?.layout === "white_stock_card_pink_panel_six_box", "strategy3_v2_line_layout_mismatch");
  const scanFailedClosed = String(scanReceipt.status || "").toUpperCase() === "FAIL_CLOSED";
  add(schemaContractRun.exitCode === 0, "strategy3_v2_schema_contract_verifier_failed", { exitCode: schemaContractRun.exitCode });
  add(motherPoolV41ScanContractRun.exitCode === 0, "strategy3_v2_mother_pool_v4_1_scan_contract_failed", { exitCode: motherPoolV41ScanContractRun.exitCode });
  add(technicalTrendContractRun.exitCode === 0, "strategy3_v2_technical_trend_contract_failed", { exitCode: technicalTrendContractRun.exitCode });
  add(atrRvolContractRun.exitCode === 0, "strategy3_v2_atr_rvol_contract_failed", { exitCode: atrRvolContractRun.exitCode });
  add(legacyRetirementRun.exitCode === 0, "strategy3_v2_legacy_retirement_verifier_failed", { exitCode: legacyRetirementRun.exitCode, stderr: String(legacyRetirementRun.stderr || "").slice(0, 500) });
  add(surfaceRun.exitCode === 0, "strategy3_v2_surface_verifier_failed", { exitCode: surfaceRun.exitCode, stderr: String(surfaceRun.stderr || "").slice(0, 500) });
  if (scanFailedClosed) {
    add(lineReceipt.status === "FAIL_CLOSED", "strategy3_v2_fail_closed_surface_not_safe", { lineStatus: lineReceipt.status });
  } else {
    add(waterUniverseRun.exitCode === 0, "strategy3_v2_water_universe_verifier_failed", { exitCode: waterUniverseRun.exitCode });
    add(readinessRun.exitCode === 0, "strategy3_v2_readiness_verifier_failed", { exitCode: readinessRun.exitCode, stderr: String(readinessRun.stderr || "").slice(0, 500) });
  }
  add(JSON.stringify(lineReceipt).includes("strategy3_scan_results") === false || lineReceipt.status === "FAIL_CLOSED", "strategy3_v2_line_receipt_mentions_legacy_results");

  const payload = {
    ok: issues.length === 0,
    status: issues.length === 0
      ? (scanFailedClosed ? "STRATEGY3_V2_FAIL_CLOSED_SAFE" : "STRATEGY3_V2_CLEAN_CHAIN_READY")
      : "STRATEGY3_V2_CLEAN_CHAIN_NOT_READY",
    contract: CONTRACT_VERSION,
    strategy: STRATEGY,
    trade_date: tradeDate,
    tables: { results: RESULTS_TABLE, runs: RUNS_TABLE, latestView: LATEST_VIEW },
    minimums: {
      motherPoolExpectedSymbols: Number(scanReceipt?.scanner_summary?.formal_ready_target || 0),
      motherPoolRequiredReadySymbols: Math.ceil(Number(scanReceipt?.scanner_summary?.formal_ready_target || 0) * Number(scanReceipt?.scanner_summary?.minimum_mother_pool_coverage_ratio || 0.9)),
      sourceContractVersion: scanReceipt?.source_contract_version || null,
    },
    stages: {
      readiness: { exitCode: readinessRun.exitCode },
      scan: { exitCode: null, readOnly: true, receipt: scanReceiptPath(compactDate), status: scanReceipt.status || "" },
      lineDryRun: { exitCode: null, readOnly: true, receipt: lineReceiptPath(compactDate, ".dry-run"), status: lineReceipt.status || "" },
      waterUniverse: { exitCode: waterUniverseRun.exitCode },
      motherPoolV41ScanContract: { exitCode: motherPoolV41ScanContractRun.exitCode },
      technicalTrendContract: { exitCode: technicalTrendContractRun.exitCode },
      schemaContract: { exitCode: schemaContractRun.exitCode },
      legacyRetirement: { exitCode: legacyRetirementRun.exitCode },
      surface: { exitCode: surfaceRun.exitCode },
      mode: scanFailedClosed ? "fail_closed_safe" : "formal_complete",
      blocker: scanFailedClosed ? (scanReceipt.reason_code || scanReceipt.status || "source_not_ready") : "",
    },
    issues,
  };
  console.log(JSON.stringify(payload, null, 2));
  process.exitCode = payload.ok ? 0 : 1;
}

main();
