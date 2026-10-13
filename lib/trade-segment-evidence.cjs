'use strict';
const crypto=require('node:crypto');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
// Isolated prospective evidence builder. Never reconstruct missing intent from cache.
function create({epoch,connection_id,symbol,trade_date,start_offset,opened_at,maxRecords=256,maxBytes=1048576}){
 if(!epoch||!connection_id||!/^\d{4}$/.test(symbol)||!/^\d{4}-\d{2}-\d{2}$/.test(trade_date)||!Number.isSafeInteger(start_offset)||start_offset<0||!Number.isFinite(Date.parse(opened_at))||!Number.isSafeInteger(maxRecords)||maxRecords<1||!Number.isSafeInteger(maxBytes)||maxBytes<1)throw Error('SEGMENT_IDENTITY');
 const id={epoch,connection_id,symbol,trade_date,start_offset,opened_at};let parts=[],size=0,count=0,ack=null,reason=null,sealed=false;
 function gap(code){reason=reason||code;return false;}
 return {
  gap,
  capture(row){try{
   if(sealed||reason)return false;
   if(row.contract!=='fugle_native_trade_journal_v1'||row.stock_id!==symbol||row.trade_date!==trade_date||row.source!=='Fugle.websocket.trades'||row.is_synthetic!==false||!Number.isFinite(Date.parse(row.received_at))||Date.parse(row.received_at)<Date.parse(opened_at))return gap('ROW_IDENTITY');
   const bytes=Buffer.from(JSON.stringify(row)+'\n');if(count>=maxRecords||size+bytes.length>maxBytes)return gap('EVIDENCE_LIMIT');
   parts.push(bytes);size+=bytes.length;count++;return true;
  }catch{return gap('CAPTURE_FAILED');}},
  acknowledge(receipt){try{
   if(sealed||reason)return false;
   if(!receipt||receipt.epoch!==epoch||receipt.connection_id!==connection_id||receipt.symbol!==symbol||receipt.start_offset!==start_offset||receipt.end_offset!==start_offset+size||receipt.rows!==count||receipt.sha256!==hash(Buffer.concat(parts))||receipt.status!=='STORED')return gap('ACK_MISMATCH');
   ack=structuredClone(receipt);return true;
  }catch{return gap('ACK_INVALID');}},
  async seal({closed_at,persist}){
   if(sealed)throw Error('SEGMENT_ALREADY_SEALED');sealed=true;
   if(!Number.isFinite(Date.parse(closed_at))||Date.parse(closed_at)<Date.parse(opened_at))gap('CLOSE_TIME');
   if(!ack||ack.rows!==count||ack.end_offset!==start_offset+size||ack.sha256!==hash(Buffer.concat(parts)))gap('UNACKNOWLEDGED_BYTES');
   const proof={contract:'trade_segment_evidence_isolated_v1',...id,closed_at,end_offset:start_offset+size,rows:count,sha256:hash(Buffer.concat(parts)),status:reason?'GAP':'SEALED',reason,ack};
   parts=[];
   try{await persist(structuredClone(proof));return {...proof,persisted:true};}catch{return {...proof,status:'GAP',reason:'SIDECAR_PERSIST_FAILED',persisted:false};}
  }
 };
}
module.exports={create};
