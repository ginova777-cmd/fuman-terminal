'use strict';
const fs=require('node:fs'),path=require('node:path');
function createSourceReadback({url,key,runtimeRoot,fetchImpl=fetch}){
 let role;try{role=JSON.parse(Buffer.from(String(key).split('.')[1],'base64url')).role;}catch{}
 if(role!=='anon')throw Error('SOURCE_READBACK_ANON_REQUIRED');
 const endpoint=new URL('/rest/v1/source_status',url);
 if(endpoint.protocol!=='https:')throw Error('SOURCE_READBACK_HTTPS_REQUIRED');
 endpoint.search=new URLSearchParams({select:'source_name,status,updated_at,payload',source_name:'eq.fugle_daytrade_source',limit:'1'}).toString();
 return async()=>{
  const response=await fetchImpl(endpoint,{headers:{apikey:key,Authorization:'Bearer '+key,Prefer:'count=exact',Range:'0-0'},signal:AbortSignal.timeout(5000)});
  if(!response.ok)throw Error('SOURCE_READBACK_HTTP_'+response.status);
  if(response.headers.get('content-range')!=='0-0/1')throw Error('SOURCE_READBACK_COUNT_INVALID');
  const chunks=[];let size=0;
  for await(const chunk of response.body){size+=chunk.length;if(size>4*1024*1024)throw Error('SOURCE_READBACK_SIZE_LIMIT');chunks.push(chunk);}
  const rows=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if(!Array.isArray(rows)||rows.length!==1)throw Error('SOURCE_READBACK_ROWS_INVALID');
  const file=path.join(runtimeRoot,'state','daytrade-mother-pool-snapshot-latest.json');
  if(fs.statSync(file).size>4*1024*1024)throw Error('SOURCE_SNAPSHOT_SIZE_LIMIT');
  const snapshotBytes=fs.readFileSync(file);
  if(snapshotBytes.length>4*1024*1024)throw Error('SOURCE_SNAPSHOT_SIZE_LIMIT');
  return {sourceStatus:rows[0],snapshotBytes};
 };
}
module.exports={createSourceReadback};
