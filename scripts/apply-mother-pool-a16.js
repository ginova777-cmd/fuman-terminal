'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
(async()=>{
 if(!process.argv.includes('--apply'))throw Error('APPLY_REQUIRED');
 const runtime=process.env.FUMAN_RUNTIME_DIR||'C:/fuman-runtime';
 const guard=spawnSync(process.execPath,[path.join(__dirname,'supabase-incident-guard.js'),'check','--class=writer','--action=a16-schema'],{encoding:'utf8',windowsHide:true});if(guard.status!==0)throw Error('SUPABASE_INCIDENT_BLOCKED');
 const sql=fs.readFileSync(path.join(__dirname,'../ops/public-slot/MotherPoolA16BaselinesV1.sql'),'utf8');
 const key=fs.readFileSync(path.join(runtime,'secrets/supabase-service-role-key.txt'),'utf8').trim();
 const url=(process.env.SUPABASE_URL||'https://cpmpfhbzutkiecccekfr.supabase.co')+'/rest/v1/rpc/exec_sql';
 let ok=false;for(const name of ['query','sql']){const r=await fetch(url,{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({[name]:sql}),signal:AbortSignal.timeout(30000)});if(r.ok){ok=true;break;}if(![400,404].includes(r.status))throw Error('A16_SCHEMA_HTTP_'+r.status);}
 let method='exec_sql';
 if(!ok){
  // Existing release-owner PostgreSQL access, scoped to this additive migration.
  const connection=new URL(fs.readFileSync(path.join(runtime,'secrets/supabase-db-url.txt'),'utf8').trim());
  const r=spawnSync(process.env.PSQL_PATH||'C:/Program Files/PostgreSQL/17/bin/psql.exe',['-v','ON_ERROR_STOP=1','-f',path.join(__dirname,'../ops/public-slot/MotherPoolA16BaselinesV1.sql')],{encoding:'utf8',windowsHide:true,timeout:60000,env:{...process.env,PGHOST:connection.hostname,PGPORT:connection.port||'5432',PGUSER:decodeURIComponent(connection.username),PGPASSWORD:decodeURIComponent(connection.password),PGDATABASE:connection.pathname.slice(1),PGSSLMODE:'require',PGCONNECT_TIMEOUT:'15'}});
  if(r.status!==0)throw Error('A16_SCHEMA_PSQL_FAILED:'+String(r.stderr||r.error?.message||'').slice(0,400));method='psql';
 }
 console.log(JSON.stringify({schema:'MotherPoolA16BaselinesV1',applied:true,method}));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
