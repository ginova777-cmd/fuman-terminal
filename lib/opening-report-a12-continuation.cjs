'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),{isDeepStrictEqual}=require('util');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const CONTRACT='opening-report-a12-continuation-v1';
// Reference existing immutable evidence; never duplicate the readback bodies.
function select(runtime,h,stage,asOf=Date.now()){
 if(!h||!['us_0820','asia_0850'].includes(stage))return null;
 const events=require('./opening-report-writer-refresh-evidence').readAfter(runtime,h.trade_date,Date.parse(h.checked_at),asOf);
 const selected=require('./opening-report-complete-refresh.cjs').completed(runtime,events,h,{asOf}).slice(0,2);
 if(selected.length!==2)return null;
 const handoffPath=path.join(runtime,'data/opening-report-stages',stage,'scan-receipts',`opening-report-0830-mother-pool-handoff-ack-${h.trade_date.replaceAll('-','')}.json`);
 const proof={contract:CONTRACT,runtime:path.resolve(runtime),stage,trade_date:h.trade_date,report_run_id:h.report_run_id,handoff_path:handoffPath,handoff_sha256:hash(fs.readFileSync(handoffPath)),rounds:selected.map(x=>({refresh_path:x.event.evidence_path,refresh_sha256:x.event.evidence_sha256,terminal_path:x.terminal.path,terminal_sha256:x.terminal.sha256}))};
 return verify(proof,h,stage,asOf)?proof:null;
}
function verify(proof,h,stage,asOf){
 try{
  if(proof?.contract!==CONTRACT||proof.stage!==stage||proof.trade_date!==h.trade_date||proof.report_run_id!==h.report_run_id||!Number.isFinite(asOf)||!Array.isArray(proof.rounds)||proof.rounds.length!==2)return null;
  const root=path.resolve(proof.runtime),date=h.trade_date;
  const expectedHandoff=path.join(root,'data/opening-report-stages',stage,'scan-receipts',`opening-report-0830-mother-pool-handoff-ack-${date.replaceAll('-','')}.json`);
  if(path.resolve(proof.handoff_path)!==expectedHandoff)return null;
  const hb=fs.readFileSync(expectedHandoff);if(hash(hb)!==proof.handoff_sha256||!isDeepStrictEqual(JSON.parse(hb),h))return null;
  const events=[];
  for(const r of proof.rounds){
   const dir=path.join(root,'state/opening-report-writer-refreshes',date),f=path.resolve(r.refresh_path);
   if(path.dirname(f)!==dir||! /^[a-f0-9]{64}\.json$/.test(path.basename(f)))return null;
   const bytes=fs.readFileSync(f);if(hash(bytes)!==r.refresh_sha256)return null;
   const event=JSON.parse(bytes);
   if(path.basename(f)!==hash(event.generation_id)+'.json'||event.trade_date!==date)return null;
   const terminal=require('./opening-report-complete-refresh.cjs').terminal(root,event,{after:Date.parse(h.checked_at),asOf});
   if(!terminal||path.resolve(r.terminal_path)!==path.resolve(terminal.path)||r.terminal_sha256!==terminal.sha256)return null;
   events.push({...event,evidence_path:f,evidence_sha256:r.refresh_sha256});
  }
  const complete=require('./opening-report-complete-refresh.cjs').completed(root,events,h,{asOf});
  if(complete.length!==2)return null;
  return {refresh_files:events.map(e=>({text:fs.readFileSync(e.evidence_path,'utf8'),expected_sha256:e.evidence_sha256})),writer_terminals:complete.map(c=>c.terminal.record)};
 }catch{return null;}
}
module.exports={select,verify,CONTRACT};
