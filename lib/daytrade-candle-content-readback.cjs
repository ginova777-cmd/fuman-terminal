'use strict';
const {fingerprint}=require('./daytrade-candle-delta');
const key=r=>r.symbol+'|'+new Date(r.candle_time).toISOString();
async function readback({rows,url,headers,fetchImpl=global.fetch,deadline,onRows,progress}){
 if(rows.length>=1000)return readbackPaged({rows,url,headers,fetchImpl,deadline,onRows,progress});
 const matched=new Map(), seen=new Set();
 if(!Number.isFinite(deadline))throw Error('CANDLE_READBACK_DEADLINE_REQUIRED');
 for(let i=0;i<rows.length;i+=50){
  const batch=rows.slice(i,i+50), expected=new Map(batch.map(r=>[key(r),r]));
  if(expected.size!==batch.length)throw Error('CANDLE_READBACK_DUPLICATE_REQUEST');
  for(const r of batch)if(!/^\d{4}$/.test(r.symbol)||!Number.isFinite(Date.parse(r.candle_time)))throw Error('CANDLE_READBACK_IDENTITY');
  const fields=[...new Set(batch.flatMap(Object.keys))];
  const query=new URLSearchParams({select:fields.join(','),or:'('+batch.map(r=>'and(symbol.eq.'+r.symbol+',candle_time.eq.'+new Date(r.candle_time).toISOString()+')').join(',')+')',limit:String(batch.length+1)});
  const remaining=deadline-Date.now();if(remaining<=0)throw Error('CANDLE_READBACK_DEADLINE');
  const response=await require('./writer-operation-trace.cjs').request(url+'?'+query,{headers},{step:'stock_candle_content_readback',deadline,fetchImpl,symbolCount:new Set(rows.map(r=>r.symbol)).size});
  if(!response.ok)throw Error('CANDLE_READBACK_HTTP_'+response.status);
  const actual=await response.json();if(!Array.isArray(actual)||actual.length>batch.length)throw Error('CANDLE_READBACK_SHAPE');
  if(onRows)await onRows(actual,new Date().toISOString());
  for(const row of actual){const id=key(row), want=expected.get(id);if(!want||seen.has(id))throw Error('CANDLE_READBACK_UNEXPECTED_OR_DUPLICATE');seen.add(id);
   const projected={};for(const field of Object.keys(want)){if(!Object.hasOwn(row,field))throw Error('CANDLE_READBACK_FIELD_MISSING:'+field);projected[field]=row[field];}
   normalizeServerMetadata(projected,want);
   projected.candle_time=new Date(projected.candle_time).toISOString();
   if(fingerprint(projected)===fingerprint({...want,candle_time:new Date(want.candle_time).toISOString()}))matched.set(id,fingerprint(want));
  }
  if(progress)await progress();
 }
 return matched;
}

function normalizeServerMetadata(projected,want){
 // The server appends publication provenance to payload. Compare source content
 // exactly while retaining validation of the separately owned server metadata.
 const metadata=['db_written_at','version_first_written_at','publication_revision','publication_time_contract','commit_visibility_verified'];
 const added=metadata.filter(field=>Object.hasOwn(projected.payload||{},field)&&!Object.hasOwn(want.payload||{},field));
 if(added.length){
  const p=projected.payload;
  if(p.publication_time_contract!=='server-row-write-v1'||!Number.isFinite(Date.parse(p.db_written_at))||!Number.isFinite(Date.parse(p.version_first_written_at))||Date.parse(p.version_first_written_at)>Date.parse(p.db_written_at)||!Number.isSafeInteger(p.publication_revision)||p.publication_revision<1||typeof p.commit_visibility_verified!=='boolean')throw Error('CANDLE_READBACK_PUBLICATION_METADATA_INVALID');
  projected.payload={...p};for(const field of added)delete projected.payload[field];
 }

}
async function readbackPaged({rows,url,headers,fetchImpl,deadline,onRows,progress}){
 if(!Number.isFinite(deadline))throw Error('CANDLE_READBACK_DEADLINE_REQUIRED');
 const expected=new Map(),symbols=new Set(),fields=new Set(),dates=new Set();let earliest=Infinity,latest=-Infinity;
 for(const r of rows){const t=Date.parse(r.candle_time);if(!/^\d{4}$/.test(r.symbol)||!Number.isFinite(t))throw Error('CANDLE_READBACK_IDENTITY');const id=key(r);if(expected.has(id))throw Error('CANDLE_READBACK_DUPLICATE_REQUEST');expected.set(id,r);symbols.add(r.symbol);dates.add(r.trade_date);Object.keys(r).forEach(k=>fields.add(k));earliest=Math.min(earliest,t);latest=Math.max(latest,t);}
 if(dates.size!==1)throw Error('CANDLE_READBACK_TRADE_DATE_MIX');
 const tradeDate=[...dates][0],matched=new Map(),seen=new Set(),pageSize=1000,maxRows=Math.min(symbols.size*1440,rows.length*2+1000);
 for(let offset=0;offset<=maxRows;offset+=pageSize){
  const remaining=deadline-Date.now();if(remaining<=0)throw Error('CANDLE_READBACK_DEADLINE');
  const query=new URLSearchParams({select:[...fields].join(','),trade_date:'eq.'+tradeDate,symbol:'in.('+[...symbols].sort().join(',')+')',and:'(candle_time.gte.'+new Date(earliest).toISOString()+',candle_time.lte.'+new Date(latest).toISOString()+')',order:'symbol.asc,candle_time.asc',limit:String(pageSize),offset:String(offset)});
  const response=await require('./writer-operation-trace.cjs').request(url+'?'+query,{headers},{step:'stock_candle_content_readback',deadline,fetchImpl,symbolCount:new Set(rows.map(r=>r.symbol)).size});
  if(!response.ok)throw Error('CANDLE_READBACK_HTTP_'+response.status);const actual=await response.json();if(!Array.isArray(actual)||actual.length>pageSize)throw Error('CANDLE_READBACK_SHAPE');
  for(const row of actual){const t=Date.parse(row.candle_time);if(!symbols.has(row.symbol)||row.trade_date!==tradeDate||!Number.isFinite(t)||t<earliest||t>latest)throw Error('CANDLE_READBACK_UNEXPECTED_OR_DUPLICATE');const id=key(row);if(seen.has(id))throw Error('CANDLE_READBACK_UNEXPECTED_OR_DUPLICATE');seen.add(id);if(seen.size>maxRows)throw Error('CANDLE_READBACK_BOUND');const want=expected.get(id);if(!want)continue;const projected={};for(const field of Object.keys(want)){if(!Object.hasOwn(row,field))throw Error('CANDLE_READBACK_FIELD_MISSING:'+field);projected[field]=row[field];}normalizeServerMetadata(projected,want);projected.candle_time=new Date(projected.candle_time).toISOString();if(fingerprint(projected)===fingerprint({...want,candle_time:new Date(want.candle_time).toISOString()}))matched.set(id,fingerprint(want));}
  if(onRows)await onRows(actual,new Date().toISOString());
  if(progress)await progress();
  if(actual.length<pageSize)return matched;
 }
 throw Error('CANDLE_READBACK_BOUND');
}

module.exports={readback,key};

