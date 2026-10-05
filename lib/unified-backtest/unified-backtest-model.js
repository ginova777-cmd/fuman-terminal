(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.UnifiedBacktestModel=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  function validateFilters(f){
    if(f.direction&&!['LONG','SHORT'].includes(f.direction))throw Error('INVALID_DIRECTION_FILTER');
    for(const d of [f.from,f.to])if(d&&(typeof d!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(d)||!Number.isFinite(Date.parse(d))||new Date(d).toISOString().slice(0,10)!==d))throw Error('INVALID_DATE_FILTER');
    if(f.from&&f.to&&f.from>f.to)throw Error('INVALID_DATE_RANGE');
  }
  function isActiveStrategy(value){return !/^(?:strategy[ _-]*2|策略\s*2)(?![0-9])/i.test(String(value||'').trim());}
  function select(data,f){validateFilters(f);return (data.signals||[]).filter(s=>isActiveStrategy(s.strategy_id)&&s.run_type!=='SIMULATION'&&(!f.strategy||s.strategy_id===f.strategy)&&(!f.direction||s.direction===f.direction)&&s.source_mode===f.source&&(!f.type||s.candidate_status===f.type)&&(!f.status||(s.outcome?.status||'PENDING')===f.status)&&(!f.from||s.signal_date>=f.from)&&(!f.to||s.signal_date<=f.to));}
  function summarize(rows){
    const scored=rows.filter(s=>s.run_type!=='SIMULATION'&&['FORWARD_RECORDED','HISTORICAL_REPLAY'].includes(s.source_mode)&&s.eligible===true&&s.outcome?.status==='COMPLETE'&&typeof s.outcome.metrics?.success==='boolean');
    const wins=scored.filter(s=>s.outcome.metrics.success).length;
    const mean=k=>{const values=scored.map(s=>s.outcome.metrics[k]).filter(Number.isFinite);return values.length?values.reduce((a,b)=>a+b,0)/values.length:null;};
    const targets={};for(const s of scored)for(const [key,value] of Object.entries(s.outcome.metrics.targets||{})){if(typeof value!=='boolean')continue;const t=targets[key]||(targets[key]={wins:0,total:0});t.total++;if(value)t.wins++;}
    return {total:rows.length,denominator:scored.length,wins,rate:scored.length?wins/scored.length:null,coverage:rows.length?scored.length/rows.length:null,MFE:mean('MFE'),MAE:mean('MAE'),targets,pending:rows.filter(s=>!s.outcome||s.outcome.status==='PENDING').length};
  }
  function groups(rows){const grouped=new Map();for(const s of rows){const key=JSON.stringify([s.strategy_id,s.strategy_version,s.source_mode,s.candidate_status,s.direction,s.holding_horizon,s.success_rule]);if(!grouped.has(key))grouped.set(key,{strategy_id:s.strategy_id,version:s.strategy_version,source:s.source_mode,type:s.candidate_status,direction:s.direction,horizon:s.holding_horizon,rule:s.success_rule,rows:[]});grouped.get(key).rows.push(s);}return [...grouped.values()].map(({rows,...g})=>({...g,...summarize(rows)}));}
  function researchGroups(rows){
    const grouped=new Map();
    for(const s of rows){const o=s.outcome?.original_research,b=o?.OHLC;
      if(s.source_mode!=='RECOVERED_RECORD'||o?.status!=='OBSERVED_DAILY_RESEARCH_UNVERIFIED'||o.evaluation_type!=='HYPOTHETICAL_DAILY_OPEN_RESEARCH'||!['LONG','SHORT'].includes(s.direction)||!b||!['open','high','low','close'].every(k=>Number.isFinite(b[k])&&b[k]>0)||b.high<Math.max(b.open,b.low,b.close)||b.low>Math.min(b.open,b.close))continue;
      const key=JSON.stringify([s.strategy_id,s.strategy_version,s.direction]);if(!grouped.has(key))grouped.set(key,{strategy:s.strategy_id,version:s.strategy_version,direction:s.direction,n:0,hits:0,MFE:0,MAE:0});
      const g=grouped.get(key),long=s.direction==='LONG';g.n++;if(long?b.close>b.open:b.close<b.open)g.hits++;g.MFE+=(long?b.high-b.open:b.open-b.low)/b.open*100;g.MAE+=(long?b.low-b.open:b.open-b.high)/b.open*100;
    }
    return [...grouped.values()].map(g=>({...g,rate:g.hits/g.n,MFE:g.MFE/g.n,MAE:g.MAE/g.n}));
  }
  return {isActiveStrategy,select,summarize,groups,researchGroups,validateFilters};
});
