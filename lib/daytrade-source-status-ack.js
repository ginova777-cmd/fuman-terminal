'use strict';
const {isDeepStrictEqual}=require('node:util');
const {createHash}=require('node:crypto');
const identityKeys=['trade_date','canonical_run_id','writer_run_id','generation_id'];
function canonical(value) {
  if(Array.isArray(value)) return value.map(canonical);
  if(value && typeof value==='object') return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));
  return value;
}
function comparable(row, keys) {
  return Object.fromEntries(keys.map(k=>[k,['updated_at','last_success_at'].includes(k)&&row[k]!==null ? Date.parse(row[k]) : row[k]]));
}
function differencePaths(a,b,prefix='',out=[]){
  if(out.length>=20||isDeepStrictEqual(a,b))return out;
  if(a&&b&&typeof a==='object'&&typeof b==='object'&&Array.isArray(a)===Array.isArray(b)){
    for(const k of new Set([...Object.keys(a),...Object.keys(b)])){
      const p=prefix?prefix+'.'+k:k;
      if(!Object.hasOwn(a,k)||!Object.hasOwn(b,k))out.push(p);
      else differencePaths(a[k],b[k],p,out);
      if(out.length>=20)break;
    }
  }else out.push(prefix);
  return out;
}
async function writeWithAcknowledgement({row,write,read,onMismatch,onPrepared,onAcknowledged,retryDelaysMs=[],sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}) {
  if(!Array.isArray(retryDelaysMs)||retryDelaysMs.length>2||retryDelaysMs.some(ms=>!Number.isInteger(ms)||ms<0||ms>10000))
    throw Error('SOURCE_STATUS_ACK_RETRY_BUDGET_INVALID');
  // Snapshot the actual JSON wire representation before either callback runs.
  const expected=JSON.parse(JSON.stringify(row));
  for(const key of identityKeys) if(typeof expected.payload?.[key]!=='string'||!expected.payload[key])
    throw Error('SOURCE_STATUS_ACK_IDENTITY_MISSING:'+key);
  if(expected.trade_date!==expected.payload.trade_date || !Number.isFinite(Date.parse(expected.updated_at)))
    throw Error('SOURCE_STATUS_ACK_IDENTITY_INVALID');
  if(typeof onPrepared==='function')await onPrepared(expected);
  const finish=async ack=>{if(typeof onAcknowledged==='function')await onAcknowledged(ack);return ack;};
  try { await write(expected); }
  catch(cause) {
    if(!['TimeoutError','AbortError'].includes(cause?.name)) throw cause;
    for(let attempt=0;attempt<=retryDelaysMs.length;attempt++) {
    let rows;
    try { rows=await read(expected); }
    catch(readCause) { throw new Error('SOURCE_STATUS_ACK_READ_FAILED',{cause:readCause}); }
    if(Array.isArray(rows)&&rows.length===0&&attempt<retryDelaysMs.length){await sleep(retryDelaysMs[attempt]);continue;}
    if(!Array.isArray(rows)||rows.length!==1) throw new Error('SOURCE_STATUS_ACK_ROW_COUNT',{cause});
    const actual=rows[0],keys=Object.keys(expected);
    if(keys.some(k=>!Object.hasOwn(actual,k)) || !isDeepStrictEqual(comparable(actual,keys),comparable(expected,keys))) {
      const identity = r => Object.fromEntries(identityKeys.map(k=>[k,typeof r.payload?.[k]==='string'?r.payload[k]:null]));
      const evidence = {expected_identity:identity(expected),actual_identity:identity(actual),
        expected_updated_at:expected.updated_at,actual_updated_at:actual.updated_at||null,
        identity_matches:isDeepStrictEqual(identity(expected),identity(actual)),
        different_fields:differencePaths(comparable(expected,keys),comparable(actual,keys)),read_attempt:attempt+1};
      if(typeof onMismatch==='function') await onMismatch(evidence);
      // A previous round can remain visible while the original request commits.
      // Never retry a write, accept partial content, or wait behind a newer round.
      const previousRound=actual.trade_date===expected.trade_date&&actual.payload?.trade_date===expected.payload.trade_date&&
        actual.payload?.canonical_run_id===expected.payload.canonical_run_id&&
        typeof actual.payload?.writer_run_id==='string'&&typeof actual.payload?.generation_id==='string'&&
        actual.payload.writer_run_id!==expected.payload.writer_run_id&&actual.payload.generation_id!==expected.payload.generation_id&&
        Number.isFinite(Date.parse(actual.updated_at))&&Date.parse(actual.updated_at)<Date.parse(expected.updated_at);
      const previousRevision=actual.trade_date===expected.trade_date&&
        isDeepStrictEqual(identity(expected),identity(actual))&&
        Number.isFinite(Date.parse(actual.updated_at))&&Date.parse(actual.updated_at)<Date.parse(expected.updated_at);
      // The same Writer publishes an initial and a final revision. A timeout may
      // still expose its initial revision; wait only within the existing read budget.
      // Never accept that revision and never replay the state-changing write.
      if((previousRound||previousRevision)&&attempt<retryDelaysMs.length){await sleep(retryDelaysMs[attempt]);continue;}
      throw new Error('SOURCE_STATUS_ACK_CONTENT_MISMATCH:'+evidence.different_fields.join(','),{cause});
    }
    return await finish({mode:'exact_readback_after_timeout',verified_after_timeout:true,
      writer_run_id:expected.payload.writer_run_id,generation_id:expected.payload.generation_id,
      payload_sha256:createHash('sha256').update(JSON.stringify(canonical(expected.payload))).digest('hex')});
    }
  }
  return await finish({mode:'write_response',verified_after_timeout:false});
}
async function acknowledgeStored({row,read}) {
  const expected=JSON.parse(JSON.stringify(row));
  for(const key of identityKeys)if(typeof expected.payload?.[key]!=='string'||!expected.payload[key])throw Error('SOURCE_STATUS_ACK_IDENTITY_MISSING:'+key);
  if(expected.trade_date!==expected.payload.trade_date||!Number.isFinite(Date.parse(expected.updated_at)))throw Error('SOURCE_STATUS_ACK_IDENTITY_INVALID');
  const rows=await read(expected);
  if(!Array.isArray(rows)||rows.length!==1)throw Error('SOURCE_STATUS_ACK_ROW_COUNT');
  const keys=Object.keys(expected),actual=rows[0];
  if(keys.some(k=>!Object.hasOwn(actual,k))||!isDeepStrictEqual(comparable(actual,keys),comparable(expected,keys)))throw Error('SOURCE_STATUS_ACK_CONTENT_MISMATCH');
  return {mode:'exact_readback_after_interruption',verified_after_interruption:true,writer_run_id:expected.payload.writer_run_id,generation_id:expected.payload.generation_id,payload_sha256:createHash('sha256').update(JSON.stringify(canonical(expected.payload))).digest('hex')};
}
function fixedReadQuery(row){
 for(const key of identityKeys)if(typeof row.payload?.[key]!=='string'||!row.payload[key])throw Error('SOURCE_STATUS_ACK_IDENTITY_MISSING:'+key);
 if(row.trade_date!==row.payload.trade_date||typeof row.source_name!=='string'||!row.source_name)throw Error('SOURCE_STATUS_ACK_IDENTITY_INVALID');
 const query=new URLSearchParams({select:Object.keys(row).join(','),source_name:'eq.'+row.source_name,trade_date:'eq.'+row.trade_date,limit:'2'});
 for(const key of identityKeys)query.set('payload->>'+key,'eq.'+row.payload[key]);
 return query.toString();
}
module.exports={writeWithAcknowledgement,acknowledgeStored,fixedReadQuery};

