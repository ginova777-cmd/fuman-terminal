'use strict';
const {evaluateTradeValue}=require('./daytrade-trade-value-evidence');
const {compare}=require('./mother-pool-industry-round-delta');
const round=x=>Number(x.toFixed(2));
function verify(moduleId,row,artifact){
 try{
  const d=artifact.writer_write_set.plan.source_evidence.discovery,groups=new Map();
  if(d.trade_date!==artifact.trade_date||d.canonical_run_id!==artifact.canonical_run_id||new Set(d.source_rows.map(x=>x.symbol)).size!==d.source_rows.length)return false;
  if(d.requested_symbols.length!==artifact.requested_symbols.length||d.requested_symbols.some(s=>!artifact.requested_symbols.includes(s)))return false;
  for(const s of d.source_rows){
   if(require('./verify-mother-pool-industry-mapping').evaluate({symbol:s.symbol,classification:s.classification,tradeDate:artifact.trade_date,asOf:artifact.observed_at}).failed_checks.length)return false;
   const value=evaluateTradeValue(s.trade_value_evidence,artifact.trade_date,Date.parse(d.updated_at));
   if(value.status!=='ready'||value.trade_value_twd!==s.trade_value||s.classification?.classificationStatus!=='ready'||!Number.isFinite(s.change_percent)||!d.requested_symbols.includes(s.symbol))return false;
   const group=groups.get(s.classification.industry)||[];group.push(s);groups.set(s.classification.industry,group);
  }
  const scores=[...groups].map(([industry,rows])=>{
   const up=rows.filter(s=>s.change_percent>0),down=rows.filter(s=>s.change_percent<0),total=rows.reduce((n,s)=>n+s.trade_value,0),net=up.reduce((n,s)=>n+s.trade_value,0)-down.reduce((n,s)=>n+s.trade_value,0);
   const breadth=(up.length-down.length)/rows.length*100,share=total>0?net/total*100:0,average=rows.reduce((n,s)=>n+s.change_percent,0)/rows.length,expansion=rows.filter(s=>Number(s.volume_ratio_5)>=1.2).length/rows.length*100;
   return {industry,rows,net:Math.round(net),breadth:round(breadth),share:round(share),average:round(average),expansion:round(expansion),momentum:round(Math.max(0,Math.min(100,50+Math.max(-30,Math.min(30,average*10))+breadth*.15+expansion*.05)))};
  }).sort((a,b)=>b.net-a.net||b.momentum-a.momentum||a.industry.localeCompare(b.industry,'zh-Hant'));
  if(d.industry_heatmap.some(f=>f.writer_run_id!==artifact.writer_run_id))return false;
  const score=scores.find(s=>s.industry===row.industry),source=score?.rows.find(s=>s.symbol===row.symbol);
  if(!source||row.status!=='READY'||row.industry_net_flow!==score.net||row.breadth_pct!==score.breadth||row.concentration_pct!==score.share||row.trade_value!==source.trade_value||row.trade_value_unit!=='TWD'||row.flow_semantics!=='DIRECTION_WEIGHTED_TRADE_VALUE_PROXY')return false;
  const direction=source.change_percent>0?'UP':source.change_percent<0?'DOWN':'FLAT',proxy=direction==='UP'?source.trade_value:direction==='DOWN'?-source.trade_value:0;
  if(row.direction!==direction||row.proxy_flow!==proxy)return false;
  if(moduleId==='B06')return true;
  const flows=d.industry_heatmap,flow=flows.find(f=>f.industry===row.industry);
  const compared=scores.map(s=>{const f=flows.find(f=>f.industry===s.industry);const c=compare({current:{...f,net_flow_proxy:s.net,symbols:s.rows.map(x=>x.symbol)},previous:f?.previous_round_evidence,tradeDate:artifact.trade_date,canonicalRunId:artifact.canonical_run_id,asOf:artifact.observed_at});return {industry:s.industry,c};}).filter(x=>x.c.comparable).sort((a,b)=>b.c.delta-a.c.delta||a.industry.localeCompare(b.industry,'zh-Hant'));
  const previous=flow?.previous_round_evidence,entry=compared.find(x=>x.industry===row.industry);if(!entry)return false;
  const rank=scores.indexOf(score)+1,sudden=compared.indexOf(entry)+1,price=score.average>0&&score.breadth>0&&score.average>=previous.average_change_percent,volume=score.expansion>0;
  const inflow=score.net>0&&score.breadth>0,outflow=score.net<0&&score.breadth<0;
  return row.top3_rank===rank&&row.sudden_rank===sudden&&row.ntd_threshold===500000000&&row.price_confirmation===price&&row.volume_confirmation===volume&&row.persistent_inflow===(rank<=3&&inflow&&volume&&price)&&row.sudden_inflow===(sudden<=3&&entry.c.delta>=500000000&&!outflow&&volume&&price);
 }catch{return false;}
}
module.exports={verify};
