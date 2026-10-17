'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const source=fs.readFileSync(path.join(__dirname,'test-cleanup-database-observation.js'),'utf8').replaceAll('\r\n','\n');
const output=path.resolve(__dirname,'../../../outputs/TOM-CLEANUP-FIRST-COMPLETE-20261017/release-gates-final/archive-races');fs.mkdirSync(output,{recursive:true});
async function fixture(kind,run){
 const title=kind==='C20'?'C20 actual runner binds full PostgreSQL inventory deletion and protected readback to its run':'C21-C23 candidate SQL and runner emit same-run full row protection proofs';
 const start=source.indexOf("test('"+title+"',async()=>{")+"test('".length+title.length+"',async()=>{".length,end=source.indexOf(' const file=path.join',start);
 assert(start>0&&end>start);const setup=source.slice(start,end);
 return new AsyncFunction('require','__dirname','run',"const fs=require('fs'),path=require('path');"+setup+"await run(db,runtime,typeof prefixes==='undefined'?tables:prefixes.flatMap(p=>[p+'_runs',p+'_results']).concat('fugle_daytrade_quote_snapshots'));}finally{await db.close();}")(require,__dirname,run);
}
async function capture(db,tables){const result={};for(const table of tables)result[table]=(await db.query('select to_jsonb(t) value from '+table+' t order by to_jsonb(t)::text')).rows.map(r=>r.value);return result;}
for(const kind of ['C20','C21-C23'])for(const mode of ['insert','update','duplicate-multiplicity','legacy-apply'])test(kind+' rejects unsealed '+mode+' before commit',async()=>fixture(kind,async(db,runtime,tables)=>{
 const first=tables[0];
 if(mode==='duplicate-multiplicity'){
  const table=kind==='C20'?first:'warrant_flow_scan_results';await db.exec(`alter table ${table} drop constraint ${table}_pkey`);
  if(kind!=='C20')await db.exec("insert into warrant_flow_scan_results values(999,'warrant_flow_scan-failed-1',now()-interval '50 days','{}')");
 }
 const original=await capture(db,tables),archive=require('./cleanup-recovery-archive').seal(runtime,'isolated-race-'+kind.replaceAll('-',''),kind,original),sealed=require('./cleanup-recovery-archive').verify(archive.index).tables;
 if(kind==='C20'){
  if(mode==='insert')await db.exec(`insert into ${first} values(99,current_date-40,'{"racing":true}')`);
  if(mode==='update')await db.exec(`update ${first} set payload='{"racing":true}' where id=1`);
  if(mode==='duplicate-multiplicity')await db.exec(`insert into ${first} select * from ${first} where id=1`);
 }else{
  if(mode==='insert')await db.exec("insert into warrant_flow_scan_results values(default,'racing-orphan',now()-interval '50 days','{}')");
  if(mode==='update')await db.exec("update warrant_flow_scan_runs set payload='{\"racing\":true}' where run_id='warrant_flow_scan-failed-1'");
  if(mode==='duplicate-multiplicity')await db.exec('insert into warrant_flow_scan_results select * from warrant_flow_scan_results where id=999');
 }
 const beforeApply=await capture(db,tables);let error;
 try{if(kind==='C20')await db.query(mode==='legacy-apply'?'select fuman_cleanup_source_observability_15d_once(true,5000,10)':'select fuman_cleanup_source_observability_15d_once(true,5000,10,$1::jsonb)',mode==='legacy-apply'?[]:[JSON.stringify(sealed)]);else await db.query(mode==='legacy-apply'?'select fuman_extended_cleanup_v1(true,ARRAY[]::text[])':'select fuman_extended_cleanup_v1(true,ARRAY[]::text[],$1::jsonb)',mode==='legacy-apply'?[]:[JSON.stringify(sealed)]);}catch(e){error=e.message;}
 assert.match(error||'',mode==='legacy-apply'?/cleanup_archive_required/:/cleanup_unarchived_payload/);const after=await capture(db,tables);assert.deepEqual(after,beforeApply,'entire statement must roll back earlier table deletions');
 fs.writeFileSync(path.join(output,kind+'-'+mode+'.json'),JSON.stringify({scope:'isolated PostgreSQL actual candidate SQL',kind,mode,error,archive,rowsBeforeApply:Object.fromEntries(Object.entries(beforeApply).map(([t,r])=>[t,r.length])),rowsAfter:Object.fromEntries(Object.entries(after).map(([t,r])=>[t,r.length])),allPayloadsUnchanged:true},null,2));
}));
test('client archive budget consumes duplicate multiplicity across RPC batches',()=>{
 const {consume}=require('./cleanup-archive-budget.cjs'),budget={t:[{id:1},{id:1}]};consume(budget,{t:[{id:1}]});assert.equal(budget.t.length,1);consume(budget,{t:[{id:1}]});assert.equal(budget.t.length,0);assert.throws(()=>consume(budget,{t:[{id:1}]}),/cleanup_unarchived_payload/);
});

test('typed archive normalizes equivalent timezone offsets and rejects changed timestamp',async()=>fixture('C20',async(db)=>{
 await db.exec('CREATE TABLE archive_clock(id int,at timestamptz);INSERT INTO archive_clock VALUES(1,\'2026-01-01T00:00:00Z\');SET timezone=\'Asia/Taipei\'');
 const selected=(await db.query('select to_jsonb(t) value from archive_clock t')).rows.map(r=>r.value),archive={archive_clock:[{id:1,at:'2026-01-01T00:00:00Z'}]};
 const remaining=(await db.query('select fuman_cleanup_consume_archive_v1($1,\'archive_clock\',$2) value',[JSON.stringify(archive),JSON.stringify(selected)])).rows[0].value;assert.deepEqual(remaining.archive_clock,[]);
 archive.archive_clock[0].at='2026-01-01T00:00:01Z';await assert.rejects(db.query('select fuman_cleanup_consume_archive_v1($1,\'archive_clock\',$2)',[JSON.stringify(archive),JSON.stringify(selected)]),/cleanup_unarchived_payload/);
}));
for(const kind of ['C20','C21-C23'])for(const mode of ['delete-trigger','external-cascade'])test(kind+' rejects '+mode,async()=>fixture(kind,async(db,runtime,tables)=>{
 const table=kind==='C20'?tables[0]:'fugle_daytrade_quote_snapshots';
 if(mode==='delete-trigger')await db.exec(`CREATE FUNCTION forbidden_effect() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN OLD;END$$;CREATE TRIGGER forbidden_effect BEFORE DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION forbidden_effect()`);
 else await db.exec(`CREATE TABLE outside_consumer(parent_id ${kind==='C20'?'integer':'text'} REFERENCES ${table}(id) ON DELETE CASCADE)`);
 const archived=await capture(db,tables);await assert.rejects(db.query(kind==='C20'?'select fuman_cleanup_source_observability_15d_once(true,5000,10,$1)':'select fuman_extended_cleanup_v1(true,ARRAY[]::text[],$1)',[JSON.stringify(archived)]),/cleanup_unreviewed_|quote_snapshot_dependencies/);assert.deepEqual(await capture(db,tables),archived);
}));

