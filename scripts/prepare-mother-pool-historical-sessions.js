'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {selectSessions}=require('../lib/mother-pool-historical-sessions');
const {isTwseTradingDay}=require('./twse-trading-day');
const arg=n=>process.argv.find(x=>x.startsWith('--'+n+'='))?.slice(n.length+3);
(async()=>{
 const out=arg('out'),tradeDate=arg('trade-date');
 if(!out||fs.existsSync(out))throw Error('NEW_OUTPUT_REQUIRED');
 const stateDir=path.join(path.dirname(path.resolve(out)),'historical-calendar-source');
 const result=await selectSessions({tradeDate,resolveDay:d=>isTwseTradingDay(d,{stateDir,ignoreOverrides:true})});
 const sources=[...new Set(result.checks.map(r=>r.date.slice(0,4)))].map(year=>{
  const file=path.join(stateDir,'twse-holiday-schedule-'+year+'.json');
  return fs.existsSync(file)?{file,sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}:{file,missing:true};
 });
 fs.mkdirSync(path.dirname(path.resolve(out)),{recursive:true});
 fs.writeFileSync(out,JSON.stringify({...result,checked_at:new Date().toISOString(),sources,production_written:false},null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({status:result.status,reason:result.reason,session_dates:result.session_dates,out,complete:false}));
 process.exitCode=result.status==='SESSION_DATES_VERIFIED'?0:1;
})().catch(()=>{console.error('HISTORICAL_SESSION_PREPARATION_FAILED');process.exitCode=1;});
