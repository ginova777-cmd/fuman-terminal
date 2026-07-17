const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const PRODUCTION_MIRROR_ROOT = path.resolve("C:/fuman-terminal").toLowerCase();
const REQUIRED_VERCEL_PROJECT = "fuman-terminal";
const VERSION_FILES = new Set(["version.json", "index.html", "fuman-sw.js"]);
const DEFAULT_ALLOWED_BRANCHES = ["main"];

function splitList(value) {
  return String(value || "")
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

const allowedBranches = new Set([
  ...DEFAULT_ALLOWED_BRANCHES,
  ...splitList(process.env.FUMAN_RELEASE_BRANCH),
  ...splitList(process.env.FUMAN_RELEASE_BRANCHES),
]);

const issues = [];

function git(args) {
  const result = spawnSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  });
  return {
    ok: result.status === 0,
    stdout: String(result.stdout || "").trim(),
    stderr: String(result.stderr || "").trim(),
  };
}

function fail(message) {
  issues.push(message);
}

function assertCleanWorktree() {
  const status = git(["status", "--porcelain=v1", "--untracked-files=all"]);
  if (!status.ok) {
    fail(`git status failed: ${status.stderr}`);
    return;
  }
  if (!status.stdout) return;
  fail(`working tree must be clean and have no untracked files:\n${status.stdout.split(/\r?\n/).slice(0, 40).join("\n")}`);
  const versionDirty = status.stdout
    .split(/\r?\n/)
    .map((line) => line.slice(3).replace(/\\/g, "/"))
    .filter((file) => VERSION_FILES.has(file));
  if (versionDirty.length) {
    fail(`version-bearing files have uncommitted changes: ${versionDirty.join(", ")}`);
  }
}

function assertBranchAndSync() {
  const branch = git(["branch", "--show-current"]);
  if (!branch.ok || !branch.stdout) {
    fail(`cannot detect current branch: ${branch.stderr || "(detached HEAD)"}`);
    return;
  }
  if (!allowedBranches.has(branch.stdout)) {
    fail(`branch must be one of ${[...allowedBranches].join(", ")}; current=${branch.stdout}`);
  }

  const upstream = git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  if (!upstream.ok || !upstream.stdout) {
    fail(`branch ${branch.stdout} must track an upstream remote branch`);
    return;
  }
  const counts = git(["rev-list", "--left-right", "--count", `${upstream.stdout}...HEAD`]);
  if (!counts.ok) {
    fail(`cannot compare with upstream ${upstream.stdout}: ${counts.stderr}`);
    return;
  }
  const [behindText = "0", aheadText = "0"] = counts.stdout.split(/\s+/);
  const behind = Number(behindText) || 0;
  const ahead = Number(aheadText) || 0;
  if (behind > 0) fail(`branch is behind ${upstream.stdout} by ${behind} commit(s); run git pull --ff-only in a clean tree`);
  if (ahead > 0) fail(`branch has ${ahead} unpushed commit(s); push before deploy`);

  if (branch.stdout === "main" && upstream.stdout !== "origin/main") {
    fail(`main must track origin/main; current upstream=${upstream.stdout}`);
  }
}

function assertVercelProject() {
  const projectFile = path.join(ROOT, ".vercel", "project.json");
  if (!fs.existsSync(projectFile)) {
    fail(".vercel/project.json is missing; do not deploy until the Vercel project is confirmed");
    return;
  }
  try {
    const project = JSON.parse(fs.readFileSync(projectFile, "utf8"));
    if (project.projectName !== REQUIRED_VERCEL_PROJECT) {
      fail(`.vercel/project.json projectName must be ${REQUIRED_VERCEL_PROJECT}; current=${project.projectName || "(missing)"}`);
    }
    if (!project.projectId || !project.orgId) {
      fail(".vercel/project.json must contain projectId and orgId");
    }
  } catch (error) {
    fail(`.vercel/project.json is invalid JSON: ${error.message}`);
  }
}

function assertProductionMirrorPolicy() {
  const actualRoot = ROOT.toLowerCase();
  if (actualRoot === PRODUCTION_MIRROR_ROOT) {
    fail("C:\\fuman-terminal is production mirror only; run release/deploy gates from the release clone, not the mirror");
  }
}

function assertProductionMirrorClean() {
  const mirrorRoot = process.env.FUMAN_PRODUCTION_MIRROR_ROOT || process.env.FUMAN_DEPLOY_SOURCE_DIR || ROOT;
  const mirrorGuard = spawnSync(process.execPath, ["scripts/verify-production-mirror-guard.js"], {
    cwd: ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      FUMAN_PRODUCTION_MIRROR_ROOT: mirrorRoot,
    },
    windowsHide: true,
  });
  if (mirrorGuard.status === 0) return;
  const output = `${mirrorGuard.stdout || ""}${mirrorGuard.stderr || ""}`.trim();
  fail(output || "production mirror guard failed");
}

assertCleanWorktree();
assertBranchAndSync();
assertVercelProject();
assertProductionMirrorPolicy();
assertProductionMirrorClean();

if (issues.length) {
  console.error("[sync-hard-gate] failed");
  for (const issue of issues) console.error(`- ${issue}`);
  process.exit(1);
}

console.log(`[sync-hard-gate] ok root=${ROOT}`);
