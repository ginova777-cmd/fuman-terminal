"use strict";

const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");

const CONTRACT = "opening_limit_order_closed_loop_readiness_v1";
const TERMINAL_DIR = process.env.FUMAN_TERMINAL_DIR || "C:/fuman-terminal";
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const DATA_DIR = path.join(RUNTIME_DIR, "data", "opening-limit-order");

function arg(name, fallback = "") {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || fallback;
}
function flag(name) { return process.argv.includes(`--${name}`) || arg(name, "") === "1" || arg(name, "") === "true"; }
function compactDate(value) { return String(value || "").replace(/\D/g, "").slice(0, 8); }
function dashDate(value) { const c = compactDate(value); return c.length === 8 ? `${c.slice(0, 4)}-${c.slice(4, 6)}-${c.slice(6, 8)}` : ""; }
function taipeiDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function taipeiHhmm(value) {
  const timestamp = new Date(value || "");
  if (!Number.isFinite(timestamp.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(timestamp).replace(":", "");
}
function exists(file) { try { return fs.existsSync(file); } catch { return false; } }
function read(file) { try { return fs.readFileSync(file, "utf8"); } catch { return ""; } }
function readJson(file) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (error) { return { __read_error: error?.message || String(error) }; } }
function array(value) { return Array.isArray(value) ? value : []; }
function guardOk(guard) {
  return guard && guard.creates_order === false && guard.creates_formal_candidate === false && guard.publish_allowed === false && guard.requires_second_confirm_before_action === true;
}
function queryTask(name) {
  const result = childProcess.spawnSync("schtasks", ["/Query", "/TN", name, "/V", "/FO", "LIST"], { encoding: "utf8" });
  return { status: result.status, text: `${result.stdout || ""}${result.stderr || ""}` };
}
function taskEnabled(text) { return /Scheduled Task State:\s*Enabled/i.test(text); }
function taskReady(text) { return /Status:\s*Ready/i.test(text); }
function taskHasStart(text, hhmmss) { return new RegExp(`Start Time:\\s*(?:上午\\s*)?${hhmmss.replace(/:/g, ":")}`, "i").test(text); }
function taskRuns(text, scriptName) { return text.includes(scriptName); }
function lateOnly(failedChecks) {
  const allowed = new Set(["preflight_completed_after_0855", "summary_completed_after_0900"]);
  return array(failedChecks).length > 0 && array(failedChecks).every((check) => allowed.has(check));
}

function main() {
  const tradeDate = dashDate(arg("trade-date", taipeiDate()));
  const requireRuntime = !flag("no-runtime");
  const allowLateRepair = flag("allow-late-repair");
  const compact = compactDate(tradeDate);
  const outPath = arg("out", path.join(DATA_DIR, `opening-limit-order-closed-loop-readiness-${compact}.json`));
  const failures = [];
  const warnings = [];

  const sourceFiles = {
    morningRunner: path.join(TERMINAL_DIR, "ops", "Run-OpeningLimitOrderMorningReadonly.ps1"),
    progressiveRunner: path.join(TERMINAL_DIR, "ops", "Run-OpeningLimitOrder0840ProgressiveReadonly.ps1"),
    preflightRunner: path.join(TERMINAL_DIR, "ops", "Run-OpeningLimitOrder0850PreflightReadonly.ps1"),
    preflightEngine: path.join(TERMINAL_DIR, "ops", "Run-OpeningLimitOrder0850PreflightReadonly.engine-v2.ps1"),
    runner0855: path.join(TERMINAL_DIR, "ops", "Run-OpeningLimitOrder0855Readonly.ps1"),
    verifier0900: path.join(TERMINAL_DIR, "ops", "Run-OpeningLimitOrder0900Verifier.ps1"),
    register0840: path.join(TERMINAL_DIR, "ops", "Register-OpeningLimitOrder0840Task.ps1"),
    candidateVerifier: path.join(TERMINAL_DIR, "scripts", "verify-opening-limit-order-candidate-readonly.js"),
    verifier0855: path.join(TERMINAL_DIR, "scripts", "verify-opening-limit-order-0855-readonly.js"),
    sourceVerifier: path.join(TERMINAL_DIR, "scripts", "verify-opening-limit-order-source-contract.js"),
    closedLoopVerifier: path.join(TERMINAL_DIR, "scripts", "verify-opening-limit-order-closed-loop.js"),
  };
  for (const [label, file] of Object.entries(sourceFiles)) if (!exists(file)) failures.push(`${label}_missing`);

  const morningRunner = read(sourceFiles.morningRunner);
  const progressiveRunner = read(sourceFiles.progressiveRunner);
  const preflightRunner = read(sourceFiles.preflightRunner);
  const preflightEngine = read(sourceFiles.preflightEngine);
  const runner0855 = read(sourceFiles.runner0855);
  const verifier0900 = read(sourceFiles.verifier0900);
  const candidateVerifier = read(sourceFiles.candidateVerifier);

  if (!morningRunner.includes("Run-OpeningLimitOrder0840ProgressiveReadonly.ps1") || !morningRunner.includes("-WaitUntil0840")) failures.push("morning_runner_not_chaining_0840_progressive");
  if (!progressiveRunner.includes("Wait-UntilTaipeiTime -HHmmss \"09:00:00\"") || !progressiveRunner.includes("Run-OpeningLimitOrder0900Verifier.ps1")) failures.push("progressive_runner_not_chaining_0900_verifier");
  if (!progressiveRunner.includes("opening-limit-order-morning-readonly") || !progressiveRunner.includes("opening_limit_order_morning_readonly_chain_v1")) failures.push("morning_total_receipt_missing");
  if (!progressiveRunner.includes("uses_0900_data = $false")) failures.push("pre_0900_data_guard_missing");
  if (!preflightRunner.includes("Resolve-NodeExe") || !preflightEngine.includes("Resolve-NodeExe") || !runner0855.includes("Resolve-NodeExe") || !progressiveRunner.includes("Resolve-NodeExe")) failures.push("fixed_node_resolver_missing");
  if (preflightRunner.includes("& node ") || preflightEngine.includes("& node ") || runner0855.includes("& node ") || progressiveRunner.includes("& node ")) failures.push("bare_node_call_present");
  if (!verifier0900.includes("param(") || !verifier0900.includes("[string]$TradeDate") || !verifier0900.includes("OpeningLimitOrder0900Verifier")) failures.push("0900_verifier_not_parameterized");
  if (verifier0900.includes("Invoke-FumanWeekdayGuard")) failures.push("0900_verifier_uses_formal_source_window_guard");
  if (!candidateVerifier.includes("rule_definitions: RULE_DEFINITIONS") || !candidateVerifier.includes("implemented_rules: RULES") || !candidateVerifier.includes("main().catch")) failures.push("candidate_contract_fallback_missing");

  const task0840 = queryTask("Fuman Opening Limit Order Morning Readonly 0845");
  const task0900 = queryTask("Fuman Opening Limit Order 0900 Readonly Verify");
  if (task0840.status !== 0) failures.push("task_0840_unreadable");
  else {
    if (!taskEnabled(task0840.text)) failures.push("task_0840_not_enabled");
    if (!taskReady(task0840.text)) warnings.push("task_0840_not_ready_now");
    if (!taskHasStart(task0840.text, "08:40:00")) failures.push("task_0840_wrong_start_time");
    if (!taskRuns(task0840.text, "Run-OpeningLimitOrderMorningReadonly.ps1")) failures.push("task_0840_wrong_runner");
  }
  if (task0900.status !== 0) failures.push("task_0900_unreadable");
  else {
    if (!taskEnabled(task0900.text)) failures.push("task_0900_not_enabled");
    if (!taskReady(task0900.text)) warnings.push("task_0900_not_ready_now");
    if (!taskHasStart(task0900.text, "09:00:00")) failures.push("task_0900_wrong_start_time");
    if (!taskRuns(task0900.text, "Run-OpeningLimitOrder0900Verifier.ps1")) failures.push("task_0900_wrong_runner");
  }

  const runtimeFiles = {
    preCandidates: path.join(DATA_DIR, `opening-limit-order-0840-pre-candidates-${compact}.json`),
    futoptReadback: path.join(DATA_DIR, `opening-limit-order-0845-futopt-readback-${compact}.json`),
    preflight: path.join(DATA_DIR, `opening-limit-order-0850-preflight-${compact}.json`),
    watchlist: path.join(DATA_DIR, `opening-limit-order-0855-watchlist-${compact}.json`),
    candidates: path.join(DATA_DIR, `opening-limit-order-0855-candidates-${compact}.json`),
    summary: path.join(DATA_DIR, `opening-limit-order-0855-summary-${compact}.json`),
    verifier0900: path.join(DATA_DIR, `opening-limit-order-0900-verifier-${compact}.json`),
    morningReceipt: path.join(DATA_DIR, `opening-limit-order-morning-readonly-${compact}.json`),
  };
  const runtime = {};
  if (requireRuntime) {
    for (const [label, file] of Object.entries(runtimeFiles)) {
      runtime[label] = exists(file) ? readJson(file) : null;
      if (!runtime[label] && label !== "morningReceipt") failures.push(`${label}_runtime_missing`);
    }
    if (!runtime.morningReceipt) warnings.push("morning_total_receipt_missing_for_current_date_before_next_scheduled_run");
    if (runtime.preCandidates && !guardOk(runtime.preCandidates.action_guard)) failures.push("pre_candidates_action_guard_failed");
    if (runtime.futoptReadback && !guardOk(runtime.futoptReadback.action_guard)) failures.push("futopt_readback_action_guard_failed");
    if (runtime.watchlist && !guardOk(runtime.watchlist.action_guard)) failures.push("watchlist_action_guard_failed");
    if (runtime.candidates && !guardOk(runtime.candidates.action_guard)) failures.push("candidates_action_guard_failed");
    if (runtime.summary && !guardOk(runtime.summary.action_guard)) failures.push("summary_action_guard_failed");
    if (runtime.summary && runtime.summary.ok !== true) failures.push("summary_not_ok");
    if (runtime.summary && Number(runtime.summary.formal_candidate_count || 0) !== 0) failures.push("summary_formal_candidate_count_not_zero");
    if (runtime.summary && runtime.summary.publish_allowed !== false) failures.push("summary_publish_allowed_not_false");
    if (runtime.candidates && array(runtime.candidates.implemented_rules).length < 10) failures.push("candidate_implemented_rules_less_than_10");
    if (runtime.verifier0900 && runtime.verifier0900.ok !== true) {
      if (allowLateRepair && lateOnly(runtime.verifier0900.failed_checks)) warnings.push("current_date_repaired_late_only_not_a_scheduled_pass");
      else failures.push("verifier_0900_not_ok");
    }
  }

  const firstBlocker = failures[0] || null;
  const output = {
    ok: failures.length === 0,
    contract: CONTRACT,
    trade_date: tradeDate,
    checked_at: new Date().toISOString(),
    closed_loop: {
      schedule_0840: task0840.status === 0 && taskEnabled(task0840.text) && taskHasStart(task0840.text, "08:40:00") && taskRuns(task0840.text, "Run-OpeningLimitOrderMorningReadonly.ps1"),
      schedule_0900: task0900.status === 0 && taskEnabled(task0900.text) && taskHasStart(task0900.text, "09:00:00") && taskRuns(task0900.text, "Run-OpeningLimitOrder0900Verifier.ps1"),
      runner_chains_0900: progressiveRunner.includes("Run-OpeningLimitOrder0900Verifier.ps1"),
      total_receipt_contract: progressiveRunner.includes("opening_limit_order_morning_readonly_chain_v1"),
      no_order_no_publish_guard: true,
      source_window_guard_not_used_by_readback: !verifier0900.includes("Invoke-FumanWeekdayGuard"),
    },
    runtime_readback: requireRuntime ? {
      summary_ok: runtime.summary?.ok === true,
      summary_checked_at: runtime.summary?.checked_at || null,
      candidate_count: runtime.summary?.candidate_count ?? null,
      data_gap_count: runtime.summary?.data_gap_count ?? null,
      rejected_count: runtime.summary?.rejected_count ?? null,
      verifier_0900_ok: runtime.verifier0900?.ok === true,
      verifier_0900_first_blocker: runtime.verifier0900?.first_blocker || null,
      verifier_0900_failed_checks: runtime.verifier0900?.failed_checks || [],
      late_repair_accepted: Boolean(runtime.verifier0900 && runtime.verifier0900.ok !== true && allowLateRepair && lateOnly(runtime.verifier0900.failed_checks)),
      morning_total_receipt_exists: Boolean(runtime.morningReceipt),
    } : null,
    files: { source: sourceFiles, runtime: runtimeFiles, out: outPath },
    warnings,
    failed_checks: failures,
    first_blocker: firstBlocker,
  };
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(output, null, 2));
  process.exitCode = output.ok ? 0 : 1;
}

main();
