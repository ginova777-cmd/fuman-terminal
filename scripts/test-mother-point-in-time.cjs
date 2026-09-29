'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const d = require(path.join(process.argv[2], 'lib/intraday-context-detectors-b19-b24'));
const identity = {symbol:'2330',trade_date:'2026-09-17',canonical_run_id:'isolated-regression'};
const bar = {...identity,timestamp:'2026-09-17T09:09:00+08:00',high:110,low:90,synthetic:false,complete:true};
const input = {...identity,current_price:110,today_open:100,event_timestamp:'2026-09-17T09:10:00+08:00',bars_through_event:[bar]};
assert.equal(d.b23(input).new_high,true);
assert.equal(d.b23(input).source_contract_ok,true);
for(const key of ['symbol','trade_date','canonical_run_id','event_timestamp']) {
  assert.equal(d.b23({...input,[key]:undefined}).source_contract_ok,false,`missing ${key}`);
}
for(const changed of [{symbol:undefined},{symbol:'9999'},{trade_date:'2026-09-16',timestamp:'2026-09-16T09:09:00+08:00'},{timestamp:'2026-09-17T13:00:00+08:00'}]) {
  assert.equal(d.b23({...input,bars_through_event:[{...bar,...changed}]}).source_contract_ok,false,JSON.stringify(changed));
}
console.log('10 point-in-time positive/negative assertions passed; isolated only');
const opening={...identity,current_price:120,event_timestamp:'2026-09-17T09:05:00+08:00',opening_range_bars:Array.from({length:5},(_,i)=>({...bar,timestamp:`2026-09-17T09:0${i}:00+08:00`}))};
assert.equal(d.b22(opening).source_contract_ok,true);
assert.equal(d.b22(opening).break_direction,'UP');
for(const key of ['symbol','trade_date','canonical_run_id','event_timestamp']) {
  assert.equal(d.b22({...opening,[key]:undefined}).source_contract_ok,false,`B22 missing ${key}`);
}
for(const changed of [{symbol:'9999'},{symbol:undefined},{timestamp:'2026-09-16T09:00:00+08:00'},{complete:false},{synthetic:true},{high:null}]) {
  const bad=d.b22({...opening,opening_range_bars:opening.opening_range_bars.map((b,i)=>i===0?{...b,...changed}:b)});
  assert.equal(bad.source_contract_ok,false);assert.equal(bad.break_direction,null);
}
assert.equal(d.b22({...opening,event_timestamp:'2026-09-17T09:04:30+08:00'}).source_contract_ok,false);
console.log('19 opening-range positive/negative assertions passed; isolated only');
