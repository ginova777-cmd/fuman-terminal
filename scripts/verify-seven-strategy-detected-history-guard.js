#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const sql = fs.readFileSync(path.join(root, "ops", "public-slot", "SevenStrategyDetectedHistoryGuard_20260729.sql"), "utf8");
const writer = fs.readFileSync(path.join(root, "lib", "seven-strategy-daily-history-writer.js"), "utf8");
const api = fs.readFileSync(path.join(root, "api", "seven-strategy-daily-history.js"), "utf8");
const markers = [
  ["sql_trigger", sql.includes("trg_seven_strategy_formal_history_evidence")],
  ["sql_revoke_public_insert", sql.includes("revoke insert on public.seven_strategy_daily_history from anon, authenticated")],
  ["sql_gate_status", sql.includes("gate_status")],
  ["writer_gate_status", writer.includes("gate_status") && writer.includes("gate_status_not_ready")],
  ["api_gate_status", api.includes("gate_status_not_ready")],
  ["api_bad_detected_counter", api.includes("badDetected")],
];
const issues = markers.filter(([, ok]) => !ok).map(([name]) => name);
const result = { ok: issues.length === 0, markers: Object.fromEntries(markers), issues };
console.log(JSON.stringify(result, null, 2));
process.exitCode = result.ok ? 0 : 1;
