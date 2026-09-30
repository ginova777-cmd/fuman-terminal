'use strict';
const net=require('node:net');
const MAX_REQUEST=2048,MAX_RESPONSE=8*1024*1024;
function createSnapshotServer({endpoint,store,marketStore}) {
 const connections=new Set();
 const server=net.createServer(socket=>{
  if(connections.size>=4){socket.destroy();return;}
  connections.add(socket);socket.on('close',()=>connections.delete(socket));socket.on('error',()=>{});
  socket.setTimeout(3000,()=>socket.destroy());
  let input=Buffer.alloc(0),handled=false;
  socket.on('data',chunk=>{
   if(handled)return;
   input=Buffer.concat([input,chunk]);
   if(input.length>MAX_REQUEST){handled=true;socket.destroy();return;}
   const end=input.indexOf(10);if(end<0)return;
   handled=true;
   let response;
   try {
    const request=JSON.parse(input.subarray(0,end).toString('utf8'));
    if(!['read','market','page','lease'].includes(request.op)||!/^\d{4}-\d{2}-\d{2}$/.test(request.tradeDate)||Object.keys(request).some(k=>!['op','tradeDate','snapshotId','offset','leaseId'].includes(k))||request.snapshotId!==undefined&&typeof request.snapshotId!=='string'||request.op!=='page'&&request.offset!==undefined)throw Error('INVALID_SNAPSHOT_REQUEST');
    if(request.leaseId!==undefined&&(typeof request.leaseId!=='string'||!['read','page'].includes(request.op)))throw Error('INVALID_LEASE_REQUEST');
    if(request.op==='market'&&(!marketStore||request.snapshotId!==undefined))throw Error('MARKET_READ_NOT_AVAILABLE');
    response={ok:true,snapshot:request.op==='lease'?store.acquireLease({tradeDate:request.tradeDate,snapshotId:request.snapshotId}):request.op==='page'?store.readPage({tradeDate:request.tradeDate,snapshotId:request.snapshotId,offset:request.offset,leaseId:request.leaseId,maxAgeMs:5000}):(request.op==='market'?marketStore:store).read({tradeDate:request.tradeDate,snapshotId:request.snapshotId,leaseId:request.leaseId,maxAgeMs:5000})};
   }catch(error){response={ok:false,error:typeof error.message==='string'&&/^[A-Z_]+$/.test(error.message)?error.message:'SNAPSHOT_REQUEST_FAILED'};}
   let text=JSON.stringify(response)+'\n';if(Buffer.byteLength(text)>MAX_RESPONSE)text=JSON.stringify({ok:false,error:'SNAPSHOT_RESPONSE_TOO_LARGE'})+'\n';
   socket.end(text);
  });
 });
 return {
  listen:()=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(endpoint,()=>{server.removeListener('error',reject);resolve();});}),
  close:()=>new Promise((resolve,reject)=>{for(const socket of connections)socket.destroy();server.close(error=>error?reject(error):resolve());}),
 };
}
function readOne({endpoint,tradeDate,snapshotId,timeoutMs=2000,op='read',offset,leaseId}) {
 return new Promise((resolve,reject)=>{
  let done=false,input=Buffer.alloc(0);
  const socket=net.createConnection(endpoint);
  const finish=(error,value)=>{if(done)return;done=true;socket.destroy();error?reject(error):resolve(value);};
  socket.setTimeout(timeoutMs,()=>finish(Error('SNAPSHOT_TRANSPORT_TIMEOUT')));
  socket.on('connect',()=>socket.write(JSON.stringify({op,tradeDate,snapshotId,offset,leaseId})+'\n'));
  socket.on('error',()=>finish(Error('SNAPSHOT_TRANSPORT_UNAVAILABLE')));
  socket.on('end',()=>{if(!done)finish(Error('SNAPSHOT_TRANSPORT_TRUNCATED'));});
  socket.on('data',chunk=>{
   input=Buffer.concat([input,chunk]);if(input.length>MAX_RESPONSE){finish(Error('SNAPSHOT_TRANSPORT_TOO_LARGE'));return;}
   const end=input.indexOf(10);if(end<0)return;
   try {const data=JSON.parse(input.subarray(0,end).toString('utf8'));if(data.ok!==true||!data.snapshot)throw Error(data.error||'SNAPSHOT_TRANSPORT_INVALID');finish(null,data.snapshot);}catch(error){finish(error);}
  });
 });
}
async function readSnapshot(options){
 let offset=0,first=null,bytes=0,pageCount=0;const rows=[],quotes=[],symbols=new Set(),quoteSymbols=new Set();
 do{
  const page=await readOne({...options,op:'page',offset,snapshotId:first?.snapshot_id||options.snapshotId});
  pageCount++;if(!first)first=page;
  if(!Array.isArray(page.rows)||!Array.isArray(page.quotes)||!Number.isSafeInteger(page.count)||page.count<1||page.count>3000||page.page?.offset!==offset||page.page.returned!==page.rows.length||!page.rows.length||page.rows.length>50)throw Error('SNAPSHOT_PAGE_INVALID');
  for(const field of ['snapshot_id','producer_epoch','snapshot_sequence','canonical_run_id','trade_date','observed_at','count','quote_count'])if(page[field]!==first[field])throw Error('SNAPSHOT_PAGE_IDENTITY_CHANGED');
  for(const field of ['contract','storage','source_evidence','verification_lease'])if(JSON.stringify(page[field])!==JSON.stringify(first[field]))throw Error('SNAPSHOT_PAGE_CONTRACT_CHANGED');
  if(page.trade_date!==options.tradeDate||!page.snapshot_id||options.snapshotId&&page.snapshot_id!==options.snapshotId)throw Error('SNAPSHOT_PAGE_IDENTITY_INVALID');
  const members=new Set();for(const row of page.rows){if(!/^\d{4}$/.test(row.symbol)||symbols.has(row.symbol))throw Error('SNAPSHOT_PAGE_DUPLICATE_SYMBOL');symbols.add(row.symbol);members.add(row.symbol);rows.push(row);}
  for(const quote of page.quotes){if(!members.has(quote.symbol)||quoteSymbols.has(quote.symbol)||quote.trade_date!==page.trade_date)throw Error('SNAPSHOT_PAGE_QUOTE_INVALID');quoteSymbols.add(quote.symbol);quotes.push(quote);}
  bytes+=Buffer.byteLength(JSON.stringify(page));if(bytes>128*1024*1024)throw Error('SNAPSHOT_TOTAL_TOO_LARGE');
  offset+=page.rows.length;
  if(offset>page.count||page.page.next_offset!==(offset<page.count?offset:null))throw Error('SNAPSHOT_PAGE_TRUNCATED');
 }while(offset<first.count);
 if(quotes.length!==first.quote_count)throw Error('SNAPSHOT_QUOTE_COUNT_MISMATCH');
 const {page,...meta}=first;return {...meta,rows,quotes,transport_readback:{page_count:pageCount,row_count:rows.length,quote_count:quotes.length}};
}
module.exports={createSnapshotServer,readSnapshot,acquireSnapshotLease:options=>readOne({...options,op:"lease",leaseId:undefined}),readMarket:options=>readOne({...options,op:'market',snapshotId:undefined})};
