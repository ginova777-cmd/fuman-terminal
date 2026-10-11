'use strict';
const assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),{spawnSync}=require('child_process');
const {normalize}=require('../lib/tom-acceptance.cjs');
const root=path.resolve(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'tom-review-'));
let checks=0;function check(fn){fn();checks++;}
const good={trade_date:'2026-10-11',runId:'fixture',status:'complete',complete:true,exitCode:0,failed_checks:[],scanned:3,total:3,triSurfaceStatus:'complete',desktopRunId:'fixture',mobileRunId:'fixture',scorecardRunId:'fixture',naturalSlotComplete:true,scanCounts:{contract:'strategy3-scan-counts-v1',runId:'fixture',tradeDate:'2026-10-11',universe:3,visited:3,qualified:3,requiredRatio:0.9}};
const norm=x=>normalize('strategy3',{...good,...x},{date:good.trade_date});
function run(file,args){const r=spawnSync(process.execPath,[path.join(root,'scripts',file),...args],{encoding:'utf8',timeout:10000,maxBuffer:1048576});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);}
function save(name,value){const p=path.join(tmp,name);fs.writeFileSync(p,JSON.stringify(value));return p;}
check(()=>assert.equal(norm({}).complete,true));
check(()=>assert.equal(norm({recoveryReplay:true}).complete,false));
check(()=>assert.equal(norm({recoveryReplay:true}).verification,'RECOVERY_COMPLETE'));
check(()=>assert.equal(norm({naturalSlotComplete:undefined}).verification,'UNKNOWN'));
check(()=>assert.equal(norm({naturalSlotComplete:false}).complete,false));
check(()=>assert.equal(norm({first_blocker:'real_failure'}).verification,'BLOCKED'));
check(()=>assert.equal(norm({scanCounts:{...good.scanCounts,visited:2}}).complete,false));
check(()=>assert.equal(norm({mobileRunId:'other'}).complete,false));
check(()=>assert.equal(norm({recoveryReplay:true,exitCode:1}).recoveryComplete,false));
const receipt=save('strategy3.json',good);
function observe(){return run('read-tom-strategy-receipts.cjs',[save('manifest.json',{requireFormalMapping:true,tasks:[{task:'strategy3',receipt,expected:{date:good.trade_date}},{task:'seven-strategies',receipt:path.join(tmp,'missing-remote.json'),expected:{date:good.trade_date}}]})]);}
let observed=observe();
check(()=>assert.equal(observed.complete,true));
check(()=>assert.equal(observed.rows[1].receiptRead,false));
check(()=>assert.equal(observed.rows[1].verification,'REMOTE_UNVERIFIED'));
check(()=>assert.equal(observed.rows[1].complete,false));
check(()=>assert.equal(observed.rows[1].first_blocker,null));
fs.writeFileSync(receipt,JSON.stringify({...good,first_blocker:'local_failure'}));
check(()=>assert.equal(observe().complete,false));
fs.writeFileSync(receipt,JSON.stringify({...good,recoveryReplay:true}));
check(()=>assert.equal(observe().complete,false));
const eventRows=[norm({}),norm({recoveryReplay:true}),{...norm({}),recoveryReplay:true},{...norm({}),naturalSlotComplete:false}];
const events=run('record-tom-business-events.cjs',[save('root.json',{strategyObservation:{rows:eventRows}}),path.join(tmp,'events')]);
check(()=>assert.equal(events.recorded,1));
console.log(JSON.stringify({ok:true,checks,scope:'isolated_fixtures_only',evidenceDirectory:tmp}));
