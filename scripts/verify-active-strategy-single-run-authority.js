const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const failures = [];

const wrappers = ["run-strategy5.ps1", "run-institution.ps1"];
for (const file of wrappers) {
  const text = read(file);
  if (!text.includes("single canonical attempt")) failures.push(`${file}: missing single canonical attempt marker`);
  if (!text.includes("rerunAllowed=false")) failures.push(`${file}: missing fail-closed rerun marker`);
  if (/for\s*\(\s*\$attempt/i.test(text)) failures.push(`${file}: retry loop is forbidden`);
  if (/Waiting 60 seconds before retry/i.test(text)) failures.push(`${file}: retry sleep is forbidden`);
}

const watchdogs = ["run-strategy5-watchdog.ps1", "run-flow-watchdog.ps1"];
for (const file of watchdogs) {
  const text = read(file);
  if (!text.includes("read-only watchdog will not start a second formal run")) {
    failures.push(`${file}: missing read-only no-second-run declaration`);
  }
  for (const forbidden of [/Start-ScheduledTask/i, /schtasks(?:\.exe)?\s+\/Run/i]) {
    if (forbidden.test(text)) failures.push(`${file}: watchdog may start an execution task`);
  }
}

const result = {
  contract: "active-strategy-single-run-authority-v1",
  ok: failures.length === 0,
  wrappers,
  watchdogs,
  failures,
};
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exit(1);