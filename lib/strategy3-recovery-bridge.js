"use strict";
function bridgeMatches(bridge, runner, bridgeDate) {
  return bridge?.complete === true
    && Array.isArray(bridge.failed_checks) && bridge.failed_checks.length === 0
    && bridge.first_blocker === null
    && bridge.requested_trade_date === bridgeDate
    && bridge.authority_trade_date === runner?.trade_date
    && bridge.writer_bridge_canonical_run_id === `fugle_daytrade_source:${bridgeDate.replace(/-/g, "")}:canonical`
    && bridge.authority_run_id === runner?.run_id
    && Number(bridge.authority_result_count) === Number(runner?.result_count);
}
module.exports = { bridgeMatches };
