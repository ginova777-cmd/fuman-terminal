'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const E=require('../../lib/mother-change-evidence.cjs'),{verifyHandoff,local,read,sha}=require('./producer-handoff.cjs');
const valid=x=>{const c={...x};delete c.hash;return sha(c)===x.hash;};
class LiveTail {
 constructor({directory,handoff,stop=()=>false,limits={}}){
  this.directory=local(directory);this.identity=verifyHandoff(handoff);this.stop=stop;
  this.limits={maxFiles:800,maxBytes:64*1048576,maxEvents:20000,maxParents:1,...limits};
  for(const [k,max]of Object.entries({maxFiles:800,maxBytes:64*1048576,maxEvents:20000,maxParents:16}))if(!Number.isSafeInteger(this.limits[k])||this.limits[k]<1||this.limits[k]>max)throw Error('TAIL_LIMIT');
  fs.mkdirSync(this.directory,{recursive:true});this.file=path.join(this.directory,'cursor.json');
 }
 cursor(){if(!fs.existsSync(this.file))return {...this.identity.cursor,epoch:this.identity.epoch,trade_date:this.identity.trade_date,kind:this.identity.kind,binding:this.identity.binding};const e=JSON.parse(read(this.file,16*1048576));if(sha(e.payload)!==e.hash||e.payload.binding!==this.identity.binding)throw Error('CURSOR_HASH_OR_IDENTITY');return e.payload;}
 poll(catalogue){
  if(this.stop())return {status:'STOPPED'};
  const before=this.cursor(),next=structuredClone(before),proofs=[],events=[];let bytes=0,files=0,parents=0;
  const cat=JSON.parse(read(catalogue,1048576));if(!valid(cat)||cat.contract!=='tail-segment-catalogue-v1'||cat.continuity!=='CONTIGUOUS_FROM_HANDOFF'||cat.gap===true||cat.binding!==this.identity.binding||cat.epoch!==this.identity.epoch||!Array.isArray(cat.segments)||cat.segments.length>256||!Number.isSafeInteger(cat.published_through)||cat.published_through<before.sequence)throw Error('CATALOGUE_IDENTITY_OR_REGRESSION');
  const anchor=cat.anchor||{sequence:this.identity.cursor.sequence,commit_hash:this.identity.cursor.commit_hash};if(!Number.isSafeInteger(anchor.sequence)||anchor.sequence<this.identity.cursor.sequence||anchor.sequence>before.sequence||anchor.sequence===before.sequence&&anchor.commit_hash!==before.commit_hash)throw Error('CATALOGUE_ANCHOR_GAP');
  let end=anchor.sequence;for(const s of cat.segments){if(s.first!==end+1||!Number.isSafeInteger(s.last)||s.last<s.first||!s.id||!s.dir||path.dirname(local(s.dir))!==this.identity.feed_root)throw Error('SEGMENT_RANGE_OR_PATH');end=s.last;}if(end!==cat.published_through)throw Error('CATALOGUE_RANGE_GAP');
  const get=(seq,suffix)=>{if(this.stop())throw Error('TAIL_STOP');const seg=cat.segments.find(s=>seq>=s.first&&seq<=s.last);if(!seg)throw Error('SEQUENCE_GAP');const name=typeof suffix==='function'?suffix(seq):String(seq).padStart(12,'0')+'.'+suffix+'.json',file=path.join(local(seg.dir),name);
   if(!fs.existsSync(file))throw Error('COMMITTED_FILE_GAP');if(++files>this.limits.maxFiles)throw Error('BACKPRESSURE_FILES');if(fs.statSync(file).size>this.limits.maxBytes-bytes)throw Error('BACKPRESSURE_BYTES');const b=read(file,8*1048576);bytes+=b.length;if(bytes>this.limits.maxBytes)throw Error('BACKPRESSURE_BYTES');proofs.push({file,sha256:sha(b),bytes:b.length});return JSON.parse(b);};
  try{while(next.sequence<cat.published_through&&parents<this.limits.maxParents){
   if(this.identity.kind==='quote'){
    const seq=next.sequence+1,b=get(seq,'prepare'),s=get(seq,'saved'),c=get(seq,'commit');E.validateBatch(b);E.validateSaved(b,s);
    if(local(s.cache_file)!==this.identity.cache_path||b.collector_epoch!==this.identity.epoch||b.producer_version!==this.identity.evidence_version||b.sequence!==seq||c.sequence!==seq||c.batch_hash!==b.batch_hash||c.saved_hash!==sha(s)||c.batch_id!==b.batch_id||c.collector_epoch!==b.collector_epoch||c.status!=='DURABLE_COMMITTED')throw Error('QUOTE_COMMIT_BINDING');
    for(const e of b.events){if(e.trade_date!==this.identity.trade_date||E.keyOf(e.payload,'quote').key!==e.key)throw Error('EVENT_IDENTITY');const old=next.revisions[e.key];if(e.revision!==(old?.revision||0)+1||(old&&old.hash!==e.previous_hash))throw Error('REVISION_GAP');next.revisions[e.key]={revision:e.revision,hash:e.content_hash};events.push(e);}
    next.sequence=seq;next.commit_hash=sha(c);parents++;
   }else{
    let p=null;do{const seq=next.sequence+1;if(seq>cat.published_through)return {status:'WAIT_PARENT_COMPLETE',files,bytes,cursor:before};
     const b=get(seq,'prepare'),s=get(seq,'saved'),c=get(seq,'commit'),m=b.intent;
     if(!valid(b)||!valid(c)||b.contract!=='mother-change-evidence-v3-c2-capacity'||b.epoch!==this.identity.epoch||b.sequence!==seq||c.sequence!==seq||c.prepare_hash!==b.hash||s.prepare_hash!==b.hash||c.saved_hash!==sha(s)||b.previous_commit_hash!==next.commit_hash||c.previous_commit_hash!==next.commit_hash||c.status!=='DURABLE_COMMITTED')throw Error('SUB_COMMIT_INVALID');
     if(local(m.proof.cache_file)!==this.identity.cache_path||sha(s.proof)!==sha(m.proof)||s.parent_id!==b.parent_id||c.parent_id!==b.parent_id||m.parent_id!==b.parent_id||m.epoch!==b.epoch||!m.proof.original_ack||!m.proof.ok||m.proof.collector_epoch!==b.epoch||BigInt(m.frozen_ns)>BigInt(m.proof.cache_started_ns)||BigInt(m.proof.cache_started_ns)>BigInt(m.proof.cache_finished_ns))throw Error('ACK_IDENTITY');
     if(!p){const manifest=get(seq,n=>'parent-'+n+'.json');if(manifest.parent_id!==b.parent_id||manifest.root_hash!==m.root_hash||manifest.sub_count!==m.sub_count||manifest.total_entries!==m.total_entries||sha(manifest.proof)!==sha(m.proof)||manifest.frozen_ns!==m.frozen_ns)throw Error('PARENT_MANIFEST');p={id:m.parent_id,sub:0,count:0,changed:0,last:null,root:crypto.createHash('sha256'),final:new Map(),chain:new Map(),sub_count:m.sub_count,total:m.total_entries,root_hash:m.root_hash};if(p.total>20000||p.sub_count>20000||p.sub_count<1)throw Error('PARENT_LIMIT');}
     if(p.id!==m.parent_id||p.sub!==m.sub_index||b.sub_index!==m.sub_index||b.previous_parent_sub_hash!==p.last||m.sub_count!==p.sub_count||m.total_entries!==p.total||m.root_hash!==p.root_hash)throw Error('PARENT_SUB_GAP');let ei=0;
     for(const entry of m.entries){const buf=Buffer.from(entry.json),header=Buffer.alloc(4);header.writeUInt32BE(buf.length);p.root.update(header).update(buf);const {previous,merged}=JSON.parse(entry.json),final=JSON.parse(entry.final_json),id=E.keyOf(merged,'candle'),d=E.difference(previous,merged,'candle'),ordinal=p.count++;if(p.count>20000||id.trade_date!==this.identity.trade_date||E.keyOf(final,'candle').key!==id.key)throw Error('ROW_IDENTITY');const fh=sha(E.projection(final,'candle'));if(p.final.has(id.key)&&p.final.get(id.key)!==fh)throw Error('FINAL_CONFLICT');p.final.set(id.key,fh);if(p.chain.has(id.key)&&p.chain.get(id.key)!==d.previous_hash)throw Error('PARENT_REVISION_CHAIN');p.chain.set(id.key,d.content_hash);
      if(d.changed){const e=b.events[ei++],old=next.revisions[id.key];if(!e||e.event_id!==p.id+':'+ordinal||e.key!==id.key||e.operation!==d.operation||e.previous_hash!==d.previous_hash||e.content_hash!==d.content_hash||e.revision!==(old?.revision||0)+1||old&&old.hash!==d.previous_hash||sha(e.payload)!==sha(merged)||sha(e.final_payload)!==sha(final))throw Error('EVENT_BINDING');next.revisions[id.key]={revision:e.revision,hash:e.content_hash};events.push(e);p.changed++;}
     }
     if(ei!==b.events.length||c.events!==ei)throw Error('EVENT_COUNT');p.sub++;p.last=c.hash;next.sequence=seq;next.commit_hash=c.hash;
     if(p.sub===p.sub_count){const r=get(seq,'parent-complete');if(r.status!=='PARENT_COMPLETE'||r.parent_id!==p.id||r.total_entries!==p.count||p.total!==p.count||r.changed_events!==p.changed||r.sub_count!==p.sub||r.root_hash!==p.root.digest('hex')||r.root_hash!==p.root_hash||r.last_commit_hash!==p.last)throw Error('PARENT_COMPLETE_INVALID');for(const [k,h]of p.chain)if(p.final.get(k)!==h)throw Error('FINAL_CHAIN');p=null;parents++;}
     if(events.length>this.limits.maxEvents)throw Error('BACKPRESSURE_EVENTS');if(Object.keys(next.revisions).length>50000)throw Error('REVISION_LIMIT');
    }while(p);
   }
   if(events.length>this.limits.maxEvents)throw Error('BACKPRESSURE_EVENTS');if(Object.keys(next.revisions).length>50000)throw Error('REVISION_LIMIT');
  }
  }catch(e){if(e.message==='TAIL_STOP')return {status:'STOPPED',files,bytes};if(e.message.startsWith('BACKPRESSURE'))return {status:'BACKPRESSURE',reason:e.message,files,bytes,cursor:before};throw e;}
  if(!parents)return {status:'IDLE',cursor:before,files,bytes};
  const rows=new Map();for(const e of events)rows.set(e.key,e.final_payload||e.payload);
  const page={contract:'tail-page-v1',binding:this.identity.binding,before,next,events,rows:[...rows.values()],proofs,parents,files,bytes,continuity:'FROM_BASELINE_BOUNDARY_ONLY',formal_verified:false};return {status:'PAGE',page,id:sha(page)};
 }
 ack(result,readback,{fault}={}){
  if(this.stop())throw Error('TAIL_STOP');if(result.status!=='PAGE'||sha(result.page)!==result.id||readback?.page_id!==result.id||!/^[a-f0-9]{64}$/.test(readback.root_hash||'')||readback.independent_readback!==true)throw Error('ACK_REQUIRES_READBACK');
  if(result.page.binding!==this.identity.binding)throw Error('ACK_BINDING');
  const rootBytes=read(readback.root_file,4194304),root=JSON.parse(rootBytes),frameBytes=read(readback.frame_file,8388608),frame=JSON.parse(frameBytes);
  if(sha(rootBytes)!==readback.root_hash||sha(JSON.stringify(root.payload))!==root.sha256||sha(frameBytes)!==root.payload.sourceCursor.intent_hash||!frame.feed_pages?.includes(result.id))throw Error('CONSUMER_READBACK_BINDING');
  const lock=path.join(this.directory,'cursor.lock'),fd=fs.openSync(lock,'wx');try{
   const before=this.cursor();if(before.last_page===result.id)return {status:'ACK_REPLAY'};if(sha(before)!==sha(result.page.before))throw Error('CURSOR_CONFLICT');
   for(const proof of result.page.proofs)if(sha(read(proof.file,8*1048576))!==proof.sha256)throw Error('SOURCE_CHANGED_BEFORE_ACK');
   const payload={...result.page.next,last_page:result.id,consumer_root:readback.root_hash},tmp=this.file+'.tmp';fs.writeFileSync(tmp,JSON.stringify({payload,hash:sha(payload)}));const w=fs.openSync(tmp,'r+');try{fs.fsyncSync(w);}finally{fs.closeSync(w);}if(fault==='BEFORE_RENAME')throw Error('CRASH_BEFORE_CURSOR_RENAME');fs.renameSync(tmp,this.file);if(fault==='AFTER_RENAME')throw Error('CRASH_AFTER_CURSOR_RENAME');if(sha(this.cursor())!==sha(payload))throw Error('CURSOR_READBACK');return {status:'ACKED',cursor:payload};
  }finally{fs.closeSync(fd);fs.unlinkSync(lock);}
 }
}
module.exports={LiveTail};
