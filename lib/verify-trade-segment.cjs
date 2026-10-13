'use strict';
const crypto=require('node:crypto');
function verify({proof,bytes,expected,asOf}){
 const bad=reason=>({ok:false,status:'DATA_GAP',reason});
 try{
 if(!proof||proof.contract!=='trade_segment_evidence_isolated_v1'||proof.status!=='SEALED'||proof.reason)return bad('UNSEALED_OR_GAP');
 for(const k of ['epoch','connection_id','symbol','trade_date','start_offset'])if(proof[k]!==expected[k])return bad('SEGMENT_IDENTITY');
 if(!Buffer.isBuffer(bytes)||!Number.isSafeInteger(proof.start_offset)||proof.start_offset<0||proof.end_offset-proof.start_offset!==bytes.length)return bad('OFFSET');
 const digest=crypto.createHash('sha256').update(bytes).digest('hex');if(digest!==proof.sha256)return bad('HASH');
 const start=Date.parse(proof.opened_at),end=Date.parse(proof.closed_at),now=Date.parse(asOf);if(![start,end,now].every(Number.isFinite)||start>end||end>now)return bad('TIME');
 const ack=proof.ack;if(!ack||ack.status!=='STORED'||['epoch','connection_id','symbol','start_offset','end_offset','rows','sha256'].some(k=>ack[k]!==proof[k]))return bad('ACK');
 const raw=bytes.toString('utf8');if(raw&&!raw.endsWith('\n'))return bad('PARTIAL_LINE');const lines=raw?raw.slice(0,-1).split('\n'):[];
 if(lines.length!==proof.rows)return bad('ROW_COUNT');let prior=null;
 for(const line of lines){const r=JSON.parse(line),t=Date.parse(r.event_at),seen=Date.parse(r.received_at),x=r.trade;
 if(r.contract!=='fugle_native_trade_journal_v1'||r.stock_id!==expected.symbol||r.trade_date!==expected.trade_date||r.source!=='Fugle.websocket.trades'||r.is_synthetic!==false||!Number.isFinite(t)||!Number.isFinite(seen)||seen<start||seen>end||t>seen||!Number.isSafeInteger(x?.serial)||!Number.isSafeInteger(x?.time)||Math.floor(x.time/1000)!==t||!Number.isFinite(x.price)||x.price<=0)return bad('ROW');
 if(prior&&(x.serial<=prior.serial||t<prior.t))return bad('ORDER');prior={serial:x.serial,t};
 }
 return {ok:true,status:'CAPTURED_SEGMENT_VERIFIED',provider_completeness:false};
 }catch{return bad('MALFORMED');}
}
module.exports={verify};
