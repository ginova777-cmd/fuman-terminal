const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

function git(args, options = {}) {
  const result = spawnSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: options.stdio || "pipe",
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || "");
    process.exit(result.status || 1);
  }
  return result.stdout || "";
}

function run(label, command) {
  console.log(`[snapshot:data] ${label}`);
  const executable = process.platform === "win32" && command[0] === "npm" ? "npm.cmd" : command[0];
  const result = spawnSync(executable, command.slice(1), {
    cwd: ROOT,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    console.error(`[snapshot:data] failed at ${label}`);
    process.exit(result.status || 1);
  }
}

const tracked = git(["diff", "--name-only", "--", "data"])
  .trim()
  .split(/\r?\n/)
  .filter(Boolean);
const untracked = git(["ls-files", "--others", "--exclude-standard", "--", "data"])
  .trim()
  .split(/\r?\n/)
  .filter(Boolean);
const files = [...new Set([...tracked, ...untracked])];

if (!files.length) {
  console.log("[snapshot:data] ok no data changes");
  process.exit(0);
}

for (const file of files) {
  const absolute = path.join(ROOT, file);
  try {
    JSON.parse(fs.readFileSync(absolute, "utf8"));
  } catch (error) {
    console.error(`[snapshot:data] invalid JSON: ${file}`);
    console.error(error.message);
    process.exit(1);
  }
}

run("verify:data-freshness", ["npm", "run", "verify:data-freshness"]);
git(["add", "data"], { stdio: "inherit" });
git(["commit", "-m", "Publish data snapshot"], { stdio: "inherit" });
console.log(`[snapshot:data] ok files=${files.length}`);
