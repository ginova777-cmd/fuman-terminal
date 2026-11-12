'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict'),path=require('path');
const s=fs.readFileSync(path.join(__dirname,'../terminal-desktop-fast-shell.js'),'utf8');
function fn(name){const start=s.indexOf('  function '+name+'(');assert(start>=0);const end=s.indexOf('\n  function ',start+10);return s.slice(start,end<0?undefined:end);}
const good={ok:true,runId:'institution-20261112-20261112131923',resultCount:0,evidenceStatus:'complete'};
const ctx={};vm.runInNewContext(fn('institutionEmptyReadbackComplete')+';this.check=institutionEmptyReadbackComplete;',ctx);
assert.equal(ctx.check(good),true);
for(const bad of [null,{}, {...good,runId:''},{...good,ok:false},{...good,resultCount:59},{...good,evidenceStatus:'pending'},{...good,error:'timeout'},{...good,publishAllowed:false}])assert.equal(ctx.check(bad),false);
// Execute the actual rendering function: unresolved/failed reads must exit into
// the pending shell before a zero-result success can be rendered.
for(const meta of [{},{ok:false,error:'timeout'},{...good,runId:''},{...good,resultCount:59}]){
 const c={canvasState:{rows:[],filtered:[]},strategyMeta:()=>({}),canvasPayloadMeta:()=>meta,
 unifiedRunCards:()=>[],clearEmptyUnifiedFilter:()=>false,isStrategy3Route:()=>false,isStrategy4Route:()=>false,isStrategy5Route:()=>false,
 isMemberStrategyPreviewRoute:()=>false,isChipTradeRoute:()=>true,
 renderMemberStrategyPendingShell:()=> 'PENDING',unifiedDisplayCount:()=>{throw Error('FALSE_ZERO_RENDER');}};
 vm.runInNewContext(fn('institutionEmptyReadbackComplete')+'\n'+fn('renderUnifiedListShell')+'\nthis.result=renderUnifiedListShell("chip-trade|買賣超",{},{});',c);
 assert.equal(c.result,'PENDING');
}
console.log('PASS missing, failed, wrong-count reads cannot render a completed zero result; authoritative zero retained');
