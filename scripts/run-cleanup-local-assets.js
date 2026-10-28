"use strict";
const fs=require('fs'),path=require('path');
const lib=require('./cleanup-local-assets');
const RUNTIME=process.env.FUMAN_RUNTIME_DIR||'C:/fuman-runtime';
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
  const maintenance=maintenanceAuthorization?require('./cleanup-maintenance-context').authorization(maintenanceAuthorization):null;
  const capacityBefore=require('./cleanup-local-capacity').snapshot(RUNTIME);
  const manifest=path.join(RUNTIME,lib.policy.manifest);
  const entries=fs.existsSync(manifest)?read(manifest):{contract:'cleanup-local-assets-manifest-v1',entries:[]};
  if(entries.contract!=='cleanup-local-assets-manifest-v1'||!Array.isArray(entries.entries))throw Error('local_assets_manifest_invalid');
  const inventoryBefore=new Map(entries.entries.filter(e=>e&&typeof e.path==='string'&&fs.existsSync(e.path)).map(e=>[e.path,lib.fingerprint(e.path)]));
  const receipt={contract:lib.policy.contract,runId:require('crypto').randomUUID(),checkedAt:new Date().toISOString(),applied:apply,ok:false,maintenanceRunId:maintenance?.runId||null,maintenanceAuthorizationSha256:maintenance?.sha256||null,manifestPresent:fs.existsSync(manifest),categories:Object.keys(lib.policy.categories),localCalendar:require('./cleanup-local-calendar').describe(),candidates:[],processed:[],preserved:[],errors:[],protectedEvidence:[],inventory:[]};
  const journal=path.join(RUNTIME,'status/cleanup-local-assets-runs',receipt.runId+'.json');
  const progress=()=>{if(apply)save(journal,receipt);};
  // Only catalog sizes; absence of retirement evidence is an explicit preservation reason.
  for(const root of ['outputs','logs','tmp']){
    const p=path.join(RUNTIME,root);if(!fs.existsSync(p))continue;
    const all=lib.files(p);receipt.inventory.push({root:p,files:all.length,bytes:all.reduce((n,f)=>n+fs.statSync(f).size,0),reason:'unregistered_assets_preserved'});
    for(const file of all.filter(f=>!entries.entries.some(e=>typeof e?.path==='string'&&lib.inside(e.path,f)))){const bytes=fs.readFileSync(file);receipt.protectedEvidence.push({path:file,sha256:lib.hash(bytes),bytes:bytes.length,appendAllowed:path.basename(file)==='production-health.jsonl'});}
  }
  // Discovery is an exclusion inventory, never authorization to delete a root.
  for(const intakeRoot of lib.policy.intakeInventoryRoots||[]){
    if(!fs.existsSync(intakeRoot)){receipt.inventory.push({root:intakeRoot,files:0,bytes:0,linksProtected:0,reason:'intake_root_absent'});continue;}
    let files=0,bytes=0,linksProtected=0;const protectedUninspectedPaths=[];const digest=require('crypto').createHash('sha256');
    function visit(p){if(entries.entries.some(e=>typeof e?.path==='string'&&lib.inside(e.path,p)))return;if(require('./cleanup-local-history-guards').protectedPath(p)){protectedUninspectedPaths.push({path:p,reason:'protected_identity'});return;}let stat;try{stat=fs.lstatSync(p);}catch(error){protectedUninspectedPaths.push({path:p,reason:error.code||'unreadable'});return;}if(stat.isSymbolicLink()){linksProtected++;digest.update(JSON.stringify({path:p,link:true}));return;}if(stat.isDirectory()){let names;try{names=fs.readdirSync(p).sort();}catch(error){protectedUninspectedPaths.push({path:p,reason:error.code||'unreadable'});return;}for(const name of names)visit(path.join(p,name));return;}if(!stat.isFile())throw Error('intake_special_file:'+p);files++;bytes+=stat.size;digest.update(JSON.stringify({path:p,bytes:stat.size,mtimeMs:stat.mtimeMs}));}
    visit(intakeRoot);receipt.inventory.push({root:intakeRoot,files,bytes,linksProtected,protectedUninspectedPaths,fileCountIncludesUninspected:false,metadataSha256:digest.digest('hex'),reason:'unregistered_intake_preserved',protectionMode:'excluded_from_mutation_manifest'});
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
    const hasLiveManifestTargets=entries.entries.some(e=>typeof e?.path==='string'&&fs.existsSync(e.path));
    if(hasLiveManifestTargets)refs=await require('./cleanup-extended-retention').referenceInventory(false,excluded);
    const ctx={policy:lib.policy,now:Date.now(),productionRoot:authority.productionRoot,activity:hasLiveManifestTargets?lib.activity():{processes:[],tasks:[]},referenced:p=>refs&&[p,p.replaceAll('\\','/'),p.replaceAll('/','\\'),path.basename(p)].some(v=>refs.contains(v))};
    const seen=new Set();
    for(const entry of entries.entries){
      if(!entry||typeof entry.path!=='string'){receipt.errors.push('manifest_entry_path_missing');continue;}
      if(seen.has(lib.key(entry.path))){receipt.errors.push('duplicate_manifest_path:'+entry.path);continue;}seen.add(lib.key(entry.path));
      if(!fs.existsSync(entry.path)){receipt.preserved.push({path:entry.path,reason:'already_absent'});continue;}
      try{
        // Owner deferred LAB integration: no cache/worktree deletion without consumer safety.
        // Existing retirement evidence does not establish complete LAB reader exclusion.
        if(['retired_cache','retired_worktree','retired_backup'].includes(entry.category))throw Error('lab_reference_or_safety_unverified');
        const item=lib.validate(entry,ctx);receipt.candidates.push(item);
        if(apply){try{ctx.activity=lib.activity();ctx.now=Date.now();refs=await require('./cleanup-extended-retention').referenceInventory(false,excluded);const current=lib.validate(entry,ctx);if(current.treeSha256!==item.treeSha256)throw Error('changed_after_preview');receipt.pendingAction={path:current.path,action:current.action,treeSha256:current.treeSha256};progress();receipt.processed.push(lib.applyOne(current));receipt.pendingAction=null;progress();}catch(error){receipt.errors.push("apply_failed:"+entry.path+":"+error.message);progress();}}
      }catch(error){const files=lib.fingerprint(entry.path);receipt.preserved.push({path:entry.path,category:entry.category,reason:error.message,files,treeSha256:lib.hash(JSON.stringify(files))});}
    }
    receipt.capacity=require('./cleanup-local-capacity').assess(capacityBefore,require('./cleanup-local-capacity').snapshot(RUNTIME),lib.policy.capacity.minimumFreeBytes);
    receipt.counts={scannedFiles:[...inventoryBefore.values()].reduce((n,rows)=>n+rows.length,0),deletedFiles:receipt.processed.reduce((n,item)=>n+item.files.length,0),protectedFiles:receipt.preserved.reduce((n,item)=>n+(item.files?.length||0),0),remainingCandidates:receipt.candidates.length-receipt.processed.length};
    if(receipt.capacity.belowWatermark)receipt.errors.push('local_capacity_below_watermark');
    receipt.notificationRequired=receipt.errors.length>0;
    receipt.ok=receipt.errors.length===0;
    if(apply){receipt.readback=lib.verify(receipt);receipt.ok=receipt.ok&&receipt.readback.ok;}
    if(apply&&maintenance){
      receipt.cleanupItems=[];
      const groups={N01:['retired_cache'],N02:['test_artifact','engineering_test'],N03:['sealed_log'],N04:['retired_worktree','retired_backup','engineering_backup'],N05:['interrupted_temp','telegram_history','telegram_plan','mother_pool_history','closed_execution']};
      for(const [id,categories] of Object.entries(groups)){
        const listed=entries.entries.filter(e=>categories.includes(e.category)&&inventoryBefore.has(e.path));
        const before=listed.map(e=>({key:e.path,sha256:lib.hash(JSON.stringify(inventoryBefore.get(e.path)))}));
        const after=listed.filter(e=>fs.existsSync(e.path)).map(e=>({key:e.path,sha256:lib.hash(JSON.stringify(lib.fingerprint(e.path)))}));
        const candidates=receipt.candidates.filter(e=>categories.includes(e.category)).map(e=>e.path);
        const archives=receipt.processed.filter(e=>categories.includes(e.category)&&e.archive).map(e=>({file:e.archive,sha256:e.archiveSha256,originalSha256:e.originalSha256,index:e.index}));
        const protectedExclusions=receipt.preserved.filter(e=>categories.includes(e.category)&&inventoryBefore.has(e.path)).map(e=>({key:e.path,reason:e.reason}));
        receipt.cleanupItems.push(require('./cleanup-item-observation').persist(path.join(RUNTIME,'status/cleanup-items',maintenance.runId,id+'.json'),{contract:'cleanup-item-observation-v1',id,runId:maintenance.runId,inventoryComplete:true,readbackComplete:true,before,after,candidates,archives,protectedExclusions,checkedAt:new Date().toISOString()}));
      }
    }
    receipt.finishedAt=new Date().toISOString();
    progress();
    if(!noStatus){receipt.receiptFile=path.join(RUNTIME,'status',`cleanup-local-assets-${date()}.json`);save(receipt.receiptFile,receipt);}
    return receipt;
  }finally{if(fd!==undefined){fs.closeSync(fd);fs.unlinkSync(lock);}}
}
module.exports={run};
if(require.main===module)run({apply:process.argv.includes('--apply'),noStatus:process.argv.includes('--no-status'),maintenanceAuthorization:process.argv.find(x=>x.startsWith('--maintenance-authorization='))?.slice("--maintenance-authorization=".length)}).then(p=>{console.log(JSON.stringify(p,null,2));if(!p.ok)process.exitCode=1;}).catch(e=>{console.error(e.stack);process.exitCode=1;});
