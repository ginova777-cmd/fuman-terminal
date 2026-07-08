#!/usr/bin/env node
"use strict";

const fs = require("fs");
const {
  publishRows,
  normalizeRows,
  todayTaipeiDate,
} = require("../lib/seven-strategy-daily-history-writer");

function argValue(name) {
  const prefix = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

function arrayFromPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.rows)) return payload.rows;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.items)) return payload.items;
  if (payload && typeof payload === "object") return [payload];
  return [];
}

function readJsonFile(file) {
  if (!file) return [];
  return arrayFromPayload(JSON.parse(fs.readFileSync(file, "utf8")));
}

function readPayloads() {
  const rows = [];
  const payloadJson = argValue("--payload") || process.env.FUMAN_SEVEN_STRATEGY_DAILY_HISTORY_JSON || "";
  if (payloadJson) rows.push(...arrayFromPayload(JSON.parse(payloadJson)));
  const entryFile = argValue("--entry-file") || process.env.FUMAN_SEVEN_STRATEGY_ENTRY_HISTORY_FILE || "";
  const detectedFile = argValue("--detected-file") || process.env.FUMAN_SEVEN_STRATEGY_DETECTED_HISTORY_FILE || "";
  const payloadFile = argValue("--payload-file") || "";
  rows.push(...readJsonFile(payloadFile).map((row) => ({ ...row })));
  rows.push(...readJsonFile(entryFile).map((row) => ({ ...row, signal_type: row.signal_type || row.signalType || "formal", source: row.source || "fugle-entry-history" })));
  rows.push(...readJsonFile(detectedFile).map((row) => ({ ...row, signal_type: row.signal_type || row.signalType || "detected", source: row.source || "fugle-detected-history" })));
  if (process.argv.includes("--fixture=valid") || process.argv.includes("--fixture")) {
    rows.push(
      {
        tradeDate: process.env.FUMAN_SEVEN_STRATEGY_FIXTURE_DATE || todayTaipeiDate(),
        detectTime: "09:18:31",
        symbol: "2330",
        name: "台積電",
        entryPrice: 1000,
        currentPrice: 1005,
        changePercent: 0.5,
        score: 91,
        strategy: "七策略正式進場",
        signalType: "formal",
        source: "fugle-entry-history",
        runId: "fixture-seven-strategy-daily-history",
      },
      {
        tradeDate: process.env.FUMAN_SEVEN_STRATEGY_FIXTURE_DATE || todayTaipeiDate(),
        detectTime: "09:19:08",
        symbol: "2317",
        name: "鴻海",
        entryPrice: 155,
        currentPrice: 156,
        changePercent: 0.65,
        score: 82,
        strategy: "七策略觀察",
        signalType: "detected",
        source: "fugle-detected-history",
        runId: "fixture-seven-strategy-daily-history",
      },
    );
  }
  return rows;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const localCheck = process.argv.includes("--local-check");
  const dryRun = process.argv.includes("--dry-run") || localCheck || !apply;
  const now = process.env.FUMAN_SEVEN_STRATEGY_NOW ? new Date(process.env.FUMAN_SEVEN_STRATEGY_NOW) : new Date();
  const rows = readPayloads();
  if (!rows.length) throw new Error("missing payload; pass --payload, --payload-file, --entry-file, or --detected-file");
  if (localCheck) {
    const normalized = normalizeRows(rows, { now });
    const ok = normalized.accepted.length > 0;
    const issues = normalized.rejected.flatMap((item) => item.issues);
    console.log(`[seven-strategy-daily-history-publish] rawOk=${ok} action=local-check accepted=${normalized.accepted.length} rejected=${normalized.rejected.length} issues=${issues.join(",") || "none"} first=${normalized.accepted[0]?.symbol || ""}`);
    process.exit(ok ? 0 : 1);
  }
  const result = await publishRows(rows, { dryRun, now });
  const issues = result.rejected.flatMap((item) => item.issues);
  console.log(`[seven-strategy-daily-history-publish] rawOk=${result.rawOk} action=${result.action} accepted=${result.accepted.length} rejected=${result.rejected.length} issues=${issues.join(",") || "none"} written=${result.write?.written || 0} first=${result.accepted[0]?.symbol || ""}`);
  process.exit(result.rawOk ? 0 : 1);
}

main().catch((error) => {
  console.error(`[seven-strategy-daily-history-publish] rawOk=false error=${error.stack || error.message || error}`);
  process.exit(1);
});
