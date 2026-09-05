"use strict";

const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");

const ROOT = "C:\\fuman-release-owner\\fuman-terminal";
const RUNTIME = process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime";
const REPORT_DIR = path.join(RUNTIME, "data", "opening-report-0830");
const STATE_DIR = path.join(RUNTIME, "state");

const CONTRACT = "opening-report-morning-single-verifier-v1";
const SINGLE_VERIFIER_SCRIPT = "scripts/verify-opening-report-morning-contract.js";
const SINGLE_VERIFIER_CMD = "node --use-system-ca " + SINGLE_VERIFIER_SCRIPT;
const RETIRED_TELEGRAM_SCRIPT = path.join(ROOT, "scripts", "verify-opening-report-0830-telegram-contract.js");
const RETIRED_TELEGRAM_PACKAGE_KEY = "verify:opening-report-0830-telegram-contract";

const RETIRED_ALIASES = [
  "verify:opening-report-0820-preflight",
  "verify:opening-report-0830-contract",
  "verify:opening-report-0830-bridge-handoff",
  "verify:opening-report-0830-terminal-briefing",
  "verify:opening-report-0830-delivery-chain",
  "verify:opening-report-0830-unattended-readiness",
  "verify:opening-report-0830-production:line",
  "verify:opening-report-0830-briefing-only-live",
];

const REQUIRED_INDUSTRIES = [
  "AI_GPU_CLOUD",
  "AWS_AI_DATACENTER",
  "FOUNDRY_ADVANCED_PROCESS",
  "IC_DESIGN",
  "MEMORY",
  "ABF_SUBSTRATE",
  "PCB_CCL",
  "PASSIVE_COMPONENTS",
  "THERMAL_POWER",
  "NETWORK_HIGH_SPEED",
  "OPTICAL_COMM",
  "III_V_OPTICAL",
  "ROBOTICS_AUTOMATION",
  "PANEL",
  "APPLE_CONSUMER",
];

function compactDate(input) {
  return String(input || "").replace(/-/g, "");
}

function defaultTradeDate() {
  const now = new Date();
  const taipei = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return taipei;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { tradeDate: defaultTradeDate(), requireCurrent: false, phase: "static" };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--require-current") {
      out.requireCurrent = true;
      out.phase = "delivery";
    } else if (arg === "--pre-delivery" || arg === "--phase=preflight" || arg === "--phase=pre-delivery") {
      out.phase = "preflight";
    } else if (arg === "--trade-date" && args[i + 1]) {
      out.tradeDate = args[i + 1];
      i += 1;
    } else if (arg.startsWith("--trade-date=")) {
      out.tradeDate = arg.slice("--trade-date=".length);
    }
  }
  if (/^\d{8}$/.test(out.tradeDate)) {
    out.tradeDate = out.tradeDate.slice(0, 4) + "-" + out.tradeDate.slice(4, 6) + "-" + out.tradeDate.slice(6, 8);
  }
  return out;
}

function currentPreflightReceiptChecks(checks, tradeDate) {
  const ymd = compactDate(tradeDate);
  const paths = {
    preflight: path.join(REPORT_DIR, "opening-report-0820-preflight-receipt-" + ymd + ".json"),
    leaders: path.join(REPORT_DIR, "opening-report-0820-overseas-leaders-" + ymd + ".json"),
    snapshot: path.join(REPORT_DIR, "opening-report-0820-market-snapshot-" + ymd + ".json"),
  };
  for (const [key, filePath] of Object.entries(paths)) {
    addCheck(checks, "current_preflight_receipt_exists:" + key, exists(filePath), filePath);
  }
  if (!Object.values(paths).every(exists)) return;
  const preflight = readJson(paths.preflight);
  const leaders = readJson(paths.leaders);
  const snapshot = readJson(paths.snapshot);
  const industries = leaders.industries || leaders.industry_bias || leaders.rows || leaders.overseas_industries || [];
  addCheck(checks, "current_preflight_ok", preflight.ok === true && ["REPORT_OK", "REPORT_DEGRADED"].includes(preflight.report_status), JSON.stringify({ ok: preflight.ok, report_status: preflight.report_status }));
  addCheck(checks, "current_preflight_15_industries", Array.isArray(industries) && industries.length === 15, "count=" + (Array.isArray(industries) ? industries.length : "not-array"));
  addCheck(checks, "current_preflight_snapshot_ok", snapshot.ok === true && (snapshot.date === tradeDate || snapshot.trade_date === tradeDate), JSON.stringify({ ok: snapshot.ok, date: snapshot.date, trade_date: snapshot.trade_date }));
}

