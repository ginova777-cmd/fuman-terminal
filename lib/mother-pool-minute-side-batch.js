'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {readMinuteSide}=require('./mother-pool-minute-side-source');
const {inspectSnapshot}=require('./daytrade-mother-pool-snapshot');
function collect({runtimeRoot,snapshot,asOf,deadlineMs=Date.now()+10000}){
 const date=new Date(Date.parse(asOf)+28800000).toISOString().slice(0,10);
 const valid=inspectSnapshot(snapshot,date);
 if(!valid.ok)throw Error('MINUTE_SIDE_SNAPSHOT_INVALID:'+valid.failedChecks.join(','));
 if(Date.parse(snapshot.effective_at)>Date.parse(asOf))throw Error('MINUTE_SIDE_SNAPSHOT_NOT_EFFECTIVE');
 const details=[];
 for(const symbol of snapshot.symbols){
  if(Date.now()>=deadlineMs){details.push({symbol,status:'DATA_GAP',reason:'WRITER_BUDGET_EXHAUSTED'});continue;}
  const sources=[];
  function load(kind){const file=path.join(runtimeRoot,'data',`provider-${kind}-journal`,date,symbol+'.jsonl');
   const raw=fs.readFileSync(file,'utf8');sources.push({kind,sha256:crypto.createHash('sha256').update(raw).digest('hex')});
   return raw.split(/\r?\n/).filter(Boolean).map(JSON.parse);
  }
  try{
   const r=readMinuteSide({symbol,tradeDate:date,canonicalRunId:snapshot.canonical_run_id,asOf,trades:load('trade'),side:load('side')});
   const latest=r.rows.at(-1)||null,age=latest?(Date.parse(asOf)-Date.parse(latest.side_volume_timestamp))/1000:null;
   // Preserve the exact preceding window for downstream baseline calculation.
   // Missing minutes remain missing; never pad with cumulative or zero values.
   const latestStart=Date.parse(latest?.timestamp);
   const rolling=Number.isFinite(latestStart)?r.rows.filter(x=>{
    const t=Date.parse(x.timestamp);return t>=latestStart-20*60000&&t<latestStart;
   }):[];
   const fresh=age!==null&&age>=0&&age<=120;
   details.push({symbol,status:fresh?'SOURCE_READY':'DATA_GAP',reason:fresh?null:latest?'STALE_SIDE_MINUTE':r.data_gaps[0]?.reason||'MINUTE_MISSING',
    sources,latest,side_event_age_seconds:age,available_minutes:r.rows.length,gap_minutes:r.data_gaps.length,
    rolling_20m_rows:rolling,rolling_20m_observed_count:rolling.length,
    rolling_20m_missing_count:20-rolling.length,
    rolling_baseline:require('./mother-pool-side-rolling-baseline').calculate(rolling),
    same_minute_historical_baselines:require('./mother-pool-a16-writer').readMinute({runtime:runtimeRoot,tradeDate:date,symbol,minute:latest?new Date(Date.parse(latest.timestamp)+28800000).toISOString().slice(11,16):'',types:['OUTSIDE_STRENGTH','INSIDE_STRENGTH']}),
    baseline_verified:false});
  }catch(e){details.push({symbol,status:'DATA_GAP',reason:e.code==='ENOENT'?'NATIVE_JOURNAL_MISSING':e instanceof SyntaxError?'JOURNAL_JSON_INVALID':'SOURCE_READ_FAILED',sources});}
 }
 return {contract:'mother_pool_minute_side_batch_v1',trade_date:date,canonical_run_id:snapshot.canonical_run_id,
  mother_pool_run_id:valid.runId,snapshot_sequence:snapshot.snapshot_sequence,as_of:asOf,
  requested:snapshot.symbols.length,evaluated:details.filter(x=>x.reason!=='WRITER_BUDGET_EXHAUSTED').length,
  source_ready:details.filter(x=>x.status==='SOURCE_READY').length,details,
  complete:false,baseline_verified:false,publish_allowed:false,creates_order:false};
}
module.exports={collect};
