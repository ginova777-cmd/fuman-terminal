'use strict';
const fs=require('fs'),path=require('path');
const FILE_LIMIT=4*1024*1024,DAY_LIMIT=64*1024*1024,ROUND_RESERVE=4*FILE_LIMIT;
// Called under the existing Writer round lock. Never removes evidence.
function check(runtime,date){
 try{
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('DATE');
  const root=path.join(runtime,'state/opening-report-writer-refreshes',date,'proofs');let bytes=0;
  if(fs.existsSync(root)){
   if(fs.lstatSync(root).isSymbolicLink())throw Error('LINK');
   for(const dir of fs.readdirSync(root,{withFileTypes:true})){
    if(!dir.isDirectory()||dir.isSymbolicLink()||!/^[a-f0-9]{64}$/.test(dir.name))throw Error('LAYOUT');
    for(const file of fs.readdirSync(path.join(root,dir.name),{withFileTypes:true})){
     if(!file.isFile()||file.isSymbolicLink())throw Error('LAYOUT');
     bytes+=fs.statSync(path.join(root,dir.name,file.name)).size;
    }
   }
  }
  return {ok:bytes+ROUND_RESERVE<=DAY_LIMIT,reason:bytes+ROUND_RESERVE<=DAY_LIMIT?null:'REFRESH_DAILY_EVIDENCE_CAPACITY',bytes,limit:DAY_LIMIT,reserve:ROUND_RESERVE};
 }catch{return {ok:false,reason:'REFRESH_EVIDENCE_CAPACITY_UNKNOWN'};}
}
module.exports={check,FILE_LIMIT,DAY_LIMIT,ROUND_RESERVE};