function readText(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function exists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function run(command, args) {
  const result = childProcess.spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    shell: false,
    timeout: 15000,
  });
  return { ok: result.status === 0, text: (result.stdout || "") + "\n" + (result.stderr || "") };
}

function addCheck(checks, name, ok, detail) {
  checks.push({
    name,
    ok: Boolean(ok),
    detail: detail == null ? "" : String(detail),
  });
}

function loadIndustryContract() {
  const mod = require(path.join(ROOT, "scripts", "opening-report-0830-industry-map-contract.js"));
  return mod;
}

function getIndustryRow(contract, industry) {
  const rows = contract.OPENING_REPORT_0830_INDUSTRY_MAP || contract.INDUSTRY_MAP || contract.industryMap || [];
  return rows.find((row) => row.industry === industry || row.id === industry || row.key === industry);
}

function hasSymbol(list, symbol) {
  return Array.isArray(list) && list.some((value) => String(value?.symbol || value?.yahoo_symbol || value?.yahooSymbol || value?.name || value).includes(symbol));
}

function symbolMapChecks(checks) {
  const contract = loadIndustryContract();
  const rows = contract.OPENING_REPORT_0830_INDUSTRY_MAP || contract.INDUSTRY_MAP || contract.industryMap || [];
  addCheck(checks, "industry_contract_15_rows", rows.length === REQUIRED_INDUSTRIES.length && REQUIRED_INDUSTRIES.every((industry) => getIndustryRow(contract, industry)), "required=" + REQUIRED_INDUSTRIES.length + " actual=" + rows.length);
  const classification = typeof contract.validateIndustryMapContract === "function" ? contract.validateIndustryMapContract(rows) : { ok: false, issues: ["validator_missing"] };
  addCheck(checks, "industry_tier_a_b_classification_complete", classification.ok === true, JSON.stringify(classification.issues || []));

  const pcb = getIndustryRow(contract, "PCB_CCL") || {};
  const iiiV = getIndustryRow(contract, "III_V_OPTICAL") || {};
  addCheck(checks, "manual_mapping_8358_pcb_ccl_a", hasSymbol(pcb.tw_a || pcb.twA || pcb.a || pcb.mapped_symbols_a, "8358"), "8358 must be PCB/CCL A");
  addCheck(checks, "manual_mapping_8039_pcb_ccl_b", hasSymbol(pcb.tw_b || pcb.twB || pcb.b || pcb.mapped_symbols_b, "8039"), "8039 must be PCB/CCL B");
  addCheck(checks, "manual_mapping_4991_iii_v_related_b", hasSymbol(iiiV.tw_b || iiiV.twB || iiiV.b || iiiV.mapped_symbols_b, "4991"), "4991 must be III-V/optical related B");
  addCheck(checks, "manual_mapping_3105_iii_v_a", hasSymbol(iiiV.tw_a || iiiV.twA || iiiV.a || iiiV.mapped_symbols_a, "3105"), "3105 must be III-V/optical A");

  const passive = getIndustryRow(contract, "PASSIVE_COMPONENTS") || {};
  const passiveLeaders = passive.overseas_leaders || passive.overseasLeaders || passive.leaders || [];
  addCheck(checks, "passive_components_anchor_only_murata", passiveLeaders.length === 1 && hasSymbol(passiveLeaders, "6981.T"), JSON.stringify(passiveLeaders));

  const optical = getIndustryRow(contract, "OPTICAL_COMM") || {};
  const opticalLeaders = optical.overseas_leaders || optical.overseasLeaders || optical.leaders || [];
  const opticalRequired = ["COHR", "LITE", "CIEN", "AAOI", "GLW"];
  addCheck(checks, "optical_us_leaders_include_required", opticalRequired.every((symbol) => hasSymbol(opticalLeaders, symbol)), JSON.stringify(opticalLeaders));

  const contractText = readText("scripts/opening-report-0830-industry-map-contract.js");
  const forbidden = ["6967.T", "WCI", "SCFI", "BDI"];
  addCheck(checks, "forbidden_overseas_sources_excluded", forbidden.every((token) => !contractText.includes(token) || contractText.includes("FORBIDDEN_OVERSEAS_LEADERS")), "forbidden=" + forbidden.join(","));
}

