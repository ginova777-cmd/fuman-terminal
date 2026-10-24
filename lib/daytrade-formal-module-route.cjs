'use strict';
const supported=require('./daytrade-independent-preopen-modules.cjs');
// Capability restriction after policy validation; this never enables a module.
function restrict(policy,registry,at=new Date()) {
 const requested=[...policy.enabled,...(policy.probe?[policy.probe]:[])];
 if(requested.some(id=>!(supported.includes(id)||(id==='A18'&&['A15','A16','A17'].every(parent=>policy.enabled.includes(parent)))))){
  const rejected={...(policy.rejected||{})};
  for(const id of requested.filter(id=>!(supported.includes(id)||(id==='A18'&&['A15','A16','A17'].every(parent=>policy.enabled.includes(parent))))))rejected[id]='MODULE_ISOLATION_NOT_IMPLEMENTED';
  const enabled=policy.enabled.filter(id=>!Object.hasOwn(rejected,id));
  const probe=policy.probe&&!Object.hasOwn(rejected,policy.probe)?policy.probe:null;
  return {...policy,status:enabled.length||probe?'STAGED_RECOVERY':'PAUSED',enabled,probe,rejected,
   paused:Object.keys(registry.modules||{}).filter(id=>!enabled.includes(id)),reason:'MODULE_ISOLATION_NOT_IMPLEMENTED'};
 }
 return policy;
}
module.exports={supported,restrict};
