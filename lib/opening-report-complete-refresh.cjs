'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),{isDeepStrictEqual}=require('util');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
// A saved pool readback is not a successful Writer round. Both are required.
function terminal(runtime,event,{after=0,asOf=Date.now(),readFile=fs.readFileSync}={}){
 try{
  if(!Number.isFinite(after)||!Number.isFinite(asOf)||!/^\d{4}-\d{2}-\d{2}$/.test(event.trade_date)||!event.writer_run_id||!event.generation_id)return null;
  const dir=path.join(runtime,'data','writer-terminals',event.trade_date);
  const file=path.join(dir,hash(String(event.writer_run_id))+'.json');
  const bytes=readFile(file),t=JSON.parse(bytes),id=t.receipt?.identity;
  const calculated=require('./mother-pool-preopen-module-evidence.cjs').terminalEvidence(t.input);
  const end=Date.parse(t.receipt?.completed_at),refreshTime=Date.parse(event.completed_at);
  if(t.contract!=='mother_pool_writer_terminal_v11'||!isDeepStrictEqual(calculated,t.receipt)||id?.trade_date!==event.trade_date||id.writer_run_id!==event.writer_run_id||id.generation_id!==event.generation_id||!Number.isFinite(end)||!Number.isFinite(refreshTime)||end<refreshTime||refreshTime<=after||end>asOf)return null;
  for(const kind of ['verifier','refresh']){
   const item=t.input[kind],digest=item?.payload?.raw_sha256;
   if(!/^[a-f0-9]{64}$/.test(digest))return null;
   const rawBytes=readFile(path.join(dir,digest+'.raw'));
   if(hash(rawBytes)!==digest)return null;
   const raw=JSON.parse(rawBytes);
   if(raw.ok!==true||raw.trade_date!==event.trade_date)return null;
   if(kind==='verifier'&&(raw.verifier_ok!==true||raw.closed_loop_ok!==true||raw.publication?.status!=='POST_ACKNOWLEDGED'||raw.canonical_run_id!==id.canonical_run_id||raw.publication.acknowledged_at!==item.completed_at))return null;
   if(kind==='refresh'&&(raw.wrapper_run_id!==t.wrapper_run_id||raw.completed_at!==item.completed_at))return null;
  }
  return {record:t,path:file,sha256:hash(bytes)};
 }catch{return null;}
}
function completed(runtime,events,report,{asOf=Date.now(),verifyReadback,readFile=fs.readFileSync}={}){
 const verify=verifyReadback||require('./opening-report-refresh-proof.cjs').verified;
 const writers=new Set(),generations=new Set(),result=[];
 for(const e of events){
  if(writers.has(e.writer_run_id)||generations.has(e.generation_id)||!verify(runtime,e,report.report_run_id,readFile))continue;
  const proof=terminal(runtime,e,{after:Date.parse(report.checked_at),asOf,readFile});
  if(!proof)continue;
  writers.add(e.writer_run_id);generations.add(e.generation_id);result.push({event:e,terminal:proof});
 }
 return result;
}
module.exports={terminal,completed};
