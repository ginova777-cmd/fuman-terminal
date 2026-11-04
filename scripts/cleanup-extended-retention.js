"use strict";
const fs=require('fs'),path=require('path'),crypto=require('crypto'),{spawnSync}=require('child_process');
const {serviceRoleKey,terminalSupabaseUrl}=require('../lib/server-supabase-key');
const {assertTree,assertEntry}=require('./cleanup-path-protection');
const ROOT=path.resolve(__dirname,'..'),RUNTIME=process.env.FUMAN_RUNTIME_DIR||'C:\\fuman-runtime',DAY=86400000;
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const date=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
function read(p){return JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));}
function save(p,v){fs.mkdirSync(path.dirname(p),{recursive:true});const t=p+'.'+process.pid+'.tmp';const fd=fs.openSync(t,'wx');try{fs.writeFileSync(fd,JSON.stringify(v,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(t,p);}
function walk(root,visit){if(!fs.existsSync(root))return;for(const e of fs.readdirSync(root,{withFileTypes:true})){const p=path.join(root,e.name);assertEntry(root,p);if(e.isDirectory())walk(p,visit);else if(e.isFile())visit(p);}}
async function referenceInventory(persist=false,excludePaths=[],options={}){
 const cacheModule=require('./cleanup-reference-cache.cjs'),paths=[],state=path.join(RUNTIME,'state'),cachePath=path.join(state,'cleanup-extended-reference-index.json'),sealPath=path.join(state,'cleanup-extended-reference-seal.json');let cache={};
 if(options.cacheFile)cache=await cacheModule.index(options.cacheFile,options.cacheSeal);
 else if(fs.existsSync(sealPath)){const seal=read(sealPath);if(seal.contract!=='cleanup-reference-cache-v2'||path.dirname(path.resolve(seal.file))!==path.resolve(state)||!/^cleanup-extended-reference-[a-f0-9-]+\.jsonl$/.test(path.basename(seal.file)))throw Error('reference_cache_seal_path');cache=await cacheModule.index(seal.file,seal);}
 else{try{cache=read(cachePath);}catch{}}
 for(const dir of ['state','data','status','config'])walk(path.join(RUNTIME,dir),p=>{if(/\.json$/i.test(p)&&!/notification-guard[\\/]claims/.test(p)&&!/cleanup-(?:extended|maintenance)/.test(path.basename(p)))paths.push(p);});
 if(options.onProgress)options.onProgress({stage:'enumeration_complete',totalFiles:paths.length,memory:process.memoryUsage()});const excluded=new Set(excludePaths.map(p=>path.resolve(p).toLowerCase())),sink=persist?cacheModule.writer(state):null;
 try{const result=await require('./cleanup-reference-inventory.cjs').collect(paths.filter(p=>!excluded.has(path.resolve(p).toLowerCase())),cache,false,{...options,compactRows:true,onRow:row=>{if(sink)sink.write(row);if(options.onRow)options.onRow(options.compactRows===true?row:cacheModule.expand(row));}});if(sink)save(sealPath,sink.seal());delete result.next;return result;}finally{if(sink)sink.abort();}
}

async function request(route,body,storage=false){const key=serviceRoleKey({root:ROOT,runtimeDir:RUNTIME}),url=terminalSupabaseUrl({root:ROOT,runtimeDir:RUNTIME});if(!key||!url)throw Error('supabase_credentials_missing');const r=await fetch(url+(storage?'/storage/v1/':'/rest/v1/')+route,{method:body===undefined?'GET':'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(60000)});const t=await r.text();if(!r.ok)throw Error('cleanup_api_HTTP_'+r.status+':'+t.slice(0,160));return t?JSON.parse(t):null;}
function compactNotification(record,now=Date.now()){
 const at=Date.parse(record.recordedAt||record.sent_at||record.sentAt||'');
 if(record.status!=='sent'||!record.idempotencyKey||!record.payloadHash||!Number.isFinite(at)||at>=require('./cleanup-local-calendar').cutoff(now))return null;
 const out={...record},removed={};for(const k of ['payload','message','messageBody','body','flexMessage','rawResponse'])if(Object.hasOwn(out,k)){removed[k]=out[k];delete out[k];}
 if(!Object.keys(removed).length)return null;
 out.retention={contract:'notification-body-retention-7-calendar-days-v1',compactedAt:new Date(now).toISOString(),removedBodySha256:hash(JSON.stringify(removed))};return out;
}
function notificationCleanup(apply,refs,dir=path.join(RUNTIME,'state/notification-guard/claims'),maintenance=null){
 const capture=()=>{const rows=[];walk(dir,p=>{if(!p.endsWith('.json'))return;const bytes=fs.readFileSync(p);let value;try{value=JSON.parse(bytes);}catch{rows.push({key:p,sha256:hash(bytes)});return;}if(!value||typeof value!=='object'||Array.isArray(value)){rows.push({key:p,sha256:hash(bytes)});return;}for(const [key,v]of Object.entries(value))if(key!=='retention')rows.push({key:p+'#'+key,sha256:hash(JSON.stringify(v))});});return rows;};
 const observationBefore=maintenance?capture():null,observationCandidates=[];
const items=[],protectedUnreadable=[];let candidates=0,savedBytes=0,scanned=0;
 walk(dir,p=>{if(!p.endsWith('.json'))return;scanned++;const bytes=fs.readFileSync(p),old=bytes.toString('utf8');let v;
  try { v=JSON.parse(old); if(!v||typeof v!=='object'||Array.isArray(v))throw Error('claim_object_required'); }
  catch {
    // Unproven delivery/age is ineligible for deletion. Keep the claim in place
    // so the notification guard's exclusive-create deduplication still blocks it.
    protectedUnreadable.push({file:p,bytes:bytes.length,sha256:hash(bytes),reason:'unreadable_claim_preserved_no_cleanup_authority',deliveryStatus:'unknown',dedupClaimRetained:true});return;
  }
  const next=compactNotification(v);if(!next)return;
  // Explicit file references protect complete delivery evidence.
  if(refs.contains(p)||refs.contains(p.replaceAll('\\','/')))return;
  for(const key of ['payload','message','messageBody','body','flexMessage','rawResponse'])if(Object.hasOwn(v,key))observationCandidates.push(p+'#'+key);
   candidates++;const encoded=JSON.stringify(next,null,2)+'\n';if(apply){if(hash(fs.readFileSync(p))!==hash(old))throw Error('notification_changed_before_cleanup');save(p,next);const actual=read(p);for(const k of ['idempotencyKey','payloadHash','status','target','channel','recordedAt','claimFile'])if(JSON.stringify(actual[k])!==JSON.stringify(v[k]))throw Error('notification_identity_changed');savedBytes+=Math.max(0,Buffer.byteLength(old)-Buffer.byteLength(encoded));}
  items.push({file:p,beforeSha256:hash(old),afterSha256:apply?hash(fs.readFileSync(p)):null});
 });
 for(const item of protectedUnreadable)if(!fs.existsSync(item.file)||fs.statSync(item.file).size!==item.bytes||hash(fs.readFileSync(item.file))!==item.sha256)throw Error('protected_unreadable_claim_changed:'+item.file);
 const itemEvidence=apply&&maintenance?require('./cleanup-item-observation').persist(path.join(RUNTIME,'status/cleanup-items',maintenance.runId,'C24.json'),{contract:'cleanup-item-observation-v1',id:'C24',runId:maintenance.runId,inventoryComplete:true,readbackComplete:true,before:observationBefore,after:capture(),candidates:observationCandidates,checkedAt:new Date().toISOString()}):null;
 return {ok:true,itemEvidence,category:'notification_bodies',protectedUnreadable,protectedUnreadableCount:protectedUnreadable.length,protectedReadbackOk:true,scanned,candidates,compacted:apply?candidates:0,savedBytes,keepDays:7,items,protected:['active outbox','pending/failed claims','dedup identities','canonical delivery receipts','sent-notifications.jsonl']};}
async function blobInventory(){const {list}=require('@vercel/blob');const token=fs.readFileSync(path.join(RUNTIME,'secrets/vercel-blob-read-write-token.txt'),'utf8').trim();let cursor;const rows=[],seen=new Set();for(let page=0;page<100;page++){const p=await list({token,limit:1000,cursor});if(!Array.isArray(p.blobs)||typeof p.hasMore!=='boolean')throw Error('blob_pagination_metadata_missing');for(const b of p.blobs){if(typeof b.pathname!=='string'||!b.pathname||typeof b.url!=='string'||!Number.isFinite(b.size)||b.size<0||!Number.isFinite(Date.parse(b.uploadedAt)))throw Error('blob_object_fields_missing');if(seen.has(b.pathname))throw Error('blob_duplicate_page');seen.add(b.pathname);rows.push(b);}if(p.hasMore===false)return {rows,pages:page+1};if(!p.cursor||p.cursor===cursor)throw Error('blob_pagination_stalled');cursor=p.cursor;}throw Error('blob_inventory_bound');}
function eligibleAsset(asset,entry,refs,now=Date.now()){
 if(!entry||entry.owner!=='cleanup-managed-test-assets'||entry.status!=='retired'||entry.formalEvidence!==false||entry.rollbackRequired!==false||entry.referenceAuditComplete!==true)return false;
 if(!/^(?:tests|test-exports|temporary-exports)\//.test(asset.pathname)||asset.pathname.includes('..'))return false;
 if(entry.pathname!==asset.pathname||entry.size!==asset.size||Date.parse(entry.uploadedAt)!==Date.parse(asset.uploadedAt))return false;
 if(!(Date.parse(entry.retiredAt)<now-30*DAY&&Date.parse(asset.uploadedAt)<now-30*DAY))return false;
 return !(refs.contains?refs.contains(asset.pathname)||refs.contains(asset.url):refs.text.includes(asset.pathname)||refs.text.includes(asset.url));
}
async function cloudCleanup(apply,refs,maintenance=null){const buckets=await request('bucket',undefined,true),inv=await blobInventory();
 const storage=await require('./cleanup-history-pagination').storageInventory(buckets,(id,args)=>request('object/list/'+encodeURIComponent(id),args,true));const manifestPath=path.join(RUNTIME,'config/cleanup-retired-assets.json'),manifest=fs.existsSync(manifestPath)?read(manifestPath):{entries:[]};const candidates=inv.rows.filter(b=>eligibleAsset(b,manifest.entries?.find(e=>e.pathname===b.pathname),refs));const removed=[];
 if(apply&&candidates.length){const {del,head}=require('@vercel/blob'),token=fs.readFileSync(path.join(RUNTIME,'secrets/vercel-blob-read-write-token.txt'),'utf8').trim();for(const b of candidates){const current=await head(b.url,{token});if(current.size!==b.size||Date.parse(current.uploadedAt)!==Date.parse(b.uploadedAt))throw Error('asset_changed_before_delete');await del(b.url,{token});removed.push({pathname:b.pathname,bytes:b.size});}}
 const after=apply?await blobInventory():inv;
 const storageAfter=apply?await require('./cleanup-history-pagination').storageInventory(await request('bucket',undefined,true),(id,args)=>request('object/list/'+encodeURIComponent(id),args,true)):storage;
 if(storage.objects.some(o=>!storageAfter.objects.some(a=>a.bucket===o.bucket&&a.path===o.path&&JSON.stringify(a)===JSON.stringify(o))))throw Error('storage_protected_readback_failed');
 const protectedObjects=inv.rows.filter(b=>!candidates.includes(b));
 if(protectedObjects.some(b=>!after.rows.some(a=>a.pathname===b.pathname&&a.url===b.url&&a.size===b.size&&Date.parse(a.uploadedAt)===Date.parse(b.uploadedAt))))throw Error('blob_protected_readback_failed');if(removed.some(x=>after.rows.some(b=>b.pathname===x.pathname)))throw Error('blob_delete_readback_failed');
 const rows=(blobs,storage)=>[...blobs.map(b=>({key:'blob:'+b.pathname,sha256:hash(JSON.stringify({pathname:b.pathname,url:b.url,size:b.size,uploadedAt:b.uploadedAt}))})),...storage.objects.map(o=>({key:'storage:'+o.bucket+'/'+o.path,sha256:hash(JSON.stringify(o))}))];
 const protectedExclusions=[...storage.objects.map(o=>({key:'storage:'+o.bucket+'/'+o.path,reason:'no_approved_storage_retirement_binding'})),...protectedObjects.map(b=>({key:'blob:'+b.pathname,reason:'retirement_or_reference_proof_missing'}))];
 const itemEvidence=apply&&maintenance?require('./cleanup-item-observation').persist(path.join(RUNTIME,'status/cleanup-items',maintenance.runId,'C25.json'),{contract:'cleanup-item-observation-v1',id:'C25',runId:maintenance.runId,inventoryComplete:true,readbackComplete:true,before:rows(inv.rows,storage),after:rows(after.rows,storageAfter),candidates:candidates.map(b=>'blob:'+b.pathname),protectedExclusions,hashScope:'provider_object_identity_and_metadata',checkedAt:new Date().toISOString()}):null;
 return {itemEvidence,ok:true,storage:{...storage,independentReadback:apply,readbackObjects:storageAfter.objects.length,protected:storage.objects.map(o=>({...o,reason:'no_approved_storage_retirement_binding'}))},category:'cloud_assets',supabaseBuckets:buckets.map(b=>({id:b.id,name:b.name})),supabaseReason:buckets.length?'fully_inventoried_objects_preserved_pending_retirement_binding':'no_buckets',inventoryComplete:true,pages:inv.pages,objects:inv.rows.length,bytes:inv.rows.reduce((n,b)=>n+b.size,0),candidates:candidates.length,deleted:removed,protected:inv.rows.filter(b=>!candidates.includes(b)).map(b=>({pathname:b.pathname,size:b.size,uploadedAt:b.uploadedAt,reason:b.pathname.startsWith('scorecard88/')?'formal_scorecard_evidence':'retirement_or_reference_proof_missing'}))};}
function costAudit(){const r=spawnSync('powershell.exe',['-NoProfile','-Command',"$rows=@(Get-ScheduledTask | Where-Object { $_.TaskName -like 'Fuman*' -and $_.Settings.Enabled } | ForEach-Object { [pscustomobject]@{name=$_.TaskName;actions=@($_.Actions | Select-Object Execute,Arguments,WorkingDirectory);triggers=@($_.Triggers | ForEach-Object { [pscustomobject]@{start=$_.StartBoundary;days=$_.DaysOfWeek;interval=$_.DaysInterval;enabled=$_.Enabled;repeatInterval=$_.Repetition.Interval;repeatDuration=$_.Repetition.Duration;stop=$_.Repetition.StopAtDurationEnd} })} }); ConvertTo-Json -InputObject $rows -Depth 10 -Compress"],{encoding:'utf8',windowsHide:true,timeout:30000});if(r.status!==0)throw Error('cost_schedule_inventory_failed');const rows=JSON.parse(r.stdout),groups=new Map();for(const row of rows){const key=JSON.stringify({actions:row.actions,triggers:row.triggers});groups.set(key,[...(groups.get(key)||[]),row.name]);}const duplicates=[...groups.values()].filter(x=>x.length>1);const v=read(path.join(ROOT,'vercel.json'));return {ok:duplicates.length===0,category:'repeated_execution',enabledTasks:rows.length,exactDuplicateTaskGroups:duplicates,vercelCrons:v.crons,actualBillingAvailable:false,realizedSavings:null,reason:'configuration_inventory_is_not_billing_evidence'};}
function billingAudit(){const cli=path.join(process.env.APPDATA||'','npm/node_modules/vercel/dist/vc.js');const r=spawnSync(process.execPath,[cli,'usage','--format','json','--group-by','project'],{cwd:ROOT,encoding:'utf8',windowsHide:true,timeout:60000,maxBuffer:8*1024*1024});if(r.status!==0)throw Error('vercel_billing_readback_failed');const b=JSON.parse(r.stdout),project=b.groupBy?.data?.find(x=>x.name==='fuman-terminal');if(!project||b.pricingUnit!=='USD')throw Error('vercel_billing_project_missing');return {ok:true,category:'actual_billing',actualBillingAvailable:true,checkedAt:new Date().toISOString(),period:b.period,pricingUnit:b.pricingUnit,project,realizedSavings:null,note:'effectiveCost is usage valuation; billedCost may reflect credits; no causal cleanup savings claim'};}

const databaseSections=['strategy1_open_buy','strategy2_scan','strategy3_v2_scan','strategy4_scan','strategy5_scan','institution_scan','cb_detect_scan','warrant_flow_scan'].flatMap(p=>[['failed_runs',p+'_runs'],['orphan_results',p+'_results']]).concat([['exact_duplicate_snapshots','fugle_daytrade_quote_snapshots']]);
function validateDatabaseResult(r){
 if(r?.ok!==true||r.contract!=='extended-cleanup-db-v1'||!Array.isArray(r.sections)||r.sections.length!==17)throw Error('extended_database_sections_incomplete');
 const keys=new Set();for(const s of r.sections){const key=s.category+':'+s.table;if(keys.has(key)||!databaseSections.some(([c,t])=>c===s.category&&t===s.table)||!Number.isSafeInteger(s.candidateCount)||s.candidateCount<0||s.candidateCount>5000)throw Error('extended_database_section_invalid');keys.add(key);if(s.category==='orphan_results'&&(!s.latestCompleteRunId||!s.protectedHashBefore||s.protectedHashBefore!==s.protectedHashAfter))throw Error('extended_database_protection_failed');}
 return r.sections.reduce((n,s)=>n+s.candidateCount,0);
}
async function databaseCleanup(apply,refs,maintenance=null){
 const observation=require('./cleanup-database-observation');
 const capture=async()=>{const tables={};for(const [,table] of databaseSections)tables[table]=await observation.inventory(table,table.endsWith('_runs')?'run_id.asc':table==='fugle_daytrade_quote_snapshots'?'id.asc':'run_id.asc',{url:terminalSupabaseUrl({root:ROOT,runtimeDir:RUNTIME}),headers:{apikey:serviceRoleKey({root:ROOT,runtimeDir:RUNTIME}),Authorization:'Bearer '+serviceRoleKey({root:ROOT,runtimeDir:RUNTIME})},fetch});return tables;};
 const snapshot=maintenance?await capture():null;
 const planned={C21:[],C22:[],C23:[]};
 const checkObservation=r=>{
  if(r.observationContract!=='extended-cleanup-candidates-v1')throw Error('extended_candidate_identity_missing');
  if(r.archiveBudgetContract!=='cleanup-archive-multiset-v1')throw Error('extended_archive_contract_missing');
  for(const section of r.sections){if(!Array.isArray(section.candidateRows)||section.candidateRows.length!==section.candidateCount)throw Error('extended_candidate_identity_count');if(section.category==='failed_runs'&&(!Array.isArray(section.candidateResults)||section.resultTable!==section.table.replace(/_runs$/,'_results')))throw Error('extended_result_identity_missing');}
  if(r.applied)for(const section of r.sections){if(!Array.isArray(section.archivedRows)||section.archivedRows.length!==section.candidateRows.length||section.category==='failed_runs'&&(!Array.isArray(section.archivedResults)||section.archivedResults.length!==section.candidateResults.length))throw Error('extended_archived_identity_missing');}
 };
 const before=await request('rpc/fuman_extended_cleanup_v1',{p_apply:false,p_protected_run_ids:refs.ids});let remaining=validateDatabaseResult(before),after=before;const batches=[];
 if(maintenance)checkObservation(before);
 const recoveryArchives=apply&&maintenance?[require('./cleanup-recovery-archive').seal(RUNTIME,maintenance.runId,'C21-C23',snapshot)]:[];
 const archiveBudget=require('./cleanup-archive-budget.cjs'),sealedPayload=apply?archiveBudget.fromArchive(recoveryArchives[0]):null;
 if(apply)for(let round=0;remaining>0&&round<100;round++){
  const execution=await request('rpc/fuman_extended_cleanup_v1',{p_apply:true,p_protected_run_ids:refs.ids,p_archive:sealedPayload});validateDatabaseResult(execution);checkObservation(execution);batches.push(execution);
  for(const section of execution.sections){archiveBudget.consume(sealedPayload,{[section.table]:section.archivedRows});if(section.category==='failed_runs')archiveBudget.consume(sealedPayload,{[section.resultTable]:section.archivedResults});}
  if(maintenance){checkObservation(execution);for(const s of execution.sections){const id=s.category==='failed_runs'?'C21':s.category==='orphan_results'?'C22':'C23';planned[id].push(...s.archivedRows.map(r=>observation.row(s.table,r).key));if(id==='C21')planned[id].push(...s.archivedResults.map(r=>observation.row(s.resultTable,r).key));}}
  after=await request('rpc/fuman_extended_cleanup_v1',{p_apply:false,p_protected_run_ids:refs.ids});remaining=validateDatabaseResult(after);
  if(maintenance)checkObservation(after);
  if(remaining && execution.sections.reduce((n,s)=>n+Number(s.deletedRows||0)+Number(s.deletedRuns||0),0)===0)throw Error('extended_database_no_progress');
 }
 const cleanupItems=[];
 if(apply&&maintenance){
  const readback=await capture(),groups={C21:[],C22:[],C23:[]},afterGroups={C21:[],C22:[],C23:[]};
  for(const [table,rows] of Object.entries(snapshot)){
   const runs=table.endsWith('_results')?new Set(snapshot[table.replace(/_results$/,'_runs')].map(r=>r.run_id)):null;
   const group=r=>table==='fugle_daytrade_quote_snapshots'?'C23':runs&&!runs.has(r.run_id)?'C22':'C21';
   for(const r of rows)groups[group(r)].push(observation.row(table,r));
   for(const r of readback[table])afterGroups[group(r)].push(observation.row(table,r));
  }
  for(const id of Object.keys(groups))cleanupItems.push(require('./cleanup-item-observation').persist(path.join(RUNTIME,'status/cleanup-items',maintenance.runId,id+'.json'),{contract:'cleanup-item-observation-v1',id,runId:maintenance.runId,inventoryComplete:true,readbackComplete:true,before:groups[id],after:afterGroups[id],candidates:planned[id],recoveryArchives,checkedAt:new Date().toISOString()}));
 }
 return {ok:remaining===0,cleanupItems,remaining,remainingCountKind:remaining===0?'exact_zero':'bounded_candidate_count',initialCountKind:'bounded_candidate_count',before,batches,after};
}

async function main(){const apply=process.argv.includes('--apply'),verify=process.argv.includes('--verify'),authArg=process.argv.find(x=>x.startsWith('--maintenance-authorization='));
 const maintenance=authArg?require('./cleanup-maintenance-context').authorization(authArg.slice('--maintenance-authorization='.length)):null;
 if(apply){if(authArg)require('./cleanup-maintenance-context').authorization(authArg.slice('--maintenance-authorization='.length));else{const day=await require('./twse-trading-day').isTwseTradingDay(new Date(date()+'T04:00:00Z'),{stateDir:path.join(RUNTIME,'state'),ignoreOverrides:true});if(!day.isTradingDay||day.error||day.source==='weekend_fallback')throw Error('extended_cleanup_requires_trading_day_or_explicit_authorization');}const guard=spawnSync(process.execPath,['scripts/supabase-incident-guard.js','check','--class=guard','--action=extended-cleanup'],{encoding:'utf8',cwd:ROOT});if(guard.status!==0)throw Error('supabase_incident_blocked');}
 const lock=path.join(RUNTIME,'locks/cleanup-extended.lock');let fd;if(apply){fs.mkdirSync(path.dirname(lock),{recursive:true});fd=fs.openSync(lock,'wx');}
 const p={contract:'extended-cleanup-v1',checkedAt:new Date().toISOString(),applied:apply,dryRun:!apply,ok:false,complete:false,issues:[],sections:{}};
 try{const refs=await referenceInventory(apply||verify);p.referenceEvidence={files:refs.files.length,runIds:refs.ids.length,sha256:hash(JSON.stringify(refs.files))};
 for(const [name,fn]of Object.entries({duplicateIndexes:()=>{const args=['--use-system-ca',path.join(__dirname,'cleanup-duplicate-indexes.cjs')];if(apply)args.push('--apply');if(verify)args.push('--verify');const child=spawnSync(process.execPath,args,{cwd:ROOT,encoding:'utf8',windowsHide:true,timeout:75000});let result;try{result=JSON.parse(child.stdout);}catch{throw Error('duplicate_index_child_receipt_missing');}if(child.status!==0||result.ok!==true)throw Error('duplicate_index_child_failed:'+String(result.reasonCode||child.status));return {...result,childReceiptSha256:hash(fs.readFileSync(result.receiptFile))};},database:()=>databaseCleanup(apply,refs,maintenance),notifications:()=>notificationCleanup(apply,refs,undefined,maintenance),cloud:()=>cloudCleanup(apply,refs,maintenance),space:async()=>{const r=await request('rpc/fuman_cleanup_space_readback_v1',{});return {ok:r.autovacuum==='on',...r,actualBillingAvailable:false,spaceReclaimedBytes:null};},execution:()=>costAudit(),billing:()=>billingAudit()})){
  try{const result=await fn();p.sections[name]=result;if(!result.ok)p.issues.push(name+':incomplete');if(name==='database'&&(apply||verify)&&result.remaining!==0)p.issues.push('database:eligible_rows_remain');if(name==='notifications'&&verify&&result.candidates)p.issues.push('notifications:eligible_bodies_remain');if(name==='cloud'&&verify&&result.candidates)p.issues.push('cloud:eligible_assets_remain');}catch(e){p.issues.push(name+':'+e.message);if(/522|cannot check out|retry_after|owner_action_required/i.test(e.message))break;}
 }
 p.sections.preview={policy:'keep_production_active_aliases_and_rollback_until_retirement_and_usage_proven',runner:'cleanup-supabase-vercel-history.js',reason:'full_inventory_and_safe_deletion_owned_by_history_stage'};
 p.cleanupItems=[...(p.sections.database?.cleanupItems||[]),p.sections.notifications?.itemEvidence,p.sections.cloud?.itemEvidence].filter(Boolean);
 p.ok=p.issues.length===0;p.complete=p.ok&&(apply||verify);p.status=p.complete?'complete':p.ok?'preview':'blocked';p.exitCode=p.ok?0:1;
 }finally{p.finishedAt=new Date().toISOString();if(apply||verify){p.receiptFile=path.join(RUNTIME,'status',`cleanup-extended-${verify?'verifier-':''}${date().replaceAll('-','')}.json`);save(p.receiptFile,p);}if(fd!==undefined){fs.closeSync(fd);fs.unlinkSync(lock);}}
 console.log(JSON.stringify(p,null,2));if(!p.ok)process.exitCode=1;
}
module.exports={validateDatabaseResult,databaseCleanup,compactNotification,eligibleAsset,referenceInventory,notificationCleanup};if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1;});
