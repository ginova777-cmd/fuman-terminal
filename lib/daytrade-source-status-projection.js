'use strict';
// These producer-only details remain in the in-memory result and durable archive.
// Public rankings, Gate fields and existing readback evidence are unchanged.
const fields=['same_round_industry_discovery','b19_b24_event_evidence'];
function project(row,{save,read}){
 const details=Object.fromEntries(fields.filter(k=>Object.hasOwn(row.payload,k)).map(k=>[k,row.payload[k]]));
 if(!Object.keys(details).length)return row;
 const identity=Object.fromEntries(['trade_date','canonical_run_id','writer_run_id','generation_id'].map(k=>[k,row.payload[k]]));
 if(Object.values(identity).some(v=>typeof v!=='string'||!v))throw Error('STATUS_DETAIL_IDENTITY_MISSING');
 const archived={source_name:row.source_name,trade_date:row.trade_date,updated_at:row.updated_at,payload:{...identity,...details}};
 const checkpoint=save(archived);
 require('node:assert/strict').deepEqual(read(checkpoint),JSON.parse(JSON.stringify(archived)));
 const payload={...row.payload};for(const k of fields)delete payload[k];
 payload.producer_detail_archive={contract:'daytrade_producer_detail_archive_v1',...identity,fields:Object.keys(details),row_sha256:checkpoint.row_sha256,file:checkpoint.file,scope:'local_producer_evidence_not_public_readback',complete:false};
 return {...row,payload};
}
module.exports={project,fields};
