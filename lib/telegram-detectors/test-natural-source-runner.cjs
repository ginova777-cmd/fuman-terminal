'use strict';
const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {produce}=require('./natural-source-runner.cjs');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'telegram-source-unit-'));
const write=(p,x)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,typeof x==='string'?x:JSON.stringify(x));};
const date='2026-09-16',symbol='3450',base=Date.parse(date+'T09:00:00+08:00'),candles=[],journal=[],trades=[];let total=0,bid=0,ask=0;
for(let i=0;i<33;i++){
 const time=base+i*60000,evt=time+59000,size=i===32?100:10;total+=size;bid+=i===32?10:2;ask+=i===32?90:8;
 candles.push({symbol,market:'TSE',tradeDate:date,candleTime:new Date(time).toISOString(),candleSeenAt:new Date(evt).toISOString(),synthetic:false,volumeStrategyUsable:true,intradayOddLot:false,open:100+i,high:100+i,low:100+i,close:100+i,volume:size});
 const received_at=new Date(evt+100).toISOString();
 trades.push({stock_id:symbol,trade_date:date,is_synthetic:false,volume_unit:'LOTS',received_at,trade:{serial:i+1,time:evt*1000,size,volume:total,price:100+i}});
 journal.push({stock_id:symbol,trade_date:date,aggregation:'DAY_CUMULATIVE',volume_unit:'LOTS',provider_source:'Fugle.aggregates.total',is_synthetic:false,is_trial:false,received_at,event_at:new Date(evt).toISOString(),event_time_microseconds:evt*1000,identity:'unit-fixture-'+i,total:{tradeVolume:total,tradeVolumeAtBid:bid,tradeVolumeAtAsk:ask}});
}
write(path.join(root,'cache/intraday/fugle-daytrade-ws-candles-v2.json'),{candles});write(path.join(root,'cache/intraday/fugle-daytrade-ws-quotes-v2.json'),{quotes:[{code:symbol,totalVolumeSourceEventAt:journal.at(-1).event_at,prevClose:99}]});
write(path.join(root,'data/provider-side-journal',date,symbol+'.jsonl'),journal.map(JSON.stringify).join('\n'));
write(path.join(root,'data/provider-trade-journal',date,symbol+'.jsonl'),trades.map(JSON.stringify).join('\n'));
const now=new Date(base+33*60000).toISOString();
const x=produce({runtimeRoot:root,now});assert.deepEqual(x.proof.failed_checks,[]);assert.equal(x.proof.complete,true);assert.equal(x.events.length,3);assert.equal(x.events.filter(e=>e.event_type.includes('OUTSIDE')).length,2);
const stale=produce({runtimeRoot:root,now:new Date(base+36*60000).toISOString()});assert.equal(stale.proof.complete,false);assert.equal(stale.events.length,0);
write(path.join(root,'data/provider-side-journal',date,symbol+'.jsonl'),'');const missing=produce({runtimeRoot:root,now});assert.equal(missing.proof.complete,true);assert(missing.proof.pending_modules.includes('outside'));assert.equal(missing.events.length,1);assert.equal(missing.events[0].event_type,'VOLUME_ANOMALY_EVENT');
write(path.join(root,'cache/intraday/fugle-daytrade-ws-candles-v2.json'),{candles:candles.map(x=>({...x,volume:null,volumeStrategyUsable:false}))});
const noVolume=produce({runtimeRoot:root,now});assert.equal(noVolume.proof.ready_counts.price,1);assert.equal(noVolume.proof.ready_counts.volume,0);
write(path.join(root,'data/provider-side-journal',date,symbol+'.jsonl'),journal.map(JSON.stringify).join('\n'));
write(path.join(root,'cache/intraday/fugle-daytrade-ws-candles-v2.json'),{candles:candles.map(x=>({...x,close:null}))});
const noPrice=produce({runtimeRoot:root,now});assert.equal(noPrice.proof.ready_counts.outside,1);assert.equal(noPrice.events.length,2);
console.log('PASS independent minute source, three eligible events, stale rejection, missing journal rejection; fixture only');
fs.rmSync(root,{recursive:true});
