'use strict';
// Isolated harness only; never shipped as a formal CLI or loaded by Owner.
const fs=require('fs'),path=require('path'),cp=require('child_process'),assert=require('assert/strict'),crypto=require('crypto');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const {execute}=require('./ReleaseOperation.cjs'),{execute:stop}=require('./GracefulOperation.cjs');
const {git,text}=require('./release-package/deploy-core.cjs');
if(process.argv[2]==='--manifest'){
 const [root,base,target,out]=process.argv.slice(3);const files=text(root,'diff','--name-only',base,target).split(/\r?\n/).filter(Boolean).map(file=>{const b=git(root,'show',target+':'+file);return {file,bytes:b.length,sha256:hash(b)}});
 fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify({production_sha:base,final_sha:target,files},null,2));fs.writeFileSync(path.join(out,'exact.diff'),git(root,'diff','--binary',base,target));
}else{
 const x=JSON.parse(fs.readFileSync(process.argv[2],'utf8').replace(/^\uFEFF/,'')),c=x.config;
 function guard(){for(const f of [c.prod,c.runtime,c.authority,c.lock]){assert(path.resolve(f).startsWith(path.resolve(x.isolated_root)+path.sep));assert(!/fuman-release-owner|fuman-runtime|prod81/i.test(f));}const o=JSON.parse(fs.readFileSync(x.owner_gate,'utf8'));assert.equal(o.maintenance_verified,true);}
 const dep={guard,noUsers:()=>{guard();const f=path.join(c.runtime,'state/futopt-shutdown/owner.json');if(fs.existsSync(f)){const o=JSON.parse(fs.readFileSync(f));const live=cp.execFileSync('pwsh',['-NoProfile','-Command',`$p=Get-Process -Id ${o.pid} -ErrorAction SilentlyContinue;if($p){'LIVE'}`],{encoding:'utf8',windowsHide:true});assert(!live.includes('LIVE'),'LIVE_COLLECTOR_FORBIDS_CHECKOUT')}},admin:()=>true,evidenceOff:()=>true,freeBytes:()=>1e10,remoteMain:()=>c.target,verify:()=>{assert.equal(text(c.prod,'rev-parse','HEAD'),JSON.parse(fs.readFileSync(c.authority)).approvedProductionSha);assert.equal(text(c.prod,'status','--porcelain'),'')}};
 Promise.resolve().then(()=>x.operation==='stop'?stop(c,x.identity,guard):execute(c,x.operation,x.out,dep)).then(r=>{console.log(JSON.stringify(r));if(!['GRACEFUL_STOP_VERIFIED','CODE_DEPLOYMENT_VERIFIED_RUNTIME_PENDING','RESTORED'].includes(r.status))process.exitCode=1}).catch(e=>{console.error(e.stack);process.exitCode=1});
}
