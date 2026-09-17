'use strict';
// Explicitly isolated localhost database only. Never accepts production credentials.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const port=process.argv.find(x=>x.startsWith('--isolated-port='))?.split('=')[1];
if(port!=='55437') throw Error('requires dedicated isolated PostgreSQL port 55437');
function sql(input,ok=true){
  const r=spawnSync('C:/Program Files/PostgreSQL/17/bin/psql.exe',
    ['-X','-w','-h','127.0.0.1','-p',port,'-U','postgres','-d','postgres','-At','-v','ON_ERROR_STOP=1'],
    {input,encoding:'utf8',windowsHide:true,timeout:15000});
  if(ok) assert.equal(r.status,0,r.stderr); else assert.notEqual(r.status,0,'expected SQL rejection');
  return r.stdout.trim();
}
sql("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;");
sql(fs.readFileSync(path.join(__dirname,'../ops/public-slot/DaytradeMotherPoolSnapshotSupabaseV4_1.sql'),'utf8'));
const fixture={contract:'daytrade_mother_pool_snapshot_v1',contract_version:'4.1.0',
 trade_date:'2026-09-17',canonical_run_id:'fugle_daytrade_source:20260917:canonical',run_id:'isolated-1',
 snapshot_sequence:1,snapshot_type:'INTRADAY_FULL_SNAPSHOT',generated_at:'2026-09-17T02:00:00Z',effective_at:'2026-09-17T02:00:00Z',
 status:'complete',complete:true,exit_code:0,first_blocker:null,symbol_count:1,symbols:['2330'],added_symbols:['2330'],removed_symbols:[],
 previous_run_id:null,source_max_updated_at:null,symbol_membership:[{symbol:'2330',trade_date:'2026-09-17',mother_pool_run_id:'isolated-1',
 mother_pool_snapshot_sequence:1,membership_status:'ACTIVE',membership_effective_at:'2026-09-17T02:00:00Z',added_at:'2026-09-17T02:00:00Z',removed_at:null,source_reason:'isolated fixture',source_updated_at:null}]};
function publish(s,ok=true){return sql(`SELECT public.publish_fugle_daytrade_mother_pool_snapshot_v4_1('${JSON.stringify(s).replaceAll("'","''")}'::jsonb);`,ok);}
publish(fixture);
assert.equal(JSON.parse(publish(fixture)).idempotent,true);
let count=2;
function reject(label,change){const s=structuredClone(fixture);change(s);publish(s,false);console.log('PASS '+label);count++;}
reject('same run changed reason',s=>s.symbol_membership[0].source_reason='changed');
reject('same run added member',s=>{s.symbols.push('2317');s.symbol_count=2;s.symbol_membership.push({...s.symbol_membership[0],symbol:'2317'});});
reject('duplicate symbol',s=>{s.symbols.push('2330');s.symbol_count=2;});
reject('duplicate membership',s=>s.symbol_membership.push(s.symbol_membership[0]));
reject('wrong date',s=>s.symbol_membership[0].trade_date='2026-09-16');
reject('mixed sequence',s=>s.symbol_membership[0].mother_pool_snapshot_sequence=2);
reject('partial receipt',s=>s.complete=false);
reject('missing contract',s=>delete s.contract);
reject('count mismatch',s=>s.symbol_count=2);
reject('missing member',s=>s.symbol_membership=[]);
assert.equal(sql('select count(*) from public.fugle_daytrade_mother_pool_snapshot_members_v4_1;'),'1');
const empty={...fixture,trade_date:'2026-09-15',canonical_run_id:'fugle_daytrade_source:20260915:canonical',
 generated_at:'2026-09-15T02:00:00Z',effective_at:'2026-09-15T02:00:00Z',
 run_id:'isolated-2',snapshot_sequence:1,symbol_count:0,symbols:[],added_symbols:[],symbol_membership:[],previous_run_id:null};
publish(empty);
assert.equal(sql("SET ROLE anon; SELECT count(*) FROM public.v_fugle_daytrade_mother_pool_snapshot_v4_1 WHERE mother_pool_run_id='isolated-2' AND symbol IS NULL AND symbol_count=0;").split('\n').at(-1),'1');
assert.equal(sql("SET ROLE anon; SELECT count(*) FROM public.v_fugle_daytrade_mother_pool_snapshot_v4_1 WHERE mother_pool_run_id='isolated-1';").split('\n').at(-1),'1');
sql('SET ROLE anon; SELECT * FROM public.fugle_daytrade_mother_pool_snapshots_v4_1;',false);
sql(`SET ROLE anon; SELECT public.publish_fugle_daytrade_mother_pool_snapshot_v4_1('{}');`,false);
console.log(JSON.stringify({isolated:true,complete:false,checks_passed:count+5,production_written:false,
 remaining:['concurrent publication','formal deployment','production anon paging','natural member changes']}));
