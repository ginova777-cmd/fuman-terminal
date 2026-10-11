'use strict';
const {loadActiveModuleRegistry}=require('./terminal-active-module-registry');
const aliases=Object.freeze({'strategy1/open-buy':'strategy1','open-buy':'strategy1','cb-detect':'cb','warrant-flow':'warrant'});
const policyKeys=Object.freeze(["strategy1","strategy2","heatmap","market-ai","realtime-radar","cb","warrant"]);
function canonicalKey(key){return aliases[key]||key;}
function isPaused(key){key=canonicalKey(key);if(!policyKeys.includes(key))return false;const r=loadActiveModuleRegistry();if((r.paused||[]).some(x=>x.key===key&&x.usage_policy==='PAUSED_BY_USER'))return true;if(r.active.some(x=>x.key===key))return false;throw Error('MODULE_POLICY_UNVERIFIED:'+key);}
function monitorEnabled(key){return !isPaused(key);}
module.exports={canonicalKey,policyKeys,isPaused,monitorEnabled};
