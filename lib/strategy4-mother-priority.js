'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {inspectSnapshot}=require('./daytrade-mother-pool-snapshot');
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
function verifyRows(snapshot,rows,generation){
 const errors=[];const expected=new Set(snapshot.symbols),seen=new Set();
 for(const r of rows){if(seen.has(r.symbol))errors.push('duplicate_symbol');seen.add(r.symbol);
 for(const k of ['trade_date','canonical_run_id','mother_pool_run_id','snapshot_sequence'])if(r[k]!==snapshot[k])errors.push('identity_'+k);
 if(r.generation!==generation||r.complete!==true||r.status!=='complete'||r.contract_version!=='4.1.0'||r.membership_status==='REMOVED')errors.push('row_contract');
 if(!expected.has(r.symbol))errors.push('extra_symbol');}
 const missing=[...expected].filter(s=>!seen.has(s)),extra=[...seen].filter(s=>!expected.has(s));
 if(missing.length||rows.length!==expected.size)errors.push('missing_or_count');
 return {failed_checks:[...new Set(errors)],missing,extra,requested:expected.size,readback:rows.length,unique:seen.size};
}
async function readPriority(tradeDate){
 const runtime=process.env.FUMAN_RUNTIME_DIR||'C:/fuman-runtime',root=path.resolve(__dirname,'..');
 const sourceFile=path.join(runtime,'state/daytrade-mother-pool-snapshot-latest.json');
 const snapshot=JSON.parse(fs.readFileSync(sourceFile,'utf8').replace(/^\uFEFF/,'')),checked=inspectSnapshot(snapshot,tradeDate);
 if(!checked.ok)throw Error('strategy4_mother_snapshot:'+checked.failedChecks.join(','));
 const {terminalSupabaseUrl}=require('./server-supabase-key');
 const key=process.env.SUPABASE_ANON_KEY||fs.readFileSync(path.join(runtime,'secrets/supabase-anon-key.txt'),'utf8').trim();
 const base=terminalSupabaseUrl({root,runtimeDir:runtime}).replace(/\/$/,'')+'/rest/v1/v_fugle_daytrade_mother_pool_snapshot_v4_1';
 const identity={trade_date:'eq.'+tradeDate,canonical_run_id:'eq.'+snapshot.canonical_run_id,mother_pool_run_id:'eq.'+snapshot.mother_pool_run_id,snapshot_sequence:'eq.'+snapshot.snapshot_sequence};
 async function get(q){const r=await fetch(base+'?'+new URLSearchParams(q),{headers:{apikey:key,Authorization:'Bearer '+key,Prefer:'count=exact'},signal:AbortSignal.timeout(30000)});if(![200,206].includes(r.status))throw Error('mother_snapshot_anon_http_'+r.status);return {rows:await r.json(),http:r.status,contentRange:r.headers.get('content-range')};}
 const header=await get({...identity,select:'generation',limit:1});const generation=header.rows[0]?.generation;
 if(!generation||snapshot.generation&&snapshot.generation!==generation)throw Error('mother_snapshot_generation_mismatch');
 if(!snapshot.generation&&!process.env.STRATEGY4_REPLAY_TRADE_DATE)throw Error('mother_snapshot_producer_generation_missing');
 const rows=[],pages=[];
 for(let offset=0;offset<10000;offset+=200){const page=await get({...identity,generation:'eq.'+generation,select:'*',membership_status:'neq.REMOVED',order:'symbol.asc',offset,limit:200});rows.push(...page.rows);pages.push({offset,http:page.http,count:page.rows.length,contentRange:page.contentRange,sha256:hash(page.rows)});if(page.rows.length<200)break;}
 const check=verifyRows(snapshot,rows,generation);if(check.failed_checks.length)throw Error('strategy4_mother_readback:'+check.failed_checks.join(','));
 const artifact={contract:'strategy4_fixed_mother_priority_v2',source:'v_fugle_daytrade_mother_pool_snapshot_v4_1',sourceFile,tradeDate,canonicalRunId:snapshot.canonical_run_id,mother_pool_run_id:snapshot.mother_pool_run_id,snapshot_sequence:snapshot.snapshot_sequence,generation,archivedProducerGeneration:snapshot.generation??null,daytradeMotherPoolSymbols:snapshot.symbols,priorityOnly:true,hardGate:false,checkedAt:new Date().toISOString(),pages,...check};
 const file=path.join(runtime,'data/scan-receipts/strategy4-mother-priority-'+Date.now()+'.json');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(artifact,null,2),{flag:'wx'});return {...artifact,receiptPath:file};
}
module.exports={readPriority,verifyRows};
