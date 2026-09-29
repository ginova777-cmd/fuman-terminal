'use strict';
const assert=require('node:assert/strict'),{build}=require('../lib/mother-pool-daily-volume-baseline'),{inspect}=require('../lib/verify-mother-pool-discovery-source');
const date='2026-09-18',asOf=date+'T10:00:00+08:00',checks=[];
for(let i=1;i<12;i++){const d=new Date(Date.parse(date+'T00:00:00Z')-i*86400000);checks.push({date:d.toISOString().slice(0,10),source:'cache',isTradingDay:![0,6].includes(d.getUTCDay())});}
const calendar={trade_date:date,status:'SESSION_DATES_VERIFIED',checks};
const dates=checks.filter(x=>x.isTradingDay).slice(0,5).map(x=>x.date);
const daily=build({symbol:'2330',tradeDate:date,calendar,rows:dates.map(trade_date=>({symbol:'2330',trade_date,volume_lots:100}))});
const row={symbol:'2330',totalVolume:250,avgVolume5:100,volumeRatio5:2.5,changePercent:2,source_evidence:{daily_baseline:daily,quote_event_at:asOf,quote:{price:102,previous_close:100,payload:{turnoverVolumeEvidence:{value:250000,unit:'shares',source:'fugle.websocket.aggregates.total.tradeVolume',event_at:asOf,is_synthetic:false}}}}};
if(require.main===module){
assert.equal(inspect(row,date,asOf).status,'SOURCE_VERIFIED');
for(const mutate of [r=>{r.volumeRatio5=3;},r=>{r.source_evidence.quote.payload.turnoverVolumeEvidence.unit='unknown';},r=>{r.source_evidence.daily_baseline.rows.pop();},r=>{r.source_evidence.quote_event_at=date+'T09:50:00+08:00';},r=>{r.source_evidence.quote.previous_close=null;},r=>{r.totalVolume=250000;}]){const bad=structuredClone(row);mutate(bad);assert.equal(inspect(bad,date,asOf).status,'DATA_GAP');}
console.log(JSON.stringify({status:'passed',checks:7,scope:'isolated',production_complete:false}));

}
module.exports={row,date,asOf};
