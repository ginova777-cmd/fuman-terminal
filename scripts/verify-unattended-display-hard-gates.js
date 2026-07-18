"use strict";

const childProcess = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "outputs", "unattended-display-hard-gates");

const CHECKS = [
  {
    key: "membership_layering",
    rule: "Unauthenticated 401/membership_required must be display protection, not computation failure.",
    command: ["npm", "run", "verify:membership-e2e-layering"],
  },
  {
    key: "membership_ui_state",
    rule: "Protected desktop/mobile surfaces must show a membership/permission state instead of looking broken.",
    command: ["npm", "run", "verify:membership-ui-state"],
  },
  {
    key: "retired_static_artifacts",
    rule: "Retired static JSON/latest/snapshot files must not be formal data sources.",
    command: ["npm", "run", "verify:retired-artifacts"],
  },
  {
    key: "source_date_contracts",
    rule: "Market calendar, target trade date, source trade date, and quote date must be aligned or explicitly gated.",
    command: ["npm", "run", "verify:terminal-source-contracts"],
  },
  {
    key: "terminal_resource_chain",
    rule: "Computation latest, desktop snapshot, protected API, mobile, and /88 membership display states must not be confused.",
    command: ["npm", "run", "verify:terminal-resource-chain"],
  },
  {
    key: "protected_route_no_stale_first_paint",
    rule: "Protected strategy/chip pages must not first-paint old snapshot/cache rows as current data.",
    command: ["npm", "run", "verify:protected-route-no-stale-first-paint"],
  },
  {
    key: "ui_state_acceptance",
    rule: "Empty, blocked, degraded, and zero-result states must render explicitly on desktop and mobile.",
    command: ["npm", "run", "verify:terminal-ui-state-acceptance"],
  },
  {
    key: "mobile_api_only",
    rule: "Mobile routes must use API/fragment contracts, not retired static JSON as formal truth.",
    command: ["npm", "run", "verify:mobile-api-only"],
  },
  {
    key: "mobile_cache_contract",
    rule: "Mobile cache/service-worker behavior must not serve stale formal data as live truth.",
    command: ["npm", "run", "verify:mobile-cache-contract"],
  },
  {
    key: "scorecard_chain",
    rule: "/88 scorecard chain must preserve latest-good data and not treat protected access as missing computation.",
    command: ["npm", "run", "verify:scorecard-chain"],
  },
  {
    key: "scorecard_page_contract",
    rule: "/88 page contract must expose protected/blocked/fallback states without technical leakage.",
    command: ["npm", "run", "verify:scorecard-page-contract"],
  },
  {
    key: "market_calendar_contract",
    rule: "Holiday/typhoon/non-trading gates must preserve previous good and not mark scans as failed.",
    command: ["npm", "run", "verify:market-calendar-contract"],
  },
  {
    key: "service_worker_smoke",
    rule: "Service worker must not keep serving old bundles after the app contract changes.",
    command: ["npm", "run", "verify:sw"],
  },
];

function npmCommand(command) {
  if (command[0] !== "npm") return command;
  return [process.platform === "win32" ? "npm.cmd" : "npm", ...command.slice(1)];
}

function runCheck(check) {
  const startedAt = new Date();
  const [bin, ...args] = npmCommand(check.command);
  const spawnTarget = process.platform === "win32" ? [bin, ...args].join(" ") : bin;
  const spawnArgs = process.platform === "win32" ? [] : args;
  const result = childProcess.spawnSync(spawnTarget, spawnArgs, {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    shell: process.platform === "win32",
    maxBuffer: 20 * 1024 * 1024,
  });
  const stdout = String(result.stdout || "");
  const stderr = String(result.stderr || "");
  return {
    key: check.key,
    rule: check.rule,
    command: check.command.join(" "),
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    exitCode: typeof result.status === "number" ? result.status : 1,
    ok: result.status === 0,
    stdoutTail: stdout.slice(-5000),
    stderrTail: stderr.slice(-5000),
    error: result.error ? String(result.error.message || result.error) : "",
  };
}

function markdown(report) {
  const lines = [
    "# Unattended Display Hard Gates",
    "",
    `- Checked: ${report.checkedAt}`,
    `- Overall: ${report.ok ? "OK" : "FAILED"}`,
    "",
    "| Gate | Rule | Command | Exit | Result |",
    "|---|---|---|---:|---|",
  ];
  for (const row of report.results) {
    lines.push(`| ${row.key} | ${row.rule.replace(/\|/g, "/")} | \`${row.command}\` | ${row.exitCode} | ${row.ok ? "OK" : "FAILED"} |`);
  }
  lines.push("");
  for (const row of report.results) {
    lines.push(`## ${row.key}`);
    lines.push("");
    lines.push(`- Rule: ${row.rule}`);
    lines.push(`- Command: \`${row.command}\``);
    lines.push(`- Exit: ${row.exitCode}`);
    lines.push("");
    if (row.stdoutTail.trim()) {
      lines.push("```text");
      lines.push(row.stdoutTail.trim());
      lines.push("```");
      lines.push("");
    }
    if (row.stderrTail.trim() || row.error) {
      lines.push("```text");
      lines.push([row.error, row.stderrTail].filter(Boolean).join("\n").trim());
      lines.push("```");
      lines.push("");
    }
  }
  return lines.join("\n");
}

async function main() {
  await fs.promises.mkdir(OUT_DIR, { recursive: true });
  const results = CHECKS.map(runCheck);
  const report = {
    checkedAt: new Date().toISOString(),
    ok: results.every((row) => row.ok),
    results,
  };
  const jsonFile = path.join(OUT_DIR, "unattended-display-hard-gates.json");
  const mdFile = path.join(OUT_DIR, "unattended-display-hard-gates.md");
  await fs.promises.writeFile(jsonFile, JSON.stringify(report, null, 2));
  await fs.promises.writeFile(mdFile, markdown(report));
  console.log(`[unattended-display-hard-gates] wrote ${mdFile}`);
  if (!report.ok) {
    console.error("[unattended-display-hard-gates] failed");
    for (const row of results.filter((item) => !item.ok)) {
      console.error(`- ${row.key}: exit=${row.exitCode}`);
    }
    process.exit(1);
  }
  console.log("[unattended-display-hard-gates] ok");
}

main().catch((error) => {
  console.error(`[unattended-display-hard-gates] failed: ${error.stack || error.message || error}`);
  process.exit(1);
});
