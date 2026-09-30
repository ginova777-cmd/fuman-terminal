'use strict';
// Isolated localhost database only. No production credentials.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const {persistModuleRound}=require('../lib/persist-mother-pool-module-round');
const {compact}=require('../lib/daytrade-module-compact-wire');
function sql(s){const r=spawnSync('C:/Program Files/PostgreSQL/17/bin/psql.exe',['-X','-A','-t','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p','55439','-U','mp_test','-d','postgres'],{input:s,encoding:'utf8',windowsHide:true,timeout:10000});if(r.status!==0)throw Error(r.stderr);return r.stdout.trim();}
const lit=s=>"'"+s.replace(/'/g,"''")+"'";
(async()=>{
 sql(fs.readFileSync(path.join(__dirname,'../ops/public-slot/DaytradeModuleCompactWireV1.sql'),'utf8'));
 const i={module_id:'A01',trade_date:'2026-09-30',canonical_run_id:'isolated:c',writer_run_id:'isolated:compact:'+Date.now(),generation_id:'g',mother_pool_run_id:'m',snapshot_generation:'s',snapshot_sequence:1,created_at:'2026-09-30T00:00:00Z',requested_symbols:['2330'],rows:[{symbol:'2330',status:'READY',source:'isolated',source_contract:'test',source_updated_at:'2026-09-30T00:00:00Z',is_synthetic:false,replay:false,look_ahead:false,value:'x'.repeat(10000)}]};
 let before,after;
 const adapter={savePlan:async()=>{},saveEvidence:async()=>{},persist:async body=>{const wire=compact(body);before=Buffer.byteLength(JSON.stringify(body));after=Buffer.byteLength(JSON.stringify(wire));return JSON.parse(sql('SELECT public.persist_daytrade_module_round_compact_v1('+lit(wire.p_metadata)+','+lit(wire.p_plan)+');'));}};
 const first=await persistModuleRound(i,adapter),second=await persistModuleRound(i,adapter);
 assert.deepEqual(first.ack,second.ack);assert(after<before*.55);
 await assert.rejects(()=>persistModuleRound({...i,rows:i.rows.map(r=>({...r,value:'changed'}))},adapter),/IMMUTABLE_MODULE_ROUND_CONFLICT/);
 const stored=JSON.parse(sql('SELECT document FROM public.fugle_daytrade_module_round_v2 WHERE writer_run_id='+lit(i.writer_run_id)+';'));
 const {ack,...expected}=first;assert.deepEqual(stored,expected);
 assert.throws(()=>compact({p_document:JSON.stringify(stored),p_plan:'{}'}),/MISMATCH/);
 assert.throws(()=>sql("SET ROLE anon;SELECT public.persist_daytrade_module_round_compact_v1('{}','{}');"),/permission denied/);
 assert.throws(()=>sql("SELECT public.persist_daytrade_module_round_compact_v1('{\"plan\":{}}','{}');"),/INVALID_COMPACT_MODULE_METADATA/);
 console.log(JSON.stringify({status:'PASS',scope:'isolated_postgres',checks:['identical_stored_document','same_hash_idempotency','changed_plan_rejected','anon_denied','metadata_rejected','wire_reduced'],production_complete:false}));
})().catch(e=>{console.error(e);process.exitCode=1;});
