'use strict';
const {build}=require('./mother-pool-detector-candle-source'),{calculate,flags}=require('./mother-pool-discovery-calculation');
function collect({identity,symbols,sources,candles,previous,asOf}){
 const c=build({candles,tradeDate:identity.trade_date,canonicalRunId:identity.canonical_run_id,asOf});
 const bySymbol=new Map(sources.map(r=>[r.symbol,r]));
 const rows=symbols.map(symbol=>{const source=bySymbol.get(symbol)||{symbol},bars=(c.groups.get(symbol)||[]).slice(-20),r=calculate({symbol,source,previous,bars,identity,asOf});
 if(c.rejected.some(x=>x.symbol===symbol)){r.status='DATA_GAP';r.failed_checks.push('REJECTED_CANDLE_INPUT');r.data_gap_reason=r.failed_checks.join('|');}
 return {symbol,...r,raw_source:source,natural_bars:bars,source:'Fugle.quote+natural_1m+official_daily_volume',source_contract:'daytrade_intraday_discovery_v1',source_updated_at:source.source_evidence?.quote_event_at||asOf,event_time:asOf,is_synthetic:false,replay:false,look_ahead:false};});
 const ranked=rows.filter(r=>r.status==='READY').slice().sort((a,b)=>b.cumulative_volume_lots-a.cumulative_volume_lots||a.symbol.localeCompare(b.symbol));
 for(const row of rows){row.volume_rank=ranked.findIndex(r=>r.symbol===row.symbol)+1;row.discovery_flags=flags(row,row.volume_rank);}
 return {...identity,module_id:'B04',created_at:asOf,requested_symbols:[...symbols],source_evidence:{previous_write_set:previous},rows};
}
module.exports={collect};
