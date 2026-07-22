"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

const REQUIRED_IN_ROOT = [
  "ops:predictive-preflight",
  "verify:terminal-predictive-preflight",
  "verify:fugle-websocket-sources",
  "verify:terminal-water-root",
  "verify:terminal-water-root-contract",
  "verify:terminal-live-scope",
  "verify:terminal-unattended-root-policy",
  "verify:daytrade-warmup-root",
  "daytrade-warmup:root",
  "verify:strategy-scan-formal-gate",
  "verify:terminal-auto-roll-forward",
  "verify:terminal-idempotent-runner",
  "verify:strategy-scan-receipt-contract",
  "ops:autonomous-root:contract",
  "verify:daily-manifest-schedule-transition",
  "manifest:daily-terminal-run",
  "orchestrator:state:from-existing",
  "verify:terminal-orchestrator-self-test",
  "verify:terminal-state-machine-contract",
  "verify:terminal-reason-code-classifier",
  "policy:autonomous-ops",
  "rollforward:terminal",
  "verify:terminal-canary-publish:live",
  "verify:terminal-canary-publish",
  "verify:terminal-control-plane:from-existing",
  "verify:terminal-resource-chain:unattended",
  "verify:terminal-runid-closure",
  "verify:manifest-publish-wiring",
  "verify:backend-auth-isolation",
  "verify:backend-service-token-schedule",
  "verify:autonomous-ops-action-matrix",
  "ops:notification:plan",
  "verify:autonomous-ops-notification-policy",
  "ops:status:export",
  "verify:terminal-ops-status-api",
  "verify:terminal-autonomous-completion-audit",
  "verify:protected-readback-credential-contract",
  "verify:protected-readback-credential",
  "verify:terminal-ops-production-live:authenticated",
  "ops:production-unattended-readiness-report:authenticated",
  "verify:production-unattended-readiness-report",
];

const FORBIDDEN_ROOT_SCRIPTS = [
  "verify:api-unattended-scorecard",
  "verify:all-api-unattended",
  "verify:production-api-freshness",
  "verify:production-api-freshness-contract",
  "verify:market-closed-terminal-readback",
  "verify:strategy1-prewater-strict",
  "verify:strategy1-prewater-contract",
  "verify:strategy1-business-fields",
  "verify:strategy1-formal-payloads",
  "verify:heatmap",
  "verify:heatmap-ai-prewater-strict",
  "verify:realtime-radar-prewater-strict",
];

const RETIRED_TOKENS = [
  "strategy1",
  "open-buy",
  "open_buy",
  "open-buy-latest",
  "scan-open-buy",
  "realtime-radar",
  "realtimeRadar",
  "heatmap",
];

