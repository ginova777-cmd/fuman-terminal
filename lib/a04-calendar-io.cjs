'use strict';
// No retries; timeout includes body consumption and respects the caller's deadline.
function createCalendarIO({url,key,deadlineMs,clock=Date.now,fetchImpl=fetch}){
 async function request(query,body){
  const left=Math.min(5000,deadlineMs-clock());if(left<=0)throw Error('CALENDAR_BUDGET_EXHAUSTED');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),left);
  try{
   const response=await fetchImpl(url+'/rest/v1/market_calendar?'+query,{method:body?'POST':'GET',redirect:'error',
    headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json',...(body?{Prefer:'resolution=merge-duplicates,return=minimal'}:{})},
    ...(body?{body:JSON.stringify(body)}:{}),signal:controller.signal});
   if(!response.ok){await response.body?.cancel();throw Error('CALENDAR_HTTP_'+response.status);}
   const chunks=[];let bytes=0;for await(const chunk of response.body||[]){bytes+=chunk.length;if(bytes>2*1024*1024){controller.abort();throw Error('CALENDAR_BODY_BOUND');}chunks.push(Buffer.from(chunk));}
   if(body)return;return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }finally{clearTimeout(timer);}
 }
 return {readDays:(from,to,n)=>request('select=trade_date,market,is_open,session,updated_at,payload&market=eq.TW&trade_date=gte.'+from+'&trade_date=lte.'+to+'&order=trade_date.desc&limit='+(n+1)),
  writeRows:async rows=>{for(let i=0;i<rows.length;i+=10)await request('on_conflict=trade_date,market',rows.slice(i,i+10));}};
}
module.exports={createCalendarIO};
