"use strict";

const { spawnSync } = require("child_process");
const path = require("path");

const ROOT = process.env.FUMAN_ROOT || path.resolve(__dirname, "..");
const APPLY = process.argv.includes("--apply");

function passThroughArgs() {
  return process.argv.slice(2).filter((arg) => arg !== "--apply");
}

function run(label, script, args = []) {
  const nodeArgs = ["--use-system-ca", script, ...args];
  const result = spawnSync(process.execPath, nodeArgs, {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env },
    windowsHide: true,
    timeout: 120000,
  });
  return {
    label,
    command: [process.execPath, ...nodeArgs].join(" "),
    exitCode: result.status ?? 1,
    ok: result.status === 0,
    error: result.error ? result.error.message : "",
    stdout: String(result.stdout || "").slice(-5000),
    stderr: String(result.stderr || "").slice(-5000),
  };
}

function main() {
  const extra = passThroughArgs();
  const warmup = run("verify:daytrade-warmup-unattended", "scripts/verify-daytrade-warmup-unattended.js", extra);
  const selfHealArgs = APPLY ? ["--apply", ...extra] : extra;
  const selfHeal = run(APPLY ? "daytrade-warmup:self-heal:apply" : "daytrade-warmup:self-heal", "scripts/run-daytrade-warmup-self-heal.js", selfHealArgs);
  let selfHealPayload = {};
  try { selfHealPayload = JSON.parse(selfHeal.stdout || "{}"); } catch {}
  const waitingForNaturalPhase = selfHealPayload.state === "WAITING_FOR_NATURAL_PHASE";
  const ok = warmup.ok || selfHeal.ok;
  const state = warmup.ok
    ? "WARMUP_UNATTENDED_YES_NO_REWATER_NEEDED"
    : waitingForNaturalPhase
      ? "WARMUP_WAITING_FOR_NATURAL_PHASE"
      : selfHeal.ok
        ? "WARMUP_NOT_READY_SELF_HEAL_PLANNED_OR_APPLIED"
        : "WARMUP_NOT_READY_SELF_HEAL_FAILED";
  const result = {
    ok,
    contract: "daytrade-warmup-root-with-self-heal-v1",
    checkedAt: new Date().toISOString(),
    mode: APPLY ? "apply" : "dry-run",
    state,
    invariant: "warmup NO must still produce self-heal queue; self-heal does not backfill natural evidence or fake unattended YES",
    warmup,
    selfHeal,
  };
  console.log(JSON.stringify(result, null, 2));
  if (!ok) process.exit(1);
}

main();
