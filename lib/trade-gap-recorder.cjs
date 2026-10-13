'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
function create(binding){
 let pending=[],timer=null,writing=null,error=null,total=0;const files=[];
 function record(reason,data,received_at){
  if(!binding)return;
  total++;
  if(pending.length>=256){error='GAP_RECORDER_OVERFLOW';return;}
  pending.push({epoch:binding.epoch,connection_id:binding.connection_id,reason,symbol:data?.symbol||null,serial:data?.serial??null,received_at:received_at||new Date().toISOString()});
  if(!timer)timer=setTimeout(()=>{timer=null;void flush();},20);
 }
 async function flush(){
  if(timer){clearTimeout(timer);timer=null;}
  if(writing)await writing;
  if(!pending.length)return;
  if(files.length>=256){error='GAP_FILE_LIMIT';pending=[];return;}
  const rows=pending;pending=[];
  writing=(async()=>{try{await fs.mkdir(binding.root,{recursive:true});const name=crypto.randomUUID()+'-gaps.json';await fs.writeFile(path.join(binding.root,name),JSON.stringify({contract:'trade_gap_batch_v1',rows}),{flag:'wx'});files.push(name);}catch(e){error=e.code||e.message;}})();await writing;writing=null;
  if(pending.length)await flush();
 }
 return {record,flush,health:()=>({total,error,pending:pending.length,files:[...files]})};
}
module.exports={create};
