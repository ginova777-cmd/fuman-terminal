'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const CONTRACT='shared-recent-volume-water-v1';
const FORMULA='volume10d-prior5-2_5x-v1';
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
function same(a,b){return JSON.stringify(a)===JSON.stringify(b);}
function valid(snapshot,{target,dates,version}){
 return Boolean(snapshot?.contract===CONTRACT&&snapshot.formula===FORMULA&&snapshot.tradeDate===target&&same(snapshot.dates,dates)&&same(snapshot.sourceVersion,version)&&snapshot.complete===true&&snapshot.rows?.length===version.count&&snapshot.evidenceBySymbol&&snapshot.rowsHash===hash(snapshot.rows)&&snapshot.evidenceHash===hash(snapshot.evidenceBySymbol));
}
function create({runtime=process.env.FUMAN_RUNTIME_DIR||'C:/fuman-runtime',request}={}){
 const dir=path.join(runtime,'data/shared-recent-volume-water');
 const read=f=>{try{return JSON.parse(fs.readFileSync(f,'utf8'))}catch{return null}};
 const defaultRequest=async query=>{
  const secret=n=>fs.readFileSync(path.join(runtime,'secrets',n),'utf8').trim();
  const url=secret('supabase-url.txt').replace(/\/+$/,''),key=secret('supabase-service-role-key.txt');
  const metadata=query.get('select')==='updated_at';
  const r=await fetch(url+'/rest/v1/stock_daily_volume?'+query,{headers:{apikey:key,Authorization:'Bearer '+key,...(metadata?{Prefer:'count=exact'}:{})},signal:AbortSignal.timeout(30000)});
  if(!r.ok)throw Error('shared_volume_http_'+r.status);
  const rows=await r.json(),total=Number(r.headers.get('content-range')?.split('/')[1]);
  if(!Array.isArray(rows)||(metadata&&!Number.isFinite(total)))throw Error('shared_volume_invalid_response');return{rows,total};
 };
 const fetchRows=request||defaultRequest;
 async function get({target,dates,calculate}){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(target)||dates.length!==15||dates.some(d=>!/^\d{4}-\d{2}-\d{2}$/.test(d))||new Set(dates).size!==15||dates.at(-1)!==target||dates.some((d,i)=>i&&d<=dates[i-1]))throw Error('shared_volume_calendar_invalid');
  const query=fields=>{const q=new URLSearchParams(fields);q.append('trade_date','gte.'+dates[0]);q.append('trade_date','lte.'+target);return q;};
  const version=async()=>{const r=await fetchRows(query({select:'updated_at',order:'updated_at.desc.nullslast',limit:'1'}));const updatedAt=r.rows[0]?.updated_at;if(!updatedAt||!Number.isFinite(Date.parse(updatedAt))||r.total<=0)throw Error('shared_volume_source_version_missing');return{table:'stock_daily_volume',from:dates[0],to:target,count:r.total,updatedAt};};
  fs.mkdirSync(dir,{recursive:true});
  const file=path.join(dir,target+'.json'),lock=file+'.lock';
  let currentVersion=await version();
  let cached=read(file);
  if(valid(cached,{target,dates,version:currentVersion}))return{snapshot:cached,cacheHit:true,file,metadataReads:1};
  const deadline=Date.now()+90000;
  while(true){
   try{const fd=fs.openSync(lock,'wx');fs.writeFileSync(fd,JSON.stringify({pid:process.pid,createdAt:new Date().toISOString()}));fs.closeSync(fd);break;}
   catch(e){if(e.code!=='EEXIST')throw e;const owner=read(lock);if(owner?.pid){try{process.kill(owner.pid,0)}catch(err){if(err.code==='ESRCH'){fs.unlinkSync(lock);continue}}}if(Date.now()>deadline)throw Error('shared_volume_writer_busy');await pause(500);}
  }
  try{
   currentVersion=await version();cached=read(file);
   if(valid(cached,{target,dates,version:currentVersion}))return{snapshot:cached,cacheHit:true,file,metadataReads:2};
   const rows=[];
   for(let offset=0;offset<100000;offset+=1000){const r=await fetchRows(query({select:'symbol,trade_date,volume_lots,volume_shares',order:'trade_date.asc,symbol.asc',limit:'1000',offset:String(offset)}));rows.push(...r.rows);if(r.rows.length<1000)break;}
   const after=await version();
   if(!same(currentVersion,after)||rows.length!==after.count)throw Error('shared_volume_source_changed_during_read');
   const by=new Map();for(const row of rows){if(!by.has(row.symbol))by.set(row.symbol,[]);by.get(row.symbol).push(row);}
   const evidenceBySymbol={};for(const [symbol,history] of by)evidenceBySymbol[symbol]=calculate(history,dates,target);
   const snapshot={contract:CONTRACT,formula:FORMULA,scope:'completed_daily_volume_only',tradeDate:target,dates,sourceVersion:after,generation:hash({version:after,rows}),createdAt:new Date().toISOString(),rows,rowsHash:hash(rows),evidenceBySymbol,evidenceHash:hash(evidenceBySymbol),requestedCount:after.count,writtenCount:rows.length,readbackCount:rows.length,failedChecks:[],firstBlocker:null,status:'complete',complete:true,createsFormalCandidate:false,publishAllowed:false};
   const temporary=file+'.'+process.pid+'.tmp';fs.writeFileSync(temporary,JSON.stringify(snapshot));fs.renameSync(temporary,file);
   const persisted=read(file);if(!valid(persisted,{target,dates,version:after}))throw Error('shared_volume_file_readback_mismatch');
   return{snapshot:persisted,cacheHit:false,file,metadataReads:3};
  }finally{try{fs.unlinkSync(lock)}catch{}}
 }
 return{get};
}
module.exports={CONTRACT,FORMULA,create,valid,hash};
