'use strict';
const assert=require('node:assert/strict');
const {createWarmupLoader}=require('../lib/daytrade-memory-warmup');
const base={tradeDate:'2026-09-30',revision:'isolated',identity:{trade_date:'2026-09-30',canonical_run_id:'isolated'},calendar:{tradeDate:'2026-09-30',isTradingDay:true},readMemoryJson:()=>null};
const names=['dailyVolumeMap','capitalMap','chipMap','marginChangeMap','stockGroupContractMap','preopenReferencePriceMap'];
const loaders={activeSymbols:async()=>[{symbol:'1101'},{symbol:'1102'}],...Object.fromEntries(names.map(n=>[n,async()=>new Map([['1101',{value:1}]])]))};
(async()=>{
 const failing={...loaders,capitalMap:async()=>{throw Error('isolated DB timeout');}};
 await assert.rejects(createWarmupLoader().load({...base,loaders:failing}),/WARMUP_SOURCE_READ_FAILED/);
 const partial=await createWarmupLoader().load({...base,loaders:failing,allowPartialSources:true});
 assert.equal(partial.baseline_complete,false);assert.equal(partial.activeSymbols.length,2);assert.equal(partial.supplementalMaps.capitalMap.size,0);
 assert.deepEqual(partial.warmup_failures,[{source:'capitalMap',reason:'isolated DB timeout'}]);assert.equal(partial.dailyVolumeMap.size,1);
 await assert.rejects(createWarmupLoader().load({...base,loaders:{...failing,activeSymbols:async()=>{throw Error('master missing');}},allowPartialSources:true}),/WARMUP_SOURCE_READ_FAILED/);
 const {completeHistoryWarmup}=require('../lib/daytrade-memory-history-warmup'); const degraded=await completeHistoryWarmup(partial,async()=>{throw Error('HISTORY_READ_HTTP_503');});assert.equal(degraded.history,null);assert.equal(degraded.warmup_failures.length,2);assert.equal(degraded.activeSymbols.length,2);assert.equal(degraded.baseline_complete,false); const history={rows:[],data_gaps:[{symbol:'1101'}]};assert.deepEqual((await completeHistoryWarmup(partial,async()=>history)).history,history);
 const healthy=await createWarmupLoader().load({...base,loaders,allowPartialSources:true});assert.equal(healthy.baseline_complete,true);
 console.log(JSON.stringify({pass:true,scope:'isolated_partial_warmup',checks:['strict_default_preserved','full_universe_retained','missing_source_explicit','no_invented_baseline','master_failure_still_blocks'],production_active:false}));
})().catch(e=>{console.error(e);process.exitCode=1;});

