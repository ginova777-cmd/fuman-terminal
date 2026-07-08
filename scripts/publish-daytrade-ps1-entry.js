#!/usr/bin/env node
"use strict";

const fs = require("fs");
const {
  publishPs1Entry,
  validateEntry,
  validateSourceGate,
  normalizeEntry,
} = require("../lib/daytrade-ps1-entry-writer");

function argValue(name) {
  const prefix = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

function readPayload() {
  const json = argValue("--payload") || process.env.FUMAN_DAYTRADE_PS1_ENTRY_JSON || "";
  const file = argValue("--payload-file") || "";
  if (json) return JSON.parse(json);
  if (file) return JSON.parse(fs.readFileSync(file, "utf8"));
  if (process.argv.includes("--fixture=valid") || process.argv.includes("--fixture")) {
    return {
      trade_date: process.env.FUMAN_DAYTRADE_PS1_FIXTURE_DATE || "2026-07-08",
      entry_time: "09:15:02",
      symbol: "2330",
      name: "台積電",
      entry_price: 1000,
      current_price: 1005,
      strategy_label: "PS1",
      note: "formal entry fixture",
      source: "ps1-live",
      run_id: "fixture-ps1-entry",
    };
  }
  throw new Error("missing payload; pass --payload JSON or --payload-file FILE");
}

async function main() {
  const apply = process.argv.includes("--apply");
  const localCheck = process.argv.includes("--local-check");
  const dryRun = process.argv.includes("--dry-run") || localCheck || !apply;
  const skipSourceGate = process.argv.includes("--skip-source-gate");
  const sourceStatus = process.argv.includes("--source-gate-A")
    ? { status: "ok", payload: { daytrade_gate_grade: "A" } }
    : null;
  const payload = readPayload();
  const now = process.env.FUMAN_DAYTRADE_PS1_NOW ? new Date(process.env.FUMAN_DAYTRADE_PS1_NOW) : new Date();
  if (localCheck) {
    const entry = normalizeEntry(payload, { now });
    const entryValidation = validateEntry(entry, { now });
    const sourceGate = validateSourceGate(sourceStatus || { status: "ok", payload: { daytrade_gate_grade: "A" } });
    const ok = entryValidation.ok && sourceGate.ok;
    console.log(`[daytrade-ps1-entry-publish] rawOk=${ok} action=local-check issues=${[...entryValidation.issues, sourceGate.issue].filter(Boolean).join(",") || "none"} symbol=${entry.symbol} tradeDate=${entry.trade_date} entryTime=${entry.entry_time} source=${entry.source} sourceGate=${sourceGate.grade}`);
    process.exit(ok ? 0 : 1);
  }
  const result = await publishPs1Entry(payload, { dryRun, skipSourceGate, sourceStatus, now });
  console.log(`[daytrade-ps1-entry-publish] rawOk=${result.rawOk} action=${result.action} issues=${(result.issues || []).join(",") || "none"} symbol=${result.entry?.symbol || ""} tradeDate=${result.entry?.trade_date || ""} entryTime=${result.entry?.entry_time || ""} source=${result.entry?.source || ""} sourceGate=${result.sourceGate?.grade || ""} written=${result.write?.written || 0}`);
  process.exit(result.rawOk ? 0 : 1);
}

main().catch((error) => {
  console.error(`[daytrade-ps1-entry-publish] rawOk=false error=${error.stack || error.message || error}`);
  process.exit(1);
});
