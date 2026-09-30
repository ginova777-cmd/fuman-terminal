'use strict';
const {createMemoryFeed}=require('./daytrade-memory-feed');
// Collector-side bridge. Exactly one IPC batch may be awaiting acknowledgement.
// New input is merged locally while detection is busy; no raw-event queue grows.
function createDetectionBridge({send,mergeQuote,now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout,maxWaitMs=5000,onFault=()=>{}}){
 const feed=createMemoryFeed({mergeQuote,now});
 let connected=true,busy=null,sequence=0,timer=null,configuration=null,lastSentAt=-Infinity;
 const pendingCandles=new Map();let candleSymbols=new Set();
 let transportStatus=null;
 function fault(reason){connected=false;clearTimer(timer);timer=null;onFault(reason);}
 function flush(){
  if(!connected||busy||!configuration)return;
  const changed=!!feed.status().pending||configuration.dirty||pendingCandles.size>0;
  if(!changed&&now()-lastSentAt<2000)return;
  const snapshot=changed?feed.snapshot():feed.status();
  // Full latest state per bounded batch makes configuration changes and a lost
  // acknowledgement recoverable without replaying old events as new events.
  if(changed)feed.drain();configuration.dirty=false;
  const batch=changed?{type:'daytrade_detection_state',sequence:++sequence,tradeDate:snapshot.tradeDate,revision:snapshot.revision,universe:snapshot.universe,rows:snapshot.rows}:{type:'daytrade_detection_heartbeat',sequence:++sequence,tradeDate:snapshot.tradeDate,revision:snapshot.revision};
  if(changed){batch.candles=[...pendingCandles.values()];pendingCandles.clear();}
  batch.transportStatus=transportStatus;
  lastSentAt=now();
  busy=batch.sequence;
  timer=setTimer(()=>fault('DETECTION_WORKER_ACK_TIMEOUT'),maxWaitMs);
  try{send(batch,error=>{if(error)fault('DETECTION_WORKER_SEND_FAILED');});}catch{fault('DETECTION_WORKER_SEND_FAILED');}
 }
 return {
  configure(input){feed.configure(input);configuration={dirty:true};candleSymbols=new Set(input.symbols);for(const [key,row]of pendingCandles)if(!candleSymbols.has(String(row.code||row.symbol)))pendingCandles.delete(key);},
  ingest(rows){for(const row of rows)feed.ingest(row);},
  updateTransport(status){transportStatus=structuredClone(status);},
  ingestCandles(rows){for(const row of rows){const symbol=String(row.code||row.symbol||'');if(!candleSymbols.has(symbol))continue;const key=symbol+'|'+(row.candleTime||row.candle_time||row.date||'');if(!pendingCandles.has(key)&&pendingCandles.size>=candleSymbols.size*300){fault('CANDLE_BRIDGE_CAPACITY_EXCEEDED');return;}pendingCandles.set(key,structuredClone(row));}},
  flush,
  acknowledge(message){if(!connected||message?.type!=='daytrade_detection_ack'||message.sequence!==busy)return false;clearTimer(timer);timer=null;busy=null;return true;},
  disconnect(){fault('DETECTION_WORKER_DISCONNECTED');},
  stop(){connected=false;clearTimer(timer);timer=null;busy=null;},
  status:()=>({...feed.status(),connected,in_flight:busy===null?0:1,sequence,pending_candles:pendingCandles.size}),
 };
}
module.exports={createDetectionBridge};
