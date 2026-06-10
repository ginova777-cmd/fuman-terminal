const { spawnSync } = require("child_process");

function run(label, command, options = {}) {
  console.log(`[release] ${label}`);
  const result = spawnSync(command[0], command.slice(1), {
    stdio: options.capture ? "pipe" : "inherit",
    encoding: "utf8",
  });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
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

run("verify:all", [process.execPath, "scripts/verify-all.js"]);
run("verify:local-ops", ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts/verify-local-ops.ps1"]);

const status = run("git status", ["git", "status", "--porcelain"], { capture: true }).trim();
if (status) {
  console.error("[release] failed: working tree is not clean.");
  console.error("Commit code changes normally, or run `npm run snapshot:data` for data-only updates.");
  console.error(status);
  process.exit(1);
}

run("push origin main", ["git", "push", "origin", "main"]);
run("verify:live-version", [process.execPath, "--use-system-ca", "scripts/verify-live-version.js"]);

console.log("[release] ok");
