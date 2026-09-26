'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./level-gate-fixture.cjs');
const {evaluate,verify,build}=require('./level-cross-gate.cjs');
test('same-bar touch and crossover qualifies, independently recomputed',()=>{const f=fixture();assert(f.event.gate.eligible);assert(f.event.gate.matches.some(x=>x.indicators.includes('KD')));assert.deepEqual(verify([f.event],[f.proof]),[]);});
test('a forged eligible flag, price or original event cannot pass',()=>{const f=fixture();for(const patch of [{gate:{...f.event.gate,eligible:false}},{primary_ratio:99}])assert(verify([{...f.event,...patch}],[f.proof]).length);assert(verify([f.event],[]).length);});
test('cross before trigger and fourth-bar cross are not accepted',()=>{const f=fixture();const old={...f.proof,event:{...f.proof.event,timestamp:'2026-09-16T09:54:00+08:00'}};assert.equal(evaluate(old).eligible,false);});
test('two-stage last allowed bars qualify; one extra minute on either stage expires',()=>{
 const f=fixture(),base=Date.parse('2026-09-16T09:28:00+08:00');
 const bars=Array.from({length:35},(_,i)=>{const p=i<27?105:i<30?100:104;return {stock_id:'3450',trade_date:'2026-09-16',timestamp:new Date(base+i*60000).toISOString(),open:p,high:p,low:p,close:p,complete:true,is_synthetic:false,timeframe:'1m'};});
 const data={...f.proof,bars,event:{...f.proof.event,timestamp:new Date(base+24*60000).toISOString()},now:new Date(base+31*60000).toISOString()};
 const r=evaluate(data);assert.equal(r.eligible,true);assert.equal(Date.parse(r.matches[0].touch_at)-Date.parse(data.event.timestamp),180000);assert.equal(Date.parse(r.matches[0].cross_at)-Date.parse(r.matches[0].touch_at),180000);
 assert.equal(evaluate({...data,event:{...data.event,timestamp:new Date(base+23*60000).toISOString()}}).eligible,false);
 const later=bars.map((b,i)=>i===30?{...b,open:100,high:100,low:100,close:100}:b);assert.equal(evaluate({...data,bars:later,now:new Date(base+32*60000).toISOString()}).eligible,false);
});
test('restart preserves original time and level source; repeat events do not reset deadlines',()=>{const f=fixture(),contexts={'3450':{bars:f.proof.bars,levelInput:f.proof.levelInput}};const a=build({events:[f.proof.event],contexts,now:f.proof.now,tradeDate:'2026-09-16'}),b=build({events:[f.proof.event],previous:JSON.parse(JSON.stringify(a.state)),contexts,now:f.proof.now,tradeDate:'2026-09-16'});assert.deepEqual(a,b);});
test('forming bars and next-day state cannot confirm',()=>{const f=fixture(),bars=f.proof.bars.map((b,i)=>i===30?{...b,complete:false}:b);assert.equal(evaluate({...f.proof,bars}).eligible,false);assert.equal(build({events:[],previous:[{event:f.proof.event}],contexts:{},now:'2026-09-17T09:59:00+08:00',tradeDate:'2026-09-17'}).events.length,0);});
