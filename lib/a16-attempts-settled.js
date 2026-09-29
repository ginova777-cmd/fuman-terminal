'use strict';
const {hash}=require('./mother-pool-a16-io');
function settled(summary,universe){
 const symbols=universe.symbols;
 if(summary?.contract!=='mother_pool_a16_writer_summary_v1'||summary.mode!=='scheduled'||summary.trade_date!==universe.trade_date||summary.canonical_run_id!==universe.canonical_run_id||summary.universe_sha256!==hash(universe)||!Array.isArray(symbols)||!symbols.length||!Array.isArray(summary.rows)||summary.rows_sha256!==hash(summary.rows)||summary.requested_count!==symbols.length||summary.attempted_count!==symbols.length||summary.rows.length!==symbols.length||!Array.isArray(summary.requested_symbols)||summary.requested_symbols.length!==symbols.length||new Set(summary.requested_symbols).size!==symbols.length||summary.requested_symbols.some(s=>!symbols.includes(s))||new Set(summary.rows.map(r=>r.symbol)).size!==symbols.length)return false;
 return summary.rows.every(r=>symbols.includes(r.symbol)&&r.db_readback_ok===true&&r.anon_readback_ok===true&&r.verifier_passed===true&&r.requested_count===1084&&r.written_count===1084&&r.readback_count===1084&&/^[a-f0-9]{64}$/.test(r.payload_sha256||''));
}
module.exports={settled};
