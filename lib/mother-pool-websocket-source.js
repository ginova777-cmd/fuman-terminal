'use strict';
const CHANNELS=['trades','aggregates','candles'];
const stable=x=>Array.isArray(x)?x.map(stable):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])])):x;
const digest=x=>require('./mother-pool-module-write-set').hash(stable(x));
function evaluate(symbol,raw,identity,asOf){
 const gaps=[],now=Date.parse(asOf),checked=Date.parse(raw.updated_at),opened=Date.parse(raw.opened_at),auth=Date.parse(raw.authenticated_at),transport=Date.parse(raw.transport_message_at);
 if(raw.trade_date!==identity.trade_date||raw.canonical_run_id!==identity.canonical_run_id||raw.role!=='daytrade'||raw.mode!=='streaming'||raw.endpoint!=='wss://api.fugle.tw/marketdata/v1.0/stock/streaming'||!raw.host_id||!Number.isInteger(raw.pid)||raw.pid<1||!raw.connection_id)gaps.push('COLLECTOR_IDENTITY_INVALID');
 if(raw.ack_contract!=='fugle_subscription_ack_evidence_v1'||raw.connected!==true||raw.authenticated!==true||raw.closed_at!==null)gaps.push('COLLECTOR_NOT_AUTHENTICATED_OR_CONNECTED');
 if(![now,checked,opened,auth,transport].every(Number.isFinite)||checked>now||now-checked>120000||opened>auth||auth>checked||transport<opened||transport>checked||now-transport>120000||new Date(checked+28800000).toISOString().slice(0,10)!==identity.trade_date)gaps.push('COLLECTOR_TIME_INVALID_OR_STALE');
 if(!Number.isInteger(raw.connection_attempt)||raw.connection_attempt<1)gaps.push('COLLECTOR_RECONNECT_EVIDENCE_MISSING');
 const requests=Array.isArray(raw.requests)?raw.requests:[],acks=Array.isArray(raw.acks)?raw.acks:[];
 if(!Array.isArray(raw.channels)||CHANNELS.some(c=>!raw.channels.includes(c)))gaps.push('REQUIRED_CHANNEL_NOT_CONFIGURED');
 for(const channel of CHANNELS){
  const intents=requests.filter(r=>r.channel===channel&&r.symbol===symbol),found=acks.filter(r=>r.channel===channel&&r.symbol===symbol);
  if(intents.length!==1||found.length!==1){gaps.push('SUBSCRIPTION_ACK_MISSING_OR_DUPLICATE:'+channel);continue;}
  const q=intents[0],a=found[0],sent=Date.parse(q.requested_at),received=Date.parse(a.acknowledged_at);
  if(!a.id||a.requested_at!==q.requested_at||!Number.isFinite(sent)||!Number.isFinite(received)||sent<auth||received<sent||received>checked)gaps.push('SUBSCRIPTION_ACK_IDENTITY_OR_TIME:'+channel);
 }
 if(new Set(acks.map(r=>r.id)).size!==acks.length)gaps.push('DUPLICATE_SUBSCRIPTION_ID');
 const data=Date.parse(raw.market_message_at),marketSeen=Number.isFinite(data)&&data>=opened&&data<=checked;
 return {status:gaps.length?'DATA_GAP':'READY',data_gap_reason:gaps.length?gaps.join('|'):null,
  subscribed_channels:CHANNELS.filter(c=>acks.some(a=>a.symbol===symbol&&a.channel===c)),reconnect_count:Number.isInteger(raw.connection_attempt)?raw.connection_attempt-1:null,
  market_message_seen:marketSeen,last_market_message_at:marketSeen?raw.market_message_at:null,heartbeat_is_market_data:false};
}
function collect({identity,symbols,status,asOf}){
 const s=status||{},ack=s.subscriptionAckEvidence||{};
 const rows=symbols.map(symbol=>{
  const raw={trade_date:s.tradeDate??null,canonical_run_id:s.canonicalRunId??null,role:s.collectorRole??null,mode:s.mode??null,endpoint:s.streamingUrl??null,host_id:s.sourceHostId??null,pid:s.pid??null,
   connection_id:ack.connection_id??null,connection_attempt:s.connectionAttempt??null,ack_contract:ack.contract??null,connected:s.websocketConnected??null,authenticated:ack.authenticated===true&&s.websocketAuthenticated===true,
   authenticated_at:ack.authenticated_at??null,closed_at:ack.closed_at??null,opened_at:s.streamingOpenedAt??null,updated_at:s.updatedAt??null,transport_message_at:s.websocketLastMessageAt??null,heartbeat_at:s.websocketHeartbeatAt??null,market_message_at:s.lastMessageAt??null,
   channels:s.streamingChannels??null,requests:(Array.isArray(ack.requested)?ack.requested:[]).filter(r=>r?.symbol===symbol),acks:(Array.isArray(ack.acknowledged)?ack.acknowledged:[]).filter(r=>r?.symbol===symbol)};
  return {symbol,...evaluate(symbol,raw,identity,asOf),source:'Fugle.websocket.subscription_ack',source_contract:'preopen_a06_websocket_receipt_v1',source_updated_at:raw.updated_at||asOf,event_time:asOf,raw_collector:raw,source_hash:digest(raw),is_synthetic:false,replay:false,look_ahead:false};
 });
 return {...identity,module_id:'A06',created_at:asOf,requested_symbols:[...symbols],rows};
}
function verify(row,r){try{
 const expected=evaluate(row.symbol,row.raw_collector,r,r.observed_at);
 return expected.status==='READY'&&row.is_synthetic===false&&row.replay===false&&row.look_ahead===false&&row.source==='Fugle.websocket.subscription_ack'&&row.source_contract==='preopen_a06_websocket_receipt_v1'&&row.source_updated_at===row.raw_collector.updated_at&&row.event_time===r.observed_at&&row.source_hash===digest(row.raw_collector)&&Object.keys(expected).every(k=>JSON.stringify(row[k])===JSON.stringify(expected[k]));
}catch{return false;}}
module.exports={collect,evaluate,verify};
