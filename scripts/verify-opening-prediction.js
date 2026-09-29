"use strict";
const fs=require('fs'),crypto=require('crypto'),path=require('path');
function verify(file,expectedDate,expectedRun){
 const failures=[];let p=null,raw=null;
 try {raw=fs.readFileSync(file);p=JSON.parse(raw.toString('utf8').replace(/^\uFEFF/,''));}catch{failures.push('FREEZE_MISSING_OR_INVALID');}
 const check=(ok,name)=>{if(!ok)failures.push(name);};
 check(p?.ok===true,'FREEZE_NOT_OK');check(p?.trade_date===expectedDate,'TRADE_DATE_MISMATCH');
 check(typeof p?.run_id==='string'&&p.run_id.length>0&&(!expectedRun||p.run_id===expectedRun),'RUN_ID_MISMATCH');
 check(p?.immutable_after_publish===true,'NOT_IMMUTABLE');
 check(p?.allowed_after_0850==='monitor_and_rank_only','POST_FREEZE_POLICY_INVALID');
 const t=Date.parse(p?.frozen_at);const local=Number.isFinite(t)?new Date(t+8*3600000).toISOString():'';
 check(local.slice(0,10)===expectedDate&&local.slice(11,16)==='08:50','FREEZE_OUTSIDE_0850');
 const rows=Array.isArray(p?.predictions)?p.predictions:[];
 check(Array.isArray(p?.predictions)&&rows.length===p?.prediction_count,'COUNT_MISMATCH');
 check(new Set(rows.map(r=>r.symbol)).size===rows.length,'DUPLICATE_SYMBOL');
 for(const r of rows){
  check(/^\d{4,6}$/.test(r.symbol),`SYMBOL_INVALID:${r.symbol}`);
  check(['多','空','不交易'].includes(r.prediction),`DIRECTION_INVALID:${r.symbol}`);
  if(r.prediction==='不交易')continue;
  check(r.prediction_version==='opening_prediction_v3',`ENGINE_VERSION_INVALID:${r.symbol}`);
  check(Boolean(r.tomorrow_prediction_reason)&&Boolean(r.tomorrow_prediction_pattern),`REASON_MISSING:${r.symbol}`);
  const slots=r.evidence?.preopen_slots||[];
  for(const slot of ['0845','0850']) {
   const s=slots.find(s=>s.capture_slot===slot),event=Date.parse(s?.trial_event_at);
   const stamp=Number.isFinite(event)?new Date(event+8*3600000).toISOString():'';
   check(s?.is_trial===true&&s.natural_schedule_evidence===true&&s.trial_price_source==='fugle_native_trial'&&s.trial_price>0&&stamp.slice(0,10)===expectedDate&&stamp.slice(11,16).replace(':','')===slot&&event<=t,`TRIAL_INVALID:${r.symbol}:${slot}`);
  }
  if(r.prediction==='多'){
   check(r.evidence?.daily_signal_date<expectedDate,'SIGNAL_DATE_INVALID');
   for(const key of ['daily_indicators','hourly_indicators']) {
    const i=r.evidence?.[key];check(i?.available===true&&i.version==='opening_prediction_v3'&&i.k>i.previous_k&&i.d>i.previous_d&&i.rsi3>i.previous_rsi3&&i.rsi6>i.previous_rsi6,`LONG_TREND_INVALID:${r.symbol}:${key}`);
   }
   check(r.matched_strategy_numbers?.length>0,`STRATEGY_MISSING:${r.symbol}`);
  }else{
   const short=r.evidence?.opening_short_signal;
   check(short?.matched===true&&short.checks?.kgi_chengzhong_present===true,`SHORT_SIGNAL_INVALID:${r.symbol}`);
   const pct=slots.find(s=>s.capture_slot==='0850')?.trial_change_pct;check(Number.isFinite(pct)&&pct>=3&&pct<=5,`SHORT_TRIAL_RANGE_INVALID:${r.symbol}`);
  }
 }
 return {ok:failures.length===0,contract:'opening_prediction_verifier_v2',trade_date:expectedDate,run_id:p?.run_id||null,checked_at:new Date().toISOString(),canonical_readback:true,canonical_path:path.resolve(file),canonical_sha256:raw?crypto.createHash('sha256').update(raw).digest('hex'):null,failed_checks:failures,first_blocker:failures[0]||null,prediction_count:rows.length};
}
if(require.main===module){const arg=n=>process.argv.find(x=>x.startsWith(`--${n}=`))?.slice(n.length+3);const r=verify(arg('freeze'),arg('trade-date'),arg('run-id'));if(arg('receipt'))fs.writeFileSync(arg('receipt'),JSON.stringify(r,null,2));console.log(JSON.stringify(r,null,2));process.exitCode=r.ok?0:1;}
module.exports={verify};
