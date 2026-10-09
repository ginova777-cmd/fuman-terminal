'use strict';
const fs=require('fs'),crypto=require('crypto'),{build}=require('./build-intake-isolated-copy.cjs');
function buildStock(root,sourceHash){
 const original=build(root,sourceHash);let s=fs.readFileSync(original.file,'utf8').replaceAll('\r\n','\n');
 function once(a,b){if(s.split(a).length!==2)throw Error('R3_ANCHOR_DRIFT');s=s.replace(a,b);}
 once('let isolatedFrozen=false, isolatedOriginalAck=null;', 'let r3Stopping=false,r3Socket=null;let isolatedFrozen=false, isolatedOriginalAck=null;');
 once('ws = new WebSocket(STREAMING_URL);','if(r3Stopping){resolve();return;}ws = new WebSocket(STREAMING_URL);r3Socket=ws;');
 once('ws.addEventListener("message", (event) => stageTiming.run("message", () => {','ws.addEventListener("message", (event) => stageTiming.run("message", () => {if(r3Stopping)return;');
 once('let reconnectDelayMs = STREAMING_RECONNECT_INITIAL_MS;\n  while (true) {','let reconnectDelayMs = STREAMING_RECONNECT_INITIAL_MS;\n  while (!r3Stopping) {');
 once("process.once('exit', () => preopenWorker?.kill());", "// R3: preopen child is disconnected and awaited by the graceful port.");
 s+=`\nmodule.exports.r3Freeze=async function(challenge,binding){
 r3Stopping=true;r3Socket?.close(1000,'owner maintenance');
 const proof=await module.exports.isolatedIntake.freeze(challenge,binding);
 const journalHealth=[await providerSideJournal.drain(),await providerTradeJournal.drain()];if(journalHealth.some(h=>!h.ok||h.queued_records!==0))throw Error('JOURNAL_NOT_DRAINED');proof.journal_health=journalHealth;
 if(preopenWorker&&preopenWorker.exitCode===null){await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('PREOPEN_NOT_EXITED')),5000);preopenWorker.once('exit',()=>{clearTimeout(t);resolve();});if(preopenWorker.connected)preopenWorker.disconnect();});}
 return proof;
};\n`;
 fs.writeFileSync(original.file,s);return {...original,modified_sha256:crypto.createHash('sha256').update(s).digest('hex')};
}
module.exports={buildStock};
