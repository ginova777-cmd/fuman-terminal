'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {reference}=require('./txf-reference-publication.cjs');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
async function publishReference({runtime,tradeDate,writerRunId,apply,leaseValid,sendBatch,writeJson,nowMs=Date.now()}){
 if(!apply)return {status:'dry_run',written:0};
 const read=(file,fallback)=>{try{return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}};
 const config=read(path.join(runtime,'config','txf-candle-publication.json'),null);if(config?.enabled!==true)return {status:'not_enabled',written:0};
 if(config.contract!=='txf-candle-publication-v1'||config.session!=='REGULAR')throw Error('TXF_PUBLICATION_CONFIG_INVALID');
 if(!leaseValid()||!writerRunId)throw Error('TXF_REFERENCE_LEASE_REQUIRED');
 let payload=null,status='WAITING_CATALOGUE',reason='CATALOGUE_NOT_PUBLISHED';
 try{const snapshot=read(path.join(runtime,'data','futures-catalogue',tradeDate+'.json'),null);if(snapshot){payload=reference(snapshot,{tradeDate,nowMs});status='VERIFIED';reason=null;}}
 catch(e){status=/CONFLICT|AMBIGUOUS|DUPLICATE/.test(e.message)?'CONFLICT':'INVALID';reason=/^[A-Z0-9_:|]+$/.test(e.message)?e.message:'CATALOGUE_UNVERIFIED';}
 const stable=payload?{...payload,verified_at:undefined}:null;
 const revision=hash({tradeDate,status,reason,payload:stable});const cursorFile=path.join(runtime,'state','txf-reference-publication-cursor.json');
 const cursor=read(cursorFile,null);if(cursor?.revision===revision)return {status:'unchanged',written:0};
 if(!leaseValid())throw Error('TXF_REFERENCE_LEASE_EXPIRED');
 await sendBatch('fugle_daytrade_txf_reference',[{trade_date:tradeDate,product:'TXF',session:'REGULAR',status,reason,payload,revision,writer_run_id:writerRunId}],'trade_date,product,session');
 writeJson(cursorFile,{revision,trade_date:tradeDate,published_at:new Date(nowMs).toISOString(),writer_run_id:writerRunId});
 const result={status:'written_unverified',mapping_status:status,reason,written:1,requests:1,trade_date:tradeDate,writer_run_id:writerRunId,checked_at:new Date(nowMs).toISOString()};
 writeJson(path.join(runtime,'status','txf-reference-publication.json'),result);return result;
}
module.exports={publishReference};
