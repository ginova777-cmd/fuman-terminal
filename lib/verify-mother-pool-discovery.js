'use strict';
const {calculate,flags}=require('./mother-pool-discovery-calculation');
function verify(rows,artifact){try{
 const rebuilt=rows.map(row=>({symbol:row.symbol,...calculate({symbol:row.symbol,source:row.raw_source,previous:artifact.writer_write_set.plan.source_evidence.previous_write_set,bars:row.natural_bars,identity:artifact,asOf:artifact.observed_at})}));
 if(rebuilt.some(r=>r.status!=='READY'))return false;
 const ranked=rebuilt.slice().sort((a,b)=>b.cumulative_volume_lots-a.cumulative_volume_lots||a.symbol.localeCompare(b.symbol));
 return rows.every((row,i)=>{const r=rebuilt[i],rank=ranked.findIndex(x=>x.symbol===row.symbol)+1;
 return Object.keys(r).filter(k=>!['data_gap_reason','failed_checks'].includes(k)).every(k=>row[k]===r[k])&&row.volume_rank===rank&&JSON.stringify(row.discovery_flags)===JSON.stringify(flags(r,rank));});
}catch{return false;}}
module.exports={verify};