const SNAPSHOT_ONLY_PRODUCTION_SCRIPTS = [
  "verify:terminal-ops-production-live",
  "verify:terminal-ops-production-live:authenticated",
  "verify:terminal-resource-chain",
  "verify:terminal-resource-chain:unattended",
  "verify:protected-readback-credential",
];

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function splitRootCommands(rootCommand) {
  return String(rootCommand || "")
    .split(/\s+&&\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function npmScriptName(command) {
  const match = command.match(/^npm\s+run\s+([^\s]+)/);
  return match ? match[1] : "";
}

function issue(issues, code, details = {}) {
  issues.push({ code, details });
}

function verifyRootOrder(rootScripts, issues) {
  const positions = Object.fromEntries(rootScripts.map((name, index) => [name, index]));
  const orderedPairs = [
    ["ops:predictive-preflight", "verify:terminal-water-root"],
    ["verify:terminal-water-root", "verify:strategy-scan-formal-gate"],
    ["verify:strategy-scan-formal-gate", "verify:daily-manifest-schedule-transition"],
    ["verify:daily-manifest-schedule-transition", "manifest:daily-terminal-run"],
    ["manifest:daily-terminal-run", "orchestrator:state:from-existing"],
    ["orchestrator:state:from-existing", "verify:terminal-orchestrator-self-test"],
    ["verify:terminal-orchestrator-self-test", "verify:terminal-state-machine-contract"],
    ["verify:terminal-state-machine-contract", "policy:autonomous-ops"],
    ["policy:autonomous-ops", "rollforward:terminal"],
    ["rollforward:terminal", "verify:terminal-canary-publish:live"],
    ["verify:terminal-canary-publish:live", "verify:terminal-canary-publish"],
    ["verify:terminal-canary-publish", "verify:terminal-resource-chain:unattended"],
    ["verify:terminal-resource-chain:unattended", "verify:terminal-runid-closure"],
    ["verify:terminal-runid-closure", "verify:manifest-publish-wiring"],
    ["verify:terminal-autonomous-completion-audit", "verify:terminal-ops-production-live:authenticated"],
    ["verify:terminal-ops-production-live:authenticated", "ops:production-unattended-readiness-report:authenticated"],
  ];
  for (const [before, after] of orderedPairs) {
    if (positions[before] === undefined || positions[after] === undefined) continue;
    if (positions[before] >= positions[after]) {
      issue(issues, `root_order_invalid:${before}->${after}`, { positions });
    }
  }
}

function verifyRootMembership(rootScripts, rootCommand, issues) {
  for (const required of REQUIRED_IN_ROOT) {
    if (!rootScripts.includes(required)) issue(issues, `root_required_script_missing:${required}`);
  }
  for (const forbidden of FORBIDDEN_ROOT_SCRIPTS) {
    if (rootScripts.includes(forbidden) || rootCommand.includes(forbidden)) {
      issue(issues, `root_forbidden_heavy_or_retired_script:${forbidden}`);
    }
  }
  for (const token of RETIRED_TOKENS) {
    const pattern = new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    if (pattern.test(rootCommand)) issue(issues, `root_retired_token_present:${token}`);
  }
}

function verifySnapshotOnlyScriptContent(scripts, issues) {
  const scriptToFiles = {
    "verify:terminal-ops-production-live": ["scripts/verify-terminal-ops-production-live.js"],
    "verify:terminal-ops-production-live:authenticated": ["scripts/verify-terminal-ops-production-live.js"],
    "verify:terminal-resource-chain": ["scripts/verify-terminal-resource-chain.js"],
    "verify:terminal-resource-chain:unattended": ["scripts/verify-terminal-resource-chain.js"],
    "verify:protected-readback-credential": ["scripts/verify-protected-readback-credential.js"],
  };
  for (const scriptName of SNAPSHOT_ONLY_PRODUCTION_SCRIPTS) {
    if (!scripts[scriptName]) issue(issues, `snapshot_script_missing:${scriptName}`);
    for (const rel of scriptToFiles[scriptName] || []) {
      const text = read(rel);
      if (/\/api\/scorecard\?live=1/.test(text)) {
        issue(issues, `snapshot_script_scorecard_live_query:${scriptName}`, { file: rel });
      }
      if (/\/api\/source-reports\?live=1/.test(text)) {
        issue(issues, `snapshot_script_source_reports_live_query:${scriptName}`, { file: rel });
      }
    }
  }
}

function verifyLiveScopeIsInRoot(rootScripts, issues) {
  const liveScopeIndex = rootScripts.indexOf("verify:terminal-live-scope");
  const productionReadbackIndex = rootScripts.indexOf("verify:terminal-ops-production-live:authenticated");
  if (liveScopeIndex < 0) issue(issues, "live_scope_gate_missing_from_root");
  if (productionReadbackIndex >= 0 && liveScopeIndex >= 0 && liveScopeIndex > productionReadbackIndex) {
    issue(issues, "live_scope_gate_runs_after_production_readback", { liveScopeIndex, productionReadbackIndex });
  }
}

function verifyTerminalLiveScopeGuards(issues) {
  const text = read("scripts/verify-terminal-live-scope.js");
  const requiredMarkers = [
    "production_verifier_scorecard_live_query",
    "production_verifier_source_reports_live_query",
    "resource_chain_scorecard_live_query",
    "resource_chain_strategy_live_query",
    "runtime_config_retired_endpoint",
    "retired_priority_seed_in_formal_websocket_collector",
    "desktop_stale_release_readback_fallback",
    "source_reports_live_not_env_gated",
  ];
  for (const marker of requiredMarkers) {
    if (!text.includes(marker)) issue(issues, `live_scope_marker_missing:${marker}`);
  }
}

function main() {
  const pkg = readJson("package.json");
  const scripts = pkg.scripts || {};
  const rootCommand = String(scripts["verify:terminal-unattended-root"] || "");
  const rootScripts = splitRootCommands(rootCommand).map(npmScriptName).filter(Boolean);
  const issues = [];

  if (!rootCommand) issue(issues, "root_gate_script_missing");
  verifyRootMembership(rootScripts, rootCommand, issues);
  verifyRootOrder(rootScripts, issues);
  verifyLiveScopeIsInRoot(rootScripts, issues);
  verifySnapshotOnlyScriptContent(scripts, issues);
  verifyTerminalLiveScopeGuards(issues);

  const payload = {
    ok: issues.length === 0,
    contract: "terminal-unattended-root-policy-v1",
    checkedAt: new Date().toISOString(),
    rule: "Production unattended root may run Strategy2/daytrade/source-gate live checks, but scorecard/desktop/mobile/88 readback must use snapshot/protected readback and retired modules must stay out of official root gates.",
    rootScriptCount: rootScripts.length,
    requiredRootScripts: REQUIRED_IN_ROOT,
    forbiddenRootScripts: FORBIDDEN_ROOT_SCRIPTS,
    retiredTokens: RETIRED_TOKENS,
    snapshotOnlyProductionScripts: SNAPSHOT_ONLY_PRODUCTION_SCRIPTS,
    rootScripts,
    issues,
  };

  console.log(JSON.stringify(payload, null, 2));
  if (!payload.ok) process.exit(1);
}

main();
