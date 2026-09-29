'use strict';
// Explicit isolated server only; no runtime credentials are loaded.
const assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const {persistModuleRound}=require('../lib/persist-mother-pool-module-round');
const {reconcile}=require('../lib/mother-pool-module-write-set');
const psql=process.env.MP_TEST_PSQL||'C:/Program Files/PostgreSQL/17/bin/psql.exe';
function query(sql,role='service_role') {
 const r=spawnSync(psql,['-X','-A','-t','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p','55439','-U','mp_test','-d','postgres'],{input:`SET ROLE ${role};\n${sql}`,encoding:'utf8',windowsHide:true,timeout:10000});
 if(r.status!==0)throw Error(r.stderr);return r.stdout.split(/\r?\n/).filter(x=>x&&x!=='SET').join('\n');
}
const literal=s=>"'"+s.replace(/'/g,"''")+"'";
const identity={trade_date:'2026-09-18',canonical_run_id:'isolated:canonical',writer_run_id:'isolated:writer:'+Date.now(),generation_id:'isolated:g1',mother_pool_run_id:'isolated:s1',snapshot_generation:'isolated:s1',snapshot_sequence:1};
const source={status:'READY',source:'isolated_test',source_contract:'test_only',source_updated_at:'2026-09-18T01:06:00Z',is_synthetic:false,replay:false,look_ahead:false,volume:100};
const input={...identity,module_id:'B02',created_at:'2026-09-18T01:06:01Z',requested_symbols:['1101','2330'],rows:['1101','2330'].map(symbol=>({...source,symbol}))};
let saved=false;const adapter={savePlan:async()=>{saved=true;},persist:async p=>{assert(saved);return JSON.parse(query(`SELECT public.persist_daytrade_module_round_v2(${literal(p.p_document)},${literal(p.p_plan)});`));},saveEvidence:async()=>{}};
function read(id,role){const result=JSON.parse(query(`SELECT coalesce(jsonb_agg(to_jsonb(v)),'[]'::jsonb) FROM public.v_daytrade_module_readback_v2 v WHERE writer_run_id=${literal(id.writer_run_id)};`,role));return result.map(r=>({...r.evidence,...r,...r.special_evidence}));}
(async()=>{
 const first=await persistModuleRound(input,adapter);assert.equal(first.ack.written_symbols.length,2);
 const retry=await persistModuleRound(input,adapter);assert.deepEqual(retry.ack,first.ack);
 await assert.rejects(()=>persistModuleRound({...input,rows:input.rows.map(r=>({...r,volume:999}))},adapter),/IMMUTABLE_MODULE_ROUND_CONFLICT/);
 const secondInput={...input,writer_run_id:identity.writer_run_id+':2',generation_id:'isolated:g2',mother_pool_run_id:'isolated:s2',snapshot_generation:'isolated:s2',snapshot_sequence:2};
 await persistModuleRound(secondInput,adapter);
 const db=read(identity,'service_role'),anon=read(identity,'anon');assert.deepEqual(reconcile(first,db,anon,identity,'B02').failed_checks,[]);
 assert(reconcile(first,db.slice(1),anon.slice(1),identity,'B02').failed_checks.includes('MISSING_SYMBOLS'));
 assert.equal(read(secondInput,'anon').length,2);assert.equal(read(identity,'anon')[0].volume,100);
 assert.throws(()=>query('SELECT * FROM public.fugle_daytrade_module_rows_v2;','anon'),/permission denied/);
 assert.throws(()=>query("SELECT public.persist_daytrade_module_round_v2('{}','{}');",'anon'),/permission denied/);
 console.log(JSON.stringify({status:'passed',scope:'isolated_postgres',checks:['actual_insert_ack','idempotent_retry','changed_content_rejected','two_distinct_rounds','anon_view','independent_reconciliation','both_readbacks_missing_symbol','prior_round_preserved','anon_table_denied','anon_rpc_denied'],production_complete:false}));
})().catch(e=>{console.error(e);process.exitCode=1;});
