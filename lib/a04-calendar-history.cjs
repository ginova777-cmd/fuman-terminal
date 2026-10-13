'use strict';
const {validateDecision}=require('./daytrade-calendar-publication.cjs');
const {verifyCalendarReadback}=require('./a04-calendar-readback.cjs');
const day=86400000;
const key=ms=>new Date(ms).toISOString().slice(0,10);
// Bounded, incremental history only. Future/today publication is a separate caller.
async function ensureHistory({tradeDate,cacheRows=[],readDays,resolveDay,writeRows,clock=Date.now,deadlineMs}) {
 const started=clock(),stats={db_reads:0,rows_read:0,db_write_batches:0,rows_written:0,cache_hits:0,db_hits:0,gap_resolutions:0,days_checked:0};
 const checks=[],dates=[],accepted=[],pending=[],cached=new Map(),remote=new Map();
 const base=Date.parse(tradeDate+'T00:00:00Z');
 const finish=(status,reason)=>({status,reason,trade_date:tradeDate,session_dates:status==='SESSION_DATES_VERIFIED'?[...dates].reverse():[],checks,complete:false,cache_rows:accepted,stats:{...stats,elapsed_ms:clock()-started}});
 const budget=()=>{if(!Number.isFinite(deadlineMs)||clock()>=deadlineMs)throw Error('CALENDAR_BUDGET_EXHAUSTED');};
 const insert=(map,r)=>{const k=r?.trade_date;if(map.has(k))throw Error('DUPLICATE_CALENDAR_DAY:'+k);map.set(k,r);};
 try {
  if(!Number.isFinite(base)||key(base)!==tradeDate||!Array.isArray(cacheRows)||cacheRows.length>40)throw Error('CALENDAR_REQUEST_INVALID');
  for(const r of cacheRows)insert(cached,r);
  for(let offset=1;offset<=40&&dates.length<15;offset++){
   budget();const date=key(base-offset*day);let row=cached.get(date),valid=false;
   try{verifyCalendarReadback(row,date,clock());valid=true;stats.cache_hits++;}catch{}
   if(!valid){
    if(!remote.has(date)){
     // Read only the minimum additional calendar days that could complete the set.
     let n=Math.min(15-dates.length,41-offset);
     for(let j=1;j<n;j++){
      const d=key(base-(offset+j)*day);
      try{verifyCalendarReadback(cached.get(d),d,clock());n=j;break;}catch{}
     }
     const from=key(base-(offset+n-1)*day);
     stats.db_reads++;const batch=await readDays(from,date,n);budget();
     if(!Array.isArray(batch)||batch.length>n)throw Error('CALENDAR_READ_BOUND');
     stats.rows_read+=batch.length;
     for(const r of batch){if(r?.market!=='TW'||r.trade_date<from||r.trade_date>date)throw Error('CALENDAR_READ_SCOPE');insert(remote,r);}
     for(let j=0;j<n;j++){const d=key(base-(offset+j)*day);if(!remote.has(d))remote.set(d,null);}
    }
    row=remote.get(date);
    try{verifyCalendarReadback(row,date,clock());valid=true;stats.db_hits++;}catch{}
   }
   if(!valid){
    if(deadlineMs-clock()<3000)throw Error('CALENDAR_BUDGET_SOURCE_RESERVE');
    stats.gap_resolutions++;const decision=await resolveDay(new Date(date+'T12:00:00+08:00'));budget();
    const acquired=clock(),hash=validateDecision(decision,date,acquired),at=new Date(acquired).toISOString();
    row={trade_date:date,market:'TW',is_open:decision.isTradingDay,session:'closed',updated_at:at,
     payload:{source:'daytrade-source-writer:twse-trading-day',checked_at:at,calendar_contract:'market-calendar-contract-v1',
      calendar_decision:decision,calendar_source_sha256:hash,calendar_publication_contract:'calendar-horizon-v1',override:false,
      historical_calendar_evidence:true,historical_publication_available_at:at,schedule_subject_to_official_revision:true}};
    verifyCalendarReadback(row,date,acquired);pending.push(row);
   }
   accepted.push(row);checks.push({date,isTradingDay:row.is_open,source:row.payload.calendar_decision.source,
    calendar_source_sha256:row.payload.calendar_source_sha256,
    fetched_at:row.payload.calendar_decision.calendar_evidence.fetched_at,
    available_at:row.payload.historical_publication_available_at||row.updated_at});stats.days_checked++;
   if(row.is_open)dates.push(date);
  }
  if(dates.length!==15)return finish('BLOCKED','HISTORICAL_SESSIONS_INSUFFICIENT_40_DAYS');
  budget();
  // No success cache or partial history publication on an incomplete set.
  if(pending.length){stats.db_write_batches=Math.ceil(pending.length/10);await writeRows(pending);stats.rows_written=pending.length;budget();}
  return finish('SESSION_DATES_VERIFIED',null);
 }catch(e){return finish('BLOCKED',e.message);}
}
module.exports={ensureHistory};
