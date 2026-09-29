'use strict';
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),crypto=require('node:crypto');
const digest=x=>crypto.createHash('sha256').update(x).digest('hex');
function durable(file,bytes){const fd=fs.openSync(file,'wx');try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function prepare(root,row){
 const date=row?.trade_date;if(!/^\d{4}-\d{2}-\d{2}$/.test(date||''))throw Error('SOURCE_STATUS_JOURNAL_DATE');
 const wire=JSON.stringify(row),sha=digest(wire),dir=path.join(root,date),file=path.join(dir,sha+'.json.gz');fs.mkdirSync(dir,{recursive:true});
 if(fs.existsSync(file))throw Error('SOURCE_STATUS_ALREADY_PREPARED_READ_ONLY_RECOVERY_REQUIRED');
 const envelope={contract:'source_status_write_intent_v1',row_sha256:sha,prepared_at:new Date().toISOString(),row};
 durable(file,zlib.gzipSync(JSON.stringify(envelope),{level:1}));return {file,row_sha256:sha};
}
function read(checkpoint){const envelope=JSON.parse(zlib.gunzipSync(fs.readFileSync(checkpoint.file)).toString('utf8'));
 if(envelope.contract!=='source_status_write_intent_v1'||envelope.row_sha256!==checkpoint.row_sha256||digest(JSON.stringify(envelope.row))!==checkpoint.row_sha256)throw Error('SOURCE_STATUS_JOURNAL_HASH_MISMATCH');return envelope.row;}
function confirm(checkpoint,ack){
 const row=read(checkpoint);
 if(!['write_response','exact_readback_after_timeout','exact_readback_after_interruption'].includes(ack?.mode))throw Error('SOURCE_STATUS_JOURNAL_ACK_INVALID');
 if(ack.mode==='exact_readback_after_interruption'&&(ack.writer_run_id!==row.payload?.writer_run_id||ack.generation_id!==row.payload?.generation_id||ack.verified_after_interruption!==true))throw Error('SOURCE_STATUS_JOURNAL_ACK_IDENTITY');
 if(ack.mode==='exact_readback_after_timeout'&&(ack.writer_run_id!==row.payload?.writer_run_id||ack.generation_id!==row.payload?.generation_id||ack.verified_after_timeout!==true))throw Error('SOURCE_STATUS_JOURNAL_ACK_IDENTITY');
 const record={contract:'source_status_write_ack_v1',row_sha256:checkpoint.row_sha256,checked_at:new Date().toISOString(),ack,complete:false,scope:'source_status_write_only'};
 durable(checkpoint.file+'.ack.json',JSON.stringify(record)+'\n');return record;
}
module.exports={prepare,read,confirm};
