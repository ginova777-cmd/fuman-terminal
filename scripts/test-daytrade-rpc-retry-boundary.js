'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { invoke } = require('../lib/daytrade-rpc-observation');
const source = fs.readFileSync(path.join(__dirname, 'run-daytrade-source-writer.js'), 'utf8');
const start = source.indexOf('async function supabaseFetch(');
const end = source.indexOf('\nasync function supabaseGet(', start);
assert(start >= 0 && end > start);
async function scenario(method, fail) {
  let calls = 0;
  const context = { AbortController, setTimeout, clearTimeout,
    SUPABASE_READ_TIMEOUT_MS: 100, SUPABASE_TRANSIENT_RETRIES: 2,
    SUPABASE_RETRY_BASE_DELAY_MS: 0, sleep: async () => {},
    retryableSupabaseFetchError: () => true,
    fetch: async () => { calls++; if (fail) { const error = new Error('aborted'); error.name = 'AbortError'; throw error; }
      return {ok:true,status:200,headers:{get:()=>null},text:async()=>'[]'}; },
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context);
  let evidence;
  const request = invoke({resource:'lease',send:()=>context.supabaseFetch('https://fixture.invalid',{method}),onFailure:value=>{evidence=value;}});
  if (fail) await assert.rejects(request, /aborted/); else await request;
  return {calls,evidence};
}
(async()=>{
  for (const method of ['POST','PATCH','PUT','DELETE']) {
    const result=await scenario(method,true); assert.equal(result.calls,1);
    assert.equal(result.evidence.retry_performed,false);
    assert.equal(result.evidence.execution_outcome,'unknown');
  }
  for (const method of ['GET','HEAD']) assert.equal((await scenario(method,true)).calls,3);
  assert.equal((await scenario('POST',false)).calls,1);
  console.log(JSON.stringify({pass:true,network_requests:0,mutation_failure_attempts:1,read_failure_attempts:3}));
})().catch(error=>{console.error(error);process.exitCode=1;});
