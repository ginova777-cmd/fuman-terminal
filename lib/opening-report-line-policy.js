"use strict";
const CONTRACT='opening-report-line-quota-exception-v1';
const POLICY=require('../data/contracts/opening_report_notification_policy_v1.json');
function pauseEnabled(date){return POLICY.contract==='opening-report-notification-policy-v1'&&POLICY.line_mode==='paused'&&POLICY.delivery_required===false&&POLICY.completion_scope==='tri_surface'&&POLICY.authorization==='user-20260926-continue-line-pause-separate-surface-acceptance'&&/^\d{4}-\d{2}-\d{2}$/.test(date)&&date>=POLICY.effective_from;}
function pausedReceipt(run,hash,date){if(!pauseEnabled(date))throw Error('line_pause_not_authorized');return {contract:POLICY.contract,notification_status:'paused_by_user',authorization:POLICY.authorization,trade_date:date,report_run_id:run,run_id:run,delivery_content_hash:hash,line_push_attempted:false,line_push_ok:false,delivered:false,delivered_count:0,target_count:0,has_user_target:false,has_group_target:false,token_logged:false,target_logged:false,checked_at:new Date().toISOString(),completion_scope:'tri_surface'};}
function paused(line,run,hash,date){return pauseEnabled(date)&&line?.contract===POLICY.contract&&line.authorization===POLICY.authorization&&line.notification_status==='paused_by_user'&&line.completion_scope==='tri_surface'&&line.trade_date===date&&line.report_run_id===run&&line.delivery_content_hash===hash&&line.line_push_attempted===false&&line.line_push_ok===false&&line.delivered===false&&line.delivered_count===0;}
function notificationAccepted(line,run,hash,date,at){return paused(line,run,hash,date)||accepted(line,run,hash,date,at);}
function eligible(line){return line?.line_push_attempted===true&&line.line_push_ok===false&&line.has_user_target===true&&line.has_group_target===true&&Number(line.target_count)>=2&&Number(line.delivered_count)<Number(line.target_count)&&/^(user|group):http_429(?:\s*;\s*(user|group):http_429)*\s*$/.test(String(line.line_error_detail||''));}
function accepted(line,run,hash,date,at=Date.now()){
 if(line?.report_run_id!==run||line?.delivery_content_hash!==hash)return false;
 if(line.line_push_ok===true&&line.has_user_target===true&&line.has_group_target===true&&Number(line.delivered_count)>=2)return true;
 const q=line.quota_exception,t=Date.parse(q?.checked_at),now=Number(at);
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
module.exports={CONTRACT,eligible,accepted,capture,pauseEnabled,pausedReceipt,paused,notificationAccepted};
