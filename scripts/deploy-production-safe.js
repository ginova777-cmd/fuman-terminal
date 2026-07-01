const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const LOCK_FILE = process.env.FUMAN_DEPLOY_LOCK_FILE || "C:\\fuman-runtime\\locks\\fuman-vercel-deploy.lock";
const LAST_DEPLOY_FILE = process.env.FUMAN_DEPLOY_LAST_FILE || "C:\\fuman-runtime\\locks\\fuman-vercel-deploy.last.json";
const LOCK_TTL_MS = Number(process.env.FUMAN_DEPLOY_LOCK_TTL_MS || 2 * 60 * 60 * 1000);
const DUPLICATE_WINDOW_MS = Number(process.env.FUMAN_DEPLOY_DUPLICATE_WINDOW_MS || 30 * 60 * 1000);

function ensureDir(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

function git(args) {
  const result = spawnSync("git", args, { cwd: ROOT, encoding: "utf8", windowsHide: true });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${(result.stderr || result.stdout || "").trim()}`);
  }
  return String(result.stdout || "").trim();
}

function run(label, args) {
  console.log(`[deploy-safe] ${label}`);
  const result = spawnSync(args[0], args.slice(1), {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${label} exited ${result.status || 1}`);
}

function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function acquireLock(releaseSha) {
  ensureDir(LOCK_FILE);
  const now = Date.now();
  const existing = readJsonSafe(LOCK_FILE);
  if (existing?.createdAtMs && now - Number(existing.createdAtMs) < LOCK_TTL_MS) {
    throw new Error(`another deploy appears active: ${LOCK_FILE} sha=${existing.releaseSha || "(unknown)"}`);
  }
  fs.writeFileSync(LOCK_FILE, JSON.stringify({
    releaseSha,
    pid: process.pid,
    host: os.hostname(),
    createdAt: new Date(now).toISOString(),
    createdAtMs: now,
  }, null, 2));
}

function releaseLock() {
  try {
    const existing = readJsonSafe(LOCK_FILE);
    if (existing?.pid === process.pid) fs.unlinkSync(LOCK_FILE);
  } catch {
    // best effort
  }
}

function assertNoDuplicateDeploy(releaseSha) {
  if (process.env.FUMAN_ALLOW_DUPLICATE_DEPLOY === "1") return;
  const last = readJsonSafe(LAST_DEPLOY_FILE);
  if (!last || last.releaseSha !== releaseSha || !last.deployedAtMs) return;
  const ageMs = Date.now() - Number(last.deployedAtMs);
  if (ageMs >= 0 && ageMs < DUPLICATE_WINDOW_MS) {
    throw new Error(`duplicate deploy blocked for ${releaseSha}; set FUMAN_ALLOW_DUPLICATE_DEPLOY=1 to override`);
  }
}

function writeLastDeploy(releaseSha) {
  ensureDir(LAST_DEPLOY_FILE);
  fs.writeFileSync(LAST_DEPLOY_FILE, JSON.stringify({
    releaseSha,
    deployedAt: new Date().toISOString(),
    deployedAtMs: Date.now(),
  }, null, 2));
}

const releaseSha = git(["rev-parse", "HEAD"]);
if (!/^[0-9a-f]{40}$/i.test(releaseSha)) {
  console.error(`[deploy-safe] invalid release sha ${releaseSha}`);
  process.exit(1);
}

try {
  acquireLock(releaseSha);
  run("verify-sync-hard-gate.js", [process.execPath, "scripts/verify-sync-hard-gate.js"]);
  run("verify-vercel-cost-guard.js", [process.execPath, "scripts/verify-vercel-cost-guard.js"]);
  run("verify-vercel-project-inventory.js", [process.execPath, "scripts/verify-vercel-project-inventory.js"]);
  assertNoDuplicateDeploy(releaseSha);
  run("require-version-bump-approval.js", [process.execPath, "scripts/require-version-bump-approval.js", "vercel", "--prod"]);
  run("deploy-production-with-release-env.js", [process.execPath, "scripts/deploy-production-with-release-env.js"]);
  writeLastDeploy(releaseSha);
  console.log(`[deploy-safe] ok releaseSha=${releaseSha}`);
} catch (error) {
  console.error(`[deploy-safe] failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  releaseLock();
}
