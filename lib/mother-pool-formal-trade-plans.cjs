'use strict';
async function collect({identity,symbols,candles,asOf,runtime,status,releaseSha}){
 const input=await require('./mother-pool-live-trade-readback.cjs').collect({runtime,status,releaseSha,tradeDate:identity.trade_date,symbols,asOf});
 const producer=require('./mother-pool-candle-module-producer');
 const plans=producer.collect({identity,symbols,candles,asOf});
 const plan=plans.find(x=>x.module_id==='B22');
 if(input.complete){
  const scoped=producer.collect({identity,symbols,candles,asOf:input.window.to,tradesBySymbol:input.tradesBySymbol}).find(x=>x.module_id==='B22');plan.rows=scoped.rows;
 }
 plan.source_evidence={contract:'formal_b22_local_trade_window_v1',checkpoint:input.checkpoint||null,window:input.window||null,scope:input.scope||null,provider_completeness:false,complete:input.complete,reason:input.reason||null};
 for(const row of plan.rows){row.trade_window=plan.source_evidence;if(!input.complete){row.status='DATA_GAP';row.data_gap_reason=input.reason||'B22_FORMAL_WINDOW_UNAVAILABLE';}}
 plan.source_evidence={...plan.source_evidence,checkpoint_body:input.checkpoint_body||null};
 return plans;
}
function verify(row,round){try{
 const e=round.writer_write_set?.plan?.source_evidence,c=e?.checkpoint_body,ref=e?.checkpoint;
 if(e?.contract!=='formal_b22_local_trade_window_v1'||!e.complete||!c||!ref||c.contract!=='formal_live_trade_checkpoint_v1'||c.through_at!==e.window.to||Date.parse(e.window.from)!==Date.parse(round.trade_date+'T09:02:00+08:00'))return false;
 if(require('node:crypto').createHash('sha256').update(JSON.stringify(c)).digest('hex')!==ref.sha256||c.release_sha!==ref.release_sha||c.connection_id!==ref.connection_id||c.epoch!==ref.epoch||c.session_id!==ref.session_id)return false;
 const end=Date.parse(e.window.to),now=Date.parse(round.observed_at);if(!Number.isFinite(end)||end>now||now-end>120000||Date.parse(c.opened_at)>Date.parse(e.window.from)||c.health?.ok!==true||c.health.queued_records!==0||c.health.gap_evidence?.total||c.health.gap_evidence?.error)return false;
 const {checkpoint_body,...binding}=e;if(JSON.stringify(row.trade_window)!==JSON.stringify(binding))return false;
 return row.trade_evidence.every(t=>Date.parse(t.received_at)<=end)&&require('./verify-mother-pool-tongzi').verify(row,{...round,observed_at:e.window.to});
 }catch{return false;}}
module.exports={collect,verify};
