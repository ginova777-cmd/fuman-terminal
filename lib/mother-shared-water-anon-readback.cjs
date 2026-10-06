'use strict';
// Small, serial, bounded readback. Never falls back to a service-role key.
function createReadback({url,key,fetchImpl=fetch,timeoutMs=12000,maxBytes=4*1024*1024,deadlineMs=Infinity}){
 if(typeof key!=='string'||!key)throw Error('ANON_KEY_MISSING');
 let role;try{role=JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString()).role;}catch{}
 if(role!=='anon')throw Error('ANON_JWT_REQUIRED');
 const base=new URL(url);if(base.protocol!=='https:'||base.username||base.password)throw Error('HTTPS_BASE_REQUIRED');
 return async function readback(symbols,tradeDate){
  if(!Array.isArray(symbols)||!symbols.length||symbols.length>2000||new Set(symbols).size!==symbols.length||symbols.some(s=>typeof s!=='string'||!/^\d{4}$/.test(s))||!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate))throw Error('READBACK_SCOPE_INVALID');
  const rows=[],pages=[];let totalBytes=0;
  for(let i=0;i<symbols.length;i+=100){
   const group=symbols.slice(i,i+100),target=new URL('/rest/v1/fugle_daytrade_quotes_live',base);
   target.search=new URLSearchParams({select:'symbol,trade_date,price,last_trade_time,updated_at',trade_date:'eq.'+tradeDate,symbol:'in.('+group.join(',')+')',order:'symbol.asc',limit:String(group.length)}).toString();
   const remaining=Math.min(timeoutMs,deadlineMs-Date.now());if(remaining<=0)throw Error('READBACK_DEADLINE');
   const response=await fetchImpl(target,{headers:{apikey:key,Authorization:'Bearer '+key,Prefer:'count=exact'},signal:AbortSignal.timeout(Math.ceil(remaining))});
   if(!response.ok)throw Error('READBACK_HTTP_'+response.status);
   const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;totalBytes+=chunk.length;if(size>maxBytes||totalBytes>maxBytes)throw Error('READBACK_BYTES_LIMIT');chunks.push(chunk);}
   const bytes=Buffer.concat(chunks),part=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
   if(!Array.isArray(part)||part.length>group.length||part.some(r=>!group.includes(r.symbol)||r.trade_date!==tradeDate)||new Set(part.map(r=>r.symbol)).size!==part.length)throw Error('READBACK_ROWS_INVALID');
   const range=response.headers.get('content-range')||'',match=range.match(/^(\d+)-(\d+)\/(\d+)$/);
   const empty=part.length===0&&['*/0','0--1/0'].includes(range);
   if(!empty&&(!match||Number(match[1])!==0||Number(match[2])+1!==part.length||Number(match[3])!==part.length))throw Error('READBACK_RANGE_MISMATCH');
   rows.push(...part);pages.push({bytes,content_range:range,requested_symbols:group});
  }
  return {reader_role:'anon',complete:true,bytes:Buffer.from(JSON.stringify(rows)),raw_pages:pages,requested_count:symbols.length,returned_count:rows.length,missing_symbols:symbols.filter(s=>!rows.some(r=>r.symbol===s)),scope:'bounded_requested_quotes_not_full_strategy_gate'};
 };
}
module.exports={createReadback};
