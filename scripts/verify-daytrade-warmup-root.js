"use strict";

const { spawnSync } = require("child_process");
const path = require("path");

const ROOT = process.env.FUMAN_ROOT || path.resolve(__dirname, "..");
const APPLY = process.argv.includes("--apply");

function passThroughArgs() {
  return process.argv.slice(2).filter((arg) => arg !== "--apply");
}

function parseJson(text) {
  try {
    return JSON.parse(String(text || "{}"));
  } catch {
    return {};
  }
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

function isUnattendedYes(payload) {
  return payload.unattended_yes === "YES"
    || payload.unattendedStatus === "YES"
    || payload.unattended_status === "YES"
    || payload.unattendedYes === true
    || payload.unattended_yes === true;
}

function main() {
  const extra = passThroughArgs();
  const warmup = run("verify:daytrade-warmup-unattended", "scripts/verify-daytrade-warmup-unattended.js", extra);
  const finalPayload = parseJson(warmup.stdout);
  const selfHealArgs = APPLY ? ["--apply", ...extra] : extra;
  const selfHeal = run(APPLY ? "daytrade-warmup:self-heal:apply" : "daytrade-warmup:self-heal", "scripts/run-daytrade-warmup-self-heal.js", selfHealArgs);
  let selfHealPayload = {};
  try { selfHealPayload = JSON.parse(selfHeal.stdout || "{}"); } catch {}

  const unattendedYes = warmup.ok && isUnattendedYes(finalPayload);
  const marketClosed = finalPayload.market_closed === true || selfHealPayload.market_closed === true;
  const ok = unattendedYes || marketClosed;
  const waitingForNaturalPhase = selfHealPayload.state === "WAITING_FOR_NATURAL_PHASE";
  const state = unattendedYes
    ? "WARMUP_UNATTENDED_YES_NO_REWATER_NEEDED"
    : marketClosed
      ? "WARMUP_MARKET_CLOSED_PRESERVE_PREVIOUS_GOOD"
      : waitingForNaturalPhase
        ? "WARMUP_WAITING_FOR_NATURAL_PHASE"
        : selfHeal.ok
          ? "WARMUP_NOT_READY_SELF_HEAL_PLANNED_OR_APPLIED"
          : "WARMUP_NOT_READY_SELF_HEAL_FAILED";

  const result = {
    ok,
    contract: "daytrade-warmup-root-with-self-heal-v2",
    checkedAt: new Date().toISOString(),
    mode: APPLY ? "apply" : "dry-run",
    state,
    invariant: "warmup NO must still produce self-heal queue; self-heal does not backfill natural evidence or fake unattended YES",
    marketClosedPolicy: "market-closed policy may pass without formal entry, but only natural 0700/0845/0900 evidence can set unattended_yes=YES",
    unattendedYes,
    marketClosed,
    selfHealOk: selfHeal.ok,
    selfHealCountsAsUnattendedYes: false,
    warmup,
    finalPayload,
    selfHeal,
    selfHealPayload,
  };
  console.log(JSON.stringify(result, null, 2));
  const rootExitOk = ok || waitingForNaturalPhase;
  if (!rootExitOk) process.exit(1);
}

main();
