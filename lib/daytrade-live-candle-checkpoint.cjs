'use strict';
// Cooperative in the existing Writer. At most two attempts per minute; no
// background timer, subscription or detached work. A new completed frontier
// is independent of the quote cadence. Failed writes propagate unchanged.
function create({apply,run,leaseValid,roundDeadline,now=Date.now}){
 let frontier=-Infinity,lastAttempt=-Infinity,attemptMinute=-1,attempts=0,probes=0,busy=false;
 return async function checkpoint(stage){
  if(!apply)return {status:'SKIPPED_READ_ONLY'};
  if(busy)return {status:'BUSY'};
  const clock=now(),minute=Math.floor(clock/60000),target=(minute-1)*60000;
  if(frontier>=target)return {status:'NOT_DUE'};
  if(minute!==attemptMinute){attemptMinute=minute;attempts=0;probes=0;}
  if(attempts>=2||probes>=6||clock-lastAttempt<10000)return {status:'NOT_DUE'};
  const deadline=Math.min(roundDeadline,clock+15000);
  if(deadline-clock<5000||!leaseValid(deadline))return {status:'BYPASSED_LEASE_OR_DEADLINE',complete:false};
  probes++;attempts++;lastAttempt=clock;busy=true;
  try{const result=await run({deadline,minimumClosedMinute:new Date(target).toISOString(),canWrite:()=>leaseValid(deadline)});
   if(result?.status!=='LATEST_ROWS_READBACK_VERIFIED'&&result?.status!=='WAITING_NATURAL_CANDLES'&&result?.status!=='WAITING_CURRENT_MOTHER_POOL_SNAPSHOT')throw Error('LIVE_CANDLE_CHECKPOINT_NOT_VERIFIED');
   if(['WAITING_NATURAL_CANDLES','WAITING_CURRENT_MOTHER_POOL_SNAPSHOT'].includes(result.status))attempts--;
   const stamp=Date.parse(result.latest_closed_candle_time);if(Number.isFinite(stamp))frontier=Math.max(frontier,stamp);
   return {...result,checkpoint:stage,target_completed_minute:new Date(target).toISOString(),write_attempts_this_minute:attempts,local_probes_this_minute:probes,complete:false};
  }finally{busy=false;}
 };
}
module.exports={create};

