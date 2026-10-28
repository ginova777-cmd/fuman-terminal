'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),vm=require('vm'),{createRequire}=require('module');
const observation=require('./cleanup-database-observation');
test('C21-C23 candidate SQL and runner emit same-run full row protection proofs',async()=>{
 const output=path.resolve(__dirname,'../..'),{PGlite}=require(path.join(output,'isolated-sql-runtime/node_modules/@electric-sql/pglite'));
 const db=new PGlite(),runtime=fs.mkdtempSync(path.join(output,'extended-observation-'));
 try{
 await db.exec('create table trade_records(run_id text,evidence_run_id text);create table market_snapshots(payload jsonb);create table fuman_scorecard_ledger(payload jsonb);');
 await db.exec(fs.readFileSync(path.join(__dirname,'../ops/public-slot/CleanupExtendedRetention_20260912.sql'),'utf8').split('REVOKE ALL')[0]);
 const prefixes=['strategy1_open_buy','strategy2_scan','strategy3_v2_scan','strategy4_scan','strategy5_scan','institution_scan','cb_detect_scan','warrant_flow_scan'];
 for(const p of prefixes)await db.exec(`create table ${p}_runs(run_id text primary key,complete boolean,status text,finished_at timestamptz,payload jsonb);create table ${p}_results(id serial primary key,run_id text,created_at timestamptz,payload jsonb);insert into ${p}_runs select '${p}-good-'||n,true,'complete',now()-n*interval '1 hour','{}' from generate_series(1,60)n;insert into ${p}_results values(default,'${p}-good-1',now(),'{"protected":true}');insert into ${p}_runs select '${p}-failed-'||n,false,'failed',now()-interval '50 days','{}' from generate_series(1,2)n;insert into ${p}_results values(default,'${p}-orphan',now()-interval '50 days','{}');`);
 await db.exec("insert into trade_records values('strategy1_open_buy-failed-1',null);create table fugle_daytrade_quote_snapshots(id text primary key,run_id text,snapshot_at timestamptz,payload jsonb);insert into fugle_daytrade_quote_snapshots values('a','quote',current_date-40,'{}'),('b','quote',current_date-40,'{}');");
 await db.exec(fs.readFileSync(path.join(__dirname,'../ops/public-slot/CleanupArchiveBudget_20261017.sql'),'utf8'));
 await db.exec(fs.readFileSync(path.join(__dirname,'../ops/public-slot/CleanupExtendedObservation_20261017.sql'),'utf8'));
 const file=path.join(__dirname,'cleanup-extended-retention.js'),native=createRequire(file),auth={runId:'isolated-extended-'+require('crypto').randomUUID()};
 const tables=new Set(prefixes.flatMap(p=>[p+'_runs',p+'_results']).concat('fugle_daytrade_quote_snapshots'));
 const ctx={module:{exports:{}},__dirname,require:n=>n==='../lib/server-supabase-key'?{serviceRoleKey:()=> 'fixture',terminalSupabaseUrl:()=> 'https://fixture.invalid'}:native(n),process:{argv:[],env:{FUMAN_RUNTIME_DIR:runtime}},console,AbortSignal,auth};
 let pages=0;
 ctx.fetch=async(url,options)=>{assert(url.startsWith('https://fixture.invalid/rest/v1/'));const u=new URL(url),table=u.pathname.split('/').at(-1);if(u.pathname.includes('/rpc/')){assert.equal(table,'fuman_extended_cleanup_v1');const b=JSON.parse(options.body),value=(await db.query(b.p_apply?'select fuman_extended_cleanup_v1($1,$2,$3::jsonb) value':'select fuman_extended_cleanup_v1($1,$2) value',b.p_apply?[b.p_apply,b.p_protected_run_ids,JSON.stringify(b.p_archive)]:[b.p_apply,b.p_protected_run_ids])).rows[0].value;return {ok:true,text:async()=>JSON.stringify(value)};}
 assert(tables.has(table));pages++;const all=(await db.query('select to_jsonb(r) value from '+table+' r order by '+(table.endsWith('_runs')?'run_id':'id'))).rows.map(r=>r.value),offset=Number(u.searchParams.get('offset'));return {ok:true,headers:{get:()=> '0-0/'+all.length},text:async()=>JSON.stringify(all.slice(offset,offset+7))};};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync(file,'utf8'),ctx);
 const result=await vm.runInContext('databaseCleanup(true,{ids:[]},auth)',ctx);assert.equal(result.ok,true);assert.equal(result.cleanupItems.length,3);
 const proof=require('./cleanup-item-observation');for(const item of result.cleanupItems){assert.equal(proof.verify(item).runId,auth.runId);assert.equal(item.remaining,0);assert(item.deleted>0);}
 assert.deepEqual(Array.from(result.cleanupItems,i=>i.deleted),[15,8,1]);assert(pages>100);
 const receiptFile=path.join(runtime,'database-result.json');fs.writeFileSync(receiptFile,JSON.stringify({scope:'isolated PostgreSQL, new candidate SQL only',...result},null,2));console.log(JSON.stringify({receiptFile,pages}));
 const oldSql=fs.readFileSync(path.join(__dirname,'../ops/public-slot/CleanupExtendedQueryPlan_20260919.sql'),'utf8').split('REVOKE ALL')[0];
 await db.exec(oldSql);
 await assert.rejects(vm.runInContext('databaseCleanup(true,{ids:[]},auth)',ctx),/extended_candidate_identity_missing/);
 }finally{await db.close();}
});
test('complete database inventory continues past service caps and rejects missing counts',async()=>{
 const values=[{id:1},{id:2},{id:3}];let calls=0;
 const read=async url=>{calls++;const offset=Number(new URL(url).searchParams.get('offset'));return {ok:true,headers:{get:()=> '0-0/3'},text:async()=>JSON.stringify(values.slice(offset,offset+1))};};
 assert.equal((await observation.inventory('fixture','id.asc',{url:'https://fixture.invalid',headers:{},fetch:read})).length,3);assert.equal(calls,4);
 await assert.rejects(observation.inventory('fixture','id.asc',{url:'https://fixture.invalid',headers:{},fetch:async()=>({ok:true,headers:{get:()=>null}})}),/count_missing/);
});
test('C20 actual runner binds full PostgreSQL inventory deletion and protected readback to its run',async()=>{
 const output=path.resolve(__dirname,'../..');
 const {PGlite}=require(path.join(output,'isolated-sql-runtime/node_modules/@electric-sql/pglite'));
 const db=new PGlite();const runtime=fs.mkdtempSync(path.join(output,'c20-observation-'));
 // Status RPC is an explicit isolated provider; deletion SQL and row readback stay real.
 const tables=['fugle_daytrade_source_scorecard','fugle_daytrade_source_speed_scorecard','fugle_daytrade_gate_scorecard','fugle_source_coverage'];
 try{
 for(const t of tables)await db.exec(`create table ${t}(id integer primary key,trade_date date,payload jsonb);insert into ${t} values(1,current_date-40,'{"kind":"expired"}'),(2,current_date,'{"kind":"protected"}');`);
 await db.exec('create table fuman_retention_cleanup_log(table_name text,keep_from_date date,deleted_rows integer,mode text,note text,keep_policy text,audit_payload jsonb)');

 await db.exec(fs.readFileSync(path.join(__dirname,'../ops/public-slot/CleanupArchiveBudget_20261017.sql'),'utf8'));
 await db.exec(fs.readFileSync(path.join(__dirname,'../ops/public-slot/CleanupObservabilityArchive_20261017.sql'),'utf8'));
 const file=path.join(__dirname,'cleanup-source-observability-retention.js'),native=createRequire(file),auth={runId:'isolated-c20-'+require('crypto').randomUUID()};
 const ctx={require:n=>n==='./cleanup-maintenance-context'?{authorization:()=>auth}:n==='../lib/server-supabase-key'?{serverSupabaseKey:()=> 'fixture',serverSupabaseUrl:()=> 'https://fixture.invalid'}:native(n),process:{env:{FUMAN_RUNTIME_DIR:runtime,FUMAN_CLEANUP_CONTEXT_FILE:'fixture'},argv:['node','fixture','--apply','--json']},console:{log:()=>{}},AbortSignal};
 let reads=0;
 ctx.fetch=async(url,options)=>{assert(url.startsWith('https://fixture.invalid/rest/v1/'));const u=new URL(url),name=u.pathname.split('/').at(-1);let rows;
 if(u.pathname.includes('/rpc/')){const b=JSON.parse(options.body);if(name==='fuman_source_observability_retention_status'){assert.equal(b.p_keep_days,15);rows={ok:true,keepDays:15,keepFromDate:(await db.query("select to_char(current_date-15,'YYYY-MM-DD') value")).rows[0].value,tables:await Promise.all(tables.map(async table=>({table,...(await db.query('select exists(select 1 from '+table+' where trade_date<current_date-15) as "hasOldRows",exists(select 1 from '+table+' where trade_date>=current_date-15) as "hasProtectedRows"')).rows[0]})))};}else if(name==='fuman_cleanup_source_observability_15d_once')rows=(await db.query('select fuman_cleanup_source_observability_15d_once($1,$2,$3,$4::jsonb) value',[b.p_apply,b.p_batch_size,b.p_max_batches_per_table,JSON.stringify(b.p_archive)])).rows[0].value;else throw Error('unexpected RPC');return {ok:true,text:async()=>JSON.stringify(rows)};}
 assert(tables.includes(name));reads++;const all=(await db.query('select to_jsonb(t) value from '+name+' t order by trade_date,id')).rows.map(r=>r.value);const offset=Number(u.searchParams.get('offset'));rows=all.slice(offset,offset+1);return {ok:true,headers:{get:()=> '0-0/'+all.length},text:async()=>JSON.stringify(rows)};
 };
 vm.createContext(ctx);vm.runInContext(fs.readFileSync(file,'utf8').split('main().catch(')[0],ctx);await vm.runInContext('main()',ctx);
 const receiptFile=path.join(runtime,'status',fs.readdirSync(path.join(runtime,'status')).find(f=>f.startsWith('source-observability'))),receipt=JSON.parse(fs.readFileSync(receiptFile));
 const item=require('./cleanup-item-observation').verify(receipt.cleanupItems[0]);assert.equal(receipt.ok,true);assert.equal(item.runId,auth.runId);assert.equal(item.scanned,8);assert.equal(item.deleted,4);assert.equal(item.protectedSet.length,4);assert.equal(item.remaining,0);assert.equal(reads,20);
 console.log(JSON.stringify({scope:'isolated PostgreSQL C20 execution, not formal',receiptFile,reads}));
 }finally{await db.close();}
});
