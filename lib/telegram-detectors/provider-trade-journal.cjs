'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
function createJournal(root){const last=new Map();let error=null;return{
 capture(data,received_at=new Date().toISOString()){
  if(data?.isTrial===true||!/^\d{4}$/.test(String(data?.symbol||''))||!['TSE','OTC'].includes(data?.market))return false;
  if(!Number.isSafeInteger(data.time)||data.time<1e15||!Number.isSafeInteger(data.serial)||!['size','volume','price'].every(k=>typeof data[k]==='number'&&Number.isFinite(data[k]))||data.size<0||data.volume<data.size||data.price<=0)return false;
  const event=data.time/1000,now=Date.parse(received_at);if(!Number.isFinite(now)||event>now)return false;
  const local=new Date(event+28800000).toISOString(),date=local.slice(0,10),minute=local.slice(11,16);if(minute<'09:00'||minute>'13:30')return false;
  const trade={time:data.time,serial:data.serial,size:data.size,volume:data.volume,price:data.price};
  const identity=crypto.createHash('sha256').update(JSON.stringify({stock_id:data.symbol,trade_date:date,trade})).digest('hex');
  if(last.get(data.symbol)===identity)return false;
  const row={contract:'fugle_native_trade_journal_v1',stock_id:data.symbol,trade_date:date,received_at,event_at:new Date(event).toISOString(),source:'Fugle.websocket.trades',volume_unit:'LOTS',is_synthetic:false,trade,identity};
  try{const dir=path.join(root,date);fs.mkdirSync(dir,{recursive:true});fs.appendFileSync(path.join(dir,data.symbol+'.jsonl'),JSON.stringify(row)+'\n');last.set(data.symbol,identity);error=null;return true;}catch(e){error=e.code||'TRADE_JOURNAL_WRITE_FAILED';return false;}
 },health(){return {ok:!error,error};}
};}
module.exports={createJournal};
