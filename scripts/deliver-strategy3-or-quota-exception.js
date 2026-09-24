"use strict";
const fs=require('fs'),path=require('path'),{execFileSync,spawnSync}=require('child_process');
const c=require('./strategy3-v2-contract'),policy=require('../lib/strategy3-line-exception');
const date=process.argv.find(x=>x.startsWith('--trade-date='))?.slice(13)||c.taipeiDate(),day=date.replace(/-/g,'');
if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||date>c.taipeiDate())throw Error('invalid_recovery_trade_date');
const replay=process.argv.includes('--recovery-replay');
function secret(n){try{return fs.readFileSync(path.join(c.RUNTIME_DIR,'secrets',n),'utf8').trim()}catch{return ''}}
function reg(n){try{return execFileSync('reg.exe',['query','HKCU\\Environment','/v',n],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','ignore']}).trim().split(/\s{2,}/).pop().trim()}catch{return ''}}
async function main(){
 const scan=c.readJson(path.join(c.RUNTIME_DIR,'data/scan-receipts',`strategy3-v2-recovery-replay-${day}.json`),null);
 if(!replay||scan?.trade_date!==date||scan?.ok!==true||scan?.apply!==true||scan?.status!=='RECOVERY_REPLAY_COMPLETE')throw Error('quota_exception_requires_applied_same_day_replay');
 const file=path.join(c.RUNTIME_DIR,'data/line-cards',`strategy3-v2-line-card-${day}.recovery-replay.json`),old=c.readJson(file,null);
 if(old?.ok===true&&old.run_id===scan.run_id){console.log('same_run_delivered_receipt_preserved');return;}
 const token=process.env.FUMAN_LINE_CHANNEL_ACCESS_TOKEN||process.env.LINE_CHANNEL_ACCESS_TOKEN||reg('FUMAN_LINE_CHANNEL_ACCESS_TOKEN')||reg('LINE_CHANNEL_ACCESS_TOKEN')||secret('line-channel-access-token.txt');
 if(!token)throw Error('line_token_missing');
 const get=async suffix=>{const r=await fetch('https://api.line.me/v2/bot/message/'+suffix,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error('line_quota_http_'+r.status);return r.json();};
 const q=await get('quota'),u=await get('quota/consumption');
 if(q.type!=='limited'||!Number.isFinite(q.value)||q.value<=0||!Number.isFinite(u.totalUsage)||u.totalUsage<q.value){const r=spawnSync(process.execPath,['--use-system-ca',path.join(__dirname,'send-strategy3-v2-line-card.js'),'--recovery-replay','--trade-date='+date],{stdio:'inherit',windowsHide:true});process.exitCode=r.status===0?0:1;return;}
 const receipt={status:'SKIPPED_QUOTA_EXHAUSTED',ok:false,date,run_id:scan.run_id,count:scan.result_count,line_push_personal_ok:false,line_push_group_ok:false,delivery_evidence:[],authorization_sha256:policy.quotaPolicyHash,reason:'line_monthly_quota_exhausted_user_accepted',checked_at:new Date().toISOString(),quota_evidence:{source:'LINE Messaging API quota and consumption',quota_type:q.type,quota_limit:q.value,total_usage:u.totalUsage,checked_at:new Date().toISOString(),delivered:false}};
 if(!policy.valid(receipt,scan,date))throw Error('quota_evidence_contract_failed');
 if(old)fs.copyFileSync(file,file+'.before-quota-'+Date.now());c.writeJson(file,receipt);console.log(JSON.stringify(receipt));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
