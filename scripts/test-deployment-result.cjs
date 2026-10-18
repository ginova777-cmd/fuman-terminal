'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { identify } = require('../lib/deployment-result.cjs');
const { CONTRACT } = require('../lib/morning-web-release-contract.cjs');
const dir = 'outputs/morning-formal-release-95b0f98';
const stderr = fs.readFileSync(dir + '/formal-deploy.stderr.txt', 'utf8');
const actual = JSON.parse(fs.readFileSync(dir + '/new-deployment-after-failure.json', 'utf8').replace(/^\uFEFF/, ''));
const url = 'https://' + actual.url;
const rows = [];
function test(name, fn) { fn(); rows.push({ name, status: 'PASS' }); }
test('actual_saved_cli_stderr_with_empty_stdout', () => assert.equal(identify('', stderr, () => actual, CONTRACT).deploymentId, actual.id));
test('plain_machine_stdout', () => assert.equal(identify(url, '', () => actual, CONTRACT).deploymentId, actual.id));
test('same_url_repeated_both_streams_and_ansi', () => assert.equal(identify(url + '\n' + url, '\x1b[32m▲ Production  ' + url + '\x1b[0m\n▲ Aliased https://fuman-terminal.vercel.app', () => actual, CONTRACT).deploymentId, actual.id));
for (const [name, stdout, err] of [
  ['zero_identity', '', 'Build succeeded'],
  ['alias_only', '', '▲ Aliased https://fuman-terminal.vercel.app'],
  ['arbitrary_log_url', '', 'Fetched ' + url],
  ['different_deployments', url, '▲ Production https://different.vercel.app'],
  ['host_suffix_attack', '', '▲ Production ' + url + '.evil.example'],
]) test(name, () => assert.throws(() => identify(stdout, err, () => { throw Error('inspect_should_not_run'); }, CONTRACT), /deployment_result_url_ambiguous/));
for (const patch of [{id:CONTRACT.deploymentId},{url:'wrong.vercel.app'},{name:'wrong'},{contextName:'wrong'}, {target:'preview'}, {readyState:'ERROR'}]) {
  test('reject_identity_' + Object.keys(patch)[0], () => assert.throws(() => identify(url, '', () => ({...actual,...patch}), CONTRACT), /identity_mismatch/));
}
test('inspect_failure_propagates', () => assert.throws(() => identify(url, '', () => {throw Error('HTTP403');}, CONTRACT), /HTTP403/));
const path = require('node:path'), os = require('node:os'), vm = require('node:vm');
for (const kind of ['success', 'child_failure', 'identity_failure']) test('actual_entry_capture_' + kind, () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'morning-result-test-'));
  const receipt = path.join(target, 'result.json');
  fs.writeFileSync(receipt, JSON.stringify({ deploymentUrl: 'old-success' }));
  const env = { FUMAN_RELEASE_SHA: CONTRACT.candidate, FUMAN_RELEASE_BRANCH:'fixture', FUMAN_DEPLOY_RESULT_FILE:receipt };
  const fakeProcess = { env, platform:process.platform, stdout:{write(){}}, stderr:{write(){}}, exit:n=>{throw Error('EXIT:'+n);} };
  const context = { __dirname, process:fakeProcess, console:{log(){},error(){}}, require:name=> {
    if (name === 'child_process') return {spawnSync:()=>({status:kind==='child_failure'?1:0,stdout:'',stderr})};
    if (name === '../lib/morning-web-release-runtime.cjs') return {inspectDeployment:()=>({...actual,readyState:kind==='identity_failure'?'ERROR':'READY'})};
    return require(name);
  }};
  const execute=()=>vm.runInNewContext(fs.readFileSync(path.join(__dirname,'deploy-production-with-release-env.js'),'utf8'),context);
  if(kind==='success') {execute();assert.equal(JSON.parse(fs.readFileSync(receipt)).deploymentId,actual.id);}
  else {assert.throws(execute);assert.equal(fs.existsSync(receipt),false);}
  const files=fs.readdirSync(target);
  assert(files.some(f=>f.endsWith('.previous.json')));
  assert(files.some(f=>f.endsWith('.stdout.txt')));
  assert.equal(fs.readFileSync(path.join(target,files.find(f=>f.endsWith('.stderr.txt'))),'utf8'),stderr);
  assert(files.some(f=>f.endsWith('.process.json')));
});
fs.mkdirSync('outputs/morning-deployment-result-fix', {recursive:true});
fs.writeFileSync('outputs/morning-deployment-result-fix/parser-tests.json', JSON.stringify({ok:true,scope:'actual_saved_cli_stderr_replay_and_negative_fixtures',originalStdoutUnavailable:true,inspectIsSavedEvidenceNotLiveAcceptance:true,rows},null,2));
console.log(JSON.stringify({ok:true,cases:rows.length}));
