'use strict';
const fs=require('node:fs');
const log=process.argv[2],date=process.argv[3];
if(!log||fs.statSync(log).size>8*1024*1024)throw Error('SIDE_POLICY_LOG_SIZE');
const events=fs.readFileSync(log,'utf8').split(/\r?\n/).flatMap(s=>{try{return [JSON.parse(s)];}catch{return [];}});
const intent=events.findLast(x=>x.stage==='source_status_intent:durable');if(!intent)throw Error('SIDE_POLICY_INTENT_MISSING');
const row=require('../lib/daytrade-source-status-journal').read(intent);
const ack=JSON.parse(fs.readFileSync(intent.file+'.ack.json','utf8'));
console.log(JSON.stringify(require('../lib/daytrade-side-verifier-policy.cjs').decide({row,ack,expectedHash:intent.row_sha256,tradeDate:date})));
