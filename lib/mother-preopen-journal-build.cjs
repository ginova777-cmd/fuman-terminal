'use strict';
const fs=require('node:fs'),path=require('node:path');
const {build,hash}=require('./mother-preopen.cjs');
// Bound parsing by stock, not by total market journal size. Raw files remain
// unchanged and every event for the stock participates in conflict detection.
function buildJournal(options,{rawDir,names,maxFileBytes=8*1024*1024}) {
  const snapshot=build({...options,records:[]}),candidate=JSON.parse(options.candidateBytes),digests=[];
  const bySymbol=new Map(snapshot.rows.map(r=>[r.stock_id,r]));
  for(const name of names){
    const stock_id=name.slice(0,-6),file=path.join(rawDir,name),stat=fs.statSync(file);
    if(stat.size>maxFileBytes)throw Error('RAW_SYMBOL_SIZE_LIMIT:'+stock_id);
    const bytes=fs.readFileSync(file,'utf8');if(Buffer.byteLength(bytes)>maxFileBytes)throw Error('RAW_SYMBOL_SIZE_LIMIT:'+stock_id);if(bytes&&!bytes.endsWith('\n'))throw Error('RAW_APPEND_IN_PROGRESS');
    digests.push([name,hash(bytes)]);
    if(!bySymbol.has(stock_id))continue;
    const records=bytes.split('\n').filter(Boolean).map((line,i)=>({...JSON.parse(line),raw_evidence_ref:file+':'+(i+1)}));
    const single=build({...options,candidateBytes:JSON.stringify({...candidate,symbols:[{stock_id,name:bySymbol.get(stock_id).name}]}),records});
    const row=single.rows[0];row.run_id=snapshot.run_id;
    row.diagnostics_total=row.diagnostics.length;row.diagnostics_truncated=row.diagnostics.length>32;row.diagnostics=row.diagnostics.slice(0,32);
    bySymbol.set(stock_id,row);
  }
  snapshot.rows=[...bySymbol.values()];
  snapshot.covered_count=snapshot.rows.filter(r=>r.trial_0855.status==='FINAL').length;
  snapshot.missing_count=snapshot.rows.filter(r=>r.trial_0855.price===null&&r.trial_0855.status!=='CONFLICT').length;
  snapshot.conflict_count=snapshot.rows.filter(r=>r.trial_0855.status==='CONFLICT').length;
  snapshot.actual_open_covered_count=snapshot.rows.filter(r=>r.actual_open.status==='CONFIRMED').length;
  snapshot.missing_symbols=snapshot.rows.filter(r=>r.trial_0855.price===null).map(r=>({stock_id:r.stock_id,reason:r.trial_0855.missing_reason}));
  snapshot.status=!snapshot.finalized_at?'PROVISIONAL':snapshot.covered_count===snapshot.rows.length?'FINAL':'PARTIAL';
  return {snapshot,journalDigest:hash(JSON.stringify(digests))};
}
module.exports={buildJournal};
