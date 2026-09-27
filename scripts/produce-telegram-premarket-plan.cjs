'use strict';
const fs=require('node:fs'),path=require('node:path');
const {build}=require('../lib/telegram-detectors/premarket-plan-producer.cjs');
const {digest}=require('../lib/telegram-detectors/premarket-plan-contract.cjs');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
function main(args=process.argv.slice(2)){
 const arg=name=>args.find(x=>x.startsWith('--'+name+'='))?.slice(name.length+3);
 for(const key of args.includes('--collect-runtime')?['output']:['static','trials','calendar','date','base-date','output'])if(!arg(key))throw Error('REQUIRED_ARGUMENT_'+key);
 const now=arg('as-of')||new Date().toISOString(),mode=arg('as-of')?'replay':'live';
 const collected=args.includes('--collect-runtime')?require('../lib/telegram-detectors/premarket-source-collector.cjs').collect({runtimeRoot:arg('runtime-root')||process.env.FUMAN_RUNTIME_DIR||'C:/fuman-runtime',now}):null;
 if(collected&&!collected.baseDate)throw Error('PREVIOUS_TRADING_DAY_NOT_PROVEN');
 const result=build(collected?{...collected,mode}:{snapshot:read(arg('static')),trialRows:read(arg('trials')),calendar:read(arg('calendar')),universe:arg('universe')?read(arg('universe')):null,tradeDate:arg('date'),baseDate:arg('base-date'),now,mode});
 const dir=path.resolve(arg('output'));fs.mkdirSync(dir,{recursive:true});
 // Attempt artifacts never overwrite the last accepted operational plan.
 const attempt=path.join(dir,result.plan.run_id);fs.mkdirSync(attempt);
 for(const [name,payload] of Object.entries({plan:result.plan,receipt:result.receipt,verification:result.verification,...(collected?{source_capture:collected}:{})})){const file=path.join(attempt,name+'.json');fs.writeFileSync(file,JSON.stringify(payload,null,2),{flag:'wx'});if(digest(read(file))!==digest(payload))throw Error('PLAN_ARTIFACT_READBACK_MISMATCH');}
 if(result.verification.complete&&mode==='live')throw Error('LIVE_PLAN_PUBLICATION_REQUIRES_REVIEWED_RULES');
 console.log(JSON.stringify({run_id:result.plan.run_id,status:result.receipt.status,complete:false,mode,row_count:result.plan.rows.length,output:attempt,failed_checks:result.receipt.failed_checks}));
 return result;
}
if(require.main===module){try{const r=main();process.exitCode=r.receipt.complete?0:2;}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={main};
