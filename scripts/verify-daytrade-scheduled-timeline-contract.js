"use strict";

const { execFileSync } = require("child_process");

const checks = [
  { name: "Fuman Fugle Daytrade WebSocket Collector 0600-1330", contains: "Run-DaytradeWebSocketCollector.ps1" },
  { name: "Fuman Daytrade Source Writer 0600-1330", contains: "Run-DaytradeSourceWriter.ps1" },
  { name: "Fuman Daytrade Source Gate 0700", contains: "-Phase 0700" },
  { name: "Fuman Opening Report 0820 Preflight", contains: "run-opening-report-0820-preflight.js" },
  { name: "Fuman Opening Report 0830 LINE", contains: "run-opening-report-0830-production-wrapper.ps1" },
  { name: "Fuman Opening Limit Order Morning Readonly 0840", contains: "Run-OpeningLimitOrderMorningReadonly.ps1" },
  { name: "Fuman Strategy3 V2 First Attempt 1255", contains: "run-strategy3-v2" },
  { name: "Fuman Strategy3 V2 Complete Scan 1300", contains: "run-strategy3-v2-complete-scan.ps1" },
  { name: "Fuman Strategy3 V2 Daily Closure Verify 1315", contains: "verify-strategy3-v2-daily-unattended-closure.js" }
];

function query(name) {
  try {
    return execFileSync("schtasks", ["/Query", "/TN", name, "/V", "/FO", "LIST"], {
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch (error) {
    return String(error.stdout || "") + "\n" + String(error.stderr || "");
  }
}

function queryXml(name) {
  try {
    return execFileSync("schtasks", ["/Query", "/TN", name, "/XML"], {
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch (error) {
    return String(error.stdout || "") + "\n" + String(error.stderr || "");
  }
}

const results = checks.map((check) => {
  const raw = query(check.name);
  const missing = /ERROR:|cannot find the file specified/i.test(raw);
  const xml = queryXml(check.name);
  const enabled = !missing && !/<Enabled>false<\/Enabled>/i.test(xml);
  const commandMatches = !missing && raw.includes(check.contains);
  return {
    task: check.name,
    exists: !missing,
    enabled,
    command_matches: commandMatches,
    ok: !missing && enabled && commandMatches
  };
});

const failed_checks = results.filter((item) => !item.ok).map((item) => item.task);
console.log(JSON.stringify({
  ok: failed_checks.length === 0,
  contract: "daytrade_scheduled_timeline_contract_v2",
  canonical_timeline: [
    "06:00 collector + writer",
    "07:00 natural warmup gate",
    "08:20 overseas preflight",
    "08:30 morning report",
    "08:40 opening-entry readonly runner",
    "12:55 Strategy3 first attempt",
    "13:00 Strategy3 complete scan",
    "13:15 Strategy3 closure verify"
  ],
  checked_at: new Date().toISOString(),
  results,
  failed_checks,
  first_blocker: failed_checks[0] || null,
  read_only: true
}, null, 2));

process.exitCode = failed_checks.length ? 1 : 0;
