'use strict';
// Isolated immutable object store. One atomic root binds inputs, results and dry outbox.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {measure}=require('./profile.cjs');
const bytes=x=>measure('serialize',()=>Buffer.from(JSON.stringify(x)));const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
class OfflineStore {
 constructor(directory,{maxObjectBytes=8*1024*1024,maxRootBytes=4*1024*1024}={}){
  this.directory=path.resolve(directory);if(/fuman-runtime|fuman-release-owner|prod81/i.test(this.directory))throw Error('FORMAL_PATH_FORBIDDEN');
  this.limits={maxObjectBytes,maxRootBytes};fs.mkdirSync(path.join(this.directory,'objects'),{recursive:true});this.rootFile=path.join(this.directory,'root.json');this.io={read:0,written:0};
 }
 put(value){const b=bytes(value);if(b.length>this.limits.maxObjectBytes)throw Error('OBJECT_LIMIT');const h=hash(b),file=path.join(this.directory,'objects',h+'.json');if(!fs.existsSync(file)){const fd=fs.openSync(file,'wx');try{measure('disk_write_fsync',()=>{fs.writeFileSync(fd,b);fs.fsyncSync(fd);});this.io.written+=b.length;}finally{fs.closeSync(fd);}}else this.get(h);return h;}
 verifiedBytes(h){if(!/^[a-f0-9]{64}$/.test(h))throw Error('OBJECT_ID');const file=path.join(this.directory,'objects',h+'.json');if(fs.statSync(file).size>this.limits.maxObjectBytes)throw Error('OBJECT_LIMIT');const b=measure('disk_read',()=>fs.readFileSync(file));this.io.read+=b.length;if(hash(b)!==h)throw Error('OBJECT_HASH');return b;}
 get(h){const b=this.verifiedBytes(h);return measure('parse',()=>JSON.parse(b));}
 putItem(item){if(!Array.isArray(item.data?.history))return this.put(item);const historyRef=this.put(item.data.history);return this.put({...item,data:{...item.data,history:undefined},historyRef});}
 getItem(h,withHistory=true){const item=this.get(h);if(withHistory&&item.historyRef)item.data.history=this.get(item.historyRef);return item;}
 root(){if(!fs.existsSync(this.rootFile))return null;if(fs.statSync(this.rootFile).size>this.limits.maxRootBytes)throw Error('ROOT_LIMIT');const b=fs.readFileSync(this.rootFile);this.io.read+=b.length;const e=measure('parse',()=>JSON.parse(b));if(hash(bytes(e.payload))!==e.sha256)throw Error('ROOT_HASH');return e.payload;}
 transaction(build,{fault}={}){
  const lock=path.join(this.directory,'owner.lock');const fd=fs.openSync(lock,'wx');
  try{fs.writeFileSync(fd,String(process.pid));const prior=this.root();const next=build(prior);const b=bytes({payload:next,sha256:hash(bytes(next))});if(b.length>this.limits.maxRootBytes)throw Error('ROOT_LIMIT');
   if(fault==='BEFORE_ROOT')throw Error('CRASH_BEFORE_ROOT');
   const tmp=this.rootFile+'.tmp';const w=fs.openSync(tmp,'w');try{fs.writeFileSync(w,b);fs.fsyncSync(w);this.io.written+=b.length;}finally{fs.closeSync(w);}
   if(fault==='BEFORE_RENAME')throw Error('CRASH_BEFORE_RENAME');fs.renameSync(tmp,this.rootFile);
   if(fault==='AFTER_RENAME')throw Error('CRASH_AFTER_RENAME');return next;
  }finally{fs.closeSync(fd);fs.unlinkSync(lock);}
 }
}
module.exports={OfflineStore,hash,bytes};
