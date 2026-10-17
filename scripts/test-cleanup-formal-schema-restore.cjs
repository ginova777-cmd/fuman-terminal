const fs=require('fs'),path=require('path'),assert=require('assert/strict'),crypto=require('crypto');
const base=process.argv[2]||path.resolve(__dirname,'../../../outputs/TOM-CLEANUP-FIRST-COMPLETE-20261017'),dir=path.join(base,'release-gates-final/sql'),{PGlite}=require(path.join(base,'isolated-sql-runtime/node_modules/@electric-sql/pglite'));
(async()=>{const db=new PGlite();try{
await db.exec('CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;');
const functions=JSON.parse(fs.readFileSync(path.join(dir,'formal-restore-functions.json'))).rows;
await db.exec('SET check_function_bodies=false;');for(const f of functions)await db.exec(f.definition);
const schema=fs.readFileSync(path.join(dir,'formal-scoped-schema.sql'),'utf8').replace(/^\\.*$/gm,'');await db.exec(schema);
const samples=JSON.parse(fs.readFileSync(path.join(dir,'formal-restore-samples.json'))),tables=Object.keys(samples).sort((a,b)=>Number(b.endsWith('_runs'))-Number(a.endsWith('_runs')));
const matrix=[];
for(const t of tables){for(const row of samples[t])await db.query(`INSERT INTO public.${t} SELECT * FROM jsonb_populate_record(null::public.${t},$1::jsonb)`,[JSON.stringify(row)]);matrix.push({table:t,rows:samples[t].length});}
// Empty production tables receive explicitly synthetic isolated rows; never production evidence.
await db.exec('SET search_path=public,pg_catalog;');
const synthetic={
 cb_detect_scan_runs: "INSERT INTO cb_detect_scan_runs(run_id) VALUES('restore-fixture')",
 warrant_flow_scan_runs:"INSERT INTO warrant_flow_scan_runs(run_id,scan_date) VALUES('restore-fixture',current_date)",
 strategy1_open_buy_runs:"INSERT INTO strategy1_open_buy_runs(run_id,scan_date) VALUES('restore-fixture',current_date)",
 cb_detect_scan_results:"INSERT INTO cb_detect_scan_results(run_id,symbol) VALUES('restore-fixture','FIXTURE')",
 warrant_flow_scan_results:"INSERT INTO warrant_flow_scan_results(run_id,scan_date,code) VALUES('restore-fixture',current_date,'FIXTURE')",
 strategy1_open_buy_results:"INSERT INTO strategy1_open_buy_results(run_id,scan_date,code) VALUES('restore-fixture',current_date,'FIXTURE')",
 seven_strategy_daily_history:`INSERT INTO seven_strategy_daily_history(trade_date,detect_time,symbol,name,entry_price,strategy,signal_type,evidence) VALUES(current_date,'09:01','FIXTURE','isolated only',1,'fixture','formal','{"source_status":"ready","gate_grade":"A","gate_status":"ready","formal_entry_speed_verdict":"YES","formal_entry_allowed":true}')`,
 fugle_source_coverage:"INSERT INTO fugle_source_coverage(source_name,trade_date) VALUES('fixture',current_date)"
};
for(const t of tables)if(!samples[t].length){await db.exec(synthetic[t]);matrix.find(x=>x.table===t).synthetic=true;}
const baseline={};for(const t of tables)baseline[t]=(await db.query(`SELECT to_jsonb(t) row FROM public.${t} t ORDER BY to_jsonb(t)::text`)).rows.map(r=>r.row);
const recovery=require('./cleanup-recovery-archive');
const sealed=recovery.seal(path.join(base,'formal-schema-restore-isolation'),'schema-restore-'+Date.now(),'all-tables',baseline);
for(const t of [...tables].reverse())await db.exec('DELETE FROM public.'+t);
const payload=recovery.verify(sealed.index,sealed);
for(const t of tables)for(const row of payload.tables[t])await db.query(`INSERT INTO public.${t} SELECT * FROM jsonb_populate_record(null::public.${t},$1::jsonb)`,[JSON.stringify(row)]);
for(const t of tables){const after=(await db.query(`SELECT to_jsonb(t) row FROM public.${t} t ORDER BY to_jsonb(t)::text`)).rows.map(r=>r.row);assert.deepEqual(after,baseline[t]);}
const sequenceChecks=[];
for(const m of schema.matchAll(/ALTER SEQUENCE public\.(\w+) OWNED BY public\.(\w+)\.(\w+);/g)){
 const [,seq,table,col]=m;const max=(await db.query(`SELECT coalesce(max(${col}),0)::text n FROM public.${table}`)).rows[0].n;
 await db.query(`SELECT setval('public.${seq}',greatest((SELECT last_value FROM public.${seq}),$1::bigint,1),true)`,[max]);
 const next=(await db.query(`SELECT nextval('public.${seq}')::text n`)).rows[0].n;assert(BigInt(next)>BigInt(max));sequenceChecks.push({seq,table,aboveRestoredMaximum:true});
}
await db.exec(fs.readFileSync(path.join(__dirname,'../ops/public-slot/CleanupHistoryRecoveryBound_20261017.sql'),'utf8'));
await db.exec("SET timezone='UTC'");const historyChecks=[];
for(const [t,col]of [['mobile_update_events','created_at'],['market_snapshots','updated_at'],['fugle_daytrade_entry_history','trade_date'],['seven_strategy_daily_history','trade_date']]){
 await db.exec(`UPDATE public.${t} SET ${col}='2020-01-01'`);if(t==='market_snapshots')await db.exec("UPDATE market_snapshots SET symbol='__fuman_restore_fixture'");
 const rows=(await db.query(`SELECT to_jsonb(t) row FROM public.${t} t`)).rows.map(r=>r.row);
 await db.exec(`UPDATE public.${t} SET ${col}='2020-01-02'`);
 await assert.rejects(db.query('SELECT fuman_cleanup_history_recovery_bound_v1($1,$2,$3)',[t,'2025-01-01',JSON.stringify(rows)]),/unarchived_candidate/);
 assert.equal(Number((await db.query(`SELECT count(*) n FROM public.${t}`)).rows[0].n),rows.length);
 await db.exec(`UPDATE public.${t} SET ${col}='2020-01-01'`);
 await db.exec("SET timezone='UTC'");const current=(await db.query(`SELECT to_jsonb(t) row FROM public.${t} t`)).rows.map(r=>r.row);const r=(await db.query('SELECT fuman_cleanup_history_recovery_bound_v1($1,$2,$3) value',[t,'2025-01-01',JSON.stringify(rows)])).rows[0].value;assert.equal(r.deleted,rows.length);
 for(const row of r.deletedRows)await db.query(`INSERT INTO public.${t} SELECT * FROM jsonb_populate_record(null::public.${t},$1::jsonb)`,[JSON.stringify(row)]);
 assert.deepEqual((await db.query(`SELECT to_jsonb(t) row FROM public.${t} t`)).rows.map(r=>r.row),rows);
 historyChecks.push({table:t,deleted:r.deleted,restore:true,updatedUnarchivedRejected:true});
}
const result={scope:'isolated real schema with original triggers/FKs and bounded read-only production samples; NOT full production restore',ok:true,matrix,sequenceChecks,historyChecks,archive:sealed,checkedAt:new Date().toISOString()};fs.writeFileSync(path.join(dir,'schema-restore-result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({ok:true,matrix,sequenceChecks,historyChecks}));
}finally{await db.close();}})().catch(e=>{console.error(e.message);process.exitCode=1});
