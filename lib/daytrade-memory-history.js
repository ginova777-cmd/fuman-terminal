'use strict';
// One bounded warmup acquisition. No reads from the per-second detection path.
async function loadHistory({tradeDate,symbols,calendar,readPage}){
 const previous=calendar?.session_dates?.at(-1);
 if(calendar?.status!=='SESSION_DATES_VERIFIED'||calendar.trade_date!==tradeDate||!previous||previous>=tradeDate)throw Error('HISTORY_CALENDAR_UNPROVEN');
 if(!Array.isArray(symbols)||!symbols.length||new Set(symbols).size!==symbols.length||symbols.some(s=>!/^\d{4}$/.test(s)))throw Error('HISTORY_UNIVERSE_INVALID');
 const rows=[],pages=[],seen=new Set(),counts=new Map(),lower=previous+'T12:55:00+08:00',upper=previous+'T13:30:00+08:00';
 for(let index=0;index<symbols.length;index+=40){
  const group=symbols.slice(index,index+40);let offset=0,total=null;
  do{
   const page=await readPage({symbols:group,tradeDate:previous,lower,upper,offset,limit:500});
   if(!Array.isArray(page?.rows)||!Number.isSafeInteger(page.total)||page.total<0||page.total>group.length*35||page.rows.length>500||page.offset!==offset)throw Error('HISTORY_PAGE_INVALID');
   if(total!==null&&page.total!==total)throw Error('HISTORY_COUNT_CHANGED');total=page.total;
   if(page.rows.length!==Math.min(500,total-offset))throw Error('HISTORY_PAGE_TRUNCATED');
   for(const row of page.rows){
    const ms=Date.parse(row.candle_time),key=row.symbol+'|'+row.candle_time;
    if(!group.includes(row.symbol)||row.trade_date!==previous||ms<Date.parse(lower)||ms>=Date.parse(upper)||!Number.isFinite(ms)||seen.has(key))throw Error('HISTORY_ROW_IDENTITY_INVALID');
    seen.add(key);counts.set(row.symbol,(counts.get(row.symbol)||0)+1);rows.push(row);
   }
   pages.push({group_index:index/40,offset,total,row_count:page.rows.length});offset+=page.rows.length;
  }while(offset<total);
 }
 return {calendar,rows,requested_symbols:[...symbols],pages,data_gaps:symbols.filter(s=>(counts.get(s)||0)<20).map(symbol=>({symbol,reason:'HISTORY_MA20_SAMPLE_INSUFFICIENT',sample_count:counts.get(symbol)||0}))};
}
function createPageReader({url,key,fetchImpl=fetch}){
 if(!url||!key)throw Error('HISTORY_READ_CREDENTIAL_MISSING');
 return async function({symbols,tradeDate,lower,upper,offset,limit}){
  const query=new URLSearchParams({select:'symbol,trade_date,candle_time,open,high,low,close,volume,synthetic,volume_strategy_usable',symbol:'in.('+symbols.join(',')+')',trade_date:'eq.'+tradeDate,and:'(candle_time.gte.'+lower+',candle_time.lt.'+upper+')',order:'symbol.asc,candle_time.asc'});
  const response=await fetchImpl(url.replace(/\/+$/,'')+'/rest/v1/fugle_daytrade_intraday_1m?'+query,{headers:{apikey:key,Authorization:'Bearer '+key,Prefer:'count=exact','Range-Unit':'items',Range:offset+'-'+(offset+limit-1)},signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error('HISTORY_READ_HTTP_'+response.status);
  const rows=await response.json(),range=response.headers.get('content-range')||'',match=range.match(/^(?:(\d+)-(\d+)|\*)\/(\d+)$/);
  if(!Array.isArray(rows)||!match||rows.length>0&&(Number(match[1])!==offset||Number(match[2])-offset+1!==rows.length)||rows.length===0&&Number(match[3])!==0)throw Error('HISTORY_RANGE_UNPROVEN');
  return {rows,total:Number(match[3]),offset};
 };
}
module.exports={loadHistory,createPageReader};
