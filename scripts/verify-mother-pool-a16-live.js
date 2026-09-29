'use strict';
const path=require('node:path'),{spawnSync}=require('node:child_process');
const {read,hash,readSide,compact,client,atomic}=require('../lib/mother-pool-a16-io');
const {verify}=require('../lib/verify-mother-pool-a16');
const arg=n=>process.argv.find(x=>x.startsWith('--'+n+'='))?.slice(n.length+3);
(async()=>{
 const runtime=process.env.FUMAN_RUNTIME_DIR||'C:/fuman-runtime',summary=read(arg('summary')),out=arg('out');
 const g=spawnSync(process.execPath,[path.join(__dirname,'supabase-incident-guard.js'),'check','--class=guard','--action=a16-live-verifier'],{encoding:'utf8',windowsHide:true});if(g.status!==0)throw Error('SUPABASE_INCIDENT_BLOCKED');
 const failures=[],results=[],db=client(runtime),date=summary.trade_date,run=`fugle_daytrade_source:${date.replaceAll('-','')}:canonical`;
 if(summary.contract!=='mother_pool_a16_writer_summary_v1'||summary.canonical_run_id!==run||hash(summary.rows)!==summary.rows_sha256)failures.push('SUMMARY_INVALID');
 if(summary.requested_count!==summary.requested_symbols.length||summary.attempted_count!==summary.requested_count||summary.rows.length!==summary.requested_count||new Set(summary.rows.map(x=>x.symbol)).size!==summary.requested_count||summary.rows.some(x=>!summary.requested_symbols.includes(x.symbol)))failures.push('SCOPE_COUNT_MISMATCH');
 for(const entry of summary.rows){
  const file=path.join(runtime,'data','mother-pool-a16',date,summary.generation,entry.symbol+'.json');
  try{
   const artifact=read(file),history=read(artifact.input_reference.history_file),sideJournals=readSide(runtime,entry.symbol,history.requested_sessions);
   const verified=verify(artifact.receipt,{history,sideJournals,symbol:entry.symbol,tradeDate:date,canonicalRunId:run,asOf:artifact.receipt.calculated_at});
   const rows=await db.readback({trade_date:date,generation:summary.generation,symbol:entry.symbol});
   const wanted=hash(compact(artifact.receipt));
   const same=rows.length===1&&rows[0].canonical_run_id===run&&rows[0].payload_sha256===wanted&&hash(rows[0].payload)===wanted;
   if(!verified.verification_passed||!same)failures.push(entry.symbol+':'+(!same?'ANON_DIFFERENCE':'INDEPENDENT_VERIFIER_FAILED'));
   results.push({symbol:entry.symbol,verifier_passed:verified.verification_passed,anon_readback_ok:same,source_ready:verified.source_ready,first_blocker:artifact.receipt.first_blocker,row_count:rows[0]?.payload?.rows?.length||0});
  }catch(e){failures.push(entry.symbol+':'+e.message);}
 }
 const wiring=failures.length===0,sourceReady=results.length>0&&results.every(x=>x.source_ready),complete=wiring&&sourceReady;
 const receipt={contract:'mother_pool_a16_closed_loop_receipt_v1',trade_date:date,canonical_run_id:run,generation:summary.generation,mode:summary.mode,scope:'A16_ONLY',checked_at:new Date().toISOString(),wiring_verified:wiring,source_ready:sourceReady,status:complete?'complete':'blocked',complete,exit_code:complete?0:2,requested_count:summary.requested_count,readback_count:results.length,results,failed_checks:[...failures,...results.filter(x=>!x.source_ready).map(x=>x.symbol+':'+x.first_blocker)],first_blocker:failures[0]||results.find(x=>!x.source_ready)?.first_blocker||null,formal_candidate_allowed:false,publish_allowed:false};
 if(out)atomic(out,receipt);console.log(JSON.stringify(receipt));process.exitCode=complete?0:2;
})().catch(e=>{console.error(JSON.stringify({status:'blocked',complete:false,error:e.message}));process.exitCode=1;});