function staticContractChecks(checks) {
  const pkg = readJson(path.join(ROOT, "package.json"));
  addCheck(checks, "single_morning_verifier_package_entry", pkg.scripts && pkg.scripts["verify:opening-report-morning-contract"] === SINGLE_VERIFIER_CMD, pkg.scripts && pkg.scripts["verify:opening-report-morning-contract"]);
  for (const alias of RETIRED_ALIASES) {
    addCheck(checks, "retired_alias_absent:" + alias, !(pkg.scripts && pkg.scripts[alias]), alias);
  }
  addCheck(checks, "retired_telegram_package_entry_absent", !(pkg.scripts && pkg.scripts[RETIRED_TELEGRAM_PACKAGE_KEY]), RETIRED_TELEGRAM_PACKAGE_KEY);
  addCheck(checks, "retired_telegram_contract_file_absent", !exists(RETIRED_TELEGRAM_SCRIPT), RETIRED_TELEGRAM_SCRIPT);

  const selfCheck = run("node", ["--check", SINGLE_VERIFIER_SCRIPT]);
  addCheck(checks, "single_verifier_syntax_check", selfCheck.ok, selfCheck.text.trim());

  const detector = readText("scripts/run-opening-report-0830-overseas-leader-detector.js");
  addCheck(checks, "us_equities_use_0820_prepost_not_previous_close_only", detector.includes("includePrePost") && detector.includes("us_overnight_after_hours") && detector.includes("us_overnight_bar_missing_before_0820"), "requires 08:20 available US overnight/pre-market direction");
  addCheck(checks, "japan_korea_freeze_window_0800_0820", detector.includes("08:00-08:20 Asia/Taipei") && detector.includes("T08:20:00+08:00"), "Japan/Korea must freeze by 08:20");

  const preflight = readText("scripts/run-opening-report-0820-preflight.js");
  addCheck(checks, "preflight_freezes_at_0820", preflight.includes("08:20:00 Asia/Taipei"), "08:20 freeze must be explicit");

  const runner = readText("scripts/run-opening-report-0830-production.js");
  addCheck(checks, "runner_owns_non_trading_day_guard", runner.includes("isTwseTradingDay") && runner.includes("market_calendar_non_trading_day") && runner.includes("no_side_effects") && runner.includes("line_push_attempted: false") && runner.includes("mother_pool_bridge_attempted: false"), "direct runner invocation must skip before every side effect on market-closed days");
  addCheck(checks, "runner_consumes_frozen_snapshot_only", runner.includes("consume frozen 08:20") || runner.includes("凍結"), "08:30 runner must not refetch overseas direction");
  addCheck(checks, "runner_observation_only", runner.includes("formal_candidates: 0") && runner.includes("watchlist_only: true") && runner.includes("industry_observation_only"), "morning report must never create formal candidates");
  addCheck(checks, "line_delivery_contract_present", runner.includes("line-push-receipt") && runner.includes("pushLine") && runner.includes("lineReportFlex"), "LINE Flex delivery remains canonical");
  addCheck(checks, "line_customer_layout_fixed", ["📈 08:30 漲幅族群晨報", "15 個產業掃描完成", "海外平均漲幅：", "台股 A：", "台股 B："].every((token) => runner.includes(token)), "LINE customer layout must remain fixed");
  const lineLayoutSource = (runner.match(/function lineReportText[\s\S]*?function invalidLineTarget/) || [""])[0];
  addCheck(checks, "line_customer_layout_hides_internal_status", ["掃描：15／15", "資料截點：08:20", "Mother Pool：", "台股 Gate：", "狀態：", "FAIL_CLOSED", "僅供觀察，不是自動下單訊號"].every((token) => !lineLayoutSource.includes(token)), "LINE customer card must not expose internal operations");
  addCheck(checks, "bridge_top3_positive_only_nonblocking", runner.includes("positive_overseas_return_top3_only") && runner.includes("It must never change the 08:30 report delivery decision."), "Mother Pool bridge is optional handoff after report delivery");

  const wrapper = readText("run-opening-report-0830-production-wrapper.ps1");
  addCheck(checks, "wrapper_owns_non_trading_day_guard", wrapper.includes("check-market-calendar-action.js") && wrapper.includes("market_calendar_non_trading_day") && wrapper.includes("line_push_attempted = $false") && wrapper.includes("mother_pool_bridge_attempted = $false"), "Task Scheduler wrapper must guard independently before invoking the runner");
  addCheck(checks, "wrapper_runner_verifier_receipt_chain", wrapper.includes("run-opening-report-0830-production.js") && wrapper.includes("verify-opening-report-morning-contract.js") && wrapper.includes("opening-report-morning-wrapper-v1"), "wrapper must be runner -> canonical verifier -> wrapper receipt");
  addCheck(checks, "wrapper_has_no_telegram_execution", !wrapper.includes("send-opening-report-0830-telegram") && !wrapper.includes("TELEGRAM_BOT_TOKEN") && wrapper.includes("telegram_enabled = $false"), "Telegram must remain retired from morning wrapper");
  addCheck(checks, "wrapper_complete_requires_all_channels", wrapper.includes("$linePersonalOk") && wrapper.includes("$lineGroupOk") && wrapper.includes("$terminalOk") && wrapper.includes("$bridgeOk") && wrapper.includes("$expected -eq 15") && wrapper.includes("$scanned -eq 15"), "complete must require 15/15 + LINE personal/group + terminal + Mother Pool");

  const bridge = readText("scripts/apply-opening-report-0830-priority-bias-bridge.js");
  addCheck(checks, "bridge_cannot_publish_formal_candidates", bridge.includes("formal_candidate_allowed") && bridge.includes("formal_candidate_count") && bridge.includes("forbidden_publish_guard"), "bridge only boosts scan priority");
  addCheck(checks, "bridge_rejects_non_top3_positive_industry", bridge.includes("industry_not_positive_return_top3"), "only overseas top positive industries can boost");

  const terminalApp = readText("terminal-app.js");
  const terminalShell = readText("terminal-desktop-fast-shell.js");
  addCheck(checks, "terminal_displays_0830_window_observation_only", (terminalApp + terminalShell).includes("08:30-08:59") && (terminalApp + terminalShell).includes("僅供觀察排序"), "terminal must show morning report as observation-only");
}

