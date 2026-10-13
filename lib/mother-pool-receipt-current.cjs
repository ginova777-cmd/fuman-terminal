'use strict';
const fs = require('node:fs');
const {createHash} = require('node:crypto');
const {verifyHashEvidence} = require('./mother-pool-receipt-binding');
function preopenNotDue(receipt, now=Date.now()) {
  try {
    const s=receipt.session_evidence;
    if(receipt.realtime_status!=='NOT_DUE'||s?.phase!=='PREOPEN'||s.calendar_verified!==true) return false;
    const calendar={date:receipt.trade_date,isTradingDay:true,source:s.calendar_source,reason:s.calendar_reason,calendar_evidence:s.calendar_evidence};
    const assess=require('./mother-pool-receipt-assessment.cjs').assess;
    const original=assess(receipt,{calendar});
    const current=assess({...receipt,checked_at:new Date(now).toISOString()},{calendar});
    return original.integrity_status==='PASS' && original.realtime_status==='NOT_DUE'
      && original.session_evidence.phase==='PREOPEN' && current.session_evidence.phase==='PREOPEN'
      && JSON.stringify(original.session_evidence)===JSON.stringify(s);
  } catch { return false; }
}
function isCurrent(receipt, snapshotRaw, tradeDate, {now=Date.now(),expectedSnapshotHash=null,notBefore=null,allowPreopen=false}={}) {
  try {
    if (receipt?.ok !== true || receipt.verifier_ok !== true || receipt.receipt_written !== true
      || !Array.isArray(receipt.failed_checks) || receipt.failed_checks.length !== 0 || receipt.first_blocker !== null
      || typeof receipt.verification_run_id !== 'string' || !receipt.verification_run_id.trim()
      || receipt.snapshot_binding?.receipt_generation_verified !== true) return false;
    const currentHash = createHash('sha256').update(snapshotRaw).digest('hex');
    if (expectedSnapshotHash !== null && currentHash !== expectedSnapshotHash.toLowerCase()) return false;
    if (notBefore !== null && (!Number.isFinite(Date.parse(notBefore)) || Date.parse(receipt.checked_at) < Date.parse(notBefore))) return false;
    const publication = receipt?.publication;
    if (publication?.status !== 'POST_ACKNOWLEDGED' || publication.verification_run_id !== receipt.verification_run_id
      || publication.generation !== receipt.snapshot_binding?.generation
      || publication.snapshot_sha256 !== receipt.snapshot_binding?.snapshot_sha256
      || !Number.isFinite(Date.parse(publication.acknowledged_at))
      || Date.parse(publication.acknowledged_at) > now
      || Date.parse(publication.acknowledged_at) < Date.parse(receipt.checked_at)) return false;
    const checkedAt=Date.parse(receipt?.checked_at);
    // Reuse only a recent assessment; immutable membership does not prove live freshness.
    if (!Number.isFinite(now) || !Number.isFinite(checkedAt) || checkedAt>now || now-checkedAt>120000) return false;
    if (receipt.integrity_status!=='PASS' || (receipt.realtime_status!=='PASS' && !(allowPreopen && preopenNotDue(receipt,now)))) return false;
    const s = JSON.parse(snapshotRaw), b = receipt.snapshot_binding;
    if (receipt.closed_loop_ok !== true || receipt.complete === false || receipt.trade_date !== tradeDate || !b) return false;
    if (s.complete !== true || s.trade_date !== tradeDate || s.canonical_run_id !== `fugle_daytrade_source:${tradeDate.replaceAll('-','')}:canonical`) return false;
    for (const k of ['trade_date','canonical_run_id','mother_pool_run_id','generation','snapshot_sequence']) if (s[k] == null || s[k] !== b[k]) return false;
    if (receipt.canonical_run_id !== s.canonical_run_id || b.snapshot_sha256 !== createHash('sha256').update(snapshotRaw).digest('hex')) return false;
    return verifyHashEvidence(b).ok === true;
  } catch { return false; }
}
if (require.main === module) {
  try { process.exitCode = isCurrent(JSON.parse(fs.readFileSync(process.argv[2],'utf8').replace(/^\uFEFF/,'')), fs.readFileSync(process.argv[3],'utf8'), process.argv[4], {expectedSnapshotHash:process.argv[5] || null,notBefore:process.argv[6] && process.argv[6]!=='--preopen-terminal' ? process.argv[6] : null,allowPreopen:process.argv.includes('--preopen-terminal')}) ? 0 : 1; }
  catch { process.exitCode = 1; }
}
module.exports = {isCurrent,preopenNotDue};

