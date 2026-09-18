"use strict";
const fs=require("node:fs"),crypto=require("node:crypto");
const arg=n=>process.argv.find(v=>v.startsWith(`--${n}=`))?.slice(n.length+3);
const sha=x=>crypto.createHash("sha256").update(x).digest("hex");
function verify(artifact){
 const {receipt,inputs,rows}=artifact,fail=[],details=[];
 const date=receipt.trade_date,priorDate=receipt.warmup_source_trade_date;
 if(!(priorDate<date))fail.push("INVALID_SESSION_ORDER");
 if(new Set(rows.map(r=>r.symbol+"|"+r.bar_start)).size!==rows.length)fail.push("DUPLICATE_OUTPUT");
 if(rows.some(r=>r.trade_date!==date||r.run_id!==receipt.run_id))fail.push("OUTPUT_IDENTITY_OR_PRIOR_DAY_LEAK");
 const time=(d,m)=>Date.parse(d+"T"+m+":00+08:00");
 function adjacent(a,b){return a&&b&&a.confirmation_eligible===true&&b.confirmation_eligible===true&&(Date.parse(b.bar_start)-Date.parse(a.bar_start)===300000||(a.trade_date===priorDate&&b.trade_date===date&&Date.parse(a.bar_start)===time(priorDate,"13:20")&&Date.parse(b.bar_start)===time(date,"09:00")&&a.source==="fugle_stock_historical_candles_timeframe_5"&&a.is_synthetic===false&&b.is_synthetic===false&&a.volume_available===true&&b.volume_available===true));}
 function ma(bars,i,p){const s=bars.slice(Math.max(0,i-p+1),i+1);return s.length===p&&s.every((r,j)=>r.confirmation_eligible===true&&(!j||adjacent(s[j-1],r)))?s.reduce((sum,r)=>sum+r.close,0)/p:null;}
 const equal=(a,b)=>a===b||(typeof a==="number"&&typeof b==="number"&&Math.abs(a-b)<1e-8);
 for(const input of inputs){
  if(input.previous.some(r=>r.trade_date!==priorDate||r.is_synthetic!==false))fail.push(input.symbol+":PRIOR_SOURCE_INVALID");
  const combined=[...input.previous,...input.current];
  const output=rows.filter(r=>r.symbol===input.symbol);
  if(output.length!==input.current.length)fail.push(input.symbol+":TODAY_COUNT_MISMATCH");
  for(const actual of output){
   const i=combined.findIndex(r=>r.trade_date===date&&r.bar_start===actual.bar_start),bar=combined[i];
   if(!bar){fail.push(input.symbol+":UNKNOWN_OUTPUT_BAR");continue;}
   for(const k of ["open","high","low","close","volume","bar_start","bar_end","source","volume_unit","is_synthetic"]){if(actual[k]!==bar[k])fail.push(input.symbol+":SOURCE_MUTATION:"+k);}
   if(Date.parse(actual.bar_end)>Date.parse(receipt.started_at))fail.push(input.symbol+":FUTURE_BAR");
   for(const p of [5,10,20]){
    const expected=ma(combined,i,p),prior=adjacent(combined[i-1],bar)?ma(combined,i-1,p):null;
    if(!equal(actual[`ma${p}_5m`],expected)||!equal(actual[`previous_ma${p}_5m`],prior))fail.push(input.symbol+":MA"+p+"_MISMATCH");
   }
   for(const [fast,slow] of [[5,10],[10,20],[5,20]]){
    const values=[ma(combined,i-1,fast),ma(combined,i-1,slow),ma(combined,i,fast),ma(combined,i,slow)];
    const expected=adjacent(combined[i-1],bar)&&values.every(v=>v!==null)?values[0]<=values[1]&&values[2]>values[3]:null;
    if(actual[`ma${fast}_cross_ma${slow}_up_5m`]!==expected)fail.push(input.symbol+":CROSS_MISMATCH");
   }
  }
  details.push({symbol:input.symbol,previous_bars:input.previous.length,today_bars:input.current.length,first_today_ma20:output[0]?.ma20_5m??null,latest_status:output.at(-1)?.trend_5m_status??null});
 }
 return {contract:"previous_session_5m_independent_isolated_verifier_v1",scope:"source_identity_and_independent_MA_cross_calculation",run_id:receipt.run_id,trade_date:date,warmup_source_trade_date:priorDate,checked_at:new Date().toISOString(),status:fail.length?"failed":"complete",complete:!fail.length,failed_checks:[...new Set(fail)],first_blocker:fail[0]||null,details,production_deployed:false,natural_batch_acceptance:false,db_written:false};
}
if(require.main===module){try{const file=arg("input"),out=arg("out");if(!file||!out)throw Error("--input and --out required");const raw=fs.readFileSync(file,"utf8"),result={...verify(JSON.parse(raw)),input_sha256:sha(raw)};fs.writeFileSync(out,JSON.stringify(result,null,2)+"\n");console.log(JSON.stringify(result,null,2));if(!result.complete)process.exitCode=1;}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={verify};
