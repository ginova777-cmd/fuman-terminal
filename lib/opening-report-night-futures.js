"use strict";
const fs=require("fs"),path=require("path"),crypto=require("crypto");
const CONTRACT="opening-report-tx-night-v1";
const SOURCE="TAIFEX dated after-hours daily report";
const sha=s=>crypto.createHash("sha256").update(s).digest("hex");
const text=s=>String(s).replace(/<[^>]*>/g," ").replace(/&nbsp;|&#160;/g," ").replace(/\s+/g," ").trim();
const num=s=>{const v=String(s).replace(/[, %\s]/g,"").replace(/▲/g,"+").replace(/▼/g,"-");return /^[+-]?\d+(?:\.\d+)?$/.test(v)?Number(v):NaN;};
const urlFor=date=>`https://www.taifex.com.tw/cht/3/futDailyMarketReport?queryType=2&marketCode=1&commodity_id=TX&queryDate=${encodeURIComponent(date.replace(/-/g,"/"))}`;
function parse(html,date){
 const section=String(html).split("dataStart")[1]||"",plain=text(section);
 const reported=plain.match(/日期：\s*(\d{4}\/\d{2}\/\d{2})/)?.[1]?.replace(/\//g,"-");
 if(reported!==date)throw Error("night_futures_trade_date_mismatch");
 const startDate=plain.match(/(\d{4}\/\d{2}\/\d{2})\s+15:00~次日05:00\s+盤後交易時段行情表/)?.[1]?.replace(/\//g,"-");
 if(!startDate)throw Error("night_futures_after_hours_header_missing");
 const endDate=new Date(Date.parse(startDate+"T00:00:00Z")+86400000).toISOString().slice(0,10);
 const table=section.match(/<table\b[^>]*class="[^"]*table_f[^" ]*(?: [^"]*)?"[^>]*>[\s\S]*?<\/table>/i)?.[0];
 if(!table)throw Error("night_futures_table_missing");
 const rows=[...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(m=>[...m[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(c=>text(c[1]))).filter(c=>c[0]==="TX"&&/^\d{6}$/.test(c[1])&&c[1]>=date.replace(/-/g,"").slice(0,6)).sort((a,b)=>a[1].localeCompare(b[1]));
 if(!rows.length||new Set(rows.map(r=>r[1])).size!==rows.length)throw Error("night_futures_near_contract_missing_or_duplicate");
 const r=rows[0],v={trade_date:date,session:"after_hours",contract_code:"TX",contract_month:r[1],session_start:startDate+"T15:00:00+08:00",session_end:endDate+"T05:00:00+08:00",open:num(r[2]),high:num(r[3]),low:num(r[4]),close:num(r[5]),change:num(r[6]),change_percent:num(r[7]),volume:num(r[8])};
 if(![v.open,v.high,v.low,v.close,v.change,v.change_percent,v.volume].every(Number.isFinite)||Math.min(v.open,v.high,v.low,v.close)<=0||v.volume<=0||!Number.isInteger(v.volume)||v.high<Math.max(v.open,v.close,v.low)||v.low>Math.min(v.open,v.close)||v.close-v.change<=0||Math.abs(v.change/(v.close-v.change)*100-v.change_percent)>0.02)throw Error("night_futures_fields_invalid");
 if(Date.parse(v.session_end)>Date.parse(date+"T08:50:00+08:00")||Date.parse(v.session_start)>=Date.parse(v.session_end))throw Error("night_futures_session_not_completed");
 return v;
}
function verify(e,{date,runId,cutoff,diagnostic=false}={}){
 const issues=[];
 if(e?.contract!==CONTRACT||e?.ok!==true||e?.source!==SOURCE||e?.source_url!==urlFor(date)||e?.trade_date!==date||e?.run_id!==runId)issues.push("night_futures_identity_invalid");
 if(!Number.isFinite(Date.parse(e?.fetched_at))||Date.parse(e?.fetched_at)<Date.parse(e?.session_end)||(!diagnostic&&(!Number.isFinite(Date.parse(cutoff))||Date.parse(e?.fetched_at)>Date.parse(cutoff))))issues.push("night_futures_capture_outside_cutoff");
 if(!/^[a-f0-9]{64}$/.test(e?.response_sha256||""))issues.push("night_futures_digest_missing");
 try{const raw=fs.readFileSync(e.raw_receipt,"utf8");if(sha(raw)!==e.response_sha256)issues.push("night_futures_raw_hash_mismatch");const parsed=parse(raw,date);for(const [k,v]of Object.entries(parsed))if(e[k]!==v)issues.push("night_futures_readback_mismatch:"+k);}catch(error){issues.push(error.message);}
 return issues;
}
async function capture({date,runId,cutoff,directory,diagnostic=false}){
 const sourceUrl=urlFor(date);let last;
 for(let attempt=1;attempt<=2;attempt++)try{
  const response=await fetch(sourceUrl,{headers:{"user-agent":"FumanMorningReport/1.0"},signal:AbortSignal.timeout(12000)});if(!response.ok)throw Error("night_futures_http_"+response.status);
  const raw=await response.text(),fields=parse(raw,date);fs.mkdirSync(directory,{recursive:true});const rawReceipt=path.join(directory,"night-futures-"+runId.replace(/[^a-zA-Z0-9_-]/g,"_")+".html");fs.writeFileSync(rawReceipt,raw);
  const e={contract:CONTRACT,ok:true,run_id:runId,source:SOURCE,source_url:sourceUrl,...fields,fetched_at:new Date().toISOString(),response_sha256:sha(raw),raw_receipt:rawReceipt};const issues=verify(e,{date,runId,cutoff,diagnostic});if(issues.length)throw Error(issues.join(";"));return e;
 }catch(error){last=error;}
 throw last;
}
function summary(e){return e?.ok?`台指夜盤 TX ${e.contract_month}｜收 ${e.close}｜${e.change>=0?"+":""}${e.change} 點（${e.change_percent>=0?"+":""}${e.change_percent.toFixed(2)}%）｜成交 ${e.volume} 口｜夜盤 ${e.session_start.slice(0,10)} 15:00～${e.session_end.slice(0,10)} 05:00｜歸屬交易日 ${e.trade_date}`:"台指夜盤：本批次尚無已驗證資料";}
module.exports={CONTRACT,SOURCE,parse,capture,verify,summary,urlFor};
