'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),{randomUUID,createHash}=require('node:crypto');
function scope(symbols){if(!Array.isArray(symbols)||!symbols.length||symbols.length>2000||new Set(symbols).size!==symbols.length||symbols.some(s=>typeof s!=='string'||!/^\d{4}$/.test(s)))throw Error('CAPTURE_SCOPE_INVALID');const sorted=[...symbols].sort();return {requested_symbols:sorted,requested_count:sorted.length,requested_symbols_sha256:createHash('sha256').update(JSON.stringify(sorted)).digest('hex')};}
async function request(file,{after,connectionId=null,symbols,deadline,now=Date.now}){
 const at=now(),threshold=Date.parse(after);
 if(!Number.isFinite(threshold)||threshold>at||(connectionId!==null&&(typeof connectionId!=='string'||!connectionId))||deadline<=at||deadline>at+20000)throw Error('CAPTURE_REQUEST_INVALID');
 const value={contract:'mother-shared-water-capture-request-v1',request_id:randomUUID(),connection_id:connectionId,after,requested_at:new Date(at).toISOString(),expires_at:new Date(deadline).toISOString(),...scope(symbols)};
 const tmp=file+'.'+process.pid+'.tmp';await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(tmp,JSON.stringify(value),'utf8');await fs.rename(tmp,file);return value.request_id;
}
function createResponder(file,{snapshot,publish,now=Date.now}){
 let active=false,lastHandled=null;
 return async function respond(){
  if(active)return {status:'BUSY'};active=true;
  try{
   let bytes;try{if((await fs.stat(file)).size>16384)return {status:'INVALID'};bytes=await fs.readFile(file);}catch(e){if(e.code==='ENOENT')return {status:'NO_REQUEST'};return {status:'READ_FAILED',code:e.code};}
   if(bytes.length>16384)return {status:'INVALID'};
   let r;try{r=JSON.parse(bytes.toString('utf8'));}catch{return {status:'INVALID'};}
   const time=now(),after=Date.parse(r.after),requested=Date.parse(r.requested_at),expires=Date.parse(r.expires_at);
   if(r.contract!=='mother-shared-water-capture-request-v1'||typeof r.request_id!=='string'||!/^[a-f0-9-]{36}$/.test(r.request_id)||![after,requested,expires].every(Number.isFinite)||after>requested||requested>time||expires<=time||expires>requested+20000)return {status:'INVALID_OR_EXPIRED'};
   if(r.request_id===lastHandled)return {status:'ALREADY_HANDLED'};
   if(time<=after)return {status:'WAITING_CLOCK'};
   let expected;try{expected=scope(r.requested_symbols);}catch{return {status:'INVALID_SCOPE'};}
   if(expected.requested_symbols_sha256!==r.requested_symbols_sha256||expected.requested_count!==r.requested_count)return {status:'INVALID_SCOPE'};
   const value=snapshot(new Date(time).toISOString(),{symbols:expected.requested_symbols});
   if((r.connection_id!==null&&value.connection_id!==r.connection_id)||value.closed||!value.authenticated)return {status:'CONNECTION_MISMATCH'};
   if(value.requested_symbols_sha256!==expected.requested_symbols_sha256||value.requested_count!==expected.requested_count)return {status:'CAPTURE_SCOPE_MISMATCH'};
   if(Date.parse(value.captured_at)!==time)return {status:'CAPTURE_TIME_INVALID'};
   const accepted=await publish({...value,request_id:r.request_id,request_after:r.after});
   if(accepted)lastHandled=r.request_id;
   return {status:accepted?'QUEUED':'NOT_QUEUED'};
  }finally{active=false;}
 };
}
module.exports={request,createResponder,scope};