function sourceTimeOk(value, cutoffMs) {
  if (!value) return true;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return false;
  return ms <= cutoffMs;
}

function currentReceiptChecks(checks, tradeDate) {
  const ymd = compactDate(tradeDate);
  const paths = {
    preflight: path.join(REPORT_DIR, "opening-report-0820-preflight-receipt-" + ymd + ".json"),
    leaders: path.join(REPORT_DIR, "opening-report-0820-overseas-leaders-" + ymd + ".json"),
    snapshot: path.join(REPORT_DIR, "opening-report-0820-market-snapshot-" + ymd + ".json"),
    final: path.join(REPORT_DIR, "opening-report-0830-final-receipt-" + ymd + ".json"),
    line: path.join(REPORT_DIR, "line-push-receipt-" + ymd + ".json"),
  };

  for (const [key, filePath] of Object.entries(paths)) {
    addCheck(checks, "current_receipt_exists:" + key, exists(filePath), filePath);
  }

  if (!Object.values(paths).every(exists)) return;

  const preflight = readJson(paths.preflight);
  const leaders = readJson(paths.leaders);
  const snapshot = readJson(paths.snapshot);
  const finalReceipt = readJson(paths.final);
  const line = readJson(paths.line);
  const cutoffMs = Date.parse(tradeDate + "T08:20:00+08:00");

  addCheck(checks, "current_preflight_ok", preflight.ok === true || preflight.status === "OK" || preflight.report_status === "REPORT_OK" || preflight.report_status === "REPORT_DEGRADED", JSON.stringify({ ok: preflight.ok, status: preflight.status, report_status: preflight.report_status }));

  const industries = leaders.industries || leaders.industry_bias || leaders.rows || leaders.overseas_industries || [];
  addCheck(checks, "current_leaders_15_industries", Array.isArray(industries) && industries.length === 15, "count=" + (Array.isArray(industries) ? industries.length : "not-array"));

  const allSourcesWithinCutoff = JSON.stringify(leaders).split('"').filter((part) => /T\d\d:\d\d:\d\d/.test(part) || /\d{4}-\d{2}-\d{2}/.test(part)).every((part) => {
    if (!/(checked_at|source_time|snapshot_time|observed_at|frozen_at|market_time)/i.test(part)) return true;
    return sourceTimeOk(part, cutoffMs);
  });
  addCheck(checks, "current_no_source_after_0820", allSourcesWithinCutoff, "cutoff=" + tradeDate + "T08:20:00+08:00");

  const leaderText = JSON.stringify(leaders);
  addCheck(checks, "current_us_equity_uses_overnight_session", !/(NVDA|AMD|AVGO|AMZN|TSM|MU|COHR|LITE|CIEN|AAOI|GLW)/.test(leaderText) || leaderText.includes("us_overnight_after_hours"), "US equities must be overnight/pre-market, not stale previous close");

  addCheck(checks, "current_snapshot_trade_date", snapshot.trade_date === tradeDate || snapshot.tradeDate === tradeDate || snapshot.date === tradeDate, JSON.stringify({ trade_date: snapshot.trade_date, tradeDate: snapshot.tradeDate, date: snapshot.date }));
  addCheck(checks, "current_report_status_is_report_only", ["REPORT_OK", "REPORT_DEGRADED", "COMPLETE", "complete"].includes(finalReceipt.report_status || finalReceipt.status), finalReceipt.report_status || finalReceipt.status);
  addCheck(checks, "current_report_observation_only", finalReceipt.watchlist_only === true && Number(finalReceipt.formal_candidates || 0) === 0, JSON.stringify({ watchlist_only: finalReceipt.watchlist_only, formal_candidates: finalReceipt.formal_candidates }));
  addCheck(checks, "current_scan_15_of_15", Number(finalReceipt.expected_industry_count) === 15 && Number(finalReceipt.scanned_industry_count) === 15, JSON.stringify({ expected_industry_count: finalReceipt.expected_industry_count, scanned_industry_count: finalReceipt.scanned_industry_count }));

  const runId = finalReceipt.run_id || finalReceipt.runId;
  const hash = finalReceipt.delivery_content_hash || finalReceipt.content_hash || finalReceipt.contentHash;
  const lineRunId = line.run_id || line.runId;
  const lineHash = line.delivery_content_hash || line.content_hash || line.contentHash;
  addCheck(checks, "current_line_same_run_id", !runId || !lineRunId || runId === lineRunId, runId + "/" + lineRunId);
  addCheck(checks, "current_line_same_content_hash", !hash || !lineHash || hash === lineHash, hash + "/" + lineHash);
  addCheck(checks, "current_line_token_target_not_logged", line.token_logged === false && line.target_logged === false, JSON.stringify({ token_logged: line.token_logged, target_logged: line.target_logged }));

  const targetCount = Number(line.target_count || line.targetCount || 0);
  const hasUser = line.has_user_target === true || line.hasUserTarget === true;
  const hasGroup = line.has_group_target === true || line.hasGroupTarget === true;
  const deliveredCount = Number(line.delivered_count || line.deliveredCount || 0);
  const lineAttempted = line.line_push_attempted === true;
  addCheck(checks, "current_line_user_and_group_delivery", line.ok === true && lineAttempted && targetCount >= 2 && deliveredCount >= 2 && hasUser && hasGroup, JSON.stringify({ ok: line.ok, line_push_attempted: lineAttempted, target_count: targetCount, delivered_count: deliveredCount, has_user_target: hasUser, has_group_target: hasGroup }));

  const terminal = finalReceipt.terminal_briefing_snapshot || {};
  addCheck(checks, "current_terminal_snapshot_ok", terminal.ok === true, JSON.stringify({ ok: terminal.ok, key: terminal.key }));
  addCheck(checks, "current_terminal_same_run_id", terminal.report_run_id === runId, String(terminal.report_run_id || "") + "/" + String(runId || ""));
  addCheck(checks, "current_terminal_same_content_hash", terminal.delivery_content_hash === hash, String(terminal.delivery_content_hash || "") + "/" + String(hash || ""));

  const reportPath = String(finalReceipt.report_path || "");
  const reportText = reportPath && exists(reportPath) ? fs.readFileSync(reportPath, "utf8") : "";
  addCheck(checks, "current_codex_markdown_exists", Boolean(reportText), reportPath);
  addCheck(checks, "current_codex_markdown_same_run_id", Boolean(runId) && reportText.includes("run_id：" + runId), runId || "missing_run_id");
  addCheck(checks, "current_codex_markdown_observation_only", reportText.includes("formal_candidates=0") && reportText.includes("watchlist_only=true"), "Codex Markdown must remain observation-only");

  const bridgePath = String(finalReceipt.bridge_aggregate_receipt || "");
  const bridge = bridgePath && exists(bridgePath) ? readJson(bridgePath) : null;
  addCheck(checks, "current_bridge_aggregate_exists", Boolean(bridge), bridgePath);
  addCheck(checks, "current_bridge_aggregate_ok", bridge?.status === "BRIDGE_OK" && Number(bridge?.successful_industry_count || 0) === Number(bridge?.industry_count || 0), JSON.stringify({ status: bridge?.status, industry_count: bridge?.industry_count, successful_industry_count: bridge?.successful_industry_count }));
  addCheck(checks, "current_bridge_same_run_id", bridge?.run_id === runId, String(bridge?.run_id || "") + "/" + String(runId || ""));
  addCheck(checks, "current_bridge_observation_only", bridge?.forbidden_publish_guard === true && Number(bridge?.formal_candidate_count || 0) === 0 && bridge?.formal_candidate_allowed === false, JSON.stringify({ forbidden_publish_guard: bridge?.forbidden_publish_guard, formal_candidate_count: bridge?.formal_candidate_count, formal_candidate_allowed: bridge?.formal_candidate_allowed }));
}

