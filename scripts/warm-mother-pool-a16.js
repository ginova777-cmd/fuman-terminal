'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const {fetchHistory}=require('../lib/fetch-mother-pool-historical-minutes');
const {selectSessions}=require('../lib/mother-pool-historical-sessions');
const {isTwseTradingDay}=require('./twse-trading-day');
const {build}=require('../lib/mother-pool-a16-baseline');
const {verify}=require('../lib/verify-mother-pool-a16');
const {hash,read,atomic,readSide,client}=require('../lib/mother-pool-a16-io');
const arg=n=>process.argv.find(x=>x.startsWith('--'+n+'='))?.slice(n.length+3);
const root=path.join(__dirname,'..'),runtime=process.env.FUMAN_RUNTIME_DIR||'C:/fuman-runtime';
const scheduled=process.argv.includes('--scheduled'),apply=process.argv.includes('--apply');
const local=()=>new Date(Date.now()+28800000).toISOString();
function guard(){const r=spawnSync(process.execPath,[path.join(__dirname,'supabase-incident-guard.js'),'check','--class=writer','--action=mother-pool-a16'],{encoding:'utf8',windowsHide:true});if(r.status!==0)throw Error('SUPABASE_INCIDENT_BLOCKED');}
async function main(){
 if(!apply)throw Error('APPLY_REQUIRED');
 const universe=read(arg('universe')),date=universe.trade_date;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||universe.canonical_run_id!==`fugle_daytrade_source:${date.replaceAll('-','')}:canonical`||!Array.isArray(universe.symbols)||!universe.symbols.length||universe.symbols.some(s=>!/^\d{4}$/.test(s))||new Set(universe.symbols).size!==universe.symbols.length)throw Error('UNIVERSE_INVALID');
 if(scheduled&&(local().slice(0,10)!==date||local().slice(11,16)<'06:00'||local().slice(11,16)>='09:00'))throw Error('OUTSIDE_NATURAL_PREOPEN');
 const day=await isTwseTradingDay(new Date(date+'T12:00:00+08:00'),{stateDir:path.join(runtime,'state'),ignoreOverrides:true});
 if(day.isTradingDay!==true||day.error||!['cache','twse'].includes(day.source))throw Error('TARGET_NOT_VERIFIED_TRADING_DAY');
 guard();
 const dir=path.join(runtime,'data','mother-pool-a16',date),mode=scheduled?'scheduled':'acceptance_probe';fs.mkdirSync(dir,{recursive:true});
 const lock=path.join(dir,'warmup.lock');let lockFd;
 try{lockFd=fs.openSync(lock,'wx');fs.writeFileSync(lockFd,JSON.stringify({pid:process.pid,started_at:new Date().toISOString()}));}catch{throw Error('A16_WARMUP_LOCKED');}
 try {
  const planFile=path.join(dir,'session-plan.json');
  if(!fs.existsSync(planFile)){const p=spawnSync(process.execPath,['--use-system-ca',path.join(__dirname,'prepare-mother-pool-historical-sessions.js'),'--trade-date='+date,'--out='+planFile],{encoding:'utf8',windowsHide:true,timeout:60000});if(p.status!==0)throw Error('CALENDAR_PLAN_FAILED');}
  const planRaw=fs.readFileSync(planFile,'utf8'),plan=JSON.parse(planRaw),sha=bytes=>require('node:crypto').createHash('sha256').update(bytes).digest('hex');
  if(plan.status!=='SESSION_DATES_VERIFIED'||plan.trade_date!==date||!plan.sources?.length)throw Error('CALENDAR_PLAN_INVALID');
  for(const s of plan.sources)if(sha(fs.readFileSync(s.file))!==s.sha256)throw Error('CALENDAR_SOURCE_CHANGED');
  const selected=await selectSessions({tradeDate:date,resolveDay:async d=>plan.checks.find(c=>c.date===new Date(d.getTime()+28800000).toISOString().slice(0,10))});
  if(selected.status!=='SESSION_DATES_VERIFIED'||JSON.stringify(selected.session_dates)!==JSON.stringify(plan.session_dates))throw Error('CALENDAR_PLAN_MISMATCH');
  const calendar={plan_file:planFile,sha256:sha(planRaw),checked_at:plan.checked_at,sources:plan.sources};
  const universeHash=hash(universe),generation=`a16-${date}-${mode}-${universeHash.slice(0,16)}`,rows=[];
  const receiptDir=path.join(dir,generation),summaryFile=path.join(dir,scheduled?'writer-summary.json':generation+'-summary.json');
  const apiKey=fs.readFileSync(path.join(runtime,'secrets','fugle-api-key.txt'),'utf8').trim(),db=client(runtime);
  function summary(){const failed=rows.filter(r=>r.source_ready!==true||r.db_readback_ok!==true||r.verifier_passed!==true);return {contract:'mother_pool_a16_writer_summary_v1',trade_date:date,canonical_run_id:universe.canonical_run_id,generation,mode,universe_sha256:universeHash,requested_symbols:universe.symbols,requested_count:universe.symbols.length,attempted_count:rows.length,rows,rows_sha256:hash(rows),status:rows.length===universe.symbols.length&&!failed.length?'complete':'blocked',complete:rows.length===universe.symbols.length&&!failed.length,failed_checks:[...(rows.length<universe.symbols.length?['WARMUP_PENDING']:[]),...new Set(failed.map(r=>r.first_blocker||'A16_SOURCE_NOT_READY'))],first_blocker:failed[0]?.first_blocker|| (rows.length<universe.symbols.length?'WARMUP_PENDING':null),formal_candidate_allowed:false,publish_allowed:false,updated_at:new Date().toISOString()};}
  for(const symbol of universe.symbols){
   if(scheduled&&(local().slice(0,10)!==date||local().slice(11,16)>='09:00'))break;
   guard();const file=path.join(runtime,'data','mother-pool-historical-minutes',date,symbol+'.json');let history;
   try{const cached=read(file);if(cached.calendar?.sha256===calendar.sha256&&cached.symbol===symbol&&cached.trade_date===date&&cached.result?.status==='HISTORY_FETCHED')history=cached;}catch{}
   if(!history){
    const result=await fetchHistory({symbol,tradeDate:date,sessionDates:plan.session_dates,apiKey});
    // Raw response is the evidence. Avoid storing a duplicate expanded copy of
    // all OHLCV bars: every reader revalidates the raw response through adapt().
    if(result.normalized){const {rows:expanded,...metadata}=result.normalized;result.normalized=metadata;}
    history={contract:'mother_pool_historical_minute_fetch_evidence_v1',symbol,trade_date:date,requested_sessions:plan.session_dates,calendar_verified:true,calendar,result,production_written:false,natural_intraday_acceptance:false,complete:false};atomic(file,history);
    await new Promise(resolve=>setTimeout(resolve,2000));
   }
   const sideJournals=readSide(runtime,symbol,plan.session_dates),input={symbol,tradeDate:date,canonicalRunId:universe.canonical_run_id,asOf:new Date().toISOString(),history,sideJournals};
   const receipt=build(input),verifier=verify(receipt,input);let dbResult={db_readback_ok:false,anon_readback_ok:false,written_count:0,readback_count:0},failure=null;
   if(verifier.verification_passed)try{dbResult=await db.writeReadback(receipt,generation);}catch(e){failure=e.message;}
   const entry={symbol,source_ready:receipt.complete,verifier_passed:verifier.verification_passed,requested_count:receipt.requested_count,...dbResult,first_blocker:failure||verifier.failed_checks[0]||receipt.first_blocker};rows.push(entry);
   atomic(path.join(receiptDir,symbol+'.json'),{input_reference:{history_file:file,side_journal_dates:Object.keys(sideJournals)},receipt,verifier,db:dbResult,generation,mode,complete:receipt.complete&&verifier.complete&&dbResult.db_readback_ok});
   atomic(summaryFile,summary());console.log(JSON.stringify({symbol,attempted:rows.length,total:universe.symbols.length,db_readback_ok:dbResult.db_readback_ok,first_blocker:entry.first_blocker}));
   if(failure||[401,403,429].includes(history.result?.http_status))break;
  }
  const final=summary();atomic(summaryFile,final);console.log(JSON.stringify({status:final.status,complete:final.complete,attempted_count:rows.length,summary:summaryFile}));
  process.exitCode=final.complete?0:2;
 }finally{fs.closeSync(lockFd);fs.unlinkSync(lock);}
}
main().catch(e=>{console.error(JSON.stringify({status:'blocked',complete:false,error:e.message}));process.exitCode=1;});
