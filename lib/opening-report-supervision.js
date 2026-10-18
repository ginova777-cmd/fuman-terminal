'use strict';
// Pure receipt decisions for the existing TOM/Codex reader. No network or sender.
const {contentReceiptMatches,deliveryReceiptMatches}=require('./opening-report-receipt-authority');
const STAGES=['us_0820','asia_0850'];
function stageResult(date,stage,evidence={}) {
  const {final,content,wrapper,canonical}=evidence,run=final?.run_id,hash=final?.delivery_content_hash;
  const same=Boolean(run&&final.date===date&&final.stage===stage);
  const own=same&&contentReceiptMatches(content,date,stage,run,hash);
  const contentFailure=same&&content?.scope==='morning_source_content_only'&&content.phase==='content'&&content.stage===stage&&content.trade_date===date&&content.run_id===run&&content.complete===false&&content.exitCode===1&&Array.isArray(content.failed_checks)&&content.failed_checks.length>0;
  const delivered=same&&deliveryReceiptMatches(canonical,date,stage,run)&&wrapper?.run_id===run&&wrapper.stage===stage&&wrapper.trade_date===date&&wrapper.complete===true&&wrapper.exitCode===0;
  const failed=same&&wrapper?.run_id===run&&wrapper.stage===stage&&wrapper.trade_date===date&&['failed','fail_closed'].includes(wrapper.status)&&wrapper.complete===false&&wrapper.exitCode===1;
  return {stage,run_id:run||null,morning_status:own?'COMPLETE':contentFailure?'FAILED':'PENDING',delivery_status:delivered?'COMPLETE':failed?'FAILED':'PENDING',first_blocker:failed?wrapper.first_blocker:null};
}
function notifications(date,evidence,acknowledged={}) {
  const events=[];
  for(const stage of STAGES){const r=stageResult(date,stage,evidence[stage]);
    for(const component of ['morning','delivery']){const status=r[component+'_status'];if(!r.run_id||status==='PENDING')continue;
      const key=[date,stage,r.run_id,component].join('|');if(acknowledged[key]===status)continue;
      events.push({key,trade_date:date,stage,run_id:r.run_id,component,status,kind:status==='COMPLETE'&&acknowledged[key]==='FAILED'?'RECOVERED':status,first_blocker:component==='delivery'?r.first_blocker:null,channel:'codex_original_thread',sent:false});
    }
  }return events;
}
function acknowledge(state,event){if(!event||!['COMPLETE','FAILED'].includes(event.status)||event.channel!=='codex_original_thread')throw Error('INVALID_NOTIFICATION_ACK');return {...state,[event.key]:event.status};}
function recordNaturalDay(ledger,observation){
  const {date,calendar,git_sha,evidence,aggregate}=observation;
  const next=structuredClone(ledger||{contract:'morning-five-natural-days-v1',days:[],consecutive:0,stable:false});
  if(next.days.some(x=>x.date===date))throw Error('DAY_ALREADY_RECORDED');
  const calendarOk=calendar?.date===date&&calendar.verified===true&&calendar.official_evidence_sha256?.match(/^[a-f0-9]{64}$/);
  if(!calendarOk)return {...next,pending_reason:'official_calendar_unverified'};
  if(calendar.is_trading_day===false){next.days.push({date,status:'SKIPPED',calendar});return next;}
  if(calendar.is_trading_day!==true)return {...next,pending_reason:'calendar_status_unknown'};
  const rows=STAGES.map(s=>stageResult(date,s,evidence?.[s]));
  const natural=STAGES.every(s=>{const w=evidence?.[s]?.wrapper;return w?.mode==='production'&&w.execution_mode==='scheduled'&&w.recovery===false&&w.git_sha===git_sha;});
  const pass=/^[a-f0-9]{40}$/.test(git_sha||'')&&natural&&rows.every(r=>r.morning_status==='COMPLETE'&&r.delivery_status==='COMPLETE')&&new Set(rows.map(r=>r.run_id)).size===2&&aggregate?.trade_date===date&&aggregate.verification_mode==='current'&&aggregate.complete===true&&aggregate.exitCode===0&&aggregate.blocking_reasons?.length===0&&STAGES.every(s=>aggregate.stages?.some(r=>r.stage===s&&r.run_id===evidence[s].final.run_id&&r.complete===true));
  const previous=next.days.filter(x=>x.status!=='SKIPPED').at(-1);
  const consecutive=pass?(previous?.status==='PASS'&&previous.git_sha===git_sha&&calendar.previous_trading_day===previous.date?next.consecutive+1:1):0;
  next.days.push({date,git_sha,status:pass?'PASS':'FAILED',natural,stages:rows,calendar});next.consecutive=consecutive;next.stable=consecutive>=5;return next;
}
module.exports={stageResult,notifications,acknowledge,recordNaturalDay};
