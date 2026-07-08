"use strict";

const {
  normalizeEntry,
  validateEntry,
  validateSourceGate,
} = require("../lib/daytrade-ps1-entry-writer");

const now = new Date("2026-07-08T02:00:00.000Z");
const base = {
  trade_date: "2026-07-08",
  entry_time: "09:15:02",
  symbol: "2330",
  name: "台積電",
  entry_price: 1000,
  current_price: 1005,
  strategy_label: "PS1",
  note: "formal entry",
  source: "ps1-live",
};

function issueOf(mutator) {
  const entry = normalizeEntry(mutator({ ...base }), { now });
  return validateEntry(entry, { now }).issues;
}

const cases = [
  ["valid formal entry", [], issueOf((row) => row)],
  ["old trade_date", ["trade_date_not_today"], issueOf((row) => ({ ...row, trade_date: "2026-07-07" }))],
  ["before 09:00", ["entry_time_outside_window"], issueOf((row) => ({ ...row, entry_time: "08:59:59" }))],
  ["after 13:30", ["entry_time_outside_window"], issueOf((row) => ({ ...row, entry_time: "13:30:01" }))],
  ["replay source", ["source_contains_replay"], issueOf((row) => ({ ...row, source: "ps1-replay" }))],
  ["observation strategy", ["source_contains_observation"], issueOf((row) => ({ ...row, strategy_label: "PS1 observation" }))],
  ["blank symbol", ["missing_symbol", "symbol_invalid"], issueOf((row) => ({ ...row, symbol: "" }))],
  ["missing price", ["missing_entry_price", "entry_price_not_positive"], issueOf((row) => ({ ...row, entry_price: null }))],
];

const failures = [];
for (const [name, expected, actual] of cases) {
  for (const issue of expected) {
    if (!actual.some((item) => item.startsWith(issue))) failures.push(`${name}:missing_${issue}:actual=${actual.join("|") || "none"}`);
  }
  if (!expected.length && actual.length) failures.push(`${name}:unexpected=${actual.join("|")}`);
}

const gateA = validateSourceGate({ status: "ok", payload: { daytrade_gate_grade: "A" } });
const gateB = validateSourceGate({ status: "ok", payload: { daytrade_gate_grade: "B" } });
const gateDown = validateSourceGate({ status: "stopped", payload: { daytrade_gate_grade: "A" } });
if (!gateA.ok) failures.push(`gateA_should_pass:${gateA.issue}`);
if (gateB.ok || gateB.issue !== "source_gate_not_A:B") failures.push(`gateB_should_block:${gateB.issue}`);
if (gateDown.ok || !gateDown.issue.startsWith("source_status_not_ok")) failures.push(`gateDown_should_block:${gateDown.issue}`);

if (failures.length) {
  console.error(`[daytrade-ps1-entry-writer-contract] rawOk=false issues=${failures.join(",")}`);
  process.exit(1);
}

console.log("[daytrade-ps1-entry-writer-contract] rawOk=true valid=formal-entry mutationIssues=old_date,time_window,replay,observation,blank_symbol,missing_price sourceGate=A_only writerMode=service_role_script");
