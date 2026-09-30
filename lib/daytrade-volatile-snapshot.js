'use strict';
const {randomUUID}=require('node:crypto');
const CONTRACT='mother-pool-volatile-snapshot-v1';
function createSnapshotStore({now=Date.now,epoch=randomUUID(),maxSnapshots=3}={}) {
 if(!Number.isInteger(maxSnapshots)||maxSnapshots<1||maxSnapshots>10)throw Error('INVALID_SNAPSHOT_CAPACITY');
 let sequence=0,latest=null;
 const snapshots=new Map();
 function publish({trade_date,canonical_run_id,observed_at,rows,quotes,source_evidence}) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(trade_date)||!canonical_run_id||!Number.isFinite(Date.parse(observed_at)))throw Error('SNAPSHOT_IDENTITY_MISSING');
  if(!Array.isArray(rows)||!rows.length||!Array.isArray(quotes))throw Error('SNAPSHOT_UNIVERSE_MISSING');
  const symbols=new Set();
  for(const row of rows){if(!/^\d{4}$/.test(row.symbol)||symbols.has(row.symbol))throw Error('SNAPSHOT_SYMBOL_INVALID_OR_DUPLICATE');symbols.add(row.symbol);}
  const quoteSymbols=new Set();
  for(const row of quotes){if(!symbols.has(row.symbol)||quoteSymbols.has(row.symbol)||row.trade_date!==trade_date)throw Error('SNAPSHOT_QUOTE_IDENTITY_MISMATCH');quoteSymbols.add(row.symbol);}
  if(Date.parse(observed_at)>now())throw Error('SNAPSHOT_FUTURE_TIME');
  const id=epoch+':'+(++sequence);
  if(source_evidence&&(source_evidence.trade_date!==trade_date||source_evidence.canonical_run_id!==canonical_run_id))throw Error('SNAPSHOT_READINESS_IDENTITY_MISMATCH');
  const snapshot=structuredClone({contract:CONTRACT,storage:'volatile_memory',trade_date,canonical_run_id,producer_epoch:epoch,snapshot_sequence:sequence,snapshot_id:id,observed_at,rows,quotes,count:rows.length,...(source_evidence?{source_evidence}:{})});
  snapshots.set(id,snapshot);latest=id;
  while(snapshots.size>maxSnapshots)snapshots.delete(snapshots.keys().next().value);
  return {snapshot_id:id,trade_date,count:rows.length};
 }
 function select({tradeDate,snapshotId=latest,maxAgeMs=5000}={}) {
  const snapshot=snapshots.get(snapshotId);
  if(!snapshot)throw Error('VOLATILE_SNAPSHOT_NOT_AVAILABLE');
  if(snapshot.trade_date!==tradeDate)throw Error('VOLATILE_SNAPSHOT_DATE_MISMATCH');
  const age=now()-Date.parse(snapshot.observed_at);
  if(age<0||age>maxAgeMs)throw Error('VOLATILE_SNAPSHOT_STALE');
  return snapshot;
 }
 function read(options){return structuredClone(select(options));}
 function readPage({offset=0,limit=50,...options}={}){
  const snapshot=select(options);
  if(!Number.isSafeInteger(offset)||offset<0||offset>=snapshot.count||!Number.isSafeInteger(limit)||limit<1||limit>50)throw Error('SNAPSHOT_PAGE_RANGE_INVALID');
  const {rows,quotes,...meta}=snapshot,bySymbol=new Map(quotes.map(q=>[q.symbol,q]));
  const page={...meta,quote_count:quotes.length,rows:[],quotes:[],page:{offset,returned:0,next_offset:null}};
  let bytes=Buffer.byteLength(JSON.stringify({ok:true,snapshot:page}))+128;
  for(let i=offset;i<Math.min(offset+limit,rows.length);i++){
   const row=rows[i],quote=bySymbol.get(row.symbol);
   const extra=Buffer.byteLength(JSON.stringify(row))+1+(quote?Buffer.byteLength(JSON.stringify(quote))+1:0);
   if(bytes+extra>512*1024){if(!page.rows.length)throw Error('SNAPSHOT_SINGLE_ROW_TOO_LARGE');break;}
   bytes+=extra;page.rows.push(row);if(quote)page.quotes.push(quote);
  }
  page.page.returned=page.rows.length;
  page.page.next_offset=offset+page.rows.length<snapshot.count?offset+page.rows.length:null;
  return structuredClone(page);
 }
 function invalidate(){latest=null;snapshots.clear();}
 return {publish,read,readPage,invalidate};
}
module.exports={CONTRACT,createSnapshotStore};
