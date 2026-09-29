'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const io=require('../lib/mother-pool-a16-io');
const {build}=require('../lib/mother-pool-a16-baseline');
const {collect,verify}=require('../lib/mother-pool-a16-module');
const runtime=fs.mkdtempSync(path.join(os.tmpdir(),'a16-module-')),date='2026-09-29',asOf=date+'T00:00:00Z',generation='a16-isolated';
const identity={trade_date:date,canonical_run_id:'fugle_daytrade_source:20260929:canonical',writer_run_id:'w',generation_id:'g',mother_pool_run_id:'m',snapshot_generation:'sg',snapshot_sequence:1};
const input={identity,symbols:['2330'],asOf,runtime};
assert.equal(collect(input).rows[0].status,'DATA_GAP');
const dates=Array.from({length:20},(_,i)=>'2026-08-'+String(i+1).padStart(2,'0'));
const raw={symbol:'2330',exchange:'TWSE',market:'TSE',type:'EQUITY',timeframe:'1',data:dates.flatMap((d,i)=>[{date:d+'T09:00:00+08:00',open:100,high:100,low:100,close:100,volume:10+i},{date:d+'T09:01:00+08:00',open:100,high:102,low:100,close:101,volume:20+i}])};
const history={contract:'mother_pool_historical_minute_fetch_evidence_v1',symbol:'2330',trade_date:date,calendar_verified:true,requested_sessions:dates,calendar:{checked_at:'2026-09-28T12:00:00Z',sha256:'a'.repeat(64)},result:{status:'HISTORY_FETCHED',raw,fetched_at:'2026-09-28T12:01:00Z',normalized:{raw_sha256:crypto.createHash('sha256').update(JSON.stringify(raw)).digest('hex')}}};
const receipt=build({symbol:'2330',tradeDate:date,canonicalRunId:identity.canonical_run_id,asOf,history});
const db={readback_contract:'a16_db_anon_v2',db_readback_ok:true,anon_readback_ok:true,written_count:1084,readback_count:1084,payload_sha256:io.hash(io.compact(receipt))};
const file=path.join(runtime,'data','mother-pool-a16',date,generation,'2330.json');
const artifact={verifier:require('../lib/verify-mother-pool-a16').verify(receipt,{history,symbol:'2330',tradeDate:date,canonicalRunId:identity.canonical_run_id,asOf}),generation,mode:'scheduled',receipt,db};io.atomic(file,artifact);
const historyFile=path.join(runtime,'data','mother-pool-historical-minutes',date,'2330.json');io.atomic(historyFile,history);
const rows=[{symbol:'2330',...db,requested_count:1084,verifier_passed:true,source_ready:false,first_blocker:receipt.first_blocker}];
const summary={contract:'mother_pool_a16_writer_summary_v1',trade_date:date,canonical_run_id:identity.canonical_run_id,generation,mode:'scheduled',requested_symbols:['2330'],requested_count:1,attempted_count:1,rows,rows_sha256:io.hash(rows)};
io.atomic(path.join(runtime,'data','mother-pool-a16',date,'writer-summary.json'),summary);
let plan=collect(input);assert.equal(plan.rows[0].status,'DATA_GAP');assert.equal(plan.rows[0].baseline_counts.OUTSIDE_STRENGTH.gaps,271);
assert.equal(verify(plan.rows,{...identity,observed_at:asOf,writer_write_set:{plan}},{runtime}),false);
const tamper=structuredClone(artifact);tamper.receipt.rows[0].baseline_value=999;io.atomic(file,tamper);assert.match(collect(input).rows[0].data_gap_reason,/ARTIFACT_MISMATCH/);
for(const replacement of [{symbol:'2317'},{trade_date:'2026-09-28'},{canonical_run_id:'other'}]){
 const mixed=structuredClone(artifact);Object.assign(mixed.receipt,replacement);io.atomic(file,mixed);
 assert.match(collect(input).rows[0].data_gap_reason,/BASELINE_IDENTITY_MISMATCH/);
}
io.atomic(file,artifact);const badHistory=structuredClone(history);badHistory.result.raw.data[0].volume=999;io.atomic(historyFile,badHistory);assert.match(collect({...input,recalculate:true}).rows[0].data_gap_reason,/FORMULA/);
io.atomic(historyFile,history);io.atomic(file,{...artifact,mode:'acceptance_probe'});assert.match(collect(input).rows[0].data_gap_reason,/ARTIFACT_MISMATCH/);
io.atomic(file,artifact);assert.match(collect({...input,asOf:'2026-09-30T00:00:00Z'}).rows[0].data_gap_reason,/IDENTITY_INVALID/);
console.log('PASS A16 module: real baseline recalculation, missing source, sample gaps, hash tampering, raw corruption, probe rejection and cross-date rejection. No production I/O.');

