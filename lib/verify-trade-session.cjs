'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const digest=x=>crypto.createHash('sha256').update(x).digest('hex');
async function read({evidenceRoot,journalRoot,epoch,asOf,maxFiles=4096,maxBytes=67108864,includeRows=false,maxRows=100000}){
 const captured=[];let rowCount=0;
 const gaps=[],heads={},sessions=[],proofs=[],lastTrades={};let files=0,bytes=0;
 async function json(file){const h=await fs.open(file,'r');try{const stat=await h.stat();if(++files>maxFiles||bytes+stat.size>maxBytes)throw Error('READ_BUDGET');bytes+=stat.size;return JSON.parse(await h.readFile('utf8'));}finally{await h.close();}}
 try{
 const dirs=(await fs.readdir(path.join(evidenceRoot,epoch),{withFileTypes:true})).filter(d=>d.isDirectory()).map(d=>d.name).sort();
 for(let i=0;i<dirs.length;i++){
  const dir=path.join(evidenceRoot,epoch,dirs[i]);const opened=await json(path.join(dir,'session-open.json'));
  if(opened.epoch!==epoch||opened.sequence!==i+1)throw Error('SESSION_IDENTITY');
  let closed;try{closed=await json(path.join(dir,'session-closed.json'));}catch(e){gaps.push({session:dirs[i],reason:'SESSION_UNCLOSED_OR_INVALID',detail:e.code||e.message});}
  if(!closed||closed.status!=='CLOSED'||closed.epoch!==epoch||closed.connection_id!==opened.connection_id||closed.health?.error||closed.health?.gap_evidence?.total||closed.health?.gap_evidence?.error)gaps.push({session:dirs[i],reason:'SESSION_GAP'});
  const names=await fs.readdir(dir);const opens=names.filter(n=>n.endsWith('-open.json')&&n!=='session-open.json');
  if(names.filter(n=>n.endsWith('-sealed.json')).some(n=>!opens.includes(n.replace('-sealed.json','-open.json'))))gaps.push({session:dirs[i],reason:'ORPHAN_SEAL'});
  if(!Number.isFinite(Date.parse(opened.opened_at))||closed&&(!Number.isFinite(Date.parse(closed.closed_at))||Date.parse(closed.closed_at)<Date.parse(opened.opened_at)||Date.parse(closed.closed_at)>Date.parse(asOf)))gaps.push({session:dirs[i],reason:'SESSION_TIME'});
  if(sessions.some(s=>s.connection_id===opened.connection_id))gaps.push({session:dirs[i],reason:'DUPLICATE_CONNECTION_ID'});
  if(sessions.length&&Date.parse(opened.opened_at)<Date.parse(sessions.at(-1).closed_at))gaps.push({session:dirs[i],reason:'SESSION_OVERLAP'});
  if(names.some(n=>n.endsWith('-gaps.json')))gaps.push({session:dirs[i],reason:'PERSISTED_GAPS'});
  const batches=[];
  for(const name of opens){const o=await json(path.join(dir,name));let c;
   try{c=await json(path.join(dir,name.replace('-open.json','-sealed.json')));}catch{gaps.push({session:dirs[i],reason:'UNSEALED_BATCH',batch:o.batch_id});continue;}
   if(c.epoch!==epoch||c.connection_id!==opened.connection_id||o.epoch!==epoch||o.connection_id!==c.connection_id||c.batch_id!==o.batch_id||c.worker_batch_id!==o.worker_batch_id||c.status!=='SEALED'||c.gaps.length||c.error)gaps.push({session:dirs[i],reason:'BATCH_GAP',batch:o.batch_id});
   if(c.proofs.reduce((sum,p)=>sum+p.rows,0)!==o.inputs.length)gaps.push({session:dirs[i],reason:'BATCH_COUNT'});
   batches.push(c);
  }
  batches.sort((a,b)=>a.worker_batch_id-b.worker_batch_id);
  for(let b=0;b<batches.length;b++){
   if(batches[b].worker_batch_id!==b+1)gaps.push({session:dirs[i],reason:'BATCH_SEQUENCE_GAP'});
   for(const p of batches[b].proofs){
    if(!/^\d{4}$/.test(p.symbol)||!/^\d{4}-\d{2}-\d{2}$/.test(p.trade_date)||p.epoch!==epoch||p.connection_id!==opened.connection_id)throw Error('PROOF_IDENTITY');
    if(Date.parse(p.opened_at)<Date.parse(opened.opened_at)||Date.parse(p.closed_at)>Date.parse(closed?.closed_at))throw Error('PROOF_OUTSIDE_SESSION');
    const {proof_hash,...body}=p;if(digest(Buffer.from(JSON.stringify(body)))!==proof_hash)throw Error('PROOF_HASH');
    const key=p.trade_date+'/'+p.symbol,previous=heads[key];
    if(p.previous_proof_hash!==(previous?.proof_hash||null)||p.start_offset!==(previous?.end_offset||0))gaps.push({symbol:p.symbol,reason:'CROSS_SEGMENT_CHAIN'});
    const size=p.end_offset-p.start_offset;if(!Number.isSafeInteger(size)||size<0||bytes+size>maxBytes)throw Error('READ_BUDGET');bytes+=size;
    const h=await fs.open(path.join(journalRoot,p.trade_date,p.symbol+'.jsonl'),'r');const data=Buffer.alloc(size);
    try{if((await h.read(data,0,size,p.start_offset)).bytesRead!==size)throw Error('SHORT_JOURNAL');}finally{await h.close();}
    const verified=require('./verify-trade-segment.cjs').verify({proof:p,bytes:data,expected:{epoch,connection_id:opened.connection_id,symbol:p.symbol,trade_date:p.trade_date,start_offset:p.start_offset},asOf});
    if(!verified.ok)gaps.push({symbol:p.symbol,reason:verified.reason});
    const rows=data.toString('utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
    rowCount+=rows.length;if(rowCount>maxRows)throw Error('ROW_BUDGET');
    if(includeRows&&verified.ok){let offset=p.start_offset;const lines=data.toString('utf8').split('\n');for(const line of lines){if(!line)continue;const end=offset+Buffer.byteLength(line+'\n');captured.push({row:JSON.parse(line),start_offset:offset,end_offset:end,line_sha256:digest(Buffer.from(line+'\n')),segment_sha256:p.sha256,proof_hash,connection_id:p.connection_id});offset=end;}}
    if(rows.length){const first=rows[0],last=rows.at(-1),prior=lastTrades[key];if(prior&&(first.trade.serial<=prior.serial||Date.parse(first.event_at)<prior.time))gaps.push({symbol:p.symbol,reason:'CROSS_SEGMENT_TRADE_ORDER'});lastTrades[key]={serial:last.trade.serial,time:Date.parse(last.event_at)};}
    heads[key]={end_offset:p.end_offset,proof_hash};proofs.push({symbol:p.symbol,trade_date:p.trade_date,connection_id:p.connection_id,rows:p.rows,proof_hash});
   }
  }
  if(closed&&batches.reduce((n,b)=>n+b.proofs.reduce((a,p)=>a+p.rows,0),0)!==closed.health?.stored_records)gaps.push({session:dirs[i],reason:'STORED_COUNT'});
  if(closed&&JSON.stringify(closed.health?.segment_evidence?.heads)!==JSON.stringify(heads))gaps.push({session:dirs[i],reason:'FINAL_HEADS'});
  sessions.push({sequence:opened.sequence,connection_id:opened.connection_id,closed:!!closed,opened_at:opened.opened_at,closed_at:closed?.closed_at});
 }
 if(!sessions.length)gaps.push({reason:'NO_SESSIONS'});
 }catch(e){gaps.push({reason:e.code||e.message});}
 return {status:gaps.length?'DATA_GAP':'CAPTURED_INTERVAL_VERIFIED',continuity_verified:gaps.length===0,scope:'local captured closed intervals only; reconnect intervals excluded',provider_completeness:false,gaps,sessions,proofs,resources:{files,bytes},...(includeRows?{captured:gaps.length?[]:captured}:{})};
}
module.exports={read};
