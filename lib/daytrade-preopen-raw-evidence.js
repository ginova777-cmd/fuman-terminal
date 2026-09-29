'use strict';

// Retain the actual RPC rows separately from derived readiness. This evidence
// does not assert source quality, previous-session validity, or completion.
function attach(map, {tradeDate, requestedSymbols, pages, rows, observedAt}) {
  if (!(map instanceof Map)) throw Error('PREOPEN_EVIDENCE_MAP_REQUIRED');
  if (!Array.isArray(requestedSymbols) || new Set(requestedSymbols).size !== requestedSymbols.length)
    throw Error('PREOPEN_EVIDENCE_REQUESTED_SET_INVALID');
  if (!Array.isArray(rows) || !Array.isArray(pages)) throw Error('PREOPEN_EVIDENCE_ROWS_REQUIRED');
  const evidence = JSON.parse(JSON.stringify({
    contract: 'daytrade_preopen_raw_rpc_evidence_v1',
    observation_trade_date: tradeDate,
    observed_at: observedAt,
    source_rpc: 'get_fugle_daytrade_intraday_1m_latest_n',
    requested_symbols: requestedSymbols,
    bars_per_symbol: 25,
    pages, rows,
    verified: false,
  }));
  Object.defineProperty(map, 'preopenRawEvidence', {value: evidence, enumerable: false});
  return map;
}
module.exports = {attach};
