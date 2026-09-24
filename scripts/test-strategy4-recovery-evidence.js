'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),cp=require('child_process');
const run='strategy4-20260924-20260924092159';
function check(mutator){
 const runtime=fs.mkdtempSync(path.join(os.tmpdir(),'strategy4-evidence-'));
 const scan={runId:run,tradeDate:'2026-09-24',status:'verifying',complete:false,scanComplete:true,exitCode:0,fallback:false,startedAt:new Date().toISOString(),finishedAt:new Date().toISOString(),scanned:1605,total:1605,matches:156,blockingReason:''};
 const row={key:'strategy4',supabase:{ok:true,runId:run,scannedCount:1605,expectedTotal:1605,count:156,qualityStatus:'complete'},desktopSnapshot:{runId:run},mobileFragment:{runId:run},issues:['scorecard /88 row/sourceReport runId != latest pointer']};
 const surface={key:'strategy4',ok:true,desktopRunId:run,mobileRunId:run};
 mutator?.({scan,row,surface});
 const write=(p,x)=>{p=path.join(runtime,p);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(x));};
 write('data/scan-receipts/strategy4.json',scan);write('outputs/post-scan-tri-surface/strategy4/'+run+'/terminal-resource-chain-audit.json',{results:[row]});write('data/scan-receipts/scorecard88-surface-evidence-20260924-1700.json',{rows:[surface]});
 try{return cp.spawnSync(process.execPath,[path.join(__dirname,'build-strategy4-recovery-evidence.js'),'--run-id='+run],{env:{...process.env,FUMAN_RUNTIME_DIR:runtime},encoding:'utf8',windowsHide:true}).status;}finally{fs.rmSync(runtime,{recursive:true,force:true});}
}
test('DB-complete scan may publish scorecard before final tri-surface completion',()=>assert.equal(check(),0));
test('incomplete scan is rejected',()=>assert.notEqual(check(({scan})=>{scan.scanComplete=false;}),0));
test('stale or incomplete DB identity is rejected',()=>assert.notEqual(check(({row})=>{row.supabase.runId='old';}),0));
test('partial count and failed scan are rejected',()=>{assert.notEqual(check(({scan})=>{scan.scanned--; }),0);assert.notEqual(check(({scan})=>{scan.status='failed';}),0);});
test('unrelated chain failure cannot be hidden as scorecard recovery',()=>assert.notEqual(check(({row})=>{row.issues=['desktop missing'];}),0));