// Candle persistence provenance: ACK time is not generation time. A later
// assessment binds unchanged ACKed content to the exact published snapshot.
function hashBytes(value){return createHash('sha256').update(value).digest('hex');}
function atomicJson(file,value){const path=require('node:path');fs.mkdirSync(path.dirname(file),{recursive:true});const t=file+'.'+process.pid+'.tmp';fs.writeFileSync(t,JSON.stringify(value));fs.renameSync(t,file);}
function candleEntries(rows){const delta=require('./daytrade-candle-delta');const m=new Map();for(const row of rows){const k=row.symbol+'|'+row.candle_time,h=delta.fingerprint(row);if(m.has(k)&&m.get(k)!==h)throw Error('CONFLICTING_KEY');m.set(k,h);}return [...m].sort(([a],[b])=>a.localeCompare(b));}
function makeCandleProof({rows,evidence,tradeDate,target,snapshotRaw,roundId,syncId,pending,deferred,now}){
 const p={contract:'candle_saved_content_handoff_v1',status:'BLOCKED',trade_date:tradeDate,target,wrapper_run_id:roundId,sync_id:syncId,
   assessed_at:new Date(now).toISOString(),pending,deferred,reason:null};
 try{
  if(pending!==0||deferred!==0)throw Error('UNCOMMITTED_CANDLES');
  const entries=candleEntries(rows);if(!entries.length)throw Error('EMPTY_CANDLES');
  const ackDayFormatter=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'});
  p.entries=entries.map(([key,hash])=>{const ack=evidence[key];
   if(!ack||ack.status!=='HTTP_ACKNOWLEDGED'||ack.hash!==hash||ack.trade_date!==tradeDate||ack.target!==target||!ack.sync_id||!ack.wrapper_run_id
     ||!Number.isFinite(Date.parse(ack.acknowledged_at))||Date.parse(ack.acknowledged_at)>now
     ||ackDayFormatter.format(new Date(ack.acknowledged_at))!==tradeDate)throw Error('ACK_MISSING_OR_MISMATCH');
   return {key,hash,ack};});
  p.content_sha256=hashBytes(JSON.stringify(entries));p.row_count=entries.length;
  const s=JSON.parse(snapshotRaw);
  if(s.complete!==true||s.trade_date!==tradeDate||!s.generation||!s.mother_pool_run_id||!s.snapshot_sequence
   ||s.canonical_run_id!==`fugle_daytrade_source:${tradeDate.replaceAll('-','')}:canonical`)throw Error('SNAPSHOT_NOT_BOUND');
  p.snapshot={};for(const k of ['trade_date','canonical_run_id','mother_pool_run_id','generation','snapshot_sequence'])p.snapshot[k]=s[k];
  p.snapshot.sha256=hashBytes(snapshotRaw);p.status='SAVED_CONTENT_BOUND';
 }catch(e){p.reason=e.message;}
 return p;
}
function verifyCandleProof({receipt,proofRaw,snapshotRaw,rows,tradeDate,target,roundId,now=Date.now()}){
 try{
  if(receipt?.final_content_readback_verified!==true||receipt?.ok!==true||receipt.mode!=='apply'||receipt.trade_date!==tradeDate||receipt.candle_pending_after!==0||receipt.candle_deferred!==0
    ||receipt.candle_backfill_complete!==true)throw Error('SYNC_NOT_COMPLETE');
  if(!Number.isFinite(Date.parse(receipt.completed_at))||Date.parse(receipt.completed_at)>now||now-Date.parse(receipt.completed_at)>120000)throw Error('SYNC_STALE');
  if(hashBytes(proofRaw)!==receipt.candle_save_proof?.sha256)throw Error('PROOF_HASH');
  const p=JSON.parse(proofRaw);
  if(p.contract!=='candle_saved_content_handoff_v1'||p.status!=='SAVED_CONTENT_BOUND'||p.wrapper_run_id!==receipt.wrapper_run_id
   ||p.sync_id!==receipt.sync_id||(roundId&&p.wrapper_run_id!==roundId))throw Error('RUN_OR_STATUS');
  if(!Number.isFinite(Date.parse(p.assessed_at))||Date.parse(p.assessed_at)>Date.parse(receipt.completed_at))throw Error('ASSESSMENT_TIME');
  const evidence=Object.fromEntries(p.entries.map(e=>[e.key,e.ack]));
  const expected=makeCandleProof({rows,evidence,tradeDate,target,snapshotRaw,roundId:p.wrapper_run_id,syncId:p.sync_id,pending:p.pending,deferred:p.deferred,now:Date.parse(p.assessed_at)});
  if(expected.status!=='SAVED_CONTENT_BOUND'||JSON.stringify(expected)!==JSON.stringify(p))throw Error(expected.reason||'CONTENT_OR_GENERATION');
  return {ok:true,status:p.status,row_count:p.row_count,content_sha256:p.content_sha256,snapshot:p.snapshot,ack_count:p.entries.length};
 }catch(e){return {ok:false,reason:e.message};}
}
module.exports={...module.exports,hashBytes,atomicJson,makeCandleProof,verifyCandleProof};
