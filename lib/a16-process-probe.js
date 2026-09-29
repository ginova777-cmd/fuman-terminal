'use strict';
function probe(pid,kill=process.kill.bind(process)) {
 if(!Number.isSafeInteger(pid)||pid<=0)return {state:'unknown',reason:'INVALID_PID'};
 try{kill(pid,0);return {state:'running',reason:'PROCESS_EXISTS'};}
 catch(error){if(error.code==='ESRCH')return {state:'absent',reason:'PROCESS_NOT_FOUND'};if(error.code==='EPERM'||error.code==='EACCES')return {state:'unknown',reason:'PROCESS_ACCESS_DENIED'};return {state:'unknown',reason:'PROCESS_PROBE_FAILED'};}
}
module.exports={probe};
