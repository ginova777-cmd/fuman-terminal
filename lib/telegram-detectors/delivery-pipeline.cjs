'use strict';
const crypto = require('crypto');
const { prepare } = require('./telegram-event-adapter.cjs');
const CONTRACT = 'telegram_three_independent_detectors_v1';
const digest = value => crypto.createHash('sha256').update(stable(value)).digest('hex');
function stable(value) {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stable(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
// Storage and delivery are injected. Tests cannot accidentally reach Telegram.
// A send requires independently validated source evidence and a durable DB readback.
async function run({ batch, events, now, verifySource, store, readback, send, targetCount }) {
  const source = await verifySource(batch, events);
  const failures = [...(source.failed_checks || [])];
  if (source.complete !== true) failures.push('SOURCE_VERIFIER_NOT_COMPLETE');
  if (source.run_id !== batch.run_id || source.trade_date !== batch.trade_date || source.events_sha256 !== digest(events)) failures.push('SOURCE_PROOF_IDENTITY_MISMATCH');
  const natural = batch.mode === 'live' && source.live_point_in_time_proven === true;
  const payload = {
    contract: CONTRACT, run_id: batch.run_id, source_run_id: batch.source_run_id,
    trade_date: batch.trade_date, mode: batch.mode, checked_at: now,
    scope: natural ? 'natural_intraday_three_detectors' : 'replay_integration_only',
    live_point_in_time_proven: natural, calculation_verified: !failures.length,
    ready_counts: source.ready_counts || null, pending_modules: source.pending_modules || [],
    candle_timeframe: '1m', events, event_count: events.length,
    events_sha256: digest(events), data_gaps: batch.data_gaps || [], data_gap_count: (batch.data_gaps || []).length,
    requested_count: batch.requested_count ?? null, evaluated_count: batch.evaluated_count ?? null,
    deliveries: [], status: 'blocked', complete: false,
    failed_checks: [], first_blocker: null, notifications_sent: 0,
  };
  const key = `telegram_three_detectors_${batch.run_id}`;
  let dbReadback = false;
  if (!failures.length) {
    try {
      await store(key, payload);
      const found = await readback(key);
      dbReadback = digest(found) === digest(payload);
      if (!dbReadback) failures.push('DB_READBACK_MISMATCH');
    } catch { failures.push('DB_WRITE_OR_READBACK_FAILED'); }
  }
  const prepared = prepare({ batch: { ...batch, complete: !failures.length, verifier_complete: !failures.length, live_point_in_time_proven: natural }, events, now });
  if (natural && !prepared.publish_allowed) failures.push(...prepared.failed_checks);
  if (natural && prepared.publish_allowed && !failures.length) {
    if (!Number.isInteger(targetCount) || targetCount < 1) failures.push('NO_DELIVERY_TARGETS');
    else for (const intent of prepared.intents) {
      try {
        const results = await send(intent);
        const confirmed = Array.isArray(results) ? results.filter(x => (x.sent === true || x.previouslyDelivered === true) && typeof x.target_hash === 'string' && Number.isInteger(x.message_id) && x.message_id > 0).length : 0;
        const delivered = Array.isArray(results) && results.length === targetCount && confirmed === targetCount && new Set(results.map(x=>x.target_hash)).size === targetCount;
        payload.deliveries.push({ event_id: intent.event_id, dedup_key: intent.dedup_key, target_count: targetCount, confirmed_count: confirmed, targets: Array.isArray(results) ? results.map(x=>({target_hash:x.target_hash,message_id:x.message_id,confirmed:(x.sent===true||x.previouslyDelivered===true)&&Number.isInteger(x.message_id)&&x.message_id>0})) : [], status: delivered ? 'delivered' : 'unconfirmed', sent_at: now });
        if (delivered && results.some(x => x.sent === true)) payload.notifications_sent++;
        else failures.push('DELIVERY_NOT_CONFIRMED');
      } catch { failures.push('DELIVERY_FAILED'); }
    }
    if (prepared.skipped?.length) failures.push('EVENT_REJECTED_BY_NOTIFIER');
  }
  payload.notification_status = natural ? failures.length ? 'blocked' : 'verified' : 'replay_not_sent';
  payload.db_readback_ok = dbReadback;
  payload.integration_complete = !failures.length && dbReadback;
  // UI and final independent verifier own formal completion, never this runner.
  payload.failed_checks = [...new Set(failures)];
  payload.first_blocker = payload.failed_checks[0] || (natural ? payload.pending_modules.length ? 'MODULE_SOURCE_NOT_READY:'+payload.pending_modules.join(',') : 'TRI_SURFACE_VERIFICATION_PENDING' : 'NATURAL_INTRADAY_EVIDENCE_REQUIRED');
  payload.status = payload.integration_complete ? payload.pending_modules.length ? 'degraded' : 'pending' : 'blocked';
  if (dbReadback) {
    try {
      await store(key, payload);
      const found = await readback(key);
      if (digest(found) !== digest(payload)) throw Error('mismatch');
    } catch {
      payload.integration_complete = false; payload.db_readback_ok = false;
      payload.failed_checks.push('DELIVERY_READBACK_MISMATCH'); payload.first_blocker = 'DELIVERY_READBACK_MISMATCH'; payload.status = 'blocked';
    }
  }
  return payload;
}
module.exports = { run, CONTRACT, digest, stable };
