'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const {selectHistory}=require('../lib/mother-pool-history-input');
const file=process.argv.find(x=>x.startsWith('--input='))?.slice(8);
if(!file)throw Error('INPUT_REQUIRED');
const artifact=JSON.parse(fs.readFileSync(file,'utf8'));
const context={symbol:artifact.symbol,tradeDate:artifact.trade_date,asOf:artifact.result.fetched_at,minute:'09:22'};
const good=selectHistory(artifact,context);
assert(good.rows.length>0&&good.rows.length<=40);
assert(good.rows.every(r=>r.trade_date<context.tradeDate));
for(const mutate of [a=>a.calendar_verified=false,a=>a.trade_date='2000-01-01',a=>a.result.raw.data[0].volume++,a=>a.requested_sessions.pop(),a=>a.calendar.checked_at='2099-01-01T00:00:00Z']){
 const bad=structuredClone(artifact);mutate(bad);assert.throws(()=>selectHistory(bad,context));
}
assert.throws(()=>selectHistory(artifact,{...context,asOf:'2026-09-17T01:00:00Z'}));
console.log(JSON.stringify({status:'PASS',selected_history_rows:good.rows.length,source:'actual saved response',historical_input_validated:true,production_written:false,complete:false}));
