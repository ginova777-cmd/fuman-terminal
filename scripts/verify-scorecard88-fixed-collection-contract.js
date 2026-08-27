"use strict";
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const page = read("88.html");
const api = read("api/scorecard.js");
const collector = read("scripts/collect-terminal-scorecard-88.js");
const surfaceEvidence = read("scripts/collect-scorecard88-terminal-surface-evidence.js");
const wrapper = read("scripts/run-scorecard88-terminal-collector.ps1");
const master = read("run-terminal-master-control.ps1");
const registry = JSON.parse(read("scripts/fuman-schedule-registry.json").replace(/^\uFEFF/, ""));
const issues = [];
const definitions = [
  ["Fuman Scorecard88 Collect Strategy2 1240", "12:40"],
  ["Fuman Scorecard88 Collect Strategy3 1315", "13:15"],
  ["Fuman Scorecard88 Collect Strategy4 1700", "17:00"],
  ["Fuman Scorecard88 Collect Evening 2140", "21:40"],
];
const scorecardFetch = page.match(/fetch\(`\/api\/scorecard[^\n]+/)?.[0] || "";
if (/refreshSourceReports=1|strictLiveReports=1|[?&]live=1/.test(scorecardFetch)) issues.push("page88_live_rebuild_query_present");
if ((page.match(/loadDaytradeEntries\(\);/g) || []).length || (page.match(/loadSevenStrategyDailyHistory\(\);/g) || []).length || (page.match(/loadStrategy4Live\(\);/g) || []).length) issues.push("page88_live_or_supabase_autoload_present");
if (!api.includes("terminal_fixed_slot_snapshot") || !api.includes('cacheSource = "terminal-canonical-json"')) issues.push("scorecard_api_not_terminal_snapshot_only");
if (!api.includes("terminal_scorecard_snapshot_missing_or_legacy")) issues.push("scorecard_api_legacy_static_fallback_not_fail_closed");
if (/await readSnapshot\s*\(SNAPSHOT_KEY/.test(api)) issues.push("scorecard_api_executes_supabase_snapshot_read");
for (const slot of definitions.map((row) => row[1])) if (!collector.includes(`"${slot}"`)) issues.push(`collector_slot_missing:${slot}`);
for (const invariant of ["querySupabase: false", "recalculated: false", "generatedRunId: false", "terminal_canonical_not_complete"]) if (!collector.includes(invariant)) issues.push(`collector_invariant_missing:${invariant}`);
for (const invariant of ["outside_fixed_collection_window", "writeAllowed: false", "blobPublishAllowed: false", "fixedCollectionWindow(slot)"]) if (!collector.includes(invariant)) issues.push(`collector_window_guard_missing:${invariant}`);
for (const field of ["sourceDate", "startedAt", "finishedAt", "universeCount", "scannedCount", "resultCount", "qualityStatus", "evidenceStatus", "fallbackUsed", "publishAllowed", "desktopStatus", "mobileStatus", "scorecardUpdatedAt", "firstBlocker", "reasonCode"]) {
  if (!collector.includes(field)) issues.push(`collector_required_field_missing:${field}`);
}
if (!collector.includes('surface?.mobileStatus || "UNVERIFIED"') || !collector.includes("mobileRunId === runId") || !collector.includes("&& surfaceMatches")) issues.push("collector_mobile_authenticated_readback_gate_missing");
if (!collector.includes('mobileStatus: canonical?.mobileStatus || "UNVERIFIED"')) issues.push("collector_blocked_mobile_status_missing");
if (/server-supabase|supabase-snapshots|fetch\s*\(/i.test(collector)) issues.push("collector_network_or_supabase_dependency_present");
for (const invariant of ["scorecard88-terminal-surface-evidence-v1", "querySupabase: false", "scanAllowed: false", "recalculated: false", "generatedRunId: false", "resolveProtectedReadbackCredential", "/api/terminal-fast-bundle", "/api/mobile-fragment", "desktopDate === expectedDate", "mobileDate === expectedDate", "desktop_mobile_trade_date_not_today"]) {
  if (!surfaceEvidence.includes(invariant)) issues.push(`surface_evidence_invariant_missing:${invariant}`);
}
if (/server-supabase|supabase-snapshots|callInternalApi/i.test(surfaceEvidence)) issues.push("surface_evidence_direct_compute_or_supabase_dependency_present");
const surfaceFetchCalls = [...surfaceEvidence.matchAll(/await fetchResult\(([^\n]+)/g)].map((match) => match[1]);
if (surfaceFetchCalls.some((call) => !/terminal-fast-bundle|mobile-fragment/.test(call))) issues.push("surface_evidence_unapproved_endpoint_fetch_present");
if (!wrapper.includes("collect-scorecard88-terminal-surface-evidence.js") || wrapper.indexOf("collect-scorecard88-terminal-surface-evidence.js") > wrapper.indexOf("collect-terminal-scorecard-88.js")) issues.push("surface_evidence_not_run_before_scorecard_collection");
if (!master.includes("verify-scorecard88-fixed-collection-contract.js") || !master.includes("scorecard88ContractExitCode")) issues.push("master_checkpoint_missing_scorecard88_contract");
for (const [name, time] of definitions) {
  if (!registry.policy.activeTasks.includes(name)) issues.push(`registry_active_missing:${name}`);
  const def = registry.tasks.find((row) => row.displayName === name);
  if (!def || JSON.stringify(def.expectedTriggers) !== JSON.stringify([time])) issues.push(`registry_trigger_mismatch:${name}`);
  const allowed = registry.policy.allowedResults[name] || [];
  if (!allowed.includes(0) || !allowed.includes(3) || !allowed.includes(4)) issues.push(`registry_allowed_results_missing:${name}`);
}
const namesLiteral = definitions.map(([name]) => `'${name.replace(/'/g, "''")}'`).join(",");
const ps = `$OutputEncoding=[Console]::OutputEncoding=[Text.UTF8Encoding]::new(); $rows=Get-ScheduledTask -TaskName @(${namesLiteral}) -ErrorAction SilentlyContinue | ForEach-Object {$a=$_.Actions|Select-Object -First 1; [pscustomobject]@{name=$_.TaskName; enabled=$_.Settings.Enabled; arguments=[string]$a.Arguments; logonType=[string]$_.Principal.LogonType; triggers=@($_.Triggers|ForEach-Object{if([string]$_.StartBoundary -match 'T(\\d{2}:\\d{2})'){$Matches[1]}})}}; @($rows)|ConvertTo-Json -Depth 4 -Compress`;
const liveResult = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", ps], { encoding: "utf8", timeout: 15000, windowsHide: true });
let live = [];
try { const parsed = JSON.parse(String(liveResult.stdout || "[]").trim() || "[]"); live = Array.isArray(parsed) ? parsed : [parsed]; } catch (error) { issues.push(`live_task_query_invalid:${error.message}`); }
for (const [name, time] of definitions) {
  const row = live.find((item) => item.name === name);
  if (!row || row.enabled === false) { issues.push(`live_task_missing_or_disabled:${name}`); continue; }
  if (!String(row.arguments).includes("run-scorecard88-terminal-collector.ps1") || !String(row.arguments).includes(`-Slot \"${time}\"`)) issues.push(`live_task_action_mismatch:${name}`);
  if (!Array.isArray(row.triggers) || !row.triggers.includes(time)) issues.push(`live_task_trigger_mismatch:${name}`);
  if (row.logonType !== "S4U") issues.push(`live_task_not_s4u:${name}:${row.logonType || "unknown"}`);
}
const result = { ok: issues.length === 0, contract: "scorecard88-fixed-collection-contract-v4", fixedSlots: definitions.map(([,time]) => time), liveTaskCount: live.length, invariants: { scans: false, supabaseQueries: false, recalculation: false, runIdGeneration: false, authenticatedMobileRequiredForPass: true, nonCircularSurfaceEvidence: true, completeFieldContract: true }, issues };
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
