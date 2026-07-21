const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const DEFAULT_MIRROR_ROOT = "C:\\fuman-terminal";
const MIRROR_ROOT = path.resolve(
  process.env.FUMAN_PRODUCTION_MIRROR_ROOT ||
  process.env.FUMAN_DEPLOY_SOURCE_DIR ||
  DEFAULT_MIRROR_ROOT
);
const RELEASE_SHA = normalizeSha(
  readArg("--release-sha") ||
  process.env.FUMAN_RELEASE_SHA ||
  process.env.FUMAN_DEPLOY_SHA
);
const ALLOW_DIRTY = process.argv.includes("--allow-dirty");
const REQUIRE_MAIN = !process.argv.includes("--allow-non-main");
const GENERATED_DIRTY_ALLOWLIST = new Set(["data/terminal-ops-status-latest.json"]);

const issues = [];

function readArg(name) {
  const inline = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  if (index >= 0) return process.argv[index + 1] || "";
  return "";
}

function normalizeSha(value) {
  return String(value || "").trim().toLowerCase();
}

function git(args) {
  return spawnSync("git", ["-c", `safe.directory=${MIRROR_ROOT}`, ...args], {
    cwd: MIRROR_ROOT,
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  });
}

function gitText(args) {
  const result = git(args);
  return {
    ok: result.status === 0,
    stdout: String(result.stdout || "").trim(),
    stderr: String(result.stderr || "").trim(),
  };
}

function fail(message) {
  issues.push(message);
}

function parsePorcelain(output) {
  return String(output || "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => ({ raw: line, file: line.slice(3).replace(/\\/g, "/") }));
}

if (!fs.existsSync(MIRROR_ROOT)) {
  fail(`production mirror missing: ${MIRROR_ROOT}`);
} else if (!fs.existsSync(path.join(MIRROR_ROOT, ".git"))) {
  fail(`production mirror is not a git worktree: ${MIRROR_ROOT}`);
} else {
  const branch = gitText(["branch", "--show-current"]);
  if (!branch.ok) fail(`cannot read mirror branch: ${branch.stderr}`);
  if (REQUIRE_MAIN && branch.stdout !== "main") {
    fail(`production mirror must stay on main; current=${branch.stdout || "(detached)"}`);
  }

  const status = gitText(["status", "--porcelain=v1", "--untracked-files=all"]);
  if (!status.ok) {
    fail(`cannot read mirror worktree status: ${status.stderr}`);
  } else if (status.stdout && !ALLOW_DIRTY) {
    const dirtyEntries = parsePorcelain(status.stdout);
    const blockingDirty = dirtyEntries.filter((entry) => !GENERATED_DIRTY_ALLOWLIST.has(entry.file));
    if (blockingDirty.length) {
      fail(`production mirror is dirty and cannot be used for deploy:\n${blockingDirty.map((entry) => entry.raw).slice(0, 40).join("\n")}`);
    } else if (dirtyEntries.length) {
      console.warn(`[production-mirror-guard] allowing generated ops artifact dirty: ${dirtyEntries.map((entry) => entry.file).join(", ")}`);
    }
  }

  const head = gitText(["rev-parse", "HEAD"]);
  if (!head.ok) {
    fail(`cannot read mirror HEAD: ${head.stderr}`);
  } else if (RELEASE_SHA && normalizeSha(head.stdout) !== RELEASE_SHA) {
    fail(`production mirror HEAD must equal release SHA: mirror=${head.stdout.slice(0, 8)} release=${RELEASE_SHA.slice(0, 8)}`);
  }
}

if (issues.length) {
  console.error("[production-mirror-guard] failed");
  for (const issue of issues) console.error(`- ${issue}`);
  process.exit(1);
}

const head = gitText(["rev-parse", "HEAD"]).stdout || "";
console.log(`[production-mirror-guard] ok root=${MIRROR_ROOT} head=${head.slice(0, 8)} release=${RELEASE_SHA ? RELEASE_SHA.slice(0, 8) : "none"}`);

