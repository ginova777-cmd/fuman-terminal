'use strict';
const {parentPort,workerData}=require('node:worker_threads');
const {readJson,writeJson}=require('./fugle-websocket-quotes');
const {createCandleStore}=require('./daytrade-candle-store');
const store=createCandleStore({read:()=>readJson(workerData.file,{}),write:value=>writeJson(workerData.file,value),retentionMs:workerData.retentionMs});
let failed=false;
parentPort.on('message',message=>{
 if(failed)return;
 try{const count=store.merge(message.rows);parentPort.postMessage({sequence:message.sequence,ok:true,count});}
 catch{failed=true;parentPort.postMessage({sequence:message.sequence,ok:false});}
});
