'use strict';
const assert=require('assert/strict'),s=require('../lib/opening-report-supervision'),a=require('../lib/opening-report-receipt-authority');
function day(date,previous){const git_sha='a'.repeat(40),evidence={};for(const stage of ['us_0820','asia_0850']){
  const run_id=date+'-'+stage,final={date,stage,run_id,delivery_content_hash:'test-hash'};
  const core={contract:'opening-report-morning-single-verifier-v1',trade_date:date,stage,run_id,delivery_content_hash:final.delivery_content_hash,require_current:true,canonical_verifier:a.CONTRACT.canonical_command,complete:true,status:'complete',exitCode:0,failed_checks:[],first_blocker:null};
  evidence[stage]={final,content:{...core,scope:'morning_source_content_only',phase:'content'},canonical:{...core,scope:'stage_delivery',phase:'delivery'},wrapper:{trade_date:date,stage,run_id,mode:'production',execution_mode:'scheduled',recovery:false,git_sha,complete:true,exitCode:0,status:'complete'}};
}return {date,git_sha,evidence,calendar:{date,verified:true,is_trading_day:true,previous_trading_day:previous,official_evidence_sha256:'b'.repeat(64)},aggregate:{trade_date:date,verification_mode:'current',complete:true,exitCode:0,blocking_reasons:[],stages:Object.values(evidence).map(e=>({stage:e.final.stage,run_id:e.final.run_id,complete:true}))}};}
let observation=day('2026-10-19','2026-10-16'),state={},events=s.notifications(observation.date,observation.evidence,state);assert.equal(events.length,4);
for(const event of events)state=s.acknowledge(state,event);
assert.equal(s.notifications(observation.date,observation.evidence,state).length,0);
observation.evidence.us_0820.wrapper={...observation.evidence.us_0820.wrapper,complete:false,status:'failed',exitCode:1,first_blocker:'mother_pending'};
events=s.notifications(observation.date,observation.evidence,state);assert.equal(events.length,1);assert.equal(events[0].component,'delivery');state=s.acknowledge(state,events[0]);
assert.equal(s.stageResult(observation.date,'us_0820',observation.evidence.us_0820).morning_status,'COMPLETE');
observation=day('2026-10-19','2026-10-16');assert.equal(s.notifications(observation.date,observation.evidence,state)[0].kind,'RECOVERED');
let ledger;for(let n=19;n<=23;n++)ledger=s.recordNaturalDay(ledger,day(`2026-10-${n}`,n===19?'2026-10-16':`2026-10-${n-1}`));assert.equal(ledger.consecutive,5);assert.equal(ledger.stable,true);
assert.throws(()=>s.recordNaturalDay(ledger,day('2026-10-23','2026-10-22')),/DAY_ALREADY_RECORDED/);
for(const mutate of [x=>x.evidence.us_0820.wrapper.execution_mode='resume_existing_evidence',x=>x.evidence.us_0820.wrapper.mode='isolated_backtest',x=>x.evidence.us_0820.content.run_id='old',x=>x.aggregate.complete=false,x=>x.evidence.asia_0850.wrapper.git_sha='c'.repeat(40)]){const x=day('2026-10-26','2026-10-23');mutate(x);assert.equal(s.recordNaturalDay(ledger,x).consecutive,0);}
const holiday=day('2026-10-24','2026-10-23');holiday.calendar.is_trading_day=false;assert.equal(s.recordNaturalDay(ledger,holiday).consecutive,5);
const unknown=day('2026-10-26','2026-10-23');unknown.calendar.verified=false;assert.equal(s.recordNaturalDay(ledger,unknown).pending_reason,'official_calendar_unverified');
const changed=day('2026-10-26','2026-10-23');changed.git_sha='c'.repeat(40);for(const e of Object.values(changed.evidence))e.wrapper.git_sha=changed.git_sha;assert.equal(s.recordNaturalDay(ledger,changed).consecutive,1);
for(const mutate of [e=>e.content=null,e=>e.content.run_id='other-run',e=>e.canonical.delivery_content_hash='other-content']){
  const x=day('2026-10-26','2026-10-23');mutate(x.evidence.us_0820);
  assert.notEqual(s.stageResult(x.date,'us_0820',x.evidence.us_0820).delivery_status,'COMPLETE');
  assert.equal(s.recordNaturalDay(ledger,x).consecutive,0);
}
console.log(JSON.stringify({scope:'isolated_supervision_unit_test',complete:true,real_natural_days:0,real_notifications_sent:0}));
