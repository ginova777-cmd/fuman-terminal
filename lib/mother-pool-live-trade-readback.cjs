'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
async function collect({runtime,status,releaseSha,tradeDate,symbols,asOf,maxBytes=67108864,maxFiles=4096,maxRows=100000}){
 let bytes=0,files=0,rowsCount=0;const tradesBySymbol=Object.fromEntries(symbols.map(s=>[s,[]]));
 async function read(file){const h=await fs.open(file,'r');try{const st=await h.stat();if(!st.isFile()||++files>maxFiles||bytes+st.size>maxBytes)throw Error('B22_EVIDENCE_BUDGET');bytes+=st.size;return await h.readFile();}finally{await h.close();}}
 try{
  const ref=status?.checkpoint;if(status?.contract!=='formal_live_trade_capture_v1'||status.status!=='OPEN'||status.error||!ref)throw Error('B22_FORMAL_CHECKPOINT_MISSING');
  if(status.current?.ok!==true||status.current.gap_evidence?.total||status.current.gap_evidence?.error||status.current.segment_evidence?.status!=='CAPTURED_ONLY')throw Error('B22_CURRENT_CAPTURE_GAP');
  if(!/^[a-f0-9-]{36}$/.test(ref.epoch)||!/^[a-f0-9-]{36}$/.test(ref.session_id)||! /^[a-f0-9]{64}$/.test(ref.sha256))throw Error('B22_CHECKPOINT_IDENTITY');
  const dir=path.resolve(runtime,'data/provider-trade-evidence',ref.epoch,ref.session_id),file=path.join(dir,'checkpoint-current.json');
  if(path.resolve(ref.file)!==file)throw Error('B22_CHECKPOINT_PATH');
  const raw=await read(file);if(hash(raw)!==ref.sha256)throw Error('B22_CHECKPOINT_HASH');const cp=JSON.parse(raw),end=Date.parse(cp.through_at),now=Date.parse(asOf),from=Date.parse(tradeDate+'T09:02:00+08:00');
  if(cp.contract!=='formal_live_trade_checkpoint_v1'||cp.release_sha!==releaseSha||ref.release_sha!==releaseSha||cp.epoch!==ref.epoch||cp.session_id!==ref.session_id||cp.connection_id!==status.connection_id||cp.connection_id!==ref.connection_id||cp.through_at!==ref.through_at)throw Error('B22_CHECKPOINT_IDENTITY');
  if(![end,now,from,Date.parse(cp.opened_at)].every(Number.isFinite)||end<from||end>now||now-end>120000||Date.parse(cp.opened_at)>from)throw Error('B22_REQUESTED_WINDOW_UNAVAILABLE');
  const health=cp.health;if(health?.ok!==true||health.queued_records!==0||health.gap_evidence?.total||health.gap_evidence?.error||health.segment_evidence?.status!=='CAPTURED_ONLY')throw Error('B22_CAPTURE_GAP');
  const limit=health.segment_evidence.last_batch;if(!Number.isSafeInteger(limit)||limit<1)throw Error('B22_NO_SEALED_BATCH');
  const names=await fs.readdir(dir);if(names.length>maxFiles)throw Error('B22_EVIDENCE_BUDGET');const batches=[];
  for(const name of names.filter(n=>n.endsWith('-sealed.json'))){const b=JSON.parse(await read(path.join(dir,name)));if(b.worker_batch_id<=limit)batches.push(b);}
  batches.sort((a,b)=>a.worker_batch_id-b.worker_batch_id);if(batches.length!==limit)throw Error('B22_BATCH_SEQUENCE');
  const heads={},last={};let stored=0;
  for(let i=0;i<batches.length;i++){
   const b=batches[i];if(b.worker_batch_id!==i+1||b.status!=='SEALED'||b.error||b.gaps?.length||b.epoch!==cp.epoch||b.connection_id!==cp.connection_id||!/^[a-f0-9-]{36}$/.test(b.batch_id))throw Error('B22_BATCH_GAP');
   const opened=JSON.parse(await read(path.join(dir,b.batch_id+'-open.json')));if(opened.batch_id!==b.batch_id||opened.worker_batch_id!==b.worker_batch_id||opened.epoch!==cp.epoch||opened.connection_id!==cp.connection_id||opened.inputs.length!==b.proofs.reduce((n,p)=>n+p.rows,0))throw Error('B22_BATCH_INPUT_MISMATCH');
   for(const p of b.proofs){
    if(!/^\d{4}$/.test(p.symbol)||p.trade_date!==tradeDate||p.contract!=='trade_segment_evidence_formal_v1')throw Error('B22_PROOF_IDENTITY');
    const {proof_hash,...body}=p;if(hash(Buffer.from(JSON.stringify(body)))!==proof_hash)throw Error('B22_PROOF_HASH');
    const key=p.trade_date+'/'+p.symbol,prior=heads[key];if(p.previous_proof_hash!==(prior?.proof_hash||null)||prior&&p.start_offset!==prior.end_offset)throw Error('B22_SEGMENT_CHAIN');
    const size=p.end_offset-p.start_offset;if(!Number.isSafeInteger(size)||size<0||bytes+size>maxBytes)throw Error('B22_EVIDENCE_BUDGET');bytes+=size;
    const h=await fs.open(path.join(runtime,'data/provider-trade-journal',tradeDate,p.symbol+'.jsonl'),'r'),data=Buffer.alloc(size);try{let offset=0;while(offset<size){const n=(await h.read(data,offset,size-offset,p.start_offset+offset)).bytesRead;if(!n)throw Error('B22_SHORT_READ');offset+=n;}}finally{await h.close();}
    if(Date.parse(p.opened_at)<Date.parse(cp.opened_at)||Date.parse(p.closed_at)>end)throw Error('B22_PROOF_WINDOW');
    const verified=require('./verify-trade-segment.cjs').verify({proof:p,bytes:data,expected:{epoch:cp.epoch,connection_id:cp.connection_id,symbol:p.symbol,trade_date:tradeDate,start_offset:p.start_offset,contract:'trade_segment_evidence_formal_v1'},asOf:cp.through_at});if(!verified.ok)throw Error('B22_SEGMENT_'+verified.reason);
    for(const line of data.toString('utf8').trim().split('\n').filter(Boolean)){if(++rowsCount>maxRows)throw Error('B22_ROW_BUDGET');const r=JSON.parse(line);if(last[key]&&r.trade.serial<=last[key])throw Error('B22_CROSS_SEGMENT_ORDER');last[key]=r.trade.serial;if(Object.hasOwn(tradesBySymbol,p.symbol)&&Date.parse(r.event_at)>=from)tradesBySymbol[p.symbol].push(r);}
    heads[key]={end_offset:p.end_offset,proof_hash};stored+=p.rows;
   }
  }
  if(stored!==health.stored_records||JSON.stringify(heads)!==JSON.stringify(health.segment_evidence.heads))throw Error('B22_CHECKPOINT_HEADS');
  return {tradesBySymbol,complete:true,checkpoint:ref,checkpoint_body:cp,window:{from:new Date(from).toISOString(),to:cp.through_at},scope:'local_received_trades_in_verified_active_connection',provider_completeness:false,resources:{bytes,files,rows:rowsCount}};
 }catch(e){return {complete:false,tradesBySymbol:{},reason:e.code||e.message,provider_completeness:false};}
}
module.exports={collect};
