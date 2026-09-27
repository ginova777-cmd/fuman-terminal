'use strict';
const assert=require('node:assert/strict');
const calendarRules=require('../../scripts/twse-trading-day');
assert.equal(calendarRules.isClosedRow({Name:'和平紀念日',Description:'於2月27日（星期五）補假。'}),true);
assert.equal(calendarRules.isClosedRow({Name:'補行交易',Description:'恢復交易'}),false);
assert.equal(calendarRules.readTradingDayOverride(require('node:path').join(__dirname,'../../data'),'2026-07-10').isTradingDay,false);
const {fixture}=require('./premarket-validation-fixture.cjs');
const {runValidation}=require('./premarket-validation-flow.cjs');
const {trialAt0859,checkCalendar}=require('./premarket-validation-sources.cjs');
const calendarInput={calendar:{verified:true,source:'test-current-year',trading_dates:['2026-01-02','2026-01-05','2026-01-06']},baseDate:'2026-01-05',tradeDate:'2026-01-06',history:[{date:'2025-12-31'},{date:'2026-01-02'},{date:'2026-01-05'}]};
const separate=checkCalendar(calendarInput);assert.equal(separate.complete,true);assert.equal(separate.historical.complete,false);assert.equal(separate.historical.reason,'HISTORICAL_CALENDAR_NOT_COVERED');
const gap=checkCalendar({...calendarInput,history:[{date:'2025-12-31'},{date:'2026-01-05'}]});assert.equal(gap.complete,true);assert.equal(gap.historical.reason,'DAILY_HISTORY_CALENDAR_GAP');
assert.equal(checkCalendar({...calendarInput,baseDate:'2026-01-02'}).complete,false);
const input=fixture(),result=runValidation(input);
assert.equal(result.rows[0].direction_candidate,'short');
assert(result.observations.some(o=>o.gate.eligible));
assert(result.observations.filter(o=>o.gate.eligible).every(o=>o.gate.matches.every(m=>m.direction==='short')));
assert.equal(result.notifications_sent,0);assert.equal(result.complete,false);
assert(result.notification_previews.some(n=>n.category==='intraday_direction'));
assert(result.notification_previews.every(n=>n.sent===false));
for(const mutate of [x=>x.trialRows=[],x=>x.calendar=null,x=>x.snapshot.symbols[0].branch_rows=[],x=>x.snapshot.symbols[0].fetched_at=x.tradeDate+'T09:01:00+08:00']){
 const x=structuredClone(input);mutate(x);const r=runValidation(x);assert.equal(r.rows[0].direction_candidate,'none');assert(r.observations.every(o=>!o.gate.eligible));assert.equal(r.notifications_sent,0);
}
for(const minute of ['08:58:59','09:00:00']){
 const rows=structuredClone(input.trialRows);rows[0].observed_at=input.tradeDate+'T'+minute+'+08:00';rows[0].payload.observed_at=rows[0].observed_at;
 assert.equal(trialAt0859({rows,symbol:'3450',tradeDate:input.tradeDate,asOf:input.asOf}).verified,false);
}
const conflict=structuredClone(input.trialRows);conflict.push({...conflict[0],trial_price:99});assert.equal(trialAt0859({rows:conflict,symbol:'3450',tradeDate:input.tradeDate,asOf:input.asOf}).verified,false);
const equivalent=structuredClone(input.trialRows);equivalent.push({...equivalent[0]});const utc=new Date(Date.parse(equivalent[0].observed_at)).toISOString();equivalent.push({...equivalent[0],trial_price:99,observed_at:utc,payload:{...equivalent[0].payload,observed_at:utc}});assert.equal(trialAt0859({rows:equivalent,symbol:'3450',tradeDate:input.tradeDate,asOf:input.asOf}).verified,false);
assert.equal(runValidation({...input,symbols:[]}).status,'empty');
const stale=runValidation({...input,asOf:input.tradeDate+'T10:02:00+08:00'});
assert(stale.observations.some(o=>o.blocking_reasons.includes('CONFIRMATION_OUTSIDE_120_SECONDS')));
assert(!stale.notification_previews.some(n=>n.category==='intraday_direction'));
assert.throws(()=>runValidation({...input,symbols:['3450','3450']}),/INVALID_SYMBOL_SET/);
console.log('PASS static source -> daily/cost -> trial -> scenario -> fixed short -> real detector -> level cross -> three notification categories; missing data blocks; sends=0');
