"use strict";
async function allCursorPages(fetchPage,maxPages=100){
 const rows=[],ids=new Set(),cursors=new Set();let cursor;
 for(let page=0;page<maxPages;page++){
  const p=await fetchPage(cursor);if(!Array.isArray(p.deployments)||!p.pagination||!Object.hasOwn(p.pagination,'next'))throw Error('deployment_pagination_missing');
  for(const row of p.deployments){const id=row.uid||row.id||row.url;if(!id||ids.has(id))throw Error('deployment_pagination_duplicate_or_missing_id');ids.add(id);rows.push(row);}
  const next=p.pagination.next;if(next===null||next===0)return {rows,pageCount:page+1,complete:true};
  if(!p.deployments.length||cursors.has(String(next)))throw Error('deployment_pagination_not_advancing');cursors.add(String(next));cursor=next;
 }
 throw Error('deployment_pagination_bound_reached');
}
module.exports={allCursorPages};

// Empty terminal page is required: service page caps must not truncate inventories.
async function allOffsetPages(fetchPage,{id,limit=100,maxPages=10000}={}) {
 const rows=[],seen=new Set();let total;
 for(let page=0;page<maxPages;page++){
  const result=await fetchPage(rows.length,limit);
  if(!result||!Array.isArray(result.rows))throw Error('offset_rows_missing');
  if(Object.hasOwn(result,'total')){
   if(!Number.isSafeInteger(result.total)||result.total<0)throw Error('offset_count_invalid');
   if(total!==undefined&&total!==result.total)throw Error('offset_count_drift');total=result.total;
  }
  if(!result.rows.length){if(total!==undefined&&rows.length!==total)throw Error('offset_missing_rows');return {rows,pageCount:page+1,complete:true};}
  for(const row of result.rows){const key=id(row);if(typeof key!=='string'||!key||seen.has(key))throw Error('offset_duplicate_or_missing_identity');seen.add(key);rows.push(row);}
  if(total!==undefined&&rows.length>total)throw Error('offset_count_exceeded');
 }
 throw Error('offset_pagination_bound');
}
async function storageInventory(buckets,listObjects,{maxFolders=10000}={}){
 if(!Array.isArray(buckets))throw Error('storage_buckets_missing');
 const ids=new Set(),objects=[],folders=[];let pages=0;
 for(const bucket of buckets){
  if(typeof bucket?.id!=='string'||!bucket.id||ids.has(bucket.id))throw Error('storage_bucket_identity_invalid');ids.add(bucket.id);
  const queue=[''],seen=new Set();
  while(queue.length){
   const prefix=queue.shift();if(seen.has(prefix)||folders.length>=maxFolders)throw Error('storage_folder_cycle_or_bound');seen.add(prefix);folders.push({bucket:bucket.id,prefix});
   const result=await allOffsetPages(async(offset,limit)=>({rows:await listObjects(bucket.id,{prefix,offset,limit,sortBy:{column:'name',order:'asc'}})}),{id:r=>r?.name});pages+=result.pageCount;
   for(const row of result.rows){
    if(row.name.includes('/')||row.name==='.'||row.name==='..'||row.name.includes('\\'))throw Error('storage_object_path_invalid');
    const name=prefix?prefix+'/'+row.name:row.name;
    if(row.id===null&&row.metadata===null){queue.push(name);continue;}
    if(typeof row.id!=='string'||!row.id||!row.metadata||!Number.isFinite(row.metadata.size)||row.metadata.size<0||!Number.isFinite(Date.parse(row.updated_at)))throw Error('storage_object_fields_missing');
    objects.push({bucket:bucket.id,path:name,id:row.id,metadata:row.metadata,updated_at:row.updated_at});
   }
  }
 }
 return {complete:true,buckets:buckets.map(b=>b.id),objects,folders,pages};
}
module.exports.allOffsetPages=allOffsetPages;
module.exports.storageInventory=storageInventory;
