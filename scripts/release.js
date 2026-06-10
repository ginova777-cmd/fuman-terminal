const { spawnSync } = require("child_process");

function run(label, command, options = {}) {
  console.log(`[release] ${label}`);
  const executable = process.platform === "win32" && command[0] === "npm" ? "npm.cmd" : command[0];
  const result = spawnSync(executable, command.slice(1), {
    stdio: options.capture ? "pipe" : "inherit",
    encoding: "utf8",
  });
  if (result.status !== 0) {
    if (options.capture) {
      process.stdout.write(result.stdout || "");
      process.stderr.write(result.stderr || "");
    }
    console.error(`[release] failed at ${label}`);
    process.exit(result.status || 1);
  }
  return result.stdout || "";
}

run("verify:all", ["npm", "run", "verify:all"]);
run("verify:local-ops", ["npm", "run", "verify:local-ops"]);

const status = run("git status", ["git", "status", "--porcelain"], { capture: true }).trim();
if (status) {
  console.error("[release] failed: working tree is not clean.");
  console.error("Commit code changes normally, or run `npm run snapshot:data` for data-only updates.");
  console.error(status);
  process.exit(1);
}

run("push origin main", ["git", "push", "origin", "main"]);
run("verify:live-version", ["npm", "run", "verify:live-version"]);

console.log("[release] ok");
