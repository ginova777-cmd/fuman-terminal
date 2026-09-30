'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { previousSession } = require('./daytrade-preopen-history-calendar');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const local = ms => new Date(ms + 28800000).toISOString();
const positive = v => typeof v === 'number' && Number.isFinite(v) && v > 0;
const micros = v => Number.isSafeInteger(v) && v >= 1e15 ? v / 1000 : NaN;

// Called only on authenticated provider messages, before latest-quote merging.
// No network, subscriptions, strategy computation, notification or order code.
function extract(payload, received_at) {
  const d = payload?.data, channel = payload?.channel || d?.channel;
  if (!['data', 'snapshot'].includes(payload?.event) || !['aggregates', 'trades'].includes(channel)
      || !/^\d{4,6}$/.test(String(d?.symbol || ''))) return null;
  if (!(d.isTrial === true || (channel === 'aggregates' && positive(d.openPrice)))) return null;
  const received = Date.parse(received_at);
  if (!Number.isFinite(received)) return null;
  return { contract: 'mother_preopen_raw_v1', provider: 'Fugle', source_channel: channel,
    stock_id: d.symbol, received_at, payload, raw_sha256: hash(JSON.stringify(payload)) };
}

function createJournal(root) {
  let pending = Promise.resolve(), queued = 0, failure = null;
  const last = new Map();
  return {
    capture(payload, receivedAt) {
      const row = extract(payload, receivedAt);
      if (!row) return;
      const d = row.payload.data;
      // Bounded storage: preserve every distinct trial event and opening evidence,
      // not every intraday aggregate containing the unchanged opening price.
      const key = local(Date.parse(receivedAt)).slice(0, 10) + ':' + row.stock_id + ':' + row.source_channel;
      const fingerprint = JSON.stringify(d.isTrial === true
        ? [d.date, d.isTrial, d.lastTrial || [d.time, d.price], d.isSynthetic, d.isTest]
        : [d.date, d.openPrice, d.openTime, d.isSynthetic, d.isTest]);
      if (last.get(key) === fingerprint) return;
      if (queued >= 10000) { failure = 'RAW_QUEUE_OVERFLOW'; return; }
      last.set(key, fingerprint); queued++;
      pending = pending.then(async () => {
        const directory = path.join(root, key.slice(0, 10));
        await fs.promises.mkdir(directory, { recursive: true });
        await fs.promises.appendFile(path.join(directory, row.stock_id + '.jsonl'), JSON.stringify(row) + '\n');
      }).catch(e => { failure = e.code || 'RAW_WRITE_FAILED'; last.delete(key); }).finally(() => queued--);
    },
    drain: () => pending,
    health: () => ({ ok: !failure, pending: queued, first_failure: failure })
  };
}

