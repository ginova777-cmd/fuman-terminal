'use strict';
// Independent closure verifier: no runner completion flag can satisfy these checks.
const { createHash } = require('crypto');
function canonical(v) { return Array.isArray(v) ? '[' + v.map(canonical).join(',') + ']' : v && typeof v === 'object' ? '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}' : JSON.stringify(v); }
const hash = v => createHash('sha256').update(canonical(v)).digest('hex');
function verify({ record, db, surfaces, expectedDate, expectedRunId, sourceProof }) {
  const failed = [], check = (ok, reason) => { if (!ok) failed.push(reason); };
  check(record?.contract === 'telegram_three_independent_detectors_v1', 'CONTRACT_MISMATCH');
  check(record?.trade_date === expectedDate && record?.run_id === expectedRunId && !!expectedRunId, 'BATCH_IDENTITY_MISMATCH');
  check(record?.mode === 'live' && record?.live_point_in_time_proven === true, 'NATURAL_INTRADAY_EVIDENCE_REQUIRED');
  check(sourceProof?.complete === true && sourceProof?.live_point_in_time_proven === true && sourceProof?.run_id === expectedRunId && sourceProof?.trade_date === expectedDate && sourceProof?.events_sha256 === hash(record?.events || []), 'SOURCE_PROOF_NOT_ALIGNED');
  for(const name of ['volume','price','outside'])check(sourceProof?.ready_counts?.[name]>0,'MODULE_SOURCE_NOT_READY:'+name);
  check(record?.candle_timeframe === '1m', 'ONE_MINUTE_TIMEFRAME_REQUIRED');
  check(Array.isArray(record?.events) && record.event_count === record.events.length && record.events_sha256 === hash(record.events), 'EVENT_HASH_OR_COUNT_MISMATCH');
  check(db != null && hash(record) === hash(db), 'CANONICAL_DB_READBACK_MISMATCH');
  check(record?.failed_checks?.length === 0 && record?.db_readback_ok === true, 'RUNNER_BLOCKED');
  for (const name of ['desktop', 'mobile', 'scorecard']) {
    const s = surfaces?.[name];
    check(s?.rendered === true && s.run_id === expectedRunId && s.trade_date === expectedDate && s.events_sha256 === record?.events_sha256 && s.event_count === record?.event_count && !!s.screenshot_sha256 && !!s.url, 'SURFACE_NOT_ALIGNED:' + name);
  }
  const events = record?.events || [], deliveries = record?.deliveries || [];
  for (const e of events) {
    if(!Number.isFinite(Date.parse(e.timestamp))){check(false,'INVALID_EVENT_TIMESTAMP');continue;}
    const id = `${expectedDate}:${e.stock_id || e.symbol}:${new Date(e.timestamp).toISOString()}:${e.event_type}`;
    const d = deliveries.filter(x => x.event_id === id);
    check(d.length === 1 && d[0].status === 'delivered' && Number.isInteger(d[0].target_count) && d[0].target_count > 0 && d[0].confirmed_count === d[0].target_count, 'DELIVERY_NOT_PROVEN:' + id);
    const targets=d[0]?.targets||[];
    check(targets.length===d[0]?.target_count&&new Set(targets.map(x=>x.target_hash)).size===targets.length&&targets.every(x=>typeof x.target_hash==='string'&&x.confirmed===true&&Number.isInteger(x.message_id)&&x.message_id>0),'TARGET_ACKNOWLEDGEMENTS_MISSING:'+id);
  }
  return { contract: 'telegram_three_detectors_final_receipt_v1', trade_date: expectedDate, run_id: expectedRunId, checked_at: new Date().toISOString(), scope: 'formal_three_detectors_closure', status: failed.length ? 'blocked' : 'complete', complete: !failed.length, exit_code: failed.length ? 1 : 0, failed_checks: failed, first_blocker: failed[0] || null, triSurfaceStatus: failed.some(x => x.startsWith('SURFACE_')) ? 'blocked' : 'complete' };
}
module.exports = { verify };
