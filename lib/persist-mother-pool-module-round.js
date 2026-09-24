'use strict';
const {hash, identityFields} = require('./mother-pool-module-write-set');
const registry = require('../data/contracts/mother-pool-a01-b24-module-registry-v1.json');

// A module supplies its actual requested universe and evidence before I/O.
// Missing source rows are explicit gaps, never inferred from a SELECT result.
async function persistModuleRound(input, adapter) {
  if (!registry.modules[input.module_id]) throw Error('UNKNOWN_MODULE');
  for (const key of identityFields) if (input[key] == null || input[key] === '') throw Error('MISSING_IDENTITY:' + key);
  if (!Number.isInteger(input.snapshot_sequence) || input.snapshot_sequence < 1) throw Error('INVALID_SEQUENCE');
  const requested = input.requested_symbols;
  if (!Array.isArray(requested) || !requested.length || requested.some(s => typeof s !== 'string' || !s) || new Set(requested).size !== requested.length) throw Error('INVALID_REQUESTED_SET');
  const rows = input.rows;
  if (!Array.isArray(rows) || rows.length !== requested.length || new Set(rows.map(r => r.symbol)).size !== rows.length || rows.some(r => !requested.includes(r.symbol))) throw Error('PRODUCER_SET_MISMATCH');
  for (const row of rows) {
    if (!['READY','DATA_GAP'].includes(row.status)) throw Error('INVALID_SOURCE_STATUS');
    if (!row.source || !row.source_contract || !Number.isFinite(Date.parse(row.source_updated_at))) throw Error('SOURCE_PROVENANCE_REQUIRED');
    if (row.status === 'DATA_GAP' && !row.data_gap_reason) throw Error('GAP_REASON_REQUIRED');
    if (row.is_synthetic !== false || row.replay !== false || row.look_ahead !== false) throw Error('NATURAL_PROVENANCE_REQUIRED');
  }
  const identity = Object.fromEntries(identityFields.map(k => [k,input[k]]));
  const plan = {created_at: input.created_at, requested_symbols: requested,
    data_gap_symbols: rows.filter(r => r.status === 'DATA_GAP').map(r => r.symbol),
    special_evidence: input.special_evidence || {}, ...(input.source_evidence?{source_evidence:input.source_evidence}:{}), rows};
  if (!Number.isFinite(Date.parse(plan.created_at))) throw Error('PLAN_TIME_REQUIRED');
  const writeSet = {contract:'mother_pool_module_write_set_v1', module_id:input.module_id,
    module_contract:registry.modules[input.module_id], ...identity, plan, plan_hash:hash(plan)};
  await adapter.savePlan(writeSet); // Durable intent must precede the RPC.
  const ack = await adapter.persist({p_document:JSON.stringify(writeSet), p_plan:JSON.stringify(plan)});
  if (!ack || ack.committed !== true || ack.plan_hash !== writeSet.plan_hash || !Array.isArray(ack.written_symbols)) throw Error('INVALID_DB_ACK');
  for (const key of identityFields) if (ack[key] !== identity[key]) throw Error('ACK_IDENTITY:' + key);
  if (ack.module_id !== input.module_id || ack.written_symbols.length !== requested.length || new Set(ack.written_symbols).size !== requested.length || requested.some(s => !ack.written_symbols.includes(s))) throw Error('DB_WRITE_SET_MISMATCH');
  writeSet.ack = ack;
  await adapter.saveEvidence(writeSet);
  return writeSet;
}
module.exports = {persistModuleRound};
