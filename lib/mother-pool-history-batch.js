'use strict';
const {inspectSnapshot}=require('./daytrade-mother-pool-snapshot');
async function runBatch({snapshot,asOf,maxRequests,fetchSymbol,readCached=async()=>null,retryInvalidCache=false}) {
 const identity=inspectSnapshot(snapshot,snapshot?.trade_date);
 if(!identity.ok||!Number.isFinite(Date.parse(asOf))||Date.parse(snapshot.effective_at)>Date.parse(asOf)
  ||!Number.isInteger(maxRequests)||maxRequests<1||maxRequests>10||typeof fetchSymbol!=='function')throw Error('HISTORY_BATCH_INPUT_INVALID');
 const rows=[];let attempted=0,stop=null;
 for(const symbol of snapshot.symbols){
  let cached;
  try{cached=await readCached(symbol);}catch{if(!retryInvalidCache){rows.push({symbol,status:'DATA_GAP',reason:'CACHED_HISTORY_INVALID'});continue;} cached=null;}
  if(cached){rows.push({...cached,symbol,status:'HISTORY_REUSED'});continue;}
  if(stop||attempted>=maxRequests){rows.push({symbol,status:'PENDING',reason:stop||'REQUEST_BUDGET_EXHAUSTED'});continue;}
  attempted++;
  let result;
  try{result=await fetchSymbol(symbol);}catch{result={status:'DATA_GAP',reason:'HISTORY_FETCH_OR_PERSIST_FAILED'};}
  rows.push({...result,symbol});
  if([401,403,429].includes(result.http_status)||result.reason==='HISTORY_TRANSPORT_FAILED')stop='UPSTREAM_BLOCKED';
 }
 return {contract:'mother_pool_history_supply_batch_v1',trade_date:snapshot.trade_date,mother_pool_run_id:identity.runId,
  snapshot_sequence:snapshot.snapshot_sequence,requested:snapshot.symbols.length,attempted,
  fetched:rows.filter(r=>r.status==='HISTORY_FETCHED').length,reused:rows.filter(r=>r.status==='HISTORY_REUSED').length,rows,complete:false,
  first_blocker:rows.find(r=>!['HISTORY_FETCHED','HISTORY_REUSED'].includes(r.status))?.reason||'WRITER_AND_DB_ACCEPTANCE_PENDING'};
}
module.exports={runBatch};
