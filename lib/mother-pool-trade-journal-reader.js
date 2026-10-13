'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
// Read-only, isolated input adapter. A truncated file is never a complete proof.
async function read({root,symbol,tradeDate,asOf,maxBytes=8*1024*1024,maxRows=100000}){
 if(!/^\d{4}$/.test(symbol)||!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)||!Number.isFinite(Date.parse(asOf))||!Number.isSafeInteger(maxBytes)||maxBytes<1||!Number.isSafeInteger(maxRows)||maxRows<1)throw Error('JOURNAL_ARGUMENT_INVALID');
 const file=path.join(root,tradeDate,symbol+'.jsonl');let handle;
 const gap=reason=>({status:'DATA_GAP',reason,file,rows:[],complete:false});
 try{
  handle=await fs.open(file,'r');const before=await handle.stat();
  if(!before.isFile())return gap('NOT_REGULAR_FILE');
  if(before.size>maxBytes)return gap('JOURNAL_BYTE_LIMIT');
  const bytes=Buffer.alloc(before.size);let offset=0;
  while(offset<bytes.length){const r=await handle.read(bytes,offset,bytes.length-offset,offset);if(!r.bytesRead)return gap('JOURNAL_SHORT_READ');offset+=r.bytesRead;}
  const after=await handle.stat();if(after.size!==before.size||after.mtimeMs!==before.mtimeMs)return gap('JOURNAL_CHANGED_DURING_READ');
  const raw=bytes.toString('utf8');if(raw&&!raw.endsWith('\n'))return gap('JOURNAL_PARTIAL_LINE');
  const rows=[];let count=0;
  for(const line of raw.split('\n')){if(!line.trim())continue;if(++count>maxRows)return gap('JOURNAL_ROW_LIMIT');let row;try{row=JSON.parse(line);}catch{return gap('JOURNAL_INVALID_JSON');}
   if(row.stock_id!==symbol||row.trade_date!==tradeDate||row.source!=='Fugle.websocket.trades'||row.is_synthetic!==false||!Number.isFinite(Date.parse(row.event_at))||!Number.isFinite(Date.parse(row.received_at))||Date.parse(row.event_at)>Date.parse(row.received_at))return gap('JOURNAL_ROW_IDENTITY_OR_TIME');
   if(Date.parse(row.received_at)<=Date.parse(asOf))rows.push(row);
  }
  return {status:'READ_COMPLETE',complete:true,file,rows,bytes:bytes.length,scanned_rows:count,sha256:require('node:crypto').createHash('sha256').update(bytes).digest('hex'),as_of:asOf,continuity_verified:false};
 }catch(e){if(e.code==='ENOENT')return gap('JOURNAL_MISSING');return gap('JOURNAL_READ_FAILED:'+e.code);}finally{if(handle)await handle.close();}
}
module.exports={read};
