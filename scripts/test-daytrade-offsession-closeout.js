const test = require("node:test");
const assert = require("node:assert/strict");
const { verifiedOffSessionCloseout } = require("../lib/daytrade-offsession-closeout");
function fixture() {
  return { tradeDate: "2026-09-11", minute: 1000,
    receipt: { trade_date: "2026-09-11", ok: true, complete: true, status: "complete", last_attempt: { first_blocker: "outside_trading_window" } },
    runner: { trade_date: "2026-09-11", canonical_run_id: "fugle_daytrade_source:20260911:canonical", ok: true, complete: true, status: "complete", exit_code: 0 },
    outbox: { trade_date: "2026-09-11", events: [] } };
}
test("current verified closeout accepts preserved receipt", () => assert.equal(verifiedOffSessionCloseout(fixture()), true));
for (const [name, mutate] of [
  ["stale receipt", x => x.receipt.trade_date = "2026-09-10"],
  ["unverified runner", x => x.runner.complete = false],
  ["pending events", x => x.outbox.events.push({})],
  ["wrong canonical run", x => x.runner.canonical_run_id = "other"],
  ["inside trading window", x => x.minute = 600],
  ["missing closeout reason", x => x.receipt.last_attempt = null],
]) test(name, () => { const x = fixture(); mutate(x); assert.equal(verifiedOffSessionCloseout(x), false); });
