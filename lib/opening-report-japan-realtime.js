"use strict";
const crypto = require("crypto");
const SYMBOLS = Object.freeze(["4062.T", "6787.T", "6981.T", "6506.T", "6273.T"]);
const PROVIDER = "yahoo_japan_tse_realtime_v1";
const SOURCE = "Yahoo! Japan Finance TSE real-time";
const FIELDS = Object.freeze(["codeWithMarketExtension", "price.value", "priceChangeRate.value", "japanUpdateTime", "delayMinutes", "openPrice.updateDateMeta", "previousPrice.value"]);
function inWindow(ms, date) { return Number.isFinite(ms) && ms >= Date.parse(`${date}T08:00:00+08:00`) && ms <= Date.parse(`${date}T08:30:59.999+08:00`); }
function numeric(value) { const s=String(value ?? "").replace(/,/g, "").trim(); return /^[+-]?\d+(?:\.\d+)?$/.test(s) ? Number(s) : NaN; }
function clockMs(value, date) { const s=String(value || ""); const m=s.match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/); return m && +m[1]<24 && +m[2]<60 && +(m[3]||0)<60 ? Date.parse(`${date}T${m[1]}:${m[2]}:${m[3]||"00"}+09:00`) : NaN; }
// Decode JSON transport only; never evaluate page JavaScript or mix PTS with TSE.
function pageState(html) {
  let flight="";
  for(const m of String(html).matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) {
    const text=m[1].trim(); const prefix="self.__next_f.push(";
    if(!text.startsWith(prefix)) continue;
    try { const a=JSON.parse(text.slice(prefix.length).replace(/\);?$/, "")); if(a[0]===1 && typeof a[1]==="string") flight+=a[1]; } catch {}
  }
  const boards=[], indicators=[];
  function walk(value,depth=0) {
    if(depth>40) return;
    if(typeof value==="string" && value.startsWith("{")) { try { walk(JSON.parse(value),depth+1); } catch {} return; }
    if(!value || typeof value!=="object") return;
    if(value.priceBoard?.board) boards.push(value.priceBoard.board);
    if(value.indicators?.openPrice && value.indicators?.previousPrice) indicators.push(value.indicators);
    for(const child of Object.values(value)) walk(child,depth+1);
  }
  for(const line of flight.split("\n")) { try { walk(JSON.parse(line.slice(line.indexOf(":")+1))); } catch {} }
  return {boards,indicators};
}
function evidenceCheck(e, symbol, date) {
  if(!SYMBOLS.includes(symbol) || e?.symbol!==symbol) return "japan_realtime_symbol_mismatch";
  if(e.delay_minutes!==0) return "japan_realtime_delayed_quote";
  const openMs=Date.parse(e.open_time);
  if(!Number.isFinite(openMs) || !String(e.open_time).startsWith(date+"T") || !String(e.open_time).endsWith("+09:00")) return "japan_realtime_trade_date_mismatch";
  const quoteMs=clockMs(e.quote_clock,date), fetchedMs=Date.parse(e.fetched_at);
  if(!inWindow(quoteMs,date) || openMs>quoteMs) return "japan_realtime_quote_outside_0800_0830_window";
  if(!inWindow(fetchedMs,date) || quoteMs>fetchedMs) return "japan_realtime_capture_outside_0800_0830_window";
  const price=numeric(e.price), previous=numeric(e.previous_price), percent=numeric(e.percent);
  if(!(price>0) || !(previous>0) || !Number.isFinite(percent)) return "japan_realtime_numeric_missing";
  if(Math.abs((price/previous-1)*100-percent)>0.02) return "japan_realtime_percent_inconsistent";
  if(!/^[a-f0-9]{64}$/.test(e.response_sha256 || "")) return "japan_realtime_response_digest_missing";
  return null;
}
function parseQuote(html, symbol, date, fetchedAt) {
  const base={ok:false,source:SOURCE,source_url:`https://finance.yahoo.co.jp/quote/${symbol}`,ticker:symbol,source_provider:PROVIDER,source_fields:[...FIELDS],session_contract:"08:00-08:30 Asia/Taipei"};
  const {boards,indicators}=pageState(html);
  if(boards.length!==1 || indicators.length!==1) return {...base,reason_code:"japan_realtime_page_shape_changed"};
  const board=boards[0], detail=indicators[0];
  const evidence={symbol:board.codeWithMarketExtension,delay_minutes:board.delayMinutes,quote_clock:board.japanUpdateTime,open_time:detail.openPrice.updateDateMeta,price:board.price?.value,previous_price:detail.previousPrice.value,percent:board.priceChangeRate?.value,fetched_at:fetchedAt,response_sha256:crypto.createHash("sha256").update(html).digest("hex")};
  const reason=evidenceCheck(evidence,symbol,date);
  if(reason) return {...base,source_evidence:evidence,reason_code:reason};
  const percent=numeric(evidence.percent);
  return {...base,ok:true,source_evidence:evidence,selected_time:new Date(clockMs(evidence.quote_clock,date)).toISOString(),close:numeric(evidence.price),previous_close:numeric(evidence.previous_price),percent,direction:percent>0.3?"positive":percent< -0.3?"negative":"neutral",display:percent>0.3?"偏強":percent< -0.3?"偏弱":"中性",reason_code:"japan_tse_realtime_primary"};
}
const cache=new Map();
async function snapshot(leader,date) {
  const symbol=leader.yahoo;
  if(!SYMBOLS.includes(symbol)) throw new Error(`japan_realtime_symbol_not_authorized:${symbol}`);
  const key=`${date}:${symbol}`;
  if(!cache.has(key)) cache.set(key,(async()=>{
    const base={ok:false,source:SOURCE,source_url:`https://finance.yahoo.co.jp/quote/${symbol}`,source_provider:PROVIDER,source_fields:[...FIELDS]};
    // A replay or late run cannot replace the frozen early-session evidence.
    if(!inWindow(Date.now(),date)) return {...base,reason_code:"japan_realtime_capture_outside_0800_0830_window"};
    const attempts=[];
    for(let attempt=1;attempt<=2;attempt++) {
      if(!inWindow(Date.now(),date)) break;
      try {
        const response=await fetch(base.source_url,{headers:{"user-agent":"Mozilla/5.0 FumanTerminal/1.0"},signal:AbortSignal.timeout(7000)});
        attempts.push({attempt,status:response.status});
        if(response.ok) { const html=await response.text(); return {...parseQuote(html,symbol,date,new Date().toISOString()),attempts}; }
        if(response.status<500 && response.status!==429) break;
      } catch(error) { attempts.push({attempt,error:error.message}); }
    }
    return {...base,attempts,reason_code:"japan_realtime_fetch_failed"};
  })());
  return cache.get(key);
}
function receiptValid(row,date) {
  if(row.source!==SOURCE || row.source_provider!==PROVIDER || row.source_url!==`https://finance.yahoo.co.jp/quote/${row.yahoo_symbol}`) return false;
  if(evidenceCheck(row.source_evidence,row.yahoo_symbol,date)) return false;
  return row.source_time===new Date(clockMs(row.source_evidence.quote_clock,date)).toISOString() && row.percent===numeric(row.source_evidence.percent) && row.close===numeric(row.source_evidence.price) && row.previous_close===numeric(row.source_evidence.previous_price) && FIELDS.every(f=>row.source_fields?.includes(f));
}
module.exports={SYMBOLS,PROVIDER,SOURCE,FIELDS,inWindow,pageState,parseQuote,snapshot,evidenceCheck,receiptValid};
