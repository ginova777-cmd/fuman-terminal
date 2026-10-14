'use strict';
const fs=require('fs'),path=require('path'),cp=require('child_process');
const lab=path.resolve(process.argv[2]);if(!lab.includes('stock-recovery-entry-'))throw Error('LAB_ONLY');
const testFile=path.join(__dirname,'test-stock-runtime-pair-release.cjs');const prefix=fs.readFileSync(testFile,'utf8').split('const results=[];')[0];
const fixtureRoot=path.join(lab,'actual-release');
// Reuse the already verified real Git/runtime pair fixture, without running its suite again.
const helper=path.join(__dirname,'temporary-stock-recovery-fixture-'+process.pid+'.cjs');
const crash=process.argv[3]==='crash';
const code=prefix+`\nconst c=setup('recovery');if(${crash}){const r=cp.spawnSync(process.execPath,[${JSON.stringify(testFile)},'child',path.dirname(c.out)+'/config.json'],{encoding:'utf8',timeout:120000});fs.writeFileSync(path.dirname(c.out)+'/crash-output.txt',r.stdout+'\\n'+r.stderr);assert.equal(r.status,73);}else{const r=execute(c,'apply',c.out,deps(c));assert.equal(r.status,'CODE_DEPLOYMENT_VERIFIED_RUNTIME_PENDING');}console.log(JSON.stringify(c));`;
try{fs.writeFileSync(helper,code,{flag:'wx'});const result=cp.execFileSync(process.execPath,[helper,fixtureRoot],{encoding:'utf8',timeout:120000});const c=JSON.parse(result.trim().split(/\r?\n/).at(-1));
 const original=JSON.parse(fs.readFileSync(path.join(lab,'release-config.json')));
 const out=path.join(lab,'runs/old/release');fs.cpSync(c.out,out,{recursive:true});if(crash)fs.copyFileSync(c.lock,path.join(lab,'isolated-release.lock'));
 fs.mkdirSync(path.join(lab,'release-package'),{recursive:true});
 for(const [from,to] of [[c.manifestPath,'release-package/manifest.json'],[c.diffPath,'release-package/exact.diff'],[path.join(c.packageRoot,'runtime-pair.json'),'runtime-pair.json']])fs.copyFileSync(from,path.join(lab,to));
 fs.cpSync(path.join(c.packageRoot,'runtime-payload'),path.join(lab,'runtime-payload'),{recursive:true});
 for(const f of ['ReleaseOperation.cjs','RuntimePair.cjs','release-package/deploy-core.cjs','release-package/exact-diff.cjs'])fs.copyFileSync(path.join(__dirname,f),path.join(lab,f));
 const operation=path.join(lab,'ReleaseOperation.cjs');const operationSource=fs.readFileSync(operation,'utf8');if(!operationSource.includes("c.lock='C:/fuman-release-owner/final-release-deployment.lock'"))throw Error('FIXTURE_LOCK_REWRITE_REQUIRED');fs.writeFileSync(operation,operationSource.replace("c.lock='C:/fuman-release-owner/final-release-deployment.lock'","c.lock=path.join(__dirname,'isolated-release.lock')"));
 // Only installed-admin trust and process visibility are artificial; actual Git/ACL/bytes rollback remains real.
 fs.writeFileSync(path.join(lab,'OwnerAuthorization.cjs'),"exports.guardOwner=(root,c)=>{if(!root.includes('stock-recovery-entry-')||/fuman-release-owner|fuman-runtime/i.test(c.prod))throw Error('LAB_ONLY');};");
 const inventory=JSON.parse(fs.readFileSync(path.join(lab,'runs/old/preserved-future-identity.json')));inventory.entry='future.js';
 fs.appendFileSync(path.join(lab,'ProductionRuntimePorts.ps1'),"\nfunction Get-RuntimeInventory($c){Get-Content (Join-Path $PSScriptRoot 'runs/old/preserved-future-identity.json') -Raw|ConvertFrom-Json -AsHashtable}\n");
 c.future_identity=inventory;
 const conf={...original,...c,runtime:original.runtime,packageRoot:lab,formal_apply_authorized:true,release_approved:true,remote_main_verified:true,final_sha_after_merge:c.target,verifier:path.join(lab,'verify-fixture.cjs')};
 // Keep wrapper transaction rooted in the real fixture runtime while owner marker remains in that same runtime.
 conf.runtime=c.runtime;fs.mkdirSync(path.join(conf.runtime,'state'),{recursive:true});
 const crypto=require('crypto'),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
 const preservation={contract:'stock_futures_preservation_v1',expected:c.expected,target:c.target,files:c.preserved_files};
 const bytes=Buffer.from(JSON.stringify(preservation));fs.writeFileSync(path.join(lab,'stock-preservation.json'),bytes);conf.stock_preservation_sha256=hash(bytes);
 fs.writeFileSync(path.join(lab,'release-config.json'),JSON.stringify(conf));
 fs.writeFileSync(conf.verifier,`const fs=require('fs'),cp=require('child_process');const c=${JSON.stringify({prod:c.prod,authority:c.authority})};const h=cp.execFileSync('git',['-c','safe.directory='+c.prod,'-C',c.prod,'rev-parse','HEAD'],{encoding:'utf8'}).trim();const ok=h===JSON.parse(fs.readFileSync(c.authority)).approvedProductionSha;console.log(JSON.stringify({ok,productionClean:true,productionHead:h,approvedProductionSha:h}));if(!ok)process.exitCode=1;`);
 console.log(JSON.stringify({expected:c.expected,target:c.target,runtime:conf.runtime}));
}finally{fs.unlinkSync(helper);}
