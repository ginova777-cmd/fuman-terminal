"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.resolve(process.argv.find((arg) => arg.startsWith("--out="))?.slice("--out=".length) || path.join(ROOT, "outputs", "strategy34-terminal-surface-closure"));

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function tail(text, lines = 80) {
  return String(text || "").split(/\r?\n/).slice(-lines).join("\n").trim();
}

function run(label, scriptName) {
  const startedAt = new Date().toISOString();
  const isWin = process.platform === "win32";
  const command = isWin ? "cmd.exe" : "npm";
  const args = isWin ? ["/d", "/s", "/c", `npm run ${scriptName}`] : ["run", scriptName];
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env },
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  const stdout = String(result.stdout || "");
  const stderr = String(result.stderr || "");
  return {
    label,
    command: [command, ...args].join(" "),
    startedAt,
    finishedAt: new Date().toISOString(),
    exitCode: typeof result.status === "number" ? result.status : 1,
    signal: result.signal || "",
    error: result.error ? String(result.error.message || result.error) : "",
    stdoutTail: tail(stdout),
    stderrTail: tail(stderr),
  };
}

function main() {
  ensureDir(OUT_DIR);
  const checks = [
    run("strategy3_full_closure", "verify:strategy3-full-closure"),
    run("strategy4_full_closure", "verify:strategy4-full-closure"),
  ];
  const issues = [];
  for (const check of checks) {
    if (check.exitCode !== 0) issues.push(`${check.label}_failed:${check.exitCode}`);
  }
  const payload = {
    ok: issues.length === 0,
    contract: "strategy34-terminal-surface-closure-v1",
    verifier: "verify-strategy34-terminal-surface-closure",
    checked_at: new Date().toISOString(),
    guarantees: [
      "strategy3 and strategy4 cannot publish from stale or mismatched source evidence",
      "Strategy3 LINE card, API, Supabase result rows, terminal surfaces, mobile, scorecard and /88 must close on the same runId",
      "Strategy4 source root, match yield, LINE card, API, Supabase result rows, terminal surfaces, mobile, scorecard and /88 must close on the same runId",
      "Any failed child verifier makes this verifier fail-closed; previous-good or fallback cannot count as fresh success",
    ],
    checks: checks.map(({ stdoutTail, stderrTail, ...rest }) => rest),
    artifacts: checks.map((check) => ({ label: check.label, stdoutTail: check.stdoutTail, stderrTail: check.stderrTail })),
    issues,
    first_blocker: issues[0] || "",
    reason_code: issues.length ? "strategy34_terminal_surface_closure_failed" : "strategy34_terminal_surface_closure_ok",
    allowed_action: issues.length ? "fail_closed_fix_first_child_verifier_then_rerun_strategy34_surface_closure" : "allow_strategy3_strategy4_surface_publish",
  };
  const jsonFile = path.join(OUT_DIR, "strategy34-terminal-surface-closure.json");
  fs.writeFileSync(jsonFile, JSON.stringify(payload, null, 2) + "\n", "utf8");
  console.log(JSON.stringify({ ok: payload.ok, verifier: payload.verifier, reason_code: payload.reason_code, output: jsonFile, issues }, null, 2));
  if (!payload.ok) process.exit(1);
}

main();