function writeReceipt(result, tradeDate) {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const ymd = compactDate(tradeDate);
  const filePath = path.join(REPORT_DIR, "opening-report-morning-contract-verifier-" + ymd + ".json");
  fs.writeFileSync(filePath, JSON.stringify(result, null, 2));
  return filePath;
}

function main() {
  const args = parseArgs();
  const checks = [];

  staticContractChecks(checks);
  symbolMapChecks(checks);
  if (args.phase === "preflight") {
    currentPreflightReceiptChecks(checks, args.tradeDate);
  } else if (args.requireCurrent) {
    currentReceiptChecks(checks, args.tradeDate);
  }

  const failures = checks.filter((check) => !check.ok);
  const result = {
    ok: failures.length === 0,
    contract: CONTRACT,
    checked_at: new Date().toISOString(),
    trade_date: args.tradeDate,
    require_current: args.requireCurrent,
    phase: args.phase,
    terminal_dir: ROOT,
    runtime_dir: RUNTIME,
    retired_contracts: [RETIRED_TELEGRAM_PACKAGE_KEY],
    canonical_verifier: "verify:opening-report-morning-contract",
    retired_aliases: RETIRED_ALIASES,
    checks,
    failed_checks: failures.map((check) => check.name),
    first_blocker: failures.length ? failures[0].name : null,
    reason_code: failures.length ? "opening_report_morning_" + failures[0].name : "opening_report_morning_contract_pass",
  };

  result.receipt_path = writeReceipt(result, args.tradeDate);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

main();
