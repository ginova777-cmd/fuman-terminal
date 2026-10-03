'use strict';
const {readVerifiedQualification}=require('./shared-stock-qualification-store.cjs');
async function publishStockQualification({directory,tradeDate,stockRows,apply=false,rpc,read=readVerifiedQualification,nowMs=Date.now()}){
 const pending=[],gaps=[],seen=new Set();let unchanged=0;
 for(const row of stockRows){
  const symbol=String(row.symbol||'');if(seen.has(symbol))throw Error('QUALIFICATION_DUPLICATE_MASTER');seen.add(symbol);
  const r=read(directory,symbol,tradeDate,nowMs);
  if(!r.ok){gaps.push({symbol,reason:r.reason});continue;}
  const old=row.payload?.fugle_qualification;
  if(old?.contract===r.evidence.contract&&old.trade_date===tradeDate&&old.raw_json_sha256===r.evidence.raw_json_sha256){unchanged++;continue;}
  pending.push({symbol,evidence:r.evidence});
 }
 const selected=pending.slice(0,200),published=[];
 if(apply)for(let offset=0;offset<selected.length;offset+=50){
  const batch=selected.slice(offset,offset+50);
  if(Buffer.byteLength(JSON.stringify(batch))>256*1024)throw Error('QUALIFICATION_BATCH_BYTES');
  const ack=await rpc('publish_fugle_stock_qualification_v1',{p_rows:batch});
  if(!Array.isArray(ack)||ack.length!==batch.length)throw Error('QUALIFICATION_ACK_COUNT');
  const actual=new Map(ack.map(r=>[r.symbol,r]));
  if(actual.size!==batch.length||batch.some(r=>actual.get(r.symbol)?.raw_json_sha256!==r.evidence.raw_json_sha256||actual.get(r.symbol)?.trade_date!==tradeDate))throw Error('QUALIFICATION_ACK_IDENTITY');
  published.push(...ack);
 }
 return {status:apply?'WRITE_ACKNOWLEDGED':'DRY_RUN',complete:false,independent_readback_verified:false,
  requested_count:seen.size,unchanged_count:unchanged,pending_count:pending.length,
  written_count:published.length,deferred_count:Math.max(0,pending.length-selected.length),missing_count:gaps.length,missing_symbols:gaps};
}
module.exports={publishStockQualification};
