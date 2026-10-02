'use strict';

// Only evidence received on this connection may keep its transport alive.
// Local status writes and outgoing pings are deliberately not inputs.
function transportIsStale({ nowMs, openedAt, heartbeatAt, dataReceivedAt, timeoutMs }) {
  const valid = [openedAt, heartbeatAt, dataReceivedAt]
    .map(value => Date.parse(value || ''))
    .filter(value => Number.isFinite(value) && value <= nowMs);
  return valid.length === 0 || nowMs - Math.max(...valid) > timeoutMs;
}

module.exports = { transportIsStale };
