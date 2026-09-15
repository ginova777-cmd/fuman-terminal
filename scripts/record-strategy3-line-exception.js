"use strict";
const fs=require('fs'),path=require('path');
const {allowed,valid,policyHash}=require('../lib/strategy3-line-exception');
const c=require('./strategy3-v2-contract');
const date=c.taipeiDate(),compact=date.replace(/-/g,'');
if(!allowed(date,process.argv.includes('--recovery-replay')))throw Error('line_exception_not_authorized_for_date_or_mode');
const scan=c.readJson(path.join(c.RUNTIME_DIR,'data/scan-receipts',`strategy3-v2-recovery-replay-${compact}.json`),null);
if(scan?.trade_date!==date||scan?.status!=='RECOVERY_REPLAY_COMPLETE'||scan.ok!==true||scan.apply!==true)throw Error('line_exception_requires_applied_recovery_scan');
const file=path.join(c.RUNTIME_DIR,'data/line-cards',`strategy3-v2-line-card-${compact}.recovery-replay.json`);
const old=c.readJson(file,null);
if(old?.ok===true&&old.run_id===scan.run_id){console.log('Existing successful delivery preserved');process.exit(0);}
const receipt={status:'SKIPPED_QUOTA_EXHAUSTED',ok:false,date,run_id:scan.run_id,count:scan.result_count,line_push_personal_ok:false,line_push_group_ok:false,delivery_evidence:[],authorization_sha256:policyHash,reason:'line_monthly_quota_exhausted_user_accepted',checked_at:new Date().toISOString()};
if(!valid(receipt,scan,date))throw Error('line_exception_identity_invalid');
if(old)fs.copyFileSync(file,file+'.before-exception-'+Date.now());
c.writeJson(file,receipt);console.log(JSON.stringify(receipt));
