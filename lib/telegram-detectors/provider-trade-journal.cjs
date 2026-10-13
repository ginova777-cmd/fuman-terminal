'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
function createJournal(root,observer=null){const last=new Map();let error=null;return{
 capture(data,received_at=new Date().toISOString()){
  const reject=reason=>{try{observer?.rejected(reason,data,received_at);}catch{}return false;};
  if(data?.isTrial===true||!/^\d{4}$/.test(String(data?.symbol||''))||!['TSE','OTC'].includes(data?.market))return reject('TRADE_FILTER_REJECT');
  if(!Number.isSafeInteger(data.time)||data.time<1e15||!Number.isSafeInteger(data.serial)||!['size','volume','price'].every(k=>typeof data[k]==='number'&&Number.isFinite(data[k]))||data.size<0||data.volume<data.size||data.price<=0)return reject('TRADE_VALIDATION_REJECT');
  const event=data.time/1000,now=Date.parse(received_at);if(!Number.isFinite(now)||event>now)return reject('TRADE_TIME_REJECT');
  const local=new Date(event+28800000).toISOString(),date=local.slice(0,10),minute=local.slice(11,16);if(minute<'09:00'||minute>'13:30')return reject('TRADE_SESSION_REJECT');
  const trade={time:data.time,serial:data.serial,size:data.size,volume:data.volume,price:data.price};
  const identity=crypto.createHash('sha256').update(JSON.stringify({stock_id:data.symbol,trade_date:date,trade})).digest('hex');
  if(last.get(data.symbol)===identity)return reject('EXACT_DUPLICATE_FILTERED');
  const row={contract:'fugle_native_trade_journal_v1',stock_id:data.symbol,trade_date:date,received_at,event_at:new Date(event).toISOString(),source:'Fugle.websocket.trades',volume_unit:'LOTS',is_synthetic:false,trade,identity};
  const dir=path.join(root,date),file=path.join(dir,data.symbol+'.jsonl'),bytes=Buffer.from(JSON.stringify(row)+'\n');let proof;
  try{proof=observer?.prepare({row,file,bytes});}catch{} // Evidence must not block original append.
  try{fs.mkdirSync(dir,{recursive:true});fs.appendFileSync(file,bytes);last.set(data.symbol,identity);error=null;try{observer?.stored(proof);}catch{}return true;}catch(e){error=e.code||'TRADE_JOURNAL_WRITE_FAILED';try{observer?.failed(proof,error);}catch{}return false;}
 },health(){return {ok:!error,error};}
};}
module.exports={createJournal};
