#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const {
  TABLE_NAME,
  normalizeRows,
  validateRow,
  todayTaipeiDate,
} = require("../lib/seven-strategy-daily-history-writer");

const root = path.resolve(__dirname, "..");
const scriptSource = fs.readFileSync(path.join(root, "scripts", "publish-seven-strategy-daily-history.js"), "utf8");
const libSource = fs.readFileSync(path.join(root, "lib", "seven-strategy-daily-history-writer.js"), "utf8");

const now = new Date("2026-07-08T02:00:00Z");
const today = todayTaipeiDate(now);
const fixtureRows = [
  { tradeDate: today, detectTime: "09:15:00", symbol: "2330", name: "台積電", entryPrice: 1000, strategy: "七策略A", signalType: "formal", source: "fugle-entry-history" },
  { tradeDate: today, detectTime: "09:16:00", symbol: "2317", name: "鴻海", entryPrice: 155, strategy: "七策略B", signalType: "detected", source: "fugle-detected-history" },
  { tradeDate: "2026-07-07", detectTime: "09:16:00", symbol: "2303", name: "聯電", entryPrice: 50, strategy: "七策略B", signalType: "detected", source: "fugle-detected-history" },
  { tradeDate: today, detectTime: "13:31:00", symbol: "2603", name: "長榮", entryPrice: 180, strategy: "七策略B", signalType: "detected", source: "fugle-detected-history" },
  { tradeDate: today, detectTime: "09:20:00", symbol: "2308", name: "台達電", entryPrice: 390, strategy: "replay-七策略", signalType: "detected", source: "replay" },
  { tradeDate: today, detectTime: "09:21:00", symbol: "", name: "空白", entryPrice: 10, strategy: "七策略B", signalType: "detected", source: "fugle-detected-history" },
];

const normalized = normalizeRows(fixtureRows, { now });
const mutationIssues = [
  validateRow({ ...normalized.accepted[0], trade_date: "2026-07-07" }, { now }).issues[0],
  validateRow({ ...normalized.accepted[0], detect_time: "13:31:00" }, { now }).issues[0],
  validateRow({ ...normalized.accepted[0], source: "replay" }, { now }).issues[0],
  validateRow({ ...normalized.accepted[0], symbol: "" }, { now }).issues[0],
  validateRow({ ...normalized.accepted[0], entry_price: null }, { now }).issues[0],
];

const issues = [];
if (TABLE_NAME !== "seven_strategy_daily_history") issues.push("wrong_table_name");
if (normalized.accepted.length !== 2) issues.push(`accepted_count:${normalized.accepted.length}`);
if (normalized.rejected.length !== 4) issues.push(`rejected_count:${normalized.rejected.length}`);
if (normalized.accepted[0]?.symbol !== "2317") issues.push(`latest_first:${normalized.accepted[0]?.symbol || "missing"}`);
for (const expected of ["trade_date_not_today", "detect_time_outside_window", "source_contains_replay", "missing_symbol", "missing_entry_price"]) {
  if (!mutationIssues.some((issue) => String(issue || "").startsWith(expected))) issues.push(`missing_mutation_issue:${expected}`);
}
for (const marker of ["--entry-file", "--detected-file", "fugle-entry-history", "fugle-detected-history"]) {
  if (!scriptSource.includes(marker)) issues.push(`missing_cli_marker:${marker}`);
}
for (const marker of ["on_conflict=trade_date,detect_time,symbol,strategy,signal_type,source", "resolution=merge-duplicates", "serverSupabaseKey"]) {
  if (!libSource.includes(marker)) issues.push(`missing_writer_marker:${marker}`);
}

if (issues.length) {
  console.error(`[seven-strategy-daily-history-writer-contract] rawOk=false issues=${issues.join(",")}`);
  process.exit(1);
}

console.log(`[seven-strategy-daily-history-writer-contract] rawOk=true table=${TABLE_NAME} accepted=${normalized.accepted.length} rejected=${normalized.rejected.length} first=${normalized.accepted[0].symbol} mutationIssues=${mutationIssues.join("|")} entryFile=true detectedFile=true mode=service_role_upsert`);
