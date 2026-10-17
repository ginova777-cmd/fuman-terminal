const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),crypto=require('crypto');
const recovery=require('./cleanup-recovery-archive');
test('durable recovery payload restores all fields into isolated PostgreSQL',async()=>{
 const {PGlite}=require(path.resolve(__dirname,'../../../outputs/TOM-CLEANUP-FIRST-COMPLETE-20261017/isolated-sql-runtime/node_modules/@electric-sql/pglite'));
 const runtime=fs.mkdtempSync(path.join(os.tmpdir(),'cleanup-row-restore-')),db=new PGlite();
 try{await db.exec('create table fixture(id integer primary key,run_id text,price numeric,payload jsonb,at timestamptz);');
 await db.query('insert into fixture values(1,$1,12.345,$2,$3),(2,$1,null,null,$3)',['same-run',JSON.stringify({null:null,unicode:'保護',array:[1,false]}),'2026-10-17T00:00:00Z']);
 const before=(await db.query('select to_jsonb(t) row from fixture t order by id')).rows.map(r=>r.row),sealed=recovery.seal(runtime,'isolated-restore','C11',{fixture:before});
 await db.exec('delete from fixture');assert.equal((await db.query('select count(*)::int n from fixture')).rows[0].n,0);
 const payload=recovery.verify(sealed.index);for(const row of payload.tables.fixture)await db.query('insert into fixture select * from jsonb_populate_record(null::fixture,$1::jsonb)',[JSON.stringify(row)]);
 const after=(await db.query('select to_jsonb(t) row from fixture t order by id')).rows.map(r=>r.row);assert.deepEqual(after,before);
 fs.writeFileSync(path.join(runtime,'restore-result.json'),JSON.stringify({scope:'isolated PostgreSQL restore; no formal restore',runId:payload.runId,rows:after.length,sha256:crypto.createHash('sha256').update(JSON.stringify(after)).digest('hex'),ok:true}));console.log(JSON.stringify({restoreEvidence:runtime}));
 assert.throws(()=>recovery.verify(sealed.index,{...sealed,indexSha256:'wrong'}),/binding/);
 assert.throws(()=>recovery.seal(runtime,'isolated-restore','C11',{fixture:before}),/EEXIST/);
 fs.appendFileSync(sealed.file,'changed');assert.throws(()=>recovery.verify(sealed.index));
 }finally{await db.close();}
});
test('recovery rejects unsafe identity and invalid table inventory before creating output',()=>{assert.throws(()=>recovery.seal(os.tmpdir(),'../escape','C11',{}),/identity/);assert.throws(()=>recovery.seal(os.tmpdir(),'valid','C11',{}),/inventory/);});
