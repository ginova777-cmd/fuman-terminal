#!/usr/bin/env node
"use strict";
const fs=require("fs"),path=require("path"),ROOT=path.resolve(__dirname,".."),URL=(process.env.SUPABASE_URL||"https://cpmpfhbzutkiecccekfr.supabase.co").replace(/\/+$/,"");
const arg=n=>{const x=process.argv.find(v=>v.startsWith(`--${n}=`));return x?x.slice(n.length+3):""};
const symbols=[...new Set((arg("symbols")||"").split(",").map(x=>x.trim()).filter(x=>/^\d{4}$/.test(x)))];
function secret(n){for(const p of [path.join("C:\\fuman-runtime","secrets",n),path.join(ROOT,"secrets",n)])try{const v=fs.readFileSync(p,"utf8").trim();if(v)return v}catch{}return""}
async function get(key,q){const started=Date.now();try{const r=await fetch(`${URL}/rest/v1/${q}`,{headers:{apikey:key,Authorization:`Bearer ${key}`,Accept:"application/json"},signal:AbortSignal.timeout(30000)}),t=await r.text();if(!r.ok)throw new Error(`HTTP ${r.status}: ${t.slice(0,500)}`);return{ok:true,http:r.status,ms:Date.now()-started,rows:JSON.parse(t)}}catch(e){return{ok:false,http:null,ms:Date.now()-started,error:e.message}}}
function resolve(values,barComplete=true,globalGap=false){if(!barComplete||globalGap)return"DATA_GAP_5M";if(values.some(v=>v===true))return"CONFIRMED_STRONG_5M";if(values.some(v=>v==null))return"DATA_GAP_5M";return"WAIT_5M_CONFIRMATION"}
function fixtureChecks(){return[
 ["rsi_only",resolve([true,false,false,false,false]),"CONFIRMED_STRONG_5M"],
 ["kd_only",resolve([false,true,false,false,false]),"CONFIRMED_STRONG_5M"],
 ["ma_only",resolve([false,false,true,false,false]),"CONFIRMED_STRONG_5M"],
 ["all_false",resolve([false,false,false,false,false]),"WAIT_5M_CONFIRMATION"],
 ["null_branch",resolve([false,null,false,false,false]),"DATA_GAP_5M"],
 ["unclosed_bar",resolve([true,false,false,false,false],false),"DATA_GAP_5M"]
].map(([name,actual,expected])=>({name,actual,expected,ok:actual===expected}))}
async function main(){
 const key=process.env.SUPABASE_ANON_KEY||secret("supabase-anon-key.txt");if(!key)throw new Error("SUPABASE_ANON_KEY is required");if(!symbols.length)throw new Error("--symbols= is required");
 const dp=await get(key,"fugle_daytrade_intraday_1m?select=trade_date&synthetic=is.false&order=trade_date.desc,candle_time.desc&limit=1"),tradeDate=arg("trade-date")||dp.rows?.[0]?.trade_date||"",runId=arg("run-id");
 const fields=["symbol","trade_date","candle_time","bar_end","updated_at","run_id","bar_complete","data_gap_5m","source_status","trend_5m_status","trend_5m_reason","trend_5m_strategy_version","golden_cross_any_5m","rsi3_5m","rsi6_5m","rsi3_cross_rsi6_up_5m","kd_k_5m","kd_d_5m","kd_5_3_golden_cross_5m","kd_period","kd_k_smoothing","kd_d_smoothing","kd_seed","ma5_cross_ma10_up_5m","ma10_cross_ma20_up_5m","ma5_cross_ma20_up_5m"],runFilter=runId?`&run_id=eq.${encodeURIComponent(runId)}`:"";
 const q=`v_fugle_intraday_5m_readback?select=${fields.join(",")}&trade_date=eq.${tradeDate}&symbol=in.(${symbols.join(",")})${runFilter}&order=candle_time.desc&limit=600`,read=await get(key,q),rows=read.rows||[],latest={};
 for(const r of rows)if(!latest[r.symbol])latest[r.symbol]=r;
 const writtenSymbols=Object.keys(latest),missingSymbols=symbols.filter(s=>!writtenSymbols.includes(s)),fail=[],fixtures=fixtureChecks();
 if(!dp.ok)fail.push(`date_probe:${dp.error}`);if(!read.ok)fail.push(`anon_read:${read.error}`);if(!rows.length)fail.push("anon_read_zero_rows");if(missingSymbols.length)fail.push(`missing_symbols:${missingSymbols.join(",")}`);if(fixtures.some(x=>!x.ok))fail.push("or_rule_fixture_failed");
 for(const r of Object.values(latest)){
  const values=[r.rsi3_cross_rsi6_up_5m,r.kd_5_3_golden_cross_5m,r.ma5_cross_ma10_up_5m,r.ma10_cross_ma20_up_5m,r.ma5_cross_ma20_up_5m],expected=resolve(values,r.bar_complete,r.data_gap_5m&&values.every(v=>v!==true));
  if(r.trend_5m_strategy_version!=="golden-cross-any-v3")fail.push(`${r.symbol}:strategy_version`);
  if(r.kd_period!==5||r.kd_k_smoothing!==3||r.kd_d_smoothing!==3||Number(r.kd_seed)!==50)fail.push(`${r.symbol}:kd_period_formula`);
  if(r.trend_5m_status!==expected)fail.push(`${r.symbol}:status_expected_${expected}`);
  if(r.golden_cross_any_5m!==values.some(v=>v===true))fail.push(`${r.symbol}:or_evidence_mismatch`);
 }
 const completeBars=Object.values(latest).filter(r=>r.bar_complete===true&&!r.data_gap_5m),out={contract:"daytrade_intraday_5m_golden_cross_any_verifier_v3",strategy_version:"golden-cross-any-v3",status:fail.length?"blocked":"complete",ok:!fail.length,run_id:runId||rows[0]?.run_id||null,checked_at:new Date().toISOString(),view:"v_fugle_intraday_5m_readback",anon_http_status:read.http,trade_date:tradeDate,latest_complete_5m_time:completeBars.map(x=>x.bar_end).filter(Boolean).sort().at(-1)||null,rows:rows.length,requested_symbols:symbols,written_symbols:writtenSymbols,missing_symbols:missingSymbols,kd_formula:"RSV(5); K=(2*prevK+RSV)/3; D=(2*prevD+K)/3; K/D seed=50",rsi_formula:"simple average gain/loss RSI periods 3 and 6",confirmation_rule:"RSI3xRSI6 OR KD(5,3,3) OR MA5x10 OR MA10x20 OR MA5x20",fixture_checks:fixtures,ssl:{ok:read.ok,error:read.error||null,tls_verification_disabled:false,elapsed_ms:read.ms},failed_checks:[...new Set(fail)],first_blocker:fail[0]||null,formal_buy_authority:false,publish_allowed:false};
 if(process.argv.includes("--write-receipt")){const p=path.join("C:\\fuman-runtime","data","scan-receipts",`daytrade-intraday-5m-seven-strategy-${tradeDate.replace(/-/g,"")}.json`);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify({...out,receipt_path:p},null,2)+"\n");out.receipt_path=p}
 console.log(JSON.stringify(out,null,2));if(fail.length)process.exitCode=1;
}
main().catch(e=>{console.error(JSON.stringify({ok:false,status:"blocked",error:e.message},null,2));process.exitCode=1});
