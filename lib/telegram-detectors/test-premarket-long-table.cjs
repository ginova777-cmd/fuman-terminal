'use strict';
const assert=require('node:assert/strict');
const {assess,ID}=require('./premarket-long-table.cjs');
const {runValidation}=require('./premarket-validation-flow.cjs');
const {build}=require('./premarket-plan-producer.cjs');
const {validate,digest,directionFor}=require('./premarket-plan-contract.cjs');
const clone=x=>structuredClone(x);
const input={current:{kd:{k:51,d:41},rsi:{short:51,long:41},macd:{histogram:0}},previous:{kd:{k:50,d:40},rsi:{short:50,long:40},macd:{histogram:1}},history:['2026-09-11','2026-09-14','2026-09-15'].map(date=>({date})),foreignHistory:['2026-09-11','2026-09-14','2026-09-15'].map(date=>({date,net:1})),baseDate:'2026-09-15',trial:{verified:true,price:99},previousClose:100,cost:101};
assert.equal(assess(input).status,'matched');assert.equal(assess(input).target,104.03);
for(const mutate of [x=>x.current.kd.k=50,x=>x.foreignHistory[1].net=0,x=>x.trial.price=100,x=>x.cost=99]){const x=clone(input);mutate(x);assert.equal(assess(x).status,'not_matched');}
for(const mutate of [x=>x.foreignHistory.splice(1,1),x=>x.foreignHistory.push(x.foreignHistory[1]),x=>x.trial.verified=false,x=>x.current.kd.k=null]){const x=clone(input);mutate(x);assert.equal(assess(x).status,'insufficient_data');}
function longFixture(){
 const f=require('./premarket-validation-fixture.cjs').fixture(),s=f.snapshot.symbols[0];
 for(const [i,r]of s.price_rows.entries()){const c=i===s.price_rows.length-1?104:100+Math.sin(i)*3;r.open=c;r.close=c;r.min=c-1;r.max=c+1;}
 s.branch_rows[0].price=105;
 for(const r of s.institutional_rows){r.buy=100;r.sell=0;}
 f.trialRows[0].trial_price=102;return f;
}
const f=longFixture(),audit=runValidation(f),row=audit.rows[0];
assert.equal(row.long_table_rule.status,'matched');assert.equal(row.direction_candidate,'long');assert.equal(row.preopen_recommendation,'LIMIT_UP_LONG');assert.equal(row.recommendation_target,108.15);assert.equal(row.preopen_action,'NO_TRADE');assert.equal(audit.notifications_sent,0);
const result=build({...f,now:f.tradeDate+'T08:59:50+08:00',mode:'live'});
assert.equal(result.verification.complete,true,JSON.stringify(result.verification));assert.equal(directionFor(result.plan,'3450',{tradeDate:f.tradeDate,now:f.asOf}).direction,'long');
for(const mutate of [p=>p.rows[0].recommendation_target=999,p=>p.rows[0].order_allowed=true,p=>p.rows[0].preopen_action='LIMIT_UP_LONG',p=>p.rows[0].long_table_rule.foreign_history[1].net=0,p=>p.rows[0].intraday_direction='short',p=>p.notifications_enabled=true]){const p=clone(result.plan);mutate(p);p.rows_sha256=digest(p.rows);assert.equal(validate(p,{tradeDate:f.tradeDate,now:f.asOf}).complete,false);}
const missing=longFixture();missing.snapshot.symbols[0].institutional_rows=missing.snapshot.symbols[0].institutional_rows.filter(r=>!(r.name==='Foreign_Investor'&&r.date===missing.snapshot.symbols[0].price_rows.at(-2).date));assert.equal(runValidation(missing).rows[0].direction_candidate,'none');
const conflict=longFixture();conflict.trialRows[0].trial_price=90;conflict.snapshot.symbols[0].institutional_rows.find(r=>r.name==='Investment_Trust'&&r.date===f.baseDate).sell=200;const c=runValidation(conflict).rows[0];assert.equal(c.long_table_rule.status,'matched');assert(c.blockers.includes('DIRECTION_CONFLICT'));assert.equal(c.direction_candidate,'none');assert.equal(c.preopen_recommendation,'WAIT_CONFIRM');
console.log('PASS table long: 2/3 rising, exact 3 foreign days, low open below cost, cost target, conflict blocking, frozen long consumer, no order/send');
module.exports={longFixture};
