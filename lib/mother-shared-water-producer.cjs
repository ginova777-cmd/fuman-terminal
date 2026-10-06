'use strict';
// Builds an immutable receipt from caller-frozen membership and evidence bytes.
// Does not fetch, write, or infer NO_NEW_TRADE from a transport heartbeat.
const {createHash}=require('node:crypto');
const {createVerifier}=require('./mother-shared-water-evidence.cjs');
const hash=b=>createHash('sha256').update(b).digest('hex');
function canonicalSymbols(rows){
 if(!Array.isArray(rows)||!rows.length||rows.some(s=>typeof s!=='string'||!/^\d{4}$/.test(s))||new Set(rows).size!==rows.length)throw Error('MEMBERSHIP_INVALID');
 return [...rows].sort();
}
function build({identity,prioritySymbols,snapshotBytes,evidenceRows,resolve,checkedAt,validUntil}){
 const symbols=canonicalSymbols(prioritySymbols),snapshot=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(snapshotBytes));
 const members=canonicalSymbols(snapshot.symbols);
 for(const key of ['trade_date','canonical_run_id','mother_pool_run_id','generation','snapshot_sequence'])if(identity[key]!==snapshot[key])throw Error('SNAPSHOT_IDENTITY_MISMATCH:'+key);
 for(const key of ['trade_date','canonical_run_id','mother_pool_run_id','writer_run_id','generation','producer_version','verification_run_id'])if(typeof identity[key]!=='string'||!identity[key])throw Error('IDENTITY_MISSING:'+key);
 if(!Number.isInteger(identity.snapshot_sequence)||identity.snapshot_sequence<1)throw Error('SNAPSHOT_SEQUENCE_INVALID');
 const now=Date.parse(checkedAt),until=Date.parse(validUntil);if(!Number.isFinite(now)||!Number.isFinite(until)||until<=now||until>now+60000)throw Error('RECEIPT_TTL_INVALID');
 const sortedEvidence=new Map();for(const row of evidenceRows){if(!symbols.includes(row.symbol)||sortedEvidence.has(row.symbol))throw Error('EVIDENCE_ROW_SET_INVALID');sortedEvidence.set(row.symbol,row);}
 const receipt={...identity,contract:'mother-pool-shared-water-acceptance-v1',contract_version:'1.1.0',scope_definition_version:'full-priority-fixed-membership-v1',scope:'full_priority_pool',checked_at:checkedAt,valid_until:validUntil,requested_symbols:symbols,requested_symbols_sha256:hash(Buffer.from(JSON.stringify(symbols))),requested_count:symbols.length,unique_count:symbols.length,snapshot_symbols:members,snapshot_symbols_sha256:hash(Buffer.from(JSON.stringify(members))),snapshot_bytes_sha256:hash(snapshotBytes),priority_not_in_snapshot:symbols.filter(s=>!members.includes(s)),snapshot_not_in_priority:members.filter(s=>!symbols.includes(s)),water_available_threshold:0.95,rows:[]};
 const verify=createVerifier({resolve,nowMs:()=>now});
 for(const symbol of symbols){
  const input=sortedEvidence.get(symbol);
  if(!input){receipt.rows.push({symbol,trade_date:identity.trade_date,source_status:'UNKNOWN',reason_codes:['EVIDENCE_NOT_CAPTURED']});continue;}
  const row=structuredClone(input);const age=now-Date.parse(row.last_trade_at);
  row.source_status=Number.isFinite(age)&&age>=0&&age<=120000?'FRESH':'NO_NEW_TRADE';
  const proof=verify(row,receipt);
  if(!proof.verified){row.source_status='UNKNOWN';row.reason_codes=proof.failed_checks;}else row.reason_codes=[];
  receipt.rows.push(row);
 }
 receipt.fresh_count=receipt.rows.filter(r=>r.source_status==='FRESH').length;
 receipt.no_new_trade_count=receipt.rows.filter(r=>r.source_status==='NO_NEW_TRADE').length;
 receipt.unknown_count=receipt.rows.filter(r=>r.source_status==='UNKNOWN').length;
 receipt.unavailable_count=0;receipt.water_available_count=receipt.fresh_count+receipt.no_new_trade_count;
 receipt.water_available_coverage=receipt.water_available_count/symbols.length;
 const evidenceTimes=receipt.rows.filter(r=>['FRESH','NO_NEW_TRADE'].includes(r.source_status)).map(r=>Date.parse(r.evidence_asof));
 // No fabricated as-of: an entirely unverified receipt stays null and blocked.
 receipt.source_asof=evidenceTimes.length?new Date(Math.min(...evidenceTimes)).toISOString():null;
 receipt.failed_checks=receipt.water_available_count>=Math.ceil(symbols.length*0.95)?[]:['WATER_AVAILABILITY_BELOW_095'];
 receipt.status=receipt.failed_checks.length?'BLOCKED':'PASS';receipt.first_blocker=receipt.failed_checks[0]||null;
 receipt.water_gate_pass=receipt.status==='PASS';receipt.strategy3_scan_ready=false;receipt.formal_entry_authorization=false;
 receipt.rows_sha256=hash(Buffer.from(JSON.stringify(receipt.rows)));
 return receipt;
}
module.exports={build,canonicalSymbols};
