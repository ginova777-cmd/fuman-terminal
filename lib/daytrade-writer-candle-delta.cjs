'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const delta=require('./daytrade-candle-delta');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
async function sync({file,rows,tradeDate,target,nowMs,write}) {
 let checkpoint=null;
 try { const saved=JSON.parse(fs.readFileSync(file,'utf8'));if(saved.sha256===hash(saved.checkpoint))checkpoint=saved.checkpoint; } catch {}
 const selected=delta.selectDelta(rows,checkpoint,{tradeDate,target,nowMs});
 if(selected.pending.length){
  await write(selected.pending);
  const next=delta.acknowledge(selected.checkpoint,selected.pending);
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const tmp=file+'.'+crypto.randomUUID()+'.tmp';
  try {fs.writeFileSync(tmp,JSON.stringify({checkpoint:next,sha256:hash(next)}),{flag:'wx'});fs.renameSync(tmp,file);}finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}
 }
 return {written:selected.pending.length,unchanged:selected.unchanged,not_due:selected.not_due};
}
module.exports={sync};
