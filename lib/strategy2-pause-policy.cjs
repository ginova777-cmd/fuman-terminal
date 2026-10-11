'use strict';
const policy=require('./module-usage-policy.cjs');
function isStrategy2Paused(){return policy.isPaused('strategy2');}
function monitorEnabled(key){return policy.monitorEnabled(key);}
function assertStrategy2ExecutionAllowed(){if(isStrategy2Paused())throw Error('STRATEGY2_PAUSED_BY_USER');}
module.exports={isStrategy2Paused,monitorEnabled,assertStrategy2ExecutionAllowed};
