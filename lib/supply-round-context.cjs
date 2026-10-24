'use strict';
const fs=require('node:fs'),path=require('node:path'),{AsyncLocalStorage}=require('node:async_hooks');
const quote=require('./quote-write-adapter.cjs'),store=new AsyncLocalStorage();
const eligible=f=>/^fugle-daytrade-ws-(quotes|candles)-v2\.json(?:\.bak)?$/.test(path.basename(f));
async function run(identity,work,report=()=>{}){
 if(store.getStore())throw Error('SUPPLY_ROUND_NESTED');
 const s={active:true,identity,cache:new Map(),stats:{source_requests:0,source_reads:0,parse_calls:0,parse_reused:0,refreshes:0},started:Date.now()};
 return store.run(s,()=>quote.run(identity,async counts=>{try{return await work();}finally{s.active=false;s.cache.clear();report({...s.stats,quote:counts(),elapsed_ms:Date.now()-s.started});}}));
}
function active(){return store.getStore()?.active===true;}
function refresh(){const s=store.getStore();if(s?.active){s.cache.clear();s.stats.refreshes++;}}
function text(file,load){
 const s=store.getStore();if(!s?.active||!eligible(file))return load();
 s.stats.source_requests++;
 const key=path.resolve(file),before=fs.statSync(file),sig=x=>[x.dev,x.ino,x.size,x.mtimeMs,x.ctimeMs].join(':');
 const old=s.cache.get(key);if(old?.signature===sig(before))return old.raw;
 const raw=load();s.stats.source_reads++;
 const after=fs.statSync(file);
 if(sig(before)===sig(after))s.cache.set(key,{signature:sig(after),raw});else s.cache.delete(key);
 return raw;
}
function parse(file,raw){
 const s=store.getStore(),entry=s?.active&&eligible(file)?s.cache.get(path.resolve(file)):null;
 if(entry?.raw===raw&&entry.parsed!==undefined){s.stats.parse_reused++;return entry.parsed;}
 const value=JSON.parse(raw);if(s?.active)s.stats.parse_calls++;
 if(entry?.raw===raw){
  // Shared payload is immutable; consumers retain their original filtering clocks.
  const freeze=x=>{if(x&&typeof x==='object'&&!Object.isFrozen(x)){Object.freeze(x);for(const v of Object.values(x))freeze(v);}return x;};
  entry.parsed=freeze(value);
 }
 return value;
}
async function write(options){
 const s=store.getStore();if(!s?.active)throw Error('SUPPLY_ROUND_REQUIRED');
 if(options.sink!==s.identity.sink)throw Error('SUPPLY_ROUND_SINK_MISMATCH');
 return quote.write({...options,tradeDate:s.identity.tradeDate});
}
function acknowledged(result){
 const n=result?.quotes_written;
 if(!Number.isInteger(n)||n<0)return 0;
 if(result?.quote_confirmation_scope!=='SAME_ROUND_HTTP_ACK')return n;
 const reused=result.quotes_reused,total=result.quotes_acknowledged;
 return Number.isInteger(reused)&&reused>=0&&Number.isInteger(total)&&total===n+reused?total:0;
}
module.exports={run,active,refresh,text,parse,write,acknowledged};
