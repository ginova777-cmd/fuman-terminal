const { spawnSync } = require("child_process");

const steps = [
  ["guard:source", ["npm", "run", "guard:source"]],
  ["verify:version", ["npm", "run", "verify:version"]],
  ["verify:bump", ["npm", "run", "verify:bump"]],
  ["verify:sw", ["npm", "run", "verify:sw"]],
  ["verify:data-freshness", ["npm", "run", "verify:data-freshness"]],
  ["verify:live-version", ["npm", "run", "verify:live-version"]],
];

for (const [name, command] of steps) {
  console.log(`[verify:all] ${name}`);
  const result = spawnSync(command[0], command.slice(1), { stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) {
    console.error(`[verify:all] failed at ${name}`);
    process.exit(result.status || 1);
  }
}

console.log("[verify:all] ok");
