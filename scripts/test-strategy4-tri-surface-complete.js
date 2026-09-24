'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {validate}=require('./verify-strategy4-tri-surface-complete');
const run='strategy4-20260924-20260924092159';
function fixture(){
 const scan={runId:run,scanComplete:true,status:'delivering',complete:false,exitCode:0,blockingReason:'',fallback:false,total:1605,scanned:1605,matches:1,tradeDate:'2026-09-24',triSurfaceStatus:'complete',desktopRunId:run,mobileRunId:run,scorecardRunId:run};
 const tri={complete:true,status:'complete',runId:run,desktopRunId:run,mobileRunId:run,scorecardRunId:run};
 const audit={ok:true,results:[{key:'strategy4',ok:true,supabase:{runId:run,count:1}}]};
 const db={ok:true,runId:run,complete:true,resultCount:1,readbackCount:1,scannedCount:1605,expectedTotal:1605};
 const rendered={contract:'strategy4_rendered_complete_v1',ok:true,runId:run,tradeDate:'20260924',checkedAt:new Date().toISOString(),symbols:['2330'],resultCount:1,reportSha256:'a'.repeat(64),surfaces:['desktop','mobile','scorecard'].map(kind=>({kind,ok:true,runId:run,symbols:['2330'],screenshotSha256:'b'.repeat(64)}))};
 return {scan,tri,audit,db,rendered};
}
test('three-surface completion requires data and rendered evidence without LINE delivery',()=>assert.deepEqual(validate(fixture(),run),[]));
test('old or mismatched surface cannot complete',()=>{const e=fixture();e.tri.scorecardRunId='old';assert(validate(e,run).includes('tri_surface_not_verified'));});
test('incomplete scan cannot complete',()=>{const e=fixture();e.scan.scanned--;assert(validate(e,run).includes('scan_not_ready'));});
test('independent database failures cannot complete',()=>{const e=fixture();e.db.ok=false;assert(validate(e,run).includes('independent_db_readback_failed'));});
test('missing actual rendering cannot complete',()=>{const e=fixture();e.rendered=null;assert(validate(e,run).includes('rendered_missing_or_wrong_identity'));});
