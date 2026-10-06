'use strict';
const {sha}=require('./mother-shared-water-evidence.cjs');
const {build}=require('./mother-shared-water-producer.cjs');
// Called by the existing Writer after its actual write completes. Callbacks
// must implement bounded anon readback and a fresh read of the collector cache.
// No persistence/network or live Gate changes are performed by this module.
async function freeze({identity,prioritySymbols,snapshotBytes,readCapture,readback,writeCompletedAt,writtenSymbols,now=Date.now,maxBundleBytes=8*1024*1024}){
 const before=await readCapture();
 if(before?.contract!=='mother-shared-water-capture-v1'||before.stored!==true||before.closed||!before.authenticated)throw Error('CAPTURE_NOT_ACTIVE');
 const beforeAt=Date.parse(before.captured_at);
 if(!Number.isFinite(beforeAt)||beforeAt>now())throw Error('CAPTURE_TIME_INVALID');
 const eligible=new Set(prioritySymbols),selected=before.rows.filter(r=>eligible.has(r.symbol));
 if(new Set(selected.map(r=>r.symbol)).size!==selected.length)throw Error('CAPTURE_DUPLICATE');
 const read=await readback(prioritySymbols,identity.trade_date);
 const readAt=new Date(now()).toISOString();
 if(read.reader_role!=='anon'||!Buffer.isBuffer(read.bytes)||read.bytes.length>4*1024*1024||read.complete!==true)throw Error('ANON_READBACK_INVALID');
 const dbRows=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(read.bytes));
 if(!Array.isArray(dbRows)||dbRows.some(r=>!eligible.has(r.symbol)||r.trade_date!==identity.trade_date)||new Set(dbRows.map(r=>r.symbol)).size!==dbRows.length)throw Error('ANON_READBACK_IDENTITY_INVALID');
 const after=await readCapture({after:readAt,connectionId:before.connection_id}),headCheckedAt=new Date(now()).toISOString();
 if(after?.connection_id!==before.connection_id||after.closed||!after.authenticated||after.stored!==true)throw Error('CAPTURE_CONNECTION_CHANGED');
 const afterAt=Date.parse(after.captured_at);
 if(!Number.isFinite(afterAt)||afterAt<=Date.parse(readAt)||afterAt<=beforeAt||afterAt>Date.parse(headCheckedAt))throw Error('CAPTURE_NOT_AFTER_READBACK');
 const head=new Map(after.rows.map(r=>[r.symbol,r]));if(head.size!==after.rows.length)throw Error('CAPTURE_HEAD_DUPLICATE');
 const tradeMap=capture=>{const rows=capture.trade_heads||[];if(!Array.isArray(rows))throw Error('TRADE_HEAD_ARRAY_INVALID');const map=new Map(rows.map(r=>[r.symbol,r]));if(map.size!==rows.length)throw Error('TRADE_HEAD_DUPLICATE');return map;};
 const tradesBefore=tradeMap(before),tradesAfter=tradeMap(after);
 const windows=new Map((after.native_windows||[]).map(r=>[r.symbol,r]));if(windows.size!==(after.native_windows||[]).length)throw Error('NATIVE_WINDOW_DUPLICATE');
 const db=new Map(dbRows.map(r=>[r.symbol,r])),blobs=new Map(),evidenceRows=[];let bytes=0;
 const add=buffer=>{const h=sha(buffer),ref='sha256:'+h;if(!blobs.has(ref)){bytes+=buffer.length;if(bytes>maxBundleBytes)throw Error('BUNDLE_LIMIT');blobs.set(ref,buffer);}return {ref,hash:h};};
 const readbackBlob=add(read.bytes);add(snapshotBytes);
 const rawPages=(read.raw_pages||[]).map(page=>({...add(page.bytes),content_range:page.content_range,requested_symbols:page.requested_symbols}));
 for(const item of selected){
  // Unwritten members remain in the fixed denominator without a fabricated
  // current write acknowledgement. Historical acknowledgements need their own proof.
  if(writtenSymbols&&!writtenSymbols.includes(item.symbol))continue;
  const raw=Buffer.from(item.raw_utf8),transport=Buffer.from(item.transport_utf8);
  if(sha(raw)!==item.raw_sha256||sha(transport)!==item.transport_sha256)throw Error('CAPTURE_HASH_MISMATCH');
  const native=JSON.parse(raw.toString('utf8'));
  if(native.connection_id!==before.connection_id||native.symbol!==item.symbol)throw Error('CAPTURE_NATIVE_IDENTITY_MISMATCH');
  const publication={contract:'mother-publication-evidence-v1',symbol:item.symbol,trade_date:identity.trade_date,connection_id:native.connection_id,subscription_id:native.subscription_id,writer_run_id:identity.writer_run_id,generation:identity.generation,reader_role:'anon',row_count:db.has(item.symbol)?1:0,row:db.get(item.symbol)||null,raw_sha256:item.raw_sha256,write_completed_at:writeCompletedAt,readback_at:readAt,readback_bytes_sha256:sha(read.bytes),collector_head_sha256:head.get(item.symbol)?.raw_sha256||null,collector_head_checked_at:headCheckedAt};
  publication.readback_ref=readbackBlob.ref;
  publication.collector_capture_at=after.captured_at;
  publication.raw_readback_pages=rawPages;
  if(windows.has(item.symbol)){
   const window=windows.get(item.symbol),bytes=Buffer.from(window.raw_utf8);if(sha(bytes)!==window.raw_sha256)throw Error('NATIVE_WINDOW_HASH_MISMATCH');
   const stored=add(bytes);publication.native_window_ref=stored.ref;publication.native_window_sha256=stored.hash;
  }
  publication.trade_head_status=tradesBefore.has(item.symbol)?'CAPTURED':'NOT_CAPTURED';
  publication.collector_trade_head_sha256=tradesAfter.get(item.symbol)?.raw_sha256||null;
  if(tradesBefore.has(item.symbol)){
   const entry=tradesBefore.get(item.symbol),bytes=Buffer.from(entry.raw_utf8);
   if(sha(bytes)!==entry.raw_sha256)throw Error('TRADE_HEAD_HASH_MISMATCH');
   const stored=add(bytes);publication.trade_head_ref=stored.ref;publication.trade_head_sha256=stored.hash;
  }
  const a=add(raw),t=add(transport),p=add(Buffer.from(JSON.stringify(publication)));
  const tradeUs=native.payload?.lastTrade?.time;const tradeAt=Number.isSafeInteger(tradeUs)?new Date(Math.floor(tradeUs/1000)).toISOString():null;
  const idle=Number.isSafeInteger(tradeUs)&&now()-tradeUs/1000>120000;
  // The verifier independently validates this new observation window before an
  // idle row is usable. A missing/broken window remains UNKNOWN.
  const expiration=idle?Math.min(Date.parse(after.captured_at)+30000,now()+30000):Math.min(tradeUs/1000+120000,now()+30000);
  evidenceRows.push({symbol:item.symbol,trade_date:identity.trade_date,source:'Fugle.websocket.aggregates',last_trade_at:tradeAt,quote_event_at:tradeAt,evidence_asof:headCheckedAt,evidence_valid_until:Number.isFinite(expiration)?new Date(expiration).toISOString():null,raw_evidence_ref:a.ref,payload_sha256:a.hash,transport_evidence_ref:t.ref,transport_sha256:t.hash,publication_evidence_ref:p.ref,publication_sha256:p.hash});
 }
 const checkedAt=new Date(now()).toISOString(),validUntil=new Date(Date.parse(checkedAt)+30000).toISOString();
 const receipt=build({identity,prioritySymbols,snapshotBytes,evidenceRows,resolve:ref=>blobs.get(ref),checkedAt,validUntil});
 receipt.evidence_hashes=[...blobs.keys()].map(ref=>ref.slice(7)).sort();
 return {receipt,blobs,byte_length:bytes,readback_sha256:sha(read.bytes),persisted:false};
}
module.exports={freeze};
