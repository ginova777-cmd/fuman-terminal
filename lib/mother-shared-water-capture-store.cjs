'use strict';
// Coalesced latest-cache persistence. Frozen Writer evidence must copy and hash
// these exact bytes; this mutable file is NOT a historical evidence reference.
const fs=require('node:fs/promises'),path=require('node:path');
function createStore(file,{intervalMs=30000,maxBytes=5*1024*1024,now=Date.now}={}){
 let pending=null,running=null,lastQueued=-Infinity,lastError=null,writes=0;
 async function pump(){
  while(pending){const bytes=pending;pending=null;const tmp=file+'.'+process.pid+'.tmp';
   try{await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(tmp,bytes,{encoding:'utf8'});await fs.rename(tmp,file);lastError=null;writes++;}
   catch(e){lastError=e.code||'CAPTURE_WRITE_FAILED';}
  }
 }
 return {
  due(){return now()-lastQueued>=intervalMs;},
  publish(snapshot,{force=false}={}){
   if(!force&&now()-lastQueued<intervalMs)return false;
   const bytes=JSON.stringify({...snapshot,stored:true});
   if(Buffer.byteLength(bytes)>maxBytes){lastError='CAPTURE_FILE_LIMIT';return false;}
   pending=bytes;lastQueued=now();
   if(!running)running=pump().finally(()=>{running=null;});return true;
  },
  async drain(){if(running)await running;return this.health();},
  health(){return {pending:!!running,last_error:lastError,writes,immutable:false};}
 };
}
module.exports={createStore};
