const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const approvalPath = process.env.FUMAN_DAYTRADE_HOST_APPROVAL || "C:/fuman-runtime/config/daytrade-source-host-approval.json";
const issues = [];

function readApproval() {
  try {
    return JSON.parse(fs.readFileSync(approvalPath, "utf8"));
  } catch (error) {
    issues.push(`approval_unreadable:${error.message}`);
    return {};
  }
}

function powershell(command) {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", command], { encoding: "utf8", windowsHide: true });
  return { code: result.status, stdout: String(result.stdout || "").trim(), stderr: String(result.stderr || "").trim() };
}

function main() {
  const approval = readApproval();
  const host = String(process.env.COMPUTERNAME || "").trim().toUpperCase();
  const role = String(approval.sourceRole || "").trim().toLowerCase();
  const approved = approval.approved === true;
  const writerProcesses = powershell("@(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match 'fugle-websocket-collector\\.js|run-daytrade-source-writer\\.js' }).Count");
  const writerTask = powershell("$t=Get-ScheduledTask -TaskName 'Fuman Daytrade Source Writer 0600-1330' -ErrorAction SilentlyContinue; if($t){$t.State}else{'missing'}");
  const processCount = Number(writerProcesses.stdout || "0");
  const taskState = writerTask.stdout || "unknown";

  if (!approval || approval.contract !== "daytrade-source-host-approval-v1") issues.push("approval_contract_missing");
  if (role === "reader") {
    if (approved) issues.push("reader_host_approved_as_writer");
    if (processCount > 0) issues.push(`reader_host_writer_processes_present:${processCount}`);
    if (/Ready|Running/i.test(taskState)) issues.push(`reader_host_writer_task_enabled:${taskState}`);
  } else if (role === "writer") {
    if (!approved) issues.push("writer_host_not_approved");
  } else {
    issues.push("source_host_role_unknown");
  }
  if (host === "FUMAN-PC" && role !== "reader") issues.push("FUMAN-PC_must_be_reader_only");

  const result = {
    ok: issues.length === 0,
    contract: "daytrade-source-host-role-v1",
    checkedAt: new Date().toISOString(),
    host,
    role,
    approved,
    writerProcessCount: processCount,
    writerTaskState: taskState,
    approvalPath,
    issues,
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

main();