'use strict';
// Dedicated localhost isolated PostgreSQL only. Never accepts a production connection URL.
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),cp=require('child_process');
const bin='C:/Program Files/PostgreSQL/17/bin/psql.exe',args=['-h','127.0.0.1','-p','55437','-U','postgres','-d','postgres','-X','-qAt'];
const out=path.resolve(__dirname,'../../../outputs/TOM-CLEANUP-FIRST-COMPLETE-20261017/release-gates-final');
function run(sql,strict=true){const r=cp.spawnSync(bin,[...args,'-v','ON_ERROR_STOP='+(strict?'1':'0')],{input:sql,encoding:'utf8',timeout:10000});if(strict)assert.equal(r.status,0,r.stderr);return {status:r.status,stdout:r.stdout,stderr:r.stderr};}
(async()=>{
 const actualDataDirectory=run('SHOW data_directory;').stdout.trim().replaceAll('\\','/');assert.equal(actualDataDirectory.toLowerCase(),path.join(out,'c20-lock-pg').replaceAll('\\','/').toLowerCase(),'only dedicated isolated cluster allowed');
 const result={scope:'isolated native PostgreSQL localhost port55437; no formal connection',checks:[]};
 run(`CREATE TABLE IF NOT EXISTS fuman_retention_cleanup_log(table_name text,keep_from_date date,deleted_rows int,mode text,note text,keep_policy text,audit_payload jsonb);`);
 run(fs.readFileSync(path.join(__dirname,'../ops/public-slot/CleanupObservabilityArchive_20261017.sql'),'utf8'));
 run(`CREATE OR REPLACE FUNCTION isolation_cancel() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'isolated query cancellation' USING ERRCODE='57014'; END$$;CREATE TRIGGER isolation_cancel BEFORE INSERT ON fuman_retention_cleanup_log FOR EACH ROW EXECUTE FUNCTION isolation_cancel();`);
 let r=run(`SELECT fuman_cleanup_source_observability_15d_once(false,5000,10,NULL::jsonb);SELECT 'remaining='||count(*) FROM pg_locks WHERE locktype='advisory' AND pid=pg_backend_pid();`,false);
 assert.match(r.stderr,/isolated query cancellation/);assert.match(r.stdout,/remaining=0/);result.checks.push({name:'query_canceled_same_session_lock_released',...r});
 run(`CREATE OR REPLACE FUNCTION isolation_cancel() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN PERFORM pg_sleep(2);RETURN NEW;END$$;`);
 r=run(`SET statement_timeout='100ms';SELECT fuman_cleanup_source_observability_15d_once(false,5000,10,NULL::jsonb);SET statement_timeout=0;SELECT 'remaining='||count(*) FROM pg_locks WHERE locktype='advisory' AND pid=pg_backend_pid();`,false);
 assert.match(r.stderr,/statement timeout/);assert.match(r.stdout,/remaining=0/);result.checks.push({name:'statement_timeout_same_session_lock_released',...r});
 run('DROP TRIGGER isolation_cancel ON fuman_retention_cleanup_log;');
 const held=cp.spawn(bin,args,{stdio:['pipe','pipe','pipe']});let text='';
 const ready=new Promise((resolve,reject)=>{held.stdout.on('data',b=>{text+=b;if(text.includes('LOCKED'))resolve();});held.on('error',reject);});
 held.stdin.write("SELECT pg_advisory_lock(2026081425);SELECT 'LOCKED';\n");await ready;
 r=run('SELECT fuman_cleanup_source_observability_15d_once(false,5000,10,NULL::jsonb);');assert.match(r.stdout,/source_observability_retention_lock_contended/);result.checks.push({name:'legacy_session_lock_same_key_blocks_new_xact_lock',...r});
 held.stdin.end("SELECT pg_advisory_unlock(2026081425);\n\\q\n");await new Promise(resolve=>held.on('close',resolve));
 r=run('SELECT fuman_cleanup_source_observability_15d_once(false,5000,10,NULL::jsonb);');assert.equal(JSON.parse(r.stdout.trim()).ok,true);result.checks.push({name:'after_release_candidate_succeeds',...r});
 fs.writeFileSync(path.join(out,'c20-native-lock-result.json'),JSON.stringify(result,null,2));console.log('native PostgreSQL 4 lock checks PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});

