'use strict';
// Independent arithmetic/order verifier; does not call the producer evaluator.
const stable=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
function verify(actual,expected,{read_role,db_readback_ok}={}) {
  const failed=[];
  const fail=x=>failed.push(x);
  if(!actual||actual.contract!=='daytrade_volume_value_ranking_v1') fail('CONTRACT_MISSING');
  if(read_role!=='anon'||db_readback_ok!==true) fail('ANON_READBACK_MISSING');
  if(!actual||!expected||stable(actual)!==stable(expected)) fail('NOT_SAME_BATCH');
  if(actual) {
    const calculated=Date.parse(actual.calculated_at);
    if(actual.run_id!==`volume-value:${actual.trade_date}:${actual.calculated_at}`) fail('RUN_ID_INVALID');
    if(actual.scope!=='active_common_stock_universe'||actual.volume_unit!=='shares'||actual.value_unit!=='TWD') fail('SCOPE_OR_UNITS_INVALID');
    if(!Number.isFinite(calculated)||new Date(calculated+28800000).toISOString().slice(0,10)!==actual.trade_date)fail('CALCULATION_DATE_INVALID');
    const rows=Array.isArray(actual.rows)?actual.rows:[];
    if(rows.some(r=>!r||typeof r!=='object'||Array.isArray(r)||typeof r.symbol!=='string'||!/^\d{4}$/.test(r.symbol)))return {contract:'daytrade_volume_value_readback_verifier_v1',complete:false,status:'blocked',failed_checks:[...failed,'INVALID_ROW'],first_blocker:failed[0]||'INVALID_ROW',exit_code:1};
    if(!rows.length||actual.requested_count!==rows.length||new Set(rows.map(r=>r.symbol)).size!==rows.length) fail('UNIVERSE_COUNT_INVALID');
    if(actual.canonical_run_id!==`fugle_daytrade_source:${String(actual.trade_date).replace(/-/g,'')}:canonical`) fail('CANONICAL_INVALID');
    if(actual.publish_allowed!==false||actual.creates_formal_candidate!==false) fail('SIDE_EFFECT_GUARD_INVALID');
    for(const [field,list,key] of [['volume','volume_ranking','volume_shares'],['amount','value_ranking','trade_value_twd']]) {
      const ready=[];
      for(const row of rows) {
        const e=row[field]||{},time=Date.parse(e.event_at),age=(Date.parse(actual.calculated_at)-time)/1000;
        const n=(typeof e.value==='number'||typeof e.value==='string'&&e.value.trim()!=='')?Number(e.value):NaN;
        const converted=field==='volume'?n*(e.unit==='lots'?1000:1):n;
        if(e.status==='DATA_GAP') {
          const unitsOk=field==='volume'?['shares','lots'].includes(e.unit)&&['fugle.websocket.aggregates.total.tradeVolume','fugle.intraday.quote.total.tradeVolume','fugle.collector.typed_cumulative_volume'].includes(e.source):e.unit==='TWD'&&e.calculation==='provider_reported_cumulative'&&['fugle.websocket.aggregates.total.tradeValue','fugle.intraday.quote.total.tradeValue'].includes(e.source);
          const actuallyValid=Number.isFinite(n)&&n>=0&&Number.isFinite(converted)&&unitsOk&&e.is_synthetic===false&&!!e.source&&Number.isFinite(age)&&age>=0&&age<=120&&Number.isFinite(time)&&new Date(time+28800000).toISOString().slice(0,10)===actual.trade_date;
          if(actuallyValid||!Array.isArray(e.reasons)||!e.reasons.length||e[key]!==null||(field==='volume'&&e.volume_lots!==null)) fail(`${row.symbol}:${field}:GAP_INVALID`);
          continue;
        }
        if(!Array.isArray(e.reasons)||e.reasons.length) fail(`${row.symbol}:${field}:READY_REASONS_INVALID`);
        if(field==='volume'&&e.volume_lots!==converted/1000) fail(`${row.symbol}:volume:LOTS_INVALID`);
        if(e.status!=='ready'||!Number.isFinite(n)||n<0||!Number.isFinite(converted)||e[key]!==converted||e.is_synthetic!==false||!e.source||!Number.isFinite(age)||age<0||age>120||e.age_seconds!==age||!Number.isFinite(time)||new Date(time+28800000).toISOString().slice(0,10)!==actual.trade_date) fail(`${row.symbol}:${field}:SOURCE_OR_ARITHMETIC_INVALID`);
        if(field==='volume'&&!['shares','lots'].includes(e.unit)) fail('VOLUME_UNIT_INVALID');
        if(field==='volume'&&!['fugle.websocket.aggregates.total.tradeVolume','fugle.intraday.quote.total.tradeVolume','fugle.collector.typed_cumulative_volume'].includes(e.source)) fail('VOLUME_SOURCE_INVALID');
        if(field==='amount'&&(e.unit!=='TWD'||e.calculation!=='provider_reported_cumulative'||!['fugle.websocket.aggregates.total.tradeValue','fugle.intraday.quote.total.tradeValue'].includes(e.source))) fail('VALUE_SOURCE_INVALID');
        ready.push({symbol:row.symbol,value:converted});
      }
      ready.sort((a,b)=>b.value-a.value||a.symbol.localeCompare(b.symbol));
      if(stable(actual[list])!==stable(ready.map((r,i)=>({...r,rank:i+1})))) fail(`${field}:RANK_INVALID`);
    }
  }
  return {contract:'daytrade_volume_value_readback_verifier_v1',status:failed.length?'blocked':'verified',complete:failed.length===0,
    read_role,db_readback_ok:db_readback_ok===true,run_id:actual?.run_id||null,requested_count:expected?.requested_count??null,
    readback_count:actual?.rows?.length??null,failed_checks:[...new Set(failed)],first_blocker:failed[0]||null,exit_code:failed.length?1:0};
}
module.exports={verify};
