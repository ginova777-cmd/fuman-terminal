const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_ROOT = process.env.FUMAN_RUNTIME_ROOT || "C:\\fuman-runtime";
const STATUS_FILE = process.env.FUMAN_VERCEL_COST_STATUS_FILE || path.join(RUNTIME_ROOT, "state", "vercel-cost-health-status.json");
const LOG_FILE = process.env.FUMAN_VERCEL_COST_LOG_FILE || path.join(RUNTIME_ROOT, "logs", "vercel-cost-health.jsonl");
const ALERT_RECEIPT_FILE = process.env.FUMAN_VERCEL_COST_ALERT_RECEIPT_FILE || path.join(RUNTIME_ROOT, "logs", "vercel-cost-health-alert.json");
const ALERT_ON_WARNINGS = process.env.FUMAN_VERCEL_COST_ALERT_WARNINGS === "1";

function run(label, args) {
  const result = spawnSync(args[0], args.slice(1), {
    cwd: ROOT,
    encoding: "utf8",
    shell: process.platform === "win32",
    env: process.env,
    timeout: Number(process.env.FUMAN_VERCEL_COST_MONITOR_TIMEOUT_MS || 60000),
  });
  return {
    label,
    ok: result.status === 0,
    status: result.status,
    stdout: String(result.stdout || "").trim(),
    stderr: String(result.stderr || "").trim(),
    error: result.error ? result.error.message : null,
  };
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function appendJsonl(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(value) + "\n");
}

async function sendAlert(payload) {
  fs.mkdirSync(path.dirname(ALERT_RECEIPT_FILE), { recursive: true });
  const result = spawnSync(process.execPath, ["scripts/send-workflow-alert.js", "--kind", "vercel_cost_health_failed", "--receipt", ALERT_RECEIPT_FILE], {
    cwd: ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      FUMAN_ALERT_KIND: "vercel_cost_health_failed",
      FUMAN_ALERT_SOURCE: "monitor-vercel-cost-health.js",
      FUMAN_ALERT_SUBJECT: "Fuman Vercel cost/upload guard failed",
      FUMAN_ALERT_TEXT: [
        "Fuman Vercel cost/upload guard failed",
        "",
        `status: ${payload.status}`,
        `checkedAt: ${payload.checkedAt}`,
        "",
        JSON.stringify({ issues: payload.issues, warnings: payload.warnings }, null, 2),
      ].join("\n"),
      FUMAN_ALERT_RECEIPT_FILE: ALERT_RECEIPT_FILE,
    },
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: String(result.stdout || "").trim(),
    stderr: String(result.stderr || "").trim(),
    error: result.error ? result.error.message : null,
    receiptFile: ALERT_RECEIPT_FILE,
  };
}

(async () => {
  const checks = [
    run("verify-vercel-cost-guard.js", [process.execPath, "scripts/verify-vercel-cost-guard.js"]),
    run("verify-vercel-project-inventory.js", [process.execPath, "scripts/verify-vercel-project-inventory.js"]),
    run("verify-production-mirror-guard.js", [process.execPath, "scripts/verify-production-mirror-guard.js"]),
  ];
  const failed = checks.filter((check) => !check.ok);
  const warningChecks = checks.filter((check) => /"warnings"\s*:\s*\[[^\]]+\]/.test(check.stdout));
  const status = failed.length ? "critical" : warningChecks.length ? "warning" : "ok";
  const payload = {
    ok: status === "ok",
    status,
    checkedAt: new Date().toISOString(),
    issues: failed.map((check) => ({ label: check.label, status: check.status, error: check.error, stderr: check.stderr, stdout: check.stdout })),
    warnings: warningChecks.map((check) => ({ label: check.label })),
    checks,
  };

  if (status === "critical" || (ALERT_ON_WARNINGS && status === "warning")) {
    payload.alert = await sendAlert(payload);
  }

  writeJson(STATUS_FILE, payload);
  appendJsonl(LOG_FILE, payload);
  console.log(JSON.stringify(payload, null, 2));
  if (status === "critical") process.exit(1);
})();
