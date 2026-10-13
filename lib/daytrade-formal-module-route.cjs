'use strict';
const session=require('./daytrade-module-session.cjs');
const supported=Object.freeze(['A01','A02','A05','A06','A07','A08','A09','A11','A12','A13']);
// Capability restriction after policy validation; this never enables a module.
function restrict(policy,registry,at=new Date()) {
 const active=session.select(policy,at);
 const requested=[...active.enabled,...(active.probe?[active.probe]:[])];
 if(requested.some(id=>!supported.includes(id)))return {status:'PAUSED',enabled:[],probe:null,paused:Object.keys(registry.modules||{}),reason:'MODULE_ISOLATION_NOT_IMPLEMENTED'};
 return policy;
}
module.exports={supported,restrict};
