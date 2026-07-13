const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const WRAPPER = path.join(ROOT, "run-strategy2-intraday.ps1");
const OUT_DIR = path.join(ROOT, "outputs", "strategy2-live-on");
const OUT_FILE = path.join(OUT_DIR, "strategy2-live-on.json");

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function push(checks, ok, code, evidence = {}) {
  checks.push({ ok: Boolean(ok), code, evidence });
}

function queryTask() {
  try {
    const out = execFileSync("schtasks.exe", ["/Query", "/TN", "Fuman Strategy2 Intraday Scan", "/FO", "LIST", "/V"], {
      encoding: "utf8",
      timeout: 20000,
    });
    const parsed = {};
    for (const line of out.split(/\r?\n/)) {
      const match = line.match(/^([^:]+):\s*(.*)$/);
      if (match) parsed[match[1].trim()] = match[2].trim();
    }
    return { ok: true, raw: out, parsed };
  } catch (error) {
    return { ok: false, error: error.message || String(error), raw: error.stdout || "" };
  }
}

function runNodeScript(script, args = []) {
  try {
    const out = execFileSync(process.execPath, ["--use-system-ca", script, ...args], {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 120000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, exitCode: 0, output: out };
  } catch (error) {
    return {
      ok: false,
      exitCode: typeof error.status === "number" ? error.status : 1,
      output: `${error.stdout || ""}${error.stderr || ""}${error.message || ""}`,
    };
  }
}

function main() {
  const checks = [];
  const wrapper = read(WRAPPER);
  const task = queryTask();
  const e2e = runNodeScript(path.join("scripts", "verify-strategy2-e2e-closure.js"));
  const readiness = runNodeScript(path.join("scripts", "check-scanner-resource-health.js"), ["--strategy=strategy2"]);

  push(checks, task.ok, "schedule_task_query_ok", { error: task.error || "" });
  push(checks, /Ready|Running/i.test(task.parsed?.Status || ""), "schedule_task_ready_or_running", {
    status: task.parsed?.Status || "",
  });
  push(checks, String(task.parsed?.["Scheduled Task State"] || "").toLowerCase() === "enabled", "schedule_task_enabled", {
    state: task.parsed?.["Scheduled Task State"] || "",
  });
  push(checks, String(task.parsed?.["Task To Run"] || "").includes("C:\\fuman-terminal\\run-strategy2-intraday.ps1"), "schedule_task_uses_production_wrapper", {
    taskToRun: task.parsed?.["Task To Run"] || "",
  });
  push(checks, String(task.parsed?.["Next Run Time"] || "").includes("08:00"), "schedule_next_run_0800", {
    nextRunTime: task.parsed?.["Next Run Time"] || "",
  });

  push(checks, wrapper.includes("Strategy2 before scan window; handing off to patrol wait loop until 09:00."), "wrapper_before_window_handoff_present");
  push(checks, !wrapper.includes("outside Strategy2 scan window; preserve latest and do not publish"), "wrapper_old_preopen_exit_removed");
  push(checks, wrapper.includes("after Strategy2 scan window; preserve latest and do not publish"), "wrapper_after_window_preserve_present");
  push(checks, wrapper.includes("& $nodeExe \"scripts\\patrol-intraday-signals.js\""), "wrapper_invokes_patrol");

  let readinessJson = null;
  try {
    readinessJson = JSON.parse(readiness.output);
  } catch {
    readinessJson = null;
  }
  push(checks, readiness.exitCode === 0 && readinessJson?.publishAllowed === true, "source_preflight_publish_allowed", {
    exitCode: readiness.exitCode,
    status: readinessJson?.status || "",
    publishAllowed: readinessJson?.publishAllowed,
    sourceGate: readinessJson?.sourceGate || null,
    reason: readinessJson?.reason || "",
    tail: readiness.output.split(/\r?\n/).slice(-8),
  });
  let e2eStdoutJson = null;
  try {
    e2eStdoutJson = JSON.parse(e2e.output);
  } catch {
    e2eStdoutJson = null;
  }
  push(checks, e2e.exitCode === 0 && (e2e.output.includes("[strategy2-e2e-closure] runId=") || e2eStdoutJson?.ok === true), "e2e_closure_command_runs", {
    exitCode: e2e.exitCode,
    stdoutOk: e2eStdoutJson?.ok === true,
    tail: e2e.output.split(/\r?\n/).slice(-8),
  });

  const closureReportPath = path.join(ROOT, "outputs", "strategy2-e2e-closure", "strategy2-e2e-closure.json");
  let closure = null;
  if (fs.existsSync(closureReportPath)) {
    closure = JSON.parse(read(closureReportPath));
  }
  push(checks, Boolean(closure?.expectedRunId), "closure_latest_run_id_present", {
    expectedRunId: closure?.expectedRunId || "",
  });
  push(checks, closure?.ok === true || e2e.exitCode === 1, "closure_is_explicit_pass_or_fail_closed", {
    closureOk: closure?.ok,
    issueCodes: (closure?.issues || []).map((item) => item.code),
  });

  const report = {
    ok: checks.every((item) => item.ok),
    verifier: "verify-strategy2-live-on",
    generatedAt: new Date().toISOString(),
    purpose: "Confirm Strategy2 08:00 task is armed, wrapper will not exit before 09:00, and production closure state is explicit.",
    task: task.parsed || {},
    wrapper: {
      path: WRAPPER,
      beforeWindowHandoff: wrapper.includes("Strategy2 before scan window; handing off to patrol wait loop until 09:00."),
      oldPreopenExitRemoved: !wrapper.includes("outside Strategy2 scan window; preserve latest and do not publish"),
      afterWindowPreserve: wrapper.includes("after Strategy2 scan window; preserve latest and do not publish"),
    },
    readiness: { exitCode: readiness.exitCode, payload: readinessJson, outputTail: readiness.output.split(/\r?\n/).slice(-12) },
    closure,
    checks,
    issues: checks.filter((item) => !item.ok),
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`[strategy2-live-on] wrote ${OUT_FILE}`);
  console.log(`[strategy2-live-on] ok=${report.ok} issues=${report.issues.map((item) => item.code).join(",") || "none"}`);
  if (!report.ok) process.exit(1);
}

main();
