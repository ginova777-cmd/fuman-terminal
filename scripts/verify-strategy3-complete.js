'use strict';
// Read-only completion evaluation; finalizer remains the sole production receipt writer.
const {spawnSync}=require('child_process'),path=require('path');
const ROOT=path.resolve(__dirname, '..');
const guard=require('./verify-strategy3-verifier-retirement').verify(ROOT);
if(!guard.ok){console.log(JSON.stringify(guard));process.exitCode=1;}else{
 const supplied=process.argv.slice(2);const allowed=supplied.every(x=>x==='--recovery-replay'||x==='--status-only'||/^--trade-date=\d{4}-\d{2}-\d{2}$/.test(x));
 if(!allowed){console.error('UNSUPPORTED_STRATEGY3_VERIFIER_ARGUMENT');process.exitCode=1;}else{
 const r=spawnSync(process.execPath,['--use-system-ca',path.join(__dirname,'finalize-strategy3-complete.js'),'--status-only',...supplied.filter(x=>x!=='--status-only')],{encoding:'utf8',windowsHide:true,timeout:120000});
 if(r.stdout)process.stdout.write(r.stdout);if(r.stderr)process.stderr.write(r.stderr);process.exitCode=r.status===0?0:1;
 }
}
