#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const terminalDir = process.argv.find((arg) => arg.startsWith("--terminal-dir="))?.slice("--terminal-dir=".length) || "C:/fuman-terminal";
const viewerPath = path.join(terminalDir, "ops", "Show-OpeningLimitOrderDetectionStatus.ps1");
const watcherPath = path.join(terminalDir, "ops", "Watch-OpeningLimitOrderDetectionStatus.ps1");
const packagePath = path.join(terminalDir, "package.json");
const builderPath = path.join(terminalDir, "scripts", "build-opening-limit-order-static-prefilter.js");
const failures = [];

function read(file) {
  try { return fs.readFileSync(file, "utf8"); }
  catch (error) {
    failures.push(`missing_or_unreadable:${file}:${error.message}`);
    return "";
  }
}

function parsePowerShell(file, label) {
  if (!fs.existsSync(file)) return;
  const escaped = file.replace(/'/g, "''");
  const parse = spawnSync("C:/Program Files/PowerShell/7/pwsh.exe", [
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-Command",
    `$code = Get-Content -LiteralPath '${escaped}' -Raw; [scriptblock]::Create($code) | Out-Null`
  ], { encoding: "utf8" });
  if (parse.status !== 0) {
    failures.push(`${label}_powershell_parse_failed:${(parse.stderr || parse.stdout || "").trim()}`);
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    return null;
  }
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function latestStaticPrefilterFile() {
  const dir = path.join("C:/fuman-runtime", "data", "opening-limit-order");
  try {
    const files = fs
      .readdirSync(dir)
      .filter((name) => /^opening-limit-order-0850-static-prefilter-\d{8}\.json$/.test(name))
      .sort()
      .reverse();
    return files.length ? path.join(dir, files[0]) : null;
  } catch (error) {
    return null;
  }
}

function tradeDateFromStaticPrefilter(file) {
  const match = String(file || "").match(/(\d{4})(\d{2})(\d{2})\.json$/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

function eligibleRowsFromStaticPrefilter(json) {
  const rows = toArray(json && json.rows);
  return rows.filter((row) => {
    const status = String(row && row.status || "");
    const eligibility = String(row && row.eligibility || "");
    return eligibility === "eligible" && (status === "STATIC_MATCH" || status === "CONDITIONALLY_READY");
  });
}

function getBrokerDetail(row) {
  const evidence = row && row.evidence ? row.evidence : {};
  return evidence.preferred_broker_top_net_buy_detail
    || evidence.overnight_detail
    || row.preferred_broker_top_net_buy_detail
    || row.overnight_detail
    || null;
}

function isMatchedMorganDetail(detail) {
  if (!detail || detail.matched !== true) return false;
  const key = String(detail.broker_key || "").toLowerCase();
  const name = String(detail.broker_name || detail.trader || detail.branch_name || "");
  return key === "morgan_stanley"
    || key === "jpmorgan"
    || /摩根士丹利|摩根大通|台灣摩根|morgan\s*stanley|jp\s*morgan/i.test(name);
}

function verifyRuntimeViewerSample() {
  const sample = {
    checked: false,
    static_prefilter_path: null,
    trade_date: null,
    eligible_rows: 0,
    rows_with_broker_detail: 0,
    matched_morgan_rows: 0,
    black_k_usable_leak_count: 0,
    viewer_exit_status: null,
    output_has_overnight_main_force_header: false,
    output_has_main_force_cost_header: false,
    output_has_any_main_force_label: false,
    output_has_morgan_alias_label: false
  };

  const file = latestStaticPrefilterFile();
  sample.static_prefilter_path = file;
  sample.trade_date = tradeDateFromStaticPrefilter(file);
  if (!file || !sample.trade_date) {
    failures.push("runtime_sample_missing:opening-limit-order-0850-static-prefilter");
    return sample;
  }

  const json = readJson(file);
  const eligibleRows = eligibleRowsFromStaticPrefilter(json);
  const detailRows = eligibleRows.filter((row) => getBrokerDetail(row));
  const matchedMorganRows = eligibleRows.filter((row) => isMatchedMorganDetail(getBrokerDetail(row)));
  const blackKUsableRows = eligibleRows.filter((row) => {
    const evidence = row && row.evidence ? row.evidence : {};
    const open = Number(evidence.open);
    const close = Number(evidence.close);
    return Number.isFinite(open) && Number.isFinite(close) && close < open;
  });
  sample.eligible_rows = eligibleRows.length;
  sample.rows_with_broker_detail = detailRows.length;
  sample.matched_morgan_rows = matchedMorganRows.length;
  sample.black_k_usable_leak_count = blackKUsableRows.length;

  const ps = "C:/Program Files/PowerShell/7/pwsh.exe";
  const escapedViewerPath = String(viewerPath).replace(/'/g, "''");
  const command = `[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new(); & '${escapedViewerPath}' -TradeDate '${sample.trade_date}' -All -Detail`;
  const run = spawnSync(ps, [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    command
  ], { encoding: "utf8", windowsHide: true, maxBuffer: 1024 * 1024 * 8 });

  sample.checked = true;
  sample.viewer_exit_status = run.status;
  const output = `${run.stdout || ""}\n${run.stderr || ""}`;
  sample.output_has_overnight_main_force_header = output.includes("隔日沖主力");
  sample.output_has_main_force_cost_header = output.includes("主力成本");
  sample.output_has_any_main_force_label = /(?:大摩|小摩)#\d+/.test(output);
  sample.output_has_morgan_alias_label = /(?:大摩|小摩)#\d+/.test(output);
  sample.output_has_non_morgan_main_force_label = /(?:台灣摩根|摩根士丹利|摩根大通|元大|富邦|凱基|國泰|永豐|群益|美商高盛|美林|土銀|台新)[^\s|]*#\d+/.test(output);

  if (run.status !== 0) failures.push(`viewer_runtime_sample_failed:${sample.trade_date}`);
  if (!sample.output_has_overnight_main_force_header) failures.push("viewer_missing_column:隔日沖主力");
  if (!sample.output_has_main_force_cost_header) failures.push("viewer_missing_column:主力成本");
  if (sample.output_has_non_morgan_main_force_label) failures.push("viewer_non_morgan_main_force_label_visible");
  if (blackKUsableRows.length > 0) failures.push(`static_prefilter_black_k_usable_leak:${blackKUsableRows.map((row) => row.symbol).slice(0, 20).join(",")}`);
  if (matchedMorganRows.length > 0 && !sample.output_has_morgan_alias_label) failures.push("viewer_missing_morgan_alias_labels");

  return sample;
}

const viewer = read(viewerPath);
const watcher = read(watcherPath);
const pkg = read(packagePath);
const builder = read(builderPath);

const requiredViewerMarkers = [
  "Opening Limit Order Detection Status",
  "[switch]$All",
  "date_source=$DateSource",
  "latest_available_trading_evidence",
  "Find-LatestOpeningEvidenceDateKey",
  "opening-limit-order-0850-static-prefilter",
  "opening_report_0830.industry_bias",
  "opening-limit-order-0840-pre-candidates",
  "opening-limit-order-0845-futopt-readback",
  "opening-limit-order-0855-watchlist",
  "opening-limit-order-0855-ranked-watchlist",
  "opening-limit-order-morning-readonly-",
  "opening-limit-order-closed-loop-readiness",
  "08:20 晨報產業加權",
  "08:45 股期/試撮證據",
  "08:55 watchlist fallback",
  "08:55 正式觀察排名",
  "STATIC_MATCH=$($staticMatchRows.Count)",
  "CONDITIONALLY_READY=$($conditionalReadyRows.Count)",
  "baseRowsReadback",
  "pending_morning_futopt_trial",
  "pending_strategy_numbers",
  "隔日沖主力",
  "主力成本",
  "Get-OvernightMainForceText",
  "Get-MainForceCostText",
  "return \"-\"",
  "formal_candidate=false",
  "publish=false",
  "allowed_action=watch_status_only",
  "forbidden_action=create_order|publish|formal_candidate",
];

const requiredWatcherMarkers = [
  "Opening Limit Order watcher started",
  "Opening Limit Order Watcher",
  "Show-OpeningLimitOrderDetectionStatus.ps1",
  "RefreshSeconds",
  "params.All",
  "params.Detail",
  "readonly=true",
  "creates_order=false",
  "formal_candidate=false",
  "publish=false",
  "Start-Sleep -Seconds $RefreshSeconds",
  "Press Ctrl+C to stop",
];

for (const marker of requiredViewerMarkers) {
  if (!viewer.includes(marker)) failures.push(`viewer_marker_missing:${marker}`);
}
for (const marker of requiredWatcherMarkers) {
  if (!watcher.includes(marker)) failures.push(`watcher_marker_missing:${marker}`);
}

const forbiddenReadonlyMarkers = [
  "Set-Content",
  "Out-File",
  "Add-Content",
  "New-Item",
  "Remove-Item",
  "Start-Process",
  "Run-OpeningLimitOrderMorningReadonly.ps1",
  "Run-OpeningLimitOrderMorningBacktestReadonly.ps1",
  "verify-opening-limit-order-candidate-readonly.js",
  "build-opening-limit-order-static-prefilter.js",
];

for (const marker of forbiddenReadonlyMarkers) {
  if (viewer.includes(marker)) failures.push(`viewer_must_be_readonly_forbidden_marker:${marker}`);
  if (watcher.includes(marker)) failures.push(`watcher_must_be_readonly_forbidden_marker:${marker}`);
}

if (!builder.includes("t_day_black_k_rejected") || !builder.includes("close < open")) {
  failures.push("builder_black_k_guard_missing");
}

if (!pkg.includes("\"verify:opening-limit-order-detection-status\"")) {
  failures.push("package_script_missing:verify:opening-limit-order-detection-status");
}

parsePowerShell(viewerPath, "viewer");
parsePowerShell(watcherPath, "watcher");

const runtimeSample = verifyRuntimeViewerSample();

console.log(JSON.stringify({
  ok: failures.length === 0,
  contract: "opening_limit_order_detection_status_viewer_v1",
  checked_at: new Date().toISOString(),
  viewer: viewerPath,
  watcher: watcherPath,
  runtime_sample: runtimeSample,
  guarantees: {
    readonly: true,
    creates_order: false,
    creates_formal_candidate: false,
    publish_allowed: false,
    shows_overnight_main_force: true,
    shows_main_force_cost: true,
    supports_all_rows: true,
    supports_continuous_watch: true,
    surfaces: [
      "night_static_shape_prefilter",
      "opening_report_industry_bias",
      "0840_pre_candidates",
      "0845_futopt_trial_readback",
      "0855_watchlist_fallback",
      "0855_ranked_watchlist",
      "morning_verifier",
      "closed_loop_readiness"
    ]
  },
  failed_checks: failures,
  first_blocker: failures[0] || null
}, null, 2));

process.exitCode = failures.length ? 1 : 0;




