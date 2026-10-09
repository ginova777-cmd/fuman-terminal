'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('assert/strict');
const {auditTree}=require('./attested-tree-owner.cjs'),{local}=require('./producer-handoff.cjs');
const dir=local(process.argv[2]),root=path.join(dir,'source'),runtime=path.join(dir,'load-runtime');fs.mkdirSync(runtime,{recursive:true});
const h=b=>crypto.createHash('sha256').update(b).digest('hex');
const files={};function walk(d){for(const x of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,x.name);if(x.isDirectory())walk(p);else if(/\.(cjs|js|json)$/.test(p))files[path.relative(root,p).replaceAll('\\','/')]=h(fs.readFileSync(p));}}walk(root);
const harness=path.join(root,'isolated-load-profile.cjs');fs.writeFileSync(harness,`const path=require('path');require('./scripts/fugle-websocket-collector.js');
new (require('worker_threads').Worker)(path.join(__dirname,'lib/daytrade-candle-save-worker.js'),{workerData:{file:path.join(process.env.FUMAN_RUNTIME_DIR,'candle.json'),retentionMs:86400000}});
require('child_process').fork(path.join(__dirname,'scripts/mother-preopen-worker.cjs'),[],{windowsHide:true,stdio:['ignore','ignore','ignore','ipc']});
setTimeout(()=>require('./lib/fugle-rest-quote-evidence.cjs'),20);setInterval(()=>{},1000);`);files[path.basename(harness)]=h(fs.readFileSync(harness));
const manifest=path.join(dir,'load-manifest.json');fs.writeFileSync(manifest,JSON.stringify({root,node_version:process.version,node_hash:h(fs.readFileSync(process.execPath)),files}));
const config=path.join(dir,'load-config.json');fs.writeFileSync(config,JSON.stringify({scope:'ISOLATED_REVIEW',manifest,manifest_hash:h(fs.readFileSync(manifest)),challenge:crypto.randomUUID(),context:crypto.randomUUID(),config_dir:dir,entrypoint:harness,isolatedRuntime:runtime}));
async function main(){const expected=['scripts/fugle-websocket-collector.js','lib/provider-journal-worker.cjs','lib/provider-side-journal.cjs','lib/telegram-detectors/provider-trade-journal.cjs','lib/daytrade-candle-save-worker.js','scripts/mother-preopen-worker.cjs','lib/fugle-rest-quote-evidence.cjs'];const receipt=await auditTree(config,expected);assert(expected.every(p=>receipt.events.some(e=>e.path===p&&e.event==='LOADED')));fs.writeFileSync(path.join(dir,'formal-load-receipt.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify({status:'PARTIAL',verified_profiles:expected,os_processes:receipt.os.length,contexts:receipt.contexts.length,dir,blocked:['AUTHENTICATED_STREAMING_BRANCH_NOT_EXECUTED','ESM_NATIVE_DYNAMIC_NOT_SUPPORTED'],formal_started:false}));}
main().catch(e=>{console.error(e);process.exitCode=1;});
