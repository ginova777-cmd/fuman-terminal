#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const retired = "verify-daytrade-source-speed-readonly.js";
const issues = [];
if (fs.existsSync(path.join(root, "scripts", retired))) issues.push("retired verifier still exists");
const roots = ["package.json", "scripts", "docs", "ops"];
function visit(relative) {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) return;
  const stat = fs.statSync(absolute);
  if (stat.isDirectory()) {
    for (const name of fs.readdirSync(absolute)) visit(path.join(relative, name));
    return;
  }
  if (relative === "package.json.bak" || relative.replace(/\\/g, "/") === "scripts/verify-daytrade-source-speed-retirement-contract.js") return;
  if (fs.readFileSync(absolute, "utf8").includes(retired)) issues.push(`${relative}: references retired verifier`);
}
for (const entry of roots) visit(entry);
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const command = packageJson.scripts?.["verify:daytrade-source-speed"] || "";
for (const required of ["verify-daytrade-websocket-transport-readonly.js", "verify-daytrade-source-contract-alignment.js", "verify-daytrade-mother-pool-skeleton.js"]) {
  if (!command.includes(required)) issues.push(`replacement chain missing ${required}`);
}
if (issues.length) { console.error(JSON.stringify({ ok: false, issues })); process.exit(1); }
console.log(JSON.stringify({ ok: true, retired, replacementCommand: command }));