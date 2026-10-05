"use strict";
const fs=require("node:fs");
const stages=require("../lib/opening-report-stage-contract");
const {OPENING_REPORT_0830_INDUSTRY_MAP,leaderPairs}=require("./opening-report-0830-industry-map-contract");
const jp=require("../lib/opening-report-japan-realtime");
const {assessLeaderFreshness}=require("../lib/opening-report-asia-freshness");
const {buildUsEquityMarketCalendar}=require("./us-equity-market-calendar");
function verify(source,date,runId) {
 const failed=[],rows=[],add=(code,ok)=>{if(!ok)failed.push(code);};
 add("source_identity",source?.date===date&&source?.run_id===runId&&source?.stage===stages.stage().id);
 const industries=Array.isArray(source?.industries)?source.industries:[];
 add("industry_set",industries.length===OPENING_REPORT_0830_INDUSTRY_MAP.length&&new Set(industries.map(x=>x.industry)).size===industries.length);
 const us=buildUsEquityMarketCalendar(date);
 for(const expected of OPENING_REPORT_0830_INDUSTRY_MAP){
  const actual=industries.find(x=>x.industry===expected.industry);
  const leaders=actual?.leaders||[];
  const symbols=leaderPairs(expected).map(x=>x[1]);
  add("symbol_set:"+expected.industry,leaders.length===symbols.length&&symbols.every(s=>leaders.filter(x=>x.yahoo_symbol===s).length===1));
  for(const row of leaders){
   const issues=[],symbol=row.yahoo_symbol,market=stages.market(symbol),fresh=assessLeaderFreshness(row,date);
   const closed=fresh.market_closed===true || (market==="us"&&us.no_new_us_session===true);
   if(closed){
    if(row.ok!==false||row.percent!=null||row.close!=null||row.previous_close!=null)issues.push("closed_market_values_not_excluded");
    if(market==="korea"&&row.reason_code!=="korea_market_closed")issues.push("closure_not_classified");
   }else{
    if(row.ok!==true||row.source_gap===true)issues.push("source_unavailable");
    if(!Number.isFinite(Date.parse(row.source_time)))issues.push("source_time_missing");
    if(fresh.required&&!fresh.fresh)issues.push(fresh.reason_code);
    if(typeof row.percent!=="number"||!Number.isFinite(row.percent))issues.push("percent_missing");
    if(!(typeof row.close==="number"&&row.close>0))issues.push("price_missing");
    if(jp.SYMBOLS.includes(symbol)&&!jp.receiptValid(row,date))issues.push("japan_evidence_invalid");
   }
   for(const issue of issues)failed.push(expected.industry+":"+symbol+":"+issue);
   rows.push({industry:expected.industry,symbol,source:row.source,source_time:row.source_time,price:row.close??null,percent:row.percent??null,status:issues.length?"DATA_GAP":closed?"MARKET_CLOSED":"PASS",issues});
  }
 }
 add("reported_total",source?.total_leaders===rows.length);
 return {contract:"morning-source-coverage-v1",scope:"overseas_source_only",trade_date:date,run_id:runId,stage:stages.stage().id,ok:failed.length===0,complete:failed.length===0,failed_checks:failed,first_blocker:failed[0]||null,rows};
}
if(require.main===module){
 const a=Object.fromEntries(process.argv.slice(2).map(x=>{const i=x.indexOf("=");return [x.slice(0,i),x.slice(i+1)];}));
 const source=JSON.parse(fs.readFileSync(a["--input"],"utf8").replace(/^\uFEFF/,""));
 const result=verify(source,a["--date"],a["--run-id"]);
 if(a["--output"])fs.writeFileSync(a["--output"],JSON.stringify(result,null,2));
 console.log(JSON.stringify(result));process.exitCode=result.ok?0:1;
}
module.exports={verify};
