"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = process.env.FUMAN_TERMINAL_DIR || path.resolve(__dirname, "..");
const RUNTIME = process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime";
const AUTHORITY_FILE = path.join(ROOT, "data", "contracts", "release_root_authority_v1.json");
const RECEIPT_DIR = path.join(RUNTIME, "data", "scan-receipts");
const CONTRACT = "daytrade_postclose_1330_readonly_v1";
const TASKS = [
  { key: "writer", name: "Fuman Daytrade Source Writer 0600-1330", runner: "Run-DaytradeSourceWriterPinned.ps1" },
  { key: "collector", name: "Fuman Fugle Daytrade WebSocket Collector 0600-1330", runner: "Run-DaytradeWebSocketCollector.ps1" },
];

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")); } catch { return fallback; }
}
function taipeiDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function ageSeconds(value) {
  const stamp = Date.parse(String(value || ""));
  return Number.isFinite(stamp) ? Math.max(0, Math.floor((Date.now() - stamp) / 1000)) : 999999;
}
function queryTask(name) {
  const escaped = name.replace(/'/g, "''");
  const command = `$t=Get-ScheduledTask -TaskName '${escaped}' -ErrorAction Stop;$i=Get-ScheduledTaskInfo -TaskName '${escaped}' -ErrorAction Stop;$a=$t.Actions|Select-Object -First 1;[ordered]@{count=@($t).Count;state=[string]$t.State;execute=[string]$a.Execute;arguments=[string]$a.Arguments;workingDirectory=[string]$a.WorkingDirectory;lastRunTime=$i.LastRunTime.ToString('o');lastResult=[int64]$i.LastTaskResult}|ConvertTo-Json -Compress`;
  const result = spawnSync("C:\\Program Files\\PowerShell\\7\\pwsh.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { encoding: "utf8", windowsHide: true, timeout: 15000 });
  if (result.status !== 0) return { error: String(result.stderr || result.stdout || "task_query_failed").trim() };
  try { return JSON.parse(String(result.stdout || "").trim()); } catch { return { error: "task_query_invalid_json" }; }
}

const requestedDate = (process.argv.find((arg) => arg.startsWith("--trade-date=")) || "").split("=")[1] || taipeiDate();
const compact = requestedDate.replace(/\D/g, "");
const authority = readJson(AUTHORITY_FILE, {});
const productionRoot = String(authority?.productionRoot || "");
const v2File = path.join(RUNTIME, "state", "fugle-daytrade-websocket-status-v2.json");
const deltaFile = path.join(RUNTIME, "state", "daytrade-mother-pool-delta.json");
const lockFile = path.join(RUNTIME, "state", "daytrade-source-writer.cross-session.lock");
const v2 = readJson(v2File, {});
const delta = readJson(deltaFile, {});
const round = delta?.round_summary || {};
const checks = [];
const taskEvidence = {};
function add(name, ok, detail = null) { checks.push({ name, ok: Boolean(ok), detail }); }

add("release_authority_valid", authority?.contract === "release_root_authority_v1" && Boolean(productionRoot), { productionRoot });
for (const spec of TASKS) {
  const task = queryTask(spec.name);
  taskEvidence[spec.key] = task;
  const action = `${task.execute || ""} ${task.arguments || ""} ${task.workingDirectory || ""}`;
  add(`${spec.key}_task_unique`, Number(task.count) === 1, task);
  add(`${spec.key}_task_ran_today`, String(task.lastRunTime || "").slice(0, 10) === requestedDate, { lastRunTime: task.lastRunTime });
  add(`${spec.key}_task_naturally_stopped`, String(task.state || "").toLowerCase() !== "running", { state: task.state });
  add(`${spec.key}_task_runner_authoritative`, action.includes(spec.runner) && (!productionRoot || action.toLowerCase().includes(productionRoot.toLowerCase())), { action });
}
add("writer_cross_session_lock_absent", !fs.existsSync(lockFile), { lockFile });
add("v2_status_today_and_recent", String(v2.updatedAt || "").slice(0, 10) === requestedDate && ageSeconds(v2.updatedAt) <= 600, { updatedAt: v2.updatedAt, ageSeconds: ageSeconds(v2.updatedAt) });
add("v2_formal_source_contract", v2.ok === true && v2.primarySource === "fugle-websocket" && v2.restDisabled === true, { ok: v2.ok, primarySource: v2.primarySource, restDisabled: v2.restDisabled });
add("mother_pool_trade_date_current", String(round.trade_date || "") === requestedDate, { tradeDate: round.trade_date });
add("mother_pool_final_receipt_recent", String(round.checked_at || "").slice(0, 10) === requestedDate && ageSeconds(round.checked_at) <= 900, { checkedAt: round.checked_at, ageSeconds: ageSeconds(round.checked_at) });
add("mother_pool_final_counts_present", Number(round.mother_pool_rows || 0) > 0 && Number(round.mother_pool_rows || 0) <= 600, { motherPoolRows: round.mother_pool_rows, hotRows: round.hot_pool_rows, dataGapCount: round.data_gap_count });

const failedChecks = checks.filter((row) => !row.ok).map((row) => row.name);
const output = {
  ok: failedChecks.length === 0,
  status: failedChecks.length === 0 ? "PASS" : "FAIL_CLOSED",
  contract: CONTRACT,
  tradeDate: requestedDate,
  checkedAt: new Date().toISOString(),
  readOnly: true,
  strategyStarted: false,
  taskEvidence,
  sourceEvidence: {
    v2UpdatedAt: v2.updatedAt || "",
    motherPoolCheckedAt: round.checked_at || "",
    motherPoolRows: Number(round.mother_pool_rows || 0),
    hotRows: Number(round.hot_pool_rows || 0),
    dataGapCount: Number(round.data_gap_count || 0),
    crossSessionLockPresent: fs.existsSync(lockFile),
  },
  checks,
  failed_checks: failedChecks,
  firstBlocker: failedChecks[0] || null,
};

fs.mkdirSync(RECEIPT_DIR, { recursive: true });
const dated = path.join(RECEIPT_DIR, `daytrade-postclose-1330-${compact}.json`);
fs.writeFileSync(dated, `${JSON.stringify(output, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
process.exitCode = output.ok ? 0 : 1;
