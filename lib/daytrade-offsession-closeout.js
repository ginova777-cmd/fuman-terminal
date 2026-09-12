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
function verifiedHistoricalCloseout({ receipt, runner, outbox, currentDate }) {
  const tradeDate = String(outbox?.trade_date || "");
  const timestamp = new Date(outbox?.updated_at || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate) || tradeDate >= currentDate || !Number.isFinite(timestamp.getTime())) return false;
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(timestamp).map(p => [p.type, p.value]));
  if (tradeDate !== `${parts.year}-${parts.month}-${parts.day}`) return false;
  return verifiedOffSessionCloseout({ receipt, runner, outbox, tradeDate, minute: Number(parts.hour) * 60 + Number(parts.minute) });
}
module.exports = { verifiedOffSessionCloseout, verifiedHistoricalCloseout };
