'use strict';
// Invoked only by the isolated integration test. Production runners never import this file.
const fs=require('fs'),path=require('path');
(async()=>{
 const config=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),stage=process.argv[3];
 if(config.contract!=='cleanup-isolated-test-v1'||!config.runtime.includes('cleanup-parent-run-')||path.resolve(config.runtime).toLowerCase().startsWith('c:\\fuman-runtime'))throw Error('fixture_scope_invalid');
 if(stage==='incident'||stage==='authority'){if(!fs.existsSync(config.auth.file))throw Error('fixture_context_missing');console.log(JSON.stringify({scope:'isolated preflight fixture, not formal authority',stage,ok:true}));return;}
 if(['cost','janitor'].includes(stage)){await require('./cleanup-cost-stage-fixtures.cjs').execute(stage,config.runtime);return;}
 await require('./cleanup-shared-run-fixtures.cjs')[stage](config.runtime,config.auth,{});
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
