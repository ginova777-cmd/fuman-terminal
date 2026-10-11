'use strict';
const fs=require('fs'),path=require('path'),{enqueue}=require('../lib/tom-notification.cjs');
const [receiptFile,dir]=process.argv.slice(2);if(!receiptFile||!dir)throw Error('arguments_required');
if(fs.statSync(receiptFile).size>4194304)throw Error('receipt_too_large');
const root=JSON.parse(fs.readFileSync(receiptFile,'utf8').replace(/^\uFEFF/,''));
const rows=root.strategyObservation?.rows||[];if(rows.length>64)throw Error('too_many_tasks');
const files=[];
for(const r of rows){if(r.runId&&['COMPLETE','FAILED','BLOCKED','INCOMPLETE'].includes(r.verification))files.push(enqueue(dir,{task:r.task,date:r.trade_date,runId:r.runId,state:r.verification,evidencePath:r.evidence_path||receiptFile}));}
console.log(JSON.stringify({recorded:files.length,files,deliveryEnabled:false}));
