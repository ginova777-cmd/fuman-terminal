'use strict';
const crypto=require('node:crypto');
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const day=ms=>new Date(ms+28800000).toISOString().slice(0,10);
function normalize(raw,{symbol,tradeDate,receivedAt,source,session='REGULAR',nowMs=Date.now()}) {
 if(!/^TXF[A-L]\d$/.test(symbol||'')||!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate||''))throw Error('TXF_IDENTITY_INVALID');
 if(!['REGULAR','AFTERHOURS'].includes(session)||!['Fugle:REST:intraday/candles','Fugle:WS:candles'].includes(source))throw Error('TXF_SOURCE_INVALID');
 const received=Date.parse(receivedAt),event=Date.parse(raw?.date);
 if(!Number.isFinite(received)||received>nowMs||!Number.isFinite(event)||event>received||event%60000!==0)throw Error('TXF_CANDLE_TIME_INVALID');
 if(raw.symbol!==undefined&&raw.symbol!==symbol)throw Error('TXF_SYMBOL_MISMATCH');
 if(raw.type!==undefined&&raw.type!=='FUTURE')throw Error('TXF_TYPE_MISMATCH');
 if(raw.exchange!==undefined&&raw.exchange!=='TAIFEX')throw Error('TXF_EXCHANGE_MISMATCH');
 // Night-session trade dates require separate calendar evidence; never infer them from the clock.
 if(session!=='REGULAR')throw Error('TXF_NIGHT_CALENDAR_REQUIRED');
 const minute=new Date(event+28800000).getUTCHours()*60+new Date(event+28800000).getUTCMinutes();
 if(day(event)!==tradeDate||minute<525||minute>=825)throw Error('TXF_SESSION_OR_DATE_MISMATCH');
 for(const key of ['open','high','low','close'])if(typeof raw[key]!=='number'||!Number.isFinite(raw[key])||raw[key]<=0)throw Error('TXF_OHLC_INVALID');
 if(raw.low>Math.min(raw.open,raw.close)||raw.high<Math.max(raw.open,raw.close)||raw.low>raw.high)throw Error('TXF_OHLC_INCONSISTENT');
 if(!Number.isSafeInteger(raw.volume)||raw.volume<0)throw Error('TXF_VOLUME_INVALID');
 if(raw.isSynthetic===true||raw.is_synthetic===true||raw.isTrial===true)throw Error('TXF_NONTRADE_CANDLE');
 return {future_symbol:symbol,trade_date:tradeDate,session,timeframe:1,candle_time:new Date(event).toISOString(),open:raw.open,high:raw.high,low:raw.low,close:raw.close,volume:raw.volume,source,is_synthetic:false,received_at:receivedAt,available_at:receivedAt,raw_sha256:hash(raw),raw_evidence:raw,closed_at_receipt:event+60000<=received};
}
function validateRest(body,context){
 if(body?.symbol!==context.symbol||body.date!==context.tradeDate||body.type!=='FUTURE'||body.exchange!=='TAIFEX'||String(body.timeframe)!=='1'||!Array.isArray(body.data)||body.data.length>1440)throw Error('TXF_REST_IDENTITY_INVALID');
 const seen=new Set();return body.data.map(raw=>{const row=normalize(raw,{...context,source:'Fugle:REST:intraday/candles'});if(seen.has(row.candle_time))throw Error('TXF_DUPLICATE_MINUTE');seen.add(row.candle_time);return row;}).sort((a,b)=>a.candle_time.localeCompare(b.candle_time));
}
function coverage(rows,{tradeDate,throughMinute=825}){
 const have=new Set(rows.map(r=>r.candle_time)),missing=[];
 for(let m=525;m<Math.min(825,throughMinute);m++){const t=new Date(Date.parse(tradeDate+'T00:00:00+08:00')+m*60000).toISOString();if(!have.has(t))missing.push({candle_time:t,reason:'NO_PROVIDER_BAR_EVIDENCE'});}
 return {count:rows.length,missing,complete:missing.length===0};
}
module.exports={normalize,validateRest,coverage,hash};
