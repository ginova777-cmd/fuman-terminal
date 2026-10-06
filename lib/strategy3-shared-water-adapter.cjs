'use strict';
// PREPARED ONLY. No production reader imports this module. Mapping and evidence
// verification must be frozen with the producer before activating any new Gate.
const {createHash} = require('node:crypto');
const ID = ['trade_date','canonical_run_id','mother_pool_run_id','writer_run_id','generation','snapshot_sequence'];
const STATES = ['FRESH','NO_NEW_TRADE','SUBSCRIPTION_MISSING','SUBSCRIPTION_FAILED','PIPELINE_DELAY','PUBLICATION_GAP','DISCONNECTED','INVALID_SOURCE','UNKNOWN'];
function symbolsHash(symbols) {
  if (!Array.isArray(symbols) || symbols.some(s => typeof s !== 'string' || !/^[0-9A-Za-z]+$/.test(s)) || new Set(symbols).size !== symbols.length) throw Error('invalid_symbol_set');
  return createHash('sha256').update(JSON.stringify([...symbols].sort()), 'utf8').digest('hex');
}
function evaluate(receipt, options = {}) {
  const errors = [];
  const fail = x => { if (!errors.includes(x)) errors.push(x); };
  const result = metrics => ({adapter_status:'PREPARED', water_gate_pass:errors.length === 0,
    strategy3_scan_ready:false, formal_entry_authorization:false,
    failed_checks:errors, first_blocker:errors[0] || null, ...metrics});
  if (!receipt || typeof receipt !== 'object') { fail('shared_water_receipt_missing'); return result({}); }
  const r = receipt, e = options.expected || {}, now = options.nowMs;
  if (!Number.isFinite(now)) fail('verification_clock_missing');
  if (r.contract !== 'mother-pool-shared-water-acceptance-v1') fail('contract_mismatch');
  // These values must come from the agreed producer/consumer mapping, never the receipt itself.
  for (const k of ['contract_version','producer_version','scope_definition_version',...ID]) {
    if (e[k] == null || e[k] === '' || r[k] !== e[k]) fail('identity_or_version_mismatch:' + k);
  }
  if (!Number.isInteger(r.snapshot_sequence) || r.snapshot_sequence <= 0) fail('snapshot_sequence_invalid');
  if (r.scope !== 'full_priority_pool') fail('scope_mismatch');
  if (typeof r.verification_run_id !== 'string' || !r.verification_run_id) fail('verification_run_id_missing');
  const stamp = v => typeof v === 'string' && /(Z|[+-]\d\d:\d\d)$/.test(v) ? Date.parse(v) : NaN;
  const checked = stamp(r.checked_at), asof = stamp(r.source_asof), until = stamp(r.valid_until);
  if (![checked,asof,until].every(Number.isFinite) || asof > checked || checked > now || until <= now || until < checked) fail('receipt_time_invalid');
  let hash;
  try { hash = symbolsHash(r.requested_symbols); if (hash !== r.requested_symbols_sha256 || hash !== symbolsHash(e.requested_symbols)) fail('requested_hash_mismatch'); }
  catch { fail('requested_symbols_invalid'); }
  const n = Array.isArray(r.requested_symbols) ? r.requested_symbols.length : 0;
  if (n <= 0 || r.requested_count !== n || r.unique_count !== n) fail('denominator_invalid');
  if (r.status !== 'PASS' || r.first_blocker !== null || !Array.isArray(r.failed_checks) || r.failed_checks.length) fail('producer_not_pass');
  const rows = Array.isArray(r.rows) ? r.rows : [];
  try { if (symbolsHash(rows.map(x => x.symbol)) !== hash) fail('row_set_mismatch'); } catch { fail('row_set_invalid'); }
  const counts = Object.fromEntries(STATES.map(x => [x,0]));
  for (const row of rows) {
    const key = String(row.symbol), state = row.source_status;
    if (!STATES.includes(state)) { fail('classification_invalid:' + key); continue; }
    counts[state]++;
    if (row.trade_date !== r.trade_date) fail('row_date_mismatch:' + key);
    if (!['FRESH','NO_NEW_TRADE'].includes(state)) continue;
    const at = stamp(row.evidence_asof), valid = stamp(row.evidence_valid_until), trade = stamp(row.last_trade_at);
    if (![at,valid,trade].every(Number.isFinite) || trade > at || at > checked || valid <= now || valid > until) fail('row_time_invalid:' + key);
    if (!row.source || !row.raw_evidence_ref || !row.transport_evidence_ref || !/^[a-f0-9]{64}$/.test(row.payload_sha256 || '')) fail('row_evidence_missing:' + key);
    if (state === 'FRESH' && (!Number.isFinite(stamp(row.quote_event_at)) || stamp(row.quote_event_at) > at || now - stamp(row.quote_event_at) > 120000)) fail('fresh_event_invalid:' + key);
    // A producer boolean, heartbeat or historic ACK is not independent evidence.
    // A reviewed resolver must verify referenced raw bytes, transport generation,
    // continuity/recovery and absence of a newer unpublished event.
    let proof;
    try { proof = typeof options.verifyEvidence === 'function' ? options.verifyEvidence(row, r) : null; } catch { proof = null; }
    const required = ['verified','raw_hash_verified','identity_verified'];
    // Owner-approved v1.1: FRESH proves the native event and its publication
    // within 120 seconds. Only idle evidence additionally requires no newer
    // unpublished event. Older versions retain their original strict meaning.
    if(r.contract_version==='1.1.0'&&state==='FRESH') required.push('native_event_verified','publication_verified');
    else required.push('native_latest_verified','pipeline_caught_up');
    if (state === 'NO_NEW_TRADE') required.push('subscription_generation_verified','continuity_verified','no_new_trade_verified');
    if (!proof || required.some(k => proof[k] !== true)) fail('independent_evidence_unverified:' + key);
  }
  const fresh = counts.FRESH, quiet = counts.NO_NEW_TRADE, unknown = counts.UNKNOWN;
  const available = fresh + quiet, unavailable = rows.length - available - unknown;
  for (const [k,v] of Object.entries({fresh_count:fresh,no_new_trade_count:quiet,unknown_count:unknown,unavailable_count:unavailable,water_available_count:available})) if (r[k] !== v) fail('count_mismatch:' + k);
  if (r.water_available_threshold !== 0.95 || r.water_available_coverage !== available / n) fail('coverage_contract_mismatch');
  if (n <= 0 || available < Math.ceil(n * 0.95)) fail('water_coverage_below_095');
  return result({requested_count:n,fresh_count:fresh,no_new_trade_count:quiet,unknown_count:unknown,water_available_count:available,water_available_coverage:n > 0 ? available/n : null});
}
module.exports = {evaluate,symbolsHash};
