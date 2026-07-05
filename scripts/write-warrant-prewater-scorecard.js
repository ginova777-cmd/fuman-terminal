"use strict";

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "data", "warrant-prewater-scorecard.json");
const COMMANDS = [
  ["strategyRequirements", "npm run verify:warrant-strategy-requirements"],
  ["businessFields", "npm run verify:warrant-business-fields"],
  ["formalPayloads", "npm run verify:warrant-formal-payloads"],
  ["uiDisplay", "npm run verify:warrant-ui-display"],
  ["sourcePlan", "npm run verify:warrant-prewater-source-plan"],
  ["strict", "npm run verify:warrant-prewater-strict"],
];

function run(commandText) {
  const command = process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : "sh";
  const args = process.platform === "win32" ? ["/d", "/s", "/c", commandText] : ["-lc", commandText];
  const result = spawnSync(command, args, { cwd: ROOT, shell: false, encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });
  return {
    command: commandText,
    ok: result.status === 0,
    exitCode: result.status,
    stdout: String(result.stdout || "").trim().split(/\r?\n/).slice(-30),
    stderr: String(result.stderr || "").trim().split(/\r?\n/).filter(Boolean).slice(-30),
  };
}

const results = COMMANDS.map(([key, command]) => ({ key, ...run(command) }));
const ok = results.every((result) => result.ok);
const scorecard = {
  ok,
  strategy: "warrant-flow",
  strategyName: "權證走向",
  scorecardType: "pre-water-prep",
  generatedAt: new Date().toISOString(),
  supabaseRead: false,
  supabaseWrite: false,
  deployed: false,
  liveSourceVerifierPrepared: ok,
  liveSourceVerifierRun: false,
  preWaterPrepStatus: ok ? "complete" : "failed",
  aGradeStatus: "blocked_until_supabase_recovery",
  productionUnattendedStatus: "NO",
  canBackfillA: false,
  canBackfillProductionUnattendedYES: false,
  canPublishLatestFromThisRun: false,
  latestPollutionRisk: "NO",
  preservePreviousGood: true,
  highestBackfill: "pre-water engineering complete",
  uiEvidenceLimitations: {
    uiMatrixIsNotLiveDom: true,
    proven: "verify:warrant-ui-display only proves fixtures/warrant-ui-display-matrix.json field coverage and degraded/fallback/evidence payload rules.",
    notProven: "production UI live DOM is not proven; do not convert UI matrix verifier output into UI PASS production."
  },
  sourceContractPrecision: {
    formalRequiredSources: ["warrant_flow_scan_results", "v_warrant_flow_latest_complete_run"],
    notDirectFormalDependencies: ["shared quote", "intraday 1m", "MA readiness", "futopt/TXF"],
    rule: "權證 formal publish 不依賴 shared quote/1m/MA/futopt；但若 payload 明確帶 degraded source/fallback 狀態，必須 block latest，避免壞水源被誤當正式證據。"
  },
  commands: results,
  recoveryFirstCommand: "npm run supabase:probe:light",
  sourceLiveCommand: "FUMAN_ALLOW_SUPABASE_READ=1 npm run verify:warrant-prewater-source-live",
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(scorecard, null, 2) + "\n", "utf8");
console.log("[warrant-prewater-scorecard] wrote " + path.relative(ROOT, OUT));
console.log("[warrant-prewater-scorecard] status=" + scorecard.preWaterPrepStatus + " ok=" + scorecard.ok);
if (!ok) process.exit(1);
