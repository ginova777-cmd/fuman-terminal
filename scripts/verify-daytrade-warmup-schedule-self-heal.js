"use strict";

const { spawnSync } = require("child_process");
const path = require("path");

const currentVerifier = path.join(__dirname, "verify-daytrade-scheduled-timeline-contract.js");
const result = spawnSync(process.execPath, [currentVerifier], { encoding: "utf8", windowsHide: true });
const raw = String(result.stdout || "").trim();
let schedule = null;
try { schedule = JSON.parse(raw); } catch {}
const output = {
  ok: Boolean(schedule && schedule.ok === true),
  contract: "daytrade_warmup_schedule_without_watchdog_v2",
  checked_at: new Date().toISOString(),
  watchdog_required: false,
  canonical_schedule_contract: schedule ? schedule.contract : null,
  failed_checks: schedule && Array.isArray(schedule.failed_checks) ? schedule.failed_checks : ["canonical_schedule_verifier_unreadable"],
  first_blocker: schedule ? schedule.first_blocker : "canonical_schedule_verifier_unreadable",
  read_only: true
};
console.log(JSON.stringify(output, null, 2));
process.exitCode = output.ok ? 0 : 1;
