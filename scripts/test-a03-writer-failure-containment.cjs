'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'run-daytrade-source-writer.js'),'utf8');
const start=source.indexOf('      if(moduleWorkIds().some(id=>["A03"].includes(id)))');
const end=source.indexOf('      if(moduleWorkIds().some(id=>["A05"].includes(id)))',start);
assert(start>0&&end>start);
for(const fails of [false,true]){
 const inputs=[],result={payload:{module_persistence_errors:[]}},identity={trade_date:'TEST_ONLY'};
 vm.runInNewContext(source.slice(start,end),{inputs,result,identity,isolatedModules:true,process:{env:{}},moduleWorkIds:()=>['A03','A04'],sideAsOf:'TEST_ONLY',snapshot:{symbols:['2330']},dailyVolumeMap:new Map(),nowIso:()=> 'TEST_ONLY',readJson:()=>null,STRATEGY_PRIORITY_BRIDGE_CACHE_FILE:'TEST_ONLY',require:n=>{
  if(n.endsWith('mother-pool-a03-integration.cjs'))return {dispatchForWriter:()=>{if(fails)throw Error('A03_SOURCE_UNBOUND');return {module_id:'A03'};}};
  if(n.endsWith('mother-pool-historical-volume-price'))return {collect:()=>({module_id:'A04',status:'DATA_GAP'})};
  throw Error('UNEXPECTED_DEPENDENCY:'+n);
 }});
 assert.deepEqual(inputs.map(x=>x.module_id),fails?['A04']:['A03','A04']);
 assert.equal(result.payload.module_persistence_errors.length,fails?1:0);
 if(fails){assert.equal(result.payload.module_persistence_errors[0].modules[0],'A03');assert.equal(result.payload.module_persistence_errors[0].error,'A03_SOURCE_UNBOUND');}
 assert.equal(inputs.at(-1).status,'DATA_GAP');
}
console.log('PASS actual Writer A03 failure is scoped; A04 continues with its original gap; success unchanged');
