const fs = require("fs");
const path = require("path");
const { ROOT, dataPath } = require("./runtime-paths");
const { writeSummary } = require("./cache-summary");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

const jobs = [
  ["strategy4", path.join(ROOT, "data", "strategy4-latest.json"), path.join(ROOT, "data", "strategy4-summary.json")],
  ["strategy4", dataPath("strategy4-latest.json"), dataPath("strategy4-summary.json")],
  ["institution", dataPath("institution-latest.json"), dataPath("institution-summary.json")],
  ["warrant", dataPath("warrant-flow-latest.json"), dataPath("warrant-flow-summary.json")],
];

for (const [kind, input, output] of jobs) {
  if (!fs.existsSync(input)) {
    console.log(`summary skipped ${kind}: missing ${input}`);
    continue;
  }
  const summary = writeSummary(kind, readJson(input), output);
  console.log(`summary wrote ${path.basename(output)} count=${summary.count || 0}`);
}
