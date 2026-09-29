'use strict';
// Uses ONLY the previously initialized disposable cluster; no production credentials.
const {spawn,spawnSync}=require('node:child_process'),fs=require('node:fs'),assert=require('node:assert/strict');
const exe='C:/Program Files/PostgreSQL/17/bin/psql.exe';
const args=['-X','-w','-h','127.0.0.1','-p','55437','-U','postgres','-d','postgres','-At','-v','ON_ERROR_STOP=1'];
if(!process.argv.includes('--isolated-port=55437')) throw Error('explicit isolated port required');
function sql(query,ok=true){const r=spawnSync(exe,args,{input:query,encoding:'utf8',timeout:15000,windowsHide:true});
 if(ok)assert.equal(r.status,0,r.stderr);else assert.notEqual(r.status,0);return r.stdout.trim();}
sql(fs.readFileSync(require.resolve('../ops/public-slot/DaytradeMotherPoolSnapshotSupabaseV4_1.sql'),'utf8'));
const prior=JSON.parse(sql("select row_to_json(s) from public.fugle_daytrade_mother_pool_snapshots_v4_1 s where trade_date='2026-09-17' order by snapshot_sequence desc limit 1;"));
const seq=prior.snapshot_sequence+1;
const s={contract:'daytrade_mother_pool_snapshot_v1',contract_version:'4.1.0',trade_date:'2026-09-17',
 canonical_run_id:'fugle_daytrade_source:20260917:canonical',run_id:`isolated-race-${seq}`,generation:`isolated-race-${seq}`,snapshot_sequence:seq,
 snapshot_type:'INTRADAY_FULL_SNAPSHOT',generated_at:'2026-09-17T02:00:00Z',effective_at:'2026-09-17T02:00:00Z',
 status:'complete',complete:true,exit_code:0,first_blocker:null,symbol_count:1,symbols:['2330'],added_symbols:['2330'],removed_symbols:[],
 symbol_membership:[{symbol:'2330',trade_date:'2026-09-17',mother_pool_run_id:`isolated-race-${seq}`,
 mother_pool_snapshot_sequence:seq,membership_status:'ACTIVE',membership_effective_at:'2026-09-17T02:00:00Z',source_reason:'fixture'}]};
s.previous_run_id=prior.run_id;
s.added_symbols=prior.symbols.includes('2330')?[]:['2330'];
s.removed_symbols=prior.symbols.filter(x=>x!=='2330');
for(const symbol of s.removed_symbols)s.symbol_membership.push({...s.symbol_membership[0],symbol,membership_status:'REMOVED',removed_at:s.effective_at});
const query=v=>`SELECT public.publish_fugle_daytrade_mother_pool_snapshot_v4_1('${JSON.stringify(v).replaceAll("'","''")}'::jsonb);`;
async function main(){
 let resolveReady;const ready=new Promise(r=>resolveReady=r);
 const child=spawn(exe,args,{windowsHide:true});let stdout='',stderr='';
 const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>resolve({code,stderr}));});
 child.stdout.on('data',chunk=>{stdout+=chunk;if(stdout.includes('LOCK_HELD'))resolveReady();});
 child.stderr.on('data',chunk=>stderr+=chunk);
 child.stdin.end(`BEGIN;${query(s)} SELECT 'LOCK_HELD'; SELECT pg_sleep(2); COMMIT;`);
 const timer=setTimeout(()=>{child.kill();resolveReady();},10000);
 await ready;
 assert.ok(stdout.includes('LOCK_HELD'),'publisher acquired lock');
 assert.equal(sql(`SELECT count(*) FROM public.v_fugle_daytrade_mother_pool_snapshot_v4_1 WHERE mother_pool_run_id='${s.run_id}';`),'0','uncommitted snapshot invisible');
 const conflict=structuredClone(s);conflict.symbol_membership[0].source_reason='conflicting concurrent publisher';
 const error=spawnSync(exe,args,{input:query(conflict),encoding:'utf8',timeout:15000,windowsHide:true});
 assert.notEqual(error.status,0);assert.match(error.stderr,/immutable snapshot conflict/);
 const result=await done;clearTimeout(timer);assert.equal(result.code,0,result.stderr);
 assert.equal(JSON.parse(sql(query(s))).idempotent,true);
 assert.equal(sql(`SELECT source_reason FROM public.fugle_daytrade_mother_pool_snapshot_members_v4_1 WHERE run_id='${s.run_id}';`),'fixture');
 let rejected=0;
 for(const mutate of [v=>v.effective_at='infinity',v=>v.effective_at='2099-01-01T00:00:00Z',
  v=>v.symbol_membership[0].membership_effective_at=null,v=>v.added_symbols=['2330','2330'],
  v=>v.removed_symbols=['2317'],v=>v.snapshot_type='UNKNOWN']){
  const bad=structuredClone(s);mutate(bad);sql(query(bad),false);rejected++;
 }
 console.log(JSON.stringify({isolated:true,complete:false,atomic_visibility:true,concurrent_conflict_rejected:true,
  exact_retry:true,member_preserved:true,additional_invalid_cases_rejected:rejected,production_written:false}));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
