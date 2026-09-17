'use strict';
const crypto=require('node:crypto');
// Pure adapter for authenticated Fugle historical/candles responses. Callers
// retain the raw response and actual fetch time; this never backdates evidence.
function adapt({response,symbol,tradeDate,fetchedAt,asOf,sessionDates}){
 const fetched=Date.parse(fetchedAt),now=Date.parse(asOf);
 if(!/^\d{4}$/.test(symbol)||!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate||'')||!Number.isFinite(fetched)||!Number.isFinite(now)||fetched>now
  ||!Array.isArray(sessionDates)||!sessionDates.length||sessionDates.length>20
  ||new Set(sessionDates).size!==sessionDates.length
  ||sessionDates.some(d=>!/^\d{4}-\d{2}-\d{2}$/.test(d)||d>=tradeDate))throw Error('HISTORY_ENVELOPE_INVALID');
 if(response?.symbol!==symbol||response.timeframe!=='1'||!['TWSE','TPEx','TPEX'].includes(response.exchange)
  ||(response.type!=null&&response.type!=='EQUITY')
  ||(response.market!=null&&!['TSE','OTC','TIB'].includes(response.market))
  ||(response.market==='TIB'&&(response.exchange!=='TWSE'||response.type!=='EQUITY'))||!Array.isArray(response.data))throw Error('HISTORY_RESPONSE_INVALID');
 const rows=[],seen=new Set();
 for(const b of response.data){
  const t=Date.parse(b?.date),local=Number.isFinite(t)?new Date(t+28800000).toISOString():'';
  if(!Number.isFinite(t)||t%60000||!sessionDates.includes(local.slice(0,10))||local.slice(11,16)<'09:00'||local.slice(11,16)>'13:30'
   ||t+60000>fetched||seen.has(t)||!['open','high','low','close'].every(k=>typeof b[k]==='number'&&Number.isFinite(b[k])&&b[k]>0)
   ||b.high<Math.max(b.open,b.close,b.low)||b.low>Math.min(b.open,b.close,b.high)
   ||typeof b.volume!=='number'||!Number.isFinite(b.volume)||b.volume<0)throw Error('HISTORY_ROW_INVALID');
  seen.add(t);rows.push({stock_id:symbol,trade_date:local.slice(0,10),timestamp:new Date(t).toISOString(),
   open:b.open,high:b.high,low:b.low,close:b.close,volume_raw:b.volume,volume_raw_unit:'LOTS',
   complete:true,is_synthetic:false,available_at:fetchedAt,market:response.market||null,exchange:response.exchange,
   source:response.market==='TIB'?'Fugle.historical.candles.1.TIB':'Fugle.historical.candles.1.TSE_OTC'});
 }
 return {rows:rows.sort((a,b)=>Date.parse(a.timestamp)-Date.parse(b.timestamp)),session_dates:sessionDates,
  fetched_at:fetchedAt,raw_sha256:crypto.createHash('sha256').update(JSON.stringify(response)).digest('hex'),
  complete:false,calendar_provenance_required:true};
}
module.exports={adapt};
