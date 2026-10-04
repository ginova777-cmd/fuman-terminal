'use strict';
const {hash,normalize}=require('./txf-candle-evidence.cjs');
const {CONTRACT}=require('./txf-candle-archive.cjs');
const TABLE='fugle_daytrade_futopt_intraday_1m';
function createPublisher({readState,writeState,sendBatch,now=()=>Date.now(),batchSize=50}){
 if(!Number.isInteger(batchSize)||batchSize<1||batchSize>50)throw Error('TXF_BATCH_BOUND');
 let inFlight=false;
 return async function publish(snapshot,{writerRunId,apply,leaseValid}){
  if(!apply)return {status:'dry_run',written:0};
  if(inFlight)return {status:'in_flight',written:0};
  const state=readState()||{cursor:{},failures:0};
  if(Date.parse(state.next_retry_at||'')>now())return {status:'backoff',written:0,next_retry_at:state.next_retry_at};
  if(typeof leaseValid!=='function'||!leaseValid())return {status:'blocked',error:'TXF_WRITER_LEASE_REQUIRED',written:0};
  if(!writerRunId||snapshot?.contract!==CONTRACT||!Array.isArray(snapshot.rows)||snapshot.rows.length>1440||snapshot.rows_sha256!==hash(snapshot.rows))throw Error('TXF_PUBLICATION_ARCHIVE_INVALID');
  const identity=[snapshot.trade_date,snapshot.session,snapshot.future_symbol].join('|');
  const cursor=state.identity===identity?{...state.cursor}:{};
  const seen=new Set(),rows=[];
  for(const row of snapshot.rows){
   const native=normalize(row.raw_evidence,{symbol:snapshot.future_symbol,tradeDate:snapshot.trade_date,session:snapshot.session,receivedAt:row.received_at,source:row.source,nowMs:now()});
   for(const key of ['future_symbol','trade_date','session','candle_time','open','high','low','close','volume','raw_sha256','available_at'])if(row[key]!==native[key])throw Error('TXF_PUBLICATION_EVIDENCE_MISMATCH');
   if(seen.has(row.candle_time))throw Error('TXF_PUBLICATION_DUPLICATE');seen.add(row.candle_time);
   if(typeof row.conflict!=='boolean'||row.volume_strategy_usable!==!row.conflict||!Number.isFinite(Date.parse(row.first_available_at))||Date.parse(row.first_available_at)>Date.parse(row.available_at))throw Error('TXF_PUBLICATION_QUALITY_INVALID');
   const revision=hash(row);
   if(cursor[row.candle_time]===revision)continue;
   rows.push({revision,row:{...native,first_available_at:row.first_available_at,conflict:row.conflict,volume_strategy_usable:row.volume_strategy_usable,data_gap_reason:row.data_gap_reason||null,archive_run_id:snapshot.run_id,writer_run_id:writerRunId}});
  }
  if(!rows.length)return {status:'unchanged',written:0};
  inFlight=true;let written=0,requests=0;
  try{
   for(let offset=0;offset<rows.length;offset+=batchSize){
    if(!leaseValid())throw Error('TXF_WRITER_LEASE_EXPIRED');
    const batch=rows.slice(offset,offset+batchSize);requests++;
    await sendBatch(TABLE,batch.map(item=>item.row),'trade_date,session,future_symbol,candle_time');
    batch.forEach(item=>{cursor[item.row.candle_time]=item.revision;});written+=batch.length;
    writeState({identity,cursor,failures:0,next_retry_at:null,last_success_at:new Date(now()).toISOString(),writer_run_id:writerRunId});
   }
   return {status:'written_unverified',written,requests,db_readback_verified:false};
  }catch(error){
   const failures=Math.min(100,(Number.isSafeInteger(state.failures)?state.failures:0)+1),wait=[60000,120000,240000,300000][Math.min(failures-1,3)];
   const code=/^TXF_[A-Z0-9_]+$/.test(error.message||'')?error.message:'TXF_CANDLE_DB_WRITE_FAILED';
   writeState({identity,cursor,failures,next_retry_at:new Date(now()+wait).toISOString(),last_error:code,writer_run_id:writerRunId});
   return {status:'failed',written,requests,error:code,db_readback_verified:false,next_retry_at:new Date(now()+wait).toISOString()};
  }finally{inFlight=false;}
 };
}
module.exports={createPublisher,TABLE};
