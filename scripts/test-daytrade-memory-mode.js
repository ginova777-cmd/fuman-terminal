'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const text=fs.readFileSync(path.join(__dirname,'fugle-websocket-collector.js'),'utf8');
const start=text.indexOf('const COLLECTOR_ROLE ='),end=text.indexOf('let memoryDetectionHost',start);
assert(start>=0&&end>start);
const code=text.slice(start,end)+'\n({enabled:MEMORY_ENABLED,only:MEMORY_ONLY});';
function mode(env){const r=vm.runInNewContext(code,{process:{env}});return {enabled:r.enabled,only:r.only};}
assert.deepEqual(mode({FUGLE_COLLECTOR_ROLE:'daytrade'}),{enabled:true,only:false});
assert.deepEqual(mode({}),{enabled:false,only:false});
assert.deepEqual(mode({FUGLE_COLLECTOR_ROLE:'daytrade',FUMAN_MOTHER_POOL_DETECTION_MODE:'legacy'}),{enabled:false,only:false});
assert.deepEqual(mode({FUGLE_COLLECTOR_ROLE:'daytrade',FUMAN_MOTHER_POOL_RETENTION_MODE:'one_minute_only'}),{enabled:true,only:true});
assert.deepEqual(mode({FUGLE_COLLECTOR_ROLE:'default',FUMAN_MOTHER_POOL_RETENTION_MODE:'one_minute_only'}),{enabled:false,only:false});
console.log(JSON.stringify({pass:true,scope:'actual_collector_mode_selection',checks:['daytrade_default_memory','legacy_persistence_retained','explicit_rollback','one_minute_only','other_roles_unchanged'],process_started:false}));
