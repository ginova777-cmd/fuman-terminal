"use strict";
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const root = path.resolve(__dirname, "..");
const registryFile = path.join(root, "scripts", "fuman-schedule-registry.json");
const issues = [];
const registry = JSON.parse(fs.readFileSync(registryFile, "utf8").replace(/^\uFEFF/, ""));
const active = [...new Set(registry?.policy?.activeTasks || [])].sort();
const retired = new Set(registry?.policy?.retiredTasks || []);
const definitions = Array.isArray(registry?.tasks) ? registry.tasks : [];
const ps = String.raw`
$OutputEncoding=[Console]::OutputEncoding=[Text.UTF8Encoding]::new()
$rows=foreach($t in Get-ScheduledTask | Where-Object {$_.TaskName -like 'Fuman*' -and $_.Settings.Enabled}){
  $a=$t.Actions|Select-Object -First 1
  $times=@($t.Triggers|ForEach-Object{if([string]$_.StartBoundary -match 'T(\d{2}:\d{2})'){$Matches[1]}}|Where-Object{$_}|Sort-Object -Unique)
  [pscustomobject]@{name=[string]$t.TaskName;state=[string]$t.State;execute=[string]$a.Execute;arguments=[string]$a.Arguments;workingDirectory=[string]$a.WorkingDirectory;triggers=$times}
}
@($rows)|ConvertTo-Json -Depth 5 -Compress
`;
const liveResult = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", ps], {
  encoding: "utf8", timeout: 20000, windowsHide: true,
});
if (liveResult.status !== 0) issues.push(`live_query_failed:${String(liveResult.stderr || "").trim()}`);
let live = [];
try {
  const parsed = JSON.parse(String(liveResult.stdout || "[]").trim() || "[]");
  live = Array.isArray(parsed) ? parsed : [parsed];
} catch (error) {
  issues.push(`live_query_invalid_json:${error.message}`);
}
if (liveResult.status !== 0 || live.length === 0) {
  const fallbackScript = String.raw`
$raw = (& schtasks.exe /Query /FO LIST /V 2>$null | Out-String)
$out = foreach ($block in ($raw -split '\\r?\\n\\r?\\n')) {
  $m = [regex]::Match($block, '(?im)^TaskName:\s*(\\Fuman .+)$'); if (-not $m.Success) { continue }
  $name = $m.Groups[1].Value -replace '^\\',''
  $state = ([regex]::Match($block, '(?im)^Scheduled Task State:\s*(.+)$')).Groups[1].Value
  if ($state.Trim() -eq 'Disabled') { continue }
  $start = ([regex]::Match($block, '(?im)^Start Time:\s*(.+)$')).Groups[1].Value
  $taskToRun = ([regex]::Match($block, '(?im)^Task To Run:\s*(.+)$')).Groups[1].Value
  $triggers = @()
  if ($start -match '(?i)(\d{1,2}:\d{2})') { $triggers = @(([datetime]::Parse($Matches[1])).ToString('HH:mm')) }
  [pscustomobject]@{name=$name;state=$state.Trim();execute='';arguments=$taskToRun;workingDirectory='';triggers=$triggers}
}
@($out) | ConvertTo-Json -Depth 5 -Compress
`;
  const fallback = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", fallbackScript], {
    encoding: "utf8", timeout: 20000, windowsHide: true,
  });
  try {
    const parsedFallback = JSON.parse(String(fallback.stdout || "[]").trim() || "[]");
    const fallbackRows = Array.isArray(parsedFallback) ? parsedFallback : [parsedFallback];
    if (fallbackRows.length) live = fallbackRows;
  } catch (error) {
    issues.push(`live_fallback_invalid_json:${error.message}`);
  }
}
if (live.length === 0) {
  const listFallback = spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/c", "schtasks.exe /Query /FO LIST /V"], { encoding: "utf8", timeout: 20000, windowsHide: true });
  const blocks = String(listFallback.stdout || "").split(/\r?\n\r?\n/);
  for (const block of blocks) {
    const name = (block.match(/^TaskName:\s*(\\Fuman .+)$/mi) || [])[1];
    const state = (block.match(/^Scheduled Task State:\s*(.+)$/mi) || [])[1];
    if (!name || String(state).trim() === "Disabled") continue;
    const taskToRun = (block.match(/^Task To Run:\s*(.+)$/mi) || [])[1] || "";
    const start = (block.match(/^Start Time:\s*(.+)$/mi) || [])[1] || "";
    const tm = start.match(/(\d{1,2}:\d{2})/);
    live.push({ name: name.replace(/^\\/, ""), state: String(state || "").trim(), execute: "", arguments: taskToRun, workingDirectory: "", triggers: tm ? [tm[1].padStart(5, "0")] : [] });
  }
}
const liveNames = [...new Set(live.map((row) => row.name))].sort();
for (const name of active.filter((name) => !liveNames.includes(name))) issues.push(`registry_active_missing_live:${name}`);
for (const name of liveNames.filter((name) => !active.includes(name))) issues.push(`live_enabled_missing_registry_active:${name}`);
for (const name of active.filter((name) => retired.has(name))) issues.push(`active_retired_collision:${name}`);
for (const name of liveNames.filter((name) => retired.has(name))) issues.push(`retired_task_installed:${name}`);
const defGroups = new Map();
for (const def of definitions) {
  const name = String(def?.displayName || String(def?.taskName || "").replace(/^\\+/, ""));
  if (!defGroups.has(name)) defGroups.set(name, []);
  defGroups.get(name).push(def);
}
for (const [name, rows] of defGroups) if (rows.length > 1) issues.push(`duplicate_definition:${name}:${rows.length}`);
const legacyPath = /Documents\\Codex|fuman-terminal-release-main|C:\\fuman-terminal(?:\\|$)/i;
for (const row of live) {
  const defs = defGroups.get(row.name) || [];
  if (defs.length !== 1) {
    issues.push(`active_definition_count:${row.name}:${defs.length}`);
    continue;
  }
  const expected = [...new Set(Array.isArray(defs[0].expectedTriggers) ? defs[0].expectedTriggers : [])].sort();
  const actual = [...new Set(Array.isArray(row.triggers) ? row.triggers : [])].sort();
  if (JSON.stringify(expected) !== JSON.stringify(actual)) issues.push(`trigger_mismatch:${row.name}:live=${actual.join(",")}:registry=${expected.join(",")}`);
  const action = `${row.execute || ""} ${row.arguments || ""} ${row.workingDirectory || ""}`;
  if (legacyPath.test(action)) issues.push(`legacy_action_path:${row.name}`);
}
const result = {
  ok: issues.length === 0,
  contract: "fuman-schedule-registry-live-alignment-v1",
  checkedAt: new Date().toISOString(),
  registryFile,
  activeCount: active.length,
  liveEnabledCount: liveNames.length,
  retiredCount: retired.size,
  issues,
  readOnly: true,
};
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
