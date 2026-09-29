'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(require.resolve('./run-daytrade-source-writer'),'utf8').replace(/\r\n/g,'\n');
let previous={};
const context=vm.createContext({require,readJson:()=>previous,MOTHER_POOL_SNAPSHOT_FILE:'isolated',
 MOTHER_POOL_CONTRACT_VERSION:'4.1.0',normalizeCode:String,
 taipeiClockMinutesFrom:()=>600,motherPoolSnapshotType:()=> 'INTRADAY_FULL_SNAPSHOT'});
const start=source.indexOf('function buildMotherPoolSnapshot(');
assert.ok(start>=0);
vm.runInContext(source.slice(start,source.indexOf('\n}',start)+2),context);
const build=(symbols,time)=>context.buildMotherPoolSnapshot(symbols.map(symbol=>({symbol,poolReasons:['fixture'],updated_at:time})),symbols,
 '2026-09-17','fugle_daytrade_source:20260917:canonical',time);
previous=build(['2330'],'2026-09-17T02:00:00Z');
const original=JSON.stringify(previous);
assert.equal(previous.symbol_membership[0].membership_status,'PENDING_DOWNSTREAM_WARMUP');
assert.equal(JSON.stringify(build(['2330'],'2026-09-17T02:01:00Z')),original);
const next=build(['2330','2317'],'2026-09-17T02:02:00Z');
assert.equal(next.snapshot_sequence,2);
assert.notEqual(next.run_id,previous.run_id);
assert.equal(next.previous_run_id,previous.run_id);
assert.equal(next.symbol_membership.find(x=>x.symbol==='2330').membership_status,'PENDING_DOWNSTREAM_WARMUP');
assert.equal(JSON.stringify(previous),original);
previous={...previous,complete:false};
assert.throws(()=>build(['2330'],'2026-09-17T02:03:00Z'),/MOTHER_POOL_SNAPSHOT_REUSE_INVALID/);
console.log('PASS actual Writer: unchanged membership preserves full snapshot; added member creates next identity; invalid reuse rejected');
// Run the actual phase function too: unchanged membership must not leave an
// opening snapshot permanently active after market open or closeout.
context.taipeiClockMinutesFrom=value=>{const d=new Date(Date.parse(value)+28800000);return d.getUTCHours()*60+d.getUTCMinutes();};
const phaseStart=source.indexOf('function motherPoolSnapshotType(');
vm.runInContext(source.slice(phaseStart,source.indexOf('\n}',phaseStart)+2),context);
previous={};
previous=build(['2330'],'2026-09-17T00:59:00Z');
assert.equal(previous.snapshot_type,'OPENING_SNAPSHOT');
let transitioned=build(['2330'],'2026-09-17T01:00:00Z');
assert.equal(transitioned.snapshot_type,'INTRADAY_FULL_SNAPSHOT');
assert.equal(transitioned.snapshot_sequence,2);
previous=transitioned;
assert.equal(JSON.stringify(build(['2330'],'2026-09-17T01:01:00Z')),JSON.stringify(previous));
transitioned=build(['2330'],'2026-09-17T05:30:00Z');
assert.equal(transitioned.snapshot_type,'CLOSEOUT_SNAPSHOT');
assert.equal(transitioned.snapshot_sequence,3);
console.log('PASS actual Writer: opening/intraday/closeout transitions preserve immutable prior snapshots');
