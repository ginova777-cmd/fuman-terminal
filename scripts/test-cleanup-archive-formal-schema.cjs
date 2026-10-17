'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const base=path.resolve(__dirname,'../../../outputs/TOM-CLEANUP-FIRST-COMPLETE-20261017'),dir=path.join(base,'release-gates-final/sql'),{PGlite}=require(path.join(base,'isolated-sql-runtime/node_modules/@electric-sql/pglite'));
(async()=>{const db=new PGlite();try{
 await db.exec('CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;SET check_function_bodies=false');
 for(const f of JSON.parse(fs.readFileSync(path.join(dir,'formal-restore-functions.json'))).rows)await db.exec(f.definition);
 await db.exec(fs.readFileSync(path.join(dir,'formal-scoped-schema.sql'),'utf8').replace(/^\\.*$/gm,''));
 for(const f of JSON.parse(fs.readFileSync(path.join(dir,'formal-functions-live.json'))).rows)await db.exec(f.definition);
 for(const f of ['CleanupArchiveBudget_20261017.sql','CleanupObservabilityArchive_20261017.sql','CleanupExtendedObservation_20261017.sql'])await db.exec(fs.readFileSync(path.join(__dirname,'../ops/public-slot',f),'utf8'));
 const tables=(await db.query("select tablename from pg_tables where schemaname='public'")).rows.map(r=>r.tablename),archive=Object.fromEntries(tables.map(t=>[t,[]]));
 await db.exec('SET search_path=public,pg_catalog'); const checks=[];
 for(const sql of ['select fuman_cleanup_source_observability_15d_once(false,5000,10) result','select fuman_extended_cleanup_v1(false,ARRAY[]::text[]) result','select fuman_cleanup_source_observability_15d_once(true,5000,10,$1) result','select fuman_extended_cleanup_v1(true,ARRAY[]::text[],$1) result']){const r=(await db.query(sql,sql.includes('$1')?[JSON.stringify(archive)]:[])).rows[0].result;assert.equal(r.ok,true);checks.push({sql,result:r});}
 const signatures=(await db.query("select p.oid::regprocedure::text signature,p.proconfig,has_function_privilege('anon',p.oid,'EXECUTE') anon,has_function_privilege('service_role',p.oid,'EXECUTE') service_role from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and ((p.proname='fuman_extended_cleanup_v1' and p.pronargs=3) or (p.proname='fuman_cleanup_source_observability_15d_once' and p.pronargs=4))")).rows;
 assert.equal(signatures.length,2);for(const s of signatures){assert.equal(s.anon,false);assert.equal(s.service_role,true);assert(s.proconfig.includes('lock_timeout=2s'));}
 fs.writeFileSync(path.join(dir,'archive-budget-formal-schema-result.json'),JSON.stringify({scope:'isolated real formal schema; zero rows, no production execution',checks,signatures,ok:true},null,2));console.log('formal schema install/preview/zero apply/signatures ACL PASS');
}finally{await db.close();}})().catch(e=>{console.error(e);process.exitCode=1;});

