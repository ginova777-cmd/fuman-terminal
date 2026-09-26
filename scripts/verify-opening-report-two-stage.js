"use strict";
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const stages=require('../lib/opening-report-stage-contract');
const {contentHash}=require('../lib/opening-report-delivery-contract');
const {readSnapshot}=require('../lib/supabase-snapshots');
const runtime=process.env.FUMAN_RUNTIME_DIR||'C:/fuman-runtime';
const historical=process.argv.includes('--historical');
const ifReady=process.argv.includes('--if-ready');
const date=process.argv.find(x=>x.startsWith('--date='))?.slice(7)||new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('invalid_trade_date');
const day=date.replace(/-/g,''),read=f=>{try{return JSON.parse(fs.readFileSync(f,'utf8').replace(/^\uFEFF/,''));}catch{return null;}};
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const outputFile=path.join(runtime,'data','opening-report-stages',`morning-two-stage-receipt-${day}.json`);
const lockFile=outputFile+'.lock';
let lockOwned=false;
function alive(pid){try{process.kill(Number(pid),0);return true;}catch(e){return e.code!=='ESRCH';}}
function acquire(){
  fs.mkdirSync(path.dirname(outputFile),{recursive:true});
  try{fs.writeFileSync(lockFile,JSON.stringify({pid:process.pid,started_at:new Date().toISOString()}),{flag:'wx'});lockOwned=true;return true;}
  catch(e){if(e.code!=='EEXIST')throw e;const owner=read(lockFile);if(owner?.pid&&!alive(owner.pid)){fs.unlinkSync(lockFile);return acquire();}return false;}
}
function save(result){
  fs.mkdirSync(path.dirname(outputFile),{recursive:true});
  if(fs.existsSync(outputFile)){
    const history=path.join(path.dirname(outputFile),'history');fs.mkdirSync(history,{recursive:true});
    fs.copyFileSync(outputFile,path.join(history,`two-stage-${day}-${Date.now()}-${crypto.randomUUID()}.json`));
  }
  const temp=outputFile+'.'+process.pid+'.tmp';fs.writeFileSync(temp,JSON.stringify(result,null,2)+'\n');fs.renameSync(temp,outputFile);
  console.log(JSON.stringify({...result,receipt_path:outputFile},null,2));process.exitCode=result.exitCode;
}
function inputs(){return Object.fromEntries(Object.keys(stages.STAGES).map(id=>{const dir=stages.directory(runtime,id);return [id,{final:read(path.join(dir,`opening-report-0830-final-receipt-${day}.json`)),wrapper:read(path.join(dir,`opening-report-0830-wrapper-receipt-${day}.json`))}];}));}
async function verifyStage(id){
  const dir=stages.directory(runtime,id),checks=[];
  const final=read(path.join(dir,`opening-report-0830-final-receipt-${day}.json`));
  const source=read(path.join(dir,`opening-report-0830-overseas-leaders-${day}.json`));
  let preflight=null;try{preflight=require('../lib/opening-frozen-preflight-recovery').resolvePreflight(dir,date);}catch{}
  const handoff=read(path.join(dir,'scan-receipts',`opening-report-0830-mother-pool-handoff-ack-${day}.json`));
  const persistence=read(path.join(dir,'scan-receipts',`opening-report-0830-mother-pool-persistence-ack-${day}.json`));
  const rendered=read(path.join(dir,'rendered',day,'opening-report-rendered.json'));
  const line=read(path.join(dir,`line-push-receipt-${day}.json`));
  const canonical=read(path.join(dir,`opening-report-morning-contract-verifier-${day}.json`));
  const wrapper=read(path.join(dir,`opening-report-0830-wrapper-receipt-${day}.json`));
  const run=final?.run_id,hash=final&&contentHash(final.priority_observation_mode,final.display_top3||[],final.night_futures);
  const add=(name,ok)=>checks.push({name,ok:ok===true});
  add('source',source?.ok===true&&stages.verifyStageIdentity(source,date,id).length===0&&source.run_id===run&&preflight?.ok===true&&preflight.run_id===run&&preflight.date===date);
  add('runner_identity',final?.stage===id&&final.date===date&&final.overseas_sources_ok===true&&final.mother_pool_bridge_ok===true&&final.delivery_content_hash===hash);
  add('handoff',handoff?.contract==='opening-report-0830-mother-pool-handoff-ack-v2'&&handoff.complete===true&&handoff.db_readback_ok===true&&handoff.report_run_id===run&&handoff.trade_date===date&&handoff.missing_fields?.length===0);
  add('persistence',persistence?.contract==='opening-report-0830-mother-pool-persistence-ack-v1'&&persistence.complete===true&&persistence.db_readback_ok===true&&persistence.report_run_id===run&&persistence.trade_date===date&&persistence.required_writer_refreshes>=2&&persistence.writer_refreshes_observed>=2&&persistence.missing_fields?.length===0);
  const renderedRows=rendered?.results||[];
  const shotsValid=renderedRows.every(row=>{try{return row.screenshot_sha256===sha(fs.readFileSync(row.screenshot));}catch{return false;}});
  add('rendered',rendered?.complete===true&&rendered.diagnostic===false&&rendered.trade_date===date&&rendered.run_id===run&&rendered.delivery_content_hash===hash&&rendered.full_content_hash_ok===true&&rendered.base_url==='https://fuman-terminal.vercel.app'&&['desktop','mobile-portrait','mobile-landscape','scorecard88'].every(surface=>renderedRows.some(row=>row.surface===surface&&row.ok===true&&row.run_id===run&&row.hash===hash))&&shotsValid);
  const db=await readSnapshot('opening_report_0830_terminal_briefing_'+id,{tradeDate:date,allowLatestFallback:false,timeoutMs:5000,maxAttempts:2}).catch(()=>null);
  const p=db?.payload;
  add('stage_db_readback',p?.ok===true&&p.run_id===run&&p.date===date&&p.stage===id&&p.delivery_content_hash===hash&&require('util').isDeepStrictEqual(p.display_top3,final?.display_top3)&&require('util').isDeepStrictEqual(p.night_futures,final?.night_futures));
  const dataComplete=checks.every(x=>x.ok);
  // Historical closure verifies the existing canonical decision at its real timestamp;
  // it must not renew quota evidence or pretend a previous day is current delivery.
  const canonicalMatches=require('../lib/opening-report-receipt-authority').deliveryReceiptMatches(canonical,date,id,run);
  const deliveryAt=historical&&canonicalMatches?Date.parse(canonical.checked_at):Date.now();
  const deliveryDate=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(Number.isFinite(deliveryAt)?deliveryAt:0));
  add('notification_policy',(!historical||(canonicalMatches&&deliveryDate===date&&deliveryAt<=Date.now()))&&require('../lib/opening-report-line-policy').notificationAccepted(line,run,hash,date,deliveryAt));
  add('canonical_receipt',require('../lib/opening-report-receipt-authority').deliveryReceiptMatches(canonical,date,id,run));
  add('final_receipt',final?.complete===true&&final.status==='complete'&&final.exitCode===0&&wrapper?.complete===true&&wrapper.run_id===run&&wrapper.exitCode===0);
  const paused=require('../lib/opening-report-line-policy').paused(line,run,hash,date);
  return {stage:id,run_id:run||null,data_complete:dataComplete,complete:checks.every(x=>x.ok),completion_scope:paused?'tri_surface':'stage_delivery',notification_status:paused?'paused_by_user':line?.line_push_ok===true?'delivered':line?.quota_exception?'quota_exhausted_not_delivered':'failed',checks,source_count:source?.valid_leaders||0,received_symbols:handoff?.received_symbols||0,delivery:{ok:line?.line_push_ok===true,delivered:line?.line_push_ok===true,quota_exception:line?.quota_exception||null,delivered_count:line?.delivered_count||0,target_count:line?.target_count||0,error:line?.line_error_detail||null},receipt_directory:dir};
}
(async()=>{
  if(!acquire()){console.log(JSON.stringify({status:'waiting',complete:false,reason_code:'aggregate_verifier_active',lock:lockFile}));process.exitCode=2;return;}
  const before=inputs();
  if(ifReady){
    const state=require('../lib/opening-report-aggregate-readiness').readiness(date,before,alive);
    if(!state.ready){save({contract:stages.CONTRACT,trade_date:date,checked_at:new Date().toISOString(),status:state.status,complete:false,data_complete:false,exitCode:state.status==='blocked'?1:0,stages:state.stages,blocking_reasons:state.stages.filter(r=>r.status==='blocked').map(r=>r.stage+':'+r.reason),waiting_for:state.stages.filter(r=>r.status==='waiting').map(r=>r.stage),verification_mode:'readiness_only',new_source_fetch:false,new_notification_sent:false});return;}
  }
  const results=[];for(const id of Object.keys(stages.STAGES))results.push(await verifyStage(id));
  if(JSON.stringify(before)!==JSON.stringify(inputs())){save({contract:stages.CONTRACT,trade_date:date,checked_at:new Date().toISOString(),status:'blocked',complete:false,data_complete:false,exitCode:1,blocking_reasons:['stage_evidence_changed_during_verification'],stages:results});return;}
  const complete=results.every(row=>row.complete),dataComplete=results.every(row=>row.data_complete);
  const result={contract:stages.CONTRACT,trade_date:date,checked_at:new Date().toISOString(),verification_mode:historical?'historical_existing_evidence':'current',new_source_fetch:false,new_notification_sent:false,status:complete?'complete':'blocked',complete,data_complete:dataComplete,exitCode:complete?0:1,stages:results,blocking_reasons:results.flatMap(row=>row.checks.filter(x=>!x.ok).map(x=>row.stage+':'+x.name))};
  result.completion_scope=results.some(r=>r.completion_scope==='tri_surface')?'tri_surface':'stage_delivery';
  result.notification_status=results.every(r=>r.notification_status==='paused_by_user')?'paused_by_user':results.every(r=>r.delivery.delivered)?'delivered':'not_fully_delivered';
  result.line_delivered=results.every(r=>r.delivery.delivered);
  save(result);
})().catch(error=>{if(lockOwned)save({contract:stages.CONTRACT,trade_date:date,checked_at:new Date().toISOString(),status:'blocked',complete:false,data_complete:false,exitCode:1,blocking_reasons:['aggregate_error:'+error.message]});else{console.error(error.message);process.exitCode=1;}}).finally(()=>{if(lockOwned&&read(lockFile)?.pid===process.pid)fs.unlinkSync(lockFile);});
