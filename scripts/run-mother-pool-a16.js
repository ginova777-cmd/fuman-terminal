'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {build}=require('../lib/mother-pool-a16-baseline');
const {verify}=require('../lib/verify-mother-pool-a16');
const arg=n=>process.argv.find(x=>x.startsWith('--'+n+'='))?.slice(n.length+3);
(async()=>{
 const file=arg('history'),out=arg('out'),runtime=arg('runtime')||'C:/fuman-runtime';
 if(!file||!out||fs.existsSync(out))throw Error('NEW_OUTPUT_AND_HISTORY_REQUIRED');
 const history=JSON.parse(fs.readFileSync(file,'utf8')),planRaw=fs.readFileSync(history.calendar.plan_file,'utf8'),plan=JSON.parse(planRaw);
 if(crypto.createHash('sha256').update(planRaw).digest('hex')!==history.calendar.sha256)throw Error('CALENDAR_PLAN_HASH_MISMATCH');
 for(const s of plan.sources)if(crypto.createHash('sha256').update(fs.readFileSync(s.file)).digest('hex')!==s.sha256)throw Error('CALENDAR_SOURCE_HASH_MISMATCH');
 const sessions=await require('../lib/mother-pool-historical-sessions').selectSessions({tradeDate:history.trade_date,resolveDay:async d=>plan.checks.find(x=>x.date===new Date(d.getTime()+28800000).toISOString().slice(0,10))});
 if(sessions.status!=='SESSION_DATES_VERIFIED'||JSON.stringify(sessions.session_dates)!==JSON.stringify(history.requested_sessions))throw Error('CALENDAR_SESSIONS_MISMATCH');
 const sideJournals={};
 for(const date of sessions.session_dates){const files=['provider-trade-journal','provider-side-journal'].map(dir=>path.join(runtime,'data',dir,date,history.symbol+'.jsonl'));if(files.every(f=>fs.existsSync(f)))sideJournals[date]=Object.fromEntries(files.map((f,i)=>[i?'side':'trades',fs.readFileSync(f,'utf8').split(/\r?\n/).filter(x=>x.trim()).map(x=>JSON.parse(x))]));}
 const input={symbol:history.symbol,tradeDate:history.trade_date,canonicalRunId:`fugle_daytrade_source:${history.trade_date.replaceAll('-','')}:canonical`,asOf:new Date().toISOString(),history,sideJournals};
 const receipt=build(input),verifier=verify(receipt,input);
 fs.mkdirSync(path.dirname(path.resolve(out)),{recursive:true});
 fs.writeFileSync(out,JSON.stringify({receipt,verifier,production_written:false,db_readback_ok:false,natural_intraday_acceptance:false},null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({symbol:receipt.symbol,trade_date:receipt.trade_date,status:receipt.status,complete:receipt.complete,ready_count:receipt.ready_count,data_gap_count:receipt.data_gap_count,failed_checks:receipt.failed_checks,verifier,out}));
 process.exitCode=verifier.verification_passed?0:1;
})().catch(e=>{console.error(e.message);process.exitCode=1;});
