'use strict';
const {fingerprint}=require('./daytrade-candle-delta');
const key=r=>r.symbol+'|'+new Date(r.candle_time).toISOString();
async function readback({rows,url,headers,fetchImpl=global.fetch,deadline}){
 const matched=new Map(), seen=new Set();
 if(!Number.isFinite(deadline))throw Error('CANDLE_READBACK_DEADLINE_REQUIRED');
 for(let i=0;i<rows.length;i+=50){
  const batch=rows.slice(i,i+50), expected=new Map(batch.map(r=>[key(r),r]));
  if(expected.size!==batch.length)throw Error('CANDLE_READBACK_DUPLICATE_REQUEST');
  for(const r of batch)if(!/^\d{4}$/.test(r.symbol)||!Number.isFinite(Date.parse(r.candle_time)))throw Error('CANDLE_READBACK_IDENTITY');
  const fields=[...new Set(batch.flatMap(Object.keys))];
  const query=new URLSearchParams({select:fields.join(','),or:'('+batch.map(r=>'and(symbol.eq.'+r.symbol+',candle_time.eq.'+new Date(r.candle_time).toISOString()+')').join(',')+')',limit:String(batch.length+1)});
  const remaining=deadline-Date.now();if(remaining<=0)throw Error('CANDLE_READBACK_DEADLINE');
  const response=await fetchImpl(url+'?'+query,{headers,signal:AbortSignal.timeout(Math.max(1,Math.min(30000,remaining)))});
  if(!response.ok)throw Error('CANDLE_READBACK_HTTP_'+response.status);
  const actual=await response.json();if(!Array.isArray(actual)||actual.length>batch.length)throw Error('CANDLE_READBACK_SHAPE');
  for(const row of actual){const id=key(row), want=expected.get(id);if(!want||seen.has(id))throw Error('CANDLE_READBACK_UNEXPECTED_OR_DUPLICATE');seen.add(id);
   const projected={};for(const field of Object.keys(want)){if(!Object.hasOwn(row,field))throw Error('CANDLE_READBACK_FIELD_MISSING:'+field);projected[field]=row[field];}
   // The server appends publication provenance to payload. Compare source content
   // exactly while retaining validation of the separately owned server metadata.
   const metadata=['db_written_at','version_first_written_at','publication_revision','publication_time_contract','commit_visibility_verified'];
   const added=metadata.filter(field=>Object.hasOwn(projected.payload||{},field)&&!Object.hasOwn(want.payload||{},field));
   if(added.length){
    const p=projected.payload;
    if(p.publication_time_contract!=='server-row-write-v1'||!Number.isFinite(Date.parse(p.db_written_at))||!Number.isFinite(Date.parse(p.version_first_written_at))||Date.parse(p.version_first_written_at)>Date.parse(p.db_written_at)||!Number.isSafeInteger(p.publication_revision)||p.publication_revision<1||typeof p.commit_visibility_verified!=='boolean')throw Error('CANDLE_READBACK_PUBLICATION_METADATA_INVALID');
    projected.payload={...p};for(const field of added)delete projected.payload[field];
   }
   projected.candle_time=new Date(projected.candle_time).toISOString();
   if(fingerprint(projected)===fingerprint({...want,candle_time:new Date(want.candle_time).toISOString()}))matched.set(id,fingerprint(want));
  }
 }
 return matched;
}
module.exports={readback,key};
