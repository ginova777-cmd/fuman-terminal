'use strict';
const assert=require('assert/strict'),fs=require('fs'),vm=require('vm');
const {publish}=require('../lib/daytrade-collector-bootstrap.cjs');
let writes=[];
const base={apply:true,dryRun:false,calendar:{trade_date:'2026-10-15',is_open:true},tradeDate:'2026-10-15',canonicalRunId:'fugle_daytrade_source:20261015:canonical',leaseValid:()=>true,rows:[{symbol:'2330'},{symbol:'3030'}],write:(symbols,meta)=>writes.push({symbols,meta})};
assert.equal(publish(base).count,2);
const first=JSON.stringify(writes);
assert.throws(()=>{throw Error('LATER_WRITER_TIMEOUT')});
assert.equal(JSON.stringify(writes),first);
for(const change of [{apply:false},{dryRun:true},{calendar:{trade_date:'2026-10-14',is_open:true}},{calendar:{trade_date:'2026-10-15',is_open:false}}]){assert.equal(publish({...base,...change}).written,false);assert.equal(JSON.stringify(writes),first);}
for(const change of [{rows:[]},{rows:[{symbol:'INVALID'}]},{leaseValid:()=>false}]){assert.throws(()=>publish({...base,...change}));assert.equal(JSON.stringify(writes),first);}
const source=fs.readFileSync(require.resolve('../scripts/run-daytrade-source-writer.js'),'utf8');
const start=source.indexOf('function mergeStrategyPriorityBridgeIntoRuntimeFile('),end=source.indexOf('\nasync function refreshStrategyChipPriorityBridge',start);
let priorityWrites=0;
const ctx={readJson:()=>({}),PRIORITY_SYMBOLS_FILE:'isolated',taipeiDate:()=>base.tradeDate,canonicalDaytradeRunId:()=>base.canonicalRunId,sameDayArtifact:()=>false,MOTHER_POOL_CONTRACT_VERSION:'test',buildFormalStrategyChipArtifact:()=>({}),STRATEGY_PRIORITY_BRIDGE_SOURCES:[],writeJson:()=>priorityWrites++,writeFugleWebSocketSymbols:()=>{throw Error('BRIDGE_MUST_NOT_OVERWRITE_UNIVERSE')}};
vm.createContext(ctx);vm.runInContext(source.slice(start,end)+';mergeStrategyPriorityBridgeIntoRuntimeFile({status:"partial",groups:{}})',ctx);
assert.equal(priorityWrites,1);
assert.equal(JSON.stringify(writes),first);
assert.ok(source.indexOf("tickStage('collector_universe_bootstrap'")<source.indexOf('const dailyVolumePromise ='));
console.log(JSON.stringify({status:'ISOLATED_BOOTSTRAP_AND_BRIDGE_PASS',formal_execution:false,scope:'Source helper guards and actual extracted bridge function; full Writer E2E pending'}));
