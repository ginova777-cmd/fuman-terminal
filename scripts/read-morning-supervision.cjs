'use strict';
// Read-only adapter: emits decisions, never sends or acknowledges a notification.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const stages=require('../lib/opening-report-stage-contract');
const supervision=require('../lib/opening-report-supervision');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function inspect(runtime,date,acknowledged={}) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('INVALID_DATE');
  const day=date.replace(/-/g,''),artifacts=[],issues=[];
  function read(file){
    try { const bytes=fs.readFileSync(file);artifacts.push({path:file,sha256:sha(bytes)});return JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,'')); }
    catch(error){artifacts.push({path:file,sha256:null});issues.push({path:file,reason:error.code==='ENOENT'?'MISSING':'UNREADABLE'});return null;}
  }
  const evidence={};
  for(const stage of ['us_0820','asia_0850']){
    const dir=stages.directory(runtime,stage);
    evidence[stage]={
      final:read(path.join(dir,`opening-report-0830-final-receipt-${day}.json`)),
      content:read(path.join(dir,`morning-content-verification-${day}.json`)),
      wrapper:read(path.join(dir,`opening-report-0830-wrapper-receipt-${day}.json`)),
      canonical:read(path.join(dir,`opening-report-morning-contract-verifier-${day}.json`))
    };
  }
  const changed=artifacts.filter(a=>{try{return sha(fs.readFileSync(a.path))!==a.sha256;}catch{return a.sha256!==null;}});
  const rows=Object.entries(evidence).map(([stage,data])=>supervision.stageResult(date,stage,data));
  // Isolation and historical evidence must never become live completion notices.
  const eligible=Object.fromEntries(Object.entries(evidence).filter(([,e])=>e.wrapper?.mode==='production'&&e.wrapper.execution_mode==='scheduled'&&e.wrapper.recovery===false));
  return {contract:'morning-supervision-readonly-v1',trade_date:date,checked_at:new Date().toISOString(),
    status:changed.length?'INPUT_CHANGED':issues.length?'DATA_GAP':'READ_COMPLETE',
    stages:rows,artifacts,issues,changed_inputs:changed,
    events:changed.length?[]:supervision.notifications(date,eligible,acknowledged),
    notifications_sent:0,natural_ledger_updated:false};
}
if(require.main===module){
  try{
    const arg=name=>process.argv.find(v=>v.startsWith('--'+name+'='))?.slice(name.length+3);
    const runtime=arg('runtime'),date=arg('date');
    if(!runtime||!date)throw Error('EXPLICIT_RUNTIME_AND_DATE_REQUIRED');
    const ack=arg('ack')?JSON.parse(fs.readFileSync(arg('ack'),'utf8').replace(/^\uFEFF/,'')):{};
    const result=inspect(path.resolve(runtime),date,ack);console.log(JSON.stringify(result,null,2));
    process.exitCode=result.status==='READ_COMPLETE'?0:2;
  }catch(error){console.error(error.message);process.exitCode=1;}
}
module.exports={inspect};