function build({ candidateBytes, candidateSource, calendar, records, asOf, producerVersion, subscriptionReasons = {} }) {
  const c = JSON.parse(candidateBytes), now = Date.parse(asOf);
  if (c.contract !== 'telegram_mother_preopen_candidates_v1' || !Array.isArray(c.symbols)
      || !c.symbols.length || !Number.isFinite(now)) throw Error('CANDIDATE_CONTRACT_INVALID');
  const base = previousSession(calendar, c.trade_date, asOf);
  if (c.base_date !== base) throw Error('CANDIDATE_BASE_DATE_MISMATCH');
  const symbols = new Map();
  for (const r of c.symbols) {
    if (!/^\d{4,6}$/.test(r.stock_id || '')) throw Error('CANDIDATE_SYMBOL_INVALID');
    symbols.set(r.stock_id, { stock_id: r.stock_id, name: r.name || '' });
  }
  const start = Date.parse(c.trade_date + 'T08:55:00+08:00'), end = start + 60000;
  const final = now >= end, run_id = 'mother-preopen:' + c.trade_date + ':' + crypto.randomUUID();
  const rows = [...symbols.values()].sort((a,b) => a.stock_id.localeCompare(b.stock_id)).map(symbol => {
    const trials = [], opens = [], diagnostics = [];
    for (const r of records.filter(r => r.stock_id === symbol.stock_id)) {
      const d = r.payload?.data, channel = r.source_channel, received = Date.parse(r.received_at);
      if (!d || !['aggregates','trades'].includes(channel) || r.contract !== 'mother_preopen_raw_v1'
          || r.provider !== 'Fugle' || r.raw_sha256 !== hash(JSON.stringify(r.payload))
          || d.symbol !== symbol.stock_id || !Number.isFinite(received) || received > now
          || d.isSynthetic === true || d.is_synthetic === true || d.isTest === true || d.is_test === true) {
        diagnostics.push({ reason: 'INVALID_RAW_EVIDENCE', raw_sha256: r.raw_sha256 }); continue;
      }
      const evidence = { received_at: r.received_at, source_channel: channel,
        source_contract: r.contract, raw_evidence_ref: r.raw_evidence_ref, raw_sha256: r.raw_sha256 };
      if (d.isTrial === true) {
        const time = channel === 'aggregates' ? d.lastTrial?.time : d.time;
        const price = channel === 'aggregates' ? d.lastTrial?.price : d.price;
        const ms = micros(time);
        const valid = positive(price) && Number.isFinite(ms) && ms <= received
          && local(ms).slice(0,10) === c.trade_date && (!d.date || d.date === c.trade_date);
        if (valid && ms >= start && ms < end) trials.push({ ...evidence, price,
          event_at: new Date(ms).toISOString(), event_time_microseconds: time, is_trial: true, is_synthetic: false });
        else diagnostics.push({ reason: valid ? 'OUTSIDE_0855_WINDOW' : 'INVALID_TRIAL',
          event_at: Number.isFinite(ms) ? new Date(ms).toISOString() : null, ...evidence });
      }
      if (channel === 'aggregates' && positive(d.openPrice)) {
        const ms = micros(d.openTime);
        // Require native opening timestamp; never substitute last trade or 09:00.
        if (d.date === c.trade_date && Number.isFinite(ms) && ms <= received
            && local(ms).slice(0,10) === c.trade_date && ms >= Date.parse(c.trade_date+'T09:00:00+08:00')) {
          opens.push({ ...evidence, price: d.openPrice, event_at: new Date(ms).toISOString(), source_field: 'openPrice/openTime' });
        } else diagnostics.push({ reason: 'OPEN_EVIDENCE_UNCONFIRMED', ...evidence });
      }
    }
    const times = new Map();
    for (const t of trials) { const set = times.get(t.event_time_microseconds) || new Set(); set.add(t.price); times.set(t.event_time_microseconds, set); }
    const conflict = [...times.values()].some(s => s.size > 1);
    const latest = trials.sort((a,b) => b.event_time_microseconds - a.event_time_microseconds)[0];
    const missing_reason = subscriptionReasons[symbol.stock_id] || 'MISSING_0855_TRIAL';
    const empty = { price: null, event_at: null, received_at: null, raw_evidence_ref: null, raw_sha256: null };
    const trial_0855 = { ...empty, captured_at: asOf, is_trial: null, is_synthetic: null,
      source_channel: null, source_contract: 'mother_preopen_raw_v1',
      ...(conflict ? { status: 'CONFLICT', missing_reason: 'SAME_EVENT_DIFFERENT_PRICE' }
        : latest ? { ...latest, status: final ? 'FINAL' : 'PROVISIONAL', missing_reason: null }
        : { status: final ? 'MISSING' : 'PROVISIONAL', missing_reason }) };
    const openConflict = new Set(opens.map(o => o.price + ':' + o.event_at)).size > 1;
    const actual_open = { ...empty, source_field: null,
      ...(openConflict ? { status: 'INVALID', missing_reason: 'OPEN_EVIDENCE_CONFLICT' }
        : opens.length ? { ...opens[0], status: 'CONFIRMED', missing_reason: null }
        : { status: 'WAITING', missing_reason: 'NATIVE_OPEN_NOT_CONFIRMED' }) };
    const selected_price_kind = trial_0855.status === 'FINAL' ? 'trial_0855'
      : actual_open.status === 'CONFIRMED' ? 'actual_open' : 'unavailable';
    return { ...symbol, base_date: base, trade_date: c.trade_date, provider: 'Fugle', trial_0855, actual_open,
      selected_price_kind, selected_price: selected_price_kind === 'unavailable' ? null
        : selected_price_kind === 'trial_0855' ? trial_0855.price : actual_open.price,
      run_id, producer_version: producerVersion, diagnostics };
  });
  const covered = rows.filter(r => r.trial_0855.status === 'FINAL').length;
  return { contract: 'mother_preopen_snapshot_v1', version: 1, run_id, base_date: base, trade_date: c.trade_date,
    generated_at: asOf, finalized_at: final ? asOf : null, source_provider: 'Fugle',
    source_channel: 'shared_websocket', producer_version: producerVersion,
    candidate_source: candidateSource, candidate_sha256: hash(candidateBytes), requested_count: rows.length,
    covered_count: covered, missing_count: rows.filter(r => r.trial_0855.price === null && r.trial_0855.status !== 'CONFLICT').length,
    conflict_count: rows.filter(r => r.trial_0855.status === 'CONFLICT').length,
    actual_open_covered_count: rows.filter(r => r.actual_open.status === 'CONFIRMED').length,
    missing_symbols: rows.filter(r => r.trial_0855.price === null).map(r => ({ stock_id: r.stock_id, reason: r.trial_0855.missing_reason })),
    status: !final ? 'PROVISIONAL' : covered === rows.length ? 'FINAL' : 'PARTIAL',
    complete: false, notifications_sent: 0, orders_sent: 0, rows };
}

