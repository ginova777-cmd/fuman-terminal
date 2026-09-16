const morningStages = require("../lib/opening-report-stage-contract");
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
    seconds: 8 * 60 * 60 + 50 * 60,
    time: "08:20:00",
  });
  if (report?.ok !== true) {
    console.log(JSON.stringify({ ok: false, trade_date: date, reason_code: report?.reason_code || "opening_report_0830_not_ready" }, null, 2));
    process.exitCode = 1;
    return;
  }
  const fs=require("fs"),path=require("path"),night=require("../lib/opening-report-night-futures");
  const final=JSON.parse(fs.readFileSync(path.join(process.env.FUMAN_RUNTIME_DIR||"C:/fuman-runtime","data","opening-report-0830","opening-report-0830-final-receipt-"+compact+".json"),"utf8").replace(/^\uFEFF/,""));
  const issues=night.verify(final.night_futures,{date,runId:report.run_id,cutoff:final.recovery?.cutoff_at||require("../lib/opening-report-recovery").cutoff(date)});
  if(issues.length||final.run_id!==report.run_id)throw Error("night_futures_snapshot_repair_blocked:"+issues.join(";"));
  const result = await upsertSnapshot("opening_report_0830_terminal_briefing", {
    ...report,
    delivery_content_hash:final.delivery_content_hash,display_top3:final.display_top3,source_cutoff:final.source_cutoff,recovery:final.recovery,
    night_futures:final.night_futures,night_futures_summary:night.summary(final.night_futures),
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
