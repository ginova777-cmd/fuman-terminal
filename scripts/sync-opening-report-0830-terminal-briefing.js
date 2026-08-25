"use strict";

const { upsertSnapshot } = require("../lib/supabase-snapshots");
const marketAiLive = require("../api/market-ai-live");

function argValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || fallback) : fallback;
}

async function main() {
  const tradeDate = argValue("--trade-date", new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date()));
  const compact = tradeDate.replace(/\D/g, "").slice(0, 8);
  if (!/^\d{8}$/.test(compact)) throw new Error("invalid_trade_date");
  const date = compact.slice(0, 4) + "-" + compact.slice(4, 6) + "-" + compact.slice(6, 8);
  const report = marketAiLive.__test.readOpeningMorningReport({
    date,
    ymd: compact,
    seconds: 8 * 60 * 60 + 30 * 60,
    time: "08:30:00",
  });
  if (report?.ok !== true) {
    console.log(JSON.stringify({ ok: false, trade_date: date, reason_code: report?.reason_code || "opening_report_0830_not_ready" }, null, 2));
    process.exitCode = 1;
    return;
  }
  const result = await upsertSnapshot("opening_report_0830_terminal_briefing", {
    ...report,
    source: "opening_report_0830_terminal_briefing",
    updatedAt: new Date().toISOString(),
  }, {
    tradeDate: date,
    snapshotId: report.run_id || "opening-report-0830-" + compact,
    source: "opening_report_0830_terminal_briefing",
    reason: "repair-terminal-briefing-snapshot",
    locked: false,
  });
  const ok = result?.ok === true;
  console.log(JSON.stringify({
    ok,
    contract: "opening_report_0830_terminal_briefing_snapshot_repair_v1",
    trade_date: date,
    run_id: report.run_id || "",
    industry_bias_files: report.industry_bias?.count || 0,
    reason_code: ok ? "opening_report_0830_terminal_snapshot_synced" : (result?.reason_code || "opening_report_0830_terminal_snapshot_sync_failed"),
    result,
  }, null, 2));
  if (!ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, reason_code: "opening_report_0830_terminal_snapshot_repair_error", error: error?.message || String(error) }, null, 2));
  process.exitCode = 1;
});
