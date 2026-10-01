const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const file=require.resolve('../lib/daytrade-memory-service');let clones=0,getInputs;
const context={module:{exports:{}},require:name=>{
 if(name==='./daytrade-baseline-transfer')return {cloneBaseline:value=>{clones++;return require('../lib/daytrade-baseline-transfer').cloneBaseline(value);}};
 if(name==='./daytrade-memory-runtime')return {createDetectionRuntime:options=>{getInputs=options.getInputs;return {start(){},stop(){},status:()=>({})};}};
 return require(name.startsWith('.')?path.resolve(path.dirname(file),name):name);
}};
new Function('require','module',fs.readFileSync(file,'utf8'))(context.require,context.module);
const make=()=>({tradeDate:'2026-10-01',calendar:{tradeDate:'2026-10-01',isTradingDay:true},identity:{trade_date:'2026-10-01'},activeSymbols:[{symbol:'2330'}],dailyVolumeMap:new Map([['2330',{volume:10}]]),supplementalMaps:{},readMemoryJson:()=>null});
for(const takeOwnership of [false,true]){
 const input=make(),before=clones;
 const service=context.module.exports.createMemoryService({endpoint:'unused',mergeQuote:(a,b)=>({...a,...b}),normalizeQuotes:()=>new Map(),evaluate:()=>[]});
 service.warmup(input,{takeOwnership});const result=getInputs();
 assert.equal(clones-before,takeOwnership?0:1);
 assert.equal(result.dailyVolumeMap===input.dailyVolumeMap,takeOwnership);
 assert.deepEqual(result.dailyVolumeMap,input.dailyVolumeMap);
}
console.log('PASS: ordinary warmup keeps copy isolation; privately decoded IPC input avoids a second graph clone');
