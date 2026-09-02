"use strict";
const fs = require("fs");
const path = require("path");
const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.FUMAN_SUPABASE_URL || "https://cpmpfhbzutkiecccekfr.supabase.co").replace(/\/+$/, "");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
function readText(file) { try { return fs.readFileSync(file, "utf8").trim(); } catch { return ""; } }
const KEY = process.env.SUPABASE_ANON_KEY || process.env.FUMAN_SUPABASE_ANON_KEY || readText(path.join(RUNTIME_DIR, "secrets", "supabase-anon-key.txt"));
function arg(name, fallback = "") { const p=`--${name}=`; return process.argv.find((v)=>v.startsWith(p))?.slice(p.length)||fallback; }
function taipeiDate(){return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());}
function positive(v){const n=Number(v);return Number.isFinite(n)&&n>0;}
async function main(){
  if(!KEY) throw new Error("missing_supabase_anon_key");
  const tradeDate=arg("trade-date",taipeiDate());
  const symbols=[...new Set(arg("symbols","").split(/[,+]/).map((v)=>v.replace(/\D/g,"").slice(0,4)).filter((v)=>/^\d{4}$/.test(v)))];
  const params=new URLSearchParams({select:"*",trade_date:`eq.${tradeDate}`,order:"symbol.asc",limit:"5000"});
  if(symbols.length) params.set("symbol",`in.(${symbols.join(",")})`);
  const response=await fetch(`${SUPABASE_URL}/rest/v1/v_fugle_daytrade_star_preopen_readback?${params}`,{headers:{apikey:KEY,Authorization:`Bearer ${KEY}`,Accept:"application/json"},signal:AbortSignal.timeout(20000)});
  const body=await response.text(); if(!response.ok) throw new Error(`star_readback_HTTP_${response.status}:${body.slice(0,240)}`);
  const rows=body?JSON.parse(body):[]; const failures=[];
  if(!rows.length) failures.push("all_stock_future_near_one_rows_missing");
  const cases=rows.map((row)=>{
    const futureUsable=Boolean(row.future_symbol)&&!String(row.future_symbol).startsWith("TXF")&&positive(row.futopt_last_price)&&row.empty_shell_row!==true;
    const preopenUsable=positive(row.trial_price)&&positive(row.reference_price)&&Number(row.preopen_snapshot_count)>0;
    const nearOne=row.near_one_present===true;
    if(row.star_final_ok===true&&(!futureUsable||!preopenUsable||!nearOne)) failures.push(`${row.symbol}:star_pass_with_missing_evidence`);
    if(!preopenUsable&&row.star_final_ok===true) failures.push(`${row.symbol}:missing_preopen_must_fail_closed`);
    if(!preopenUsable&&!String(row.display_label||"").includes("試撮")&&!String(row.data_gap_reason||"").includes("試撮")) failures.push(`${row.symbol}:preopen_gap_not_visible`);
    return {symbol:row.symbol,future_symbol:row.future_symbol,future_ok:row.future_ok,preopen_ok:row.preopen_ok,near_one_present:nearOne,preopen_snapshot_count:Number(row.preopen_snapshot_count||0),star_final_ok:row.star_final_ok,data_gap_reason:row.data_gap_reason,display_label:row.display_label};
  });
  const output={ok:failures.length===0,contract:"daytrade_futopt_star_readback_readonly_v2",view:"v_fugle_daytrade_star_preopen_readback",scope:symbols.length?"requested_symbols":"all_stock_future_near_one",trade_date:tradeDate,row_count:rows.length,checked_at:new Date().toISOString(),cases,failed_checks:failures,first_blocker:failures[0]||null,read_only:true};
  console.log(JSON.stringify(output,null,2)); process.exitCode=output.ok?0:1;
}
main().catch((error)=>{console.error(JSON.stringify({ok:false,contract:"daytrade_futopt_star_readback_readonly_v2",failed_checks:[error.message],first_blocker:error.message,read_only:true},null,2));process.exitCode=1;});