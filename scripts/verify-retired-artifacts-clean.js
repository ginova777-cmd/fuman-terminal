const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const CLEANUP_SCRIPT = path.join(ROOT, "scripts", "cleanup-api-only-retired-artifacts.js");

function readCleanupRetiredList() {
  const text = fs.readFileSync(CLEANUP_SCRIPT, "utf8");
  const match = text.match(/const EXACT_RETIRED = \[([\s\S]*?)\];/);
  if (!match) throw new Error("cannot find EXACT_RETIRED in cleanup script");
  return [...match[1].matchAll(/"([^"]+)"/g)]
    .map((item) => item[1].replace(/\\/g, "/"))
    .filter(Boolean);
}

function gitTrackedFiles() {
  const result = spawnSync("git", ["ls-files"], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(`git ls-files failed: ${(result.stderr || result.stdout || "").trim()}`);
  }
  return new Set(String(result.stdout || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
}

const retired = readCleanupRetiredList();
const tracked = gitTrackedFiles();
const trackedRetired = retired.filter((file) => tracked.has(file));
const existingRetired = retired.filter((file) => fs.existsSync(path.join(ROOT, file)));
const issues = [];

if (trackedRetired.length) {
  issues.push(`retired artifacts must not be tracked in source:\n${trackedRetired.join("\n")}`);
}
if (existingRetired.length) {
  issues.push(`retired artifacts must not exist in source:\n${existingRetired.join("\n")}`);
}

if (issues.length) {
  console.error("[retired-artifacts-clean] failed");
  for (const issue of issues) console.error(`- ${issue}`);
  process.exit(1);
}

console.log(`[retired-artifacts-clean] ok retired=${retired.length}`);
