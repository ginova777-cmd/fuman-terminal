'use strict';
const assert=require('node:assert/strict');
const volume=require('../lib/telegram-detectors/volume-detector.cjs'),price=require('../lib/telegram-detectors/price-detector.cjs');
const {collect}=require('../lib/mother-pool-anomaly-module-producer');
const {verify}=require('../lib/verify-mother-pool-anomaly-row');
const date='2026-09-18',canonical='fugle_daytrade_source:20260918:canonical',asOf=date+'T09:32:01+08:00';
let close=100;const current=Array.from({length:22},(_,i)=>{const old=close;close*=i===21?0.95:i%2?1.01:0.99;const t=Date.parse(date+'T09:10:00+08:00')+i*60000;return {stock_id:'1101',trade_date:date,timestamp:new Date(t).toISOString(),open:old,high:Math.max(old,close),low:Math.min(old,close),close,volume_raw:i===21?400:100,volume_raw_unit:'LOTS',complete:true,is_synthetic:false,available_at:new Date(t+60000).toISOString(),source:'Fugle.websocket.candles.TSE_OTC'};});
const input={stock_id:'1101',trade_date:date,current,history:[],as_of:asOf};
const v=volume.detect(input).rows.at(-1),p=price.detect(input).rows.at(-1);
const identity={trade_date:date,canonical_run_id:canonical,mother_pool_run_id:'s1',snapshot_sequence:1};
const evidence={...identity,details:[{symbol:'1101',current,history:[],volume:v,price:p,failed_checks:[]}]};
const plans=collect({identity,symbols:['1101','2330'],evidence,asOf});
for(const plan of plans){assert.equal(plan.rows[0].status,'READY');assert.equal(plan.rows[1].status,'DATA_GAP');assert(verify(plan.module_id,{...plan.rows[0],trade_date:date},asOf));}
assert.equal(plans[0].rows[0].event_detected,true);assert.equal(plans[1].rows[0].event_detected,false);assert.equal(plans[1].rows[0].ratio,null);assert.equal(plans[2].rows[0].event_detected,true);
const bad={...plans[2].rows[0],trade_date:date,ratio:1,price_spike_ratio:1,event_detected:false};assert(!verify('B19',bad,asOf));
const changed=structuredClone(plans[0].rows[0]);changed.current[0].volume_raw=999999;changed.current[1].volume_raw=999999;changed.sample_count=1;assert(!verify('B12',{...changed,trade_date:date},asOf));
const future=structuredClone(plans[2].rows[0]);future.current.at(-1).available_at=date+'T10:00:00+08:00';assert(!verify('B19',{...future,trade_date:date},asOf));
console.log(JSON.stringify({status:'passed',scope:'isolated',checks:9,production_complete:false}));
