'use strict';
// Optional isolated tick input. Identity and universe always come from tick's
// checked snapshot, never from the journal configuration.
async function collect({identity,symbols,candles,asOf,tradeJournal,deadlineMs,now=Date.now()}){
 let input=null;
 if(tradeJournal){
  const remaining=Math.floor(deadlineMs-now-5000);
  if(!Number.isFinite(deadlineMs)||!Number.isFinite(now)||remaining<1){
   input={tradesBySymbol:{},receipts:{},gaps:Object.fromEntries(symbols.map(s=>[s,'WRITER_TRADE_BUDGET_EXHAUSTED'])),continuity_verified:false};
  }else{
   if(!Number.isSafeInteger(tradeJournal.maxElapsedMs)||tradeJournal.maxElapsedMs<1)throw Error('TRADE_INPUT_DEADLINE_REQUIRED');
   input=await require('./mother-pool-trade-input-worker').collect({...tradeJournal,symbols,tradeDate:identity.trade_date,asOf,maxElapsedMs:Math.min(tradeJournal.maxElapsedMs,remaining)});
  }
 }
 const plans=require('./mother-pool-candle-module-producer').collect({identity,symbols,candles,asOf,tradesBySymbol:input?.tradesBySymbol||{}});
 if(input){
  const plan=plans.find(p=>p.module_id==='B22'),w=input.segment_binding?.requested_window;
  const complete=input.continuity_verified===true&&Date.parse(w?.from)===Date.parse(identity.trade_date+'T09:02:00+08:00')&&Date.parse(w?.to)===Date.parse(asOf);
  plan.source_evidence={trade_segment_binding:input.segment_binding||{status:'DATA_GAP',reason:'SEGMENT_BINDING_UNAVAILABLE',gaps:input.gaps,provider_completeness:false}};
  for(const row of plan.rows){const b=input.segment_binding;row.trade_segment_binding=b?{binding_sha256:b.binding_sha256,epoch:b.epoch,requested_window:b.requested_window,status:b.status}:null;row.trade_journal_readback=input.receipts[row.symbol]||null;if(!complete){row.status='DATA_GAP';row.data_gap_reason=input.gaps[row.symbol]||'B22_FULL_REQUESTED_WINDOW_UNVERIFIED';}}
 }
 return plans;
}
module.exports={collect};
