const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const sourceFile = path.join(ROOT, "terminal-desktop-fast-shell.js");
const outDir = path.join(ROOT, "outputs", "fast-shell-regression-drill");
const drillFile = path.join(outDir, "terminal-desktop-fast-shell.missing-normalizeArray.js");
const reportFile = path.join(outDir, "fast-shell-regression-drill.json");

fs.mkdirSync(outDir, { recursive: true });

const source = fs.readFileSync(sourceFile, "utf8");
const start = source.indexOf("\n  function normalizeArray(");
const end = source.indexOf("\n  function pickFirstValue(", start);
const mutated = start >= 0 && end > start
  ? `${source.slice(0, start)}\n${source.slice(end)}`
  : source;

if (mutated === source) {
  console.error("[fast-shell-regression-drill] failed");
  console.error("- drill could not remove normalizeArray helper; update the drill pattern");
  process.exit(1);
}

fs.writeFileSync(drillFile, mutated, "utf8");

const result = spawnSync(process.execPath, [
  path.join(ROOT, "scripts", "verify-fast-shell-self-contained.js"),
  `--file=${drillFile}`,
], {
  cwd: ROOT,
  encoding: "utf8",
});

const output = `${result.stdout || ""}${result.stderr || ""}`;
const ok = result.status !== 0 && output.includes("normalizeArray");
const report = {
  contract: "fast-shell-regression-drill-v1",
  scenario: "remove normalizeArray from desktop fast shell",
  expected: "verify-fast-shell-self-contained must fail before publish",
  ok,
  status: result.status,
  output,
  drillFile,
  updatedAt: new Date().toISOString(),
};

fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");

if (!ok) {
  console.error("[fast-shell-regression-drill] failed");
  console.error("- self-contained gate did not catch the missing normalizeArray helper");
  console.error(output.trim());
  process.exit(1);
}

console.log(`[fast-shell-regression-drill] ok ${reportFile}`);
