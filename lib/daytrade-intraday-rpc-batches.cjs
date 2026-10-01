'use strict';
async function readLatest({symbols,bars=200,send,now=Date.now,budgetMs=60000}){
 if(!Array.isArray(symbols)||new Set(symbols).size!==symbols.length||symbols.some(s=>!/^\d{4}$/.test(s))||!Number.isInteger(bars)||bars<1||bars>200)throw Error('INTRADAY_RPC_REQUEST_INVALID');
 const width=Math.floor(800/bars),groups=[];for(let i=0;i<symbols.length;i+=width)groups.push(symbols.slice(i,i+width));
 const result=new Array(groups.length),started=now();let next=0,failure=null;
 async function worker(){while(!failure&&next<groups.length){const index=next++,group=groups[index];try{
  if(now()-started>=budgetMs)throw Error('INTRADAY_RPC_BUDGET_EXCEEDED');
  const response=await send({symbols:group,bars_per_symbol:bars});
  if(!response.ok)throw Error('INTRADAY_RPC_HTTP_'+response.status);
  const reader=response.body.getReader();let size=0,chunks=[];
  try{for(;;){const r=await reader.read();if(r.done)break;size+=r.value.byteLength;if(size>4*1024*1024)throw Error('INTRADAY_RPC_BODY_LIMIT');chunks.push(Buffer.from(r.value));}}catch(e){await reader.cancel().catch(()=>{});throw e;}
  const rows=JSON.parse(Buffer.concat(chunks).toString('utf8')),range=response.headers.get('content-range')||'',m=range.match(/^(?:(\d+)-(\d+)|\*)\/(\d+)$/);
  if(!Array.isArray(rows)||!m||Number(m[3])!==rows.length||rows.length>group.length*bars||(rows.length>0&&(Number(m[1])!==0||Number(m[2])!==rows.length-1)))throw Error('INTRADAY_RPC_TRUNCATED_OR_UNPROVEN');
  const seen=new Set(),counts=new Map();for(const row of rows){const key=row.symbol+'|'+row.candle_time;if(!group.includes(row.symbol)||!Number.isFinite(Date.parse(row.candle_time))||seen.has(key))throw Error('INTRADAY_RPC_ROW_IDENTITY_INVALID');seen.add(key);counts.set(row.symbol,(counts.get(row.symbol)||0)+1);if(counts.get(row.symbol)>bars)throw Error('INTRADAY_RPC_SYMBOL_LIMIT');}
  result[index]=rows;
 }catch(e){failure=failure||e;}}}
 await Promise.all([worker(),worker()]);if(failure)throw failure;
 return result.flat();
}
module.exports={readLatest};
