'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process'),{randomUUID}=require('node:crypto');
const {buildCloseout}=require('../lib/mother-pool-closeout-producer');
const {persistModuleRound}=require('../lib/persist-mother-pool-module-round');
const runtime=process.env.FUMAN_RUNTIME||process.env.FUMAN_RUNTIME_DIR||'C:/fuman-runtime';
const root=path.resolve(__dirname,'..');
function child(script,args=[]){const p=spawnSync(process.execPath,[path.join(__dirname,script),...args],{cwd:root,encoding:'utf8',windowsHide:true,timeout:120000,env:{...process.env,FUMAN_RUNTIME:runtime,FUMAN_RUNTIME_DIR:runtime}});if(p.status!==0)throw Error(script+':'+(p.stderr||p.stdout||p.error?.message||p.status).slice(-500));return JSON.parse(p.stdout);}
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
(async()=>{
 if(!process.argv.includes('--apply'))throw Error('CLOSEOUT_APPLY_REQUIRED');
 const now=new Date(),date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei'}).format(now);
 if(now.getTime()<Date.parse(date+'T13:30:00+08:00')){console.log(JSON.stringify({status:'pending',reason:'CLOSEOUT_NOT_DUE',complete:false}));process.exitCode=2;return;}
 const calendar=child('check-market-calendar-action.js',['--label=Mother Pool closeout']);
 if(calendar.tradingDay?.isTradingDay!==true||calendar.tradingDay?.date!==date){console.log(JSON.stringify({status:'skipped',reason:'NOT_CURRENT_TRADING_DAY',complete:false}));process.exitCode=3;return;}
 child('verify-release-root-authority.js',['--require-production-root']);
 child('supabase-incident-guard.js',['check','--class=guard','--action=mother-module-closeout']);
 const canonical=`fugle_daytrade_source:${date.replaceAll('-','')}:canonical`,dir=path.join(runtime,'data','scan-receipts','modules');
 fs.mkdirSync(dir,{recursive:true});
 const list=fs.readdirSync(dir).filter(f=>f.endsWith('.json')).map(f=>{try{return {file:path.join(dir,f),value:read(path.join(dir,f))};}catch{return null;}}).filter(x=>x?.value.module_id==='B01'&&x.value.trade_date===date&&x.value.canonical_run_id===canonical&&x.value.db_readback&&!x.value.rounds_verified).sort((a,b)=>Date.parse(b.value.observed_at)-Date.parse(a.value.observed_at));
 const picked=[];for(const r of list){if(picked.every(x=>x.value.writer_run_id!==r.value.writer_run_id&&x.value.generation_id!==r.value.generation_id&&x.value.snapshot_generation!==r.value.snapshot_generation))picked.push(r);if(picked.length===2)break;}
 if(picked.length<2){console.log(JSON.stringify({status:'pending',reason:'TWO_NATURAL_ROUNDS_REQUIRED',complete:false}));process.exitCode=2;return;}
 picked.reverse();const attempt=randomUUID(),last=picked[1].value;
 const previousInputs=fs.readdirSync(dir).filter(f=>f.startsWith('closeout-input-')&&f.endsWith('.json')).map(f=>read(path.join(dir,f))).filter(x=>x.type==='mother_pool_closeout_inputs_v1'&&x.trade_date===date&&x.canonical_run_id===canonical).sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at));
 const previous=previousInputs[0];
 if(previous&&previous.round1===picked[0].file&&previous.round2===picked[1].file){
  // Reverify the immutable closeout and original rounds; do not write another DB round.
  const verified=child('verify-mother-pool-closeout.js',['--closeout='+previous.closeout,'--round1='+previous.round1,'--round2='+previous.round2,'--natural-verification='+previous.natural_verification,'--out='+path.join(dir,'b18-reverified-'+date+'-'+attempt+'.json')]);
  console.log(JSON.stringify({...verified,scope:'B18_closeout',reused_existing_closeout:true,overall_complete:false}));return;
 }
 const verificationFile=path.join(dir,'closeout-natural-verification-'+attempt+'.json');
 child('verify-daytrade-module-receipt.js',['--module=B01','--round1='+picked[0].file,'--round2='+picked[1].file,'--out='+verificationFile]);
 const identity={trade_date:date,canonical_run_id:canonical,writer_run_id:'mother-pool-closeout:'+attempt,generation_id:'closeout:'+attempt,mother_pool_run_id:last.mother_pool_run_id,snapshot_generation:last.snapshot_generation,snapshot_sequence:last.snapshot_sequence};
 const input=await buildCloseout({identity,rounds:picked.map(x=>x.value),closeoutAt:new Date().toISOString()},{verifyRounds:async()=>read(verificationFile)});
 const evidenceDir=path.join(runtime,'data','module-write-sets');fs.mkdirSync(evidenceDir,{recursive:true});
 const url=fs.readFileSync(path.join(runtime,'secrets','supabase-url.txt'),'utf8').trim().replace(/\/+$/,'');
 const key=fs.readFileSync(path.join(runtime,'secrets','supabase-service-role-key.txt'),'utf8').trim();
 const saved=await persistModuleRound(input,{
  savePlan:async p=>fs.writeFileSync(path.join(evidenceDir,attempt+'-plan.json'),JSON.stringify(p),{flag:'wx'}),
  persist:async p=>{const r=await fetch(url+'/rest/v1/rpc/persist_daytrade_module_round_v2',{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(p),signal:AbortSignal.timeout(20000)});if(r.status!==200)throw Error('CLOSEOUT_RPC_HTTP_'+r.status);return r.json();},
  saveEvidence:async p=>fs.writeFileSync(path.join(evidenceDir,attempt+'.json'),JSON.stringify(p),{flag:'wx'})});
 const index=path.join(evidenceDir,attempt+'-index.json');fs.writeFileSync(index,JSON.stringify({modules:{B18:saved}}),{flag:'wx'});
 // Credentials remain in environment, never command arguments or receipts.
 process.env.SUPABASE_SERVICE_ROLE_KEY=key;process.env.SUPABASE_URL=url;
 const captured=child('capture-daytrade-module-readbacks.js',['--modules=B18','--write-set-index='+index,'--trade-date='+date,'--canonical='+canonical,'--writer-run-id='+identity.writer_run_id,'--writer-generation-id='+identity.generation_id,'--mother-pool-run-id='+identity.mother_pool_run_id,'--snapshot-generation='+identity.snapshot_generation,'--snapshot-sequence='+identity.snapshot_sequence]);
 const closeout=captured.results.find(r=>r.module_id==='B18');if(!closeout?.file)throw Error('CLOSEOUT_CAPTURE_MISSING');
 const out=path.join(dir,'b18-verified-'+date+'-'+attempt+'.json');
 const verified=child('verify-mother-pool-closeout.js',['--closeout='+closeout.file,'--round1='+picked[0].file,'--round2='+picked[1].file,'--natural-verification='+verificationFile,'--out='+out]);
 // Persist provenance paths so the ordinary total runner can independently reverify.
 fs.writeFileSync(path.join(dir,'closeout-input-'+attempt+'.json'),JSON.stringify({type:'mother_pool_closeout_inputs_v1',trade_date:date,canonical_run_id:canonical,closeout:closeout.file,round1:picked[0].file,round2:picked[1].file,natural_verification:verificationFile,created_at:new Date().toISOString()}),{flag:'wx'});
 console.log(JSON.stringify({...verified,scope:'B18_closeout',overall_complete:false}));
})().catch(e=>{console.error(JSON.stringify({status:'blocked',complete:false,first_blocker:e.message}));process.exitCode=1;});
