'use strict';
const fs=require('fs');const {guardedInspect}=require('./fresh-epoch.cjs');
const start=Date.now();guardedInspect({isolatedFault:'HANG'}).then(()=>{throw Error('UNEXPECTED_SUCCESS');}).catch(e=>{const r={status:e.message==='TIMEOUT'?'PASS':'BLOCKED',expected:'TIMEOUT',trigger_reason:e.message,elapsed_ms:Date.now()-start,resource:e.resource,stage:e.stage};fs.writeFileSync(process.argv[2],JSON.stringify(r,null,2));console.log(JSON.stringify(r));process.exitCode=r.status==='PASS'?0:1;});
