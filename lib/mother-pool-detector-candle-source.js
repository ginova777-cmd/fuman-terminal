'use strict';
const {mapNaturalCandle}=require('./daytrade-fast-candle-row');
// Current-day detector input only. Historical candles require a separate,
// calendar-bound envelope. No notification or publication side effects.
function build({candles,tradeDate,canonicalRunId,asOf}){
 const now=Date.parse(asOf);
 if(!Number.isFinite(now)||new Date(now+28800000).toISOString().slice(0,10)!==tradeDate
  ||canonicalRunId!==`fugle_daytrade_source:${String(tradeDate).replaceAll('-','')}:canonical`||!Array.isArray(candles))
  throw Error('DETECTOR_SOURCE_IDENTITY_INVALID');
 const groups=new Map(),rejected=[],seen=new Set();
 for(const raw of candles){
  // Prior minutes are baseline inputs; freshness is enforced on the latest
  // trigger separately. Every record must still have been available by asOf.
  const c=mapNaturalCandle(raw,{tradeDate,nowMs:now,maxSeenAgeMs:Infinity});
  const symbol=String(raw?.symbol||raw?.code||'');
  if(!c||!['TSE','OTC'].includes(c.market)){rejected.push({symbol,reason:'INVALID_NATURAL_CANDLE'});continue;}
  const hm=new Date(Date.parse(c.candle_time)+28800000).toISOString().slice(11,16);
  if(hm<'09:00'||hm>'13:30'){rejected.push({symbol,reason:'OUTSIDE_REGULAR_SESSION'});continue;}
  const key=symbol+':'+c.candle_time;
  if(seen.has(key))throw Error('DETECTOR_SOURCE_DUPLICATE_MINUTE');seen.add(key);
  if(!groups.has(symbol))groups.set(symbol,[]);
  groups.get(symbol).push({stock_id:symbol,trade_date:tradeDate,timestamp:c.candle_time,
   open:c.open,high:c.high,low:c.low,close:c.close,volume_raw:c.volume,volume_raw_unit:'LOTS',
   complete:true,is_synthetic:false,available_at:c.updated_at,source:'Fugle.websocket.candles.TSE_OTC'});
 }
 for(const rows of groups.values())rows.sort((a,b)=>Date.parse(a.timestamp)-Date.parse(b.timestamp));
 return {groups,rejected,trade_date:tradeDate,canonical_run_id:canonicalRunId,as_of:asOf};
}
module.exports={build};
