'use strict';
const {createHash}=require('node:crypto');
const {datesFromCalendar}=require('./mother-pool-daily-volume-baseline');
const binding=require('../data/contracts/a04-historical-source-binding-v1.json');
const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
const hash=v=>createHash('sha256').update(JSON.stringify(stable(v))).digest('hex');
const date=t=>Number.isFinite(Date.parse(t))?new Date(Date.parse(t)+28800000).toISOString().slice(0,10):null;
const natural=x=>x&&x.is_synthetic===false&&x.replay===false&&x.look_ahead===false&&x.synthetic!==true;
const nonempty=x=>typeof x==='string'&&x.trim().length>0;
// trustedBinding is configuration supplied by the caller, NEVER read from evidence.
// The shipped binding is UNBOUND; fixture bindings do not authorize a real source.
function inspect({symbol,tradeDate,raw,proof,readAt,asOf},trustedBinding=binding){
 const errors=[],need=(ok,code)=>{if(!ok)errors.push(code);};let dates=[];
 need(trustedBinding?.contract==='a04_historical_source_binding_v1'&&trustedBinding.status==='APPROVED'
  &&trustedBinding.source==='strategy4_daily_ohlcv_view'&&nonempty(trustedBinding.source_contract)
  &&/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(trustedBinding.source_version||'')&&nonempty(trustedBinding.approval_reference)
  &&Array.isArray(trustedBinding.row_sources)&&trustedBinding.row_sources.length>0,'HISTORICAL_SOURCE_BINDING_REQUIRED');
 try{dates=datesFromCalendar(raw?.calendar,tradeDate,15);}catch{errors.push('HISTORICAL_CALENDAR_INVALID');}
 need(raw?.symbol===symbol&&raw?.trade_date===tradeDate&&raw?.source==='strategy4_daily_ohlcv_view','HISTORICAL_SOURCE_IDENTITY');
 const rows=Array.isArray(raw?.rows)?raw.rows:[];
 if(trustedBinding?.source_contract==='a04_fugle_snapshot_original_v1'){
  for(const row of rows){try{
   const verified=require('./a04-retained-provenance.cjs').normalize(row,process.env.FUMAN_RUNTIME_DIR||'C:/fuman-runtime',readAt);
   need(hash(verified)===hash(row),'HISTORICAL_ORIGINAL_RECOMPUTE');
  }catch{errors.push('HISTORICAL_ORIGINAL_UNVERIFIED');}}
 }
 need(dates.length===15&&rows.length===15&&dates.every(d=>rows.filter(r=>r.symbol===symbol&&r.trade_date===d).length===1),'HISTORICAL_SOURCE_SET_INCOMPLETE');
 const now=Date.parse(asOf),read=Date.parse(readAt),seen=Date.parse(proof?.available_at);
 if(raw?.calendar?.contract==='a04_verified_calendar_v1'){
  need(Array.isArray(raw.calendar.checks)&&raw.calendar.checks.length<=40&&raw.calendar.checks.every(c=>{
   if(!c||typeof c!=='object')return false;
   const fetched=Date.parse(c.fetched_at),available=Date.parse(c.available_at);
   return Number.isFinite(fetched)&&fetched<=read&&now-fetched<=7*86400000&&Number.isFinite(available)
    &&available<=read&&/^[a-f0-9]{64}$/.test(c.calendar_source_sha256||'');
  }),'HISTORICAL_CALENDAR_SOURCE_EXPIRED_OR_INVALID');
 }
 need(date(asOf)===tradeDate&&date(readAt)===tradeDate&&Number.isFinite(now)&&Number.isFinite(read)&&read<=now&&now-read<=30*60*1000,'HISTORY_READ_TIME_INVALID');
 need(proof?.contract==='a04_historical_source_readback_v1'&&proof.source===raw?.source&&proof.symbol===symbol
  &&proof.trade_date===tradeDate&&proof.source_contract===trustedBinding?.source_contract
  &&proof.source_version===trustedBinding?.source_version&&nonempty(proof.source_run_id)
  &&proof.binding_sha256===hash(trustedBinding),'HISTORICAL_SOURCE_PROOF_IDENTITY');
 need(natural(proof)&&rows.every(natural),'HISTORICAL_SOURCE_NON_NATURAL');
 need(Number.isFinite(seen)&&seen<=read&&proof?.read_at===readAt,'HISTORICAL_AVAILABLE_AT_INVALID');
 need(rows.every(r=>Array.isArray(trustedBinding?.row_sources)&&trustedBinding.row_sources.includes(r.source)
  &&r.trade_date<tradeDate&&Number.isFinite(Date.parse(r.updated_at))&&Number.isFinite(Date.parse(r.available_at))
  &&date(r.available_at)>=r.trade_date&&Date.parse(r.updated_at)<=Date.parse(r.available_at)
  &&Date.parse(r.available_at)<=seen),'HISTORICAL_ROW_SOURCE_OR_TIME_INVALID');
 // Preserve and compare the complete independently returned set, not a success bit.
 need(proof?.requested_count===15&&proof.written_count===15&&proof.readback_count===15
  &&Array.isArray(proof.readback_rows)&&proof.readback_rows.length===15
  &&hash(proof.readback_rows)===hash(rows)&&proof.rows_sha256===hash(rows)
  &&proof.calendar_sha256===hash(raw?.calendar??null),'HISTORICAL_SOURCE_HASH_OR_READBACK');
 return {ok:errors.length===0,failed_checks:[...new Set(errors)],dates,source_hash:hash(raw??null),proof_hash:hash(proof??null),binding_sha256:hash(trustedBinding)};
}
module.exports={inspect,hash,binding};
