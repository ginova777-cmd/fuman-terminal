'use strict';
const assert=require('node:assert/strict'),fs=require('fs'),path=require('path');const {derive,impacted,source_hash}=require('./candle-derived.cjs');
const date='2026-10-06',asOf=date+'T13:00:00+08:00';
const rows=Array.from({length:40},(_,i)=>({symbol:'2330',trade_date:date,candle_time:new Date(Date.parse(date+'T12:59:00+08:00')-i*60000).toISOString(),open:100+i,high:102+i,low:99+i,close:101+i,volume:10+i}));
const tests=[];function test(name,f){f();tests.push({name,status:'PASS'});}
test('exact original grouped mapper retains supplied ordering and full fields',()=>{const r=derive(rows,date,asOf)[0][1];assert.equal(r.ma3,102);assert.equal(r.ma20,110.5);assert.equal(r.today_candle_count,40);assert(Number.isFinite(r.kd_k));});
test('per-symbol update equals full-market original recomputation subset',()=>{const other=rows.map(r=>({...r,symbol:'3163'}));const changed=rows.map((r,i)=>i===35?{...r,close:r.close+.5}:r);assert.deepEqual(derive(changed,date,asOf),derive([...changed,...other],date,asOf).filter(([s])=>s==='2330'));});
test('invalidation removes contribution instead of retaining old good K',()=>assert.equal(derive(rows.slice(1),date,asOf)[0][1].today_candle_count,39));
test('older-minute revision invalidates recursive indicators through current end',()=>{const r=impacted({symbol:'2330',minute:rows[35].candle_time});assert(r.resources.includes('MACD'));assert.equal(r.scope,'REVISED_MINUTE_THROUGH_CURRENT_END');assert.equal(r.historical_notification_replay,false);});
test('history revision invalidates all current historical-dependent windows',()=>assert.equal(impacted({symbol:'2330',minute:'2026-10-05T01:00:00Z',historyRevision:true}).scope,'ALL_CURRENT_AND_HISTORY_DEPENDENT_WINDOWS'));
fs.writeFileSync(path.join(__dirname,'receipts/derived-tests.json'),JSON.stringify({status:'PASS',tests,source_hash,synthetic:true,scope:'Candle-derived original grouping and invalidation descriptors; all supplemental resources require their own frozen evidence'},null,2));console.log(JSON.stringify({status:'PASS',count:tests.length}));
