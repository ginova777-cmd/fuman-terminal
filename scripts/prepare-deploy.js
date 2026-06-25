const { spawnSync } = require("child_process");

function run(label, command) {
  console.log(`[prepare-deploy] ${label}`);
  const result = spawnSync(command[0], command.slice(1), {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) {
    console.error(`[prepare-deploy] ${label} failed: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`[prepare-deploy] failed at ${label}`);
    process.exit(result.status || 1);
  }
}

function runCheck(label, command) {
  console.log(`[prepare-deploy] ${label}`);
  return spawnSync(command[0], command.slice(1), {
    stdio: "inherit",
    shell: process.platform === "win32",
  }).status || 0;
}

run("guard:source", ["npm", "run", "guard:source"]);
run("verify:strategy1-open-buy-ui", ["npm", "run", "verify:strategy1-open-buy-ui"]);
const bumpStatus = runCheck("verify:bump", ["npm", "run", "verify:bump"]);
if (bumpStatus !== 0) {
  run("version bump approval", ["node", "scripts/require-version-bump-approval.js", "npm run bump:version"]);
  run("bump:version", ["npm", "run", "bump:version"]);
}
run("verify:version", ["npm", "run", "verify:version"]);
run("verify:sw", ["npm", "run", "verify:sw"]);
run("verify:mobile-layout", ["npm", "run", "verify:mobile-layout"]);

console.log("[prepare-deploy] ok");
