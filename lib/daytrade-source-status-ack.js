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
async function writeWithAcknowledgement({row,write,read}) {
  // Snapshot the actual JSON wire representation before either callback runs.
  const expected=JSON.parse(JSON.stringify(row));
  for(const key of identityKeys) if(typeof expected.payload?.[key]!=='string'||!expected.payload[key])
    throw Error('SOURCE_STATUS_ACK_IDENTITY_MISSING:'+key);
  if(expected.trade_date!==expected.payload.trade_date || !Number.isFinite(Date.parse(expected.updated_at)))
    throw Error('SOURCE_STATUS_ACK_IDENTITY_INVALID');
  try { await write(expected); return {mode:'write_response',verified_after_timeout:false}; }
  catch(cause) {
    if(!['TimeoutError','AbortError'].includes(cause?.name)) throw cause;
    let rows;
    try { rows=await read(expected); }
    catch(readCause) { throw new Error('SOURCE_STATUS_ACK_READ_FAILED',{cause:readCause}); }
    if(!Array.isArray(rows)||rows.length!==1) throw new Error('SOURCE_STATUS_ACK_ROW_COUNT',{cause});
    const actual=rows[0],keys=Object.keys(expected);
    if(keys.some(k=>!Object.hasOwn(actual,k)) || !isDeepStrictEqual(comparable(actual,keys),comparable(expected,keys)))
      throw new Error('SOURCE_STATUS_ACK_CONTENT_MISMATCH:'+differencePaths(comparable(expected,keys),comparable(actual,keys)).join(','),{cause});
    return {mode:'exact_readback_after_timeout',verified_after_timeout:true,
      writer_run_id:expected.payload.writer_run_id,generation_id:expected.payload.generation_id,
      payload_sha256:createHash('sha256').update(JSON.stringify(canonical(expected.payload))).digest('hex')};
  }
}
module.exports={writeWithAcknowledgement};
