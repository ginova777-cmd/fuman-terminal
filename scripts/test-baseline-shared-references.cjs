const assert=require('node:assert/strict'),v8=require('node:v8');
const {encodeBaseline,decodeBaseline,cloneBaseline}=require('../lib/daytrade-baseline-transfer');
const calendar={trade_date:'2026-10-01',session_dates:Array.from({length:15},(_,i)=>'2026-09-'+String(i+1).padStart(2,'0'))};
const baseline={calendar,dailyVolumeMap:new Map(Array.from({length:2034},(_,i)=>[String(1000+i),{calendar,history:{calendar},volume:i}]))};
baseline.dailyVolumeMap.source='exact';
const encoded=encodeBaseline(baseline),bytes=v8.serialize(encoded),roundtrip=decodeBaseline(v8.deserialize(bytes));
assert.deepEqual(roundtrip,baseline);assert.notEqual(roundtrip,baseline);assert.notEqual(roundtrip.calendar,calendar);
assert.equal(roundtrip.dailyVolumeMap.get('1000').calendar,roundtrip.calendar);
assert.equal(roundtrip.dailyVolumeMap.get('3033').history.calendar,roundtrip.calendar);
// Shared metadata must not be expanded once per symbol by advanced IPC.
const expanded=JSON.parse(JSON.stringify(encoded));const expandedBytes=v8.serialize(expanded).length;
assert(bytes.length<expandedBytes/3,{bytes:bytes.length,expandedBytes});
const extra=new Map();extra.meta={date:new Date('2026-10-01'),set:new Set(['x'])};const copy=cloneBaseline({a:extra,b:extra});
assert.equal(copy.a,copy.b);assert.deepEqual(copy.a.meta,extra.meta);assert.notEqual(copy.a.meta,extra.meta);
const cycle={};cycle.self=cycle;assert.throws(()=>encodeBaseline(cycle),/BASELINE_TRANSFER_CYCLE/);
assert.equal(decodeBaseline({kind:'value',value:42}),42);
console.log(JSON.stringify({pass:true,symbols:2034,shared_wire_bytes:bytes.length,expanded_wire_bytes:expandedBytes,scope:'isolated_fixture_not_production_measurement'}));
