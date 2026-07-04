"use strict";

const { spawnSync } = require("child_process");

const CHECKS = [
  ["requirements", "node scripts/verify-warrant-strategy-requirements.js"],
  ["business-fields", "node scripts/verify-warrant-business-fields.js"],
  ["fixtures", "node scripts/verify-warrant-prewater-fixture.js"],
  ["formal-payloads", "node scripts/verify-warrant-formal-payloads.js"],
  ["ui-display", "node scripts/verify-warrant-ui-display.js"],
  ["source-plan", "node scripts/verify-warrant-prewater-source-plan.js"],
];

function run(commandText) {
  const command = process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : "sh";
  const args = process.platform === "win32" ? ["/d", "/s", "/c", commandText] : ["-lc", commandText];
  return spawnSync(command, args, {
    cwd: process.cwd(),
    shell: false,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
}

const failures = [];
for (const [label, command] of CHECKS) {
  const result = run(command);
  process.stdout.write(result.stdout || "");
  process.stderr.write(result.stderr || "");
  if (result.status !== 0) failures.push({ label, command, exitCode: result.status });
}

if (failures.length) {
  console.error("[warrant-prewater-strict] FAIL " + JSON.stringify(failures));
  process.exit(1);
}
console.log("[warrant-prewater-strict] PASS");
