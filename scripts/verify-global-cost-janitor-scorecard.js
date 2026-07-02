const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_ROOT = process.env.FUMAN_RUNTIME_ROOT || process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime";
const STATUS_DIR = path.join(RUNTIME_ROOT, "status");
const LOG_DIR = path.join(RUNTIME_ROOT, "logs");
const STATUS_FILE = process.env.FUMAN_GLOBAL_COST_JANITOR_STATUS_FILE || path.join(STATUS_DIR, "global-cost-janitor-scorecard.json");
const LOG_FILE = process.env.FUMAN_GLOBAL_COST_JANITOR_LOG_FILE || path.join(LOG_DIR, "global-cost-janitor-scorecard.jsonl");
const ALERT_RECEIPT_FILE = process.env.FUMAN_GLOBAL_COST_JANITOR_ALERT_RECEIPT_FILE || path.join(LOG_DIR, "global-cost-janitor-alert.json");
const MAX_STATUS_AGE_HOURS = Number(process.env.FUMAN_GLOBAL_COST_JANITOR_MAX_STATUS_AGE_HOURS || 36);

const EXPECTED_TASKS = [
  {
    name: "\\Fuman API-Only Retired Artifact Cleanup 1535",
    purpose: "local retired API/static/runtime artifact cleanup",
    allowedResults: [0],
  },
  {
    name: "\\Fuman Supabase Vercel History Cleanup 1545",
    purpose: "Supabase/Vercel history retention cleanup",
    allowedResults: [0],
  },
  {
    name: "\\Fuman Vercel Cost Health Monitor 2115",
    purpose: "Vercel cost/project/mirror read-only monitor",
    allowedResults: [0],
  },
  {
    name: "\\Fuman Global Cost Janitor Scorecard 1555",
    purpose: "global cost janitor read-only scorecard",
    allowedResults: [0, 267009],
  },
];

const STATUS_FILES = [
  {
    key: "apiOnlyRetiredCleanup",
    file: path.join(STATUS_DIR, "api-only-retired-cleanup-status.json"),
    description: "API-only retired artifact cleanup status",
  },
  {
    key: "supabaseVercelHistoryCleanup",
    file: path.join(STATUS_DIR, "supabase-vercel-history-cleanup-status.json"),
    description: "Supabase/Vercel history cleanup status",
  },
  {
    key: "vercelCostHealth",
    file: path.join(RUNTIME_ROOT, "state", "vercel-cost-health-status.json"),
    description: "Vercel cost health monitor status",
    allowWarning: true,
  },
];

function run(args, options = {}) {
  const result = spawnSync(args[0], args.slice(1), {
    cwd: options.cwd || ROOT,
    encoding: "utf8",
    shell: process.platform === "win32",
    timeout: options.timeout || 120000,
    env: process.env,
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: String(result.stdout || "").trim(),
    stderr: String(result.stderr || "").trim(),
    error: result.error ? result.error.message : null,
  };
}

function appendJsonl(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(payload) + "\n", "utf8");
}

function writeJson(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), "utf8");
}

function parseJsonText(text) {
  if (!text) return null;
  const trimmed = String(text).trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try { return JSON.parse(trimmed.slice(start, end + 1)); } catch {}
    }
  }
  return null;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    return { __readError: error.message };
  }
}

function taipeiNowIso() {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date()).replace(" ", "T") + "+08:00";
}

function normalizeTaskName(name) {
  const text = String(name || "").trim();
  return text.startsWith("\\") ? text : `\\${text}`;
}

function parseCsvLine(line) {
  const cells = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (ch === "," && !quoted) {
      cells.push(cell);
      cell = "";
    } else {
      cell += ch;
    }
  }
  cells.push(cell);
  return cells;
}

function parseTasks(csv) {
  const lines = String(csv || "").split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    const row = {};
    headers.forEach((header, index) => { row[header] = cells[index] || ""; });
    row.TaskName = normalizeTaskName(row.TaskName);
    return row;
  });
}

function checkTasks(issues, warnings) {
  const result = run(["schtasks", "/Query", "/V", "/FO", "CSV"], { cwd: ROOT, timeout: 120000 });
  const evidence = {
    ok: result.ok,
    status: result.status,
    tasks: {},
  };
  if (!result.ok) {
    issues.push({ issue: "schtasks_query_failed", detail: result.stderr || result.error || result.stdout });
    return evidence;
  }
  const rows = parseTasks(result.stdout);
  for (const expected of EXPECTED_TASKS) {
    const row = rows.find((item) => item.TaskName === expected.name);
    if (!row) {
      issues.push({ issue: "scheduled_task_missing", taskName: expected.name, purpose: expected.purpose });
      evidence.tasks[expected.name] = { missing: true };
      continue;
    }
    const lastResult = Number(row["Last Result"]);
    const allowed = expected.allowedResults.includes(lastResult);
    evidence.tasks[expected.name] = {
      status: row.Status,
      lastResult,
      lastRunTime: row["Last Run Time"],
      nextRunTime: row["Next Run Time"],
      taskToRun: row["Task To Run"],
      purpose: expected.purpose,
    };
    if (!["Ready", "Running"].includes(row.Status)) {
      issues.push({ issue: "scheduled_task_bad_status", taskName: expected.name, status: row.Status });
    }
    if (!allowed) {
      issues.push({ issue: "scheduled_task_bad_last_result", taskName: expected.name, lastResult, allowed: expected.allowedResults });
    } else if (lastResult === 267009) {
      warnings.push({ warning: "scheduled_task_currently_running", taskName: expected.name, lastResult });
    }
  }
  return evidence;
}

