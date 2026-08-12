"use strict";

const legacy = require("../api/strategy3-latest.shared-probe-legacy.js");

async function main() {
  const apply = legacy.__test?.applyStrategy3Entry1mGate;
  if (typeof apply !== "function") throw new Error("strategy3_entry_gate_test_hook_missing");

  process.env.FUMAN_EXPECTED_DATE = "20260812";
  const published = {
    runId: "strategy3-20260812-20260812130000",
    scanDate: "2026-08-12",
    count: 1,
    matches: [{
      code: "2330",
      price: 999,
      entryPrice: 999,
      entryPriceSource: "intraday_1m_1300_exact",
      entryCandleTime: "2026-08-12T05:00:00.000Z",
      entryTradeDate: "2026-08-12",
    }],
  };

  const nativeFetch = global.fetch;
  global.fetch = async () => { throw new Error("published_entry_must_not_refetch"); };
  try {
    const sameDay = await apply(published);
    const stale = await apply({ ...published, runId: "strategy3-20260811-20260811093935", scanDate: "2026-08-11", matches: [{ ...published.matches[0], entryTradeDate: "2026-08-11", entryCandleTime: "2026-08-11T05:00:00.000Z" }] });
    const row = sameDay.matches?.[0] || {};
    const issues = [];
    if (sameDay.ok === false || row.price !== 999 || row.entryPrice !== 999 || sameDay.sourceCoverage?.strategy3Entry1mStatus !== "published_formal") issues.push("same_day_published_entry_not_immutable");
    if (stale.ok !== false || !String(stale.blockedReason || "").includes("not_today")) issues.push("stale_run_not_fail_closed");
    const output = { ok: issues.length === 0, verifier: "verify-strategy3-api-entry-immutability", sameDay: { price: row.price, entryPrice: row.entryPrice, status: sameDay.sourceCoverage?.strategy3Entry1mStatus }, stale: { blockedReason: stale.blockedReason || "" }, issues };
    console.log(JSON.stringify(output, null, 2));
    if (issues.length) process.exit(1);
  } finally {
    global.fetch = nativeFetch;
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, verifier: "verify-strategy3-api-entry-immutability", error: error?.message || String(error) }, null, 2));
  process.exit(1);
});
