"use strict";
// Read completed terminal publications only. Never invokes a scanner or market-data API.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const keys = ['strategy3','strategy4','strategy5','institution'];
const arg = (name, fallback) => process.argv.find(x=>x.startsWith(`--${name}=`))?.slice(name.length+3) || fallback;
const dateKey = x => String(x||'').replace(/\D/g,'').slice(0,8);
const read = file => JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const rowsOf = p => Array.isArray(p.rows) ? p.rows : Array.isArray(p.matches) ? p.matches : [];
function validateSource(key, p, expectedDate) {
 if (!p || p.ok!==true || p.complete!==true || p.publishAllowed!==true || p.fallbackUsed===true) throw Error(`${key}: incomplete terminal publication`);
 const date = dateKey(p.tradeDate||p.trade_date||p.scanDate||p.date||p.usedDate);
 if(date!==expectedDate) throw Error(`${key}: trade date mismatch ${date}/${expectedDate}`);
 if(!(p.runId||p.run_id)) throw Error(`${key}: missing run ID`);
 for(const row of rowsOf(p)) {
  const id = row.run_id||row.runId;
  if(id && id!==(p.runId||p.run_id)) throw Error(`${key}: row run ID mismatch`);
 }
}
function extract(snapshot, receipt) {
 if(receipt.ok!==true||receipt.partial===true||receipt.write?.ok!==true)throw Error('Full-scan snapshot receipt incomplete');
 const expectedDate=dateKey(receipt.write.tradeDate);
 if(!expectedDate||dateKey(snapshot?.tradeDate)!==expectedDate)throw Error('Snapshot trade date mismatch');
 if(snapshot.payload?.partial===true)throw Error('Snapshot partial');
 const sources={};
 for(const key of keys) {
  const entry=Object.entries(snapshot.payload?.endpoints||{}).find(([endpoint])=>endpoint.split('?')[0]===`/api/${key}-latest`);
  if(!entry)throw Error(`${key}: missing completed snapshot`);
  const [endpoint,p]=entry;
  validateSource(key,p,expectedDate);
  const metadata=receipt.summary?.[endpoint];
  if(!metadata||metadata.ok!==true||metadata.runId!==(p.runId||p.run_id))throw Error(`${key}: receipt run ID mismatch`);
  const limit=Number(new URL(endpoint,'https://local').searchParams.get('limit'));
  const rows=rowsOf(p);
  // Strategy5 intentionally removes retired signals; use the original snapshot's full input bound.
  if(key!=='institution' && (!limit || Number(p.count)>limit))throw Error(`${key}: snapshot result truncated; full export required`);
  sources[key]={...p,rows,run_id:p.runId||p.run_id,tradeDate:expectedDate};
 }
 return sources;
}
function validateCache(cached, receipt) {
 if(cached.contract!=='opening_complete_scan_readback_v1')throw Error('Cache contract mismatch');
 for(const key of keys){
  const p=cached.sources?.[key];validateSource(key,p,dateKey(receipt.write?.tradeDate));
  const entry=Object.entries(receipt.summary||{}).find(([endpoint])=>endpoint.split('?')[0]===`/api/${key}-latest`);
  if(!entry||entry[1].ok!==true||entry[1].runId!==p.run_id)throw Error(`${key}: cached receipt run ID mismatch`);
  if(key==='institution'&&rowsOf(p).length!==Number(p.count))throw Error('Institution cache truncated');
 }
}
async function loadInstitution(p, expectedDate) {
 if(rowsOf(p).length===Number(p.count))return p;
 const {terminalSupabaseKey,terminalSupabaseUrl}=require('../lib/server-supabase-key');
 const runtimeDir=process.env.FUMAN_RUNTIME_DIR||'C:/fuman-runtime';
 const url=terminalSupabaseUrl({runtimeDir}), key=terminalSupabaseKey({runtimeDir});
 if(!url||!key)throw Error('Completed institution result read credentials missing');
 const rows=[];
 for(let offset=0;offset<Number(p.count);offset+=1000){
  const q=new URLSearchParams({select:'*',run_id:`eq.${p.run_id}`,order:'rank.asc,code.asc',limit:'1000',offset:String(offset)});
  const response=await fetch(`${url}/rest/v1/institution_scan_results?${q}`,{headers:{apikey:key,Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw Error(`institution complete result read HTTP ${response.status}`);
  const page=await response.json();
  if(!Array.isArray(page))throw Error('Institution result format invalid');
  rows.push(...page);
 }
 if(rows.length!==Number(p.count))throw Error(`institution count mismatch ${rows.length}/${p.count}`);
 for(const row of rows){
  if(row.run_id!==p.run_id||dateKey(row.scan_date)!==expectedDate||row.complete!==true)throw Error('Institution row date/run/completion mismatch');
 }
 const normalized=rows.map(r=>{const v=r.payload||{};return {...v,code:String(v.code||r.code),name:v.name||r.name,totalNet:v.total??r.total_net,foreignNet:v.foreign??r.foreign_net,trustNet:v.trust??r.trust_net,dealerNet:v.dealer??r.dealer_net};});
 return {...p,rows:normalized,data:undefined,returnedCount:normalized.length};
}
async function main(){
 const receiptPath=arg('receipt','C:/fuman-runtime/data/scan-receipts/desktop-route-snapshot.json');
 const cacheDir=arg('cache-dir',path.join(__dirname,'../data/opening-ranking-complete-scan'));
 const bytes=fs.readFileSync(receiptPath), receipt=JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));
 const age=Date.now()-Date.parse(receipt.updatedAt);
 if(!Number.isFinite(age)||age< -300000||age>7*86400000)throw Error('Full-scan receipt timestamp missing or stale');
 if(receipt.ok!==true||receipt.partial===true||receipt.write?.ok!==true)throw Error('Full-scan receipt not complete');
 const fingerprint=crypto.createHash('sha256').update(bytes).digest('hex');
 fs.mkdirSync(cacheDir,{recursive:true});
 const output=path.join(cacheDir,'sources.json'), failurePath=path.join(cacheDir,'failure.json'), lock=path.join(cacheDir,'sync.lock');
 if(fs.existsSync(output)){
  const cached=read(output);
  if(cached.receipt_sha256===fingerprint && cached.ok===true){
   validateCache(cached,receipt);
   console.log(JSON.stringify({ok:true,cache_hit:true,path:output,network_reads:0}));return;
  }
 }
 if(fs.existsSync(failurePath)){
  const failure=read(failurePath);
  if(failure.fingerprint===fingerprint && Date.now()-failure.at<300000)throw Error(`Sync retry deferred: ${failure.reason}`);
 }
 if(fs.existsSync(lock)&&Date.now()-fs.statSync(lock).mtimeMs>600000)fs.unlinkSync(lock);
 const fd=fs.openSync(lock,'wx');fs.closeSync(fd);
 try{
  const {readSnapshot}=require('../lib/supabase-snapshots');
  const snapshot=await readSnapshot('desktop_route_snapshot',{timeoutMs:30000});
  const sources=extract(snapshot,receipt);
  sources.institution=await loadInstitution(sources.institution,dateKey(receipt.write.tradeDate));
  if(crypto.createHash('sha256').update(fs.readFileSync(receiptPath)).digest('hex')!==fingerprint)throw Error('Full-scan receipt changed during readback');
  const result={ok:true,contract:'opening_complete_scan_readback_v1',receipt_sha256:fingerprint,source_updated_at:snapshot.updatedAt,synced_at:new Date().toISOString(),sources};
  const temp=output+`.${process.pid}.tmp`;fs.writeFileSync(temp,JSON.stringify(result));fs.renameSync(temp,output);
  console.log(JSON.stringify({ok:true,cache_hit:false,path:output,counts:Object.fromEntries(keys.map(k=>[k,rowsOf(sources[k]).length]))}));
 }catch(e){fs.writeFileSync(failurePath,JSON.stringify({fingerprint,at:Date.now(),reason:e.message}));throw e;}
 finally{fs.unlinkSync(lock);}
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={extract,validateSource,validateCache};
