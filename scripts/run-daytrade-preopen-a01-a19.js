'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const runtime=process.env.FUMAN_RUNTIME_DIR||'C:\\fuman-runtime';
const root=path.resolve(__dirname,'..');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const taipeiDate=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const date=process.env.TRADE_DATE||taipeiDate();
const dryRun=process.argv.includes('--dry-run');
const preopenDir=path.join(runtime,'data','scan-receipts','preopen');
const completeMarker=path.join(preopenDir,`a01-a19-${date}.complete.json`);
if(fs.existsSync(completeMarker)){console.log(JSON.stringify({ok:true,complete:true,status:'already_complete',trade_date:date}));process.exit(0);}
fs.mkdirSync(preopenDir,{recursive:true});
let lock;
const lockPath=path.join(preopenDir,`a01-a19-${date}.lock`);
try{lock=fs.openSync(lockPath,'wx');fs.writeSync(lock,`${process.pid}\n`);}catch{
  let stale=false;
  try{const pid=Number(fs.readFileSync(lockPath,'utf8').trim());if(!pid) stale=true; else {try{process.kill(pid,0);}catch{stale=true;}}}catch{stale=true;}
  if(stale){try{fs.unlinkSync(lockPath);lock=fs.openSync(lockPath,'wx');fs.writeSync(lock,`${process.pid}\n`);}catch{}}
  if(!lock){console.log(JSON.stringify({ok:true,complete:false,status:'already_running',trade_date:date}));process.exit(0);}
}
const delta=read(path.join(runtime,'state','daytrade-mother-pool-delta.json'));
const snapshot=read(path.join(runtime,'state','daytrade-mother-pool-snapshot-latest.json'));
if(delta.trade_date!==date)throw Error(`TRADE_DATE_MISMATCH:${delta.trade_date}:${date}`);
const canonical=delta.canonical_run_id||delta.run_id||`fugle_daytrade_source:${date.replaceAll('-','')}:canonical`;
const snapshotRun=delta.mother_pool_run_id||snapshot.mother_pool_run_id||'';
const snapshotGeneration=snapshot.generation||snapshotRun;
const sequence=String(snapshot.snapshot_sequence||snapshot.sequence||'');
if(!snapshotRun||!snapshotGeneration||!/^\d+$/.test(sequence))throw Error('PREOPEN_SNAPSHOT_IDENTITY_MISSING');
const modules=Array.from({length:19},(_,i)=>`A${String(i+1).padStart(2,'0')}`);
const registry=read(path.join(root,'data','contracts','mother-pool-a01-b24-module-registry-v1.json'));
const args=[path.join(__dirname,'capture-daytrade-module-readbacks.js'),`--trade-date=${date}`,`--canonical=${canonical}`,`--writer-run-id=${delta.writer_run_id||''}`,`--writer-generation-id=${delta.generation_id||''}`,`--mother-pool-run-id=${snapshotRun}`,`--snapshot-generation=${snapshotGeneration}`,`--snapshot-sequence=${sequence}`,`--modules=${modules.filter(id=>registry.modules?.[id]).join(',')}`];
if(dryRun){console.log(JSON.stringify({ok:true,complete:false,status:'dry_run_validated',trade_date:date,canonical_run_id:canonical,writer_run_id:delta.writer_run_id,generation_id:delta.generation_id,mother_pool_run_id:snapshotRun,snapshot_generation:snapshotGeneration,snapshot_sequence:Number(sequence),modules,batched_modules:[modules.slice(0,5),modules.slice(5,10),modules.slice(10,15),modules.slice(15,19)]},null,2));process.exit(0);}
const output={contract:'daytrade_preopen_a01_a19_runner_v1',trade_date:date,canonical_run_id:canonical,writer_run_id:delta.writer_run_id||null,generation_id:delta.generation_id||null,mother_pool_run_id:snapshotRun,snapshot_generation:snapshotGeneration,snapshot_sequence:Number(sequence),modules,started_at:new Date().toISOString(),batches:[]};
for(let i=0;i<modules.length;i+=5){const batch=modules.slice(i,i+5).filter(id=>registry.modules?.[id]);if(!batch.length)continue;const batchArgs=args.map(x=>x.startsWith('--modules=')?`--modules=${batch.join(',')}`:x);const p=spawnSync(process.execPath,batchArgs,{cwd:root,encoding:'utf8',windowsHide:true,timeout:120000,env:{...process.env,FUMAN_RUNTIME_DIR:runtime}});output.batches.push({modules:batch,status:p.status,stdout:p.stdout||'',stderr:p.stderr||'',error:p.error?.message||null});if(p.status!==0)break;}
const verifier=spawnSync(process.execPath,[path.join(__dirname,'run-daytrade-module-verifiers.js')],{cwd:root,encoding:'utf8',windowsHide:true,timeout:120000,env:{...process.env,FUMAN_RUNTIME_DIR:runtime,TRADE_DATE:date}});
output.verifier={status:verifier.status,stdout:verifier.stdout||'',stderr:verifier.stderr||'',error:verifier.error?.message||null};output.complete=output.batches.length>0&&output.batches.every(x=>x.status===0)&&verifier.status===0;output.first_blocker=output.complete?null:(output.batches.find(x=>x.status!==0)?.error||'PREOPEN_A01_A19_VERIFIER_BLOCKED');output.finished_at=new Date().toISOString();
const outDir=preopenDir;fs.writeFileSync(path.join(outDir,`a01-a19-${date}.json`),JSON.stringify(output,null,2)+'\n');if(output.complete)fs.writeFileSync(completeMarker,JSON.stringify(output,null,2)+'\n');try{fs.closeSync(lock);fs.unlinkSync(path.join(preopenDir,`a01-a19-${date}.lock`));}catch{}console.log(JSON.stringify({ok:output.complete,complete:output.complete,first_blocker:output.first_blocker,batches:output.batches.map(x=>({modules:x.modules,status:x.status})),verifier_status:verifier.status},null,2));process.exitCode=output.complete?0:1;

