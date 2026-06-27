const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const DEPLOY_ROOT = path.resolve(
  process.env.FUMAN_DEPLOY_SOURCE_DIR ||
  process.env.FUMAN_MAIN_DEPLOY_REPO ||
  "C:\\fuman-terminal"
);
const OUT_DIR = path.join(ROOT, "outputs", "deploy-worktree-clean");
const FIX = process.argv.includes("--fix") || process.argv.includes("--cleanup");

const DEFAULT_ALLOWLIST = [
  "data/scorecard-latest.json",
];

function normalizeRel(file) {
  return String(file || "")
    .replace(/\\/g, "/")
    .replace(/^["']|["']$/g, "")
    .trim();
}

function allowlist() {
  const extra = String(process.env.DEPLOY_WORKTREE_DIRTY_ALLOWLIST || "")
    .split(/[;,]/)
    .map(normalizeRel)
    .filter(Boolean);
  return new Set([...DEFAULT_ALLOWLIST, ...extra]);
}

function git(args, cwd = DEPLOY_ROOT) {
  return spawnSync("git", ["-c", `safe.directory=${DEPLOY_ROOT}`, ...args], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
}

function parsePorcelain(text) {
  return String(text || "")
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => {
      const status = line.slice(0, 2);
      let file = normalizeRel(line.slice(3));
      if (file.includes(" -> ")) file = normalizeRel(file.split(" -> ").pop());
      return { status, file, line };
    });
}

function isForbiddenStaticData(file) {
  const rel = normalizeRel(file);
  return /^data\/[^/]+\.(?:json|html)$/i.test(rel) ||
    /^data\/mobile-[^/]+/i.test(rel) ||
    /^data\/terminal-home-[^/]+/i.test(rel) ||
    /^data\/mobile-analysis\/.+\.json$/i.test(rel);
}

function isInside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function fixForbiddenIssue(issue) {
  const rel = normalizeRel(issue.file);
  const target = path.resolve(DEPLOY_ROOT, rel);
  if (!isInside(DEPLOY_ROOT, target)) return { ...issue, fixed: false, fixReason: "outside deploy root" };
  if (issue.status === "??") {
    if (fs.existsSync(target) && fs.statSync(target).isFile()) {
      fs.unlinkSync(target);
      return { ...issue, fixed: true, fixAction: "delete-untracked" };
    }
    return { ...issue, fixed: false, fixReason: "untracked file missing" };
  }
  const restored = git(["restore", "--", rel]);
  return {
    ...issue,
    fixed: restored.status === 0,
    fixAction: "git-restore",
    fixReason: restored.status === 0 ? "" : (restored.stderr || restored.stdout || "").trim(),
  };
}

function inspectDirty(allowed) {
  const status = git(["status", "--porcelain=v1", "--untracked-files=all"]);
  if (status.status !== 0) {
    return {
      statusOk: false,
      statusError: (status.stderr || status.stdout || "").trim(),
      dirty: [],
      dirtyCount: 0,
      allowedDirty: [],
      ignoredDirty: [],
      issues: [],
    };
  }
  const dirty = parsePorcelain(status.stdout);
  const allowedDirty = [];
  const ignoredDirty = [];
  const issues = [];
  for (const item of dirty) {
    if (!isForbiddenStaticData(item.file)) {
      ignoredDirty.push(item);
      continue;
    }
    if (allowed.has(item.file)) {
      allowedDirty.push(item);
      continue;
    }
    issues.push({
      ...item,
      reason: "static data artifact dirty/untracked in deploy worktree",
    });
  }
  return { statusOk: true, statusError: "", dirty, dirtyCount: dirty.length, allowedDirty, ignoredDirty, issues };
}

function writeReport(result) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "deploy-worktree-clean.json"), `${JSON.stringify(result, null, 2)}\n`);
  const lines = [
    "# Deploy Worktree Clean",
    "",
    `- Checked: ${result.checkedAt}`,
    `- Deploy root: ${result.deployRoot}`,
    `- Dirty entries: ${result.dirtyCount}`,
    `- Static data issues: ${result.issues.length}`,
    "",
  ];
  if (result.allowedDirty.length) {
    lines.push("## Allowed Dirty");
    for (const item of result.allowedDirty) lines.push(`- ${item.status} ${item.file}`);
    lines.push("");
  }
  if (result.issues.length) {
    lines.push("## Issues");
    for (const issue of result.issues) lines.push(`- ${issue.status} ${issue.file}: ${issue.reason}`);
    lines.push("");
  }
  fs.writeFileSync(path.join(OUT_DIR, "deploy-worktree-clean.md"), `${lines.join("\n")}\n`);
}

function main() {
  const result = {
    ok: false,
    checkedAt: new Date().toISOString(),
    deployRoot: DEPLOY_ROOT,
    allowlist: [...allowlist()],
    dirtyCount: 0,
    allowedDirty: [],
    ignoredDirty: [],
    issues: [],
    fixed: [],
  };

  if (!fs.existsSync(DEPLOY_ROOT)) {
    result.issues.push({ status: "", file: DEPLOY_ROOT, reason: "deploy root missing" });
    writeReport(result);
    console.error(`[deploy-worktree-clean] failed root missing ${DEPLOY_ROOT}`);
    process.exit(1);
  }
  if (!fs.existsSync(path.join(DEPLOY_ROOT, ".git"))) {
    result.issues.push({ status: "", file: DEPLOY_ROOT, reason: "deploy root is not a git worktree" });
    writeReport(result);
    console.error(`[deploy-worktree-clean] failed not git ${DEPLOY_ROOT}`);
    process.exit(1);
  }

  const allowed = allowlist();
  let inspected = inspectDirty(allowed);
  if (!inspected.statusOk) {
    result.issues.push({
      status: "",
      file: DEPLOY_ROOT,
      reason: `git status failed ${inspected.statusError}`,
    });
    writeReport(result);
    console.error("[deploy-worktree-clean] failed git status");
    process.exit(1);
  }

  Object.assign(result, {
    dirtyCount: inspected.dirtyCount,
    allowedDirty: inspected.allowedDirty,
    ignoredDirty: inspected.ignoredDirty,
    issues: inspected.issues,
  });

  if (FIX && result.issues.length) {
    result.fixed = result.issues.map(fixForbiddenIssue);
    inspected = inspectDirty(allowed);
    Object.assign(result, {
      dirtyCount: inspected.dirtyCount,
      allowedDirty: inspected.allowedDirty,
      ignoredDirty: inspected.ignoredDirty,
      issues: inspected.issues,
    });
  }

  result.ok = result.issues.length === 0;
  writeReport(result);
  if (!result.ok) {
    console.error(`[deploy-worktree-clean] failed deploy=${DEPLOY_ROOT}`);
    for (const issue of result.issues) console.error(`- ${issue.status} ${issue.file}: ${issue.reason}`);
    process.exit(1);
  }
  console.log(`[deploy-worktree-clean] ok deploy=${DEPLOY_ROOT} dirty=${result.dirtyCount} staticIssues=0`);
}

main();
