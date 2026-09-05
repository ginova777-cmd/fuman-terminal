"use strict";

const fs = require("fs");
const path = require("path");

const RUNTIME = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
function arg(name, fallback = "") {
  const prefix = `--${name}=`;
  const hit = process.argv.find((item) => item.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}
function dateKey() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}${get("month")}${get("day")}`;
}

function main() {
  const date = arg("date", dateKey()).replace(/\D/g, "").slice(0, 8);
  const dryRun = process.argv.includes("--dry-run");
  const input = path.resolve(arg("receipt", path.join(RUNTIME, "data", "line-cards", `strategy4-line-card-${date}${dryRun ? ".dry-run" : ""}.json`)));
  const runner = JSON.parse(fs.readFileSync(input, "utf8"));
  const rows = Array.isArray(runner.accepted_rows) ? runner.accepted_rows : [];
  const computedZones = Object.fromEntries(["A", "B", "C"].map((key) => [key, rows.filter((row) => String(row.zone || row.zoneLabel || "").toUpperCase().startsWith(key)).length]));
  const checks = [
    ["runner_contract", runner.contract === "strategy4-line-card-runner-v2"],
    ["format_contract", runner.format_contract === "strategy4-line-customer-grouped-v2"],
    ["strategy", runner.strategy === "strategy4"],
    ["runner_ready", runner.ok === true && runner.status === "ready"],
    ["same_day", runner.dateAligned === true && String(runner.dataDate) === date],
    ["run_id", Boolean(runner.runId)],
    ["count_matches_rows", Number(runner.count) > 0 && Number(runner.count) === rows.length],
    ["all_rows_identified", rows.every((row) => row.code && row.name && row.strategyLabel)],
    ["all_rows_grouped", rows.every((row) => /^[ABC]/i.test(String(row.zone || row.zoneLabel || "")))],
    ["zone_counts_match", ["A", "B", "C"].every((key) => Number(runner.zone_counts?.[key]) === computedZones[key])],
    ["zone_total_matches", Object.values(computedZones).reduce((sum, count) => sum + count, 0) === rows.length],
    ["customer_safe", runner.customer_safe === true && runner.internal_status_visible === false],
    ["disclaimer", String(runner.disclaimer || "").includes("不是自動下單訊號")],
    ["target_valid", runner.line_target_configured === true && runner.line_target_valid === true],
    ["delivery_confirmed", dryRun ? runner.line_push_ok === false : runner.line_push_ok === true],
  ].map(([name, ok]) => ({ name, ok: Boolean(ok) }));
  const failed = checks.filter((item) => !item.ok);
  const receipt = {
    contract: "strategy4-line-card-canonical-verifier-v2",
    status: failed.length ? "failed" : "complete",
    ok: failed.length === 0,
    checked_at: new Date().toISOString(),
    trade_date: date,
    run_id: runner.runId || null,
    runner_receipt: input,
    dry_run: dryRun,
    count: rows.length,
    zone_counts: computedZones,
    strategy_combination_count: new Set(rows.map((row) => row.strategyLabel).filter(Boolean)).size,
    checks,
    first_blocker: failed[0]?.name || null,
  };
  const output = path.join(RUNTIME, "data", "line-cards", `strategy4-line-card-canonical-verifier-receipt-${date}${dryRun ? ".dry-run" : ""}.json`);
  fs.writeFileSync(output, JSON.stringify({ ...receipt, receipt_path: output }, null, 2) + "\n", "utf8");
  console.log(JSON.stringify({ ...receipt, receipt_path: output }, null, 2));
  process.exit(receipt.ok ? 0 : 1);
}

try { main(); } catch (error) {
  console.error(JSON.stringify({ contract: "strategy4-line-card-canonical-verifier-v2", status: "failed", ok: false, first_blocker: error.message }, null, 2));
  process.exit(1);
}
