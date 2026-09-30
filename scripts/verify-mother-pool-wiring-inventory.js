'use strict';
// Static entrypoint inventory only. Natural module receipts remain mandatory.
const fs=require('node:fs'),path=require('node:path');
function verify(root){
 const failures=[],read=p=>fs.readFileSync(path.join(root,p),'utf8');
 let registry;try{registry=JSON.parse(read('data/contracts/mother-pool-a01-b24-module-registry-v1.json'));}catch{return {ok:false,scope:'static_entrypoint_inventory_only',failed_checks:['REGISTRY_UNREADABLE']};}
 const expected=[...Array.from({length:19},(_,i)=>'A'+String(i+1).padStart(2,'0')).filter(x=>x!=='A10'),...Array.from({length:24},(_,i)=>'B'+String(i+1).padStart(2,'0')).filter(x=>x!=='B15')];
 const ids=Object.keys(registry.modules||{});
 if(ids.length!==expected.length||expected.some(id=>typeof registry.modules[id]!=='string'||!registry.modules[id])||ids.some(id=>!expected.includes(id)))failures.push('MODULE_REGISTRY_SCOPE_INVALID');
 if(!Array.isArray(registry.excluded)||!['A10','B15','B25'].every(id=>registry.excluded.includes(id)))failures.push('EXCLUSIONS_INVALID');
 const required=['scripts/run-daytrade-source-writer.js','scripts/capture-daytrade-module-readbacks.js','scripts/run-daytrade-module-verifiers.js','scripts/verify-daytrade-module-receipt.js','scripts/verify-daytrade-mother-pool-a01-b24-total.js','lib/verify-mother-pool-module-round.js','lib/preopen-a15-a19.js','lib/intraday-context-detectors-b19-b24.js'];
 for(const file of required)if(!fs.existsSync(path.join(root,file)))failures.push('ENTRYPOINT_MISSING:'+file);
 const links=[['scripts/run-daytrade-source-writer.js','capture-daytrade-module-readbacks.js'],['scripts/run-daytrade-source-writer.js','run-daytrade-module-verifiers.js'],['scripts/run-daytrade-module-verifiers.js','verify-daytrade-module-receipt.js'],['scripts/run-daytrade-module-verifiers.js','verify-daytrade-mother-pool-a01-b24-total.js'],['scripts/verify-daytrade-mother-pool-a01-b24-total.js','verify-mother-pool-wiring-inventory.js']];
 for(const [file,target] of links)if(fs.existsSync(path.join(root,file))&&!read(file).includes(target))failures.push('ENTRYPOINT_REFERENCE_MISSING:'+file+':'+target);
 return {ok:failures.length===0,scope:'static_entrypoint_inventory_only',count:ids.length,excluded:registry.excluded,failed_checks:failures,natural_complete:false};
}
if(require.main===module){const result=verify(path.join(__dirname,'..'));console.log(JSON.stringify(result));process.exitCode=result.ok?0:1;}
module.exports={verify};
