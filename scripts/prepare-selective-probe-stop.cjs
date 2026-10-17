'use strict';
const fs=require('node:fs');
const {prepare}=require('../lib/daytrade-selective-probe-stop.cjs');
try {
 const [file,approval]=process.argv.slice(2),g=JSON.parse(fs.readFileSync(approval,'utf8'));
 const result=prepare({before:fs.readFileSync(file),expectedHash:g.expected_policy_sha256,
  identity:{release_sha:g.target,trade_date:g.trade_date},target:g.module_id,
  registry:require('../data/contracts/mother-pool-a01-b24-module-registry-v1.json')});
 console.log(JSON.stringify({...result,after:undefined,after_base64:result.after.toString('base64')}));
} catch(error){console.error(String(error.message));process.exitCode=1;}
