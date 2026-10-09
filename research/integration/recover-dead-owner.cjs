'use strict';
const fs=require('fs'),path=require('path');
// Explicit offline recovery only; a live or inaccessible PID is never reclaimed.
function reclaim(directory,name,expectedPid){
 if(!['coordinator.lock','owner.lock'].includes(name)||!Number.isSafeInteger(expectedPid)||expectedPid<=0)throw Error('LOCK_IDENTITY');
 const file=path.join(path.resolve(directory),name);if(/fuman-runtime|fuman-release-owner|prod81/i.test(file))throw Error('FORMAL_PATH_FORBIDDEN');
 const raw=fs.readFileSync(file,'utf8');let pid;try{const v=JSON.parse(raw);pid=typeof v==='number'?v:v.pid;}catch{throw Error('LOCK_UNKNOWN');}
 if(pid!==expectedPid)throw Error('LOCK_OWNER_CHANGED');
 try{process.kill(pid,0);throw Error('OWNER_ALIVE');}catch(e){if(e.code!=='ESRCH')throw e;}
 if(fs.readFileSync(file,'utf8')!==raw)throw Error('LOCK_CHANGED');
 const archived=file+'.dead-'+pid+'-'+Date.now();fs.renameSync(file,archived);return {status:'DEAD_OWNER_ARCHIVED',pid,archived};
}
module.exports={reclaim};
