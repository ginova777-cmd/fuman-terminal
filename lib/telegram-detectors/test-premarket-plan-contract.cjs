'use strict';
const assert=require('assert/strict');
const {CONTRACT,costTopBuyer,digest,validate,directionFor}=require('./premarket-plan-contract.cjs');
const baseDate='2026-09-24',tradeDate='2026-09-29',symbol='3450';
const row=(id,price,buy,sell)=>({stock_id:symbol,date:baseDate,securities_trader_id:id,price,buy,sell});
let cost=costTopBuyer({symbol,baseDate,rows:[row('A',100,20,0),row('A',120,0,10),row('B',200,10,5)]});
assert.equal(cost.value,100); // Buy VWAP, not net amount/net volume.
assert.equal(cost.selected[0].buyCost,100);
cost=costTopBuyer({symbol,baseDate,rows:Array.from({length:16},(_,i)=>row(String(i).padStart(2,'0'),100+i,100-i,0))});
assert.equal(cost.selected.length,1);assert.equal(cost.selected.some(x=>x.id==='15'),false);
for(const bad of [[],[row('A',100,0,1)],[{...row('A',100,1,0),date:'2026-09-23'}],[{...row('A',100,1,0),buy:null}],[row('A',Infinity,1,0)]])assert.equal(costTopBuyer({symbol,baseDate,rows:bad}).valid,false);
const plan={contract:CONTRACT,base_date:baseDate,trade_date:tradeDate,calendar_verified:true,status:'complete',complete:true,mode:'live',source_verified:true,run_id:'plan-test',source_run_id:'source-test',frozen_at:tradeDate+'T08:59:30+08:00',rules_complete:true,unresolved_rules:[],coverage:{twse:1000,tpex:800,total:1800},rows:[{stock_id:symbol,scenario:'B1',preopen_action:'NO_TRADE',intraday_direction:'short',direction_qualified:true,data_complete:true,reasons:['WAIT_REBOUND_SHORT']}]};
plan.rows_sha256=digest(plan.rows);const ctx={tradeDate,now:tradeDate+'T09:01:00+08:00'};
assert.equal(validate(plan,ctx).complete,true);assert.equal(directionFor(plan,symbol,ctx).direction,'short');
assert.equal(directionFor(plan,'2330',ctx).direction,null);
for(const edit of [{trade_date:baseDate},{complete:false},{mode:'replay'},{rules_complete:false},{unresolved_rules:['WEAK_STRUCTURE']},{rows_sha256:'wrong'},{coverage:{twse:800,tpex:800,total:1600}},{frozen_at:tradeDate+'T09:00:00+08:00'},{calendar_verified:false}])assert.equal(validate({...plan,...edit},ctx).complete,false);
for(const edited of [[...plan.rows,...plan.rows],[{...plan.rows[0],intraday_direction:'both'}],[{...plan.rows[0],preopen_action:'LIMIT_UP_LONG'}],[{...plan.rows[0],direction_qualified:false}]])assert.equal(validate({...plan,rows:edited,rows_sha256:digest(edited)},ctx).complete,false);
console.log('PASS first net-buy broker buy-VWAP cost and premarket three-category contract: same-day freeze, direction conflict, no-trade watch, missing/unresolved/replay fail closed; no network');
const fixture=require('./level-gate-fixture.cjs').fixture(),directed=require('./premarket-directed-gate.cjs');
const naturalPlan={...plan,base_date:'2026-09-15',trade_date:'2026-09-16',frozen_at:'2026-09-16T08:59:00+08:00'};
function withDirection(direction){const rows=[{...plan.rows[0],intraday_direction:direction}];return {...naturalPlan,rows,rows_sha256:digest(rows)};}
let result=directed.evaluate({...fixture.proof,plan:withDirection('long')});
assert.equal(result.eligible,true);assert(result.matches.every(x=>x.direction==='long'));
result=directed.evaluate({...fixture.proof,plan:withDirection('short')});
assert.equal(result.eligible,false);assert(result.matches.every(x=>x.direction==='short'));
for(const invalid of [null,{...naturalPlan,complete:false},withDirection('none')])assert.equal(directed.evaluate({...fixture.proof,plan:invalid}).eligible,false);
console.log('PASS direction filtering before level evaluation; opposite-direction cross cannot mask or trigger the fixed direction');
