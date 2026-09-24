'use strict';
const {hash}=require('./mother-pool-module-write-set');
const stable=x=>Array.isArray(x)?x.map(stable):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])])):x;
const digest=x=>hash(stable(x));
const truth=v=>v===true||v===1||/^(true|yes|y|1)$/i.test(String(v));
function evaluate(symbol,ticker,universe,identity,asOf){
 const rows=[ticker,universe].filter(Boolean),payloads=rows.map(r=>r.payload&&typeof r.payload==='object'?r.payload:{}),all=[...rows,...payloads],reasons=[],gaps=[];
 const flag=keys=>all.some(r=>keys.some(k=>truth(r[k])));
 const name=ticker?.name||universe?.name||'',market=String(ticker?.market||universe?.market||'').toUpperCase();
 const type=String(ticker?.stock_type||universe?.stock_type||ticker?.type||universe?.type||payloads.map(p=>p.stockType||p.stock_type).find(Boolean)||'').toLowerCase();
 if(!['TWSE','TSE','TPEX','OTC','上市','上櫃'].includes(market))reasons.push('MARKET_NOT_TWSE_TPEX');
 if(!/^\d{4}$/.test(symbol)||symbol.startsWith('00')||flag(['is_etf','isEtf','is_warrant','isWarrant','is_cb','isCb','is_trial','isTrial'])||/etf|warrant|convertible|preferred|權證|認購|認售|特別股|tdr|^dr$/.test(type))reasons.push('NOT_COMMON_STOCK');
 else if(!/^(commonstock|common|stock)$/.test(type))gaps.push('COMMON_STOCK_TYPE_UNPROVEN');
 if(rows.some(r=>r.is_active===false))reasons.push('INACTIVE');
 if(flag(['is_blacklisted','isBlacklisted']))reasons.push('BLACKLISTED');
 if(flag(['is_suspended','isSuspended','is_halted','isHalted']))reasons.push('HALTED_OR_SUSPENDED');
 if(flag(['is_daytrade_unsuitable','isDaytradeUnsuitable'])||all.some(r=>['daytradeAllowed','daytrade_allowed','canDaytrade','can_daytrade'].some(k=>r[k]===false)))reasons.push('DAYTRADE_NOT_ALLOWED');
 const statuses=all.flatMap(r=>['tradingStatus','trading_status','tradeStatus','trade_status','controlStatus','control_status','dispositionStatus','disposition_status'].map(k=>String(r[k]||''))).join(' ');
 if(/disposition|controlled|restricted|halted|suspended|處置|分盤|停牌|人工管制/i.test(statuses)||flag(['isDisposition','is_disposition','isSplitTrading','is_split_trading','splitTrading','split_trading','isControlled','is_controlled','manualControl','manual_control','tradingRestricted','trading_restricted']))reasons.push('DISPOSITION_SPLIT_OR_CONTROLLED');
 if(!reasons.length){
  const p=ticker?.payload||{},synced=Date.parse(p.stock_master_synced_at),now=Date.parse(asOf);
  if(!ticker||!universe||universe.is_active!==true)gaps.push('AUTHORITATIVE_UNIVERSE_MISSING');
  if(p.stock_master_contract!=='mops_official_stock_master_v1'||p.stock_master_source!=='MOPS_OPEN_DATA_TWSE_TPEX'||p.official_present!==true||!p.stock_master_run_id||p.stock_master_source_date!==identity.trade_date||!Number.isFinite(synced)||synced>now||now-synced>86400000)gaps.push('OFFICIAL_MASTER_PROVENANCE_INVALID');
  if(!name)gaps.push('STOCK_NAME_MISSING');
 }
 return {symbol,name,market,stock_type:type,eligible:!reasons.length&&!gaps.length,reject_reasons:[...new Set(reasons)],data_gaps:[...new Set(gaps)]};
}
function collect({identity,evidence,asOf}){
 if(!Array.isArray(evidence?.stock_tickers)||!Array.isArray(evidence?.stock_universe))throw Error('A02_RAW_MASTER_REQUIRED');
 const map=rows=>{const m=new Map();for(const r of rows){const s=String(r.symbol||'').trim();if(!s||m.has(s))throw Error('A02_DUPLICATE_OR_EMPTY_SYMBOL');m.set(s,r);}return m;};
 const tickers=map(evidence.stock_tickers),universe=map(evidence.stock_universe),symbols=[...new Set([...tickers.keys(),...universe.keys()])].sort();
 const rows=symbols.map(symbol=>{
  const ticker=tickers.get(symbol)||null,u=universe.get(symbol)||null,out=evaluate(symbol,ticker,u,identity,asOf);
  return {...out,status:out.data_gaps.length?'DATA_GAP':'READY',data_gap_reason:out.data_gaps.length?out.data_gaps.join('|'):null,source:'stock_tickers+stock_universe',source_contract:'preopen_a02_eligibility_receipt_v1',source_updated_at:evidence.observed_at,event_time:asOf,is_synthetic:false,replay:false,look_ahead:false,raw_ticker:ticker,raw_universe:u,source_hash:digest({ticker,universe:u})};
 });
 return {...identity,module_id:'A02',created_at:asOf,requested_symbols:symbols,rows,source_evidence:{observed_at:evidence.observed_at,ticker_count:tickers.size,universe_count:universe.size}};
}
function verify(row,r){try{
 const out=evaluate(row.symbol,row.raw_ticker,row.raw_universe,r,r.observed_at);
 return !out.data_gaps.length&&row.status==='READY'&&row.data_gap_reason===null&&Object.entries(out).every(([k,v])=>JSON.stringify(row[k])===JSON.stringify(v))&&row.source_hash===digest({ticker:row.raw_ticker,universe:row.raw_universe});
}catch{return false;}}
module.exports={collect,evaluate,verify};
