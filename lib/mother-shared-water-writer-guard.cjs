'use strict';
const backoff=require('../scripts/writer-database-backoff.cjs');
// Called under the existing wrapper's exclusive lock. Never claims or renews a
// lease, resets backoff, or starts another process.
function createGuard({backoffFile,lease,tradeDate,now=Date.now,marginMs=45000}){
 if(typeof lease!=='function'||typeof tradeDate!=='string'||!backoffFile||!Number.isFinite(marginMs)||marginMs<45000)throw Error('SHARED_WATER_GUARD_CONFIG');
 return function canPublish(){
  const time=now(),date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(time));
  if(date!==tradeDate||backoff.check(backoffFile,time).blocked)return false;
  const current=lease();
  return current?.ok===true&&current.status==='claimed'&&Date.parse(current.leaseExpiresAt)>time+marginMs;
 };
}
module.exports={createGuard};
