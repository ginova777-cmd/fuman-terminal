'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),vm=require('vm'),crypto=require('crypto'),{createRequire}=require('module');
const output=path.resolve(__dirname,'../../../outputs/TOM-CLEANUP-FIRST-COMPLETE-20261017/release-gates-final/c15-protection');fs.mkdirSync(output,{recursive:true});
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function load(name,runtime,overrides={}){const file=path.join(__dirname,name),native=createRequire(file),ctx={module:{exports:{}},__dirname,require:n=>overrides[n]||native(n),process:{argv:[],env:{FUMAN_RUNTIME_DIR:runtime}},console:{log:()=>{}},URL,URLSearchParams,AbortSignal,Buffer};vm.createContext(ctx);vm.runInContext(fs.readFileSync(file,'utf8'),ctx);return ctx;}
for(const mode of ['approved-isolated-fixture','missing','id-reference','url-reference','rollback','incident','artifact-missing','reference-unknown','artifact-after-delete'])test('C15 protection '+mode,async()=>{
 const runtime=fs.mkdtempSync(path.join(output,mode+'-')),at=Date.now(),auth={runId:'isolated-c15-'+crypto.randomUUID()},old={uid:'dpl-old',target:'preview',createdAt:at-60*86400000,url:'old.fixture.invalid',alias:[],state:'READY'},recent={...old,uid:'dpl-recent',url:'recent.fixture.invalid',createdAt:at-86400000};
 let deployments=[recent,old],deletes=0,artifactFile;
 if(mode!=='missing'){
  const [binding]=require('./cleanup-deployment-fixture.cjs').seed(runtime,[old],new Date(at).toISOString()),file=binding.retirementEvidence.file,p=JSON.parse(fs.readFileSync(file));
  artifactFile=p.rebuildArtifact.file;
  if(mode==='rollback')p.rollbackRequired=true;if(mode==='incident')p.incidentState='open';if(mode==='artifact-missing')fs.unlinkSync(p.rebuildArtifact.file);
  fs.writeFileSync(file,JSON.stringify(p));binding.retirementEvidence.sha256=hash(fs.readFileSync(file));fs.writeFileSync(path.join(runtime,'config/cleanup-retired-assets.json'),JSON.stringify({entries:[binding]}));
 }
 fs.mkdirSync(path.join(runtime,'state'),{recursive:true});
 if(mode==='id-reference')fs.writeFileSync(path.join(runtime,'state/consumer.json'),JSON.stringify({deploymentId:old.uid}));
 if(mode==='url-reference')fs.writeFileSync(path.join(runtime,'state/consumer.json'),JSON.stringify({url:'https://'+old.url}));
 if(mode==='reference-unknown')fs.writeFileSync(path.join(runtime,'state/consumer.json'),'"unterminated');
 const references=load('cleanup-extended-retention.js',runtime),ctx=load('cleanup-supabase-vercel-history.js',runtime,{'./cleanup-extended-retention':references.module.exports});
 ctx.process.env.VERCEL_TOKEN='isolated';ctx.provider=async(route,token,method)=>{assert.equal(token,'isolated');if(method==='DELETE'){deletes++;deployments=deployments.filter(v=>v.uid!==route.split('/').at(-1));if(mode==='artifact-after-delete')fs.unlinkSync(artifactFile);return{};}if(route.startsWith('/v13/'))return deployments.find(v=>v.uid===route.split('/').at(-1));const cursor=Number(new URL('https://fixture.invalid'+route).searchParams.get('until')||0);return {deployments:deployments.slice(cursor,cursor+1),pagination:{next:cursor+1<deployments.length?cursor+1:null}};};
 vm.runInContext("vercelProject=()=>({projectId:'fixture'});vercelRequest=provider",ctx);
 ctx.args={apply:true,referenceMs:at,vercelRetentionDays:30,vercelKeepPerTarget:1,maintenance:auth};
 if(mode==='artifact-after-delete'){await assert.rejects(vm.runInContext('cleanupVercelDeployments(args)',ctx),/deployment_recovery_evidence_changed_after_cleanup/);assert.equal(deletes,1);fs.writeFileSync(path.join(runtime,'result.json'),JSON.stringify({scope:'isolated-provider-only',mode,expectedRejection:'deployment_recovery_evidence_changed_after_cleanup',complete:false,deleted:deletes}));return;}
 const result=await vm.runInContext('cleanupVercelDeployments(args)',ctx);assert.equal(result.ok,true);assert.equal(result.scannedDeployments,2);assert.equal(result.retentionAgeCandidates,1);assert.equal(result.inventoryComplete,true);
 const item=require('./cleanup-item-observation').verify(result.itemEvidence);assert.equal(item.runId,auth.runId);assert.equal(item.remaining,0);
 if(mode==='approved-isolated-fixture'){assert.equal(deletes,1);assert.equal(item.deleted,1);assert.equal(item.protectedSet.length,1);}else{assert.equal(deletes,0);assert.equal(item.deleted,0);assert.equal(item.protectedExclusions.length,1);assert.equal(item.protectedSet.length,2);assert(item.protectedExclusions[0].reason);}
 fs.writeFileSync(path.join(runtime,'result.json'),JSON.stringify({scope:'isolated-provider-only',mode,...result},null,2));
});
