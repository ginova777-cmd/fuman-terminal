'use strict';
// Fixed loopback PostgreSQL fixture only. No production credentials or endpoints.
const assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const {persistMinuteSideRoundEvidence}=require('../lib/mother-pool-minute-side-persistence');
const {reconcile}=require('../lib/mother-pool-minute-side-reconciliation');
const {createVerifier}=require('../lib/verify-mother-pool-module-round');
const fixture=require('./fixtures/minute-side-r4-plan.json').rounds[0];
const literal=s=>"'"+s.replaceAll("'","''")+"'";
function sql(q,role='service_role'){
 const p=spawnSync('C:/Program Files/PostgreSQL/17/bin/psql.exe',['-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p','55439','-U','mp_test','-d','postgres'],{input:'SET ROLE '+role+';\n'+q,encoding:'utf8',windowsHide:true,timeout:10000});
 if(p.status!==0)throw Error(p.stderr);return JSON.parse(p.stdout.trim());
}
(async()=>{
 let checks=0;
 for(const [n,volumes] of [[0,[0,100]],[1,[100,0]],[2,[0,0]],[3,[100,200]],[4,[100,200]]]){
  const f=n===4?require('./test-side-baseline-selection').prepare('09:20'):structuredClone(fixture),payload=f.result.payload,side=payload.mother_pool_minute_side_evidence;
  payload.writer_run_id='side-sql:'+Date.now()+':'+n;payload.generation_id=payload.writer_run_id;
  if(n!==4)side.as_of=`2026-09-18T02:${22+n}:01.000Z`;
  for(const d of side.details){
   Object.assign(d.latest,{timestamp:n===4?d.latest.timestamp:`2026-09-18T02:${21+n}:00.000Z`,side_volume_timestamp:n===4?d.latest.side_volume_timestamp:`2026-09-18T02:${21+n}:59.000Z`,inside_1m:volumes[0],outside_1m:volumes[1],unknown_1m:0,total_1m:volumes[0]+volumes[1]});
   d.rolling_baseline={method:'ROLLING_20M_MEDIAN',outside:{sample_count:20,baseline:2},inside:{sample_count:20,baseline:0.5}};
  }
  let planned=false;
  const e=await persistMinuteSideRoundEvidence(f.result,{snapshot:f.snapshot,savePlan:async()=>{planned=true;},persist:async p=>{assert(planned);return sql('SELECT public.persist_minute_side_round_v1('+literal(JSON.stringify(p))+'::jsonb);');},saveEvidence:async()=>{}});
  for(const id of ['B14','B20']){
   const view=id==='B14'?'v_daytrade_minute_side_readback_v1':'v_daytrade_minute_side_b20_readback_v1';
   const q=`SELECT json_agg(t) FROM (SELECT * FROM public.${view} WHERE writer_run_id=${literal(e.writer_run_id)} ORDER BY symbol) t;`;
   const db=sql(q),anon=sql(q,'anon');
   assert.deepEqual(reconcile(e,db,anon,{...e,module_id:id}).failed_checks,[]);checks++;
   assert(db.every(r=>createVerifier(id).minuteSideFormulaOk(id,r)));checks++;
   if(n===4){assert(db.every(r=>r.baseline_method==='HISTORICAL_20D_SAME_MINUTE_MEDIAN'&&r.baseline_value===(id==='B14'?4:0.25)));checks++;}
   const zero=id==='B14'?volumes[0]===0:volumes[1]===0;
   if(zero){assert(db.every(r=>r.dynamic_ratio===null&&r[id==='B14'?'raw_outside_ratio':'raw_inside_ratio']===null));checks++;}
   const bad=structuredClone(db);bad[0].baseline_value=999;
   assert(reconcile(e,bad,bad,{...e,module_id:id}).failed_checks.some(x=>x.includes('WRITER_VALUE_MISMATCH')));checks++;
  }
 }
 console.log(JSON.stringify({status:'passed',checks,scope:'isolated_postgres_actual_side_rpc_views',production_complete:false}));
})().catch(e=>{console.error(e);process.exitCode=1;});
