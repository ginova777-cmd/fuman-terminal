'use strict';
const path=require('path');
const registry=require('./tom-strategy-map.cjs');
const {isClosedRow,isExplicitTradingRow}=require('../scripts/twse-trading-day.js');
const dateOf=t=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(t));
function build({now,calendar,tasks,policy,runtimeRoot,overrides=[]}){
  if(!Number.isFinite(Date.parse(now)))throw Error('invalid_now');
  if(!policy||policy.contract!=='tom-manifest-policy-v1'||policy.approved!==true)throw Error('policy_not_approved');
  if(!Array.isArray(calendar?.rows)||!calendar.rows.length||!Number.isFinite(Date.parse(calendar.cachedAt))||Date.parse(now)-Date.parse(calendar.cachedAt)>7*86400000||Date.parse(calendar.cachedAt)>Date.parse(now))throw Error('calendar_unverified');
  if(!Array.isArray(overrides))throw Error('override_invalid');
  const overrideMap=new Map();
  for(const row of overrides){
    const date=row.date||row.tradeDate||row.marketDate,value=row.marketOpen??row.isTradingDay;
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||typeof value!=='boolean'||!row.source||!row.lockedBy)throw Error('override_invalid');
    if(overrideMap.has(date)&&overrideMap.get(date)!==value)throw Error('override_conflict');
    overrideMap.set(date,value);
  }
  const today=dateOf(now),year=Number(today.slice(0,4));
  if(!calendar.rows.some(r=>String(r.Date).startsWith(String(year-1911))))throw Error('calendar_year_mismatch');
  function open(date){if(overrideMap.has(date))return overrideMap.get(date);const roc=String(Number(date.slice(0,4))-1911)+date.slice(5).replace('-','');const row=calendar.rows.find(r=>String(r.Date)===roc);if(row&&isExplicitTradingRow(row))return true;if(row&&isClosedRow(row))return false;return ![0,6].includes(new Date(date+'T12:00:00+08:00').getUTCDay());}
  function lastSlot(spec){
    if(!['trading','calendar_day'].includes(spec.calendar))throw Error('calendar_policy_invalid');
    const matches=tasks.filter(t=>t.name===spec.taskName);if(matches.length!==1)throw Error('task_mapping_ambiguous:'+spec.taskName);
    const t=matches[0];if(t.state==='Disabled')throw Error('required_task_disabled:'+spec.taskName);
    if(!Array.isArray(t.actions)||t.actions.length!==1||t.actions[0].Arguments!==spec.expectedArguments)throw Error('task_entry_drift:'+spec.taskName);
    if(spec.expectedExecute!==undefined&&t.actions[0].Execute!==spec.expectedExecute)throw Error('task_executable_drift');
    if(spec.expectedWorkingDirectory!==undefined&&(t.actions[0].WorkingDirectory??null)!==spec.expectedWorkingDirectory)throw Error('task_directory_drift');
    const ts=t.triggers.filter(x=>x.Enabled!==false);if(ts.length!==1||!ts[0].StartBoundary)throw Error('task_slot_ambiguous:'+spec.taskName);
    const hhmm=ts[0].StartBoundary.match(/T(\d{2}:\d{2})/)?.[1];if(!hhmm||hhmm!==spec.approvedSlot)throw Error('task_slot_drift:'+spec.taskName);
    const mask=ts[0].DaysOfWeek;
    for(let i=0;i<32;i++){let date=new Date(Date.parse(today+'T12:00:00+08:00')-i*86400000).toISOString().slice(0,10);let at=date+'T'+hhmm+':00+08:00';const wd=new Date(at).getUTCDay();if(mask!=null&&!(mask&(1<<wd)))continue;if(spec.calendar==='trading'&&!open(date))continue;if(Date.parse(at)<=Date.parse(now))return {date,at};}
    throw Error('no_due_slot_in_bound');
  }
  const rows=[];
  for(const [task,m] of Object.entries(registry)){
    if(m.scope!=='CONFIRMED'){rows.push({task,receipt:path.join(runtimeRoot,'data/scan-receipts',m.receipt||'unverified-'+task.replaceAll('/','-')+'.json'),expected:{date:today,paused:m.scope==='PAUSED_BY_USER'}});continue;}
    const spec=policy.strategies?.[task];if(!spec)throw Error('strategy_policy_missing:'+task);
    const slot=lastSlot(spec);rows.push({task,receipt:path.join(runtimeRoot,'data/scan-receipts',m.receipt),expected:{date:slot.date,due:true},slotEvidence:slot});
  }
  const cleanup={};for(const [key,spec] of Object.entries(policy.cleanup||{})){
    if(spec.kind==='once'){cleanup[key]={verified:!!spec.expectedReceiptSha256,kind:'once',expectedReceiptSha256:spec.expectedReceiptSha256||null};continue;}
    const slot=lastSlot(spec);cleanup[key]={verified:true,kind:'daily',expectedDate:slot.date,expectedSlotAt:slot.at,observedAt:now,due:true};
  }
  return {manifest:{contract:'tom-receipt-manifest-v1',asOfDate:today,generatedAt:now,requireFormalMapping:true,tasks:rows},cleanup:{asOfDate:today,generatedAt:now,tasks:cleanup}};
}
module.exports={build};
