'use strict';
function session(nowMs){
 const local=new Date(nowMs+8*3600000);
 const date=local.toISOString().slice(0,10),minute=local.getUTCHours()*60+local.getUTCMinutes();
 return {date,minute,intervalMs:minute>=540&&minute<810?1000:minute>=360&&minute<540?60000:0,midnight:Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate())-8*3600000};
}
function createDetectionRuntime({evaluate,getInputs,store,now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout}){
 let timer=null,running=false,inTick=false;
 const status={mode:'volatile_detection',complete:false,scans:0,failures:0,last_duration_ms:null,max_duration_ms:0,last_blocker:'NOT_STARTED',over_budget:0};
 function schedule(){
  if(!running)return;
  clearTimer(timer);
  const ms=now(),s=session(ms);
  const boundaries=[s.midnight+360*60000,s.midnight+540*60000,s.midnight+810*60000,s.midnight+86400000+360*60000].filter(x=>x>ms);
  const next=s.intervalMs?Math.min(Math.floor(ms/s.intervalMs)*s.intervalMs+s.intervalMs,...boundaries):Math.min(...boundaries);
  timer=setTimer(tick,Math.max(1,next-ms));
 }
 function tick(){
  if(!running||inTick)return;
  inTick=true;const started=now(),s=session(started);
  try{
   if(!s.intervalMs){store.invalidate();status.last_blocker='OUTSIDE_DETECTION_SESSION';return;}
   const inputs=getInputs();
   if(inputs?.tradeDate!==s.date||inputs?.calendar?.tradeDate!==s.date||inputs?.calendar?.isTradingDay!==true)throw Error('CURRENT_TRADING_CALENDAR_REQUIRED');
   if(!inputs.identity||inputs.identity.trade_date!==s.date||!inputs.identity.canonical_run_id)throw Error('CURRENT_DETECTOR_IDENTITY_REQUIRED');
   const result=evaluate(inputs);
   if(result&&typeof result.then==='function'){result.catch(()=>{});throw Error('ASYNC_IO_FORBIDDEN_IN_DETECTION');}
   const evaluatedRows=Array.isArray(result)?result:result?.rows;
   if(!Array.isArray(evaluatedRows))throw Error('DETECTOR_ROWS_REQUIRED');
   const rows=evaluatedRows.map(row=>({...row.payload,...row,symbol:row.symbol,payload:undefined}));
   const quotes=rows.map(row=>inputs.quoteMap.get(row.symbol)).filter(Boolean);
   store.publish({trade_date:s.date,canonical_run_id:inputs.identity.canonical_run_id,observed_at:new Date(started).toISOString(),rows,quotes,source_evidence:result?.source_evidence});
   status.scans++;status.last_blocker=null;status.last_observed_at=new Date(started).toISOString();
  }catch(error){store.invalidate();status.failures++;status.last_blocker=String(error.message||error);}
  finally{
   status.last_duration_ms=Math.max(0,now()-started);status.max_duration_ms=Math.max(status.max_duration_ms,status.last_duration_ms);
   if(s.intervalMs&&status.last_duration_ms>s.intervalMs)status.over_budget++;
   inTick=false;schedule();
  }
 }
 return {start(){if(running)return;running=true;tick();},stop(){running=false;clearTimer(timer);store.invalidate();},status:()=>({...status,running})};
}
module.exports={session,createDetectionRuntime};
