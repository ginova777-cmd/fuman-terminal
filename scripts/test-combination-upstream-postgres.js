'use strict';
// Isolated loopback database and logical fixture clock only. Never production.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
const {persistModuleRound}=require('../lib/persist-mother-pool-module-round');
const {collect}=require('../lib/mother-pool-combination-producer'),{verify}=require('../lib/verify-mother-pool-combinations');
const literal=s=>"'"+String(s).replaceAll("'","''")+"'";
const runtime=fs.mkdtempSync(path.join(os.tmpdir(),'b24-upstream-pg-'));
function sql(query,role='service_role'){
 const r=spawnSync('C:/Program Files/PostgreSQL/17/bin/psql.exe',['-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p','55439','-U','mp_test','-d','postgres'],{input:'SET ROLE '+role+';\n'+query,encoding:'utf8',windowsHide:true,timeout:10000});
 if(r.status!==0)throw Error(r.stderr);return JSON.parse(r.stdout.trim());
}
function adapter(time){return {
 savePlan:async p=>fs.writeFileSync(path.join(runtime,p.writer_run_id.replaceAll(':','_')+'-'+p.module_id+'-plan.json'),JSON.stringify(p),{flag:'wx'}),
 persist:async p=>sql(`BEGIN; ALTER TABLE public.fugle_daytrade_module_round_v2 ALTER COLUMN committed_at SET DEFAULT ${literal(time)}::timestamptz; SELECT public.persist_daytrade_module_round_v2(${literal(p.p_document)},${literal(p.p_plan)}); ALTER TABLE public.fugle_daytrade_module_round_v2 ALTER COLUMN committed_at SET DEFAULT clock_timestamp(); COMMIT;`,'mp_test'),
 saveEvidence:async p=>fs.writeFileSync(path.join(runtime,p.writer_run_id.replaceAll(':','_')+'-'+p.module_id+'-ack.json'),JSON.stringify(p),{flag:'wx'})};}
(async()=>{
 const suffix=Date.now();let checked=0;
 for(let round=1;round<=2;round++){
  const f=require('./test-combination-independent').fixture({writer_run_id:`b24-db:${suffix}:${round}`,generation_id:'b24g'+round,mother_pool_run_id:'b24s'+round,snapshot_generation:'b24s'+round,snapshot_sequence:round},round);
  for(const [module_id,ws] of Object.entries(f.parents)){
   f.parents[module_id]=await persistModuleRound({...f.identity,module_id,...ws.plan},adapter(f.asOf));
   assert.equal(f.parents[module_id].ack.committed,true);checked++;
  }
  // The side fixtures use the same source content in both rounds; only round
  // identity changes. PostgreSQL must retain the original immutable source.
  for(const r of f.side.source_rows)Object.assign(r,{source_version:'b24-isolated-v1',source:'isolated-natural-shape',start_boundary_identity:'start',end_boundary_identity:'end',baseline_sample_count:20,baseline_value:1,dynamic_ratio:2,side_state:'RATIO_VALID'});
  for(const r of f.side.round_rows)Object.assign(r,f.identity,{requested:true,readback:false,source_rows:1,data_gap_count:0});
  const ack=sql(`SELECT public.persist_minute_side_round_v1(${literal(JSON.stringify(f.side))}::jsonb);`);
  f.side.written_symbols=ack.written_symbols;f.side.round_written_symbols=ack.round_symbols;
  fs.writeFileSync(path.join(runtime,'side-ack-'+round+'.json'),JSON.stringify({identity:f.identity,ack}));
  assert.deepEqual(ack.written_symbols,f.symbols);checked++;
  const plan=collect(f);assert.equal(plan.rows[0].status,'READY',JSON.stringify(plan.rows[0].data_gaps));
  const ws=await persistModuleRound(plan,adapter(f.asOf));
  const where=`module_id='B24' AND writer_run_id=${literal(f.identity.writer_run_id)}`;
  const db=sql(`SELECT jsonb_agg(to_jsonb(v) ORDER BY symbol) FROM public.v_daytrade_module_readback_v2 v WHERE ${where};`);
  const anon=sql(`SELECT jsonb_agg(to_jsonb(v) ORDER BY symbol) FROM public.v_daytrade_module_readback_v2 v WHERE ${where};`,'anon');
  assert.deepEqual(db,anon);checked++;
  const expand=rows=>rows.map(r=>({...r.evidence,...r}));
  const receipt={...f.identity,observed_at:f.asOf,writer_write_set:ws};assert(verify(expand(db),receipt));assert(verify(expand(anon),receipt));checked+=2;
  const bad=structuredClone(ws);bad.plan.source_evidence.parents.B12.ack.written_symbols=[];assert(!verify(expand(db),{...receipt,writer_write_set:bad}));checked++;
 }
 const defaultExpr=sql("SELECT to_jsonb(pg_get_expr(d.adbin,d.adrelid)) FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum WHERE d.adrelid='public.fugle_daytrade_module_round_v2'::regclass AND a.attname='committed_at';",'mp_test');
 assert.equal(defaultExpr,'clock_timestamp()');checked++;
 console.log(JSON.stringify({status:'passed',checks:checked,scope:'isolated_postgres_actual_upstream_writes',logical_fixture_clock:true,hosted_postgrest_tested:false,production_complete:false,runtime}));
})().catch(e=>{console.error(e);process.exitCode=1;});
