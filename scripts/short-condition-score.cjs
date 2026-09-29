'use strict';
const number=v=>typeof v==='number'&&Number.isFinite(v);
function calculate(row,scenario='A'){const p=row.premarket_final||{},d=row.daily_metrics||{};
 const change=number(d.change_percent)?d.change_percent>5:null,limit=typeof d.limit_locked==='boolean'?d.limit_locked:null;
 const checks={
  '總成交量>2000張':number(d.volume_lots)?d.volume_lots>2000:null,
  '布林位階<8':number(p.boll_level_raw)?p.boll_level_raw<8:null,
  '月線斜率<0':number(p.month_slope_raw)?p.month_slope_raw<0:null,
  '日K低於三均線':typeof d.price_below_all_ma==='boolean'?d.price_below_all_ma:null,
  '60分K低於三均線':typeof row.hourly_evidence?.price_below_all_ma==='boolean'?row.hourly_evidence.price_below_all_ma:null,
  '週轉率>5%':number(row.turnover_rate)?row.turnover_rate>5:null,
  '漲幅>5%或收盤漲停':change===true||limit===true?true:change===null||limit===null?null:false,
  'Telegram已通知盤中巨量':row.telegram_intraday_notification?.status==='SENT'?true:row.telegram_intraday_notification?.status==='NO_SENT_BURST'?false:null
 };if(scenario==='B'){
 delete checks['布林位階<8'];delete checks['月線斜率<0'];
 checks['B布林位置符合']=number(p.boll_level_raw)?Math.round(p.boll_level_raw)>=8:null;
 checks['月斜率連降至少2日']=number(p.slope_down_days)?p.slope_down_days>=2:null;
 checks['漲停＋凱基城中買一成本等於收盤']=row.branch_priority?.matched??null;
 }const values=Object.values(checks);return{score:values.filter(v=>v===true).length,max_score:values.length,checks,missing:Object.entries(checks).filter(([,v])=>v===null).map(([k])=>k),method:'每個獨立條件符合加1分；法人、自營商、分點數值僅顯示；非勝率'};
}
function compare(a,b){return b.condition_score.score-a.condition_score.score||['A','B','WATCH'].indexOf(a.premarket_final.short_candidate_grade)-['A','B','WATCH'].indexOf(b.premarket_final.short_candidate_grade)||a.symbol.localeCompare(b.symbol);}
module.exports={calculate,compare};
