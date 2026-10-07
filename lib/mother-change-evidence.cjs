'use strict';
// Phase 1 evidence only. No DB, network, Consumer cursor, GC, or publication authority.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const CONTRACT = 'mother-change-evidence-v1';
const canonical = value => JSON.stringify(sort(value));
function sort(value) {
  if (Array.isArray(value)) return value.map(sort);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => [k, sort(value[k])]));
  if (typeof value === 'number' && !Number.isFinite(value)) throw Error('NON_FINITE_EVIDENCE');
  return value;
}
const sha = value => crypto.createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : canonical(value)).digest('hex');
const transport = new Set(['received_at','receivedAt','candleSeenAt','updatedAt','heartbeatAt','transportSeenAt']);
const quality = /source|synthetic|usable|available|unit|origin|websocket|restRepair|oddLot|quality|complete|finality/i;
const ordering = /serial|order|eventAt|tradeTime|lastUpdated|tradeDate|exchangeTime|quoteSeenAt|quoteTime|^time$/i;
function projection(row, kind) {
  const out = {};
  for (const [k,v] of Object.entries(row || {})) if (!transport.has(k)) out[k] = v;
  return out;
}
function difference(previous, merged, kind) {
  const before = projection(previous, kind), after = projection(merged, kind);
  const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(k => canonical(before[k]) !== canonical(after[k])).sort();
  const groups = {market:[], ordering:[], quality:[], transport:[]};
  for (const k of fields) groups[quality.test(k) ? 'quality' : ordering.test(k) ? 'ordering' : 'market'].push(k);
  for (const k of transport) if (canonical(previous?.[k] ?? null) !== canonical(merged?.[k] ?? null)) groups.transport.push(k);
  const inserted = !previous || Object.keys(previous).length === 0;
  return {changed: fields.length > 0, groups, operation: inserted ? 'INSERT' : fields.length && groups.market.length === 0 && groups.ordering.length === 0 ? 'QUALITY_CHANGE' : 'REVISE', previous_hash: inserted ? null : sha(before), content_hash:sha(after)};
}
function keyOf(row, kind) {
  const symbol = String(row.code || row.symbol || '');
  const minute = kind === 'candle' ? row.candleTime || row.date : null;
  const eventMs=Date.parse(row.exchangeTime || row.lastTradeTime || row.quoteSeenAt || minute || '');
  const date = row.tradeDate || row.trade_date || (Number.isFinite(eventMs)?new Date(eventMs+28800000).toISOString().slice(0,10):null);
  if (!/^\d{4}$/.test(symbol) || !/^\d{4}-\d{2}-\d{2}$/.test(date || '') || kind === 'candle' && !Number.isFinite(Date.parse(minute))) throw Error('INVALID_EVIDENCE_IDENTITY');
  return {key:[row.market || 'UNKNOWN', symbol, date, ...(kind === 'candle' ? [new Date(minute).toISOString()] : [])].join('|'),symbol,trade_date:date,candle_minute:minute};
}
function durable(file, value) {
  if(fs.existsSync(file))throw Error('IMMUTABLE_EVIDENCE_EXISTS');
  const body = canonical(value), tmp = file + '.tmp';
  let fd;
  try { fd=fs.openSync(tmp,'wx'); fs.writeFileSync(fd,body); fs.fsyncSync(fd); fs.closeSync(fd);fd=undefined;fs.renameSync(tmp,file); }
  finally { if(fd!==undefined)fs.closeSync(fd); }
  // A leftover temp is recovery evidence: never silently delete it.
}
const read = file => JSON.parse(fs.readFileSync(file,'utf8'));
function name(seq, type) { return String(seq).padStart(12,'0')+'.'+type+'.json'; }
function validateBatch(batch) {
  const copy={...batch};delete copy.batch_hash;
  if(![CONTRACT,'mother-change-evidence-v2-c2'].includes(batch.contract) || sha(copy)!==batch.batch_hash)throw Error('PREPARE_HASH_MISMATCH');
  for(const e of batch.events) if(sha(projection(e.payload,batch.kind))!==e.content_hash)throw Error('CONTENT_HASH_MISMATCH');
  if(batch.contract!==CONTRACT){
    const intent=require('./mother-evidence-intent.cjs').validate(batch.context?.intent,{epoch:batch.collector_epoch,kind:batch.kind,token:batch.context?.token});
    if(sha(intent)!==batch.context.intent_sha256||batch.batch_id!==intent.intent_id)throw Error('FROZEN_INTENT_HASH_MISMATCH');
    const entries=intent.entries.filter(e=>e.difference.changed);
    if(entries.length!==batch.events.length)throw Error('INTENT_EVENT_COUNT_MISMATCH');
    for(let i=0;i<entries.length;i++){const f=entries[i],e=batch.events[i];if(e.event_id!==f.event_id||e.key!==f.identity.key||sha(e.payload)!==sha(f.merged)||e.previous_hash!==f.difference.previous_hash||e.operation!==f.difference.operation)throw Error('INTENT_EVENT_BINDING_MISMATCH');}
  }
}
function validateSaved(batch, saved) {
  if(saved.batch_hash!==batch.batch_hash || saved.sequence!==batch.sequence || saved.collector_epoch!==batch.collector_epoch || saved.batch_id!==batch.batch_id)throw Error('PERSISTENCE_IDENTITY_MISMATCH');
  if(!saved.shadow_audit?.ok || !(saved.cache_sha256||saved.confirmed_rows_sha256))throw Error('PERSISTENCE_NOT_VERIFIED');
  if(batch.contract!==CONTRACT){
    const p=saved.original_ack;
    if(!p||p.ok!==true||p.original_ack!==true||p.collector_epoch!==batch.collector_epoch||p.token!==batch.context.token||sha(p.rows_json)!==saved.confirmed_rows_sha256)throw Error('C2_ORIGINAL_ACK_REQUIRED');
    if(BigInt(batch.context.intent.frozen_ns)>BigInt(p.cache_started_ns)||BigInt(p.cache_started_ns)>BigInt(p.cache_finished_ns))throw Error('INTENT_NOT_FROZEN_BEFORE_CACHE');
    const wanted=new Map(batch.events.map(e=>[e.key,e.content_hash]));
    for(const row of JSON.parse(p.rows_json)){const key=keyOf(row,batch.kind).key;if(!wanted.has(key)||wanted.get(key)!==sha(projection(row,batch.kind)))throw Error('C2_ACK_CONTENT_MISMATCH');wanted.delete(key);}
    if(wanted.size)throw Error('C2_ACK_ROWS_MISSING');
  }
}
function commitAck(dir, ack) {
  const batch=read(path.join(dir,name(ack.sequence,'prepare')));validateBatch(batch);
  const saved=read(path.join(dir,name(ack.sequence,'saved')));validateSaved(batch,saved);
  if(ack.batch_id!==batch.batch_id || ack.collector_epoch!==batch.collector_epoch || ack.batch_hash!==batch.batch_hash || ack.saved_hash!==sha(saved))throw Error('EVIDENCE_ACK_MISMATCH');
  if(batch.sequence>1){const previous=read(path.join(dir,name(batch.sequence-1,'commit')));if(previous.sequence!==batch.sequence-1||previous.status!==(batch.contract===CONTRACT?'COMMITTED':'DURABLE_COMMITTED'))throw Error('COMMIT_SEQUENCE_GAP');}
  const target=path.join(dir,name(batch.sequence,'commit'));
  if(fs.existsSync(target)){const old=read(target);if(old.batch_hash!==batch.batch_hash||old.saved_hash!==ack.saved_hash)throw Error('COMMIT_REPLAY_CONFLICT');return old;}
  const commit={contract:batch.contract,status:batch.contract===CONTRACT?'COMMITTED':'DURABLE_COMMITTED',batch_id:batch.batch_id,batch_hash:batch.batch_hash,collector_epoch:batch.collector_epoch,sequence:batch.sequence,commit_sequence:batch.sequence,saved_hash:ack.saved_hash,persisted_at:saved.persisted_at,committed_at:new Date().toISOString(),events:batch.events.length};
  durable(target,commit);return commit;
}
function createEvidence({dir,kind,producerVersion,contract=CONTRACT,epoch=crypto.randomUUID(),now=Date.now,maxBytes=Infinity,minFreeBytes=0,onStatus=()=>{},fault=()=>{}}) {
  if(!['candle','quote'].includes(kind)||!producerVersion)throw Error('EVIDENCE_CONFIGURATION_REQUIRED');
  fs.mkdirSync(dir,{recursive:true});
  const lockFile=path.join(dir,'owner.lock');let ownerFd=null;
  try{ownerFd=fs.openSync(lockFile,'wx');fs.writeFileSync(ownerFd,canonical({pid:process.pid,epoch,kind}));fs.fsyncSync(ownerFd);}catch(e){throw Error('EVIDENCE_OWNER_LOCKED_OR_UNWRITABLE: '+e.code);}
  const started=now(), revisions=new Map();let sequence=0,blocked=null,duplicates=0,transportOnly=0,produced=0,failedCommits=0,replay=0;
  let retainedBytes=0,eventCount=0,committedCount=0,initialCommitted=0,oldest=null,latest=0,pending=null;
  function refreshCommit(){
    if(!pending)return;
    const file=path.join(dir,name(pending.sequence,'commit'));
    if(!fs.existsSync(file))return;
    const c=read(file);
    if(c.batch_hash!==pending.batch_hash||c.sequence!==pending.sequence||c.status!==(contract===CONTRACT?'COMMITTED':'DURABLE_COMMITTED'))throw Error('COMMIT_HASH_MISMATCH');
    retainedBytes+=fs.statSync(file).size;committedCount+=pending.events.length;latest=pending.sequence;pending=null;
  }
  function scan() {
    const names=fs.readdirSync(dir);if(names.some(n=>n.endsWith('.tmp')))throw Error('EVIDENCE_PARTIAL_FILE');
    retainedBytes=names.reduce((n,f)=>n+fs.statSync(path.join(dir,f)).size,0);
    const prepares=names.filter(n=>/^\d{12}\.prepare\.json$/.test(n)).sort();
    for(const n of prepares){const b=read(path.join(dir,n));validateBatch(b);if(b.sequence!==sequence+1||n!==name(b.sequence,'prepare')||b.kind!==kind||b.contract!==contract)throw Error('EVIDENCE_SEQUENCE_GAP');sequence=b.sequence;eventCount+=b.events.length;oldest=oldest||b.prepared_at;pending=b;
      const s=path.join(dir,name(sequence,'saved')),c=path.join(dir,name(sequence,'commit'));
      if(!fs.existsSync(s)||!fs.existsSync(c))throw Error('RECOVERY_REQUIRED_UNACKNOWLEDGED_BATCH');
      const saved=read(s),commit=read(c);validateSaved(b,saved);
      if(commit.sequence!==sequence||commit.batch_id!==b.batch_id||commit.batch_hash!==b.batch_hash||commit.saved_hash!==sha(saved)||commit.status!==(contract===CONTRACT?'COMMITTED':'DURABLE_COMMITTED'))throw Error('COMMIT_HASH_MISMATCH');
      committedCount+=b.events.length;latest=sequence;pending=null;
      for(const e of b.events){const prev=revisions.get(e.key);if(prev&&(e.revision!==prev.revision+1||e.previous_hash!==prev.hash))throw Error('REVISION_CHAIN_GAP');revisions.set(e.key,{revision:e.revision,hash:e.content_hash});}
    }
    for(const n of names.filter(n=>/^\d{12}\.(saved|commit)\.json$/.test(n)))if(!fs.existsSync(path.join(dir,name(Number(n.slice(0,12)),'prepare'))))throw Error('ORPHAN_EVIDENCE');
  }
  try{scan();const file=path.join(dir,'epoch-'+epoch+'.json');durable(file,{contract:contract,collector_epoch:epoch,previous_sequence:sequence,producer_version:producerVersion,started_at:new Date(now()).toISOString()});retainedBytes+=fs.statSync(file).size;}catch(e){blocked=e.message;}initialCommitted=committedCount;
  function status(){
    try{refreshCommit();}catch(e){blocked=blocked||e.message;}
    let backlogBytes=0;
    try{if(pending)for(const type of ['prepare','saved']){const f=path.join(dir,name(pending.sequence,type));if(fs.existsSync(f))backlogBytes+=fs.statSync(f).size;}}catch(e){blocked=blocked||'METRICS_READ_FAILED';}
    const seconds=Math.max(1,(now()-started)/1000);
    return {contract:contract,kind,status:blocked?'BLOCKED':'SHADOW_ONLY',reason:blocked,collector_epoch:epoch,earliest_retained_sequence:eventCount?1:null,latest_committed_sequence:latest,event_count:eventCount,bytes:retainedBytes,unconsumed_event_count:eventCount,oldest_unconsumed_age_ms:oldest?Math.max(0,now()-Date.parse(oldest)):0,gc_status:'DISABLED_NO_CONSUMER_ACK',changes_produced_per_sec:produced/seconds,changes_committed_per_sec:(committedCount-initialCommitted)/seconds,rate_scope:'current_process',backlog_event_count:pending?.events.length||0,backlog_bytes:backlogBytes,oldest_backlog_age_ms:pending?Math.max(0,now()-Date.parse(pending.prepared_at)):0,duplicate_replay_count:duplicates+replay,transport_only_count:transportOnly,failed_commit_count:failedCommits,consumers_switched:false};
  }
  function report(){const s=status();try{onStatus(s);}catch{}return s;}
  function fail(reason,commitFailure=false){blocked=reason;if(commitFailure)failedCommits++;report();}
  return {dir,epoch,status,report,fail,close(){if(ownerFd!==null){fs.closeSync(ownerFd);ownerFd=null;fs.unlinkSync(lockFile);}},
    // Called only by the evidence worker. ACK is an original cache-save confirmation,
    // not a claim that the entire cache was independently read back.
    persistedConfirmation(batch, proof, preparedDurableNs) {
      if(!batch||blocked)return null;
      try {
        if(proof.collector_epoch!==epoch||proof.token!==batch.context.token||proof.ok!==true||proof.original_ack!==true)throw Error('CACHE_ACK_IDENTITY_MISMATCH');
        const boundary=contract===CONTRACT?preparedDurableNs:batch.context.intent.frozen_ns;
        if(BigInt(boundary)>BigInt(proof.cache_started_ns)||BigInt(proof.cache_started_ns)>BigInt(proof.cache_finished_ns))throw Error(contract===CONTRACT?'PREPARE_NOT_DURABLE_BEFORE_CACHE':'INTENT_NOT_FROZEN_BEFORE_CACHE');
        const rows=JSON.parse(proof.rows_json),expected=new Map(batch.events.map(e=>[e.key,e.content_hash]));
        for(const row of rows){const id=keyOf(row,kind);if(expected.has(id.key)){if(sha(projection(row,kind))!==expected.get(id.key))throw Error('CONFIRMED_CONTENT_HASH_MISMATCH');expected.delete(id.key);}}
        if(expected.size)throw Error('CONFIRMED_ROWS_MISSING');
        // No full-cache readback/parse. Extra fsync is on this dedicated worker only.
        if(contract===CONTRACT){const fd=fs.openSync(proof.cache_file,'r+');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
        const saved={contract:contract,batch_id:batch.batch_id,batch_hash:batch.batch_hash,collector_epoch:epoch,sequence:batch.sequence,persisted_at:new Date(now()).toISOString(),cache_file:path.resolve(proof.cache_file),confirmed_rows_sha256:sha(proof.rows_json),original_ack:proof,prepared_durable_ns:preparedDurableNs,shadow_audit:{ok:true,events:batch.events.length,scope:'bounded final rows + original cache-save ACK; whole-cache independent audit remains separate'}};
        const target=path.join(dir,name(batch.sequence,'saved'));durable(target,saved);retainedBytes+=fs.statSync(target).size;
        return {sequence:batch.sequence,batch_id:batch.batch_id,collector_epoch:epoch,batch_hash:batch.batch_hash,saved_hash:sha(saved)};
      }catch(e){fail(e.message);return null;}
    },
    prepare(changes,context={}){
      if(blocked)return null;
      try{
        // Previous batch must have a verified ACK before producing another batch.
        if(sequence&&!fs.existsSync(path.join(dir,name(sequence,'commit'))))throw Error('RECOVERY_REQUIRED_UNACKNOWLEDGED_BATCH');
        if(contract!==CONTRACT){require('./mother-evidence-intent.cjs').validate(context.intent,{epoch,kind,token:context.token});if(context.intent.producer_version!==producerVersion||context.intent_sha256!==sha(context.intent)||sha(changes)!==sha(context.intent.entries.map(e=>({previous:e.previous,merged:e.merged}))))throw Error('FROZEN_INTENT_REQUIRED');}
        const events=[],next=new Map();let entryIndex=0;
        for(const {previous,merged} of changes){const frozen=context.intent?.entries[entryIndex++];const d=difference(previous,merged,kind);if(!d.changed){duplicates++;if(d.groups.transport.length)transportOnly++;continue;}
          const id=keyOf(merged,kind),prior=next.get(id.key)||revisions.get(id.key);
          if(prior&&prior.hash!==d.previous_hash)throw Error('PREVIOUS_CONTENT_CHAIN_MISMATCH');
          const revision=(prior?.revision||0)+1,t=kind==='candle'?Date.parse(id.candle_minute):NaN;
          const e={contract_version:contract,producer_version:producerVersion,collector_epoch:epoch,sequence:sequence+1,event_id:frozen?.event_id||crypto.randomUUID(),...id,operation:d.operation,revision,previous_hash:d.previous_hash,content_hash:d.content_hash,changed_fields:d.groups,provider_event_time:kind==='candle'?id.candle_minute:merged.exchangeTime||merged.lastTradeTime||null,received_time:merged.candleSeenAt||merged.received_at||merged.receivedAt||null,completion_state:kind==='candle'?(Number.isFinite(t)&&t+60000<=now()?'TIME_ELAPSED_NOT_PROVIDER_FINAL':'FORMING'):'NOT_APPLICABLE',quality_source_evidence:Object.fromEntries(Object.entries(merged).filter(([k])=>quality.test(k))),payload:structuredClone(merged)};
          events.push(e);next.set(id.key,{hash:e.content_hash,revision});
        }
        if(!events.length){report();return null;}
        const batch={contract:contract,kind,collector_epoch:epoch,producer_version:producerVersion,sequence:sequence+1,batch_id:context.intent?.intent_id||crypto.randomUUID(),prepared_at:new Date(now()).toISOString(),context,events};
        for(const e of events)e.batch_id=batch.batch_id;
        batch.batch_hash=sha(batch);
        const size=Buffer.byteLength(canonical(batch));const used=status().bytes;
        if(used+size>maxBytes)throw Error('EVIDENCE_DISK_BUDGET');
        if(minFreeBytes&&Number(fs.statfsSync(dir).bavail)*Number(fs.statfsSync(dir).bsize)<minFreeBytes+size)throw Error('EVIDENCE_DISK_FREE_WARNING');
        fault('before_prepare',batch);durable(path.join(dir,name(batch.sequence,'prepare')),batch);
        refreshCommit();sequence=batch.sequence;produced+=events.length;eventCount+=events.length;retainedBytes+=size;oldest=oldest||batch.prepared_at;pending=batch;for(const [k,v]of next)revisions.set(k,v);fault('after_prepare',batch);return batch;
      }catch(e){fail(e.message);return null;}
    },
    persisted(batch,cacheFile,cachePayload){
      if(contract!==CONTRACT){fail('C2_REQUIRES_ORIGINAL_CACHE_ACK');return null;}
      if(!batch||blocked)return null;
      try{
        fault('before_persisted',batch);
        const fd=fs.openSync(cacheFile,'r+');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
        const bytes=fs.readFileSync(cacheFile),disk=JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));
        if(sha(disk)!==sha(cachePayload))throw Error('CACHE_READBACK_HASH_MISMATCH');
        const rows=kind==='candle'?disk.candles:disk.quotes;
        if(!Array.isArray(rows))throw Error('CACHE_ROWS_INVALID');
        const wanted=new Map(batch.events.map(e=>[e.key,e]));
        for(const row of rows){let id;try{id=keyOf(row,kind);}catch{continue;}const e=wanted.get(id.key);if(e&&sha(projection(row,kind))===e.content_hash)wanted.delete(id.key);}
        if(wanted.size)throw Error('CACHE_VERSION_NOT_FOUND');
        const saved={contract:contract,batch_id:batch.batch_id,batch_hash:batch.batch_hash,collector_epoch:epoch,sequence:batch.sequence,persisted_at:new Date(now()).toISOString(),cache_file:path.resolve(cacheFile),cache_sha256:sha(bytes),shadow_audit:{ok:true,events:batch.events.length,scope:'final version per key at this persistence boundary; intermediate versions retained in prepare'}};
        const savedFile=path.join(dir,name(batch.sequence,'saved'));durable(savedFile,saved);retainedBytes+=fs.statSync(savedFile).size;fault('after_persisted',batch);
        return {sequence:batch.sequence,batch_id:batch.batch_id,collector_epoch:epoch,batch_hash:batch.batch_hash,saved_hash:sha(saved)};
      }catch(e){fail(e.message);return null;}
    },
    commit(ack){if(!ack||blocked)return null;try{fault('before_commit',ack);const c=commitAck(dir,ack);fault('after_commit',ack);report();return c;}catch(e){fail(e.message,true);return null;}},
  };
}
module.exports={CONTRACT,canonical,sha,projection,difference,keyOf,durable,createEvidence,commitAck,validateBatch,validateSaved};
