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

function parseJsonOutput(stdout) {
  const raw = String(stdout || "").trim();
  if (raw) {
    try {
      const value = JSON.parse(raw);
      if (value && typeof value === "object") return value;
    } catch {}
  }
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const value = JSON.parse(lines[index]);
      if (value && typeof value === "object") return value;
    } catch {}
  }
  return {};
}

function main() {
  const extra = passThroughArgs();
  const warmup = run("verify:daytrade-warmup-unattended", "scripts/verify-daytrade-warmup-unattended.js", extra);
  const selfHealArgs = APPLY ? ["--apply", ...extra] : extra;
  const selfHeal = run(APPLY ? "daytrade-warmup:self-heal:apply" : "daytrade-warmup:self-heal", "scripts/run-daytrade-warmup-self-heal.js", selfHealArgs);
  const initialPayload = parseJsonOutput(warmup.stdout);
  const selfHealPayload = parseJsonOutput(selfHeal.stdout);
  let postHeal = null;
  if (APPLY && !warmup.ok && selfHeal.ok && selfHealPayload.verificationOk === true) {
    postHeal = run("verify:daytrade-warmup-unattended:post-rewater", "scripts/verify-daytrade-warmup-unattended.js", extra);
  }
  const finalPayload = parseJsonOutput(postHeal?.stdout || warmup.stdout);
  const unattendedYes = finalPayload.unattended_yes === "YES" && finalPayload.natural_warmup_ok === true;
  const formalEntryAllowed = finalPayload.formal_entry_allowed === true;
  const marketClosed = finalPayload.market_closed === true || selfHealPayload.market_closed === true;
  const ok = unattendedYes || marketClosed;
  const state = marketClosed
    ? "WARMUP_MARKET_CLOSED_PRESERVE_PREVIOUS_GOOD"
    : unattendedYes
    ? "WARMUP_UNATTENDED_YES"
    : formalEntryAllowed
      ? "WARMUP_REWATERED_FORMAL_ENTRY_ALLOWED_BUT_UNATTENDED_NO"
      : selfHeal.ok
        ? "WARMUP_NOT_READY_SELF_HEAL_PLANNED_OR_APPLIED"
        : "WARMUP_NOT_READY_SELF_HEAL_FAILED";
  const result = {
    ok,
    unattended_yes: unattendedYes ? "YES" : "NO",
    formal_entry_allowed: formalEntryAllowed,
    market_closed: marketClosed,
    contract: "daytrade-warmup-root-with-self-heal-v2",
    checkedAt: new Date().toISOString(),
    mode: APPLY ? "apply" : "dry-run",
    state,
    invariant: "market-closed policy may pass without formal entry, but only natural 0700/0845/0900 evidence can set unattended_yes=YES",
    warmup,
    selfHeal,
    postHeal,
    finalPayload,
  };
  console.log(JSON.stringify(result, null, 2));
  if (!ok) process.exit(1);
}

main();
