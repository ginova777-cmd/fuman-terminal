'use strict';
const crypto=require('node:crypto');
const identityFields=['trade_date','canonical_run_id','writer_run_id','generation_id','mother_pool_run_id','snapshot_generation','snapshot_sequence'];
function validateIdentity(x){if(!/^\d{4}-\d{2}-\d{2}$/.test(x.trade_date)||x.canonical_run_id!==`fugle_daytrade_source:${x.trade_date.replaceAll('-','')}:canonical`)throw Error('INVALID_DATE_CANONICAL');for(const k of identityFields)if(k==='snapshot_sequence'?(!Number.isInteger(x[k])||x[k]<1):(typeof x[k]!=='string'||!x[k]))throw Error('INVALID_IDENTITY:'+k);}
function minuteHash(x){const keys=['trade_date','stock_id','timestamp','inside_1m','outside_1m','unknown_1m','total_1m','volume_unit','aggregation','side_volume_timestamp','classification_source','start_boundary_identity','end_boundary_identity','is_synthetic'];return crypto.createHash('sha256').update(JSON.stringify(keys.map(k=>[k,x[k]]))).digest('hex');}
function validateMinute(x,date,asOf){
 const nums=['inside_1m','outside_1m','unknown_1m','total_1m'];
 if(nums.some(k=>typeof x[k]!=='number'||!Number.isFinite(x[k])||x[k]<0)||Math.abs(x.total_1m-x.inside_1m-x.outside_1m-x.unknown_1m)>1e-6)throw Error('SIDE_CONSERVATION');
 const t=Date.parse(x.timestamp), e=Date.parse(x.side_volume_timestamp);
 if(x.volume_unit!=='LOTS'||x.aggregation!=='ONE_MINUTE'||x.is_synthetic!==false||x.complete!==true)throw Error('SIDE_SOURCE_CONTRACT');
 if(!Number.isFinite(t)||t%60000||!Number.isFinite(e)||e<t||e>=t+60000||t+60000>Date.parse(asOf)||new Date(t+28800000).toISOString().slice(0,10)!==date)throw Error('SIDE_MINUTE_TIME');
}
function buildPlan(result,snapshot){
 const ms0=result.payload.mother_pool_minute_side_evidence;
 const check=require('./daytrade-mother-pool-snapshot').inspectSnapshot(snapshot,ms0.trade_date);if(!check.ok)throw Error('INVALID_SNAPSHOT:'+check.failedChecks.join(','));
 const identity={trade_date:ms0.trade_date,canonical_run_id:ms0.canonical_run_id,writer_run_id:result.payload.writer_run_id,generation_id:result.payload.generation_id,mother_pool_run_id:ms0.mother_pool_run_id,snapshot_generation:snapshot.generation,snapshot_sequence:ms0.snapshot_sequence};
 if(snapshot.mother_pool_run_id!==identity.mother_pool_run_id||snapshot.snapshot_sequence!==identity.snapshot_sequence||snapshot.canonical_run_id!==identity.canonical_run_id)throw Error('SNAPSHOT_IDENTITY_MISMATCH');
      const ms = result.payload.mother_pool_minute_side_evidence;
      const snap = snapshot;
      const writerId = result.payload?.writer_run_id || result.run_id;
      const generationId = result.payload?.generation_id;
      const sourceRows = [];
      const roundRows = [];
      validateIdentity(identity);
      if(!Array.isArray(snap.symbols)||new Set(snap.symbols).size!==snap.symbols.length)throw Error('INVALID_REQUESTED_SYMBOLS');
      const details = new Map((ms.details || []).map(d=>[String(d.symbol),d]));
      if(details.size!==(ms.details||[]).length||[...details.keys()].some(x=>!snap.symbols.includes(x)))throw Error('DETAIL_SYMBOL_MISMATCH');
      for (const symbol of snap.symbols) {
        const d=details.get(symbol)||{symbol,status:'DATA_GAP',reason:'MISSING_DETAIL'};
        const latest = d.latest;
        const sourceHash = latest ? minuteHash(latest) : null;
        roundRows.push({ writer_run_id: writerId, trade_date: ms.trade_date,
          canonical_run_id: ms.canonical_run_id, generation_id: generationId,
          mother_pool_run_id: ms.mother_pool_run_id, snapshot_generation: snap.generation || ms.mother_pool_run_id,
          snapshot_sequence: Number(ms.snapshot_sequence), symbol: d.symbol,
          requested: true, written: false, readback: false,
          source_rows: Number(d.available_minutes || 0), data_gap_count: Number(d.gap_minutes || 0),
          first_blocker: d.reason || null });
        if (d.status!=='SOURCE_READY'||!latest||!sourceHash) {roundRows.at(-1).first_blocker ||= 'SOURCE_NOT_READY';continue;}
        validateMinute(latest, ms.trade_date, ms.as_of);
        if(latest.stock_id!==symbol||latest.trade_date!==ms.trade_date)throw Error('SIDE_SYMBOL_DATE_MISMATCH');
        const baseline=require('./mother-pool-side-baseline-selection').select(d,identity);
        sourceRows.push({ trade_date: ms.trade_date, canonical_run_id: ms.canonical_run_id,
          symbol: d.symbol, minute_start: latest.timestamp,
          source_contract: 'mother_pool_native_minute_side_source_v1', source_version: '1',
          inside_1m: latest.inside_1m ?? null, outside_1m: latest.outside_1m ?? null,
          unknown_1m: latest.unknown_1m ?? null, total_1m: latest.total_1m ?? null,
          volume_unit: latest.volume_unit, aggregation: latest.aggregation,
          side_volume_timestamp: latest.side_volume_timestamp || null, source: latest.classification_source,
          start_boundary_identity: latest.start_boundary_identity || null,
          end_boundary_identity: latest.end_boundary_identity || null,
          is_synthetic: latest.is_synthetic, source_hash: sourceHash,
          baseline_method: baseline?.method || null,
          baseline_sample_count: Number(baseline?.outside?.sample_count || 0),
          baseline_value: baseline?.outside?.baseline ?? null,
          outside_baseline_value: baseline?.outside?.baseline ?? null,
          inside_baseline_value: baseline?.inside?.baseline ?? null,
          raw_outside_ratio: latest.inside_1m > 0 ? Number((latest.outside_1m / latest.inside_1m).toFixed(8)) : null,
          outside_strength: latest.inside_1m > 0 ? Number((latest.outside_1m / latest.inside_1m).toFixed(8)) : null,
          raw_inside_ratio: latest.outside_1m > 0 ? Number((latest.inside_1m / latest.outside_1m).toFixed(8)) : null,
          inside_strength: latest.outside_1m > 0 ? Number((latest.inside_1m / latest.outside_1m).toFixed(8)) : null,
          dynamic_ratio: latest.inside_1m > 0 && Number(baseline?.outside?.baseline) > 0 ? Number(((latest.outside_1m / latest.inside_1m) / baseline.outside.baseline).toFixed(8)) : null,
          outside_dynamic_ratio: latest.inside_1m > 0 && Number(baseline?.outside?.baseline) > 0 ? Number(((latest.outside_1m / latest.inside_1m) / baseline.outside.baseline).toFixed(8)) : null,
          inside_dynamic_ratio: latest.outside_1m > 0 && Number(baseline?.inside?.baseline) > 0 ? Number(((latest.inside_1m / latest.outside_1m) / baseline.inside.baseline).toFixed(8)) : null,
          side_state: latest.inside_1m === 0 && latest.outside_1m > 0 ? 'OUTSIDE_ONLY' : latest.inside_1m === 0 && latest.outside_1m === 0 ? 'NO_VALID_SIDE_VOLUME' : 'RATIO_VALID',
          outside_baseline_sample_count: Number(baseline?.outside?.sample_count || 0),
          inside_baseline_sample_count: Number(baseline?.inside?.sample_count || 0),
          outside_side_state: latest.inside_1m === 0 && latest.outside_1m > 0 ? 'OUTSIDE_ONLY' : latest.inside_1m === 0 && latest.outside_1m === 0 ? 'NO_VALID_SIDE_VOLUME' : 'RATIO_VALID',
          inside_side_state: latest.outside_1m === 0 && latest.inside_1m > 0 ? 'INSIDE_ONLY' : latest.outside_1m === 0 && latest.inside_1m === 0 ? 'NO_VALID_SIDE_VOLUME' : 'RATIO_VALID',
          writer_run_id: writerId, generation_id: generationId,
          mother_pool_run_id: ms.mother_pool_run_id, snapshot_generation: snap.generation || ms.mother_pool_run_id,
          snapshot_sequence: Number(ms.snapshot_sequence) });
        roundRows[roundRows.length - 1].minute_start = latest.timestamp;
        roundRows[roundRows.length - 1].source_hash = sourceHash;
      }

 return {contract:'minute_side_write_plan_v1',...identity,observed_at:ms.as_of,requested_symbols:[...snap.symbols],data_gap_symbols:roundRows.filter(r=>r.first_blocker).map(r=>r.symbol),source_rows:sourceRows,round_rows:roundRows};
}
async function persistMinuteSideRoundEvidence(result,adapter){
 const plan=buildPlan(result,adapter.snapshot);
 await adapter.savePlan(plan); // Persist expected set before the first DB operation.
 const ack=await adapter.persist(plan); // Transactional DB result, never inferred from planned rows.
 if(!ack||!Array.isArray(ack.written_symbols)||!Array.isArray(ack.round_symbols))throw Error('WRITE_ACK_MISSING');
 const eq=(a,b)=>JSON.stringify([...a].sort())===JSON.stringify([...b].sort());
 if(!eq(ack.written_symbols,plan.source_rows.map(r=>r.symbol))||!eq(ack.round_symbols,plan.requested_symbols))throw Error('WRITE_ACK_SET_MISMATCH');
 const evidence={...plan,written_symbols:ack.written_symbols,round_written_symbols:ack.round_symbols,status:'written',complete:false};
 await adapter.saveEvidence(evidence);
 return evidence;
}
module.exports={buildPlan,persistMinuteSideRoundEvidence,identityFields,validateIdentity,minuteHash,validateMinute};
