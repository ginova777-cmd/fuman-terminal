'use strict';
function compare({current,previous,tradeDate,canonicalRunId,asOf}){
 const gap=reason=>({comparable:false,status:'NOT_COMPARABLE',reason,delta:null,window_seconds:null,previous_round_id:previous?.writer_run_id||null,current_round_id:current?.writer_run_id||null});
 if(!current||!previous)return gap('PREVIOUS_ROUND_MISSING');
 if([current,previous].some(r=>r.trade_date!==tradeDate||r.canonical_run_id!==canonicalRunId))return gap('ROUND_IDENTITY_MISMATCH');
 if(!current.writer_run_id||!previous.writer_run_id||current.writer_run_id===previous.writer_run_id)return gap('WRITER_ROUND_NOT_DISTINCT');
 if((current.formula_version||previous.formula_version)&&current.formula_version!==previous.formula_version)return gap('FORMULA_VERSION_MISMATCH');
 const end=Date.parse(asOf),start=Date.parse(previous.updated_at),now=Date.parse(current.updated_at),seconds=(now-start)/1000;
 if(![end,start,now].every(Number.isFinite)||now>end||seconds<=0||seconds>300)return gap('ROUND_TIME_NOT_COMPARABLE');
 const a=current.symbols,b=previous.symbols;
 if(!Array.isArray(a)||!Array.isArray(b)||!a.length||new Set(a).size!==a.length||new Set(b).size!==b.length||a.length!==b.length||a.some(s=>!b.includes(s)))return gap('INDUSTRY_MEMBERS_CHANGED');
 if(!Number.isFinite(current.net_flow_proxy)||!Number.isFinite(previous.net_flow_proxy))return gap('FLOW_VALUE_MISSING');
 return {comparable:true,status:'COMPARABLE',reason:null,delta:Math.round(current.net_flow_proxy-previous.net_flow_proxy),window_seconds:seconds,previous_round_id:previous.writer_run_id,current_round_id:current.writer_run_id};
}
module.exports={compare};
