'use strict';
const fs=require('fs'),path=require('path');
function verifyRetirement(root=path.resolve(__dirname,'..')) {
 const read=p=>fs.readFileSync(path.join(root,p),'utf8');
 const runner=read('run-strategy4.ps1'),legacy=read('scripts/finalize-strategy4-receipt.js'),current=read('scripts/verify-strategy4-complete.js');
 if(runner.includes('scripts\\finalize-strategy4-receipt.js')||!runner.includes('scripts\\verify-strategy4-complete.js'))throw Error('strategy4_runner_verifier_drift');
 if(!legacy.includes('RETIRED_STRATEGY4_VERIFIER')||legacy.includes('writeFileSync')||legacy.includes('module.exports'))throw Error('strategy4_legacy_verifier_restored');
 if(!current.includes("runRendered(run,scan)")||!current.includes('strategy4_runner_verifier_receipt_v3'))throw Error('strategy4_rendered_gate_removed');
 return {ok:true,contract:'strategy4_runner_verifier_receipt_v3',retired:'finalize-strategy4-receipt.js',canonical:'verify-strategy4-complete.js'};
}
module.exports={verifyRetirement};if(require.main===module){try{console.log(JSON.stringify(verifyRetirement()));}catch(e){console.error(e.message);process.exitCode=1;}}
