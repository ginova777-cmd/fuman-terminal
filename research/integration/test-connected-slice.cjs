'use strict';
const fs=require('fs'),os=require('os'),path=require('path'),assert=require('node:assert/strict');
const {CandleLifecycle}=require('../phase2/candle-lifecycle.cjs'),{derive}=require('../phase3/candle-derived.cjs');
const {IncrementalDiscovery}=require('../phase3/incremental-discovery.cjs'),{createOracle}=require('../phase3/original-oracle.cjs'),{fixture,quote}=require('../phase3/fixture.cjs');
const {OfflineStore}=require('./offline-store.cjs'),{evaluate}=require('./evaluate-routed.cjs'),{bind}=require('./routing-contract.cjs'),fx=require('../phase4/fixtures.cjs');
async function main(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mp-chain-')),date='2026-10-08',epoch='fixture-chain',t=Date.parse(date+'T12:59:00+08:00'),asOf=new Date(t+60000).toISOString();
 const opt={directory:path.join(dir,'phase2'),tradeDate:date,epoch};let life=new CandleLifecycle(opt);
 const raw={symbol:'1000',market:'TSE',tradeDate:date,candleTime:new Date(t).toISOString(),candleSeenAt:new Date(t+10000).toISOString(),source:'fugle-ws-candles',sourceChannel:'candles',candleOrigin:'websocket_candle',restRepairRow:false,intradayOddLot:false,synthetic:false,volumeStrategyUsable:true,open:105,high:107,low:104,close:106,volume:100};
 assert.equal(life.apply({sequence:1,rows:[raw],nowMs:t+10000}).length,0);
 life=new CandleLifecycle(opt);const events=life.apply({sequence:2,nowMs:t+60000});assert.equal(events.length,1);
 const row=events[0].payload,data=fx.data('1000',{date});data.current[data.current.length-1]={stock_id:row.symbol,trade_date:row.trade_date,timestamp:row.candle_time,open:row.open,high:row.high,low:row.low,close:row.close,volume_raw:row.volume,volume_raw_unit:row.payload.volume_unit.toUpperCase(),complete:true,is_synthetic:row.synthetic,source:'Fugle.websocket.candles.TSE_OTC',available_at:row.updated_at};
 const mapped=data.current.map(b=>({symbol:b.stock_id,trade_date:b.trade_date,candle_time:b.timestamp,...b,volume:b.volume_raw})).reverse();
 const snap=fixture(2);snap.epoch=epoch;const engine=new IncrementalDiscovery({oracle:createOracle()});engine.baseline(snap);
 const d=engine.process({epoch,tradeDate:date,sequence:1,continuity:'CONTIGUOUS',asOf,events:[{resource:'intradayMap',symbol:'1000',value:derive(mapped,date,asOf)[0][1]},{resource:'quoteMap',symbol:'1000',value:quote('1000',106,20000,asOf)},{resource:'quoteMap',symbol:'1001',value:quote('1001',1,20000,asOf)}]});assert.equal(d.status,'OFFLINE_EVALUATED');
 const binding=bind({trade_date:date,epoch,activeSymbols:['1000','1001'],prioritySymbols:[],sourceAnchors:{fixture:{epoch,trade_date:date,sequence:0,commit_hash:'fixture-baseline'}}});
 const store=new OfflineStore(path.join(dir,'phase4'));const args={store,binding,input:{discovery:d,changedSymbols:['1000','1001'],candleSymbols:['1000','1001'],asOf},changes:{'1000':{symbol:'1000',trade_date:date,verified:true,data}},gate:fx.gate(binding.sha256,{date,asOf}),backfill:async s=>({symbol:s,trade_date:date,verified:true,data:fx.data(s,{date})}),sequence:1,sourceCursor:{status:'OFFLINE_FIXED_SEGMENT',epoch,phase2_sequence:2,event_ids:events.map(e=>e.event_id),phase3_checkpoint_hash:engine.checkpoint().sha256}};
 await assert.rejects(evaluate({...args,fault:'AFTER_RENAME'}),/CRASH/);
 life=new CandleLifecycle(opt);assert.equal(life.state.outbox.length,1);assert.equal(store.root().sourceCursor.phase2_sequence,2);
 assert.equal((await evaluate({...args,store:new OfflineStore(path.join(dir,'phase4'))})).status,'REPLAY_DEDUP');life.ack(events.map(e=>e.event_id));assert.equal(life.state.outbox.length,0);
 assert(store.root().telegram['1001']);assert(!store.root().strategy['1001']);
 const report={status:'SYNTHETIC_CONNECTED_SLICE_PASS',forming_to_complete_without_ws:true,phase2_derived_phase3_routing_phase4:true,crash_after_phase4_before_phase2_ack_replay:true,all_market_telegram_preserved:true,notifications_sent:0,full_e2e:false,limitations:['frozen invocation replay; no autonomous cross-stage coordinator yet','quote/supplemental baseline fixtures','no natural data or historical-arrival proof'],peak_rss_kib:process.resourceUsage().maxRSS,io:store.io};
 fs.writeFileSync(path.join(__dirname,'connected-slice.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
main().catch(e=>{console.error(e);process.exitCode=1});