// A new immutable directory per publication, then one atomic receipt pointer.
// Readers open receipt first and use only its hashed revision files.
function publishUnlocked(root, snapshot, { revisionReason, schedule = {} } = {}) {
  const dir = path.join(root, snapshot.trade_date); fs.mkdirSync(dir, { recursive: true });
  const current = path.join(dir, 'receipt.json');
  const prior = fs.existsSync(current) ? JSON.parse(fs.readFileSync(current)) : null;
  if (prior?.finalized_at && !revisionReason) throw Error('FINAL_REVISION_REASON_REQUIRED');
  const revision = crypto.randomUUID(), dest = path.join(dir, 'revisions', revision);
  fs.mkdirSync(dest, { recursive: true });
  const files = {};
  for (const [name, value] of [['trial-0855.json', snapshot], ['actual-open.json', { ...snapshot, rows: snapshot.rows.map(r => ({ stock_id: r.stock_id, base_date: r.base_date, trade_date: r.trade_date, actual_open: r.actual_open, selected_price_kind: r.selected_price_kind, selected_price: r.selected_price })) }]]) {
    const bytes = JSON.stringify(value); const file = path.join(dest, name);
    fs.writeFileSync(file, bytes, { flag: 'wx' });
    if (hash(fs.readFileSync(file)) !== hash(bytes)) throw Error('READBACK_HASH_MISMATCH');
    files[name] = { path: file, sha256: hash(bytes) };
  }
  const { rows, ...meta } = snapshot;
  const receipt = { ...meta, revision, revision_reason: revisionReason || 'INITIAL_CAPTURE',
    previous_revision: prior?.revision || null, files, schedule_name: schedule.name || null,
    scheduled_start: schedule.scheduled_start || null, actual_start: schedule.actual_start || null,
    process_status: schedule.process_status || 'OFFLINE_BUILD_NOT_SCHEDULED', independent_readback: 'HASH_VERIFIED' };
  fs.writeFileSync(path.join(dest, 'receipt.json'), JSON.stringify(receipt), { flag: 'wx' });
  const temp = current + '.' + revision + '.tmp'; fs.writeFileSync(temp, JSON.stringify(receipt)); fs.renameSync(temp, current);
  return receipt;
}
function publish(root, snapshot, options) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshot.trade_date)) throw Error('TRADE_DATE_INVALID');
  const dir=path.join(root,snapshot.trade_date); fs.mkdirSync(dir,{recursive:true});
  const lock=path.join(dir,'publish.lock'); const fd=fs.openSync(lock,'wx');
  try { return publishUnlocked(root,snapshot,options); }
  finally { fs.closeSync(fd); fs.unlinkSync(lock); }
}
module.exports = { extract, createJournal, build, publish, hash };
