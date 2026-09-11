"use strict";
// Versioned, deterministic rules. No orders and no post-open price inputs.
const VERSION = "opening_prediction_v2";
const finite = x => x !== null && x !== undefined && x !== "" && Number.isFinite(Number(x));
const num = x => finite(x) ? Number(x) : NaN;
function indicators(bars) {
  const b = bars.map(x => ({high:num(x.high ?? x.max), low:num(x.low ?? x.min), close:num(x.close)}));
  if (b.length < 16 || b.some(x => !Object.values(x).every(Number.isFinite))) return {available:false, version:VERSION};
  let k=50,d=50,gain=0,loss=0,prev=null,last=null;
  for(let i=0;i<b.length;i++) {
    if(i>=4) {const w=b.slice(i-4,i+1),hi=Math.max(...w.map(x=>x.high)),lo=Math.min(...w.map(x=>x.low)); const rsv=hi===lo?50:100*(b[i].close-lo)/(hi-lo); k=(2*k+rsv)/3; d=(2*d+k)/3;}
    if(i>0) {const diff=b[i].close-b[i-1].close;
      if(i<=14){gain+=Math.max(diff,0)/14;loss+=Math.max(-diff,0)/14;}
      else {gain=(gain*13+Math.max(diff,0))/14;loss=(loss*13+Math.max(-diff,0))/14;}
    }
    if(i>=14){prev=last;last={k,d,rsi:loss===0?(gain===0?50:100):100-100/(1+gain/loss)};}
  }
  return {available:true,version:VERSION,...last,previous_k:prev.k,previous_d:prev.d,previous_rsi:prev.rsi,
    kd_up:last.k>prev.k&&last.d>prev.d,rsi_up:last.rsi>prev.rsi,
    kd_rsi_up:last.k>prev.k&&last.d>prev.d&&last.rsi>prev.rsi,
    kd_rsi_down:last.k<prev.k&&last.d<prev.d&&last.rsi<prev.rsi,
    overheated:last.k>90,bar_count:b.length,formula:"RSV(5), K/D smoothing 3/3 seed50; Wilder RSI(14); both K,D rising"};
}
function completeHours(rows, signalDate) {
  const groups=new Map();
  for(const r of rows){
    if(r.synthetic===true || !/([zZ]|[+-]\d{2}:\d{2})$/.test(String(r.candle_time)))continue;
    const time=Date.parse(r.candle_time); if(!Number.isFinite(time))continue;
    const local=new Date(time+8*3600000).toISOString(),day=local.slice(0,10),h=Number(local.slice(11,13)),m=Number(local.slice(14,16));
    // The final session bar closes at 13:30 (some vendors label it 14:00).
    // 13:25-13:29 are auction order collection, not missing trade minutes.
    // Delayed closing may match at 13:33; never synthesize the auction gap.
    if(day>signalDate||h<9||h>13||(h===13&&m>=25&&m!==30&&m!==33))continue;
    const key=day+"T"+String(h).padStart(2,"0"),g=groups.get(key)||new Map();g.set(m,r);groups.set(key,g);
  }
  return [...groups].sort(([a],[b])=>a.localeCompare(b)).filter(([key,g])=>key.endsWith('T13')?(g.size===26&&(g.has(30)||g.has(33))):g.size===60).map(([key,g])=>{
    const b=[...g].sort(([a],[b])=>a-b).map(([,r])=>r);
    return {date:key.slice(0,10),timestamp:key,session_tail:key.endsWith('T13'),source_minutes:g.size,open:num(b[0].open),high:Math.max(...b.map(r=>num(r.high))),low:Math.min(...b.map(r=>num(r.low))),close:num(b.at(-1).close)};
  });
}
function predict(source, preopen, shortSignal, matchedRules=[]) {
  const daily=source.daily_indicators,hourly=source.hourly_indicators;
  const initial=daily?.kd_rsi_up&&hourly?.kd_rsi_up?"多":daily?.kd_rsi_down&&hourly?.kd_rsi_down?"空":"";
  const gaps=[];const reject=[];
  const result=(direction,reason,pattern)=>({direction,label:direction||"不交易",reason,pattern,initial_direction:initial,confirmation:direction?"08:45／08:50試撮確認":"不交易",version:VERSION,data_gaps:gaps,rejections:reject});
  const slots=["0845","0850"].map(s=>preopen?.slots?.find(x=>x.capture_slot===s));
  if(slots.some(s=>!s||s.present!==true||s.natural_schedule_evidence!==true||s.is_trial!==true||s.has_trial_price!==true||!(num(s.trial_price)>0)||!finite(s.trial_change_pct))){gaps.push("DATA_GAP_TRIAL_PRICE");return result("","缺少08:45／08:50天然試撮，等待有效資料","TRIAL_DATA_GAP");}
  const pct=num(slots[1].trial_change_pct);
  if(shortSignal?.matched===true&&shortSignal.checks?.kgi_chengzhong_present===true){
    if(pct>=3&&pct<=5)return result("空",`T-1開盤空獨立條件成立；凱基－城中；兩次天然試撮；08:50上漲${pct}%`,"LIMIT_UP_KD_PREOPEN_HIGH_SHORT");
    reject.push("SHORT_TRIAL_OUTSIDE_3_5");
    return result("",`開盤空試撮${pct}%，未落入+3%～+5%；近平盤或-1%～-3%僅列多方觀察`,"SHORT_NO_TRADE");
  }
  for(const [name,i] of [["DAILY",daily],["60M",hourly]]) {
    if(!i?.available||i.version!==VERSION)gaps.push(`DATA_GAP_T_MINUS_1_${name}_KD_RSI_UP`);
    else if(!i.kd_rsi_up)reject.push(`T_MINUS_1_${name}_KD_RSI_NOT_UP`);
  }
  if(gaps.length||reject.length)return result("",[...gaps,...reject].join("；"),"LONG_TREND_NOT_CONFIRMED");
  if(!matchedRules.length)return result("","未命中開盤多策略1～10","NO_MATCHED_LONG_STRATEGY");
  if(pct<=-9.5)return result("","08:50試撮仍呈跌停型態，取消多方","PREOPEN_LONG_CANCELLED");
  return result("多",`日K及最後完整60分K：KD／RSI均向上；命中${matchedRules.length}項策略；兩次天然試撮確認，08:50 ${pct}%`,"LONG_TREND_STRATEGY_TRIAL_CONFIRMED");
}
module.exports={VERSION,indicators,completeHours,predict};
