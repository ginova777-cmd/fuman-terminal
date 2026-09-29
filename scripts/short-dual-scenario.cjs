'use strict';
const finite=x=>typeof x==='number'&&Number.isFinite(x);
function evaluate(p,row={}){
 const level=p.boll_level_raw,slope=p.month_slope_raw,d=row.daily_metrics||{};
 const aPass=['A','B','WATCH'].includes(p.short_candidate_grade);
 const high=finite(level)&&Math.round(level)>=8;
 const backgrounds={
  '當日漲幅>5%':finite(d.change_percent)?d.change_percent>5:null,
  '收盤漲停':typeof d.limit_locked==='boolean'?d.limit_locked:null,
  '已通知盤中巨量':row.telegram_intraday_notification?.status==='SENT'?true:row.telegram_intraday_notification?.status==='NO_SENT_BURST'?false:null
 };
 const background_evidence=Object.entries(backgrounds).filter(([,v])=>v===true).map(([k])=>k);
 const signals={'60分K轉弱':row.hourly_evidence?.trend==='TURNING_BEARISH','日K三均線下彎':d.all_ma_down===true};
 const evidence=Object.entries(signals).filter(([,v])=>v).map(([k])=>k);
 const pass=high&&background_evidence.length>0;
 const grade=pass?(evidence.length?'B-CANDIDATE':'B-WATCH'):!finite(level)||high&&Object.values(backgrounds).some(v=>v===null)?'UNKNOWN':'REJECT';
 return {version:'DUAL_SCENARIO_ROUNDED_HIGH_8_V2',a:{pass:aPass,grade:p.short_candidate_grade,position:!finite(level)?'UNKNOWN':level>=8?'REJECT_HIGH':level>=3?'BEST':level>=0?'ACCEPTABLE':level>-5?'LOW_WARNING':'REJECT_OVERSOLD',trend_strength:!finite(slope)?'UNKNOWN':slope>=0?'REJECT':slope>-.3?'A-WATCH':slope>-.6?'A-PASS':'A-STRONG'},b:{pass,level_gate_value:finite(level)?Math.round(level):null,level_gate_policy:'round_integer_gte_8',needs_evidence:high,grade,zone:!finite(level)?'UNKNOWN':level>=12?'極高位階':level>=10?'上軌／過熱區':high?'高位階觀察區':'未達高位階',backgrounds,background_evidence,signals,evidence,momentum_slowing:finite(p.slope_delta)?p.slope_delta<0:null,confirmed:null,confirmation_status:'WAIT_INTRADAY_STRUCTURE',reason:pass?'位階四捨五入≥8且有急漲／漲停／巨量背景；等待出貨轉弱':!high?'四捨五入未達位階8':'急漲／漲停／巨量背景未確認',signal_policy:'Existing change>5%, closing limit, sent volume notification; unquantified long-shadow/distribution patterns are not inferred',short_entry_signal:null},scope:'PREMARKET_CANDIDATES_ONLY'};
}
module.exports={evaluate};
