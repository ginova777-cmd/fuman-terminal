"use strict";
const fs=require('fs'),path=require('path');
const lib=require('./cleanup-local-assets');
const RUNTIME='C:/fuman-runtime';
function read(p){return JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));}
function save(p,v){fs.mkdirSync(path.dirname(p),{recursive:true});const temp=p+'.'+process.pid+'.tmp';fs.writeFileSync(temp,JSON.stringify(v,null,2)+'\n',{flag:'wx'});fs.renameSync(temp,p);}
function date(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()).replaceAll('-','');}
async function run({apply=false,noStatus=false,maintenanceAuthorization=null}={}){
  if(apply&&noStatus)throw Error('apply_requires_persistent_receipt');
  if(apply){
    const cp=require('child_process'),root=path.resolve(__dirname,'..');
    const gate=cp.spawnSync(process.execPath,[path.join(root,'scripts/verify-release-root-authority.js'),'--require-production-root'],{encoding:'utf8',windowsHide:true});
    if(gate.status!==0)throw Error('release_root_drift');
    if(maintenanceAuthorization)require('./cleanup-maintenance-context').authorization(maintenanceAuthorization);
    else {const calendar=await require('./twse-trading-day').isTwseTradingDay(new Date(),{stateDir:path.join(RUNTIME,'state'),ignoreOverrides:true});if(calendar.error||calendar.source==='weekend_fallback'||!calendar.isTradingDay)throw Error('local_assets_non_trading_day_apply_rejected');}
  }
  const manifest=path.join(RUNTIME,lib.policy.manifest);
  const entries=fs.existsSync(manifest)?read(manifest):{contract:'cleanup-local-assets-manifest-v1',entries:[]};
  if(entries.contract!=='cleanup-local-assets-manifest-v1'||!Array.isArray(entries.entries))throw Error('local_assets_manifest_invalid');
  const receipt={contract:lib.policy.contract,runId:require('crypto').randomUUID(),checkedAt:new Date().toISOString(),applied:apply,ok:false,manifestPresent:fs.existsSync(manifest),categories:Object.keys(lib.policy.categories),candidates:[],processed:[],preserved:[],errors:[],protectedEvidence:[],inventory:[]};
  const journal=path.join(RUNTIME,'status/cleanup-local-assets-runs',receipt.runId+'.json');
  const progress=()=>{if(apply)save(journal,receipt);};
  // Only catalog sizes; absence of retirement evidence is an explicit preservation reason.
  for(const root of ['outputs','logs','tmp']){
    const p=path.join(RUNTIME,root);if(!fs.existsSync(p))continue;
    const all=lib.files(p);receipt.inventory.push({root:p,files:all.length,bytes:all.reduce((n,f)=>n+fs.statSync(f).size,0),reason:'unregistered_assets_preserved'});
  }
  const lock=path.join(RUNTIME,'locks/cleanup-local-assets.lock');let fd;
  if(apply){fs.mkdirSync(path.dirname(lock),{recursive:true});fd=fs.openSync(lock,'wx');fs.writeSync(fd,JSON.stringify({pid:process.pid,startedAt:receipt.checkedAt}));}
  try{
    progress();
    const root=path.resolve(__dirname,'..'),authority=read(path.join(root,'data/contracts/release_root_authority_v1.json'));
    for(const file of [path.join(RUNTIME,'logs/production-health.jsonl'),path.join(root,'data/contracts/cleanup_local_assets_v1.json')])if(fs.existsSync(file)){const b=fs.readFileSync(file);receipt.protectedEvidence.push({path:file,sha256:lib.hash(b),bytes:b.length,appendAllowed:path.basename(file)==='production-health.jsonl'});}
    const excluded=[manifest,...entries.entries.map(e=>e.evidenceFile).filter(Boolean),...lib.files(path.join(RUNTIME,"status")).filter(p=>/^(?:cleanup-local-assets-|runtime-retention-)/i.test(path.basename(p))||p.replaceAll("\\", "/").includes("/cleanup-local-assets-runs/"))];
    let refs=null;
    // Expensive complete reference scan is unnecessary when no item can be mutated.
    if(entries.entries.length)refs=await require('./cleanup-extended-retention').referenceInventory(false,excluded);
    const ctx={policy:lib.policy,now:Date.now(),productionRoot:authority.productionRoot,activity:entries.entries.length?lib.activity():{processes:[],tasks:[]},referenced:p=>refs&&[p,p.replaceAll('\\','/'),p.replaceAll('/','\\'),path.basename(p)].some(v=>refs.contains(v))};
    const seen=new Set();
    for(const entry of entries.entries){
      if(!entry||typeof entry.path!=='string'){receipt.errors.push('manifest_entry_path_missing');continue;}
      if(seen.has(lib.key(entry.path))){receipt.errors.push('duplicate_manifest_path:'+entry.path);continue;}seen.add(lib.key(entry.path));
      if(!fs.existsSync(entry.path)){receipt.preserved.push({path:entry.path,reason:'already_absent'});continue;}
      try{const item=lib.validate(entry,ctx);receipt.candidates.push(item);
        if(apply){try{ctx.activity=lib.activity();ctx.now=Date.now();refs=await require('./cleanup-extended-retention').referenceInventory(false,excluded);const current=lib.validate(entry,ctx);if(current.treeSha256!==item.treeSha256)throw Error('changed_after_preview');receipt.pendingAction={path:current.path,action:current.action,treeSha256:current.treeSha256};progress();receipt.processed.push(lib.applyOne(current));receipt.pendingAction=null;progress();}catch(error){receipt.errors.push("apply_failed:"+entry.path+":"+error.message);progress();}}
      }catch(error){receipt.preserved.push({path:entry.path,category:entry.category,reason:error.message});}
    }
    receipt.ok=receipt.errors.length===0;
    if(apply){receipt.readback=lib.verify(receipt);receipt.ok=receipt.ok&&receipt.readback.ok;}
    receipt.finishedAt=new Date().toISOString();
    progress();
    if(!noStatus){receipt.receiptFile=path.join(RUNTIME,'status',`cleanup-local-assets-${date()}.json`);save(receipt.receiptFile,receipt);}
    return receipt;
  }finally{if(fd!==undefined){fs.closeSync(fd);fs.unlinkSync(lock);}}
}
module.exports={run};
if(require.main===module)run({apply:process.argv.includes('--apply'),noStatus:process.argv.includes('--no-status'),maintenanceAuthorization:process.argv.find(x=>x.startsWith('--maintenance-authorization='))?.slice("--maintenance-authorization=".length)}).then(p=>{console.log(JSON.stringify(p,null,2));if(!p.ok)process.exitCode=1;}).catch(e=>{console.error(e.stack);process.exitCode=1;});
