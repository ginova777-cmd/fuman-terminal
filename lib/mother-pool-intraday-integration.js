'use strict';
// Integration boundary: caller supplies immutable inputs and existing persistence.
// No source fetch, extra subscription, DB configuration or real Telegram transport.
async function run({identity,symbols,candles,tradesBySymbol={},tradeJournal,anomalyEvidence,parents={},asOf,persistence,b16Policy,isolatedOutbox,deadlineMs}){
 let tradeInput=null,plans;
 if(tradeJournal){
  if(Object.keys(tradesBySymbol).length)throw Error('AMBIGUOUS_TRADE_INPUT');
  plans=await require('./mother-pool-writer-trade-plans.cjs').collect({identity,symbols,candles,asOf,tradeJournal,deadlineMs});
  tradeInput=plans.find(p=>p.module_id==='B22').source_evidence;
 }else plans=require('./mother-pool-candle-module-producer').collect({candles,identity,symbols,asOf,tradesBySymbol});
 plans.push(require('./mother-pool-one-minute-indicators').collect({candles,identity,symbols,asOf}));
 if(anomalyEvidence)plans.push(...require('./mother-pool-anomaly-module-producer').collect({identity,symbols,evidence:anomalyEvidence,asOf}));
 const committed={...parents},writes=[];
 for(const plan of plans){const saved=await require('./persist-mother-pool-module-round').persistModuleRound(plan,persistence);committed[plan.module_id]=saved;writes.push(saved);}
 const combined=require('./mother-pool-combination-producer').collect({identity,symbols,parents:committed,asOf});
 const saved=await require('./persist-mother-pool-module-round').persistModuleRound(combined,persistence);writes.push(saved);
 const handoff=await require('./mother-pool-b16-combination-adapter').prepare({combinations:combined.rows.filter(r=>r.status==='READY').flatMap(r=>r.combinations),events:combined.rows.flatMap(r=>r.events),asOf,policy:b16Policy});
  let durableOutbox=null;
 if(isolatedOutbox){
  if(typeof persistence.readback!=='function')throw Error('OUTBOX_READBACK_REQUIRED');
  const {db,anon}=await persistence.readback(saved);
  const receipt={...identity,observed_at:asOf,writer_write_set:saved};
  if(require('./mother-pool-stock-module-write-set').reconcile(saved,db,anon,identity,'B24').failed_checks.length||!require('./verify-mother-pool-combinations').verify(db,receipt)||!require('./verify-mother-pool-combinations').verify(anon,receipt))throw Error('OUTBOX_SOURCE_VERIFIER_FAILED');
  durableOutbox=await require('./mother-pool-isolated-outbox.cjs').run({...isolatedOutbox,writeSet:saved,verifier:{...identity,ok:true,plan_hash:saved.plan_hash},asOf});
 }
 return {status:combined.rows.some(r=>r.status!=='READY')?'DATA_GAP':'CALCULATED_NOT_DEPLOYED',writes,handoff,tradeInput,durableOutbox,notifications_sent:0};
}
module.exports={run};
