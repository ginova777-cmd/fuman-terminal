'use strict';
const fs=require('node:fs'),path=require('node:path');
const {spawn}=require('node:child_process');
const {read,atomic,hash}=require('./mother-pool-a16-io');
const canonical=d=>`fugle_daytrade_source:${d.replaceAll('-','')}:canonical`;
function summaryFile(runtime,date){return path.join(runtime,'data','mother-pool-a16',date,'writer-summary.json');}
function readReferences({runtime,tradeDate,symbols}){
 let summary;try{summary=read(summaryFile(runtime,tradeDate));}catch{}
 const valid=summary?.contract==='mother_pool_a16_writer_summary_v1'&&summary.trade_date===tradeDate&&summary.canonical_run_id===canonical(tradeDate)&&summary.mode==='scheduled'&&Array.isArray(summary.rows)&&summary.rows_sha256===hash(summary.rows)&&typeof summary.generation==='string'&&summary.generation.length>0;
 const index=new Map(valid?summary.rows.map(r=>[r.symbol,r]):[]);
 return symbols.map(s=>{const symbol=typeof s==='string'?s:s.symbol,r=index.get(symbol);const verified=r?.db_readback_ok===true&&r?.anon_readback_ok===true&&r?.verifier_passed===true&&r?.written_count===r?.readback_count;
  return {contract:'mother_pool_a16_writer_reference_v1',symbol,trade_date:tradeDate,canonical_run_id:canonical(tradeDate),generation:valid?summary.generation:null,status:verified&&r?.source_ready===true?'READY':verified?'INSUFFICIENT_SAMPLE':'DATA_GAP',data_gap:!(verified&&r?.source_ready===true),db_readback_ok:!!verified,source_ready:verified&&r.source_ready===true,reason:!r?'A16_WARMUP_NOT_AVAILABLE':!verified?'A16_READBACK_OR_VERIFIER_FAILED':r.first_blocker||null,payload_sha256:r?.payload_sha256||null,requested_count:r?.requested_count||0,readback_count:r?.readback_count||0,formal_candidate_allowed:false,publish_allowed:false};
 });
}
function ensureWarmup({runtime,root,tradeDate,symbols,apply,now=new Date()}){
 const t=new Date(now.getTime()+28800000).toISOString(),minutes=Number(t.slice(11,13))*60+Number(t.slice(14,16));
 if(!apply||t.slice(0,10)!==tradeDate||minutes<360||minutes>=540)return {started:false,reason:'OUTSIDE_PREOPEN_OR_DRY_RUN'};
 const codes=[...new Set(symbols.map(s=>typeof s==='string'?s:s.symbol).filter(s=>/^\d{4}$/.test(s)))].sort();
 const dir=path.join(runtime,'data','mother-pool-a16',tradeDate),universeFile=path.join(dir,'requested-symbols.json');
 const universe={trade_date:tradeDate,canonical_run_id:canonical(tradeDate),symbols:codes,scope:'writer_active_symbols'};
 atomic(universeFile,universe);
 try{const done=read(summaryFile(runtime,tradeDate));if(done.universe_sha256===hash(universe)&&done.attempted_count===codes.length)return {started:false,reason:'DAILY_WARMUP_ATTEMPTED'};}catch{}
 let previousLaunch=null;
 const launchFile=path.join(dir,'launch.json');try{const x=read(launchFile);previousLaunch=x;if(Date.now()-Date.parse(x.started_at)<180000)return {started:false,reason:'LAUNCH_COOLDOWN'};if(x.pid){try{process.kill(x.pid,0);return {started:false,reason:'WARMUP_RUNNING'};}catch{}}if(x.attempts>=2)return {started:false,reason:'DAILY_RETRY_LIMIT'};}catch{}
 fs.mkdirSync(dir,{recursive:true});const log=fs.openSync(path.join(dir,'warmup.log'),'a');
 const child=spawn(process.execPath,['--use-system-ca',path.join(root,'scripts','warm-mother-pool-a16.js'),'--apply','--scheduled','--universe='+universeFile],{cwd:root,env:{...process.env,FUMAN_RUNTIME_DIR:runtime},windowsHide:true,detached:true,stdio:['ignore',log,log]});
 child.on('error',()=>{});child.unref();fs.closeSync(log);atomic(launchFile,{pid:child.pid||null,attempts:(previousLaunch?.attempts||0)+1,started_at:new Date().toISOString()});return {started:true,pid:child.pid||null};
}
function readMinute({runtime,tradeDate,symbol,minute,types}){
 const ref=readReferences({runtime,tradeDate,symbols:[symbol]})[0];
 if(!ref.db_readback_ok)return {status:'DATA_GAP',reason:ref.reason,rows:[],complete:false};
 try{
  const artifact=read(path.join(runtime,'data','mother-pool-a16',tradeDate,ref.generation,symbol+'.json'));
  const payload=require('./mother-pool-a16-io').compact(artifact.receipt);
  if(hash(payload)!==ref.payload_sha256)throw Error('A16_ARTIFACT_HASH_MISMATCH');
  const rows=payload.rows.filter(r=>r.minute===minute&&types.includes(r.baseline_type));
  return {contract:'mother_pool_a16_minute_reference_v1',trade_date:tradeDate,canonical_run_id:ref.canonical_run_id,generation:ref.generation,symbol,minute,rows,complete:rows.length===types.length&&rows.every(r=>r.status==='READY'),publish_allowed:false};
 }catch{return {status:'DATA_GAP',reason:'A16_VERIFIED_ARTIFACT_UNAVAILABLE',rows:[],complete:false};}
}
module.exports={readReferences,ensureWarmup,summaryFile,readMinute};
