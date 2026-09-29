'use strict';
function budget(previous,summary){
 const attempted=Number(summary?.attempted_count||0);
 if(!Number.isInteger(attempted)||attempted<0)throw Error('A16_PROGRESS_INVALID');
 // Legacy exhausted launches remain exhausted; a code release must not reset them.
 if(previous&&previous.resume_contract!=='a16_progress_resume_v1'&&previous.attempts>=2)
  return {allowed:false,reason:'DAILY_RETRY_LIMIT'};
 const progressed=previous&&Number.isInteger(previous.last_attempted_count)&&attempted>previous.last_attempted_count;
 const stalls=previous?(progressed?0:Number(previous.no_progress_attempts||0)+1):0;
 return {allowed:stalls<2,reason:stalls>=2?'NO_PROGRESS_RETRY_LIMIT':null,
  resume_contract:'a16_progress_resume_v1',last_attempted_count:attempted,no_progress_attempts:stalls};
}
module.exports={budget};