// Full four-branch success fixture, entirely under the isolated temp directory.
const fullHistory=structuredClone(history),sideJournals={};fullHistory.result.raw.data=[];
for(const d of dates){const trades=[],side=[];
 for(let n=0;n<271;n++){
  const time=new Date(Date.parse(d+'T09:00:00+08:00')+n*60000+1000),event=time.toISOString(),micro=time.getTime()*1000;
  fullHistory.result.raw.data.push({date:new Date(time.getTime()-1000).toISOString(),open:100+n,high:102+n,low:99+n,close:101+n,volume:10});
  trades.push({stock_id:'2330',trade_date:d,is_synthetic:false,volume_unit:'LOTS',received_at:event,contract:'fugle_native_trade_journal_v1',source:'Fugle.websocket.trades',trade:{time:micro,serial:n+1,size:10,volume:(n+1)*10}});
  side.push({stock_id:'2330',trade_date:d,is_synthetic:false,is_trial:false,volume_unit:'LOTS',received_at:event,provider_source:'Fugle.aggregates.total',aggregation:'DAY_CUMULATIVE',event_at:event,event_time_microseconds:micro,identity:d+'/'+n,total:{tradeVolume:(n+1)*10,tradeVolumeAtBid:(n+1)*5,tradeVolumeAtAsk:(n+1)*5}});
 }
 sideJournals[d]={trades,side};
 for(const [folder,values] of [['provider-trade-journal',trades],['provider-side-journal',side]]){const f=path.join(runtime,'data',folder,d,'2330.jsonl');fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,values.map(x=>JSON.stringify(x)).join('\n'));}
}
fullHistory.result.normalized.raw_sha256=crypto.createHash('sha256').update(JSON.stringify(fullHistory.result.raw)).digest('hex');
io.atomic(historyFile,fullHistory);
const fullReceipt=build({symbol:'2330',tradeDate:date,canonicalRunId:identity.canonical_run_id,asOf,history:fullHistory,sideJournals});assert.equal(fullReceipt.complete,true);
const fullDb={...db,payload_sha256:io.hash(io.compact(fullReceipt))};io.atomic(file,{...artifact,receipt:fullReceipt,db:fullDb,verifier:require('../lib/verify-mother-pool-a16').verify(fullReceipt,{history:fullHistory,sideJournals,symbol:'2330',tradeDate:date,canonicalRunId:identity.canonical_run_id,asOf})});
const fullRows=[{...rows[0],...fullDb,source_ready:true,first_blocker:null}];io.atomic(path.join(runtime,'data','mother-pool-a16',date,'writer-summary.json'),{...summary,rows:fullRows,rows_sha256:io.hash(fullRows)});
const started=Date.now(),fullPlan=collect(input);assert.equal(fullPlan.rows[0].status,'READY');assert.equal(verify(fullPlan.rows,{...identity,observed_at:asOf,writer_write_set:{plan:fullPlan}},{runtime}),true);
assert.equal(fullPlan.rows[0].baseline_counts.ABS_RETURN.not_applicable,1);
for(const type of ['VOLUME','OUTSIDE_STRENGTH','INSIDE_STRENGTH'])assert.equal(fullPlan.rows[0].baseline_counts[type].ready,271);
console.log('PASS A16 complete four-branch source and module verifier; isolated full-history elapsed_ms='+String(Date.now()-started));
