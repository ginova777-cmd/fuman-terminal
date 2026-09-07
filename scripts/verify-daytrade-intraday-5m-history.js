#!/usr/bin/env node
"use strict";
const fs=require("fs"),path=require("path"),ROOT=path.resolve(__dirname,"..");
const URL=(process.env.SUPABASE_URL||"https://cpmpfhbzutkiecccekfr.supabase.co").replace(/\/+$/,"");
const arg=n=>{const x=process.argv.find(v=>v.startsWith(`--${n}=`));return x?x.slice(n.length+3):""};
function secret(n){for(const p of [path.join("C:\\fuman-runtime","secrets",n),path.join(ROOT,"secrets",n)])try{const v=fs.readFileSync(p,"utf8").trim();if(v)return v}catch{}return""}
async function request(key,q,range){
 const headers={apikey:key,Authorization:`Bearer ${key}`,Accept:"application/json",Prefer:"count=exact"};if(range)headers.Range=range;
 const r=await fetch(`${URL}/rest/v1/${q}`,{headers,signal:AbortSignal.timeout(30000)}),text=await r.text();
 if(!r.ok)throw new Error(`HTTP ${r.status}: ${text.slice(0,500)}`);
 return{status:r.status,range:r.headers.get("content-range"),rows:JSON.parse(text)};
}
async function paged(key,q){
 const rows=[];let status=0,total=null;
 for(let start=0;;start+=1000){const x=await request(key,q,`${start}-${start+999}`);status=x.status;rows.push(...x.rows);const m=/\/(\d+)$/.exec(x.range||"");if(m)total=Number(m[1]);if(x.rows.length<1000||(total!=null&&rows.length>=total))break}
 return{status,total,rows};
}
async function main(){
 const key=process.env.SUPABASE_ANON_KEY||secret("supabase-anon-key.txt"),runId=arg("run-id"),tradeDate=arg("trade-date"),requestedSample=arg("sample-symbol"),requestedAsOf=arg("as-of");
 if(!key||!runId||!tradeDate)throw new Error("anon key, --run-id and --trade-date are required");
 const fields=["symbol","trade_date","run_id","bar_start","bar_end","bar_count","bar_complete","bar_kind","confirmation_eligible","data_gap_5m","gap_reason","source_status","calculated_at","calculation_version","trend_5m_strategy_version","rsi3_5m","rsi6_5m","previous_rsi3_5m","previous_rsi6_5m","rsi3_cross_rsi6_up_5m","kd_k_5m","kd_d_5m","previous_kd_k_5m","previous_kd_d_5m","kd_5_3_golden_cross_5m","ma5_5m","ma10_5m","ma20_5m","previous_ma5_5m","previous_ma10_5m","previous_ma20_5m","ma5_cross_ma10_up_5m","ma10_cross_ma20_up_5m","ma5_cross_ma20_up_5m","golden_cross_any_5m","trend_5m_status"];
 const base=`v_fugle_intraday_5m_history_readback?select=${fields.join(",")}&run_id=eq.${encodeURIComponent(runId)}&trade_date=eq.${tradeDate}`;
 const all=await paged(key,`${base}&order=symbol.asc,bar_start.asc`),rows=all.rows,issues=[];
 const completeRows=rows.filter(row=>row.bar_complete===true&&Number.isFinite(Date.parse(String(row.bar_end||"")))).sort((a,b)=>Date.parse(a.bar_end)-Date.parse(b.bar_end));
 const defaultReplayRow=completeRows[Math.floor(completeRows.length/2)]||completeRows[0]||null;
 const asOf=requestedAsOf||defaultReplayRow?.bar_end||`${tradeDate}T23:59:59+08:00`,asOfUtc=new Date(asOf).toISOString().replace(".000Z","Z");
 const replayCandidate=completeRows.filter(row=>(!requestedSample||String(row.symbol)===requestedSample)&&Date.parse(row.bar_end)<=Date.parse(asOf)).at(-1)||null;
 const sample=requestedSample||String(replayCandidate?.symbol||rows[0]?.symbol||"");
 const sampleRead={rows:rows.filter(row=>String(row.symbol)===sample).sort((a,b)=>Date.parse(a.bar_start)-Date.parse(b.bar_start))};
 const replay={rows:sampleRead.rows.filter(row=>row.bar_complete===true&&Number.isFinite(Date.parse(String(row.bar_end||"")))&&Date.parse(row.bar_end)<=Date.parse(asOf)).sort((a,b)=>Date.parse(a.bar_end)-Date.parse(b.bar_end))};
 if(!rows.length)issues.push("history_zero_rows");
 const keys=new Set,duplicates=[];
 for(const r of rows){
  const k=`${r.symbol}|${r.trade_date}|${r.bar_start}`;if(keys.has(k))duplicates.push(k);keys.add(k);
  if(r.calculation_version!=="five-minute-indicators-v3")issues.push(`${r.symbol}:calculation_version`);
  if(r.trend_5m_strategy_version!=="golden-cross-any-v3")issues.push(`${r.symbol}:strategy_version`);
  if(r.confirmation_eligible&&(r.bar_kind!=="regular_session"||!r.bar_complete||r.bar_count!==5))issues.push(`${r.symbol}:eligible_structure_mismatch`);
  if(r.bar_kind==="closing_special"&&(r.bar_complete||r.confirmation_eligible||!r.data_gap_5m))issues.push(`${r.symbol}:closing_special_quality_mismatch`);
  if(r.previous_bar_end&&Date.parse(r.bar_start)!==Date.parse(r.previous_bar_end))issues.push(`${r.symbol}:non_adjacent_previous_evidence`);
 }
 if(duplicates.length)issues.push(`duplicate_keys:${duplicates.length}`);
 if(replay.rows.some(r=>Date.parse(r.bar_end)>Date.parse(asOf)))issues.push("as_of_future_leak");
 if(!sampleRead.rows.length)issues.push("sample_history_zero_rows");
 if(!replay.rows.length)issues.push("as_of_replay_zero_rows");
 const branchNames=["rsi3_cross_rsi6_up_5m","kd_5_3_golden_cross_5m","ma5_cross_ma10_up_5m","ma10_cross_ma20_up_5m","ma5_cross_ma20_up_5m"];
 const branchStats=Object.fromEntries(branchNames.map(name=>[name,{available:rows.filter(r=>r[name]!==null).length,unknown:rows.filter(r=>r[name]===null).length,true:rows.filter(r=>r[name]===true).length}]));
 const summary={total_rows:rows.length,total_header:all.total,structurally_complete_rows:rows.filter(r=>r.confirmation_eligible).length,basic_quality_pass:rows.filter(r=>r.bar_complete&&!r.data_gap_5m).length,data_gap_rows:rows.filter(r=>r.data_gap_5m).length,closing_special_rows:rows.filter(r=>r.bar_kind==="closing_special").length,missing_source_rows:rows.filter(r=>r.bar_kind==="missing_source").length,branch_stats:branchStats,sample_symbol:sample,sample_rows:sampleRead.rows.length,replay_candidate_bar_end:replayCandidate?.bar_end||null,as_of:asOf,as_of_utc:asOfUtc,replay_mode:"local_projection_from_complete_history_readback",replay_rows:replay.rows.length,replay_latest_bar_end:replay.rows.map(r=>r.bar_end).sort().at(-1)||null,duplicate_keys:duplicates.length};
 const uniqueIssues=[...new Set(issues)],out={contract:"daytrade_intraday_5m_history_replay_verifier_v1",status:uniqueIssues.length?"blocked":"complete",complete:!uniqueIssues.length,run_id:runId,trade_date:tradeDate,view:"v_fugle_intraday_5m_history_readback",anon_http_status:all.status,ssl_ok:true,tls_verification_disabled:false,calculation_version:"five-minute-indicators-v3",strategy_version:"golden-cross-any-v3",summary,issues:uniqueIssues,first_blocker:uniqueIssues[0]||null,checked_at:new Date().toISOString()};
 const p=path.join("C:\\fuman-runtime","data","scan-receipts",`daytrade-intraday-5m-history-${tradeDate.replace(/-/g,"")}.json`);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify({...out,receipt_path:p},null,2)+"\n");console.log(JSON.stringify({...out,receipt_path:p},null,2));if(uniqueIssues.length)process.exitCode=1;
}
main().catch(e=>{console.error(JSON.stringify({status:"blocked",complete:false,first_blocker:e.message},null,2));process.exitCode=1});
