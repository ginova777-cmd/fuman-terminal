'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {fetchHistory}=require('../lib/fetch-mother-pool-historical-minutes');
const arg=name=>process.argv.find(x=>x.startsWith('--'+name+'='))?.slice(name.length+3);
(async()=>{
 const out=arg('out'),symbol=arg('symbol'),tradeDate=arg('trade-date'),sessions=arg('sessions'),planFile=arg('session-plan');
 if(!out||fs.existsSync(out)||(!sessions&&!planFile)||(sessions&&planFile))throw Error('NEW_OUTPUT_AND_SESSIONS_REQUIRED');
 let sessionDates=sessions?.split(','),calendar=null;
 if(planFile){
  const raw=fs.readFileSync(planFile,'utf8'),plan=JSON.parse(raw);
  if(plan.status!=='SESSION_DATES_VERIFIED'||plan.trade_date!==tradeDate||!Array.isArray(plan.checks)||!Array.isArray(plan.sources)||!plan.sources.length)throw Error('CALENDAR_PLAN_INVALID');
  for(const source of plan.sources)if(!source.file||crypto.createHash('sha256').update(fs.readFileSync(source.file)).digest('hex')!==source.sha256)throw Error('CALENDAR_SOURCE_CHANGED');
  const verified=await require('../lib/mother-pool-historical-sessions').selectSessions({tradeDate,resolveDay:async d=>plan.checks.find(x=>x.date===new Date(d.getTime()+28800000).toISOString().slice(0,10))});
  if(verified.status!=='SESSION_DATES_VERIFIED'||JSON.stringify(verified.session_dates)!==JSON.stringify(plan.session_dates))throw Error('CALENDAR_PLAN_MISMATCH');
  sessionDates=verified.session_dates;calendar={plan_file:path.resolve(planFile),sha256:crypto.createHash('sha256').update(raw).digest('hex'),checked_at:plan.checked_at,sources:plan.sources};
 }
 const apiKey=process.env.FUGLE_API_KEY||process.env.FUMAN_FUGLE_API_KEY||fs.readFileSync('C:/fuman-runtime/secrets/fugle-api-key.txt','utf8').trim();
 const result=await fetchHistory({symbol,tradeDate,sessionDates,apiKey});
 const counts=Object.fromEntries(sessionDates.map(date=>[date,0]));
 for(const row of result.normalized?.rows||[])counts[row.trade_date]++;
 const artifact={contract:'mother_pool_historical_minute_fetch_evidence_v1',symbol,trade_date:tradeDate,
  requested_sessions:sessionDates,calendar_verified:!!calendar,calendar,session_row_counts:counts,missing_sessions:sessionDates.filter(d=>counts[d]===0),production_written:false,
  natural_intraday_acceptance:false,complete:false,result};
 fs.mkdirSync(path.dirname(path.resolve(out)),{recursive:true});
 fs.writeFileSync(out,JSON.stringify(artifact,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({symbol,status:result.status,reason:result.reason,http_status:result.http_status,
  rows:result.normalized?.rows.length??0,fetched_at:result.fetched_at,raw_sha256:result.normalized?.raw_sha256,
  calendar_verified:!!calendar,session_row_counts:counts,missing_sessions:artifact.missing_sessions,complete:false,out}));
 process.exitCode=result.status==='HISTORY_FETCHED'?0:1;
})().catch(()=>{console.error('HISTORICAL_FETCH_FAILED: inspect configuration and local file access; credentials suppressed');process.exitCode=1;});
