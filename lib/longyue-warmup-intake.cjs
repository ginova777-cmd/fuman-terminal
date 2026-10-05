'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const LABELS=['無腦開盤入 100元以下','無腦開盤入 超過100元'];
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function validate(p,{tradeDate,baseDate,now=Date.now()}){
 const errors=[];const check=(ok,name)=>{if(!ok)errors.push(name)};
 check(p?.contract==='longyue_open_long_watchlist_v1','CONTRACT');check(p?.trade_date===tradeDate,'TRADE_DATE');check(p?.base_date===baseDate,'BASE_DATE');
 check(typeof p?.candidate_version==='string'&&p.candidate_version.length>0&&p.run_id===p.candidate_version,'VERSION');
 for(const k of ['published_at','source_asof'])check(Number.isFinite(Date.parse(p?.[k]))&&Date.parse(p[k])<=now,k.toUpperCase());
 check(Date.parse(p?.source_asof)<=Date.parse(p?.published_at),'SOURCE_AFTER_PUBLICATION');
 check(p?.direction_confirmation===false&&p?.order_permission===false,'CANDIDATE_ONLY');check(Array.isArray(p?.missing_dependencies),'DEPENDENCIES');
 check(typeof p?.source_file==='string'&&!!p.source_file&&/^[a-f0-9]{64}$/i.test(p?.source_sha256||''),'SOURCE_REFERENCE');
 const rows=Array.isArray(p?.rows)?p.rows:[];check(Array.isArray(p?.rows)&&Number.isInteger(p?.total)&&p.total===rows.length,'ROW_COUNT');
 check(hash(JSON.stringify(rows))===p?.list_sha256,'LIST_HASH');
 const symbols=rows.map(r=>r.stock_id);check(symbols.every(s=>typeof s==='string'&&/^\d{4}$/.test(s)),'SYMBOL');check(new Set(symbols).size===symbols.length,'DUPLICATE_SYMBOL');
 check(rows.every(r=>LABELS.includes(r.menu_label)&&typeof r.name==='string'&&Object.hasOwn(r,'original_rank')&&Object.hasOwn(r,'original_score')&&r.volume_gate&&typeof r.volume_gate==='object'),'ROW_FIELDS');
 check(Array.isArray(p?.counts)&&p.counts.length===2&&LABELS.every(l=>p.counts.filter(c=>c.label===l).length===1&&p.counts.find(c=>c.label===l)?.count===rows.filter(r=>r.menu_label===l).length),'MENU_COUNTS');
 // An empty file is not accepted as evidence of a legitimate empty selection.
 if(!rows.length)check(p?.empty_selection_evidence?.verified===true&&typeof p.empty_selection_evidence?.reason==='string'&&p.empty_selection_evidence.reason.length>0,'EMPTY_SELECTION_EVIDENCE');
 return {ok:!errors.length,failed_checks:errors,symbols:errors.length?[]:symbols};
}
async function receive({runtimeDir,tradeDate,resolveDay,now=Date.now()}){
 const file=path.join(runtimeDir,'data/telegram-detectors/longyue-open-long-candidates.json');
 const result={contract:'mother_pool_longyue_warmup_intake_v1',checked_at:new Date(now).toISOString(),trade_date:tradeDate,source_file:file,status:'BLOCKED',complete:false,requested_count:null,unique_count:null,symbols:[],failed_checks:[],history_status:'NOT_VERIFIED',trial_status:'NOT_VERIFIED',intraday_status:'NOT_VERIFIED'};
 try{
  const day=await resolveDay(tradeDate);if(day.error||!['cache','twse'].includes(day.source)||typeof day.isTradingDay!=='boolean')throw Error('CALENDAR_UNVERIFIED');
  result.calendar={date:tradeDate,is_open:day.isTradingDay,source:day.source};if(!day.isTradingDay){result.status='SKIPPED_MARKET_CLOSED';return result;}
  let baseDate=null;for(let i=1;i<=14;i++){const date=new Date(Date.parse(tradeDate+'T12:00:00Z')-i*86400000).toISOString().slice(0,10),d=await resolveDay(date);if(d.error||!['cache','twse'].includes(d.source)||typeof d.isTradingDay!=='boolean')throw Error('CALENDAR_UNVERIFIED');if(d.isTradingDay){baseDate=date;break;}}
  if(!baseDate)throw Error('BASE_DATE_UNVERIFIED');result.base_date=baseDate;
  const bytes=fs.readFileSync(file);if(bytes.length>4*1024*1024)throw Error('CANDIDATE_FILE_TOO_LARGE');result.file_sha256=hash(bytes);
  const p=JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,'')),v=validate(p,{tradeDate,baseDate,now});
  Object.assign(result,{candidate_version:p.candidate_version,list_sha256:p.list_sha256,published_at:p.published_at,source_asof:p.source_asof,missing_dependencies:p.missing_dependencies,requested_count:Array.isArray(p.rows)?p.rows.length:null,unique_count:Array.isArray(p.rows)?new Set(p.rows.map(r=>r.stock_id)).size:null,failed_checks:v.failed_checks});
  if(v.ok){result.status='ACCEPTED';result.symbols=v.symbols;result.candidate_accepted=true;result.candidate_snapshot=p;}
 }catch(e){result.failed_checks.push(['ENOENT','EACCES'].includes(e.code)?'CANDIDATE_'+e.code:/^[A-Z_]+$/.test(e.message)?e.message:'CANDIDATE_READ_OR_PARSE_FAILED');}
 return result;
}
function publishReceipt(runtimeDir,result,{motherPoolRunId,motherSymbols,warmupSymbols}){
 const requested=result.symbols||[],missing=requested.filter(s=>!motherSymbols.includes(s));const receipt={...result,mother_pool_run_id:motherPoolRunId,generation:motherPoolRunId,covered_count:result.status==='ACCEPTED'?requested.length-missing.length:null,missing_symbols:result.status==='ACCEPTED'?missing:null,warmup_missing_symbols:requested.filter(s=>!warmupSymbols.includes(s))};
 const dir=path.join(runtimeDir,'data/scan-receipts/longyue-warmup',result.trade_date);fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,'receipt.json'),tmp=file+'.'+process.pid+'.tmp';fs.writeFileSync(tmp,JSON.stringify(receipt,null,2));fs.renameSync(tmp,file);return receipt;
}
module.exports={validate,receive,publishReceipt};
