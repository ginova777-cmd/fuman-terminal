const { spawnSync } = require("child_process");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

function run(label, args) {
  console.log(`[upload-gate] ${label}`);
  const result = spawnSync(args[0], args.slice(1), {
    cwd: ROOT,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.status === 0) return;
  console.error(`[upload-gate] failed at ${label}`);
  process.exit(result.status || 1);
}

run("verify:sync-hard-gate", [process.execPath, path.join("scripts", "verify-sync-hard-gate.js")]);
run("verify:publish-gate", [process.execPath, path.join("scripts", "verify-publish-gate.js")]);
run("verify:vercel-cost", [process.execPath, path.join("scripts", "verify-vercel-cost-guard.js")]);
run("verify:vercel-projects", [process.execPath, path.join("scripts", "verify-vercel-project-inventory.js")]);

console.log(`[upload-gate] ok root=${ROOT}`);
