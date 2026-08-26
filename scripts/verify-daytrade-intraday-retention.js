"use strict";

const fs = require("fs");
const path = require("path");
const { serverSupabaseKey, serverSupabaseUrl } = require("../lib/server-supabase-key");

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime";
const KEEP_DAYS = 15;

function taipeiDate() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}${get("month")}${get("day")}`;
}

function readReceipt() {
  const file = path.join(RUNTIME_DIR, "status", `daytrade-intraday-retention-${taipeiDate()}.json`);
  try { return { file, payload: JSON.parse(fs.readFileSync(file, "utf8")) }; } catch { return { file, payload: null }; }
}

async function rpc(name, body) {
  const key = serverSupabaseKey();
  const response = await fetch(`${serverSupabaseUrl().replace(/\/$/, "")}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(90000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${name} HTTP ${response.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : null;
}

async function main() {
  const { file, payload } = readReceipt();
  const status = await rpc("fuman_daytrade_intraday_retention_status", { p_keep_days: KEEP_DAYS });
  const issues = [];
  if (status?.table !== "fugle_daytrade_intraday_1m") issues.push("formal_table_mismatch");
  if (Number(status?.keepDays) !== KEEP_DAYS) issues.push("keep_days_mismatch");
  if (!status?.latestTradeDate || Number(status?.protectedRows || 0) <= 0) issues.push("protected_window_missing");
  if (!payload) issues.push("today_receipt_missing");
  if (payload && payload.contract !== "daytrade-intraday-retention-15d-v1") issues.push("receipt_contract_mismatch");
  if (payload && payload.ok !== true) issues.push("receipt_pre_or_postcheck_failed");
  if (status?.hasOldRows === true) issues.push("old_rows_remaining");
  const result = {
    ok: issues.length === 0,
    checkedAt: new Date().toISOString(),
    contract: "daytrade-intraday-retention-15d-v1",
    formalTable: "fugle_daytrade_intraday_1m",
    keepDays: KEEP_DAYS,
    receiptFile: file,
    status,
    issues,
    reasonCode: issues[0] || "ok",
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, checkedAt: new Date().toISOString(), error: error.message }, null, 2));
  process.exitCode = 1;
});
