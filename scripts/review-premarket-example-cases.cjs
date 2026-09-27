'use strict';
const fs=require('node:fs'),path=require('node:path');
const {reviewCase}=require('../lib/telegram-detectors/premarket-plan-contract.cjs');
const cases=require('../lib/telegram-detectors/premarket-example-cases.cjs');
function build(){return {contract:'premarket_example_review_receipt_v1',scope:'user_example_review_only',status:'blocked',complete:false,production_complete:false,reason:'FORMAL_SOURCE_AND_SCENARIO_RULES_UNVERIFIED',rows:cases.map(reviewCase)};}
if(require.main===module){
 const output=process.argv[2];if(!output)throw Error('EXPLICIT_REVIEW_OUTPUT_REQUIRED');
 const resolved=path.resolve(output);if(/fuman-runtime|prod81/i.test(resolved))throw Error('REVIEW_OUTPUT_MUST_NOT_BE_PRODUCTION');
 fs.mkdirSync(path.dirname(resolved),{recursive:true});fs.writeFileSync(resolved,JSON.stringify(build(),null,2));
 console.log(JSON.stringify({output:resolved,scope:'user_example_review_only',status:'blocked',case_count:cases.length}));
}
module.exports={build};
