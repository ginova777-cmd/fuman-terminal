'use strict';
// Offline calls use original formula adapters. No formal Gate or sender exists here.
const {strategy3,telegram,deepAnalysis}=require('../phase4/original-adapters.cjs');
const {route}=require('./routing-contract.cjs');const {hash,bytes}=require('./offline-store.cjs');
async function evaluate({store,binding,input,changes,gate,backfill,sequence,sourceCursor,coordinator=null,fault}){
 const routing=route(binding,input),id=routing.identity;
 if(gate.mode!=='OFFLINE_FIXTURE'||gate.identity!==id||gate.as_of!==input.asOf||gate.trade_date!==binding.payload.trade_date)throw Error('OFFLINE_GATE_IDENTITY');
 if(sourceCursor.status!=='OFFLINE_FIXED_SEGMENT'||sourceCursor.epoch!==binding.payload.epoch)throw Error('CONTINUITY_UNKNOWN');
 const prior=store.root();const txHash=hash(bytes({binding,input,changes,sequence,sourceCursor,coordinator}));
 if(prior&&prior.identity!==id)throw Error('IDENTITY_RECOVERY_REQUIRED');
 if(prior?.sequence===sequence){if(prior.txHash!==txHash)throw Error('REPLAY_CONFLICT');return {status:'REPLAY_DEDUP',root:prior};}
 if(sequence!==(prior?.sequence||0)+1)throw Error('SEQUENCE_GAP');
 const next={identity:id,sequence,txHash,sourceCursor,coordinator,symbols:{...(prior?.symbols||{})},strategy:{...(prior?.strategy||{})},telegram:{...(prior?.telegram||{})},pending:{...(prior?.pending||{})},outbox:{...(prior?.outbox||{})}};
 const active=new Set(routing.telegram.universe),members=new Set(routing.strategy3.members);
 if(Object.keys(changes).some(s=>!active.has(s)))throw Error('CHANGE_OUTSIDE_UNIVERSE');
 const clockChanged=prior?.coordinator?.asOf!==input.asOf;
 const pendingSymbols=Object.keys(next.pending).filter(s=>store.get(next.pending[s]).length>0);
 const touched=new Set([...routing.strategy3.changed,...routing.strategy3.admit,...routing.telegram.changed,...Object.keys(changes),...pendingSymbols,...(clockChanged?routing.strategy3.members:[])]);
 for(const s of routing.strategy3.exit)delete next.strategy[s];
 for(const s of touched){const old=next.symbols[s]?store.get(next.symbols[s]):await backfill(s);if(!old||old.trade_date!==binding.payload.trade_date||old.symbol!==s||old.verified!==true)throw Error('BACKFILL_UNVERIFIED');const item=changes[s]||old;
  if(item.symbol!==s||item.trade_date!==old.trade_date||item.verified!==true)throw Error('SYMBOL_INPUT_IDENTITY');next.symbols[s]=store.put(item);
  const state={identity:id,trade_date:binding.payload.trade_date,symbols:{[s]:item.data}};
  if(members.has(s)){const r=await strategy3(state,[s],gate);if(r.results.length)next.strategy[s]=store.put(r.results[0]);else delete next.strategy[s];}
  const candleChanged=routing.telegram.changed.includes(s);
  if(candleChanged||pendingSymbols.includes(s)){const t=candleChanged?telegram(state,[s],input.asOf):[];if(candleChanged)next.telegram[s]=store.put(t);
   const events=t.filter(x=>x.hit).map(x=>({...x.row,event_type:x.kind==='volume'?'VOLUME_ANOMALY_EVENT':'PRICE_UP_ANOMALY_EVENT',source_event_at:x.row.timestamp}));
   const deep=deepAnalysis({events,previous:next.pending[s]?store.get(next.pending[s]):[],contexts:{[s]:{bars:item.data.current,levelInput:item.data.levelInput}},now:input.asOf,tradeDate:state.trade_date,plan:input.plan||null});next.pending[s]=store.put(deep.state);
   for(const e of deep.events.filter(e=>e.gate.eligible)){const key=hash(bytes([s,e.event_type,e.timestamp]));if(!next.outbox[key])next.outbox[key]=store.put({payload:e,status:'DRY_RUN_PENDING',delivery_authorized:false});}
  }
 }
 // Persist global ranking as a small result index, without reading other symbols' K/history.
 const ranks=Object.entries(next.strategy).map(([s,h])=>({symbol:s,row:store.get(h)})).sort((a,b)=>b.row.score-a.row.score||b.row.change_percent-a.row.change_percent||b.row.tail_volume_share_pct-a.row.tail_volume_share_pct);next.ranking=ranks.map(x=>x.symbol);
 store.transaction(current=>{if((current?.sequence||0)!==(prior?.sequence||0)||(current?.txHash||null)!==(prior?.txHash||null))throw Error('CONCURRENT_ROOT_CHANGED');return next;},{fault});
 return {status:'OFFLINE_COMMITTED',root:next,notifications_sent:0,limitations:['source cursor is offline proof only; no formal activation']};
}
module.exports={evaluate};
