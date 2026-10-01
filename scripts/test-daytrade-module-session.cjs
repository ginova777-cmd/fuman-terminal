'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const gate=require('../lib/daytrade-module-session.cjs');
const at=t=>'2026-10-01T'+t+'+08:00';
for(const [time,phase] of [['05:59:59','CLOSED'],['06:00:00','PREOPEN'],['08:59:59','PREOPEN'],['09:00:00','INTRADAY'],['13:29:59','INTRADAY'],['13:30:00','CLOSED']])assert.equal(gate.session(at(time)),phase);
assert.equal(gate.session('invalid'),'CLOSED');
const policy={enabled:['A01','A19','B01','B24'],probe:'A02'};
assert.deepEqual(gate.select(policy,at('08:55:00')).enabled,['A01','A19']);
assert.deepEqual(gate.select(policy,at('09:00:00')).enabled,['B01','B24']);
assert.equal(gate.select(policy,at('09:00:00')).probe,null);
assert.deepEqual(gate.select(policy,at('13:30:00')).enabled,[]);
// Execute the actual Writer selector twice across 09:00 in the same round.
const source=fs.readFileSync(require.resolve('./run-daytrade-source-writer.js'),'utf8');
const start=source.indexOf('const moduleWorkIds = () => {'),end=source.indexOf('\n};',start)+3;
let time=at('08:59:59');
const context={moduleRecovery:policy,moduleSession:{select:p=>gate.select(p,time)}};
vm.runInNewContext(source.slice(start,end)+'; this.ids=moduleWorkIds;',context);
assert.deepEqual(Array.from(context.ids()),['A01','A19','A02']);time=at('09:00:00');
assert.deepEqual(Array.from(context.ids()),['B01','B24']);
// Out-of-session A producers must not create new receipt files.
const begin=source.indexOf('function writeModuleProducerReceipts('),finish=source.indexOf('\nasync function main()',begin);
const writes=[];const fixture={...context,require,readJson:()=>({modules:{A01:'a',A19:'a',B01:'b'}}),path:require('path'),__dirname:__dirname,runtimePath:()=>'/fixture',fs:{mkdirSync(){},existsSync:()=>false,writeFileSync:(file)=>writes.push(file)},SOURCE_NAME:'source',nowIso:()=>at('09:00:00'),moduleWorkIds:()=>[],moduleSession:{allowed:id=>gate.allowed(id,time)}};
vm.runInNewContext(source.slice(begin,finish)+';this.run=writeModuleProducerReceipts;',fixture);
fixture.run({payload:{}},'2026-10-01');assert.equal(writes.length,1);assert.match(writes[0],/b01-/);
assert.deepEqual(policy.enabled,['A01','A19','B01','B24']);
console.log('PASS: Taipei session boundaries, mid-round switch, probe gate, and preservation of preopen receipts');
