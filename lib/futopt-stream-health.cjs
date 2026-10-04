'use strict';
function createHealth({symbols,channels,now=()=>Date.now()}){
 let expected=new Set(symbols.flatMap(symbol=>channels.map(channel=>symbol+'|'+channel)));
 const acknowledged=new Set();let authenticated=false,lastTransportAt=null,protocolError=null;
 function observe(payload){
  const event=payload?.event;
  if(event==='authenticated'){authenticated=true;lastTransportAt=now();}
  if(event==='heartbeat'||event==='pong'){lastTransportAt=now();}
  if(event==='error'){protocolError='FUGLE_PROTOCOL_ERROR';}
  if(event==='subscribed'&&authenticated){
   const rows=Array.isArray(payload.data)?payload.data:[payload.data];
   for(const row of rows){const key=row?.symbol+'|'+row?.channel;if(expected.has(key))acknowledged.add(key);}
   lastTransportAt=now();
  }
  if((event==='data'||event==='snapshot')&&authenticated)lastTransportAt=now();
  return snapshot();
 }
 function snapshot(){return {authenticated,expected_count:expected.size,acknowledged_count:acknowledged.size,subscriptions_ready:expected.size>0&&expected.size===acknowledged.size&&!protocolError,last_transport_at:lastTransportAt===null?null:new Date(lastTransportAt).toISOString(),transport_age_ms:lastTransportAt===null?null:now()-lastTransportAt,protocol_error:protocolError};}
 function setExpected(nextSymbols,nextChannels){expected=new Set(nextSymbols.flatMap(symbol=>nextChannels.map(channel=>symbol+'|'+channel)));acknowledged.clear();}
 return {observe,snapshot,setExpected};
}
module.exports={createHealth};
