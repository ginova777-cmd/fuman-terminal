'use strict';
// Verify exact written bars, not an independently advancing "latest" pointer.
function verifyCandleReadback(expected, actualRows, context = {}) {
  const failures = [];
  const fail = value => failures.push(value);
  if (context.read_role !== 'anon' || context.db_readback_ok !== true) fail('ANON_READBACK_NOT_PROVEN');
  if (!expected || !Array.isArray(expected.items) || !Array.isArray(actualRows)) {
    fail('INVALID_ENVELOPE');
    return verdict();
  }
  const evidenceAt = Date.parse(expected.checked_at);
  const asOf = Date.parse(context.readback_at ?? expected.checked_at);
  if (!Number.isFinite(asOf)) fail('INVALID_CHECK_TIME');
  if (!Number.isFinite(evidenceAt) || asOf < evidenceAt) fail('INVALID_EVIDENCE_TIME_ORDER');
  const day = Number.isFinite(asOf) ? new Date(asOf + 28800000).toISOString().slice(0,10) : '';
  const validItem = row => row && typeof row === 'object' && !Array.isArray(row)
    && typeof row.symbol === 'string' && /^\d{4}$/.test(row.symbol);
  if (expected.items.some(row => !validItem(row))) {
    fail('INVALID_EXPECTED_ITEM');
    return verdict();
  }
  const symbols = expected.items.map(row => row.symbol);
  if (new Set(symbols).size !== symbols.length || expected.requested_count !== symbols.length) fail('REQUESTED_COUNT_MISMATCH');
  const keyed = new Map();
  for (const row of actualRows) {
    if (!validItem(row) || !Number.isFinite(Date.parse(row.candle_time))) { fail('INVALID_READBACK_ROW'); continue; }
    if (!symbols.includes(row.symbol)) { fail(`UNREQUESTED_READBACK_SYMBOL:${row.symbol}`); continue; }
    const key = `${row.symbol}|${Date.parse(row.candle_time)}`;
    if (keyed.has(key)) fail(`DUPLICATE_READBACK:${row.symbol}`);
    keyed.set(key,row);
  }
  for (const item of expected.items) {
    if (!['READY','DATA_GAP'].includes(item.status)) fail(`INVALID_ITEM_STATUS:${item.symbol}`);
    if (item.status === 'DATA_GAP' && !item.reason) fail(`GAP_REASON_MISSING:${item.symbol}`);
    if (item.status !== 'READY') continue; // gaps remain gaps, never qualify through a later row
    const start = Date.parse(item.bar_start);
    const row = keyed.get(`${item.symbol}|${start}`);
    if (!row) { fail(`MISSING_EXACT_BAR:${item.symbol}`); continue; }
    if (row.trade_date !== day || item.trade_date !== day || !Number.isFinite(start)
      || new Date(start + 28800000).toISOString().slice(0,10) !== day
      || start % 60000 !== 0 || asOf-start < 60000 || asOf-start > 120000) fail(`TIME_INVALID:${item.symbol}`);
    if (row.synthetic !== false || row.volume_strategy_usable !== true
      || item.synthetic !== false || item.volume_strategy_usable !== true) fail(`QUALITY_INVALID:${item.symbol}`);
    for (const key of ['open','high','low','close','volume']) {
      if (typeof row[key] !== 'number' || !Number.isFinite(row[key]) || row[key] !== item[key]
        || (key === 'volume' ? row[key] < 0 : row[key] <= 0)) fail(`FIELD_MISMATCH:${item.symbol}:${key}`);
    }
    if (row.high < Math.max(row.open,row.close,row.low) || row.low > Math.min(row.open,row.close,row.high)) fail(`OHLC_INVALID:${item.symbol}`);
    if (!item.source || row.source !== item.source) fail(`SOURCE_MISMATCH:${item.symbol}`);
  }
  if (expected.ready_count !== expected.items.filter(row=>row.status==='READY').length) fail('READY_COUNT_MISMATCH');
  return verdict();
  function verdict() {
    return {contract:'b01_exact_candle_readback_v1',complete:false,
      candle_readback_verified:failures.length===0,status:failures.length?'BLOCKED':'CANDLE_READBACK_VERIFIED',
      failed_checks:failures,first_blocker:failures[0]||null,exit_code:failures.length?1:0,
      requested_count:expected?.requested_count??null,readback_count:Array.isArray(actualRows)?actualRows.length:null,
      limitation:'Exact READY candle comparison only; does not prove quotes, full-market coverage, transport or overall B01 completion.'};
  }
}
module.exports={verifyCandleReadback};
