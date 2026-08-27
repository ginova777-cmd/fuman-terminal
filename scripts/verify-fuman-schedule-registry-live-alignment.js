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
