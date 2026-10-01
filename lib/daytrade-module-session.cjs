'use strict';
const clock=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Taipei',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
function session(at=new Date()){
 const date=new Date(at);if(!Number.isFinite(date.getTime()))return 'CLOSED';
 const parts=Object.fromEntries(clock.formatToParts(date).map(p=>[p.type,p.value]));
 const minute=Number(parts.hour)*60+Number(parts.minute);
 return minute>=360&&minute<540?'PREOPEN':minute>=540&&minute<810?'INTRADAY':'CLOSED';
}
function allowed(id,at=new Date()){
 const phase=session(at);
 return phase==='PREOPEN'?/^A(?:0[1-9]|1[0-9])$/.test(id):phase==='INTRADAY'?/^B\d{2}$/.test(id):false;
}
function select(policy,at=new Date()){
 const enabled=(policy.enabled||[]).filter(id=>allowed(id,at));
 const probe=policy.probe&&allowed(policy.probe,at)?policy.probe:null;
 const configured=[...(policy.enabled||[]),...(policy.probe?[policy.probe]:[])];
 return {...policy,enabled,probe,session:session(at),timezone:'Asia/Taipei',deferred_by_session:configured.filter(id=>!allowed(id,at))};
}
module.exports={session,allowed,select};
