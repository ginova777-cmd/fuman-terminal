'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const {PGlite}=require(path.resolve(__dirname,'../../../outputs/TOM-CLEANUP-FIRST-COMPLETE-20261017/isolated-sql-runtime/node_modules/@electric-sql/pglite'));
for(const [table,column]of [['mobile_update_events','created_at'],['market_snapshots','updated_at'],['fugle_daytrade_entry_history','trade_date'],['seven_strategy_daily_history','trade_date']])test('history archive-bound transaction '+table,async()=>{
 const db=new PGlite();try{
 await db.exec(`CREATE ROLE service_role;CREATE TABLE ${table}(id bigint PRIMARY KEY,${column} ${column==='trade_date'?'date':'timestamptz'},symbol text,payload jsonb);INSERT INTO ${table} VALUES(1,'2020-01-01','__fuman_fixture','{"n":1}'),(2,'2099-01-01','keep','{}');`);
 await db.exec(fs.readFileSync(path.join(__dirname,'../ops/public-slot/CleanupHistoryRecoveryBound_20261017.sql'),'utf8'));
 await db.exec("SET timezone='Asia/Taipei';");
 const rows=(await db.query(`SELECT to_jsonb(t) row FROM ${table} t ORDER BY id`)).rows.map(r=>r.row);
 const apply=()=>db.query('SELECT fuman_cleanup_history_recovery_bound_v1($1,$2,$3) r',[table,'2025-01-01',JSON.stringify(rows)]);
 await db.exec(`INSERT INTO ${table} VALUES(3,'2020-01-01','__fuman_new','{}')`);await assert.rejects(apply(),/unarchived_candidate/);assert.equal((await db.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n,3);await db.exec(`DELETE FROM ${table} WHERE id=3`);
 await db.exec(`UPDATE ${table} SET payload='{"n":2}' WHERE id=1`);await assert.rejects(apply(),/unarchived_candidate/);await db.exec(`UPDATE ${table} SET payload='{"n":1}' WHERE id=1`);
 await assert.rejects(db.query('SELECT fuman_cleanup_history_recovery_bound_v1($1,now(),$2)',[table,JSON.stringify(rows)]),/retention_shortened/);
 const result=(await apply()).rows[0].r;assert.equal(result.deleted,1);assert.deepEqual(result.deletedRows,[rows[0]]);
 assert.deepEqual((await db.query(`SELECT to_jsonb(t) row FROM ${table} t`)).rows.map(r=>r.row),[rows[1]]);
 await db.query(`INSERT INTO ${table} SELECT * FROM jsonb_populate_record(null::${table},$1)`,[JSON.stringify(result.deletedRows[0])]);assert.deepEqual((await db.query(`SELECT to_jsonb(t) row FROM ${table} t ORDER BY id`)).rows.map(r=>r.row),rows);
 }finally{await db.close();}
});
