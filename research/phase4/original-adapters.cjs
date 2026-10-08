'use strict';
// Offline only. No runner is imported: its module initialization loads credentials.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const volume = require('../../lib/telegram-detectors/volume-detector.cjs');
const price = require('../../lib/telegram-detectors/price-detector.cjs');
const independent = require('../../lib/telegram-detectors/verify-natural-calculation.cjs');
const levelGate = require('../../lib/telegram-detectors/level-cross-gate.cjs');
const {scoreBonuses} = require('../../lib/strategy3-score-bonuses.js');
const TREND_CONTRACT = require('../../data/contracts/strategy3_technical_trend_v2.json');
const sha = x => crypto.createHash('sha256').update(x).digest('hex');
const formatterCache=new Map();
function boundedFormatter(locales,options){
  const key=JSON.stringify([locales,options]);
  if(!formatterCache.has(key)){
    if(formatterCache.size>=16)throw Error('OFFLINE_FORMATTER_CACHE_CAPACITY');
    formatterCache.set(key,new Intl.DateTimeFormat(locales,options));
  }
  return formatterCache.get(key);
}
function strategyCore(tradeDate,{memoizeFormatter=true}={}) {
  const file = path.join(root, 'scripts/run-strategy3-v2-complete-scan.js');
  const source = fs.readFileSync(file, 'utf8');
  const start = source.indexOf('function candleMinute(');
  const end = source.indexOf('\nasync function main()');
  if (start < 0 || end < start) throw Error('ORIGINAL_FUNCTION_BOUNDARY_CHANGED');
  const code = source.slice(start, end);
  const context = vm.createContext({ ...(memoizeFormatter?{Intl:{DateTimeFormat:boundedFormatter}}:{}),tradeDate, recoveryReplay:false, TREND_CONTRACT,
    scoreBonuses, MIN_CHANGE_PERCENT:5, MAX_CHANGE_PERCENT:8,
    STRATEGY:'strategy3_v2', MOTHER_POOL_VIEW:'v_fugle_daytrade_mother_pool_v4_1',
    MOTHER_POOL_RECEIPT_VIEW:'v_fugle_daytrade_mother_pool_receipt_v4_1',
    MOTHER_POOL_CONTRACT_VERSION:'4.1.0',
    QUOTE_TABLE:'fugle_daytrade_quotes_live', INTRADAY_1M_RPC:'get_fugle_daytrade_intraday_1m_latest_n' });
  const fn = vm.runInContext(code + '\nbuildScannerCoreResults', context, {timeout:1000});
  return {fn, file, source_sha256:sha(source), function_sha256:sha(code),memoized_formatter:memoizeFormatter};
}
function makeWater(state, symbols, gate) {
  return {ok:gate.ok===true, skipped:false,
    poolBySymbol:new Map(symbols.map(s=>[s,state.symbols[s].pool || {}])),
    quoteBySymbol:new Map(symbols.map(s=>[s,state.symbols[s].quote || {}])),
    candleRowsBySymbol:new Map(symbols.map(s=>[s,(state.symbols[s].current || []).map(b=>({...b,candle_time:b.timestamp,volume:b.volume_raw}))])),
    symbolDataGaps:new Map(symbols.filter(s=>state.symbols[s].gap).map(s=>[s,state.symbols[s].gap])),
    receipt:{canonical_run_id:state.identity, mother_pool_snapshot:{identity:state.identity}}};
}
async function strategy3(state, symbols, gate) {
  if (!gate || gate.ok!==true || gate.identity!==state.identity) throw Error('UPSTREAM_GATE_UNVERIFIED');
  const core = strategyCore(state.trade_date);
  const out = await core.fn(async()=>makeWater(state,symbols,gate),
    async()=>new Map(symbols.map(s=>[s,state.symbols[s].technical || {source_ready:false}])),
    async()=>new Map(symbols.map(s=>[s,state.symbols[s].atr || {source_ready:false}])));
  return {results:JSON.parse(JSON.stringify(out.results)), proof:{source_sha256:core.source_sha256,function_sha256:core.function_sha256}};
}
function telegram(state, symbols, asOf) {
  const rows = [], now = Date.parse(asOf);
  if (!Number.isFinite(now)) throw Error('INVALID_AS_OF');
  for (const symbol of symbols) {
    const item=state.symbols[symbol], current=item.current || [], history=(item.history || []).filter(b=>b.stock_id===symbol&&b.trade_date<state.trade_date&&!volume.validate(b,now).reasons.length);
    const latest=current.at(-1); if (!latest) continue;
    const age=(now-Date.parse(latest.timestamp))/1000;
    // Matches original natural runner's 60..120 second completed-minute gate.
    if (age<60 || age>120) continue;
    const input={stock_id:symbol,trade_date:state.trade_date,current,history,as_of:asOf,previous_close:item.quote?.prevClose || null};
    const vc=current.filter(b=>!volume.validate(b,now).reasons.length);
    const pc=current.filter(b=>['open','high','low','close'].every(k=>typeof b[k]==='number'&&Number.isFinite(b[k])&&b[k]>0)&&b.high>=Math.max(b.open,b.close)&&b.low<=Math.min(b.open,b.close)&&b.high>=b.low);
    const v=vc.at(-1)?.timestamp===latest.timestamp?volume.detect({...input,current:vc}).rows.at(-1):null;
    const p=pc.at(-1)?.timestamp===latest.timestamp?price.detect({...input,current:pc}).rows.at(-1):null;
    const failures=independent.verify({current:p?pc:current,volumeCurrent:vc,history,volume:v,price:p});
    if(failures.length)throw Error('NATURAL_CALCULATION_MISMATCH:'+failures.join(','));
    for (const [kind,row,hit] of [['volume',v,v?.volume_anomaly_event],['price',p,p?.price_up_anomaly_event]]) if(row) rows.push({symbol,kind,row,hit:!!hit});
  }
  return rows;
}
function deepAnalysis({events,previous=[],contexts,now,tradeDate,plan=null}){
  // A missing plan is explicit missing evidence, not an implicit LONG direction.
  return levelGate.build({events,previous,contexts,now,tradeDate,plan});
}
module.exports={strategyCore,makeWater,strategy3,telegram,deepAnalysis,sha};
