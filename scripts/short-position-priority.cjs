'use strict';
function evaluate(b,daily,hourly,ema,matched,c){
 const raw=b.boll_position_raw,eligible=raw===null?null:raw<b.parameters.weak_threshold;
 const matches=raw===null?[]:c.groups.filter(g=>(g.min===null||raw>=g.min)&&(g.max===null||raw<g.max));
 if(eligible&&matches.length!==1)throw Error('PRIORITY_CONFIG_OVERLAP_OR_GAP');
 const g=eligible?matches[0]:{group:raw===null?'UNKNOWN':'EXCLUDE',rank:99,score:0,label:raw===null?'資料不足':'排除弱勢空'};
 const ds=c.daily_scores[daily]??null,hs=c.hourly_scores[hourly]??null;
 const ms=(b.ma20_slope_1d<0?c.slope_1d_score:0)+(b.ma20_slope_5d<0?c.slope_5d_score:0);
 const chips=Object.entries(c.chip_condition_weights).reduce((s,[id,w])=>s+(matched.includes(Number(id))?w:0),0);
 const valid=eligible===true&&b.ma20_trend==='DOWN';
 const tier=raw===null?'UNKNOWN':!eligible?'EXCLUDE':!valid?'C':daily==='BEARISH'&&['BEARISH','TURNING_BEARISH'].includes(hourly)?'A':'B';
 const missing=[daily==='UNKNOWN'?'日K方向':null,hourly==='UNKNOWN'?'60分K方向':null,ema==='UNKNOWN'?'30分EMA方向':null,b.ma20_trend==='UNKNOWN'?'月線雙斜率':null].filter(Boolean);
 return {short_position_eligible:eligible,short_position_valid:valid,position_group:g.group,priority_rank:g.rank,priority_score:g.score,priority_label:g.label,daily_trend:daily,hourly_trend:hourly,ema30_trend:ema,daily_trend_score:ds,hourly_trend_score:hs,ma20_trend_score:ms,trend_score:(ds??0)+(hs??0)+ms,chip_score:chips,final_short_score:raw===null?null:g.score+(ds??0)+(hs??0)+ms+chips,candidate_tier:tier,main_list:valid,score_status:missing.length?'PARTIAL':'OK',missing_sources:missing,reason:raw===null?'布林資料不足':`${g.group} ${g.label}；月線${b.ma20_trend}；日K ${daily}；60分K ${hourly}；${tier}級${valid?'觀察候選':'，不列主要名單'}`,creates_order:false,short_entry_signal:null};
}
const compare=(a,b)=>b.final_short_score-a.final_short_score||a.priority_rank-b.priority_rank||a.symbol.localeCompare(b.symbol);
module.exports={evaluate,compare};
