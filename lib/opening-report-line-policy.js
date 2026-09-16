"use strict";
const CONTRACT='opening-report-line-quota-exception-v1';
function eligible(line){return line?.line_push_attempted===true&&line.line_push_ok===false&&line.has_user_target===true&&line.has_group_target===true&&Number(line.target_count)>=2&&Number(line.delivered_count)<Number(line.target_count)&&/^(user|group):http_429(?:\s*;\s*(user|group):http_429)*\s*$/.test(String(line.line_error_detail||''));}
function accepted(line,run,hash,date){
 if(line?.report_run_id!==run||line?.delivery_content_hash!==hash)return false;
 if(line.line_push_ok===true&&line.has_user_target===true&&line.has_group_target===true&&Number(line.delivered_count)>=2)return true;
 const q=line.quota_exception,t=Date.parse(q?.checked_at),now=Date.now();
 return eligible(line)&&q?.contract===CONTRACT&&q.authorized_policy==='user-approved-20260916-morning-quota-exception'&&q.report_run_id===run&&q.delivery_content_hash===hash&&q.trade_date===date&&q.status==='quota_exhausted_not_delivered'&&q.source==='LINE Messaging API quota and consumption'&&q.quota_type==='limited'&&Number.isFinite(q.quota_limit)&&q.quota_limit>0&&Number.isFinite(q.total_usage)&&q.total_usage>=q.quota_limit&&Number.isFinite(t)&&t<=now+60000&&now-t<=86400000;
}
async function capture(line,token,run,hash,date){
 if(!eligible(line)||!token)return null;
 try{
 const get=async suffix=>{const res=await fetch('https://api.line.me/v2/bot/message/'+suffix,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(12000)});if(!res.ok)throw Error('quota_read_failed');return res.json();};
 const quota=await get('quota'),usage=await get('quota/consumption');
 if(quota.type!=='limited'||!Number.isFinite(quota.value)||quota.value<=0||!Number.isFinite(usage.totalUsage)||usage.totalUsage<quota.value)return null;
 return {contract:CONTRACT,authorized_policy:'user-approved-20260916-morning-quota-exception',status:'quota_exhausted_not_delivered',delivered:false,report_run_id:run,delivery_content_hash:hash,trade_date:date,source:'LINE Messaging API quota and consumption',quota_type:quota.type,quota_limit:quota.value,total_usage:usage.totalUsage,checked_at:new Date().toISOString()};
 }catch{return null;}
}
module.exports={CONTRACT,eligible,accepted,capture};
