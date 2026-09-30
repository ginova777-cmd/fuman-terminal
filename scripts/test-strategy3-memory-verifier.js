'use strict';
const fs=require('fs'),path=require('path'),Module=require('module'),assert=require('node:assert/strict'),crypto=require('crypto');
const dir=__dirname,stage=path.resolve(__dirname,'..');
const {createSnapshotStore}=require('../lib/daytrade-volatile-snapshot');
const {createReader}=require('../lib/strategy3-volatile-water-reader');
const contract=require('./strategy3-v2-contract');
let now=Date.now(),minute=Math.floor(now/60000)*60000;const date=contract.taipeiDate(),canonical='fugle_daytrade_source:'+date.replace(/-/g,'')+':canonical';
const symbols=Array.from({length:10},(_,i)=>String(1000+i)),store=createSnapshotStore({now:()=>now});
const rows=symbols.map(symbol=>({symbol})),quotes=symbols.map(symbol=>({symbol,trade_date:date,price:106,previous_close:100,change_percent:6,quote_seen_at:new Date(minute).toISOString(),last_trade_time:new Date(minute).toISOString(),total_volume:1000,total_volume_unit:'lots',total_volume_available:true,is_synthetic:false,total_volume_source:'isolated',total_volume_source_event_at:new Date(minute).toISOString()}));
const publish=()=>store.publish({trade_date:date,canonical_run_id:canonical,observed_at:new Date(now).toISOString(),rows,quotes,source_evidence:{contract:'mother-pool-memory-readiness-v1',trade_date:date,canonical_run_id:canonical,formal_ready:true,formal_entry_allowed:true}});publish();
let changed=false,scan,captured;
const reader=createReader({now:()=>now,isTradingDay:async()=>true,readSnapshot:async args=>{if(!args.leaseId){const lease=store.acquireLease(args);args={tradeDate:date,snapshotId:lease.snapshot_id,leaseId:lease.lease_id};}return store.read(args);},readCandles:async({asOf})=>{const data=symbols.flatMap(symbol=>Array.from({length:20},(_,i)=>({symbol,trade_date:date,candle_time:new Date(minute-(20-i)*60000).toISOString(),open:100,high:107,low:99,close:106,volume:changed?11:10,synthetic:false,volume_strategy_usable:true})));data.readback={source:'fugle_daytrade_intraday_1m',as_of:asOf,rows:data.length,sha256:crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex')};return data;}});
(async()=>{
 const initial=await reader({tradeDate:date});assert.equal(initial.ok,true,initial.firstBlocker);
 scan={ok:true,status:'COMPLETE',apply:true,trade_date:date,run_id:'strategy3v2-'+date.replace(/-/g,'')+'-isolated',scanner_source:initial.receipt.scanner_source,source_mode:initial.receipt.source_mode,source_field_contract:initial.receipt.source_field_contract,mother_pool_snapshot:initial.receipt.mother_pool_snapshot,mother_pool_rows:10,canonical_run_id:canonical,result_count:0,results:[],candle_readback:initial.receipt.candle_readback};
 for(let i=0;i<5;i++){now+=1000;publish();}
 const filename=path.join(__dirname,'verify-strategy3-v2-water-universe.js'),m=new Module(filename,module);m.filename=filename;m.paths=Module._nodeModulePaths(path.dirname(filename));const orig=m.require.bind(m);
 m.require=name=>name==='./strategy3-v2-contract'?{...contract,readJson:()=>scan,writeJson:(file,value)=>{captured=value;}}:name==='../lib/daytrade-canonical-water-reader'?{readCanonicalDaytradeWater:reader}:orig(name);
 let text=fs.readFileSync(path.join(stage,'scripts/verify-strategy3-v2-water-universe.js'),'utf8');const end=text.indexOf('main().catch(');assert(end>0);text=text.slice(0,end)+'module.exports={run:main};';m._compile(text,filename);
 const log=console.log;try{console.log=()=>{};await m.exports.run();assert.equal(captured.ok,true,JSON.stringify(captured.failed_checks));changed=true;await m.exports.run();assert.equal(captured.ok,false);assert(captured.failed_checks.includes('strategy3_pinned_candle_readback_changed'));scan.mother_pool_snapshot.identity.snapshot_id='wrong';await m.exports.run();assert.equal(captured.ok,false);}finally{console.log=log;process.exitCode=0;}
 const result={pass:true,scope:'isolated_actual_water_verifier_with_in_memory_receipts',production_writes:0,checks:['same_snapshot_after_new_rounds','original_candle_hash_matches','changed_candles_fail','wrong_snapshot_fails'],complete:false};console.log(JSON.stringify(result));
})().catch(e=>{console.error(e);process.exitCode=1;});
