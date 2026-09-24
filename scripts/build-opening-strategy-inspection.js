"use strict";
const fs=require('fs'),crypto=require('crypto');
const arg=n=>process.argv.find(x=>x.startsWith(`--${n}=`))?.slice(n.length+3);
function inspect(raw) {
 if(raw.ok!==true||!Array.isArray(raw.rows)||!Array.isArray(raw.symbols_requested))throw Error('Detection source invalid');
 const symbols=raw.rows.map(r=>String(r.symbol));
 if(new Set(symbols).size!==symbols.length||JSON.stringify([...symbols].sort())!==JSON.stringify([...raw.symbols_requested].map(String).sort()))throw Error('Detection coverage mismatch');
 const labels=Object.values(raw.rule_definitions||{}).sort((a,b)=>a.no-b.no);
 if(labels.length!==10||labels.some((x,i)=>x.no!==i+1))throw Error('Ten rule definitions required');
 const finite=x=>x!==null&&x!==undefined&&Number.isFinite(Number(x));
 const rows=raw.rows.map(row=>{
  const e=row.evidence||{},g=row.data_gaps||[],hasDaily=finite(e.close)&&finite(e.previous_close);
  const hasIndustry=Array.isArray(e.opening_report_run_ids)&&e.opening_report_run_ids.length>0;
  const hasTrial=['0845','0850'].every(slot=>e.preopen_slots?.some(s=>s.capture_slot===slot&&s.is_trial===true&&s.natural_schedule_evidence===true&&s.has_trial_price===true&&s.has_fut_price===true));
  const strategies=labels.map(({no,label})=>{
   const missing=[];
   if(!hasDaily)missing.push('日K資料缺口');
   if(no===1&&!finite(e.main_force_cost_top10))missing.push('主力成本缺口');
   if(no===2&&g.includes('institutional_two_day_history_missing'))missing.push('法人兩日資料缺口');
   if([3,4,5,7,9].includes(no)&&!hasIndustry)missing.push('海外產業證據缺口');
   if(no===3&&!finite(e.ma60))missing.push('MA60缺口');
   if(no===4&&!finite(e.ma240))missing.push('MA240缺口');
   if([5,6,10].includes(no)&&!hasTrial)missing.push('天然試撮／股期缺口');
   if(no===8&&e.overnight_trader_style?.available!==true)missing.push('隔日沖分點缺口');
   if(no===9&&!finite(e.main_force_cost_top10)&&!finite(e.ma60))missing.push('關鍵價位缺口');
   // A proven false prerequisite rejects a conjunction even if another input is absent.
   // Missing inputs must not mask already evaluated local chart conditions.
   const rejected=[];
   if(hasDaily){
    if(no===1&&e.limit_down_reopened===false)rejected.push('未符合跌停打開');
    if(no===2&&e.daily_history_count>=3&&(e.two_day_up===false||e.rebound_from_low===false))rejected.push('未符合低點反彈及連漲2日');
    if(no===2&&!g.includes('institutional_two_day_history_missing')&&e.institution_same_buy_2d===false)rejected.push('法人未連續2日同買');
    if(no===3&&finite(e.ma60)&&e.ma60_support_retest===false)rejected.push('未回測MA60有撐');
    if(no===4&&e.daily_history_count>=241&&finite(e.ma240)&&e.ma240_breakout===false)rejected.push('未突破MA240');
    if(no===8&&e.daily_history_count>=9&&e.w_neckline?.two_day_hold===false)rejected.push('W底頸線未站穩2日');
    if(no===9&&e.key_level_two_day_hold===false&&(finite(e.main_force_cost_top10)||finite(e.ma60)))rejected.push('關鍵價位未守住2日');
    if(no===10&&e.previous_limit_up===false)rejected.push('昨日未漲停');
   }
   if(hasIndustry&&[3,4,5,9].includes(no)&&e.opening_report_sector_up_1d===false)rejected.push('對應海外族群未上漲');
   if(hasIndustry&&no===7&&e.opening_report_sector_up_2d===false)rejected.push('對應海外族群未連續2日轉強');
   const matched=(row.matched_strategy_numbers||[]).map(Number).includes(no);
   return {no,label,status:rejected.length?'NOT_MATCHED':missing.length?'DATA_GAP':matched?'MATCHED':'NOT_MATCHED',reason:rejected.join('；')||missing.join('；')||(matched?'策略前置條件命中':'策略前置條件未命中'),unavailable_inputs:missing};
  });
  return {symbol:String(row.symbol),strategies,matched_strategy_numbers:strategies.filter(s=>s.status==='MATCHED').map(s=>s.no),pending_strategy_numbers:strategies.filter(s=>s.status==='DATA_GAP').map(s=>s.no),prediction_qualification:row.status,prediction_reason:row.tomorrow_prediction_reason||row.first_blocker||''};
 });
 const summary=labels.map(({no,label})=>({strategy:no,label,checked:rows.length,matched:rows.filter(r=>r.strategies[no-1].status==='MATCHED').length,not_matched:rows.filter(r=>r.strategies[no-1].status==='NOT_MATCHED').length,data_gap:rows.filter(r=>r.strategies[no-1].status==='DATA_GAP').length}));
 return {ok:true,contract:'opening_strategy_inspection_v1',trade_date:raw.trade_date,checked_at:new Date().toISOString(),source_checked_at:raw.checked_at,inspection_only:true,description:'獨立策略檢查；不改寫08:50預言，命中不等於多方資格通過',symbol_count:rows.length,summary,rows,failed_checks:[],first_blocker:null};
}
if(require.main===module){const bytes=fs.readFileSync(arg('input'));const result=inspect(JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,'')));result.source_sha256=crypto.createHash('sha256').update(bytes).digest('hex');fs.writeFileSync(arg('output'),JSON.stringify(result,null,2));console.log(JSON.stringify(result.summary,null,2));}
module.exports={inspect};
