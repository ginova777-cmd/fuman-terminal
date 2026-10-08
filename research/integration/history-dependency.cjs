'use strict';
// Research-only dependency index. Every reuse re-hashes ALL original bytes.
// It avoids full JSON hydration/validation, never replaces source evidence.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const volume=require('../../lib/telegram-detectors/volume-detector.cjs');
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
const version=digest(Buffer.concat([fs.readFileSync(__filename),fs.readFileSync(require.resolve('../../lib/telegram-detectors/volume-detector.cjs')),fs.readFileSync(require.resolve('../../lib/telegram-detectors/price-detector.cjs'))]));
const stats={builds:0,reuses:0,validated_rows:0,projected_rows:0,verified_source_bytes:0};
function project(store,historyRef,symbol,tradeDate,current,asOf,binding=null){
 const now=Date.parse(asOf);if(!Number.isFinite(now))throw Error('INVALID_AS_OF');
 const raw=store.verifiedBytes(historyRef);stats.verified_source_bytes+=raw.length;
 const identity={contract:'offline-history-dependency-v1',version,historyRef,symbol,tradeDate,binding};
 const key=digest(JSON.stringify(identity)),dir=path.join(store.directory,'history-proof-index'),pointer=path.join(dir,key+'.json');
 let proof=null;if(fs.existsSync(pointer)){const p=JSON.parse(fs.readFileSync(pointer));proof=store.get(p.hash);if(JSON.stringify(proof.identity)!==JSON.stringify(identity))throw Error('HISTORY_PROOF_IDENTITY');if(now<proof.validFrom||(proof.validUntil!==null&&now>=proof.validUntil))proof=null;}
 if(!proof){
  const rows=JSON.parse(raw);if(!Array.isArray(rows)||rows.length>5420)throw Error('HISTORY_LIMIT');
  let offset=1,until=Infinity;const entries=[];for(let i=0;i<rows.length;i++){
   const b=rows[i],encoded=Buffer.from(JSON.stringify(b));if(!raw.subarray(offset,offset+encoded.length).equals(encoded))throw Error('NONCANONICAL_HISTORY_BYTES');
   for(const t of [Date.parse(b.timestamp)+60000,Date.parse(b.available_at)])if(Number.isFinite(t)&&t>now)until=Math.min(until,t);
   if(b.stock_id===symbol&&b.trade_date<tradeDate){const v=volume.validate(b,now);stats.validated_rows++;if(!v.reasons.length)entries.push([offset,encoded.length,v.clock.ms,b.trade_date,v.clock.minute]);}
   offset+=encoded.length+(i<rows.length-1?1:0);
  }
  if(offset!==raw.length-1||raw[0]!==91||raw.at(-1)!==93)throw Error('NONCANONICAL_HISTORY_BYTES');
  const days=[...new Set(entries.map(e=>e[3]))].sort().slice(-20);
  proof={identity,validFrom:now,validUntil:Number.isFinite(until)?until:null,entries,days,raw_bytes:raw.length,total_rows:rows.length};
  const hash=store.put(proof);fs.mkdirSync(dir,{recursive:true});const tmp=pointer+'.'+process.pid+'.tmp';fs.writeFileSync(tmp,JSON.stringify({hash}));fs.renameSync(tmp,pointer);stats.builds++;
 }else stats.reuses++;
 if(proof.raw_bytes!==raw.length||!Array.isArray(proof.entries)||proof.entries.length>5420)throw Error('HISTORY_PROOF_SHAPE');
 const seen=new Set();for(const b of current){const t=Date.parse(b.timestamp);if(Number.isFinite(t)){if(seen.has(t))throw Error('DUPLICATE_MINUTE');seen.add(t);}}
 for(const e of proof.entries){if(seen.has(e[2]))throw Error('DUPLICATE_MINUTE');seen.add(e[2]);}
 const minutes=new Set(current.flatMap(b=>[Date.parse(b.timestamp),Date.parse(b.timestamp)-60000]).filter(Number.isFinite).map(t=>new Date(t+28800000).toISOString().slice(11,16))),days=new Set(proof.days),selected=[];
 for(const e of proof.entries)if(days.has(e[3])&&minutes.has(e[4])){const b=JSON.parse(raw.subarray(e[0],e[0]+e[1]));if(b.stock_id!==symbol||b.trade_date!==e[3]||Date.parse(b.timestamp)!==e[2])throw Error('HISTORY_INDEX_ROW_IDENTITY');selected.push(b);}
 stats.projected_rows+=selected.length;return selected;
}
module.exports={project,stats,version};