function checkStatusFiles(issues, warnings) {
  const now = Date.now();
  const maxAgeMs = MAX_STATUS_AGE_HOURS * 3600000;
  const evidence = {};
  for (const item of STATUS_FILES) {
    const stat = fs.existsSync(item.file) ? fs.statSync(item.file) : null;
    if (!stat) {
      issues.push({ issue: "status_file_missing", key: item.key, file: item.file, description: item.description });
      evidence[item.key] = { file: item.file, missing: true };
      continue;
    }
    const ageMs = now - stat.mtimeMs;
    const payload = readJson(item.file);
    const status = payload.status || (payload.ok === true ? "ok" : "unknown");
    evidence[item.key] = {
      file: item.file,
      mtime: stat.mtime.toISOString(),
      ageHours: Number((ageMs / 3600000).toFixed(2)),
      ok: payload.ok,
      status,
      payload,
    };
    if (ageMs > maxAgeMs) {
      issues.push({ issue: "status_file_stale", key: item.key, file: item.file, ageHours: evidence[item.key].ageHours, maxAgeHours: MAX_STATUS_AGE_HOURS });
    }
    if (payload.__readError) {
      issues.push({ issue: "status_file_unreadable", key: item.key, file: item.file, error: payload.__readError });
    } else if (status === "critical" || (payload.ok === false && !(status === "warning" && item.allowWarning))) {
      issues.push({ issue: "status_file_not_ok", key: item.key, file: item.file, status, payloadIssues: payload.issues || [] });
    } else if (status === "warning" && item.allowWarning) {
      warnings.push({ warning: "status_file_warning_allowed", key: item.key, file: item.file });
    } else if (status === "warning") {
      warnings.push({ warning: "status_file_warning", key: item.key, file: item.file });
    }
  }
  return evidence;
}

function commandCheck(label, args, issues, warnings, options = {}) {
  const result = run(args, options);
  const parsed = parseJsonText(result.stdout);
  const hasWarnings = parsed && Array.isArray(parsed.warnings) && parsed.warnings.length > 0;
  const evidence = {
    label,
    ok: result.ok,
    status: result.status,
    stdout: result.stdout.slice(0, 4000),
    stderr: result.stderr.slice(0, 1000),
    parsed,
  };
  if (!result.ok) {
    issues.push({ issue: "command_check_failed", label, status: result.status, stderr: result.stderr, stdout: result.stdout });
  } else if (hasWarnings) {
    warnings.push({ warning: "command_check_warning", label, warnings: parsed.warnings });
  }
  return evidence;
}

async function sendAlert(payload) {
  const result = spawnSync(process.execPath, ["scripts/send-workflow-alert.js", "--kind", "global_cost_janitor_failed", "--receipt", ALERT_RECEIPT_FILE], {
    cwd: ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      FUMAN_ALERT_KIND: "global_cost_janitor_failed",
      FUMAN_ALERT_SOURCE: "verify-global-cost-janitor-scorecard.js",
      FUMAN_ALERT_SUBJECT: "Fuman global cost janitor scorecard failed",
      FUMAN_ALERT_TEXT: [
        "Fuman global cost janitor scorecard failed",
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

async function main() {
  const issues = [];
  const warnings = [];
  const evidence = {
    tasks: checkTasks(issues, warnings),
    statusFiles: checkStatusFiles(issues, warnings),
    commands: {},
  };

  evidence.commands.costGovernanceAudit = commandCheck(
    "verify-cost-governance-audit",
    [process.execPath, "--use-system-ca", "scripts/verify-cost-governance-audit.js"],
    issues,
    warnings,
    { timeout: 120000 }
  );
  evidence.commands.vercelCostGuard = commandCheck(
    "verify-vercel-cost-guard",
    [process.execPath, "scripts/verify-vercel-cost-guard.js"],
    issues,
    warnings
  );
  evidence.commands.vercelProjectInventory = commandCheck(
    "verify-vercel-project-inventory",
    [process.execPath, "scripts/verify-vercel-project-inventory.js"],
    issues,
    warnings
  );
  evidence.commands.retiredArtifactsClean = commandCheck(
    "verify-retired-artifacts-clean",
    [process.execPath, "scripts/verify-retired-artifacts-clean.js"],
    issues,
    warnings
  );

  const status = issues.length ? "critical" : warnings.length ? "warning" : "ok";
  const payload = {
    ok: issues.length === 0,
    status,
    checkedAt: new Date().toISOString(),
    checkedAtTaipei: taipeiNowIso(),
    contract: "global-cost-janitor-scorecard-v1",
    scope: [
      "supabase-retention-cleanup",
      "local-retired-artifact-cleanup",
      "supabase-vercel-history-cleanup",
      "vercel-cost-health-monitor",
      "vercel-cost-deploy-guard",
    ],
    issues,
    warnings,
    evidence,
  };

  if (issues.length > 0) {
    payload.alert = await sendAlert(payload);
  }

  writeJson(STATUS_FILE, payload);
  appendJsonl(LOG_FILE, payload);
  console.log(JSON.stringify(payload, null, 2));
  if (issues.length > 0) process.exit(1);
}

main().catch(async (error) => {
  const payload = {
    ok: false,
    status: "critical",
    checkedAt: new Date().toISOString(),
    checkedAtTaipei: taipeiNowIso(),
    contract: "global-cost-janitor-scorecard-v1",
    issues: [{ issue: "scorecard_exception", error: error?.stack || error?.message || String(error) }],
    warnings: [],
  };
  payload.alert = await sendAlert(payload).catch((alertError) => ({ ok: false, error: alertError?.message || String(alertError) }));
  writeJson(STATUS_FILE, payload);
  appendJsonl(LOG_FILE, payload);
  console.error(JSON.stringify(payload, null, 2));
  process.exit(1);
});
