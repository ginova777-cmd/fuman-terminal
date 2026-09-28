'use strict';
const assert=require('node:assert/strict'),{build}=require('./premarket-plan-producer.cjs'),{directionFor}=require('./premarket-plan-contract.cjs');
const f=require('./premarket-validation-fixture.cjs').fixture();
const input={...f,now:f.tradeDate+'T08:59:50+08:00',mode:'live',universe:{verified:true,trade_date:f.tradeDate,source:'synthetic-test-only',rows:[{symbol:'3450',market:'TWSE'}]}};
const r=build(input);assert.equal(r.plan.rows.length,1);assert.equal(r.plan.coverage.scope,'captured_source_symbols');assert.equal(r.plan.coverage.full_market_verified,false);assert.equal(r.plan.rows[0].intraday_direction,'short');assert.equal(r.verification.complete,true);assert.equal(directionFor(r.plan,'3450',{tradeDate:f.tradeDate,now:f.asOf}).direction,'short');assert.equal(r.plan.rows[0].preopen_action,'NO_TRADE');assert.equal(r.plan.rows[0].order_allowed,false);assert(r.plan.order_unresolved_rules.includes('ADDITIONAL_VETO_RULES_PENDING'));assert.equal(r.plan.notifications_enabled,false);
assert.equal(build({...input,now:f.asOf}).plan.frozen_at,null);
assert.equal(build({...input,universe:null}).verification.complete,true);
const missing=build({...input,trialRows:[]});assert.equal(missing.plan.rows[0].data_complete,false);assert.equal(missing.plan.rows[0].intraday_direction,'none');
assert.equal(build({...input,mode:'replay'}).verification.complete,false);
const {validate,digest}=require('./premarket-plan-contract.cjs');
for(const mutate of [p=>p.rows[0].preopen_action='LIMIT_DOWN_SHORT',p=>p.rows[0].order_allowed=true,p=>p.notifications_enabled=true,p=>p.rows[0].observation_rule_ids=['A_UPPER_SHADOW_REBOUND_REVIEW'],p=>p.coverage.total=999]){const p=structuredClone(r.plan);mutate(p);p.rows_sha256=digest(p.rows);assert.equal(validate(p,{tradeDate:f.tradeDate,now:f.asOf}).complete,false);}
console.log('PASS fixed observation direction independent of deferred order veto; no orders or sends; explicit source-set coverage; replay rejected');
const {collect}=require('./premarket-source-collector.cjs');
assert.throws(()=>collect({runtimeRoot:'unused',now:'bad'}),/SOURCE_CLOCK_REQUIRED/);
const empty=collect({runtimeRoot:require('node:path').join(require('node:os').tmpdir(),'nonexistent-premarket-'+require('node:crypto').randomUUID()),now:input.now});
assert.equal(empty.snapshot.symbols.length,0);assert.equal(empty.calendar.verified,false);assert.equal(empty.baseDate,null);assert(empty.blockers.some(b=>b.reason==='SOURCE_FILE_MISSING'));
const fs=require('node:fs'),path=require('node:path'),temp=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'calendar-year-test-'));
try{fs.mkdirSync(path.join(temp,'state'));fs.writeFileSync(path.join(temp,'state','twse-holiday-schedule-2025.json'),JSON.stringify({cachedAt:'2026-09-27T00:00:00Z',rows:[{Date:'1150101',Name:'放假'}]}));assert.equal(require('./premarket-runtime-inputs.cjs').calendarFromCache({runtimeRoot:temp,tradeDate:'2025-09-24'}).reason,'CALENDAR_CACHE_YEAR_MISMATCH');}finally{fs.rmSync(temp,{recursive:true,force:true});}
