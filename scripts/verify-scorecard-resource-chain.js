"use strict";
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const root = path.resolve(__dirname, "..");
const runtimeRoot = process.env.FUMAN_RUNTIME_ROOT || "C:\\fuman-runtime";
const outputDir = path.join(root, "outputs", "scorecard-resource-chain");
const artifactFile = path.join(runtimeRoot, "data", "scorecard-terminal-current.json");
const fixedVerifier = path.join(root, "scripts", "verify-scorecard88-fixed-collection-contract.js");
const checks = [];
function check(id, ok, detail) { checks.push({ id, ok: Boolean(ok), detail }); }
const contractRun = spawnSync(process.execPath, [fixedVerifier], { cwd: root, encoding: "utf8", timeout: 20000, windowsHide: true });
let contract = null;
try { contract = JSON.parse(String(contractRun.stdout || "{}").trim()); } catch {}
check("fixed-slot-contract", contractRun.status === 0 && contract?.ok === true, contract?.issues?.join(",") || "12:40/13:15/17:00/21:40 terminal-only contract");
let artifact = null;
try { artifact = JSON.parse(fs.readFileSync(artifactFile, "utf8")); } catch {}
check("terminal-artifact-exists", Boolean(artifact), artifactFile);
check("terminal-artifact-source", artifact?.source === "terminal-canonical-fixed-slot-collector" && artifact?.cacheSource === "terminal-canonical-json", `${artifact?.source || "missing"} / ${artifact?.cacheSource || "missing"}`);
const policy = artifact?.collectionPolicy || {};
check("no-scan", policy.scanAllowed === false, `scanAllowed=${policy.scanAllowed}`);
check("no-supabase-query", policy.supabaseQueryAllowed === false, `supabaseQueryAllowed=${policy.supabaseQueryAllowed}`);
check("no-recalculation", policy.recalculateAllowed === false, `recalculateAllowed=${policy.recalculateAllowed}`);
check("no-runid-generation", policy.generateRunIdAllowed === false, `generateRunIdAllowed=${policy.generateRunIdAllowed}`);
const reports = Array.isArray(artifact?.sourceReports) ? artifact.sourceReports : [];
for (const report of reports.filter((row) => row.collectionContract === "scorecard88-terminal-canonical-collector-v1")) {
  const safeBlocked = report.ok === true || (report.status === "今日尚未閉環" && Boolean(report.blocking_reason) && !report.runId);
  check(`report-${report.key}-pass-or-blocked`, safeBlocked, `status=${report.status};runId=${report.runId || "missing"};blocker=${report.blocking_reason || "none"}`);
  check(`report-${report.key}-copied-runid`, report.generatedRunId === false, `generatedRunId=${report.generatedRunId}`);
}
const result = {
  ok: checks.every((row) => row.ok),
  contract: "scorecard88-terminal-resource-chain-v2",
  checkedAt: new Date().toISOString(),
  artifactFile,
  fixedSlots: ["12:40", "13:15", "17:00", "21:40"],
  checks,
  retired: ["Fuman Scorecard Daily Automation 1400", "Fuman Scorecard Daily Watchdog 1410", "supabase:scorecard_latest live rebuild"],
};
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, "scorecard-resource-chain.json"), `${JSON.stringify(result, null, 2)}\n`);
const lines = ["# /88 Terminal Canonical Resource Chain", "", `Status: ${result.ok ? "PASS" : "FAIL_CLOSED"}`, "", "| check | ok | detail |", "|---|---:|---|", ...checks.map((row) => `| ${row.id} | ${row.ok} | ${String(row.detail || "").replace(/\|/g, "\\|")} |`), ""];
fs.writeFileSync(path.join(outputDir, "scorecard-resource-chain.md"), lines.join("\n"));
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
