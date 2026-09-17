'use strict';
const fs=require('node:fs');
const file=process.argv.find(x=>x.startsWith('--input='))?.slice(8);
const out=process.argv.find(x=>x.startsWith('--out='))?.slice(6);
if(!file||!out||fs.existsSync(out))throw Error('INPUT_AND_NEW_OUTPUT_REQUIRED');
const artifact=JSON.parse(fs.readFileSync(file,'utf8'));
const rows=artifact.result?.normalized?.rows||[];
const byTime=new Map(rows.map(r=>[Date.parse(r.timestamp),r]));
const minutes=[];
for(let m=9*60;m<=13*60+30;m++){
 const key=String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');
 const samples=rows.filter(r=>new Date(Date.parse(r.timestamp)+28800000).toISOString().slice(11,16)===key);
 const prices=samples.filter(r=>{
  const previous=byTime.get(Date.parse(r.timestamp)-60000);
  return previous&&previous.trade_date===r.trade_date;
 });
 minutes.push({minute:key,volume_samples:samples.length,price_return_samples:prices.length,
  volume_sample_ready:samples.length>=10,price_sample_ready:prices.length>=10});
}
const result={contract:'mother_pool_historical_minute_sample_audit_v1',symbol:artifact.symbol,trade_date:artifact.trade_date,
 source_artifact:file,rows:rows.length,unique_minutes:byTime.size,session_count:new Set(rows.map(r=>r.trade_date)).size,
 minutes,volume_insufficient:minutes.filter(m=>!m.volume_sample_ready).map(m=>m.minute),
 price_insufficient:minutes.filter(m=>!m.price_sample_ready).map(m=>m.minute),
 complete:false,limitation:'Sample counts only. No formal event, production deployment or Writer baseline admission is proven.'};
fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({rows:result.rows,session_count:result.session_count,volume_insufficient:result.volume_insufficient,price_insufficient:result.price_insufficient,complete:false,out}));
