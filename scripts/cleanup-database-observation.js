'use strict';
const crypto=require('crypto');
function stable(v){return v&&typeof v==='object'?(Array.isArray(v)?v.map(stable):Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]))):v;}
function row(table,value){const sha256=crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');return {key:table+':'+sha256,sha256};}
// Bounded complete read, never infer completion from a short service-capped page.
async function inventory(table,order,{url,headers,fetch:read=global.fetch}){
 const rows=[],seen=new Set();let total;
 for(let page=0;page<100;page++){
  const response=await read(url.replace(/\/$/,'')+'/rest/v1/'+table+'?select=*&order='+encodeURIComponent(order)+'&limit=1000&offset='+rows.length,{headers:{...headers,Prefer:'count=exact'},signal:AbortSignal.timeout(60000)});
  if(!response.ok)throw Error('database_inventory_HTTP_'+response.status+':'+table+':page='+page);
  const countText=response.headers.get('content-range')?.split('/')[1];
  if(!/^\d+$/.test(countText||''))throw Error('database_inventory_count_missing:'+table);
  const count=Number(countText);if(!Number.isSafeInteger(count))throw Error('database_inventory_count_invalid');
  if(total!==undefined&&total!==count)throw Error('database_inventory_count_drift:'+table);total=count;
  const text=await response.text();if(Buffer.byteLength(text)>16*1024*1024)throw Error('database_inventory_page_bound:'+table);
  const values=JSON.parse(text);if(!Array.isArray(values))throw Error('database_inventory_rows_missing');
  if(!values.length){if(rows.length!==total)throw Error('database_inventory_incomplete:'+table);return rows;}
  for(const value of values){const key=row(table,value).key;if(seen.has(key))throw Error('database_inventory_duplicate_or_unstable_page:'+table);seen.add(key);rows.push(value);}
  if(rows.length>total)throw Error('database_inventory_count_exceeded:'+table);
 }
 throw Error('database_inventory_bound:'+table);
}
module.exports={inventory,row};
