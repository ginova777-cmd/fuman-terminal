'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const ttl=30*60*1000;
function load(file,scope,now=Date.now()){
 try{
  const e=JSON.parse(fs.readFileSync(file,'utf8'));
  const age=now-Date.parse(e.read_at);
  if(e.contract!=='daytrade_historical_read_cache_v1'||hash(e.scope)!==hash(scope)||!Number.isFinite(age)||age<0||age>ttl||!Array.isArray(e.rows)||!e.rows.length||hash(e.rows)!==e.rows_sha256)return null;
  return {rows:e.rows,readAt:e.read_at,cacheHit:true};
 }catch{return null;}
}
function save(file,scope,rows,readAt){
 if(!Array.isArray(rows)||!rows.length||!Number.isFinite(Date.parse(readAt)))return false;
 fs.mkdirSync(path.dirname(file),{recursive:true});
 const tmp=file+'.'+crypto.randomUUID()+'.tmp';
 const fd=fs.openSync(tmp,'wx');
 try{fs.writeFileSync(fd,JSON.stringify({contract:'daytrade_historical_read_cache_v1',scope,read_at:readAt,rows_sha256:hash(rows),rows}));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 try{fs.renameSync(tmp,file);}finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}
 return true;
}
module.exports={load,save};
