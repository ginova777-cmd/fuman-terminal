'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const {runBatch}=require('../lib/mother-pool-history-batch');
const arg=n=>process.argv.find(x=>x.startsWith('--'+n+'='))?.slice(n.length+3);
(async()=>{
 const input=JSON.parse(fs.readFileSync(arg('snapshot'),'utf8')),snapshot=input.authoritative_candidate||input;
 const plan=path.resolve(arg('session-plan'));
 const planHash=crypto.createHash('sha256').update(fs.readFileSync(plan)).digest('hex');
 const previous=arg('resume')?JSON.parse(fs.readFileSync(arg('resume'),'utf8')):null;
 if(previous&&(previous.trade_date!==snapshot.trade_date||previous.mother_pool_run_id!==snapshot.mother_pool_run_id||previous.snapshot_sequence!==snapshot.snapshot_sequence||previous.requested!==snapshot.symbols.length||!Array.isArray(previous.rows)))throw Error('RESUME_SNAPSHOT_MISMATCH');
 const cached=new Map((previous?.rows||[]).filter(r=>['HISTORY_FETCHED','HISTORY_REUSED'].includes(r.status)).map(r=>[r.symbol,r]));
 const asOf=new Date().toISOString();
 const root=path.resolve(__dirname,'../outputs/history-supply-'+crypto.randomUUID());
 const result=await runBatch({snapshot,asOf,maxRequests:Number(arg('max-requests')),retryInvalidCache:true,readCached:async symbol=>{
  const record=cached.get(symbol);if(!record)return null;
  const raw=fs.readFileSync(record.file);
  if(crypto.createHash('sha256').update(raw).digest('hex')!==record.sha256)throw Error('CACHE_HASH_MISMATCH');
  const artifact=JSON.parse(raw);
  if(artifact.calendar?.sha256!==planHash)throw Error('CACHE_CALENDAR_MISMATCH');
  require('../lib/mother-pool-history-input').selectHistory(artifact,{symbol,tradeDate:snapshot.trade_date,asOf,minute:'09:22'});
  return record;
 },fetchSymbol:async symbol=>{
  await new Promise(resolve=>setTimeout(resolve,1000));
  const file=path.join(root,snapshot.trade_date,symbol+'.json');
  const child=spawnSync(process.execPath,[path.join(__dirname,'fetch-mother-pool-historical-minutes.js'),
   '--symbol='+symbol,'--trade-date='+snapshot.trade_date,'--session-plan='+plan,'--out='+file],{encoding:'utf8',timeout:20000,windowsHide:true});
  if(!fs.existsSync(file))return {status:'DATA_GAP',reason:'HISTORY_FETCH_OR_PERSIST_FAILED',exit_code:child.status};
  const artifact=JSON.parse(fs.readFileSync(file,'utf8'));
  return {status:artifact.result.status,reason:artifact.result.reason,http_status:artifact.result.http_status,
   file,sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),rows:artifact.result.normalized?.rows.length||0,
   missing_sessions:artifact.missing_sessions,exit_code:child.status};
 }});
 fs.mkdirSync(root,{recursive:true});
 const receipt=path.join(root,'receipt.json');
 fs.writeFileSync(receipt,JSON.stringify({...result,production_written:false,isolated:true},null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({requested:result.requested,attempted:result.attempted,fetched:result.fetched,reused:result.reused,first_blocker:result.first_blocker,receipt,complete:false}));
})().catch(()=>{console.error('ISOLATED_HISTORY_SUPPLY_FAILED');process.exitCode=1;});
