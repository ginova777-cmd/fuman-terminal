'use strict';
const fs=require('node:fs'),path=require('node:path');
const {createPublisher}=require('./txf-candle-publisher.cjs');
async function publishTxfArchive({runtime,tradeDate,writerRunId,apply,leaseValid,sendBatch,readJson,writeJson}){
 // Cursor/config reads bypass the Writer's per-round cache; corrupt state fails closed.
 const readFresh=(file,fallback)=>{try{return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}catch(error){if(error.code==='ENOENT')return fallback;throw error;}};
 const config=readFresh(path.join(runtime,'config','txf-candle-publication.json'),null);
 if(!config?.enabled)return {status:'not_enabled',written:0};
 if(config.contract!=='txf-candle-publication-v1'||config.session!=='REGULAR')throw Error('TXF_PUBLICATION_CONFIG_INVALID');
 const ref=require('./futopt-txf-reference.cjs').createReader(runtime)(new Date().toISOString()).txf_reference;
 if(!ref||ref.trade_date!==tradeDate)return {status:'blocked',error:'TXF_REFERENCE_UNVERIFIED',written:0};
 const directory=path.join(runtime,'data','mother-pool','futures-1m',tradeDate,'REGULAR');
 const file=path.join(directory,ref.future_symbol+'.json');
 if(!fs.existsSync(file))return {status:'waiting_archive',written:0};
 const snapshot=JSON.parse(fs.readFileSync(file,'utf8'));
 if(snapshot.trade_date!==tradeDate||snapshot.future_symbol!==ref.future_symbol)throw Error('TXF_PUBLICATION_REFERENCE_MISMATCH');
 const cursorFile=path.join(directory,ref.future_symbol+'.writer-state.json');
 const publish=createPublisher({readState:()=>readFresh(cursorFile,null),writeState:r=>writeJson(cursorFile,r),sendBatch});
 const result=await publish(snapshot,{writerRunId,apply,leaseValid});
 writeJson(path.join(runtime,'status','txf-candle-publication.json'),{...result,checked_at:new Date().toISOString(),trade_date:tradeDate,future_symbol:ref.future_symbol,writer_run_id:writerRunId,archive_run_id:snapshot.run_id});
 if(result.status==='failed')throw Error(result.error); // Stop this Writer round; do not continue writing after a DB failure.
 return result;
}
module.exports={publishTxfArchive};
