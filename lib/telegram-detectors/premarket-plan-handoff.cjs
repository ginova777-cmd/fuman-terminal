'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {validate,digest}=require('./premarket-plan-contract.cjs');
function publish({plan,runtimeRoot,now}){
 const context={tradeDate:plan.trade_date,now};
 const v=validate(plan,context);if(!v.complete)throw Error('PLAN_HANDOFF_REJECTED:'+v.failed_checks.join(','));
 const dir=path.join(runtimeRoot,'data/telegram-detectors',plan.trade_date),file=path.join(dir,'premarket-plan.json');
 fs.mkdirSync(dir,{recursive:true});
 const temp=file+'.'+crypto.randomUUID()+'.tmp';
 let created=false;
 try{
  fs.writeFileSync(temp,JSON.stringify(plan,null,2),{flag:'wx'});
  // Atomic create-if-absent: no reader sees a partial plan and later rounds
  // cannot overwrite the direction already frozen for this session.
  try{fs.linkSync(temp,file);created=true;}catch(e){if(e.code!=='EEXIST')throw e;}
 }finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
 const readback=JSON.parse(fs.readFileSync(file,'utf8'));
 if(!validate(readback,context).complete)throw Error('PLAN_HANDOFF_EXISTING_INVALID');
 if(created&&digest(readback)!==digest(plan))throw Error('PLAN_HANDOFF_READBACK_MISMATCH');
 return {status:'complete',scope:'intraday_observation_handoff',created,existing_freeze_preserved:!created,path:file,run_id:readback.run_id,plan_sha256:digest(readback),rows_sha256:readback.rows_sha256,notifications_sent:0,order_allowed:false};
}
module.exports={publish};
