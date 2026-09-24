"use strict";
const crypto = require('crypto');
const CONTRACT = 'strategy3-source-fields-v2';
function dateOf(value) {
  const ms=Date.parse(value || '');
  return Number.isFinite(ms) ? new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei'}).format(new Date(ms)) : '';
}
function volumeEvidence(row, date) {
  const gaps=[];
  const raw=row.total_volume;
  const unit=row.total_volume_unit;
  const numeric=raw!==null && raw!==undefined && raw!=='' && Number.isFinite(Number(raw)) && Number(raw)>=0;
  if(!numeric) gaps.push('total_volume_missing_or_invalid');
  if(!['lots','shares'].includes(unit)) gaps.push('total_volume_unit_missing_or_invalid');
  if(row.total_volume_available!==true) gaps.push('total_volume_unavailable');
  if(row.is_synthetic!==false) gaps.push('total_volume_synthetic_or_unknown');
  if(!row.total_volume_source) gaps.push('total_volume_source_missing');
  if(dateOf(row.total_volume_source_event_at)!==date) gaps.push('total_volume_event_date_mismatch');
  return {gaps, total_volume:gaps.length?null:Number(raw)/(unit==='shares'?1000:1),total_volume_unit:'lots',total_volume_raw:raw??null,total_volume_raw_unit:unit??null,total_volume_available:gaps.length===0,total_volume_source:row.total_volume_source||null,total_volume_source_event_at:row.total_volume_source_event_at||null,is_synthetic:row.is_synthetic??null};
}
function quoteEvidence(row,date) {
  const gaps=[];
  for(const field of ['quote_seen_at','last_trade_time']) {
    if(dateOf(row?.[field])!==date || Date.parse(row?.[field])>Date.now()) gaps.push(field+'_missing_or_wrong_date');
  }
  return {gaps,canonical_quote_time:dateOf(row?.quote_seen_at)===date?row.quote_seen_at:''};
}
function snapshotEvidence(before,after,rows) {
  const gaps=[];
  if(!before.ok || !after.ok) gaps.push('mother_pool_snapshot_invalid');
  const fields=['trade_date','canonical_run_id','mother_pool_run_id','snapshot_sequence','snapshot_type','effective_at','generation'];
  if(typeof before.snapshot?.generation!=='string'||!before.snapshot.generation.trim()) gaps.push('mother_pool_snapshot_generation_missing');
  if(fields.some(k=>before.snapshot?.[k]!==after.snapshot?.[k])) gaps.push('mother_pool_snapshot_changed_during_read');
  const expected=[...(before.symbols||[])].sort(),actual=rows.map(r=>String(r.symbol)).sort();
  if(JSON.stringify(expected)!==JSON.stringify(actual)) gaps.push('mother_pool_snapshot_symbol_set_mismatch');
  for(const symbol of expected){const m=before.membership?.get(symbol);if(!m || m.membership_status==='REMOVED' || before.removed?.has(symbol)) gaps.push('mother_pool_snapshot_removed_member');}
  const identity=Object.fromEntries(fields.map(k=>[k,before.snapshot?.[k]??null]));
  identity.symbols_sha256=crypto.createHash('sha256').update(JSON.stringify(expected)).digest('hex');
  // Binding is a consumer cross-check against the independent producer snapshot;
  // it does not claim the mutable View publishes a per-row snapshot identity.
  return {contract:CONTRACT,ok:gaps.length===0,gaps:[...new Set(gaps)],identity,binding:'producer_snapshot_and_exact_view_symbol_set'};
}
module.exports={CONTRACT,volumeEvidence,quoteEvidence,snapshotEvidence};
