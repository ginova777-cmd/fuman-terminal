'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto'),assert=require('assert/strict');const {auditTree}=require('./attested-tree-owner.cjs');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
async function main(){const results=[];for(const [name,code,extra,error]of [
 ['dynamic',"require('vm')",{},/DYNAMIC_EXECUTION_BLOCKED/],
 ['native',"require('./a.node')",{'a.node':'not native'},/NATIVE_BLOCKED/],
 ['esm',"import('./a.mjs');setInterval(()=>{},1000)",{'a.mjs':'export default 1'},/ESM_BLOCKED/],
 ['worker-eval',"new (require('worker_threads').Worker)('1',{eval:true})",{},/WORKER_OPTIONS_BLOCKED/],
 ['child-exec',"require('child_process').exec('unused')",{},/CHILD_EXECUTION_BLOCKED/]
 ]){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mp-load-negative-'));const files={};for(const [n,text]of Object.entries({'main.cjs':code,...extra})){fs.writeFileSync(path.join(dir,n),text);files[n]=hash(text);}const manifest=path.join(dir,'manifest.json');fs.writeFileSync(manifest,JSON.stringify({root:dir,node_version:process.version,node_hash:hash(fs.readFileSync(process.execPath)),files}));const config=path.join(dir,'config.json');fs.writeFileSync(config,JSON.stringify({scope:'ISOLATED_REVIEW',manifest,manifest_hash:hash(fs.readFileSync(manifest)),context:crypto.randomUUID(),challenge:crypto.randomUUID(),entrypoint:path.join(dir,'main.cjs'),config_dir:dir}));await assert.rejects(auditTree(config,['unreachable']),error);results.push({name,status:'REJECTED'});}
console.log(JSON.stringify({status:'PASS',results}));}
main().catch(e=>{console.error(e);process.exitCode=1;});
