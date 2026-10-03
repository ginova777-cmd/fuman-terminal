'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),net=require('node:net');
const {refreshQualificationStep:step,CONTRACT}=require('./shared-stock-qualification-cache.cjs');
const {mapFugleStockQualification:map}=require('./fugle-stock-qualification.cjs');
function read(file,max){const stat=fs.statSync(file);if(stat.size>max)throw Error('CACHE_SIZE_BOUND');return JSON.parse(fs.readFileSync(file,'utf8'));}
function atomic(file,value){
 const tmp=file+'.'+crypto.randomUUID()+'.tmp';let fd;
 try{fd=fs.openSync(tmp,'wx');fs.writeFileSync(fd,JSON.stringify(value));fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.renameSync(tmp,file);}
 finally{if(fd!==undefined)fs.closeSync(fd);if(fs.existsSync(tmp))fs.unlinkSync(tmp);}
}
async function openQualificationStore(directory){
 if(process.platform!=='win32')throw Error('QUALIFICATION_OWNER_REQUIRES_WINDOWS');
 fs.mkdirSync(path.resolve(directory),{recursive:true});
 const root=fs.realpathSync.native(path.resolve(directory));
 const lock=path.join(root,'owner.lock'),token=crypto.randomUUID();
 const id=crypto.createHash('sha256').update(root.toLowerCase()).digest('hex');
 const owner=net.createServer(socket=>socket.destroy());
 await new Promise((resolve,reject)=>{
  owner.once('error',error=>reject(new Error(error.code==='EADDRINUSE'?'QUALIFICATION_OWNER_BUSY':'QUALIFICATION_OWNER_'+error.code)));
  owner.listen({path:'\\\\.\\pipe\\fuman-qualification-'+id},resolve);
 });
 owner.removeAllListeners('error');owner.unref();
 let closed=false,busy=false,poisoned=false;
 owner.on('error',()=>{poisoned=true;});
 const release=async()=>{if(closed)return;closed=true;try{
   if(fs.existsSync(lock)){if(read(lock,4096).token!==token)throw Error('QUALIFICATION_OWNER_CHANGED');fs.unlinkSync(lock);}
  }finally{await new Promise(resolve=>owner.close(resolve));}};
 try{
  // The OS pipe is authoritative. A diagnostic file left by a dead process
  // cannot block recovery; it is replaced only after exclusive acquisition.
  atomic(lock,{pid:process.pid,token,created_at:new Date().toISOString(),authority:'windows_named_pipe'});
  const control=path.join(root,'control.json');
  let state=fs.existsSync(control)?read(control,16384):{contract:CONTRACT,failures:0};
  if(state.contract!==CONTRACT)throw Error('CACHE_CONTRACT_MISMATCH');
  state.records={};
  const files=fs.readdirSync(root).filter(name=>/^\d{4}\.json$/.test(name));
  if(files.length>3000)throw Error('CACHE_RECORD_BOUND');
  for(const file of files)state.records[file.slice(0,4)]=read(path.join(root,file),65536);
  return {close:async()=>{if(busy)throw Error('QUALIFICATION_REQUEST_ACTIVE');await release();},
   async refresh(options){
    if(closed||poisoned)throw Error('QUALIFICATION_STORE_UNAVAILABLE');
    if(busy)return {status:'IN_PROCESS_BUSY',request_count:0};
    busy=true;
    const clock=options.clock||Date.now;
    try{
     const result=await step({...options,state,fetchTicker:async symbol=>{
      // Persist a conservative reservation before network I/O. A crash cannot
      // silently erase pacing. Only the small control file is rewritten here.
      const {records,...metadata}=state;
      atomic(control,{...metadata,next_request_at:new Date(clock()+60000).toISOString(),inflight_symbol:symbol});
      return options.fetchTicker(symbol);
     }});
     if(result.request_count){
      if(result.state.records[result.symbol])atomic(path.join(root,result.symbol+'.json'),result.state.records[result.symbol]);
      const {records,...metadata}=result.state;
      delete metadata.inflight_symbol;
      atomic(control,metadata);
      state=result.state;
     }
     return result;
    }catch(error){poisoned=true;throw error;}finally{busy=false;}
   }};
 }catch(error){try{await release();}catch{}throw error;}
}
function readVerifiedQualification(directory,symbol,tradeDate,nowMs=Date.now()){
 if(!/^\d{4}$/.test(symbol||''))return {ok:false,reason:'INVALID_SYMBOL',evidence:null};
 try{
  const record=read(path.join(path.resolve(directory),symbol+'.json'),65536);
  const old=record.evidence;
  if(!old)return {ok:false,reason:'QUALIFICATION_NOT_AVAILABLE',evidence:null};
  const evidence=map({body:old.raw,expectedSymbol:symbol,tradeDate,receivedAt:old.received_at,nowMs});
  if(!evidence.identity_valid)return {ok:false,reason:'QUALIFICATION_IDENTITY_MISMATCH',evidence:null};
  if(evidence.raw_json_sha256!==old.raw_json_sha256)return {ok:false,reason:'QUALIFICATION_HASH_MISMATCH',evidence:null};
  // Recompute every field from raw evidence; never trust stored derived flags.
  return {ok:true,reason:null,evidence};
 }catch(error){return {ok:false,reason:error.code==='ENOENT'?'QUALIFICATION_NOT_AVAILABLE':'QUALIFICATION_CACHE_INVALID',evidence:null};}
}
module.exports={openQualificationStore,readVerifiedQualification};
