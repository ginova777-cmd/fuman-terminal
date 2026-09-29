'use strict';
const fs=require('fs'),path=require('path');
function verify(root=path.resolve(__dirname,'..')){
 const issues=[];const c=JSON.parse(fs.readFileSync(path.join(root,'data/contracts/strategy3_runner_verifier_receipt_v1.json'),'utf8'));
 if(c.contract!=='strategy3_runner_verifier_receipt_v1'||c.verifier!=='scripts/verify-strategy3-complete.js'||c.receiptWriter!=='scripts/finalize-strategy3-complete.js')issues.push('contract_authority_mismatch');
 for(const f of [c.runner,c.verifier,c.receiptWriter,...c.requiredVerifiers])if(!fs.existsSync(path.join(root,f)))issues.push('required_component_missing:'+f);
 for(const f of c.activeReferenceFiles){const s=fs.readFileSync(path.join(root,f),'utf8');if(s.includes(c.retiredVerifier)||s.includes(c.retiredAlias))issues.push('retired_reference:'+f);}
 const retired=fs.readFileSync(path.join(root,c.retiredVerifier),'utf8');if(!retired.includes('RETIRED_STRATEGY3_VERIFIER')||!retired.includes('process.exitCode = 1')||retired.includes('require('))issues.push('retired_entry_not_disabled');
 const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));if(pkg.scripts['verify:strategy3-complete']!=='node --use-system-ca scripts/verify-strategy3-complete.js')issues.push('canonical_alias_mismatch');
 for(const f of [c.runner,c.receiptWriter])if(!fs.readFileSync(path.join(root,f),'utf8').includes('verify-strategy3-verifier-retirement'))issues.push('retirement_guard_missing:'+f);
 return {contract:'strategy3_verifier_retirement_v1',scope:'code_wiring_retirement',ok:issues.length===0,complete:issues.length===0,failed_checks:issues,first_blocker:issues[0]||null};
}
module.exports={verify};if(require.main===module){try{const r=verify();console.log(JSON.stringify(r,null,2));process.exitCode=r.ok?0:1;}catch(e){console.error(e.message);process.exitCode=1;}}
