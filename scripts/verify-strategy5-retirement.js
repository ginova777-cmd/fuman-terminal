"use strict";
const fs=require("fs"),path=require("path");
function retirementIssues(root,io=fs){
const fs=io,issues=[];
let packageSource="";try{packageSource=fs.readFileSync(path.join(root,"package.json"),"utf8");}catch{issues.push("retirement_package_unreadable");}
const retiredVerifiers = [
  "run-strategy5-battle-verify.ps1",
  "scripts/verify-strategy5-battle-state.js",
  "scripts/verify-strategy5-alert-path.js",
  "scripts/verify-strategy5-prewater-static-fields.js",
  "scripts/verify-strategy5-prewater-fixtures.js",
  "scripts/verify-strategy5-prewater-formal-payloads.js",
  "scripts/verify-strategy5-business-fields.js",
  "scripts/verify-strategy5-post-restore-readonly.js",
  "scripts/strategy5-live-bad-source-drill.js",
];
for (const retired of retiredVerifiers) {
  if (fs.existsSync(path.join(root, retired))) issues.push(`retired_verifier_returned:${retired}`);
}
for (const retiredScript of ["verify:strategy5-alert-path", "verify:strategy5-prewater", "verify:strategy5-business-fields", "verify:strategy5-formal-payloads", "verify:strategy5-live-bad-source-drill", "verify:strategy5-post-restore-readonly"]) {
  if (packageSource.includes(`"${retiredScript}"`)) issues.push(`retired_verifier_package_reference_returned:${retiredScript}`);
}
return issues;
}
module.exports={retirementIssues};
if(require.main===module){const issues=retirementIssues(path.resolve(__dirname,".."));console.log(JSON.stringify({ok:issues.length===0,root:path.resolve(__dirname,".."),issues}));process.exitCode=issues.length?1:0;}
