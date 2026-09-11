"use strict";
const fs=require('fs'),path=require('path'),crypto=require('crypto'),{spawnSync}=require('child_process');
const {inspect}=require('./build-opening-strategy-inspection');
const {verify}=require('./verify-opening-universe-inspection');
const arg=(n,f)=>process.argv.find(x=>x.startsWith(`--${n}=`))?.slice(n.length+3)||f;
const read=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const write=(p,x)=>{const t=p+'.tmp';fs.writeFileSync(t,JSON.stringify(x));fs.renameSync(t,p);};
function main(){
 const symbols=arg('symbols','').split(',').filter(Boolean).sort();
 if(!symbols.length||symbols.some(s=>!/^\d{4,6}$/.test(s))||new Set(symbols).size!==symbols.length)throw Error('Terminal universe invalid');
 const date=arg('trade-date','').replace(/\D/g,'');if(date.length!==8)throw Error('Trade date required');
 const dash=`${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6)}`;
 const dir=arg('cache-dir',path.join(__dirname,'../data/opening-universe'));
 fs.mkdirSync(dir,{recursive:true});
 const formal=arg('source-cache',`C:/fuman-runtime/data/opening-limit-order/opening-limit-order-0850-static-sources-${date}.json`);
 const own=path.join(dir,`static-${date}.json`),output=path.join(dir,`inspection-${date}.json`);
 const stateDir='C:/fuman-runtime/state';
 const reportVersions=fs.existsSync(stateDir)?fs.readdirSync(stateDir).filter(n=>/^opening_report_0830\.industry_bias\..+\.json$/.test(n)).sort().map(n=>[n,fs.statSync(path.join(stateDir,n)).mtimeMs]):[];
 const slot=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Taipei',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date());
 const phase=slot<'08:45'?'pre0845':slot<'08:50'?'0845':slot<'08:55'?'0850':'post0855';
 const fingerprint=hash(JSON.stringify({symbols,date,phase,reportVersions,version:3,formal:fs.existsSync(formal)?hash(fs.readFileSync(formal)):null}));
 if(fs.existsSync(output)&&arg('force','false')!=='true'){
  const p=read(output);if(p.universe_fingerprint===fingerprint&&p.ok===true){
   const check=verify(p,fs.readFileSync(path.join(dir,`raw-${date}.json`)),symbols);
   if(!check.ok)throw Error(`Cached inspection verification failed: ${check.first_blocker}`);
   console.log(JSON.stringify({ok:true,cache_hit:true,path:output,count:symbols.length}));return;
  }
 }
 const lock=path.join(dir,'scan.lock');
 if(fs.existsSync(lock)&&Date.now()-fs.statSync(lock).mtimeMs>1800000)fs.unlinkSync(lock);
 const fd=fs.openSync(lock,'wx');fs.closeSync(fd);
 try{
  let base=fs.existsSync(formal)?read(formal):null;
  if(base&&base.trade_date!==dash)throw Error('Static source date mismatch');
  const map=new Map((base?.symbols||[]).map(x=>[x.symbol,x]));
  if(fs.existsSync(own)){const previous=read(own);if(previous.trade_date===dash)for(const row of previous.symbols||[])if(!row.error)map.set(row.symbol,row);}
  const missing=symbols.filter(s=>!map.get(s)?.signal_date||map.get(s)?.error);
  const runner=path.join(__dirname,'verify-opening-limit-order-candidate-readonly.js');
  const run=(args,log)=>{
   const fd=fs.openSync(path.join(dir,log),'w');
   try{const r=spawnSync(process.execPath,['--use-system-ca',runner,...args],{stdio:['ignore',fd,fd],windowsHide:true,timeout:900000});if(r.status!==0)throw Error(`Strategy scan failed; see ${path.join(dir,log)}`);}finally{fs.closeSync(fd);}
  };
  if(missing.length){
   console.error(`補入 ${missing.length} 檔日K／法人／分點資料；總標的 ${symbols.length} 檔`);
   const supplement=path.join(dir,`supplement-${date}.json`);
   run([`--trade-date=${dash}`,`--symbols=${missing.join(',')}`,'--warmup-static=true','--strategy-inspection-only=true',`--source-cache=${supplement}`],`warmup-${date}.log`);
   const fresh=read(supplement);base=base||fresh;for(const row of fresh.symbols||[])map.set(row.symbol,row);
  }
  if(!base)throw Error('No static evidence');
  const rows=symbols.map(s=>map.get(s));
  const cache={...base,symbols:rows,source_counts:{requested:rows.length,ready:rows.filter(x=>x.signal_date&&!x.error).length,failed:rows.filter(x=>x.error).length}};
  write(own,cache);
  const rawPath=path.join(dir,`raw-${date}.json`);
  run([`--trade-date=${dash}`,`--symbols=${symbols.join(',')}`,`--source-cache=${own}`,`--output=${rawPath}`],`detection-${date}.log`);
  const raw=read(rawPath),result=inspect(raw);
  result.universe_fingerprint=fingerprint;result.universe_scope='terminal3_terminal4_terminal5_institution_union';result.source_sha256=hash(fs.readFileSync(rawPath));result.static_coverage=cache.source_counts;
  write(output,result);
  const checked=verify(read(output),fs.readFileSync(rawPath),symbols);
  write(path.join(dir,`verifier-${date}.json`),checked);
  if(!checked.ok)throw Error(`Inspection verification failed: ${checked.first_blocker}`);
  console.log(JSON.stringify({ok:true,cache_hit:false,path:output,count:symbols.length,static_coverage:cache.source_counts}));
 }finally{fs.unlinkSync(lock);}
}
if(require.main===module)try{main();}catch(e){console.error(e.message);process.exitCode=1;}
