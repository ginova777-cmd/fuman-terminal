const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const DEPLOY_ROOT = path.resolve(
  process.env.FUMAN_DEPLOY_SOURCE_DIR ||
  process.env.FUMAN_MAIN_DEPLOY_REPO ||
  "C:\\fuman-terminal"
);
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime";
const LOG_DIR = path.join(RUNTIME_DIR, "logs");
const STATE_DIR = path.join(RUNTIME_DIR, "state");
const AUTO_CLEANUP = process.env.FUMAN_DEPLOY_WORKTREE_MONITOR_AUTO_CLEANUP !== "0";

function runNode(args) {
  return spawnSync(process.execPath, args, {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    env: {
      ...process.env,
      FUMAN_DEPLOY_SOURCE_DIR: DEPLOY_ROOT,
    },
  });
}

function writeText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, "utf8");
}

function appendLog(lines) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const logFile = path.join(LOG_DIR, `deploy-worktree-clean-${stamp}.log`);
  writeText(logFile, `${lines.filter(Boolean).join("\n")}\n`);
  return logFile;
}

function writeState(state) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  writeText(path.join(STATE_DIR, "deploy-worktree-clean-status.json"), `${JSON.stringify(state, null, 2)}\n`);
}

function main() {
  const startedAt = new Date().toISOString();
  const lines = [
    `[deploy-worktree-monitor] started ${startedAt}`,
    `[deploy-worktree-monitor] root=${DEPLOY_ROOT}`,
  ];

  let verify = runNode(["scripts/verify-deploy-worktree-clean.js"]);
  lines.push(verify.stdout.trim(), verify.stderr.trim());
  let cleanup = null;

  if (verify.status !== 0 && AUTO_CLEANUP) {
    lines.push("[deploy-worktree-monitor] cleanup start");
    cleanup = runNode(["scripts/verify-deploy-worktree-clean.js", "--fix"]);
    lines.push(cleanup.stdout.trim(), cleanup.stderr.trim());
    lines.push("[deploy-worktree-monitor] cleanup end");
    verify = runNode(["scripts/verify-deploy-worktree-clean.js"]);
    lines.push(verify.stdout.trim(), verify.stderr.trim());
  }

  const ok = verify.status === 0;
  const state = {
    ok,
    startedAt,
    finishedAt: new Date().toISOString(),
    deployRoot: DEPLOY_ROOT,
    autoCleanup: AUTO_CLEANUP,
    verifyExitCode: verify.status,
    cleanupExitCode: cleanup ? cleanup.status : null,
  };
  const logFile = appendLog(lines);
  state.log = logFile;
  writeState(state);

  if (!ok) {
    console.error(`[deploy-worktree-monitor] failed log=${logFile}`);
    process.exit(1);
  }
  console.log(`[deploy-worktree-monitor] ok log=${logFile}`);
}

main();
