'use strict';
const path=require('node:path');
const {createArchive}=require('./txf-candle-archive.cjs');
const {createRecovery}=require('./txf-candle-recovery.cjs');
function createPipeline({runtime,readJson,writeJson,now=()=>Date.now(),fetchImpl=fetch}) {
 const archive=createArchive({runtime,now});
 const receiptFile=path.join(runtime,'status','txf-candle-recovery.json');
 const statusFile=path.join(runtime,'status','txf-candle-pipeline.json');
 const recover=createRecovery({archive,now,fetchImpl,readState:()=>readJson(receiptFile,null),writeState:r=>writeJson(receiptFile,r)});
 let context=null,lastError=null,accepted=0,rejected=0,conflicts=0,publication=null,quiesced=false;
 const recoveries=new Set();
 function status(){return {contract:'mother-pool-txf-candle-pipeline-v1',checked_at:new Date(now()).toISOString(),context,accepted,rejected,conflicts,last_error:lastError,publication};}
 function configure(value){context=value?{symbol:value.symbol,tradeDate:value.tradeDate,session:value.session}:null;}
 function receive(payload){
  if(quiesced)return {accepted:false,reason:'COLLECTOR_QUIESCED'};
  const raw=payload?.data;
  if(payload?.channel!=='candles'&&raw?.channel!=='candles')return {accepted:false,reason:'NOT_CANDLES'};
  if(!context||raw?.symbol!==context.symbol)return {accepted:false,reason:'NOT_SELECTED_TXF'};
  try{
   const result=archive.ingest(raw,{...context,receivedAt:new Date(now()).toISOString(),source:'Fugle:WS:candles'});
   if(result.accepted)accepted++;
   if(result.conflict)conflicts++;
   return result;
  }catch(error){rejected++;lastError=error.message;return {accepted:false,reason:error.message};}
 }
 function flush(force=false){
  try{publication=archive.flush({force});}
  catch(error){lastError='TXF_ARCHIVE_PUBLISH_FAILED';}
  // This separate receipt does not claim the quote collector or downstream Writer is complete.
  writeJson(statusFile,status());return status();
 }
 async function recoverOnConnection(apiKey,reason){
  if(quiesced)return {status:'blocked',error:'COLLECTOR_QUIESCED'};
  if(!context)return {status:'blocked',error:'TXF_REFERENCE_UNVERIFIED'};
  const pending=recover({...context,apiKey,reason});recoveries.add(pending);
  try{return await pending;}
  catch(error){lastError='TXF_RECOVERY_RECEIPT_FAILED';return {status:'failed',error:lastError};}
  finally{recoveries.delete(pending);}
 }
 function quiesce(){quiesced=true;}
 async function stopAndVerify(){
  quiesce();await Promise.allSettled([...recoveries]);
  try{const proof=archive.flushAndVerify();publication=proof.publication;return {...proof,accepted,rejected,conflicts,prior_error:lastError};}
  catch(error){lastError='TXF_ARCHIVE_PUBLISH_FAILED';error.pending=archive.pendingState();throw error;}
 }
 return {configure,receive,flush,recoverOnConnection,status,quiesce,stopAndVerify,pendingState:archive.pendingState};
}
module.exports={createPipeline};
