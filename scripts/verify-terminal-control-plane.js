"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

function argValue(name, fallback = "") {
  const prefix = name + "=";
  const value = process.argv.find((item) => item === name || item.startsWith(prefix));
  return value === name ? "1" : (value ? value.slice(prefix.length) : fallback);
}

function compactDate(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 8);
}

function readJson(file) {
  try {
    return { value: JSON.parse(fs.readFileSync(file, "utf8")), error: "" };
  } catch (error) {
    return { value: null, error: String(error.message || error) };
  }
}

function main() {
  const tradeDate = compactDate(argValue("--trade-date", process.env.FUMAN_TRADE_DATE || ""));
  const dailyRunId = argValue("--daily-run-id", process.env.FUMAN_DAILY_RUN_ID || "");
  const file = path.resolve(argValue("--source", process.env.FUMAN_CONTROL_PLANE_FILE || path.join(ROOT, "outputs", "terminal-control-plane", "terminal-control-plane.json")));
  const loaded = readJson(file);
  const source = loaded.value;
  const issues = [];
  if (!source) issues.push(loaded.error ? "control_plane_source_unreadable" : "control_plane_source_missing");
  if (source && source.contract !== "terminal-control-plane-v1") issues.push("control_plane_contract_invalid");
  if (source && tradeDate && compactDate(source.tradeDate) !== tradeDate) issues.push("control_plane_trade_date_mismatch");
  if (source && source.dailyManifest?.ok !== true) issues.push("control_plane_daily_manifest_not_ok");
  if (source && source.predictivePreflight?.ok !== true) issues.push("control_plane_preflight_not_ok");
  if (source && !source.stateMachine) issues.push("control_plane_state_machine_missing");
  if (source && !source.decision?.state) issues.push("control_plane_decision_missing");
  const state = String(source?.decision?.state || source?.stateMachine?.overallState || "");
  const acceptedStates = new Set(["UNATTENDED_YES", "PENDING_NOT_DUE", "MARKET_CLOSED_PRESERVE_PREVIOUS_GOOD"]);
  if (source && state && !acceptedStates.has(state)) issues.push("control_plane_not_green:" + state);
  const ok = issues.length === 0;
  const payload = {
    contract: "terminal-control-plane-verifier-v1",
    ok,
    status: ok ? "PASS" : "BLOCKED",
    checkedAt: new Date().toISOString(),
    trade_date: tradeDate || compactDate(source?.tradeDate),
    daily_run_id: dailyRunId,
    source_file: file,
    source_exists: Boolean(source),
    source_contract: source?.contract || "",
    control_plane_state: state,
    control_plane_unattended_status: source?.decision?.unattendedStatus || source?.unattendedStatus || "",
    issues,
    source: source || null,
  };
  console.log(JSON.stringify(payload, null, 2));
  if (!ok) process.exitCode = 1;
}

main();