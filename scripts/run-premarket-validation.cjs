'use strict';
const fs=require('node:fs'),path=require('node:path');
const {runValidation}=require('../lib/telegram-detectors/premarket-validation-flow.cjs');
const {digest}=require('../lib/telegram-detectors/premarket-plan-contract.cjs');
const {calendarFromCache,readIntraday}=require('../lib/telegram-detectors/premarket-runtime-inputs.cjs');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const value=(args,key)=>args.find(x=>x.startsWith('--'+key+'='))?.slice(key.length+3);
function main(args=process.argv.slice(2)){
 const output=value(args,'output'),staticFile=value(args,'static'),tradeDate=value(args,'date'),baseDate=value(args,'base-date'),asOf=value(args,'as-of');
 if(!output||!staticFile)throw Error('EXPLICIT_STATIC_AND_OUTPUT_REQUIRED');
 const dir=path.resolve(output);
 if(/(?:^|[\\/])(?:fuman-runtime|prod81|fuman-terminal-production[^\\/]*)[\\/]/i.test(dir+path.sep))throw Error('VALIDATION_OUTPUT_MUST_NOT_BE_PRODUCTION');
 const trialFile=value(args,'trials'),calendarFile=value(args,'calendar'),intradayFile=value(args,'intraday');
 const runtimeRoot=value(args,'runtime-root')||process.env.FUMAN_RUNTIME_DIR||'C:/fuman-runtime';
 const quoteFile=path.join(runtimeRoot,'cache/intraday/fugle-daytrade-ws-quotes-v2.json');
 const effectiveTrialFile=trialFile||(fs.existsSync(quoteFile)?quoteFile:null);
 const trialSource=effectiveTrialFile?read(effectiveTrialFile):{},intraday=intradayFile?read(intradayFile):readIntraday({runtimeRoot,asOf});
 const calendar=calendarFile?read(calendarFile):calendarFromCache({runtimeRoot,tradeDate});
 const payload=runValidation({snapshot:read(staticFile),trialRows:Array.isArray(trialSource)?trialSource:trialSource.rows||trialSource.quotes||[],calendar,symbols:value(args,'symbols')?.split(','),tradeDate,baseDate,asOf,...Object.fromEntries(['groups','histories','quotes'].map(k=>[k,intraday[k]||{}]))});
 payload.intraday_source_proof=intraday.source_proof||{complete:false,reason:'EXPLICIT_VALIDATION_FILE'};
 payload.calendar_source=calendar;
 payload.input_files=[staticFile,effectiveTrialFile,calendarFile,intradayFile].filter(Boolean).map(file=>({path:path.resolve(file),sha256:require('node:crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex')}));
 fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,'validation.json');fs.writeFileSync(file,JSON.stringify(payload,null,2));
 if(digest(read(file))!==digest(payload))throw Error('VALIDATION_READBACK_MISMATCH');
 const receipt={scope:'premarket_engineering_validation',run_id:payload.run_id,mode:'validation',local_readback_ok:true,notifications_sent:0,formal_complete:false,tri_surface_status:'pending',artifact:file,artifact_sha256:digest(payload),counts:payload.coverage};
 fs.writeFileSync(path.join(dir,'engineering-receipt.json'),JSON.stringify(receipt,null,2));
 console.log(JSON.stringify(receipt));return {payload,receipt};
}
if(require.main===module){try{main();}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={main};
