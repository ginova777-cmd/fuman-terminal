'use strict';
const {createHash}=require('node:crypto');
const {verifySource}=require('./mother-pool-snapshot-module-producer');
const sha=value=>createHash('sha256').update(value).digest('hex');
const symbolHash=symbols=>sha(JSON.stringify([...symbols].sort()));
const identityKeys=['trade_date','canonical_run_id','mother_pool_run_id','generation','snapshot_sequence'];
function bindReceipt({snapshotRaw,readbackRaw,tradeDate,canonicalRunId,symbols,now=Date.now()}) {
 const snapshot=JSON.parse(snapshotRaw),readback=JSON.parse(readbackRaw);
 if(snapshot.trade_date!==tradeDate||snapshot.canonical_run_id!==canonicalRunId)throw Error('snapshot_binding_date_or_canonical_mismatch');
 if(readback.complete!==true||readback.status!=='complete'||readback.exit_code!==0||readback.first_blocker||!Array.isArray(readback.failed_checks)||readback.failed_checks.length)throw Error('snapshot_binding_readback_incomplete');
 if(identityKeys.some(k=>readback[k]!==snapshot[k]))throw Error('snapshot_binding_readback_identity_mismatch');
 const stamp=Date.parse(readback.verified_at);
 if(!Number.isFinite(stamp)||stamp<Date.parse(snapshot.effective_at)||stamp>now)throw Error('snapshot_binding_readback_time_invalid');
 const rows=verifySource(snapshot,readback).filter(r=>r.membership_status!=='REMOVED');
 if(!Array.isArray(symbols)||!symbols.length||symbols.some(s=>typeof s!=='string'||!/^\d{4}$/.test(s))||new Set(symbols).size!==symbols.length)throw Error('snapshot_binding_symbols_invalid');
 if(symbolHash(rows.map(r=>r.symbol))!==symbolHash(symbols))throw Error('snapshot_binding_members_mismatch');
 return {...Object.fromEntries(identityKeys.map(k=>[k,snapshot[k]])),symbols_sha256:symbolHash(symbols),snapshot_sha256:sha(snapshotRaw),snapshot_readback_sha256:sha(readbackRaw),snapshot_readback_verified_at:readback.verified_at,snapshot_readback_count:rows.length,receipt_generation_verified:true};
}
function validateReceipt(receipt,identity,symbols) {
 const failures=[];
 for(const key of identityKeys)if(identity?.[key]==null||receipt?.[key]!==identity[key])failures.push('receipt_identity_mismatch:'+key);
 if(!Number.isInteger(identity?.snapshot_sequence)||identity.snapshot_sequence<1)failures.push('snapshot_sequence_invalid');
 if(!Array.isArray(symbols)||!symbols.length||symbols.some(s=>typeof s!=='string'||!/^\d{4}$/.test(s))||new Set(symbols).size!==symbols.length)failures.push('snapshot_symbols_invalid');
 else {
  if(receipt?.symbols_sha256!==symbolHash(symbols))failures.push('receipt_symbols_mismatch');
  if(receipt?.mother_pool_rows!==symbols.length||receipt?.snapshot_readback_count!==symbols.length)failures.push('receipt_count_mismatch');
 }
 if(receipt?.receipt_generation_verified!==true)failures.push('receipt_generation_unverified');
 if(receipt?.complete!==true||!Array.isArray(receipt.failed_checks)||receipt.failed_checks.length||receipt.first_blocker)failures.push('producer_receipt_incomplete');
 for(const key of ['snapshot_sha256','snapshot_readback_sha256'])if(!/^[a-f0-9]{64}$/.test(receipt?.[key]||''))failures.push('receipt_evidence_missing:'+key);
 const stamp=Date.parse(receipt?.snapshot_readback_verified_at),verified=Date.parse(receipt?.verified_at);
 if(!Number.isFinite(stamp)||!Number.isFinite(verified)||stamp>verified||verified>Date.now())failures.push('receipt_evidence_time_invalid');
 return {ok:failures.length===0,failed_checks:failures};
}
module.exports={bindReceipt,validateReceipt};
