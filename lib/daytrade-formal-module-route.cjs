'use strict';
const supported=require('./daytrade-independent-preopen-modules.cjs');
// Parent authorization is established by recovery-policy before this route.
// User-authorized A18 continuation occupies only an otherwise empty probe slot.
function restrict(policy,registry,at=new Date()) {
 const automaticA18=policy.status==='STAGED_RECOVERY' && policy.probe==null &&
   !Object.keys(policy.rejected||{}).length && registry.modules?.A18 &&
   !policy.enabled.includes('A18') && ['A15','A16','A17'].every(id=>policy.enabled.includes(id));
 if(automaticA18) policy={...policy,probe:'A18',automatic_probe:'A18',automatic_probe_reason:'AUTHORIZED_PARENTS_READY_FOR_CONDITIONAL_READBACK'};
 const requested=[...policy.enabled,...(policy.probe?[policy.probe]:[])];
 if(requested.some(id=>!((supported.includes(id)||['B01','B02','B03','B21','B11','B05','B15'].includes(id))||(id==='A18'&&['A15','A16','A17'].every(parent=>policy.enabled.includes(parent)))))){
  const rejected={...(policy.rejected||{})};
  for(const id of requested.filter(id=>!((supported.includes(id)||['B01','B02','B03','B21','B11','B05','B15'].includes(id))||(id==='A18'&&['A15','A16','A17'].every(parent=>policy.enabled.includes(parent))))))rejected[id]='MODULE_ISOLATION_NOT_IMPLEMENTED';
  const enabled=policy.enabled.filter(id=>!Object.hasOwn(rejected,id));
  const probe=policy.probe&&!Object.hasOwn(rejected,policy.probe)?policy.probe:null;
  return {...policy,status:enabled.length||probe?'STAGED_RECOVERY':'PAUSED',enabled,probe,rejected,
   paused:Object.keys(registry.modules||{}).filter(id=>!enabled.includes(id)),reason:'MODULE_ISOLATION_NOT_IMPLEMENTED'};
 }
 return policy;
}
module.exports={supported,restrict};
