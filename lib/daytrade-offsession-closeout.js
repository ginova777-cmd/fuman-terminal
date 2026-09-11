"use strict";
function verifiedOffSessionCloseout({ receipt, runner, outbox, tradeDate, minute }) {
  const canonicalRunId = `fugle_daytrade_source:${String(tradeDate).replace(/-/g, "")}:canonical`;
  return minute > 750
    && receipt?.trade_date === tradeDate && runner?.trade_date === tradeDate && outbox?.trade_date === tradeDate
    && (receipt?.first_blocker === "outside_trading_window" || receipt?.last_attempt?.first_blocker === "outside_trading_window")
    && receipt?.ok === true && receipt?.complete === true && receipt?.status === "complete"
    && runner?.ok === true && runner?.complete === true && runner?.status === "complete"
    && runner?.canonical_run_id === canonicalRunId && Number(runner?.exit_code) === 0
    && Array.isArray(outbox?.events) && outbox.events.length === 0;
}
module.exports = { verifiedOffSessionCloseout };
