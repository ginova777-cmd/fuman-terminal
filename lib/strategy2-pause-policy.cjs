'use strict';
const {loadActiveModuleRegistry}=require('./terminal-active-module-registry');
function isStrategy2Paused(){const r=loadActiveModuleRegistry();if((r.paused||[]).some(x=>x.key==='strategy2'&&x.usage_policy==='PAUSED_BY_USER'))return true;if(r.active.some(x=>x.key==='strategy2'))return false;throw Error('STRATEGY2_POLICY_UNVERIFIED');}
function monitorEnabled(key){return key!=='strategy2'||!isStrategy2Paused();}
function assertStrategy2ExecutionAllowed(){if(isStrategy2Paused())throw Error('STRATEGY2_PAUSED_BY_USER');}
module.exports={isStrategy2Paused,monitorEnabled,assertStrategy2ExecutionAllowed};
