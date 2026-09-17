'use strict';
// Metadata only. Credentials remain in process environment, never command arguments/output.
const fs=require('node:fs'),{spawnSync}=require('node:child_process');
const out=process.argv.find(x=>x.startsWith('--out='))?.slice(6);
if(!out||fs.existsSync(out))throw Error('NEW_OUTPUT_PATH_REQUIRED');
const u=new URL(fs.readFileSync('C:/fuman-runtime/secrets/supabase-db-url.txt','utf8').trim());
const env={...process.env,PGHOST:u.hostname,PGPORT:u.port||'5432',PGDATABASE:decodeURIComponent(u.pathname.slice(1)),PGUSER:decodeURIComponent(u.username),PGPASSWORD:decodeURIComponent(u.password),PGSSLMODE:'require',PGCONNECT_TIMEOUT:'10'};
const sql=`BEGIN READ ONLY; SET LOCAL statement_timeout='8s';
SELECT json_build_object('checked_at',clock_timestamp(),
'columns',(SELECT json_agg(json_build_object('name',column_name,'type',data_type,'generated',is_generated)) FROM information_schema.columns WHERE table_schema='public' AND table_name='fugle_daytrade_intraday_1m'),
'rpc',(SELECT json_agg(json_build_object('signature',p.oid::regprocedure::text,'result',pg_get_function_result(p.oid),'anon_execute',has_function_privilege('anon',p.oid,'EXECUTE'))) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='get_fugle_daytrade_intraday_1m_latest_n')); COMMIT;`;
const r=spawnSync('C:/Program Files/PostgreSQL/17/bin/psql.exe',['-w','-X','-q','-A','-t','-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8',env,timeout:15000,windowsHide:true});
const evidence=r.status===0?JSON.parse(r.stdout):null;
const fields=['symbol','market','trade_date','candle_time','open','high','low','close','volume','updated_at','source','synthetic','volume_strategy_usable','payload','source_channel','candle_origin','websocket_row','rest_repair_row','intraday_odd_lot'];
const columns=new Map((evidence?.columns||[]).map(c=>[c.name,c]));
const missing=evidence?fields.filter(f=>!columns.has(f)):null;
const generated=fields.filter(f=>columns.has(f)&&columns.get(f).generated!=='NEVER');
const report={contract:'b01_deployment_schema_audit_v1',complete:false,production_written:false,actual_anon_readback:false,evidence,required_write_fields:fields,missing_fields:missing,generated_write_fields:evidence?generated:null,metadata_compatible:!!evidence&&!missing.length&&!generated.length,query_exit_code:r.status??1,error:r.status===0?null:'READ_ONLY_SCHEMA_QUERY_FAILED'};
fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(report));process.exitCode=report.metadata_compatible?0:1;
