"use strict";

const { spawnSync } = require("child_process");

const LIVE = process.argv.includes("--live");
const ACK = process.env.FUMAN_ALLOW_SUPABASE_READ === "1";
const READ_ONLY_COMMANDS = [
  {
    key: "source-contracts",
    command: "npm run verify:terminal-source-contracts -- --routes=warrant --out=outputs/warrant-prewater-source-contracts",
    reads: ["v_warrant_flow_latest_complete_run", "warrant_flow_scan_results"],
  },
  {
    key: "resource-chain",
    command: "npm run verify:terminal-resource-chain -- --routes=warrant --out=outputs/warrant-prewater-resource-chain",
    reads: ["v_warrant_flow_latest_complete_run", "warrant_flow_scan_results"],
  },
  {
    key: "warrant-battle-state",
    command: "node scripts/verify-warrant-battle-state.js",
    reads: ["v_scanner_resource_health", "v_warrant_latest_complete_run_health", "v_warrant_flow_latest_complete_run", "warrant_flow_scan_results"],
  },
];

function runCommand(commandText) {
  const command = process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : "sh";
  const args = process.platform === "win32" ? ["/d", "/s", "/c", commandText] : ["-lc", commandText];
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    shell: false,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
  return {
    command: commandText,
    ok: result.status === 0,
    exitCode: result.status,
    stdout: String(result.stdout || "").trim().split(/\r?\n/).slice(-30),
    stderr: [
      ...String(result.stderr || "").trim().split(/\r?\n/).filter(Boolean),
      result.error ? String(result.error.message || result.error) : "",
    ].filter(Boolean).slice(-30),
  };
}

function plan(mode, armed) {
  console.log(JSON.stringify({
    ok: true,
    mode,
    armed,
    supabaseRead: false,
    supabaseWrite: false,
    deploy: false,
    liveCommand: "FUMAN_ALLOW_SUPABASE_READ=1 npm run verify:warrant-prewater-source-live",
    readOnlyCommands: READ_ONLY_COMMANDS,
    passMeaning: armed
      ? "Live read-only verifier is armed but no read was requested in plan mode."
      : "Live read-only verifier is installed; no Supabase request was made because FUMAN_ALLOW_SUPABASE_READ=1 is not set.",
  }, null, 2));
}

if (!LIVE) {
  plan("plan-only", false);
} else if (!ACK) {
  plan("live-not-armed", false);
} else {
  const results = READ_ONLY_COMMANDS.map((entry) => ({ key: entry.key, reads: entry.reads, ...runCommand(entry.command) }));
  console.log(JSON.stringify({
    ok: results.every((result) => result.ok),
    mode: "live-read-only",
    armed: true,
    supabaseRead: true,
    supabaseWrite: false,
    deploy: false,
    results,
  }, null, 2));
  if (results.some((result) => !result.ok)) process.exit(1);
}
