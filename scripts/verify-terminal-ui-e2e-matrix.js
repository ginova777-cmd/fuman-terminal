const childProcess = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUT_ROOT = path.resolve(process.argv.find((arg) => arg.startsWith("--out="))?.slice("--out=".length) || "outputs/terminal-ui-e2e-matrix");
const BASE_URL = process.argv.find((arg) => arg.startsWith("--base-url=")) || "";
const ROUTES = process.argv.find((arg) => arg.startsWith("--routes=")) || "";
const EXTRA = process.argv.filter((arg) => ["--headful", "--no-screenshots", "--debug"].includes(arg));

const RUNS = [
  ["desktop", "desktop-night,desktop-sun"],
  ["mobile-phone-portrait", "mobile-phone-portrait-night,mobile-phone-portrait-sun"],
  ["mobile-phone-landscape", "mobile-phone-landscape-night,mobile-phone-landscape-sun"],
  ["mobile-tablet", "mobile-tablet-night,mobile-tablet-sun"],
  ["mobile-desktop", "mobile-desktop-night,mobile-desktop-sun"],
];

function runOne(label, only) {
  const out = path.join(OUT_ROOT, label);
  fs.mkdirSync(out, { recursive: true });
  const args = [
    "--use-system-ca",
    path.join("scripts", "verify-terminal-ui-e2e.js"),
    `--only=${only}`,
    `--out=${out}`,
    ...EXTRA,
  ];
  if (BASE_URL) args.push(BASE_URL);
  if (ROUTES) args.push(ROUTES);
  console.log(`[terminal-ui-e2e-matrix] ${label} ${only}`);
  const result = childProcess.spawnSync(process.execPath, args, {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env,
  });
  return {
    label,
    only,
    out,
    status: result.status === 0 ? "PASS" : "FAIL",
    exitCode: result.status ?? 1,
  };
}

function writeSummary(results) {
  fs.mkdirSync(OUT_ROOT, { recursive: true });
  const lines = [
    "# Terminal UI E2E Matrix",
    "",
    `- Generated: ${new Date().toISOString()}`,
    `- Overall: ${results.every((row) => row.status === "PASS") ? "PASS" : "FAIL"}`,
    "",
    "| Segment | Modes | Result | Report |",
    "|---|---|---|---|",
  ];
  for (const row of results) {
    const report = path.join(row.out, "terminal-ui-e2e-report.md");
    lines.push(`| ${row.label} | ${row.only} | ${row.status} | ${report} |`);
  }
  fs.writeFileSync(path.join(OUT_ROOT, "terminal-ui-e2e-matrix.md"), `${lines.join("\n")}\n`);
  fs.writeFileSync(path.join(OUT_ROOT, "terminal-ui-e2e-matrix.json"), `${JSON.stringify(results, null, 2)}\n`);
}

async function main() {
  const results = [];
  for (const [label, only] of RUNS) {
    results.push(runOne(label, only));
  }
  writeSummary(results);
  const failed = results.filter((row) => row.status !== "PASS");
  if (failed.length) {
    console.error(`[terminal-ui-e2e-matrix] failed ${failed.map((row) => row.label).join(", ")}`);
    process.exit(1);
  }
  console.log(`[terminal-ui-e2e-matrix] ok ${OUT_ROOT}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
